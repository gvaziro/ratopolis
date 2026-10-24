/**
 * Human-scale calendar helpers for the HUD: «Вт, 18 окт 1887 · 07:14».
 * The run starts on Tuesday 18 October 1887 (it really was a Tuesday); every migration starts a new day.
 */
import { HUMAN_ACTIVITIES } from "@/game/data/headlines";
import { WEEKDAYS, WEEKDAYS_FULL } from "@/game/data/zones";
import { humanClock } from "@/game/engine/formulas";
import type { GameState } from "@/game/types";

const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const MONTHS_FULL = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

export interface HumanDate {
  wd: string;
  wdFull: string;
  date: number;
  month: string;
  monthFull: string;
  year: number;
}

/** Calendar date `migrations + day` days after Tue 18 Oct 1887. */
export function humanDate(migrations: number, day: number): HumanDate {
  const offset = Math.max(0, Math.floor(migrations + day));
  const d = new Date(Date.UTC(1887, 9, 18 + offset));
  return {
    wd: WEEKDAYS[offset % 7],
    wdFull: WEEKDAYS_FULL[offset % 7],
    date: d.getUTCDate(),
    month: MONTHS[d.getUTCMonth()],
    monthFull: MONTHS_FULL[d.getUTCMonth()],
    year: d.getUTCFullYear(),
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Human clock at an arbitrary run time (e.g. a headline's timestamp). */
export function clockAt(time: number): { day: number; hh: number; mm: number; totalMin: number } {
  // humanClock only reads `time`
  return humanClock({ time } as GameState);
}

export function hhmm(time: number): string {
  const c = clockAt(time);
  return `${pad(c.hh)}:${pad(c.mm)}`;
}

/** Full header line «Вт, 18 окт 1887 · 07:14». */
export function clockLine(time: number, migrations: number): string {
  const c = clockAt(time);
  const d = humanDate(migrations, c.day);
  return `${d.wd}, ${d.date} ${d.month} ${d.year} · ${pad(c.hh)}:${pad(c.mm)}`;
}

/** What the humans upstairs are doing at this hour. */
export function humanActivity(hh: number): string {
  // before 05:00 the humans are still asleep from the night before
  let act = HUMAN_ACTIVITIES[HUMAN_ACTIVITIES.length - 1][1];
  for (const [h, a] of HUMAN_ACTIVITIES) if (hh >= h) act = a;
  return act;
}

export { pad };
