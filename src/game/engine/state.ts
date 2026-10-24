import { RAT_MEMORY_UPGRADES, FOREMAN_UPGRADES } from "../data/upgrades";
import {
  BUILDING_IDS,
  JOB_IDS,
  RES_IDS,
  type BuildingId,
  type GameState,
  type JobId,
  type Meta,
  type ResMap,
  type RunStats,
  type Settings,
  type Timers,
} from "../types";

export const SCHEMA_VERSION = 1;

export function zeroRes(): ResMap {
  return Object.fromEntries(RES_IDS.map((r) => [r, 0])) as ResMap;
}

export function zeroJobs(): Record<JobId, number> {
  return Object.fromEntries(JOB_IDS.map((j) => [j, 0])) as Record<JobId, number>;
}

export function zeroBuildings(): Record<BuildingId, number> {
  return Object.fromEntries(BUILDING_IDS.map((b) => [b, 0])) as Record<BuildingId, number>;
}

export function zeroStats(): RunStats {
  return {
    clicks: 0,
    autoClicks: 0,
    capsules: 0,
    trains: 0,
    expresses: 0,
    carriages: 0,
    cats: 0,
    catsBeaten: 0,
    ratcatchers: 0,
    pipersBroken: 0,
    sparksHit: 0,
    purses: 0,
    downpours: 0,
    births: 0,
    bestCombo: 0,
    lanternMax: 0,
    hookPerfects: 0,
  };
}

export function defaultSettings(): Settings {
  return { sound: true, volume: 0.4, reducedMotion: false, noShake: false, trainToasts: true, sciNotation: false };
}

export function defaultMeta(): Meta {
  return {
    crowns: 0,
    crownsEver: 0,
    edicts: {},
    achievements: {},
    migrations: 0,
    district: 0,
    trophies: [],
    bestRating: "none",
    lifetime: { ...zeroStats(), playSeconds: 0, coinsEver: 0 },
    seenEvents: [],
    expressKept: 0,
  };
}

function freshTimers(): Timers {
  return {
    carriage: 210,
    capsule: Infinity,
    metro_train: Infinity,
    royal_express: Infinity,
    downpour: Infinity,
    cat: Infinity,
    purse: 480,
    shiny: 40,
    market: Infinity,
    ratcatcherAt: Infinity,
    lastSceneEnd: -999,
    catForcedAt: Infinity,
    whistleUsedFor: -1,
    toastFor: -1,
    nextGeneration: 180,
  };
}

/** A brand-new run. `meta` and `settings` carry over between migrations. */
export function newRun(meta: Meta, settings: Settings, seed: number, now: number): GameState {
  const s: GameState = {
    schemaVersion: SCHEMA_VERSION,
    rng: seed >>> 0,
    time: 0,
    lastSaved: now,
    res: zeroRes(),
    resEver: zeroRes(),
    ema: zeroRes(),
    rates: zeroRes(),
    gross: zeroRes(),
    rats: 0,
    birthProgress: 0,
    jobs: zeroJobs(),
    focus: "forager",
    ratios: { forager: 40, pickpocket: 35, scavenger: 25 },
    assignMode: "focus",
    stunned: [],
    hungry: false,
    satiety: false,
    convEff: {},
    steamEff: 1,
    buildings: zeroBuildings(),
    upgrades: {},
    zones: { burrow: true },
    projects: {},
    digging: null,
    express: { stage: 0, progress: {}, wagons: 0 },
    autoContribute: false,
    foreman: { nests: true, storage: true },
    suspicion: 0,
    bustle: { value: 0, lastClickAt: -10 },
    buffs: { feastUntil: 0, luckyPawUntil: 0, soggyUntil: 0, frenzyUntil: 0, frenzyCooldownUntil: 0 },
    stats: zeroStats(),
    flags: {},
    revealed: {},
    seen: {},
    timers: freshTimers(),
    scene: null,
    sceneSeq: 0,
    purse: null,
    shinies: [],
    market: null,
    trainPrefs: { position: "rails", lastNets: [] },
    haulLog: [],
    clickWindow: [],
    autoclickAcc: 0,
    eRun: 0,
    coronatedThisRun: false,
    news: [],
    zoneOpenedAt: { burrow: 0 },
    generation: 1,
    meta,
    settings,
  };

  const e = meta.edicts;
  if (e.royal_litter) {
    s.rats = 10;
    s.jobs.forager = 10;
    s.buildings.nest = 5;
    s.flags.vagrants = true;
    s.res.crumbs = 50;
    s.resEver.crumbs = 50;
  }
  if (e.rat_memory) for (const u of RAT_MEMORY_UPGRADES) s.upgrades[u] = true;
  if (e.inherited_foreman) for (const u of FOREMAN_UPGRADES) s.upgrades[u] = true;
  if (e.old_tunnels) {
    s.zones.sewers = true;
    s.zoneOpenedAt.sewers = 0;
    s.timers.capsule = 300;
    s.timers.downpour = 480; // same as onZoneOpen("sewers"): the downpour would otherwise never be scheduled
  }
  if (e.express_blueprints) s.express.stage = meta.expressKept;
  s.news.push({ t: 0, text: meta.migrations > 0 ? "Колония обустраивается на новом месте. Наверху снова 05:00" : "Вожак выбрался к решётке стока. Колония из одной крысы объявлена открытой" });
  return s;
}

export function createInitialState(seed: number, now: number): GameState {
  return newRun(defaultMeta(), defaultSettings(), seed, now);
}
