import { BUILDINGS, MILESTONES, MILESTONE_JOB_BOOST } from "../data/buildings";
import { JOBS } from "../data/jobs";
import { RESOURCES } from "../data/resources";
import { TINKERS_MULT } from "../data/upgrades";
import { ZONES, ZONE_ORDER, districtTrait } from "../data/zones";
import { RANKED, byRank, sealOn } from "./ranks";
import { ACHIEVEMENT_IDS, BUILDING_IDS, JOB_IDS, RES_IDS, type Amounts, type BuildingId, type GameState, type JobId, type ResId, type ResMap, type ZoneId, type CommissionId } from "../types";

/**
 * Everything that is a pure function of the current state (levels, upgrades, edicts, buffs).
 * Computed once per tick and memoized for the UI by state identity.
 */
export interface Derived {
  /** Highest open zone order, 1..5. */
  z: number;
  caps: ResMap; // Infinity = unlimited
  housing: number;
  slots: Record<JobId, number>; // Infinity = unlimited
  jobSpeed: Record<JobId, number>; // multiplies input and output
  jobYield: Record<JobId, number>; // multiplies output only
  tierMult: number; // T1 production multiplier
  global: number; // GM (without hunger)
  globalParts: { label: string; mult: number }[];
  temp: number; // EM: feast, frenzy
  medals: number;
  railMult: number; // Rsw * Rst
  birthRate: number; // births/s when allowed
  click: number; // crumbs per click (without hunting %)
  clickHuntPct: number;
  dropMult: number;
  autoclick: { cps: number; power: number };
  trainAutoBase: number; // before "По местам!" and crew position
  capsuleAuto: number;
  capsuleCount: number;
  trainExtraCars: number;
  trainValueMult: number;
  capsuleValueMult: number;
  netSlots: number;
  rumbleMetro: number;
  intervals: { capsule: number; metro: number; express: number };
  steamNeed: number; // steam/s wanted by press + clocktower
  /** Production multipliers of the district trait per resource (EN-9), applied by resMult. */
  districtRes: Partial<Record<ResId, number>>;
  /** Purse frequency multiplier (golden_whiskers ranks × district) and purse effect multiplier. */
  purseFreq: number;
  purseEffect: number;
  /** Value multiplier of train/capsule items (lucky_tail ranks); trinket pieces too. */
  lucky: number;
  /** Suspicion that summons the ratcatcher (district Мэйфэр: 80). */
  ratcatcherAt: number;
  /** Cat check chance multiplier (district quirk). */
  catMult: number;
  /** Market interval range (district Боро-маркет: [240, 300]). */
  marketInterval: readonly [number, number];
  /** Печать Тишины: no suspicion, no cat, no ratcatcher. */
  silence: boolean;
  /** The accepted royal commission (EN-12): its event comes more often while it runs. */
  commission: CommissionId | null;
  suspicionMult: number;
  offline: { eta: number; capSec: number };
  frenzy: boolean;
  feast: boolean;
  luckyPaw: boolean;
  soggy: boolean;
  satietyActive: boolean;
  /** Per-building output per second including milestones (before tier/global multipliers). */
  buildingOut: Record<BuildingId, Amounts>;
  /** Crumbs eaten per second. */
  food: number;
  cheeseFood: number;
}

export function milestoneMult(level: number): number {
  return Math.pow(2, milestonesReached(level));
}

/** How many ×2 milestones a level has passed (log2 of milestoneMult). */
export function milestonesReached(level: number): number {
  let n = 0;
  for (const t of MILESTONES) if (level >= t) n++;
  return n;
}

export function nextMilestone(level: number): number | null {
  for (const t of MILESTONES) if (level < t) return t;
  return null;
}

export function highestZone(s: GameState): number {
  let z = 1;
  for (const id of ZONE_ORDER) if (s.zones[id]) z = Math.max(z, ZONES[id].order);
  return z;
}

/** Id of the highest open zone. */
export function highestZoneId(s: GameState): ZoneId {
  let best: ZoneId = "burrow";
  for (const id of ZONE_ORDER) if (s.zones[id] && ZONES[id].order >= ZONES[best].order) best = id;
  return best;
}

export function medalCount(s: GameState): number {
  let n = 0;
  for (const id of ACHIEVEMENT_IDS) if (s.meta.achievements[id] !== undefined) n++;
  return n;
}

export function derive(s: GameState): Derived {
  const b = s.buildings;
  const u = s.upgrades;
  const e = s.meta.edicts;
  const t = s.time;
  const dm = districtTrait(s.meta.district).mods;
  const railway = sealOn(s, "railway");
  const silence = sealOn(s, "silence");

  const railMult = (u.rail_switches ? 1.5 : 1) * (u.steel_rails ? 1.25 : 1);

  // ---- caps
  const capAdd: Partial<Record<ResId, number>> = {};
  let t1Mult = 1;
  let t1gMult = 1;
  let steamCapAdd = 0;
  const slots = Object.fromEntries(JOB_IDS.map((j) => [j, JOBS[j].slots ? 0 : Infinity])) as Record<JobId, number>;
  const jobPct = Object.fromEntries(JOB_IDS.map((j) => [j, 0])) as Record<JobId, number>;
  // EN-4: every ×2 milestone of a producing building also gives its linked job ×MILESTONE_JOB_BOOST (once per building)
  const jobMs = Object.fromEntries(JOB_IDS.map((j) => [j, 1])) as Record<JobId, number>;
  let housing = 3;
  let tierPct = 0;
  let globalPct = 0;
  let birthPct = 0;
  let pressPct = 0;
  let steamNeed = 0;
  let clockMult = 1;
  let clockLevels = 0;
  let clockUse = 0;
  let trainCars = 0;
  let trainAuto = 0;
  let capsuleAuto = 0;
  let capsuleCount = 0;
  let trainValuePct = 0;
  const buildingOut = {} as Record<BuildingId, Amounts>;

  for (const id of BUILDING_IDS) {
    const L = b[id];
    const def = BUILDINGS[id];
    const out: Amounts = {};
    buildingOut[id] = out;
    if (L <= 0) continue;
    const isRail = id === "rat_rail";
    const rm = isRail ? railMult : 1;
    const msBoost = Math.pow(MILESTONE_JOB_BOOST, milestonesReached(L));
    const producer = msBoost !== 1 && def.effects.some((x) => x.t === "produce");
    let boosted: JobId | null = null; // once per building, even if it names the job twice
    for (const ef of def.effects) {
      switch (ef.t) {
        case "produce":
          out[ef.res] = (out[ef.res] ?? 0) + ef.amt * L * milestoneMult(L);
          break;
        case "cap":
          capAdd[ef.res] = (capAdd[ef.res] ?? 0) + ef.amt * L;
          break;
        case "capMult":
          if (ef.group === "T1") t1Mult *= Math.pow(ef.mult, L);
          else t1gMult *= Math.pow(ef.mult, L);
          break;
        case "housing":
          if (id === "nest") housing += L * (u.communal_nest ? 3 : ef.amt) * (u.bunk_nests ? 2 : 1);
          else housing += L * ef.amt;
          break;
        case "jobPct":
          jobPct[ef.job] += ef.pct * L;
          if (msBoost !== 1 && boosted !== ef.job) {
            boosted = ef.job;
            jobMs[ef.job] *= msBoost;
          }
          break;
        case "slots":
          slots[ef.job] += ef.amt * L;
          if (producer && boosted !== ef.job) {
            boosted = ef.job;
            jobMs[ef.job] *= msBoost;
          }
          break;
        case "tierPct":
          tierPct += ef.pct * L;
          break;
        case "globalPct":
          globalPct += ef.pct * L * rm;
          break;
        case "birthPct":
          birthPct += ef.pct * L;
          break;
        case "steamCap":
          steamCapAdd += ef.amt * L;
          break;
        case "steamPress":
          pressPct += ef.pct * L;
          steamNeed += ef.use * L;
          break;
        case "steamClock":
          clockMult = ef.mult;
          clockLevels += L;
          clockUse += ef.use * L;
          steamNeed += ef.use * L;
          break;
        case "trainCars":
          trainCars += ef.amt * L;
          break;
        case "trainAuto":
          trainAuto += ef.amt * L * rm;
          break;
        case "capsuleAuto":
          capsuleAuto += ef.amt * L * rm;
          break;
        case "capsuleCount":
          capsuleCount += ef.amt * L;
          break;
        case "trainValuePct":
          trainValuePct += ef.pct * L;
          break;
        case "special":
          break;
      }
    }
  }
  void clockUse;

  for (const id of ZONE_ORDER) if (s.zones[id]) housing += ZONES[id].housingBonus;

  const caps = {} as ResMap;
  for (const r of RES_IDS) {
    const def = RESOURCES[r];
    if (def.capGroup === "steam") {
      caps[r] = (50 + steamCapAdd) * (u.safety_valves ? 2 : 1) * (dm.steamBufferMult ?? 1);
      continue;
    }
    if (def.baseCap === null) {
      caps[r] = Infinity;
      continue;
    }
    let c = def.baseCap + (capAdd[r] ?? 0);
    if (def.capGroup === "T1") c *= t1Mult * t1gMult;
    else if (def.capGroup === "T2") c *= t1gMult;
    if (u.deep_pockets) c *= 2;
    caps[r] = c;
  }

  // ---- jobs
  const jobSpeed = Object.fromEntries(JOB_IDS.map((j) => [j, 1])) as Record<JobId, number>;
  const jobYield = Object.fromEntries(JOB_IDS.map((j) => [j, (1 + jobPct[j] / 100) * jobMs[j]])) as Record<JobId, number>;
  if (u.forager_sacks) jobYield.forager *= 2;
  if (u.nimble_tails) jobYield.pickpocket *= 2;
  if (u.candle_stubs) jobYield.scavenger *= 2;
  if (u.gear_trains) jobSpeed.mechanic *= 2;
  if (u.printing_press) jobYield.scholar *= 2;
  if (u.safety_valves) jobYield.stoker *= 1.5;
  if (u.brass_alloys) jobYield.smelter *= 2;
  if (u.tube_orders) for (const j of JOB_IDS) jobYield[j] *= 1.25;

  // ---- multipliers
  const soggy = s.buffs.soggyUntil > t;
  const tierMult = (1 + tierPct / 100) * (u.tinkers_guild ? TINKERS_MULT : 1) * (soggy ? 0.8 : 1);

  const medals = medalCount(s);
  const crownC = e.kings_favor ? 0.03 : 0.02;
  const satietyActive = !!(s.satiety && u.cheese_diet && s.res.cheese > 0);
  const steamEff = steamNeed > 0 ? s.steamEff : 0;
  const parts: { label: string; mult: number }[] = [];
  const push = (label: string, mult: number) => {
    if (Math.abs(mult - 1) > 1e-9) parts.push({ label, mult });
  };
  push("Узкоколейка", 1 + globalPct / 100);
  push("Паровой пресс", 1 + (pressPct / 100) * steamEff);
  push("Вокзальные часы", Math.pow(clockMult, clockLevels * steamEff));
  push("Крысиный экспресс", 1 + 0.2 * s.express.stage + 0.1 * s.express.wagons);
  push("Венцы", 1 + crownC * s.meta.crownsEver);
  push("Медали", 1 + 0.01 * medals);
  push("Сытость", satietyActive ? 1.25 : 1);
  push("Печать Династии", sealOn(s, "dynasty") ? 1 + 0.1 * s.meta.migrations : 1);
  const global = parts.reduce((a, p) => a * p.mult, 1);

  const frenzy = s.buffs.frenzyUntil > t;
  const feast = s.buffs.feastUntil > t;
  const luckyPaw = s.buffs.luckyPawUntil > t;
  const temp = (feast ? 5 : 1) * (frenzy ? 1.5 : 1);

  // ---- population
  const birthRate = (0.08 + 0.005 * s.rats) * (1 + birthPct / 100) * (u.courtship_squeak ? 1.5 : 1);

  // ---- click
  const click = (1 + (u.sharp_teeth ? 1 : 0)) * (u.greedy_paws ? 2 : 1) * byRank(s, "ancestral_paws", RANKED.ancestral_paws, 1) * (silence ? 2 : 1) * (frenzy ? 3 : 1) * (luckyPaw ? 15 : 1);
  const autoclick = u.clockwork_legion ? { cps: 5, power: 0.5 } : u.windup_rat ? { cps: 1, power: 0.5 } : { cps: 0, power: 0.5 };

  // ---- events
  const post = b.platform_post;
  const trainAutoBase = 0.35 + trainAuto + (u.pickup_brigade ? 0.25 : 0) + (e.timetable_in_head ? 0.1 : 0) + (u.steel_rails ? 0.1 : 0) + (railway ? 0.15 : 0);
  const capsuleAutoTotal = Math.min(0.9, 0.3 + capsuleAuto + (u.steel_rails ? 0.1 : 0));
  const lucky = byRank(s, "lucky_tail", RANKED.lucky_tail, 1);
  const depot = b.express_depot;

  return {
    z: highestZone(s),
    caps,
    housing,
    slots,
    jobSpeed,
    jobYield,
    tierMult,
    global,
    globalParts: parts,
    temp,
    medals,
    railMult,
    birthRate,
    click,
    clickHuntPct: u.hunting_on_the_go ? 0.03 : 0,
    dropMult: u.long_whiskers ? 1.5 : 1,
    autoclick,
    trainAutoBase,
    capsuleAuto: capsuleAutoTotal,
    capsuleCount: 3 + capsuleCount,
    trainExtraCars: trainCars + (u.stolen_timetable ? 1 : 0) + byRank(s, "timetable_in_head", RANKED.timetable_in_head, 0) + (railway ? 2 : 0) + (dm.metroCarsDelta ?? 0),
    trainValueMult: (1 + trainValuePct / 100) * lucky,
    capsuleValueMult: (u.pneumatic_timetable ? 1.5 : 1) * lucky,
    netSlots: u.wire_nets ? 1 + (post >= 3 ? 1 : 0) + (post >= 5 ? 1 : 0) : 0,
    rumbleMetro: 8 + (u.stolen_timetable ? 4 : 0) + (e.timetable_in_head ? 5 : 0),
    intervals: {
      capsule: (dm.capsuleInterval ?? 150) * (u.pneumatic_timetable ? 0.8 : 1),
      metro: 240,
      express: 720 * Math.pow(0.85, Math.max(0, depot - 1)) * (u.royal_informant ? 0.75 : 1) * (railway ? 0.5 : 1) * (dm.expressIntervalMult ?? 1) * (s.commissions?.active?.id === "royal_mail" ? 0.5 : 1),
    },
    steamNeed,
    districtRes: dm.res ?? {},
    purseFreq: byRank(s, "golden_whiskers", RANKED.golden_whiskers.freq, 1) * (dm.purseFreqMult ?? 1),
    purseEffect: byRank(s, "golden_whiskers", RANKED.golden_whiskers.effect, 1),
    lucky,
    ratcatcherAt: dm.ratcatcherThreshold ?? 100,
    catMult: dm.catCheckMult ?? 1,
    marketInterval: dm.marketInterval ?? [480, 600],
    silence,
    commission: s.commissions?.active?.id ?? null,
    suspicionMult: silence ? 0 : (u.quiet_paws ? 0.7 : 1) * byRank(s, "felt_soles", RANKED.felt_soles, 1) * (dm.suspicionMult ?? 1),
    offline: {
      eta: 0.5 + (u.night_shift ? 0.25 : 0) + byRank(s, "eternal_night_shift", RANKED.eternal_night_shift, 0),
      capSec: 3600 * (2 + (u.night_shift ? 2 : 0) + (e.eternal_night_shift ? 4 : 0)),
    },
    frenzy,
    feast,
    luckyPaw,
    soggy,
    satietyActive,
    buildingOut,
    food: 0.04 * s.rats,
    cheeseFood: satietyActive ? 0.005 * s.rats : 0,
  };
}

/** Production multiplier applied to resource r (tier, global, temp, hunger). */
export function resMult(s: GameState, d: Derived, r: ResId, withTemp = true): number {
  const def = RESOURCES[r];
  let m = 1;
  if (def.tier === 1) m *= d.tierMult;
  const dr = d.districtRes[r];
  if (dr !== undefined) m *= dr;
  if (!def.excludeGlobal) {
    m *= d.global;
    if (withTemp) m *= d.temp;
  }
  if (s.hungry && r !== "crumbs") m *= 0.5;
  return m;
}

/** Event value base: V_r = max(EMA_r, floor_r * 4^(z-1)). */
export function eventValue(s: GameState, d: Derived, r: ResId): number {
  return Math.max(s.ema[r], RESOURCES[r].floor * Math.pow(4, d.z - 1));
}

/** Number of rats currently assigned to non-idle jobs. */
export function assignedRats(s: GameState): number {
  let n = 0;
  for (const j of JOB_IDS) if (j !== "idle") n += s.jobs[j];
  return n;
}

export function idleRats(s: GameState): number {
  return Math.max(0, s.rats - assignedRats(s));
}

export function stunnedRats(s: GameState): number {
  let n = 0;
  for (const g of s.stunned) n += g.count;
  return Math.min(n, s.rats);
}

const cache = new WeakMap<GameState, Derived>();
/** Memoized derive for UI selectors. */
export function derived(s: GameState): Derived {
  let d = cache.get(s);
  if (!d) {
    d = derive(s);
    cache.set(s, d);
  }
  return d;
}
