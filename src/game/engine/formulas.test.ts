import { describe, expect, it } from "vitest";
import { BUILDINGS } from "../data/buildings";
import { EXPRESS_BASE, EXPRESS_GROWTH } from "../data/meta";
import { BUILDING_IDS, type Amounts, type EngineCtx } from "../types";
import { buyBuilding } from "./actions";
import { derive } from "./derive";
import { buildingCost, canAfford, crownThreshold, crownsForRun, entries, expressStageCost, humanActivity, humanClock, maxAffordable, nextCrownAt, prevCrownAt } from "./formulas";
import { rand } from "./rng";
import { createInitialState } from "./state";

function sumCosts(list: Amounts[]): Amounts {
  const out: Amounts = {};
  for (const a of list) for (const [r, v] of entries(a)) out[r] = (out[r] ?? 0) + v;
  return out;
}

describe("buildingCost", () => {
  it("cost of k levels equals the sum of k single-level costs (± rounding)", () => {
    for (const id of BUILDING_IDS) {
      for (const level of [0, 3, 11]) {
        for (const k of [1, 2, 5, 10]) {
          const batch = buildingCost(id, level, k);
          const seq = sumCosts(Array.from({ length: k }, (_, i) => buildingCost(id, level + i)));
          for (const [r, v] of entries(seq)) {
            const b = batch[r] ?? 0;
            // each single level is rounded up separately (the sum may exceed the batch by < 1 per level),
            // and the batch formula itself may round a float like 345.0000001 up by one
            expect(v).toBeGreaterThanOrEqual(b - 1);
            expect(v - b).toBeLessThanOrEqual(k);
          }
        }
      }
    }
  });

  it("first level costs the base price, the next one × growth", () => {
    for (const id of BUILDING_IDS) {
      const def = BUILDINGS[id];
      expect(buildingCost(id, 0)).toEqual(Object.fromEntries(entries(def.cost).map(([r, v]) => [r, Math.ceil(v)])));
      for (const [r, v] of entries(def.cost)) expect(buildingCost(id, 1)[r]).toBe(Math.ceil(v * def.growth));
    }
  });
});

describe("maxAffordable", () => {
  it("k levels are affordable, k + 1 are not (unless capped by maxLevel)", () => {
    const s = createInitialState(1, 0);
    const rnd = { rng: 4242 };
    for (let trial = 0; trial < 300; trial++) {
      const id = BUILDING_IDS[Math.floor(rand(rnd) * BUILDING_IDS.length)];
      const def = BUILDINGS[id];
      s.buildings[id] = Math.floor(rand(rnd) * 15);
      if (def.maxLevel !== undefined) s.buildings[id] = Math.min(s.buildings[id], def.maxLevel);
      for (const [r] of entries(def.cost)) s.res[r] = Math.floor(Math.pow(10, rand(rnd) * 9));
      const level = s.buildings[id];
      const k = maxAffordable(s, id);
      if (k > 0) expect(canAfford(s, buildingCost(id, level, k))).toBe(true);
      const room = (def.maxLevel ?? Infinity) - level;
      if (k < room) expect(canAfford(s, buildingCost(id, level, k + 1))).toBe(false);
      expect(maxAffordable(s, id, 1)).toBe(Math.min(1, k));
    }
  });

  it("buying with mode max buys exactly maxAffordable levels and spends their price", () => {
    const s = createInitialState(1, 0);
    s.flags.vagrants = true;
    s.resEver.crumbs = 100;
    s.res.crumbs = 1e6;
    const k = maxAffordable(s, "nest");
    const cost = buildingCost("nest", 0, k);
    const ctx: EngineCtx = { fx: [] };
    expect(buyBuilding(s, derive(s), "nest", "max", ctx)).toBe(k);
    expect(s.buildings.nest).toBe(k);
    expect(s.res.crumbs).toBeCloseTo(1e6 - (cost.crumbs ?? 0), 6);
  });
});

describe("projects and prestige", () => {
  it("express stage n costs base × growth^(n−1), wagons × 3^k", () => {
    const s = createInitialState(1, 0);
    for (const n of [1, 2, 5, 10]) {
      const c = expressStageCost(s, n);
      for (const [r, v] of Object.entries(EXPRESS_BASE)) expect(c[r as keyof typeof c]).toBe(Math.ceil(v * Math.pow(EXPRESS_GROWTH, n - 1)));
    }
    const w1 = expressStageCost(s, 11);
    for (const [r, v] of Object.entries(EXPRESS_BASE)) expect(w1[r as keyof typeof w1]).toBe(Math.ceil(v * Math.pow(EXPRESS_GROWTH, 9) * 3));
    s.meta.edicts.express_blueprints = true;
    expect(expressStageCost(s, 1).rails).toBe(Math.ceil(EXPRESS_BASE.rails * 0.75));
  });

  it("crowns: 10·√(E/1e6) up to 1e8, then the soft cap 100·(E/1e8)^0.1; ×1.25 after the coronation", () => {
    const s = createInitialState(1, 0);
    const table: [number, number][] = [
      [5e5, 0],
      [1e6, 10],
      [4e6, 20],
      [1e7, 31],
      [6.4e7, 80],
      [1e8, 100],
      [1.21e8, 101],
      [1e9, 125],
      [1.5e9, 131],
    ];
    for (const [e, c] of table) {
      s.eRun = e;
      expect(crownsForRun(s), String(e)).toBe(c);
    }
    s.coronatedThisRun = true;
    for (const [e, c] of [
      [4e6, 25],
      [1.5e9, 163], // GDD: «1.5B → ≈164»
      [7.6e9, 192],
    ] as const) {
      s.eRun = e;
      expect(crownsForRun(s), String(e)).toBe(c);
    }
    s.coronatedThisRun = false;
    s.eRun = 1e6;
    const next = nextCrownAt(s);
    expect(next).toBeGreaterThan(1e6);
    s.eRun = next * 1.000001;
    expect(crownsForRun(s)).toBe(11);
  });

  it("crowns are continuous at E = 1e8 and never decrease", () => {
    const s = createInitialState(1, 0);
    s.eRun = 1e8 * (1 - 1e-9);
    expect(crownsForRun(s)).toBe(99);
    s.eRun = 1e8;
    expect(crownsForRun(s)).toBe(100);
    s.eRun = 1e8 * (1 + 1e-9);
    expect(crownsForRun(s)).toBe(100);
    for (const bonus of [false, true]) {
      s.coronatedThisRun = bonus;
      let prev = 0;
      for (let lg = 5; lg <= 12; lg += 0.01) {
        s.eRun = Math.pow(10, lg);
        const c = crownsForRun(s);
        expect(c).toBeGreaterThanOrEqual(prev);
        prev = c;
      }
    }
  });

  it("nextCrownAt / prevCrownAt are the exact inverse of crownsForRun for k = 0…300", () => {
    const s = createInitialState(1, 0);
    for (const bonus of [false, true]) {
      s.coronatedThisRun = bonus;
      const b = bonus ? 1.25 : 1;
      s.eRun = 0;
      expect(nextCrownAt(s)).toBe(1e6);
      s.eRun = 1e6;
      const first = crownsForRun(s);
      expect(first).toBe(bonus ? 12 : 10);
      s.eRun = 1e6 * (1 - 1e-12);
      expect(crownsForRun(s)).toBe(0);
      for (let k = first; k <= 300; k++) {
        s.eRun = crownThreshold(k / b);
        if (s.eRun < 1e6) s.eRun = 1e6;
        expect(crownsForRun(s), `k ${k} bonus ${bonus}`).toBe(k);
        expect(prevCrownAt(s)).toBeLessThanOrEqual(s.eRun);
        const next = nextCrownAt(s);
        expect(next).toBe(crownThreshold((k + 1) / b));
        s.eRun = next;
        expect(crownsForRun(s)).toBe(k + 1);
        s.eRun = next * (1 - 1e-12);
        expect(crownsForRun(s)).toBe(k);
      }
    }
  });
});

describe("human clock", () => {
  it("the humans are still asleep between 00:00 and 04:59", () => {
    for (const hh of [0, 2, 4, 23]) expect(humanActivity(hh), String(hh)).toBe("спят и храпят");
    expect(humanActivity(5)).toBe("только просыпаются");
    expect(humanActivity(12)).toBe("читают утреннюю газету");
    const s = createInitialState(1, 0);
    s.time = 13680; // 19 h of human time after 05:00 → 00:00 the next day
    expect(humanClock(s).hh).toBe(0);
    expect(humanActivity(humanClock(s).hh)).toBe("спят и храпят");
  });
});
