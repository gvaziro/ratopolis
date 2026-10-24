/**
 * Headless balance simulator core: deterministic bots that drive the engine the same way the UI does
 * (step() at 10 Hz, actions from engine/actions, sceneAction for event scenes).
 * Used by scripts/balance-sim.ts (CLI) and by the engine test-suite.
 * Spec: docs/GDD.md 15.14.
 */
import { BUILDINGS } from "../src/game/data/buildings";
import { CREW_POSITIONS, TRAIN_CARS } from "../src/game/data/events";
import { CONVERTERS, JOBS } from "../src/game/data/jobs";
import { EDICTS, EXPRESS_BASE, SEALS } from "../src/game/data/meta";
import { edictRank } from "../src/game/engine/ranks";
import { RESOURCES } from "../src/game/data/resources";
import { UPGRADES } from "../src/game/data/upgrades";
import { ZONES, ZONE_ORDER } from "../src/game/data/zones";
import {
  assignJob,
  buildingVisible,
  buyBuilding,
  acceptCommission,
  buyEdict,
  buyEdictRank,
  buySeal,
  buyUpgrade,
  click,
  contributeExpedition,
  contributeExpress,
  currentExpedition,
  expressCost,
  migrate,
  setAssignMode,
  setFocus,
  toggleSatiety,
  upgradeVisible,
} from "../src/game/engine/actions";
import { check } from "../src/game/engine/conditions";
import { derive, eventValue, resMult, stunnedRats, type Derived } from "../src/game/engine/derive";
import { clickPurse, clickShiny, isTrainScene, marketDeal, metroCarCount, sceneAction, trainActive, trainDropRes } from "../src/game/engine/events";
import {
  buildingCost,
  canAfford,
  canMigrate,
  crownsForRun,
  entries,
  expeditionCost,
  remaining,
} from "../src/game/engine/formulas";
import { simulateOffline } from "../src/game/engine/offline";
import { rand } from "../src/game/engine/rng";
import { createInitialState, zeroRes } from "../src/game/engine/state";
import { step, TICK } from "../src/game/engine/step";
import {
  BUILDING_IDS,
  JOB_IDS,
  RES_IDS,
  UPGRADE_IDS,
  type AchievementId,
  type Amounts,
  type BuildingId,
  type Cond,
  type CatchResult,
  type CommissionId,
  type EdictId,
  type EngineCtx,
  type GameState,
  type JobId,
  type ResId,
  type ResMap,
  type SceneEventId,
  type TrainVariantId,
  type UpgradeId,
  type ZoneId,
} from "../src/game/types";

/* ================================================================ valuation */

/** Market value per unit used for ROI (market table; blueprints/trinkets get a nominal price, steam is an intermediate). */
export const VALUE: ResMap = (() => {
  const v = zeroRes();
  for (const r of RES_IDS) v[r] = RESOURCES[r].market ?? 0;
  v.blueprints = 25;
  v.trinkets = 250;
  v.steam = 0;
  return v;
})();

/** Market value of an amounts bundle with the plain VALUE table. */
export function bundleValue(a: Amounts, w: ResMap = VALUE): number {
  let v = 0;
  for (const [r, x] of entries(a)) v += x * w[r];
  return v;
}

const OPEN: JobId[] = ["forager", "pickpocket", "scavenger"];
/** Support buildings evaluated together with a converter building (their job slots feed it). */
const BUNDLES: Partial<Record<BuildingId, BuildingId[]>> = {
  brass_foundry: ["boiler", "coal_chute"],
  rail_forge: ["boiler", "coal_chute"],
  boiler: ["coal_chute"],
  steam_press: ["boiler", "coal_chute"],
  clocktower: ["boiler", "coal_chute"],
  library: ["cheese_tap"],
};
const ENABLERS: Partial<Record<ResId, BuildingId[]>> = {
  gears: ["workshop"],
  cheese: ["cheese_tap"],
  blueprints: ["library"],
  coal: ["coal_chute"],
  brass: ["boiler", "brass_foundry"],
  rails: ["rail_forge"],
  trinkets: ["lost_luggage"],
};
const LIMITED_PRODUCERS: JobId[] = ["cheese_thief", "coal_miner", "appraiser"];
/** Building effects that can change the bot's job plan. */
const PLAN_EFFECTS = new Set(["slots", "housing", "jobPct", "cap", "capMult", "birthPct"]);
/** Converters in the order the planner fills them (most valuable chains first). */
const PLAN_CONVERTERS: JobId[] = ["smith", "smelter", "mechanic", "scholar"];
/** Seconds of stock a converter may live on when planning (stock counts as a slow inflow). */
const STOCK_HORIZON = 600;

function jobUnlocked(s: GameState, j: JobId): boolean {
  return check(s, JOBS[j].unlock);
}

function perWorker(d: Derived, j: JobId, r: ResId): number {
  return (JOBS[j].produces[r] ?? 0) * d.jobSpeed[j] * d.jobYield[j];
}

function isFull(s: GameState, d: Derived, r: ResId): boolean {
  return Number.isFinite(d.caps[r]) && s.res[r] >= d.caps[r] * 0.995;
}

/** Allocation-light zero map (the bot evaluates thousands of plans per decision). */
function zr(): ResMap {
  return { crumbs: 0, coins: 0, buttons: 0, wire: 0, gears: 0, cheese: 0, blueprints: 0, coal: 0, steam: 0, brass: 0, rails: 0, trinkets: 0 };
}

const pairCache = new WeakMap<object, [ResId, number][]>();
/** Cached [res, amount] pairs of a static amounts table. */
function pairs(a: Amounts): [ResId, number][] {
  let p = pairCache.get(a);
  if (!p) {
    p = entries(a);
    pairCache.set(a, p);
  }
  return p;
}

/**
 * Passive net flows per second for a job assignment (mirrors economy.ts: producers → converters → steam → food).
 * No temporary multipliers. Stock counts as a slow inflow (STOCK_HORIZON) for converter inputs.
 */
export function flows(s: GameState, d: Derived, jobs: Record<JobId, number>, rats: number, stockHorizon = STOCK_HORIZON): ResMap {
  const stunned = stunnedRats(s);
  const wf = rats > 0 ? Math.max(0, 1 - stunned / rats) : 1;
  const net = zr();
  const mult = zr();
  for (const r of RES_IDS) mult[r] = resMult(s, d, r, false);
  for (const j of JOB_IDS) {
    const n = jobs[j];
    if (n <= 0 || pairs(JOBS[j].consumes).length > 0) continue;
    const k = n * d.jobSpeed[j] * d.jobYield[j] * wf;
    for (const [r, v] of pairs(JOBS[j].produces)) net[r] += v * k * mult[r];
  }
  for (const id of BUILDING_IDS) {
    if (s.buildings[id] <= 0) continue;
    const out = d.buildingOut[id];
    for (const r in out) net[r as ResId] += (out[r as ResId] ?? 0) * mult[r as ResId];
  }
  for (const j of CONVERTERS) {
    const n = jobs[j];
    if (n <= 0) continue;
    const rate = n * d.jobSpeed[j] * wf;
    let e = 1;
    const cons = pairs(JOBS[j].consumes);
    const prod = pairs(JOBS[j].produces);
    for (const [r, v] of cons) {
      const need = rate * v;
      const avail = Math.max(0, net[r]) + s.res[r] / stockHorizon;
      if (need > 0) e = Math.min(e, avail / need);
    }
    for (const [r] of prod) if (isFull(s, d, r)) e = 0;
    e = Math.max(0, Math.min(1, e));
    for (const [r, v] of cons) net[r] -= rate * v * e;
    for (const [r, v] of prod) net[r] += rate * v * d.jobYield[j] * mult[r] * e;
  }
  if (d.steamNeed > 0) {
    const avail = Math.max(0, net.steam) + s.res.steam / 60;
    net.steam -= Math.min(avail, d.steamNeed);
  }
  net.crumbs -= 0.04 * rats;
  if (d.satietyActive) net.cheese -= 0.005 * rats;
  return net;
}

/** Steam efficiency estimate for steam consumers (press/clocktower) under a plan. */
function steamEffFor(s: GameState, d: Derived, jobs: Record<JobId, number>, rats: number): number {
  if (d.steamNeed <= 0) return 1;
  const f = flows(s, { ...d, steamNeed: 0 }, jobs, rats);
  return Math.max(0, Math.min(1, (Math.max(0, f.steam) + s.res.steam / 60) / d.steamNeed));
}

/* ================================================================ events income model */

const AVG_CAR_WEIGHT: [keyof typeof TRAIN_CARS, number][] = [
  ["third", 30],
  ["dining", 15],
  ["mail", 15],
  ["first", 15],
  ["baggage", 15],
];

/** Expected loot of one car, per resource, added to `out` × scale (drops of unrevealed resources swap exactly like fillCar). */
function carLoot(s: GameState, d: Derived, kind: keyof typeof TRAIN_CARS, scale: number, out: ResMap, opts: { drops?: Partial<Record<ResId, number>>; mult?: number; pieces?: number } = {}): void {
  const def = TRAIN_CARS[kind];
  const lucky = s.meta.edicts.lucky_tail ? 2 : 1;
  const total = Object.values(opts.drops ?? def.drops).reduce((a, p) => a + (p ?? 0), 0) || 1;
  for (const [r0, p] of Object.entries(opts.drops ?? def.drops) as [ResId, number][]) {
    const r = trainDropRes(s, r0);
    const per = r === "trinkets" ? (opts.pieces ?? 1) * lucky : def.S * eventValue(s, d, r) * (opts.mult ?? 1);
    out[r] += (p / total) * def.items * per * scale;
  }
}

/** Expected resources per second from trains/capsules (auto-collect for the passive bot, 75% catch ×1.2 for the active one). */
export function eventRates(s: GameState, d: Derived, active: boolean): ResMap {
  const out = zeroRes();
  const collect = (a: number) => (active ? 0.75 * 1.2 + 0.25 * a : a);
  if (trainActive(s, "capsule")) {
    const drops = s.zones.cellars ? { coins: 0.35, buttons: 0.2, wire: 0.2, gears: 0.15, cheese: 0.1 } : undefined;
    carLoot(s, d, "capsule", (d.capsuleCount * collect(d.capsuleAuto)) / d.intervals.capsule, out, { drops, mult: d.capsuleValueMult });
  }
  const trainA = Math.min(0.9, (d.trainAutoBase + (active ? 0.15 : 0)) * CREW_POSITIONS.rails.auto);
  if (trainActive(s, "metro_train")) {
    const cars = metroCarCount(d);
    const k = collect(trainA) / d.intervals.metro;
    const m = { mult: d.trainValueMult };
    carLoot(s, d, "engine", k, out, m);
    carLoot(s, d, "tender", 0.7 * k, out, m);
    const tw = AVG_CAR_WEIGHT.reduce((acc, [, x]) => acc + x, 0);
    // expected random cars: cars − 1 without the tender (30%), cars − 2 with it (70%)
    for (const [kind, x] of AVG_CAR_WEIGHT) carLoot(s, d, kind, (Math.max(0, cars - 1.7) * x * k) / tw, out, m);
    if (s.upgrades.grappling_hook) {
      // the hook turns the last random car into a baggage car when the train has no 1st-class/baggage car
      const none = 0.3 * Math.pow(0.7, Math.max(0, cars - 1)) + 0.7 * Math.pow(0.7, Math.max(0, cars - 2));
      carLoot(s, d, "baggage", none * k, out, m);
      const plain = AVG_CAR_WEIGHT.filter(([kind]) => kind !== "first" && kind !== "baggage");
      const pw = plain.reduce((acc, [, x]) => acc + x, 0);
      for (const [kind, x] of plain) carLoot(s, d, kind, (-none * x * k) / pw, out, m);
      if (active) out.trinkets += (0.6 * 2) / d.intervals.metro;
    }
  }
  if (trainActive(s, "royal_express")) {
    const k = collect(trainA) / d.intervals.express;
    const m = { mult: d.trainValueMult };
    for (const kind of ["engine", "tender", "first", "first", "first", "dining", "dining", "baggage", "baggage", "mail", "third"] as const) carLoot(s, d, kind, k, out, m);
    carLoot(s, d, "royal", k, out, { mult: d.trainValueMult * Math.pow(1.5, Math.max(0, s.buildings.express_depot - 1)), pieces: 2 });
    if (active && s.upgrades.grappling_hook) out.trinkets += (0.6 * 2) / d.intervals.express;
  }
  return out;
}

/** Expected value per second of trains/capsules (market-weighted), for ROI of event buildings. */
export function eventIncome(s: GameState, d: Derived, w: ResMap, active: boolean): number {
  const ev = eventRates(s, d, active);
  let v = 0;
  for (const r of RES_IDS) v += ev[r] * w[r];
  return v;
}

/* ================================================================ job planner */

type Jobs = Record<JobId, number>;

function zeroJobs(): Jobs {
  return Object.fromEntries(JOB_IDS.map((j) => [j, 0])) as Jobs;
}

/**
 * Plan a job assignment: food first, limited producers, converter chains (with supporting scavengers/pickpockets/stokers),
 * then the open jobs by water-filling the shopping-list deficits (minimise the slowest resource), the rest by weighted value.
 */
export function planJobs(s: GameState, d: Derived, rats: number, w: ResMap, deficit: ResMap): Jobs {
  const jobs = zeroJobs();
  let left = Math.max(0, Math.floor(rats));
  const free = (j: JobId) => Math.max(0, d.slots[j] - jobs[j]);
  const add = (j: JobId, n: number) => {
    const k = Math.max(0, Math.min(Math.floor(n), left, free(j)));
    jobs[j] += k;
    left -= k;
    return k;
  };
  const wf = rats > 0 ? Math.max(0, 1 - stunnedRats(s) / Math.max(1, s.rats)) : 1;
  const unit = (j: JobId, r: ResId) => perWorker(d, j, r) * resMult(s, d, r, false) * wf;
  const open = OPEN.filter((j) => jobUnlocked(s, j));
  const openValue = (j: JobId) => entries(JOBS[j].produces).reduce((a, [r]) => a + unit(j, r) * w[r], 0);
  const bestOpen = open.length ? Math.max(...open.map(openValue)) : 0;

  // 1. food (+10% margin)
  if (jobUnlocked(s, "forager")) {
    const f0 = flows(s, d, jobs, rats);
    const need = -f0.crumbs + 0.04 * rats * 0.1;
    const per = unit("forager", "crumbs");
    if (need > 0 && per > 0) add("forager", Math.ceil(need / per));
  }

  // 2. limited producers without inputs
  for (const j of LIMITED_PRODUCERS) {
    if (!jobUnlocked(s, j)) continue;
    const r = Object.keys(JOBS[j].produces)[0] as ResId;
    if (isFull(s, d, r) && deficit[r] <= 0) continue;
    add(j, free(j));
  }

  // 3. converter chains: one more worker plus the supporters its inputs need, if worth more per rat than an open job
  const supporter: Partial<Record<ResId, JobId>> = { buttons: "scavenger", wire: "scavenger", coins: "pickpocket", coal: "coal_miner", cheese: "cheese_thief", steam: "stoker" };
  const lackOf = (t: Jobs, c: JobId): [ResId, number][] => {
    const f = flows(s, d, { ...t, [c]: 0 }, rats, Infinity);
    const rate = t[c] * d.jobSpeed[c] * wf;
    const out: [ResId, number][] = [];
    for (const [r, v] of entries(JOBS[c].consumes)) {
      const lack = rate * v - Math.max(0, f[r]);
      if (lack > 1e-9 && s.res[r] < lack * STOCK_HORIZON) out.push([r, lack]);
    }
    return out;
  };
  const supportPer = (sup: JobId, r: ResId) => (sup === "stoker" ? perWorker(d, "stoker", "steam") * resMult(s, d, "steam", false) * wf : unit(sup, r));
  for (const j of PLAN_CONVERTERS) {
    if (!jobUnlocked(s, j)) continue;
    const outs = Object.keys(JOBS[j].produces) as ResId[];
    if (outs.some((r) => isFull(s, d, r))) continue;
    let guard = 0;
    let chunk = Math.max(1, Math.floor(free(j) / 4));
    while (left > 0 && free(j) > 0 && guard++ < 400) {
      const step = Math.max(1, Math.min(chunk, free(j), left));
      const trial = { ...jobs };
      trial[j] += step;
      let used = step;
      let ok = false;
      for (let pass = 0; pass < 5; pass++) {
        let missing = false;
        let stuck = false;
        for (const c of [j, "stoker"] as JobId[]) {
          if (trial[c] <= 0) continue;
          for (const [r, lack] of lackOf(trial, c)) {
            missing = true;
            const sup = supporter[r];
            const per = sup ? supportPer(sup, r) : 0;
            if (!sup || !jobUnlocked(s, sup) || per <= 0 || (JOBS[sup].slots && trial[sup] >= d.slots[sup])) {
              stuck = true;
              break;
            }
            const n = Math.max(1, Math.ceil(lack / per));
            const room = JOBS[sup].slots ? d.slots[sup] - trial[sup] : Infinity;
            const k = Math.min(n, room);
            trial[sup] += k;
            used += k;
          }
          if (stuck) break;
        }
        if (stuck || used > left) break;
        if (!missing) {
          ok = true;
          break;
        }
      }
      if (!ok) {
        if (step > 1) {
          chunk = 1;
          continue;
        }
        break;
      }
      const before = flows(s, d, jobs, rats);
      const after = flows(s, d, trial, rats);
      let dv = 0;
      for (const r of RES_IDS) dv += (after[r] - before[r]) * w[r];
      // a missing project resource (needs > 10 min at the current flow) is staffed regardless of the per-rat value
      const urgent = outs.some((r) => deficit[r] > 0 && Math.max(0, before[r]) * 600 < deficit[r]);
      if (!urgent && (dv <= 0 || dv / used < bestOpen * 0.9)) {
        if (step > 1) {
          chunk = 1;
          continue;
        }
        break;
      }
      for (const k of JOB_IDS) jobs[k] = trial[k];
      left -= used;
    }
  }

  // 3b. stokers for steam buildings (press, clocktower) when coal allows
  if (d.steamNeed > 0 && jobUnlocked(s, "stoker")) {
    let guard = 0;
    while (left > 0 && free("stoker") > 0 && guard++ < 200) {
      const f = flows(s, { ...d, steamNeed: 0 }, jobs, rats);
      if (f.steam >= d.steamNeed) break;
      const trial = { ...jobs, stoker: jobs.stoker + 1 };
      const f2 = flows(s, { ...d, steamNeed: 0 }, trial, rats);
      if (f2.steam <= f.steam + 1e-9) break; // no coal
      jobs.stoker++;
      left--;
    }
  }

  // 4. open jobs: half by weighted value (a human keeps every flow going), half water-fills the deficits
  if (left > 0 && open.length) {
    const val = (j: JobId) => entries(JOBS[j].produces).reduce((a, [r]) => a + (isFull(s, d, r) && deficit[r] <= 0 ? 0 : unit(j, r) * w[r]), 0);
    const shareByValue = (n: number) => {
      const ranked = [...open].sort((a, b) => val(b) - val(a));
      const shares = ranked.length === 1 ? [1] : ranked.length === 2 ? [0.7, 0.3] : [0.6, 0.3, 0.1];
      let given = 0;
      ranked.forEach((j, i) => {
        const k = i === ranked.length - 1 ? n - given : Math.floor(n * shares[i]);
        given += add(j, k);
      });
    };
    shareByValue(Math.floor(left / 2));
    const base = flows(s, d, jobs, rats);
    const resOf: Record<string, ResId[]> = { forager: ["crumbs"], pickpocket: ["coins"], scavenger: ["buttons", "wire"] };
    const needFor = (T: number): Record<string, number> => {
      const out: Record<string, number> = {};
      for (const j of open) {
        let n = 0;
        for (const r of resOf[j]) {
          if (deficit[r] <= 0) continue;
          const p = unit(j, r);
          if (p <= 0) continue;
          n = Math.max(n, (deficit[r] / T - Math.max(0, base[r])) / p);
        }
        out[j] = Math.max(0, n);
      }
      return out;
    };
    const sum = (o: Record<string, number>) => Object.values(o).reduce((a, x) => a + x, 0);
    const anyDeficit = open.some((j) => resOf[j].some((r) => deficit[r] > 0));
    if (anyDeficit) {
      let lo = 1;
      let hi = 1e7;
      if (sum(needFor(hi)) > left) lo = hi;
      else {
        for (let it = 0; it < 50; it++) {
          const mid = Math.sqrt(lo * hi);
          if (sum(needFor(mid)) > left) lo = mid;
          else hi = mid;
        }
      }
      const n = needFor(hi);
      const order = [...open].sort((a, b) => n[b] - n[a]);
      for (const j of order) add(j, Math.floor(n[j]));
    }
    // whatever the deficits did not need, by weighted value
    if (left > 0) shareByValue(left);
  }
  return jobs;
}

/* ================================================================ bot */

export type BotKind = "active" | "passive";

export interface BotStats {
  storageStall: number; // current consecutive seconds the top wish is locked by a cap
  maxStorageStall: number;
  maxStorageStallAt: number;
  lastGoalAt: number;
  maxGoalGap: number;
  maxGoalGapAt: number;
  purchases: number;
}

interface Candidate {
  id: BuildingId;
  /** Support buildings bought together with `id` (chain bundles: foundry + boiler + coal chute…). */
  extra: BuildingId[];
  cost: Amounts;
  score: number;
  dv: number;
  tta: number;
  locked: ResId[];
  /** All income rates per resource after the purchase (flows + events + clicks). */
  rates2: ResMap;
}

/** Commissions in the order the active bot can finish them (EN-12). */
const COMMISSION_PREF: CommissionId[] = ["three_gold", "purse_season", "royal_mail", "whiskers_twice", "dry_paws2", "pipe_splinters", "replenish", "bullseye", "lamplighter", "quick_hand", "frenzy5", "wagon"];

/** Priority order for edicts (cheap first, per GDD 15.14). */
export const EDICT_PLAN: EdictId[] = [
  "royal_litter",
  "ancestral_paws",
  "rat_memory",
  "eternal_night_shift",
  "old_tunnels",
  "inherited_foreman",
  "timetable_in_head",
  "lucky_tail",
  "golden_whiskers",
  "felt_soles",
  "express_blueprints",
  "kings_favor",
];

export class Bot {
  readonly kind: BotKind;
  readonly rnd: { rng: number };
  private clickAcc = 0;
  private nextDecision = 0;
  private sceneSeq = -1;
  private sceneT0 = 0;
  private phaseKey = "";
  private seenShiny = new Set<number>();
  private marketSeen = -1;
  private wishes: Amounts[] = [];
  private lastTop: Candidate | null = null;
  w: ResMap = { ...VALUE };
  deficit: ResMap = zeroRes();
  rush = false;
  /** Cost of a pending project accelerator: kept out of contributions until it is bought. */
  private accReserve: Amounts = {};
  /** Optional decision log (dev). */
  debug: ((msg: string) => void) | null = null;
  stats: BotStats = { storageStall: 0, maxStorageStall: 0, maxStorageStallAt: 0, lastGoalAt: 0, maxGoalGap: 0, maxGoalGapAt: 0, purchases: 0 };
  private visibleCount = 0;
  /** The building the bot skipped a purchase to save for at its last decision. */
  private waitedFor: BuildingId | null = null;

  constructor(kind: BotKind, seed: number) {
    this.kind = kind;
    this.rnd = { rng: (seed ^ 0x5bd1e995) >>> 0 };
  }

  /** Reset per-run bookkeeping after a migration. */
  newRun(): void {
    this.nextDecision = 0;
    this.sceneSeq = -1;
    this.seenShiny.clear();
    this.marketSeen = -1;
    this.wishes = [];
    this.lastTop = null;
    this.stats = { storageStall: 0, maxStorageStall: 0, maxStorageStallAt: 0, lastGoalAt: 0, maxGoalGap: 0, maxGoalGapAt: 0, purchases: 0 };
    this.visibleCount = 0;
    this.waitedFor = null;
  }

  /** Whether the player counts as "active" for the scheduler (harmful events, suspicion). */
  isActive(s: GameState): boolean {
    return this.kind === "active" || s.time < 180;
  }

  /** Called once per tick after step(); `d` is what step() derived this tick (saves a second derive). */
  tick(s: GameState, ctx: EngineCtx, d: Derived = derive(s)): void {
    this.clicks(s, d, ctx);
    if (this.kind === "active") {
      this.handleScene(s, d, ctx);
      this.handleBackground(s, d, ctx);
      this.handleCommissions(s, ctx);
    }
    const interval = this.kind === "active" ? 5 : 60;
    if (s.time >= this.nextDecision) {
      this.nextDecision = s.time + interval;
      this.decide(s, ctx);
    }
  }

  /* ---------------------------------------------------------- clicks */

  private clicks(s: GameState, d: Derived, ctx: EngineCtx): void {
    let cps = 0;
    if (this.kind === "active") cps = s.time < 600 ? 4 : 1;
    else cps = s.time < 180 ? 2 : 0;
    if (cps <= 0) return;
    this.clickAcc += cps * TICK;
    while (this.clickAcc >= 1) {
      this.clickAcc -= 1;
      click(s, d, ctx);
    }
  }

  /* ---------------------------------------------------------- scenes (active only) */

  private handleScene(s: GameState, d: Derived, ctx: EngineCtx): void {
    const sc = s.scene;
    if (!sc) return;
    if (sc.seq !== this.sceneSeq) {
      this.sceneSeq = sc.seq;
      this.phaseKey = "";
      sceneAction(s, d, { a: "attach" }, ctx);
    }
    const key = `${sc.seq}:${sc.phase}`;
    if (key !== this.phaseKey) {
      this.phaseKey = key;
      this.sceneT0 = s.time;
    }
    const dt = s.time - this.sceneT0;
    switch (sc.phase) {
      case "rumble":
        if (dt < 0.15) {
          if (sc.id !== "capsule") {
            sceneAction(s, d, { a: "position", pos: "rails" }, ctx);
            if (d.netSlots > 0) {
              if (s.trainPrefs.lastNets.length) sceneAction(s, d, { a: "netsRepeat" }, ctx);
              for (let k = 0; k < 3 && sc.nets.length < d.netSlots; k++) if (!sc.nets.includes(k)) sceneAction(s, d, { a: "net", section: k }, ctx);
            }
          }
        } else if (dt >= 2) sceneAction(s, d, { a: "ready" }, ctx);
        break;
      case "catch":
        if (s.time >= sc.phaseEnds - 0.05) sceneAction(s, d, { a: "catch", result: this.catchResult(s) }, ctx);
        break;
      case "piles":
        if (dt >= Math.min(6, (sc.phaseEnds - sc.phaseStart) * 0.4)) {
          const f = Math.min(1, sc.auto + 0.15); // EN-5: the lineman leaves a good player about +15%
          sceneAction(s, d, { a: "piles", fractions: sc.piles.map(() => f) }, ctx);
        }
        break;
      case "haul":
        if (dt >= 3) sceneAction(s, d, { a: "dismiss" }, ctx);
        break;
      case "warn":
        if (dt >= 1) sceneAction(s, d, { a: "choice", option: "fight" }, ctx);
        break;
      case "taps":
        if (sc.id === "downpour" && dt >= 6) sceneAction(s, d, { a: "taps", cleared: sc.taps?.count ?? 3 }, ctx);
        else if (sc.id === "cat" && dt >= 5) sceneAction(s, d, { a: "taps", cleared: rand(this.rnd) < 0.7 ? 1 : 0 }, ctx);
        else if (sc.id === "ratcatcher" && dt >= 12) {
          const n = sc.taps?.count ?? 24;
          sceneAction(s, d, { a: "taps", cleared: Math.round(0.85 * n) }, ctx);
        }
        break;
      default:
        break;
    }
  }

  /** Catch 75% of the items with an average combo multiplier of ×1.2; nets/clockwork take what is left. */
  private catchResult(s: GameState): CatchResult {
    const sc = s.scene!;
    const caught: CatchResult["caught"] = [];
    const netted: number[] = [];
    const taken = new Set<number>();
    let sparksHit = 0;
    for (const it of sc.items) {
      if (it.spark) {
        if (rand(this.rnd) < 0.1) sparksHit++;
        continue;
      }
      if (rand(this.rnd) < 0.75) {
        caught.push({ id: it.id, combo: 10, lantern: sc.lantern && rand(this.rnd) < 0.15 });
        taken.add(it.id);
      }
    }
    if (sc.nets.length) {
      for (const car of sc.cars) {
        const left = car.itemIds.map((id) => sc.items[id]).filter((it) => it && !it.spark && !taken.has(it.id));
        left.sort((a, b) => b.weight - a.weight);
        for (let n = 0; n < sc.nets.length && n < left.length; n++) {
          netted.push(left[n].id);
          taken.add(left[n].id);
        }
      }
    }
    if (s.upgrades.clockwork_legion && isTrainScene(sc.id)) {
      let next = 0;
      for (const it of [...sc.items].filter((x) => !x.spark).sort((a, b) => a.t - b.t)) {
        if (taken.has(it.id)) continue;
        if (it.t >= next) {
          netted.push(it.id);
          taken.add(it.id);
          next = it.t + 0.5;
        }
      }
    }
    let hook: CatchResult["hook"] = "none";
    if (sc.hookCar >= 0) {
      const r = rand(this.rnd);
      hook = r < 0.15 ? "perfect" : r < 0.6 ? "hit" : "miss";
    }
    return { caught, netted, sparksHit, hook, maxCombo: Math.min(30, 10 + Math.floor(caught.length / 4)) };
  }

  private handleBackground(s: GameState, d: Derived, ctx: EngineCtx): void {
    if (s.purse && s.purse.until - s.time < 10) clickPurse(s, d, ctx);
    for (const sh of s.shinies) {
      if (this.seenShiny.has(sh.id)) continue;
      this.seenShiny.add(sh.id);
      if (rand(this.rnd) < 0.5) clickShiny(s, d, sh.id, ctx);
    }
    if (this.seenShiny.size > 500) this.seenShiny = new Set([...this.seenShiny].slice(-50));
    if (s.market && this.marketSeen !== s.market.until) {
      this.marketSeen = s.market.until;
      s.market.deals.forEach((deal, i) => {
        if (s.res[deal.give] < deal.giveAmt) return;
        const giveV = deal.giveAmt * this.w[deal.give];
        const getV = deal.getAmt * this.w[deal.get];
        const spare = isFull(s, d, deal.give) || this.deficit[deal.give] <= 0;
        if (spare && getV > giveV * 0.8) marketDeal(s, d, i, ctx);
      });
    }
  }

  /* ---------------------------------------------------------- decisions */

  /** Effective rats for planning: births expected within ~30 s, capped by housing. */
  private effRats(s: GameState, d: Derived): number {
    return Math.min(d.housing, s.rats + (s.flags.vagrants ? d.birthRate * 30 : 0));
  }

  private value(s: GameState, d: Derived, rats: number, reuse?: Jobs): { v: number; jobs: Jobs; f: ResMap; all: ResMap } {
    const jobs = reuse ?? planJobs(s, d, Math.floor(rats), this.w, this.deficit);
    const f = flows(s, d, jobs, Math.floor(rats));
    const ev = eventRates(s, d, this.kind === "active");
    const all = zeroRes();
    let v = 0;
    for (const r of RES_IDS) {
      all[r] = f[r] + ev[r] + this.clickRate(s, d, r);
      v += (f[r] + ev[r]) * this.w[r];
    }
    return { v, jobs, f, all };
  }

  /** Seconds until `rem` is covered by stock (after paying `cost`) at the given rates. */
  private etaWith(s: GameState, rem: Amounts, cost: Amounts, rates: ResMap): number {
    let t = 0;
    for (const [r, v] of entries(rem)) {
      const lack = v - (s.res[r] - (cost[r] ?? 0));
      if (lack <= 0) continue;
      if (rates[r] <= 1e-9) return Infinity;
      t = Math.max(t, lack / rates[r]);
    }
    return t;
  }

  /** Current project (expedition or express) remaining cost, and its rat requirement. */
  private project(s: GameState): { kind: "zone" | "plan" | "express"; zone?: ZoneId; rem: Amounts; rats: number } | null {
    const z = currentExpedition(s);
    if (z && !s.digging) {
      const rem = remaining(expeditionCost(s, z), s.projects[z] ?? {});
      return { kind: "zone", zone: z, rem, rats: ZONES[z].expedition?.rats ?? 0 };
    }
    // on the terminal, before the express plan: the clocktower and the plan itself are the goal
    if (s.zones.terminal && !s.upgrades.express_plan) {
      const rem: Amounts = { ...UPGRADES.express_plan.cost };
      if (s.buildings.clocktower === 0) for (const [r, v] of entries(buildingCost("clocktower", 0))) rem[r] = (rem[r] ?? 0) + v;
      return { kind: "plan", rem, rats: 0 };
    }
    if (s.upgrades.express_plan) {
      return { kind: "express", rem: remaining(expressCost(s), s.express.progress), rats: 0 };
    }
    return null;
  }

  /** Recompute need-weights from the shopping list: bottleneck resources (longest time to afford) weigh more. */
  private updateWeights(s: GameState, d: Derived, f: ResMap, proj: ReturnType<Bot["project"]>): void {
    const def = zeroRes();
    const add = (a: Amounts) => {
      for (const [r, v] of entries(a)) def[r] += v;
    };
    if (proj) add(proj.rem);
    for (const w of this.wishes) add(w);
    for (const r of RES_IDS) def[r] = Math.max(0, def[r] - s.res[r]);
    this.deficit = def;
    const t = zeroRes();
    let tMax = 1;
    for (const r of RES_IDS) {
      if (def[r] <= 0) continue;
      t[r] = Math.min(7200, def[r] / Math.max(1e-3, f[r]));
      tMax = Math.max(tMax, t[r]);
    }
    for (const r of RES_IDS) {
      let k = def[r] > 0 ? 0.5 + 1.5 * (t[r] / tMax) : 0.5;
      // nothing needs it and it is full, or ten minutes of its output are already banked: little marginal value
      if (def[r] <= 0 && (isFull(s, d, r) || s.res[r] > 600 * Math.max(1, f[r]))) k = 0.05;
      this.w[r] = VALUE[r] * k;
    }
  }

  private clickRate(s: GameState, d: Derived, r: ResId): number {
    const cps = this.kind === "active" ? (s.time < 600 ? 4 : 1) : s.time < 180 ? 2 : 0;
    const auto = d.autoclick.cps * d.autoclick.power;
    const c = cps + auto;
    if (r === "crumbs") return c * d.click;
    if (r === "coins" && s.resEver.crumbs >= 30) return c * 0.1 * d.dropMult * Math.max(1, 0.2 * d.click);
    if ((r === "buttons" || r === "wire") && s.rats >= 6) return c * 0.06 * d.dropMult * Math.max(1, 0.15 * d.click);
    return 0;
  }

  private decide(s: GameState, ctx: EngineCtx): void {
    let d = derive(s);
    this.trackGoals(s);
    // edicts (between runs the bot buys them right after migrating)
    if (s.upgrades.cheese_diet && !s.satiety && s.res.cheese > 0.005 * s.rats * 120) toggleSatiety(s);
    if (s.upgrades.tube_orders && s.assignMode !== "smart") setAssignMode(s, "smart");

    const proj = this.project(s);
    // weights from the current plan
    const rats0 = this.effRats(s, d);
    let cur = this.value(s, d, rats0);
    this.updateWeights(s, d, cur.all, proj);
    cur = this.value(s, d, rats0);

    // project rush: everything goes to the expedition/express once it is within reach
    const eta = proj ? this.etaWith(s, proj.rem, {}, cur.all) : Infinity;
    const ratsOk = !proj || proj.rats <= Math.max(s.rats, d.housing);
    // the passive player only holds resources back when the project is minutes away (it checks in once a minute)
    const scoreRush = this.kind === "active" && this.lastTop !== null && this.lastTop.score > eta * 1.5;
    this.rush = !!proj && ratsOk && (eta <= (proj.kind === "zone" ? 300 : 180) || scoreRush);

    let bought = 0;
    // upgrades: buy everything affordable (skip ones that eat a rushed project's bottleneck)
    for (const u of [...UPGRADE_IDS].sort((a, b) => bundleValue(UPGRADES[a].cost) - bundleValue(UPGRADES[b].cost))) {
      if (s.upgrades[u] || !upgradeVisible(s, u)) continue;
      if (!canAfford(s, UPGRADES[u].cost)) continue;
      if (this.rush && proj && this.conflicts(UPGRADES[u].cost, proj.rem, s) && bundleValue(UPGRADES[u].cost) > 0.15 * bundleValue(proj.rem)) continue;
      if (buyUpgrade(s, u, ctx)) {
        bought++;
        this.note(s);
      }
    }
    d = derive(s);

    // buildings
    const maxBuys = this.kind === "active" ? 6 : 15;
    for (let k = 0; k < maxBuys; k++) {
      const ids = this.chooseBuilding(s, d, proj);
      if (this.debug) this.debug(`  choose → ${ids.join("+") || "(nothing)"}`);
      if (!ids.length) break;
      let ok = true;
      for (const id of ids) {
        if (buyBuilding(s, d, id, 1, ctx) <= 0) {
          ok = false;
          break;
        }
        bought++;
        this.note(s);
        d = derive(s);
      }
      if (!ok) break;
    }

    // stall tracking: top wish locked by a cap and nothing bought
    const top = this.lastTop;
    if (top && top.locked.length && bought === 0) {
      this.stats.storageStall += this.kind === "active" ? 5 : 60;
      if (this.stats.storageStall > this.stats.maxStorageStall) {
        this.stats.maxStorageStall = this.stats.storageStall;
        this.stats.maxStorageStallAt = s.time;
      }
    } else this.stats.storageStall = 0;

    // contributions
    if (proj && proj.kind !== "plan") this.contribute(s, d, proj, ctx);

    // jobs
    if (s.assignMode !== "smart") {
      const plan = planJobs(s, d, s.rats, this.w, this.deficit);
      this.applyJobs(s, d, plan);
    }
  }

  private conflicts(cost: Amounts, rem: Amounts, s: GameState): boolean {
    for (const [r, v] of entries(cost)) if ((rem[r] ?? 0) > 0 && v > 0 && s.res[r] < (rem[r] ?? 0) + v) return true;
    return false;
  }

  private note(s: GameState): void {
    this.stats.purchases++;
    this.goal(s);
  }

  /** A scouting payout (EN-4) or a zone opening is a beat too: it counts as a new goal for the "ожидание новой цели" metric. */
  noteScout(s: GameState): void {
    this.goal(s);
  }

  private goal(s: GameState): void {
    const gap = s.time - this.stats.lastGoalAt;
    if (gap > this.stats.maxGoalGap) {
      this.stats.maxGoalGap = gap;
      this.stats.maxGoalGapAt = s.time;
    }
    this.stats.lastGoalAt = s.time;
  }

  /** New visible buildings/upgrades or an expedition card count as a "new goal". */
  private trackGoals(s: GameState): void {
    let n = 0;
    for (const id of BUILDING_IDS) if (buildingVisible(s, id)) n++;
    for (const u of UPGRADE_IDS) if (upgradeVisible(s, u)) n++;
    for (const z of ZONE_ORDER) if (s.zones[z] || s.revealed[`exp_${z}`]) n++;
    n += s.express.stage;
    if (n > this.visibleCount) {
      this.visibleCount = n;
      this.goal(s);
    }
  }

  /** Choose the next building(s): rat requirement → project enablers → storage locks → best payback (time to afford + cost/Δincome). */
  private chooseBuilding(s: GameState, d: Derived, proj: ReturnType<Bot["project"]>): BuildingId[] {
    const rats = this.effRats(s, d);
    // the baseline uses the same steam-efficiency estimate as the hypothetical states below
    const plan0 = planJobs(s, d, Math.floor(rats), this.w, this.deficit);
    const saveEff0 = s.steamEff;
    let d0 = d;
    if (d.steamNeed > 0) {
      s.steamEff = steamEffFor(s, d, plan0, rats);
      d0 = derive(s);
    }
    const base = this.value(s, d0, rats);
    s.steamEff = saveEff0;
    const cands: Candidate[] = [];
    const rates = base.f;
    const open = (id: BuildingId) => buildingVisible(s, id) && (BUILDINGS[id].maxLevel === undefined || s.buildings[id] < BUILDINGS[id].maxLevel!);
    const evalAdds = (adds: BuildingId[]): { dv: number; cost: Amounts; rates2: ResMap } => {
      const cost: Amounts = {};
      for (const a of adds) for (const [r, v] of entries(buildingCost(a, s.buildings[a]))) cost[r] = (cost[r] ?? 0) + v;
      for (const a of adds) s.buildings[a]++;
      const saveEff = s.steamEff;
      let d2 = derive(s);
      const rats2 = Math.min(d2.housing, rats + (d2.housing - d.housing) * (s.rats >= d.housing - 1 ? 0.8 : 0));
      // buildings that cannot change the job plan (no slots/housing/job bonus/caps) reuse the baseline plan
      const replan = adds.some((a) => BUILDINGS[a].effects.some((e) => PLAN_EFFECTS.has(e.t)));
      if (d2.steamNeed > 0) {
        // steam share under the plan the purchase leads to: new stoker slots (a boiler) feed the press and clocktower
        const plan2 = replan ? planJobs(s, d2, Math.floor(rats2), this.w, this.deficit) : base.jobs;
        s.steamEff = steamEffFor(s, d2, plan2, rats2);
        d2 = derive(s);
      }
      const r2 = this.value(s, d2, rats2, replan ? undefined : base.jobs);
      s.steamEff = saveEff;
      for (const a of adds) s.buildings[a]--;
      return { dv: r2.v - base.v, cost, rates2: r2.all };
    };
    const candidate = (id: BuildingId, extra: BuildingId[]): Candidate => {
      const { dv, cost, rates2 } = evalAdds([...extra, id]);
      const cv = bundleValue(cost, this.w);
      const locked = entries(cost)
        .filter(([r, v]) => Number.isFinite(d.caps[r]) && v > d.caps[r] && s.res[r] < v)
        .map(([r]) => r);
      let tta = 0;
      for (const [r, v] of entries(cost)) {
        const lack = v - s.res[r];
        if (lack <= 0) continue;
        const rate = Math.max(0, rates[r]) + this.clickRate(s, d, r);
        tta = Math.max(tta, rate > 1e-9 ? lack / rate : Infinity);
      }
      const score = dv > 1e-12 ? tta + cv / dv : Infinity;
      return { id, extra, cost, score, dv, tta, locked, rates2 };
    };
    for (const id of BUILDING_IDS) {
      if (!open(id)) continue;
      let c = candidate(id, []);
      const sups = (BUNDLES[id] ?? []).filter(open);
      if (sups.length) {
        const c2 = candidate(id, sups);
        if (c2.score < c.score) c = c2;
      }
      cands.push(c);
    }

    cands.sort((a, b) => a.score - b.score);
    const ranked = cands.filter((c) => Number.isFinite(c.score));
    if (this.debug)
      this.debug(
        `  top: ${(ranked.length ? ranked : cands)
          .slice(0, 4)
          .map((c) => `${c.id}(sc ${c.score.toFixed(0)} tta ${c.tta.toFixed(0)} dv ${c.dv.toFixed(3)}${c.locked.length ? " 🔒" + c.locked.join(",") : ""})`)
          .join(" ")} | def ${RES_IDS.filter((r) => this.deficit[r] > 0).map((r) => `${r}:${this.deficit[r].toFixed(0)}`).join(" ")} | w ${RES_IDS.filter((r) => this.w[r] > 0).map((r) => `${r}:${this.w[r].toFixed(2)}`).join(" ")}`,
      );
    this.lastTop = ranked[0] ?? null;
    this.wishes = ranked.slice(0, 2).map((c) => c.cost);
    for (const u of [...UPGRADE_IDS]
      .filter((u) => !s.upgrades[u] && upgradeVisible(s, u))
      .sort((a, b) => bundleValue(UPGRADES[a].cost) - bundleValue(UPGRADES[b].cost))
      .slice(0, 2))
      this.wishes.push(UPGRADES[u].cost);

    // project accelerators: the purchase that finishes the project soonest (saving for it + its cost included)
    let pendingAcc: Candidate | null = null;
    this.accReserve = {};
    if (proj && !(proj.rats > d.housing)) {
      const etaNow = this.etaWith(s, proj.rem, {}, base.all);
      let acc: Candidate | null = null;
      let accT = Number.isFinite(etaNow) ? etaNow * 0.97 : Infinity;
      for (const c of cands) {
        if (c.locked.length || !Number.isFinite(c.tta) || c.tta > 600) continue;
        // stock when the candidate becomes affordable, minus its price, then the new rates
        const later: Amounts = {};
        for (const r of RES_IDS) later[r] = (c.cost[r] ?? 0) - base.all[r] * c.tta;
        const t = c.tta + this.etaWith(s, proj.rem, later, c.rates2);
        if (t < accT || (!acc && !Number.isFinite(accT) && Number.isFinite(t))) {
          accT = t;
          acc = c;
        }
      }
      if (acc) {
        if (this.debug) this.debug(`  accelerate ${acc.id}${acc.extra.length ? "+" + acc.extra.join("+") : ""}: ETA ${etaNow.toFixed(0)} → ${accT.toFixed(0)} (tta ${acc.tta.toFixed(0)})`);
        if (canAfford(s, acc.cost)) return [...acc.extra, acc.id];
        pendingAcc = acc;
        this.accReserve = { ...acc.cost };
        this.wishes.push(acc.cost);
      }
    }

    // resources reserved for a rushed project and for pending priority targets
    const reserve = zeroRes();
    const rushed = zeroRes();
    if (this.rush && proj) for (const [r, v] of entries(proj.rem)) rushed[r] += v;
    // a pending target only reserves what cannot be earned again before its slowest resource arrives
    // (if waiting can never make it affordable — a resource nobody produces — holding the rest is pointless)
    const hold = (c: Candidate) => {
      if (!Number.isFinite(c.tta)) return;
      for (const [r, v] of entries(c.cost)) reserve[r] += Math.max(0, v - Math.max(0, base.all[r]) * c.tta);
    };
    if (pendingAcc) hold(pendingAcc);
    // a rushed project holds everything it still needs, except from a small purchase (≤ 2% of what the project still
    // needs of each resource it shares): nobody stops buying a 15K-coin chute while saving 3M for the Terminal
    const small = (cost: Amounts) => entries(cost).every(([r, v]) => !(rushed[r] > 0) || v <= 0.02 * rushed[r]);
    const held = (cost: Amounts, r: ResId) => reserve[r] + (small(cost) ? 0 : rushed[r]);
    const fits = (cost: Amounts) => entries(cost).every(([r, v]) => s.res[r] + 1e-9 >= v + held(cost, r));

    // priority targets: housing for the project's rat requirement, buildings that enable a missing project resource
    const prio: Candidate[] = [];
    if (proj && proj.rats > d.housing) {
      const h = this.cheapestHousing(s, d, cands);
      if (h) prio.push(h);
    }
    if (proj?.kind === "plan" && s.buildings.clocktower === 0) {
      const c = cands.find((x) => x.id === "clocktower");
      if (c) prio.push(c);
    }
    if (proj)
      for (const id of this.enablers(s, proj.rem, rates)) {
        const c = cands.find((x) => x.id === id);
        if (c && !prio.includes(c)) prio.push(c);
      }
    const lockedRes = new Set<ResId>();
    for (const p of prio) {
      if (p.locked.length) {
        for (const r of p.locked) lockedRes.add(r);
        continue;
      }
      if (fits(p.cost)) return [...p.extra, p.id];
      hold(p);
    }

    // storage: a wish is locked by a cap, or a needed resource sits full
    for (const c of ranked.slice(0, 3)) for (const r of c.locked) lockedRes.add(r);
    for (const u of UPGRADE_IDS) {
      if (s.upgrades[u] || !upgradeVisible(s, u)) continue;
      for (const [r, v] of entries(UPGRADES[u].cost)) if (Number.isFinite(d.caps[r]) && v > d.caps[r]) lockedRes.add(r);
    }
    for (const r of RES_IDS) if (isFull(s, d, r) && this.deficit[r] > 0 && rates[r] > 0) lockedRes.add(r);
    for (const r of lockedRes) {
      const st = this.cheapestStorage(s, d, r);
      if (st && fits(st.cost)) return [st.id];
    }

    if (!ranked.length) return [];
    const best = ranked[0];
    const affordable = ranked.filter((c) => fits(c.cost));
    if (!affordable.length) return [];
    if (affordable[0] === best) return [...best.extra, best.id];
    // save for the best unless it is far away; otherwise take a good affordable alternative
    const alt = affordable[0];
    // waiting only pays when the best will fit once affordable (not held back by a rushed project or a pending
    // target), and a passive player who already waited a whole check-in for it takes the alternative
    const blocked = entries(best.cost).some(([r]) => held(best.cost, r) > 0);
    const stale = this.kind === "passive" && this.waitedFor === best.id;
    if (best.tta < 45 && !best.locked.length && !blocked && !stale && alt.score > best.score * 1.2) {
      this.waitedFor = best.id;
      return [];
    }
    this.waitedFor = null;
    // an alternative is measured against the best purchase that is not held back: next to a bargain the rushed project
    // keeps out of reach for now, every other building would look like junk and the colony would buy nothing
    const ref = blocked ? (ranked.find((c) => !entries(c.cost).some(([r]) => held(c.cost, r) > 0)) ?? best) : best;
    return alt.score <= Math.max(ref.score * 2.5, 600) ? [...alt.extra, alt.id] : [];
  }

  /** Buildings that start production of a project resource nobody makes yet (workshop → gears, library → blueprints…). */
  private enablers(s: GameState, rem: Amounts, rates: ResMap): BuildingId[] {
    const out: BuildingId[] = [];
    for (const [r, v] of entries(rem)) {
      if (v <= s.res[r] || rates[r] > 1e-6) continue;
      for (const id of ENABLERS[r] ?? []) if (s.buildings[id] === 0 && buildingVisible(s, id) && !out.includes(id)) out.push(id);
    }
    return out;
  }

  private cheapestHousing(s: GameState, d: Derived, cands: Candidate[]): Candidate | null {
    let best: Candidate | null = null;
    let bestV = Infinity;
    for (const c of cands) {
      const def = BUILDINGS[c.id];
      if (!def.effects.some((e) => e.t === "housing")) continue;
      s.buildings[c.id]++;
      const gain = derive(s).housing - d.housing;
      s.buildings[c.id]--;
      if (gain <= 0) continue;
      const v = bundleValue(c.cost, this.w) / gain;
      if (v < bestV) {
        bestV = v;
        best = c;
      }
    }
    return best;
  }

  private cheapestStorage(s: GameState, d: Derived, r: ResId): { id: BuildingId; cost: Amounts } | null {
    let best: { id: BuildingId; cost: Amounts } | null = null;
    let bestV = Infinity;
    for (const id of BUILDING_IDS) {
      if (!buildingVisible(s, id)) continue;
      const def = BUILDINGS[id];
      if (def.maxLevel !== undefined && s.buildings[id] >= def.maxLevel) continue;
      if (!def.effects.some((e) => e.t === "cap" || e.t === "capMult")) continue;
      s.buildings[id]++;
      const gain = derive(s).caps[r] - d.caps[r];
      s.buildings[id]--;
      if (!(gain > 0)) continue;
      const cost = buildingCost(id, s.buildings[id]);
      // storage that itself costs more of r than the current cap is useless
      if ((cost[r] ?? 0) > d.caps[r]) continue;
      const v = bundleValue(cost, this.w) / gain;
      if (v < bestV) {
        bestV = v;
        best = { id, cost };
      }
    }
    return best;
  }

  private contribute(s: GameState, d: Derived, proj: NonNullable<ReturnType<Bot["project"]>>, ctx: EngineCtx): void {
    this.contributeParts(s, d, proj, ctx);
    // a zero-fraction call only checks completion (starts the dig once the rat requirement is met)
    if (proj.kind === "zone") contributeExpedition(s, proj.zone!, null, ctx, 0);
    else contributeExpress(s, null, ctx, 0);
  }

  private contributeParts(s: GameState, d: Derived, proj: NonNullable<ReturnType<Bot["project"]>>, ctx: EngineCtx): void {
    if (this.rush) {
      for (const [r, need] of entries(proj.rem)) {
        if (need <= 0) continue;
        const spare = s.res[r] - (this.accReserve[r] ?? 0);
        if (spare <= 0) continue;
        const frac = Math.min(1, spare / Math.max(1e-9, s.res[r]));
        if (proj.kind === "zone") contributeExpedition(s, proj.zone!, r, ctx, frac);
        else contributeExpress(s, r, ctx, frac);
      }
      return;
    }
    // otherwise only the surplus: what is not reserved for the next wishes, and what sits at the cap
    const reserve = zeroRes();
    for (const w of this.wishes) for (const [r, v] of entries(w)) reserve[r] = Math.max(reserve[r], v);
    for (const [r, v] of entries(this.accReserve)) reserve[r] = Math.max(reserve[r], v);
    for (const [r, need] of entries(proj.rem)) {
      if (need <= 0) continue;
      let spare = s.res[r] - reserve[r];
      if (isFull(s, d, r)) spare = Math.max(spare, s.res[r] * 0.5);
      if (spare <= 0) continue;
      const frac = Math.min(1, spare / Math.max(1e-9, s.res[r]));
      if (proj.kind === "zone") contributeExpedition(s, proj.zone!, r, ctx, frac);
      else contributeExpress(s, r, ctx, frac);
    }
  }

  private applyJobs(s: GameState, d: Derived, plan: Jobs): void {
    for (const j of JOB_IDS) {
      if (j === "idle") continue;
      if (s.jobs[j] > plan[j]) assignJob(s, d, j, plan[j] - s.jobs[j]);
    }
    for (const j of JOB_IDS) {
      if (j === "idle") continue;
      if (s.jobs[j] < plan[j]) assignJob(s, d, j, plan[j] - s.jobs[j]);
    }
    // newborns follow the most wanted open job until the next decision
    const open = OPEN.filter((j) => jobUnlocked(s, j));
    if (open.length) {
      const want = [...open].sort((a, b) => plan[b] - s.jobs[b] - (plan[a] - s.jobs[a]) || plan[b] - plan[a])[0];
      if (s.focus !== want) setFocus(s, want);
    }
  }

  /* ---------------------------------------------------------- prestige */

  /** Migrate when the GDD says so: run 1 at ~72–82 min (≥ 20 crowns), run 2 at ~85 min unless the coronation is near. */
  shouldMigrate(s: GameState, run: number): boolean {
    if (!canMigrate(s) || s.coronatedThisRun) return false;
    const crowns = crownsForRun(s);
    const min = s.time / 60;
    // a train haul can add 5–6 crowns at once near the end of run 1: a player with 24 already moves on
    if (run === 1) return (min >= 72 && crowns >= 20) || min >= 82 || crowns >= 24;
    if (run === 2) return min >= 85 && s.express.stage < 6;
    return false;
  }

  /**
   * EN-9 spending plan: unsigned base edicts (EDICT_PLAN order, cheapest first), then the railway seal, then edict
   * ranks II/III cheapest first. Returns what was bought ("railway" for the seal, "id:II"/"id:III" for ranks).
   */
  buyEdicts(s: GameState, ctx: EngineCtx): string[] {
    const out: string[] = [];
    for (const e of EDICT_PLAN) {
      if (s.meta.edicts[e]) continue;
      if (s.meta.crowns >= EDICTS[e].cost && buyEdict(s, e, ctx)) out.push(e);
    }
    if (EDICT_PLAN.every((e) => s.meta.edicts[e])) {
      if (!s.meta.sealsOwned.includes("railway") && s.meta.crowns >= SEALS.railway.cost && buySeal(s, "railway", ctx)) out.push("railway");
      if (s.meta.sealsOwned.includes("railway")) {
        for (;;) {
          let best: EdictId | null = null;
          let bestCost = Infinity;
          for (const e of EDICT_PLAN) {
            const ranks = EDICTS[e].ranks;
            const r = edictRank(s, e);
            if (!ranks || r < 1 || r > ranks.length) continue;
            if (ranks[r - 1].cost < bestCost) {
              bestCost = ranks[r - 1].cost;
              best = e;
            }
          }
          if (!best || s.meta.crowns < bestCost || !buyEdictRank(s, best, ctx)) break;
          out.push(`${best}:${edictRank(s, best) === 2 ? "II" : "III"}`);
        }
      }
    }
    return out;
  }

  /** EN-12: take the King's commission the bot can actually finish (its preference order), one at a time. */
  handleCommissions(s: GameState, ctx: EngineCtx): void {
    const c = s.commissions;
    if (!c || c.active) return;
    const pick = COMMISSION_PREF.find((id) => c.offered.includes(id)) ?? c.offered[0];
    if (pick) acceptCommission(s, pick, ctx);
  }
}

/* ================================================================ runner & metrics */

export interface Checkpoint {
  run: number;
  minute: number;
  rats: number;
  housing: number;
  zones: number;
  crumbsPerSec: number; // gross passive
  coinsPerSec: number; // all coins gained per second over the last minute (incl. clicks and events)
  coinsPassive: number;
  eRun: number;
  trainShare: number; // share of market-value income from metro/royal trains over the last 10 min
  trainCoinShare: number; // share of coin income from metro/royal trains over the last 10 min
  eventShare: number; // all scenes + purse etc. over the last 10 min
  crowns: number;
  expressStage: number;
  suspicion: number;
}

export interface RunReport {
  run: number;
  bot: BotKind;
  seconds: number;
  zoneOpenAt: Partial<Record<ZoneId, number>>;
  firstCapsuleAt: number | null;
  firstTrainAt: number | null;
  migrateReadyAt: number | null;
  eRun1MAt: number | null;
  expressStageAt: number[];
  coronationAt: number | null;
  crownsGained: number;
  crownsEverAfter: number;
  edictsBought: EdictId[];
  checkpoints: Checkpoint[];
  maxStorageStall: number;
  maxStorageStallAt: number;
  maxGoalGap: number;
  maxGoalGapAt: number;
  /** Longest stretch (s) at rats ≥ housing while housing is below the offered expedition's rat requirement (EN-2). */
  maxHousingStall: number;
  maxHousingStallAt: number;
  /** The same, per expedition zone (the longest stretch while that zone was the one on the map). */
  housingStallByZone: Partial<Record<ZoneId, number>>;
  /**
   * The housing dead zone proper (EN-13): the same stretch counted only while housing is what blocks the expedition,
   * i.e. the rest of its price is in the project or within 5 minutes of income.
   */
  maxHousingBlock: number;
  maxHousingBlockAt: number;
  housingBlockByZone: Partial<Record<ZoneId, number>>;
  /** Scouting payouts (EN-4). */
  scouts: number;
  /** Lowest steam efficiency of the press/clocktower seen in the run (1 = never short of steam). */
  minSteamEff: number;
  /** Express stages kept from the previous run at the start (express_blueprints). */
  expressKept: number;
  nonFinite: string[];
  buildingsSeen: BuildingId[];
  upgradesSeen: UpgradeId[];
  buildingLevels: Partial<Record<BuildingId, number>>;
  upgradesBought: number;
  scenes: Partial<Record<SceneEventId, number>>;
  /** Metro train variants seen (EN-6) and Cheddar cars. */
  variants: Partial<Record<TrainVariantId, number>>;
  cheeseCars: number;
  /** Medals awarded during the run (EN-11), in order. */
  medals: AchievementId[];
  /** Royal commissions finished after the coronation (EN-12). */
  commissionsDone: number;
  commissionLog: string[];
  /** Crowns spent on edicts, ranks and seals right after this run's migration (filled by simulate). */
  crownsSpent: number;
  migrated: boolean;
  final: GameState;
  offlineCheck?: OfflineCheck;
}

export interface OfflineCheck {
  away: number;
  simulated: number;
  eta: number;
  gainedValue: number;
  boundValue: number;
  ok: boolean;
}

export interface SimOptions {
  seed: number;
  bot: BotKind;
  runs: number;
  /** Per-run time limit in minutes. */
  minutes: number;
  /** Minutes at which to take checkpoints (in addition to every 10 min). */
  checkpointMinutes?: number[];
  /** Run the 8 h offline check on a snapshot at this minute of run 1. */
  offlineAtMinute?: number;
  /** Stop a run as soon as all zones are open + coronation (for tests) */
  stopAtCoronation?: boolean;
  /** Minutes the last run keeps playing after its coronation (EN-12 commissions; default 0.5). */
  postCoronationMinutes?: number;
  onProgress?: (msg: string) => void;
}

const VALUE_NO_NULL: ResMap = (() => {
  const v = zeroRes();
  for (const r of RES_IDS) v[r] = RESOURCES[r].market ?? 0;
  return v;
})();

function resValue(a: Amounts | ResMap): number {
  let v = 0;
  for (const [r, x] of Object.entries(a) as [ResId, number][]) v += (x ?? 0) * VALUE_NO_NULL[r];
  return v;
}

/** Check that all numeric state that must be finite is finite. */
export function nonFiniteFields(s: GameState): string[] {
  const bad: string[] = [];
  for (const r of RES_IDS) {
    for (const k of ["res", "resEver", "ema", "rates", "gross"] as const) if (!Number.isFinite(s[k][r])) bad.push(`${k}.${r}=${s[k][r]}`);
  }
  for (const k of ["rats", "eRun", "suspicion", "birthProgress", "time"] as const) if (!Number.isFinite(s[k])) bad.push(`${k}=${s[k]}`);
  for (const j of JOB_IDS) if (!Number.isFinite(s.jobs[j])) bad.push(`jobs.${j}`);
  return bad;
}

/** Run a bot for `opts.runs` runs (migrating between them). Deterministic for a given seed. */
export function simulate(opts: SimOptions): RunReport[] {
  const bot = new Bot(opts.bot, opts.seed);
  let s = createInitialState(opts.seed, 0);
  const reports: RunReport[] = [];
  let edictsBought: EdictId[] = [];
  for (let run = 1; run <= opts.runs; run++) {
    bot.newRun();
    const rep = runOne(s, bot, run, opts, edictsBought);
    reports.push(rep);
    if (!rep.migrated || run === opts.runs) break;
    const ctx: EngineCtx = { fx: [] };
    const next = migrate(rep.final, 0, ctx);
    if (!next) break;
    s = next;
    const before = s.meta.crowns;
    edictsBought = bot.buyEdicts(s, ctx) as EdictId[];
    rep.crownsSpent = before - s.meta.crowns;
  }
  return reports;
}

function runOne(s0: GameState, bot: Bot, run: number, opts: SimOptions, edictsBought: EdictId[]): RunReport {
  let s = s0;
  const ctx: EngineCtx = { fx: [] };
  const limit = opts.minutes * 60;
  const cpMin = new Set([...(opts.checkpointMinutes ?? []), ...Array.from({ length: Math.ceil(opts.minutes / 10) + 1 }, (_, i) => i * 10)]);
  const rep: RunReport = {
    run,
    bot: bot.kind,
    seconds: 0,
    zoneOpenAt: {},
    firstCapsuleAt: null,
    firstTrainAt: null,
    migrateReadyAt: null,
    eRun1MAt: null,
    expressStageAt: [],
    coronationAt: null,
    crownsGained: 0,
    crownsEverAfter: 0,
    edictsBought,
    checkpoints: [],
    maxStorageStall: 0,
    maxStorageStallAt: 0,
    maxGoalGap: 0,
    maxGoalGapAt: 0,
    maxHousingStall: 0,
    maxHousingStallAt: 0,
    housingStallByZone: {},
    maxHousingBlock: 0,
    maxHousingBlockAt: 0,
    housingBlockByZone: {},
    scouts: 0,
    minSteamEff: 1,
    expressKept: s.express.stage,
    nonFinite: [],
    buildingsSeen: [],
    upgradesSeen: [],
    buildingLevels: {},
    upgradesBought: 0,
    scenes: {},
    variants: {},
    cheeseCars: 0,
    medals: [],
    commissionsDone: 0,
    commissionLog: [],
    crownsSpent: 0,
    migrated: false,
    final: s,
  };
  const seenB = new Set<BuildingId>();
  const seenU = new Set<UpgradeId>();
  // per-second history for windowed rates
  const histEver: number[] = []; // market value of resEver
  const histCoins: number[] = [];
  const histTrain: number[] = []; // cumulative train value
  const histEvent: number[] = [];
  const histTrainCoins: number[] = [];
  let trainC = 0;
  let trainV = 0;
  let eventV = 0;
  let lastSec = -1;
  let housingStall = 0;
  let housingBlock = 0;
  const ticks = Math.round(limit / TICK);
  for (let i = 0; i < ticks; i++) {
    const dStep = step(s, TICK, { active: bot.isActive(s) }, ctx);
    bot.tick(s, ctx, dStep);
    for (const fx of ctx.fx) {
      if (fx.k === "sceneEnd") {
        rep.scenes[fx.id] = (rep.scenes[fx.id] ?? 0) + 1;
        const v = fx.haul ? resValue(fx.haul.gained) : 0;
        if (fx.id === "metro_train" || fx.id === "royal_express") {
          trainV += v;
          trainC += fx.haul?.gained.coins ?? 0;
        }
        eventV += v;
      } else if (fx.k === "sceneStart" && fx.id === "metro_train" && s.scene) {
        const v = s.scene.variant ?? "normal";
        rep.variants[v] = (rep.variants[v] ?? 0) + 1;
        if (s.scene.announce) rep.cheeseCars++;
      } else if (fx.k === "medal") rep.medals.push(fx.id);
      else if (fx.k === "commission") {
        if (fx.done) rep.commissionsDone++;
        rep.commissionLog.push(`${fmtMin(s.time)} ${fx.done ? "✓" : "→"} ${fx.id}`);
      }
      else if (fx.k === "drop" && fx.big) eventV += resValue({ [fx.res]: fx.amount });
      else if (fx.k === "scout") {
        rep.scouts++;
        bot.noteScout(s);
      } else if (fx.k === "zoneOpen") bot.noteScout(s); // a new zone is a new goal the moment it opens
    }
    ctx.fx.length = 0;
    if (dStep.steamNeed > 0 && s.steamEff < rep.minSteamEff) rep.minSteamEff = s.steamEff;

    const sec = Math.floor(s.time);
    if (sec === lastSec) continue;
    lastSec = sec;
    histEver.push(resValue(s.resEver));
    histCoins.push(s.resEver.coins);
    histTrain.push(trainV);
    histEvent.push(eventV);
    histTrainCoins.push(trainC);
    for (const z of ZONE_ORDER) if (s.zones[z] && rep.zoneOpenAt[z] === undefined) rep.zoneOpenAt[z] = s.zoneOpenedAt[z] ?? s.time;
    if (rep.firstCapsuleAt === null && s.flags.first_capsule) rep.firstCapsuleAt = s.time;
    if (rep.firstTrainAt === null && s.flags.first_train) rep.firstTrainAt = s.time;
    if (rep.migrateReadyAt === null && canMigrate(s)) rep.migrateReadyAt = s.time;
    if (rep.eRun1MAt === null && s.eRun >= 1e6) rep.eRun1MAt = s.time;
    while (rep.expressStageAt.length < s.express.stage) rep.expressStageAt.push(s.time);
    if (rep.coronationAt === null && s.coronatedThisRun) rep.coronationAt = s.time;
    // housing dead zone: the colony is full, but too small for the expedition on the map
    const exp = currentExpedition(s);
    const needRats = exp && !s.digging ? (ZONES[exp].expedition?.rats ?? 0) : 0;
    if (s.rats >= dStep.housing && dStep.housing < needRats) {
      housingStall++;
      if (exp && housingStall > (rep.housingStallByZone[exp] ?? 0)) rep.housingStallByZone[exp] = housingStall;
      if (housingStall > rep.maxHousingStall) {
        rep.maxHousingStall = housingStall;
        rep.maxHousingStallAt = s.time;
      }
      if (exp && priceNear(s, exp)) {
        housingBlock++;
        if (housingBlock > (rep.housingBlockByZone[exp] ?? 0)) rep.housingBlockByZone[exp] = housingBlock;
        if (housingBlock > rep.maxHousingBlock) {
          rep.maxHousingBlock = housingBlock;
          rep.maxHousingBlockAt = s.time;
        }
      } else housingBlock = 0;
    } else {
      housingStall = 0;
      housingBlock = 0;
    }
    if (sec % 10 === 0) {
      for (const id of BUILDING_IDS) if (buildingVisible(s, id)) seenB.add(id);
      for (const u of UPGRADE_IDS) if (upgradeVisible(s, u)) seenU.add(u);
      if (!rep.nonFinite.length) {
        const bad = nonFiniteFields(s);
        if (bad.length) rep.nonFinite = bad.map((b) => `${fmtMin(s.time)} ${b}`);
      }
    }
    if (sec % 60 === 0 && cpMin.has(sec / 60)) rep.checkpoints.push(checkpoint(s, run, histEver, histCoins, histTrain, histEvent, histTrainCoins));
    if (run === 1 && opts.offlineAtMinute !== undefined && sec === opts.offlineAtMinute * 60) rep.offlineCheck = offlineCheck(s);
    if (sec % 600 === 0) opts.onProgress?.(`${bot.kind} run ${run}: ${fmtMin(s.time)} rats ${s.rats} eRun ${s.eRun.toExponential(2)}`);

    if (s.coronatedThisRun && opts.stopAtCoronation) break;
    if (bot.shouldMigrate(s, run) && run < opts.runs) {
      rep.migrated = true;
      break;
    }
    const after = run < opts.runs ? 30 : (opts.postCoronationMinutes ?? 0.5) * 60;
    if (s.coronatedThisRun && run >= 2 && s.time - (rep.coronationAt ?? s.time) > after) {
      // after a later-run coronation the colony moves on (run 3 replays the express from the kept stages)
      if (run < opts.runs) rep.migrated = true;
      break;
    }
  }
  rep.seconds = s.time;
  rep.crownsGained = crownsForRun(s);
  rep.crownsEverAfter = s.meta.crownsEver + (rep.migrated ? rep.crownsGained : 0);
  rep.maxStorageStall = bot.stats.maxStorageStall;
  rep.maxStorageStallAt = bot.stats.maxStorageStallAt;
  rep.maxGoalGap = bot.stats.maxGoalGap;
  rep.maxGoalGapAt = bot.stats.maxGoalGapAt;
  rep.buildingsSeen = [...seenB];
  rep.upgradesSeen = [...seenU];
  for (const id of BUILDING_IDS) if (s.buildings[id] > 0) rep.buildingLevels[id] = s.buildings[id];
  rep.upgradesBought = Object.keys(s.upgrades).length;
  rep.final = s;
  s = rep.final;
  return rep;
}

/** The expedition's price is in the project or within 5 minutes of passive income (housing is then what blocks it). */
function priceNear(s: GameState, z: ZoneId): boolean {
  for (const [r, v] of entries(remaining(expeditionCost(s, z), s.projects[z] ?? {}))) {
    const lack = v - s.res[r];
    if (lack > 0 && lack > 300 * Math.max(0, s.ema[r])) return false;
  }
  return true;
}

function checkpoint(s: GameState, run: number, ever: number[], coins: number[], train: number[], event: number[], trainCoins: number[]): Checkpoint {
  const d = derive(s);
  const n = ever.length - 1;
  const back = (arr: number[], k: number) => arr[n] - arr[Math.max(0, n - k)];
  const span = (k: number) => Math.max(1, Math.min(k, n));
  const tot10 = back(ever, 600);
  return {
    run,
    minute: Math.round(s.time / 60),
    rats: s.rats,
    housing: d.housing,
    zones: ZONE_ORDER.filter((z) => s.zones[z]).length,
    crumbsPerSec: s.ema.crumbs,
    coinsPerSec: back(coins, 60) / span(60),
    coinsPassive: s.ema.coins,
    eRun: s.eRun,
    trainShare: tot10 > 0 ? back(train, 600) / tot10 : 0,
    trainCoinShare: back(coins, 600) > 0 ? back(trainCoins, 600) / back(coins, 600) : 0,
    eventShare: tot10 > 0 ? back(event, 600) / tot10 : 0,
    crowns: crownsForRun(s),
    expressStage: s.express.stage,
    suspicion: s.suspicion,
  };
}

/** 8 h offline on a snapshot: gains must stay within simulated × passive income × η (+ trains). */
export function offlineCheck(s: GameState, away = 8 * 3600): OfflineCheck {
  const c = structuredClone(s);
  c.scene = null;
  const d = derive(c);
  const incBefore = passiveIncome(c, d);
  const ctx: EngineCtx = { fx: [] };
  const before = { ...c.res };
  const rep = simulateOffline(c, away, ctx);
  const incAfter = passiveIncome(c, derive(c));
  let gained = 0;
  let bound = 0;
  for (const r of RES_IDS) {
    const g = c.res[r] - before[r];
    if (g > 0) gained += g * VALUE[r];
    const inc = Math.max(incBefore[r], incAfter[r]);
    bound += (inc * (rep?.simulated ?? 0) * (rep?.eta ?? 1) + (rep?.trainLoot[r] ?? 0)) * VALUE[r];
  }
  return { away, simulated: rep?.simulated ?? 0, eta: rep?.eta ?? 0, gainedValue: gained, boundValue: bound, ok: gained <= bound * 1.02 + 1 };
}

/** Gross passive production per second of the current job assignment (positive parts only, no temp buffs). */
export function passiveIncome(s: GameState, d: Derived): ResMap {
  const f = flows(s, d, s.jobs, s.rats);
  const out = zeroRes();
  for (const r of RES_IDS) out[r] = Math.max(0, f[r] + (r === "crumbs" ? 0.04 * s.rats : 0));
  return out;
}

export function fmtMin(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return "—";
  const m = Math.floor(sec / 60);
  const ss = Math.floor(sec % 60);
  return `${m}:${String(ss).padStart(2, "0")}`;
}

/* ================================================================ tuning overrides (dev) */

type Overrides = {
  buildings?: Record<string, { growth?: number; cost?: Amounts }>;
  zones?: Record<string, { cost?: Amounts; rats?: number; mapRevealRats?: number; housingBonus?: number }>;
  jobs?: Record<string, { produces?: Amounts; consumes?: Amounts; unlock?: Cond }>;
  upgrades?: Record<string, { cost?: Amounts }>;
  express?: Amounts;
  cars?: Record<string, { S?: number; items?: number }>;
};

/**
 * Patch the data tables in memory (for exploring balance variants in parallel without editing files).
 * Used by the dev scripts via the SIM_OVERRIDES env var (JSON). Never used by the game.
 */
export function applyOverrides(json: string | Overrides | undefined): void {
  if (!json) return;
  const o = typeof json === "string" ? (JSON.parse(json) as Overrides) : json;
  for (const [id, v] of Object.entries(o.buildings ?? {})) {
    const def = BUILDINGS[id as BuildingId];
    if (!def) throw new Error(`override: unknown building ${id}`);
    if (v.growth !== undefined) def.growth = v.growth;
    if (v.cost) def.cost = v.cost;
  }
  for (const [id, v] of Object.entries(o.zones ?? {})) {
    const def = ZONES[id as ZoneId];
    if (!def?.expedition) throw new Error(`override: unknown zone ${id}`);
    if (v.cost) def.expedition.cost = v.cost;
    if (v.rats !== undefined) def.expedition.rats = v.rats;
    if (v.mapRevealRats !== undefined) def.mapRevealRats = v.mapRevealRats;
    if (v.housingBonus !== undefined) def.housingBonus = v.housingBonus;
  }
  for (const [id, v] of Object.entries(o.jobs ?? {})) {
    const def = JOBS[id as JobId];
    if (!def) throw new Error(`override: unknown job ${id}`);
    if (v.produces) def.produces = v.produces;
    if (v.consumes) def.consumes = v.consumes;
    if (v.unlock) def.unlock = v.unlock;
  }
  if (o.express) Object.assign(EXPRESS_BASE, o.express);
  for (const [k, v] of Object.entries(o.cars ?? {})) Object.assign(TRAIN_CARS[k as keyof typeof TRAIN_CARS], v);
  for (const [id, v] of Object.entries(o.upgrades ?? {})) {
    const def = UPGRADES[id as UpgradeId];
    if (!def) throw new Error(`override: unknown upgrade ${id}`);
    if (v.cost) def.cost = v.cost;
  }
}

/** The data tables as they were before balance tuning (for `npm run sim -- --pre-tuning`, the "before" column). */
export const PRE_TUNING_OVERRIDES: Overrides = {
  buildings: {
    nest: { growth: 1.15, cost: { crumbs: 15 } },
    trash_chute: { growth: 1.15 },
    pantry: { growth: 1.25 },
    stash: { growth: 1.25 },
    pickpocket_school: { growth: 1.2 },
    sorting_den: { growth: 1.2 },
    drain_sieve: { growth: 1.17 },
    workshop: { growth: 1.22 },
    water_wheel: { growth: 1.3 },
    rat_rail: { growth: 1.35 },
    cheese_tap: { growth: 1.18 },
    nursery: { growth: 1.25, cost: { crumbs: 4000, cheese: 50 } },
    library: { growth: 1.25 },
    coal_chute: { growth: 1.2 },
    steam_press: { growth: 1.35 },
  },
  zones: {
    sewers: { cost: { crumbs: 1500, coins: 300, wire: 150 } },
    cellars: { cost: { coins: 5000, buttons: 1500, gears: 250 } },
    metro: { cost: { coins: 40000, gears: 2500, cheese: 1500, blueprints: 100 } },
    terminal: { cost: { coins: 8_000_000, brass: 4000, rails: 400, blueprints: 1500, trinkets: 5 }, rats: 350 },
  },
  jobs: {
    pickpocket: { produces: { coins: 0.08 } },
    scavenger: { unlock: { any: [{ resEver: "buttons", gte: 0.01 }, { resEver: "wire", gte: 0.01 }] } },
  },
  upgrades: {
    communal_nest: { cost: { crumbs: 300, buttons: 15 } },
    nimble_tails: { cost: { coins: 80 } },
    express_plan: { cost: { blueprints: 3000, trinkets: 30 } },
  },
  express: { trinkets: 10, blueprints: 50 },
  cars: { third: { S: 20 }, dining: { S: 20 }, mail: { S: 20 }, first: { S: 30 }, baggage: { S: 30 } },
};
