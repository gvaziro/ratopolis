import { CONVERTERS, JOBS } from "../data/jobs";
import { RESOURCES } from "../data/resources";
import { ZONES, ZONE_ORDER } from "../data/zones";
import { BUILDING_IDS, JOB_IDS, RES_IDS, type Amounts, type BuildingId, type GameState, type JobId, type ResId, type ResMap, type ZoneId } from "../types";
import { currentExpedition, expressCost } from "./actions";
import { hasFreeSlot, jobUnlocked } from "./core";
import { idleRats, resMult, stunnedRats, type Derived } from "./derive";
import { entries, expeditionCost } from "./formulas";
import { zeroRes } from "./state";

/**
 * Potential production and the current project (v3 ENG-1), the part of the goal brain the economy tick needs too (the
 * auto newborn focus): kept out of goals.ts so that economy.ts → potential.ts stays free of import cycles. goals.ts
 * re-exports everything here; UIs import from goals.ts.
 */

/** Below this a rate counts as zero (the resource is not produced at all). */
const RATE_EPS = 1e-9;
/** Seconds of stock a converter may live on when its input is short: a big stock counts as a slow inflow (as the sim bot). */
export const STOCK_HORIZON = 600;
/** Food upkeep per rat and second (derive.food = 0.04 × rats; read live here: newborns change it within a tick). */
const UPKEEP_PER_RAT = 0.04;
/** Auto focus: newborns forage while the potential gross 🍞 stays below this × upkeep (the rebalance hint keeps it too). */
export const AUTO_FOOD_MARGIN = 1.3;

export type Project = { kind: "expedition"; zone: ZoneId } | { kind: "express"; stage: number };

export interface Bottleneck {
  res: ResId;
  /** Still to be produced: need − paid − stock (≥ 0). */
  remaining: number;
  /** remaining / potentialRate; Infinity when the resource is not produced; 0 when nothing remains. */
  etaSec: number;
  /** The store of `res` is (almost) full: s.res ≥ 99% of its cap. */
  full: boolean;
}

/* ================================================================ potential production */

/**
 * Per-second production of every resource IGNORING storage caps: plain producers (jobs without inputs, buildings) with
 * their multipliers, then the converters in the economy's order, each limited by what is left of its inputs per second
 * plus its stock spread over STOCK_HORIZON (3 mechanics on an empty 🔘 store do not count as full speed). Inputs are
 * net of what the converters burn; 🍞 is net of the food upkeep, 🧀 of the cheese diet.
 */
export function potentialRates(s: GameState, d: Derived): ResMap {
  const workforce = s.rats > 0 ? 1 - stunnedRats(s) / s.rats : 1;
  const base = zeroRes();
  for (const j of JOB_IDS) {
    const def = JOBS[j];
    const n = s.jobs[j];
    if (n <= 0 || Object.keys(def.consumes).length > 0) continue;
    const k = n * d.jobSpeed[j] * d.jobYield[j] * workforce;
    for (const [r, v] of entries(def.produces)) base[r] += v * k;
  }
  for (const id of BUILDING_IDS) {
    if (s.buildings[id] <= 0) continue;
    for (const [r, v] of entries(d.buildingOut[id])) base[r] += v;
  }
  const out = zeroRes();
  for (const r of RES_IDS) if (base[r] > 0) out[r] = base[r] * resMult(s, d, r, true);
  for (const j of CONVERTERS) {
    const n = s.jobs[j];
    if (n <= 0) continue;
    const rate = n * d.jobSpeed[j] * workforce;
    let e = 1;
    for (const [c, vc] of entries(JOBS[j].consumes)) {
      const need = rate * vc;
      if (need > 0) e = Math.min(e, (Math.max(0, out[c]) + Math.max(0, s.res[c]) / STOCK_HORIZON) / need);
    }
    e = Math.max(0, Math.min(1, e));
    for (const [c, vc] of entries(JOBS[j].consumes)) out[c] -= rate * vc * e;
    for (const [r, v] of entries(JOBS[j].produces)) out[r] += rate * v * d.jobYield[j] * resMult(s, d, r, true) * e;
  }
  out.crumbs -= UPKEEP_PER_RAT * s.rats;
  out.cheese -= d.cheeseFood;
  return out;
}

/**
 * Per-second production of r ignoring storage caps (buildings + jobs + converters at the inputs and steam there are);
 * for 🍞 the food upkeep is subtracted, so it can be negative. Never s.rates / s.gross (both ~0 at a full store).
 */
export function potentialRate(s: GameState, d: Derived, r: ResId): number {
  return potentialRates(s, d)[r];
}

/** Food upkeep per second of the colony as it is now (= derive.food, but live while newborns arrive). */
export function upkeep(s: GameState): number {
  return UPKEEP_PER_RAT * s.rats;
}

/** Potential gross 🍞 per second (production before the upkeep): what the auto focus and the rebalance hint compare. */
export function crumbGross(s: GameState, d: Derived, rates: ResMap = potentialRates(s, d)): number {
  return rates.crumbs + upkeep(s);
}

/** What one more forager adds to the gross 🍞 per second (multipliers and stunned rats included). */
export function foragerOutput(s: GameState, d: Derived): number {
  const workforce = s.rats > 0 ? 1 - stunnedRats(s) / s.rats : 1;
  return (JOBS.forager.produces.crumbs ?? 0) * d.jobSpeed.forager * d.jobYield.forager * resMult(s, d, "crumbs") * workforce;
}

/** Foragers needed so that the potential gross 🍞 is at least `margin` × upkeep (the rest of the 🍞 counts as it is). */
export function foragersNeeded(s: GameState, d: Derived, margin: number, rates: ResMap = potentialRates(s, d)): number {
  const per = foragerOutput(s, d);
  if (!(per > 0)) return s.jobs.forager;
  const other = crumbGross(s, d, rates) - s.jobs.forager * per;
  return Math.max(0, Math.ceil((margin * upkeep(s) - other) / per - 1e-9));
}

/* ================================================================ bottleneck */

/** The slowest of `need` at the given rates (projectBottleneck with rates computed once). */
export function bottleneckAt(s: GameState, d: Derived, rates: ResMap, need: Amounts, paid: Amounts | undefined): Bottleneck | null {
  let best: Bottleneck | null = null;
  for (const [r, v] of entries(need)) {
    const remaining = Math.max(0, v - (paid?.[r] ?? 0) - Math.max(0, s.res[r]));
    if (!(remaining > 0)) continue;
    const rate = rates[r];
    const etaSec = rate > RATE_EPS ? remaining / rate : Infinity;
    const cap = d.caps[r];
    const full = Number.isFinite(cap) && s.res[r] >= 0.99 * cap;
    if (!best || etaSec > best.etaSec || (etaSec === best.etaSec && remaining > best.remaining)) best = { res: r, remaining, etaSec, full };
  }
  return best;
}

/** Every resource the project still has to produce, slowest first (the same numbers as projectBottleneck). */
export function projectShortfall(s: GameState, d: Derived, need: Amounts, paid?: Amounts, rates: ResMap = potentialRates(s, d)): Bottleneck[] {
  const out: Bottleneck[] = [];
  for (const [r, v] of entries(need)) {
    const b = bottleneckAt(s, d, rates, { [r]: v }, paid);
    if (b) out.push(b);
  }
  return out.sort((a, b) => b.etaSec - a.etaSec || b.remaining - a.remaining);
}

/**
 * The slowest resource of a project: the largest remaining / potentialRate (rate ≈ 0 → etaSec Infinity, never NaN).
 * null when nothing remains to be produced. `paid` = what was already contributed (expedition / express progress).
 */
export function projectBottleneck(s: GameState, d: Derived, need: Amounts, paid?: Amounts): Bottleneck | null {
  return bottleneckAt(s, d, potentialRates(s, d), need, paid);
}

/** projectBottleneck of an expedition (its cost after edicts, minus the contributions). */
export function expeditionBottleneck(s: GameState, d: Derived, zone: ZoneId): Bottleneck | null {
  return projectBottleneck(s, d, expeditionCost(s, zone), s.projects[zone]);
}

/** projectBottleneck of the current Rat Express stage (or the next wagon after the coronation). */
export function expressBottleneck(s: GameState, d: Derived): Bottleneck | null {
  return projectBottleneck(s, d, expressCost(s), s.express.progress);
}

/* ================================================================ the project */

/** The colony's current goal, as GoalWidget shows it: the offered expedition, else the Rat Express, else null. */
export function currentProject(s: GameState): Project | null {
  if (!s.digging) {
    const zone = currentExpedition(s);
    if (zone) return { kind: "expedition", zone };
  }
  if (s.upgrades.express_plan) return { kind: "express", stage: s.express.stage + s.express.wagons + 1 };
  return null;
}

/** The project's price and what is already in it. */
export function projectNeed(s: GameState, p: Project): { need: Amounts; paid: Amounts | undefined } {
  return p.kind === "expedition" ? { need: expeditionCost(s, p.zone), paid: s.projects[p.zone] } : { need: expressCost(s), paid: s.express.progress };
}

/** The zones in the genitive, for «для «Канализации»». */
const ZONE_GEN: Record<ZoneId, string> = {
  burrow: "Норы у стока",
  sewers: "Канализации",
  cellars: "Подвалов",
  metro: "Станции подземки",
  terminal: "Большого вокзала",
};

/** «для «Канализации»», «для 3-го этапа экспресса», «для нового вагона экспресса»: the goal in the genitive. */
export function projectForText(p: Project): string {
  if (p.kind === "expedition") return `для «${ZONE_GEN[p.zone]}»`;
  return p.stage > 10 ? "для нового вагона экспресса" : `для ${p.stage}-го этапа экспресса`;
}

/** «экспедиция «Подвалы»», «экспресс, этап 3»: the goal as the subject of a sentence. */
export function projectName(p: Project): string {
  if (p.kind === "expedition") return `экспедиция «${ZONES[p.zone].name}»`;
  return p.stage > 10 ? "новый вагон экспресса" : `экспресс, этап ${p.stage}`;
}

/* ================================================================ who makes what */

/**
 * The job one more rat should take to raise r: its maker when that is an open job or has a free slot; for a converter
 * whose input runs short (its inflow plus the stock over STOCK_HORIZON below one worker's intake), the input's maker
 * instead. null when no maker can take a rat (slots full, building missing, maker locked).
 */
export function jobFor(s: GameState, d: Derived, r: ResId, rates: ResMap = potentialRates(s, d), depth = 0): JobId | null {
  const workforce = s.rats > 0 ? 1 - stunnedRats(s) / s.rats : 1;
  for (const j of JOB_IDS) {
    if (j === "idle" || !((JOBS[j].produces[r] ?? 0) > 0) || !jobUnlocked(s, j) || !hasFreeSlot(s, d, j)) continue;
    let short: ResId | null = null;
    for (const [c, vc] of entries(JOBS[j].consumes)) {
      if (Math.max(0, rates[c]) + Math.max(0, s.res[c]) / STOCK_HORIZON < vc * d.jobSpeed[j] * workforce) {
        short = c;
        break;
      }
    }
    if (!short) return j;
    const sup = depth < 2 ? jobFor(s, d, short, rates, depth + 1) : null;
    if (sup) return sup;
  }
  return null;
}

/** The slot job that makes r and the building its slots come from (the workshop for ⚙️, the library for 📜…). */
export function slotMakerOf(r: ResId): { job: JobId; building: BuildingId } | null {
  for (const j of JOB_IDS) {
    const slots = JOBS[j].slots;
    if (slots && (JOBS[j].produces[r] ?? 0) > 0) return { job: j, building: slots.building };
  }
  return null;
}

/**
 * Rats the colony needs before it can move on: the crew of the offered expedition, else the rats that reveal the next
 * one on the map; 0 when every zone is open.
 */
export function crewTarget(s: GameState): number {
  const z = ZONE_ORDER.find((x) => !s.zones[x]);
  if (!z) return 0;
  return currentExpedition(s) === z ? (ZONES[z].expedition?.rats ?? 0) : ZONES[z].mapRevealRats;
}

/** The resources the current project still has to produce (its shortfall), as a set. */
export function neededSet(s: GameState, d: Derived, rates: ResMap = potentialRates(s, d)): Set<ResId> {
  const p = currentProject(s);
  if (!p) return new Set();
  const { need, paid } = projectNeed(s, p);
  return new Set(projectShortfall(s, d, need, paid, rates).map((b) => b.res));
}

/** Where rats for a move may come from, and how many each job can spare. */
export interface Donor {
  job: JobId;
  n: number;
}

/**
 * Rats that can leave their job for `target` without hurting the colony (v3 ENG-1, the elder's «Сделать»), in the
 * order they are taken: the foragers above AUTO_FOOD_MARGIN × the upkeep, the idle, then open crews (scavengers,
 * pickpockets) whose every output overflows a full store the project does not need — as many as keep that output's
 * net rate (converters fed) at or above zero. Never the target itself.
 */
export function donorPool(s: GameState, d: Derived, target: JobId, rates: ResMap = potentialRates(s, d), needed: Set<ResId> = neededSet(s, d, rates)): Donor[] {
  const out: Donor[] = [];
  const workforce = s.rats > 0 ? 1 - stunnedRats(s) / s.rats : 1;
  if (target !== "forager") {
    const f = Math.max(0, s.jobs.forager - foragersNeeded(s, d, AUTO_FOOD_MARGIN, rates));
    if (f > 0) out.push({ job: "forager", n: f });
  }
  const idle = idleRats(s);
  if (idle > 0 && target !== "idle") out.push({ job: "idle", n: idle });
  for (const j of ["scavenger", "pickpocket"] as const) {
    if (j === target || s.jobs[j] <= 0) continue;
    let spare = s.jobs[j];
    for (const [r, v] of entries(JOBS[j].produces)) {
      const full = Number.isFinite(d.caps[r]) && s.res[r] >= 0.99 * d.caps[r];
      const per = v * d.jobSpeed[j] * d.jobYield[j] * resMult(s, d, r, true) * workforce;
      spare = !full || needed.has(r) || !(per > 0) ? 0 : Math.min(spare, Math.floor(Math.max(0, rates[r]) / per));
      if (spare <= 0) break;
    }
    if (spare > 0) out.push({ job: j, n: spare });
  }
  return out;
}

/** How many rats a move into `target` can take now: its room, at most the donor pool. */
export function movableTo(s: GameState, d: Derived, target: JobId, pool: Donor[]): number {
  const room = Math.max(0, d.slots[target] - s.jobs[target]);
  return Math.min(room, pool.reduce((a, x) => a + x.n, 0));
}

/* ================================================================ the auto newborn focus */

/**
 * The auto focus is on: the player never picked a focus (flags.focus_manual) and the newborns follow the star (focus
 * mode: always before «Цепочка передачи»; after it until the player picks ratios, and «Пневмоприказы» turn on the smart
 * assignment). v3 ENG-1 keeps it past «Цепочка передачи»: a player who never touched the star would otherwise send
 * every newborn after the last star a hint set, for the rest of the run.
 */
export function autoFocusOn(s: GameState): boolean {
  return !s.flags.focus_manual && s.assignMode === "focus";
}

/**
 * Where the colony sends a newborn by itself (ENG-1 auto focus, see autoFocusOn): the foragers while the potential
 * gross 🍞 is below AUTO_FOOD_MARGIN × upkeep; otherwise the job that helps the current project's slowest resource a
 * newborn can help with (jobFor); otherwise the foragers.
 */
export function autoFocus(s: GameState, d: Derived, rates: ResMap = potentialRates(s, d)): { job: JobId; reason: string | null } {
  const fallback: JobId = jobUnlocked(s, "forager") ? "forager" : "idle";
  if (crumbGross(s, d, rates) < AUTO_FOOD_MARGIN * upkeep(s)) return { job: fallback, reason: "крошек впритык: сперва прокормить колонию" };
  const p = currentProject(s);
  if (!p) return { job: fallback, reason: null };
  const { need, paid } = projectNeed(s, p);
  for (const b of projectShortfall(s, d, need, paid, rates)) {
    const job = jobFor(s, d, b.res, rates);
    if (job) return { job, reason: `${projectForText(p)} не хватает ${RESOURCES[b.res].icon}` };
  }
  return { job: fallback, reason: null };
}
