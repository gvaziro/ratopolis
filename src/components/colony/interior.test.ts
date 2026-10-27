import { describe, expect, it } from "vitest";
import { VISUAL_TIERS } from "@/game/data/buildings";
import { BUILDING_IDS } from "@/game/types";
import { apexY, bulkImpact, lampX } from "./geometry";

describe("bulkImpact (COL-4: bulk buys land harder)", () => {
  it("leaves a +1 buy exactly as it was", () => {
    expect(bulkImpact(1)).toEqual({ bounce: 1, dust: 12 });
    expect(bulkImpact(0)).toEqual({ bounce: 1, dust: 12 });
    expect(bulkImpact(Number.NaN)).toEqual({ bounce: 1, dust: 12 });
  });

  it("gives ×10 a 1.4× bounce and 25 dust, and caps the bounce at 1.6×", () => {
    expect(bulkImpact(10).bounce).toBeCloseTo(1.4, 6);
    expect(bulkImpact(10).dust).toBe(25);
    expect(bulkImpact(1e6).bounce).toBeCloseTo(1.6, 6);
  });

  it("never gets weaker for a bigger jump", () => {
    let prev = bulkImpact(1);
    for (let k = 2; k <= 2000; k++) {
      const cur = bulkImpact(k);
      expect(cur.bounce).toBeGreaterThanOrEqual(prev.bounce);
      expect(cur.dust).toBeGreaterThanOrEqual(prev.dust);
      prev = cur;
    }
  });
});

describe("chamber lamp placement (COL-3)", () => {
  it("apexY follows the niche: flat top, rounded corners down to the walls", () => {
    expect(apexY(0)).toBe(-148);
    expect(apexY(48)).toBe(-148);
    expect(apexY(-48)).toBe(-148);
    expect(apexY(88)).toBeCloseTo(-108, 6);
    expect(apexY(-70)).toBeCloseTo(apexY(70), 9);
    for (let x = 48; x < 88; x++) expect(apexY(x + 1)).toBeGreaterThanOrEqual(apexY(x));
  });

  it("hangs every lamp inside its niche, from the ceiling, in the top third", () => {
    const stages = [...new Set([1, 2, 3, 4, 5, ...VISUAL_TIERS])];
    for (const id of BUILDING_IDS) {
      for (const l of stages) {
        const x = lampX(id, l);
        expect(Math.abs(x), `${id} @${l}`).toBeLessThanOrEqual(76);
        // the chain starts at the ceiling above the lamp body (y −122 … −104 sits in the niche's top third)
        expect(apexY(x), `${id} @${l}`).toBeLessThan(-122);
      }
    }
  });
});
