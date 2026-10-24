import type { Fx } from "./types";

/** Tiny pub/sub for transient engine feedback (sounds, particles, toasts). */
type Listener = (fx: Fx) => void;
const listeners = new Set<Listener>();

export function onFx(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function emitFx(list: Fx[]): void {
  if (list.length === 0) return;
  for (const fx of list) for (const fn of listeners) fn(fx);
}

/** UI-only events (not from the engine): pointer positions for floating numbers, screen shake requests. */
export type UiFx =
  | { k: "shake"; px: number; ms: number }
  | { k: "flash"; color: string; ms: number }
  | { k: "float"; text: string; x: number; y: number; color: string; big?: boolean };

type UiListener = (fx: UiFx) => void;
const uiListeners = new Set<UiListener>();

export function onUiFx(fn: UiListener): () => void {
  uiListeners.add(fn);
  return () => {
    uiListeners.delete(fn);
  };
}

export function emitUiFx(fx: UiFx): void {
  for (const fn of uiListeners) fn(fx);
}
