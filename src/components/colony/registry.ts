import type { BuildingId } from "@/game/types";
import { ecoActive } from "@/lib/eco";

/** Chambers register a "poke" (spring squash) so flying loot and rats can nudge them imperatively. */
const pokes = new Map<BuildingId, (strength: number) => void>();

export function registerPoke(id: BuildingId, fn: (strength: number) => void): () => void {
  pokes.set(id, fn);
  return () => {
    if (pokes.get(id) === fn) pokes.delete(id);
  };
}

export function pokeChamber(id: BuildingId, strength = 1): void {
  // «Экономия батареи»: the ambient nudges (a rat home, a work beat) would keep hundreds of chambers bouncing;
  // the ones the player caused (a delivery, a buy) stay
  if (strength < 0.3 && ecoActive()) return;
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
 * Register a world-space element spanning y0..y1: while it is out of the live range (the view ± a margin)
 * it carries data-off, and colonyCss pauses every CSS animation on and inside it.
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

/** World units a loop carries an item beyond its geometry: steam rises and swells, crumbs and drips fall (--fall). */
function motionPad(el: Element): { up: number; down: number } {
  let up = 0;
  let down = 0;
  for (const m of [el, ...Array.from(el.querySelectorAll(".cv-steam,.cv-fall,.cv-drip"))]) {
    if (m.matches(".cv-steam")) up = 100;
    else if (m.matches(".cv-fall,.cv-drip")) down = Math.max(down, parseFloat((m as SVGElement).style.getPropertyValue("--fall")) || 150);
  }
  return { up, down };
}

/**
 * Register the animated items of a tall world-space group one by one: each child of `root` holding a cv- class, at
 * its own y-range (geometry plus its loop's travel; `worldY` = world y of root's origin). A band or a chamber then runs
 * only the loops near the view, not all its drips, gears and steam while a sliver of it shows. Measured once (getBBox,
 * the item's own transform attribute — never a running CSS transform) when the group mounts or its art changes.
 */
export function registerCullItems(root: SVGGElement, worldY: number): () => void {
  const offs: (() => void)[] = [];
  for (const el of Array.from(root.children)) {
    if (!(el instanceof SVGGraphicsElement) || !(el.matches('[class*="cv-"]') || el.querySelector('[class*="cv-"]'))) continue;
    const b = el.getBBox();
    // item space → root space (multiplied by hand: consolidate() would rewrite the attribute)
    const list = el.transform.baseVal;
    let t = new DOMMatrix();
    for (let i = 0; i < list.numberOfItems; i++) t = t.multiply(list.getItem(i).matrix);
    const ys = [b.x, b.x + b.width].flatMap((x) => [b.y, b.y + b.height].map((y) => t.b * x + t.d * y + t.f));
    const pad = motionPad(el);
    offs.push(registerCull(el, worldY + Math.min(...ys) - pad.up, worldY + Math.max(...ys) + pad.down));
  }
  return () => offs.forEach((off) => off());
}

/** Called by ColonyView on camera changes with the live world y-range. */
export function updateCull(y0: number, y1: number): void {
  if (Math.abs(y0 - live.y0) < 1 && Math.abs(y1 - live.y1) < 1) return;
  live = { y0, y1 };
  for (const c of cullables) applyCull(c);
}
