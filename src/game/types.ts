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
  // v2 (EN-11): meta medals
  "nomads",
  "all_london",
  "treasury",
  "thousand_crowns",
  "seal_and_tail",
  "full_code",
  "long_train",
  "tail_horizon",
  "again_throne",
  "naturalist",
  "purser",
  "honored_rail",
  "genealogy",
  // v2 (EN-11): secret
  "hungry_king",
  "miser",
  "forever_tuesday",
  // v2 (EN-11): event feats
  "clean_car_10",
  "no_spark",
  "gold_streak",
  "ties_survivor",
  "dry_paws",
  "cat_nightmare",
  "royal_retinue",
  "full_consist",
  // v3 (ENG-10): «Кунсткамера Короля»
  "first_curio",
  "curio_full",
] as const;
export type AchievementId = (typeof ACHIEVEMENT_IDS)[number];

/** Scene (stage-occupying) events and background events. */
export type SceneEventId = "carriage" | "capsule" | "metro_train" | "royal_express" | "downpour" | "cat" | "ratcatcher";
export type BgEventId = "purse" | "shiny" | "market";
export type EventId = SceneEventId | BgEventId;

/** Side panel tabs (UI state; re-exported from store.ts for the v1 imports). */
export type TabId = "buildings" | "jobs" | "upgrades" | "map" | "schedule" | "migration" | "medals" | "settings";

/** Great Seals (EN-9): one active at a time, bought for 120 👑 each. */
export const SEAL_IDS = ["railway", "silence", "dynasty"] as const;
export type SealId = (typeof SEAL_IDS)[number];

/** Metro train variants (EN-6). "normal" is the plain train. */
export const TRAIN_VARIANT_IDS = ["normal", "rush_hour", "edinburgh_mail", "freight", "flooded", "circus", "fog"] as const;
export type TrainVariantId = (typeof TRAIN_VARIANT_IDS)[number];

/** Royal commissions after the coronation (EN-12). */
export const COMMISSION_IDS = [
  "three_gold",
  "whiskers_twice",
  "pipe_splinters",
  "purse_season",
  "frenzy5",
  "dry_paws2",
  "royal_mail",
  "lamplighter",
  "bullseye",
  "replenish",
  "wagon",
  "quick_hand",
  // v3 (ENG-3): offered instead of «replenish» (which keeps its id and definition for old saves)
  "clean_three",
] as const;
export type CommissionId = (typeof COMMISSION_IDS)[number];

/** London districts (v3 ENG-11, data/districts.ts). The first six are the v1/v2 migration sequence. */
export const DISTRICT_IDS = [
  "whitechapel",
  "southwark",
  "lambeth",
  "bloomsbury",
  "mayfair",
  "westminster",
  "city",
  "covent_garden",
  "kings_cross",
  "docklands",
  "chelsea",
  "greenwich",
] as const;
export type DistrictId = (typeof DISTRICT_IDS)[number];

/** «Кунсткамера Короля» (v3 ENG-10, data/curios.ts): 24 curios in 6 sets of 4, grouped by owner. */
export const CURIO_IDS = [
  // Леди Пемберли
  "lace_glove",
  "lady_fan",
  "murzifer_bell",
  "teapot_lid",
  // Мистер Уиггинс
  "monocle",
  "onion_watch",
  "walking_cane",
  "card_case",
  // Лорд Эшби
  "crest_snuffbox",
  "sapphire_cufflink",
  "signet_ring",
  "first_class_ticket",
  // Полковник Хэтчетт
  "meerschaum_pipe",
  "colonel_order",
  "cavalry_spur",
  "hip_flask",
  // Часовщик Грант
  "escapement_fork",
  "chronometer_spring",
  "tower_key",
  "watchmaker_loupe",
  // Город
  "cat_fur_tuft",
  "broken_pipe",
  "edinburgh_sack",
  "cheddar_seal",
] as const;
export type CurioId = (typeof CURIO_IDS)[number];
/** Who lost the curio: one set of four per owner. */
export type CurioOwner = "pemberley" | "wiggins" | "ashby" | "hatchett" | "grant" | "city";

/** Steam priority valve (v3 ENG-4): who gets the steam first when the stokers fall short. */
export type SteamPriority = "works" | "power";

/** Colony records (EN-11): best run time (s) to open a zone or to be crowned. */
export type RecordKey = "sewers" | "cellars" | "metro" | "terminal" | "coronation";

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
  /* v2 */
  cleanCars: number; // cars with every non-spark item caught (EN-11)
  goldStreak: number; // current run of gold+ hauls in a row (EN-11)
  goldHauls: number; // gold+ hauls (EN-12 commission "three_gold")
  downpoursWon: number; // downpours with all 3 valves closed (EN-11/12)
  frenzies: number; // bustle frenzies started (EN-12)
  royalExpresses: number; // royal expresses passed (EN-6/11)
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
  | "migration_ready"
  /* v3 */
  | "focus_manual" // the player picked the newborn focus by hand (ENG-1): the auto focus stops
  | "first_rumble"; // «Гул из глубины» played (ENG-9): metroTeaser() names the Metro

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
  | { migrations: number } // v3 (ENG-3): meta.migrations >= n
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
  /** v3 (ENG-3): what a locked card says while its unlock still waits on a Great Migration (express_plan). */
  lockedFlavor?: string;
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
  /** Royal decree flavour line (EN-10). */
  decree: string;
  /** Ranks II and III (EN-9), bought after the first coronation ever: ranks[0] is rank II, ranks[1] rank III. */
  ranks?: { cost: number; effect: string }[];
}

export interface AchievementDef {
  id: AchievementId;
  name: string;
  icon: string;
  desc: string;
  secret?: boolean;
  reward?: string; // cosmetic note
  /** Counter medals (EN-11): what achievementProgress() measures and the goal. */
  progress?: { stat: string; goal: number };
  /** Medal cabinet section (PA-7). */
  group?: "colony" | "events" | "meta" | "secret";
}

/** A 👤/🐀 pair of lines: what the humans see and what the rats see. */
export interface LinePair {
  human: string;
  rat: string;
  /** v3 (ENG-9): the drop table this line gives the carriage / capsule (weights; replaces the car's drops). */
  drops?: Partial<Record<ResId, number>>;
  /** v3 (ENG-9): one extra item of `res` worth S seconds of income (placed by a hash of the scene seq). */
  gift?: { res: ResId; S: number };
}

/** Train variant row (EN-6, data/events.ts TRAIN_VARIANTS). */
export interface TrainVariantDef {
  id: TrainVariantId;
  name: string;
  icon: string;
  /** Chance per metro train once the gate holds (0..1); "normal" takes the rest. */
  weight: number;
  /**
   * "rushHour": human clock 08:00–09:30; "flooded": a downpour ended with an open valve < 300 s ago;
   * "fog" (v3): forced while «Гороховый суп» lies over London (fogActive).
   */
  gate: "always" | "rushHour" | "flooded" | "fog";
  perCarMul: number;
  itemLifeMul: number;
  /** Seconds added to itemLife (after itemLifeMul). */
  itemLifeAdd: number;
  sMul: number;
  countMul: number;
  sparkMul: number;
  /** Replaces the random car weights. */
  carWeights?: Partial<Record<TrainCarKind, number>>;
  /** Cars placed right after the engine. */
  forcedCars?: TrainCarKind[];
  /** Per car kind drop tables overriding TRAIN_CARS[kind].drops. */
  dropOverride?: Partial<Record<TrainCarKind, Partial<Record<ResId, number>>>>;
  /** How items move in the catch canvas: rail bounce, bobbing on water, fluttering letters. */
  physics: "bounce" | "float" | "flutter";
  /** Body tint for the train painter (null = no tint). */
  tint: string | null;
  lines: LinePair[];
  /* v3 (all optional; absent = neutral) */
  /** Crash risk multiplier for the crew position (ENG-8 crashChance): freight 2, flooded 1.5, edinburgh_mail 0.5. */
  crashMul?: number;
  /** "bounce" physics (ENG-9 circus): rebounds off the platform before an item settles (absent = the painter's 1) … */
  bounces?: number;
  /** … the share of speed kept on each rebound (0..1) … */
  restitution?: number;
  /** … and the launch speed multiplier (absent = 1). */
  launchMul?: number;
  /** «Гороховый суп» (ENG-9): draw the fog layer over the pass; lantern chance ×2. */
  fog?: boolean;
}

/** Numeric knobs of a London district trait (EN-9). Missing = neutral. */
export interface DistrictMods {
  marketInterval?: [number, number];
  catCheckMult?: number; // cat check chance multiplier (quirk)
  steamBufferMult?: number;
  capsuleInterval?: number;
  metroCarsDelta?: number;
  purseFreqMult?: number;
  ratcatcherThreshold?: number;
  expressIntervalMult?: number;
  suspicionMult?: number;
  /** v3 (ENG-4): boiler max level +n (Гончарни +2). */
  boilerMaxDelta?: number;
  /** v3 (ENG-8): suspicion above which human vigilance eats train loot (absent = 50; Биг-Бен 30). */
  vigilanceFrom?: number;
  /** v3 (ENG-11): the «Сытость» multiplier itself (absent = 1.25; Боро-маркет 1.5). */
  satietyMult?: number;
  /** v3 (ENG-11): seconds between metro trains (absent = 240; Гончарни 300). */
  metroInterval?: number;
  /** Production multipliers per resource. */
  res?: Partial<Record<ResId, number>>;
}

export interface DistrictTrait {
  name: string;
  icon: string;
  perk: string;
  quirk: string;
  mods: DistrictMods;
}

export interface SealDef {
  id: SealId;
  name: string;
  icon: string;
  cost: number; // crowns
  effect: string;
}

export interface CommissionDef {
  id: CommissionId;
  name: string;
  icon: string;
  /** RunStats key or "wagons" (express wagons built). */
  stat: StatKey | "wagons";
  goal: number;
  /** "delta": the stat must grow by `goal` after acceptance; "max": the stat must reach `goal` after acceptance. */
  mode: "delta" | "max";
  desc: string;
}

export interface CommissionState {
  offered: CommissionId[];
  active?: { id: CommissionId; base: number };
  done: number;
}

/** One finished run in the colony chronicle (EN-11, meta.history). */
export interface RunHistoryEntry {
  district: number;
  /** v3 (ENG-11): the district of that run; absent in v2 entries (there `district` indexes the old sequence). */
  districtId?: DistrictId;
  seconds: number;
  eRun: number;
  crowns: number;
  zones: Partial<Record<ZoneId, number>>;
  coronationAt?: number;
  bestRating: HaulSummary["rating"];
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
  /** v3 (ENG-9): «Гороховый суп» lies over London until this run time (fogActive). */
  fogUntil: number;
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
  /** v2 (EN-5): absent from this pass (sparks at the 'wall' position): never rendered, never counted. */
  skip?: boolean;
  /** v3 (ENG-10): a curio for «Кунсткамера Короля» (value 0, weight 0: rating-neutral; a catch adds it to meta.curios). */
  curio?: CurioId;
  /** v3 (ENG-10): seconds this item stays catchable beyond scene.itemLife (a curio: +1.5 s); absent = 0. */
  lifeAdd?: number;
}

export interface SceneCar {
  kind: TrainCarKind;
  itemIds: number[];
  /** v2 (EN-6): a special car on an existing kind ('cheese' = the rare Cheddar dining car). */
  special?: "cheese";
}

export interface CatchResult {
  /** Items caught by the player's pointer, with combo step at catch time and lantern flag. */
  caught: { id: number; combo: number; lantern: boolean }[];
  /** Items caught by nets or clockwork rats (no combo). */
  netted: number[];
  sparksHit: number;
  hook: "none" | "miss" | "hit" | "perfect";
  maxCombo: number;
  /** v2 (EN-11): cars whose every non-spark item was caught (the engine recounts when omitted). */
  cleanCars?: number;
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
  /** Total suspicion change of the pass (kept a number for the v1 UI; the breakdown is in suspicionParts). */
  suspicion: number;
  crash: boolean;
  jackpot: boolean;
  notes: string[];
  /* v2 (all optional: v1 saves keep haulLog entries without them) */
  /** «Тем временем наверху»: the human newspaper line about this pass (EN-6). */
  headline?: string;
  /** Suspicion breakdown (EN-5): pass = the pass itself, lantern = 5 × lantern catches, total = whole-scene change. */
  suspicionParts?: { pass: number; lantern: number; total: number };
  /** Hook jackpot size in seconds of market-value income (EN-1). */
  jackpotSeconds?: number;
  /* v3 */
  /** Share of the item values human vigilance took (ENG-8 vigilance(): 0..0.5); absent = none. */
  vigilance?: number;
  /** The curio caught in this pass (ENG-10). */
  curio?: CurioId;
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
  /* v2 (all optional) */
  /** Metro train variant (EN-6); absent = "normal". */
  variant?: TrainVariantId;
  /** This scene's 👤/🐀 lines (EN-6), templates already resolved; absent = EVENT_LINES[id]. */
  line?: LinePair;
  /** Rumble banner text, e.g. «Сырный вагон из Чеддера!» (EN-6). */
  announce?: string;
  /** s.suspicion when the catch phase began (EN-5): haul.suspicionParts.total is measured from it. */
  suspBefore?: number;
  /** Index of `line` in EVENT_LINE_POOLS[id] (absent for variant lines); recorded in meta.seenLines when the scene begins. */
  lineIdx?: number;
  /** Suspicion the lantern greed actually added in the catch phase (EN-5 haul breakdown). */
  lanternSusp?: number;
  /* v3 (optional) */
  /**
   * The first carriage is a catch tutorial (ENG-9): a 2 s 'warn' phase («Сейчас посыплется!») before 'catch',
   * longer item life, hand catches ×2. `crash` (above) is also set when the crew position crashed (ENG-8).
   */
  tutorial?: boolean;
  /**
   * Share of the item values human vigilance took when the train was built (ENG-8: 1 − vigilance(S), 0..0.5);
   * absent = none. The haul card gets it as haul.vigilance.
   */
  vigilance?: number;
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
  /* v3 (ENG-9, optional) */
  /** "carriage": rain through the grate from a carriage passing overhead (after the Metro); absent = a plain shiny. */
  kind?: "carriage";
  /** Amount granted on click (absent: 30 × eventValue); an expired carriage shiny credits 25% of it. */
  amt?: number;
  /** v3 (ENG-10): a curio for «Кунсткамера Короля» in the grate rain (amt 0: a click adds it to meta.curios, nothing else). */
  curio?: CurioId;
}
export interface MarketDeal {
  give: ResId;
  giveAmt: number;
  get: ResId;
  getAmt: number;
  done: boolean;
}
export interface Market {
  /** Stable per opening (from sceneSeq): UI keys the stall on it — `until` moves while a scene pauses the market. */
  id: number;
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
  /** Next filler headline (EN-10). */
  filler: number;
  /** v3 (ENG-9): next «Гороховый суп» over London (Infinity before the Metro; scheduled once it is open). */
  fog: number;
}

export type TextScale = 1 | 1.15 | 1.3;

export interface Settings {
  sound: boolean;
  volume: number; // 0..1 (effects)
  reducedMotion: boolean;
  noShake: boolean;
  trainToasts: boolean;
  sciNotation: boolean;
  /* v2 */
  /** The elder's hint row in «Цели колонии» (nextHint returns null when off). */
  hints: boolean;
  /** Background ambience volume 0..1. */
  ambience: number;
  /** CSS zoom of the panel / header / resource bar / ticker. */
  textScale: TextScale;
  /** reducedMotion was seeded from the OS prefers-reduced-motion on a fresh save. */
  reducedMotionFromOS: boolean;
  /* v3 (ENG-12) */
  /** Effects bus 0..1 (default 1); `volume` stays the master. */
  sfxVolume: number;
  /** Generative district music 0..1 (default 0.35, AUD-3). */
  music: number;
}

export type HaulRating = HaulSummary["rating"];

export interface Meta {
  crowns: number; // spendable
  crownsEver: number; // lifetime total earned (drives bonus)
  edicts: Partial<Record<EdictId, boolean>>;
  achievements: Partial<Record<AchievementId, number>>; // run time-stamp (lifetime seconds) when earned
  migrations: number;
  /** Index of the current run in `visited` (v3: = visited.length − 1); the v1/v2 UI reads it with districtName(). */
  district: number;
  trophies: string[];
  bestRating: HaulSummary["rating"];
  /** wagons: Rat Express wagons built over all runs (medal «Хвост за горизонтом»). */
  lifetime: RunStats & { playSeconds: number; coinsEver: number; wagons: number };
  seenEvents: EventId[]; // bestiary
  /** Rat Express stages kept across migrations (express_blueprints edict). */
  expressKept: number;
  /* v2 */
  /** Edict ranks II/III (EN-9). Missing = rank 1 when edicts[id], else 0 (use edictRank()). */
  edictRank: Partial<Record<EdictId, number>>;
  /** The active Great Seal (EN-9), null = none. */
  seal: SealId | null;
  sealsOwned: SealId[];
  /** Coronations ever (EN-3). */
  coronations: number;
  /** Best haul rating each car kind appeared in (EN-11, «Журнал путейца»). */
  carLog: Partial<Record<TrainCarKind, HaulRating>>;
  /** Cheddar cars seen ever (EN-6: the first one comes sooner). */
  cheeseCars: number;
  /** Best haul rating per train variant (EN-11). */
  variantLog: Partial<Record<TrainVariantId, HaulRating>>;
  /** Indices into EVENT_LINE_POOLS[id] already shown (EN-6, bestiary). */
  seenLines: Partial<Record<SceneEventId, number[]>>;
  /** Finished runs, newest last, at most 20 (EN-11). */
  history: RunHistoryEntry[];
  /** Best run times (s) per record key (EN-11). */
  records: Partial<Record<RecordKey, number>>;
  /* v3 */
  /** The current district (ENG-11), = visited[district]; read it through districtInfo(meta). */
  districtId: DistrictId;
  /** Districts of every run so far in order, the current one last (a second lap repeats ids). */
  visited: DistrictId[];
  /** «Кунсткамера Короля» (ENG-10): curios owned, in the order caught; survives migrations. */
  curios: CurioId[];
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
  /* v2 */
  /** Scouting payouts already paid per expedition zone, 0..3 (EN-4). */
  scouted: Partial<Record<ZoneId, number>>;
  /** Last filler headlines (no-repeat ring, EN-10). */
  newsRecent: string[];
  /** Royal commissions (EN-12); null before the coronation. */
  commissions: CommissionState | null;
  /** Crown charters earned this run, 0..10 (EN-12). */
  charters: number;
  /** Last pool lines shown per scene event, newest last, at most 4 (EN-6 no-repeat ring). */
  recentLines: Partial<Record<SceneEventId, number[]>>;
  /** Run time of this run's coronation, -1 before it (EN-11 chronicle). */
  coronatedAt: number;
  /** Best haul rating of this run (the chronicle and the migration summary; haulLog keeps only the last 10). */
  runBestRating: HaulSummary["rating"];
  /* v3 */
  /** Steam priority valve (ENG-4): "works" = smelters and smiths first (the v2 order), "power" = presses and clocks first. */
  steamPriority: SteamPriority;
  /** A carriage passing over the grate after the Metro (ENG-9): the sky mini-scene and the hooves; null when none. */
  carriagePass: { seq: number; until: number } | null;
  /** Dev only (store.devTrigger with a variant): the next metro train takes this variant, then the field is removed. */
  forceVariant?: TrainVariantId;
  /** The elder's hint hysteresis (ENG-1, hints.trackHint): the hint shown since `since`; a stale one is `muted` until `mutedUntil`. */
  hintMemo: HintMemo;
}

/**
 * Hysteresis of the elder's hint (v3 ENG-1): `id` has been the hint since `since` (run time); one that stays longer than
 * HINT_STALE_SEC without its action being taken is muted for HINT_MUTE_SEC (nextHint falls through to the next rule).
 */
export interface HintMemo {
  id: string;
  since: number;
  muted: string;
  mutedUntil: number;
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
  | { k: "news"; text: string }
  /* v2 */
  | { k: "scout"; zone: ZoneId; res: ResId; amount: number; /** v3 (ENG-3): 4 = the 90% step. */ step: 1 | 2 | 3 | 4 }
  | {
      k: "migration";
      crowns: number;
      /** New district index (districtName / districtTrait: the old sequence only). */
      district: number;
      /** v3 (ENG-11): the new district (districtById / DISTRICTS); prefer it over the index. */
      districtId?: DistrictId;
      /** Human weekday of the new run, e.g. «среда». */
      weekday: string;
      summary: { seconds: number; eRun: number; trains: number; bestRating: HaulRating; rats: number };
    }
  | { k: "record"; what: RecordKey; time: number; prev: number }
  | { k: "commission"; id: CommissionId; done: boolean }
  /* v3 */
  /** «Гул из глубины» (ENG-9): the Thunder God passes under the burrow before the colony knows the Metro (once). */
  | { k: "deepRumble" }
  /** A curio for «Кунсткамера Короля» was caught (ENG-10). */
  | { k: "curio"; id: CurioId };

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
  | {
      a: "taps";
      /** Valves closed / paw hits (cat: 1 = beaten) / notes popped. */
      cleared: number;
      /** v2: ms from the first to the last valve closed (dry_paws). */
      fastMs?: number;
      /** v3 (ENG-9, cat): lunges countered inside CAT_COUNTER_WINDOW; each counts as 3 paw hits, >= 3 pays ×1.5. */
      perfect?: number;
    }
  | { a: "dismiss" }; // close the haul card
