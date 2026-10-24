import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EVENT_LINE_POOLS, EVENT_TIMING, TRAIN_VARIANTS } from "../data/events";
import { HEADLINES, pickHumanHeadline } from "../data/headlines";
import { EDICTS, EDICT_ORDER } from "../data/meta";
import { UPGRADES, UPGRADE_ORDER } from "../data/upgrades";
import type { CatchResult, EngineCtx, Fx, GameState, HaulSummary, Scene } from "../types";
import { acceptCommission, buyEdictRank, contributeExpress, migrate, openZone } from "./actions";
import { checkCommission, offerCommissions } from "./commissions";
import { award } from "./core";
import { derive } from "./derive";
import { buildTrain, floodedTracks, onZoneOpen, sceneAction } from "./events";
import { crownsForRun, humanClock } from "./formulas";
import { simulateOffline } from "./offline";
import { PILE_HOLD_RATE, PILE_STEP, pileLockTime, stepPile } from "./piles";
import { commissionProgress } from "./progress";
import { migrate as migrateSave, serialize } from "./save";
import { createInitialState, newRun } from "./state";
import { step, TICK } from "./step";

/** A colony on the metro station (zones opened through the real hooks), past its ×3 first train. */
function metroState(seed = 99): GameState {
  const s = createInitialState(seed, 0);
  const ctx: EngineCtx = { fx: [] };
  for (const z of ["sewers", "cellars", "metro"] as const) {
    openZone(s, z, ctx);
    onZoneOpen(s, z);
  }
  s.flags.vagrants = true;
  s.flags.first_train = true;
  s.rats = 200;
  s.jobs.forager = 200;
  s.res.crumbs = 1e5;
  return s;
}

/** A plain metro train (no EN-6 variant, no Cheddar car), not yet started. */
function plainTrain(s: GameState): Scene {
  const d = derive(s);
  let sc = buildTrain(s, d, "metro_train");
  while ((sc.variant ?? "normal") !== "normal" || sc.announce) sc = buildTrain(s, d, "metro_train");
  sc.position = "rails";
  sc.lantern = false;
  sc.hookCar = -1;
  return sc;
}

const value = (sc: Scene) => sc.items.reduce((a, it) => a + (it.spark || it.skip ? 0 : it.value * (it.res === "coins" ? 1 : 0)), 0);

/**
 * Optimal pile play with the lineman: always hold the pile that locks next (one paw), from phase start until each lock.
 * Returns the recovered fraction per pile.
 */
function optimalPiles(n: number, auto: number, dur: number): number[] {
  const frac = Array.from({ length: n }, () => auto);
  const dt = 0.01;
  for (let t = 0; t < dur; t += dt) {
    const i = frac.findIndex((f, k) => t < pileLockTime(k, n, dur) && f < 1);
    if (i < 0) break;
    frac[i] = stepPile(frac[i], dt, true, 0, auto);
  }
  return frac;
}

/* ================================================================ EN-5 */

describe("train scene engine (EN-5)", () => {
  it("6 piles at auto 0.6 in a 12 s phase: optimal holding recovers at most 0.85 of the piles", () => {
    expect(EVENT_TIMING.metroPiles).toBe(12);
    expect(PILE_STEP * PILE_HOLD_RATE).toBeCloseTo(0.3, 12);
    const f = optimalPiles(6, 0.6, 12);
    const mean = f.reduce((a, x) => a + x, 0) / f.length;
    expect(mean).toBeLessThanOrEqual(0.85);
    expect(mean).toBeGreaterThan(0.6);
  });

  it("a 4-car train: catch 0% + perfect piles ≤ 0.85 V; 90% caught at gold ≥ 1.4 V; untouched = auto × V", () => {
    // coins only, so the value is simply the coins gained
    const prep = (seed: number) => {
      const s = metroState(seed);
      const sc = plainTrain(s);
      for (const it of sc.items) if (!it.spark) it.res = "coins";
      sc.cars = sc.cars.slice(0, 4);
      const keep = new Set(sc.cars.flatMap((c) => c.itemIds));
      sc.items = sc.items.filter((it) => keep.has(it.id));
      sc.piles = sc.piles.slice(0, 4);
      sc.pileFractions = sc.pileFractions.slice(0, 4);
      s.scene = sc;
      return { s, sc, d: derive(s), V: value(sc), ctx: { fx: [] } as EngineCtx };
    };
    // 1) nothing caught, perfect piles
    {
      const { s, sc, d, V, ctx } = prep(5);
      sceneAction(s, d, { a: "ready" }, ctx);
      const before = s.res.coins;
      sceneAction(s, d, { a: "catch", result: { caught: [], netted: [], sparksHit: 0, hook: "none", maxCombo: 0 } }, ctx);
      const fr = optimalPiles(sc.piles.length, sc.auto, EVENT_TIMING.metroPiles);
      sceneAction(s, d, { a: "piles", fractions: fr }, ctx);
      expect(s.res.coins - before).toBeLessThanOrEqual(0.85 * V);
    }
    // 2) 90% of the weight caught by hand, combo growing as it would
    {
      const { s, sc, d, V, ctx } = prep(6);
      sceneAction(s, d, { a: "ready" }, ctx);
      const items = sc.items.filter((it) => !it.spark).sort((a, b) => a.t - b.t);
      const total = items.reduce((a, it) => a + it.weight, 0);
      const caught: CatchResult["caught"] = [];
      let w = 0;
      for (const it of items) {
        if (w >= 0.9 * total) break;
        caught.push({ id: it.id, combo: caught.length, lantern: false });
        w += it.weight;
      }
      const before = s.res.coins;
      sceneAction(s, d, { a: "catch", result: { caught, netted: [], sparksHit: 0, hook: "none", maxCombo: caught.length } }, ctx);
      expect(["gold", "royal"]).toContain(sc.haul?.rating);
      sceneAction(s, d, { a: "piles", fractions: sc.piles.map(() => 0) }, ctx);
      expect(s.res.coins - before).toBeGreaterThanOrEqual(1.4 * V);
    }
    // 3) nobody at the controls
    {
      const { s, sc, d, V, ctx } = prep(7);
      sceneAction(s, d, { a: "skip" }, ctx);
      expect(sc.gained.coins ?? 0).toBeCloseTo(sc.auto * V, 6);
    }
  });

  it("haul.suspicion.total equals the real suspicion change from the catch phase on", () => {
    const s = metroState(8);
    s.suspicion = 20;
    const d = derive(s);
    const sc = plainTrain(s);
    sc.lantern = true;
    s.scene = sc;
    const ctx: EngineCtx = { fx: [] };
    sceneAction(s, d, { a: "ready" }, ctx);
    const start = s.suspicion;
    const items = sc.items.filter((it) => !it.spark).slice(0, 6);
    const result: CatchResult = { caught: items.map((it, i) => ({ id: it.id, combo: i, lantern: i < 4 })), netted: [], sparksHit: 0, hook: "none", maxCombo: 6 };
    sceneAction(s, d, { a: "catch", result }, ctx);
    sceneAction(s, d, { a: "piles", fractions: sc.piles.map(() => 0) }, ctx);
    const h = sc.haul!;
    expect(h.suspicionParts?.total).toBeCloseTo(s.suspicion - start, 9);
    expect(h.suspicion).toBeCloseTo(s.suspicion - start, 9);
    expect(h.suspicionParts?.lantern).toBeCloseTo(4 * 5 * d.suspicionMult, 9);
    expect((h.suspicionParts?.pass ?? 0) + (h.suspicionParts?.lantern ?? 0)).toBeCloseTo(h.suspicionParts?.total ?? 0, 9);
  });

  it("'ties' gives items +0.4 s of life; 'wall' marks half the sparks absent (stable per item)", () => {
    const s = metroState(9);
    const d = derive(s);
    const ctx: EngineCtx = { fx: [] };
    const a = plainTrain(s);
    const life = a.itemLife;
    a.position = "ties";
    s.scene = a;
    sceneAction(s, d, { a: "ready" }, ctx);
    expect(a.itemLife).toBeCloseTo(life + 0.4, 12);
    s.scene = null;
    let sparks = 0;
    let skipped = 0;
    for (let i = 0; i < 40; i++) {
      const b = plainTrain(s);
      b.position = "wall";
      s.scene = b;
      sceneAction(s, d, { a: "ready" }, ctx);
      expect(b.itemLife).toBeCloseTo(life, 12);
      for (const it of b.items) {
        if (!it.spark) {
          expect(it.skip).toBeFalsy();
          continue;
        }
        sparks++;
        if (it.skip) skipped++;
      }
      s.scene = null;
    }
    expect(skipped / sparks).toBeGreaterThan(0.3);
    expect(skipped / sparks).toBeLessThan(0.7);
  });
});

/* ================================================================ EN-6 */

/** Start the next metro train through the real scheduler, return its scene, then skip it. */
function nextMetro(s: GameState, ctx: EngineCtx): Scene {
  s.timers.metro_train = s.time;
  s.timers.lastSceneEnd = -999;
  step(s, TICK, { active: false }, ctx);
  const sc = s.scene!;
  expect(sc.id).toBe("metro_train");
  const d = derive(s);
  sceneAction(s, d, { a: "skip" }, ctx);
  sceneAction(s, d, { a: "dismiss" }, ctx);
  return sc;
}

describe("train variety (EN-6)", () => {
  it("rush hour only 08:00–09:30 of the human clock", () => {
    const s = metroState(10);
    const d = derive(s);
    const seen = (time: number) => {
      s.time = time;
      let n = 0;
      for (let i = 0; i < 300; i++) if (buildTrain(s, d, "metro_train").variant === "rush_hour") n++;
      return n;
    };
    expect(seen(0)).toBe(0); // 05:00
    const at0830 = (8.5 * 60 - 5 * 60) * 12; // 1 real s = 5 human s
    s.time = at0830;
    expect(humanClock(s).hh).toBe(8);
    expect(seen(at0830)).toBeGreaterThan(120);
    expect(seen((9.75 * 60 - 5 * 60) * 12)).toBe(0); // 09:45
  });

  it("flooded tracks follow a lost downpour for 300 s, then plain trains again", () => {
    const s = metroState(11);
    const ctx: EngineCtx = { fx: [] };
    s.timers.carriage = Infinity;
    s.timers.metro_train = Infinity;
    s.timers.catForcedAt = Infinity;
    s.timers.cat = Infinity;
    s.timers.downpour = s.time;
    s.timers.lastSceneEnd = -999;
    s.time = 100;
    step(s, TICK, { active: true }, ctx);
    expect(s.scene?.id).toBe("downpour");
    sceneAction(s, derive(s), { a: "taps", cleared: 0 }, ctx);
    expect(floodedTracks(s)).toBe(true);
    const d = derive(s);
    for (let i = 0; i < 20; i++) expect(buildTrain(s, d, "metro_train").variant).toBe("flooded");
    expect(TRAIN_VARIANTS.flooded.physics).toBe("float");
    s.time += 301;
    expect(floodedTracks(s)).toBe(false);
    for (let i = 0; i < 20; i++) expect(buildTrain(s, d, "metro_train").variant).not.toBe("flooded");
  });

  it("10 consecutive metro trains show ≥ 6 different human lines; {time} is the human clock", () => {
    const s = metroState(12);
    s.timers.carriage = Infinity;
    s.timers.downpour = Infinity;
    s.timers.catForcedAt = Infinity;
    s.timers.cat = Infinity;
    s.timers.ratcatcherAt = Infinity;
    const ctx: EngineCtx = { fx: [] };
    const lines = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const c = humanClock({ ...s, time: s.time + TICK } as GameState);
      const sc = nextMetro(s, ctx);
      expect(sc.line).toBeDefined();
      lines.add(sc.line!.human);
      const m = /(\d\d):(\d\d)/.exec(sc.line!.human);
      if (m) expect(`${m[1]}:${m[2]}`).toBe(`${String(c.hh).padStart(2, "0")}:${String(c.mm).padStart(2, "0")}`);
      expect(sc.line!.human).not.toMatch(/\{(time|dest|n)\}/);
      s.time += 200;
    }
    expect(lines.size).toBeGreaterThanOrEqual(6);
    expect((s.meta.seenLines.metro_train ?? []).length).toBeGreaterThanOrEqual(5);
    for (const pool of Object.values(EVENT_LINE_POOLS)) expect(pool.length).toBeGreaterThanOrEqual(6);
  });

  it("the cheese car is a dining car with special 'cheese' and an announcement", () => {
    const s = metroState(13);
    const d = derive(s);
    let found: Scene | null = null;
    for (let i = 0; i < 2000 && !found; i++) {
      const sc = buildTrain(s, d, "metro_train");
      if (sc.announce) found = sc;
    }
    expect(found).not.toBeNull();
    const car = found!.cars.find((c) => c.special === "cheese")!;
    expect(car.kind).toBe("dining");
    expect(car.itemIds.length).toBe(12);
    expect(car.itemIds.every((id) => found!.items[id].res === "cheese")).toBe(true);
  });

  it("the first Royal Express comes 90 s after the first depot", () => {
    const s = metroState(14);
    const ctx: EngineCtx = { fx: [] };
    openZone(s, "terminal", ctx);
    onZoneOpen(s, "terminal");
    s.buildings.express_depot = 1;
    s.time = 1000;
    step(s, TICK, { active: false }, ctx);
    expect(s.timers.royal_express).toBeCloseTo(1000 + TICK + 90, 6);
  });

  it("pickHumanHeadline maps the six outcomes", () => {
    const items = (cheese: number) => [
      { res: "cheese" as const, value: cheese },
      { res: "coins" as const, value: 100 },
    ];
    const h = (o: Partial<HaulSummary>) => ({ rating: "silver" as const, gained: {}, crash: false, ...o });
    const sc = (lantern: number, cheese = 0) => ({ stats: { lanternCaught: lantern }, items: items(cheese) });
    expect(pickHumanHeadline(h({ rating: "royal" }), sc(5))).toBe("Машинист: поезд будто стал легче");
    expect(pickHumanHeadline(h({ gained: { trinkets: 2 } }), sc(5))).toBe("Пассажир 1-го класса недосчитался часов");
    expect(pickHumanHeadline(h({}), sc(3))).toBe("Кондуктор клянётся, что видел крысу с фонарём");
    expect(pickHumanHeadline(h({ crash: true }), sc(0))).toBe("Задержка на линии: на путях мусор");
    expect(pickHumanHeadline(h({}), sc(0, 10))).toBe("Вагон-ресторан остался без чеддера");
    expect(pickHumanHeadline(h({}), sc(0))).toBe("Обычный рейс, без происшествий");
  });

  it("a saved scene without variant or line loads", () => {
    const s = metroState(15);
    const sc = plainTrain(s);
    delete sc.variant;
    delete sc.line;
    delete sc.lineIdx;
    s.scene = sc;
    const raw = JSON.parse(serialize(s)) as Record<string, unknown>;
    const back = migrateSave(raw);
    expect(back.scene).toBeNull();
    expect(back.recentLines).toEqual({});
  });
});

/* ================================================================ EN-9 */

describe("meta depth (EN-9 effects)", () => {
  it("royal_litter rank II gives 25 rats, 10 nests and 500 🍞 in the next run", () => {
    const s = createInitialState(1, 0);
    s.meta.edicts.royal_litter = true;
    s.meta.achievements.coronation = 1;
    s.meta.crowns = 9;
    expect(buyEdictRank(s, "royal_litter", { fx: [] })).toBe(true);
    const next = newRun(s.meta, s.settings, 2, 0);
    expect(next.rats).toBe(25);
    expect(next.buildings.nest).toBe(10);
    expect(next.res.crumbs).toBe(500);
  });

  it("ranked click, suspicion and train cars; seals", () => {
    const s = metroState(16);
    s.meta.edicts.ancestral_paws = true;
    s.meta.edicts.felt_soles = true;
    s.meta.edicts.timetable_in_head = true;
    const base = derive(s);
    s.meta.edictRank = { ancestral_paws: 3, felt_soles: 3, timetable_in_head: 3 };
    const d = derive(s);
    expect(d.click / base.click).toBeCloseTo(4, 9);
    expect(d.suspicionMult / base.suspicionMult).toBeCloseTo(0.5, 9);
    expect(d.trainExtraCars - base.trainExtraCars).toBe(2);
    s.meta.sealsOwned = ["silence", "railway", "dynasty"];
    s.meta.seal = "silence";
    expect(derive(s).suspicionMult).toBe(0);
    expect(derive(s).click).toBeCloseTo(2 * d.click, 9);
    s.meta.seal = "railway";
    expect(derive(s).trainExtraCars).toBe(d.trainExtraCars + 2);
    expect(derive(s).intervals.express).toBeCloseTo(d.intervals.express * 0.5, 9);
    s.meta.seal = "dynasty";
    s.meta.migrations = 3;
    expect(derive(s).globalParts.find((p) => p.label === "Печать Династии")?.mult).toBeCloseTo(1.3, 9);
  });

  it("district 1: the market comes every 240–300 s and cheese is ×1.5", () => {
    const a = metroState(17);
    const b = metroState(17);
    b.meta.district = 1;
    a.jobs.cheese_thief = 5;
    b.jobs.cheese_thief = 5;
    a.buildings.cheese_tap = 3;
    b.buildings.cheese_tap = 3;
    const ctx: EngineCtx = { fx: [] };
    const ca = a.res.cheese;
    const cb = b.res.cheese;
    for (let i = 0; i < 10; i++) {
      step(a, TICK, { active: false }, ctx);
      step(b, TICK, { active: false }, ctx);
    }
    expect((b.res.cheese - cb) / (a.res.cheese - ca)).toBeCloseTo(1.5, 6);
    for (let i = 0; i < 30; i++) {
      b.market = null;
      b.timers.market = b.time;
      step(b, TICK, { active: false }, ctx);
      const next = b.timers.market - b.time;
      expect(next).toBeGreaterThanOrEqual(240 - 1);
      expect(next).toBeLessThanOrEqual(300);
    }
  });
});

/* ================================================================ EN-10 */

/** Engine source files (not tests). */
function engineSources(): string {
  const dir = join(__dirname);
  return readdirSync(dir)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => readFileSync(join(dir, f), "utf8"))
    .join("\n");
}

describe("living newspaper (EN-10)", () => {
  it("every HEADLINES key is used by a news() call, the scheduler or the run start", () => {
    const src = engineSources();
    for (const key of Object.keys(HEADLINES)) {
      if (key.startsWith("filler")) continue; // the scheduler
      if (key.startsWith("zone_")) {
        expect(src).toContain("`zone_${zone}`");
        continue;
      }
      const used = src.includes(`"${key}"`) || src.includes(`HEADLINES.${key}`);
      expect(used, key).toBe(true);
    }
  });

  it("no hard-coded start or medal lines in the engine", () => {
    const src = engineSources();
    expect(src).not.toContain("Вожак выбрался к решётке");
    expect(src).not.toContain("вручена колонии`");
  });

  it("icons are unique over upgrades and edicts; every edict has a decree", () => {
    const icons = [...UPGRADE_ORDER.map((u) => UPGRADES[u].icon), ...EDICT_ORDER.map((e) => EDICTS[e].icon)];
    expect(new Set(icons).size).toBe(icons.length);
    expect(UPGRADES.grappling_hook.icon).toBe("⚓");
    for (const e of EDICT_ORDER) expect(EDICTS[e].decree.length).toBeGreaterThan(0);
  });

  it("an hour of run 1 has ≥ 15 filler headlines, none repeated within 10 headlines", () => {
    const s = createInitialState(21, 0);
    const ctx: EngineCtx = { fx: [] };
    for (let i = 0; i < 36000; i++) step(s, TICK, { active: true }, ctx);
    const texts = ctx.fx.filter((f): f is Extract<Fx, { k: "news" }> => f.k === "news").map((f) => f.text);
    const fillers = new Set(Object.entries(HEADLINES).filter(([k]) => k.startsWith("filler")).flatMap(([, v]) => v));
    expect(texts.filter((t) => fillers.has(t)).length).toBeGreaterThanOrEqual(15);
    for (let i = 0; i < texts.length; i++) {
      const win = texts.slice(i, i + 10);
      expect(new Set(win).size, win.join(" | ")).toBe(win.length);
    }
  });

  it("no filler while catching up an absence", () => {
    const s = createInitialState(22, 0);
    const ctx: EngineCtx = { fx: [] };
    simulateOffline(s, 3 * 3600, ctx);
    const fillers = new Set(Object.entries(HEADLINES).filter(([k]) => k.startsWith("filler")).flatMap(([, v]) => v));
    expect(s.news.some((n) => fillers.has(n.text))).toBe(false);
  });

  it("gold/royal and every 3rd train make «Поезд №N пройден»", () => {
    const s = metroState(23);
    const d = derive(s);
    const ctx: EngineCtx = { fx: [] };
    for (let k = 1; k <= 6; k++) {
      const sc = plainTrain(s);
      s.scene = sc;
      sceneAction(s, d, { a: "ready" }, ctx);
      const gold = k === 1;
      const items = sc.items.filter((it) => !it.spark);
      const caught = gold ? items : [];
      sceneAction(s, d, { a: "catch", result: { caught: caught.map((it) => ({ id: it.id, combo: 0, lantern: false })), netted: [], sparksHit: 0, hook: "none", maxCombo: 0 } }, ctx);
      sceneAction(s, d, { a: "piles", fractions: sc.piles.map(() => 0) }, ctx);
      const said = s.news.some((n) => n.text.startsWith(`Поезд №${s.stats.trains} пройден`));
      expect(said, `train ${s.stats.trains}`).toBe(gold || s.stats.trains % 3 === 0);
      s.scene = null;
    }
  });
});

/* ================================================================ EN-11 */

describe("medals 2.0 (EN-11)", () => {
  it("counter medals come from housekeeping; awarding is idempotent", () => {
    const s = createInitialState(31, 0);
    const ctx: EngineCtx = { fx: [] };
    s.meta.migrations = 3;
    s.meta.crownsEver = 120;
    s.meta.lifetime.purses = 50;
    s.stats.cleanCars = 10;
    s.meta.lifetime.catsBeaten = 5;
    s.stats.royalExpresses = 3;
    s.express.wagons = 5;
    for (let i = 0; i < 12; i++) step(s, TICK, { active: false }, ctx);
    for (const id of ["nomads", "treasury", "purser", "clean_car_10", "cat_nightmare", "royal_retinue", "long_train"] as const) expect(s.meta.achievements[id], id).toBeDefined();
    expect(s.meta.achievements.thousand_crowns).toBeUndefined();
    const n = ctx.fx.filter((f) => f.k === "medal").length;
    award(s, "nomads", ctx);
    for (let i = 0; i < 12; i++) step(s, TICK, { active: false }, ctx);
    expect(ctx.fx.filter((f) => f.k === "medal").length).toBe(n);
  });

  it("train feats: no_spark, ties_survivor, full_consist; the journal logs cars and variants", () => {
    const s = metroState(32);
    const d = derive(s);
    const ctx: EngineCtx = { fx: [] };
    let sc = plainTrain(s);
    sc.position = "ties";
    s.scene = sc;
    sceneAction(s, d, { a: "ready" }, ctx);
    sc.crash = true;
    const all = sc.items.filter((it) => !it.spark).map((it) => ({ id: it.id, combo: 0, lantern: false }));
    sceneAction(s, d, { a: "catch", result: { caught: all, netted: [], sparksHit: 0, hook: "none", maxCombo: 0 } }, ctx);
    sceneAction(s, d, { a: "piles", fractions: [] }, ctx);
    expect(s.meta.achievements.no_spark).toBeDefined();
    expect(s.meta.achievements.ties_survivor).toBeDefined();
    for (const c of sc.cars) expect(s.meta.carLog[c.kind]).toBe("royal");
    expect(s.meta.variantLog.normal).toBe("royal");
    s.scene = null;
    s.buildings.platform_post = 5;
    s.upgrades.stolen_timetable = true;
    s.meta.edicts.timetable_in_head = true;
    const d2 = derive(s);
    sc = buildTrain(s, d2, "metro_train");
    expect(sc.cars).toHaveLength(11);
    s.scene = sc;
    sceneAction(s, d2, { a: "skip" }, ctx);
    expect(s.meta.achievements.full_consist).toBeDefined();
  });

  it("dry_paws: all valves within 4 s", () => {
    const s = metroState(33);
    const ctx: EngineCtx = { fx: [] };
    s.timers.carriage = Infinity;
    s.timers.metro_train = Infinity;
    s.timers.catForcedAt = Infinity;
    s.timers.cat = Infinity;
    s.timers.downpour = s.time;
    s.timers.lastSceneEnd = -999;
    step(s, TICK, { active: true }, ctx);
    sceneAction(s, derive(s), { a: "taps", cleared: 3, fastMs: 5000 }, ctx);
    expect(s.meta.achievements.dry_paws).toBeUndefined();
    s.scene = null;
    s.timers.downpour = s.time;
    s.timers.lastSceneEnd = -999;
    step(s, TICK, { active: true }, ctx);
    sceneAction(s, derive(s), { a: "taps", cleared: 3, fastMs: 3500 }, ctx);
    expect(s.meta.achievements.dry_paws).toBeDefined();
  });

  it("coronation secrets and the second throne; miser on migration", () => {
    const s = metroState(34);
    s.hungry = true;
    s.upgrades.express_plan = true;
    s.express.stage = 9;
    s.time = 3000;
    const ctx: EngineCtx = { fx: [] };
    // finish stage 10 by hand
    for (const r of ["rails", "gears", "brass", "trinkets", "blueprints"] as const) s.res[r] = 1e12;
    s.meta.coronations = 1;
    contributeExpress(s, null, ctx);
    expect(s.coronatedThisRun).toBe(true);
    expect(s.meta.achievements.hungry_king).toBeDefined();
    expect(s.meta.achievements.forever_tuesday).toBeDefined();
    expect(s.meta.achievements.before_noon).toBeDefined(); // 3000 s < 1 h: before 10:00
    expect(s.commissions?.offered).toHaveLength(3);
    for (let i = 0; i < 12; i++) step(s, TICK, { active: false }, ctx);
    expect(s.meta.achievements.again_throne).toBeDefined();
    s.eRun = 1e9;
    s.meta.crowns = 250;
    const next = migrate(s, 0, ctx)!;
    expect(next.meta.achievements.miser).toBeDefined();
    expect(next.meta.history).toHaveLength(1);
    const h = next.meta.history[0];
    expect(h.seconds).toBeCloseTo(s.time, 6);
    expect(h.coronationAt).toBeCloseTo(3000, 6);
    expect(h.crowns).toBe(crownsForRun(s));
    expect(h.zones.metro).toBeDefined();
  });

  it("old saves load with an empty journal, chronicle and records", () => {
    const old = createInitialState(35, 0);
    const raw = JSON.parse(serialize(old)) as Record<string, Record<string, unknown>>;
    delete raw.meta.carLog;
    delete raw.meta.history;
    delete raw.meta.records;
    const s = migrateSave(raw);
    expect(s.meta.carLog).toEqual({});
    expect(s.meta.history).toEqual([]);
    expect(s.meta.records).toEqual({});
  });

  it("run 2 opening the Cellars faster than run 1 gives exactly one record fx", () => {
    const s = createInitialState(36, 0);
    const ctx: EngineCtx = { fx: [] };
    s.time = 1500;
    openZone(s, "sewers", ctx);
    s.time = 1700;
    openZone(s, "cellars", ctx);
    expect(ctx.fx.filter((f) => f.k === "record")).toHaveLength(0);
    expect(s.meta.records.cellars).toBe(1700);
    const r2 = newRun(s.meta, s.settings, 2, 0);
    const ctx2: EngineCtx = { fx: [] };
    r2.time = 1600;
    openZone(r2, "sewers", ctx2); // slower: no record
    r2.time = 1200;
    openZone(r2, "cellars", ctx2);
    const rec = ctx2.fx.filter((f): f is Extract<Fx, { k: "record" }> => f.k === "record");
    expect(rec).toHaveLength(1);
    expect(rec[0]).toMatchObject({ what: "cellars", time: 1200, prev: 1700 });
    expect(r2.news.some((n) => n.text === "РЕКОРД КОЛОНИИ: Подвалы за 20:00 (было 28:20)")).toBe(true);
  });
});

/* ================================================================ EN-12 */

describe("royal commissions (EN-12)", () => {
  it("charters multiply the crowns: ×1.157625 for 3, at most ×1.5", () => {
    const s = metroState(41);
    s.eRun = 4e7; // 10·√40 = 63.2 crowns
    const raw = 10 * Math.sqrt(40);
    expect(crownsForRun(s)).toBe(Math.floor(raw));
    s.charters = 3;
    expect(crownsForRun(s)).toBe(Math.floor(raw * 1.157625));
    s.charters = 10;
    expect(crownsForRun(s)).toBe(Math.floor(raw * 1.5));
  });

  it("a finished commission pays a charter and offers three new ones; charters reset on migration", () => {
    const s = metroState(42);
    const ctx: EngineCtx = { fx: [] };
    offerCommissions(s);
    s.commissions!.offered = ["whiskers_twice", "bullseye", "wagon"];
    expect(acceptCommission(s, "whiskers_twice", ctx)).toBe(true);
    s.stats.catsBeaten++;
    expect(commissionProgress(s)).toEqual({ id: "whiskers_twice", cur: 1, goal: 2 });
    checkCommission(s, ctx);
    expect(s.charters).toBe(0);
    s.stats.catsBeaten++;
    checkCommission(s, ctx);
    expect(s.charters).toBe(1);
    expect(s.commissions?.done).toBe(1);
    expect(s.commissions?.active).toBeUndefined();
    expect(s.commissions?.offered).toHaveLength(3);
    expect(s.commissions?.offered).not.toContain("whiskers_twice");
    expect(ctx.fx.some((f) => f.k === "commission" && f.done)).toBe(true);
    s.eRun = 1e8;
    const next = migrate(s, 0, ctx)!;
    expect(next.charters).toBe(0);
    expect(next.commissions).toBeNull();
  });
});
