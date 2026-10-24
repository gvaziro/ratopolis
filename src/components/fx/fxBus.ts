/**
 * Imperative bridge between the colony (and anything else in the UI) and the global FxLayer canvas.
 * Everything here is plain module state mutated from effects / event handlers, never during render.
 */

export type BurstKind = "dust" | "gold" | "spark" | "confetti" | "heart" | "ember" | "crumb" | "glint";

export interface FloatSpec {
  text: string;
  x: number;
  y: number;
  color: string;
  /** Larger font with a dark outline (finds, big drops). */
  big?: boolean;
  /** Rubber-stamp look (ПОЛНО). */
  stamp?: boolean;
  /** Font size override in px. */
  size?: number;
  /** Lifetime override in ms (default 700, big 1100). */
  dur?: number;
  alpha?: number;
}

export interface FxImpl {
  burst(x: number, y: number, kind: BurstKind, n: number, spread?: number): void;
  text(spec: FloatSpec): void;
}

export interface Pt {
  x: number;
  y: number;
}

let impl: FxImpl | null = null;

/** Called by FxLayer on mount/unmount. */
export function registerFxImpl(i: FxImpl | null): void {
  impl = i;
}

/** Spawn a particle burst at client coordinates (no-op until FxLayer is mounted). */
export function fxBurst(x: number, y: number, kind: BurstKind, n: number, spread?: number): void {
  impl?.burst(x, y, kind, n, spread);
}

/** Floating text at client coordinates. */
export function fxText(spec: FloatSpec): void {
  impl?.text(spec);
}

/* ------------------------------------------------------------ anchors */

let grate: Pt | null = null;

/** The grate's on-screen centre (client px). ColonyView keeps it updated on pan/zoom/resize. */
export function setFxAnchor(x: number, y: number): void {
  grate = { x, y };
}

export function getFxAnchor(): Pt | null {
  return grate;
}

let colonyRect: () => DOMRect | null = () => null;

/** ColonyView registers a getter for its bounding rect (fractions 0..1 of the view map onto it). */
export function setColonyRectGetter(fn: (() => DOMRect | null) | null): void {
  colonyRect = fn ?? (() => null);
}

export function getColonyRect(): DOMRect | null {
  return colonyRect();
}

let lastPoint: (Pt & { t: number }) | null = null;

/** Remember where the player just poked (purse, shiny) so position-less engine fx can appear there. */
export function markFxPoint(x: number, y: number): void {
  lastPoint = { x, y, t: performance.now() };
}

export function recentFxPoint(maxAgeMs = 1500): Pt | null {
  if (!lastPoint || performance.now() - lastPoint.t > maxAgeMs) return null;
  return lastPoint;
}

type Resolver = (key: string) => Pt | null;
const resolvers = new Set<Resolver>();

/** Register a resolver for named anchors such as "building:nest" (returns client coords or null). */
export function addAnchorResolver(fn: Resolver): () => void {
  resolvers.add(fn);
  return () => {
    resolvers.delete(fn);
  };
}

export function resolveAnchor(key: string): Pt | null {
  for (const fn of resolvers) {
    const p = fn(key);
    if (p) return p;
  }
  return null;
}
