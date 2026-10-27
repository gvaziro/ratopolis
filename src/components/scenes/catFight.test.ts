import { describe, expect, it } from "vitest";
import { derive } from "@/game/engine/derive";
import { CAT_COUNTER_WINDOW, catLungeAt, sceneAction } from "@/game/engine/events";
import { step, TICK } from "@/game/engine/step";
import { metroState, triggerEvent } from "@/game/engine/testkit";
import type { EngineCtx } from "@/game/types";
import { COUNTER_HITS, counterOf, creep, knockBack, LUNGE_REACH, LUNGE_WINDUP, lungeAt, REACH_LOSE, REACH_START, tapEffect } from "./catFight";

interface Fight {
  won: boolean;
  taps: number;
  counters: number;
  at: number;
}

/**
 * The fight the engine really starts for a cat after `catsBeaten` beaten ones: its hp and how long its taps phase lasts
 * (the creep's `total` and the clock CatFight loses on), not a length the test picks.
 */
function engineFight(catsBeaten: number): { hp: number; secs: number } {
  const s = metroState(5, { quiet: true });
  s.stats.catsBeaten = catsBeaten;
  triggerEvent(s, "cat");
  const ctx: EngineCtx = { fx: [] };
  for (let i = 0; i < 30 && s.scene?.id !== "cat"; i++) step(s, TICK, { active: true }, ctx);
  const sc = s.scene;
  if (sc?.id !== "cat" || !sc.taps) throw new Error("the cat did not come");
  sceneAction(s, derive(s), { a: "choice", option: "fight" }, ctx);
  expect(sc.phase).toBe("taps");
  return { hp: sc.taps.hp, secs: sc.phaseEnds - sc.phaseStart };
}

/** Play a fight like CatFight does: the paw creeps (and lunges), every tap at `taps[i]` seconds lands, until the clock runs out. */
function fight(seq: number, hp: number, total: number, taps: number[], keyboard = false): Fight {
  const countered = new Set<number>();
  let reach = REACH_START;
  let hits = 0;
  let used = 0;
  let t = 0;
  const dt = 1 / 120;
  let next = 0;
  while (t < total) {
    t += dt;
    reach = creep(reach, dt, total);
    while (next < taps.length && taps[next] <= t) {
      const n = counterOf(seq, taps[next], countered, keyboard);
      if (n >= 0) countered.add(n);
      const e = tapEffect(hp, n >= 0);
      hits += e.hits;
      reach = knockBack(reach, e.knock);
      used++;
      next++;
      if (hits >= hp) return { won: true, taps: used, counters: countered.size, at: t };
    }
    if (reach + lungeAt(seq, t, countered).bump >= REACH_LOSE) return { won: false, taps: used, counters: countered.size, at: t };
  }
  return { won: false, taps: used, counters: countered.size, at: t };
}

describe("the cat's lunge and the counter (SCN-4)", () => {
  it("the claws glint 0.3 s before a peak and the lunge reaches +0.12 at it", () => {
    const peak = catLungeAt(7, 2);
    const none = new Set<number>();
    expect(lungeAt(7, peak - LUNGE_WINDUP + 0.01, none).glint).toBe(true);
    expect(lungeAt(7, peak - LUNGE_WINDUP + 0.01, none).windup).toBeGreaterThanOrEqual(0);
    expect(lungeAt(7, peak, none).bump).toBeCloseTo(LUNGE_REACH);
    expect(lungeAt(7, peak - 0.45, none).glint).toBe(false);
    // a countered lunge stops short
    expect(lungeAt(7, peak, new Set([2])).bump).toBe(0);
  });

  it("a hit within ±CAT_COUNTER_WINDOW of a peak counters it, once", () => {
    const peak = catLungeAt(3, 1);
    const used = new Set<number>();
    expect(counterOf(3, peak - CAT_COUNTER_WINDOW + 0.01, used)).toBe(1);
    expect(counterOf(3, peak + CAT_COUNTER_WINDOW + 0.02, used)).toBe(-1);
    expect(counterOf(3, peak - 0.25, used)).toBe(-1);
    used.add(1);
    expect(counterOf(3, peak, used)).toBe(-1);
  });

  it("Space counts anywhere in the glint", () => {
    const peak = catLungeAt(3, 1);
    expect(counterOf(3, peak - 0.28, new Set(), true)).toBe(1);
    expect(counterOf(3, peak - 0.28, new Set(), false)).toBe(-1);
  });

  it("a counter counts 3 hits and knocks back ×2", () => {
    expect(tapEffect(40, true)).toEqual({ hits: COUNTER_HITS, knock: (2 * 1.4) / 40 });
    expect(tapEffect(40, false)).toEqual({ hits: 1, knock: 1.4 / 40 });
  });

  // the engine's own fight, not a longer one: a 10 s fight has only 9 lunges (27 hits of counters), short of 40 hp
  it("with counters only a 40-hp cat falls in ≤ 14 taps (one on each peak) within its fight", () => {
    const { hp, secs } = engineFight(9);
    expect(hp).toBe(40);
    for (const seq of [1, 2, 77, 1234]) {
      const taps = Array.from({ length: 20 }, (_, n) => catLungeAt(seq, n));
      const f = fight(seq, hp, secs, taps);
      expect(f.won).toBe(true);
      expect(f.taps).toBeLessThanOrEqual(14);
      expect(f.counters).toBe(f.taps);
    }
  });

  it("mashing at 6 taps/s still beats a 25-hp cat (the engine's 27-hp one) within its fight", () => {
    const { hp, secs } = engineFight(4);
    expect(hp).toBeGreaterThanOrEqual(25);
    for (const seq of [1, 2, 77, 1234]) {
      const taps = Array.from({ length: Math.ceil(secs * 6) }, (_, k) => 0.15 + k / 6);
      const f = fight(seq, hp, secs, taps);
      expect(f.won).toBe(true);
      expect(f.at).toBeLessThan(secs);
    }
  });

  it("nobody fighting: the lunging paw reaches the huddle before the clock runs out", () => {
    for (const beaten of [0, 4, 9]) {
      const { hp, secs } = engineFight(beaten);
      const f = fight(5, hp, secs, []);
      expect(f.won).toBe(false);
      expect(f.at).toBeLessThan(secs);
    }
  });
});
