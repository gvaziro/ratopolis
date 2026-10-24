import { describe, expect, it } from "vitest";
import type { CamView } from "./camera";
import { BUILDING_SLOT, uiX, uiY } from "./geometry";
import { AWAY_H, RAIL_COL_H, RAIL_GRID_H, railBox, tipBox } from "./layout";

/** A home-like camera: world x centred, the world top (y −8) at the view top. */
function view(cw: number, ch: number, s: number, cy?: number): CamView {
  return { cx: 360, cy: cy ?? ch / s / 2 - 8, s, cw, ch, left: 0, top: 0 };
}

describe("tipBox (the chamber tip stays inside the colony)", () => {
  it("clamps into a short landscape-phone colony with the buttons on screen", () => {
    // 844×390: the colony is 444×174 px; at home it shows the street and the burrow's top row only
    const v = view(444, 174, 0.584);
    expect(tipBox(v, BUILDING_SLOT.stash, 172)).toBeNull();
    for (const id of ["nest", "trash_chute"] as const) {
      const b = tipBox(v, BUILDING_SLOT[id], 172);
      expect(b).not.toBeNull();
      if (!b) continue;
      expect(b.top).toBeGreaterThanOrEqual(8);
      expect(b.top + Math.min(172, b.maxH)).toBeLessThanOrEqual(174 - 8);
    }
  });

  it("keeps the second burrow row's buttons in a 375×667 colony", () => {
    const v = view(375, 279, 0.4934);
    const b = tipBox(v, BUILDING_SLOT.stash, 178);
    expect(b).not.toBeNull();
    expect(b!.top + Math.min(178, b!.maxH)).toBeLessThanOrEqual(279 - 8);
  });

  it("goes above the niche when there is room, without covering it", () => {
    const v = view(820, 584, 0.99, 420); // the burrow's second row low in the view
    const slot = BUILDING_SLOT.stash;
    const nicheTop = v.ch / 2 + (slot.floor - 150 - v.cy) * v.s;
    const b = tipBox(v, slot, 160)!;
    expect(b.top + 160).toBeCloseTo(nicheTop, 0);
  });

  it("sticks to the top while its chamber is half scrolled away and is dropped once it is gone", () => {
    const slot = BUILDING_SLOT.nest;
    const half = view(820, 584, 1, slot.floor + 232); // the niche top 90 px above the view, its floor 60 px in
    expect(tipBox(half, slot, 160)?.top).toBe(8);
    const gone = view(820, 584, 1, slot.floor + 300);
    expect(tipBox(gone, slot, 160)).toBeNull();
  });
});

describe("railBox (zone pips clear the steam gauge and «⤒ К решётке»)", () => {
  const fits = (ch: number, gauge: { w: number; h: number }) => {
    const b = railBox(ch, gauge);
    const h = b.grid ? RAIL_GRID_H : RAIL_COL_H;
    return { b, bottom: b.top + h, h };
  };

  it("a tall colony gets one column under the desktop gauge", () => {
    const { b, bottom } = fits(584, { w: 96, h: 89 });
    expect(b.grid).toBe(false);
    expect(b.top).toBeGreaterThanOrEqual(8 + 89);
    expect(bottom).toBeLessThanOrEqual(584 - AWAY_H);
  });

  it("1280×620: the column starts under a starving gauge («Нет пара!»)", () => {
    const { b, bottom } = fits(404, { w: 96, h: 111 });
    expect(b.top).toBeGreaterThanOrEqual(8 + 111);
    expect(bottom).toBeLessThanOrEqual(404 - AWAY_H);
  });

  it("a phone folds into a grid under the 44 px dial", () => {
    const { b, bottom } = fits(279, { w: 44, h: 44 });
    expect(b).toMatchObject({ grid: true, right: 4 });
    expect(b.top).toBeGreaterThanOrEqual(8 + 44);
    expect(bottom).toBeLessThanOrEqual(279 - AWAY_H);
  });

  it("844×390: no room under the gauge, so the grid sits beside it, above the away button", () => {
    const { b, bottom } = fits(174, { w: 96, h: 89 });
    expect(b.grid).toBe(true);
    expect(b.right).toBeGreaterThanOrEqual(8 + 96);
    expect(bottom).toBeLessThanOrEqual(174 - AWAY_H);
  });

  it("without a gauge the rail starts at the top", () => {
    expect(railBox(150, { w: 0, h: 0 })).toEqual({ grid: true, top: 8, right: 4 });
  });
});

describe("uiX / uiY (CO-8 remap of purse and shiny spots)", () => {
  it("maps 0..1 into the safe middle of the view and clamps", () => {
    expect(uiX(0)).toBeCloseTo(0.22);
    expect(uiX(1)).toBeCloseTo(0.78);
    expect(uiY(0)).toBeCloseTo(0.32);
    expect(uiY(1)).toBeCloseTo(0.8);
    expect(uiY(-3)).toBeCloseTo(0.32);
    expect(uiX(9)).toBeCloseTo(0.78);
  });
});
