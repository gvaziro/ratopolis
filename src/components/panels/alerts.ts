/**
 * "New!" bookkeeping for the side panel. A key is "fresh" while game.seen[key] is unset.
 * SidePanel shows a dot on a tab with fresh keys and marks them seen when the tab is left
 * (or after a while on it). Cards show a "новинка" badge for their own fresh key.
 */
import { BUILDINGS } from "@/game/data/buildings";
import { JOBS } from "@/game/data/jobs";
import { EDICT_ORDER, EDICTS, ACHIEVEMENT_ORDER } from "@/game/data/meta";
import { UPGRADE_ORDER, UPGRADES } from "@/game/data/upgrades";
import { buildingVisible, currentExpedition } from "@/game/engine/actions";
import { check } from "@/game/engine/conditions";
import { trainActive } from "@/game/engine/events";
import { canAfford, canMigrate } from "@/game/engine/formulas";
import type { TabId } from "@/game/store";
import { BUILDING_IDS, JOB_IDS, type GameState } from "@/game/types";

/** Sticky reveal flag of each tab (null = always visible). */
export const TAB_REVEAL: Record<TabId, string | null> = {
  buildings: "tab_buildings",
  jobs: "tab_jobs",
  upgrades: "tab_upgrades",
  map: "tab_map",
  schedule: "tab_schedule",
  migration: "tab_migration",
  medals: "tab_medals",
  settings: null,
};

/** Tab order of the panel (hotkeys 1–8 count the revealed ones in this order). */
export const TAB_ORDER: TabId[] = ["buildings", "jobs", "upgrades", "map", "schedule", "migration", "medals", "settings"];

export function tabRevealed(s: GameState, tab: TabId): boolean {
  const k = TAB_REVEAL[tab];
  return k === null || !!s.revealed[k];
}

/** Keys that only matter in the first run (afterwards the player knows the content). */
const FIRST_RUN_ONLY = ["tab_", "b_", "j_", "u_", "sch_"];

export function isFresh(s: GameState, key: string): boolean {
  if (s.seen[key]) return false;
  if (s.meta.migrations > 0 && FIRST_RUN_ONLY.some((p) => key.startsWith(p))) return false;
  return true;
}

/** Fresh keys of one tab. */
export function newKeys(s: GameState, tab: TabId): string[] {
  const out: string[] = [];
  const add = (k: string) => {
    if (isFresh(s, k)) out.push(k);
  };
  if (tab !== "settings" && tabRevealed(s, tab)) add(`tab_${tab}`);
  switch (tab) {
    case "buildings":
      for (const id of BUILDING_IDS) {
        if (!buildingVisible(s, id)) continue;
        add(`b_${id}`);
        if (s.buildings[id] === 0 && canAfford(s, BUILDINGS[id].cost)) add(`ba_${id}`);
      }
      break;
    case "jobs":
      for (const j of JOB_IDS) if (j !== "idle" && check(s, JOBS[j].unlock)) add(`j_${j}`);
      if (s.upgrades.rat_relay) add("jm_ratios");
      if (s.upgrades.tube_orders) add("jm_smart");
      break;
    case "upgrades":
      for (const u of UPGRADE_ORDER) {
        if (s.upgrades[u] || !check(s, UPGRADES[u].unlock)) continue;
        add(`u_${u}`);
        if (canAfford(s, UPGRADES[u].cost)) add(`ua_${u}`);
      }
      break;
    case "map": {
      const z = currentExpedition(s);
      if (z) add(`x_${z}`);
      if (s.upgrades.express_plan) add("x_express");
      break;
    }
    case "schedule":
      for (const id of ["capsule", "metro_train", "royal_express"] as const) if (trainActive(s, id)) add(`sch_${id}`);
      break;
    case "migration":
      if (canMigrate(s)) add("mg_ready");
      for (const e of EDICT_ORDER) if (!s.meta.edicts[e] && s.meta.crowns >= EDICTS[e].cost) add(`e_${e}`);
      break;
    case "medals": {
      // only medals earned during this run (timestamps are lifetime play seconds)
      const runStart = s.meta.lifetime.playSeconds - s.time - 1;
      for (const a of ACHIEVEMENT_ORDER) {
        const at = s.meta.achievements[a];
        if (at !== undefined && at >= runStart) add(`md_${a}`);
      }
      break;
    }
    case "settings":
      break;
  }
  return out;
}
