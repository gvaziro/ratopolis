import { describe, expect, it } from "vitest";
import { EDICTS, EXPRESS_STAGE_LINES, EXPRESS_STAGES } from "../data/meta";
import { FOREMAN_UPGRADES, RAT_MEMORY_UPGRADES } from "../data/upgrades";
import type { Amounts, EngineCtx, Fx, GameState } from "../types";
import { buyEdict, contributeExpress, migrate, openZone } from "./actions";
import { derive } from "./derive";
import { canMigrate, crownsForRun, entries, expeditionCost, expressStageCost } from "./formulas";
import { createInitialState, KEPT_STAGES_MAX } from "./state";

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
    expect(expeditionCost(s, "cellars").coins).toBe(Math.ceil(8500 * 0.25));

    expect(buyEdict(s, "express_blueprints", ctx)).toBe(true);
    expect(s.express.stage).toBe(4);
    expect(buyEdict(s, "express_blueprints", ctx)).toBe(false); // once only
  });

  it("after a coronation run the blueprints keep only the first 5 stages, so stages 6–10 and the coronation replay", () => {
    const s = readyToMigrate();
    s.express.stage = 10;
    s.coronatedThisRun = true;
    const ctx: EngineCtx = { fx: [] };
    const next = migrate(s, 0, ctx)!;
    expect(KEPT_STAGES_MAX).toBe(5);
    expect(next.meta.expressKept).toBe(5);
    next.meta.crowns = 100;
    expect(buyEdict(next, "express_blueprints", ctx)).toBe(true);
    expect(next.express.stage).toBe(5);
    // and at the start of the run after that (an old v1 save may still remember 9 or 10)
    next.meta.expressKept = 10;
    next.zones.metro = true;
    next.eRun = 2e6;
    const third = migrate(next, 0, ctx)!;
    expect(third.meta.expressKept).toBe(5);
    expect(third.express.stage).toBe(5);
    expect(EDICTS.express_blueprints.effect).toContain("Первые 5 этапов");
  });

  it("express stages are 5× the v1 base with ×1.5 growth (EN-13): a little above the v1 total, and stage 1 no longer costs pocket change", () => {
    const s = createInitialState(1, 0);
    const v1 = { rails: 50, gears: 10000, brass: 1000, trinkets: 6, blueprints: 30 };
    const total = (f: (n: number) => Amounts) => {
      const out: Amounts = {};
      for (let n = 1; n <= 10; n++) for (const [r, v] of entries(f(n))) out[r] = (out[r] ?? 0) + v;
      return out;
    };
    const now = total((n) => expressStageCost(s, n));
    const old = total((n) => Object.fromEntries(Object.entries(v1).map(([r, v]) => [r, Math.ceil(v * Math.pow(1.8, n - 1))])));
    for (const [r, v] of entries(old)) expect((now[r] ?? 0) / v, r).toBeGreaterThan(1.05);
    for (const [r, v] of entries(old)) expect((now[r] ?? 0) / v, r).toBeLessThan(1.35);
    expect(expressStageCost(s, 1)).toEqual({ rails: 250, gears: 50000, brass: 5000, trinkets: 30, blueprints: 150 });
    s.meta.edicts.express_blueprints = true;
    expect(expressStageCost(s, 1).rails).toBe(188);
  });

  it("a finished express stage reads «Этап «…»: <human line>»; the coronation headline uses coronationLine", () => {
    const s = readyToMigrate();
    const ctx: EngineCtx = { fx: [] };
    openZone(s, "terminal", ctx);
    s.upgrades.express_plan = true;
    s.express.stage = 0;
    s.res.rails = s.res.gears = s.res.brass = s.res.trinkets = s.res.blueprints = 1e12;
    contributeExpress(s, null, ctx);
    expect(s.express.stage).toBe(1);
    const stageNews = ctx.fx.filter((f): f is Extract<Fx, { k: "news" }> => f.k === "news").map((f) => f.text);
    expect(stageNews).toContain(`Этап «${EXPRESS_STAGES[0]}»: ${EXPRESS_STAGE_LINES[0].human}`);
    s.express.stage = 9;
    s.meta.migrations = 1; // the first run after a migration starts on a Wednesday
    ctx.fx.length = 0;
    contributeExpress(s, null, ctx);
    expect(s.express.stage).toBe(10);
    const crowning = ctx.fx.filter((f): f is Extract<Fx, { k: "news" }> => f.k === "news").map((f) => f.text).find((t) => t.startsWith("ДА ЗДРАВСТВУЕТ"));
    expect(crowning).toBe("ДА ЗДРАВСТВУЕТ КРЫСИНЫЙ КОРОЛЬ! «Для людей это одна среда. Для крыс — целая история.»");
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
