import { CHARTER_MAX, COMMISSIONS, COMMISSION_ORDER, RETIRED_COMMISSIONS, WAGON_OFFER_MAX_SEC } from "../data/commissions";
import type { CommissionId, EngineCtx, GameState } from "../types";
import { expressCost } from "./actions";
import { news, toast } from "./core";
import { derive } from "./derive";
import { projectBottleneck } from "./potential";
import { commissionProgress, commissionStat } from "./progress";
import { sealOn } from "./ranks";
import { rand } from "./rng";

/**
 * Royal commissions after the coronation (EN-12): the King offers three, one can be accepted at a time, a finished
 * one pays a crown charter (crowns for the run ×1.05 each, at most CHARTER_MULT_CAP) and three new ones are offered.
 */

/** Crowns multiplier of the charters earned this run (moved to metaMath.ts; re-exported for v2 imports). */
export { charterAtCap, charterMult } from "./metaMath";

/** Commissions that need the Cat or the Ratcatcher, who never come under Печать Тишины. */
const NEEDS_NOISE: readonly CommissionId[] = ["whiskers_twice", "pipe_splinters"];

/** The commission can be finished in this state (not one of NEEDS_NOISE under Печать Тишины). */
export function commissionPossible(s: GameState, id: CommissionId): boolean {
  return !(NEEDS_NOISE.includes(id) && sealOn(s, "silence"));
}

/**
 * Seconds of potential production (goals.projectBottleneck) until the next express wagon is paid; 0 when nothing is
 * missing. v3 (ENG-3): «Ещё вагон» is offered only while this is at most WAGON_OFFER_MAX_SEC.
 */
export function nextWagonEta(s: GameState): number {
  if (!s.upgrades.express_plan) return Infinity;
  return projectBottleneck(s, derive(s), expressCost(s), s.express.progress)?.etaSec ?? 0;
}

/**
 * Offer three commissions (seeded), never the one just finished, a retired one (RETIRED_COMMISSIONS), one that cannot
 * be finished (commissionPossible), a "max" one whose stat already stands at the goal (it would complete the moment it
 * is accepted), nor «Ещё вагон» while the next wagon is more than WAGON_OFFER_MAX_SEC away (v3 ENG-3).
 */
export function offerCommissions(s: GameState, skip?: CommissionId): void {
  const pool = COMMISSION_ORDER.filter((id) => {
    if (id === skip || RETIRED_COMMISSIONS.includes(id) || !commissionPossible(s, id)) return false;
    const def = COMMISSIONS[id];
    if (def.mode === "max" && commissionStat(s, def) >= def.goal) return false;
    return id !== "wagon" || nextWagonEta(s) <= WAGON_OFFER_MAX_SEC;
  });
  const offered: CommissionId[] = [];
  while (offered.length < 3 && pool.length) offered.push(pool.splice(Math.floor(rand(s) * pool.length), 1)[0]);
  const done = s.commissions?.done ?? 0;
  s.commissions = { offered, done };
}

/** Housekeeping: pay the active commission once its goal is reached. */
export function checkCommission(s: GameState, ctx: EngineCtx): void {
  const c = s.commissions;
  if (!c?.active) return;
  const p = commissionProgress(s);
  if (!p || p.cur < p.goal) return;
  const id = c.active.id;
  const def = COMMISSIONS[id];
  delete c.active;
  c.done++;
  s.charters = Math.min(CHARTER_MAX, s.charters + 1);
  ctx.fx.push({ k: "commission", id, done: true });
  news(s, "commission_done", { name: def.name }, ctx);
  // the shell shows the toast for Fx commission (done)
  offerCommissions(s, id);
}

/**
 * Give up the active commission: no charter, three new offers (without it). Also called when a newly sealed
 * Печать Тишины makes the active one impossible. False when none is active.
 */
export function abandonCommission(s: GameState, ctx?: EngineCtx): boolean {
  const id = s.commissions?.active?.id;
  if (!id) return false;
  offerCommissions(s, id);
  toast(ctx, `Поручение «${COMMISSIONS[id].name}» возвращено Королю`, COMMISSIONS[id].icon, "info");
  return true;
}
