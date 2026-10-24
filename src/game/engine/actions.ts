import { BUILDINGS, MILESTONES, VISUAL_TIERS } from "../data/buildings";
import { JOBS, OPEN_JOBS } from "../data/jobs";
import { EDICTS, EXPRESS_STAGES } from "../data/meta";
import { RESOURCES } from "../data/resources";
import { FOREMAN_UPGRADES, RAT_MEMORY_UPGRADES, UPGRADES } from "../data/upgrades";
import { ZONES, ZONE_ORDER, districtName } from "../data/zones";
import {
  JOB_IDS,
  type AssignMode,
  type BuildingId,
  type BuyMode,
  type EdictId,
  type EngineCtx,
  type GameState,
  type JobId,
  type ResId,
  type UpgradeId,
  type ZoneId,
} from "../types";
import { check } from "./conditions";
import { award, gain, hasFreeSlot, jobUnlocked, news, normalizeJobs, spend, toast } from "./core";
import { eventValue, idleRats, type Derived } from "./derive";
import { onZoneOpen } from "./events";
import {
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
} from "./formulas";
import { rand } from "./rng";
import { newRun } from "./state";

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
  for (const m of MILESTONES) if (from < m && to >= m) ctx.fx.push({ k: "milestone", building: id, level: m });
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
        const keep = j === "forager" ? Math.ceil((0.04 * s.rats) / Math.max(0.0001, 0.3 * d.jobYield.forager)) : 0;
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

export function setFocus(s: GameState, job: JobId): void {
  if (jobUnlocked(s, job)) s.focus = job;
}

export function setAssignMode(s: GameState, mode: AssignMode): void {
  if (mode === "ratios" && !s.upgrades.rat_relay) return;
  if (mode === "smart" && !s.upgrades.tube_orders) return;
  s.assignMode = mode;
}

export function setRatios(s: GameState, ratios: Partial<GameState["ratios"]>): void {
  s.ratios = { ...s.ratios, ...ratios };
}

/**
 * "Умное распределение" (tube_orders): food positive, converter inputs covered,
 * the rest goes where the market value per worker is highest.
 */
export function smartAssign(s: GameState, d: Derived): void {
  const total = s.rats;
  const jobs = Object.fromEntries(JOB_IDS.map((j) => [j, 0])) as Record<JobId, number>;
  let left = total;
  const perWorker = (j: JobId, r: ResId) => (JOBS[j].produces[r] ?? 0) * d.jobSpeed[j] * d.jobYield[j];
  const passive = (r: ResId) => {
    let v = 0;
    for (const id of Object.keys(d.buildingOut) as BuildingId[]) v += d.buildingOut[id][r] ?? 0;
    return v;
  };
  // 1. food
  const foodNeed = 0.04 * total * 1.1 - passive("crumbs") * d.tierMult * d.global;
  const fper = perWorker("forager", "crumbs") * d.tierMult * d.global;
  const foragers = Math.max(0, Math.min(left, Math.ceil(foodNeed / Math.max(1e-6, fper))));
  jobs.forager = foragers;
  left -= foragers;
  // 2. limited producers without inputs
  for (const j of ["cheese_thief", "coal_miner", "appraiser"] as JobId[]) {
    if (!jobUnlocked(s, j)) continue;
    const n = Math.min(left, d.slots[j]);
    jobs[j] = n;
    left -= n;
  }
  // 3. converters, limited by input supply (supply from producers so far + buildings)
  const supply = (r: ResId) => {
    let v = passive(r);
    for (const j of JOB_IDS) if (Object.keys(JOBS[j].consumes).length === 0) v += jobs[j] * perWorker(j, r);
    for (const j of ["mechanic", "stoker", "smelter", "smith", "scholar"] as JobId[]) {
      v += jobs[j] * perWorker(j, r);
      v -= jobs[j] * (JOBS[j].consumes[r] ?? 0) * d.jobSpeed[j];
    }
    return v;
  };
  for (const j of ["stoker", "smelter", "smith", "mechanic", "scholar"] as JobId[]) {
    if (!jobUnlocked(s, j)) continue;
    while (left > 0 && jobs[j] < d.slots[j]) {
      let ok = true;
      for (const [r, v] of entries(JOBS[j].consumes)) {
        if (supply(r) < v * d.jobSpeed[j] - 1e-9 && s.res[r] < 50 * v) {
          ok = false;
          break;
        }
      }
      if (!ok) {
        // add a supporting scavenger for button/wire hungry converters
        const needsScrap = JOBS[j].consumes.wire || JOBS[j].consumes.buttons;
        if (needsScrap && jobUnlocked(s, "scavenger") && left > 1) {
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
  const open = (["pickpocket", "scavenger", "forager"] as JobId[]).filter((j) => jobUnlocked(s, j));
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
  if (isComplete(cost, prog) && s.rats >= (ZONES[zone].expedition?.rats ?? 0)) startDig(s, zone, ctx);
  return any;
}

function startDig(s: GameState, zone: ZoneId, ctx: EngineCtx): void {
  s.digging = { zone, until: s.time + 5 };
  ctx.fx.push({ k: "zoneDig", zone });
}

/** Called from the step when digging completes. */
export function openZone(s: GameState, zone: ZoneId, ctx: EngineCtx): void {
  s.zones[zone] = true;
  s.zoneOpenedAt[zone] = s.time;
  s.digging = null;
  ctx.fx.push({ k: "zoneOpen", zone });
  news(s, `zone_${zone}`, {}, ctx);
  const medal = ({ sewers: "sewers_open", cellars: "cellars_open", metro: "metro_open", terminal: "terminal_open" } as const)[zone as "sewers"];
  if (medal) award(s, medal, ctx);
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
      news(s, "express_stage", { stage: EXPRESS_STAGES[s.express.stage - 1] }, ctx);
      if (s.express.stage >= 10) coronation(s, ctx);
    } else {
      s.express.wagons++;
      toast(ctx, `Вагон экспресса №${s.express.wagons}: +10% ко всему`, "🚃", "gold");
    }
  }
  return any;
}

function coronation(s: GameState, ctx: EngineCtx): void {
  s.coronatedThisRun = true;
  s.flags.coronation = true;
  ctx.fx.push({ k: "coronation" });
  award(s, "coronation", ctx);
  news(s, "coronation", {}, ctx);
  // human clock before noon: 05:00 + time*5 s < 12:00 → time < 7h*3600/5
  if (s.time * 5 < 7 * 3600) award(s, "before_noon", ctx);
}

/**
 * Auto-contribute surplus. Capped resources give only what would overflow: once full, half a second of
 * gross production (plus any overload above the cap), so the store refills to the cap every second and
 * purchases that cost up to 100% of the cap stay affordable. Uncapped ones give half of the last second's gain.
 */
export function autoContribute(s: GameState, d: Derived, ctx: EngineCtx): void {
  const target = currentExpedition(s);
  const projects: ({ kind: "zone"; zone: ZoneId } | { kind: "express" })[] = [];
  if (target) projects.push({ kind: "zone", zone: target });
  if (s.upgrades.express_plan) projects.push({ kind: "express" });
  for (const p of projects) {
    const cost = p.kind === "zone" ? expeditionCost(s, p.zone) : expressCost(s);
    const prog = p.kind === "zone" ? (s.projects[p.zone] ??= {}) : s.express.progress;
    for (const [r, need] of entries(remaining(cost, prog))) {
      if (need <= 0) continue;
      const cap = d.caps[r];
      let surplus: number;
      if (Number.isFinite(cap)) surplus = s.res[r] >= 0.999 * cap ? Math.max(0, s.res[r] - Math.max(0.5 * cap, cap - 0.5 * Math.max(0, s.gross[r]))) : 0;
      else surplus = Math.max(0, Math.min(s.res[r], 0.5 * Math.max(0, s.rates[r])));
      const amt = Math.min(need, surplus);
      if (amt <= 0) continue;
      s.res[r] -= amt;
      prog[r] = (prog[r] ?? 0) + amt;
    }
    if (p.kind === "zone") {
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
        if (!buildingVisible(s, id)) continue;
        const def = BUILDINGS[id];
        if (def.maxLevel !== undefined && s.buildings[id] >= def.maxLevel) continue;
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

export function migrate(s: GameState, now: number, ctx: EngineCtx): GameState | null {
  if (!canMigrate(s)) return null;
  const gained = crownsForRun(s);
  const meta = structuredClone(s.meta);
  meta.crowns += gained;
  meta.crownsEver += gained;
  meta.migrations += 1;
  meta.district += 1;
  meta.lifetime.playSeconds = s.meta.lifetime.playSeconds;
  // remembered even without the edict: "Чертежи экспресса" bought on the migration screen keeps these stages
  meta.expressKept = Math.max(meta.expressKept, Math.min(10, s.express.stage));
  const next = newRun(meta, s.settings, (s.rng ^ 0x9e3779b9) >>> 0, now);
  award(next, "first_migration", ctx);
  news(next, "migration", { district: districtName(meta.district) }, ctx);
  ctx.fx.push({ k: "toast", text: `Великое Переселение! +${gained} 👑. Новый район: ${districtName(meta.district)}`, icon: "👑", tone: "gold" });
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
 * Edicts are bought on the migration screen right after the move (crowns arrive in migrate()),
 * so the run-start bonuses that newRun() grants must also apply to the current run at once.
 */
function applyRunStartEdict(s: GameState, id: EdictId, ctx: EngineCtx): void {
  if (id === "royal_litter") {
    if (s.rats < 10) {
      s.jobs.forager += 10 - s.rats;
      s.rats = 10;
    }
    s.buildings.nest = Math.max(s.buildings.nest, 5);
    s.flags.vagrants = true;
    if (s.res.crumbs < 50) {
      s.resEver.crumbs += 50 - s.res.crumbs;
      s.res.crumbs = 50;
    }
  } else if (id === "rat_memory") {
    for (const u of RAT_MEMORY_UPGRADES) s.upgrades[u] = true;
  } else if (id === "inherited_foreman") {
    for (const u of FOREMAN_UPGRADES) s.upgrades[u] = true;
  } else if (id === "old_tunnels" && !s.zones.sewers) {
    if (s.digging?.zone === "sewers") s.digging = null;
    openZone(s, "sewers", ctx);
    onZoneOpen(s, "sewers");
  } else if (id === "express_blueprints") {
    s.express.stage = Math.max(s.express.stage, Math.min(10, s.meta.expressKept));
  }
}

/* ================================================================ dev */

export function devGive(s: GameState, d: Derived, r: ResId, amt: number): void {
  gain(s, d, r, amt, true);
}

export { hasFreeSlot, OPEN_JOBS };
