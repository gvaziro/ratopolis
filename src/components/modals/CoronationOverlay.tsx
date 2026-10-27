"use client";

/**
 * Coronation (GDD 13.32): decides when the ceremony opens. It opens on the engine fx "coronation" (the AudioDirector
 * plays sfx.coronationBells()), or after the offline report when it says `coronated`; `?coronation` in the URL opens
 * it on mount for testing (`?coronation=repeat`: the short form of a third and later coronation). The show itself
 * (./Celebration: the express collecting the colony, twelve bells, confetti, the crowned portrait and the
 * coronationLine() of the right weekday) is a lazily loaded chunk (SH-5), fetched ahead once the express nears its
 * last stage or the offline report brings a coronation.
 * v3 (SHL-2, K1): a close-up scene holds the show like the offline report does — a coronation finished during a
 * train (the haul card included) waits for the scene to end, and only then holds the clock (setCeremony). The short
 * form rings three bells (bellsOf); on phones the system Back ends the show.
 */
import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { useGame, type GameStore } from "@/game/store";
import { useBackCloses } from "@/lib/useBackCloses";
import CeremonyLoading from "./CeremonyLoading";
import { bellsOf, ringBells, watchCoronation } from "./coronationGate";

const loadShow = () => import("./Celebration");
const Celebration = dynamic(loadShow, { ssr: false, loading: () => <CeremonyLoading label="Коронация Крысиного Короля" /> });

/** Express stage from which the show's chunk is fetched ahead (the coronation completes stage 10). */
const PREFETCH_STAGE = 8;
const soonCrowned = (st: GameStore) => st.game.express.stage >= PREFETCH_STAGE || !!st.offlineReport?.coronated;

export default function CoronationOverlay() {
  const [dev] = useState(() => typeof window !== "undefined" && window.location.search.includes("coronation"));
  const [run, setRun] = useState(dev ? 1 : 0);
  const [open, setOpen] = useState(dev);

  // A coronation finished while away («Автовзнос», offline catch-up) arrives together with the offline report, and
  // one finished during a scene arrives under the falling loot: either waits until the report is closed and the
  // scene is over instead of playing hidden under them, and opens once, however it is learned of (the report's
  // `coronated`, the fx, or both). The store sample that clears the last of them opens the show.
  useEffect(
    () =>
      watchCoronation((late) => {
        setRun((n) => n + 1);
        setOpen(true);
        // the AudioDirector rang on the fx, under the report or the scene (or still muted before the first gesture)
        if (late) ringBells(bellsOf(useGame.getState().game.meta.coronations, window.location.search));
      }),
    [],
  );

  // dev hook: no engine fx fired, so ring the bells ourselves (audible only after a user gesture)
  useEffect(() => {
    if (dev) ringBells(bellsOf(useGame.getState().game.meta.coronations, window.location.search));
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
  // phones: the system Back ends the show like «Да здравствует…» instead of leaving the game
  useBackCloses(open, close);
  if (!open) return null;
  return <Celebration key={run} onClose={close} />;
}
