import { BUILDINGS, MILESTONES, VISUAL_TIERS } from "../data/buildings";
import { JOBS, OPEN_JOBS } from "../data/jobs";
import { COMMISSIONS } from "../data/commissions";
import { EDICTS, EXPRESS_STAGES, SEALS, expressStageLine } from "../data/meta";
import { RESOURCES } from "../data/resources";
import { FOREMAN_UPGRADES, UPGRADES, ratMemoryUpgrades } from "../data/upgrades";
import { districtFree, districtInfo, districtInfoOf, districtOptions, legacyVisited, type DistrictId } from "../data/districts";
import { ZONES, ZONE_FROM, ZONE_ORDER } from "../data/zones";
import {
  JOB_IDS,
  RES_IDS,
  UPGRADE_IDS,
  ZONE_IDS,
  type Amounts,
  type AssignMode,
  type BuildingId,
  type BuyMode,
  type CommissionId,
  type EdictId,
  type EngineCtx,
  type GameState,
  type JobId,
  type RecordKey,
  type ResId,
  type ResMap,
  type SealId,
  type SteamPriority,
  type UpgradeId,
  type ZoneId,
} from "../types";
import { fmt } from "../../lib/format";
import { check } from "./conditions";
import { award, edictRank, gain, hasFreeSlot, jobUnlocked, news, normalizeJobs, spend, toast } from "./core";
import { converterPotential, derive, eventValue, idleRats, medalCount, type Derived } from "./derive";
import { onZoneOpen } from "./events";
import {
  atMaxLevel,
  buildingCost,
  buyCount,
  canAfford,
  canMigrate,
  crownsForRun,
  entries,
  expeditionCost,
  expressStageCost,
  isComplete,
  remaining,
  unitValue,
} from "./formulas";
import { coronationLine, expressLineSet, humanWeekday } from "./narrative";
import { commissionStat } from "./progress";
import { rand } from "./rng";
import { abandonCommission, commissionPossible, offerCommissions } from "./commissions";
import { KEPT_STAGES_MAX, applyRoyalLitter, newRun } from "./state";
import { potentialRate } from "./potential";
import { CLICK_BLUEPRINTS } from "./ranks";

/* ================================================================ click */

export interface ClickOpts {
  auto?: boolean;
  x?: number;
  y?: number;
}

/** One click on the sewer grate. Returns false when rate-limited. */
export function click(s: GameState, d: Derived, ctx: EngineCtx, opts: ClickOpts = {}): boolean {
  const auto = !!opts.auto;
  if (!auto) {
    const t = s.time;
    s.clickWindow = s.clickWindow.filter((x) => x > t - 1);
    if (s.clickWindow.length >= 15) return false;
    s.clickWindow.push(t);
    s.stats.clicks++;
    s.meta.lifetime.clicks++;
    if (s.upgrades.bustle && s.buffs.frenzyCooldownUntil <= t && s.buffs.frenzyUntil <= t) {
      s.bustle.value = Math.min(100, s.bustle.value + 3);
    }
    s.bustle.lastClickAt = t;
    if (s.stats.clicks === 1 || s.meta.lifetime.clicks >= 1) award(s, "first_crumb", ctx);
    if (s.meta.lifetime.clicks >= 1000) award(s, "click_1000", ctx);
  } else {
    s.stats.autoClicks++;
  }
  const power = auto ? d.autoclick.power : 1;
  const amount = (d.click + d.clickHuntPct * s.gross.crumbs) * power;
  const added = gain(s, d, "crumbs", amount, false, ctx);
  ctx.fx.push({ k: "click", amount: added > 0 ? added : amount, res: "crumbs", full: added <= 0, auto, x: opts.x, y: opts.y });
  // v3 (ENG-8) «Лапы предков» II/III: a click of the paw also brings 0.5% / 1% of the potential 📜/s (the late bottleneck)
  if (!auto) {
    const k = CLICK_BLUEPRINTS[Math.max(0, edictRank(s, "ancestral_paws") - 1)] ?? 0;
    if (k > 0) {
      const bp = k * potentialRate(s, d, "blueprints");
      if (bp > 0) gain(s, d, "blueprints", bp, true, ctx);
    }
  }

  // finds
  const drops: [ResId, number, number, boolean][] = [
    ["coins", 0.1, 0.2, s.resEver.crumbs >= 30],
    ["buttons", 0.06, 0.15, s.rats >= 6],
    ["wire", 0.06, 0.15, s.rats >= 6],
    ["cheese", 0.03, 0.1, !!s.zones.cellars],
    ["coal", 0.04, 0.1, !!s.zones.metro],
  ];
  for (const [r, p, k, ok] of drops) {
    if (!ok) continue;
    if (rand(s) < p * d.dropMult) {
      const amt = Math.max(1, k * d.click) * power;
      const got = gain(s, d, r, amt, false, ctx);
      ctx.fx.push({ k: "drop", res: r, amount: got > 0 ? got : amt, x: opts.x, y: opts.y });
      if (r === "coins" && !s.flags.first_coin) {
        s.flags.first_coin = true;
        news(s, "first_coin", {}, ctx);
      }
      if ((r === "buttons" || r === "wire") && !s.flags.first_button_or_wire) {
        s.flags.first_button_or_wire = true;
        news(s, "first_button", {}, ctx);
      }
    }
  }
  if (s.zones.terminal && rand(s) < 0.003 * d.dropMult) {
    gain(s, d, "trinkets", 1, true, ctx);
    ctx.fx.push({ k: "drop", res: "trinkets", amount: 1, big: true, x: opts.x, y: opts.y });
  }
  // lucky find: 60 s of income of a random revealed resource (ignores cap)
  if (rand(s) < 1 / 500) {
    const pool = (["crumbs", "coins", "buttons", "wire", "gears", "cheese", "coal", "brass"] as ResId[]).filter((r) => check(s, RESOURCES[r].reveal));
    const r = pool[Math.floor(rand(s) * pool.length)] ?? "crumbs";
    const amt = 60 * eventValue(s, d, r);
    gain(s, d, r, amt, true, ctx);
    ctx.fx.push({ k: "find", res: r, amount: amt });
  }
  return true;
}

/* ================================================================ buildings & upgrades */

export function buildingVisible(s: GameState, id: BuildingId): boolean {
  const def = BUILDINGS[id];
  return !!s.zones[def.zone] && (s.buildings[id] > 0 || check(s, def.unlock));
}

export function buyBuilding(s: GameState, d: Derived, id: BuildingId, mode: BuyMode, ctx: EngineCtx): number {
  if (!buildingVisible(s, id)) return 0;
  const k = buyCount(s, id, mode);
  if (k <= 0) return 0;
  const from = s.buildings[id];
  const cost = buildingCost(id, from, k);
  if (!canAfford(s, cost)) return 0;
  spend(s, cost);
  s.buildings[id] = from + k;
  const to = from + k;
  ctx.fx.push({ k: "buy", building: id, level: to });
  // milestones double only "produce" effects (derive.ts): no ×2 fanfare for nests, stores, boilers…
  if (BUILDINGS[id].effects.some((e) => e.t === "produce")) {
    for (const m of MILESTONES) if (from < m && to >= m) ctx.fx.push({ k: "milestone", building: id, level: m });
  }
  for (const v of VISUAL_TIERS) if (from < v && to >= v && v > 1) ctx.fx.push({ k: "tier", building: id, level: v });
  void d;
  return k;
}

export function upgradeVisible(s: GameState, id: UpgradeId): boolean {
  return !!s.upgrades[id] || check(s, UPGRADES[id].unlock);
}

export function buyUpgrade(s: GameState, id: UpgradeId, ctx: EngineCtx): boolean {
  if (s.upgrades[id] || !check(s, UPGRADES[id].unlock)) return false;
  const cost = UPGRADES[id].cost;
  if (!canAfford(s, cost)) return false;
  spend(s, cost);
  s.upgrades[id] = true;
  ctx.fx.push({ k: "upgrade", upgrade: id });
  if (id === "cheese_diet") s.satiety = true;
  if (id === "tube_orders") s.assignMode = "smart";
  else if (id === "rat_relay" && s.assignMode === "focus") s.assignMode = "focus";
  return true;
}

/* ================================================================ jobs */

/** Move rats into (delta > 0) or out of (delta < 0) a job. "max" fills, "zero" empties. */
export function assignJob(s: GameState, d: Derived, job: JobId, delta: number | "max" | "zero"): void {
  if (job === "idle" || !jobUnlocked(s, job)) return;
  if (delta === "zero") delta = -s.jobs[job];
  if (delta === "max") delta = Math.max(0, Math.min(d.slots[job], s.rats) - s.jobs[job]);
  if (delta > 0) {
    let want = Math.min(delta, d.slots[job] - s.jobs[job]);
    if (want <= 0) return;
    // take idle rats first, then from open jobs (largest first), never from the target job
    let free = idleRats(s);
    const takeIdle = Math.min(free, want);
    s.jobs[job] += takeIdle;
    want -= takeIdle;
    free -= takeIdle;
    if (want > 0) {
      const donors = (["forager", "scavenger", "pickpocket"] as JobId[]).filter((j) => j !== job).sort((a, b) => s.jobs[b] - s.jobs[a]);
      for (const j of donors) {
        if (want <= 0) break;
        const keep = foragerKeep(s, d, j);
        const take = Math.min(want, Math.max(0, s.jobs[j] - keep));
        s.jobs[j] -= take;
        s.jobs[job] += take;
        want -= take;
      }
    }
  } else if (delta < 0) {
    s.jobs[job] = Math.max(0, s.jobs[job] + delta);
  }
  normalizeJobs(s, d);
}

/** How many rats assignJob(job, +n) can really move now: room in the job, idle rats and the open jobs' rats above the forager reserve. */
export function assignable(s: GameState, d: Derived, job: JobId): number {
  if (job === "idle" || !jobUnlocked(s, job)) return 0;
  const room = Math.max(0, d.slots[job] - s.jobs[job]);
  let free = idleRats(s);
  for (const j of ["forager", "scavenger", "pickpocket"] as JobId[]) {
    if (j === job) continue;
    free += Math.max(0, s.jobs[j] - foragerKeep(s, d, j));
  }
  return Math.min(room, free);
}

/** Foragers assignJob never takes away (enough to feed the colony); 0 for other jobs. */
function foragerKeep(s: GameState, d: Derived, j: JobId): number {
  return j === "forager" ? Math.ceil((0.04 * s.rats) / Math.max(0.0001, 0.3 * d.jobYield.forager)) : 0;
}

export function setFocus(s: GameState, job: JobId): void {
  if (jobUnlocked(s, job)) s.focus = job;
}

/**
 * The elder's «Сделать» for an assign hint (v3 ENG-1 HintAction 'assign'): move up to n rats into `job` (slots
 * respected) from `donors` in their order — hints.applyHintAction passes potential.donorPool: the foragers above 1.3×
 * the upkeep, then the idle, then crews whose output only overflows a full store; without donors, the foragers above
 * assignJob's food reserve, then the idle. Into the foragers themselves (the hunger hint) it is assignJob: the idle,
 * then the scavengers and pickpockets. With setFocusToo the job also becomes the newborn focus WITHOUT
 * flags.focus_manual.
 */
export function applyAssignHint(s: GameState, d: Derived, job: JobId, n: number, setFocusToo = false, donors?: { job: JobId; n: number }[]): void {
  if (setFocusToo && jobUnlocked(s, job)) s.focus = job;
  let want = Math.floor(n);
  if (!(want > 0) || job === "idle" || !jobUnlocked(s, job)) return;
  if (job === "forager") {
    assignJob(s, d, job, want);
    return;
  }
  want = Math.min(want, d.slots[job] - s.jobs[job]);
  const list = donors ?? [
    { job: "forager" as JobId, n: Math.max(0, s.jobs.forager - foragerKeep(s, d, "forager")) },
    { job: "idle" as JobId, n: idleRats(s) },
  ];
  for (const x of list) {
    if (!(want > 0)) break;
    if (x.job === job) continue;
    const take = Math.min(want, x.n, x.job === "idle" ? idleRats(s) : s.jobs[x.job]);
    if (!(take > 0)) continue;
    if (x.job !== "idle") s.jobs[x.job] -= take;
    s.jobs[job] += take;
    want -= take;
  }
  normalizeJobs(s, d);
}

/** Steam priority valve (v3 ENG-4): "works" = smelters and smiths first (v2), "power" = presses and clocks first. */
export function setSteamPriority(s: GameState, p: SteamPriority): void {
  if (p === "works" || p === "power") s.steamPriority = p;
}

export function setAssignMode(s: GameState, mode: AssignMode): void {
  if (mode === "ratios" && !s.upgrades.rat_relay) return;
  if (mode === "smart" && !s.upgrades.tube_orders) return;
  s.assignMode = mode;
}

export function setRatios(s: GameState, ratios: Partial<GameState["ratios"]>): void {
  s.ratios = { ...s.ratios, ...ratios };
}

/* ---------------------------------------------------------------- smart assignment (v3 ENG-6) */

/** Limited producers without inputs, filled after the foragers (step 2). */
const SMART_LIMITED: JobId[] = ["cheese_thief", "coal_miner", "appraiser"];
/** Converters in the order smartAssign fills them (step 3). */
const SMART_FILL: JobId[] = ["stoker", "smelter", "smith", "mechanic", "scholar"];
/** The same converters in the order their terms enter an input's supply sum (the v2 order: keeps the sums bit-identical). */
const SMART_SUM: JobId[] = ["mechanic", "stoker", "smelter", "smith", "scholar"];
/** Open jobs that take the rest (step 4). */
const SMART_OPEN: JobId[] = ["pickpocket", "scavenger", "forager"];
// The job tables below are read from JOBS on every call, never snapshotted at import: the sim's SIM_OVERRIDES retune
// JOBS[id].consumes after this module loads (scripts/sim-core.ts applyOverrides), and a stale copy would fill
// converters against the old inputs while the supply sums read the new ones (perf-saves-5).

/**
 * The supply of one converter input as a sum over the jobs that touch it: `base` (buildings) + Σ jobs[add]·addPw
 * (producers without inputs) + Σ over converters (jobs·pw, then − jobs·use·speed). Jobs that neither make nor use
 * the resource add exactly 0 and are left out, so the sum is the v2 one, term for term (same order, same rounding).
 */
interface SupplyTerms {
  base: number;
  add: JobId[];
  addPw: number[];
  conv: JobId[];
  convPw: number[];
  convUse: number[];
  convSpeed: number[];
}

/**
 * "Умное распределение" (tube_orders): food positive, converter inputs covered,
 * the rest goes where the market value per worker is highest.
 *
 * v3 (ENG-6): same algorithm and result as v2, without its cost. v2 rebuilt every input's supply from all buildings
 * and jobs for each worker it added (≈ 3 ms per call at 667 rats, 2 s for an 8 h catch-up); the supply terms are now
 * built once per call and the fill loop only re-adds a handful of products. A running total (sup += delta) would be
 * cheaper still, but its rounding drifts from the v2 sums and could flip a borderline worker; this keeps them exact.
 */
export function smartAssign(s: GameState, d: Derived): void {
  const total = s.rats;
  const jobs = {} as Record<JobId, number>;
  for (const j of JOB_IDS) jobs[j] = 0;
  let left = total;
  const perWorker = (j: JobId, r: ResId) => (JOBS[j].produces[r] ?? 0) * d.jobSpeed[j] * d.jobYield[j];
  const buildings = Object.keys(d.buildingOut) as BuildingId[];
  const passive = (r: ResId) => {
    let v = 0;
    for (const id of buildings) v += d.buildingOut[id][r] ?? 0;
    return v;
  };
  // 1. food
  const foodNeed = 0.04 * total * 1.1 - passive("crumbs") * d.tierMult * d.global;
  const fper = perWorker("forager", "crumbs") * d.tierMult * d.global;
  const foragers = Math.max(0, Math.min(left, Math.ceil(foodNeed / Math.max(1e-6, fper))));
  jobs.forager = foragers;
  left -= foragers;
  // 2. limited producers without inputs
  for (const j of SMART_LIMITED) {
    if (!jobUnlocked(s, j)) continue;
    const n = Math.min(left, d.slots[j]);
    jobs[j] = n;
    left -= n;
  }
  // 3. converters, limited by input supply (supply from producers so far + buildings)
  // jobs without inputs (their output counts as supply as is), in JOB_IDS order
  const noInput = JOB_IDS.filter((j) => Object.keys(JOBS[j].consumes).length === 0);
  const terms: Partial<Record<ResId, SupplyTerms>> = {};
  const termsOf = (r: ResId): SupplyTerms => {
    const t: SupplyTerms = { base: passive(r), add: [], addPw: [], conv: [], convPw: [], convUse: [], convSpeed: [] };
    for (const j of noInput) {
      if (JOBS[j].produces[r] === undefined) continue;
      t.add.push(j);
      t.addPw.push(perWorker(j, r));
    }
    for (const j of SMART_SUM) {
      const use = JOBS[j].consumes[r];
      if (JOBS[j].produces[r] === undefined && use === undefined) continue;
      t.conv.push(j);
      t.convPw.push(perWorker(j, r));
      t.convUse.push(use ?? 0);
      t.convSpeed.push(d.jobSpeed[j]);
    }
    return (terms[r] = t);
  };
  const supply = (r: ResId) => {
    const t = terms[r] ?? termsOf(r);
    let v = t.base;
    for (let i = 0; i < t.add.length; i++) v += jobs[t.add[i]] * t.addPw[i];
    for (let i = 0; i < t.conv.length; i++) {
      const n = jobs[t.conv[i]];
      v += n * t.convPw[i];
      v -= n * t.convUse[i] * t.convSpeed[i];
    }
    return v;
  };
  const scavengerOpen = jobUnlocked(s, "scavenger");
  for (const j of SMART_FILL) {
    if (!jobUnlocked(s, j)) continue;
    // its inputs as [res, per worker] pairs (what entries(consumes) gives), hoisted out of the fill loop
    const inputs = (Object.entries(JOBS[j].consumes) as [ResId, number | undefined][]).filter((e): e is [ResId, number] => e[1] !== undefined);
    const speed = d.jobSpeed[j];
    while (left > 0 && jobs[j] < d.slots[j]) {
      let failed: ResId | null = null;
      for (const [r, v] of inputs) {
        if (s.res[r] < 50 * v && supply(r) < v * speed - 1e-9) {
          failed = r;
          break;
        }
      }
      if (failed) {
        // a supporting scavenger only helps when the missing input is scrap (not coins or steam: those
        // would flood the colony with scavengers whenever the coin or steam stock dips)
        if ((failed === "wire" || failed === "buttons") && scavengerOpen && left > 1) {
          jobs.scavenger++;
          left--;
          continue;
        }
        break;
      }
      jobs[j]++;
      left--;
    }
  }
  // 4. the rest: best market value per worker among open jobs (skip resources that are full)
  const open = SMART_OPEN.filter((j) => jobUnlocked(s, j));
  if (open.length && left > 0) {
    const value = (j: JobId) =>
      entries(JOBS[j].produces).reduce((a, [r, v]) => a + (s.res[r] >= d.caps[r] ? 0 : v * (RESOURCES[r].market ?? 1) * d.jobYield[j]), 0);
    const ranked = [...open].sort((a, b) => value(b) - value(a));
    // spread 60/30/10 across the ranked jobs to avoid all-in on one
    const shares = [0.6, 0.3, 0.1];
    let given = 0;
    ranked.forEach((j, i) => {
      const n = i === ranked.length - 1 ? left - given : Math.floor(left * shares[i]);
      jobs[j] += n;
      given += n;
    });
    left = 0;
  }
  for (const j of JOB_IDS) if (j !== "idle") s.jobs[j] = jobs[j];
  normalizeJobs(s, d);
}

/* ================================================================ toggles */

export function toggleSatiety(s: GameState): void {
  if (!s.upgrades.cheese_diet) return;
  s.satiety = !s.satiety;
}

/* ================================================================ projects */

/** The expedition currently offered on the map (next locked zone), if visible. */
export function currentExpedition(s: GameState): ZoneId | null {
  for (const z of ZONE_ORDER) {
    if (s.zones[z]) continue;
    const def = ZONES[z];
    if (s.rats >= def.mapRevealRats || s.revealed[`exp_${z}`]) return z;
    return null;
  }
  return null;
}

export function contributeExpedition(s: GameState, zone: ZoneId, res: ResId | null, ctx: EngineCtx, fraction = 1): boolean {
  if (s.zones[zone] || s.digging) return false;
  const cost = expeditionCost(s, zone);
  const prog = (s.projects[zone] ??= {});
  let any = false;
  for (const [r, need] of entries(remaining(cost, prog))) {
    if (res && r !== res) continue;
    const amt = Math.min(need, s.res[r] * fraction);
    if (amt <= 0) continue;
    s.res[r] -= amt;
    prog[r] = (prog[r] ?? 0) + amt;
    any = true;
  }
  if (any) checkScouting(s, zone, ctx);
  if (isComplete(cost, prog) && s.rats >= (ZONES[zone].expedition?.rats ?? 0)) startDig(s, zone, ctx);
  return any;
}

/**
 * «Внести», keeping `keep` in the stores (v3 ENG-1: the elder's contribute hint saves the price of the building that
 * starts a missing resource, e.g. the workshop's 150 🔘). Starts the dig when the expedition is complete.
 */
export function contributeExpeditionKeeping(s: GameState, zone: ZoneId, keep: Amounts, ctx: EngineCtx): boolean {
  if (s.zones[zone] || s.digging) return false;
  let any = false;
  for (const [r, need] of entries(remaining(expeditionCost(s, zone), s.projects[zone] ?? {}))) {
    const spare = s.res[r] - (keep[r] ?? 0);
    if (!(need > 0) || !(spare > 0)) continue;
    if (contributeExpedition(s, zone, r, ctx, Math.min(1, spare / s.res[r]))) any = true;
  }
  // a zero-fraction call only checks completion (the dig starts once the crew is there)
  contributeExpedition(s, zone, null, ctx, 0);
  return any;
}

/* ---------------------------------------------------------------- scouting payouts (EN-4) */

/**
 * Contributed shares of an expedition (expeditionFraction) that pay the scouts: steps 1–4. v3 (ENG-3, K5): a fourth
 * step at 90% gives the long last stretch of a coin-heavy expedition (the Terminal's 8M 🪙) a beat of its own.
 */
export const SCOUT_STEPS = [0.25, 0.5, 0.75, 0.9] as const;
/** The 90% step's toast (ENG-3); steps 1–3 read «Разведчики вернулись: …». */
export const SCOUT_NEAR_TEXT = "Разведчики: до цели рукой подать";
/** A payout is this many seconds of the resource's event value (steps 1–3). */
export const SCOUT_SECONDS = 60;
/**
 * Seconds of event value paid at each step (index = step − 1). v3 (ENG-13): the 90% step is the balance knob of the
 * plan — it sets how long the last stretch of a coin-heavy expedition is (the run-2 Terminal, the passive bot's wait).
 */
export const SCOUT_PAY_SEC: number[] = [SCOUT_SECONDS, SCOUT_SECONDS, SCOUT_SECONDS, SCOUT_SECONDS];

/**
 * Contributed share of an expedition, weighted by value (v3 ENG-3, K5): Σ min(1, paid/need)·need·unitValue(r) /
 * Σ need·unitValue(r). The map's % bar and the scout steps read it, so 8M 🪙 count for what they are worth: the four
 * cheap resources of the Terminal no longer make 80% on their own. (v2: the plain mean of the per-resource shares.)
 */
export function expeditionFraction(s: GameState, zone: ZoneId): number {
  const prog = s.projects[zone] ?? {};
  let paid = 0;
  let total = 0;
  for (const [r, need] of entries(expeditionCost(s, zone))) {
    if (!(need > 0)) continue;
    const w = need * Math.max(unitValue(r), 1e-6);
    total += w;
    paid += Math.min(1, (prog[r] ?? 0) / need) * w;
  }
  return total > 0 ? paid / total : 0;
}

/**
 * The scarcest expedition resource, which the scouts bring back: the lowest contributed fraction, ties broken by the
 * most seconds of event value still missing. Resources without an event value yet (💍 before the Terminal) are skipped.
 */
export function scoutResource(s: GameState, d: Derived, zone: ZoneId): ResId | null {
  const prog = s.projects[zone] ?? {};
  let best: ResId | null = null;
  let bestF = Infinity;
  let bestT = -Infinity;
  for (const [r, need] of entries(expeditionCost(s, zone))) {
    const v = eventValue(s, d, r);
    if (need <= 0 || !(v > 0)) continue;
    const have = prog[r] ?? 0;
    const f = Math.min(1, have / need);
    const t = Math.max(0, need - have) / v;
    if (f < bestF - 1e-12 || (Math.abs(f - bestF) <= 1e-12 && t > bestT)) {
      best = r;
      bestF = f;
      bestT = t;
    }
  }
  return best;
}

/**
 * Pay the scouts when an expedition's contributed share first crosses 25/50/75/90%: 60 s of event value of the scarcest
 * resource (over the cap), a news line and Fx scout. Each step pays once per run (s.scouted survives saves); the 90%
 * step (v3) pays like the others and has its own line («до цели рукой подать»).
 */
function checkScouting(s: GameState, zone: ZoneId, ctx: EngineCtx, d?: Derived): void {
  const done = Math.max(0, Math.floor(s.scouted[zone] ?? 0));
  if (done >= SCOUT_STEPS.length) return;
  const frac = expeditionFraction(s, zone);
  let reached = done;
  while (reached < SCOUT_STEPS.length && frac + 1e-9 >= SCOUT_STEPS[reached]) reached++;
  if (reached === done) return;
  const dd = d ?? derive(s);
  for (let k = done + 1; k <= reached; k++) {
    s.scouted[zone] = k;
    const r = scoutResource(s, dd, zone);
    if (!r) continue;
    const amount = gain(s, dd, r, (SCOUT_PAY_SEC[k - 1] ?? SCOUT_SECONDS) * eventValue(s, dd, r), true, ctx);
    ctx.fx.push({ k: "scout", zone, res: r, amount, step: k as 1 | 2 | 3 | 4 });
    news(s, k >= 4 ? "scout_near" : "scout", { from: ZONE_FROM[zone], amount: fmt(amount), icon: RESOURCES[r].icon }, ctx);
  }
}

function startDig(s: GameState, zone: ZoneId, ctx: EngineCtx): void {
  s.digging = { zone, until: s.time + 5 };
  ctx.fx.push({ k: "zoneDig", zone });
}

/** Called from the step when digging completes. `noRecord`: opened by an edict at the start of a run (no record). */
export function openZone(s: GameState, zone: ZoneId, ctx: EngineCtx, noRecord = false): void {
  s.zones[zone] = true;
  s.zoneOpenedAt[zone] = s.time;
  s.digging = null;
  ctx.fx.push({ k: "zoneOpen", zone });
  news(s, `zone_${zone}`, {}, ctx);
  const medal = ({ sewers: "sewers_open", cellars: "cellars_open", metro: "metro_open", terminal: "terminal_open" } as const)[zone as "sewers"];
  if (medal) award(s, medal, ctx);
  if (zone !== "burrow" && !noRecord) checkRecord(s, zone, ctx);
}

/** «Вокзал», «Коронация»: what a record is about, for the paper. */
export const RECORD_LABEL: Record<RecordKey, string> = {
  sewers: "Канализация",
  cellars: "Подвалы",
  metro: "Метро",
  terminal: "Вокзал",
  coronation: "Коронация",
};

/**
 * Colony records (EN-11): the first time is stored silently; a faster run later stores the new time, pushes Fx record
 * and the paper's «РЕКОРД КОЛОНИИ: Вокзал за 14:54 (было 48:31)».
 */
function checkRecord(s: GameState, what: RecordKey, ctx: EngineCtx): void {
  const prev = s.meta.records[what];
  const time = s.time;
  if (prev === undefined || !Number.isFinite(prev)) {
    s.meta.records[what] = time;
    return;
  }
  if (time >= prev) return;
  s.meta.records[what] = time;
  ctx.fx.push({ k: "record", what, time, prev });
  news(s, "record", { what: RECORD_LABEL[what], time: fmtRunTime(time), prev: fmtRunTime(prev) }, ctx);
}

/** m:ss (h:mm:ss past an hour) of run time. */
export function fmtRunTime(sec: number): string {
  const t = Math.max(0, Math.floor(sec));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const ss = String(t % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

export function expressCost(s: GameState): ReturnType<typeof expressStageCost> {
  return expressStageCost(s, s.express.stage + s.express.wagons + 1);
}

export function contributeExpress(s: GameState, res: ResId | null, ctx: EngineCtx, fraction = 1): boolean {
  if (!s.upgrades.express_plan) return false;
  const cost = expressCost(s);
  const prog = s.express.progress;
  let any = false;
  for (const [r, need] of entries(remaining(cost, prog))) {
    if (res && r !== res) continue;
    const amt = Math.min(need, s.res[r] * fraction);
    if (amt <= 0) continue;
    s.res[r] -= amt;
    prog[r] = (prog[r] ?? 0) + amt;
    any = true;
  }
  if (isComplete(cost, prog)) {
    s.express.progress = {};
    if (s.express.stage < 10) {
      s.express.stage++;
      ctx.fx.push({ k: "expressStage", stage: s.express.stage });
      // v3 (ENG-11): the second express and the later ones get their own lines (stages 6–10 replay every run)
      news(s, "express_stage", { stage: EXPRESS_STAGES[s.express.stage - 1], human: expressStageLine(s.express.stage, expressLineSet(s)).human }, ctx);
      if (s.express.stage >= 10) coronation(s, ctx);
    } else {
      s.express.wagons++;
      s.meta.lifetime.wagons++;
      toast(ctx, `Вагон экспресса №${s.express.wagons}: +10% ко всему`, "🚃", "gold");
    }
  }
  return any;
}

function coronation(s: GameState, ctx: EngineCtx): void {
  s.coronatedThisRun = true;
  s.coronatedAt = s.time;
  s.flags.coronation = true;
  s.meta.coronations++;
  ctx.fx.push({ k: "coronation" });
  award(s, "coronation", ctx);
  const line = coronationLine(s);
  news(s, "coronation", { human: line.human, rat: line.rat }, ctx);
  // v2 (EN-11): «Ещё до обеда» is a coronation before 10:00 of the human clock: 05:00 + time·5 s < 10:00
  if (s.time * 5 < 5 * 3600) award(s, "before_noon", ctx);
  if (s.hungry) award(s, "hungry_king", ctx);
  // v3 (ENG-3) «Короткая неделя»: the express plan needs a migration, so the second run is the earliest crown
  if (s.meta.migrations === 1) award(s, "forever_tuesday", ctx);
  checkRecord(s, "coronation", ctx);
  // EN-12: the King starts handing out commissions
  if (!s.commissions) offerCommissions(s);
}

type AutoProject = { kind: "zone"; zone: ZoneId } | { kind: "express" };

/** Projects that «Автовзнос» feeds: the expedition offered on the map, then the Rat Express. */
function autoProjects(s: GameState): AutoProject[] {
  const out: AutoProject[] = [];
  const target = currentExpedition(s);
  if (target) out.push({ kind: "zone", zone: target });
  if (s.upgrades.express_plan) out.push({ kind: "express" });
  return out;
}

function projectState(s: GameState, p: AutoProject): { cost: Amounts; prog: Amounts } {
  if (p.kind === "zone") return { cost: expeditionCost(s, p.zone), prog: (s.projects[p.zone] ??= {}) };
  return { cost: expressCost(s), prog: s.express.progress };
}

/**
 * Auto-contribute, per-tick part: uncapped resources (📜🪨🔔🛤️💍) never fill a store, so half of this tick's
 * passive gain goes to the project. Called by tickEconomy before it measures s.rates, so the HUD rate and every
 * ETA already show what is left after the contribution. `before` is the stock at the start of the tick.
 */
export function autoContributeUncapped(s: GameState, d: Derived, before: ResMap): void {
  if (!s.autoContribute) return;
  const avail: Amounts = {}; // one half of the gain in total, even if two projects want the same resource
  for (const p of autoProjects(s)) {
    const { cost, prog } = projectState(s, p);
    for (const [r, need] of entries(remaining(cost, prog))) {
      if (need <= 0 || Number.isFinite(d.caps[r])) continue;
      const left = (avail[r] ??= Math.max(0, 0.5 * (s.res[r] - before[r])));
      const amt = Math.min(need, left, s.res[r]);
      if (amt <= 0) continue;
      s.res[r] -= amt;
      prog[r] = (prog[r] ?? 0) + amt;
      avail[r] = left - amt;
    }
  }
}

/**
 * Auto-contribute, once a second. Capped resources give only what would overflow: once full, half a second of
 * gross production (plus any overload above the cap), so the store refills to the cap every second and
 * purchases that cost up to 100% of the cap stay affordable. Uncapped ones are fed every tick by
 * autoContributeUncapped; this pass also completes the project (starts the dig / the next express stage).
 * `span` = the seconds since the last pass (an offline step: 10–48 s), so a catch-up drains half of each step's
 * production like online play; `eta` = the offline efficiency.
 */
export function autoContribute(s: GameState, d: Derived, ctx: EngineCtx, span = 1, eta = 1): void {
  for (const p of autoProjects(s)) {
    const { cost, prog } = projectState(s, p);
    for (const [r, need] of entries(remaining(cost, prog))) {
      const cap = d.caps[r];
      if (need <= 0 || !Number.isFinite(cap) || s.res[r] < 0.999 * cap) continue;
      // a full store stops its converters (⚙️ mechanics), so their gross reads 0: measure what they could make
      const rate = Math.max(0, s.gross[r], converterPotential(s, d, r, eta));
      const surplus = Math.max(0, s.res[r] - Math.max(0.5 * cap, cap - 0.5 * span * rate));
      const amt = Math.min(need, surplus);
      if (amt <= 0) continue;
      s.res[r] -= amt;
      prog[r] = (prog[r] ?? 0) + amt;
    }
    if (p.kind === "zone") {
      // also catches what autoContributeUncapped fed in during the last second
      checkScouting(s, p.zone, ctx, d);
      if (isComplete(cost, prog) && s.rats >= (ZONES[p.zone].expedition?.rats ?? 0) && !s.digging) startDig(s, p.zone, ctx);
    } else if (isComplete(cost, prog)) contributeExpress(s, null, ctx, 0);
  }
}

/* ================================================================ foreman */

const STORAGE_FOR: Partial<Record<ResId, BuildingId[]>> = {
  crumbs: ["pantry", "sewer_warehouse", "cellar_vault"],
  coins: ["stash", "sewer_warehouse", "cellar_vault"],
  buttons: ["stash", "sewer_warehouse", "cellar_vault"],
  wire: ["stash", "sewer_warehouse", "cellar_vault"],
  gears: ["workshop", "cellar_vault"],
  cheese: ["cheese_tap", "cellar_vault"],
};

export function foremanTick(s: GameState, d: Derived, ctx: EngineCtx): void {
  if (!s.upgrades.foreman) return;
  if (s.foreman.nests && s.rats >= d.housing && buildingVisible(s, "nest")) {
    buyBuilding(s, d, "nest", 1, ctx);
  }
  if (s.foreman.storage) {
    for (const [r, list] of Object.entries(STORAGE_FOR) as [ResId, BuildingId[]][]) {
      if (s.res[r] < d.caps[r] * 0.999) continue;
      // cheapest affordable storage that does not need the full resource itself beyond stock
      let best: BuildingId | null = null;
      let bestV = Infinity;
      for (const id of list) {
        if (!buildingVisible(s, id) || atMaxLevel(s, id)) continue;
        const cost = buildingCost(id, s.buildings[id]);
        if (!canAfford(s, cost)) continue;
        const v = entries(cost).reduce((a, [rr, x]) => a + x * (RESOURCES[rr].market ?? 1), 0);
        if (v < bestV) {
          bestV = v;
          best = id;
        }
      }
      if (best) buyBuilding(s, d, best, 1, ctx);
    }
  }
}

export function setForeman(s: GameState, key: "nests" | "storage", on: boolean): void {
  s.foreman[key] = on;
}

/* ================================================================ prestige */

/**
 * The Great Migration: crowns, the chronicle, a fresh run. v3 (ENG-11): `to` picks the next district (the map offers
 * migrationPreview(s).options; any district not yet visited on this lap is accepted); without it, or for a visited /
 * unknown id, options[0] — the legacy sequence while it is free, so the sim and the default route walk London as v2 did.
 */
export function migrate(s: GameState, now: number, ctx: EngineCtx, to?: DistrictId): GameState | null {
  if (!canMigrate(s)) return null;
  const gained = crownsForRun(s);
  const meta = structuredClone(s.meta);
  meta.crowns += gained;
  meta.crownsEver += gained;
  meta.migrations += 1;
  const options = districtOptions(s.meta);
  const dest = to && districtFree(s.meta, to) ? districtInfoOf(to, options[0].lap) : options[0];
  const visited = s.meta.visited.length === s.meta.district + 1 ? [...s.meta.visited] : legacyVisited(s.meta.district);
  visited.push(dest.id);
  meta.visited = visited;
  meta.districtId = dest.id;
  meta.district = visited.length - 1;
  meta.lifetime.playSeconds = s.meta.lifetime.playSeconds;
  // remembered even without the edict: "Чертежи экспресса" bought on the migration screen keeps these stages;
  // at most KEPT_STAGES_MAX (5): stages 6–10 and the coronation (×1.25 crowns, before_noon) replay every run
  meta.expressKept = Math.min(KEPT_STAGES_MAX, Math.max(meta.expressKept, s.express.stage));
  const bestRating = s.runBestRating;
  // EN-11 chronicle: the finished run, newest last, at most 20
  meta.history.push({
    district: s.meta.district,
    districtId: districtInfo(s.meta).id,
    seconds: s.time,
    eRun: s.eRun,
    crowns: gained,
    zones: { ...s.zoneOpenedAt },
    ...(s.coronatedAt >= 0 ? { coronationAt: s.coronatedAt } : {}),
    bestRating,
  });
  if (meta.history.length > 20) meta.history.splice(0, meta.history.length - 20);
  const miser = s.meta.crowns >= 200;
  const next = newRun(meta, s.settings, (s.rng ^ 0x9e3779b9) >>> 0, now);
  ctx.fx.push({
    k: "migration",
    crowns: gained,
    district: meta.district,
    districtId: dest.id,
    weekday: humanWeekday(next),
    summary: { seconds: s.time, eRun: s.eRun, trains: s.stats.trains, bestRating, rats: s.rats },
  });
  // the migration screen is where edicts are bought: keep the tabs and the HUD up instead of a blank second
  applyReveals(next);
  award(next, "first_migration", ctx);
  if (miser) award(next, "miser", ctx);
  news(next, "migration", { district: dest.name }, ctx);
  ctx.fx.push({ k: "toast", text: `Великое Переселение! +${gained} 👑. Новый район: ${dest.name}`, icon: "👑", tone: "gold" });
  return next;
}

export function buyEdict(s: GameState, id: EdictId, ctx: EngineCtx): boolean {
  if (s.meta.edicts[id]) return false;
  const cost = EDICTS[id].cost;
  if (s.meta.crowns < cost) return false;
  s.meta.crowns -= cost;
  s.meta.edicts[id] = true;
  applyRunStartEdict(s, id, ctx);
  toast(ctx, `Указ «${EDICTS[id].name}» подписан`, "📜", "gold");
  return true;
}

/**
 * Rank II/III of an edict (EN-9): available after the first coronation ever, for EDICTS[id].ranks[rank-1].cost crowns.
 * v2: the rank effects themselves are applied by EN-9 (derive.ts, newRun, applyRunStartEdict).
 */
export function buyEdictRank(s: GameState, id: EdictId, ctx: EngineCtx): boolean {
  const ranks = EDICTS[id].ranks;
  const r = edictRank(s, id);
  if (!ranks || r < 1 || r > ranks.length || s.meta.achievements.coronation === undefined) return false;
  const cost = ranks[r - 1].cost;
  if (s.meta.crowns < cost) return false;
  s.meta.crowns -= cost;
  s.meta.edictRank[id] = r + 1;
  applyRunStartEdict(s, id, ctx);
  toast(ctx, `Указ «${EDICTS[id].name}» переподписан: ранг ${r + 1 === 2 ? "II" : "III"}`, "📜", "gold");
  return true;
}

/** Buy a Great Seal (120 👑) and make it the active one; an owned seal is just activated (setSeal rules apply). */
export function buySeal(s: GameState, id: SealId, ctx: EngineCtx): boolean {
  if (s.meta.sealsOwned.includes(id)) return setSeal(s, id, ctx);
  const cost = SEALS[id].cost;
  if (s.meta.crowns < cost) return false;
  s.meta.crowns -= cost;
  s.meta.sealsOwned.push(id);
  s.meta.seal = id;
  toast(ctx, `${SEALS[id].name} скреплена воском и хвостом`, SEALS[id].icon, "gold");
  afterSealChange(s, ctx);
  return true;
}

/** Swap the active seal for free, only in the first minute of a run (s.time < 60). */
export function setSeal(s: GameState, id: SealId, ctx: EngineCtx): boolean {
  if (!s.meta.sealsOwned.includes(id) || s.time >= 60 || s.meta.seal === id) return false;
  s.meta.seal = id;
  toast(ctx, `Действует ${SEALS[id].name.replace("Печать", "печать")}`, SEALS[id].icon, "info");
  afterSealChange(s, ctx);
  return true;
}

/** Печать Тишины keeps the Cat and the Ratcatcher away: a commission that needs them is handed back / not offered. */
function afterSealChange(s: GameState, ctx: EngineCtx): void {
  const c = s.commissions;
  if (!c) return;
  if (c.active) {
    if (!commissionPossible(s, c.active.id)) abandonCommission(s, ctx);
  } else if (c.offered.some((id) => !commissionPossible(s, id))) offerCommissions(s);
}

/** Accept one of the King's offered commissions (EN-12): progress is measured from the current stat value. */
export function acceptCommission(s: GameState, id: CommissionId, ctx: EngineCtx): boolean {
  const c = s.commissions;
  if (!c || c.active || !c.offered.includes(id) || !commissionPossible(s, id)) return false;
  c.active = { id, base: commissionStat(s, COMMISSIONS[id]) };
  // the King's errand starts the clock: its event is not left waiting for its usual long interval
  const soon = (k: "purse" | "downpour" | "royal_express", sec: number) => (s.timers[k] = Math.min(s.timers[k], s.time + sec));
  if (id === "purse_season") soon("purse", 60);
  else if (id === "dry_paws2" && s.zones.sewers) soon("downpour", 120);
  else if (id === "royal_mail" && Number.isFinite(s.timers.royal_express)) soon("royal_express", 120);
  else if (id === "whiskers_twice" && s.zones.cellars) s.timers.catForcedAt = Math.min(s.timers.catForcedAt, s.time + 90);
  ctx.fx.push({ k: "commission", id, done: false });
  toast(ctx, `Поручение принято: «${COMMISSIONS[id].name}»`, COMMISSIONS[id].icon, "gold");
  return true;
}

/**
 * Edicts are bought on the migration screen right after the move (crowns arrive in migrate()),
 * so the run-start bonuses that newRun() grants must also apply to the current run at once.
 */
function applyRunStartEdict(s: GameState, id: EdictId, ctx: EngineCtx): void {
  if (id === "royal_litter") {
    applyRoyalLitter(s);
  } else if (id === "rat_memory") {
    for (const u of ratMemoryUpgrades(edictRank(s, "rat_memory"))) s.upgrades[u] = true;
  } else if (id === "inherited_foreman") {
    for (const u of FOREMAN_UPGRADES) s.upgrades[u] = true;
  } else if (id === "old_tunnels") {
    // rank I opens the Sewers, rank II the Cellars too (bought on the migration screen: the run has just begun)
    const zones: ZoneId[] = edictRank(s, "old_tunnels") >= 2 ? ["sewers", "cellars"] : ["sewers"];
    for (const z of zones) {
      if (s.zones[z]) continue;
      if (s.digging?.zone === z) s.digging = null;
      openZone(s, z, ctx, true);
      onZoneOpen(s, z);
    }
  } else if (id === "express_blueprints") {
    s.express.stage = Math.max(s.express.stage, Math.min(KEPT_STAGES_MAX, s.meta.expressKept));
  }
}

/* ================================================================ UI reveals */

/** Sticky UI reveals (tabs, widgets, resource bar entries). Run by housekeeping every second and by migrate() at once. */
export function applyReveals(s: GameState): void {
  const R = s.revealed;
  const set = (k: string, cond: boolean) => {
    if (!R[k] && cond) R[k] = true;
  };
  for (const r of RES_IDS) set(`res_${r}`, check(s, RESOURCES[r].reveal) || s.res[r] > 0);
  set("tab_buildings", !!s.flags.vagrants || s.resEver.crumbs >= 10);
  set("tab_jobs", s.rats >= 2);
  set("tab_upgrades", UPGRADE_IDS.some((u) => upgradeVisible(s, u)));
  set("news", s.rats >= 5 || s.meta.migrations > 0);
  // v3 (ENG-1): the goal widget comes with the first visitors, not at 2:00
  set("goal", !!s.flags.vagrants || s.time >= 120 || s.meta.migrations > 0);
  set("tab_map", s.rats >= 12 || !!s.zones.sewers);
  set("tab_schedule", !!s.flags.first_capsule || !!s.zones.metro || !!s.zones.sewers);
  set("suspicion", !!s.zones.cellars);
  set("tab_migration", !!s.zones.metro || s.meta.migrations > 0);
  // not the first thing a newcomer sees: the medal cabinet waits for the buildings tab (or a second medal)
  set("tab_medals", medalCount(s) > 0 && (!!R.tab_buildings || medalCount(s) >= 2));
  set("steam", s.buildings.boiler > 0);
  set("bustle", !!s.upgrades.bustle);
  const exp = currentExpedition(s);
  if (exp) set(`exp_${exp}`, true);
  for (const z of ZONE_IDS) if (s.zones[z]) set(`zone_${z}`, true);
}

/* ================================================================ dev */

export function devGive(s: GameState, d: Derived, r: ResId, amt: number): void {
  gain(s, d, r, amt, true);
}

export { hasFreeSlot, OPEN_JOBS };
