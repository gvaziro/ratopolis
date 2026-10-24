import { EDICT_ORDER, EDICTS } from "../data/meta";
import { WEEKDAYS_FULL, districtName, districtTrait } from "../data/zones";
import type { DistrictTrait, EdictId, GameState, LinePair } from "../types";
import { crownsForRun, humanClock } from "./formulas";
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

const ORDINAL_F = ["первая", "вторая", "третья", "четвёртая", "пятая", "шестая", "седьмая", "восьмая", "девятая", "десятая"];

/**
 * The 👤/🐀 line of the coronation (headline, overlay): the first one is «Для людей это одна среда. Для крыс — целая
 * история.», later ones vary with meta.coronations (counted when the express is finished).
 */
export function coronationLine(s: GameState): LinePair {
  const wd = humanWeekday(s);
  const one = oneOf(wd);
  const n = Math.max(1, s.meta.coronations);
  if (n === 1) return { human: `Для людей это ${one} ${wd}.`, rat: "Для крыс — целая история." };
  if (n % 2 === 0) {
    const nth = ORDINAL_F[n - 1] ?? `${n}-я`;
    return { human: `Для людей — ещё ${one} ${wd}.`, rat: `Для крыс — ${nth} коронация за неделю.` };
  }
  return { human: `Наверху ${wd}, люди ничего не заметили.`, rat: "Король привыкает к короне. Корона — к Королю." };
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
  nextDistrict: string;
  nextTrait: DistrictTrait;
  weekday: string;
} {
  const gained = crownsForRun(s);
  const crownC = s.meta.edicts.kings_favor ? 0.03 : 0.02;
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
  const next = s.meta.district + 1;
  return {
    gained,
    bonusBefore: s.meta.crownsEver * crownC * 100,
    bonusAfter: (s.meta.crownsEver + gained) * crownC * 100,
    affordable,
    affordableRanks,
    nextDistrict: districtName(next),
    nextTrait: districtTrait(next),
    weekday: weekdayAt(s.meta.migrations + 1, 0),
  };
}
