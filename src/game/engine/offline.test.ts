import { beforeAll, describe, expect, it } from "vitest";
import { Bot, offlineCheck } from "../../../scripts/sim-core";
import type { EngineCtx, GameState } from "../types";
import { derive } from "./derive";
import { simulateOffline } from "./offline";
import { createInitialState } from "./state";
import { step, TICK } from "./step";

/** A mid-game state played by the active bot (sewers + cellars open). */
function midGame(minutes: number, seed = 21): GameState {
  const s = createInitialState(seed, 0);
  const bot = new Bot("active", seed);
  const ctx: EngineCtx = { fx: [] };
  for (let i = 0; i < (minutes * 60) / TICK; i++) {
    const d = step(s, TICK, { active: true }, ctx);
    bot.tick(s, ctx, d);
    ctx.fx.length = 0;
  }
  return s;
}

describe("offline progress", () => {
  let s0: GameState;
  beforeAll(() => {
    s0 = midGame(40);
    // the base offline limits (the bot may already own the night shift)
    delete s0.upgrades.night_shift;
    delete s0.meta.edicts.eternal_night_shift;
  }, 120_000);

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

  it("short absences (≤ 5 s) are ignored", () => {
    const s = structuredClone(s0);
    expect(simulateOffline(s, 3, { fx: [] })).toBeNull();
    expect(s.time).toBe(s0.time);
  });
});
