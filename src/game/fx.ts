import type { Fx, TabId } from "./types";

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

/**
 * Named one-shot sounds requested by UI components (v2). AudioDirector maps each cue to a synth voice;
 * `intensity` (0..1, default 1) scales the volume, `pitch` (default 1) multiplies the frequency.
 */
export type SfxCue =
  | "footstep"
  | "thump"
  | "doppler"
  | "tinnitus"
  | "rumbleCut"
  | "medalTier"
  | "tierLost"
  | "carClear"
  | "stamp"
  | "tick"
  | "heartbeat"
  | "patent"
  | "unlock"
  | "valveCreak"
  | "bubbles"
  | "crownTick"
  | "chime";

/**
 * UI-only events (not from the engine): pointer positions for floating numbers, screen shake requests,
 * and the v2 glue between panels, colony, shell and audio.
 * `target` strings follow the data-target convention: b_<BuildingId>, j_<JobId>, u_<UpgradeId>, e_<EdictId>,
 * z_<ZoneId>, x_express (panel elements) and building:<BuildingId> (colony chambers, for "fly").
 */
export type UiFx =
  | { k: "shake"; px: number; ms: number }
  | { k: "flash"; color: string; ms: number }
  | { k: "float"; text: string; x: number; y: number; color: string; big?: boolean }
  /* v2 */
  | { k: "sfx"; cue: SfxCue; intensity?: number; pitch?: number }
  /** Emitted by store.focus() one animation frame after the tab switch: scroll [data-target] into view and glow it. */
  | { k: "focus"; tab: TabId; target?: string }
  /** Batched «Открыто!» notifications (PA-5 emits, the shell's Toasts render). */
  | { k: "unlock"; items: { key: string; tab: TabId; text: string }[] }
  /** An icon flying from a screen point (client px) to a target element (e.g. a bought building's chamber). */
  | { k: "fly"; from: { x: number; y: number }; target: string; icon: string }
  /** A generic toast from UI or store code (e.g. «Отчёт об отлучке потерян»). */
  | { k: "toast"; text: string; icon?: string; tab?: TabId; target?: string };

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

/** Play a named sound cue (AudioDirector listens). Safe to call anywhere, any time. */
export function sfxCue(cue: SfxCue, o?: { intensity?: number; pitch?: number }): void {
  emitUiFx({ k: "sfx", cue, intensity: o?.intensity, pitch: o?.pitch });
}
