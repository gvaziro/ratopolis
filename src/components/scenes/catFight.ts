/**
 * Pure rules of the cat fight (v3 SCN-4), kept apart from the DOM so vitest can pin them down. The paw creeps towards
 * the huddle and lunges on a beat (engine catLungeAt: peaks 0.6 + 1.1·n ± 0.15 s into the fight): 0.3 s of wind-up
 * (the claws glint), then a 0.2 s lunge (+0.12 reach) centred on the peak. A hit within ±CAT_COUNTER_WINDOW of a peak
 * is «Контрудар!»: it counts as 3 hits and knocks the paw back twice as far, once per lunge; every other hit counts 1
 * (mashing still beats the early cats). Space is auto-aimed, so for the keyboard the whole glint counts.
 */
import { CAT_COUNTER_WINDOW, catLungeAt } from "@/game/engine/events";

/** The claws glint this long before a peak. */
export const LUNGE_WINDUP = 0.3;
/** The lunge itself, centred on the peak … */
export const LUNGE_S = 0.2;
/** … reaches this much further (share of the way to the huddle). */
export const LUNGE_REACH = 0.12;
/** A counter counts as this many hits … */
export const COUNTER_HITS = 3;
/** … and knocks the paw back this many times as far. */
export const COUNTER_KNOCK = 2;

/** The paw's reach: starts here, creeps CREEP over the whole fight, a hit knocks it back KNOCK / hp, 0.9 = the huddle. */
export const REACH_START = 0.2;
export const REACH_MIN = 0.04;
export const REACH_LOSE = 0.9;
export const CREEP = 0.85;
export const KNOCK = 1.4;

/** The lunge whose peak is nearest to fight time t. */
export function nearestLunge(seq: number, t: number): { n: number; peak: number } {
  const n0 = Math.max(0, Math.round((t - 0.6) / 1.1));
  let best = { n: n0, peak: catLungeAt(seq, n0) };
  for (const n of [n0 - 1, n0 + 1]) {
    if (n < 0) continue;
    const peak = catLungeAt(seq, n);
    if (Math.abs(peak - t) < Math.abs(best.peak - t)) best = { n, peak };
  }
  return best;
}

export interface LungeState {
  n: number;
  peak: number;
  /** 0..1 through the wind-up (the claws glint), −1 outside it. */
  windup: number;
  /** The glint is up: from the wind-up to the end of the counter window (not after a counter). */
  glint: boolean;
  /** Extra reach of the lunge right now (0 after a counter). */
  bump: number;
}

/** What the paw is doing at fight time t (`countered`: lunges already countered). */
export function lungeAt(seq: number, t: number, countered: ReadonlySet<number>): LungeState {
  const { n, peak } = nearestLunge(seq, t);
  const done = countered.has(n);
  const windup = t >= peak - LUNGE_WINDUP && t < peak ? (t - (peak - LUNGE_WINDUP)) / LUNGE_WINDUP : -1;
  const glint = !done && t >= peak - LUNGE_WINDUP && t <= peak + CAT_COUNTER_WINDOW;
  const u = (t - (peak - LUNGE_S / 2)) / LUNGE_S;
  const bump = !done && u >= 0 && u <= 1 ? LUNGE_REACH * Math.sin(Math.PI * u) : 0;
  return { n, peak, windup, glint, bump };
}

/**
 * The lunge a hit at fight time t counters, or −1. A pointer must land within ±CAT_COUNTER_WINDOW of the peak; the
 * keyboard's Space (auto-aimed at the paw) counts anywhere in the glint. Each lunge is countered at most once.
 */
export function counterOf(seq: number, t: number, countered: ReadonlySet<number>, keyboard = false): number {
  const { n, peak } = nearestLunge(seq, t);
  if (countered.has(n)) return -1;
  const from = peak - (keyboard ? LUNGE_WINDUP : CAT_COUNTER_WINDOW);
  return t >= from && t <= peak + CAT_COUNTER_WINDOW ? n : -1;
}

/** One hit: how many it counts and how far it knocks the paw back. */
export function tapEffect(hp: number, counter: boolean): { hits: number; knock: number } {
  const k = KNOCK / Math.max(1, hp);
  return counter ? { hits: COUNTER_HITS, knock: k * COUNTER_KNOCK } : { hits: 1, knock: k };
}

/** The paw creeps for dt seconds of a fight that lasts `total` seconds. */
export function creep(reach: number, dt: number, total: number): number {
  return reach + (CREEP / Math.max(0.1, total)) * Math.max(0, dt);
}

/** The paw knocked back by a hit. */
export function knockBack(reach: number, knock: number): number {
  return Math.max(REACH_MIN, reach - knock);
}
