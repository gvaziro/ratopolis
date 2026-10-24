import { BUILDINGS } from "../data/buildings";
import { EXPRESS_BASE, EXPRESS_GROWTH } from "../data/meta";
import { RESOURCES } from "../data/resources";
import { ZONES } from "../data/zones";
import type { Amounts, BuildingId, BuyMode, GameState, ResId, ZoneId } from "../types";
import type { Derived } from "./derive";

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

/** How many levels are affordable right now (respecting maxLevel and `limit`). */
export function maxAffordable(s: GameState, id: BuildingId, limit = Infinity): number {
  const def = BUILDINGS[id];
  const level = s.buildings[id];
  const room = (def.maxLevel ?? Infinity) - level;
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

export function buyCount(s: GameState, id: BuildingId, mode: BuyMode): number {
  if (mode === "max") return maxAffordable(s, id);
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
  const mult = zone === "cellars" && s.meta.edicts.old_tunnels ? 0.25 : 1;
  const out: Amounts = {};
  for (const [r, v] of entries(exp.cost)) out[r] = Math.ceil(v * mult);
  return out;
}

/** Cost of Rat Express stage n (1-based) or post-coronation wagon (n > 10). */
export function expressStageCost(s: GameState, n: number): Amounts {
  const disc = s.meta.edicts.express_blueprints ? 0.75 : 1;
  const out: Amounts = {};
  if (n <= 10) {
    for (const [r, v] of entries(EXPRESS_BASE)) out[r] = Math.ceil(v * Math.pow(EXPRESS_GROWTH, n - 1) * disc);
  } else {
    const k = n - 10;
    for (const [r, v] of entries(EXPRESS_BASE)) out[r] = Math.ceil(v * Math.pow(EXPRESS_GROWTH, 9) * disc * Math.pow(3, k));
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

export function crownsForRun(s: GameState): number {
  if (s.eRun < 1e6) return 0;
  return Math.floor(10 * Math.sqrt(s.eRun / 1e6) * (s.coronatedThisRun ? 1.25 : 1));
}

export function canMigrate(s: GameState): boolean {
  return !!s.zones.metro && s.eRun >= 1e6;
}

/** Coins (E_run) needed for the next crown. */
export function nextCrownAt(s: GameState): number {
  const k = crownsForRun(s);
  const bonus = s.coronatedThisRun ? 1.25 : 1;
  return 1e6 * Math.pow((k + 1) / (10 * bonus), 2);
}

/* ------------------------------------------------------------ clock */

/** Human clock: 1 real second = 5 human seconds, run starts at 05:00. */
export function humanClock(s: GameState): { day: number; hh: number; mm: number; totalMin: number } {
  const totalMin = 5 * 60 + (s.time * 5) / 60;
  const day = Math.floor(totalMin / (24 * 60));
  const m = totalMin - day * 24 * 60;
  return { day, hh: Math.floor(m / 60), mm: Math.floor(m % 60), totalMin };
}
