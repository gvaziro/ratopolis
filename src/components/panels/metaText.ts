/**
 * The meta numbers the panels print (PAN-2), all read from engine/metaMath, so the badge says exactly what derive()
 * multiplies by: the Rat Express bonus and what its next stage or wagon adds, the crown bonus, the charters; and the
 * express stage lines this run reads. Pure (ExpressPanel, MigrationTab; metaText.test.ts checks them against derive()).
 */
import { CHARTER_MAX, CHARTER_MULT } from "@/game/data/commissions";
import { EXPRESS_STAGES, expressStageLine } from "@/game/data/meta";
import { EXPRESS_WAGON_MULT, charterAtCap, charterMult, crownPctPer, crownsMult, expressBonusPct } from "@/game/engine/metaMath";
import type { GameState, LinePair, Meta } from "@/game/types";
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
 * «+X% ко всему» of the Rat Express and what the next step adds (the engine's formula decides): before the coronation
 * `next` is the next stage's +20 points; after it the next wagon multiplies all production by ×`wagon` (v3 ENG-3), so
 * `next` is the gain over current production, +10% exactly as the wagon's toast says (not the badge's difference,
 * which grows with every wagon: +30…+48 points). `after` is the badge once that stage or wagon is built.
 */
export function expressBonus(s: ExpressPart): { total: string; next: string; after: string; wagon: string } {
  const now = expressBonusPct(s);
  const crowned = expressCrowned(s);
  const step = crowned ? { ...s.express, wagons: s.express.wagons + 1 } : { ...s.express, stage: s.express.stage + 1 };
  const after = expressBonusPct({ express: step });
  return {
    total: pctText(now),
    next: pctText(crowned ? (EXPRESS_WAGON_MULT - 1) * 100 : after - now),
    after: pctText(after),
    wagon: multText(EXPRESS_WAGON_MULT),
  };
}

/** «Бонус ко всему» of the crowns ever earned, and the percent per crown (2, or 3 with «Милость Короля»). */
export function crownBonus(meta: GameState["meta"]): { total: string; per: number } {
  return { total: pctText((crownsMult(meta) - 1) * 100), per: crownPctPer(meta) };
}

/**
 * The King's charters of this run: the crowns multiplier, the per-charter step and the cap, and whether it is reached.
 * Pass the state with its `meta`: the full «Город» set of «Кунсткамера Короля» (×1.06, v3 ENG-10) is in the multiplier
 * and the cap, as crownsForRun pays them; without `meta` — what the charters alone give.
 */
export function charterText(s: Pick<GameState, "charters"> & { meta?: Pick<Meta, "curios"> }): {
  mult: string;
  per: string;
  cap: string;
  atCap: boolean;
} {
  return {
    mult: charterMult(s).toFixed(2),
    per: multText(CHARTER_MULT),
    cap: multText(charterMult({ charters: CHARTER_MAX, meta: s.meta })),
    atCap: charterAtCap(s),
  };
}

/** The 👤/🐀 lines of this run's express stages (index = stage − 1): the set the stage news reads (ENG-11, expressLineSet). */
export function expressStageLines(lineSet: number): LinePair[] {
  return EXPRESS_STAGES.map((_, i) => expressStageLine(i + 1, lineSet));
}
