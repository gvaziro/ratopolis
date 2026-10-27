import { describe, expect, it } from "vitest";
import { EVENT_LINE_POOLS, EVENT_LINES, LANTERN_MULT, POSITION_FEEL, TRAIN_VARIANTS } from "../data/events";
import { EDICT_ORDER, EDICTS, EXPRESS_STAGE_LINES, EXPRESS_STAGES, SEALS } from "../data/meta";
import { COMMISSIONS, COMMISSION_ORDER } from "../data/commissions";
import { districtLoc, districtTrait } from "../data/zones";
import { TRAIN_VARIANT_IDS, type CatchResult, type EngineCtx, type Fx, type GameState, type Scene } from "../types";
import { acceptCommission, buyBuilding, buyEdict, buyEdictRank, buySeal, click, contributeExpress, migrate, openZone, setSeal } from "./actions";
import { edictRank } from "./core";
import { derive } from "./derive";
import { buildingCostFor, grossRates, levelGain, milestoneInfo, paybackSeconds } from "./economy";
import { buildTrain, catchProgress, sceneAction } from "./events";
import { buyCount, crownThreshold, crownsForRun, nextCrownAt, prevCrownAt } from "./formulas";
import { coronationLine, migrationPreview, weekdayAt } from "./narrative";
import { LINEMAN_START, PILE_HOLD_RATE, PILE_STEP, linemanX, pileLockTime, stepPile } from "./piles";
import { achievementProgress, commissionProgress } from "./progress";
import { rand } from "./rng";
import { migrate as migrateSave, serialize } from "./save";
import { createInitialState } from "./state";
import { step, TICK } from "./step";
import { metroState } from "./testkit";

describe("piles (EN-5 helpers)", () => {
  it("the lineman walks 0 → 1 between LINEMAN_START and 85% of the phase", () => {
    expect(linemanX(0, 12)).toBe(0);
    expect(linemanX(LINEMAN_START, 12)).toBe(0);
    expect(linemanX(0.85 * 12, 12)).toBeCloseTo(1, 12);
    expect(linemanX(12, 12)).toBe(1);
    expect(linemanX(LINEMAN_START + (0.85 * 12 - LINEMAN_START) / 2, 12)).toBeCloseTo(0.5, 12);
  });

  it("pile i locks exactly when the lineman reaches its centre", () => {
    for (const n of [1, 4, 6, 11]) {
      let prev = -1;
      for (let i = 0; i < n; i++) {
        const t = pileLockTime(i, n, 12);
        expect(t).toBeGreaterThan(prev);
        expect(linemanX(t, 12)).toBeCloseTo((i + 0.5) / n, 9);
        prev = t;
      }
    }
  });

  it("stepPile starts from the auto share, adds clicks and holds, caps at 1", () => {
    expect(stepPile(0, 0.1, false, 0, 0.4)).toBeCloseTo(0.4, 12);
    // digging only adds to the share the carts did not take: auto + (1 − auto)·dug
    expect(stepPile(0.5, 0.1, false, 2, 0.4)).toBeCloseTo(0.5 + 0.6 * 2 * PILE_STEP, 12);
    expect(stepPile(0.5, 1, true, 0, 0)).toBeCloseTo(0.5 + PILE_STEP * PILE_HOLD_RATE, 12);
    expect(stepPile(0.99, 1, true, 5, 0)).toBe(1);
  });
});

describe("catchProgress (SC-2 gauge)", () => {
  it("share equals resolveCatch's sc.share for random caught sets", () => {
    for (let seed = 1; seed <= 6; seed++) {
      const s = metroState(seed);
      const d = derive(s);
      const sc = buildTrain(s, d, "metro_train");
      s.scene = sc;
      const ctx: EngineCtx = { fx: [] };
      sceneAction(s, d, { a: "ready" }, ctx);
      const rng = { rng: seed * 7919 };
      const items = sc.items.filter((it) => !it.spark);
      const caught = new Set(items.filter(() => rand(rng) < 0.6).map((it) => it.id));
      const lost = new Set(items.filter((it) => !caught.has(it.id) && rand(rng) < 0.5).map((it) => it.id));
      const live = catchProgress(structuredClone(sc) as Scene, caught, lost);
      const result: CatchResult = { caught: [...caught].map((id) => ({ id, combo: 0, lantern: false })), netted: [], sparksHit: 0, hook: "none", maxCombo: 0 };
      sceneAction(s, d, { a: "catch", result }, ctx);
      expect(Math.abs(live.share - sc.share)).toBeLessThan(1e-9);
      expect(live.maxReachable).toBeGreaterThanOrEqual(live.share - 1e-12);
      const w = (ids: Set<number>) => items.filter((it) => ids.has(it.id)).reduce((a, it) => a + it.weight, 0);
      const total = items.reduce((a, it) => a + it.weight, 0);
      expect(live.maxReachable).toBeCloseTo(1 - w(lost) / total, 9);
      expect(live.tier).toBe(sc.haul!.rating === "royal" ? "royal" : sc.haul!.rating);
    }
  });

  it("lantern catches use LANTERN_MULT", () => {
    expect(LANTERN_MULT).toBe(2.5);
    const s = metroState(3);
    const d = derive(s);
    const sc = buildTrain(s, d, "metro_train");
    sc.lantern = true;
    sc.multiplier = 1;
    s.scene = sc;
    const ctx: EngineCtx = { fx: [] };
    sceneAction(s, d, { a: "ready" }, ctx);
    const it = sc.items.find((x) => !x.spark && x.res === "coal")!;
    const before = s.res.coal;
    const result: CatchResult = { caught: [{ id: it.id, combo: 0, lantern: true }], netted: [], sparksHit: 0, hook: "none", maxCombo: 0 };
    sceneAction(s, d, { a: "catch", result }, ctx);
    expect(s.res.coal - before).toBeCloseTo(it.value * LANTERN_MULT, 6);
  });

  it("POSITION_FEEL, variants and line pools are complete", () => {
    expect(POSITION_FEEL.ties.hitR / POSITION_FEEL.rails.hitR).toBeCloseTo(1.3, 12);
    expect(POSITION_FEEL.wall.sparkKeep).toBe(0.5);
    expect(Object.keys(TRAIN_VARIANTS).sort()).toEqual([...TRAIN_VARIANT_IDS].sort());
    for (const [id, pool] of Object.entries(EVENT_LINE_POOLS)) {
      expect(pool.length).toBeGreaterThan(0);
      expect(pool[0].human).toBe(EVENT_LINES[id as keyof typeof EVENT_LINES].human);
    }
  });
});

describe("purchase legibility (EN-4 helpers)", () => {
  function economy(): GameState {
    const s = createInitialState(5, 0);
    s.flags.vagrants = true;
    s.rats = 30;
    s.jobs.forager = 20;
    s.jobs.pickpocket = 10;
    s.buildings.nest = 15;
    s.buildings.trash_chute = 9;
    s.resEver.crumbs = 1e6;
    s.resEver.coins = 10;
    s.res.crumbs = 1e9;
    s.res.coins = 1e9;
    // full stores award a medal (+1% global) mid-step: settle the medals first
    s.flags.hit_any_cap = true;
    s.flags.hit_crumb_cap = true;
    s.meta.achievements.first_crumb = 0;
    s.meta.achievements.full_storage = 0;
    return s;
  }

  it("levelGain(…,1) equals the measured change of gross production across a milestone", () => {
    const s = economy();
    const ctx: EngineCtx = { fx: [] };
    step(s, TICK, { active: false }, ctx);
    const d = derive(s);
    const gain = levelGain(s, d, "trash_chute", 1);
    const before = { ...s.gross };
    expect(grossRates(s, d).crumbs).toBeCloseTo(before.crumbs, 9);
    expect(buyBuilding(s, d, "trash_chute", 1, ctx)).toBe(1);
    step(s, TICK, { active: false }, ctx);
    expect(gain.crumbs!).toBeCloseTo(s.gross.crumbs - before.crumbs, 9);
    // level 10 doubles the chute: 9 × 0.6 → 10 × 0.6 × 2 (EN-13: +0.6 🍞/с per level)
    expect(gain.crumbs!).toBeCloseTo((10 * 0.6 * 2 - 9 * 0.6) * d.tierMult * d.global * d.temp, 9);
  });

  it("paybackSeconds and buildingCostFor", () => {
    const s = economy();
    const d = derive(s);
    expect(buildingCostFor(s, "trash_chute", 3)).toEqual({ crumbs: Math.ceil(25 * Math.pow(1.3, 9) * ((Math.pow(1.3, 3) - 1) / 0.3)) });
    const p = paybackSeconds(s, d, "trash_chute", 1);
    expect(p).toBeGreaterThan(0);
    expect(Number.isFinite(p)).toBe(true);
    expect(paybackSeconds(s, d, "nest", 1)).toBe(Infinity);
  });

  it("milestoneInfo brackets the level", () => {
    expect(milestoneInfo(0)).toEqual({ prev: 0, next: 10, jobBoost: 1.2 });
    expect(milestoneInfo(10)).toEqual({ prev: 10, next: 25, jobBoost: 1.2 });
    expect(milestoneInfo(99)).toEqual({ prev: 50, next: 100, jobBoost: 1.2 });
    expect(milestoneInfo(150)).toEqual({ prev: 100, next: Infinity, jobBoost: 1.2 });
  });

  it("×10 buys exactly 10 levels or nothing", () => {
    const s = createInitialState(1, 0);
    s.resEver.crumbs = 100;
    s.buildings.nest = 0;
    const cost10 = buildingCostFor(s, "nest", 10).crumbs!;
    const cost9 = buildingCostFor(s, "nest", 9).crumbs!;
    s.res.crumbs = cost9; // 9 affordable
    const ctx: EngineCtx = { fx: [] };
    expect(buyCount(s, "nest", 10)).toBe(0);
    expect(buyBuilding(s, derive(s), "nest", 10, ctx)).toBe(0);
    expect(s.buildings.nest).toBe(0);
    expect(s.res.crumbs).toBe(cost9);
    expect(buyCount(s, "nest", "max")).toBe(9);
    s.res.crumbs = cost10;
    expect(buyBuilding(s, derive(s), "nest", 10, ctx)).toBe(10);
    expect(s.buildings.nest).toBe(10);
    // a capped building: ×10 takes the levels that are left
    const m = metroState();
    openZone(m, "terminal", ctx);
    m.buildings.express_depot = 1;
    m.res.brass = m.res.rails = m.res.trinkets = 1e9;
    expect(buyCount(m, "express_depot", 10)).toBe(2);
  });
});

describe("crowns (EN-1 helpers)", () => {
  it("crownThreshold is continuous at 100 crowns and monotonic", () => {
    expect(crownThreshold(100)).toBeCloseTo(1e8, 0);
    expect(crownThreshold(100 + 1e-9)).toBeCloseTo(1e8, 0);
    let prev = 0;
    for (let c = 1; c <= 300; c++) {
      const e = crownThreshold(c);
      expect(e).toBeGreaterThan(prev);
      prev = e;
    }
    expect(crownThreshold(20)).toBeCloseTo(4e6, 3);
  });

  it("prevCrownAt ≤ eRun < nextCrownAt and matches crownThreshold below the soft cap", () => {
    const s = createInitialState(1, 0);
    s.zones.metro = true;
    for (const e of [1.2e6, 4e6, 9.99e6, 5e7]) {
      s.eRun = e;
      const k = crownsForRun(s);
      expect(prevCrownAt(s)).toBeLessThanOrEqual(e);
      expect(nextCrownAt(s)).toBeGreaterThan(e);
      expect(prevCrownAt(s)).toBeCloseTo(crownThreshold(k), 3);
      expect(nextCrownAt(s)).toBeCloseTo(crownThreshold(k + 1), 3);
    }
  });
});

describe("ceremonies (EN-3 helpers)", () => {
  it("the coronation line agrees the weekday and varies from the 2nd coronation", () => {
    const s = createInitialState(1, 0);
    s.meta.migrations = 1;
    s.meta.coronations = 1;
    const first = coronationLine(s);
    expect(first.human).toContain("одна среда");
    expect(first.rat).toBe("Для крыс — целая история.");
    s.meta.coronations = 2;
    const second = coronationLine(s);
    expect(second.human + second.rat).not.toBe(first.human + first.rat);
    expect(second.rat).toContain("вторая коронация");
    s.meta.migrations = 0;
    s.meta.coronations = 1;
    expect(coronationLine(s).human).toContain("один вторник");
    s.meta.migrations = 5;
    expect(coronationLine(s).human).toContain("одно воскресенье");
    expect(weekdayAt(0, 1)).toBe("среда");
  });

  it("the express coronation counts meta.coronations", () => {
    const s = metroState();
    const ctx: EngineCtx = { fx: [] };
    openZone(s, "terminal", ctx);
    s.upgrades.express_plan = true;
    s.express.stage = 9;
    s.res.rails = s.res.gears = s.res.brass = s.res.trinkets = s.res.blueprints = 1e12;
    contributeExpress(s, null, ctx);
    expect(s.express.stage).toBe(10);
    expect(s.meta.coronations).toBe(1);
    expect(ctx.fx.some((f) => f.k === "coronation")).toBe(true);
  });

  it("migrate() emits exactly one migration fx; the preview's edicts are what can be signed after it", () => {
    const s = metroState();
    s.eRun = 4.2e6;
    s.meta.crowns = 5;
    s.stats.trains = 7;
    const preview = migrationPreview(s);
    expect(preview.gained).toBe(crownsForRun(s));
    expect(preview.bonusAfter - preview.bonusBefore).toBeCloseTo(preview.gained * 2, 9);
    expect(preview.nextDistrict).toBe("Саутварк");
    expect(preview.nextTrait.name).toBe("Боро-маркет");
    expect(preview.weekday).toBe("среда");
    const ctx: EngineCtx = { fx: [] };
    const next = migrate(s, 0, ctx)!;
    const fx = ctx.fx.filter((f): f is Extract<Fx, { k: "migration" }> => f.k === "migration");
    expect(fx).toHaveLength(1);
    expect(fx[0]).toMatchObject({ crowns: preview.gained, district: 1, weekday: "среда", summary: { eRun: 4.2e6, trains: 7, rats: 200 } });
    for (const id of preview.affordable) expect(buyEdict(next, id, ctx)).toBe(true);
    const cheapestLeft = EDICT_ORDER.filter((id) => !next.meta.edicts[id]).reduce((a, id) => Math.min(a, EDICTS[id].cost), Infinity);
    expect(next.meta.crowns).toBeLessThan(cheapestLeft);
  });
});

describe("meta depth (EN-9 surface)", () => {
  it("an old save with a signed edict reads as rank 1; rank II costs 3× and needs a coronation", () => {
    const old = createInitialState(1, 0);
    old.meta.edicts.royal_litter = true;
    const raw = JSON.parse(serialize(old)) as Record<string, unknown>;
    delete (raw.meta as Record<string, unknown>).edictRank;
    const s = migrateSave(raw);
    expect(edictRank(s, "royal_litter")).toBe(1);
    expect(edictRank(s, "lucky_tail")).toBe(0);
    const ctx: EngineCtx = { fx: [] };
    s.meta.crowns = 100;
    expect(buyEdictRank(s, "royal_litter", ctx)).toBe(false); // no coronation yet
    s.meta.achievements.coronation = 1;
    expect(buyEdictRank(s, "royal_litter", ctx)).toBe(true);
    expect(s.meta.crowns).toBe(91);
    expect(edictRank(s, "royal_litter")).toBe(2);
    expect(buyEdictRank(s, "royal_litter", ctx)).toBe(true);
    expect(s.meta.crowns).toBe(61);
    expect(edictRank(s, "royal_litter")).toBe(3);
    expect(buyEdictRank(s, "royal_litter", ctx)).toBe(false); // max rank
    expect(buyEdictRank(s, "kings_favor", ctx)).toBe(false); // unranked
  });

  it("every edict has a decree; ranks cost 3× and 10× the base", () => {
    for (const id of EDICT_ORDER) {
      const e = EDICTS[id];
      expect(e.decree.length).toBeGreaterThan(10);
      if (e.ranks) expect(e.ranks.map((r) => r.cost)).toEqual([3 * e.cost, 10 * e.cost]);
    }
    expect(EDICTS.kings_favor.ranks).toBeUndefined();
  });

  it("one seal is active; setSeal swaps only in the first minute", () => {
    const s = createInitialState(1, 0);
    const ctx: EngineCtx = { fx: [] };
    s.meta.crowns = 300;
    expect(buySeal(s, "railway", ctx)).toBe(true);
    expect(buySeal(s, "silence", ctx)).toBe(true);
    expect(s.meta.crowns).toBe(300 - 2 * SEALS.railway.cost);
    expect(s.meta.seal).toBe("silence");
    expect(s.meta.sealsOwned).toEqual(["railway", "silence"]);
    expect(buySeal(s, "dynasty", ctx)).toBe(false); // 60 👑 left
    s.time = 30;
    expect(setSeal(s, "railway", ctx)).toBe(true);
    expect(s.meta.seal).toBe("railway");
    s.time = 60;
    expect(setSeal(s, "silence", ctx)).toBe(false);
    expect(s.meta.seal).toBe("railway");
  });

  it("district traits (v3 ENG-11): every district keeps its own; the second lap of London is «II» and ×1.25", () => {
    expect(districtTrait(0).name).toBe("Туман");
    expect(districtTrait(1).mods.marketInterval).toEqual([240, 300]);
    expect(districtTrait(1).mods.satietyMult).toBe(1.5);
    expect(districtTrait(1).mods.res?.blueprints).toBe(0.75);
    // the legacy route goes on into the six v3 districts (v2: «Боро-маркет II» at index 6)
    expect(districtTrait(6).name).toBe("Банки");
    const again = districtTrait(13);
    expect(again.name).toBe("Боро-маркет II");
    expect(again.mods.satietyMult).toBeCloseTo(1.625, 12);
    expect(again.mods.res?.blueprints).toBeCloseTo(0.6875, 12);
    expect(districtTrait(17).name).toBe("Биг-Бен II");
    expect(districtTrait(17).mods.vigilanceFrom).toBe(25);
    expect(districtLoc(1)).toBe("в Саутварке");
    expect(districtLoc(9)).toBe("в Челси");
    expect(districtLoc(13)).toBe("в Саутварке II");
  });
});

describe("progress (EN-11/12 surface)", () => {
  it("achievementProgress counts lifetime clicks", () => {
    const s = createInitialState(1, 0);
    const d = derive(s);
    const ctx: EngineCtx = { fx: [] };
    for (let i = 0; i < 640; i++) {
      s.clickWindow = [];
      click(s, d, ctx);
    }
    expect(achievementProgress(s, "click_1000")).toEqual({ cur: 640, goal: 1000 });
    expect(achievementProgress(s, "first_crumb")).toBeNull();
    s.meta.achievements.click_1000 = 1;
    expect(achievementProgress(s, "click_1000")).toEqual({ cur: 1000, goal: 1000 });
  });

  it("an accepted commission measures from acceptance", () => {
    const s = createInitialState(1, 0);
    const ctx: EngineCtx = { fx: [] };
    s.stats.catsBeaten = 4;
    expect(acceptCommission(s, "whiskers_twice", ctx)).toBe(false); // nothing offered yet
    s.commissions = { offered: ["whiskers_twice", "bullseye", "wagon"], done: 0 };
    expect(acceptCommission(s, "three_gold", ctx)).toBe(false); // not offered
    expect(acceptCommission(s, "whiskers_twice", ctx)).toBe(true);
    expect(ctx.fx.some((f) => f.k === "commission" && f.id === "whiskers_twice" && !f.done)).toBe(true);
    expect(commissionProgress(s)).toEqual({ id: "whiskers_twice", cur: 0, goal: 2 });
    s.stats.catsBeaten++;
    expect(commissionProgress(s)).toEqual({ id: "whiskers_twice", cur: 1, goal: 2 });
    expect(acceptCommission(s, "bullseye", ctx)).toBe(false); // one at a time
    expect(COMMISSION_ORDER).toHaveLength(13); // v3 (ENG-3): + clean_three (replenish stays for old saves)
    expect(Object.values(COMMISSIONS).every((c) => c.goal > 0)).toBe(true);
  });
});

describe("onboarding and counters", () => {
  it("a fresh colony after 1 click has no medal tab yet; it opens with the buildings tab", () => {
    const s = createInitialState(1, 0);
    const ctx: EngineCtx = { fx: [] };
    click(s, derive(s), ctx);
    for (let i = 0; i < 12; i++) step(s, TICK, { active: true }, ctx);
    expect(s.meta.achievements.first_crumb).toBeDefined();
    expect(s.revealed.tab_medals).toBeFalsy();
    s.res.crumbs = 10;
    s.resEver.crumbs = 10;
    for (let i = 0; i < 12; i++) step(s, TICK, { active: true }, ctx);
    expect(s.revealed.tab_buildings).toBe(true);
    expect(s.revealed.tab_medals).toBe(true);
  });

  it("express stage lines run parallel to the stages", () => {
    expect(EXPRESS_STAGE_LINES).toHaveLength(EXPRESS_STAGES.length);
    expect(EXPRESS_STAGE_LINES[0].human).toBe("Миссис Пибоди опять не может найти спицы");
    expect(EXPRESS_STAGE_LINES.every((l) => l.human.length > 0 && l.rat.length > 0)).toBe(true);
  });

  it("frenzies and won downpours are counted", () => {
    const s = createInitialState(1, 0);
    const ctx: EngineCtx = { fx: [] };
    s.upgrades.bustle = true;
    s.bustle.value = 100;
    s.bustle.lastClickAt = 0;
    step(s, TICK, { active: true }, ctx);
    expect(s.stats.frenzies).toBe(1);
    const m = metroState();
    m.timers.carriage = Infinity;
    m.timers.metro_train = Infinity;
    m.timers.downpour = m.time;
    m.timers.lastSceneEnd = -999;
    m.timers.catForcedAt = Infinity;
    m.timers.cat = Infinity;
    step(m, TICK, { active: true }, ctx);
    expect(m.scene?.id).toBe("downpour");
    sceneAction(m, derive(m), { a: "taps", cleared: 3, fastMs: 3000 }, ctx);
    expect(m.stats.downpoursWon).toBe(1);
  });
});
