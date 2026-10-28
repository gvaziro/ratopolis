/**
 * «Экономия батареи» (settings.batterySaver): a phone that warms up in the hand is a phone that redraws a 6 000-node
 * SVG 60–120 times a second for candles, gears and rat tails. While eco is on:
 * - html[data-eco] pauses every decorative CSS loop (globals.css, colonyCss, panels' common styles);
 * - the decorative rAF loops (rats, street traffic, the sky strip, gauges, particles…) draw through decoFrame(),
 *   at most ECO_FPS times a second — they all step by elapsed time, so they only get coarser, never slower;
 * - the game loop publishes its 10 Hz steps two at a time (useGameLoop), halving React work, except during a scene.
 * Scenes (the catch, piles, hazards) keep plain requestAnimationFrame: they are played, not watched.
 * GameRoot resolves "auto" (on for touch phones) and calls setEco().
 */
import { useSyncExternalStore } from "react";
import type { BatterySaver } from "@/game/types";

/**
 * While eco is on, decorative loops draw once per slot of this length (20 fps). The slots are one clock for every loop,
 * so they all draw in the same frame: ten loops at their own 20 fps would ask the browser for up to 200 frames.
 */
export const ECO_FRAME_MS = 50;

const slotOf = (t: number) => Math.floor(t / ECO_FRAME_MS);

let eco = false;
const listeners = new Set<() => void>();

export function setEco(on: boolean): void {
  if (eco === on) return;
  eco = on;
  for (const fn of listeners) fn();
}

export function ecoActive(): boolean {
  return eco;
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Eco as React state (the resolved value: "auto" depends on the device). */
export function useEco(): boolean {
  return useSyncExternalStore(subscribe, ecoActive, () => false);
}

/** "auto" is on where the hand holds the device: a coarse primary pointer (phones, tablets). */
export function resolveEco(setting: BatterySaver | undefined, coarse: boolean): boolean {
  if (setting === "on") return true;
  if (setting === "off") return false;
  return coarse;
}

/** The slot each loop (by its callback) last drew in. */
const lastSlot = new WeakMap<FrameRequestCallback, number>();
/** decoFrame handle → what is pending for it: a frame request or the sleep before one. */
const pending = new Map<number, { raf: number; timer: number }>();
let seq = 0;

/**
 * requestAnimationFrame for decorative loops: identical while eco is off. While it is on, a loop draws once per eco
 * slot, in the slot's first frame; in between it sleeps (a timer, not a frame request), so a page whose loops all
 * sleep produces no frames at all. A loop is known by its callback, so pass the same function every frame. Returns a
 * non-zero handle for cancelDecoFrame.
 */
export function decoFrame(cb: FrameRequestCallback): number {
  const h = ++seq;
  const ask = () => pending.set(h, { raf: requestAnimationFrame(step), timer: 0 });
  /** Sleep until the slot after `slot` begins (a few ms early: the frame request lands on its first vsync). */
  const nap = (slot: number) => {
    pending.set(h, { raf: 0, timer: window.setTimeout(ask, Math.max(0, (slot + 1) * ECO_FRAME_MS - performance.now() - 4)) });
  };
  const step = (t: number) => {
    if (eco) {
      const prev = lastSlot.get(cb);
      if (prev !== undefined && slotOf(t) <= prev) {
        nap(prev);
        return;
      }
      lastSlot.set(cb, slotOf(t));
    }
    pending.delete(h);
    cb(t);
  };
  // the loop re-arms right after drawing: under eco it goes straight to sleep instead of asking for the next vsync
  const prev = eco ? lastSlot.get(cb) : undefined;
  if (prev !== undefined && slotOf(performance.now()) <= prev) nap(prev);
  else ask();
  return h;
}

export function cancelDecoFrame(h: number): void {
  const p = pending.get(h);
  if (!p) return;
  if (p.raf) cancelAnimationFrame(p.raf);
  if (p.timer) window.clearTimeout(p.timer);
  pending.delete(h);
}

/**
 * While eco is on the game loop wakes on every second slot boundary (10 Hz, its step rate), so its React updates land
 * in the frames the decorative loops draw anyway. Returns the ms to sleep from `now`.
 */
export function ecoLoopDelay(now: number): number {
  const period = 2 * ECO_FRAME_MS;
  return Math.max(0, period - (now % period) - 4);
}
