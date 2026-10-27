import type { DistrictTrait, Meta, ZoneDef, ZoneId } from "../types";
import { DISTRICTS as DISTRICT_DEFS, DISTRICT_TRAITS, LEGACY_DISTRICT_SEQ, amplifyMods, districtAt, lapNumeral } from "./districts";

export const ZONES: Record<ZoneId, ZoneDef> = {
  burrow: {
    id: "burrow",
    order: 1,
    name: "Нора у стока",
    icon: "🕳️",
    expedition: null,
    mapRevealRats: 0,
    housingBonus: 0,
    palette: { bg: "#2b1d14", accent: "#c98a3a", glow: "#f2b84b", detail: "#5e7a4a" },
    sky: "Мостовая, решётка водостока, ноги прохожих, газовый фонарь",
    humanLine: "Решётка водостока, ничего интересного",
    ratLine: "Небесные ворота, сквозь которые падает всё",
    adds: "🍞🪙🔘➰, первые постройки, Экипаж, Кошелёк",
  },
  sewers: {
    id: "sewers",
    order: 2,
    name: "Канализация",
    icon: "🌊",
    expedition: { cost: { crumbs: 4500, coins: 1500, wire: 600 }, rats: 20 },
    mapRevealRats: 12,
    housingBonus: 20,
    palette: { bg: "#1f3b3a", accent: "#8a4b3a", glow: "#7fd1b9", detail: "#3f7f86" },
    sky: "Люк, дождевые тучи, зонты, тумба пневмопочты",
    humanLine: "Сток, пахнет, проходите мимо",
    ratLine: "Подземная река и медные черви пневмопочты",
    adds: "+20 жилья, ⚙️ шестерёнки, мастерские, пневмокапсулы, Ливень",
  },
  cellars: {
    id: "cellars",
    order: 3,
    name: "Подвалы",
    icon: "🍷",
    expedition: { cost: { coins: 8500, buttons: 3500, gears: 650 }, rats: 50 },
    mapRevealRats: 35,
    housingBonus: 40,
    palette: { bg: "#4a2f1b", accent: "#e8b84b", glow: "#f2b84b", detail: "#7a4a2a" },
    sky: "Фасад дома, окно подвала, кошачий силуэт, лавка",
    humanLine: "Мыши опять в погребе",
    ratLine: "Мы открыли континент Сыра",
    adds: "+40 жилья, 🧀 сыр и 📜 чертежи, подозрение людей, Кот, Базарный день",
  },
  metro: {
    id: "metro",
    order: 4,
    name: "Станция подземки",
    icon: "🚇",
    expedition: { cost: { coins: 108000, gears: 6000, cheese: 3600, blueprints: 240 }, rats: 120 },
    mapRevealRats: 90,
    housingBonus: 50,
    palette: { bg: "#2a2833", accent: "#cfcfc8", glow: "#8b1e1e", detail: "#6b6b78" },
    sky: "Вход в метро, перрон, маленькие люди в цилиндрах",
    humanLine: "Поезд в 8:15, опять задымил весь перрон",
    ratLine: "Бог Грома проходит каждые четыре минуты и оставляет дары",
    adds: "+50 жилья, 🪨💨🔔🛤️, ПОЕЗДА, Крысолов, Великое Переселение",
  },
  terminal: {
    id: "terminal",
    order: 5,
    name: "Большой вокзал",
    icon: "🏛️",
    expedition: { cost: { coins: 8_000_000, brass: 3000, rails: 400, blueprints: 1000, trinkets: 5 }, rats: 300 },
    mapRevealRats: 250,
    housingBonus: 200,
    palette: { bg: "#3b3022", accent: "#e8d5a3", glow: "#d4af37", detail: "#8fa3b0" },
    sky: "Фасад вокзала с часами, дым экспресса",
    humanLine: "Кто-то забыл чемодан",
    ratLine: "Упал сундук сокровищ размером с собор",
    adds: "+200 жилья, 💍, Королевский экспресс, Крысиный экспресс и коронация",
  },
};

export const ZONE_ORDER: ZoneId[] = ["burrow", "sewers", "cellars", "metro", "terminal"];

/** «Разведчики вернулись {from}» (EN-4): where from, per zone. */
export const ZONE_FROM: Record<ZoneId, string> = {
  burrow: "из норы у стока",
  sewers: "из Канализации",
  cellars: "из Подвалов",
  metro: "со станции подземки",
  terminal: "с Большого вокзала",
};

/**
 * London districts for migrations: the names of the legacy route (the v1/v2 sequence, then the six v3 districts),
 * index = run. v3 (ENG-11): the route is chosen on the map — read a colony's districts with districtInfo(meta) /
 * districtAt(meta, i) from data/districts.ts; these helpers answer for the legacy route, or for `meta`'s real one.
 */
export const DISTRICTS = LEGACY_DISTRICT_SEQ.map((id) => DISTRICT_DEFS[id].name);

/** The legacy route (no `visited` record). */
const NO_ROUTE: Pick<Meta, "visited"> = { visited: [] };

/** The name of run `index`'s district («Сити», «Сити II» on the second lap); `meta` = this colony's route. */
export function districtName(index: number, meta?: Pick<Meta, "visited">): string {
  return districtAt(meta ?? NO_ROUTE, index).name;
}

export const WEEKDAYS = ["Вт", "Ср", "Чт", "Пт", "Сб", "Вс", "Пн"];
export const WEEKDAYS_FULL = ["вторник", "среда", "четверг", "пятница", "суббота", "воскресенье", "понедельник"];

/** «Обустраивается {loc}»: the locative of each district of the legacy route (EN-10). */
export const DISTRICT_LOC = LEGACY_DISTRICT_SEQ.map((id) => DISTRICT_DEFS[id].loc);

/** The locative of run `index`'s district («в Сити», «в Сити II»); `meta` = this colony's route. */
export function districtLoc(index: number, meta?: Pick<Meta, "visited">): string {
  return districtAt(meta ?? NO_ROUTE, index).loc;
}

/**
 * The trait of run `index`'s district (EN-9). v3 (ENG-11): every district keeps its own trait, ×1.25 per extra lap of
 * London («II» in the name); `meta` = this colony's route, else the legacy one.
 */
export function districtTrait(index: number, meta?: Pick<Meta, "visited">): DistrictTrait {
  return districtAt(meta ?? NO_ROUTE, index).trait;
}

// v3 (ENG-11): the trait table and the lap helpers moved to data/districts.ts
export { DISTRICT_TRAITS, amplifyMods, lapNumeral };
