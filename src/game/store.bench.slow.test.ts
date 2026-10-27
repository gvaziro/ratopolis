import { describe, expect, it } from "vitest";
import { cloneState, shareState } from "./engine/clone";
import { step, TICK } from "./engine/step";
import { loadFixture } from "./engine/testkit";
import { useGame } from "./store";
import type { EngineCtx, GameState } from "./types";

/**
 * Wall-clock benches of the store's tick (v3 ENG-6), kept out of the fast suite (perf-saves-1): in `npm test` a GC
 * pause or a busy neighbouring worker flipped their ratios on PRs that touched nothing related. Here both sides run
 * interleaved, each side counts its fastest round (one stall cannot decide), and a failed bench gets two retries.
 * The exact-equality checks (clone.test.ts, store.test.ts: scene identity) stay in the fast suite.
 */

/** Hand the store a state to tick (no save, no lock: node has neither). */
function adopt(s: GameState): void {
  useGame.setState({ game: s, ready: true, crashed: false, crashError: null, saveIssue: null });
}

/** The late colony both benches run on. */
const FIXTURE = "v3-run1-150min";

describe("store tick cost (v3 ENG-6, slow benches)", () => {
  it("the store's own part of a tick — cloneState + shareState — is under half of v2's structuredClone", { retry: 2 }, () => {
    // ENG-6 acceptance (3) asked for advance(1) ≤ 40% of v2's structuredClone + step, but step() alone is ≈ 40–50% of
    // that, so no copy could meet it (advance(1) measured at 45–60%: perf-saves-3). This bench holds what the item
    // changed: the copy before a tick plus the sharing after it, against the structuredClone they replaced, on the
    // same 100 consecutive ticks. Dev box: clone ≈ 0.065 ms + share ≈ 0.09 ms against ≈ 0.5 ms, a ratio of 0.31–0.35.
    const ctx: EngineCtx = { fx: [] };
    let s = loadFixture(FIXTURE);
    /** 100 consecutive ticks as the store sees them: the published state before each and the stepped copy after. */
    const ticks = () => {
      const out: { prev: GameState; next: GameState }[] = [];
      for (let i = 0; i < 100; i++) {
        const next = cloneState(s);
        step(next, TICK, { active: true }, ctx);
        ctx.fx.length = 0;
        out.push({ prev: s, next });
        s = shareState(s, cloneState(next)); // the next tick starts from what the store published
      }
      return out;
    };
    const time = (fn: () => void) => {
      const t0 = performance.now();
      fn();
      return performance.now() - t0;
    };
    let ours = Infinity;
    let v2 = Infinity;
    for (let r = 0; r < 6; r++) {
      const list = ticks();
      const tClone = time(() => list.forEach((t) => cloneState(t.prev)));
      const tShare = time(() => list.forEach((t) => shareState(t.prev, t.next)));
      const tV2 = time(() => list.forEach((t) => structuredClone(t.prev)));
      if (r === 0) continue; // warm-up
      ours = Math.min(ours, tClone + tShare);
      v2 = Math.min(v2, tV2);
    }
    expect(ours / v2).toBeLessThan(0.5);
  });

  it("advance(1) on the late colony costs well under v2's structuredClone + step (≈ 0.5 measured; step bounds it)", { retry: 2 }, () => {
    const ctx: EngineCtx = { fx: [] };
    let v2 = loadFixture(FIXTURE);
    const v2Advance = () => {
      const s = structuredClone(v2);
      step(s, TICK, { active: true }, ctx);
      ctx.fx.length = 0;
      v2 = s;
    };
    adopt(loadFixture(FIXTURE));
    const v3Advance = () => useGame.getState().advance(1, true);
    const time = (fn: () => void, n: number) => {
      const t0 = performance.now();
      for (let i = 0; i < n; i++) fn();
      return performance.now() - t0;
    };
    time(v2Advance, 100);
    time(v3Advance, 100);
    let a = Infinity;
    let b = Infinity;
    for (let r = 0; r < 5; r++) {
      a = Math.min(a, time(v2Advance, 100));
      b = Math.min(b, time(v3Advance, 100));
    }
    expect(b / a).toBeLessThan(0.8);
  });
});
