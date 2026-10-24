import { describe, expect, it } from "vitest";
import { FOREMAN_UPGRADES, RAT_MEMORY_UPGRADES } from "../data/upgrades";
import type { EngineCtx, GameState } from "../types";
import { buyEdict, migrate, openZone } from "./actions";
import { derive } from "./derive";
import { canMigrate, crownsForRun, expeditionCost } from "./formulas";
import { createInitialState } from "./state";

function readyToMigrate(): GameState {
  const s = createInitialState(1, 0);
  const ctx: EngineCtx = { fx: [] };
  for (const z of ["sewers", "cellars", "metro"] as const) openZone(s, z, ctx);
  s.eRun = 9e6; // 30 crowns
  s.express.stage = 4;
  return s;
}

describe("Great Migration and edicts", () => {
  it("migrate() grants the crowns, keeps meta and starts a fresh run", () => {
    const s = readyToMigrate();
    expect(canMigrate(s)).toBe(true);
    const crowns = crownsForRun(s);
    expect(crowns).toBe(30);
    const ctx: EngineCtx = { fx: [] };
    const next = migrate(s, 0, ctx)!;
    expect(next.meta.crowns).toBe(30);
    expect(next.meta.crownsEver).toBe(30);
    expect(next.meta.migrations).toBe(1);
    expect(next.time).toBe(0);
    expect(next.rats).toBe(0);
    expect(next.zones).toEqual({ burrow: true });
    expect(next.meta.expressKept).toBe(4);
    expect(derive(next).global).toBeGreaterThan(1.5); // +2% per crown ever earned
  });

  it("run-start edicts bought on the migration screen apply to the current run at once", () => {
    const ctx: EngineCtx = { fx: [] };
    const s = migrate(readyToMigrate(), 0, ctx)!;
    s.meta.crowns = 100;
    expect(buyEdict(s, "royal_litter", ctx)).toBe(true);
    expect(s.rats).toBe(10);
    expect(s.jobs.forager).toBe(10);
    expect(s.buildings.nest).toBe(5);
    expect(s.flags.vagrants).toBe(true);

    expect(buyEdict(s, "rat_memory", ctx)).toBe(true);
    for (const u of RAT_MEMORY_UPGRADES) expect(s.upgrades[u], u).toBe(true);
    expect(buyEdict(s, "inherited_foreman", ctx)).toBe(true);
    for (const u of FOREMAN_UPGRADES) expect(s.upgrades[u], u).toBe(true);

    expect(buyEdict(s, "old_tunnels", ctx)).toBe(true);
    expect(s.zones.sewers).toBe(true);
    expect(Number.isFinite(s.timers.capsule)).toBe(true);
    expect(Number.isFinite(s.timers.downpour)).toBe(true);
    expect(expeditionCost(s, "cellars").coins).toBe(Math.ceil(11000 * 0.25));

    expect(buyEdict(s, "express_blueprints", ctx)).toBe(true);
    expect(s.express.stage).toBe(4);
    expect(buyEdict(s, "express_blueprints", ctx)).toBe(false); // once only
  });

  it("after a coronation run the blueprints keep 9 stages, so the coronation can happen again", () => {
    const s = readyToMigrate();
    s.express.stage = 10;
    s.coronatedThisRun = true;
    const ctx: EngineCtx = { fx: [] };
    const next = migrate(s, 0, ctx)!;
    expect(next.meta.expressKept).toBe(9);
    next.meta.crowns = 100;
    expect(buyEdict(next, "express_blueprints", ctx)).toBe(true);
    expect(next.express.stage).toBe(9);
    // and at the start of the run after that (an old save may still remember 10)
    next.meta.expressKept = 10;
    next.zones.metro = true;
    next.eRun = 2e6;
    const third = migrate(next, 0, ctx)!;
    expect(third.meta.expressKept).toBe(9);
    expect(third.express.stage).toBe(9);
  });

  it("the new run's tabs and HUD are revealed at once (no blank second on the migration screen)", () => {
    const next = migrate(readyToMigrate(), 0, { fx: [] })!;
    expect(next.time).toBe(0);
    expect(next.revealed.tab_migration).toBe(true);
    expect(next.revealed.tab_medals).toBe(true);
    expect(next.revealed.news).toBe(true);
    expect(next.revealed.goal).toBe(true);
  });

  it("an edict bought before a migration still applies at the next run start", () => {
    const s = readyToMigrate();
    s.meta.crowns = 20;
    s.meta.edicts.old_tunnels = true;
    const next = migrate(s, 0, { fx: [] })!;
    expect(next.zones.sewers).toBe(true);
    expect(Number.isFinite(next.timers.downpour)).toBe(true);
  });
});
