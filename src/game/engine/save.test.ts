import { describe, expect, it } from "vitest";
import type { EngineCtx, GameState } from "../types";
import { buyBuilding, click } from "./actions";
import { derive } from "./derive";
import { deserialize, exportString, importString, migrate, serialize } from "./save";
import { createInitialState } from "./state";
import { step, TICK } from "./step";

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
