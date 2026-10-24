import { describe, expect, it } from "vitest";
import { HOOK_JACKPOT_CAP_SEC, METRO_BASE_CARS, RANDOM_CAR_WEIGHTS, TRAIN_CARS } from "../data/events";
import { RESOURCES } from "../data/resources";
import type { CatchResult, EngineCtx, GameState, ResId, Scene, SceneEventId } from "../types";
import { openZone } from "./actions";
import { check } from "./conditions";
import { stun } from "./core";
import { derive, eventValue, stunnedRats } from "./derive";
import { buildTrain, clickPurse, incomeValue, onZoneOpen, sceneAction, trainDropRes } from "./events";
import { createInitialState } from "./state";
import { step, TICK } from "./step";

/** A colony on the metro station: zones open through the real hooks. */
function metroState(seed = 99): GameState {
  const s = createInitialState(seed, 0);
  const ctx: EngineCtx = { fx: [] };
  for (const z of ["sewers", "cellars", "metro"] as const) {
    openZone(s, z, ctx);
    onZoneOpen(s, z);
  }
  s.flags.vagrants = true;
  s.flags.first_train = true; // not the ×3 first train unless a test says so
  s.rats = 200;
  s.jobs.forager = 200;
  s.res.crumbs = 1e5;
  return s;
}

/** The GDD 8.2.7 example train: 2 coin items in 3rd class (3 150 each), 4 in 1st class (4 725 each) = 25 200 coins. */
function gddTrain(s: GameState): Scene {
  const sc = buildTrain(s, derive(s), "metro_train");
  sc.cars = [
    { kind: "third", itemIds: [0, 1] },
    { kind: "first", itemIds: [2, 3, 4, 5] },
  ];
  sc.items = [0, 1, 2, 3, 4, 5].map((id) => ({
    id,
    car: id < 2 ? 0 : 1,
    res: "coins" as const,
    value: id < 2 ? 3150 : 4725,
    weight: id < 2 ? 20 : 30,
    t: 0.5 + id,
  }));
  sc.piles = [{}, {}];
  sc.pileFractions = [0, 0];
  sc.lantern = false;
  sc.hookCar = -1;
  sc.position = "rails";
  return sc;
}

function playTrain(s: GameState, caughtIds: number[]): Scene {
  const ctx: EngineCtx = { fx: [] };
  const sc = gddTrain(s);
  s.scene = sc;
  const d = derive(s);
  sceneAction(s, d, { a: "ready" }, ctx);
  const result: CatchResult = { caught: caughtIds.map((id) => ({ id, combo: 10, lantern: false })), netted: [], sparksHit: 0, hook: "none", maxCombo: 10 };
  sceneAction(s, d, { a: "catch", result }, ctx);
  sceneAction(s, d, { a: "piles", fractions: sc.piles.map(() => 0) }, ctx);
  return sc;
}

describe("train reward (GDD 8.2.7)", () => {
  it("item value = S × V × (1 + 0.05 × platform_post)", () => {
    let checked = 0;
    for (let seed = 1; seed < 40 && checked < 5; seed++) {
      const s = metroState(seed);
      s.buildings.platform_post = 1;
      s.ema.coins = 150;
      const d = derive(s);
      expect(eventValue(s, d, "coins")).toBe(150);
      const sc = buildTrain(s, d, "metro_train");
      for (const it of sc.items) {
        if (it.spark || it.res !== "coins") continue;
        const kind = sc.cars[it.car].kind;
        if (kind === "royal") continue;
        expect(it.value).toBeCloseTo(TRAIN_CARS[kind].S * 150 * 1.05, 6);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("active example: 75% caught with combo ×1.2, rest from piles at a = 0.5, silver +10% ≈ 28.4K", () => {
    const s = metroState();
    const coins0 = s.res.coins;
    const sc = playTrain(s, [2, 3, 4, 5]); // the four 1st-class items = 75% of the value and of the weight
    expect(sc.auto).toBeCloseTo(0.5, 9); // (0.35 + 0.15 «По местам!») × 1.0 at the rails
    expect(sc.haul?.rating).toBe("silver");
    expect(sc.haul?.share).toBeCloseTo(0.75, 9);
    const expected = 25200 * (0.75 * 1.2 + 0.25 * 0.5) * 1.1; // 28 413
    expect(sc.gained.coins).toBeCloseTo(expected, 6);
    expect(s.res.coins - coins0).toBeCloseTo(expected, 6);
    expect(sc.phase).toBe("haul");
  });

  it("the first metro train pays ×3", () => {
    const a = metroState(7);
    const b = metroState(7);
    b.flags.first_train = false;
    const ga = playTrain(a, [2, 3, 4, 5]).gained.coins ?? 0;
    const gb = playTrain(b, [2, 3, 4, 5]).gained.coins ?? 0;
    expect(gb / ga).toBeCloseTo(3, 9);
    expect(b.flags.first_train).toBe(true);
  });

  it("rating thresholds: <40% none, 40% bronze, 65% silver, 85% gold, 95% royal", () => {
    const share = (ids: number[]) => playTrain(metroState(), ids).haul!;
    expect(share([0]).rating).toBe("none"); // 20/160
    expect(share([0, 1, 2]).rating).toBe("bronze"); // 70/160 = 44%
    expect(share([2, 3, 4, 5]).rating).toBe("silver"); // 75%
    expect(share([1, 2, 3, 4, 5]).rating).toBe("gold"); // 140/160 = 87.5%
    const royal = share([0, 1, 2, 3, 4, 5]);
    expect(royal.rating).toBe("royal");
    expect(royal.ratingBonus).toBeCloseTo(0.35, 9);
  });
});

describe("train drops", () => {
  it("💍 drop from metro 1st-class/baggage cars before the first one is owned (the Terminal costs 💍 5)", () => {
    const s = metroState(13);
    expect(s.resEver.trinkets).toBe(0);
    const d = derive(s);
    let fromCars = 0;
    let firstCars = 0;
    for (let i = 0; i < 60; i++) {
      const sc = buildTrain(s, d, "metro_train");
      for (const it of sc.items) {
        if (it.spark || it.res !== "trinkets") continue;
        const kind = sc.cars[it.car].kind;
        expect(kind === "first" || kind === "baggage", kind).toBe(true);
        fromCars++;
        if (kind === "first") firstCars++;
      }
    }
    expect(fromCars).toBeGreaterThan(0);
    expect(firstCars).toBeGreaterThan(0);
  });
});

describe("v2 trains (EN-1, EN-2)", () => {
  it("from the Metro on trains carry 💍 and 🔔 before the first one is owned", () => {
    const s = metroState(21);
    expect(s.resEver.trinkets).toBe(0);
    expect(s.resEver.brass).toBe(0);
    const d = derive(s);
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) for (const it of buildTrain(s, d, "metro_train").items) if (!it.spark) seen.add(it.res);
    expect(seen.has("trinkets")).toBe(true);
    expect(seen.has("brass")).toBe(true);
    // and the resource bar shows them
    expect(check(s, RESOURCES.trinkets.reveal)).toBe(true);
    expect(check(s, RESOURCES.brass.reveal)).toBe(true);
    // before the Metro a capsule-era state never sees them (nothing drops them there anyway): the gate swaps them
    const early = createInitialState(3, 0);
    expect(trainDropRes(early, "trinkets")).toBe("coins");
    expect(trainDropRes(early, "brass")).toBe("coins"); // ⚙️ is not revealed before the sewers either
  });

  it("a base metro train is 4 cars", () => {
    const s = metroState(4);
    const d = derive(s);
    expect(d.trainExtraCars).toBe(0);
    expect(METRO_BASE_CARS).toBe(4);
    for (let i = 0; i < 50; i++) expect(buildTrain(s, d, "metro_train").cars).toHaveLength(4);
    s.buildings.platform_post = 5;
    s.upgrades.stolen_timetable = true;
    s.meta.edicts.timetable_in_head = true;
    for (let i = 0; i < 20; i++) expect(buildTrain(s, derive(s), "metro_train").cars).toHaveLength(11);
  });

  it("with the grappling hook every metro train of 3–11 cars has a hook target", () => {
    const s = metroState(31);
    s.upgrades.grappling_hook = true;
    const d = derive(s);
    let replaced = 0;
    for (let i = 0; i < 1000; i++) {
      const n = 3 + (i % 9);
      const sc = buildTrain(s, { ...d, trainExtraCars: n - METRO_BASE_CARS }, "metro_train");
      expect(sc.cars).toHaveLength(n);
      expect(sc.hookCar, `train ${i} (${sc.cars.map((c) => c.kind).join(",")})`).toBeGreaterThanOrEqual(0);
      expect(["first", "baggage"]).toContain(sc.cars[sc.hookCar].kind);
      if (sc.cars.filter((c) => c.kind === "first" || c.kind === "baggage").length === 1 && sc.cars[sc.cars.length - 1].kind === "baggage") replaced++;
    }
    expect(replaced).toBeGreaterThan(0);
  });

  it("without the hook the random cars follow the weights (χ², p > 0.01)", () => {
    const s = metroState(41);
    const d = derive(s);
    const counts: Record<string, number> = { third: 0, dining: 0, mail: 0, first: 0, baggage: 0 };
    let n = 0;
    for (let i = 0; i < 2600; i++) {
      // EN-6 variants (rush hour, mail, freight) have their own car tables: count plain trains only
      const sc = buildTrain(s, { ...d, trainExtraCars: i % 8 }, "metro_train");
      if (sc.variant !== "normal" || sc.announce) continue;
      for (const car of sc.cars) {
        if (car.kind === "engine" || car.kind === "tender") continue;
        counts[car.kind]++;
        n++;
      }
    }
    const wsum = Object.values(RANDOM_CAR_WEIGHTS).reduce((a, w) => a + w, 0);
    let chi2 = 0;
    for (const [k, w] of Object.entries(RANDOM_CAR_WEIGHTS)) {
      const exp = (n * w) / wsum;
      chi2 += (counts[k] - exp) ** 2 / exp;
    }
    expect(n).toBeGreaterThan(5000);
    expect(chi2).toBeLessThan(13.277); // χ²(4 dof) at p = 0.01
  });

  /** A metro scene with the hook, nothing caught by hand: everything the catch pays is the jackpot. */
  function hookOnly(s: GameState, id: "metro_train" | "royal_express", hook: CatchResult["hook"]) {
    s.upgrades.grappling_hook = true;
    const d = derive(s);
    // a plain train (no EN-6 variant or Cheddar car): the car values are the base ones
    let sc = buildTrain(s, d, id);
    while ((sc.variant ?? "normal") !== "normal" || sc.announce) sc = buildTrain(s, d, id);
    sc.position = "rails";
    sc.multiplier = 1;
    s.scene = sc;
    const ctx: EngineCtx = { fx: [] };
    sceneAction(s, d, { a: "ready" }, ctx);
    const before = { ...s.res };
    sceneAction(s, d, { a: "catch", result: { caught: [], netted: [], sparksHit: 0, hook, maxCombo: 0 } }, ctx);
    const got: Partial<Record<ResId, number>> = {};
    for (const r of Object.keys(before) as ResId[]) if (s.res[r] - before[r] > 1e-9) got[r] = s.res[r] - before[r];
    const car: Partial<Record<ResId, number>> = {};
    for (const itId of sc.cars[sc.hookCar].itemIds) {
      const it = sc.items[itId];
      if (!it.spark && it.res !== "trinkets") car[it.res] = (car[it.res] ?? 0) + it.value;
    }
    return { sc, got, car };
  }
  const value = (a: Partial<Record<ResId, number>>) => Object.entries(a).reduce((v, [r, x]) => v + (r === "trinkets" ? 0 : (x ?? 0) * (RESOURCES[r as ResId].market ?? 0)), 0);

  it("hook jackpot: ×4 perfect / ×2.5 hit of the car while under the cap, +2 💍", () => {
    for (const [hook, k] of [
      ["perfect", 4],
      ["hit", 2.5],
    ] as const) {
      const s = metroState(51);
      s.ema.coins = 10; // the car's coins are valued at the floor (0.5 × 4³ = 32)
      s.ema.rails = 1e4; // a big passive income elsewhere (🛤️ never drops from cars): the cap does not bind
      const { sc, got, car } = hookOnly(s, "metro_train", hook);
      expect(sc.jackpot).toBe(true);
      for (const [r, v] of Object.entries(car)) expect(got[r as ResId], r).toBeCloseTo((v ?? 0) * k, 6);
      expect(got.trinkets).toBeCloseTo(2, 9);
      expect(sc.haul?.jackpotSeconds).toBeCloseTo(value(car) * k / incomeValue(s), 9);
    }
  });

  it("a jackpot never pays more than 180 s of market-value income (+2 💍)", () => {
    for (let seed = 1; seed <= 12; seed++) {
      const s = metroState(60 + seed);
      s.ema.coins = 2 + seed; // a modest income: the car alone is worth far more
      s.ema.crumbs = 50;
      const income = incomeValue(s);
      const hook = seed % 2 ? "perfect" : "hit";
      const { sc, got, car } = hookOnly(s, "metro_train", hook);
      expect(value(car) * 2.5).toBeGreaterThan(HOOK_JACKPOT_CAP_SEC * income);
      expect(value(got)).toBeLessThanOrEqual(HOOK_JACKPOT_CAP_SEC * income * (1 + 1e-9));
      expect(value(got)).toBeCloseTo(HOOK_JACKPOT_CAP_SEC * income, 6);
      expect(sc.haul?.jackpotSeconds).toBeCloseTo(HOOK_JACKPOT_CAP_SEC, 6);
      expect(got.trinkets).toBeCloseTo(2, 9);
    }
  });

  it("the royal car of the Royal Express pays ×6 / ×4", () => {
    const s = metroState(71);
    openZone(s, "terminal", { fx: [] });
    s.buildings.express_depot = 1;
    s.ema.coins = 10;
    s.ema.rails = 1e4;
    const { sc, got, car } = hookOnly(s, "royal_express", "perfect");
    expect(sc.cars[sc.hookCar].kind).toBe("royal");
    for (const [r, v] of Object.entries(car)) expect(got[r as ResId], r).toBeCloseTo((v ?? 0) * 6, 6);
    const t = metroState(71);
    openZone(t, "terminal", { fx: [] });
    t.buildings.express_depot = 1;
    t.ema.coins = 10;
    t.ema.rails = 1e4;
    const hit = hookOnly(t, "royal_express", "hit");
    for (const [r, v] of Object.entries(hit.car)) expect(hit.got[r as ResId], r).toBeCloseTo((v ?? 0) * 4, 6);
  });

  it("one stoker makes exactly 3 × jobYield 💨/s, whatever the global multiplier", () => {
    const s = metroState(81);
    s.buildings.boiler = 1;
    s.meta.crownsEver = 300; // +600% from crowns
    s.res.coal = 1e6;
    s.resEver.coal = 1e6;
    s.jobs.forager = 199;
    s.jobs.stoker = 1;
    s.convEff.stoker = 1;
    const ctx: EngineCtx = { fx: [] };
    step(s, TICK, { active: false }, ctx);
    const d = derive(s);
    expect(d.global).toBeGreaterThanOrEqual(5);
    expect(s.gross.steam).toBeCloseTo(3 * d.jobYield.stoker, 12);
    expect(RESOURCES.steam.excludeGlobal).toBe(true);
  });
});

describe("background events under a scene", () => {
  /** A carriage close-up covering the colony, with nothing else due. */
  function underCarriage(): GameState {
    const s = metroState(17);
    s.timers.metro_train = Infinity;
    s.timers.market = Infinity;
    s.timers.shiny = Infinity;
    s.timers.purse = Infinity;
    s.timers.carriage = s.time;
    step(s, TICK, { active: false }, { fx: [] });
    expect(s.scene?.id).toBe("carriage");
    return s;
  }

  it("purse, shinies and the market keep their remaining life while a scene runs", () => {
    const s = underCarriage();
    s.purse = { x: 0.5, y: 0.5, until: s.time + 1 };
    s.shinies = [{ id: 999, x: 0.5, y: 0.5, res: "coins", until: s.time + 1 }];
    s.market = { id: 998, until: s.time + 1, deals: [] };
    for (let i = 0; i < 20; i++) step(s, TICK, { active: false }, { fx: [] });
    expect(s.scene).not.toBeNull();
    expect(s.purse?.until).toBeCloseTo(s.time + 1, 6);
    expect(s.shinies.map((x) => x.id)).toEqual([999]);
    expect(s.market?.id).toBe(998);
    expect(s.market!.until - s.time).toBeCloseTo(1, 6);
  });

  it("no purse or shiny spawns under a scene; the overdue ones appear right after it", () => {
    const s = underCarriage();
    s.timers.purse = s.time;
    s.timers.shiny = s.time;
    let guard = 0;
    while (s.scene && guard++ < 2000) {
      step(s, TICK, { active: false }, { fx: [] });
      if (s.scene) {
        expect(s.purse).toBeNull();
        expect(s.shinies).toEqual([]);
      }
    }
    expect(s.scene).toBeNull();
    step(s, TICK, { active: false }, { fx: [] });
    expect(s.purse).not.toBeNull();
    expect(s.purse!.until - s.time).toBeGreaterThan(11);
    expect(s.shinies.length).toBe(1);
  });

  it("a newly opened market gets a stable id", () => {
    const s = metroState(19);
    s.timers.market = s.time;
    for (const r of ["coins", "buttons", "wire"] as const) {
      s.res[r] = 5000;
      s.resEver[r] = 5000;
    }
    step(s, TICK, { active: false }, { fx: [] });
    expect(s.market).not.toBeNull();
    expect(s.market!.id).toBe(s.sceneSeq);
  });
});

describe("purse", () => {
  it("the Пир and Шальная лапа toasts say what the buff does and for how long", () => {
    const seen = new Set<string>();
    for (let seed = 1; seed < 200 && seen.size < 2; seed++) {
      const s = metroState(seed);
      s.purse = { x: 0.5, y: 0.5, until: s.time + 10 };
      const ctx: EngineCtx = { fx: [] };
      clickPurse(s, derive(s), ctx);
      const text = ctx.fx.find((f) => f.k === "toast")?.text ?? "";
      if (s.buffs.feastUntil > s.time) {
        expect(text).toContain("×5 на 30 с");
        seen.add("feast");
      }
      if (s.buffs.luckyPawUntil > s.time) {
        expect(text).toContain("×15 на 12 с");
        seen.add("paw");
      }
    }
    expect(seen.size).toBe(2);
  });
});

describe("event scheduler", () => {
  const HARMFUL: SceneEventId[] = ["downpour", "cat", "ratcatcher"];

  function run(active: boolean, minutes: number): Set<SceneEventId> {
    const s = metroState(11);
    s.suspicion = 100;
    s.timers.downpour = s.time;
    s.timers.catForcedAt = s.time;
    s.timers.cat = s.time;
    const started = new Set<SceneEventId>();
    const ctx: EngineCtx = { fx: [] };
    for (let i = 0; i < (minutes * 60) / TICK; i++) {
      step(s, TICK, { active }, ctx);
      for (const f of ctx.fx) if (f.k === "sceneStart") started.add(f.id);
      ctx.fx.length = 0;
      // a player would answer; nobody here, so scenes resolve by themselves
    }
    return started;
  }

  it("harmful events never start while the player is inactive", () => {
    const started = run(false, 30);
    for (const id of HARMFUL) expect(started.has(id), id).toBe(false);
    expect(started.has("metro_train")).toBe(true); // trains still pass
  });

  it("with an active player the same timers do fire", () => {
    const started = run(true, 30);
    for (const id of HARMFUL) expect(started.has(id), id).toBe(true);
  });

  it("suspicion grows by itself only while the player is active", () => {
    const s = metroState(3);
    s.suspicion = 10;
    s.timers.metro_train = Infinity;
    s.timers.carriage = Infinity;
    s.timers.purse = Infinity;
    const ctx: EngineCtx = { fx: [] };
    for (let i = 0; i < 600; i++) step(s, TICK, { active: false }, ctx);
    expect(s.suspicion).toBe(10);
    for (let i = 0; i < 600; i++) step(s, TICK, { active: true }, ctx);
    expect(s.suspicion).toBeCloseTo(11, 6);
  });
});

describe("rats are never lost for good", () => {
  it("stunned groups recover on their own timers and the workforce comes back", () => {
    const s = metroState(5);
    s.jobs.forager = 0;
    s.jobs.pickpocket = 200;
    s.timers.metro_train = Infinity;
    s.timers.carriage = Infinity;
    const ctx: EngineCtx = { fx: [] };
    for (let i = 0; i < 50; i++) step(s, TICK, { active: false }, ctx);
    const gross = s.gross.coins;
    const rats = s.rats;
    stun(s, 0.03, 60, "cat");
    stun(s, 0.12, 90, "piper");
    stun(s, 0.03, 90, "crash");
    expect(stunnedRats(s)).toBe(6 + 24 + 6);
    for (let i = 0; i < 10; i++) step(s, TICK, { active: false }, ctx);
    expect(s.gross.coins).toBeLessThan(gross);
    for (let i = 0; i < 920; i++) step(s, TICK, { active: false }, ctx);
    expect(s.stunned).toEqual([]);
    expect(s.rats).toBeGreaterThanOrEqual(rats);
    expect(s.gross.coins).toBeCloseTo(gross, 6);
  });

  it("losing to the ratcatcher only charms rats for 90 s", () => {
    const s = metroState(8);
    s.suspicion = 100;
    const ctx: EngineCtx = { fx: [] };
    const current = (): SceneEventId | null => s.scene?.id ?? null;
    for (let guard = 0; current() !== "ratcatcher" && guard < 20000; guard++) {
      step(s, TICK, { active: true }, ctx);
      if (current() && current() !== "ratcatcher") sceneAction(s, derive(s), { a: "skip" }, ctx);
      if (s.scene?.phase === "haul") sceneAction(s, derive(s), { a: "dismiss" }, ctx);
      ctx.fx.length = 0;
    }
    expect(s.scene?.id).toBe("ratcatcher");
    const rats = s.rats;
    sceneAction(s, derive(s), { a: "choice", option: "fight" }, ctx);
    sceneAction(s, derive(s), { a: "taps", cleared: 0 }, ctx);
    expect(stunnedRats(s)).toBeGreaterThan(0);
    expect(s.suspicion).toBe(40);
    for (let i = 0; i < 950; i++) step(s, TICK, { active: false }, ctx);
    // (a passing metro train may have scared a few rats on its own in the meantime: only the piper's group matters)
    expect(s.stunned.filter((g) => g.reason === "piper")).toEqual([]);
    expect(s.rats).toBeGreaterThanOrEqual(rats);
  });
});
