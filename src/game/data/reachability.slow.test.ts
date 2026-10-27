import { beforeAll, describe, expect, it } from "vitest";
import { simulate, type RunReport } from "../../../scripts/sim-core";
import { BUILDING_IDS, RES_IDS, UPGRADE_IDS, ZONE_IDS } from "../types";

/**
 * Slow suite (v3 ENG-7): an active sim session of two runs, at most 3 hours each (~100 s). Excluded from `npm test`;
 * runs with `npm run test:slow` (or SLOW=1 npx vitest run) and in the nightly balance job. v3 (ENG-3): the express plan
 * needs a Great Migration, so the coronation (and the plan) are reached in the second run.
 */

describe("long active session (2 runs): reachability and numeric sanity", () => {
  let reps: RunReport[];
  let rep: RunReport;
  beforeAll(() => {
    reps = simulate({ seed: 7, bot: "active", runs: 2, minutes: 180 });
    rep = reps[reps.length - 1];
  }, 300_000);

  it("every building and upgrade eventually becomes visible", () => {
    expect(reps).toHaveLength(2);
    const unseenB = BUILDING_IDS.filter((b) => !reps.some((r) => r.buildingsSeen.includes(b)));
    const unseenU = UPGRADE_IDS.filter((u) => !reps.some((r) => r.upgradesSeen.includes(u)));
    expect(unseenB, `unreachable buildings: ${unseenB.join(", ")}`).toEqual([]);
    expect(unseenU, `unreachable upgrades: ${unseenU.join(", ")}`).toEqual([]);
  });

  it("all zones open and the coronation happens within the run", () => {
    for (const z of ZONE_IDS) expect(rep.zoneOpenAt[z], z).toBeDefined();
    expect(rep.coronationAt).not.toBeNull();
  });

  it("no NaN or Infinity in resources, rates or EMAs at any point", () => {
    for (const r of reps) expect(r.nonFinite).toEqual([]);
    for (const r of RES_IDS) {
      expect(Number.isFinite(rep.final.res[r]), r).toBe(true);
      expect(Number.isFinite(rep.final.ema[r]), r).toBe(true);
    }
  });
});
