import { describe, expect, it } from "vitest";
import { legacyVisited } from "@/game/data/districts";
import { derive } from "@/game/engine/derive";
import { atMaxLevel, buildingCost } from "@/game/engine/formulas";
import { goalModel } from "@/components/colony/goalModel";
import { metroState } from "@/game/engine/testkit";
import { RES_IDS, type GameState } from "@/game/types";
import { cardPurchase } from "./cardBuy";

/** A rich metro colony moved to run `index` of the legacy route (2 = Ламбет, «Гончарни»: the boiler goes to 14). */
function inDistrict(index: number, boiler: number): GameState {
  const s = metroState(99, { quiet: true });
  s.meta.district = index;
  s.meta.visited = legacyVisited(index);
  s.meta.districtId = s.meta.visited[index];
  s.res.wire = s.res.gears = s.res.coal = 1e15;
  s.buildings.boiler = boiler;
  return s;
}

describe("the building card's buy button (pacing-2: the engine's cap, not BUILDINGS.maxLevel)", () => {
  it("in «Гончарни» the boiler is bought past 12 up to 14 from the card, then the card says «макс.»", () => {
    const s = inDistrict(2, 12);
    expect(cardPurchase(s, "boiler", 1)).toMatchObject({ k: 1, ok: true });
    expect(cardPurchase(s, "boiler", 10)).toMatchObject({ k: 2, ok: true }); // ×10 takes the levels left
    expect(cardPurchase(s, "boiler", "max")).toMatchObject({ k: 2, ok: true });
    s.buildings.boiler = 14;
    expect(cardPurchase(s, "boiler", 1)).toMatchObject({ k: 0, ok: false });
    expect(cardPurchase(s, "boiler", "max").k).toBe(0);
  });

  it("elsewhere the boiler stops at 12", () => {
    const s = inDistrict(0, 12);
    expect(cardPurchase(s, "boiler", 1).k).toBe(0);
    s.buildings.boiler = 11;
    expect(cardPurchase(s, "boiler", 10)).toMatchObject({ k: 1, ok: true });
  });

  it("the goal widget's «nearest building» still offers the boiler at 12 in «Гончарни», and not at 14", () => {
    /** Rich in everything but coal: the boiler (2183 coal at level 12) is the one visible building out of reach. */
    const short = (boiler: number) => {
      const s = inDistrict(2, boiler);
      for (const r of RES_IDS) s.res[r] = 1e300;
      s.res.coal = (buildingCost("boiler", 12).coal ?? 0) - 1;
      return s;
    };
    const at12 = short(12);
    expect(atMaxLevel(at12, "boiler")).toBe(false);
    expect(goalModel(at12, derive(at12)).map((g) => g.key)).toContain("b:boiler");
    const at14 = short(14);
    expect(atMaxLevel(at14, "boiler")).toBe(true);
    expect(goalModel(at14, derive(at14)).map((g) => g.key)).not.toContain("b:boiler");
  });
});
