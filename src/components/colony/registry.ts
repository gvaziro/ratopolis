import type { BuildingId } from "@/game/types";

/** Chambers register a "poke" (spring squash) so flying loot and rats can nudge them imperatively. */
const pokes = new Map<BuildingId, (strength: number) => void>();

export function registerPoke(id: BuildingId, fn: (strength: number) => void): () => void {
  pokes.set(id, fn);
  return () => {
    if (pokes.get(id) === fn) pokes.delete(id);
  };
}

export function pokeChamber(id: BuildingId, strength = 1): void {
  pokes.get(id)?.(strength);
}

/* ------------------------------------------------------------ pausing (CO-1) */

let covered = false;

/** ColonyView sets this while a scene covers the colony (game.scene). */
export function setColonyCovered(v: boolean): void {
  covered = v;
}

/** True while the colony is not worth drawing: a scene sits on top of it or the tab is hidden. rAF loops skip such frames. */
export function colonyPaused(): boolean {
  return covered || (typeof document !== "undefined" && document.hidden);
}

/* ------------------------------------------------------------ off-screen culling (CO-1) */

interface Cullable {
  el: Element;
  y0: number;
  y1: number;
  off: boolean;
}

const cullables = new Set<Cullable>();
let live = { y0: -Infinity, y1: Infinity };

function applyCull(c: Cullable): void {
  const off = c.y1 < live.y0 || c.y0 > live.y1;
  if (off === c.off) return;
  c.off = off;
  if (off) c.el.setAttribute("data-off", "");
  else c.el.removeAttribute("data-off");
}

/**
 * Register a world-space element spanning y0..y1: while it is out of the live range (the view ± one band)
 * it carries data-off, and colonyCss pauses every CSS animation inside it.
 */
export function registerCull(el: Element, y0: number, y1: number): () => void {
  const c: Cullable = { el, y0, y1, off: false };
  cullables.add(c);
  applyCull(c);
  return () => {
    cullables.delete(c);
    el.removeAttribute("data-off");
  };
}

/** Called by ColonyView on camera changes with the live world y-range. */
export function updateCull(y0: number, y1: number): void {
  if (Math.abs(y0 - live.y0) < 1 && Math.abs(y1 - live.y1) < 1) return;
  live = { y0, y1 };
  for (const c of cullables) applyCull(c);
}
