import { describe, expect, it } from "vitest";
import type { EngineCtx } from "../types";
import { cloneState, shareState } from "./clone";
import { step, TICK } from "./step";
import { assertPlain, fixtureNames, loadFixture, metroState, sharedObjects, tourScenes, triggerEvent } from "./testkit";

describe("cloneState (v3 ENG-6)", () => {
  it("deep-equals structuredClone, shares no object and keeps Infinity on every fixture", () => {
    for (const name of fixtureNames()) {
      const s = loadFixture(name);
      assertPlain(s);
      const c = cloneState(s);
      expect(c, name).toEqual(structuredClone(s));
      expect(sharedObjects(s, c), name).toBe(0);
      expect(c.timers.capsule).toBe(s.timers.capsule);
    }
  });

  it("copies primitives, empty containers and nested arrays", () => {
    expect(cloneState(5)).toBe(5);
    expect(cloneState(null)).toBe(null);
    const v = { a: [], b: {}, c: [[1, { d: -Infinity }]], e: "x", f: false };
    const c = cloneState(v);
    expect(c).toEqual(v);
    expect(c.c[0]).not.toBe(v.c[0]);
    expect(sharedObjects(v, c)).toBe(0);
  });

  it("step() on a clone never writes to the original through a metro train (frozen original)", async () => {
    // every kind of scene, 30 min of play and the 3 h sim: clone.slow.test.ts
    const { seen } = await tourScenes(loadFixture("v3-run1-150min"), ["metro_train"], 450);
    expect([...seen]).toEqual(["metro_train"]);
  }, 20_000); // ≈ 300 ticks of a late colony with a freeze each: slow when the machine is busy
});

describe("shareState (v3 ENG-6)", () => {
  it("returns prev when nothing changed, prev's subtrees where they are equal", () => {
    const prev = { a: { x: 1, y: [1, 2] }, b: { z: "q" }, n: 3 };
    expect(shareState(prev, cloneState(prev))).toBe(prev);
    const next = cloneState(prev);
    next.b.z = "w";
    const out = shareState(prev, next);
    expect(out).toBe(next);
    expect(out.a).toBe(prev.a);
    expect(out.b).not.toBe(prev.b);
    expect(out).toEqual({ a: { x: 1, y: [1, 2] }, b: { z: "w" }, n: 3 });
  });

  it("notices deleted and added keys, undefined values and array length", () => {
    const prev: Record<string, unknown> = { a: { x: 1, y: 2 }, u: { k: undefined }, l: [1, 2, 3] };
    const del = cloneState(prev) as { a: Record<string, number> };
    delete del.a.y;
    expect((shareState(prev, del) as typeof del).a).not.toBe(prev.a);
    const add = cloneState(prev) as { a: Record<string, number> };
    add.a.z = 0;
    expect((shareState(prev, add) as typeof add).a).not.toBe(prev.a);
    const undef = { ...cloneState(prev), u: {} };
    expect((shareState(prev, undef) as typeof undef).u).not.toBe(prev.u);
    const longer = cloneState(prev) as { l: number[] };
    longer.l.push(4);
    expect((shareState(prev, longer) as typeof longer).l).not.toBe(prev.l);
    const nan = { v: NaN };
    expect(shareState(nan, { v: NaN })).not.toBe(nan); // never "equal": only costs the sharing
  });

  it("shares the elements of a changed array by index", () => {
    const prev = { list: [{ a: 1 }, { a: 2 }] };
    const next = cloneState(prev);
    next.list[1].a = 3;
    const out = shareState(prev, next);
    expect(out.list).not.toBe(prev.list);
    expect(out.list[0]).toBe(prev.list[0]);
    expect(out.list[1]).not.toBe(prev.list[1]);
  });

  it("a waiting metro scene keeps its identity on every tick where it did not change", () => {
    const s0 = metroState(5, { quiet: true });
    triggerEvent(s0, "metro_train");
    let prev = s0;
    const ctx: EngineCtx = { fx: [] };
    let quiet = 0;
    let kept = 0;
    for (let i = 0; i < 200; i++) {
      const s = cloneState(prev);
      step(s, TICK, { active: false }, ctx);
      ctx.fx.length = 0;
      const out = shareState(prev, s);
      if (prev.scene && out.scene && (out.scene.phase === "rumble" || out.scene.phase === "piles")) {
        // a quiet tick: the scene deep-equals the previous one
        if (JSON.stringify(out.scene) === JSON.stringify(prev.scene)) {
          quiet++;
          if (out.scene === prev.scene) kept++;
        } else expect(out.scene).not.toBe(prev.scene);
      }
      expect(out).toEqual(s);
      prev = out;
    }
    expect(quiet).toBeGreaterThan(10);
    expect(kept).toBe(quiet);
  });

  it("a played tick keeps the untouched parts of a late colony", () => {
    const prev = loadFixture("v3-run1-150min");
    const s = cloneState(prev);
    step(s, TICK, { active: true }, { fx: [] });
    const out = shareState(prev, s);
    expect(out).not.toBe(prev); // time moved
    expect(out).toEqual(s);
    for (const k of ["buildings", "upgrades", "zones", "settings", "seen", "revealed", "haulLog"] as const) expect(out[k], k).toBe(prev[k]);
    expect(out.meta.history).toBe(prev.meta.history);
    expect(out.res).not.toBe(prev.res);
  });
});
