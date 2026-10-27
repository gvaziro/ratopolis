/**
 * Rules of the resource pills (v3 SHL-4, mobile-9), pure and tested (pillRules.test.ts):
 * - the spoken name of a pill for screen readers: «Крошки: 10,1 тыс. из 11,8 тыс., +155 в секунду, перегруз»;
 * - the phone order (< 640 px, where only ~4 pills fit across): what the colony's current goal still needs first
 *   (the elder's hint, the expedition or the express stage), then what runs out or overflows (net rate < 0, a full
 *   store, «ПЕРЕГРУЗ»), then the usual RES_ORDER. Stable within each group.
 */
import { RESOURCES, RES_ORDER } from "@/game/data/resources";
import { UPGRADES } from "@/game/data/upgrades";
import { expressCost } from "@/game/engine/actions";
import type { Derived } from "@/game/engine/derive";
import { buildingCostFor } from "@/game/engine/economy";
import { entries, expeditionCost } from "@/game/engine/formulas";
import { currentProject } from "@/game/engine/goals";
import { nextHint } from "@/game/engine/hints";
import type { Amounts, GameState, ResId } from "@/game/types";
import { fmt } from "@/lib/format";

/** fmt's suffixes as a Russian reader says them. */
const SPOKEN_SUFFIX: Record<string, string> = { K: " тыс.", M: " млн", B: " млрд", T: " трлн", Qa: " квадрлн", Qi: " квинтлн" };

/** A number as a screen reader should say it: 10100 → «10,1 тыс.», 1.5 → «1,5», 2.3e45 → «2,3e45». */
export function spoken(n: number): string {
  const s = fmt(n);
  const m = /^(-?[\d.]+)([A-Za-z]+)$/.exec(s);
  const num = (m ? m[1] : s).replace(".", ",").replace(/^-/, "−");
  if (!m) return num;
  return num + (SPOKEN_SUFFIX[m[2]] ?? m[2]);
}

export interface PillState {
  res: ResId;
  amount: number;
  cap: number;
  rate: number;
  full: boolean;
  over: boolean;
  hungry: boolean;
}

/** The accessible name of a pill: name, stock, limit, net rate, state. */
export function pillLabel(p: PillState): string {
  const parts = [`${RESOURCES[p.res].name}: ${spoken(p.amount)}${Number.isFinite(p.cap) && p.cap > 0 ? ` из ${spoken(p.cap)}` : ""}`];
  if (Math.abs(p.rate) >= 0.005) parts.push(`${p.rate > 0 ? "+" : ""}${spoken(p.rate)} в секунду`);
  if (p.over) parts.push("перегруз");
  else if (p.full) parts.push("склад полон");
  if (p.hungry) parts.push("голод");
  return parts.join(", ");
}

/** What is still missing of a price (`paid` already put in). */
function missing(cost: Amounts, s: GameState, paid?: Amounts): ResId[] {
  const out: ResId[] = [];
  for (const [r, v] of entries(cost)) if (v - (paid?.[r] ?? 0) > 1e-9 && (paid || s.res[r] + 1e-9 < v)) out.push(r);
  return out;
}

/**
 * Resources the colony's current goal still needs: the elder's hint (a building or an upgrade to buy) first, then the
 * project GoalWidget shows (the expedition, else the Rat Express stage). RES_ORDER inside each source, no repeats.
 */
export function goalResources(s: GameState, d: Derived): ResId[] {
  const out: ResId[] = [];
  const add = (rs: ResId[]) => {
    for (const r of RES_ORDER) if (rs.includes(r) && !out.includes(r)) out.push(r);
  };
  const act = nextHint(s, d)?.action;
  if (act?.kind === "buyBuilding") add(missing(buildingCostFor(s, act.id, 1), s));
  else if (act?.kind === "buyUpgrade") add(missing(UPGRADES[act.id].cost, s));
  const p = currentProject(s);
  if (p?.kind === "expedition") add(missing(expeditionCost(s, p.zone), s, s.projects[p.zone] ?? {}));
  else if (p?.kind === "express") add(missing(expressCost(s), s, s.express.progress));
  return out;
}

/**
 * The phone order of the shown pills: the goal's resources, then the urgent ones (draining, full, overloaded), then
 * the rest — each group in its own order (goal: as given; urgent and rest: RES_ORDER via `shown`).
 */
export function orderPills(shown: readonly ResId[], goal: readonly ResId[], urgent: ReadonlySet<ResId>): ResId[] {
  const has = new Set(shown);
  const first = goal.filter((r) => has.has(r));
  const taken = new Set(first);
  const second = shown.filter((r) => !taken.has(r) && urgent.has(r));
  for (const r of second) taken.add(r);
  return [...first, ...second, ...shown.filter((r) => !taken.has(r))];
}

/** Draining (net rate < 0), full or overloaded: worth a glance even when no goal asks for it. */
export function isUrgent(amount: number, cap: number, rate: number): boolean {
  const full = Number.isFinite(cap) && cap > 0 && amount >= cap - 1e-9;
  return rate < -0.005 || full;
}
