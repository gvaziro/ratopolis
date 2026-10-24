import { EVENT_TIMING } from "../data/events";
import { HEADLINES } from "../data/headlines";
import { FOREMAN_UPGRADES, ratMemoryUpgrades } from "../data/upgrades";
import { WEEKDAYS_FULL, districtLoc, districtTrait } from "../data/zones";
import { RANKED, byRank, edictRank } from "./ranks";
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

/** 2 = v2 (meta ranks/seals/history, settings hints/ambience/textScale, scouting, commissions). */
export const SCHEMA_VERSION = 2;

/** Express stages a run may start with (express_blueprints, v2 EN-3: 9 → 5): stages 6–10 and the coronation replay every run. */
export const KEPT_STAGES_MAX = 5;

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
    cleanCars: 0,
    goldStreak: 0,
    goldHauls: 0,
    downpoursWon: 0,
    frenzies: 0,
    royalExpresses: 0,
  };
}

export function defaultSettings(): Settings {
  return {
    sound: true,
    volume: 0.4,
    reducedMotion: false,
    noShake: false,
    trainToasts: true,
    sciNotation: false,
    hints: true,
    ambience: 0.5,
    textScale: 1,
    reducedMotionFromOS: false,
  };
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
    lifetime: { ...zeroStats(), playSeconds: 0, coinsEver: 0, wagons: 0 },
    seenEvents: [],
    expressKept: 0,
    edictRank: {},
    seal: null,
    sealsOwned: [],
    coronations: 0,
    carLog: {},
    cheeseCars: 0,
    variantLog: {},
    seenLines: {},
    history: [],
    records: {},
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
    filler: 150,
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
    scouted: {},
    newsRecent: [],
    commissions: null,
    charters: 0,
    recentLines: {},
    coronatedAt: -1,
    runBestRating: "none",
  };

  const e = meta.edicts;
  applyRoyalLitter(s);
  if (e.rat_memory) for (const u of ratMemoryUpgrades(edictRank(s, "rat_memory"))) s.upgrades[u] = true;
  if (e.inherited_foreman) for (const u of FOREMAN_UPGRADES) s.upgrades[u] = true;
  if (e.old_tunnels) {
    s.zones.sewers = true;
    s.zoneOpenedAt.sewers = 0;
    s.timers.capsule = 300;
    s.timers.downpour = 480; // same as onZoneOpen("sewers"): the downpour would otherwise never be scheduled
    // rank II: the Cellars too (the same timers as onZoneOpen("cellars"); the market at the middle of the district's
    // interval instead of its random roll: Боро-маркет's stall comes sooner)
    if (edictRank(s, "old_tunnels") >= 2) {
      const mi = districtTrait(meta.district).mods.marketInterval ?? EVENT_TIMING.marketInterval;
      s.zones.cellars = true;
      s.zoneOpenedAt.cellars = 0;
      s.timers.catForcedAt = 420;
      s.timers.cat = 60;
      s.timers.market = (mi[0] + mi[1]) / 2;
    }
  }
  if (e.express_blueprints) s.express.stage = Math.min(KEPT_STAGES_MAX, meta.expressKept);
  const start = meta.migrations > 0 ? HEADLINES.restart[0].replace("{loc}", districtLoc(meta.district)).replace("{weekday}", WEEKDAYS_FULL[meta.migrations % 7]) : HEADLINES.start[0];
  s.news.push({ t: 0, text: start });
  return s;
}

/** Royal litter (EN-9 ranks): the run starts with 10/25/60 rats, 5/10/20 nests and 50/500/5000 🍞. Never takes anything away. */
export function applyRoyalLitter(s: GameState): void {
  const r = edictRank(s, "royal_litter");
  if (r <= 0) return;
  const rats = byRank(s, "royal_litter", RANKED.royal_litter.rats, 0);
  const crumbs = byRank(s, "royal_litter", RANKED.royal_litter.crumbs, 0);
  if (s.rats < rats) {
    s.jobs.forager += rats - s.rats;
    s.rats = rats;
  }
  s.buildings.nest = Math.max(s.buildings.nest, byRank(s, "royal_litter", RANKED.royal_litter.nests, 0));
  s.flags.vagrants = true;
  if (s.res.crumbs < crumbs) {
    s.resEver.crumbs += crumbs - s.res.crumbs;
    s.res.crumbs = crumbs;
  }
}

export function createInitialState(seed: number, now: number): GameState {
  return newRun(defaultMeta(), defaultSettings(), seed, now);
}
