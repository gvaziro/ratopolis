import { describe, expect, it } from "vitest";
import { TRAIN_CARS } from "../data/events";
import type { CatchResult, EngineCtx, GameState, Scene, SceneEventId } from "../types";
import { openZone } from "./actions";
import { stun } from "./core";
import { derive, eventValue, stunnedRats } from "./derive";
import { buildTrain, onZoneOpen, sceneAction } from "./events";
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
    expect(stunnedRats(s)).toBe(0);
    expect(s.rats).toBeGreaterThanOrEqual(rats);
  });
});
