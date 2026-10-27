import { afterEach, describe, expect, it, vi } from "vitest";
import { GRATE_RAIN_TOAST } from "../data/events";
import { onFx } from "../fx";
import { useGame } from "../store";
import type { EngineCtx, Fx, GameState } from "../types";
import { openZone } from "./actions";
import { onZoneOpen } from "./events";
import { creditHold } from "./hold";
import { hash01 } from "./rng";
import { serialize } from "./save";
import { createInitialState } from "./state";
import { step, TICK } from "./step";
import { metroState } from "./testkit";

/**
 * v3 ENG-5 review fixes: what a held clock does to trains and the carriage (store.creditShortHold, creditHold's
 * "pause" and "catchUp", a reload), on the real store.
 */

type Soon = Extract<Fx, { k: "trainSoon" }>;
const soons = (fx: Fx[]) => fx.filter((f): f is Soon => f.k === "trainSoon");

/** Hand the store a state to tick (no save, no lock: node has neither). */
function adopt(s: GameState): void {
  useGame.setState({ game: s, ready: true, ceremony: false, crashed: false, crashError: null, saveIssue: null, offlineReport: null });
}

/** The fx the store emits while `fn` runs. */
function record(fn: () => void): Fx[] {
  const got: Fx[] = [];
  const off = onFx((f) => got.push(f));
  try {
    fn();
  } finally {
    off();
  }
  return got;
}

/** `n` single store ticks (a visible tab, nobody at the controls); the fx they emitted, each with the run time after it. */
function storeTicks(n: number): { fx: Fx; t: number }[] {
  const out: { fx: Fx; t: number }[] = [];
  for (let i = 0; i < n; i++) {
    const fx = record(() => useGame.getState().advance(1, false));
    const t = useGame.getState().game.time;
    for (const f of fx) out.push({ fx: f, t });
  }
  return out;
}

/** A colony before the Metro (Sewers and Cellars) with every event parked; the first capsule and carriage still ahead. */
function sewersState(seed = 12): GameState {
  const s = createInitialState(seed, 0);
  const ctx: EngineCtx = { fx: [] };
  for (const z of ["sewers", "cellars"] as const) {
    openZone(s, z, ctx);
    onZoneOpen(s, z);
  }
  s.time = 1200;
  s.flags.vagrants = true;
  s.rats = 40;
  s.jobs.forager = 40;
  s.res.crumbs = 1e5;
  for (const k of ["carriage", "capsule", "purse", "shiny", "market", "downpour", "cat", "catForcedAt"] as const) s.timers[k] = Infinity;
  return s;
}

/** A run time whose deferral hashes put the metro train before (or after) the express. */
function timeWithMetroFirst(metroFirst: boolean): number {
  for (let k = 3000; ; k++) if (hash01(1, k) < hash01(2, k) === metroFirst) return k / 10;
}

afterEach(() => {
  vi.unstubAllGlobals();
  useGame.setState({ ceremony: false, crashed: false, saveIssue: null, offlineReport: null });
});

describe("ENG-5 review: a short hold plays nothing out unattended", () => {
  it("the capsule (the train before the Metro) is deferred like a metro train: the ×2 first capsule waits for the player", () => {
    const s = sewersState();
    s.timers.capsule = s.time + 10;
    adopt(s);
    const fx = record(() => useGame.getState().creditShortHold(40));
    const g = useGame.getState().game;
    expect(g.time).toBeCloseTo(1240, 6);
    expect(g.stats.capsules).toBe(0);
    expect(g.flags.first_capsule).toBeFalsy();
    expect(g.scene).toBeNull();
    expect(fx.some((f) => f.k === "sceneStart" || f.k === "trainSoon")).toBe(false);
    const left = g.timers.capsule - g.time;
    expect(left).toBeGreaterThanOrEqual(15 - 1e-9);
    expect(left).toBeLessThanOrEqual(25 + 1e-9);
    // «К путям!» on the first tick back, with the real countdown
    const after = storeTicks(10);
    const soon = soons(after.map((x) => x.fx));
    expect(soon.length).toBe(1);
    expect(soon[0].id).toBe("capsule");
    expect(soon[0].inSec).toBe(Math.round(g.timers.capsule - after.find((x) => x.fx === soon[0])!.t));
  });

  it("the first carriage (the catch tutorial) is not spent in a hidden tab: it waits and comes as the lesson", () => {
    const s = createInitialState(13, 0);
    s.time = 180;
    s.timers.carriage = s.time + 5;
    for (const k of ["purse", "shiny"] as const) s.timers[k] = Infinity;
    adopt(s);
    const fx = record(() => useGame.getState().creditShortHold(30));
    const g = useGame.getState().game;
    expect(g.flags.first_carriage).toBeFalsy();
    expect(g.stats.carriages).toBe(0);
    expect(g.scene).toBeNull();
    expect(fx.some((f) => f.k === "sceneStart" || f.k === "toast")).toBe(false);
    const left = g.timers.carriage - g.time;
    expect(left).toBeGreaterThanOrEqual(15 - 1e-9);
    expect(left).toBeLessThanOrEqual(25 + 1e-9);
    // back at the screen: it starts as the tutorial's 'warn'
    storeTicks(Math.ceil(left / TICK) + 1);
    const sc = useGame.getState().game.scene;
    expect(sc?.id).toBe("carriage");
    expect(sc?.tutorial).toBe(true);
    expect(sc?.phase).toBe("warn");
  });

  it("after the Metro no grate rain falls into a short hold (no «лови!» for shinies already swept)", () => {
    const s = metroState(14, { quiet: true });
    for (const k of ["downpour", "cat", "catForcedAt"] as const) s.timers[k] = Infinity;
    s.flags.first_carriage = true;
    s.timers.carriage = s.time + 5;
    const carriages = s.stats.carriages;
    adopt(s);
    const fx = record(() => useGame.getState().creditShortHold(40));
    const g = useGame.getState().game;
    expect(fx.some((f) => f.k === "toast" && f.text === GRATE_RAIN_TOAST.text)).toBe(false);
    expect(g.stats.carriages).toBe(carriages);
    expect(g.shinies.filter((x) => x.kind === "carriage")).toEqual([]);
    expect(g.carriagePass).toBeNull();
    expect(g.timers.carriage - g.time).toBeGreaterThanOrEqual(15 - 1e-9);
    expect(g.timers.carriage - g.time).toBeLessThanOrEqual(25 + 1e-9);
  });
});

describe("ENG-5 review: «К путям!» after a short hold", () => {
  it("a train due 15–30 s after the credit is announced once on return with the real countdown, not the credit tick's 30", () => {
    const s = metroState(15, { quiet: true });
    s.timers.metro_train = s.time + 58;
    adopt(s);
    const fx = record(() => useGame.getState().creditShortHold(40));
    expect(soons(fx)).toEqual([]);
    const g = useGame.getState().game;
    expect(g.timers.metro_train - g.time).toBeCloseTo(18, 6); // not deferred: 18 s is room enough
    const after = storeTicks(10);
    const soon = soons(after.map((x) => x.fx));
    expect(soon).toEqual([{ k: "trainSoon", id: "metro_train", inSec: 18 }]);
  });

  for (const metroFirst of [true, false]) {
    it(`metro and express both deferred (${metroFirst ? "metro" : "express"} first): one «К путям!», for the earliest, with its real countdown`, () => {
      const s = metroState(16, { quiet: true });
      s.time = timeWithMetroFirst(metroFirst);
      s.zones.terminal = true;
      s.buildings.express_depot = 1;
      for (const k of ["downpour", "cat", "catForcedAt", "ratcatcherAt", "fog"] as const) s.timers[k] = Infinity;
      s.timers.metro_train = s.time + 10;
      s.timers.royal_express = s.time + 20;
      adopt(s);
      const fx = record(() => useGame.getState().creditShortHold(40));
      const g = useGame.getState().game;
      expect(g.stats.trains).toBe(s.stats.trains);
      const first = g.timers.metro_train < g.timers.royal_express ? "metro_train" : "royal_express";
      expect(first).toBe(metroFirst ? "metro_train" : "royal_express");
      const after = storeTicks(10);
      const soon = soons([...fx, ...after.map((x) => x.fx)]);
      expect(soon.length).toBe(1);
      expect(soon[0].id).toBe(first);
      const at = after.find((x) => x.fx === soon[0])!.t;
      expect(soon[0].inSec).toBe(Math.round(g.timers[first] - at));
    });
  }

  it("a 1.2 s alt-tab keeps a whistled, announced train where it is (no reset countdown, the whistle not undone)", () => {
    const s = metroState(17, { quiet: true });
    for (const k of ["downpour", "cat", "catForcedAt", "ratcatcherAt", "fog"] as const) s.timers[k] = Infinity;
    s.res.coins = 1000;
    s.timers.metro_train = s.time + 28;
    adopt(s);
    useGame.getState().whistle();
    const g0 = useGame.getState().game;
    expect(g0.res.coins).toBe(900);
    const at = g0.timers.metro_train;
    expect(at - g0.time).toBeCloseTo(5, 6);
    const warned = soons(storeTicks(3).map((x) => x.fx));
    expect(warned.map((f) => f.id)).toEqual(["metro_train"]);
    let how = "";
    const fx = record(() => (how = creditHold(useGame.getState(), 1.2, false)));
    expect(how).toBe("ticks");
    const g = useGame.getState().game;
    expect(g.timers.metro_train).toBe(at);
    expect(g.timers.whistleUsedFor).toBe(at);
    expect(soons(fx)).toEqual([]);
    expect(soons(storeTicks(5).map((x) => x.fx))).toEqual([]);

    // the same train due before the player is back from a 10 s alt-tab: deferred (the whistle with it), warned again
    expect(at - useGame.getState().game.time).toBeLessThan(10 + 1);
    const fx2 = record(() => creditHold(useGame.getState(), 10, false));
    const g2 = useGame.getState().game;
    expect(g2.stats.trains).toBe(s.stats.trains);
    expect(g2.scene).toBeNull();
    expect(g2.timers.metro_train - g2.time).toBeGreaterThanOrEqual(15 - 1e-9);
    expect(g2.timers.whistleUsedFor).toBe(g2.timers.metro_train);
    expect(soons(fx2)).toEqual([]);
    expect(soons(storeTicks(1).map((x) => x.fx)).map((f) => f.id)).toEqual(["metro_train"]);
  });
});

describe("ENG-5 review: a pause, a reload and a long ceremony", () => {
  it("after a pause under a ceremony «К путям!» is said again with the real countdown; a stalled frame changes nothing", () => {
    const s = metroState(18, { quiet: true });
    for (const k of ["downpour", "cat", "catForcedAt", "ratcatcherAt", "fog"] as const) s.timers[k] = Infinity;
    s.timers.metro_train = s.time + 20;
    adopt(s);
    expect(soons(storeTicks(1).map((x) => x.fx)).length).toBe(1);
    const t = useGame.getState().game.time;
    expect(creditHold(useGame.getState(), 0.4, true)).toBe("pause");
    expect(soons(storeTicks(1).map((x) => x.fx))).toEqual([]);
    expect(creditHold(useGame.getState(), 40, true)).toBe("pause");
    expect(useGame.getState().game.time).toBeCloseTo(t + TICK, 6); // a pause credits nothing
    const again = soons(storeTicks(1).map((x) => x.fx));
    expect(again).toEqual([{ k: "trainSoon", id: "metro_train", inSec: Math.round(s.timers.metro_train - (t + 2 * TICK)) }]);
    expect(soons(storeTicks(5).map((x) => x.fx))).toEqual([]);
  });

  it("a quick reload (≤ 5 s, no catch-up) says «К путям!» again for a train announced before it", () => {
    const s = metroState(19, { quiet: true });
    for (const k of ["downpour", "cat", "catForcedAt", "ratcatcherAt", "fog"] as const) s.timers[k] = Infinity;
    s.timers.metro_train = s.time + 25;
    const ctx: EngineCtx = { fx: [] };
    step(s, TICK, { active: false }, ctx);
    expect(soons(ctx.fx).length).toBe(1);
    expect(s.timers.toastFor).toBe(s.timers.metro_train);
    s.lastSaved = Date.now() - 2000;
    const raw = serialize(s);
    vi.stubGlobal("localStorage", { getItem: () => raw, setItem: () => {}, removeItem: () => {} });
    useGame.setState({ ready: false, crashed: false, saveIssue: null });
    useGame.getState().init();
    expect(useGame.getState().offlineReport).toBeNull();
    expect(useGame.getState().game.time).toBeCloseTo(s.time, 6);
    const soon = soons(storeTicks(1).map((x) => x.fx));
    expect(soon).toEqual([{ k: "trainSoon", id: "metro_train", inSec: Math.round(s.timers.metro_train - s.time - TICK) }]);
  });

  it("a ceremony watched for over a minute is caught up without «Пока вас не было»; a hidden tab keeps its report", () => {
    const s = metroState(20, { quiet: true });
    adopt(s);
    expect(creditHold(useGame.getState(), 90, true, false, false)).toBe("catchUp");
    expect(useGame.getState().game.time).toBeGreaterThan(s.time + 80);
    expect(useGame.getState().offlineReport).toBeNull();
    expect(creditHold(useGame.getState(), 90, true, false, true)).toBe("catchUp");
    expect(useGame.getState().offlineReport?.elapsed).toBe(90);
    // and the default (the sleep-gap path: the machine slept) reports too
    useGame.setState({ offlineReport: null });
    expect(creditHold(useGame.getState(), 75, false)).toBe("catchUp");
    expect(useGame.getState().offlineReport?.elapsed).toBe(75);
  });
});
