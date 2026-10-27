import { DISTRICT_IDS, type DistrictId, type DistrictMods, type DistrictTrait, type Meta } from "../types";
import { hash01 } from "../engine/rng";

export type { DistrictId } from "../types";

/**
 * London on a map (v3 ENG-11): twelve districts, each with a fixed trait, its own filler headlines and a place on the
 * map of the city (Thames in the middle). The colony visits each once; after all twelve a second lap starts with the
 * same names («Сити II») and every trait ×1.25. The first six are the v1/v2 sequence (LEGACY_DISTRICT_SEQ), so old
 * saves map their numeric meta.district onto them (save.ts MIGRATIONS).
 * Traits use the DistrictMods keys only (derive.ts, the event timers); ENG-11 retuned the first six so every quirk costs
 * something and every perk reaches a real bottleneck (GDD 10.4).
 */
export interface DistrictDef {
  id: DistrictId;
  name: string;
  /** Locative for «Обустраивается {loc}»: «в Уайтчепеле». */
  loc: string;
  icon: string;
  trait: DistrictTrait;
  /** Filler headlines of runs in this district («Тем временем наверху»): four each. */
  fillers: string[];
  /** The landmark the map draws and the migration card names. */
  landmark: string;
  /** Position on the London map, 0..100 both ways (x west → east, y north → south; the Thames runs near y ≈ 50–60). */
  pos: { x: number; y: number };
  /** Districts one migration away on the map (symmetric). */
  neighbors: DistrictId[];
}

/** What the UI shows of a district (the current one, a migration option, a chronicle entry). */
export interface DistrictInfo {
  id: DistrictId;
  /** With the lap numeral from the second lap on: «Сити II». */
  name: string;
  /** «в Сити», «в Сити II» on the second lap. */
  loc: string;
  icon: string;
  /** Effective trait (amplified ×1.25 per extra lap). */
  trait: DistrictTrait;
  /** 1 = the first walk across London, 2 = the second (every trait ×1.25), … */
  lap: number;
}

/** A district the next Great Migration may lead to (migrationPreview().options). */
export type DistrictOption = DistrictInfo;

/* ---------------------------------------------------------------- laps: numerals and amplified traits */

function toRoman(n: number): string {
  const map: [number, string][] = [
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ];
  let out = "";
  for (const [v, s] of map) {
    while (n >= v) {
      out += s;
      n -= v;
    }
  }
  return out;
}

/** Roman numeral for district laps («Сити II»). */
export function lapNumeral(n: number): string {
  return toRoman(Math.max(1, Math.floor(n)));
}

/** Scale a multiplier's effect size: 1.5 → 1 + 0.5·k, 0.6 → 1 − 0.4·k. */
function amplify(m: number, k: number): number {
  return 1 + (m - 1) * k;
}

/** A trait's mods with every perk and quirk magnitude scaled by k (the second lap of London: k = 1.25). */
export function amplifyMods(m: DistrictMods, k: number): DistrictMods {
  const mods: DistrictMods = {};
  if (m.marketInterval) mods.marketInterval = [Math.round(m.marketInterval[0] / k), Math.round(m.marketInterval[1] / k)];
  if (m.catCheckMult !== undefined) mods.catCheckMult = amplify(m.catCheckMult, k);
  if (m.steamBufferMult !== undefined) mods.steamBufferMult = amplify(m.steamBufferMult, k);
  if (m.capsuleInterval !== undefined) mods.capsuleInterval = Math.round(150 + (m.capsuleInterval - 150) * k);
  if (m.metroCarsDelta !== undefined) mods.metroCarsDelta = m.metroCarsDelta;
  if (m.purseFreqMult !== undefined) mods.purseFreqMult = amplify(m.purseFreqMult, k);
  if (m.ratcatcherThreshold !== undefined) mods.ratcatcherThreshold = Math.round(100 - (100 - m.ratcatcherThreshold) * k);
  if (m.expressIntervalMult !== undefined) mods.expressIntervalMult = amplify(m.expressIntervalMult, k);
  if (m.suspicionMult !== undefined) mods.suspicionMult = amplify(m.suspicionMult, k);
  if (m.res) mods.res = Object.fromEntries(Object.entries(m.res).map(([r, v]) => [r, amplify(v as number, k)]));
  if (m.boilerMaxDelta !== undefined) mods.boilerMaxDelta = Math.round(m.boilerMaxDelta * k);
  if (m.vigilanceFrom !== undefined) mods.vigilanceFrom = Math.round(50 - (50 - m.vigilanceFrom) * k);
  if (m.satietyMult !== undefined) mods.satietyMult = amplify(m.satietyMult, k);
  if (m.metroInterval !== undefined) mods.metroInterval = Math.round(240 + (m.metroInterval - 240) * k);
  return mods;
}

/* ---------------------------------------------------------------- the twelve traits */

/**
 * The traits of the v1/v2 sequence (index = old meta.district). v3 (ENG-11) retune: the market's perk is a richer
 * «Сытость» and its quirk costs 📜; the potteries raise the boiler cap and slow the metro; the mansions pay in 💍;
 * Big Ben's quirk costs 📜 and lets the humans watch early (v2 quirks were extra paid events: no cost at all).
 * The forced-trait ablation (scripts/sim-traits.ts, GDD 15.17: 3 replicates × 6 samples of run 3) keeps every plan value
 * but Big Ben's: its double hit on the 💍 bottleneck (the express ×0.6 and 💍 ×1.5) crowned 15% faster than «Туман», so
 * the perk is 💍 ×1.35 and the humans watch from 30 👁 (plan: ×1.5 and 40).
 */
export const DISTRICT_TRAITS: DistrictTrait[] = [
  { name: "Туман", icon: "🌫️", perk: "Ничего особенного — только туман гуще похлёбки", quirk: "Никаких сюрпризов", mods: {} },
  {
    name: "Боро-маркет",
    icon: "🧺",
    perk: "«Сытость» ×1.5 вместо ×1.25, рынок Бенедикта раз в 4–5 минут",
    quirk: "Рыночный гвалт мешает книжникам: 📜 −25%",
    mods: { satietyMult: 1.5, marketInterval: [240, 300], res: { blueprints: 0.75 } },
  },
  {
    name: "Гончарни",
    icon: "🏺",
    perk: "⚙️ ×1.5, котёл строится на 2 уровня выше (до 14)",
    quirk: "Поезда подземки реже: раз в 5 минут",
    mods: { res: { gears: 1.5 }, boilerMaxDelta: 2, metroInterval: 300 },
  },
  {
    name: "Читальный зал",
    icon: "📚",
    perk: "📜 ×2",
    quirk: "Поезда подземки на вагон короче",
    mods: { res: { blueprints: 2 }, metroCarsDelta: -1 },
  },
  {
    name: "Особняки",
    icon: "🎩",
    perk: "🪙 ×1.5, кошельки вдвое чаще",
    quirk: "Дворецкие запирают шкатулки: 💍 −25%",
    mods: { res: { coins: 1.5, trinkets: 0.75 }, purseFreqMult: 2 },
  },
  {
    name: "Биг-Бен",
    icon: "🕰️",
    perk: "Королевский экспресс чаще (×0.6 интервал), 💍 ×1.35",
    quirk: "Часовые не дремлют: 📜 −20%, бдительность людей уже с 30 👁",
    mods: { expressIntervalMult: 0.6, res: { trinkets: 1.35, blueprints: 0.8 }, vigilanceFrom: 30 },
  },
];

const [FOG, BOROUGH, POTTERIES, READING, MANSIONS, BIG_BEN] = DISTRICT_TRAITS;

export const DISTRICTS: Record<DistrictId, DistrictDef> = {
  whitechapel: {
    id: "whitechapel",
    name: "Уайтчепел",
    loc: "в Уайтчепеле",
    icon: "🌫️",
    trait: FOG,
    fillers: [
      "В Уайтчепеле туман гуще похлёбки в работном доме",
      "Колокольная литейня отлила новый колокол. Колония оглохла на полдня и очень довольна",
      "Старьёвщик с Петтикоут-лейн торгует пуговицами. Подозрительно знакомыми",
      "Констебль обходит переулки с фонарём. Крысы обходят констебля",
    ],
    landmark: "Колокольная литейня",
    pos: { x: 74, y: 40 },
    neighbors: ["city", "docklands", "southwark"],
  },
  southwark: {
    id: "southwark",
    name: "Саутварк",
    loc: "в Саутварке",
    icon: "🧺",
    trait: BOROUGH,
    fillers: [
      "Саутварк: пивоварня уронила солод. Колония пьёт за здоровье Короля",
      "Торговка с Боро-маркета недосчиталась головки сыра. Колония — аппетита",
      "Актёры у старого «Глобуса» репетируют «Гамлета». Крысы — «Короля Крыс»",
      "Лондонский мост скрипит под омнибусами. Внизу считают, что с них упало",
    ],
    landmark: "Боро-маркет",
    pos: { x: 58, y: 64 },
    neighbors: ["whitechapel", "city", "lambeth", "greenwich"],
  },
  lambeth: {
    id: "lambeth",
    name: "Ламбет",
    loc: "в Ламбете",
    icon: "🏺",
    trait: POTTERIES,
    fillers: [
      "Ламбет: архиепископ молится о тишине. Крысы стараются",
      "Печи Доултона дымят день и ночь. Кочегары колонии греются в долг",
      "Гончар уронил кувшин. Черепки пригодятся: в колонии не хватает мисок",
      "Из Ламбетского дворца выносят огарки свечей. Колония принимает пожертвования",
    ],
    landmark: "Гончарни Доултона",
    pos: { x: 38, y: 68 },
    neighbors: ["southwark", "westminster", "chelsea"],
  },
  bloomsbury: {
    id: "bloomsbury",
    name: "Блумсбери",
    loc: "в Блумсбери",
    icon: "📚",
    trait: READING,
    fillers: [
      "Блумсбери: музей потерял мумию кошки. Колония клянётся — не мы",
      "В Читальном зале тишина. Только под кафедрой кто-то шуршит страницами",
      "Студент уснул над «Происхождением видов». Книжники колонии дочитали за него",
      "Хранитель музея ищет черепок из Ниневии. Он в гнезде — работает подушкой",
    ],
    landmark: "Британский музей",
    pos: { x: 42, y: 24 },
    neighbors: ["kings_cross", "covent_garden", "city", "mayfair"],
  },
  mayfair: {
    id: "mayfair",
    name: "Мэйфэр",
    loc: "в Мэйфэре",
    icon: "🎩",
    trait: MANSIONS,
    fillers: [
      "Мэйфэр: здесь даже крошки с позолотой",
      "Дворецкий с Беркли-сквер пересчитал серебро. Дважды. Ложек всё равно на одну меньше",
      "Бал у герцогини: наверху вальс, внизу делят упавшие канапе",
      "На Беркли-сквер поёт соловей. Механики колонии подозревают, что он заводной",
    ],
    landmark: "Беркли-сквер",
    pos: { x: 24, y: 36 },
    neighbors: ["bloomsbury", "covent_garden", "westminster", "chelsea"],
  },
  westminster: {
    id: "westminster",
    name: "Вестминстер",
    loc: "в Вестминстере",
    icon: "🕰️",
    trait: BIG_BEN,
    fillers: [
      "Вестминстер: парламент обсуждает крысиный вопрос. Крысы — тоже",
      "Большой Бен пробил полдень. Колония сверила усы и всё равно опоздала к обеду",
      "Депутат обронил речь о реформе. Крысиный парламент принял её в первом чтении",
      "Крысиный парламент заседает под Вестминстером. Кворума нет: все ушли встречать поезд",
    ],
    landmark: "Башня с часами",
    pos: { x: 36, y: 52 },
    neighbors: ["lambeth", "mayfair", "covent_garden", "chelsea"],
  },
  city: {
    id: "city",
    name: "Сити",
    loc: "в Сити",
    icon: "🏦",
    trait: {
      name: "Банки",
      icon: "🏦",
      perk: "🪙 ×1.5, кошельки в полтора раза чаще",
      quirk: "Клерки бдительны: подозрение растёт ×1.3",
      mods: { res: { coins: 1.5 }, purseFreqMult: 1.5, suspicionMult: 1.3 },
    },
    fillers: [
      "Сити: Банк Англии пересчитал золото. Дважды. Крысы сочувствуют",
      "Клерк из Ломбард-стрит уронил гинею в сток и подал жалобу на гравитацию",
      "На бирже паника: акции упали. Крошки, к счастью, падают только вниз — к нам",
      "Клерк задремал над гроссбухом. Его промокашку колония подшила к чертежам",
    ],
    landmark: "Банк Англии",
    pos: { x: 60, y: 40 },
    neighbors: ["whitechapel", "southwark", "bloomsbury", "covent_garden", "kings_cross"],
  },
  covent_garden: {
    id: "covent_garden",
    name: "Ковент-Гарден",
    loc: "в Ковент-Гардене",
    icon: "🥬",
    trait: {
      name: "Овощной рынок",
      icon: "🥬",
      perk: "🍞 ×2, рынок Бенедикта раз в 4–5 минут",
      quirk: "Рыночные коты сыты и наглы: проверки ×1.3",
      mods: { res: { crumbs: 2 }, marketInterval: [240, 300], catCheckMult: 1.3 },
    },
    fillers: [
      "Ковент-Гарден: торговка капустой клянётся, что кочан убежал сам",
      "Опера давала «Волшебную флейту». Крысы слушали из суфлёрской будки",
      "Цветочница продала фиалки и не заметила, как заодно продала шнурки",
      "Грузчики носят корзины на головах. Падает всё, что не привязано",
    ],
    landmark: "Овощной рынок",
    pos: { x: 44, y: 40 },
    neighbors: ["bloomsbury", "mayfair", "westminster", "city"],
  },
  kings_cross: {
    id: "kings_cross",
    name: "Кингс-Кросс",
    loc: "в Кингс-Кроссе",
    icon: "🚉",
    trait: {
      name: "Узловая",
      icon: "🚉",
      perk: "Поезда подземки на вагон длиннее",
      quirk: "Капсулы реже: раз в 3 минуты",
      mods: { metroCarsDelta: 1, capsuleInterval: 180 },
    },
    fillers: [
      "Кингс-Кросс: носильщики спорят, чей чемодан шевелится",
      "Северный экспресс опоздал на семь минут. Колония — ни на секунду",
      "Начальник станции отчитал носильщика за пропавший саквояж. Саквояж уже в гнезде",
      "«Летучий шотландец» прибыл минута в минуту. Колония встретила его оркестром из ложек",
    ],
    landmark: "Вокзал Кингс-Кросс",
    pos: { x: 46, y: 10 },
    neighbors: ["bloomsbury", "city"],
  },
  docklands: {
    id: "docklands",
    name: "Доки Ист-Энда",
    loc: "в Доках Ист-Энда",
    icon: "⚓",
    trait: {
      name: "Причалы",
      icon: "⚓",
      perk: "🔘 и ➰ ×1.5",
      quirk: "Портовый крысолов: приходит уже при 85% подозрения",
      mods: { res: { buttons: 1.5, wire: 1.5 }, ratcatcherThreshold: 85 },
    },
    fillers: [
      "Доки: из трюма «Святой Анны» пропал тюк пуговиц. Матросы винят морского змея",
      "Грузчики Вест-Индских доков поют шанти. Крысы подпевают на две октавы выше",
      "Таможня вскрыла ящик ассамского чая. Внутри чай и очень довольная крыса",
      "Портовый кот ушёл на клипере в Бомбей. Причалы гуляют целую неделю",
    ],
    landmark: "Вест-Индские доки",
    pos: { x: 86, y: 48 },
    neighbors: ["whitechapel", "greenwich"],
  },
  chelsea: {
    id: "chelsea",
    name: "Челси",
    loc: "в Челси",
    icon: "🎨",
    trait: {
      name: "Мастерские художников",
      icon: "🎨",
      perk: "📜 ×1.5, кошельки в полтора раза чаще",
      quirk: "Королевский экспресс реже (интервал ×1.3)",
      mods: { res: { blueprints: 1.5 }, purseFreqMult: 1.5, expressIntervalMult: 1.3 },
    },
    fillers: [
      "Челси: художник рисует Темзу в тумане. Туман позирует бесплатно",
      "Пенсионеры Королевского госпиталя маршируют к обеду. Крысы — следом",
      "Мистер Уистлер снова пишет ноктюрн. Колония позирует на заднем плане",
      "Аптекарский огород недосчитался семян. Колония разбила грядку у трубы",
    ],
    landmark: "Королевский госпиталь",
    pos: { x: 14, y: 60 },
    neighbors: ["lambeth", "mayfair", "westminster"],
  },
  greenwich: {
    id: "greenwich",
    name: "Гринвич",
    loc: "в Гринвиче",
    icon: "🔭",
    trait: {
      name: "Обсерватория",
      icon: "🔭",
      perk: "Королевский экспресс чаще (интервал ×0.7)",
      quirk: "Поезда подземки на вагон короче",
      mods: { expressIntervalMult: 0.7, metroCarsDelta: -1 },
    },
    fillers: [
      "Гринвич: астроном королевы открыл новую звезду. Оказалось — крысиный глаз в трубе",
      "Шар времени упал ровно в час. Колония сверила усы",
      "Нулевой меридиан провели через Гринвич. Колония провела свой — через сырный склад",
      "Старые моряки госпиталя травят байки. Крысы записывают всё про морского змея",
    ],
    landmark: "Королевская обсерватория",
    pos: { x: 90, y: 74 },
    neighbors: ["southwark", "docklands"],
  },
};

export const DISTRICT_ORDER: readonly DistrictId[] = DISTRICT_IDS;

/**
 * The v1/v2 migration sequence (index = old meta.district), then the six new districts in a fixed order: old saves
 * with district ≥ 6 map onto these (save.ts MIGRATIONS), and districtOptions() puts the next one first while it is a free
 * neighbour, so the default route (the sim, offline paths, a player who always takes the first card) walks the v2
 * districts as v2 did for the first three runs.
 */
export const LEGACY_DISTRICT_SEQ: readonly DistrictId[] = [
  "whitechapel",
  "southwark",
  "lambeth",
  "bloomsbury",
  "mayfair",
  "westminster",
  "city",
  "covent_garden",
  "kings_cross",
  "chelsea",
  "docklands",
  "greenwich",
];

/** Districts per lap of London. */
const LAP = DISTRICT_IDS.length;

/** Trait amplification per extra lap. */
const LAP_AMPLIFY = 1.25;

/** Salt of the hash that orders the neighbours a migration offers (by the migration count; no RNG draw). */
const OPTION_SALT = 1187;

export function districtById(id: DistrictId): DistrictDef {
  return DISTRICTS[id] ?? DISTRICTS.whitechapel;
}

/** The district of run `index` (0-based) for a colony with no `visited` record: the legacy sequence, lap after lap. */
export function legacyDistrictId(index: number): DistrictId {
  const i = Math.max(0, Math.floor(index));
  return LEGACY_DISTRICT_SEQ[i % LAP];
}

/** The visited list a v2 colony at run `district` stands for (save.ts MIGRATIONS, sanitize). */
export function legacyVisited(district: number): DistrictId[] {
  const n = Math.max(0, Math.floor(district)) + 1;
  return Array.from({ length: n }, (_, i) => legacyDistrictId(i));
}

/** DistrictInfo of a district id on lap `lap` (1-based): the second lap carries «II» and traits ×1.25. */
export function districtInfoOf(id: DistrictId, lap = 1): DistrictInfo {
  const def = districtById(id);
  if (lap <= 1) return { id: def.id, name: def.name, loc: def.loc, icon: def.icon, trait: def.trait, lap: 1 };
  const k = Math.pow(LAP_AMPLIFY, lap - 1);
  const t = def.trait;
  const n = lapNumeral(lap);
  const trait: DistrictTrait = {
    ...t,
    name: `${t.name} ${n}`,
    perk: `${t.perk} — и ещё сильнее`,
    quirk: `${t.quirk} — и злее`,
    mods: amplifyMods(t.mods, k),
  };
  return { id: def.id, name: `${def.name} ${n}`, loc: `${def.loc} ${n}`, icon: def.icon, trait, lap };
}

/**
 * The district of run `index` of this colony: meta.visited[index] when recorded (v3), else the legacy sequence
 * (v2 saves before migration, tests that set meta.district by hand).
 */
export function districtAt(meta: Pick<Meta, "visited">, index: number): DistrictInfo {
  const i = Math.max(0, Math.floor(index));
  const id = meta.visited?.[i] ?? legacyDistrictId(i);
  return districtInfoOf(id, Math.floor(i / LAP) + 1);
}

/** The current district: its name, locative, icon, effective trait and lap (PAN-2, SHL-5, derive, events). */
export function districtInfo(meta: Pick<Meta, "visited" | "district">): DistrictInfo {
  return districtAt(meta, meta.district);
}

/** The visited list of this colony up to the current run (the legacy one when `visited` does not match `district`). */
function routeOf(meta: Pick<Meta, "visited" | "district">): readonly DistrictId[] {
  const n = Math.max(0, Math.floor(meta.district)) + 1;
  return meta.visited?.length === n ? meta.visited : legacyVisited(meta.district);
}

/**
 * The next Great Migration may lead to `id`: not visited yet on this lap of London and not the current district
 * (store.migrate(to) accepts any such district; the map offers districtOptions()).
 */
export function districtFree(meta: Pick<Meta, "visited" | "district">, id: DistrictId): boolean {
  if (!DISTRICTS[id]) return false;
  const nextIndex = Math.max(0, Math.floor(meta.district)) + 1;
  const lapStart = Math.floor(nextIndex / LAP) * LAP;
  return id !== districtAt(meta, meta.district).id && !routeOf(meta).slice(lapStart, nextIndex).includes(id);
}

/** Squared distance between two districts on the map. */
function dist2(a: DistrictId, b: DistrictId): number {
  const p = districtById(a).pos;
  const q = districtById(b).pos;
  return (p.x - q.x) ** 2 + (p.y - q.y) ** 2;
}

/**
 * Where the next Great Migration may go (migrationPreview().options, ENG-11): two districts not yet visited on this
 * lap — the unvisited neighbours of the current district on the map, ordered by a hash of the migration count (no RNG
 * draw), except that the legacy sequence's next district comes first while it is one of them (the default route of
 * store.migrate() and the sim then walks the v2 districts for the first three runs). With fewer than two free
 * neighbours the nearest free districts fill in; after all twelve the next lap starts over with every district free.
 */
export function districtOptions(meta: Pick<Meta, "visited" | "district" | "migrations">): DistrictOption[] {
  const nextIndex = Math.max(0, Math.floor(meta.district)) + 1;
  const lap = Math.floor(nextIndex / LAP) + 1;
  const current = districtAt(meta, meta.district).id;
  const free = (id: DistrictId) => districtFree(meta, id);
  const out: DistrictId[] = [];
  const legacy = legacyDistrictId(nextIndex);
  const near = districtById(current).neighbors.filter(free);
  if (near.includes(legacy)) out.push(legacy);
  const rest = near.filter((id) => !out.includes(id));
  if (rest.length) {
    const k = Math.floor(hash01(Math.max(0, Math.floor(meta.migrations)), OPTION_SALT) * rest.length);
    for (let i = 0; i < rest.length && out.length < 2; i++) out.push(rest[(k + i) % rest.length]);
  }
  if (out.length < 2) {
    const far = LEGACY_DISTRICT_SEQ.filter((id) => free(id) && !out.includes(id)).sort((a, b) => dist2(current, a) - dist2(current, b));
    for (const id of far) {
      if (out.length >= 2) break;
      out.push(id);
    }
  }
  // nothing free (cannot happen with 12 districts: the lap restarts first) — the legacy sequence
  if (!out.length) out.push(legacy);
  return out.map((id) => districtInfoOf(id, lap));
}
