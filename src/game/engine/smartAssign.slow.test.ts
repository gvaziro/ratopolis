import { describe, expect, it } from "vitest";
import { JOBS } from "../data/jobs";
import { RESOURCES } from "../data/resources";
import { JOB_IDS, type BuildingId, type GameState, type JobId, type ResId } from "../types";
import { smartAssign } from "./actions";
import { jobUnlocked, normalizeJobs } from "./core";
import { derive, type Derived } from "./derive";
import { entries } from "./formulas";
import { loadFixture } from "./testkit";

/**
 * The v2 smartAssign as the cost baseline of the ENG-6 bench — the same frozen copy smartAssign.test.ts compares the
 * jobs against (keep the two equal). The bench lives here, out of the fast suite (perf-saves-1): a wall-clock ratio
 * there flaked on loaded machines and parallel workers.
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

describe("smartAssign (v3 ENG-6): cost (slow bench)", () => {
  it("is several times cheaper than v2 on the late colony (fastest of 5 interleaved rounds; ≈ 0.05–0.2 measured)", { retry: 2 }, () => {
    const s0 = loadFixture("v3-run1-150min");
    const d = derive(s0);
    /** ms per call over `n` calls, each on a fresh copy (the copies made outside the timed loop). */
    const round = (fn: (s: GameState, d: Derived) => void, n: number) => {
      const copies = Array.from({ length: n }, () => structuredClone(s0));
      const t0 = performance.now();
      for (const c of copies) fn(c, d);
      return (performance.now() - t0) / n;
    };
    round(smartAssignV2, 20); // warm-up
    round(smartAssign, 20);
    let v2 = Infinity;
    let v3 = Infinity;
    for (let r = 0; r < 5; r++) {
      v2 = Math.min(v2, round(smartAssignV2, 40));
      v3 = Math.min(v3, round(smartAssign, 40));
    }
    expect(v3).toBeLessThan(v2 / 2);
  });
});
