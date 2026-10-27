import { describe, expect, it } from "vitest";
import { simulate } from "../../../scripts/sim-core";

/**
 * v3 ENG-1/ENG-2: a newcomer who only follows the elder's hints and «Выгодно сейчас» (the sim's newcomer bot) meets
 * the GDD 15.14 «Новичок» windows — Sewers ≤ 15, Cellars ≤ 40, Metro ≤ 70, first metro train ≤ 75 min — on the two
 * reference seeds, never stays hungry and never hears one hint for more than 3 minutes in a row.
 */
describe("the newcomer bot (GDD 15.14 «Новичок»)", () => {
  for (const seed of [12345, 777]) {
    it(`seed ${seed}: the onboarding windows`, () => {
      const [r] = simulate({ seed, bot: "newcomer", runs: 1, minutes: 76 });
      const min = (x: number | null | undefined) => (x === null || x === undefined ? Infinity : x / 60);
      expect(min(r.zoneOpenAt.sewers)).toBeLessThanOrEqual(15);
      expect(min(r.zoneOpenAt.cellars)).toBeLessThanOrEqual(40);
      expect(min(r.zoneOpenAt.metro)).toBeLessThanOrEqual(70);
      expect(min(r.firstTrainAt)).toBeLessThanOrEqual(75);
      expect(r.maxHungry).toBeLessThanOrEqual(10);
      expect(r.newcomer!.hintStreak).toBeLessThanOrEqual(180);
      expect(r.nonFinite).toEqual([]);
    }, 240_000);
  }
});
