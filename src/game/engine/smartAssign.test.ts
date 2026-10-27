import { describe, expect, it } from "vitest";
import { JOBS } from "../data/jobs";
import { RESOURCES } from "../data/resources";
import { JOB_IDS, type BuildingId, type GameState, type JobId, type ResId } from "../types";
import { smartAssign } from "./actions";
import { jobUnlocked, normalizeJobs } from "./core";
import { derive, type Derived } from "./derive";
import { entries } from "./formulas";
import { step } from "./step";
import { fixtureNames, loadFixture } from "./testkit";

/**
 * The v2 smartAssign, frozen as the oracle for ENG-6 (v3): the incremental version must give the same jobs on every
 * state. Do not "fix" this copy; change both only together with a deliberate balance change.
 */
function smartAssignV2(s: GameState, d: Derived): void {
  const total = s.rats;
  const jobs = Object.fromEntries(JOB_IDS.map((j) => [j, 0])) as Record<JobId, number>;
  let left = total;
  const perWorker = (j: JobId, r: ResId) => (JOBS[j].produces[r] ?? 0) * d.jobSpeed[j] * d.jobYield[j];
  const passive = (r: ResId) => {
    let v = 0;
    for (const id of Object.keys(d.buildingOut) as BuildingId[]) v += d.buildingOut[id][r] ?? 0;
    return v;
  };
  const foodNeed = 0.04 * total * 1.1 - passive("crumbs") * d.tierMult * d.global;
  const fper = perWorker("forager", "crumbs") * d.tierMult * d.global;
  const foragers = Math.max(0, Math.min(left, Math.ceil(foodNeed / Math.max(1e-6, fper))));
  jobs.forager = foragers;
  left -= foragers;
  for (const j of ["cheese_thief", "coal_miner", "appraiser"] as JobId[]) {
    if (!jobUnlocked(s, j)) continue;
    const n = Math.min(left, d.slots[j]);
    jobs[j] = n;
    left -= n;
  }
  const supply = (r: ResId) => {
    let v = passive(r);
    for (const j of JOB_IDS) if (Object.keys(JOBS[j].consumes).length === 0) v += jobs[j] * perWorker(j, r);
    for (const j of ["mechanic", "stoker", "smelter", "smith", "scholar"] as JobId[]) {
      v += jobs[j] * perWorker(j, r);
      v -= jobs[j] * (JOBS[j].consumes[r] ?? 0) * d.jobSpeed[j];
    }
    return v;
  };
  for (const j of ["stoker", "smelter", "smith", "mechanic", "scholar"] as JobId[]) {
    if (!jobUnlocked(s, j)) continue;
    while (left > 0 && jobs[j] < d.slots[j]) {
      let failed: ResId | null = null;
      for (const [r, v] of entries(JOBS[j].consumes)) {
        if (supply(r) < v * d.jobSpeed[j] - 1e-9 && s.res[r] < 50 * v) {
          failed = r;
          break;
        }
      }
      if (failed) {
        if ((failed === "wire" || failed === "buttons") && jobUnlocked(s, "scavenger") && left > 1) {
          jobs.scavenger++;
          left--;
          continue;
        }
        break;
      }
      jobs[j]++;
      left--;
    }
  }
  const open = (["pickpocket", "scavenger", "forager"] as JobId[]).filter((j) => jobUnlocked(s, j));
  if (open.length && left > 0) {
    const value = (j: JobId) =>
      entries(JOBS[j].produces).reduce((a, [r, v]) => a + (s.res[r] >= d.caps[r] ? 0 : v * (RESOURCES[r].market ?? 1) * d.jobYield[j]), 0);
    const ranked = [...open].sort((a, b) => value(b) - value(a));
    const shares = [0.6, 0.3, 0.1];
    let given = 0;
    ranked.forEach((j, i) => {
      const n = i === ranked.length - 1 ? left - given : Math.floor(left * shares[i]);
      jobs[j] += n;
      given += n;
    });
    left = 0;
  }
  for (const j of JOB_IDS) if (j !== "idle") s.jobs[j] = jobs[j];
  normalizeJobs(s, d);
}

/** The jobs both versions pick for `s` (each on its own copy). */
function both(s: GameState): { v3: GameState["jobs"]; v2: GameState["jobs"] } {
  const a = structuredClone(s);
  const b = structuredClone(s);
  smartAssign(a, derive(a));
  smartAssignV2(b, derive(b));
  return { v3: a.jobs, v2: b.jobs };
}

/** A late colony where every converter is open and has slots: the 150-min golden save. */
const late = () => loadFixture("v3-run1-150min");

describe("smartAssign (v3 ENG-6): same jobs as v2", () => {
  const variants: [string, (s: GameState) => void][] = [
    ["as saved", () => {}],
    ["rats ×3", (s) => void (s.rats *= 3)],
    ["steam shortage", (s) => void (s.res.steam = 0)],
    ["wire shortage", (s) => void ((s.res.wire = 0), (s.res.buttons = 0))],
    ["coal and coins shortage", (s) => void ((s.res.coal = 0), (s.res.coins = 0))],
  ];

  it("the late fixture exercises every converter", () => {
    const s = late();
    smartAssign(s, derive(s));
    for (const j of ["stoker", "smelter", "smith", "mechanic"] as JobId[]) expect(s.jobs[j], j).toBeGreaterThan(0);
  });

  for (const name of ["v3-run1-60min", "v3-run1-150min", "v3-run1-crowned", "v3-run3-commission"]) {
    for (const [label, tweak] of variants) {
      it(`${name}, ${label}`, () => {
        const s = loadFixture(name);
        tweak(s);
        const { v3, v2 } = both(s);
        expect(v3).toEqual(v2);
      });
    }
  }

  it("every fixture as saved and with a tenth of its rats", () => {
    for (const name of fixtureNames()) {
      const s = loadFixture(name);
      expect(both(s).v3, name).toEqual(both(s).v2);
      s.rats = Math.max(1, Math.floor(s.rats / 10));
      expect(both(s).v3, `${name} /10`).toEqual(both(s).v2);
    }
  });

  it("along a 4 h catch-up of the late colony (the states simulateOffline feeds it)", () => {
    // the same coarse steps simulateOffline takes; whole runs are checked by the seed-12345 sim SUMMARY
    const s = late();
    const ctx = { fx: [] };
    for (let i = 0; i < 300; i++) {
      if (i % 30 === 0) {
        const { v3, v2 } = both(s);
        expect(v3, `step ${i}`).toEqual(v2);
      }
      step(s, 48, { active: false, offline: { eta: 0.75 } }, ctx);
      ctx.fx.length = 0;
    }
  });
});

// the cost bench (v3 ≥ 2× cheaper than v2 on the late colony) is wall-clock: it lives in smartAssign.slow.test.ts
