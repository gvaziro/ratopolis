import type { DistrictMods, DistrictTrait, ZoneDef, ZoneId } from "../types";

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
    expedition: { cost: { coins: 11000, buttons: 3500, gears: 650 }, rats: 50 },
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
    expedition: { cost: { coins: 90000, gears: 5000, cheese: 3000, blueprints: 200 }, rats: 120 },
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

/** London districts for migrations. */
export const DISTRICTS = ["Уайтчепел", "Саутварк", "Ламбет", "Блумсбери", "Мэйфэр", "Вестминстер"];

export function districtName(index: number): string {
  if (index < DISTRICTS.length) return DISTRICTS[index];
  const n = index - DISTRICTS.length + 2;
  return `Вестминстер ${toRoman(n)}`;
}

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

export const WEEKDAYS = ["Вт", "Ср", "Чт", "Пт", "Сб", "Вс", "Пн"];
export const WEEKDAYS_FULL = ["вторник", "среда", "четверг", "пятница", "суббота", "воскресенье", "понедельник"];

/** «Обустраивается {loc}»: the locative of each district (EN-10); index ≥ 6 → Вестминстер. */
export const DISTRICT_LOC = ["в Уайтчепеле", "в Саутварке", "в Ламбете", "в Блумсбери", "в Мэйфэре", "в Вестминстере"];

export function districtLoc(index: number): string {
  return DISTRICT_LOC[Math.max(0, Math.min(DISTRICT_LOC.length - 1, Math.floor(index)))];
}

/**
 * London district traits (EN-9): a perk and a quirk per district, applied in derive.ts and the event timers.
 * Index = meta.district. v2: the effects are applied by EN-9; this table and districtTrait() are final.
 */
export const DISTRICT_TRAITS: DistrictTrait[] = [
  { name: "Туман", icon: "🌫️", perk: "Ничего особенного — только туман гуще похлёбки", quirk: "Никаких сюрпризов", mods: {} },
  {
    name: "Боро-маркет",
    icon: "🧺",
    perk: "Рынок чаще, 🧀 ×1.5",
    quirk: "Кот наглее: проверки ×1.3",
    mods: { marketInterval: [240, 300], res: { cheese: 1.5 }, catCheckMult: 1.3 },
  },
  {
    name: "Гончарни",
    icon: "🏺",
    perk: "⚙️ ×1.5, запас 💨 ×1.5",
    quirk: "Капсулы реже: раз в 3 минуты",
    mods: { res: { gears: 1.5 }, steamBufferMult: 1.5, capsuleInterval: 180 },
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
    quirk: "Крысолов приходит уже при 80% подозрения",
    mods: { res: { coins: 1.5 }, purseFreqMult: 2, ratcatcherThreshold: 80 },
  },
  {
    name: "Биг-Бен",
    icon: "🕰️",
    perk: "Королевский экспресс чаще (×0.6 интервал), 💍 ×1.5",
    quirk: "Подозрение растёт ×1.4",
    mods: { expressIntervalMult: 0.6, res: { trinkets: 1.5 }, suspicionMult: 1.4 },
  },
];

/** Scale a multiplier's effect size: 1.5 → 1 + 0.5·k, 0.6 → 1 − 0.4·k. */
function amplify(m: number, k: number): number {
  return 1 + (m - 1) * k;
}

/**
 * The trait of district `index`. Districts ≥ 6 cycle traits 1–5 with perk and quirk magnitudes ×1.25
 * (the name gets «II», «III», …).
 */
export function districtTrait(index: number): DistrictTrait {
  const i = Math.max(0, Math.floor(index));
  if (i < DISTRICT_TRAITS.length) return DISTRICT_TRAITS[i];
  const base = DISTRICT_TRAITS[1 + ((i - DISTRICT_TRAITS.length) % (DISTRICT_TRAITS.length - 1))];
  const k = 1.25;
  const m = base.mods;
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
  const lap = Math.floor((i - DISTRICT_TRAITS.length) / (DISTRICT_TRAITS.length - 1)) + 2;
  return { ...base, name: `${base.name} ${toRoman(lap)}`, perk: `${base.perk} — и ещё на четверть сильнее`, quirk: `${base.quirk} — и на четверть злее`, mods };
}
