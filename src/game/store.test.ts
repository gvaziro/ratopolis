import { afterEach, describe, expect, it, vi } from "vitest";
import { expressCost, openZone } from "./engine/actions";
import { onZoneOpen } from "./engine/events";
import { serialize } from "./engine/save";
import { createInitialState } from "./engine/state";
import { step, TICK } from "./engine/step";
import { onFx } from "./fx";
import { useGame } from "./store";
import { loadFixture, metroState, triggerEvent } from "./engine/testkit";
import type { EngineCtx, Fx, GameState } from "./types";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("store", () => {
  it("init() keeps the fx of the absence until flushInitFx(), which emits them once", () => {
    // a save from an hour ago whose «Автовзнос» finishes the express (coronation) during the catch-up
    const saved = createInitialState(3, Date.now() - 3600_000);
    saved.upgrades.express_plan = true;
    saved.express.stage = 9;
    saved.express.progress = { ...expressCost(saved) };
    saved.autoContribute = true;
    const raw = serialize(saved);
    vi.stubGlobal("localStorage", { getItem: () => raw, setItem: () => {}, removeItem: () => {} });

    const got: Fx[] = [];
    const off = onFx((f) => got.push(f));
    useGame.setState({ ready: false });
    useGame.getState().init();
    expect(useGame.getState().ready).toBe(true);
    expect(useGame.getState().offlineReport?.coronated).toBe(true);
    expect(got).toEqual([]); // nothing is listening yet in the real app
    useGame.getState().flushInitFx();
    expect(got.some((f) => f.k === "coronation")).toBe(true);
    const n = got.length;
    useGame.getState().flushInitFx();
    expect(got.length).toBe(n);
    off();
  });

  it("scene actions are not player input (timer-driven results must not make an AFK player 'active')", () => {
    const s: GameState = createInitialState(9, 0);
    const ctx: EngineCtx = { fx: [] };
    for (const z of ["sewers", "cellars", "metro"] as const) {
      openZone(s, z, ctx);
      onZoneOpen(s, z);
    }
    s.timers.carriage = Infinity;
    s.timers.metro_train = s.time;
    step(s, TICK, { active: false }, ctx);
    expect(s.scene?.id).toBe("metro_train");
    useGame.setState({ game: s, ready: true, lastInputAt: 0 });
    useGame.getState().scene({ a: "attach" });
    useGame.getState().scene({ a: "skip" });
    expect(useGame.getState().game.scene?.phase).toBe("haul");
    expect(useGame.getState().lastInputAt).toBe(0);
  });

  it("a long stalled frame restarts the elder's hint clock instead of ageing it (goals-5)", () => {
    const s = loadFixture("v3-run1-60min");
    s.settings.hints = true;
    s.scene = null;
    useGame.setState({ game: s, ready: true });
    useGame.getState().advance(10, false); // a normal frame: the top hint is noted
    const { id, since } = useGame.getState().game.hintMemo;
    expect(id).not.toBe("");
    useGame.getState().advance(10, false);
    expect(useGame.getState().game.hintMemo).toMatchObject({ id, since }); // still the same hint, still ageing
    useGame.getState().advance(400, false); // a 40 s stall: nobody read the hint
    const g = useGame.getState().game;
    if (g.hintMemo.id === id) expect(g.hintMemo.since).toBe(g.time);
    expect(g.hintMemo.since).toBeGreaterThan(since);
  });
});

describe("store: plain clone and structural sharing (v3 ENG-6)", () => {
  /** Hand the store a state to tick (no save, no lock: node has neither). */
  function adopt(s: GameState): void {
    useGame.setState({ game: s, ready: true, crashed: false, crashError: null, saveIssue: null });
  }

  it("advance() publishes a new state that keeps the untouched parts and never touches the old one", () => {
    const s = loadFixture("v3-run1-150min");
    const snapshot = serialize(s);
    adopt(s);
    useGame.getState().advance(1, true);
    const next = useGame.getState().game;
    expect(next).not.toBe(s);
    expect(next.time).toBeCloseTo(s.time + TICK, 9);
    for (const k of ["buildings", "upgrades", "zones", "settings", "haulLog"] as const) expect(next[k], k).toBe(s[k]);
    expect(serialize(s)).toBe(snapshot);
    // an action that changes nothing republishes the same object
    useGame.getState().setTrainPref(next.trainPrefs.position);
    expect(useGame.getState().game).toBe(next);
  });

  it("a waiting metro scene keeps its identity through advance() on the ticks where it did not change", () => {
    const s = metroState(5, { quiet: true });
    triggerEvent(s, "metro_train");
    adopt(s);
    let quiet = 0;
    let kept = 0;
    for (let i = 0; i < 120; i++) {
      const prev = useGame.getState().game.scene;
      useGame.getState().advance(1, false);
      const sc = useGame.getState().game.scene;
      if (prev && sc && (sc.phase === "rumble" || sc.phase === "piles") && JSON.stringify(prev) === JSON.stringify(sc)) {
        quiet++;
        if (sc === prev) kept++;
      }
    }
    expect(quiet).toBeGreaterThan(10);
    expect(kept).toBe(quiet);
  });

  // the wall-clock benches (advance(1) against v2's structuredClone + step) are in store.bench.slow.test.ts: timing
  // ratios flake in the parallel fast suite (perf-saves-1)
});
