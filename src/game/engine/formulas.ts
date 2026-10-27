import { BUILDINGS } from "../data/buildings";
import { districtInfo } from "../data/districts";
import { crownBonusMult } from "./metaMath";
import { HUMAN_ACTIVITIES } from "../data/headlines";
import { EXPRESS_BASE, EXPRESS_GROWTH, WAGON_GROWTH, WAGON_LINEAR, WAGON_LINEAR_RES, type ExpressRes } from "../data/meta";
import { RESOURCES } from "../data/resources";
import { ZONES } from "../data/zones";
import type { Amounts, BuildingId, BuyMode, GameState, ResId, ZoneId } from "../types";
import type { Derived } from "./derive";
import { edictRank } from "./ranks";

export function entries(a: Amounts): [ResId, number][] {
  return Object.entries(a).filter(([, v]) => v !== undefined) as [ResId, number][];
}

/** Cost of buying k levels starting at level n: base * g^n * (g^k - 1)/(g - 1). */
export function buildingCost(id: BuildingId, level: number, k = 1): Amounts {
  const def = BUILDINGS[id];
  const g = def.growth;
  const f = Math.pow(g, level) * (k === 1 ? 1 : (Math.pow(g, k) - 1) / (g - 1));
  const out: Amounts = {};
  for (const [r, base] of entries(def.cost)) out[r] = Math.ceil(base * f);
  return out;
}

export function canAfford(s: GameState, cost: Amounts): boolean {
  for (const [r, v] of entries(cost)) if (s.res[r] + 1e-9 < v) return false;
  return true;
}

/**
 * The highest level a building can be bought to: BUILDINGS[id].maxLevel (Infinity without one); the boiler's 12 plus
 * the current district's boilerMaxDelta (v3 ENG-4). A v2 save above it keeps its level (derive caps the effects).
 */
export function buildingMaxLevel(s: Pick<GameState, "meta">, id: BuildingId): number {
  const max = BUILDINGS[id].maxLevel ?? Infinity;
  return id === "boiler" ? max + (districtInfo(s.meta).trait.mods.boilerMaxDelta ?? 0) : max;
}

/** The building is at (or, from an old save, above) its highest level: nothing more to buy. */
export function atMaxLevel(s: Pick<GameState, "meta" | "buildings">, id: BuildingId): boolean {
  return s.buildings[id] >= buildingMaxLevel(s, id);
}

/** How many levels are affordable right now (respecting buildingMaxLevel and `limit`). */
export function maxAffordable(s: GameState, id: BuildingId, limit = Infinity): number {
  const def = BUILDINGS[id];
  const level = s.buildings[id];
  const room = buildingMaxLevel(s, id) - level;
  let k = Math.min(room, limit);
  if (k <= 0) return 0;
  const g = def.growth;
  for (const [r, base] of entries(def.cost)) {
    const first = base * Math.pow(g, level);
    const n = Math.floor(Math.log(1 + (s.res[r] * (g - 1)) / first) / Math.log(g));
    k = Math.min(k, n);
  }
  // guard against rounding: step down until affordable
  while (k > 0 && !canAfford(s, buildingCost(id, level, k))) k--;
  return Math.max(0, k);
}

/**
 * Levels a buy in this mode would take: ×1 → 1 or 0; ×10 → exactly 10 (or the levels left below maxLevel) or 0,
 * never a partial batch; "max" → as many as affordable.
 */
export function buyCount(s: GameState, id: BuildingId, mode: BuyMode): number {
  if (mode === "max") return maxAffordable(s, id);
  if (mode === 10) {
    const room = buildingMaxLevel(s, id) - s.buildings[id];
    const want = Math.min(10, room);
    return want > 0 && maxAffordable(s, id, want) === want ? want : 0;
  }
  return maxAffordable(s, id, mode);
}

/** Resources in `cost` whose price exceeds the storage cap (🔒 нужен склад). */
export function lockedByCap(cost: Amounts, d: Derived): ResId[] {
  const out: ResId[] = [];
  for (const [r, v] of entries(cost)) if (Number.isFinite(d.caps[r]) && v > d.caps[r]) out.push(r);
  return out;
}

/** Seconds until affordable at the current net rates (Infinity if never). */
export function timeToAfford(s: GameState, cost: Amounts): number {
  let worst = 0;
  for (const [r, v] of entries(cost)) {
    const lack = v - s.res[r];
    if (lack <= 0) continue;
    const rate = s.rates[r];
    if (rate <= 0) return Infinity;
    worst = Math.max(worst, lack / rate);
  }
  return worst;
}

/** Fraction (0..1) of the cost currently in stock (for readiness rings). */
export function affordFraction(s: GameState, cost: Amounts): number {
  let f = 1;
  for (const [r, v] of entries(cost)) if (v > 0) f = Math.min(f, s.res[r] / v);
  return Math.max(0, Math.min(1, f));
}

/** Market value of one unit for payback maths (📜💍 have no market price: 50, like marketValue; 💨 counts as 0). */
export function unitValue(r: ResId): number {
  return RESOURCES[r].market ?? (r === "steam" ? 0 : 50);
}

/** Market value of an amount bundle (for ROI, purse "cheapest building"). */
export function marketValue(a: Amounts): number {
  let v = 0;
  for (const [r, x] of entries(a)) v += x * (RESOURCES[r].market ?? 50);
  return v;
}

/* ------------------------------------------------------------ projects */

export function expeditionCost(s: GameState, zone: ZoneId): Amounts {
  const exp = ZONES[zone].expedition;
  if (!exp) return {};
  // old_tunnels: the Cellars −75% (rank I), the Metro −50% (rank III)
  const mult = zone === "cellars" && s.meta.edicts.old_tunnels ? 0.25 : zone === "metro" && edictRank(s, "old_tunnels") >= 3 ? 0.5 : 1;
  const out: Amounts = {};
  for (const [r, v] of entries(exp.cost)) out[r] = Math.ceil(v * mult);
  return out;
}

/**
 * Cost of Rat Express stage n (1-based) or post-coronation wagon k = n − 10 (v3 ENG-3):
 * stage: base[r] × growth[r]^(n−1) × 0.75^[express_blueprints] (growth 1.6 for 🛤️⚙️🔔, 1.45 for 💍📜);
 * wagon k: the stage-10 price × WAGON_GROWTH^k (🛤️⚙️🔔) or × (1 + WAGON_LINEAR·k) (💍📜, which ignore the global multiplier).
 */
export function expressStageCost(s: GameState, n: number): Amounts {
  const disc = s.meta.edicts.express_blueprints ? 0.75 : 1;
  const out: Amounts = {};
  const k = Math.max(0, n - 10);
  for (const [r, v] of Object.entries(EXPRESS_BASE) as [ExpressRes, number][]) {
    const g = EXPRESS_GROWTH[r];
    const wagon = k <= 0 ? 1 : WAGON_LINEAR_RES.includes(r) ? 1 + WAGON_LINEAR * k : Math.pow(WAGON_GROWTH, k);
    out[r] = Math.ceil(v * Math.pow(g, Math.min(n, 10) - 1) * disc * wagon);
  }
  return out;
}

export function remaining(cost: Amounts, progress: Amounts): Amounts {
  const out: Amounts = {};
  for (const [r, v] of entries(cost)) out[r] = Math.max(0, v - (progress[r] ?? 0));
  return out;
}

export function isComplete(cost: Amounts, progress: Amounts): boolean {
  for (const [r, v] of entries(cost)) if ((progress[r] ?? 0) + 1e-9 < v) return false;
  return true;
}

/* ------------------------------------------------------------ prestige */

/** The coronation's ×1.25 on crowns, times the King's charters (metaMath.crownBonusMult). */
const crownBonus = crownBonusMult;

/** No crowns below this E_run (the first migration gives 10). */
const CROWNS_MIN_E = 1e6;

/**
 * Crowns for this run (GDD 10.1, v2 soft cap): x = E_run / 1e6; 10·√x up to x = 100 (100 crowns at 1e8), then
 * 100·(x/100)^0.1; × 1.25 after the coronation, rounded down. Defined as the largest k with
 * crownThreshold(k / bonus) ≤ E_run, so nextCrownAt/prevCrownAt are its exact inverse (no float drift at a threshold).
 */
export function crownsForRun(s: GameState): number {
  const e = s.eRun;
  if (!(e >= CROWNS_MIN_E)) return 0;
  const bonus = crownBonus(s);
  const x = e / 1e6;
  const base = x <= 100 ? 10 * Math.sqrt(x) : 100 * Math.pow(x / 100, 0.1);
  let k = Math.floor(base * bonus);
  if (!Number.isFinite(k) || k > 1e9) return Number.isFinite(k) ? k : 0;
  // the float estimate is off by at most one either way
  for (let i = 0; i < 3 && crownThreshold((k + 1) / bonus) <= e; i++) k++;
  for (let i = 0; i < 3 && k > 0 && crownThreshold(k / bonus) > e; i++) k--;
  return k;
}

export function canMigrate(s: GameState): boolean {
  return !!s.zones.metro && s.eRun >= CROWNS_MIN_E;
}

/** Coins (E_run) needed for the next crown: crownThreshold((k + 1) / bonus), never below the first-crown 1e6. */
export function nextCrownAt(s: GameState): number {
  const k = crownsForRun(s);
  return Math.max(CROWNS_MIN_E, crownThreshold((k + 1) / crownBonus(s)));
}

/** Coins (E_run) at which the current crown count was reached (for progress bars between prevCrownAt and nextCrownAt). */
export function prevCrownAt(s: GameState): number {
  const k = crownsForRun(s);
  if (k <= 0) return 0;
  return Math.max(CROWNS_MIN_E, crownThreshold(k / crownBonus(s)));
}

/**
 * E_run needed for c crowns before bonuses under the v2 soft cap (EN-1):
 * c ≤ 100 → 1e6·(c/10)², beyond → 1e8·(c/100)^10 (continuous at c = 100, E = 1e8).
 * Reference: 20 → 4M, 80–101 → 64–121M, 131 → 1.5B (164 after a coronation), 154 → 7.6B (192).
 */
export function crownThreshold(c: number): number {
  if (!(c > 0)) return 0;
  return c <= 100 ? 1e6 * Math.pow(c / 10, 2) : 1e8 * Math.pow(c / 100, 10);
}

/* ------------------------------------------------------------ clock */

/** Human clock: 1 real second = 5 human seconds, run starts at 05:00. */
export function humanClock(s: GameState): { day: number; hh: number; mm: number; totalMin: number } {
  const totalMin = 5 * 60 + (s.time * 5) / 60;
  const day = Math.floor(totalMin / (24 * 60));
  const m = totalMin - day * 24 * 60;
  return { day, hh: Math.floor(m / 60), mm: Math.floor(m % 60), totalMin };
}

/** What the humans upstairs are doing at hour `hh` (0..23). */
export function humanActivity(hh: number): string {
  // before 05:00 the humans are still asleep from the night before
  let act = HUMAN_ACTIVITIES[HUMAN_ACTIVITIES.length - 1][1];
  for (const [h, a] of HUMAN_ACTIVITIES) if (hh >= h) act = a;
  return act;
}
