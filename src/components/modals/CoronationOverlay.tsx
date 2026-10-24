"use client";

/**
 * Coronation (GDD 13.32): decides when the ceremony opens. It opens on the engine fx "coronation" (the AudioDirector
 * plays sfx.coronationBells()), or after the offline report when it says `coronated`; `?coronation` in the URL opens
 * it on mount for testing. The show itself (./Celebration: the express collecting the colony, twelve bells, confetti,
 * the crowned portrait and the coronationLine() of the right weekday) is a lazily loaded chunk (SH-5), fetched ahead
 * once the express nears its last stage or the offline report brings a coronation.
 */
import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { sfx } from "@/audio/sfx";
import { onFx } from "@/game/fx";
import { useGame, type GameStore } from "@/game/store";
import CeremonyLoading from "./CeremonyLoading";

const loadShow = () => import("./Celebration");
const Celebration = dynamic(loadShow, { ssr: false, loading: () => <CeremonyLoading label="Коронация Крысиного Короля" /> });

/** Express stage from which the show's chunk is fetched ahead (the coronation completes stage 10). */
const PREFETCH_STAGE = 8;
const soonCrowned = (st: GameStore) => st.game.express.stage >= PREFETCH_STAGE || !!st.offlineReport?.coronated;

export default function CoronationOverlay() {
  const [dev] = useState(() => typeof window !== "undefined" && window.location.search.includes("coronation"));
  const [run, setRun] = useState(dev ? 1 : 0);
  const [open, setOpen] = useState(dev);

  // A coronation finished while away («Автовзнос», offline catch-up) arrives together with the offline report:
  // it waits until the report is closed instead of playing hidden under it, and opens once, however it is learned
  // of (the report's `coronated`, the fx, or both).
  useEffect(() => {
    let pending = !!useGame.getState().offlineReport?.coronated;
    const show = () => {
      pending = false;
      setRun((n) => n + 1);
      setOpen(true);
    };
    const offStore = useGame.subscribe((st, prev) => {
      if (st.offlineReport === prev.offlineReport) return;
      if (st.offlineReport?.coronated) pending = true;
      else if (!st.offlineReport && pending) {
        show();
        // the AudioDirector rang on the fx, under the report (or still muted before the first gesture)
        sfx.coronationBells();
      }
    });
    const offFx = onFx((fx) => {
      if (fx.k !== "coronation") return;
      if (useGame.getState().offlineReport) pending = true;
      else show();
    });
    return () => {
      offStore();
      offFx();
    };
  }, []);

  // dev hook: no engine fx fired, so ring the bells ourselves (audible only after a user gesture)
  useEffect(() => {
    if (dev) sfx.coronationBells();
  }, [dev]);

  // fetch the show's chunk before it is needed, once
  useEffect(() => {
    if (soonCrowned(useGame.getState())) {
      void loadShow();
      return;
    }
    const off = useGame.subscribe((st) => {
      if (!soonCrowned(st)) return;
      off();
      void loadShow();
    });
    return off;
  }, []);

  // the game clock is held while the show plays (no train or event under it); useGameLoop credits the time after
  useEffect(() => {
    if (!open) return;
    const st = useGame.getState();
    st.setCeremony(true);
    return () => st.setCeremony(false);
  }, [open]);

  const close = useCallback(() => setOpen(false), []);
  if (!open) return null;
  return <Celebration key={run} onClose={close} />;
}
