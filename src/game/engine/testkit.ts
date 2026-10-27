/**
 * Shared test kit (v3 ENG-7): the colony builders the engine tests used to copy into every file, the golden save
 * fixtures (scripts/capture-fixtures.ts → __fixtures__/saves/*.json) and the plain-data checks behind the store's
 * clone (ENG-6). Test-only: nothing in the game imports it (it reads the fixtures with node:fs and drives the sim bot).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { EngineCtx, GameState, SceneEventId } from "../types";
import { buyBuilding, click, openZone } from "./actions";
import { cloneState } from "./clone";
import { derive } from "./derive";
import { onZoneOpen } from "./events";
import { deserialize, isNewerSave } from "./save";
import { createInitialState } from "./state";
import { step, TICK } from "./step";

/* ------------------------------------------------------------ colonies */

export interface MetroOpts {
  /** No metro train, carriage, purse, shiny or market scheduled (timers at Infinity): nothing interrupts a test. */
  quiet?: boolean;
}

/**
 * A colony on the metro station: Sewers, Cellars and Metro opened through the real hooks (openZone + onZoneOpen),
 * vagrants arrived, past its ×3 first train; 200 rats, all foragers, 1e5 🍞.
 */
export function metroState(seed = 99, opts: MetroOpts = {}): GameState {
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
  if (opts.quiet) for (const k of ["metro_train", "carriage", "purse", "shiny", "market"] as const) s.timers[k] = Infinity;
  return s;
}

/** One minute of active play from a fresh colony (seed 31337): a click every third tick, a nest every 5 s. */
export function playedState(): GameState {
  const s = createInitialState(31337, 1_700_000_000_000);
  const ctx: EngineCtx = { fx: [] };
  for (let i = 0; i < 600; i++) {
    step(s, TICK, { active: true }, ctx);
    if (i % 3 === 0) click(s, derive(s), ctx);
    if (i % 50 === 0) buyBuilding(s, derive(s), "nest", 1, ctx);
  }
  return s;
}

/** `n` plain ticks (no bot, no clicks); returns the fx they produced. */
export function ticks(s: GameState, n: number, active = false): EngineCtx["fx"] {
  const ctx: EngineCtx = { fx: [] };
  for (let i = 0; i < n; i++) step(s, TICK, { active }, ctx);
  return ctx.fx;
}

/** Start an event on the next tick, the way store.devTrigger does. */
export function triggerEvent(s: GameState, id: SceneEventId | "purse" | "market"): void {
  if (id === "purse") s.timers.purse = s.time;
  else if (id === "market") s.timers.market = s.time;
  else if (id === "cat") s.timers.catForcedAt = s.time;
  else if (id === "ratcatcher") s.timers.ratcatcherAt = s.time;
  else if (id === "downpour") s.timers.downpour = s.time;
  else s.timers[id] = s.time;
  s.timers.lastSceneEnd = -999;
}

/**
 * Force each event in turn and let the active sim bot play it (at most `maxTicks` each), every tick on cloneState of
 * a deep-frozen previous state: a write that reaches the original (a shared object, a cached reference) throws.
 * Resolves to the scenes that started and the (frozen) end state. Async: the bot is loaded only by the tests that tour.
 */
export async function tourScenes(
  start: GameState,
  kinds: (SceneEventId | "purse" | "market")[],
  maxTicks: number,
): Promise<{ seen: Set<SceneEventId>; end: GameState }> {
  const { Bot } = await import("../../../scripts/sim-core");
  let prev = deepFreeze(start);
  const bot = new Bot("active", 7);
  const ctx: EngineCtx = { fx: [] };
  const seen = new Set<SceneEventId>();
  for (const id of kinds) {
    const s0 = cloneState(prev);
    triggerEvent(s0, id);
    // a train due soon would hold a background event back (scheduler guard): keep the trains away from it
    if (id !== "metro_train" && id !== "royal_express")
      for (const k of ["metro_train", "royal_express"] as const) s0.timers[k] = Math.max(s0.timers[k], s0.time + 300);
    prev = deepFreeze(s0);
    for (let i = 0; i < maxTicks; i++) {
      const s = cloneState(prev);
      const d = step(s, TICK, { active: true }, ctx);
      bot.tick(s, ctx, d);
      for (const f of ctx.fx) if (f.k === "sceneStart") seen.add(f.id);
      ctx.fx.length = 0;
      prev = deepFreeze(s);
      if (i > 20 && !s.scene) break;
    }
  }
  assertPlain(prev);
  return { seen, end: prev };
}

/* ------------------------------------------------------------ golden saves */

/** Where scripts/capture-fixtures.ts writes the golden saves (names start with the schema version that wrote them). */
export const FIXTURE_DIR = join(__dirname, "__fixtures__", "saves");

/** Every fixture name (file name without .json), sorted. */
export function fixtureNames(): string[] {
  return readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -5))
    .sort();
}

/** The stored save string of a fixture, as the game would find it in localStorage. */
export function rawFixture(name: string): string {
  return readFileSync(join(FIXTURE_DIR, `${name}.json`), "utf8").trim();
}

/** A fixture loaded the way the game loads a save (save.ts deserialize: migrations, defaults, sanitizing). Throws if it does not load. */
export function loadFixture(name: string): GameState {
  const s = deserialize(rawFixture(name));
  if (!s) throw new Error(`fixture ${name}: unreadable`);
  if (isNewerSave(s)) throw new Error(`fixture ${name}: written by a newer schema (${s.version})`);
  return s;
}

/* ------------------------------------------------------------ plain data (ENG-6) */

/**
 * Paths in `v` that are not plain JSON-like data (GameState rule, ARCHITECTURE «Состояние и стор»): anything but
 * objects with Object/null prototype, arrays, finite or infinite numbers, strings, booleans and null. Empty = plain.
 */
export function nonPlainPaths(v: unknown, path = "s", out: string[] = []): string[] {
  if (v === null || typeof v === "string" || typeof v === "boolean") return out;
  if (typeof v === "number") {
    if (Number.isNaN(v)) out.push(`${path}: NaN`);
    return out;
  }
  if (Array.isArray(v)) {
    if (Object.getPrototypeOf(v) !== Array.prototype) out.push(`${path}: array subclass`);
    v.forEach((x, i) => nonPlainPaths(x, `${path}[${i}]`, out));
    return out;
  }
  if (typeof v === "object") {
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) {
      out.push(`${path}: ${(v as object).constructor?.name ?? "class instance"}`);
      return out;
    }
    for (const [k, x] of Object.entries(v)) {
      if (x === undefined) out.push(`${path}.${k}: undefined`);
      else nonPlainPaths(x, `${path}.${k}`, out);
    }
    return out;
  }
  out.push(`${path}: ${typeof v}`);
  return out;
}

/** Freeze `v` and everything under it: in strict-mode code (all ES modules) any later write to it throws. */
export function deepFreeze<T>(v: T): T {
  if (typeof v === "object" && v !== null && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const x of Object.values(v)) deepFreeze(x);
  }
  return v;
}

/** Object references that `a` and `b` have in common (a deep copy must have none). */
export function sharedObjects(a: unknown, b: unknown): number {
  const seen = new Set<object>();
  const collect = (v: unknown) => {
    if (typeof v !== "object" || v === null || seen.has(v)) return;
    seen.add(v);
    for (const x of Object.values(v)) collect(x);
  };
  collect(a);
  let n = 0;
  const visit = (v: unknown) => {
    if (typeof v !== "object" || v === null) return;
    if (seen.has(v)) n++;
    for (const x of Object.values(v)) visit(x);
  };
  visit(b);
  return n;
}

/** Throws unless `s` is plain data (see nonPlainPaths). */
export function assertPlain(s: unknown): void {
  const bad = nonPlainPaths(s);
  if (bad.length) throw new Error(`not plain data: ${bad.slice(0, 5).join("; ")}`);
}

/** Numbers that must be finite but are not: NaN anywhere, ±Infinity outside the scheduler's "never" sentinels (s.timers). */
export function nonFinitePaths(s: GameState): string[] {
  const out: string[] = [];
  const walk = (v: unknown, path: string) => {
    if (typeof v === "number") {
      if (Number.isNaN(v) || (!Number.isFinite(v) && !INFINITY_OK.some((re) => re.test(path)))) out.push(`${path}=${v}`);
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
  };
  walk(s, "s");
  return out;
}

/** Where ±Infinity is a legitimate value ("never" / "not yet"). */
const INFINITY_OK: RegExp[] = [/^s\.timers\./];
