"use client";

/**
 * Event close-up host: an overlay over the colony window (whole screen on phones) that shows the running
 * `game.scene`. Attaches the UI to the engine while mounted (the engine then waits for our results).
 */
import { useEffect } from "react";
import { useGame } from "@/game/store";
import type { SceneEventId } from "@/game/types";
import CarriageScene from "./CarriageScene";
import CatScene from "./CatScene";
import DownpourScene from "./DownpourScene";
import { MarketChip } from "./MarketPopup";
import RatcatcherScene from "./RatcatcherScene";
import SceneFrame from "./SceneFrame";
import TrainScene from "./TrainScene";
import { actQuiet } from "./sceneUtils";

const PHASE_LABEL: Record<string, string> = {
  warn: "Тревога",
  rumble: "Гул",
  catch: "Лови!",
  piles: "Разбор завалов",
  taps: "В бой",
  haul: "Улов",
  done: "",
};

export default function SceneHost() {
  const id = useGame((s) => s.game.scene?.id ?? null);
  const seq = useGame((s) => s.game.scene?.seq ?? 0);
  if (!id) return null;
  return (
    <div className="fixed inset-0 z-40 md:absolute md:inset-0 md:z-20" role="dialog" aria-modal="false" aria-label="Событие крупным планом">
      <SceneInstance key={seq} id={id} seq={seq} />
    </div>
  );
}

function SceneInstance({ id, seq }: { id: SceneEventId; seq: number }) {
  useEffect(() => {
    if (useGame.getState().game.scene?.seq === seq) actQuiet({ a: "attach" });
    return () => {
      if (useGame.getState().game.scene?.seq === seq) actQuiet({ a: "detach" });
    };
  }, [seq]);
  return (
    <SceneFrame
      id={id}
      right={
        <>
          <PhaseBadge />
          <MarketChip />
        </>
      }
    >
      <SceneBody />
    </SceneFrame>
  );
}

function PhaseBadge() {
  const phase = useGame((s) => s.game.scene?.phase ?? "done");
  const label = PHASE_LABEL[phase];
  if (!label) return null;
  return <span className="rounded border border-brass-dark/70 bg-black/30 px-1.5 py-0.5 font-display text-[11px] font-bold uppercase tracking-widest text-brass">{label}</span>;
}

/** Routes the running scene to its body component (re-renders with the scene, ~10 Hz). */
function SceneBody() {
  const scene = useGame((s) => s.game.scene);
  if (!scene) return null;
  switch (scene.id) {
    case "carriage":
      return <CarriageScene scene={scene} />;
    case "capsule":
    case "metro_train":
    case "royal_express":
      return <TrainScene scene={scene} />;
    case "downpour":
      return <DownpourScene scene={scene} />;
    case "cat":
      return <CatScene scene={scene} />;
    case "ratcatcher":
      return <RatcatcherScene scene={scene} />;
  }
}
