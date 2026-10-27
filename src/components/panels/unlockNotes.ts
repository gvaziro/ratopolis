/**
 * The side panel's tab list and its «Открыто» notes (PA-5): which fresh keys announce an unlock and what each note
 * says. Every note keeps v2's full line (`text`) and carries its parts for the short toast (ENG-12, SHL-1, PAN-1):
 * `icon`, `name` and one line of what it gives (`desc`). Pure: SidePanel sends the notes, the tests read them here.
 */
import { BUILDINGS } from "@/game/data/buildings";
import { JOBS } from "@/game/data/jobs";
import { UPGRADES } from "@/game/data/upgrades";
import type { BuildingId, GameState, JobId, TabId, UpgradeId } from "@/game/types";
import { firstSentence, newKeys, tabRevealed } from "./alerts";

export interface TabMeta {
  id: TabId;
  icon: string;
  label: string;
  /** The phone tab bar's short caption. */
  caption: string;
}

export const TABS: TabMeta[] = [
  { id: "buildings", icon: "🏗️", label: "Постройки", caption: "Стройка" },
  { id: "jobs", icon: "🐀", label: "Работы", caption: "Работы" },
  { id: "upgrades", icon: "🔬", label: "Улучшения", caption: "Наука" },
  { id: "map", icon: "🗺️", label: "Карта", caption: "Карта" },
  { id: "schedule", icon: "🚂", label: "Расписание", caption: "Поезда" },
  { id: "migration", icon: "👑", label: "Переселение", caption: "Трон" },
  { id: "medals", icon: "🏅", label: "Медали", caption: "Медали" },
  { id: "settings", icon: "⚙", label: "", caption: "" },
];
export const TAB_BY_ID = Object.fromEntries(TABS.map((t) => [t.id, t])) as Record<TabId, TabMeta>;

/** One «Открыто» note: the tab its «Открыть» opens, the full line and its parts. */
export interface UnlockItem {
  key: string;
  tab: TabId;
  /** The whole line, as in v2: «🎩 Новая работа: Карманник — приносит 🪙». */
  text: string;
  icon: string;
  /** «Карманник», «Вкладка «Карта»». */
  name: string;
  /** What it gives, in one line (no full stop). */
  desc?: string;
}

/** Fresh keys that announce an unlock (tabs, jobs, buildings, upgrades), first run only (isFresh). */
export function unlockKeys(s: GameState): string[] {
  const out: string[] = [];
  for (const t of TABS) {
    if (t.id === "settings" || !tabRevealed(s, t.id)) continue;
    for (const k of newKeys(s, t.id)) if (/^(tab|j|b|u)_/.test(k)) out.push(k);
  }
  return out;
}

/** The note for an unlock key (`tab_map`, `j_pickpocket`, `b_pantry`, `u_sharp_teeth`), null for anything else. */
export function unlockItem(key: string): UnlockItem | null {
  const [kind, ...rest] = key.split("_");
  const item = unlockParts(kind, rest.join("_"));
  if (!item) return null;
  const over = UNLOCK_OVERRIDE[key];
  const desc = over?.desc ?? item.desc;
  // the full line stays as it was in v2 (a tab's note has no tail there)
  const tail = kind !== "tab" && desc ? ` — ${desc}` : "";
  return { key, tab: item.tab, icon: item.icon, name: item.name, desc, text: over?.text ?? `${item.icon} ${item.lead}${tail}` };
}

function unlockParts(kind: string, id: string): { tab: TabId; icon: string; name: string; lead: string; desc?: string } | null {
  if (kind === "tab") {
    const t = TAB_BY_ID[id as TabId];
    return t && t.label ? { tab: t.id, icon: t.icon, name: `Вкладка «${t.label}»`, lead: `Открыта вкладка «${t.label}»`, desc: TAB_DESC[t.id] } : null;
  }
  if (kind === "j") {
    const j = JOBS[id as JobId];
    return j ? { tab: "jobs", icon: j.icon, name: j.name, lead: `Новая работа: ${j.name}`, desc: firstSentence(j.desc) } : null;
  }
  if (kind === "b") {
    const b = BUILDINGS[id as BuildingId];
    return b ? { tab: "buildings", icon: b.icon, name: b.name, lead: `Открыто: ${b.name}`, desc: firstSentence(b.desc) } : null;
  }
  if (kind === "u") {
    const u = UPGRADES[id as UpgradeId];
    return u ? { tab: "upgrades", icon: u.icon, name: u.name, lead: `Открыто: ${u.name}`, desc: firstSentence(u.effect) } : null;
  }
  return null;
}

/** What a freshly opened tab is for (the short toast's line). */
const TAB_DESC: Partial<Record<TabId, string>> = {
  buildings: "сметы, гнёзда и кладовки",
  jobs: "кто где трудится и куда идут новорождённые",
  upgrades: "чертежи изобретателей",
  map: "экспедиции в новые зоны",
  schedule: "поезда и капсулы по часам",
  migration: "трон, указы и Великое Переселение",
  medals: "кабинет наград колонии",
};

/** Hand-written notes for the first unlocks a newcomer meets (`text` replaces the whole line, `desc` its tail). */
const UNLOCK_OVERRIDE: Record<string, { text?: string; desc?: string }> = {
  j_pickpocket: { desc: "приносит 🪙" },
  j_scavenger: { desc: "пуговицы и проволока" },
  b_pantry: { text: "🥫 Можно строить Кладовку — лимит 🍞 +150", desc: "лимит 🍞 +150" },
  tab_jobs: { text: "🐀 Открыта вкладка «Работы»" },
};
