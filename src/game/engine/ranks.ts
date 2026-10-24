import { EDICTS } from "../data/meta";
import type { EdictId, GameState, SealId } from "../types";

/**
 * Meta-depth lookups (EN-9) with no engine dependencies, so derive.ts, state.ts and the events can all read them.
 */

/** Rank of an edict: 0 = unsigned, 1 = signed, 2–3 = ranks II/III (EN-9). Old saves without edictRank read as rank 1. */
export function edictRank(s: Pick<GameState, "meta">, id: EdictId): number {
  if (!s.meta.edicts[id]) return 0;
  const max = 1 + (EDICTS[id].ranks?.length ?? 0);
  return Math.max(1, Math.min(max, Math.floor(s.meta.edictRank[id] ?? 1)));
}

/** The rank's value from `vals` (vals[0] = rank I), or `none` while the edict is unsigned. */
export function byRank<T>(s: Pick<GameState, "meta">, id: EdictId, vals: readonly T[], none: T): T {
  const r = edictRank(s, id);
  return r <= 0 ? none : vals[Math.min(vals.length, r) - 1];
}

/** The active Great Seal is `id`. */
export function sealOn(s: Pick<GameState, "meta">, id: SealId): boolean {
  return s.meta.seal === id && s.meta.sealsOwned.includes(id);
}

/** Rank values of the ranked edicts (rank I, II, III), GDD 10.3 v2. */
export const RANKED = {
  royal_litter: { rats: [10, 25, 60], nests: [5, 10, 20], crumbs: [50, 500, 5000] },
  ancestral_paws: [3, 6, 12],
  golden_whiskers: { freq: [2, 3, 4], effect: [1.5, 2, 2.5] },
  eternal_night_shift: [0.25, 0.35, 0.45],
  felt_soles: [0.5, 0.35, 0.25],
  timetable_in_head: [2, 3, 4],
  lucky_tail: [2, 2.5, 3],
} as const;
