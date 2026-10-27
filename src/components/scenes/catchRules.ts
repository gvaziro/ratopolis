/**
 * Pure rules of the catch canvas (v3 SCN-2), kept apart from the canvas so vitest can pin them down: the crash lockout
 * of the pointer gate, the rebounds of a landing item (the circus juggles its loot) and how visible an item is in the
 * «Гороховый суп» fog.
 */
import type { TrainVariantDef } from "@/game/types";

/* ------------------------------------------------------------ crash lockout */

/** After a crash («Тележки перевернулись») the crew is still on its back: no paw catches for this long into the pass. */
export const CRASH_LOCK_S = 1.2;

/** Whether a fresh pointer (or the keyboard paw) may start catching at pass time `t` (s since the catch began). */
export function acceptsPointerDown(t: number, crash: boolean): boolean {
  return !crash || !(t < CRASH_LOCK_S);
}

/* ------------------------------------------------------------ rebounds */

export interface BounceRule {
  /** Rebounds before the item settles. */
  max: number;
  /** Share of the vertical speed kept on each rebound. */
  restitution: number;
  /** Launch speed multiplier (how high the car flings it). */
  launch: number;
}

/** Hard cap on rebounds, whatever a variant asks for. */
export const MAX_BOUNCES = 3;

/**
 * How an item rebounds: one bounce (rail 0.42, the carriage floor 0.34) unless the train variant juggles its loot
 * (TRAIN_VARIANTS.circus: up to 3 rebounds, restitution 0.72, launch ×1.25). Sparks never juggle.
 */
export function bounceRule(mode: "train" | "fall" | "float", variant: Pick<TrainVariantDef, "bounces" | "restitution" | "launchMul"> | null | undefined, spark: boolean): BounceRule {
  const base: BounceRule = { max: 1, restitution: mode === "train" ? 0.42 : 0.34, launch: 1 };
  if (mode !== "train" || spark || !variant) return base;
  return {
    max: Math.max(0, Math.min(MAX_BOUNCES, Math.round(variant.bounces ?? base.max))),
    restitution: Math.max(0, Math.min(0.95, variant.restitution ?? base.restitution)),
    launch: Math.max(0.2, variant.launchMul ?? 1),
  };
}

/**
 * An item hits the ground with downward speed `vy` after `bounces` rebounds: it flies up again (the new, negative vy)
 * while it still has rebounds left and comes down faster than `minVy`; otherwise it settles (null).
 */
export function rebound(vy: number, bounces: number, rule: BounceRule, minVy: number): number | null {
  if (bounces >= rule.max || !(vy > minVy)) return null;
  return -vy * rule.restitution;
}

/* ------------------------------------------------------------ fog */

/** Alpha of loot lost in the fog. */
export const FOG_DIM = 0.25;
/** Loot this close to a pointer or the paw shows in full … */
export const FOG_NEAR_PX = 110;
/** … and fades back into the fog over this much more. */
export const FOG_FADE_PX = 40;
/** A landing glints: full alpha for this long after the first touch of the ground. */
export const FOG_GLINT_S = 0.4;

/**
 * How visible an item is in the fog: 1 in the lantern cone, within FOG_GLINT_S of landing or within FOG_NEAR_PX of a
 * pointer / the paw (`near` = the nearest distance, Infinity when there is none); else FOG_DIM, with a soft edge.
 */
export function fogAlpha(near: number, inCone: boolean, sinceLanding: number): number {
  if (inCone) return 1;
  if (sinceLanding >= 0 && sinceLanding <= FOG_GLINT_S) return 1;
  if (!(near > FOG_NEAR_PX)) return Number.isNaN(near) ? FOG_DIM : 1;
  if (near >= FOG_NEAR_PX + FOG_FADE_PX) return FOG_DIM;
  const k = (near - FOG_NEAR_PX) / FOG_FADE_PX;
  return 1 - (1 - FOG_DIM) * k;
}
