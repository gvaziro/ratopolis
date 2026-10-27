/**
 * What the building card's button buys (BuildingCard, PA-1), kept pure for vitest (cardBuy.test.ts): ×1, ×10 (always
 * 10, honest) or «Макс» (as many as affordable), never past the engine's own cap — formulas.buildingMaxLevel, so
 * the boiler's two extra levels in «Гончарни» (v3 ENG-4) can be bought from the card, not only by the elder.
 */
import { buildingCostFor } from "@/game/engine/economy";
import { buildingCost, buildingMaxLevel, buyCount } from "@/game/engine/formulas";
import type { Amounts, BuildingId, BuyMode, GameState } from "@/game/types";

/** Levels a click buys in this mode and their price; k = 0 — the building is at its cap («макс.»). */
export function cardPurchase(s: GameState, id: BuildingId, mode: BuyMode): { k: number; ok: boolean; raw: Amounts } {
  const lv = s.buildings[id];
  const room = buildingMaxLevel(s, id) - lv;
  if (room <= 0) return { k: 0, ok: false, raw: {} };
  if (mode === 10) {
    const k = Math.min(10, room);
    return { k, ok: buyCount(s, id, 10) === k, raw: buildingCostFor(s, id, k) };
  }
  const can = buyCount(s, id, mode);
  const k = Math.max(1, Math.min(can || 1, room));
  return { k, ok: can > 0, raw: buildingCost(id, lv, k) };
}
