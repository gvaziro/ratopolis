import { describe, expect, it } from "vitest";
import { nearestStanding } from "./sceneUtils";

describe("nearestStanding (PilesPhase focus hand-off)", () => {
  it("moves on to the next pile in a single row", () => {
    expect(nearestStanding([true, true, false, false], 1)).toBe(2);
  });

  it("looks back in a wrapped strip: 7 piles in 4 columns, pile 6 swept while pile 3 still stands", () => {
    // columns 0..2 are swept (piles 0,1,2 and 4,5,6), column 3 (pile 3) still stands
    expect(nearestStanding([true, true, true, false, true, true, true], 6)).toBe(3);
  });

  it("prefers the higher pile on a tie", () => {
    expect(nearestStanding([false, true, false], 1)).toBe(2);
  });

  it("returns -1 when everything is swept (the focus goes to «Готово»)", () => {
    expect(nearestStanding([true, true, true], 2)).toBe(-1);
    expect(nearestStanding([], 0)).toBe(-1);
  });
});
