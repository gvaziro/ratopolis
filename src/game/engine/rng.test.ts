import { describe, expect, it } from "vitest";
import { chance, pick, pickWeighted, rand, randInt, randRange } from "./rng";

describe("rng (mulberry32 in GameState.rng)", () => {
  it("is deterministic for a seed and advances the state", () => {
    const a = { rng: 12345 };
    const b = { rng: 12345 };
    const xa = Array.from({ length: 200 }, () => rand(a));
    const xb = Array.from({ length: 200 }, () => rand(b));
    expect(xa).toEqual(xb);
    expect(a.rng).toBe(b.rng);
    expect(a.rng).not.toBe(12345);
  });

  it("different seeds give different streams", () => {
    const a = { rng: 1 };
    const b = { rng: 2 };
    const xa = Array.from({ length: 20 }, () => rand(a));
    const xb = Array.from({ length: 20 }, () => rand(b));
    expect(xa).not.toEqual(xb);
  });

  it("is uniform on [0, 1)", () => {
    const s = { rng: 777 };
    const n = 100_000;
    const buckets = new Array(10).fill(0);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const x = rand(s);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      sum += x;
      buckets[Math.floor(x * 10)]++;
    }
    expect(sum / n).toBeGreaterThan(0.49);
    expect(sum / n).toBeLessThan(0.51);
    for (const c of buckets) {
      expect(c / n).toBeGreaterThan(0.095);
      expect(c / n).toBeLessThan(0.105);
    }
  });

  it("randInt covers both bounds inclusively, randRange stays in range", () => {
    const s = { rng: 99 };
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i++) {
      const k = randInt(s, 3, 7);
      expect(k).toBeGreaterThanOrEqual(3);
      expect(k).toBeLessThanOrEqual(7);
      seen.add(k);
      const x = randRange(s, -2, 5);
      expect(x).toBeGreaterThanOrEqual(-2);
      expect(x).toBeLessThan(5);
    }
    expect([...seen].sort()).toEqual([3, 4, 5, 6, 7]);
  });

  it("chance and pickWeighted follow their probabilities", () => {
    const s = { rng: 2024 };
    const n = 60_000;
    let hits = 0;
    const counts: Record<string, number> = { a: 0, b: 0, c: 0 };
    for (let i = 0; i < n; i++) {
      if (chance(s, 0.3)) hits++;
      counts[pickWeighted(s, { a: 1, b: 3, c: 6 })]++;
    }
    expect(hits / n).toBeCloseTo(0.3, 1);
    expect(counts.a / n).toBeCloseTo(0.1, 1);
    expect(counts.b / n).toBeCloseTo(0.3, 1);
    expect(counts.c / n).toBeCloseTo(0.6, 1);
  });

  it("pick returns members of the array", () => {
    const s = { rng: 5 };
    const arr = ["x", "y", "z"] as const;
    for (let i = 0; i < 100; i++) expect(arr).toContain(pick(s, arr));
  });
});
