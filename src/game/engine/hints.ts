import { BUILDINGS, BUILDING_ORDER } from "../data/buildings";
import { CONVERTERS, JOBS } from "../data/jobs";
import { RESOURCES } from "../data/resources";
import { EVENT_SOURCES, JOB_PLURAL, JOB_TO } from "../data/sources";
import { UPGRADES, UPGRADE_ORDER } from "../data/upgrades";
import { ZONES } from "../data/zones";
import { JOB_IDS, RES_IDS, T1, type BuildingId, type GameState, type JobId, type ResId, type TabId, type UpgradeId, type ZoneId } from "../types";
import { fmt, fmtRate, plural } from "../../lib/format";
import { assignable, buildingVisible, currentExpedition, upgradeVisible } from "./actions";
import { check, describeCond } from "./conditions";
import { jobUnlocked } from "./core";
import { resMult, stunnedRats, type Derived } from "./derive";
import { crumbBalance, unitValue } from "./economy";
import { buildingCost, canAfford, entries, expeditionCost, marketValue, remaining } from "./formulas";

/**
 * Onboarding brains (EN-7): the elder's next hint, «Где взять», storage locks, the steam gauge breakdown,
 * suspicion maths and per-job numbers for the Jobs tab. Pure functions of (state, derived).
 */

/* ================================================================ types */

export type HintAction =
  | { kind: "assign"; job: JobId; n: number }
  | { kind: "contribute"; zone: ZoneId }
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
  const per = (JOBS[sup.job].produces[worst] ?? 0) * d.jobSpeed[sup.job] * d.jobYield[sup.job] * resMult(s, d, worst);
  const need = Math.max(1, Math.ceil(missing / Math.max(1e-9, per)));
  let tail = `Нужно ещё ~${need} ${plural(need, ...sup.forms)}`;
  const slots = JOBS[sup.job].slots;
  let building: BuildingId | undefined;
  if (slots && s.jobs[sup.job] + need > d.slots[sup.job]) {
    building = slots.building;
    tail += ` — но мест нет: стройте «${BUILDINGS[slots.building].name}»`;
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
    const def = BUILDINGS[id];
    if (def.maxLevel !== undefined && s.buildings[id] >= def.maxLevel) continue;
    if ((buildingCost(id, s.buildings[id])[r] ?? 0) > s.res[r] + 1e-9) out.push(def.name);
  }
  for (const id of UPGRADE_ORDER) {
    if (s.upgrades[id] || !upgradeVisible(s, id)) continue;
    if ((UPGRADES[id].cost[r] ?? 0) > s.res[r] + 1e-9) out.push(UPGRADES[id].name);
  }
  return out;
}

/* ================================================================ the elder's hint */

/**
 * The single most useful next step for a newcomer (CO-3's 💡 row), first matching rule wins:
 * 1 food in deficit · 2 housing full · 3 a free resource nobody gathers · 4 a starved converter ·
 * 5 an expedition that can take a real contribution · 6 an affordable upgrade · 7 a full store with an affordable store.
 * null when settings.hints is off or nothing applies.
 */
export function nextHint(s: GameState, d: Derived): Hint | null {
  if (!s.settings.hints || s.rats <= 0) return null;
  const workforce = s.rats > 0 ? 1 - stunnedRats(s) / s.rats : 1;

  // 1. food
  const deficit = d.food - s.gross.crumbs;
  const movable = s.rats - s.jobs.forager;
  if ((s.hungry || deficit > 1e-9) && jobUnlocked(s, "forager") && movable > 0) {
    const per = (JOBS.forager.produces.crumbs ?? 0) * d.jobSpeed.forager * d.jobYield.forager * resMult(s, d, "crumbs") * workforce;
    const n = Math.min(movable, Math.max(1, Math.ceil(Math.max(0, deficit) / Math.max(1e-9, per))));
    return {
      id: "hungry",
      icon: "🍞",
      text: `Еда в минусе: верните ${n} ${ratsAcc(n)} в собиратели`,
      why: `Крошки ${fmtRate(s.gross.crumbs - d.food)}. Голодная колония работает вполсилы и не растёт`,
      tab: "jobs",
      target: "j_forager",
      action: { kind: "assign", job: "forager", n },
    };
  }

  // 2. housing
  if (s.rats >= d.housing && buildingVisible(s, "nest") && !(s.upgrades.foreman && s.foreman.nests)) {
    const cost = buildingCost("nest", s.buildings.nest);
    if ((cost.crumbs ?? 0) <= 2 * s.res.crumbs) {
      return {
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

  // 3. a resource nobody gathers
  for (const job of ["pickpocket", "scavenger"] as const) {
    if (!jobUnlocked(s, job) || s.jobs[job] > 0) continue;
    for (const [r, v] of entries(JOBS[job].produces)) {
      if (s.rates[r] > 1e-6) continue;
      const goals = goalsNeeding(s, r);
      if (!goals.length) continue;
      // as many as assignJob would really move (it keeps a forager reserve): the text matches the action
      const n = Math.min(3, assignable(s, d, job));
      if (n < 1) continue;
      const x = n * v * d.jobSpeed[job] * d.jobYield[job] * resMult(s, d, r) * workforce;
      const icon = RESOURCES[r].icon;
      return {
        id: `idle_job:${job}`,
        icon: JOBS[job].icon,
        text: `${SELF_STARTING[r] ?? `${RESOURCES[r].name}: никто не добывает`}: отправьте ${n} ${ratsAcc(n)} ${JOB_TO[job]} (+${fmt(x)} ${icon}/с)`,
        why: `Ждут ${icon}: ${goals
          .slice(0, 2)
          .map((g) => (g.startsWith("экспедиция") ? g : `«${g}»`))
          .join(", ")}`,
        tab: "jobs",
        target: `j_${job}`,
        action: { kind: "assign", job, n },
      };
    }
  }

  // 4. a starved converter
  for (const job of CONVERTERS) {
    if (s.jobs[job] <= 0 || (s.convEff[job] ?? 1) >= 0.6) continue;
    const b = converterBottleneck(s, d, job);
    if (!b) continue;
    let action: HintAction = { kind: "focus" };
    let tab: TabId = "jobs";
    let target = `j_${b.supplier ?? job}`;
    if (b.building && buildingVisible(s, b.building)) {
      action = { kind: "buyBuilding", id: b.building };
      tab = "buildings";
      target = `b_${b.building}`;
    } else if (b.kind === "input" && b.supplier && !b.supplierLocked && b.need) {
      action = { kind: "assign", job: b.supplier, n: b.need };
    }
    return { id: `converter:${job}`, icon: JOBS[job].icon, text: `${JOBS[job].name}: ${b.text}`, why: `Бригада работает на ${Math.round(b.eff * 100)}%`, tab, target, action };
  }

  // 5. an expedition that can take a real contribution
  const z = currentExpedition(s);
  if (z && !s.digging && !s.autoContribute) {
    const parts = entries(remaining(expeditionCost(s, z), s.projects[z] ?? {})).filter(([r, need]) => {
      if (need <= 0 || s.res[r] <= 0) return false;
      const full = Number.isFinite(d.caps[r]) && s.res[r] >= 0.99 * d.caps[r];
      return full || s.res[r] >= 0.25 * need;
    });
    if (parts.length) {
      const list = parts.map(([r, need]) => `${RESOURCES[r].icon} ${fmt(Math.min(need, s.res[r]))}`).join(", ");
      const rats = ZONES[z].expedition?.rats ?? 0;
      return {
        id: `expedition:${z}`,
        icon: "🗺️",
        text: `Внесите в экспедицию «${ZONES[z].name}»: ${list}`,
        why: s.rats < rats ? `Вклад не пропадёт; для похода ещё нужно ${fmt(rats)} 🐀 (сейчас ${fmt(s.rats)})` : "Вклад не пропадёт, а склад освободится для новых запасов",
        tab: "map",
        target: `z_${z}`,
        action: { kind: "contribute", zone: z },
      };
    }
  }

  // 6. an affordable upgrade
  let bestU: UpgradeId | null = null;
  let bestV = Infinity;
  for (const id of UPGRADE_ORDER) {
    if (s.upgrades[id] || !upgradeVisible(s, id) || !canAfford(s, UPGRADES[id].cost)) continue;
    const v = marketValue(UPGRADES[id].cost);
    if (v < bestV) {
      bestV = v;
      bestU = id;
    }
  }
  if (bestU) {
    const u = UPGRADES[bestU];
    return { id: `upgrade:${bestU}`, icon: u.icon, text: `Можно изобрести «${u.name}»`, why: u.effect, tab: "upgrades", target: `u_${bestU}`, action: { kind: "buyUpgrade", id: bestU } };
  }

  // 7. a full store and an affordable bigger one
  for (const r of RES_IDS) {
    const cap = d.caps[r];
    if (!Number.isFinite(cap) || s.res[r] < 0.999 * cap || !s.revealed[`res_${r}`]) continue;
    const id = cheapestStore(s, r, true);
    if (!id) continue;
    return {
      id: `storage:${r}`,
      icon: BUILDINGS[id].icon,
      text: `Склад ${RESOURCES[r].icon} полон — постройте «${BUILDINGS[id].name}»`,
      why: BUILDINGS[id].desc,
      tab: "buildings",
      target: `b_${id}`,
      action: { kind: "buyBuilding", id },
    };
  }
  return null;
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
  const max = BUILDINGS[id].maxLevel;
  return max === undefined || s.buildings[id] < max;
}

/** Cheapest visible store for r (by market value of its next level), optionally only affordable ones. */
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
  const max = BUILDINGS[id].maxLevel;
  return max !== undefined ? Math.max(1, Math.min(k, max - s.buildings[id])) : k;
}

function cheapestStore(s: GameState, r: ResId, affordableOnly: boolean): BuildingId | null {
  let best: BuildingId | null = null;
  let bestV = Infinity;
  for (const id of storageBuildingsFor(r)) {
    if (!buildingVisible(s, id) || !storeRoom(s, id)) continue;
    const cost = buildingCost(id, s.buildings[id]);
    if (affordableOnly && !canAfford(s, cost)) continue;
    const v = marketValue(cost);
    if (v < bestV) {
      bestV = v;
      best = id;
    }
  }
  return best;
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
 * What raises the cap of r, for «🔒 нужен склад» (PA-3): a visible store (text «🥫 Кладовка в жестянке ур. 3»,
 * target b_<id>), else a store of an open zone that is not unlocked yet («… — откроется, когда упрётесь в лимит 🍞»),
 * else one in a closed zone («… — в новой зоне «Подвалы»», target z_<zone>).
 */
export function storageHintFor(s: GameState, d: Derived, res: ResId, price?: number): { text: string; target?: string; buildingId?: BuildingId } {
  const visible = cheapestStore(s, res, false);
  if (visible) {
    const def = BUILDINGS[visible];
    const level = s.buildings[visible] + storeLevelsFor(s, d, visible, res, price);
    return { text: `${def.icon} ${def.name} ур. ${level}`, target: `b_${visible}`, buildingId: visible };
  }
  const all = storageBuildingsFor(res).filter((id) => storeRoom(s, id));
  const hidden = all.find((id) => !!s.zones[BUILDINGS[id].zone]);
  if (hidden) return { text: `«${BUILDINGS[hidden].name}» — откроется${unlockText(hidden)}`, buildingId: hidden };
  const closed = [...all].sort((a, b) => ZONES[BUILDINGS[a].zone].order - ZONES[BUILDINGS[b].zone].order)[0];
  if (closed) {
    const zone = BUILDINGS[closed].zone;
    return { text: `«${BUILDINGS[closed].name}» — в новой зоне «${ZONES[zone].name}»`, target: `z_${zone}`, buildingId: closed };
  }
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
  for (const src of EVENT_SOURCES[res] ?? []) {
    if (!check(s, src.when) || (src.until && check(s, src.until))) continue;
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
    else fix = "boiler";
  }
  return { stock: s.res.steam, buffer: d.caps.steam, gross, stokers, slots, convEff, consumers, steamEff: s.steamEff, fix };
}

/* ================================================================ suspicion */

/**
 * The suspicion scale explained (SH-3 tooltip): +1%/min × suspicionMult while the player is active (offline it
 * stands still), time to the ratcatcher at 100%, and what lowers it.
 */
export function suspicionInfo(
  s: GameState,
  d: Derived,
): { pct: number; perMin: number; activeOnly: true; etaSec: number | null; reducers: { label: string; amount: string }[] } {
  const pct = Math.max(0, Math.min(100, s.suspicion));
  const perMin = s.zones.cellars ? d.suspicionMult : 0;
  const etaSec = perMin > 0 ? ((100 - pct) / perMin) * 60 : null;
  const reducers: { label: string; amount: string }[] = [
    { label: "спрятаться от Кота", amount: "−10" },
    { label: "победить Кота", amount: "−25" },
    { label: "сломать дудку Крысолова", amount: "до 0" },
  ];
  if (!s.upgrades.quiet_paws) reducers.push({ label: UPGRADES.quiet_paws.name, amount: "×0.7" });
  return { pct, perMin, activeOnly: true, etaSec, reducers };
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
