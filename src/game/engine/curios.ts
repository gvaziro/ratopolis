import { CURIOS, CURIO_LIFE_ADD, CURIO_SALT, CURIO_SETS, TROPHY_CURIO, curioSetDone, rollCurio, type CurioPick } from "../data/curios";
import { CURIO_IDS, type CatchItem, type CurioId, type EngineCtx, type GameState, type Scene } from "../types";
import { award, pushNews, toast } from "./core";
import { hash01 } from "./rng";

/**
 * «Кунсткамера Короля» in the engine (v3 ENG-10): the curio item of a scene and the catch. Which curio drops where is
 * pure data (data/curios.ts: rollCurio, curioCandidates, the set perks); events.ts calls these when it builds a scene,
 * resolves a catch, a grate-rain shiny or a cat / Ratcatcher win.
 */

/** The v2 trophy string a curio stands for (meta.trophies is still written for old UIs). */
const TROPHY_OF: Partial<Record<CurioId, string>> = Object.fromEntries(Object.entries(TROPHY_CURIO).map(([t, id]) => [id, t]));

/** The 👤/🐀 news pair of a new exhibit. */
export function curioNews(id: CurioId): [string, string] {
  const c = CURIOS[id];
  return [`👤 ${c.human}`, `🐀 В Кунсткамере пополнение: «${c.name}»`];
}

/**
 * The colony gets curio `id` for good: meta.curios (and the v2 trophy), Fx curio, the news pair, the medals, and a
 * toast when it completes a set (its perk starts at once). False when it is already owned (or unknown).
 */
export function catchCurio(s: GameState, id: CurioId, ctx?: EngineCtx): boolean {
  const c = CURIOS[id];
  if (!c || s.meta.curios.includes(id)) return false;
  s.meta.curios.push(id);
  const trophy = TROPHY_OF[id];
  if (trophy && !s.meta.trophies.includes(trophy)) s.meta.trophies.push(trophy);
  ctx?.fx.push({ k: "curio", id });
  for (const line of curioNews(id)) pushNews(s, line, ctx);
  award(s, "first_curio", ctx);
  if (s.meta.curios.length >= CURIO_IDS.length) award(s, "curio_full", ctx);
  if (curioSetDone(s, c.owner)) {
    const set = CURIO_SETS[c.owner];
    toast(ctx, `Набор «${set.name}» собран! ${set.perk}`, set.icon, "gold");
  }
  return true;
}

/**
 * Roll this scene's curio (rollCurio: a hash of the scene seq, no RNG draw) and add it as a rating-neutral item —
 * value 0, weight 0, alive CURIO_LIFE_ADD s longer — in its car, at a moment of that car's window picked by another
 * hash. Returns the pick (null: nothing dropped). The scene's other items are untouched.
 */
export function addCurioItem(s: GameState, sc: Scene): CurioPick | null {
  const pick = rollCurio(s, sc);
  if (!pick || !sc.cars[pick.car]) return null;
  const car = sc.cars[pick.car];
  let lo = Infinity;
  let hi = -Infinity;
  for (const id of car.itemIds) {
    const t = sc.items[id]?.t;
    if (t === undefined) continue;
    lo = Math.min(lo, t);
    hi = Math.max(hi, t);
  }
  if (!Number.isFinite(lo)) lo = hi = 0.5;
  const item: CatchItem = {
    id: sc.items.length,
    car: pick.car,
    // a resource the car drops anyway (the UI draws the curio's own tag; the value is 0)
    res: sc.items[car.itemIds[0]]?.res ?? "coins",
    value: 0,
    weight: 0,
    t: lo + hash01(sc.seq, CURIO_SALT + 2) * (hi - lo),
    curio: pick.id,
    lifeAdd: CURIO_LIFE_ADD,
  };
  sc.items.push(item);
  car.itemIds.push(item.id);
  return pick;
}
