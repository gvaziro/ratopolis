"use client";

/**
 * Shared helpers for event close-ups: store dispatch, motion settings, deterministic randomness,
 * colours/fonts for canvas drawing and the scene geometry shared by the canvas and the DOM backdrops.
 */
import { emitUiFx } from "@/game/fx";
import { useGame } from "@/game/store";
import type { SceneAction } from "@/game/types";

/* ------------------------------------------------------------ store */

/** Dispatch a player action into the running scene. */
export function act(a: SceneAction): void {
  useGame.getState().scene(a);
}

/**
 * attach/detach are bookkeeping, not player input: keep `lastInputAt` untouched so an AFK player
 * does not look "active" (harmful events are gated on recent input).
 */
export function actQuiet(a: SceneAction): void {
  // the store does not count attach/detach as player input
  useGame.getState().scene(a);
}

/** Screen shake through GameRoot (skipped entirely for reduced motion / no shake). */
export function shake(px: number, ms = 400): void {
  const s = useGame.getState().game.settings;
  if (s.reducedMotion || s.noShake) return;
  emitUiFx({ k: "shake", px, ms });
}

export function reducedNow(): boolean {
  return useGame.getState().game.settings.reducedMotion;
}

/** A short haptic tick on phones (skipped for reduced motion; desktop browsers ignore it). */
export function buzz(ms: number): void {
  if (reducedNow()) return;
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* not allowed here */
  }
}

/* Whether the player's last input in a close-up came from the keyboard (shows the ⌨ hints, survives phase changes). */
let keyboardLast = false;
export function noteKeyboard(on: boolean): void {
  keyboardLast = on;
}
export function keyboardUsed(): boolean {
  return keyboardLast;
}

/**
 * Seconds since `phaseStart`, anchored to the game clock when created and then advanced in real time
 * (the game clock only ticks at 10 Hz).
 */
export function makeClock(phaseStart: number): () => number {
  const t0 = useGame.getState().game.time - phaseStart;
  const p0 = performance.now();
  return () => t0 + (performance.now() - p0) / 1000;
}

/* ------------------------------------------------------------ math */

export const clamp = (v: number, lo = 0, hi = 1): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
export const easeOutCubic = (k: number): number => 1 - Math.pow(1 - clamp(k), 3);

/**
 * Index of the slot nearest to `j` that is not `locked` (the higher one on a tie), or -1 when none is left.
 * PilesPhase hands the keyboard focus on with it when the boot sweeps the focused pile.
 */
export function nearestStanding(locked: readonly boolean[], j: number): number {
  let best = -1;
  for (let m = 0; m < locked.length; m++) {
    if (locked[m] || m === j) continue;
    const d = Math.abs(m - j);
    const bd = Math.abs(best - j);
    if (best < 0 || d < bd || (d === bd && m > best)) best = m;
  }
  return best;
}

/** Deterministic pseudo-random in [0, 1) — stable visuals without Math.random during render. */
export function hash01(a: number, b = 0): number {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + 0x9e3779b9) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Cheap flicker in [0, 1] (sum of incommensurate sines). */
export function flicker(t: number, seed: number): number {
  const v = Math.sin(t * 23.1 + seed * 1.7) * 0.5 + Math.sin(t * 37.7 + seed * 4.1) * 0.3 + Math.sin(t * 7.3 + seed) * 0.2;
  return clamp(0.5 + 0.5 * v);
}

/* ------------------------------------------------------------ colour & fonts */

/** "#rrggbb" (or "#rgb") → rgba() with alpha. Other colour strings are returned unchanged. */
export function hexA(hex: string, a: number): string {
  if (!hex.startsWith("#")) return hex;
  let h = hex.slice(1);
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h.slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${clamp(a)})`;
}

export const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Segoe UI Symbol",sans-serif';

let fontCache: { display: string; mono: string; body: string } | null = null;
/** Font stacks for canvas text, resolved from the next/font CSS variables. */
export function fonts(): { display: string; mono: string; body: string } {
  if (fontCache) return fontCache;
  let cs: CSSStyleDeclaration | null = null;
  try {
    cs = getComputedStyle(document.documentElement);
  } catch {
    cs = null;
  }
  const pick = (name: string, fb: string) => {
    const v = cs?.getPropertyValue(name).trim();
    return v ? `${v}, ${fb}` : fb;
  };
  fontCache = {
    display: pick("--font-display", "Georgia, serif"),
    mono: pick("--font-mono", "ui-monospace, monospace"),
    body: pick("--font-body", "system-ui, sans-serif"),
  };
  return fontCache;
}

/* ------------------------------------------------------------ geometry */

/** Train / capsule pass geometry in canvas CSS pixels. The DOM rail head sits at the same 70% line. */
export interface TrainGeom {
  w: number;
  h: number;
  /** Visual scale (height, but not much more than the width on portrait phones). */
  s: number;
  /** Items bounce on this line (top of the rail head / the ledge). */
  railY: number;
  /** Bottom edge of the car underside (or of the capsule tube). */
  underY: number;
  /** Items leave the car / capsule here. */
  dropY: number;
  carLen: number;
  /** Gap between two cars (light flickers through it). */
  gap: number;
  wheelR: number;
  wheelCy: number;
  /** Train speed, px/s. */
  speed: number;
  tubeTop: number;
  tubeBot: number;
}

export const RAIL_FRAC = 0.7;
export const LEDGE_FRAC = 0.72;
export const TUBE_TOP_FRAC = 0.12;
export const TUBE_BOT_FRAC = 0.3;

export function trainGeom(w: number, h: number, perCar: number, capsule: boolean): TrainGeom {
  const s = Math.min(h, 1.25 * w);
  if (capsule) {
    const tubeTop = h * TUBE_TOP_FRAC;
    const tubeBot = h * TUBE_BOT_FRAC;
    const carLen = Math.max(0.6 * w, 0.9 * s, 240);
    return { w, h, s, railY: h * LEDGE_FRAC, underY: tubeBot, dropY: tubeBot - 6, carLen, gap: 0, wheelR: 0, wheelCy: 0, speed: carLen / perCar, tubeTop, tubeBot };
  }
  const railY = h * RAIL_FRAC;
  const underY = h * 0.27;
  const carLen = Math.max(0.85 * w, 1.75 * s);
  const wheelR = 0.8 * s;
  return {
    w,
    h,
    s,
    railY,
    underY,
    dropY: underY + h * 0.02,
    carLen,
    gap: carLen * 0.045,
    wheelR,
    wheelCy: h * 0.15 + wheelR,
    speed: carLen / perCar,
    tubeTop: 0,
    tubeBot: 0,
  };
}

/**
 * Left edge (= front, the train runs right→left) of car `i` at pass time `t`.
 * Car i's front reaches the screen centre at t = i·perCar, so its items (t ∈ [i·perCar, (i+1)·perCar]) drop under it.
 */
export function carLeft(g: TrainGeom, i: number, t: number, perCar: number): number {
  return g.w / 2 + (i - t / perCar) * g.carLen;
}

/** Carriage: items fall through the street grate at the top onto the floor. */
export interface FallGeom {
  grateY: number;
  x0: number;
  x1: number;
  slots: number;
  slotW: number;
  floorY: number;
}
export const GRATE_FRAC = 0.11;
export const FLOOR_FRAC = 0.86;

export function fallGeom(w: number, h: number): FallGeom {
  const x0 = w * 0.12;
  const x1 = w * 0.88;
  const slots = Math.max(5, Math.round((x1 - x0) / 46));
  return { grateY: h * GRATE_FRAC, x0, x1, slots, slotW: (x1 - x0) / slots, floorY: h * FLOOR_FRAC };
}

/** Where the passing cab wheel's shadow is at time t (it crosses the grate left→right in ~5.5 s). */
export function carriageShadowX(t: number, w: number): number {
  return -0.25 * w + (t / 5.5) * 1.5 * w;
}

/** Downpour flotsam drifts along this water line (62% of the canvas height). */
export const WATER_FRAC = 0.62;
export function floatGeom(w: number, h: number): { waterY: number } {
  void w;
  return { waterY: h * WATER_FRAC };
}
