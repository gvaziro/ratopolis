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
  return (
    <div className="absolute inset-0 select-none overflow-hidden">
      <TrainBackdrop variant={variant} />
      {capsule && scene.phase !== "rumble" && <CapsuleTube />}
      {scene.phase === "rumble" && <TrainRumble scene={scene} />}
      {scene.phase === "catch" && <TrainPass key={`c${scene.phaseStart}`} scene={scene} />}
      {(scene.phase === "piles" || (capsule && scene.phase === "done")) && <PilesPhase key={`p${scene.seq}`} scene={scene} />}
      {scene.phase === "haul" && <HaulCard key={`h${scene.phaseStart}`} scene={scene} />}
    </div>
  );
}
