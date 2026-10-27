import type { Cond, GameState } from "../types";
import { plural } from "../../lib/format";

export function check(s: GameState, c: Cond): boolean {
  if ("always" in c) return true;
  if ("all" in c) return c.all.every((x) => check(s, x));
  if ("any" in c) return c.any.some((x) => check(s, x));
  if ("stat" in c) return s.stats[c.stat] >= c.gte;
  if ("rats" in c) return s.rats >= c.rats;
  if ("building" in c) return s.buildings[c.building] >= c.gte;
  if ("job" in c) return s.jobs[c.job] >= c.gte;
  if ("zone" in c) return !!s.zones[c.zone];
  if ("resEver" in c) return s.resEver[c.resEver] >= c.gte;
  if ("upgrade" in c) return !!s.upgrades[c.upgrade];
  if ("edict" in c) return !!s.meta.edicts[c.edict];
  if ("flag" in c) return !!s.flags[c.flag];
  if ("migrations" in c) return s.meta.migrations >= c.migrations;
  return false;
}

/** Human-readable Russian description of a condition (for "скоро" hints). */
export function describeCond(c: Cond, names: (kind: string, id: string) => string): string {
  if ("always" in c) return "сразу";
  if ("all" in c) return c.all.map((x) => describeCond(x, names)).join(" и ");
  if ("any" in c) return c.any.map((x) => describeCond(x, names)).join(" или ");
  if ("stat" in c) return `${statName(c.stat)}: ${c.gte}`;
  if ("rats" in c) return `${c.rats} ${plural(c.rats, "крыса", "крысы", "крыс")}`;
  if ("building" in c) return `${names("building", c.building)} ур. ${c.gte}`;
  if ("job" in c) return `${c.gte} × ${names("job", c.job)}`;
  if ("zone" in c) return `открыть зону «${names("zone", c.zone)}»`;
  if ("resEver" in c) return c.gte < 1 ? `найти ${names("res", c.resEver)}` : `собрать ${c.gte} ${names("res", c.resEver)}`;
  if ("upgrade" in c) return `улучшение «${names("upgrade", c.upgrade)}»`;
  if ("edict" in c) return `указ «${names("edict", c.edict)}»`;
  if ("flag" in c) return flagName(c.flag);
  if ("migrations" in c)
    return c.migrations <= 1 ? "после первого Великого Переселения" : `после ${c.migrations} ${plural(c.migrations, "переселения", "переселений", "переселений")}`;
  return "?";
}

function statName(k: string): string {
  const m: Record<string, string> = {
    clicks: "кликов",
    trains: "поездов",
    capsules: "капсул",
    sparksHit: "задетых искр",
    cats: "котов",
    catsBeaten: "отогнанных котов",
  };
  return m[k] ?? k;
}

function flagName(f: string): string {
  const m: Record<string, string> = {
    vagrants: "первые крысы",
    hit_crumb_cap: "упереться в лимит крошек",
    first_coin: "первая монетка",
    first_capsule: "первая пневмокапсула",
    first_train: "пережить первый поезд",
    first_cat: "встретить Кота",
    first_rumble: "услышать гул из глубины",
  };
  return m[f] ?? f;
}
