/**
 * Core type contract for Ratropolis Underground.
 * Engine (src/game/engine), data tables (src/game/data), store and UI all code against this file.
 * See docs/GDD.md for the design and docs/ARCHITECTURE.md for module contracts.
 */

/* ------------------------------------------------------------------ ids */

export const RES_IDS = [
  "crumbs",
  "coins",
  "buttons",
  "wire",
  "gears",
  "cheese",
  "blueprints",
  "coal",
  "steam",
  "brass",
  "rails",
  "trinkets",
] as const;
export type ResId = (typeof RES_IDS)[number];
export type Amounts = Partial<Record<ResId, number>>;
export type ResMap = Record<ResId, number>;

export const T1: readonly ResId[] = ["crumbs", "coins", "buttons", "wire"];

export const ZONE_IDS = ["burrow", "sewers", "cellars", "metro", "terminal"] as const;
export type ZoneId = (typeof ZONE_IDS)[number];

export const JOB_IDS = [
  "idle",
  "forager",
  "pickpocket",
  "scavenger",
  "mechanic",
  "cheese_thief",
  "scholar",
  "coal_miner",
  "stoker",
  "smelter",
  "smith",
  "appraiser",
] as const;
export type JobId = (typeof JOB_IDS)[number];

export const BUILDING_IDS = [
  "nest",
  "trash_chute",
  "pantry",
  "stash",
  "pickpocket_school",
  "sorting_den",
  "drain_sieve",
  "sewer_warehouse",
  "workshop",
  "water_wheel",
  "rat_rail",
  "capsule_tap",
  "cheese_tap",
  "nursery",
  "library",
  "cellar_vault",
  "coal_chute",
  "boiler",
  "brass_foundry",
  "rail_forge",
  "platform_post",
  "steam_press",
  "lost_luggage",
  "clocktower",
  "express_depot",
] as const;
export type BuildingId = (typeof BUILDING_IDS)[number];

export const UPGRADE_IDS = [
  "sharp_teeth",
  "long_whiskers",
  "forager_sacks",
  "communal_nest",
  "nimble_tails",
  "candle_stubs",
  "bustle",
  "greedy_paws",
  "rat_relay",
  "courtship_squeak",
  "hunting_on_the_go",
  "deep_pockets",
  "gear_trains",
  "windup_rat",
  "foreman",
  "pneumatic_timetable",
  "rail_switches",
  "bunk_nests",
  "cheese_diet",
  "printing_press",
  "night_shift",
  "quiet_paws",
  "bell_the_cat",
  "tinkers_guild",
  "stolen_timetable",
  "wire_nets",
  "grappling_hook",
  "pickup_brigade",
  "asbestos_mitts",
  "safety_valves",
  "brass_alloys",
  "steel_rails",
  "tube_orders",
  "clockwork_legion",
  "royal_informant",
  "express_plan",
] as const;
export type UpgradeId = (typeof UPGRADE_IDS)[number];

export const EDICT_IDS = [
  "royal_litter",
  "ancestral_paws",
  "golden_whiskers",
  "rat_memory",
  "eternal_night_shift",
  "old_tunnels",
  "felt_soles",
  "inherited_foreman",
  "timetable_in_head",
  "lucky_tail",
  "express_blueprints",
  "kings_favor",
] as const;
export type EdictId = (typeof EDICT_IDS)[number];

export const ACHIEVEMENT_IDS = [
  "first_crumb",
  "colony_100",
  "colony_1000",
  "click_1000",
  "full_storage",
  "overload",
  "sewers_open",
  "cellars_open",
  "metro_open",
  "terminal_open",
  "first_capsule",
  "first_train",
  "royal_haul",
  "combo_25",
  "hook_perfect",
  "cat_bonked",
  "piper_broken",
  "first_rail",
  "first_migration",
  "coronation",
  "starved",
  "lantern_greed",
  "before_noon",
] as const;
export type AchievementId = (typeof ACHIEVEMENT_IDS)[number];

/** Scene (stage-occupying) events and background events. */
export type SceneEventId = "carriage" | "capsule" | "metro_train" | "royal_express" | "downpour" | "cat" | "ratcatcher";
export type BgEventId = "purse" | "shiny" | "market";
export type EventId = SceneEventId | BgEventId;

/* ---------------------------------------------------------- conditions */

/** Run-level counters (reset on migration). Lifetime copies live in meta.lifetime. */
export interface RunStats {
  clicks: number; // player clicks on the grate (not autoclicks)
  autoClicks: number;
  capsules: number;
  trains: number; // metro trains survived
  expresses: number;
  carriages: number;
  cats: number; // cats seen
  catsBeaten: number;
  ratcatchers: number;
  pipersBroken: number;
  sparksHit: number;
  purses: number;
  downpours: number;
  births: number;
  bestCombo: number;
  lanternMax: number; // most lantern items caught in one train
  hookPerfects: number;
}
export type StatKey = keyof RunStats;

/** One-shot flags (sticky within a run unless noted). */
export type FlagId =
  | "vagrants" // the first 2 rats arrived
  | "hit_crumb_cap" // crumbs first hit the cap
  | "hit_any_cap"
  | "first_coin"
  | "first_button_or_wire"
  | "first_capsule"
  | "first_train"
  | "first_cat"
  | "first_purse"
  | "first_carriage"
  | "first_pocketwatch"
  | "starved"
  | "coronation"
  | "migration_ready";

export type Cond =
  | { always: true }
  | { stat: StatKey; gte: number }
  | { rats: number } // rats >= n
  | { building: BuildingId; gte: number }
  | { job: JobId; gte: number } // workers assigned >= n
  | { zone: ZoneId } // zone unlocked
  | { resEver: ResId; gte: number } // gained this run (all sources) >= n
  | { upgrade: UpgradeId }
  | { edict: EdictId }
  | { flag: FlagId }
  | { all: Cond[] }
  | { any: Cond[] };

/* -------------------------------------------------------------- data */

export type ResTier = 1 | 2 | 3 | 4;

export interface ResourceDef {
  id: ResId;
  name: string;
  icon: string;
  tier: ResTier;
  /** Base storage cap. null = unlimited. Steam uses its own buffer formula. */
  baseCap: number | null;
  /** Which multiplicative cap buildings apply: T1 (sewer_warehouse & cellar_vault), T2 (cellar_vault only), none. */
  capGroup: "T1" | "T2" | "none" | "steam";
  /** Market value for trading / ROI. null = not tradable. */
  market: number | null;
  /** Event value floor per second at zone 1 (V_r = max(EMA, floor * 4^(z-1))). */
  floor: number;
  /** Excluded from global and temporary multipliers (blueprints, trinkets). */
  excludeGlobal: boolean;
  /** Text colour for floating numbers. */
  color: string;
  /** Show in the resource bar once this condition holds (sticky). */
  reveal: Cond;
  desc: string;
}

export interface JobDef {
  id: JobId;
  name: string;
  icon: string;
  produces: Amounts; // per worker per second
  consumes: Amounts; // per worker per second
  /** Worker slots come from a building (per level). null = unlimited. */
  slots: { building: BuildingId; per: number } | null;
  unlock: Cond;
  /** Converters run in this order after plain producers (lower first). */
  convOrder?: number;
  desc: string;
}

export type BuildingEffect =
  | { t: "produce"; res: ResId; amt: number } // per level per second, doubled at milestones
  | { t: "cap"; res: ResId; amt: number } // flat cap per level
  | { t: "capMult"; group: "T1" | "T1G"; mult: number } // multiplicative per level (T1G = T1 + gears + cheese)
  | { t: "housing"; amt: number }
  | { t: "jobPct"; job: JobId; pct: number } // additive +pct% per level for that job
  | { t: "slots"; job: JobId; amt: number }
  | { t: "tierPct"; pct: number } // T1 production +pct% per level (additive)
  | { t: "globalPct"; pct: number } // all production +pct% per level (additive)
  | { t: "birthPct"; pct: number }
  | { t: "steamCap"; amt: number }
  | { t: "steamPress"; use: number; pct: number } // uses steam/s per level -> +pct% * e
  | { t: "steamClock"; use: number; mult: number } // uses steam/s per level -> mult^(level*e)
  | { t: "trainCars"; amt: number }
  | { t: "trainAuto"; amt: number }
  | { t: "capsuleAuto"; amt: number }
  | { t: "capsuleCount"; amt: number }
  | { t: "trainValuePct"; pct: number }
  | { t: "special"; key: string; text: string }; // engine handles by building id

export interface BuildingDef {
  id: BuildingId;
  name: string;
  icon: string;
  zone: ZoneId;
  cost: Amounts; // base cost
  growth: number;
  maxLevel?: number;
  effects: BuildingEffect[];
  unlock: Cond;
  desc: string;
  /** Short flavour line for the chamber tooltip. */
  flavor: string;
}

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  icon: string;
  cost: Amounts;
  /** Human-readable effect line (engine implements by id). */
  effect: string;
  kind?: "speed" | "yield";
  unlock: Cond;
  flavor: string;
}

export interface ZoneDef {
  id: ZoneId;
  order: number; // 1..5
  name: string;
  icon: string;
  /** Expedition cost to open (null for the starting zone). */
  expedition: { cost: Amounts; rats: number } | null;
  /** Expedition card becomes visible at this many rats. */
  mapRevealRats: number;
  housingBonus: number;
  palette: { bg: string; accent: string; glow: string; detail: string };
  sky: string; // description of the "Наверху" strip for this zone
  humanLine: string;
  ratLine: string;
  adds: string; // summary of what it adds
}

export interface EdictDef {
  id: EdictId;
  name: string;
  icon: string;
  cost: number; // crowns
  effect: string;
}

export interface AchievementDef {
  id: AchievementId;
  name: string;
  icon: string;
  desc: string;
  secret?: boolean;
  reward?: string; // cosmetic note
}

export type TrainCarKind = "engine" | "tender" | "third" | "dining" | "mail" | "first" | "baggage" | "royal" | "capsule" | "carriage" | "flotsam";

export interface TrainCarDef {
  kind: TrainCarKind;
  name: string;
  icon: string;
  weight: number; // random pick weight (0 = never random)
  items: number;
  sparks: number;
  /** Drop table: resource -> probability (sums to 1). trinkets give fixed pieces. */
  drops: Partial<Record<ResId, number>>;
  /** Seconds of income per item. */
  S: number;
}

export interface EventLines {
  name: string;
  icon: string;
  human: string; // 👤 Человек видит
  rat: string; // 🐀 Крысы видят
}

/* -------------------------------------------------------------- state */

export type AssignMode = "focus" | "ratios" | "smart";
export type CrewPosition = "wall" | "rails" | "ties";

export interface StunGroup {
  count: number;
  until: number; // run time (s)
  reason: "cat" | "piper" | "crash";
}

export interface Buffs {
  feastUntil: number; // purse "Пир": all production x5
  luckyPawUntil: number; // purse "Шальная лапа": click x15
  soggyUntil: number; // downpour fail: T1 x0.8
  frenzyUntil: number; // bustle "Аврал"
  frenzyCooldownUntil: number;
}

export interface Bustle {
  value: number; // 0..100
  lastClickAt: number; // run time
}

/** A falling / floating item in a catch phase. Values are already computed by the engine (without combo/lantern). */
export interface CatchItem {
  id: number;
  car: number; // index into scene.cars (or 0)
  res: ResId;
  value: number; // amount of res granted if caught (base, before combo/lantern/rating)
  weight: number; // S-weight for the rating share
  spark?: boolean; // a spark: touching it is bad, it has no value
  t: number; // spawn time offset (s) from phase start
}

export interface SceneCar {
  kind: TrainCarKind;
  itemIds: number[];
}

export interface CatchResult {
  /** Items caught by the player's pointer, with combo step at catch time and lantern flag. */
  caught: { id: number; combo: number; lantern: boolean }[];
  /** Items caught by nets or clockwork rats (no combo). */
  netted: number[];
  sparksHit: number;
  hook: "none" | "miss" | "hit" | "perfect";
  maxCombo: number;
}

export type ScenePhase =
  | "warn" // cat / ratcatcher warning with choice
  | "rumble" // train prep
  | "catch" // falling items
  | "piles" // clearing piles after a train/capsule
  | "taps" // tap targets (valves, cat paw, notes)
  | "haul" // result card (waits for dismiss or timeout)
  | "done";

export interface HaulSummary {
  title: string;
  gained: Amounts;
  caughtCount: number;
  totalCount: number;
  share: number; // 0..1
  rating: "none" | "bronze" | "silver" | "gold" | "royal";
  ratingBonus: number;
  combo: number;
  suspicion: number;
  crash: boolean;
  jackpot: boolean;
  notes: string[];
}

export interface Scene {
  id: SceneEventId;
  seq: number; // unique per scene
  phase: ScenePhase;
  phaseStart: number; // run time
  phaseEnds: number; // run time; auto-advance after this (+grace when interactive)
  /** True while a UI scene component is mounted and driving this scene. */
  interactive: boolean;
  /** Items for the current/next catch phase. */
  items: CatchItem[];
  cars: SceneCar[];
  /** Train specifics */
  position: CrewPosition;
  ready: boolean; // "По местам!"
  nets: number[]; // sections 0..2 with a net
  lantern: boolean;
  hookCar: number; // car index for the grappling hook, -1 none
  auto: number; // auto-collect share a (0..0.9)
  multiplier: number; // first-train x3 / first-capsule x2 / 1
  /** Accumulated gains so far (applied immediately to stock, kept for the summary). */
  gained: Amounts;
  /** Value of uncaught items per car (for piles). */
  piles: Amounts[];
  pileFractions: number[];
  /** Taps phase: number of targets and hp per target. */
  taps: { count: number; hp: number; duration: number } | null;
  choice: string | null; // chosen option in warn phase
  stats: { caught: number; total: number; caughtWeight: number; totalWeight: number; combo: number; sparks: number; lanternCaught: number; hook: CatchResult["hook"]; /** Items caught by the player's own paw (0 = nobody at the controls). */ hand: number };
  haul: HaulSummary | null;
  /** Seconds an item stays catchable after it spawns (catch phase). */
  itemLife: number;
  /** Seconds each car takes to pass (trains) — for the UI wheel/joint rhythm. */
  perCar: number;
  /** Pre-closed valves (downpour, water_wheel >= 5). */
  preCleared: number;
  /** Rating share achieved in the catch phase (0..1) and its bonus. */
  share: number;
  ratingBonus: number;
  crash: boolean;
  jackpot: boolean;
}

export interface Purse {
  x: number; // 0..1 position in colony view
  y: number;
  until: number;
}
export interface Shiny {
  id: number;
  x: number;
  y: number;
  res: ResId;
  until: number;
}
export interface MarketDeal {
  give: ResId;
  giveAmt: number;
  get: ResId;
  getAmt: number;
  done: boolean;
}
export interface Market {
  until: number;
  deals: MarketDeal[];
}

export interface Timers {
  carriage: number; // next run-time when it may fire
  capsule: number;
  metro_train: number;
  royal_express: number;
  downpour: number;
  cat: number; // next roll
  purse: number;
  shiny: number;
  market: number;
  ratcatcherAt: number; // run time when ratcatcher arrives (Infinity if none)
  lastSceneEnd: number;
  /** Scripted first cat (7 min after cellars). Infinity when not pending. */
  catForcedAt: number;
  /** Train due time for which the whistle was already used (once per interval). */
  whistleUsedFor: number;
  /** Train due time for which the "К путям!" toast was already shown. */
  toastFor: number;
  nextGeneration: number;
}

export interface Settings {
  sound: boolean;
  volume: number; // 0..1
  reducedMotion: boolean;
  noShake: boolean;
  trainToasts: boolean;
  sciNotation: boolean;
}

export interface Meta {
  crowns: number; // spendable
  crownsEver: number; // lifetime total earned (drives bonus)
  edicts: Partial<Record<EdictId, boolean>>;
  achievements: Partial<Record<AchievementId, number>>; // run time-stamp (lifetime seconds) when earned
  migrations: number;
  district: number; // index into DISTRICTS
  trophies: string[];
  bestRating: HaulSummary["rating"];
  lifetime: RunStats & { playSeconds: number; coinsEver: number };
  seenEvents: EventId[]; // bestiary
  /** Rat Express stages kept across migrations (express_blueprints edict). */
  expressKept: number;
}

export interface GameState {
  schemaVersion: number;
  rng: number; // mulberry32 state
  /** Seconds since the run started (game time, advances with ticks incl. offline sim). */
  time: number;
  lastSaved: number; // epoch ms
  res: ResMap;
  /** Gained this run per resource (all sources, before spending). */
  resEver: ResMap;
  /** EMA30 of passive gross production per second (for event values). */
  ema: ResMap;
  /** Last measured net change per second (for UI). */
  rates: ResMap;
  /** Last measured gross passive production per second (for UI). */
  gross: ResMap;
  rats: number;
  birthProgress: number;
  jobs: Record<JobId, number>; // idle is derived: rats - sum(others); stored value ignored
  focus: JobId;
  ratios: { forager: number; pickpocket: number; scavenger: number };
  assignMode: AssignMode;
  stunned: StunGroup[];
  hungry: boolean;
  satiety: boolean; // cheese diet toggle
  /** Converter efficiency EMA (0..1) per job for UI. */
  convEff: Partial<Record<JobId, number>>;
  steamEff: number; // e for steam consumers (press, clocktower), last tick
  buildings: Record<BuildingId, number>;
  upgrades: Partial<Record<UpgradeId, boolean>>;
  zones: Partial<Record<ZoneId, boolean>>;
  projects: Partial<Record<ZoneId, Amounts>>; // expedition contributions
  digging: { zone: ZoneId; until: number } | null;
  express: { stage: number; progress: Amounts; wagons: number };
  autoContribute: boolean;
  foreman: { nests: boolean; storage: boolean };
  suspicion: number;
  bustle: Bustle;
  buffs: Buffs;
  stats: RunStats;
  flags: Partial<Record<FlagId, boolean>>;
  /** Sticky UI reveals (tabs, widgets, resource bar entries). */
  revealed: Record<string, boolean>;
  /** Unlocked-and-seen ids (for "new!" badges). */
  seen: Record<string, boolean>;
  timers: Timers;
  scene: Scene | null;
  sceneSeq: number;
  purse: Purse | null;
  shinies: Shiny[];
  market: Market | null;
  trainPrefs: { position: CrewPosition; lastNets: number[] };
  haulLog: HaulSummary[]; // last 10
  /** Click-rate limiting: timestamps (run time) of counted clicks in the last second. */
  clickWindow: number[];
  autoclickAcc: number;
  eRun: number; // coins gained this run (prestige basis)
  coronatedThisRun: boolean;
  news: { t: number; text: string }[]; // newest last, max 30
  zoneOpenedAt: Partial<Record<ZoneId, number>>;
  generation: number;
  meta: Meta;
  settings: Settings;
}

/* -------------------------------------------------------- engine I/O */

/** Transient feedback events emitted by the engine for the UI (sounds, particles). Not persisted. */
export type Fx =
  | { k: "click"; amount: number; res: ResId; full: boolean; auto: boolean; x?: number; y?: number }
  | { k: "drop"; res: ResId; amount: number; big?: boolean; x?: number; y?: number; /** x,y are 0..1 fractions of the colony view, not client px. */ frac?: boolean }
  | { k: "find"; res: ResId; amount: number }
  | { k: "buy"; building: BuildingId; level: number }
  | { k: "milestone"; building: BuildingId; level: number }
  | { k: "tier"; building: BuildingId; level: number }
  | { k: "upgrade"; upgrade: UpgradeId }
  | { k: "birth"; job: JobId }
  | { k: "vagrants" }
  | { k: "full"; res: ResId }
  | { k: "overload"; res: ResId }
  | { k: "medal"; id: AchievementId }
  | { k: "zoneDig"; zone: ZoneId }
  | { k: "zoneOpen"; zone: ZoneId }
  | { k: "expressStage"; stage: number }
  | { k: "coronation" }
  | { k: "sceneStart"; id: SceneEventId }
  | { k: "scenePhase"; id: SceneEventId; phase: ScenePhase }
  | { k: "sceneEnd"; id: SceneEventId; haul: HaulSummary | null }
  | { k: "toast"; text: string; icon?: string; tone?: "info" | "good" | "bad" | "gold" }
  | { k: "trainSoon"; id: SceneEventId; inSec: number }
  | { k: "purse"; outcome: string }
  | { k: "frenzy" }
  | { k: "hunger"; on: boolean }
  | { k: "news"; text: string };

export interface TickInput {
  /** Tab visible and the player interacted within the last 60 s (gates harmful events, suspicion growth). */
  active: boolean;
  /** Offline simulation: production x eta, no events, no suspicion. */
  offline?: { eta: number };
}

export interface EngineCtx {
  fx: Fx[];
}

export type BuyMode = 1 | 10 | "max";

/** Player input into the running scene (dispatched by scene UI components). */
export type SceneAction =
  | { a: "attach" }
  | { a: "detach" }
  | { a: "position"; pos: CrewPosition }
  | { a: "net"; section: number } // toggle a net on platform section 0..2 (pays wire)
  | { a: "netsRepeat" } // re-place last train's nets
  | { a: "ready" } // "По местам!": +0.15 auto, starts the pass immediately
  | { a: "skip" } // resolve the whole scene by auto-collect
  | { a: "catch"; result: CatchResult }
  | { a: "piles"; fractions: number[] }
  | { a: "choice"; option: "hide" | "fight" | "pay" }
  | { a: "taps"; cleared: number } // valves closed / paw hits / notes popped
  | { a: "dismiss" }; // close the haul card
