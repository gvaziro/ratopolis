import {
  CAPSULE_DROPS_CELLARS,
  CHEESE_CAR,
  CREW_POSITIONS,
  EVENT_LINE_POOLS,
  EVENT_LINES,
  EVENT_TIMING as T,
  HOOK_JACKPOT,
  HOOK_JACKPOT_CAP_SEC,
  LANTERN_MULT,
  LINE_DESTS,
  METRO_BASE_CARS,
  POSITION_FEEL,
  PURSE_OUTCOMES,
  RANDOM_CAR_WEIGHTS,
  RATING_TABLE,
  TRAIN_CARS,
  TRAIN_VARIANT_ORDER,
  TRAIN_VARIANTS,
} from "../data/events";
import { pickHumanHeadline } from "../data/headlines";
import { districtTrait } from "../data/zones";
import { RESOURCES } from "../data/resources";
import { BUILDINGS } from "../data/buildings";
import {
  BUILDING_IDS,
  T1,
  type Amounts,
  type BuildingId,
  type CatchItem,
  type CatchResult,
  type EngineCtx,
  type GameState,
  type HaulSummary,
  type LinePair,
  type ResId,
  type Scene,
  type SceneAction,
  type SceneEventId,
  type ScenePhase,
  type TickInput,
  type TrainCarDef,
  type TrainCarKind,
  type TrainVariantId,
  type ZoneId,
} from "../types";
import { fmtTime, plural } from "../../lib/format";
import { check } from "./conditions";
import { addAmounts, award, gain, gainAll, news, pushNews, stun, toast } from "./core";
import { eventValue, type Derived } from "./derive";
import { buildingCost, entries, humanClock, marketValue } from "./formulas";
import { chance, hash01, pickWeighted, rand, randInt, randRange } from "./rng";

type TrainId = "capsule" | "metro_train" | "royal_express";
const TRAIN_IDS: TrainId[] = ["capsule", "metro_train", "royal_express"];

export function isTrainScene(id: SceneEventId): id is TrainId {
  return id === "capsule" || id === "metro_train" || id === "royal_express";
}

export function trainActive(s: GameState, id: TrainId): boolean {
  if (id === "capsule") return !!s.zones.sewers && !s.zones.metro;
  if (id === "metro_train") return !!s.zones.metro;
  return !!s.zones.terminal && s.buildings.express_depot >= 1;
}

/** Earliest upcoming train-like event. */
export function nextTrain(s: GameState): { id: TrainId; at: number } | null {
  let best: { id: TrainId; at: number } | null = null;
  for (const id of TRAIN_IDS) {
    if (!trainActive(s, id)) continue;
    const at = s.timers[id];
    if (!Number.isFinite(at)) continue;
    if (!best || at < best.at) best = { id, at };
  }
  return best;
}

function jitter(s: GameState, mean: number, j: number): number {
  return mean + randRange(s, -j, j);
}

function between(s: GameState, range: readonly [number, number] | readonly number[]): number {
  return randRange(s, range[0], range[1]);
}

/* ================================================================ zone hooks */

export function onZoneOpen(s: GameState, zone: ZoneId): void {
  const t = s.time;
  if (zone === "sewers") {
    s.timers.capsule = t + T.capsuleFirstAfterSewers;
    s.timers.downpour = t + between(s, T.downpourInterval);
  } else if (zone === "cellars") {
    s.timers.catForcedAt = t + T.catFirstAfterCellars;
    s.timers.cat = t + T.catCheck;
    s.timers.market = t + between(s, districtTrait(s.meta.district).mods.marketInterval ?? T.marketInterval);
  } else if (zone === "metro") {
    s.timers.capsule = Infinity;
    s.timers.metro_train = t + T.metroFirstAfterOpen;
  }
}

/* ================================================================ tick */

export function tickEvents(s: GameState, d: Derived, dt: number, input: TickInput, ctx: EngineCtx): void {
  if (input.offline) return;
  const t = s.time;

  // express timer appears with the first depot: v2 (EN-6) the first one comes 90 s later, then every interval
  if (trainActive(s, "royal_express") && !Number.isFinite(s.timers.royal_express)) s.timers.royal_express = t + T.expressFirstAfterDepot;

  // ---- suspicion (from cellars, only while the player is active)
  // EN-12 «Щепки от дудки»: the King wants the piper, so the colony gets noticed three times faster
  const piperWanted = d.commission === "pipe_splinters" ? 3 : 1;
  if (s.zones.cellars && input.active) s.suspicion = Math.min(100, s.suspicion + (dt / 60) * d.suspicionMult * piperWanted);
  // EN-12 «Дважды по усам»: a cat comes two minutes after the last one
  if (d.commission === "whiskers_twice" && s.zones.cellars && !d.silence && !Number.isFinite(s.timers.catForcedAt) && s.scene?.id !== "cat") s.timers.catForcedAt = t + 120;
  if (s.suspicion >= d.ratcatcherAt && !d.silence && !Number.isFinite(s.timers.ratcatcherAt) && s.scene?.id !== "ratcatcher") {
    s.timers.ratcatcherAt = t + T.ratcatcherDelay;
    toast(ctx, `Подозрение ${Math.round(d.ratcatcherAt)}%! Сверху доносится дудочка…`, "🎶", "bad");
  }

  // ---- background events
  tickBackground(s, d, dt, ctx);

  // ---- running scene
  if (s.scene) {
    advanceScene(s, d, ctx);
  }

  // ---- "К путям!" toast 30 s before a train
  const nt = nextTrain(s);
  if (nt && nt.at - t <= 30 && nt.at - t > 0 && s.timers.toastFor !== nt.at && !s.scene) {
    s.timers.toastFor = nt.at;
    ctx.fx.push({ k: "trainSoon", id: nt.id, inSec: Math.round(nt.at - t) });
  }

  // ---- start a new scene
  if (!s.scene) {
    if (nt && nt.at <= t) {
      startTrain(s, d, nt.id, ctx);
      return;
    }
    const gapOk = t - s.timers.lastSceneEnd >= T.minSceneGap;
    const trainSoon = nt !== null && nt.at - t < T.trainGuard;
    if (!gapOk) return;
    // a train always close (a fast Royal Express: Биг-Бен, the railway seal) would starve the background events for
    // good: one overdue by T.backgroundStarve goes first anyway, and the train waits a guard interval for it
    const due = (at: number) => at <= t && (!trainSoon || at <= t - T.backgroundStarve);
    const start = (fn: () => void) => {
      if (trainSoon && nt) {
        const at = Math.max(nt.at, t + T.trainGuard);
        if (s.timers.whistleUsedFor === nt.at) s.timers.whistleUsedFor = at;
        s.timers[nt.id] = at;
      }
      fn();
    };

    if (input.active && s.timers.ratcatcherAt <= t && d.silence) s.timers.ratcatcherAt = Infinity;
    if (input.active && due(s.timers.ratcatcherAt)) {
      start(() => startRatcatcher(s, d, ctx));
      return;
    }
    if (s.zones.cellars && input.active && !d.silence) {
      if (due(s.timers.catForcedAt)) {
        start(() => startCat(s, d, ctx));
        return;
      }
      if (!trainSoon && s.timers.cat <= t) {
        s.timers.cat = t + T.catCheck;
        if (s.suspicion >= 30 && chance(s, ((s.suspicion - 20) / 100) * d.catMult)) {
          startCat(s, d, ctx);
          return;
        }
      }
    }
    if (s.zones.sewers && input.active && due(s.timers.downpour)) {
      start(() => startDownpour(s, d, ctx));
      return;
    }
    if (due(s.timers.carriage)) {
      start(() => startCarriage(s, d, ctx));
      return;
    }
  }
}

/* ================================================================ background */

/**
 * Purse, shinies and Benedict's stall. A scene covers the colony (the whole screen on phones), so while one runs
 * their lifetimes stand still and no new purse/shiny appears; timers that fall due meanwhile fire right after it.
 */
function tickBackground(s: GameState, d: Derived, dt: number, ctx: EngineCtx): void {
  const t = s.time;
  const sceneUp = !!s.scene;

  // purse
  if (s.purse && sceneUp) s.purse.until += dt;
  if (s.purse && s.purse.until <= t) s.purse = null;
  if (!s.purse && t >= s.timers.purse && !sceneUp && s.flags.vagrants) {
    s.purse = { x: randRange(s, 0.15, 0.85), y: randRange(s, 0.4, 0.85), until: t + T.purseLife };
    s.timers.purse = t + between(s, T.purseInterval) / d.purseFreq / (d.commission === "purse_season" ? 2 : 1);
    markSeen(s, "purse");
  }

  // shinies
  if (sceneUp) for (const x of s.shinies) x.until += dt;
  if (s.shinies.length) s.shinies = s.shinies.filter((x) => x.until > t);
  if (t >= s.timers.shiny && s.flags.vagrants && !sceneUp) {
    const pool = T1.filter((r) => check(s, RESOURCES[r].reveal));
    const res = pool[Math.floor(rand(s) * pool.length)] ?? "crumbs";
    s.shinies.push({ id: ++s.sceneSeq, x: randRange(s, 0.1, 0.9), y: randRange(s, 0.45, 0.9), res, until: t + T.shinyLife });
    s.timers.shiny = t + between(s, t > 1800 ? T.shinyIntervalLate : T.shinyInterval);
    markSeen(s, "shiny");
  }

  // market
  if (s.market && sceneUp) s.market.until += dt;
  if (s.market && s.market.until <= t) s.market = null;
  if (s.zones.cellars && !s.market && t >= s.timers.market) {
    const deals = makeDeals(s, d);
    if (deals.length) {
      s.market = { id: ++s.sceneSeq, until: t + T.marketLife, deals };
      news(s, "market", {}, ctx);
      toast(ctx, "Барыга Бенедикт открыл лавку у решётки", "🧺", "info");
      markSeen(s, "market");
    }
    s.timers.market = t + between(s, d.marketInterval);
  }
}

function markSeen(s: GameState, id: Scene["id"] | "purse" | "shiny" | "market"): void {
  if (!s.meta.seenEvents.includes(id)) s.meta.seenEvents.push(id);
}

/* ================================================================ market */

const TRADABLE: ResId[] = ["crumbs", "coins", "buttons", "wire", "gears", "cheese", "coal", "brass", "rails"];

function makeDeals(s: GameState, d: Derived) {
  const revealed = TRADABLE.filter((r) => check(s, RESOURCES[r].reveal));
  if (revealed.length < 2) return [];
  // give: fullest storage first
  const fill = (r: ResId) => (Number.isFinite(d.caps[r]) ? s.res[r] / d.caps[r] : 0.3 * Math.min(1, s.res[r] / Math.max(1, s.ema[r] * 300)));
  const gives = [...revealed].sort((a, b) => fill(b) - fill(a));
  // get: largest shortfall towards visible unaffordable buildings
  const lack: Partial<Record<ResId, number>> = {};
  for (const id of BUILDING_IDS) {
    const def = BUILDINGS[id];
    if (!s.zones[def.zone] || !check(s, def.unlock)) continue;
    if (def.maxLevel !== undefined && s.buildings[id] >= def.maxLevel) continue;
    const cost = buildingCost(id, s.buildings[id]);
    for (const [r, v] of entries(cost)) {
      const short = v - s.res[r];
      if (short > 0 && TRADABLE.includes(r)) lack[r] = (lack[r] ?? 0) + short * (RESOURCES[r].market ?? 1);
    }
  }
  const gets = [...revealed].sort((a, b) => (lack[b] ?? 0) - (lack[a] ?? 0));
  const deals = [];
  const used = new Set<string>();
  for (const give of gives) {
    for (const get of gets) {
      if (give === get || used.has(give + get)) continue;
      const giveAmt = Math.max(10, Math.floor(90 * Math.max(s.ema[give], eventValue(s, d, give))));
      const getAmt = Math.floor((giveAmt * (RESOURCES[give].market ?? 1) * 1.3) / (RESOURCES[get].market ?? 1));
      if (getAmt <= 0) continue;
      deals.push({ give, giveAmt, get, getAmt, done: false });
      used.add(give + get);
      break;
    }
    if (deals.length >= 3) break;
  }
  return deals;
}

export function marketDeal(s: GameState, d: Derived, i: number, ctx: EngineCtx): boolean {
  const m = s.market;
  if (!m) return false;
  const deal = m.deals[i];
  if (!deal || deal.done || s.res[deal.give] < deal.giveAmt) return false;
  s.res[deal.give] -= deal.giveAmt;
  gain(s, d, deal.get, deal.getAmt, true, ctx);
  deal.done = true;
  ctx.fx.push({ k: "drop", res: deal.get, amount: deal.getAmt, big: true });
  return true;
}

/* ================================================================ purse / shiny */

export function clickPurse(s: GameState, d: Derived, ctx: EngineCtx): void {
  if (!s.purse) return;
  s.purse = null;
  s.stats.purses++;
  s.meta.lifetime.purses++;
  const golden = d.purseEffect;
  const o = pickWeighted(s, Object.fromEntries(PURSE_OUTCOMES.map((x) => [x.id, x.weight])) as Record<string, number>);
  const def = PURSE_OUTCOMES.find((x) => x.id === o)!;
  // the buffs have no other on-screen explanation: the toast says what they do and for how long
  let what = "";
  if (o === "coins") {
    const amt = Math.max(30, 180 * eventValue(s, d, "coins"));
    gain(s, d, "coins", amt, true, ctx);
    ctx.fx.push({ k: "drop", res: "coins", amount: amt, big: true });
  } else if (o === "feast") {
    s.buffs.feastUntil = s.time + 30 * golden;
    what = ` Всё производство ×5 на ${Math.round(30 * golden)} с`;
  } else if (o === "paw") {
    s.buffs.luckyPawUntil = s.time + 12 * golden;
    what = ` Клик ×15 на ${Math.round(12 * golden)} с — жмите решётку!`;
  } else {
    const id = cheapestBuilding(s);
    if (id) {
      s.buildings[id] += 1;
      ctx.fx.push({ k: "buy", building: id, level: s.buildings[id] });
      what = ` Даром: «${BUILDINGS[id].name}» +1`;
    } else gain(s, d, "coins", Math.max(30, 180 * eventValue(s, d, "coins")), true, ctx);
  }
  ctx.fx.push({ k: "purse", outcome: o });
  toast(ctx, `Кошелёк: ${def.name}!${what}`, def.icon, "gold");
  if (!s.flags.first_purse) s.flags.first_purse = true;
  addSuspicion(s, d, 2);
  news(s, "purse", {}, ctx);
}

function cheapestBuilding(s: GameState): BuildingId | null {
  let best: BuildingId | null = null;
  let bestV = Infinity;
  for (const id of BUILDING_IDS) {
    const def = BUILDINGS[id];
    if (!s.zones[def.zone] || !check(s, def.unlock)) continue;
    if (def.maxLevel !== undefined && s.buildings[id] >= def.maxLevel) continue;
    const v = marketValue(buildingCost(id, s.buildings[id]));
    if (v < bestV) {
      bestV = v;
      best = id;
    }
  }
  return best;
}

export function clickShiny(s: GameState, d: Derived, id: number, ctx: EngineCtx): void {
  const i = s.shinies.findIndex((x) => x.id === id);
  if (i < 0) return;
  const sh = s.shinies[i];
  s.shinies.splice(i, 1);
  const amt = 30 * eventValue(s, d, sh.res);
  gain(s, d, sh.res, amt, true, ctx);
  ctx.fx.push({ k: "drop", res: sh.res, amount: amt, x: sh.x, y: sh.y, frac: true });
}

/* ================================================================ suspicion */

export function addSuspicion(s: GameState, d: Derived, amt: number): void {
  if (!s.zones.cellars) return;
  s.suspicion = Math.max(0, Math.min(100, s.suspicion + amt * d.suspicionMult));
}

/* ================================================================ scene skeleton */

function newScene(s: GameState, id: SceneEventId, phase: ScenePhase, duration: number): Scene {
  const sc = blankScene(s, id, phase, duration);
  pickLine(s, sc);
  return sc;
}

/* ---------------------------------------------------------------- scene lines (EN-6) */

/** hh:mm of the human clock (the header shows the same). */
function clockText(s: GameState): string {
  const c = humanClock(s);
  return `${String(c.hh).padStart(2, "0")}:${String(c.mm).padStart(2, "0")}`;
}

/** Resolve {time} {dest} {n} in a line pair for this scene. */
function resolveLine(s: GameState, sc: Scene, p: LinePair): LinePair {
  const time = clockText(s);
  const dest = LINE_DESTS[Math.floor(hash01(sc.seq, 7) * LINE_DESTS.length)] ?? LINE_DESTS[0];
  const n = String(
    sc.id === "metro_train" ? s.stats.trains + 1 : sc.id === "royal_express" ? s.stats.expresses + 1 : sc.id === "capsule" ? s.stats.capsules + 1 : sc.seq,
  );
  const f = (x: string) => x.replaceAll("{time}", time).replaceAll("{dest}", dest).replaceAll("{n}", n);
  return { human: f(p.human), rat: f(p.rat) };
}

/**
 * The scene's 👤/🐀 pair from EVENT_LINE_POOLS: lines never seen in the bestiary first, then anything but the last
 * few shown (s.recentLines), picked by a hash of the scene seq (no RNG draw). Recorded as seen in beginScene.
 */
function pickLine(s: GameState, sc: Scene): void {
  const pool = EVENT_LINE_POOLS[sc.id];
  if (!pool?.length) return;
  const all = pool.map((_, i) => i);
  const seen = s.meta.seenLines[sc.id] ?? [];
  const recent = s.recentLines[sc.id] ?? [];
  let cand = all.filter((i) => !seen.includes(i));
  if (!cand.length) cand = all.filter((i) => !recent.includes(i));
  if (!cand.length) cand = all;
  const idx = cand[Math.floor(hash01(sc.seq, 101) * cand.length)] ?? 0;
  sc.line = resolveLine(s, sc, pool[idx]);
  sc.lineIdx = idx;
}

/** Remember the scene's pool line: the bestiary's seen set and the no-repeat ring of the last 4. */
function recordLine(s: GameState, sc: Scene): void {
  if (sc.lineIdx === undefined) return;
  const seen = (s.meta.seenLines[sc.id] ??= []);
  if (!seen.includes(sc.lineIdx)) seen.push(sc.lineIdx);
  const ring = (s.recentLines[sc.id] ??= []);
  ring.push(sc.lineIdx);
  if (ring.length > 4) ring.splice(0, ring.length - 4);
}

function blankScene(s: GameState, id: SceneEventId, phase: ScenePhase, duration: number): Scene {
  return {
    id,
    seq: ++s.sceneSeq,
    phase,
    phaseStart: s.time,
    phaseEnds: s.time + duration,
    interactive: false,
    items: [],
    cars: [],
    position: s.trainPrefs.position,
    ready: false,
    nets: [],
    lantern: false,
    hookCar: -1,
    auto: 0,
    multiplier: 1,
    gained: {},
    piles: [],
    pileFractions: [],
    taps: null,
    choice: null,
    stats: { caught: 0, total: 0, caughtWeight: 0, totalWeight: 0, combo: 0, sparks: 0, lanternCaught: 0, hook: "none", hand: 0 },
    haul: null,
    itemLife: 2,
    perCar: 2,
    preCleared: 0,
    share: 0,
    ratingBonus: 0,
    crash: false,
    jackpot: false,
  };
}

function beginScene(s: GameState, sc: Scene, ctx: EngineCtx): void {
  s.scene = sc;
  markSeen(s, sc.id);
  recordLine(s, sc);
  ctx.fx.push({ k: "sceneStart", id: sc.id });
}

function enterPhase(s: GameState, sc: Scene, phase: ScenePhase, duration: number, ctx: EngineCtx): void {
  sc.phase = phase;
  sc.phaseStart = s.time;
  sc.phaseEnds = s.time + duration;
  ctx.fx.push({ k: "scenePhase", id: sc.id, phase });
}

function endScene(s: GameState, d: Derived, ctx: EngineCtx): void {
  const sc = s.scene;
  if (!sc) return;
  s.scene = null;
  s.timers.lastSceneEnd = s.time;
  if (sc.haul) {
    s.haulLog.unshift(sc.haul);
    if (s.haulLog.length > 10) s.haulLog.length = 10;
  }
  ctx.fx.push({ k: "sceneEnd", id: sc.id, haul: sc.haul });
  void d;
}

/* ================================================================ item generation */

function revealedRes(s: GameState, r: ResId): boolean {
  // EN-2: from the Metro on trains carry 💍 and 🔔 even before the first one is owned (the Terminal costs 💍 5)
  if ((r === "trinkets" || r === "brass") && s.zones.metro) return true;
  return check(s, RESOURCES[r].reveal) || s.resEver[r] > 0;
}

/** What a car drop of r turns into while r is not revealed yet: 🔔🛤️ → ⚙️, 💍 → 🪙, anything else → 🪙. */
export function trainDropRes(s: GameState, r: ResId): ResId {
  if (revealedRes(s, r)) return r;
  const alt: ResId = r === "brass" || r === "rails" ? "gears" : r === "trinkets" ? "coins" : r;
  return revealedRes(s, alt) ? alt : "coins";
}

function itemValue(s: GameState, d: Derived, r: ResId, S: number, mult: number, trinketPieces: number): number {
  if (r === "trinkets") return trinketPieces * d.lucky;
  const v = S * eventValue(s, d, r) * mult;
  return r === "blueprints" ? Math.max(1, v) : v;
}

interface FillOpts {
  mult: number;
  drops?: Partial<Record<ResId, number>>;
  S?: number;
  trinketPieces?: number;
  itemCount?: number;
  sparks?: number;
  special?: "cheese";
}

function fillCar(s: GameState, d: Derived, sc: Scene, def: TrainCarDef, carIndex: number, window: [number, number], opts: FillOpts): void {
  const ids: number[] = [];
  const drops = opts.drops ?? def.drops;
  const S = opts.S ?? def.S;
  const count = opts.itemCount ?? def.items;
  const sparks = opts.sparks ?? def.sparks;
  let nextId = sc.items.length;
  for (let k = 0; k < count; k++) {
    // 💍🔔 count as revealed from the Metro on (revealedRes), so 1st-class/baggage cars drop them before the first one is owned
    const r = trainDropRes(s, pickWeighted(s, drops) as ResId);
    const item: CatchItem = {
      id: nextId++,
      car: carIndex,
      res: r,
      value: itemValue(s, d, r, S, opts.mult, opts.trinketPieces ?? 1),
      weight: S,
      t: window[0] + rand(s) * (window[1] - window[0]),
    };
    sc.items.push(item);
    ids.push(item.id);
  }
  for (let k = 0; k < sparks; k++) {
    const item: CatchItem = { id: nextId++, car: carIndex, res: "coal", value: 0, weight: 0, spark: true, t: window[0] + rand(s) * (window[1] - window[0]) };
    sc.items.push(item);
    ids.push(item.id);
  }
  sc.cars.push(opts.special ? { kind: def.kind, itemIds: ids, special: opts.special } : { kind: def.kind, itemIds: ids });
  sc.piles.push({});
  sc.pileFractions.push(0);
}

/* ================================================================ trains */

/** Weight multiplier of a train variant (and the Cheddar car) never seen before. */
const VARIANT_DEBUT = 2.5;

/** Seconds of the «подмоченные запасы» buff after a lost downpour (the flooded window counts from its start). */
const SOGGY_SEC = 25;

/** Human clock 08:00–09:30: the rush hour (EN-6). */
export function rushHour(s: GameState): boolean {
  const m = humanClock(s).totalMin % (24 * 60);
  return m >= 8 * 60 && m < 9.5 * 60;
}

/** A downpour ended with a valve open within the last T.floodedWindow seconds (EN-6 «Подтопленные пути»). */
export function floodedTracks(s: GameState): boolean {
  if (!(s.buffs.soggyUntil > 0)) return false;
  const ended = s.buffs.soggyUntil - SOGGY_SEC;
  return s.time >= ended && s.time - ended <= T.floodedWindow;
}

/**
 * Variant of a metro train (EN-6): never the very first (×3) train; flooded tracks force «Подтопленные пути», the
 * rush hour gives «Час пик» with p = 0.6, then the weighted rows (mail 12%, freight 10%), else the plain train.
 */
export function pickVariant(s: GameState): TrainVariantId {
  if (!s.flags.first_train) return "normal";
  if (floodedTracks(s)) return "flooded";
  if (rushHour(s) && chance(s, TRAIN_VARIANTS.rush_hour.weight)) return "rush_hour";
  const r = rand(s);
  let acc = 0;
  for (const id of TRAIN_VARIANT_ORDER) {
    const v = TRAIN_VARIANTS[id];
    if (v.gate !== "always" || v.weight <= 0) continue;
    // a variant the colony has never met comes sooner (×VARIANT_DEBUT), so the first hour shows the variety
    acc += v.weight * (s.meta.variantLog[id] === undefined ? VARIANT_DEBUT : 1);
    if (r < acc) return id;
  }
  return "normal";
}

/** Cars of a metro train: METRO_BASE_CARS plus platform posts, edicts and the railway seal (Блумсбери −1), 3..11. */
export function metroCarCount(d: Derived): number {
  return Math.max(3, Math.min(11, METRO_BASE_CARS + d.trainExtraCars));
}

function trainComposition(s: GameState, d: Derived, id: TrainId, variant: TrainVariantId): TrainCarKind[] {
  if (id === "capsule") return Array.from({ length: d.capsuleCount }, () => "capsule" as const);
  const v = TRAIN_VARIANTS[variant];
  const weights = v.carWeights ?? RANDOM_CAR_WEIGHTS;
  const randomCar = (): TrainCarKind => pickWeighted(s, weights);
  if (id === "metro_train") {
    // v2 (EN-2): a base train is 4 cars (engine, tender 70%, the rest random); platform posts, edicts, the railway
    // seal add more, the Блумсбери district takes one away (never below 3)
    const total = metroCarCount(d);
    const cars: TrainCarKind[] = ["engine"];
    // EN-6: the Edinburgh mail runs its mail cars right behind the engine
    for (const k of v.forcedCars ?? []) if (cars.length < total) cars.push(k);
    if (cars.length < total && chance(s, 0.7)) cars.push("tender");
    while (cars.length < total) cars.push(randomCar());
    // EN-1: with the grappling hook there is always something to hook — the last random car becomes a baggage car
    // (no extra RNG draw, so trains without the hook keep exactly the weighted distribution)
    if (s.upgrades.grappling_hook && !cars.some((k) => k === "first" || k === "baggage")) {
      let i = cars.length - 1;
      while (i > 1 && (cars[i] === "engine" || cars[i] === "tender")) i--;
      // a freight of tenders only: its last car becomes the baggage car
      if (cars[i] === "engine" || cars[i] === "tender") i = cars.length - 1;
      if (i > 0) cars[i] = "baggage";
    }
    return cars;
  }
  const cars: TrainCarKind[] = ["engine", "tender", "first", "first", "first", "dining", "dining", "baggage", "baggage", "mail", "third", "royal"];
  const extra = Math.min(17, cars.length + s.buildings.platform_post) - cars.length;
  for (let i = 0; i < extra; i++) cars.splice(cars.length - 1, 0, randomCar());
  return cars;
}

/**
 * The rare Cheddar car (EN-6): 4% of metro trains once the Cellars are open. Returns the car index that becomes a
 * cheese-laden dining car, or −1. Never the engine, nor the hook's only target.
 */
function cheeseCarIndex(s: GameState, id: TrainId, kinds: TrainCarKind[]): number {
  const p = CHEESE_CAR.chance * (s.meta.cheeseCars > 0 ? 1 : VARIANT_DEBUT);
  if (id !== "metro_train" || !s.zones.cellars || !chance(s, p)) return -1;
  const hookKinds = kinds.filter((k) => k === "first" || k === "baggage").length;
  const options: number[] = [];
  kinds.forEach((k, i) => {
    if (i === 0) return;
    if (s.upgrades.grappling_hook && hookKinds <= 1 && (k === "first" || k === "baggage")) return;
    options.push(i);
  });
  if (!options.length) return -1;
  return options[Math.floor(rand(s) * options.length)];
}

/** Build a full train/capsule scene with items (also used for the offline expectation). */
export function buildTrain(s: GameState, d: Derived, id: TrainId): Scene {
  const isCapsule = id === "capsule";
  const isExpress = id === "royal_express";
  const rumble = isCapsule ? T.capsuleRumble : isExpress ? T.expressRumble + (d.rumbleMetro - T.metroRumble) : d.rumbleMetro;
  const sc = newScene(s, id, "rumble", rumble);
  const variant: TrainVariantId = id === "metro_train" ? pickVariant(s) : "normal";
  const v = TRAIN_VARIANTS[variant];
  sc.perCar = (isCapsule ? T.capsulePerCar : isExpress ? T.expressPerCar : T.metroPerCar) * v.perCarMul;
  sc.itemLife = (isCapsule ? 2.0 : isExpress ? 1.6 : 2.2) * v.itemLifeMul + v.itemLifeAdd;
  if (id === "metro_train") {
    sc.variant = variant;
    if (v.lines.length) {
      // variant lines replace the pool (they are not bestiary lines)
      sc.line = resolveLine(s, sc, v.lines[Math.floor(hash01(sc.seq, 202) * v.lines.length)]);
      delete sc.lineIdx;
    }
  }
  const kinds = trainComposition(s, d, id, variant);
  const cheese = cheeseCarIndex(s, id, kinds);
  if (cheese >= 0) {
    kinds[cheese] = "dining";
    sc.announce = CHEESE_CAR.announce;
  }
  const mult = isCapsule ? d.capsuleValueMult : d.trainValueMult;
  const depot = s.buildings.express_depot;
  kinds.forEach((kind, i) => {
    const def = TRAIN_CARS[kind];
    const window: [number, number] = [i * sc.perCar + 0.2, (i + 1) * sc.perCar];
    if (kind === "capsule") {
      fillCar(s, d, sc, def, i, window, { mult, drops: s.zones.cellars ? CAPSULE_DROPS_CELLARS : def.drops });
    } else if (kind === "royal") {
      // royal car: coins with S = 60 * 1.5^(depot-1), trinkets 2 pieces each
      fillCar(s, d, sc, def, i, window, { mult: mult * Math.pow(1.5, Math.max(0, depot - 1)), trinketPieces: 2 });
    } else if (i === cheese) {
      fillCar(s, d, sc, def, i, window, { mult, drops: { cheese: 1 }, S: CHEESE_CAR.S, itemCount: CHEESE_CAR.items, sparks: 0, special: "cheese" });
    } else if (variant !== "normal") {
      fillCar(s, d, sc, def, i, window, {
        mult,
        drops: v.dropOverride?.[kind] ?? def.drops,
        S: def.S * v.sMul,
        itemCount: Math.max(1, Math.round(def.items * v.countMul)),
        sparks: Math.round(def.sparks * v.sparkMul),
      });
    } else {
      fillCar(s, d, sc, def, i, window, { mult });
    }
  });
  if (!isCapsule) {
    sc.lantern = chance(s, isExpress ? 0.4 : 0.2);
    if (s.upgrades.grappling_hook) {
      const target = isExpress ? kinds.indexOf("royal") : kinds.findIndex((k, i) => (k === "baggage" || k === "first") && i !== cheese);
      sc.hookCar = target;
    }
  }
  sc.multiplier = isCapsule ? (s.flags.first_capsule ? 1 : 2) : id === "metro_train" && !s.flags.first_train ? 3 : 1;
  return sc;
}

export function trainAuto(s: GameState, d: Derived, sc: Scene): number {
  if (sc.id === "capsule") return d.capsuleAuto;
  const pos = CREW_POSITIONS[sc.position];
  return Math.min(0.9, (d.trainAutoBase + (sc.ready ? 0.15 : 0)) * pos.auto);
}

function startTrain(s: GameState, d: Derived, id: TrainId, ctx: EngineCtx): void {
  const sc = buildTrain(s, d, id);
  // schedule the next one from now (regular rhythm)
  if (id === "capsule") s.timers.capsule = s.time + jitter(s, d.intervals.capsule, T.capsuleJitter);
  else if (id === "metro_train") s.timers.metro_train = s.time + jitter(s, d.intervals.metro, T.metroJitter);
  else s.timers.royal_express = s.time + d.intervals.express;
  // carriage keeps away from trains (an overdue one stays overdue: it comes after the scene, see tickEvents)
  if (s.timers.carriage > s.time) s.timers.carriage = Math.max(s.timers.carriage, s.time + 60);
  beginScene(s, sc, ctx);
}

/** «Авария у рельсов!» / «Авария между шпал!» (HaulCard highlights notes with «Авария»). */
function crashText(sc: Scene): string {
  return `Авария ${sc.position === "ties" ? "между шпал" : "у рельсов"}!`;
}

function catchDuration(sc: Scene): number {
  let last = 0;
  for (const it of sc.items) last = Math.max(last, it.t);
  return last + sc.itemLife + 0.3;
}

function beginCatch(s: GameState, d: Derived, sc: Scene, ctx: EngineCtx): void {
  sc.auto = sc.id === "carriage" ? 0.25 : isTrainScene(sc.id) ? trainAuto(s, d, sc) : 0;
  if (sc.id === "metro_train" || sc.id === "royal_express") {
    const pos = CREW_POSITIONS[sc.position];
    const risk = pos.crash * (s.meta.edicts.timetable_in_head ? 0.5 : 1);
    if (risk > 0 && chance(s, risk)) {
      sc.crash = true;
      const n = stun(s, 0.03, 90, "crash");
      toast(ctx, `${crashText(sc)} ${n} ${plural(n, "крыса напугана", "крысы напуганы", "крыс напуганы")}`, "💥", "bad");
    }
    s.trainPrefs.lastNets = [...sc.nets];
  }
  if (sc.id === "metro_train" || sc.id === "royal_express") {
    // EN-5 crew feel: between the ties items stay catchable longer; at the wall half the sparks never reach the crew
    // (marked skip by a hash of the item, so the UI and resolveCatch agree)
    if (sc.position === "ties") sc.itemLife += T.tiesItemLifeAdd;
    for (const it of sc.items) {
      if (!it.spark) continue;
      if (sc.position === "wall" && hash01(sc.seq, it.id) >= POSITION_FEEL.wall.sparkKeep) it.skip = true;
      else delete it.skip;
    }
  }
  // EN-5: the haul card's suspicion is measured from here (the lantern greed lands in the catch phase)
  sc.suspBefore = s.suspicion;
  enterPhase(s, sc, "catch", catchDuration(sc), ctx);
}

/** Apply a catch phase result (from the UI, or `null` for auto-resolution). */
function resolveCatch(s: GameState, d: Derived, sc: Scene, result: CatchResult | null, ctx: EngineCtx): void {
  const byId = new Map(sc.items.map((it) => [it.id, it]));
  const caught = new Set<number>();
  const hand: Amounts = {};
  const netted: Amounts = {};
  let caughtW = 0;
  let totalW = 0;
  let caughtN = 0;
  let totalN = 0;
  let lanternCaught = 0;
  let handN = 0;
  for (const it of sc.items) {
    if (it.spark || it.skip) continue;
    totalW += it.weight;
    totalN++;
  }

  if (result) {
    for (const c of result.caught) {
      const it = byId.get(c.id);
      if (!it || it.spark || caught.has(it.id)) continue;
      caught.add(it.id);
      const m = (1 + 0.02 * Math.min(Math.max(0, c.combo), 25)) * (c.lantern && sc.lantern ? LANTERN_MULT : 1);
      hand[it.res] = (hand[it.res] ?? 0) + it.value * m;
      caughtW += it.weight;
      caughtN++;
      handN++;
      if (c.lantern && sc.lantern) lanternCaught++;
    }
    for (const id of result.netted) {
      const it = byId.get(id);
      if (!it || it.spark || caught.has(it.id)) continue;
      caught.add(it.id);
      netted[it.res] = (netted[it.res] ?? 0) + it.value;
      caughtW += it.weight;
      caughtN++;
    }
  } else {
    // nobody at the controls: nets and clockwork rats still work
    autoNetsAndClockwork(s, sc, caught, netted);
    for (const id of caught) {
      const it = byId.get(id)!;
      caughtW += it.weight;
      caughtN++;
    }
  }

  const sparks = result ? Math.max(0, result.sparksHit) : 0;
  if (sparks > 0) {
    s.stats.sparksHit += sparks;
    s.meta.lifetime.sparksHit += sparks;
    if (s.upgrades.asbestos_mitts) {
      netted.coal = (netted.coal ?? 0) + sparks * 20 * eventValue(s, d, "coal");
    } else {
      const k = Math.pow(0.97, sparks);
      for (const [r, v] of entries(hand)) hand[r] = v * k;
    }
  }

  // jackpot (grappling hook)
  const jackpot: Amounts = {};
  const hook = result?.hook ?? "none";
  if ((hook === "hit" || hook === "perfect") && sc.hookCar >= 0) {
    const pos = CREW_POSITIONS[sc.position];
    // v2 (EN-1): ×2.5 / ×4 of the car (the royal car of the Royal Express ×4 / ×6), capped further down by income
    const royalCar = sc.cars[sc.hookCar]?.kind === "royal";
    const perfect = hook === "perfect";
    const k = (royalCar ? (perfect ? HOOK_JACKPOT.royalPerfect : HOOK_JACKPOT.royalHit) : perfect ? HOOK_JACKPOT.perfect : HOOK_JACKPOT.hit) * pos.hook;
    for (const id of sc.cars[sc.hookCar]?.itemIds ?? []) {
      const it = byId.get(id);
      if (it && !it.spark && !it.skip && it.res !== "trinkets") jackpot[it.res] = (jackpot[it.res] ?? 0) + it.value * k;
    }
    sc.jackpot = true;
    if (hook === "perfect") {
      s.stats.hookPerfects++;
      award(s, "hook_perfect", ctx);
    }
  }

  // uncaught items become piles (trains/capsules) or are partially auto-collected (carriage, flotsam)
  const usesPiles = isTrainScene(sc.id);
  const leftovers: Amounts = {};
  for (const it of sc.items) {
    if (it.spark || it.skip || caught.has(it.id)) continue;
    if (usesPiles) sc.piles[it.car][it.res] = (sc.piles[it.car][it.res] ?? 0) + it.value;
    else leftovers[it.res] = (leftovers[it.res] ?? 0) + it.value;
  }

  // rating
  const share = totalW > 0 ? caughtW / totalW : 0;
  let ratingBonus = 0;
  let rating: HaulSummary["rating"] = "none";
  if (result && isTrainScene(sc.id) && sc.id !== "capsule") {
    for (const row of RATING_TABLE) {
      if (share >= row.min && (row.id !== "royal" || sparks === 0)) {
        rating = row.id;
        ratingBonus = row.bonus;
        break;
      }
    }
  }
  sc.share = share;
  sc.ratingBonus = ratingBonus;

  const k = (1 + ratingBonus) * sc.multiplier;
  // the jackpot is worth at most HOOK_JACKPOT_CAP_SEC seconds of passive income after the rating bonus and the
  // first-train ×3 (it used to pay hours); the +2 💍 come on top
  let jackpotSeconds: number | undefined;
  if (sc.jackpot) {
    const income = incomeValue(s);
    let value = strictValue(jackpot) * k;
    const cap = HOOK_JACKPOT_CAP_SEC * income;
    if (value > cap) {
      const f = value > 0 ? cap / value : 0;
      for (const [r, v] of entries(jackpot)) jackpot[r] = v * f;
      value = cap;
    }
    jackpot.trinkets = (jackpot.trinkets ?? 0) + 2;
    jackpotSeconds = value / Math.max(income, 1e-9);
  }

  const total: Amounts = {};
  addAmounts(total, hand);
  addAmounts(total, netted);
  addAmounts(total, jackpot);
  if (!usesPiles) addAmounts(total, leftovers, sc.auto);
  const added = gainAll(s, d, scale(total, k), true, ctx);
  addAmounts(sc.gained, added);

  sc.stats = {
    caught: caughtN,
    total: totalN,
    caughtWeight: caughtW,
    totalWeight: totalW,
    combo: result?.maxCombo ?? 0,
    sparks,
    lanternCaught,
    hook,
    hand: handN,
  };
  sc.haul = {
    title: "",
    gained: sc.gained,
    caughtCount: caughtN,
    totalCount: totalN,
    share,
    rating,
    ratingBonus,
    combo: result?.maxCombo ?? 0,
    suspicion: 0,
    crash: sc.crash,
    jackpot: sc.jackpot,
    notes: [],
  };
  if (jackpotSeconds !== undefined) sc.haul.jackpotSeconds = jackpotSeconds;
  if (result && isTrainScene(sc.id) && sc.id !== "capsule") {
    let clean = 0;
    for (const car of sc.cars) {
      const items = car.itemIds.map((id) => byId.get(id)).filter((it): it is CatchItem => !!it && !it.spark && !it.skip);
      if (items.length > 0 && items.every((it) => caught.has(it.id))) clean++;
    }
    s.stats.cleanCars += Math.max(0, Math.floor(result.cleanCars ?? clean));
  }
  if (result) {
    s.stats.bestCombo = Math.max(s.stats.bestCombo, result.maxCombo);
    s.meta.lifetime.bestCombo = Math.max(s.meta.lifetime.bestCombo, result.maxCombo);
    if (result.maxCombo >= 25 && isTrainScene(sc.id)) award(s, "combo_25", ctx);
  }
  if (lanternCaught > 0) {
    const before = s.suspicion;
    addSuspicion(s, d, 5 * lanternCaught);
    sc.lanternSusp = s.suspicion - before;
    s.stats.lanternMax = Math.max(s.stats.lanternMax, lanternCaught);
    if (lanternCaught >= 10) award(s, "lantern_greed", ctx);
  }
}

/**
 * Live rating of a catch phase for the UI gauge (EN-5, SC-2), with exactly resolveCatch's weights: the caught share of
 * all non-spark weight (hand, nets and clockwork alike). `lostIds` are items that fell uncaught; maxReachable is the
 * share still possible if everything else is caught. tier ignores the royal rating's "no sparks" rule.
 */
export function catchProgress(sc: Scene, caughtIds: Set<number>, lostIds: Set<number>): { share: number; maxReachable: number; tier: HaulSummary["rating"] } {
  let total = 0;
  let caught = 0;
  let lost = 0;
  for (const it of sc.items) {
    if (it.spark || it.skip) continue;
    total += it.weight;
    if (caughtIds.has(it.id)) caught += it.weight;
    else if (lostIds.has(it.id)) lost += it.weight;
  }
  const share = total > 0 ? caught / total : 0;
  const maxReachable = total > 0 ? (total - lost) / total : 0;
  let tier: HaulSummary["rating"] = "none";
  for (const row of RATING_TABLE) {
    if (share >= row.min) {
      tier = row.id;
      break;
    }
  }
  return { share, maxReachable, tier };
}

function autoNetsAndClockwork(s: GameState, sc: Scene, caught: Set<number>, netted: Amounts): void {
  const byId = new Map(sc.items.map((it) => [it.id, it]));
  // each net catches up to one item per car (best value first)
  if (sc.nets.length) {
    for (const car of sc.cars) {
      const items = car.itemIds.map((id) => byId.get(id)!).filter((it) => !it.spark && !caught.has(it.id));
      items.sort((a, b) => b.weight - a.weight);
      for (let n = 0; n < sc.nets.length && n < items.length; n++) {
        caught.add(items[n].id);
        netted[items[n].res] = (netted[items[n].res] ?? 0) + items[n].value;
      }
    }
  }
  if (s.upgrades.clockwork_legion && isTrainScene(sc.id)) {
    const order = [...sc.items].filter((it) => !it.spark).sort((a, b) => a.t - b.t);
    let next = 0;
    for (const it of order) {
      if (caught.has(it.id)) continue;
      if (it.t >= next) {
        caught.add(it.id);
        netted[it.res] = (netted[it.res] ?? 0) + it.value;
        next = it.t + 0.5;
      }
    }
  }
}

/** Market value with the plain market table (📜💍💨 have none and count 0). */
function strictValue(a: Amounts): number {
  let v = 0;
  for (const [r, x] of entries(a)) v += x * (RESOURCES[r].market ?? 0);
  return v;
}

/** Passive market-value income per second (EMA30 of the online-equivalent rates), the jackpot cap's yardstick. */
export function incomeValue(s: GameState): number {
  let v = 0;
  for (const [r, x] of Object.entries(s.ema) as [ResId, number][]) if (x > 0) v += x * (RESOURCES[r].market ?? 0);
  return v;
}

function scale(a: Amounts, k: number): Amounts {
  const out: Amounts = {};
  for (const [r, v] of entries(a)) out[r] = v * k;
  return out;
}

function beginPiles(s: GameState, d: Derived, sc: Scene, ctx: EngineCtx): void {
  const any = sc.piles.some((p) => Object.keys(p).length > 0);
  const duration = sc.id === "capsule" ? T.capsulePiles : sc.id === "royal_express" ? T.expressPiles : T.metroPiles;
  if (!any) {
    sc.pileFractions = sc.piles.map(() => 0);
    finishTrain(s, d, sc, ctx);
    return;
  }
  sc.pileFractions = sc.piles.map(() => 0);
  enterPhase(s, sc, "piles", duration, ctx);
}

/** Piles keep max(auto, recovered): an untouched pile still pays the auto-collect share (passive income unchanged). */
function resolvePiles(s: GameState, d: Derived, sc: Scene, fractions: number[] | null, ctx: EngineCtx): void {
  const out: Amounts = {};
  sc.piles.forEach((pile, i) => {
    const f = fractions?.[i];
    const c = Math.max(sc.auto, Math.min(1, typeof f === "number" && Number.isFinite(f) ? f : 0));
    sc.pileFractions[i] = c;
    addAmounts(out, pile, c);
  });
  const added = gainAll(s, d, scale(out, (1 + sc.ratingBonus) * sc.multiplier), true, ctx);
  addAmounts(sc.gained, added);
  if (sc.haul) sc.haul.gained = sc.gained;
  finishTrain(s, d, sc, ctx);
}

const RATING_ORDER: HaulSummary["rating"][] = ["none", "bronze", "silver", "gold", "royal"];

/** The better of two ratings. */
function bestOf(a: HaulSummary["rating"] | undefined, b: HaulSummary["rating"]): HaulSummary["rating"] {
  return a !== undefined && RATING_ORDER.indexOf(a) >= RATING_ORDER.indexOf(b) ? a : b;
}

/** Train/capsule completion bookkeeping, then the haul card (trains) or a toast (capsules). */
function finishTrain(s: GameState, d: Derived, sc: Scene, ctx: EngineCtx): void {
  const share = sc.share;
  let susp = 0;
  if (sc.id === "capsule") {
    s.stats.capsules++;
    s.meta.lifetime.capsules++;
    susp = 1;
    if (!s.flags.first_capsule) {
      s.flags.first_capsule = true;
      award(s, "first_capsule", ctx);
      news(s, "first_capsule", {}, ctx);
    } else news(s, "capsule", { n: s.stats.capsules }, ctx);
  } else if (sc.id === "metro_train") {
    s.stats.trains++;
    s.meta.lifetime.trains++;
    susp = 2 + 4 * share;
  } else {
    s.stats.expresses++;
    s.meta.lifetime.expresses++;
    s.stats.royalExpresses++;
    s.meta.lifetime.royalExpresses++;
    susp = 4 + 8 * share;
    news(s, "express", {}, ctx);
  }
  // the suspicion is added once per pass (lantern greed was added in the catch phase);
  // a pass nobody worked leaves no trace (GDD 8.8: the scale stands still while idle)
  if (sc.stats.hand === 0) susp = 0;
  const before = s.suspicion;
  addSuspicion(s, d, susp);
  const pass = s.suspicion - before;
  if (sc.haul) {
    const h = sc.haul;
    // EN-5: the whole scene's change from the start of the catch phase, and its two parts
    const total = s.suspicion - (sc.suspBefore ?? before - (sc.lanternSusp ?? 0));
    h.suspicion = total;
    h.suspicionParts = { pass, lantern: sc.lanternSusp ?? 0, total };
    h.title = sc.id === "capsule" ? `Капсулы №${s.stats.capsules}` : sc.id === "metro_train" ? `Улов поезда №${s.stats.trains}` : `Королевский экспресс №${s.stats.expresses}`;
    if (sc.multiplier > 1) h.notes.push(`Первый раз: добыча ×${sc.multiplier}`);
    if (sc.crash) h.notes.push(crashText(sc));
    if (sc.jackpot) h.notes.push("ДЖЕКПОТ: чемодан с полки!");
    if (sc.announce) {
      h.notes.push(sc.announce);
      s.meta.cheeseCars++;
    }
    if (h.rating === "royal") {
      award(s, "royal_haul", ctx);
      news(s, "train_royal", {}, ctx);
    }
    if (RATING_ORDER.indexOf(h.rating) > RATING_ORDER.indexOf(s.meta.bestRating)) s.meta.bestRating = h.rating;
    if (RATING_ORDER.indexOf(h.rating) > RATING_ORDER.indexOf(s.runBestRating)) s.runBestRating = h.rating;
    if (sc.id !== "capsule") {
      const gold = h.rating === "gold" || h.rating === "royal";
      if (gold) {
        s.stats.goldHauls++;
        s.stats.goldStreak++;
      } else s.stats.goldStreak = 0;
      // EN-11 feats and the train journal
      if (gold && sc.stats.sparks === 0) award(s, "no_spark", ctx);
      if (gold && sc.crash && sc.position === "ties") award(s, "ties_survivor", ctx);
      if (sc.id === "metro_train" && sc.cars.length >= 11) award(s, "full_consist", ctx);
      for (const car of sc.cars) s.meta.carLog[car.kind] = bestOf(s.meta.carLog[car.kind], h.rating);
      if (sc.id === "metro_train") {
        const v = sc.variant ?? "normal";
        s.meta.variantLog[v] = bestOf(s.meta.variantLog[v], h.rating);
      }
      h.headline = pickHumanHeadline(h, sc);
    }
  }
  if (sc.id === "metro_train") {
    if (!s.flags.first_train) {
      s.flags.first_train = true;
      award(s, "first_train", ctx);
      news(s, "first_train", {}, ctx);
    } else if (sc.haul && (sc.haul.rating === "gold" || sc.haul.rating === "royal" || s.stats.trains % 3 === 0)) {
      // EN-10: the paper reports the good hauls and every third train
      news(s, "train", { n: s.stats.trains, haul: summarize(sc.gained) || "одни угольки" }, ctx);
    }
  }
  if (!s.flags.first_pocketwatch && (sc.gained.trinkets ?? 0) > 0) {
    s.flags.first_pocketwatch = true;
    news(s, "first_pocketwatch", {}, ctx);
  }
  if (sc.id === "capsule") {
    toast(ctx, `${EVENT_LINES.capsule.icon} Капсулы разобраны: ${summarize(sc.gained)}`, "📯", "good");
    sc.phase = "done";
    return;
  }
  enterPhase(s, sc, "haul", T.haulCard, ctx);
}

export function summarize(a: Amounts, max = 4): string {
  return entries(a)
    .filter(([, v]) => v >= 0.5)
    .sort((x, y) => y[1] * (RESOURCES[y[0]].market ?? 30) - x[1] * (RESOURCES[x[0]].market ?? 30))
    .slice(0, max)
    .map(([r, v]) => `${RESOURCES[r].icon}+${fmtShort(v)}`)
    .join(" ");
}

function fmtShort(n: number): string {
  if (n < 1000) return String(Math.round(n));
  const units = ["K", "M", "B", "T"];
  let i = -1;
  while (n >= 1000 && i < units.length - 1) {
    n /= 1000;
    i++;
  }
  return n.toFixed(n < 10 ? 1 : 0) + units[i];
}

/* ================================================================ carriage */

function startCarriage(s: GameState, d: Derived, ctx: EngineCtx): void {
  const sc = newScene(s, "carriage", "catch", 0);
  sc.itemLife = 2.0;
  const def = TRAIN_CARS.carriage;
  fillCar(s, d, sc, def, 0, [0.3, 5], { mult: 1, itemCount: randInt(s, 6, 10) });
  sc.auto = 0.25;
  sc.phaseEnds = s.time + catchDuration(sc);
  const interval = s.zones.metro ? T.carriageIntervalMetro : s.flags.first_capsule ? T.carriageIntervalCapsule : T.carriageInterval;
  s.timers.carriage = s.time + between(s, interval);
  beginScene(s, sc, ctx);
}

/* ================================================================ downpour */

function startDownpour(s: GameState, d: Derived, ctx: EngineCtx): void {
  const pre = s.buildings.water_wheel >= 5 ? 1 : 0;
  const sc = newScene(s, "downpour", "taps", T.downpourValveTime);
  sc.preCleared = pre;
  sc.taps = { count: 3 - pre, hp: T.downpourValveHp, duration: T.downpourValveTime };
  s.timers.downpour = s.time + between(s, T.downpourInterval) * (d.commission === "dry_paws2" ? 0.5 : 1);
  s.stats.downpours++;
  beginScene(s, sc, ctx);
  void d;
}

function resolveDownpour(s: GameState, d: Derived, sc: Scene, cleared: number, ctx: EngineCtx, fastMs?: number): void {
  const closed = Math.max(0, Math.min(3, cleared + sc.preCleared));
  sc.choice = String(closed);
  if (closed < 3) {
    s.buffs.soggyUntil = s.time + SOGGY_SEC;
    news(s, "downpour_fail", {}, ctx);
    toast(ctx, "Вентиль остался открыт: добыча 🍞🪙🔘➰ ×0.8 на 25 с", "🌧️", "bad");
  } else {
    s.stats.downpoursWon++;
    s.meta.lifetime.downpoursWon++;
    // EN-11 «Сухие лапки»: the player shut every valve still open within 4 s
    if (cleared >= 1 && typeof fastMs === "number" && fastMs >= 0 && fastMs <= 4000) award(s, "dry_paws", ctx);
    news(s, "downpour_win", {}, ctx);
  }
  if (closed <= 0) {
    endScene(s, d, ctx);
    return;
  }
  const def = TRAIN_CARS.flotsam;
  sc.items = [];
  sc.cars = [];
  sc.piles = [];
  sc.pileFractions = [];
  sc.itemLife = 2.4;
  fillCar(s, d, sc, def, 0, [0.2, 6], { mult: 1, itemCount: 4 * closed });
  sc.auto = 0.25;
  enterPhase(s, sc, "catch", catchDuration(sc), ctx);
}

/* ================================================================ cat */

function startCat(s: GameState, d: Derived, ctx: EngineCtx): void {
  const warn = T.catWarn + (s.upgrades.bell_the_cat ? 3 : 0);
  const sc = newScene(s, "cat", "warn", warn);
  const hp = Math.ceil(Math.min(40, 15 + 3 * s.stats.catsBeaten) * (s.upgrades.bell_the_cat ? 0.7 : 1));
  sc.taps = { count: 1, hp, duration: T.catFight };
  s.flags.first_cat = true;
  s.timers.catForcedAt = Infinity;
  s.timers.cat = s.time + T.catCheck;
  s.stats.cats++;
  s.meta.lifetime.cats++;
  beginScene(s, sc, ctx);
  void d;
}

function catHide(s: GameState, d: Derived, sc: Scene, ctx: EngineCtx): void {
  sc.choice = "hide";
  s.suspicion = Math.max(0, s.suspicion - 10);
  news(s, "cat_hide", {}, ctx);
  toast(ctx, "Колония спряталась. Кот ушёл ни с чем (подозрение −10)", "🙈", "info");
  endScene(s, d, ctx);
}

function resolveCat(s: GameState, d: Derived, sc: Scene, beaten: boolean, ctx: EngineCtx): void {
  if (beaten) {
    const bell = s.upgrades.bell_the_cat ? 1.5 : 1;
    const reward: Amounts = {
      blueprints: Math.max(10, 90 * s.ema.blueprints) * bell,
      cheese: 60 * eventValue(s, d, "cheese") * bell,
    };
    addAmounts(sc.gained, gainAll(s, d, reward, true, ctx));
    s.suspicion = Math.max(0, s.suspicion - 25);
    s.stats.catsBeaten++;
    s.meta.lifetime.catsBeaten++;
    if (!s.meta.trophies.includes("cat_fur")) s.meta.trophies.push("cat_fur");
    award(s, "cat_bonked", ctx);
    news(s, "cat_win", {}, ctx);
    toast(ctx, `ПО УСАМ! ${summarize(sc.gained)} (подозрение −25)`, "🥊", "gold");
  } else {
    const n = stun(s, 0.03, 60, "cat");
    s.res.cheese = s.res.cheese * 0.95;
    news(s, "cat_lose", {}, ctx);
    toast(ctx, `Кот победил: ${n} ${plural(n, "крыса напугана", "крысы напуганы", "крыс напуганы")}, −5% 🧀`, "🐈‍⬛", "bad");
  }
  sc.choice = beaten ? "won" : "lost";
  endScene(s, d, ctx);
}

/* ================================================================ ratcatcher */

function startRatcatcher(s: GameState, d: Derived, ctx: EngineCtx): void {
  const sc = newScene(s, "ratcatcher", "warn", T.ratcatcherWarn);
  sc.taps = { count: T.ratcatcherNotes, hp: 1, duration: T.ratcatcherFight };
  s.timers.ratcatcherAt = Infinity;
  s.stats.ratcatchers++;
  s.meta.lifetime.ratcatchers++;
  beginScene(s, sc, ctx);
  void d;
}

function ratcatcherPay(s: GameState, d: Derived, sc: Scene, ctx: EngineCtx): void {
  sc.choice = "pay";
  const wantC = 60 * eventValue(s, d, "coins");
  const wantCh = s.zones.cellars ? 30 * eventValue(s, d, "cheese") : 0;
  const payC = Math.min(s.res.coins, wantC);
  const payCh = Math.min(s.res.cheese, wantCh);
  s.res.coins -= payC;
  s.res.cheese -= payCh;
  const full = payC >= wantC - 1e-6 && payCh >= wantCh - 1e-6;
  s.suspicion = full ? 40 : 60;
  news(s, "ratcatcher_pay", {}, ctx);
  toast(ctx, `Откуп: −${fmtShort(payC)} 🪙${payCh > 0 ? `, −${fmtShort(payCh)} 🧀` : ""}. Подозрение ${s.suspicion}%`, "💰", "info");
  endScene(s, d, ctx);
}

function resolveRatcatcher(s: GameState, d: Derived, sc: Scene, popped: number, ctx: EngineCtx): void {
  const total = sc.taps?.count ?? T.ratcatcherNotes;
  const p = Math.max(0, Math.min(total, popped));
  if (p >= 0.8 * total) {
    s.suspicion = 0;
    const reward: Amounts = { coins: 300 * eventValue(s, d, "coins"), blueprints: Math.max(20, 300 * s.ema.blueprints) };
    addAmounts(sc.gained, gainAll(s, d, reward, true, ctx));
    s.stats.pipersBroken++;
    s.meta.lifetime.pipersBroken++;
    if (!s.meta.trophies.includes("broken_pipe")) s.meta.trophies.push("broken_pipe");
    award(s, "piper_broken", ctx);
    news(s, "ratcatcher_win", {}, ctx);
    toast(ctx, `ДУДКА СЛОМАНА! ${summarize(sc.gained)}`, "🎶", "gold");
    sc.choice = "won";
  } else {
    s.suspicion = 40;
    const reached = total - p;
    const n = reached > 0 ? stun(s, 0.005 * reached, 90, "piper") : 0;
    news(s, "ratcatcher_lose", {}, ctx);
    toast(ctx, `Дудочник увёл ${n} ${plural(n, "крысу", "крысы", "крыс")} (вернутся через 90 с)`, "🎶", "bad");
    sc.choice = "lost";
  }
  endScene(s, d, ctx);
}

/* ================================================================ advance & actions */

const GRACE: Partial<Record<ScenePhase, number>> = { catch: T.interactiveGrace, piles: T.interactiveGrace, taps: T.interactiveGrace, haul: 22 };

function advanceScene(s: GameState, d: Derived, ctx: EngineCtx): void {
  const sc = s.scene!;
  if (sc.phase === "done") {
    endScene(s, d, ctx);
    return;
  }
  const grace = sc.interactive ? (GRACE[sc.phase] ?? 0) : 0;
  if (s.time < sc.phaseEnds + grace) return;
  autoResolvePhase(s, d, sc, ctx);
}

/** Resolve the current phase as if the player did nothing. */
function autoResolvePhase(s: GameState, d: Derived, sc: Scene, ctx: EngineCtx): void {
  switch (sc.phase) {
    case "rumble":
      beginCatch(s, d, sc, ctx);
      break;
    case "catch":
      resolveCatch(s, d, sc, null, ctx);
      if (isTrainScene(sc.id)) beginPiles(s, d, sc, ctx);
      else finishSimpleCatch(s, d, sc, ctx);
      break;
    case "piles":
      resolvePiles(s, d, sc, null, ctx);
      break;
    case "warn":
      if (sc.id === "cat") catHide(s, d, sc, ctx);
      else ratcatcherPay(s, d, sc, ctx);
      break;
    case "taps":
      if (sc.id === "downpour") resolveDownpour(s, d, sc, 0, ctx);
      else if (sc.id === "cat") resolveCat(s, d, sc, false, ctx);
      else resolveRatcatcher(s, d, sc, 0, ctx);
      break;
    case "haul":
      endScene(s, d, ctx);
      break;
    case "done":
      endScene(s, d, ctx);
      break;
  }
}

function finishSimpleCatch(s: GameState, d: Derived, sc: Scene, ctx: EngineCtx): void {
  if (sc.id === "carriage") {
    s.stats.carriages++;
    if (!s.flags.first_carriage) s.flags.first_carriage = true;
    toast(ctx, `Экипаж проехал: ${summarize(sc.gained) || "ничего не поймано"}`, "🐎", "good");
    news(s, "carriage", {}, ctx);
  } else if (sc.id === "downpour") {
    toast(ctx, `Плавучий мусор: ${summarize(sc.gained) || "ничего"}`, "🌊", "good");
  }
  endScene(s, d, ctx);
}

export function sceneAction(s: GameState, d: Derived, action: SceneAction, ctx: EngineCtx): void {
  const sc = s.scene;
  if (!sc) return;
  switch (action.a) {
    case "attach":
      sc.interactive = true;
      return;
    case "detach":
      sc.interactive = false;
      return;
    case "position":
      if (sc.phase === "rumble" && isTrainScene(sc.id)) {
        sc.position = action.pos;
        s.trainPrefs.position = action.pos;
      }
      return;
    case "net": {
      if (sc.phase !== "rumble" || !isTrainScene(sc.id) || sc.id === "capsule") return;
      const sec = Math.max(0, Math.min(2, Math.floor(action.section)));
      const cost = netCost(s, d);
      const i = sc.nets.indexOf(sec);
      if (i >= 0) {
        sc.nets.splice(i, 1);
        s.res.wire += cost; // refund while still in prep
      } else if (sc.nets.length < d.netSlots && s.res.wire >= cost) {
        s.res.wire -= cost;
        sc.nets.push(sec);
      }
      return;
    }
    case "netsRepeat": {
      if (sc.phase !== "rumble" || !isTrainScene(sc.id) || sc.id === "capsule") return;
      const cost = netCost(s, d);
      for (const sec of s.trainPrefs.lastNets) {
        if (sc.nets.includes(sec) || sc.nets.length >= d.netSlots || s.res.wire < cost) continue;
        s.res.wire -= cost;
        sc.nets.push(sec);
      }
      return;
    }
    case "ready":
      if (sc.phase === "rumble") {
        sc.ready = true;
        beginCatch(s, d, sc, ctx);
      }
      return;
    case "skip":
      skipScene(s, d, sc, ctx);
      return;
    case "catch":
      if (sc.phase !== "catch") return;
      resolveCatch(s, d, sc, action.result, ctx);
      if (isTrainScene(sc.id)) beginPiles(s, d, sc, ctx);
      else finishSimpleCatch(s, d, sc, ctx);
      return;
    case "piles":
      if (sc.phase === "piles") resolvePiles(s, d, sc, action.fractions, ctx);
      return;
    case "choice":
      if (sc.phase !== "warn") return;
      if (sc.id === "cat") {
        if (action.option === "fight") {
          sc.choice = "fight";
          enterPhase(s, sc, "taps", T.catFight, ctx);
        } else catHide(s, d, sc, ctx);
      } else if (sc.id === "ratcatcher") {
        if (action.option === "fight") {
          sc.choice = "fight";
          enterPhase(s, sc, "taps", T.ratcatcherFight, ctx);
        } else ratcatcherPay(s, d, sc, ctx);
      }
      return;
    case "taps":
      if (sc.phase !== "taps") return;
      if (sc.id === "downpour") resolveDownpour(s, d, sc, action.cleared, ctx, action.fastMs);
      else if (sc.id === "cat") resolveCat(s, d, sc, action.cleared >= 1, ctx);
      else resolveRatcatcher(s, d, sc, action.cleared, ctx);
      return;
    case "dismiss":
      if (sc.phase === "haul" || sc.phase === "done") endScene(s, d, ctx);
      return;
  }
}

/** Resolve everything left in the scene by auto-collect (the "Пропустить" button). */
function skipScene(s: GameState, d: Derived, sc: Scene, ctx: EngineCtx): void {
  let guard = 0;
  while (s.scene === sc && sc.phase !== "haul" && guard++ < 10) {
    if (sc.phase === "warn" || sc.phase === "taps") {
      autoResolvePhase(s, d, sc, ctx);
      continue;
    }
    autoResolvePhase(s, d, sc, ctx);
  }
}

export function netCost(s: GameState, d: Derived): number {
  void d;
  return Math.ceil(Math.max(50, 20 * s.ema.wire));
}

/* ================================================================ whistle */

/** The whistle never brings a train closer than this many seconds (its «К путям!» warning still has to play). */
export const WHISTLE_FLOOR = 5;

/**
 * «Свистнуть стрелочнику»: the next train comes up to a minute sooner, never closer than WHISTLE_FLOOR s, for 10% of
 * the coins, once per train. A train already WHISTLE_FLOOR s away or less cannot come sooner: refused, nothing paid.
 */
export function whistle(s: GameState, ctx: EngineCtx): boolean {
  const nt = nextTrain(s);
  if (!nt || s.scene) return false;
  if (s.timers.whistleUsedFor === nt.at) return false;
  const left = nt.at - s.time;
  if (left <= WHISTLE_FLOOR) return false;
  const gain = Math.min(60, left - WHISTLE_FLOOR);
  const cost = Math.floor(s.res.coins * 0.1);
  s.res.coins -= cost;
  const newAt = nt.at - gain;
  s.timers[nt.id] = newAt;
  s.timers.whistleUsedFor = newAt;
  toast(ctx, `Стрелочник подмазан (−${fmtShort(cost)} 🪙): поезд ${gain >= 60 ? "на минуту" : `на ${fmtTime(gain)}`} раньше`, "🎺", "info");
  return true;
}

/* ================================================================ offline */

/**
 * After an absence the run clock has jumped past every event timer. Push the overdue ones a little into
 * the future so the returning player is not greeted by a downpour or a cat in the first second; trains
 * come back with a proper "К путям!" warning. Purses, shinies and the market may stay overdue (they are gifts).
 */
export function rescheduleAfterAbsence(s: GameState): void {
  const t = s.time;
  const tm = s.timers;
  tm.lastSceneEnd = t;
  if (tm.carriage <= t) tm.carriage = t + between(s, [40, 90]);
  // not only the overdue ones: a train due within 45 s would skip the «К путям!» warning under the absence report
  for (const id of TRAIN_IDS) if (tm[id] < t + 45) tm[id] = t + 45 + randRange(s, 0, 30);
  if (tm.downpour <= t) tm.downpour = t + between(s, T.downpourInterval) * 0.5;
  if (tm.cat <= t) tm.cat = t + T.catCheck;
  if (tm.catForcedAt <= t) tm.catForcedAt = t + T.catCheck;
  if (tm.ratcatcherAt <= t) tm.ratcatcherAt = t + T.ratcatcherDelay + 20;
}

/**
 * Expected loot of the trains/capsules that ran during the last `seconds` (auto-collect only, no crashes; called after
 * the catch-up steps, so s.time is the end of the absence). Each kind counts only the time its line ran: a zone
 * opened mid-absence starts its line then, and capsules run until the Metro opened.
 */
export function offlineTrains(s: GameState, d: Derived, seconds: number, eta: number): { count: number; loot: Amounts } {
  const loot: Amounts = {};
  let count = 0;
  const start = s.time - seconds;
  const openedAt = (z: ZoneId) => (s.zones[z] ? (s.zoneOpenedAt[z] ?? start) : Infinity);
  for (const id of TRAIN_IDS) {
    let ran: number;
    if (id === "capsule") ran = Math.min(s.time, openedAt("metro")) - Math.max(start, openedAt("sewers"));
    else if (id === "metro_train") ran = s.time - Math.max(start, openedAt("metro"));
    else ran = trainActive(s, id) ? seconds : 0;
    const interval = id === "capsule" ? d.intervals.capsule : id === "metro_train" ? d.intervals.metro : d.intervals.express;
    const n = Math.min(30, Math.floor(Math.max(0, ran) / interval));
    if (n <= 0) continue;
    for (let i = 0; i < n; i++) {
      const sc = buildTrain(s, d, id);
      sc.position = "rails";
      sc.ready = false;
      const a = id === "capsule" ? d.capsuleAuto : Math.min(0.9, d.trainAutoBase * CREW_POSITIONS.rails.auto);
      for (const it of sc.items) if (!it.spark) loot[it.res] = (loot[it.res] ?? 0) + it.value * a * eta;
    }
    count += n;
    // the next one somewhere in its interval, but never sooner than the «К путям!» warning (45 s)
    if (trainActive(s, id)) s.timers[id] = s.time + 45 + randRange(s, 0, Math.max(30, interval - 45));
  }
  // the sceneSeq advanced while building expectation scenes; harmless
  return { count, loot };
}

export { pushNews };
