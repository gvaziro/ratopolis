import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onSceneHold, sceneHeld, sceneNow, setSceneHeld } from "./sceneClock";
import { makeClock } from "./sceneUtils";

/** performance.now() under test control (ms). */
let fake = 0;

beforeEach(() => {
  fake = 1_000;
  vi.spyOn(performance, "now").mockImplementation(() => fake);
  setSceneHeld(false);
});

afterEach(() => {
  setSceneHeld(false);
  vi.restoreAllMocks();
});

describe("sceneNow (SCN-1: one pausable scene clock)", () => {
  it("runs with performance.now() while nothing holds it", () => {
    const a = sceneNow();
    fake += 2_500;
    expect(sceneNow() - a).toBe(2_500);
  });

  it("10 s of hold advance it by 0, and it goes on without a jump after the release", () => {
    fake += 300;
    const before = sceneNow();
    setSceneHeld(true);
    expect(sceneHeld()).toBe(true);
    fake += 10_000;
    expect(sceneNow()).toBe(before);
    setSceneHeld(false);
    expect(sceneNow()).toBe(before);
    fake += 16;
    expect(sceneNow()).toBe(before + 16);
  });

  it("adds up several holds and ignores repeated calls", () => {
    const start = sceneNow();
    setSceneHeld(true);
    fake += 4_000;
    setSceneHeld(true); // still the same hold
    fake += 1_000;
    setSceneHeld(false);
    fake += 500;
    setSceneHeld(true);
    fake += 7_000;
    setSceneHeld(false);
    setSceneHeld(false);
    fake += 250;
    expect(sceneNow() - start).toBe(750);
  });

  it("tells the listeners about real changes only", () => {
    const seen: boolean[] = [];
    const off = onSceneHold((h) => seen.push(h));
    setSceneHeld(true);
    setSceneHeld(true);
    setSceneHeld(false);
    off();
    setSceneHeld(true);
    expect(seen).toEqual([true, false]);
  });
});

describe("makeClock on the scene clock", () => {
  it("stands still through a 10 s hold and continues from the same second", () => {
    const clock = makeClock(0);
    const t0 = clock();
    fake += 1_500;
    expect(clock() - t0).toBeCloseTo(1.5, 9);
    setSceneHeld(true);
    fake += 10_000;
    expect(clock() - t0).toBeCloseTo(1.5, 9);
    setSceneHeld(false);
    expect(clock() - t0).toBeCloseTo(1.5, 9);
    fake += 500;
    expect(clock() - t0).toBeCloseTo(2, 9);
  });

  it("a clock made during a hold starts when the hold ends", () => {
    setSceneHeld(true);
    const clock = makeClock(0);
    const t0 = clock();
    fake += 3_000;
    expect(clock()).toBe(t0);
    setSceneHeld(false);
    fake += 1_000;
    expect(clock() - t0).toBeCloseTo(1, 9);
  });
});
