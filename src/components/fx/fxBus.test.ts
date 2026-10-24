import { afterEach, describe, expect, it } from "vitest";
import { clampToColony, flightPending, flightStart, inColony, onLand, setColonyRectGetter } from "./fxBus";

describe("flights (CO-7: the chamber bounces when the card's icon lands)", () => {
  it("stays pending until every icon on its way has landed, and tells the listeners", () => {
    const landed: string[] = [];
    const off = onLand((t) => landed.push(t));
    const a = flightStart("building:nest");
    const b = flightStart("building:nest");
    expect(flightPending("building:nest")).toBe(true);
    expect(flightPending("building:pantry")).toBe(false);
    a();
    expect(flightPending("building:nest")).toBe(true);
    a(); // a second finish (onfinish and the fallback timer) counts once
    expect(landed).toEqual(["building:nest"]);
    b();
    expect(flightPending("building:nest")).toBe(false);
    expect(landed).toEqual(["building:nest", "building:nest"]);
    off();
  });
});

describe("colony rect helpers (fx of off-screen chambers stay off the panel)", () => {
  afterEach(() => setColonyRectGetter(null));

  it("clamps into the colony and tells inside from outside", () => {
    const rect = { left: 0, top: 100, right: 400, bottom: 300, width: 400, height: 200, x: 0, y: 100 } as DOMRect;
    setColonyRectGetter(() => rect);
    expect(inColony({ x: 50, y: 150 })).toBe(true);
    expect(inColony({ x: 50, y: 650 })).toBe(false);
    expect(clampToColony({ x: 72, y: 655 })).toEqual({ x: 72, y: 276 });
    expect(clampToColony({ x: -10, y: 0 }, 24, 36)).toEqual({ x: 24, y: 124 });
  });

  it("without a colony nothing is inside and points pass through", () => {
    expect(inColony({ x: 1, y: 1 })).toBe(false);
    expect(clampToColony({ x: 5, y: 900 })).toEqual({ x: 5, y: 900 });
  });
});
