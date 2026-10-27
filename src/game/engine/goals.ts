import { BUILDINGS, BUILDING_ORDER } from "../data/buildings";
import { JOBS } from "../data/jobs";
import { RESOURCES } from "../data/resources";
import type { Amounts, BuildingId, GameState, JobId, ResId, ResMap } from "../types";
import { buildingVisible } from "./actions";
import { jobUnlocked, newbornJob } from "./core";
import { resMult, stunnedRats, type Derived } from "./derive";
import { crumbBalance, levelGain } from "./economy";
import { atMaxLevel, buildingCost, canAfford, entries, lockedByCap, marketValue } from "./formulas";
import {
  autoFocus,
  autoFocusOn,
  bottleneckAt,
  crewTarget,
  currentProject,
  donorPool,
  foragerOutput,
  neededSet,
  potentialRates,
  projectNeed,
  STOCK_HORIZON,
  type Bottleneck,
} from "./potential";

/**
 * The colony's goal brain (v3 ENG-1): what the colony is working towards (currentProject), which resource holds it up
 * and for how long (projectBottleneck, by POTENTIAL production, so a full store never reads as «≈ 1e25 д»), which
 * building helps it most right now (buildNowPick) and where the next newborn goes (newbornTarget, with the auto focus
 * while the player has not picked one). Pure functions of (state, derived); GoalWidget 2.0 (COL-2), the Jobs tab
 * (PAN-1), the elder's hints (hints.ts) and the newcomer bot (scripts/sim-core.ts) read them. The potential-production
 * half lives in potential.ts (the economy tick needs it too) and is re-exported here.
 */

export {
  AUTO_FOOD_MARGIN,
  autoFocus,
  autoFocusOn,
  bottleneckAt,
  crewTarget,
  crumbGross,
  currentProject,
  donorPool,
  expeditionBottleneck,
  expressBottleneck,
  fasterShortfall,
  foragerOutput,
  foragersNeeded,
  jobFor,
  jobsAfterMove,
  movableTo,
  neededSet,
  potentialRate,
  potentialRates,
  projectBottleneck,
  projectForText,
  projectName,
  projectNeed,
  projectShortfall,
  shortfallAfterMove,
  slotMakerOf,
  upkeep,
  type Bottleneck,
  type Donor,
  type Project,
} from "./potential";

/** An ETA above this (2 h) reads «долго» rather than a number (COL-2). */
export const ETA_LONG_SEC = 7200;

export interface BuildNowPick {
  id: BuildingId;
  /** "useful": it shortens the current project; "cheap": nothing does, this is the cheapest buy. */
  kind: "useful" | "cheap";
  /** Minutes the current project's ETA drops by (null for "cheap"). */
  minutesSaved: number | null;
}

/* ================================================================ newborns */

/**
 * Where the next newborn goes and why (PAN-1 «авто» badge): `auto` when the colony picks the focus by itself
 * (autoFocusOn: no flags.focus_manual and the newborns follow the star, i.e. focus mode), `reason` a short line such
 * as «для «Канализации» не хватает 🪙» (null when there is nothing to add). The same choice core.newbornJob makes in
 * the tick.
 */
export function newbornTarget(s: GameState, d: Derived): { job: JobId; auto: boolean; reason: string | null } {
  const crumbNet = crumbBalance(s, d);
  if (!autoFocusOn(s)) return { job: newbornJob(s, d, crumbNet), auto: false, reason: null };
  if (crumbNet < 0) return { job: newbornJob(s, d, crumbNet), auto: true, reason: "еда в минусе: Старейшина шлёт всех кормить колонию" };
  const a = autoFocus(s, d);
  const job = newbornJob(s, d, crumbNet, () => a.job);
  return { job, auto: true, reason: job === a.job ? a.reason : null };
}

/* ================================================================ build now */

/** A store (cap / capMult only, no production): buying it never shortens a project by itself. */
function isStorage(id: BuildingId): boolean {
  const fx = BUILDINGS[id].effects;
  return fx.some((e) => e.t === "cap" || e.t === "capMult") && !fx.some((e) => e.t === "produce" || e.t === "slots" || e.t === "jobPct");
}

/** ETA used to compare picks: Infinity is capped so that "becomes produced at all" still counts as a saving. */
function etaForCompare(b: Bottleneck | null): number {
  if (!b) return 0;
  return Math.min(b.etaSec, ETA_LONG_SEC * 10);
}

/**
 * Extra production of one more level of `id`, as the colony would run it: levelGain (produce effects, job bonuses on
 * the current workers, multipliers) plus its new job slots manned from the rats that can be spared (donorPool: the
 * idle, crews whose output overflows, surplus foragers), which the elder's «пустует» hint does next (so the first
 * workshop is worth its ⚙️, not nothing). Temporary buffs (a feast) are left out, as in potentialRates.
 */
export function buildGain(s: GameState, d: Derived, id: BuildingId, rates: ResMap = potentialRates(s, d), needed?: Set<ResId>): Partial<Record<ResId, number>> {
  const gain = levelGain(s, d, id, 1);
  // levelGain diffs live gross rates, a feast's ×5 and all; the potential rates it is added to leave such buffs out
  if (d.temp !== 1) for (const r of Object.keys(gain) as ResId[]) if (!RESOURCES[r].excludeGlobal) gain[r] = gain[r]! / d.temp;
  const workforce = s.rats > 0 ? 1 - stunnedRats(s) / s.rats : 1;
  for (const e of BUILDINGS[id].effects) {
    if (e.t !== "slots") continue;
    const j = e.job;
    const pool = donorPool(s, d, j, rates, needed ?? neededSet(s, d, rates));
    const slotsNow = jobUnlocked(s, j) && Number.isFinite(d.slots[j]) ? d.slots[j] : 0;
    let n = Math.min(Math.max(0, slotsNow + e.amt - s.jobs[j]), e.amt, pool.reduce((a, x) => a + x.n, 0));
    if (n <= 0) continue;
    // the foragers among them stop gathering 🍞 (the others only overflowed a full store, or idled)
    let left = n;
    for (const x of pool) {
      const take = Math.min(left, x.n);
      if (x.job === "forager") gain.crumbs = (gain.crumbs ?? 0) - take * foragerOutput(s, d);
      left -= take;
    }
    n -= left;
    const rate = n * d.jobSpeed[j] * workforce;
    let eff = 1;
    for (const [c, vc] of entries(JOBS[j].consumes)) eff = Math.min(eff, (Math.max(0, rates[c]) + Math.max(0, s.res[c]) / STOCK_HORIZON) / (rate * vc));
    eff = Math.max(0, Math.min(1, eff));
    for (const [c, vc] of entries(JOBS[j].consumes)) gain[c] = (gain[c] ?? 0) - rate * vc * eff;
    for (const [r, v] of entries(JOBS[j].produces)) gain[r] = (gain[r] ?? 0) + rate * v * d.jobYield[j] * resMult(s, d, r, false) * eff;
  }
  return gain;
}

/**
 * What «Выгодно сейчас» leaves in the stores: the next nest's price while full housing keeps the colony below the rats
 * it needs to move on (crewTarget) and the nest fits the pantry — a pick must not eat the crew's beds.
 */
export function pickReserve(s: GameState, d: Derived): Amounts {
  if (s.rats < d.housing || s.rats >= crewTarget(s) || !buildingVisible(s, "nest") || (s.upgrades.foreman && s.foreman.nests)) return {};
  const cost = buildingCost("nest", s.buildings.nest);
  return lockedByCap(cost, d).length ? {} : cost;
}

/**
 * «Выгодно сейчас» (COL-2): among the visible, affordable, not maxed, not cap-locked non-store buildings, the one that
 * saves the current project the most minutes per market value («useful», ≥ 0.05 min; buildGain: its extra production
 * and its new slots manned; its own price comes out of the stock the project would use); otherwise the cheapest such
 * building («cheap»). null when nothing is affordable.
 */
export function buildNowPick(s: GameState, d: Derived): BuildNowPick | null {
  const candidates: { id: BuildingId; cost: Amounts; value: number }[] = [];
  const reserve = pickReserve(s, d);
  for (const id of BUILDING_ORDER) {
    if (atMaxLevel(s, id)) continue;
    if (isStorage(id) || !buildingVisible(s, id)) continue;
    const cost = buildingCost(id, s.buildings[id]);
    if (lockedByCap(cost, d).length > 0 || !canAfford(s, cost)) continue;
    // the nest the crew waits for is the pick itself, or nothing that eats its price
    if (id !== "nest" && entries(cost).some(([r, v]) => (reserve[r] ?? 0) > 0 && s.res[r] - v < (reserve[r] ?? 0))) continue;
    candidates.push({ id, cost, value: Math.max(1e-9, marketValue(cost)) });
  }
  if (!candidates.length) return null;
  const project = currentProject(s);
  if (project) {
    const { need, paid } = projectNeed(s, project);
    const rates = potentialRates(s, d);
    const needed = neededSet(s, d, rates);
    const now = etaForCompare(bottleneckAt(s, d, rates, need, paid));
    let best: BuildNowPick | null = null;
    let bestScore = -Infinity;
    if (now > 0) {
      for (const c of candidates) {
        const gain = buildGain(s, d, c.id, rates, needed);
        const after = { ...rates };
        for (const [r, v] of Object.entries(gain) as [ResId, number][]) after[r] += v;
        // its own price comes out of the stock the project would use
        const s2: GameState = { ...s, res: { ...s.res } };
        for (const [r, v] of entries(c.cost)) s2.res[r] = Math.max(0, s2.res[r] - v);
        const saved = (now - etaForCompare(bottleneckAt(s2, d, after, need, paid))) / 60;
        if (!(saved >= 0.05)) continue;
        const score = saved / c.value;
        if (score > bestScore) {
          bestScore = score;
          best = { id: c.id, kind: "useful", minutesSaved: saved };
        }
      }
    }
    if (best) return best;
  }
  const cheapest = candidates.reduce((a, b) => (b.value < a.value ? b : a));
  return { id: cheapest.id, kind: "cheap", minutesSaved: null };
}
