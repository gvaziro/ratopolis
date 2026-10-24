"use client";

/**
 * Train-like scenes (capsule, metro train, royal express): routes the phases
 * rumble → catch → piles → haul over a shared backdrop.
 */
import type { Scene } from "@/game/types";
import CapsuleTube from "./CapsuleTube";
import HaulCard from "./HaulCard";
import PilesPhase from "./PilesPhase";
import { TrainBackdrop, type TrainVariant } from "./TrainBackdrop";
import TrainPass from "./TrainPass";
import TrainRumble from "./TrainRumble";

export default function TrainScene({ scene }: { scene: Scene }) {
  const variant: TrainVariant = scene.id === "capsule" ? "capsule" : scene.id === "royal_express" ? "royal" : "metro";
  const capsule = variant === "capsule";
  // a capsule keeps its piles on screen through "done" (no haul card) — unless everything was caught and the
  // engine skipped the piles phase (same emptiness test as beginPiles): then there is nothing to show
  const capsulePiles = capsule && scene.phase === "done" && scene.piles.some((p) => Object.keys(p).length > 0);
  return (
    <div className="absolute inset-0 select-none overflow-hidden">
      <TrainBackdrop variant={variant} />
      {capsule && scene.phase !== "rumble" && <CapsuleTube />}
      {scene.phase === "rumble" && <TrainRumble scene={scene} />}
      {scene.phase === "catch" && <TrainPass key={`c${scene.phaseStart}`} scene={scene} />}
      {(scene.phase === "piles" || capsulePiles) &&<PilesPhase key={`p${scene.seq}`} scene={scene} />}
      {scene.phase === "haul" && <HaulCard key={`h${scene.phaseStart}`} scene={scene} />}
    </div>
  );
}
