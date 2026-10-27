import { CHARTER_MAX, CHARTER_MULT, CHARTER_MULT_CAP } from "../data/commissions";
import { curioPerks } from "../data/curios";
import type { GameState, Meta } from "../types";

/**
 * One source for the meta multipliers (v3 ENG-3/ENG-7): derive.ts (globalParts «Крысиный экспресс», «Венцы»),
 * formulas.ts (crowns for the run), narrative.ts (migration preview) and the panels all read these, so the numbers
 * the UI prints are the numbers the engine multiplies by. Pure, no engine imports.
 */

/** Production bonus per crown ever earned, in percent: 2, or 3 with «Милость Короля». */
export function crownPctPer(meta: Pick<Meta, "edicts">): number {
  return meta.edicts.kings_favor ? 3 : 2;
}

/** The «Венцы» production multiplier: 1 + crownPctPer% × crownsEver. */
export function crownsMult(meta: Pick<Meta, "edicts" | "crownsEver">): number {
  return 1 + (crownPctPer(meta) / 100) * meta.crownsEver;
}

/**
 * Crowns multiplier of the charters earned this run (×1.05 each, at most CHARTER_MULT_CAP); with the full «Город» set of
 * «Кунсткамера Короля» (v3 ENG-10) the charters of a run that has any are worth ×1.06 more. `meta` is optional so
 * the panels can ask what n charters give.
 */
export function charterMult(s: Pick<GameState, "charters"> & { meta?: Pick<Meta, "curios"> }): number {
  const n = Math.max(0, Math.min(CHARTER_MAX, s.charters ?? 0));
  const city = n > 0 && s.meta ? curioPerks(s.meta).charterMult : 1;
  return Math.min(CHARTER_MULT_CAP, Math.pow(CHARTER_MULT, n)) * city;
}

/** Another charter would not raise charterMult (the cap or CHARTER_MAX is reached): PAN-2 / SHL greys the reward out. */
export function charterAtCap(s: Pick<GameState, "charters">): boolean {
  const n = s.charters ?? 0;
  return n >= CHARTER_MAX || charterMult({ charters: n + 1 }) <= charterMult({ charters: n }) + 1e-12;
}

/**
 * Multiplier on the crowns of this run: the coronation's ×1.25 and the King's charters. The Great Seals do not touch
 * crowns (v3 ENG-8 aims Dynasty and Silence at the 📜/💍 production instead).
 */
export function crownBonusMult(s: Pick<GameState, "coronatedThisRun" | "charters"> & { meta?: Pick<Meta, "curios"> }): number {
  return (s.coronatedThisRun ? 1.25 : 1) * charterMult(s);
}

/** Production bonus of one express stage (+20%, additive) and of one post-coronation wagon (×1.10, compound). */
export const EXPRESS_STAGE_PCT = 20;
export const EXPRESS_WAGON_MULT = 1.1;

/**
 * The «Крысиный экспресс» production multiplier: (1 + 0.2·stage) · 1.1^wagons (v3 ENG-3: every wagon is an honest
 * ×1.10 to everything, as its toast says; v2 added +0.1 per wagon, only +3% at stage 10).
 */
export function expressMult(s: Pick<GameState, "express">): number {
  return (1 + (EXPRESS_STAGE_PCT / 100) * s.express.stage) * Math.pow(EXPRESS_WAGON_MULT, s.express.wagons);
}

/** The express bonus to all production in percent (ExpressPanel «+X% ко всему»): (expressMult − 1) × 100. */
export function expressBonusPct(s: Pick<GameState, "express">): number {
  return (expressMult(s) - 1) * 100;
}
