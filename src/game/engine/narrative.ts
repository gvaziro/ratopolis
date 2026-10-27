import { CORONATION_LINES, EDICT_ORDER, EDICTS } from "../data/meta";
import { plural } from "../../lib/format";
import { districtOptions, type DistrictOption } from "../data/districts";
import { WEEKDAYS_FULL } from "../data/zones";
import type { DistrictTrait, EdictId, GameState, LinePair } from "../types";
import { crownsForRun, humanClock } from "./formulas";
import { crownPctPer } from "./metaMath";
import { edictRank } from "./ranks";

/**
 * Story helpers for the ceremonies (EN-3): the human weekday, the coronation line and the migration preview.
 * The calendar matches layout/clock.ts: the first run starts on Tuesday, every migration starts a new day.
 */

/** Human weekday name (lower case) `day` days into a run after `migrations` migrations. */
export function weekdayAt(migrations: number, day: number): string {
  const offset = Math.max(0, Math.floor(migrations + day));
  return WEEKDAYS_FULL[offset % 7];
}

/** Today's human weekday in the current run. */
export function humanWeekday(s: GameState): string {
  return weekdayAt(s.meta.migrations, humanClock(s).day);
}

/** «один вторник», «одна среда», «одно воскресенье». */
function oneOf(weekday: string): string {
  if (weekday === "среда" || weekday === "пятница" || weekday === "суббота") return "одна";
  if (weekday === "воскресенье") return "одно";
  return "один";
}

const ORDINAL_F = [
  "первая",
  "вторая",
  "третья",
  "четвёртая",
  "пятая",
  "шестая",
  "седьмая",
  "восьмая",
  "девятая",
  "десятая",
  "одиннадцатая",
  "двенадцатая",
  "тринадцатая",
  "четырнадцатая",
  "пятнадцатая",
  "шестнадцатая",
  "семнадцатая",
  "восемнадцатая",
  "девятнадцатая",
  "двадцатая",
];

/** «третья» (feminine ordinal, for «коронация»); past 20 — «21-я». */
export function ordinalF(n: number): string {
  const k = Math.max(1, Math.floor(n));
  return ORDINAL_F[k - 1] ?? `${k}-я`;
}

/** Human weeks the colony's story spans: the first run is day 1 and every migration starts a new day (layout/clock.ts). */
export function storyWeeks(migrations: number): number {
  return Math.ceil((Math.max(0, Math.floor(migrations)) + 1) / 7);
}

/** «за неделю» while the story fits into one human week (migrations < 7), else «за 2 недели», «за 5 недель». */
export function weeksText(migrations: number): string {
  const w = storyWeeks(migrations);
  return w <= 1 ? "за неделю" : `за ${w} ${plural(w, "неделю", "недели", "недель")}`;
}

/**
 * The 👤/🐀 line of the coronation (headline, overlay), CORONATION_LINES[n − 1] for the n-th coronation (meta.coronations,
 * counted when the express is finished; past the tenth lines 2–10 come round again), with today's weekday, the
 * ordinal and the span of the story filled in (v3 ENG-11).
 */
export function coronationLine(s: GameState): LinePair {
  const wd = humanWeekday(s);
  const n = Math.max(1, Math.floor(s.meta.coronations));
  const k = CORONATION_LINES.length;
  const line = CORONATION_LINES[n <= k ? n - 1 : 1 + ((n - 2) % (k - 1))];
  const nth = ordinalF(n);
  const fill = (t: string) =>
    t
      .replaceAll("{weekday}", wd)
      .replaceAll("{one}", oneOf(wd))
      .replaceAll("{nth}", nth)
      .replaceAll("{Nth}", nth.charAt(0).toUpperCase() + nth.slice(1))
      .replaceAll("{weeks}", weeksText(s.meta.migrations));
  return { human: fill(line.human), rat: fill(line.rat) };
}

/**
 * What «Великое Переселение» would give right now (PA-6 confirm card): crowns, the crown bonus before/after (in %),
 * the edicts a cheapest-first spree could sign with crowns + gained, the next district, its trait and weekday.
 */
export function migrationPreview(s: GameState): {
  gained: number;
  bonusBefore: number;
  bonusAfter: number;
  affordable: EdictId[];
  /** Edict ranks the same spree reaches afterwards (after the first coronation ever), cheapest first. */
  affordableRanks: { id: EdictId; rank: number }[];
  /** options[0]: the default destination (store.migrate() without an id). */
  nextDistrict: string;
  nextTrait: DistrictTrait;
  weekday: string;
  /** v3 (ENG-11): where the colony may go — up to two districts, options[0] = the default (PAN-2 London map). */
  options: DistrictOption[];
} {
  const gained = crownsForRun(s);
  const crownC = crownPctPer(s.meta) / 100;
  let budget = s.meta.crowns + gained;
  const affordable: EdictId[] = [];
  const unsigned = EDICT_ORDER.filter((id) => !s.meta.edicts[id]).sort((a, b) => EDICTS[a].cost - EDICTS[b].cost);
  for (const id of unsigned) {
    if (EDICTS[id].cost > budget) break;
    budget -= EDICTS[id].cost;
    affordable.push(id);
  }
  // EN-9: then ranks II/III, once ranks are on sale (the first coronation ever)
  const affordableRanks: { id: EdictId; rank: number }[] = [];
  if (s.meta.achievements.coronation !== undefined || s.coronatedThisRun) {
    const rank = (id: EdictId) => (affordable.includes(id) ? 1 : edictRank(s, id)) + affordableRanks.filter((x) => x.id === id).length;
    for (;;) {
      let best: EdictId | null = null;
      let bestCost = Infinity;
      for (const id of EDICT_ORDER) {
        const ranks = EDICTS[id].ranks;
        const r = rank(id);
        if (!ranks || r < 1 || r > ranks.length) continue;
        if (ranks[r - 1].cost < bestCost) {
          bestCost = ranks[r - 1].cost;
          best = id;
        }
      }
      if (!best || bestCost > budget) break;
      budget -= bestCost;
      affordableRanks.push({ id: best, rank: rank(best) + 1 });
    }
  }
  const options = districtOptions(s.meta);
  return {
    gained,
    bonusBefore: s.meta.crownsEver * crownC * 100,
    bonusAfter: (s.meta.crownsEver + gained) * crownC * 100,
    affordable,
    affordableRanks,
    nextDistrict: options[0].name,
    nextTrait: options[0].trait,
    weekday: weekdayAt(s.meta.migrations + 1, 0),
    options,
  };
}
