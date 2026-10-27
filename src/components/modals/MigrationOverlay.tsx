"use client";

/**
 * The Great Migration ceremony (SH-5), opened by the engine Fx "migration". «Обустроиться в …» (or Esc) closes it onto
 * the «Переселение» tab, where the new crowns buy edicts. The ceremony card itself (./MigrationCeremony: the front
 * page, the marching rats, the crown counter, the King's new tail) is a lazily loaded chunk, fetched ahead once the
 * Great Migration becomes possible (canMigrate).
 */
import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { canMigrate } from "@/game/engine/formulas";
import { onFx } from "@/game/fx";
import { useGame } from "@/game/store";
import type { Fx } from "@/game/types";
import { useBackCloses } from "@/lib/useBackCloses";
import CeremonyLoading from "./CeremonyLoading";

type MigrationFx = Extract<Fx, { k: "migration" }>;

const loadCeremony = () => import("./MigrationCeremony");
const Ceremony = dynamic(loadCeremony, { ssr: false, loading: () => <CeremonyLoading label="Великое Переселение" /> });

export default function MigrationOverlay() {
  const [fx, setFx] = useState<{ n: number; data: MigrationFx } | null>(null);
  useEffect(
    () =>
      onFx((f) => {
        if (f.k === "migration") setFx((prev) => ({ n: (prev?.n ?? 0) + 1, data: f }));
      }),
    [],
  );
  // fetch the ceremony's chunk before it is needed, once
  useEffect(() => {
    if (canMigrate(useGame.getState().game)) {
      void loadCeremony();
      return;
    }
    const off = useGame.subscribe((st) => {
      if (!canMigrate(st.game)) return;
      off();
      void loadCeremony();
    });
    return off;
  }, []);
  // the game clock is held while the card is open (the new run starts once it is closed); see useGameLoop
  const open = !!fx;
  useEffect(() => {
    if (!open) return;
    const st = useGame.getState();
    st.setCeremony(true);
    return () => st.setCeremony(false);
  }, [open]);
  const close = useCallback(() => {
    setFx(null);
    useGame.getState().setTab("migration");
  }, []);
  // phones: the system Back closes the card like «Обустроиться в …» instead of leaving the game
  useBackCloses(open, close);
  if (!fx) return null;
  return <Ceremony key={fx.n} data={fx.data} onClose={close} />;
}
