import { afterEach, describe, expect, it } from "vitest";
import { EVENT_LINE_POOLS, EVENT_TIMING as T, TRAIN_CARS, TRAIN_VARIANT_ORDER } from "../data/events";
import { RESOURCES } from "../data/resources";
import { onFx } from "../fx";
import { isHeld, useGame } from "../store";
import type { Amounts, EngineCtx, Fx, GameState, ResId, Scene, TrainCarKind, TrainVariantId } from "../types";
import { openZone } from "./actions";
import { cloneState } from "./clone";
import { derive, eventValue } from "./derive";
import {
  addSuspicion,
  buildTrain,
  CAT_COUNTER_HITS,
  CAT_COUNTER_WINDOW,
  CAT_FIGHT_TAIL,
  catFightSec,
  catHits,
  catLungeAt,
  clickShiny,
  fogActive,
  fogGap,
  metroTeaser,
  onZoneOpen,
  pickVariant,
  rushHour,
  sceneAction,
  tickEvents,
} from "./events";
import { entries } from "./formulas";
import { creditHold, holdCredit } from "./hold";
import { createInitialState } from "./state";
import { step, TICK } from "./step";
import { metroState, ticks } from "./testkit";

/** v3 ENG-5 (trains are never lost) and ENG-9 (events) acceptance. */

const toasts = (fx: Fx[]) => fx.filter((f): f is Extract<Fx, { k: "toast" }> => f.k === "toast");

/** Market value of an amount (📜💍💨 count 0). */
function worth(a: Amounts): number {
  let v = 0;
  for (const [r, x] of entries(a)) v += x * (RESOURCES[r].market ?? 0);
  return v;
}

/** Market value of a scene's items (sparks have none). */
function itemsWorth(sc: Scene): number {
  let v = 0;
  for (const it of sc.items) if (!it.spark) v += it.value * (RESOURCES[it.res].market ?? 0);
  return v;
}

/**
 * A colony before the Metro (Sewers and Cellars open, every T1 resource revealed, incomes of a ~25 min colony) with
 * every other event parked: a carriage or capsule build here is all the RNG and the scene sees.
 */
function cellarsState(seed = 11): GameState {
  const s = createInitialState(seed, 0);
  const ctx: EngineCtx = { fx: [] };
  for (const z of ["sewers", "cellars"] as const) {
    openZone(s, z, ctx);
    onZoneOpen(s, z);
  }
  s.flags.vagrants = true;
  s.flags.first_carriage = true;
  s.flags.first_capsule = true;
  s.flags.first_rumble = true;
  s.rats = 60;
  s.jobs.forager = 60;
  s.res.crumbs = 1e5;
  for (const r of ["buttons", "wire", "gears"] as const) s.resEver[r] = 10;
  Object.assign(s.ema, { crumbs: 40, coins: 6, buttons: 2.5, wire: 2, gears: 0.6, cheese: 0.8, blueprints: 0.1 });
  for (const k of ["carriage", "capsule", "purse", "shiny", "market", "downpour", "cat", "catForcedAt"] as const) s.timers[k] = Infinity;
  return s;
}

/** Start `id` on this very tick without running the economy (tickEvents only): the colony's incomes stay put. */
function startNow(s: GameState, id: "carriage" | "capsule"): Scene {
  s.scene = null;
  s.timers[id] = s.time;
  s.timers.lastSceneEnd = -999;
  tickEvents(s, derive(s), TICK, { active: false }, { fx: [] });
  const sc = s.scene as Scene | null;
  expect(sc?.id).toBe(id);
  return sc!;
}

/** Make line `i` of the pool the only one the bestiary has not seen (pickLine takes it). */
function forceLine(s: GameState, id: "carriage" | "capsule", i: number): void {
  s.meta.seenLines[id] = EVENT_LINE_POOLS[id].map((_, k) => k).filter((k) => k !== i);
  s.recentLines[id] = [];
}

/* ================================================================ ENG-5 */

describe("ENG-5: trains are never lost", () => {
  afterEach(() => {
    useGame.setState({ ceremony: false, crashed: false, saveIssue: null });
  });

  /** A metro train in its catch phase with a scene UI attached, in the real store. */
  function storeWithCatch(): GameState {
    const s = metroState(31, { quiet: true });
    s.timers.metro_train = s.time;
    step(s, TICK, { active: false }, { fx: [] });
    expect(s.scene?.id).toBe("metro_train");
    const ctx: EngineCtx = { fx: [] };
    sceneAction(s, derive(s), { a: "attach" }, ctx);
    sceneAction(s, derive(s), { a: "ready" }, ctx);
    expect(s.scene?.phase).toBe("catch");
    useGame.setState({ game: s, ready: true, ceremony: false, crashed: false, saveIssue: null });
    return s;
  }

  it("(a) a 20 s alt-tab mid-catch with the scene UI attached is a pause: time and phase stand still", () => {
    const s = storeWithCatch();
    expect(holdCredit({ away: 20, ceremony: false, scene: s.scene })).toBe("pause");
    const t = useGame.getState().game.time;
    expect(creditHold(useGame.getState(), 20, false, true)).toBe("pause");
    expect(creditHold(useGame.getState(), 20, false)).toBe("pause"); // judged by the scene itself
    expect(useGame.getState().game.time).toBe(t);
    expect(useGame.getState().game.scene?.phase).toBe("catch");
    // the same hold with nobody driving the scene is credited as ticks
    useGame.getState().scene({ a: "detach" });
    expect(creditHold(useGame.getState(), 20, false)).toBe("ticks");
    expect(useGame.getState().game.time).toBeCloseTo(t + 20, 6);
    // and a long absence is a catch-up
    let caught = 0;
    expect(creditHold({ game: { scene: null }, creditShortHold: () => {}, catchUp: (sec) => (caught = sec) }, 61, false)).toBe("catchUp");
    expect(caught).toBe(61);
  });

  it("(b) creditShortHold(40) with the metro due in 10 s: no train in the credit, it waits 15–25 s behind «К путям!»", () => {
    const s = metroState(32, { quiet: true });
    s.timers.metro_train = s.time + 10;
    useGame.setState({ game: s, ready: true, ceremony: false, crashed: false, saveIssue: null });
    const trains = s.stats.trains;
    const got: Fx[] = [];
    const off = onFx((f) => got.push(f));
    try {
      useGame.getState().creditShortHold(40);
      const g = useGame.getState().game;
      expect(g.stats.trains).toBe(trains);
      expect(g.scene).toBeNull();
      expect(g.time).toBeCloseTo(40, 6);
      const left = g.timers.metro_train - g.time;
      expect(left).toBeGreaterThanOrEqual(15 - 1e-9);
      expect(left).toBeLessThanOrEqual(25 + 1e-9);
      expect(got.some((f) => f.k === "trainSoon")).toBe(false);
      for (let i = 0; i < 10; i++) useGame.getState().advance(1, false);
      const soon = got.find((f): f is Extract<Fx, { k: "trainSoon" }> => f.k === "trainSoon");
      expect(soon?.id).toBe("metro_train");
      expect(soon!.inSec).toBeGreaterThanOrEqual(14);
    } finally {
      off();
    }
  });

  it("(c) the breather: an express ends at t with the metro 3 s overdue — «К путям!» at t+5, the metro at t+35", () => {
    const s = metroState(33, { quiet: true });
    s.zones.terminal = true;
    s.buildings.express_depot = 1;
    for (const k of ["downpour", "cat", "catForcedAt", "ratcatcherAt"] as const) s.timers[k] = Infinity;
    s.timers.royal_express = s.time;
    step(s, TICK, { active: false }, { fx: [] });
    expect(s.scene?.id).toBe("royal_express");
    const d = derive(s);
    sceneAction(s, d, { a: "skip" }, { fx: [] });
    expect(s.scene?.phase).toBe("haul");
    s.timers.metro_train = s.time - 3;
    s.timers.whistleUsedFor = s.timers.metro_train;
    const t = s.time;
    sceneAction(s, derive(s), { a: "dismiss" }, { fx: [] });
    expect(s.scene).toBeNull();
    expect(s.timers.metro_train).toBe(t + T.trainBreather);
    expect(s.timers.whistleUsedFor).toBe(t + T.trainBreather); // the whistle moves with its train
    let soonAt = -1;
    let startAt = -1;
    while (s.time < t + 40 && startAt < 0) {
      const ctx: EngineCtx = { fx: [] };
      step(s, TICK, { active: true }, ctx);
      for (const f of ctx.fx) {
        if (f.k === "trainSoon" && soonAt < 0) soonAt = s.time;
        if (f.k === "sceneStart") startAt = s.time;
      }
      if (startAt < 0) expect(s.scene).toBeNull();
    }
    expect(soonAt).toBeGreaterThanOrEqual(t + 4.9);
    expect(soonAt).toBeLessThanOrEqual(t + 5.3);
    expect(s.scene?.id).toBe("metro_train");
    expect(startAt).toBeGreaterThanOrEqual(t + T.trainBreather - 1e-6);
    expect(startAt).toBeLessThanOrEqual(t + T.trainBreather + 0.2);
  });

  it("(d) isHeld: ceremony, crash and a save issue", () => {
    const base = { ceremony: false, crashed: false, saveIssue: null };
    expect(isHeld(base)).toBe(false);
    expect(isHeld({ ...base, ceremony: true })).toBe(true);
    expect(isHeld({ ...base, crashed: true })).toBe(true);
    expect(isHeld({ ...base, saveIssue: { kind: "corrupt", quarantineKey: "q" } })).toBe(true);
  });
});

/* ================================================================ ENG-9 */

describe("ENG-9 (A): the first carriage is a catch tutorial", () => {
  function firstCarriage(seed: number): GameState {
    const s = cellarsState(seed);
    delete s.flags.first_carriage;
    startNow(s, "carriage");
    return s;
  }

  it("a 'warn' of 2 s, then a catch of ≥ 9 s (items 0.5–7 s, life 3 s); later carriages are unchanged", () => {
    const s = firstCarriage(1);
    const sc = s.scene!;
    expect(sc.tutorial).toBe(true);
    expect(sc.phase).toBe("warn");
    expect(sc.phaseEnds - sc.phaseStart).toBeGreaterThanOrEqual(2);
    expect(sc.itemLife).toBe(3);
    for (const it of sc.items) {
      expect(it.t).toBeGreaterThanOrEqual(0.5 - 1e-9);
      expect(it.t).toBeLessThanOrEqual(7 + 1e-9);
    }
    const fx = ticks(s, Math.ceil(2 / TICK) + 1);
    expect(s.scene?.phase).toBe("catch");
    expect(fx.some((f) => f.k === "scenePhase" && f.phase === "catch")).toBe(true);
    expect(s.scene!.phaseEnds - s.scene!.phaseStart).toBeGreaterThanOrEqual(9);

    const later = cellarsState(2);
    const sc2 = startNow(later, "carriage");
    expect(sc2.tutorial).toBeUndefined();
    expect(sc2.phase).toBe("catch");
    expect(sc2.itemLife).toBe(2);
    for (const it of sc2.items) expect(it.t).toBeLessThanOrEqual(5 + 1e-9);
  });

  it("catching everything pays ≥ 2.5× auto-only; every end toast says «поймано N/M»", () => {
    const s = firstCarriage(3);
    ticks(s, Math.ceil(2 / TICK) + 1);
    const sc = s.scene!;
    expect(sc.phase).toBe("catch");
    const all = cloneState(s);
    const none = cloneState(s);
    const ctxAll: EngineCtx = { fx: [] };
    sceneAction(all, derive(all), { a: "attach" }, ctxAll);
    sceneAction(
      all,
      derive(all),
      { a: "catch", result: { caught: sc.items.map((it) => ({ id: it.id, combo: 0, lantern: false })), netted: [], sparksHit: 0, hook: "none", maxCombo: 0 } },
      ctxAll,
    );
    const ctxNone: EngineCtx = { fx: [] };
    sceneAction(none, derive(none), { a: "skip" }, ctxNone);
    expect(all.scene).toBeNull();
    expect(none.scene).toBeNull();
    const gainAll: Amounts = {};
    const gainNone: Amounts = {};
    for (const r of Object.keys(s.resEver) as ResId[]) {
      gainAll[r] = all.resEver[r] - s.resEver[r];
      gainNone[r] = none.resEver[r] - s.resEver[r];
    }
    expect(worth(gainAll)).toBeGreaterThanOrEqual(2.5 * worth(gainNone));
    expect(all.flags.first_carriage).toBe(true);
    const tAll = toasts(ctxAll.fx).find((f) => f.icon === "🐎")!.text;
    const tNone = toasts(ctxNone.fx).find((f) => f.icon === "🐎")!.text;
    expect(tAll).toMatch(/поймано \d+\/\d+/);
    expect(tAll).toContain(`поймано ${sc.items.length}/${sc.items.length}`);
    expect(tAll).toContain("(без вас было бы ");
    expect(tNone).toMatch(/^Экипаж: поймано 0\/\d+ — /);
    expect(tNone).not.toContain("без вас");
  });
});

describe("ENG-9 (B): the human line decides the loot", () => {
  const BUILDS = 300;

  it("each carriage line: ≥ 70% of items from its two top drops, the top one the commonest; the glove brings one 💍", () => {
    const pool = EVENT_LINE_POOLS.carriage;
    pool.forEach((line, i) => {
      const s = cellarsState(100 + i);
      const counts: Partial<Record<ResId, number>> = {};
      let n = 0;
      for (let b = 0; b < BUILDS; b++) {
        forceLine(s, "carriage", i);
        const sc = startNow(s, "carriage");
        expect(sc.lineIdx).toBe(i);
        const rings = sc.items.filter((it) => it.res === "trinkets").length;
        expect(rings).toBe(line.gift?.res === "trinkets" ? 1 : 0);
        for (const it of sc.items) {
          if (it.res === "trinkets") continue;
          counts[it.res] = (counts[it.res] ?? 0) + 1;
          n++;
        }
      }
      const table = line.drops ?? TRAIN_CARS.carriage.drops;
      const top = entries(table).sort((a, b) => b[1] - a[1]);
      const top2 = (counts[top[0][0]] ?? 0) + (counts[top[1][0]] ?? 0);
      expect(top2 / n).toBeGreaterThanOrEqual(0.7);
      const commonest = entries(counts).sort((a, b) => b[1] - a[1])[0][0];
      expect(commonest).toBe(top[0][0]);
    });
  });

  it("capsule lines: «Курс стабилен» is ≥ 70% 🪙, the admiralty letter brings exactly one 📜", () => {
    const s = cellarsState(7);
    let coins = 0;
    let n = 0;
    for (let b = 0; b < BUILDS; b++) {
      forceLine(s, "capsule", 1);
      const sc = startNow(s, "capsule");
      for (const it of sc.items) {
        n++;
        if (it.res === "coins") coins++;
      }
      forceLine(s, "capsule", 5);
      const adm = startNow(s, "capsule");
      expect(adm.items.filter((it) => it.res === "blueprints").length).toBe(1);
    }
    expect(coins / n).toBeGreaterThanOrEqual(0.7);
  });

  it("the mean market value of a carriage and of a capsule stays within ±10% of the plain v2 table (1000 builds)", () => {
    for (const id of ["carriage", "capsule"] as const) {
      const lined = cellarsState(41);
      const plain = cellarsState(41);
      let a = 0;
      let b = 0;
      for (let k = 0; k < 1000; k++) {
        a += itemsWorth(startNow(lined, id));
        forceLine(plain, id, 0); // pair 0 is the v1 line: the plain table
        b += itemsWorth(startNow(plain, id));
      }
      expect(Math.abs(a / b - 1)).toBeLessThanOrEqual(0.1);
    }
  });
});

describe("ENG-9 (C): after the Metro the carriage rains through the grate", () => {
  function rainState(seed = 5): GameState {
    const s = metroState(seed, { quiet: true });
    for (const k of ["downpour", "cat", "catForcedAt"] as const) s.timers[k] = Infinity;
    s.flags.first_carriage = true;
    return s;
  }

  it("no close-up: 6–10 carriage shinies on the grate band for 6 s, the cab in the sky, a toast", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const s = rainState(seed);
      s.timers.carriage = s.time;
      const ctx: EngineCtx = { fx: [] };
      tickEvents(s, derive(s), TICK, { active: true }, ctx);
      expect(s.scene).toBeNull();
      expect(ctx.fx.some((f) => f.k === "sceneStart")).toBe(false);
      const rain = s.shinies.filter((x) => x.kind === "carriage");
      expect(rain.length).toBeGreaterThanOrEqual(6);
      expect(rain.length).toBeLessThanOrEqual(11); // + the glove's ring
      for (const x of rain) {
        expect(x.x).toBeGreaterThanOrEqual(0.15);
        expect(x.x).toBeLessThanOrEqual(0.85);
        expect(x.y).toBeGreaterThanOrEqual(0.45);
        expect(x.y).toBeLessThanOrEqual(0.6);
        expect(x.until).toBeCloseTo(s.time + 6, 9);
        expect(x.amt).toBeGreaterThan(0);
      }
      expect(s.carriagePass).toEqual({ seq: expect.any(Number), until: s.time + T.rainPass });
      expect(toasts(ctx.fx).some((f) => f.text === "Экипаж над решёткой — лови!" && f.icon === "🐎")).toBe(true);
      expect(s.timers.carriage - s.time).toBeGreaterThanOrEqual(300);
    }
  });

  it("a clicked carriage shiny pays its amount, an expired one 25%; a plain shiny pays nothing when it expires", () => {
    const s = rainState();
    const d = derive(s);
    s.shinies = [
      { id: 901, x: 0.5, y: 0.5, res: "coins", until: s.time + 3, kind: "carriage", amt: 100 },
      { id: 902, x: 0.5, y: 0.5, res: "wire", until: s.time + 0.05, kind: "carriage", amt: 80 },
      { id: 903, x: 0.5, y: 0.5, res: "buttons", until: s.time + 0.05 },
    ];
    const before = { ...s.res };
    clickShiny(s, d, 901, { fx: [] });
    expect(s.res.coins - before.coins).toBeCloseTo(100, 9);
    s.time += 0.1;
    const ctx: EngineCtx = { fx: [] };
    tickEvents(s, d, TICK, { active: false }, ctx);
    expect(s.shinies).toEqual([]);
    expect(s.res.wire - before.wire).toBeCloseTo(20, 9);
    expect(s.res.buttons).toBe(before.buttons);
    const swept = ctx.fx.find((f): f is Extract<Fx, { k: "drop" }> => f.k === "drop" && f.res === "wire");
    expect(swept?.amount).toBeCloseTo(20, 9);
    expect(swept?.frac).toBeUndefined(); // not a tap: no «tink»
  });

  it("a whole rain left alone is worth the old close-up's auto share; no carriage scene ever starts after the Metro", () => {
    const s = rainState(9);
    s.timers.shiny = Infinity;
    for (let n = 0; n < 5; n++) {
      s.timers.carriage = s.time;
      const ctx: EngineCtx = { fx: [] };
      for (let i = 0; i < 80; i++) {
        step(s, TICK, { active: false }, ctx);
        expect(s.scene?.id).not.toBe("carriage");
      }
      expect(s.shinies).toEqual([]);
      expect(s.carriagePass).toBeNull();
      const swept = ctx.fx.filter((f): f is Extract<Fx, { k: "drop" }> => f.k === "drop");
      expect(swept.length).toBeGreaterThan(0);
    }
  });
});

describe("ENG-9 (D, E): «Цирк Сэнгера» and «Гороховый суп»", () => {
  it("pickVariant: circus is 0.08 / 0.30 of the weighted variants (20k draws, debut already seen)", () => {
    const s = metroState(77, { quiet: true });
    for (const id of TRAIN_VARIANT_ORDER) s.meta.variantLog[id] = "bronze";
    expect(rushHour(s)).toBe(false);
    const n: Partial<Record<TrainVariantId, number>> = {};
    for (let i = 0; i < 20_000; i++) {
      const v = pickVariant(s);
      n[v] = (n[v] ?? 0) + 1;
    }
    const weighted = (n.circus ?? 0) + (n.edinburgh_mail ?? 0) + (n.freight ?? 0);
    expect(Math.abs((n.circus ?? 0) / weighted - 0.08 / 0.3)).toBeLessThanOrEqual(0.02);
    expect(n.fog ?? 0).toBe(0);
  });

  it("circus: sparkMul 0.5 halves every car's sparks on average (a one-spark car too); Хэтчетт's ×0.8 the same way", () => {
    const s = metroState(79, { quiet: true });
    const d = derive(s);
    /** Mean sparks per car kind over `n` builds (the Cheddar car, which has none, left out). */
    const meanSparks = (n: number, variant: TrainVariantId, dd = d): Partial<Record<TrainCarKind, number>> => {
      const sum: Partial<Record<TrainCarKind, number>> = {};
      const cars: Partial<Record<TrainCarKind, number>> = {};
      for (let i = 0; i < n; i++) {
        s.forceVariant = variant;
        const sc = buildTrain(s, dd, "metro_train");
        expect(sc.variant).toBe(variant);
        for (const car of sc.cars) {
          if (car.special) continue;
          cars[car.kind] = (cars[car.kind] ?? 0) + 1;
          sum[car.kind] = (sum[car.kind] ?? 0) + car.itemIds.filter((id) => sc.items[id].spark).length;
        }
      }
      const out: Partial<Record<TrainCarKind, number>> = {};
      for (const k of Object.keys(cars) as TrainCarKind[]) out[k] = (sum[k] ?? 0) / cars[k]!;
      return out;
    };
    const circus = meanSparks(2000, "circus");
    const plain = meanSparks(500, "normal");
    for (const kind of ["engine", "third", "baggage"] as const) {
      expect(plain[kind]).toBe(TRAIN_CARS[kind].sparks);
      expect(circus[kind]! / (0.5 * TRAIN_CARS[kind].sparks)).toBeGreaterThan(0.9);
      expect(circus[kind]! / (0.5 * TRAIN_CARS[kind].sparks)).toBeLessThan(1.1);
    }
    const hatchett = meanSparks(2000, "normal", { ...d, sparkMult: 0.8 });
    for (const kind of ["engine", "first", "baggage"] as const) {
      expect(hatchett[kind]! / (0.8 * TRAIN_CARS[kind].sparks)).toBeGreaterThan(0.9);
      expect(hatchett[kind]! / (0.8 * TRAIN_CARS[kind].sparks)).toBeLessThan(1.1);
    }
  });

  it("from the Metro, fog every 20–30 min for 3 min: no suspicion, metro trains run as 'fog' with the lantern twice as often", () => {
    const s = metroState(78, { quiet: true });
    s.timers.fog = Infinity;
    const ctx: EngineCtx = { fx: [] };
    tickEvents(s, derive(s), TICK, { active: false }, ctx);
    expect(s.timers.fog - s.time).toBeGreaterThanOrEqual(1200);
    expect(s.timers.fog - s.time).toBeLessThan(1800);
    for (let t = 0; t < 5000; t += 37) {
      expect(fogGap(t)).toBeGreaterThanOrEqual(1200);
      expect(fogGap(t)).toBeLessThan(1800);
    }

    // due, but it waits until the next metro train falls inside it (≤ 150 s away)
    s.timers.fog = s.time;
    s.timers.metro_train = s.time + 200;
    tickEvents(s, derive(s), TICK, { active: false }, { fx: [] });
    expect(fogActive(s)).toBe(false);
    s.timers.metro_train = s.time + 140;
    const rng = s.rng;
    const fx: EngineCtx = { fx: [] };
    tickEvents(s, derive(s), TICK, { active: false }, fx);
    expect(s.rng).toBe(rng); // the fog draws nothing from the sim RNG
    expect(s.buffs.fogUntil).toBe(s.time + 180);
    expect(fogActive(s)).toBe(true);
    expect(toasts(fx.fx)).toContainEqual({ k: "toast", text: "Туман над Лондоном: 3 мин люди ничего не видят", icon: "🌫️", tone: "info" });
    expect(s.timers.fog - s.time).toBeGreaterThanOrEqual(1200);

    // no suspicion at all: passive (an active player in the Cellars), per pass and lantern
    s.suspicion = 30;
    addSuspicion(s, derive(s), 10);
    for (let i = 0; i < 50; i++) step(s, TICK, { active: true }, { fx: [] });
    expect(s.suspicion).toBe(30);

    const d = derive(s);
    let lit = 0;
    for (let i = 0; i < 2000; i++) {
      const sc = buildTrain(s, d, "metro_train");
      expect(sc.variant).toBe("fog");
      if (sc.lantern) lit++;
    }
    expect(lit / 2000).toBeGreaterThan(0.35);
    expect(lit / 2000).toBeLessThan(0.45);
    s.time = s.buffs.fogUntil;
    expect(fogActive(s)).toBe(false);
  });
});

describe("ENG-9 (F): the cat counter", () => {
  it("three countered lunges pay 1.5× the stakes HazardKit shows; a counter is worth 3 hits", () => {
    expect(CAT_COUNTER_HITS).toBe(3);
    expect(catHits(4, 3)).toBe(13);
    // a tough cat's fight lasts until the lunge that a counters-only win needs (14 for 40 hp: the 14th peaks ≤ 15.05 s)
    // and half a second past its counter window (SCN-4 review)
    expect(catFightSec(15)).toBe(10);
    expect(catFightSec(24)).toBe(10);
    expect(catFightSec(27)).toBe(11);
    expect(catFightSec(40)).toBe(16);
    for (const hp of [15, 24, 27, 28, 33, 40]) {
      expect(catLungeAt(9, Math.ceil(hp / 3) - 1) + CAT_COUNTER_WINDOW + CAT_FIGHT_TAIL).toBeLessThanOrEqual(catFightSec(hp));
    }
    {
      const s = metroState(6, { quiet: true });
      s.stats.catsBeaten = 9;
      s.timers.catForcedAt = s.time;
      const ctx: EngineCtx = { fx: [] };
      for (let i = 0; i < 30 && s.scene?.id !== "cat"; i++) step(s, TICK, { active: true }, ctx);
      sceneAction(s, derive(s), { a: "choice", option: "fight" }, ctx);
      const sc = s.scene!;
      expect(sc.taps).toMatchObject({ hp: 40, duration: 16 });
      expect(sc.phaseEnds - sc.phaseStart).toBe(16);
    }
    for (const perfect of [0, 2, 3, 5]) {
      const s = metroState(5, { quiet: true });
      s.ema.blueprints = 2;
      s.timers.catForcedAt = s.time;
      const ctx: EngineCtx = { fx: [] };
      for (let i = 0; i < 30 && s.scene?.id !== "cat"; i++) step(s, TICK, { active: true }, ctx);
      expect(s.scene?.id).toBe("cat");
      sceneAction(s, derive(s), { a: "choice", option: "fight" }, ctx);
      const d = derive(s);
      // HazardKit.catStakes: what the fight card promises
      const bell = s.upgrades.bell_the_cat ? 1.5 : 1;
      const stakes = { blueprints: Math.max(10, 90 * s.ema.blueprints) * bell, cheese: 60 * eventValue(s, d, "cheese") * bell };
      const bp = s.resEver.blueprints;
      const ch = s.resEver.cheese;
      const end: EngineCtx = { fx: [] };
      sceneAction(s, d, { a: "taps", cleared: 1, perfect }, end);
      const k = perfect >= 3 ? 1.5 : 1;
      expect(s.resEver.blueprints - bp).toBeCloseTo(stakes.blueprints * k, 6);
      expect(s.resEver.cheese - ch).toBeCloseTo(stakes.cheese * k, 6);
      expect(toasts(end.fx).some((f) => f.text.startsWith("Кот бежит, поджав хвост!"))).toBe(perfect >= 3);
    }
  });
});

describe("ENG-9 (G): «Гул из глубины»", () => {
  /** A burrow colony at 6:20 with 12 rats; `heard`: the rumble already played. */
  function burrow(heard: boolean): GameState {
    const s = createInitialState(21, 0);
    s.time = 380;
    s.flags.vagrants = true;
    s.flags.first_carriage = true;
    s.rats = 12;
    s.jobs.forager = 12;
    s.res.crumbs = 500;
    s.buildings.nest = 4;
    s.timers.carriage = Infinity; // nothing on screen in the window
    if (heard) s.flags.first_rumble = true;
    return s;
  }

  it("fires once between 6:30 and 8:00, with its toast and news pair, and moves no timer and no RNG", () => {
    const a = burrow(false);
    const b = burrow(true);
    const at: number[] = [];
    const fx: Fx[] = [];
    while (a.time < 480) {
      const ctx: EngineCtx = { fx: [] };
      step(a, TICK, { active: true }, ctx);
      step(b, TICK, { active: true }, { fx: [] });
      for (const f of ctx.fx) {
        fx.push(f);
        if (f.k === "deepRumble") at.push(a.time);
      }
    }
    expect(at.length).toBe(1);
    expect(at[0]).toBeGreaterThanOrEqual(390);
    expect(at[0]).toBeLessThanOrEqual(480);
    expect(a.flags.first_rumble).toBe(true);
    expect(a.rng).toBe(b.rng);
    // every event timer as without it; only the filler headline waits its usual 45 s after any news (EN-10)
    expect({ ...a.timers, filler: 0 }).toEqual({ ...b.timers, filler: 0 });
    expect(toasts(fx).some((f) => f.icon === "🚇" && f.text.startsWith("Земля дрогнула. Старейшина: «Это Бог Грома."))).toBe(true);
    const news = a.news.map((n) => n.text);
    expect(news).toContain("👤 Человек видит: поезд 7:58 на Паддингтон");
    expect(news).toContain("🐀 Крысы видят: под норой прошёл Бог Грома");
    expect(metroTeaser(a)).toBe("🚇 ??? — там ходит Бог Грома");
    // never again
    expect(ticks(a, 3000, true).some((f) => f.k === "deepRumble")).toBe(false);
  });

  it("waits for ten rats and for the scene on screen to end", () => {
    // the event tick alone (no economy, so nobody is born meanwhile)
    const few = burrow(false);
    few.rats = 9;
    few.jobs.forager = 9;
    for (let i = 0; i < 300; i++) {
      few.time += TICK;
      const ctx: EngineCtx = { fx: [] };
      tickEvents(few, derive(few), TICK, { active: true }, ctx);
      expect(ctx.fx.some((f) => f.k === "deepRumble")).toBe(false);
    }
    few.rats = 10;
    const ctx: EngineCtx = { fx: [] };
    tickEvents(few, derive(few), TICK, { active: true }, ctx);
    expect(ctx.fx.filter((f) => f.k === "deepRumble").length).toBe(1);

    // a carriage close-up from 6:26 holds it back until the haul is in
    const busy = burrow(false);
    busy.time = 386;
    busy.timers.carriage = busy.time;
    step(busy, TICK, { active: true }, { fx: [] });
    expect(busy.scene?.id).toBe("carriage");
    sceneAction(busy, derive(busy), { a: "attach" }, { fx: [] });
    let at = -1;
    for (let i = 0; i < 300 && at < 0; i++) {
      const wasUp = !!busy.scene;
      const c: EngineCtx = { fx: [] };
      step(busy, TICK, { active: true }, c);
      if (c.fx.some((f) => f.k === "deepRumble")) {
        expect(wasUp && busy.scene).toBeFalsy();
        at = busy.time;
      }
    }
    expect(at).toBeGreaterThan(392);
  });

  it("once per save: a colony that has met the Thunder God (a metro train, in meta) hears no rumble on a later run", () => {
    const s = burrow(false);
    s.meta.seenEvents.push("metro_train");
    const fx = ticks(s, 1000, true);
    expect(s.time).toBeGreaterThan(T.rumbleAt + 60);
    expect(fx.some((f) => f.k === "deepRumble")).toBe(false);
    expect(s.flags.first_rumble).toBeFalsy();
    expect(metroTeaser(s)).toBeNull();
  });
});
