import { BUILDINGS, BUILDING_ORDER } from "../data/buildings";
import { CONVERTERS, JOBS } from "../data/jobs";
import { RESOURCES } from "../data/resources";
import { EVENT_SOURCES, JOB_FROM, JOB_PLURAL, JOB_TO } from "../data/sources";
import { UPGRADES, UPGRADE_ORDER } from "../data/upgrades";
import { ZONES } from "../data/zones";
import { JOB_IDS, RES_IDS, T1, type Amounts, type BuildingId, type EngineCtx, type GameState, type JobId, type ResId, type ResMap, type TabId, type UpgradeId, type ZoneId } from "../types";
import { fmt, fmtRate, fmtTime, plural } from "../../lib/format";
import {
  applyAssignHint,
  assignable,
  buildingVisible,
  buyBuilding,
  buyUpgrade,
  contributeExpedition,
  contributeExpeditionKeeping,
  currentExpedition,
  upgradeVisible,
} from "./actions";
import { check, describeCond } from "./conditions";
import { jobUnlocked } from "./core";
import { derive, resMult, stunnedRats, type Derived } from "./derive";
import { crumbBalance, steamBudget, unitValue } from "./economy";
import { vigilance } from "./events";
import { atMaxLevel, buildingCost, buildingMaxLevel, canAfford, entries, expeditionCost, isComplete, lockedByCap, marketValue, remaining } from "./formulas";
import {
  autoFocusOn,
  crewTarget,
  crumbGross,
  currentProject,
  donorPool,
  jobFor,
  movableTo,
  potentialRates,
  projectForText,
  projectName,
  projectNeed,
  projectShortfall,
  shortfallAfterMove,
  slotMakerOf,
  STOCK_HORIZON,
  upkeep,
  type Bottleneck,
  type Donor,
  type Project,
} from "./potential";
import { sealOn } from "./ranks";

/**
 * Onboarding brains (EN-7, Elder 2.0 in v3 ENG-1): the elder's next hint (steering the rats to the current goal), its
 * hysteresis and «Сделать», «Где взять», storage locks, the steam gauge breakdown, suspicion maths and per-job numbers
 * for the Jobs tab. Pure functions of (state, derived), except trackHint / applyHintAction, which write s.
 */

/* ================================================================ types */

export type HintAction =
  /**
   * Move up to n rats into job (slots respected); v3 (ENG-1) setFocus: also make it the newborn focus (not «manual»);
   * from: only these donor jobs (potential.donorPool order), e.g. the rebalance hint's surplus crews.
   */
  | { kind: "assign"; job: JobId; n: number; setFocus?: boolean; from?: JobId[] }
  /** Contribute to the expedition; v3 (ENG-1) `keep`: leave this much in the stores (the next enabling building's price). */
  | { kind: "contribute"; zone: ZoneId; keep?: Amounts }
  | { kind: "buyBuilding"; id: BuildingId }
  | { kind: "buyUpgrade"; id: UpgradeId }
  | { kind: "focus" };

export interface Hint {
  /** Stable per situation (e.g. "idle_job:pickpocket"): UIs may key animations on it. */
  id: string;
  icon: string;
  text: string;
  /** Why it matters, one short line. */
  why: string;
  tab: TabId;
  /** data-target to scroll to and glow (b_/j_/u_/e_/z_ ids, x_express). */
  target?: string;
  /** What «Сделать» does (store.applyHint); absent = the button only focuses tab/target. */
  action?: HintAction;
}

export interface ConverterBottleneck {
  job: JobId;
  /** Converter efficiency EMA (0..1). */
  eff: number;
  /** "full": an output store is full; "input": an input runs short. */
  kind: "full" | "input";
  res: ResId;
  /** Ready-made Jobs-tab line, e.g. «Не хватает 🔘. Нужно ещё ~2 барахольщика.» */
  text: string;
  /** Who makes the missing input, and how many more are needed. */
  supplier?: JobId;
  need?: number;
  supplierLocked?: boolean;
  /** Build this for more supplier slots (or a bigger store when kind = "full"). */
  building?: BuildingId;
}

/* ================================================================ wording */

/** «отправьте 1 крысу / 3 крыс / 5 крыс / 22 крысы» (animate accusative after a numeral). */
export function ratsAcc(n: number): string {
  const a = Math.abs(Math.floor(n));
  if (a % 10 === 1 && a % 100 !== 11) return "крысу";
  if (a >= 2 && a <= 4) return "крыс";
  return plural(a, "крысу", "крысы", "крыс");
}

/** Accusative of a crew after a numeral, the ratsAcc pattern: [1, 2–4, 22–24…, many]. */
const CREW_ACC: Partial<Record<JobId, [string, string, string, string]>> = {
  forager: ["собирателя", "собирателей", "собирателя", "собирателей"],
  pickpocket: ["карманника", "карманников", "карманника", "карманников"],
  scavenger: ["барахольщика", "барахольщиков", "барахольщика", "барахольщиков"],
  idle: ["бездельника", "бездельников", "бездельника", "бездельников"],
};

/** «переведите 1 собирателя / 3 собирателей / 22 собирателя / 25 собирателей» (other crews: ratsAcc). */
export function crewAcc(job: JobId, n: number): string {
  const f = CREW_ACC[job];
  if (!f) return ratsAcc(n);
  const a = Math.abs(Math.floor(n));
  if (a % 10 === 1 && a % 100 !== 11) return f[0];
  if (a >= 2 && a <= 4) return f[1];
  return plural(a, f[0], f[2], f[3]);
}

/** Why a crew can be spared (the rebalance hint), when it is not the foragers. */
const SURPLUS_WHY: Partial<Record<JobId, string>> = {
  scavenger: "Пуговицы и проволока уже не лезут в склад",
  pickpocket: "Монетки уже не лезут в склад",
  idle: "Бездельники ждут дела",
};

/** Who produces each converter input, with Russian plural forms for the hint. */
const SUPPLIER: Partial<Record<ResId, { job: JobId; forms: [string, string, string] }>> = {
  buttons: { job: "scavenger", forms: ["барахольщик", "барахольщика", "барахольщиков"] },
  wire: { job: "scavenger", forms: ["барахольщик", "барахольщика", "барахольщиков"] },
  cheese: { job: "cheese_thief", forms: ["сырный воришка", "сырных воришки", "сырных воришек"] },
  coal: { job: "coal_miner", forms: ["угольщик", "угольщика", "угольщиков"] },
  steam: { job: "stoker", forms: ["кочегар", "кочегара", "кочегаров"] },
  coins: { job: "pickpocket", forms: ["карманник", "карманника", "карманников"] },
  brass: { job: "smelter", forms: ["плавильщик", "плавильщика", "плавильщиков"] },
};

const SELF_STARTING: Partial<Record<ResId, string>> = {
  coins: "Монетки сами не копятся",
  buttons: "Пуговицы сами не копятся",
  wire: "Проволока сама не копится",
};

/** «копить ≈ 31м 10с» / «копить ≈ 2 ч» / «копить больше суток» / «никто не добывает». */
function etaWords(sec: number): string {
  if (!Number.isFinite(sec)) return "никто не добывает";
  if (sec >= 86400) return "копить больше суток";
  if (sec >= 3600) return `копить ≈ ${Math.round(sec / 3600)} ч`;
  return `копить ≈ ${fmtTime(sec)}`;
}

/* ================================================================ converters */

/** GDD 4.4 bottleneck of a converter job (moved here from JobsTab): null when it runs at ≥ 95% or has no workers. */
export function converterBottleneck(s: GameState, d: Derived, job: JobId): ConverterBottleneck | null {
  const def = JOBS[job];
  const n = s.jobs[job];
  if (n <= 0 || Object.keys(def.consumes).length === 0) return null;
  const eff = s.convEff[job] ?? 1;
  if (eff >= 0.95) return null;
  for (const [r] of entries(def.produces)) {
    if (Number.isFinite(d.caps[r]) && s.res[r] >= d.caps[r] * 0.995) {
      const store = storageHintFor(s, d, r).buildingId;
      return { job, eff, kind: "full", res: r, text: `Склад ${RESOURCES[r].icon} полон — бригада ждёт места. Нужен склад побольше.`, building: store };
    }
  }
  let worst: ResId | null = null;
  let worstRatio = Infinity;
  for (const [r, v] of entries(def.consumes)) {
    const ratio = s.res[r] / Math.max(1e-9, n * v * d.jobSpeed[job]);
    if (ratio < worstRatio) {
      worstRatio = ratio;
      worst = r;
    }
  }
  if (!worst) return null;
  const icon = RESOURCES[worst].icon;
  const missing = n * (def.consumes[worst] ?? 0) * d.jobSpeed[job] * (1 - eff);
  const sup = SUPPLIER[worst];
  if (!sup) return { job, eff, kind: "input", res: worst, text: `Не хватает ${icon}.` };
  if (!jobUnlocked(s, sup.job)) {
    return { job, eff, kind: "input", res: worst, text: `Не хватает ${icon}: поставщики ещё не открыты.`, supplier: sup.job, supplierLocked: true };
  }
  const per = (JOBS[sup.job].produces[worst] ?? 0) * d.jobSpeed[sup.job] * d.jobYield[sup.job] * resMult(s, d, worst, false);
  const need = Math.max(1, Math.ceil(missing / Math.max(1e-9, per)));
  let tail = `Нужно ещё ~${need} ${plural(need, ...sup.forms)}`;
  const slots = JOBS[sup.job].slots;
  let building: BuildingId | undefined;
  if (slots && s.jobs[sup.job] + need > d.slots[sup.job]) {
    const max = buildingMaxLevel(s, slots.building);
    if (!atMaxLevel(s, slots.building)) {
      building = slots.building;
      tail += ` — но мест нет: стройте «${BUILDINGS[slots.building].name}»`;
    } else if (sup.job !== "stoker") tail += ` — но мест нет, а «${BUILDINGS[slots.building].name}» уже на пределе (${max} ур.)`;
    // v3 (ENG-4): past the boiler cap steam is a fixed budget — the valve or a smaller crew, never another boiler
    else if (s.steamPriority === "power") tail += ` — но котёл на пределе (${max} ур.), а клапан отдаёт пар прессам: поверните его «заводу» или снимите часть бригады`;
    else tail += ` — но котёл на пределе (${max} ур.): пар — это бюджет, снимите часть бригады`;
  }
  return { job, eff, kind: "input", res: worst, text: `Не хватает ${icon}. ${tail}.`, supplier: sup.job, need, building };
}

/* ================================================================ goals that need a resource */

/** Names of visible goals whose price in r is above the stock: the current expedition, buildings, upgrades. */
function goalsNeeding(s: GameState, r: ResId): string[] {
  const out: string[] = [];
  const z = currentExpedition(s);
  if (z && !s.digging) {
    const left = remaining(expeditionCost(s, z), s.projects[z] ?? {})[r] ?? 0;
    if (left > s.res[r] + 1e-9) out.push(`экспедиция «${ZONES[z].name}»`);
  }
  for (const id of BUILDING_ORDER) {
    if (!buildingVisible(s, id)) continue;
    if (atMaxLevel(s, id)) continue;
    if ((buildingCost(id, s.buildings[id])[r] ?? 0) > s.res[r] + 1e-9) out.push(BUILDINGS[id].name);
  }
  for (const id of UPGRADE_ORDER) {
    if (s.upgrades[id] || !upgradeVisible(s, id)) continue;
    if ((UPGRADES[id].cost[r] ?? 0) > s.res[r] + 1e-9) out.push(UPGRADES[id].name);
  }
  return out;
}

/* ================================================================ the elder's hint */

/** A hint shown this long (s) without its action being taken is muted (ENG-1 hysteresis, trackHint)… */
export const HINT_STALE_SEC = 180;
/** …for this long (s): nextHint falls through to the next rule meanwhile. */
export const HINT_MUTE_SEC = 60;
/** A project resource slower than this (s) is worth moving rats or building slots for (rebalance, more slots). */
const SLOW_SEC = 240;
/** Once the colony has its crew, the housing hint gives way to a nest dearer than this many seconds of potential 🍞. */
const NEST_SEC = 120;
/** The rebalance hint fires above this × the upkeep of potential gross 🍞 (and leaves AUTO_FOOD_MARGIN×). */
const SURPLUS_MARGIN = 1.5;
/** …and only when its move brings the goal's ETA below this share of what it is now (a 5% gain at least). */
const REBALANCE_GAIN = 0.95;
/** A converter crew starved below this share of its intake is not worth staffing yet (its inputs come first). */
const MIN_CREW_EFF = 0.2;

/** What the rules share: the project, its shortfall at potential rates (slowest first), the donor pools. Lazy. */
class HintCtx {
  private _rates: ResMap | null = null;
  private _short: Bottleneck[] | null = null;
  private _pools = new Map<JobId, Donor[]>();
  readonly project: Project | null;
  constructor(
    readonly s: GameState,
    readonly d: Derived,
  ) {
    this.project = currentProject(s);
  }
  get rates(): ResMap {
    return (this._rates ??= potentialRates(this.s, this.d));
  }
  /** What the project still has to produce, slowest first ([] without a project). */
  get short(): Bottleneck[] {
    if (!this._short) {
      const p = this.project;
      if (!p) this._short = [];
      else {
        const { need, paid } = projectNeed(this.s, p);
        this._short = projectShortfall(this.s, this.d, need, paid, this.rates);
      }
    }
    return this._short;
  }
  get bottleneck(): Bottleneck | null {
    return this.short[0] ?? null;
  }
  /** Who can move into `target` (potential.donorPool: the idle, crews whose output overflows, surplus foragers). */
  pool(target: JobId): Donor[] {
    let p = this._pools.get(target);
    if (!p) {
      p = donorPool(this.s, this.d, target, this.rates, new Set(this.short.map((x) => x.res)));
      this._pools.set(target, p);
    }
    return p;
  }
  /** How many rats «Сделать» can move into `target` now. */
  movable(target: JobId): number {
    return movableTo(this.s, this.d, target, this.pool(target));
  }
}

/**
 * The single most useful next step for a newcomer (CO-3's 💡 row), first matching rule wins (v3 ENG-1 order):
 * 1 food in deficit · 1b a paid expedition with its crew: dig · 2a an empty crew the goal needs, or slots for it ·
 * 3 a free resource nobody gathers · 3b foragers in surplus while an open job's resource holds the goal up ·
 * 2 housing full (demoted: skipped once the crew is there and the nest is dear) · 4 a starved converter ·
 * 5 an expedition that can take a real contribution (keeping the price of the building that starts a missing resource) ·
 * 6 an affordable upgrade that does not only fill a full, surplus store · 7 a full store with an affordable store.
 * A hint muted by trackHint's hysteresis (s.hintMemo) is skipped for the next one. null when settings.hints is off or
 * nothing applies.
 */
export function nextHint(s: GameState, d: Derived): Hint | null {
  if (!s.settings.hints || s.rats <= 0) return null;
  const memo = s.hintMemo;
  const muted = memo && s.time < memo.mutedUntil ? memo.muted : "";
  for (const h of hintCandidates(s, d)) if (h.id !== muted) return h;
  return null;
}

function* hintCandidates(s: GameState, d: Derived): Generator<Hint> {
  const g = new HintCtx(s, d);
  const workforce = s.rats > 0 ? 1 - stunnedRats(s) / s.rats : 1;
  const p = g.project;
  // «Пневмоприказы»: the smart assignment re-deals every rat each 5 s, so the job hints (1, 2a, 3, 3b) say nothing
  const byHand = !(s.assignMode === "smart" && s.upgrades.tube_orders);

  // 1. food: assignJob moves only idle rats, scavengers and pickpockets; rats in slot jobs (mechanics, cheese
  // thieves…) the player takes off by hand, so then the hint names the biggest such crew and only focuses it
  const deficit = d.food - s.gross.crumbs;
  if (byHand && (s.hungry || deficit > 1e-9) && jobUnlocked(s, "forager")) {
    const per = (JOBS.forager.produces.crumbs ?? 0) * d.jobSpeed.forager * d.jobYield.forager * resMult(s, d, "crumbs", false) * workforce;
    const needed = Math.max(1, Math.ceil(Math.max(0, deficit) / Math.max(1e-9, per)));
    const why = `Крошки ${fmtRate(s.gross.crumbs - d.food)}. Голодная колония работает вполсилы и не растёт`;
    const movable = assignable(s, d, "forager");
    if (movable > 0) {
      const n = Math.min(movable, needed);
      yield { id: "hungry", icon: "🍞", text: `Еда в минусе: верните ${n} ${ratsAcc(n)} в собиратели`, why, tab: "jobs", target: "j_forager", action: { kind: "assign", job: "forager", n } };
    } else {
      let crew: JobId | null = null;
      for (const j of JOB_IDS) {
        if (j === "idle" || j === "forager" || j === "scavenger" || j === "pickpocket" || s.jobs[j] <= 0) continue;
        if (!crew || s.jobs[j] > s.jobs[crew]) crew = j;
      }
      if (crew) {
        const n = Math.min(s.jobs[crew], needed);
        yield { id: `hungry:${crew}`, icon: "🍞", text: `Еда в минусе: верните ${n} ${ratsAcc(n)} ${JOB_FROM[crew]} в собиратели`, why, tab: "jobs", target: `j_${crew}` };
      }
    }
  }

  // 1b. the expedition is paid and its crew is there: the dig is one press away
  const z = currentExpedition(s);
  if (z && !s.digging) {
    const crew = ZONES[z].expedition?.rats ?? 0;
    if (isComplete(expeditionCost(s, z), s.projects[z] ?? {}) && s.rats >= crew) {
      yield {
        id: `dig:${z}`,
        icon: "⛏️",
        text: `Экспедиция «${ZONES[z].name}» собрана, землекопов хватает — начинайте раскопки!`,
        why: "Пять секунд копки — и новая зона ваша",
        tab: "map",
        target: `z_${z}`,
        action: { kind: "contribute", zone: z },
      };
    }
  }

  // 2a. an empty crew whose output the goal needs (directly or through a converter); its slots, when they are full
  if (p && g.short.length) {
    yield* crewHints(g, workforce, byHand);
  }

  // 3. a resource nobody gathers (no passive production at all) while a visible price wants it
  for (const job of ["pickpocket", "scavenger"] as const) {
    if (!byHand || !jobUnlocked(s, job) || s.jobs[job] > 0) continue;
    for (const [r, v] of entries(JOBS[job].produces)) {
      if (g.rates[r] > 1e-6) continue;
      const goals = goalsNeeding(s, r);
      if (!goals.length) continue;
      // as many as «Сделать» really moves (it keeps the foragers the colony needs): the text matches the action
      const n = Math.min(3, g.movable(job));
      if (n < 1) continue;
      const x = n * v * d.jobSpeed[job] * d.jobYield[job] * resMult(s, d, r, false) * workforce;
      const icon = RESOURCES[r].icon;
      yield {
        id: `idle_job:${job}`,
        icon: JOBS[job].icon,
        text: `${SELF_STARTING[r] ?? `${RESOURCES[r].name}: никто не добывает`}: отправьте ${n} ${ratsAcc(n)} ${JOB_TO[job]} (+${fmt(x)} ${icon}/с)`,
        why: `Ждут ${icon}: ${goals
          .slice(0, 2)
          .map((x2) => (x2.startsWith("экспедиция") ? x2 : `«${x2}»`))
          .join(", ")}`,
        tab: "jobs",
        target: `j_${job}`,
        action: { kind: "assign", job, n },
      };
      break;
    }
  }

  // 3b. the goal waits for an open job's resource while other rats work for nothing: the idle, crews whose output
  // overflows a full store, foragers far above the upkeep (> SURPLUS_MARGIN×; they stay at AUTO_FOOD_MARGIN×, and
  // while 🍞 is a cost of the goal only as many as make it faster: donorPool) — said only when the move really
  // shortens the goal (REBALANCE_GAIN)
  const b = g.bottleneck;
  if (byHand && p && b && b.etaSec > SLOW_SEC) {
    const job = jobFor(s, d, b.res, g.rates);
    if (job === "pickpocket" || job === "scavenger") {
      const gross = crumbGross(s, d, g.rates);
      const food = upkeep(s);
      const pool = g.pool(job).filter((x) => x.job !== "forager" || gross > SURPLUS_MARGIN * food);
      const n = movableTo(s, d, job, pool);
      const after = n >= 1 ? shortfallAfterMove(s, d, job, pool, n) : null;
      if (after && (after[0]?.etaSec ?? 0) < REBALANCE_GAIN * b.etaSec) {
        const icon = RESOURCES[b.res].icon;
        const main = pool.reduce((a, x) => (x.n > a.n ? x : a), pool[0]);
        const lead = main.job === "forager" ? `Крошек вдоволь (${fmtRate(gross)} при прокорме ${fmt(food)}/с)` : (SURPLUS_WHY[main.job] ?? "Крысы работают впустую");
        const who = pool.length === 1 ? crewAcc(main.job, n) : ratsAcc(n);
        // the foragers come last in the pool: they move only past the free hands
        const fed = n > pool.reduce((a, x) => a + (x.job === "forager" ? 0 : x.n), 0);
        // the newborns follow the star only when the player set it and the star rules (core.newbornJob)
        const follows = !autoFocusOn(s) && (s.assignMode === "focus" || !s.upgrades.rat_relay);
        const why = follows
          ? `Новорождённые тоже пойдут ${JOB_TO[job]}${fed ? ", а еды останется с запасом" : ""}`
          : autoFocusOn(s)
            ? `${fed ? "Еды останется с запасом, а новорождённых" : "Новорождённых"} Старейшина и дальше шлёт туда, где нужнее`
            : `${fed ? "Еды останется с запасом, а новорождённые" : "Новорождённые"} пойдут по вашим долям`;
        yield {
          id: `rebalance:${job}`,
          icon: JOBS[job].icon,
          text: `${lead}, а ${icon} ${projectForText(p)} ${etaWords(b.etaSec)}: переведите ${n} ${who} ${JOB_TO[job]}`,
          why,
          tab: "jobs",
          target: `j_${job}`,
          action: { kind: "assign", job, n, ...(follows ? { setFocus: true } : {}), from: pool.map((x) => x.job) },
        };
      }
    }
  }

  // 2. housing (demoted in v3): once the colony has the rats it needs to move on, a dear or cap-locked nest waits; a
  // bigger pantry that cannot be built yet is said last (what to save for), not instead of everything else
  let housingLater: Hint | null = null;
  if (s.rats >= d.housing && buildingVisible(s, "nest") && !(s.upgrades.foreman && s.foreman.nests)) {
    const cost = buildingCost("nest", s.buildings.nest);
    const crumbs = cost.crumbs ?? 0;
    const dear = crumbs > NEST_SEC * Math.max(0, g.rates.crumbs) || lockedByCap(cost, d).length > 0;
    if (!(s.rats >= crewTarget(s) && dear)) {
      if (crumbs <= 2 * s.res.crumbs && lockedByCap(cost, d).includes("crumbs")) {
        // the nest costs more than the pantry holds: a bigger store first (buying the nest would silently fail)
        const store = storageHintFor(s, d, "crumbs", crumbs);
        const id = store.buildingId && buildingVisible(s, store.buildingId) ? store.buildingId : null;
        const h: Hint = {
          id: "housing:store",
          icon: id ? BUILDINGS[id].icon : BUILDINGS.nest.icon,
          text: `Гнездо стоит ${fmt(crumbs)} 🍞, а склад вмещает ${fmt(d.caps.crumbs)} — ${id ? `постройте «${BUILDINGS[id].name}»` : `нужен склад: ${store.text}`}`,
          why: `Крысята рождаются, только пока есть место: ${fmt(s.rats)}/${fmt(d.housing)}`,
          tab: store.target?.startsWith("z_") ? "map" : "buildings",
          target: store.target ?? "b_nest",
          ...(id && canAfford(s, buildingCost(id, s.buildings[id])) ? { action: { kind: "buyBuilding", id } as const } : {}),
        };
        if (h.action) yield h;
        else housingLater = h;
      } else if (crumbs <= 2 * s.res.crumbs) {
        yield {
          id: "housing",
          icon: BUILDINGS.nest.icon,
          text: "Жильё полно — постройте гнездо",
          why: `Крысята рождаются, только пока есть место: ${fmt(s.rats)}/${fmt(d.housing)}`,
          tab: "buildings",
          target: "b_nest",
          action: { kind: "buyBuilding", id: "nest" },
        };
      }
    }
  }

  // 4. a starved converter (one idling on a full store only when the goal still needs that output: a full steam buffer
  // nobody draws on is a surplus, not a fault)
  for (const job of CONVERTERS) {
    if (s.jobs[job] <= 0 || (s.convEff[job] ?? 1) >= 0.6) continue;
    const cb = converterBottleneck(s, d, job);
    if (!cb || (cb.kind === "full" && !g.short.some((x) => x.res === cb.res))) continue;
    let action: HintAction = { kind: "focus" };
    let tab: TabId = "jobs";
    let target = `j_${cb.supplier ?? job}`;
    if (cb.building && buildingVisible(s, cb.building) && !atMaxLevel(s, cb.building)) {
      tab = "buildings";
      target = `b_${cb.building}`;
      // «Сделать» only when the purchase can go through (else the button would do nothing)
      const cost = buildingCost(cb.building, s.buildings[cb.building]);
      if (canAfford(s, cost) && !lockedByCap(cost, d).length) action = { kind: "buyBuilding", id: cb.building };
    } else if (cb.kind === "input" && cb.supplier && !cb.supplierLocked && cb.need) {
      // the suppliers' slots are full and nothing builds more (the boiler at its cap, ENG-4): no step helps here — the
      // Jobs tab line says why
      if (!(d.slots[cb.supplier] > s.jobs[cb.supplier])) continue;
      // as many as «Сделать» really moves (potential.donorPool), so the press is never a no-op
      const n = byHand ? Math.min(cb.need, g.movable(cb.supplier)) : 0;
      if (n >= 1) action = { kind: "assign", job: cb.supplier, n };
    }
    yield { id: `converter:${job}`, icon: JOBS[job].icon, text: `${JOBS[job].name}: ${cb.text}`, why: `Бригада работает на ${Math.round(cb.eff * 100)}%`, tab, target, action };
  }

  // 5. an expedition that can take a real contribution; the price of the building that starts a missing resource
  // (the workshop's 🔘 for the Cellars' ⚙️) stays in the stores
  if (z && !s.digging && !s.autoContribute) {
    const keep = enablerReserve(g);
    const parts = entries(remaining(expeditionCost(s, z), s.projects[z] ?? {}))
      .map(([r, need]) => [r, need, s.res[r] - (keep.cost[r] ?? 0)] as const)
      .filter(([r, need, have]) => {
        if (need <= 0 || have <= 0) return false;
        const full = Number.isFinite(d.caps[r]) && s.res[r] >= 0.99 * d.caps[r];
        return full || have >= 0.25 * need;
      });
    if (parts.length) {
      const list = parts.map(([r, need, have]) => `${RESOURCES[r].icon} ${fmt(Math.min(need, have))}`).join(", ");
      const rats = ZONES[z].expedition?.rats ?? 0;
      let why = s.rats < rats ? `Вклад не пропадёт; для похода нужно ${fmt(rats)} 🐀 (сейчас ${fmt(s.rats)})` : "Вклад не пропадёт, а склад освободится для новых запасов";
      const kept = keep.id ? entries(keep.cost).filter(([r]) => parts.some(([pr]) => pr === r)) : [];
      if (keep.id && kept.length) why += `; на «${BUILDINGS[keep.id].name}» отложено ${kept.map(([r, v]) => `${fmt(v)} ${RESOURCES[r].icon}`).join(", ")}`;
      yield {
        id: `expedition:${z}`,
        icon: "🗺️",
        text: `Внесите в экспедицию «${ZONES[z].name}»: ${list}`,
        why,
        tab: "map",
        target: `z_${z}`,
        action: kept.length ? { kind: "contribute", zone: z, keep: keep.cost } : { kind: "contribute", zone: z },
      };
    }
  }

  // 6. an affordable upgrade, cheapest first; not one that only fills a full store nobody needs more of
  const ups = UPGRADE_ORDER.filter((id) => !s.upgrades[id] && upgradeVisible(s, id) && canAfford(s, UPGRADES[id].cost)).sort(
    (a, b2) => marketValue(UPGRADES[a].cost) - marketValue(UPGRADES[b2].cost),
  );
  for (const id of ups) {
    if (fillsOnlyFullStores(g, id)) continue;
    const u = UPGRADES[id];
    yield { id: `upgrade:${id}`, icon: u.icon, text: `Можно изобрести «${u.name}»`, why: u.effect, tab: "upgrades", target: `u_${id}`, action: { kind: "buyUpgrade", id } };
  }

  // 7. a full store and an affordable bigger one
  for (const r of RES_IDS) {
    const cap = d.caps[r];
    if (!Number.isFinite(cap) || s.res[r] < 0.999 * cap || !s.revealed[`res_${r}`]) continue;
    const id = cheapestStore(s, d, r, true);
    if (!id) continue;
    yield {
      id: `storage:${r}`,
      icon: BUILDINGS[id].icon,
      text: `Склад ${RESOURCES[r].icon} полон — постройте «${BUILDINGS[id].name}»`,
      why: BUILDINGS[id].desc,
      tab: "buildings",
      target: `b_${id}`,
      action: { kind: "buyBuilding", id },
    };
  }

  // last: what to save for — the slots the slow bottleneck needs, the store a nest needs
  const more = p ? moreSlotsHint(g) : null;
  if (more && !more.action) yield more;
  if (housingLater) yield housingLater;
}

/**
 * Rule 2a: a slot job with free slots whose output the project still needs (directly, or as the input of a converter
 * that makes it) — empty, or at work while that resource is slow (> SLOW_SEC); the slowest resource's crew first, a
 * converter only when its inputs can feed it; then, when the slow bottleneck has no crew that can take a rat, the
 * building that gives it slots.
 */
function* crewHints(g: HintCtx, workforce: number, byHand: boolean): Generator<Hint> {
  const { s, d } = g;
  const p = g.project!;
  const needed = new Map(g.short.map((x) => [x.res, x] as const));
  const found: { eta: number; hint: Hint }[] = [];
  for (const job of byHand ? JOB_IDS : []) {
    const slots = JOBS[job].slots;
    if (!slots || !jobUnlocked(s, job)) continue;
    const free = d.slots[job] - s.jobs[job];
    if (!(free > 0)) continue;
    const outs = Object.keys(JOBS[job].produces) as ResId[];
    let serves = outs.find((r) => needed.has(r)) ?? null;
    let via: JobId | null = null;
    if (!serves) {
      for (const c of CONVERTERS) {
        if (c === job || !jobUnlocked(s, c)) continue;
        const makes = (Object.keys(JOBS[c].produces) as ResId[]).find((r) => needed.has(r));
        if (makes && outs.some((r) => (JOBS[c].consumes[r] ?? 0) > 0)) {
          serves = makes;
          via = c;
          break;
        }
      }
    }
    if (!serves) continue;
    const need = needed.get(serves)!;
    // a crew already at work gets more hands only while what it serves is slow
    if (s.jobs[job] > 0 && !(need.etaSec > SLOW_SEC)) continue;
    const n = Math.min(free, g.movable(job));
    if (n < 1) continue;
    // what n more workers make, a converter at the inputs there are
    const rate = n * d.jobSpeed[job] * workforce;
    let eff = 1;
    for (const [c, vc] of entries(JOBS[job].consumes)) eff = Math.min(eff, (Math.max(0, g.rates[c]) + Math.max(0, s.res[c]) / STOCK_HORIZON) / (rate * vc));
    if (eff < MIN_CREW_EFF) continue;
    const out = outs[0];
    const x = rate * (JOBS[job].produces[out] ?? 0) * d.jobYield[job] * resMult(s, d, out, false) * Math.min(1, eff);
    const where = BUILDINGS[slots.building].name;
    const text =
      s.jobs[job] <= 0
        ? `«${where}» пустует: поставьте ${n} ${ratsAcc(n)} ${JOB_TO[job]} (+${fmt(x)} ${RESOURCES[out].icon}/с)`
        : `«${where}»: свободно ${free} ${plural(free, "место", "места", "мест")} — поставьте ещё ${n} ${ratsAcc(n)} ${JOB_TO[job]} (+${fmt(x)} ${RESOURCES[out].icon}/с)`;
    const icon = RESOURCES[serves].icon;
    const why = via
      ? `${icon} ждёт ${projectName(p)} (${fmt(need.remaining)}); ${JOB_PLURAL[via].toLowerCase()} делают его из ${RESOURCES[out].icon}`
      : `${icon} ждёт ${projectName(p)} (${fmt(need.remaining)})`;
    found.push({ eta: need.etaSec, hint: { id: `empty_crew:${job}`, icon: JOBS[job].icon, text, why, tab: "jobs", target: `j_${job}`, action: { kind: "assign", job, n } } });
  }
  // the crew of the slowest resource first
  for (const f of found.sort((x, y) => y.eta - x.eta)) yield f.hint;
  // the slow bottleneck has no crew that can take a rat: the building that gives it one, when affordable (else rule
  // 5 saves its price and the same hint comes last, as what to save for)
  const more = moreSlotsHint(g);
  if (more?.action) yield more;
}

/**
 * The slow bottleneck has no crew that can take a rat (slots full, or its building not built): build the slots.
 * «Сделать» only when the building is affordable; null when this does not apply.
 */
function moreSlotsHint(g: HintCtx): Hint | null {
  const { s, d } = g;
  const p = g.project;
  const b = g.bottleneck;
  if (!p || !b || !(b.etaSec > SLOW_SEC) || jobFor(s, d, b.res, g.rates)) return null;
  const m = slotMakerOf(b.res);
  if (!m || !buildingVisible(s, m.building) || !storeRoom(s, m.building)) return null;
  const cost = buildingCost(m.building, s.buildings[m.building]);
  if (lockedByCap(cost, d).length) return null;
  const icon = RESOURCES[b.res].icon;
  const crew = JOB_PLURAL[m.job].toLowerCase();
  const name = BUILDINGS[m.building].name;
  const slots = jobUnlocked(s, m.job) ? d.slots[m.job] : 0;
  const text =
    s.buildings[m.building] > 0 && slots > 0
      ? `${icon} делают только ${crew}, мест ${fmt(s.jobs[m.job])}/${fmt(slots)} — стройте ещё «${name}»`
      : `${icon} никто не делает — стройте «${name}»: там работают ${crew}`;
  return {
    id: `more_slots:${m.building}`,
    icon: BUILDINGS[m.building].icon,
    text,
    why: `${icon} ждёт ${projectName(p)} (${fmt(b.remaining)})${Number.isFinite(b.etaSec) ? `: без новых мест ${etaWords(b.etaSec)}` : ""}`,
    tab: "buildings",
    target: `b_${m.building}`,
    ...(canAfford(s, cost) ? { action: { kind: "buyBuilding", id: m.building } as const } : {}),
  };
}

/**
 * Rule 5's reserve: the price of the cheapest unbuilt, visible, not cap-locked building whose job slots would make a
 * resource the project still needs (directly or as a converter's input) — the building rule 2a then staffs.
 */
function enablerReserve(g: HintCtx): { id: BuildingId | null; cost: Amounts } {
  const { s, d } = g;
  const needed = new Set(g.short.map((x) => x.res));
  if (!needed.size) return { id: null, cost: {} };
  let best: BuildingId | null = null;
  let bestV = Infinity;
  let bestCost: Amounts = {};
  for (const id of BUILDING_ORDER) {
    if (s.buildings[id] > 0 || !buildingVisible(s, id)) continue;
    const jobs = BUILDINGS[id].effects.flatMap((e) => (e.t === "slots" ? [e.job] : []));
    const helps = jobs.some((j) => {
      const outs = Object.keys(JOBS[j].produces) as ResId[];
      if (outs.some((r) => needed.has(r))) return true;
      return CONVERTERS.some((c) => (Object.keys(JOBS[c].produces) as ResId[]).some((r) => needed.has(r)) && outs.some((r) => (JOBS[c].consumes[r] ?? 0) > 0));
    });
    if (!helps) continue;
    const cost = buildingCost(id, 0);
    if (lockedByCap(cost, d).length) continue;
    const v = marketValue(cost);
    if (v < bestV) {
      bestV = v;
      best = id;
      bestCost = cost;
    }
  }
  return { id: best, cost: bestCost };
}

/**
 * Rule 6's skip: the upgrade raises only resources whose store is ≥ 99% full and that are in surplus (the project
 * does not need more of them; 🍞 above SURPLUS_MARGIN × upkeep), e.g. «Мешочки из носков» on a full pantry. Upgrades
 * that change no production (clicks, housing, events) are never skipped.
 */
function fillsOnlyFullStores(g: HintCtx, id: UpgradeId): boolean {
  const { s, d } = g;
  const s2: GameState = { ...s, upgrades: { ...s.upgrades, [id]: true } };
  const after = potentialRates(s2, derive(s2));
  const raised = RES_IDS.filter((r) => after[r] - g.rates[r] > 1e-9);
  if (!raised.length) return false;
  const needed = new Set(g.short.map((x) => x.res));
  return raised.every((r) => {
    const full = Number.isFinite(d.caps[r]) && s.res[r] >= 0.99 * d.caps[r];
    const surplus = !needed.has(r) && (r !== "crumbs" || crumbGross(s, d, g.rates) > SURPLUS_MARGIN * upkeep(s));
    return full && surplus;
  });
}

/* ================================================================ hysteresis and «Сделать» */

/**
 * nextHint with its hysteresis (ENG-1): records in s.hintMemo since when the current hint has been shown; one shown
 * longer than HINT_STALE_SEC without its action taken is muted for HINT_MUTE_SEC and the next rule speaks instead.
 * Called by the store about once a second of play and by the newcomer bot; returns the hint to show.
 */
export function trackHint(s: GameState, d: Derived): Hint | null {
  const m = s.hintMemo;
  let h = nextHint(s, d);
  if (!h) {
    if (m.id) m.id = "";
    return null;
  }
  if (h.id !== m.id) {
    m.id = h.id;
    m.since = s.time;
    return h;
  }
  if (s.time - m.since > HINT_STALE_SEC) {
    m.muted = h.id;
    m.mutedUntil = s.time + HINT_MUTE_SEC;
    h = nextHint(s, d);
    m.id = h?.id ?? "";
    m.since = s.time;
  }
  return h;
}

/** The player took the hint's advice: its stale clock starts again (it is not muted while followed). */
export function hintTaken(s: GameState, id: string): void {
  if (s.hintMemo.id === id) s.hintMemo.since = s.time;
}

/**
 * The player was away — an offline catch-up, a long stalled frame — so the hint on screen was not being read: its
 * stale clock starts again rather than muting it on the first look back (offline.simulateOffline, store.advance).
 */
export function resumeHintClock(s: GameState): void {
  if (s.hintMemo.id) s.hintMemo.since = s.time;
}

/**
 * «Сделать» (store.applyHint, the newcomer bot): carry out the hint's action — assign (applyAssignHint, the foragers
 * the colony needs stay), contribute (keeping `keep`), build one level, invent — and, when anything changed hands,
 * note the hint as taken (a press that does nothing must not keep a dead hint from going stale). Returns whether
 * anything changed hands.
 */
export function applyHintAction(s: GameState, d: Derived, h: Hint, ctx: EngineCtx): boolean {
  const changed = doHintAction(s, d, h.action, ctx);
  if (changed) hintTaken(s, h.id);
  return changed;
}

function doHintAction(s: GameState, d: Derived, a: HintAction | undefined, ctx: EngineCtx): boolean {
  if (!a) return false;
  switch (a.kind) {
    case "assign": {
      const before = s.jobs[a.job];
      const pool = a.job === "forager" ? undefined : donorPool(s, d, a.job).filter((x) => !a.from || a.from.includes(x.job));
      applyAssignHint(s, d, a.job, a.n, a.setFocus, pool);
      return s.jobs[a.job] !== before;
    }
    case "contribute":
      return a.keep ? contributeExpeditionKeeping(s, a.zone, a.keep, ctx) : contributeExpedition(s, a.zone, null, ctx);
    case "buyBuilding":
      return buyBuilding(s, d, a.id, 1, ctx) > 0;
    case "buyUpgrade":
      return buyUpgrade(s, a.id, ctx);
    default:
      return false;
  }
}

/* ================================================================ storage */

/** Buildings that raise the cap of r: flat caps, the T1/T1G multipliers, the steam buffer. */
export function storageBuildingsFor(r: ResId): BuildingId[] {
  const t1g = new Set<ResId>([...T1, "gears", "cheese"]);
  return BUILDING_ORDER.filter((id) =>
    BUILDINGS[id].effects.some(
      (e) =>
        (e.t === "cap" && e.res === r) ||
        (e.t === "capMult" && (e.group === "T1" ? T1.includes(r) : t1g.has(r))) ||
        (e.t === "steamCap" && r === "steam"),
    ),
  );
}

function storeRoom(s: GameState, id: BuildingId): boolean {
  return !atMaxLevel(s, id);
}

/** A store is never suggested for more than this many levels at once (v3 ENG-1: no more «Кладовка ур. 29»). */
export const STORE_LEVELS_MAX = 3;

/**
 * Levels of store `id` to add before the cap of r holds `price` (1 when no price is given or it already fits).
 * Flat adders: (price − cap) / (amt × M), M = the multiplier on flat caps; multipliers: log(price / cap) / log(mult).
 */
function storeLevelsFor(s: GameState, d: Derived, id: BuildingId, r: ResId, price?: number): number {
  const cap = d.caps[r];
  if (price === undefined || !(price > cap) || !Number.isFinite(cap) || cap <= 0) return 1;
  const def = RESOURCES[r];
  let flat = def.baseCap ?? 0;
  for (const b of BUILDING_ORDER) for (const ef of BUILDINGS[b].effects) if (ef.t === "cap" && ef.res === r) flat += ef.amt * s.buildings[b];
  const M = flat > 0 ? cap / flat : 1;
  let k = 1;
  for (const ef of BUILDINGS[id].effects) {
    if (ef.t === "cap" && ef.res === r) k = Math.max(k, Math.ceil((price - cap) / (ef.amt * M)));
    else if (ef.t === "capMult") k = Math.max(k, Math.ceil(Math.log(price / cap) / Math.log(ef.mult)));
  }
  const max = buildingMaxLevel(s, id);
  return Number.isFinite(max) ? Math.max(1, Math.min(k, max - s.buildings[id])) : k;
}

/**
 * The store to suggest for r: visible, not maxed, none of the levels it takes above the caps of its time (a store
 * locked behind itself, lockedOnTheWay), and at most STORE_LEVELS_MAX levels away from holding `price`. The cheapest
 * way there by market value of the levels it takes, a multiplier store (Склад в трубе, Винный погреб…) first on a
 * tie; optionally only affordable.
 */
function cheapestStore(s: GameState, d: Derived, r: ResId, affordableOnly: boolean, price?: number): BuildingId | null {
  let best: BuildingId | null = null;
  let bestV = Infinity;
  let bestMult = false;
  for (const id of storageBuildingsFor(r)) {
    if (!buildingVisible(s, id) || !storeRoom(s, id)) continue;
    const next = buildingCost(id, s.buildings[id]);
    if (lockedByCap(next, d).length > 0) continue;
    if (affordableOnly && !canAfford(s, next)) continue;
    const k = storeLevelsFor(s, d, id, r, price);
    if (k > STORE_LEVELS_MAX || lockedOnTheWay(s, id, k)) continue;
    const v = marketValue(k > 1 ? buildingCost(id, s.buildings[id], k) : next);
    const mult = BUILDINGS[id].effects.some((e) => e.t === "capMult");
    if (v < bestV || (v === bestV && mult && !bestMult)) {
      bestV = v;
      best = id;
      bestMult = mult;
    }
  }
  return best;
}

/**
 * A level between the next one and the k-th costs more than the stores hold by then (the levels before it bought):
 * «ур. N+3» would be a dead end one level later, the store locked behind itself again.
 */
function lockedOnTheWay(s: GameState, id: BuildingId, k: number): boolean {
  for (let L = 1; L < k; L++) {
    const s2: GameState = { ...s, buildings: { ...s.buildings, [id]: s.buildings[id] + L } };
    if (lockedByCap(buildingCost(id, s2.buildings[id]), derive(s2)).length > 0) return true;
  }
  return false;
}

/** «, когда упрётесь в лимит 🍞» for the cap flags, else «: <condition>». */
function unlockText(id: BuildingId): string {
  const c = BUILDINGS[id].unlock;
  if ("flag" in c && c.flag === "hit_crumb_cap") return ", когда упрётесь в лимит 🍞";
  if ("flag" in c && c.flag === "hit_any_cap") return ", когда упрётесь в любой лимит";
  return `: ${describeCond(c, condName)}`;
}

function condName(kind: string, id: string): string {
  if (kind === "building") return BUILDINGS[id as BuildingId]?.name ?? id;
  if (kind === "job") return JOBS[id as JobId]?.name ?? id;
  if (kind === "zone") return ZONES[id as ZoneId]?.name ?? id;
  if (kind === "res") return RESOURCES[id as ResId]?.icon ?? id;
  if (kind === "upgrade") return UPGRADES[id as UpgradeId]?.name ?? id;
  return id;
}

/**
 * What raises the cap of r, for «🔒 нужен склад» (PA-3) and the elder: a visible store that is not itself cap-locked
 * and holds `price` within STORE_LEVELS_MAX levels (text «🥫 Кладовка в жестянке ур. 3», target b_<id>; cheapestStore
 * picks it), else a store of an open zone that is not unlocked yet («… — откроется, когда упрётесь в лимит 🍞»), else
 * one in a closed zone («… — в новой зоне «Подвалы»», target z_<zone>), else «ни один склад пока не вместит».
 */
export function storageHintFor(s: GameState, d: Derived, res: ResId, price?: number): { text: string; target?: string; buildingId?: BuildingId } {
  const visible = cheapestStore(s, d, res, false, price);
  if (visible) {
    const def = BUILDINGS[visible];
    const level = s.buildings[visible] + storeLevelsFor(s, d, visible, res, price);
    return { text: `${def.icon} ${def.name} ур. ${level}`, target: `b_${visible}`, buildingId: visible };
  }
  const stores = storageBuildingsFor(res);
  const all = stores.filter((id) => storeRoom(s, id) && !buildingVisible(s, id));
  const hidden = all.find((id) => !!s.zones[BUILDINGS[id].zone]);
  if (hidden) return { text: `«${BUILDINGS[hidden].name}» — откроется${unlockText(hidden)}`, buildingId: hidden };
  const closed = [...all].sort((a, b) => ZONES[BUILDINGS[a].zone].order - ZONES[BUILDINGS[b].zone].order)[0];
  if (closed) {
    const zone = BUILDINGS[closed].zone;
    return { text: `«${BUILDINGS[closed].name}» — в новой зоне «${ZONES[zone].name}»`, target: `z_${zone}`, buildingId: closed };
  }
  if (stores.length) return { text: `${RESOURCES[res].icon}: ни один склад пока столько не вместит — растите склады понемногу` };
  return { text: `${RESOURCES[res].icon}: склада для этого нет` };
}

/* ================================================================ sources */

/**
 * «Где взять {icon}»: jobs that make it (with current workers), buildings that produce it, and event sources
 * from data/sources.ts whose condition holds. Only things the player can already see.
 */
export function resourceSources(
  s: GameState,
  res: ResId,
): { icon: string; label: string; kind: "job" | "building" | "click" | "event"; job?: JobId; workers?: number }[] {
  const out: { icon: string; label: string; kind: "job" | "building" | "click" | "event"; job?: JobId; workers?: number }[] = [];
  for (const j of JOB_IDS) {
    if (j === "idle" || !(JOBS[j].produces[res] ?? 0) || !jobUnlocked(s, j)) continue;
    out.push({ icon: JOBS[j].icon, label: JOB_PLURAL[j], kind: "job", job: j, workers: s.jobs[j] });
  }
  for (const id of BUILDING_ORDER) {
    if (!buildingVisible(s, id)) continue;
    if (BUILDINGS[id].effects.some((e) => e.t === "produce" && e.res === res)) out.push({ icon: BUILDINGS[id].icon, label: BUILDINGS[id].name, kind: "building" });
  }
  const silence = sealOn(s, "silence");
  for (const src of EVENT_SOURCES[res] ?? []) {
    if (!check(s, src.when) || (src.until && check(s, src.until)) || (src.noSilence && silence)) continue;
    out.push({ icon: src.icon, label: src.label, kind: src.kind });
  }
  return out;
}

/* ================================================================ steam */

/**
 * The steam gauge, itemised (CO-4): stock and buffer, stoker output, who burns it, the consumer efficiency and
 * the one fix that helps most: more stokers (free slots), coal miners (stokers starve) or a boiler (no slots left).
 */
export function steamBreakdown(
  s: GameState,
  d: Derived,
): {
  stock: number;
  buffer: number;
  gross: number;
  stokers: number;
  slots: number;
  convEff: number;
  consumers: { id: string; name: string; icon: string; perSec: number }[];
  steamEff: number;
  fix: "boiler" | "miners" | "stokers" | null;
  /** v3 (ENG-4): «бюджет 135 💨/с: прессы X · часы Y · плавильни/кузни Z» (steamBudgetLine). */
  budgetLine: string;
} {
  const workforce = s.rats > 0 ? 1 - stunnedRats(s) / s.rats : 1;
  const consumers: { id: string; name: string; icon: string; perSec: number }[] = [];
  for (const j of ["smelter", "smith"] as const) {
    const n = s.jobs[j];
    const use = JOBS[j].consumes.steam ?? 0;
    if (n > 0 && use > 0) consumers.push({ id: j, name: JOB_PLURAL[j], icon: JOBS[j].icon, perSec: n * use * d.jobSpeed[j] * workforce });
  }
  for (const id of ["steam_press", "clocktower"] as const) {
    const L = s.buildings[id];
    if (L <= 0) continue;
    let use = 0;
    for (const e of BUILDINGS[id].effects) if (e.t === "steamPress" || e.t === "steamClock") use += e.use * L;
    if (use > 0) consumers.push({ id, name: BUILDINGS[id].name, icon: BUILDINGS[id].icon, perSec: use });
  }
  const stokers = s.jobs.stoker;
  const slots = d.slots.stoker;
  const convEff = s.convEff.stoker ?? 1;
  const gross = s.gross.steam;
  const demand = consumers.reduce((a, c) => a + c.perSec, 0);
  const starved = demand > gross * 1.001 + 1e-9 || (d.steamNeed > 0 && s.steamEff < 0.99);
  let fix: "boiler" | "miners" | "stokers" | null = null;
  if (starved && demand > 0) {
    if (s.buildings.boiler <= 0) fix = "boiler";
    else if (stokers > 0 && convEff < 0.9) fix = "miners";
    else if (stokers < slots) fix = "stokers";
    // v3 (ENG-4): the boiler is capped — past it the valve (who gets the steam first) is the remaining choice
    else fix = atMaxLevel(s, "boiler") ? null : "boiler";
  }
  return { stock: s.res.steam, buffer: d.caps.steam, gross, stokers, slots, convEff, consumers, steamEff: s.steamEff, fix, budgetLine: steamBudgetLine(s, d) };
}

/**
 * The steam budget in one line (v3 ENG-4, the manometer tooltip and the valve): what the stokers can make and what
 * the presses, the clocks and the smelters/smiths ask at full speed — «бюджет 135 💨/с: прессы 44 · часы 50 ·
 * плавильни/кузни 26».
 */
export function steamBudgetLine(s: GameState, d: Derived): string {
  const b = steamBudget(s, d);
  return `бюджет ${fmt(b.supply)} 💨/с: прессы ${fmt(b.press)} · часы ${fmt(b.clock)} · плавильни/кузни ${fmt(b.conv)}`;
}

/* ================================================================ suspicion */

/**
 * The suspicion scale explained (SH-3 tooltip): +1%/min × suspicionMult (×3 while «Щепки от дудки» runs) while the
 * player is active (offline it stands still), the threshold that summons the ratcatcher (100%, Мэйфэр 80%) and the
 * time until he comes (0 once he is on his way), and what lowers it. v3 (ENG-8): human vigilance — the share of train
 * and capsule loot lost right now above vigilanceFrom (50, Биг-Бен 30), and its rule as a line.
 */
export function suspicionInfo(
  s: GameState,
  d: Derived,
): {
  pct: number;
  perMin: number;
  activeOnly: true;
  threshold: number;
  etaSec: number | null;
  reducers: { label: string; amount: string }[];
  /** Share of train/capsule item values the humans keep from the colony at this suspicion (0..0.5). */
  vigilance: number;
  vigilanceFrom: number;
  /** «Бдительность людей: −12% к добыче поездов (выше 50 👁)», or the rule while it is still 0. */
  vigilanceLine: string;
} {
  const pct = Math.max(0, Math.min(100, s.suspicion));
  const threshold = d.ratcatcherAt;
  const perMin = s.zones.cellars ? d.suspicionMult * (d.commission === "pipe_splinters" ? 3 : 1) : 0;
  const etaSec = Number.isFinite(s.timers.ratcatcherAt) ? 0 : perMin > 0 ? (Math.max(0, threshold - pct) / perMin) * 60 : null;
  const reducers: { label: string; amount: string }[] = [
    { label: "спрятаться от Кота", amount: "−10" },
    { label: "победить Кота", amount: "−25" },
    { label: "сломать дудку Крысолова", amount: "до 0" },
  ];
  if (!s.upgrades.quiet_paws) reducers.push({ label: UPGRADES.quiet_paws.name, amount: "×0.7" });
  const lost = 1 - vigilance(pct, d.vigilanceFrom);
  const vigilanceLine =
    lost > 0
      ? `Бдительность людей: −${Math.round(lost * 100)}% к добыче поездов (выше ${d.vigilanceFrom} 👁)`
      : `Бдительность людей: выше ${d.vigilanceFrom} 👁 добыча поездов дешевеет на 1% за каждый пункт`;
  return { pct, perMin, activeOnly: true, threshold, etaSec, reducers, vigilance: lost, vigilanceFrom: d.vigilanceFrom, vigilanceLine };
}

/* ================================================================ jobs tab numbers */

/**
 * Market value one more rat in this job would add per second (outputs only, at the converter's current
 * efficiency); outputs whose store is full count 0 and are listed in `capped`. `surplus`: a crumb job while
 * food runs > 50% above upkeep.
 */
export function jobValuePerRat(s: GameState, d: Derived, job: JobId): { value: number; net: number; surplus: boolean; capped: ResId[] } {
  const def = JOBS[job];
  const isConv = Object.keys(def.consumes).length > 0;
  const eff = isConv ? Math.max(0, Math.min(1, s.convEff[job] ?? 1)) : 1;
  let value = 0;
  const capped: ResId[] = [];
  for (const [r, v] of entries(def.produces)) {
    if (Number.isFinite(d.caps[r]) && s.res[r] >= 0.999 * d.caps[r]) {
      capped.push(r);
      continue;
    }
    value += v * d.jobSpeed[job] * d.jobYield[job] * resMult(s, d, r) * eff * unitValue(r);
  }
  const surplus = (def.produces.crumbs ?? 0) > 0 && crumbBalance(s, d) > 0.5 * d.food;
  // net of a converter's intake at the same efficiency (PA-4)
  const net = value - entries(def.consumes).reduce((a, [r, x]) => a + x * d.jobSpeed[job] * eff * unitValue(r), 0);
  return { value, net, surplus, capped };
}

/** Seconds until a converter's scarcest falling input runs out at the current net rate (null if none is falling). */
export function inputRunway(s: GameState, d: Derived, job: JobId): { res: ResId; seconds: number } | null {
  void d;
  if (s.jobs[job] <= 0) return null;
  let best: { res: ResId; seconds: number } | null = null;
  for (const [r] of entries(JOBS[job].consumes)) {
    const rate = s.rates[r];
    if (!(rate < -1e-9)) continue;
    const seconds = Math.max(0, s.res[r]) / -rate;
    if (!best || seconds < best.seconds) best = { res: r, seconds };
  }
  return best;
}
