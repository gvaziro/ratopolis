import { CURIO_IDS, type CurioId, type CurioOwner, type GameState, type SceneEventId, type TrainCarKind, type TrainVariantId } from "../types";
import { hash01 } from "../engine/rng";

export type { CurioId, CurioOwner } from "../types";

/**
 * «Кунсткамера Короля» (v3 ENG-10): 24 things the recurring humans keep losing, six sets of four. A curio drops at most
 * once per scene (a hash of the scene seq, never a draw from the sim RNG) as a rating-neutral item (CatchItem.curio)
 * from its source; catching it adds it to meta.curios for good. A full set grants a small perk.
 * Drops: rollCurio below and engine/curios.ts (addCurioItem, catchCurio); perks: curioPerks → derive / metaMath (GDD 11.1).
 */
export interface CurioDef {
  id: CurioId;
  name: string;
  icon: string;
  owner: CurioOwner;
  /**
   * Where it drops: the scene, and for trains the car kind, the variant or the Cheddar car. `also`: other scenes that
   * may drop it too (v3 ENG-10: what falls in the street is washed down with the downpour's flotsam).
   */
  source: { scene: SceneEventId; car?: TrainCarKind; variant?: TrainVariantId; special?: "cheese"; also?: SceneEventId[] };
  /** 👤 What the humans say about the loss (news line). */
  human: string;
  /** 🐀 The rats' label in the showcase. */
  rat: string;
  /** Where to look, for an empty slot of the showcase. */
  hint: string;
}

export interface CurioSetDef {
  owner: CurioOwner;
  /** «Леди Пемберли». */
  name: string;
  icon: string;
  /** The perk of the full set (text; curioPerks applies it). */
  perk: string;
  items: CurioId[];
}

export const CURIOS: Record<CurioId, CurioDef> = {
  // ---- Леди Пемберли (дом №12) 👒
  lace_glove: {
    id: "lace_glove",
    name: "Кружевная перчатка",
    icon: "🧤",
    owner: "pemberley",
    source: { scene: "carriage", also: ["downpour"] },
    human: "Леди Пемберли обронила перчатку из брюссельского кружева и подозревает кучера",
    rat: "Перчатка на пять хвостов. Носить по праздникам",
    hint: "Падает из экипажа над решёткой; в Ливень её может принести вода",
  },
  lady_fan: {
    id: "lady_fan",
    name: "Веер из страусовых перьев",
    icon: "🦚",
    owner: "pemberley",
    source: { scene: "metro_train", car: "first" },
    human: "Леди Пемберли обмахивалась в первом классе — и вот уже обмахивается газетой",
    rat: "Опахало для Его Величества. Дует по-королевски",
    hint: "Вагон первого класса",
  },
  murzifer_bell: {
    id: "murzifer_bell",
    name: "Бубенчик Мурзифера",
    icon: "🔔",
    owner: "pemberley",
    source: { scene: "cat" },
    human: "Кот Леди Пемберли вернулся без бубенчика и с видом оскорблённой невинности",
    rat: "Звон врага. Теперь звенит у нас",
    hint: "Отогнать Кота; если обратить его в бегство контрударами — наверняка",
  },
  teapot_lid: {
    id: "teapot_lid",
    name: "Крышка от чайника",
    icon: "🫖",
    owner: "pemberley",
    source: { scene: "capsule" },
    human: "В доме №12 нашли чайник. Крышку — нет. Чай в пять снова под угрозой",
    rat: "Щит котельной гвардии. Слегка пахнет бергамотом",
    hint: "Пневмокапсулы",
  },
  // ---- Мистер Уиггинс 🧐
  monocle: {
    id: "monocle",
    name: "Монокль",
    icon: "🧐",
    owner: "wiggins",
    source: { scene: "carriage", also: ["downpour"] },
    human: "Мистер Уиггинс уронил монокль и теперь видит мир без подробностей",
    rat: "Глаз мудреца. Старейшина смотрит в него на газету",
    hint: "Падает из экипажа над решёткой; в Ливень его может принести вода",
  },
  onion_watch: {
    id: "onion_watch",
    name: "Часы-луковица",
    icon: "⏱️",
    owner: "wiggins",
    source: { scene: "metro_train", car: "first" },
    human: "Мистер Уиггинс опоздал на заседание: часы ушли раньше него",
    rat: "Тикающая луковица. Не есть!",
    hint: "Вагон первого класса",
  },
  walking_cane: {
    id: "walking_cane",
    name: "Трость с набалдашником",
    icon: "🦯",
    owner: "wiggins",
    source: { scene: "metro_train", car: "third" },
    human: "Мистер Уиггинс зачем-то ехал третьим классом и вышел без трости",
    rat: "Посох вождя. Набалдашник — чистая латунь",
    hint: "Вагон третьего класса",
  },
  card_case: {
    id: "card_case",
    name: "Визитница",
    icon: "📇",
    owner: "wiggins",
    source: { scene: "metro_train", car: "mail" },
    human: "Визитки мистера Уиггинса разошлись по всему Лондону — без него",
    rat: "Шкатулка с именами людей. Читаем по слогам",
    hint: "Почтовый вагон",
  },
  // ---- Лорд Эшби 🎩
  crest_snuffbox: {
    id: "crest_snuffbox",
    name: "Табакерка с гербом",
    icon: "📦",
    owner: "ashby",
    source: { scene: "metro_train", car: "first" },
    human: "Лорд Эшби обыскал все жилетные карманы. Табакерки нет. Чихнуть нечем",
    rat: "Сундучок с гербом. Внутри пахнет приключениями",
    hint: "Вагон первого класса",
  },
  sapphire_cufflink: {
    id: "sapphire_cufflink",
    name: "Запонка с сапфиром",
    icon: "💎",
    owner: "ashby",
    source: { scene: "royal_express", car: "royal" },
    human: "Лорд Эшби вышел из королевского вагона с одной запонкой и прямой спиной",
    rat: "Синий камень с моря. Король смотрит в него и думает",
    hint: "Королевский вагон",
  },
  signet_ring: {
    id: "signet_ring",
    name: "Перстень-печатка",
    icon: "💍",
    owner: "ashby",
    source: { scene: "royal_express", car: "royal" },
    human: "Лорд Эшби не может запечатать письмо: перстень остался где-то под Лондоном",
    rat: "Корона для хвоста. Печать на сургуче — наша",
    hint: "Королевский вагон",
  },
  first_class_ticket: {
    id: "first_class_ticket",
    name: "Билет первого класса",
    icon: "🎫",
    owner: "ashby",
    source: { scene: "metro_train", car: "baggage" },
    human: "Контролёр не верит, что Лорд Эшби — Лорд Эшби. Билет потерян",
    rat: "Пропуск в первый класс. Колония едет бесплатно",
    hint: "Багажный вагон",
  },
  // ---- Полковник Хэтчетт 🎖️
  meerschaum_pipe: {
    id: "meerschaum_pipe",
    name: "Пенковая трубка",
    icon: "🚬",
    owner: "hatchett",
    source: { scene: "metro_train", car: "third" },
    human: "Полковник Хэтчетт вынужденно перешёл на сигары и проклинает подземку",
    rat: "Трубка мира. Курить запрещено, нюхать — можно",
    hint: "Вагон третьего класса",
  },
  colonel_order: {
    id: "colonel_order",
    name: "Орден Бани",
    icon: "🎖️",
    owner: "hatchett",
    source: { scene: "metro_train", car: "baggage" },
    human: "Полковник Хэтчетт явился на парад без ордена. Рапорт пишется",
    rat: "Медаль за храбрость. Вручим самому храброму — кочегару",
    hint: "Багажный вагон",
  },
  cavalry_spur: {
    id: "cavalry_spur",
    name: "Кавалерийская шпора",
    icon: "⭐",
    owner: "hatchett",
    source: { scene: "metro_train", variant: "freight" },
    human: "Полковник Хэтчетт ехал товарняком «для закалки» и вернулся с одной шпорой",
    rat: "Звёздочка, которая звенит. Ею погоняют вагонетки",
    hint: "Товарняк",
  },
  hip_flask: {
    id: "hip_flask",
    name: "Фляжка",
    icon: "🍶",
    owner: "hatchett",
    source: { scene: "metro_train", car: "dining" },
    human: "Полковник Хэтчетт уверяет, что во фляжке был чай. Фляжки нет",
    rat: "Серебряный бочонок. Пахнет так, что усы закручиваются",
    hint: "Вагон-ресторан",
  },
  // ---- Часовщик Грант 🕰️
  escapement_fork: {
    id: "escapement_fork",
    name: "Анкерная вилка",
    icon: "🔱",
    owner: "grant",
    source: { scene: "metro_train", car: "mail" },
    human: "Часовщик Грант ждал посылку из Женевы. Пришла пустая коробка и запах крыс",
    rat: "Вилка для самых маленьких сыров. Механики спорят",
    hint: "Почтовый вагон",
  },
  chronometer_spring: {
    id: "chronometer_spring",
    name: "Пружина хронометра",
    icon: "🌀",
    owner: "grant",
    source: { scene: "metro_train", car: "baggage" },
    human: "Хронометр для Адмиралтейства прибыл без пружины. Часовщик Грант рвёт бакенбарды",
    rat: "Живая спираль. Если отпустить — прыгает до потолка",
    hint: "Багажный вагон",
  },
  tower_key: {
    id: "tower_key",
    name: "Ключ от башенных часов",
    icon: "🗝️",
    owner: "grant",
    source: { scene: "royal_express", car: "royal" },
    human: "Башенные часы отстают: их ключ уехал королевским поездом",
    rat: "Ключ от Времени. Король заводит им утро",
    hint: "Королевский вагон",
  },
  watchmaker_loupe: {
    id: "watchmaker_loupe",
    name: "Часовая лупа",
    icon: "🔍",
    owner: "grant",
    source: { scene: "capsule" },
    human: "Часовщик Грант отправил лупу пневмопочтой в починку. Почта её съела",
    rat: "Стеклянный глаз. Сквозь него видно каждую крошку",
    hint: "Пневмокапсулы",
  },
  // ---- Город 🏙️
  cat_fur_tuft: {
    id: "cat_fur_tuft",
    name: "Клок кошачьей шерсти",
    icon: "🐈‍⬛",
    owner: "city",
    source: { scene: "cat" },
    human: "Дворник жалуется: в переулке снова дрались коты. Или не коты",
    rat: "Трофей храбрецов. Вешаем над входом",
    hint: "Отогнать Кота",
  },
  broken_pipe: {
    id: "broken_pipe",
    name: "Сломанная дудка",
    icon: "🎶",
    owner: "city",
    source: { scene: "ratcatcher" },
    human: "Крысолов подал в суд на неизвестных. Неизвестные не явились",
    rat: "Дудка, что больше не зовёт. Тишина — лучшая музыка",
    hint: "Сломать дудку Крысолову",
  },
  edinburgh_sack: {
    id: "edinburgh_sack",
    name: "Мешок с эдинбургской почтой",
    icon: "📮",
    owner: "city",
    source: { scene: "metro_train", variant: "edinburgh_mail" },
    human: "Эдинбург не получил три письма и одну поздравительную открытку тётушке",
    rat: "Мешок слов. Внутри — шотландский акцент",
    hint: "Почтовый на Эдинбург",
  },
  cheddar_seal: {
    id: "cheddar_seal",
    name: "Печать Чеддера",
    icon: "🧀",
    owner: "city",
    source: { scene: "metro_train", car: "dining", special: "cheese" },
    human: "Сыроварня Чеддера недосчиталась головки с печатью. Ищут по всей ветке",
    rat: "Печать Сырного Королевства. Пахнет величием",
    hint: "Сырный вагон из Чеддера",
  },
};

/** The six sets in showcase order; a full set grants its perk. */
export const CURIO_SETS: Record<CurioOwner, CurioSetDef> = {
  pemberley: {
    owner: "pemberley",
    name: "Леди Пемберли",
    icon: "👒",
    perk: "Кошельки щедрее: их эффекты ×1.25",
    items: ["lace_glove", "lady_fan", "murzifer_bell", "teapot_lid"],
  },
  wiggins: {
    owner: "wiggins",
    name: "Мистер Уиггинс",
    icon: "🧐",
    perk: "Находки при клике ×1.25",
    items: ["monocle", "onion_watch", "walking_cane", "card_case"],
  },
  ashby: {
    owner: "ashby",
    name: "Лорд Эшби",
    icon: "🎩",
    perk: "Королевский вагон: +2 предмета",
    items: ["crest_snuffbox", "sapphire_cufflink", "signet_ring", "first_class_ticket"],
  },
  hatchett: {
    owner: "hatchett",
    name: "Полковник Хэтчетт",
    icon: "🎖️",
    perk: "Искр в поездах меньше: ×0.8",
    items: ["meerschaum_pipe", "colonel_order", "cavalry_spur", "hip_flask"],
  },
  grant: {
    owner: "grant",
    name: "Часовщик Грант",
    icon: "🕰️",
    perk: "«Гул» поезда на 3 с дольше",
    items: ["escapement_fork", "chronometer_spring", "tower_key", "watchmaker_loupe"],
  },
  city: {
    owner: "city",
    name: "Город",
    icon: "🏙️",
    perk: "Грамоты Короля ×1.06",
    items: ["cat_fur_tuft", "broken_pipe", "edinburgh_sack", "cheddar_seal"],
  },
};

export const CURIO_SET_ORDER: readonly CurioOwner[] = ["pemberley", "wiggins", "ashby", "hatchett", "grant", "city"];

export const CURIO_ORDER: readonly CurioId[] = CURIO_IDS;

/** The v2 trophy each «Город» curio replaces (meta.trophies keeps being written for old UIs). */
export const TROPHY_CURIO: Record<string, CurioId> = { cat_fur: "cat_fur_tuft", broken_pipe: "broken_pipe" };

/** One set of the showcase: what is owned, whether it is complete and its perk (PAN-2 «Кунсткамера»). */
export interface CurioSetView {
  owner: CurioOwner;
  name: string;
  icon: string;
  perk: string;
  items: { id: CurioId; owned: boolean }[];
  done: boolean;
}

/** The showcase by set, in CURIO_SET_ORDER. */
export function curioSets(s: Pick<GameState, "meta">): CurioSetView[] {
  const owned = new Set(s.meta.curios ?? []);
  return CURIO_SET_ORDER.map((o) => {
    const set = CURIO_SETS[o];
    const items = set.items.map((id) => ({ id, owned: owned.has(id) }));
    return { owner: o, name: set.name, icon: set.icon, perk: set.perk, items, done: items.every((x) => x.owned) };
  });
}

/** A full set of this owner is owned (ENG-10 perks). */
export function curioSetDone(s: { meta: Pick<GameState["meta"], "curios"> }, owner: CurioOwner): boolean {
  const owned = s.meta.curios ?? [];
  return CURIO_SETS[owner].items.every((id) => owned.includes(id));
}

/* ---------------------------------------------------------------- drops (ENG-10) */

/** Scenes that may drop a curio as a catch item (or a grate-rain shiny) and their chance per scene. */
export type CurioScene = "metro_train" | "royal_express" | "carriage" | "capsule" | "downpour";

/**
 * Chance per scene that one curio not owned yet drops (ENG-10): at most one per scene, decided by a hash of the scene
 * seq — no draw from the game RNG, so a scene builds the same loot with or without it. A metro train's chance is
 * ×CURIO_RICH_MULT when one of its candidates rides in a first-class or baggage car. The cat and the Ratcatcher award
 * theirs on a win (engine/curios.ts).
 */
export const CURIO_CHANCE: Record<CurioScene, number> = { metro_train: 0.04, royal_express: 0.12, carriage: 0.02, capsule: 0.02, downpour: 0.04 };
/** Metro cars that carry the valuables: a curio of theirs doubles the train's chance and is picked twice as often. */
export const CURIO_RICH_CARS: readonly TrainCarKind[] = ["first", "baggage"];
export const CURIO_RICH_MULT = 2;
/** A curio item stays catchable this much longer than the scene's other items (CatchItem.life). */
export const CURIO_LIFE_ADD = 1.5;
/** «Кунсткамера»: +0.5% to everything per exhibit (derive globalParts). */
export const CURIO_GLOBAL_PCT = 0.5;
/** A cat win after the tuft drops the bell with this chance (a hash of the scene seq); a rout always does. */
export const CURIO_BELL_CHANCE = 1 / 3;
/** Hash salt of the curio roll: chance, then the pick, then the moment. */
export const CURIO_SALT = 0xc0710;

/** Where the curio falls: its id and the index of its car in the scene. */
export interface CurioPick {
  id: CurioId;
  car: number;
}

/** What curioCandidates needs of a scene (a grate rain passes a one-car carriage). */
export interface CurioSceneInfo {
  id: SceneEventId;
  seq: number;
  cars: readonly { kind: TrainCarKind; special?: "cheese" }[];
  variant?: TrainVariantId;
}

/** Does curio `c` fall in car `car` of this scene? */
function dropsIn(c: CurioDef, sc: CurioSceneInfo, car: { kind: TrainCarKind; special?: "cheese" }, index: number): boolean {
  const src = c.source;
  if (src.scene !== sc.id) return !!src.also?.includes(sc.id);
  if (sc.id !== "metro_train" && sc.id !== "royal_express") return true;
  if (src.special) return car.special === src.special;
  if (src.variant && (sc.variant ?? "normal") !== src.variant) return false;
  if (src.car) return car.kind === src.car;
  // a variant's curio rides anywhere behind the engine
  return index > 0 && car.kind !== "engine";
}

/**
 * Every (curio, car) pair a scene can drop, with its pick weight (×CURIO_RICH_MULT in first-class and baggage cars):
 * curios not owned yet whose source is this scene (and, on trains, this car kind, variant or the Cheddar car).
 */
export function curioCandidates(s: Pick<GameState, "meta">, sc: CurioSceneInfo): (CurioPick & { w: number })[] {
  const owned = new Set(s.meta.curios ?? []);
  const out: (CurioPick & { w: number })[] = [];
  for (const id of CURIO_ORDER) {
    if (owned.has(id)) continue;
    const c = CURIOS[id];
    sc.cars.forEach((car, i) => {
      if (dropsIn(c, sc, car, i)) out.push({ id, car: i, w: sc.id === "metro_train" && CURIO_RICH_CARS.includes(car.kind) ? CURIO_RICH_MULT : 1 });
    });
  }
  return out;
}

/** The chance this scene drops a curio (0 without candidates). */
export function curioChance(s: Pick<GameState, "meta">, sc: CurioSceneInfo): number {
  const base = CURIO_CHANCE[sc.id as CurioScene] ?? 0;
  if (!(base > 0)) return 0;
  let w = 0;
  for (const c of curioCandidates(s, sc)) w = Math.max(w, c.w);
  return base * w;
}

/** The curio this scene drops, if any: hashes of (scene seq, CURIO_SALT) decide whether, which and in which car. */
export function rollCurio(s: Pick<GameState, "meta">, sc: CurioSceneInfo): CurioPick | null {
  const cand = curioCandidates(s, sc);
  if (!cand.length) return null;
  if (hash01(sc.seq, CURIO_SALT) >= curioChance(s, sc)) return null;
  const total = cand.reduce((a, c) => a + c.w, 0);
  let r = hash01(sc.seq, CURIO_SALT + 1) * total;
  for (const c of cand) {
    r -= c.w;
    if (r < 0) return { id: c.id, car: c.car };
  }
  const last = cand[cand.length - 1];
  return { id: last.id, car: last.car };
}

/* ---------------------------------------------------------------- set perks (ENG-10) */

/** What the full sets give, as multipliers / additions the engine applies (1 / 0 = no perk). */
export interface CurioPerks {
  /** Леди Пемберли: purse effects (Derived.purseEffect) ×1.25. */
  purseEffect: number;
  /** Мистер Уиггинс: the click's find chance (Derived.dropMult) ×1.25. */
  findMult: number;
  /** Лорд Эшби: the royal car carries +2 items. */
  royalItems: number;
  /** Полковник Хэтчетт: sparks in trains ×0.8. */
  sparkMult: number;
  /** Часовщик Грант: the train's «Гул» +3 s. */
  rumbleAdd: number;
  /** Город: the King's charters ×1.06 (metaMath.charterMult). */
  charterMult: number;
}

export const CURIO_PERK_VALUES: CurioPerks = { purseEffect: 1.25, findMult: 1.25, royalItems: 2, sparkMult: 0.8, rumbleAdd: 3, charterMult: 1.06 };

const PERK_OF: Record<CurioOwner, keyof CurioPerks> = {
  pemberley: "purseEffect",
  wiggins: "findMult",
  ashby: "royalItems",
  hatchett: "sparkMult",
  grant: "rumbleAdd",
  city: "charterMult",
};

/** The perks of the sets this colony has completed. */
export function curioPerks(meta: Pick<GameState["meta"], "curios">): CurioPerks {
  const out: CurioPerks = { purseEffect: 1, findMult: 1, royalItems: 0, sparkMult: 1, rumbleAdd: 0, charterMult: 1 };
  for (const o of CURIO_SET_ORDER) if (curioSetDone({ meta }, o)) out[PERK_OF[o]] = CURIO_PERK_VALUES[PERK_OF[o]];
  return out;
}

/** «Кунсткамера» production multiplier: 1 + 0.5% per exhibit. */
export function curioMult(meta: Pick<GameState["meta"], "curios">): number {
  return 1 + (CURIO_GLOBAL_PCT / 100) * (meta.curios?.length ?? 0);
}
