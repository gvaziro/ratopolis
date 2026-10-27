import { describe, expect, it } from "vitest";
import type { EngineCtx, GameState } from "../types";
import { autoContributeUncapped, buyBuilding, smartAssign } from "./actions";
import { derive } from "./derive";
import { step, TICK } from "./step";
import { metroState } from "./testkit";

/** The kit's metro colony with nothing scheduled to interrupt, coins and buttons already found. */
function quietMetro(seed = 99): GameState {
  const s = metroState(seed, { quiet: true });
  s.resEver.coins = 1;
  s.resEver.buttons = 1;
  return s;
}

describe("smart assignment (tube_orders)", () => {
  /** 200 rats, 5 foundries (10 smelter slots), 1 boiler (2 stoker slots), full button/wire stores. */
  function smelterColony(): GameState {
    const s = quietMetro();
    s.upgrades.tube_orders = true;
    s.assignMode = "smart";
    s.buildings.brass_foundry = 5;
    s.buildings.boiler = 1;
    const d = derive(s);
    s.res.buttons = d.caps.buttons;
    s.res.wire = d.caps.wire;
    return s;
  }

  it("does not flood the colony with scavengers when coins are short", () => {
    const s = smelterColony();
    s.res.steam = 500;
    s.res.coins = 20; // e.g. right after «Внести всё» into the Terminal expedition
    smartAssign(s, derive(s));
    // before the fix: every failed smelter input added a scavenger (≈ 187 of 200, 0 pickpockets)
    expect(s.jobs.scavenger).toBeLessThan(0.4 * s.rats);
    expect(s.jobs.pickpocket).toBeGreaterThan(0.4 * s.rats);
  });

  it("does not flood the colony with scavengers when steam is short", () => {
    const s = smelterColony();
    s.res.steam = 10;
    s.res.coins = 60;
    smartAssign(s, derive(s));
    expect(s.jobs.scavenger).toBeLessThan(0.4 * s.rats);
    expect(s.jobs.pickpocket).toBeGreaterThan(0.4 * s.rats);
  });

  it("still adds supporting scavengers when the missing input is scrap", () => {
    const s = smelterColony();
    s.buildings.workshop = 3; // 9 mechanic slots, eating wire + buttons
    s.res.wire = 0;
    s.res.buttons = 0;
    s.res.steam = 500;
    s.res.coins = 1e5;
    smartAssign(s, derive(s));
    expect(s.jobs.mechanic).toBeGreaterThan(0);
    expect(s.jobs.scavenger).toBeGreaterThan(0);
  });
});

describe("milestones", () => {
  it("only buildings with a produce effect announce the ×2 milestone", () => {
    const s = quietMetro();
    s.res.crumbs = 1e12;
    s.res.coins = 1e12;
    s.buildings.nest = 9;
    s.buildings.trash_chute = 9;
    const ctx: EngineCtx = { fx: [] };
    buyBuilding(s, derive(s), "nest", 1, ctx);
    expect(s.buildings.nest).toBe(10);
    expect(ctx.fx.some((f) => f.k === "milestone")).toBe(false);
    buyBuilding(s, derive(s), "trash_chute", 1, ctx);
    expect(s.buildings.trash_chute).toBe(10);
    expect(ctx.fx.filter((f) => f.k === "milestone").map((f) => f.k === "milestone" && f.building)).toEqual(["trash_chute"]);
  });
});

describe("«Автовзнос» of uncapped resources", () => {
  it("takes half of the tick's gain, never more, and leaves capped resources alone", () => {
    const s = quietMetro();
    s.autoContribute = true;
    s.revealed.exp_terminal = true;
    const before = { ...s.res };
    s.res.blueprints += 10;
    s.res.coins += 10;
    autoContributeUncapped(s, derive(s), before);
    expect(s.projects.terminal?.blueprints).toBeCloseTo(5, 9);
    expect(s.res.blueprints).toBeCloseTo(before.blueprints + 5, 9);
    expect(s.projects.terminal?.coins).toBeUndefined();
    expect(s.res.coins).toBe(before.coins + 10);
  });

  it("the measured rate (HUD, ETAs) is the net after the contribution", () => {
    const run = (on: boolean) => {
      const s = quietMetro(5);
      s.buildings.library = 10; // 0.05 × 10 × 2 (milestone) = 1 📜/s, no global multipliers
      s.revealed.exp_terminal = true;
      s.autoContribute = on;
      const ctx: EngineCtx = { fx: [] };
      for (let i = 0; i < 600; i++) step(s, TICK, { active: false }, ctx);
      return s;
    };
    const off = run(false);
    const on = run(true);
    expect(off.rates.blueprints).toBeCloseTo(1, 2);
    expect(on.rates.blueprints).toBeCloseTo(0.5, 2);
    expect(on.projects.terminal?.blueprints ?? 0).toBeCloseTo(off.res.blueprints / 2, 1);
    expect(on.res.blueprints + (on.projects.terminal?.blueprints ?? 0)).toBeCloseTo(off.res.blueprints, 6);
  });
});
