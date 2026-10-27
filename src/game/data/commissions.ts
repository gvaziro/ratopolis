import type { CommissionDef, CommissionId } from "../types";

/**
 * Royal commissions (EN-12): after the coronation the King offers three; each is a RunStats delta measured from
 * the moment it is accepted ("max" ones: the stat must reach the goal after acceptance). A finished commission
 * pays a crown charter (crowns for the run ×1.05 each, at most CHARTER_MULT_CAP: v3 all ten count).
 * v2: offering and completion are wired in EN-12; ids, goals and texts here are final.
 */
export const COMMISSIONS: Record<CommissionId, CommissionDef> = {
  three_gold: { id: "three_gold", name: "Три золотых улова", icon: "🥇", stat: "goldHauls", goal: 3, mode: "delta", desc: "Взять золото или выше в трёх поездах" },
  whiskers_twice: { id: "whiskers_twice", name: "Дважды по усам", icon: "🥊", stat: "catsBeaten", goal: 2, mode: "delta", desc: "Отогнать Кота два раза" },
  pipe_splinters: { id: "pipe_splinters", name: "Щепки от дудки", icon: "🎶", stat: "pipersBroken", goal: 1, mode: "delta", desc: "Сломать дудку Крысолову" },
  purse_season: { id: "purse_season", name: "Кошельковый сезон", icon: "👛", stat: "purses", goal: 3, mode: "delta", desc: "Подобрать три оброненных кошелька" },
  frenzy5: { id: "frenzy5", name: "Пять авралов", icon: "🔥", stat: "frenzies", goal: 5, mode: "delta", desc: "Пять раз довести Суету до Аврала" },
  dry_paws2: { id: "dry_paws2", name: "Шлюзовая вахта", icon: "🌧️", stat: "downpoursWon", goal: 2, mode: "delta", desc: "Дважды закрыть все шлюзы во время ливня" },
  // the plan said capsules +5, but capsules stop once the Metro is open (always true after the coronation)
  // v3 (ENG-11): «Королевская почта» 📯 promised capsules; the stat is the Royal Express
  royal_mail: { id: "royal_mail", name: "Почётный караул", icon: "🚆", stat: "expresses", goal: 2, mode: "delta", desc: "Встретить два Королевских экспресса" },
  lamplighter: { id: "lamplighter", name: "Фонарщик", icon: "🏮", stat: "lanternMax", goal: 12, mode: "max", desc: "Поймать 12 предметов в луче фонаря за один поезд" },
  bullseye: { id: "bullseye", name: "В яблочко", icon: "🎯", stat: "hookPerfects", goal: 1, mode: "delta", desc: "Идеальный бросок крюка" },
  // v3 (ENG-3): retired from the offers (housing is frozen after the coronation: 200 births took the rest of the run);
  // an old save that holds it keeps it, and the reduced goal lets it finish
  replenish: { id: "replenish", name: "Пополнение", icon: "🍼", stat: "births", goal: 60, mode: "delta", desc: "60 новорождённых крысят" },
  wagon: { id: "wagon", name: "Ещё вагон", icon: "🚃", stat: "wagons", goal: 1, mode: "delta", desc: "Пристроить к экспрессу ещё один вагон" },
  quick_hand: { id: "quick_hand", name: "Быстрая лапа", icon: "🖐️", stat: "bestCombo", goal: 30, mode: "max", desc: "Комбо ×30 в поезде" },
  clean_three: { id: "clean_three", name: "Три чистых вагона", icon: "🚃", stat: "cleanCars", goal: 3, mode: "delta", desc: "Очистить три вагона за забег" },
};

export const COMMISSION_ORDER = Object.keys(COMMISSIONS) as CommissionId[];

/** Commissions the King no longer offers (v3 ENG-3); kept in COMMISSIONS so old saves that hold one still load and finish. */
export const RETIRED_COMMISSIONS: readonly CommissionId[] = ["replenish"];

/** «Ещё вагон» is offered only while the next wagon is this close (s of potential production, ENG-3). */
export const WAGON_OFFER_MAX_SEC = 480;

/** Charters cap and the crowns multiplier per charter (EN-12). v3 (ENG-3): the cap is 1.05^10, so all ten count. */
export const CHARTER_MAX = 10;
export const CHARTER_MULT = 1.05;
export const CHARTER_MULT_CAP = 1.63;
