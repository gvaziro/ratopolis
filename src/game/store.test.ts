import { afterEach, describe, expect, it, vi } from "vitest";
import { expressCost, openZone } from "./engine/actions";
import { onZoneOpen } from "./engine/events";
import { serialize } from "./engine/save";
import { createInitialState } from "./engine/state";
import { step, TICK } from "./engine/step";
import { onFx } from "./fx";
import { useGame } from "./store";
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
});
