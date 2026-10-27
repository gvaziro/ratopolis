import type { GameState, Scene } from "../types";

/**
 * How useGameLoop credits a held clock (v3 ENG-5, K1 «поезда не теряются»). The clock is held while the tab is hidden
 * or a ceremony is open; on release:
 * - "pause": nothing is credited — a short hold (≤ 60 s) under a ceremony or while a scene UI was driving a scene
 *   (alt-tab in the middle of a train): the scene waits for the player exactly where it was (SCN-1 freezes its clock);
 * - "ticks": a short hold otherwise — store.creditShortHold(away): trains due meanwhile are deferred behind a fresh
 *   «К путям!» (deferTrainsForReturn), then plain ticks;
 * - "catchUp": a long absence (> 60 s) — store.catchUp(away) with its report.
 */
export type HoldCredit = "pause" | "ticks" | "catchUp";

/** Longest hold that is still a pause / plain ticks rather than an absence (s). */
export const SHORT_HOLD_SEC = 60;

/** Shorter holds (a stalled frame) are not credited at all: the frame loop's accumulator covers them. */
export const MIN_CREDIT_SEC = 0.5;

export function holdCredit(o: { away: number; ceremony: boolean; scene: Pick<Scene, "interactive"> | null | undefined }): HoldCredit {
  if (!(o.away <= SHORT_HOLD_SEC)) return "catchUp";
  if (o.ceremony || o.scene?.interactive) return "pause";
  return "ticks";
}

/** The part of the store a release needs (useGame.getState() satisfies it; tests pass the real store too). */
export interface HoldStore {
  game: Pick<GameState, "scene">;
  creditShortHold: (away: number) => void;
  catchUp: (seconds: number) => void;
}

/**
 * Credit a released hold of `away` seconds (useGameLoop's release() and its sleep-gap path): decide with holdCredit and
 * act — "pause" credits nothing, "ticks" = st.creditShortHold(away) (above MIN_CREDIT_SEC), "catchUp" = st.catchUp(away).
 * `drivenScene`: a scene UI was attached when the hold began (the scene is judged by that, or by its state now).
 * Returns the decision.
 */
export function creditHold(st: HoldStore, away: number, ceremony: boolean, drivenScene = false): HoldCredit {
  const how = holdCredit({ away, ceremony, scene: drivenScene ? { interactive: true } : st.game.scene });
  if (how === "catchUp") st.catchUp(away);
  else if (how === "ticks" && away > MIN_CREDIT_SEC) st.creditShortHold(away);
  return how;
}
