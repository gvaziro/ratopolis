import { beforeAll, describe, expect, it } from "vitest";
import { offlineCheck } from "../../../scripts/sim-core";
import type { EngineCtx, GameState } from "../types";
import { expressCost } from "./actions";
import { derive } from "./derive";
import { simulateOffline } from "./offline";
import { createInitialState } from "./state";
import { step, TICK } from "./step";
import { loadFixture } from "./testkit";

describe("offline progress", () => {
  let s0: GameState;
  beforeAll(() => {
    // a mid-game colony the active bot played for an hour (the Metro just opened): the golden save, not 36 000 ticks
    s0 = loadFixture("v3-run1-60min");
    // the base offline limits (the bot may already own the night shift)
    delete s0.upgrades.night_shift;
    delete s0.meta.edicts.eternal_night_shift;
  });

  it("10 h away is capped at capSec with efficiency η", () => {
    const s = structuredClone(s0);
    const d = derive(s);
    expect(d.offline.capSec).toBe(2 * 3600);
    expect(d.offline.eta).toBe(0.5);
    const rep = simulateOffline(s, 10 * 3600, { fx: [] })!;
    expect(rep.elapsed).toBe(10 * 3600);
    expect(rep.simulated).toBe(d.offline.capSec);
    expect(rep.eta).toBe(0.5);
    expect(s.time).toBeCloseTo(s0.time + d.offline.capSec, 3);
    expect(s.scene).toBeNull();
  });

  it("night shift and the eternal night shift extend the cap to 8 h and η to 1", () => {
    const s = structuredClone(s0);
    s.upgrades.night_shift = true;
    s.meta.edicts.eternal_night_shift = true;
    const d = derive(s);
    expect(d.offline.capSec).toBe(8 * 3600);
    expect(d.offline.eta).toBe(1);
    expect(simulateOffline(s, 10 * 3600, { fx: [] })!.simulated).toBe(8 * 3600);
  });

  it("gains stay within cap × passive income × η (+ trains), base and upgraded", () => {
    const base = offlineCheck(structuredClone(s0), 10 * 3600);
    expect(base.simulated).toBe(2 * 3600);
    expect(base.gainedValue).toBeGreaterThan(0);
    expect(base.ok, `gained ${base.gainedValue} > bound ${base.boundValue}`).toBe(true);
    const up = structuredClone(s0);
    up.upgrades.night_shift = true;
    up.meta.edicts.eternal_night_shift = true;
    const full = offlineCheck(up, 10 * 3600);
    expect(full.simulated).toBe(8 * 3600);
    expect(full.ok, `gained ${full.gainedValue} > bound ${full.boundValue}`).toBe(true);
  });

  it("no events and no suspicion while away; rats never disappear", () => {
    const s = structuredClone(s0);
    s.suspicion = 37;
    const ctx: EngineCtx = { fx: [] };
    const rats = s.rats;
    simulateOffline(s, 3 * 3600, ctx);
    expect(ctx.fx.some((f) => f.k === "sceneStart")).toBe(false);
    expect(s.suspicion).toBe(37);
    expect(s.rats).toBeGreaterThanOrEqual(rats);
    for (const r of Object.values(s.res)) expect(Number.isFinite(r)).toBe(true);
  });

  it("η is applied once: the EMA keeps the online rate, so offline trains and later events are not η²", () => {
    const s = createInitialState(4, 0);
    s.buildings.pickpocket_school = 10;
    s.timers.carriage = Infinity;
    s.timers.shiny = Infinity;
    const ctx: EngineCtx = { fx: [] };
    for (let i = 0; i < 3000; i++) step(s, TICK, { active: false }, ctx);
    const ema = s.ema.coins;
    const gross = s.gross.coins;
    expect(ema).toBeGreaterThan(0);
    expect(Math.abs(ema / gross - 1)).toBeLessThan(0.01);
    const rep = simulateOffline(s, 3600, ctx)!;
    expect(rep.eta).toBe(0.5);
    expect(Math.abs(s.ema.coins / ema - 1)).toBeLessThan(0.01); // was ≈ η = 0.5
    expect(s.gross.coins / gross).toBeCloseTo(0.5, 6); // actual production while away is still × η
  });

  it("a coronation finished by «Автовзнос» while away is reported and its overlay fx is forwarded", () => {
    const s = createInitialState(6, 0);
    s.upgrades.express_plan = true;
    s.express.stage = 9;
    s.express.progress = { ...expressCost(s) };
    s.autoContribute = true;
    const ctx: EngineCtx = { fx: [] };
    const rep = simulateOffline(s, 600, ctx)!;
    expect(s.express.stage).toBe(10);
    expect(s.coronatedThisRun).toBe(true);
    expect(rep.coronated).toBe(true);
    expect(ctx.fx.some((f) => f.k === "coronation")).toBe(true);
    // already crowned before the next absence: nothing new to report
    expect(simulateOffline(s, 600, { fx: [] })!.coronated).toBe(false);
  });

  it("short absences (≤ 5 s) are ignored", () => {
    const s = structuredClone(s0);
    expect(simulateOffline(s, 3, { fx: [] })).toBeNull();
    expect(s.time).toBe(s0.time);
  });
});
