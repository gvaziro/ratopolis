/**
 * What the 👁 scale's tooltip (Header SuspicionTip, SH-3) shows, from hints.suspicionInfo; pure for vitest
 * (suspicionTip.test.ts). v3 (ENG-8): the human vigilance line goes in too, so the price of a high 👁 in train and
 * capsule loot is seen before the train, not only on the haul card after it.
 */
import type { Derived } from "@/game/engine/derive";
import { suspicionInfo } from "@/game/engine/hints";
import type { GameState } from "@/game/types";

export interface SuspicionTipModel {
  pct: number;
  perMin: number;
  threshold: number;
  /** Seconds to the Ratcatcher, rounded; −1 = not coming at this rate. */
  eta: number;
  reducers: string;
  /** «Бдительность людей: −12% к добыче поездов (выше 50 👁)», or the rule while nothing is lost yet. */
  vig: string;
  /** The humans keep part of the loot right now (the line is a warning). */
  lost: boolean;
}

export function suspicionTipModel(s: GameState, d: Derived): SuspicionTipModel {
  const i = suspicionInfo(s, d);
  return {
    pct: Math.floor(i.pct),
    perMin: i.perMin,
    threshold: i.threshold,
    eta: i.etaSec === null ? -1 : Math.round(i.etaSec),
    reducers: i.reducers.map((r) => `${r.label} ${r.amount}`).join(", "),
    vig: i.vigilanceLine,
    lost: i.vigilance > 0,
  };
}
