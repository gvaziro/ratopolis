import { COMMISSIONS } from "../data/commissions";
import { ACHIEVEMENTS } from "../data/meta";
import { EDICT_IDS, type AchievementId, type CommissionDef, type CommissionId, type GameState, type RunStats } from "../types";

/**
 * Progress readouts for the medal cabinet and the King's commissions (EN-11, EN-12). Pure.
 */

/** Current value of a progress stat path used by ACHIEVEMENTS[id].progress.stat. */
export function progressStat(s: GameState, stat: string): number {
  if (stat.startsWith("lifetime.")) {
    const k = stat.slice(9) as keyof GameState["meta"]["lifetime"];
    return s.meta.lifetime[k] ?? 0;
  }
  if (stat.startsWith("stats.")) return s.stats[stat.slice(6) as keyof RunStats] ?? 0;
  switch (stat) {
    case "rats":
      return s.rats;
    case "migrations":
      return s.meta.migrations;
    case "district":
      // v3 (ENG-11): districts moved through on the map («Весь Лондон наш»: 5)
      return Math.max(0, (s.meta.visited?.length ?? s.meta.district + 1) - 1);
    case "crownsEver":
      return s.meta.crownsEver;
    case "coronations":
      return s.meta.coronations;
    case "wagons":
      return s.express.wagons;
    case "edicts":
      return EDICT_IDS.filter((e) => s.meta.edicts[e]).length;
    case "seenEvents":
      return s.meta.seenEvents.length;
    case "curios":
      return s.meta.curios.length;
    default:
      return 0;
  }
}

/** Counter medals: {cur, goal} (cur capped at goal; an earned medal reads full). null for one-off medals. */
export function achievementProgress(s: GameState, id: AchievementId): { cur: number; goal: number } | null {
  const p = ACHIEVEMENTS[id].progress;
  if (!p) return null;
  if (s.meta.achievements[id] !== undefined) return { cur: p.goal, goal: p.goal };
  return { cur: Math.max(0, Math.min(p.goal, Math.floor(progressStat(s, p.stat)))), goal: p.goal };
}

/** Raw value of a commission's stat right now. */
export function commissionStat(s: GameState, def: CommissionDef): number {
  return def.stat === "wagons" ? s.express.wagons : s.stats[def.stat];
}

/** The accepted commission's progress {id, cur, goal} (cur capped at goal), or null when none is active. */
export function commissionProgress(s: GameState): { id: CommissionId; cur: number; goal: number } | null {
  const a = s.commissions?.active;
  if (!a) return null;
  const def = COMMISSIONS[a.id];
  const v = commissionStat(s, def);
  // v2: EN-12 may snapshot "max" commissions differently (a run max reached before acceptance)
  const cur = def.mode === "delta" ? v - a.base : v;
  return { id: a.id, cur: Math.max(0, Math.min(def.goal, Math.floor(cur))), goal: def.goal };
}
