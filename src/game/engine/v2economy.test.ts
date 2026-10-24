import { describe, expect, it } from "vitest";
import { MILESTONE_JOB_BOOST } from "../data/buildings";
import { RESOURCES } from "../data/resources";
import { TINKERS_MULT } from "../data/upgrades";
import { ZONES } from "../data/zones";
import type { EngineCtx, Fx, GameState, ResId } from "../types";
import { autoContribute, buyBuilding, contributeExpedition, expeditionFraction, openZone, SCOUT_SECONDS, scoutResource } from "./actions";
import { derive, eventValue } from "./derive";
import { levelGain } from "./economy";
import { onZoneOpen } from "./events";
import { expeditionCost } from "./formulas";
import { deserialize, isNewerSave, serialize } from "./save";
import { createInitialState } from "./state";
import { step, TICK } from "./step";

type ScoutFx = Extract<Fx, { k: "scout" }>;
const scouts = (ctx: EngineCtx) => ctx.fx.filter((f): f is ScoutFx => f.k === "scout");

function reload(s: GameState): GameState {
  const r = deserialize(serialize(s));
  if (!r || isNewerSave(r)) throw new Error("reload failed");
  return r;
}

describe("scouting payouts (EN-4)", () => {
  function sewersState(): GameState {
    const s = createInitialState(7, 0);
    s.flags.vagrants = true;
    s.rats = 15; // below the expedition's 20: completing it does not start the dig
    s.jobs.forager = 15;
    return s;
  }

  it("contributing from 0 to 100% pays exactly 3 times, each 60 s of the then-scarcest resource, never again after a reload", () => {
    let s = sewersState();
    const cost = expeditionCost(s, "sewers"); // 🍞 4500, 🪙 1500, ➰ 600
    const ctx: EngineCtx = { fx: [] };
    const d = derive(s);
    const pay = (r: ResId) => SCOUT_SECONDS * eventValue(s, d, r);

    // 🍞 in full: 1/3 ≥ 25% → step 1. 🪙 and ➰ are both at 0: 🪙 needs more seconds of income (1500/0.5 > 600/0.3)
    s.res.crumbs = cost.crumbs!;
    expect(contributeExpedition(s, "sewers", "crumbs", ctx)).toBe(true);
    expect(expeditionFraction(s, "sewers")).toBeCloseTo(1 / 3, 12);
    let fx = scouts(ctx);
    expect(fx.map((f) => [f.step, f.res])).toEqual([[1, "coins"]]);
    expect(fx[0].amount).toBeCloseTo(pay("coins"), 9);
    expect(fx[0].amount).toBeCloseTo(30, 9);
    expect(s.res.coins).toBeCloseTo(30, 9); // over the cap is fine (ignoreCap)
    expect(s.scouted.sewers).toBe(1);
    const newsLine = ctx.fx.find((f): f is Extract<Fx, { k: "news" }> => f.k === "news" && f.text.startsWith("Разведчики"));
    expect(newsLine?.text).toBe("Разведчики вернулись из Канализации: +30 🪙 и кусок карты");

    // a reload remembers the paid step; contributing nothing new pays nothing
    s = reload(s);
    expect(s.scouted.sewers).toBe(1);
    ctx.fx.length = 0;
    contributeExpedition(s, "sewers", null, ctx, 0);
    autoContribute(s, derive(s), ctx);
    expect(scouts(ctx)).toHaveLength(0);

    // 🪙 in full: 2/3 → step 2, the only resource left is ➰
    s.res.coins = cost.coins!;
    contributeExpedition(s, "sewers", "coins", ctx);
    fx = scouts(ctx);
    expect(fx.map((f) => [f.step, f.res])).toEqual([[2, "wire"]]);
    expect(fx[0].amount).toBeCloseTo(pay("wire"), 9);

    // half of the ➰: (1 + 1 + 0.5)/3 = 83% → step 3, still ➰ (the scarcest)
    ctx.fx.length = 0;
    s.res.wire = cost.wire! / 2;
    contributeExpedition(s, "sewers", "wire", ctx);
    fx = scouts(ctx);
    expect(fx.map((f) => [f.step, f.res])).toEqual([[3, "wire"]]);
    expect(fx[0].amount).toBeCloseTo(pay("wire"), 9);
    expect(s.scouted.sewers).toBe(3);

    // the rest, a reload and more: no fourth payout
    ctx.fx.length = 0;
    s.res.wire = cost.wire!;
    contributeExpedition(s, "sewers", "wire", ctx);
    s = reload(s);
    contributeExpedition(s, "sewers", null, ctx, 0);
    expect(scouts(ctx)).toHaveLength(0);
    expect(expeditionFraction(s, "sewers")).toBeCloseTo(1, 12);
  });

  it("one big contribution that crosses all three steps pays all three", () => {
    const s = sewersState();
    const cost = expeditionCost(s, "sewers");
    for (const [r, v] of Object.entries(cost)) s.res[r as ResId] = v;
    const ctx: EngineCtx = { fx: [] };
    contributeExpedition(s, "sewers", null, ctx);
    expect(scouts(ctx).map((f) => f.step)).toEqual([1, 2, 3]);
    for (const f of scouts(ctx)) expect(f.amount).toBeGreaterThan(0);
  });

  it("«Автовзнос» pays the scouts too, and a fresh run starts unscouted", () => {
    const s = sewersState();
    s.autoContribute = true;
    s.rats = 12;
    s.revealed.exp_sewers = true;
    const d = derive(s);
    const cost = expeditionCost(s, "sewers");
    s.projects.sewers = { crumbs: cost.crumbs! / 2 }; // 1/6 of the way: no payout yet
    const ctx: EngineCtx = { fx: [] };
    autoContribute(s, d, ctx);
    expect(scouts(ctx)).toHaveLength(0);
    // an overloaded store gives its overflow to the project: (0.5 + 1000/1500)/3 = 39% → step 1
    s.res.coins = d.caps.coins + 1000;
    autoContribute(s, d, ctx);
    expect(s.projects.sewers.coins).toBeCloseTo(1000, 9);
    expect(scouts(ctx).map((f) => f.step)).toEqual([1]);
    expect(createInitialState(1, 0).scouted).toEqual({});
  });

  it("💍 is never the payout before anything earns it (no event value): the next scarcest resource is", () => {
    const s = createInitialState(9, 0);
    const ctx: EngineCtx = { fx: [] };
    for (const z of ["sewers", "cellars", "metro"] as const) {
      openZone(s, z, ctx);
      onZoneOpen(s, z);
    }
    expect(eventValue(s, derive(s), "trinkets")).toBe(0);
    const r = scoutResource(s, derive(s), "terminal");
    expect(r).not.toBe("trinkets");
    expect(r && ZONES.terminal.expedition!.cost[r]).toBeGreaterThan(0);
  });
});

describe("milestones boost the linked job (EN-4)", () => {
  function jobState(): GameState {
    const s = createInitialState(3, 0);
    const ctx: EngineCtx = { fx: [] };
    for (const z of ["sewers", "cellars"] as const) openZone(s, z, ctx);
    return s;
  }

  it("a producing building with job slots: the job yield jumps ×1.2 at levels 10 and 25", () => {
    const s = jobState();
    const at = (L: number) => {
      s.buildings.cheese_tap = L;
      return derive(s).jobYield.cheese_thief;
    };
    expect(at(9)).toBe(1);
    expect(at(10) / at(9)).toBeCloseTo(MILESTONE_JOB_BOOST, 12);
    expect(at(24)).toBeCloseTo(at(10), 12);
    expect(at(25) / at(24)).toBeCloseTo(MILESTONE_JOB_BOOST, 12);
    expect(at(50) / at(49)).toBeCloseTo(MILESTONE_JOB_BOOST, 12);
    expect(MILESTONE_JOB_BOOST).toBe(1.2);
  });

  it("a jobPct building: (1 + 10%·L) × 1.2 per milestone; slots-only buildings get no boost", () => {
    const s = jobState();
    for (const L of [9, 10, 24, 25, 60]) {
      s.buildings.pickpocket_school = L;
      const n = [10, 25, 50, 100].filter((m) => L >= m).length;
      expect(derive(s).jobYield.pickpocket, String(L)).toBeCloseTo((1 + 0.1 * L) * Math.pow(1.2, n), 12);
    }
    s.buildings.pickpocket_school = 9;
    const y9 = derive(s).jobYield.pickpocket / 1.9;
    s.buildings.pickpocket_school = 10;
    expect(derive(s).jobYield.pickpocket / 2.0 / y9).toBeCloseTo(1.2, 12);
    s.buildings.workshop = 30; // mechanic slots, but the workshop produces nothing
    expect(derive(s).jobYield.mechanic).toBe(1);
  });

  it("levelGain(…, 1) across the level-10 milestone equals the measured Δ gross, job boost included", () => {
    const s = createInitialState(5, 0);
    s.flags.vagrants = true;
    s.rats = 30;
    s.jobs.forager = 15;
    s.jobs.pickpocket = 15;
    s.buildings.nest = 15;
    s.buildings.pickpocket_school = 9;
    s.resEver.crumbs = 1e6;
    s.resEver.coins = 10;
    s.res.crumbs = 1e9;
    s.res.coins = 1e9;
    s.flags.hit_any_cap = true;
    s.flags.hit_crumb_cap = true;
    s.meta.achievements.first_crumb = 0;
    s.meta.achievements.full_storage = 0;
    const ctx: EngineCtx = { fx: [] };
    step(s, TICK, { active: false }, ctx);
    const d = derive(s);
    const gain = levelGain(s, d, "pickpocket_school", 1);
    const before = s.gross.coins;
    expect(buyBuilding(s, d, "pickpocket_school", 1, ctx)).toBe(1);
    step(s, TICK, { active: false }, ctx);
    expect(Math.abs(gain.coins! - (s.gross.coins - before))).toBeLessThan(1e-9);
    // the school's own 0.2 🪙/s doubles and 15 pickpockets go from ×1.9 to ×2.0 × 1.2
    const m = d.tierMult * d.global * d.temp;
    expect(gain.coins!).toBeCloseTo((10 * 0.2 * 2 - 9 * 0.2) * m + 15 * 0.065 * (2.0 * 1.2 - 1.9) * m, 9);
  });
});

describe("data knobs (EN-2)", () => {
  it("cellars need 50 rats, the metro adds 50 housing, the Tinkers' guild ×1.75 (EN-13)", () => {
    expect(ZONES.cellars.expedition?.rats).toBe(50);
    expect(ZONES.metro.housingBonus).toBe(50);
    expect(TINKERS_MULT).toBe(1.75);
    const s = createInitialState(1, 0);
    const base = derive(s).tierMult;
    s.upgrades.tinkers_guild = true;
    expect(derive(s).tierMult / base).toBeCloseTo(1.75, 12);
    expect(RESOURCES.steam.desc).toContain("Не получает глобальных множителей");
  });
});
