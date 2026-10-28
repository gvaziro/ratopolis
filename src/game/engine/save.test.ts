import { describe, expect, it } from "vitest";
import { legacyDistrictId, MAX_DISTRICT } from "../data/districts";
import type { EngineCtx, GameState } from "../types";
import { openZone } from "./actions";
import { derive } from "./derive";
import { onZoneOpen, sceneAction } from "./events";
import { deserialize as deserializeAny, exportString, importAny, importString, isNewerSave, migrate, MIGRATIONS, savedVersion, serialize } from "./save";
import { createInitialState, SCHEMA_VERSION } from "./state";
import { step, TICK } from "./step";
import { metroState, playedState } from "./testkit";

/** How serialize() writes ±Infinity (a JSON string the reviver turns back). */
const INF_TOKEN = "__INF__";
const NINF_TOKEN = "__-INF__";

/** deserialize() for saves of this version: newer-version results fail the test. */
function deserialize(str: string): GameState | null {
  const r = deserializeAny(str);
  expect(isNewerSave(r)).toBe(false);
  return isNewerSave(r) ? null : r;
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

  it("settings.batterySaver: missing in an older save → auto; a bad value → auto; a valid one survives", () => {
    const raw = JSON.parse(serialize(playedState())) as Record<string, unknown>;
    delete (raw.settings as Record<string, unknown>).batterySaver;
    expect(deserialize(JSON.stringify(raw))!.settings.batterySaver).toBe("auto");
    (raw.settings as Record<string, unknown>).batterySaver = "max";
    expect(deserialize(JSON.stringify(raw))!.settings.batterySaver).toBe("auto");
    (raw.settings as Record<string, unknown>).batterySaver = "off";
    expect(deserialize(JSON.stringify(raw))!.settings.batterySaver).toBe("off");
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

  /** A v2 save as v2 wrote it: no v3 field at all. */
  function v2Raw(): Record<string, unknown> {
    const raw = JSON.parse(serialize(playedState())) as Record<string, unknown>;
    raw.schemaVersion = 2;
    const settings = raw.settings as Record<string, unknown>;
    delete settings.sfxVolume;
    delete settings.music;
    const meta = raw.meta as Record<string, unknown>;
    delete meta.districtId;
    delete meta.visited;
    delete meta.curios;
    delete raw.steamPriority;
    delete raw.carriagePass;
    delete raw.hintMemo;
    delete (raw.buffs as Record<string, unknown>).fogUntil;
    delete (raw.timers as Record<string, unknown>).fog;
    return raw;
  }

  it("a v2 save loads with every v3 default (ENG-12 settings, steam valve, fog, carriage pass)", () => {
    const raw = v2Raw();
    (raw.settings as Record<string, unknown>).volume = 0.7;
    const m = migrate(raw);
    expect(m.schemaVersion).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe(3);
    expect(m.settings).toMatchObject({ volume: 0.7, sfxVolume: 1, music: 0.35 });
    expect(m.steamPriority).toBe("works");
    expect(m.carriagePass).toBeNull();
    expect(m.buffs.fogUntil).toBe(0);
    expect(m.meta).toMatchObject({ districtId: "whitechapel", visited: ["whitechapel"], curios: [] });
    expect(m.flags.focus_manual).toBeUndefined(); // focus "forager": the auto focus stays on
    expect(m.hintMemo).toEqual({ id: "", since: 0, muted: "", mutedUntil: 0 }); // ENG-1 hint hysteresis
    expect(m.timers.fog).toBe(Infinity); // ENG-9: scheduled on the first tick with the Metro open
  });

  it("ENG-9: a save from before the fog timer gets its first «Гороховый суп» 20–30 min after the next tick", () => {
    const raw = JSON.parse(serialize(metroState(3, { quiet: true }))) as Record<string, unknown>;
    raw.schemaVersion = 2;
    delete (raw.timers as Record<string, unknown>).fog;
    const m = migrate(raw);
    expect(m.timers.fog).toBe(Infinity);
    step(m, TICK, { active: false }, { fx: [] });
    expect(m.timers.fog - m.time).toBeGreaterThanOrEqual(1200 - TICK);
    expect(m.timers.fog - m.time).toBeLessThanOrEqual(1800);
    // and a v3 save keeps the time it had
    const s = metroState(3, { quiet: true });
    s.timers.fog = 777;
    expect(deserialize(serialize(s))!.timers.fog).toBe(777);
  });

  it("the elder's hint memo (ENG-1) survives a roundtrip; a malformed one is reset", () => {
    const s = playedState();
    s.hintMemo = { id: "rebalance:pickpocket", since: 30, muted: "housing", mutedUntil: 95 };
    expect(deserialize(serialize(s))!.hintMemo).toEqual(s.hintMemo);
    const raw = JSON.parse(serialize(s)) as Record<string, unknown>;
    raw.hintMemo = { id: 7, since: "soon", muted: null };
    expect(deserialize(JSON.stringify(raw))!.hintMemo).toEqual({ id: "", since: 0, muted: "", mutedUntil: 0 });
    raw.hintMemo = "stale";
    expect(deserialize(JSON.stringify(raw))!.hintMemo).toEqual({ id: "", since: 0, muted: "", mutedUntil: 0 });
  });

  it("v2 → v3: a hand-picked focus stays manual, the district index becomes visited ids, trophies become curios", () => {
    const raw = v2Raw();
    raw.focus = "pickpocket";
    const meta = raw.meta as Record<string, unknown>;
    meta.district = 6;
    meta.migrations = 6;
    meta.trophies = ["cat_fur", "broken_pipe", "mystery"];
    meta.history = [{ district: 1, seconds: 3600, eRun: 2e6, crowns: 14, zones: {}, bestRating: "gold" }];
    const m = migrate(raw);
    expect(m.flags.focus_manual).toBe(true);
    expect(m.meta.district).toBe(6);
    expect(m.meta.visited).toEqual(["whitechapel", "southwark", "lambeth", "bloomsbury", "mayfair", "westminster", "city"]);
    expect(m.meta.districtId).toBe("city");
    expect(m.meta.history[0].districtId).toBe("southwark");
    expect(m.meta.curios).toEqual(["cat_fur_tuft", "broken_pipe"]);
    expect(m.meta.trophies).toEqual(["cat_fur", "broken_pipe", "mystery"]); // still written for old readers
  });

  it("v3 values survive a roundtrip; unknown curio and district ids are dropped, settings clamped", () => {
    const s = playedState();
    s.settings.sfxVolume = 0.25;
    s.settings.music = 0;
    s.steamPriority = "power";
    s.carriagePass = { seq: 7, until: 99 };
    s.buffs.fogUntil = 120;
    s.meta.visited = ["whitechapel", "kings_cross"];
    s.meta.district = 1;
    s.meta.districtId = "kings_cross";
    s.meta.curios = ["monocle", "tower_key"];
    s.shinies = [{ id: 5, x: 0.5, y: 0.5, res: "coins", until: 99, kind: "carriage", amt: 120 }];
    const back = deserialize(serialize(s))!;
    expect(back).toEqual({ ...s, scene: null });

    const raw = JSON.parse(serialize(s)) as Record<string, unknown>;
    const meta = raw.meta as Record<string, unknown>;
    meta.curios = ["monocle", "dragon_egg", "monocle"];
    meta.visited = ["whitechapel", "atlantis"];
    (raw.settings as Record<string, unknown>).music = 7;
    raw.steamPriority = "both";
    raw.shinies = [{ id: 6, x: 0.1, y: 0.5, res: "coins", until: 9, kind: "comet", amt: "lots" }];
    const m = deserialize(JSON.stringify(raw))!;
    expect(m.meta.curios).toEqual(["monocle"]);
    expect(m.meta.visited).toEqual(["whitechapel", "southwark"]); // broken list: rebuilt from the index
    expect(m.meta.districtId).toBe("southwark");
    expect(m.settings.music).toBe(1);
    expect(m.steamPriority).toBe("works");
    expect(m.shinies).toEqual([{ id: 6, x: 0.1, y: 0.5, res: "coins", until: 9 }]);
  });

  it("MIGRATIONS run in order from the save's version (a test-only registry step is applied)", () => {
    const raw = v2Raw();
    (raw as { charters: number }).charters = 4;
    const registry = {
      ...MIGRATIONS,
      2: (r: Record<string, unknown>) => {
        MIGRATIONS[2](r);
        (r.meta as Record<string, unknown>).crowns = (r as { charters: number }).charters * 100;
      },
    };
    expect(migrate(structuredClone(raw), registry).meta.crowns).toBe(400);
    expect(migrate(structuredClone(raw)).meta.crowns).toBe((raw.meta as { crowns: number }).crowns);
  });

  it("a tampered district index loads bounded: a short visited list, a save that still fits (perf-saves-6)", () => {
    const raw = JSON.parse(serialize(playedState())) as Record<string, unknown>;
    const meta = raw.meta as Record<string, unknown>;
    meta.district = 2e6;
    meta.history = [{ district: 1e10, seconds: 3600, eRun: 2e6, crowns: 14, zones: {}, bestRating: "gold" }];
    const m = deserialize(JSON.stringify(raw))!;
    expect(m.meta.district).toBe(MAX_DISTRICT);
    expect(m.meta.visited).toHaveLength(MAX_DISTRICT + 1);
    expect(m.meta.districtId).toBe(m.meta.visited[MAX_DISTRICT]);
    expect(m.meta.history[0].district).toBe(MAX_DISTRICT);
    const str = serialize(m);
    expect(str.length).toBeLessThan(100_000); // was 24 MB (and 2 s to write), over the localStorage quota
    expect(deserialize(str)!.meta.visited).toEqual(m.meta.visited);

    // garbage indexes: never a corrupt save (1e10 used to throw a RangeError), always a whole run index
    for (const [bad, want] of [[1e10, MAX_DISTRICT], [INF_TOKEN, 0], [NINF_TOKEN, 0], [-5, 0], [2.7, 2]] as const) {
      meta.district = bad;
      const got = deserialize(JSON.stringify(raw));
      expect(got, String(bad)).not.toBeNull();
      expect(got!.meta.district, String(bad)).toBe(want);
      expect(got!.meta.visited, String(bad)).toHaveLength(want + 1);
    }
  });

  it("v2 → v3 with a tampered district: the migration builds a bounded list and names the chronicle's district", () => {
    const raw = v2Raw();
    const meta = raw.meta as Record<string, unknown>;
    meta.district = 1e10;
    meta.history = [{ district: 1e10, seconds: 3600, eRun: 2e6, crowns: 14, zones: {}, bestRating: "gold" }];
    const m = deserialize(JSON.stringify(raw))!;
    expect(m).not.toBeNull();
    expect(m.meta.district).toBe(MAX_DISTRICT);
    expect(m.meta.visited).toHaveLength(MAX_DISTRICT + 1);
    expect(m.meta.history[0].districtId).toBe(legacyDistrictId(MAX_DISTRICT));
    expect(m.meta.history[0].district).toBe(MAX_DISTRICT);
  });

  it("importAny takes both the export string and the raw save file", () => {
    const s = playedState();
    expect(importAny(serialize(s))).toEqual({ ...s, scene: null });
    expect(importAny(exportString(s))).toEqual({ ...s, scene: null });
    expect(importAny("hello")).toBeNull();
  });
});
