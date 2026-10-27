/**
 * The meta numbers the panels print (PAN-2), all read from engine/metaMath, so the badge says exactly what derive()
 * multiplies by: the Rat Express bonus and what its next stage or wagon adds, the crown bonus, the charters.
 * Pure (ExpressPanel, MigrationTab; metaText.test.ts checks them against derive()).
 */
import { CHARTER_MULT, CHARTER_MULT_CAP } from "@/game/data/commissions";
import { charterAtCap, charterMult, crownPctPer, crownsMult, expressBonusPct } from "@/game/engine/metaMath";
import type { GameState } from "@/game/types";
import { fmt } from "@/lib/format";

/** A bonus in percent: whole when it is whole («40»), else one decimal («33.1»), compact past a thousand («1.2K»). */
export function pctText(p: number): string {
  if (!Number.isFinite(p)) return "—";
  if (Math.abs(p) >= 1000) return fmt(p);
  const whole = Math.round(p);
  return Math.abs(p - whole) < 0.05 ? String(whole) : p.toFixed(1);
}

/** A multiplier: «1.25», «1.5», «1.63». */
export function multText(m: number): string {
  return Number.isFinite(m) ? String(Math.round(m * 100) / 100) : "—";
}

type ExpressPart = Pick<GameState, "express">;

/** The express stage is done: from here on only wagons are built (after the coronation). */
export function expressCrowned(s: ExpressPart): boolean {
  return s.express.stage >= 10;
}

/**
 * «+X% ко всему» of the Rat Express and what the next step adds: the next stage before the coronation, the next
 * wagon after it (the engine's formula decides; v3 ENG-3 makes the wagons compound).
 */
export function expressBonus(s: ExpressPart): { total: string; next: string } {
  const now = expressBonusPct(s);
  const step = expressCrowned(s) ? { ...s.express, wagons: s.express.wagons + 1 } : { ...s.express, stage: s.express.stage + 1 };
  return { total: pctText(now), next: pctText(expressBonusPct({ express: step }) - now) };
}

/** «Бонус ко всему» of the crowns ever earned, and the percent per crown (2, or 3 with «Милость Короля»). */
export function crownBonus(meta: GameState["meta"]): { total: string; per: number } {
  return { total: pctText((crownsMult(meta) - 1) * 100), per: crownPctPer(meta) };
}

/** The King's charters of this run: the crowns multiplier, the per-charter step and the cap, and whether it is reached. */
export function charterText(s: Pick<GameState, "charters">): { mult: string; per: string; cap: string; atCap: boolean } {
  return { mult: charterMult(s).toFixed(2), per: multText(CHARTER_MULT), cap: multText(CHARTER_MULT_CAP), atCap: charterAtCap(s) };
}
