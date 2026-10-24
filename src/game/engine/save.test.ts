import { describe, expect, it } from "vitest";
import type { EngineCtx, GameState } from "../types";
import { buyBuilding, click, openZone } from "./actions";
import { derive } from "./derive";
import { onZoneOpen, sceneAction } from "./events";
import { deserialize as deserializeAny, exportString, importAny, importString, isNewerSave, migrate, savedVersion, serialize } from "./save";
import { createInitialState, SCHEMA_VERSION } from "./state";
import { step, TICK } from "./step";

/** deserialize() for saves of this version: newer-version results fail the test. */
function deserialize(str: string): GameState | null {
  const r = deserializeAny(str);
  expect(isNewerSave(r)).toBe(false);
  return isNewerSave(r) ? null : r;
}

function playedState(): GameState {
  const s = createInitialState(31337, 1_700_000_000_000);
  const ctx: EngineCtx = { fx: [] };
  for (let i = 0; i < 600; i++) {
    step(s, TICK, { active: true }, ctx);
    if (i % 3 === 0) click(s, derive(s), ctx);
    if (i % 50 === 0) buyBuilding(s, derive(s), "nest", 1, ctx);
  }
  return s;
}

describe("save", () => {
  it("serialize → deserialize is a lossless roundtrip, including Infinity timers", () => {
    const s = playedState();
    expect(s.timers.capsule).toBe(Infinity);
    expect(s.timers.ratcatcherAt).toBe(Infinity);
    s.timers.whistleUsedFor = -Infinity;
    const back = deserialize(serialize(s));
    expect(back).not.toBeNull();
    expect(back!.timers.capsule).toBe(Infinity);
    expect(back!.timers.whistleUsedFor).toBe(-Infinity);
    expect(back).toEqual({ ...s, scene: null });
  });

  it("clamps huge numbers and replaces NaN on save", () => {
    const s = createInitialState(1, 0);
    s.res.coins = 1e305;
    s.res.wire = NaN;
    const back = deserialize(serialize(s))!;
    expect(back.res.coins).toBe(1e300);
    expect(back.res.wire).toBe(0);
  });

  it("migrate() fills fields missing from an older save", () => {
    const s = playedState();
    const raw = JSON.parse(serialize(s)) as Record<string, unknown>;
    delete raw.express;
    delete raw.trainPrefs;
    delete (raw.timers as Record<string, unknown>).whistleUsedFor;
    delete (raw.meta as Record<string, unknown>).lifetime;
    delete (raw.res as Record<string, unknown>).trinkets;
    (raw.buildings as Record<string, unknown>).nest = "oops"; // wrong type → default
    const m = migrate(raw);
    expect(m.express).toEqual({ stage: 0, progress: {}, wagons: 0 });
    expect(m.trainPrefs.position).toBe("rails");
    expect(m.timers.whistleUsedFor).toBe(-1);
    expect(m.meta.lifetime.playSeconds).toBe(0);
    expect(m.res.trinkets).toBe(0);
    expect(m.buildings.nest).toBe(0);
    expect(m.res.crumbs).toBe(s.res.crumbs); // existing values are kept
    expect(m.rats).toBe(s.rats);
    expect(m.scene).toBeNull();
  });

  it("a save made mid-train credits the train's auto-collect share instead of dropping the loot", () => {
    const s = createInitialState(77, 0);
    const ctx: EngineCtx = { fx: [] };
    for (const z of ["sewers", "cellars", "metro"] as const) {
      openZone(s, z, ctx);
      onZoneOpen(s, z);
    }
    s.flags.first_train = true;
    s.timers.carriage = Infinity;
    s.timers.metro_train = s.time;
    step(s, TICK, { active: false }, ctx);
    expect(s.scene?.id).toBe("metro_train");
    sceneAction(s, derive(s), { a: "ready" }, ctx); // now in the catch phase
    expect(s.scene?.phase).toBe("catch");
    const back = deserialize(serialize(s))!;
    expect(back.scene).toBeNull();
    expect(back.haulLog.length).toBe(s.haulLog.length + 1);
    const value = (g: GameState) => g.res.coins + g.res.coal + g.res.gears + g.res.crumbs + g.res.cheese;
    expect(value(back)).toBeGreaterThan(value(s));
  });

  it("a market saved before markets had an id gets one", () => {
    const s = createInitialState(1, 0);
    const raw = JSON.parse(serialize(s)) as Record<string, unknown>;
    raw.market = { until: 100, deals: [] };
    raw.sceneSeq = 41;
    const m = migrate(raw);
    expect(m.market?.id).toBe(42);
    expect(m.sceneSeq).toBe(42);
  });

  it("rejects garbage and round-trips the export string", () => {
    expect(deserialize("not json")).toBeNull();
    expect(deserialize("{}")).toBeNull();
    expect(importString("RATRO1:@@@")).toBeNull();
    const s = playedState();
    s.news.push({ t: 1, text: "Крысиные Ведомости: проверка юникода 🐀" });
    const back = importString(exportString(s));
    expect(back).toEqual({ ...s, scene: null });
  });
});

describe("save v2 (EN-7 / EN-8)", () => {
  /** A save as v1 wrote it: no v2 fields anywhere, schemaVersion 1. */
  function v1Raw(): Record<string, unknown> {
    const s = playedState();
    s.haulLog.unshift({ title: "Улов поезда №1", gained: { coins: 10 }, caughtCount: 1, totalCount: 2, share: 0.5, rating: "bronze", ratingBonus: 0, combo: 3, suspicion: 2, crash: false, jackpot: false, notes: [] });
    const raw = JSON.parse(serialize(s)) as Record<string, unknown>;
    raw.schemaVersion = 1;
    for (const k of ["scouted", "newsRecent", "commissions", "charters"]) delete raw[k];
    const settings = raw.settings as Record<string, unknown>;
    for (const k of ["hints", "ambience", "textScale", "reducedMotionFromOS"]) delete settings[k];
    const meta = raw.meta as Record<string, unknown>;
    for (const k of ["edictRank", "seal", "sealsOwned", "coronations", "carLog", "variantLog", "seenLines", "history", "records"]) delete meta[k];
    for (const stats of [raw.stats, meta.lifetime] as Record<string, unknown>[])
      for (const k of ["cleanCars", "goldStreak", "goldHauls", "downpoursWon", "frenzies", "royalExpresses"]) delete stats[k];
    return raw;
  }

  it("a v1 save loads with every v2 default", () => {
    const raw = v1Raw();
    (raw.settings as Record<string, unknown>).volume = 0.7;
    const m = migrate(raw);
    expect(m.schemaVersion).toBe(SCHEMA_VERSION);
    expect(m.settings).toMatchObject({ volume: 0.7, hints: true, ambience: 0.5, textScale: 1, reducedMotionFromOS: false });
    expect(m.meta).toMatchObject({ edictRank: {}, seal: null, sealsOwned: [], coronations: 0, carLog: {}, variantLog: {}, seenLines: {}, history: [], records: {} });
    expect(m).toMatchObject({ scouted: {}, newsRecent: [], commissions: null, charters: 0 });
    expect(m.stats).toMatchObject({ cleanCars: 0, goldStreak: 0, goldHauls: 0, downpoursWon: 0, frenzies: 0, royalExpresses: 0 });
    expect(m.meta.lifetime.frenzies).toBe(0);
    expect(m.haulLog[0].title).toBe("Улов поезда №1");
    expect(m.haulLog[0].headline).toBeUndefined();
    expect(m.rats).toBe((raw as { rats: number }).rats);
  });

  it("v2 values survive a roundtrip (a null default such as meta.seal keeps its value)", () => {
    const s = playedState();
    s.meta.sealsOwned = ["railway", "dynasty"];
    s.meta.seal = "dynasty";
    s.meta.edictRank = { royal_litter: 3 };
    s.meta.edicts.royal_litter = true;
    s.meta.history = [{ district: 0, seconds: 3600, eRun: 2e6, crowns: 14, zones: { sewers: 300 }, bestRating: "gold" }];
    s.meta.records = { sewers: 300 };
    s.commissions = { offered: ["wagon", "bullseye", "replenish"], active: { id: "wagon", base: 0 }, done: 1 };
    s.settings.textScale = 1.3;
    const back = deserialize(serialize(s))!;
    expect(back.meta.seal).toBe("dynasty");
    expect(back.meta.sealsOwned).toEqual(["railway", "dynasty"]);
    expect(back.meta.edictRank.royal_litter).toBe(3);
    expect(back.meta.history).toEqual(s.meta.history);
    expect(back.commissions).toEqual(s.commissions);
    expect(back.settings.textScale).toBe(1.3);
  });

  it("malformed array elements are dropped instead of crashing the page", () => {
    const s = playedState();
    const raw = JSON.parse(serialize(s)) as Record<string, unknown>;
    raw.shinies = [{ id: 1 }, { id: 2, x: 0.5, y: 0.5, res: "coins", until: 99 }, { id: 3, x: 0.2, y: 0.3, res: "gold", until: 9 }];
    raw.news = ["x", { t: 1, text: "Крысиные Ведомости" }, { t: 2 }];
    raw.haulLog = [{ title: 1 }, null, { title: "ok", gained: { coins: 5, junk: 1 }, rating: "silver" }];
    raw.stunned = [{ count: 2, until: 50, reason: "cat" }, { count: "two" }];
    raw.market = { id: 3, until: 100, deals: [{ give: "coins", giveAmt: 10, get: "wire", getAmt: 4, done: false }, { give: "nope", get: "wire" }] };
    (raw.settings as Record<string, unknown>).textScale = 2;
    (raw.meta as Record<string, unknown>).seal = "railway"; // not owned → dropped
    const back = deserialize(JSON.stringify(raw))!;
    expect(back.shinies.map((x) => x.id)).toEqual([2]);
    expect(back.news).toEqual([{ t: 1, text: "Крысиные Ведомости" }]);
    expect(back.haulLog).toHaveLength(1);
    expect(back.haulLog[0]).toMatchObject({ title: "ok", gained: { coins: 5 }, rating: "silver", notes: [], share: 0 });
    expect(back.stunned).toEqual([{ count: 2, until: 50, reason: "cat" }]);
    expect(back.market?.deals).toHaveLength(1);
    expect(back.settings.textScale).toBe(1);
    expect(back.meta.seal).toBeNull();
  });

  it("deserialize with shinies [{id:1}] and news ['x'] loads with both arrays sanitized", () => {
    const raw = JSON.parse(serialize(createInitialState(1, 0))) as Record<string, unknown>;
    raw.shinies = [{ id: 1 }];
    raw.news = ["x"];
    const back = deserialize(JSON.stringify(raw))!;
    expect(back.shinies).toEqual([]);
    expect(back.news).toEqual([]);
  });

  it("a save from a newer schema is reported, never migrated down", () => {
    const raw = JSON.parse(serialize(createInitialState(1, 0))) as Record<string, unknown>;
    raw.schemaVersion = SCHEMA_VERSION + 1;
    expect(deserializeAny(JSON.stringify(raw))).toEqual({ error: "newer", version: SCHEMA_VERSION + 1 });
    expect(importString(JSON.stringify(raw))).toBeNull();
    expect(savedVersion(JSON.stringify(raw))).toBe(SCHEMA_VERSION + 1);
    expect(deserializeAny("{\"schemaVersion\":")).toBeNull(); // truncated: garbage, not "newer"
  });

  it("importAny takes both the export string and the raw save file", () => {
    const s = playedState();
    expect(importAny(serialize(s))).toEqual({ ...s, scene: null });
    expect(importAny(exportString(s))).toEqual({ ...s, scene: null });
    expect(importAny("hello")).toBeNull();
  });
});
