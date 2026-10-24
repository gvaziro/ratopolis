import type { ZoneDef, ZoneId } from "../types";

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
    expedition: { cost: { coins: 11000, buttons: 3500, gears: 650 }, rats: 55 },
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
    housingBonus: 80,
    palette: { bg: "#2a2833", accent: "#cfcfc8", glow: "#8b1e1e", detail: "#6b6b78" },
    sky: "Вход в метро, перрон, маленькие люди в цилиндрах",
    humanLine: "Поезд в 8:15, опять задымил весь перрон",
    ratLine: "Бог Грома проходит каждые четыре минуты и оставляет дары",
    adds: "+80 жилья, 🪨💨🔔🛤️, ПОЕЗДА, Крысолов, Великое Переселение",
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
