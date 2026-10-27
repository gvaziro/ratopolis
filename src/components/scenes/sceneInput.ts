/**
 * Pure input rules of the close-ups (v3 SCN-5), kept apart from React and the DOM so vitest can pin them down:
 * the keys that count as keyboard play, the «две лапы» pointer gate of the catch canvas and the key maps of the
 * rumble prep, the catch, the hook's timing bar and the piles.
 */
import type { CrewPosition } from "@/game/types";

/* ------------------------------------------------------------ modality */

/** Keys that switch the close-ups to keyboard play (⌨ hints, focus moved into the scene): Tab, Enter, Space, arrows. */
export function isModalityKey(key: string): boolean {
  return key === "Tab" || key === "Enter" || key === " " || key === "Spacebar" || key.startsWith("Arrow");
}

/** What `isControlTarget` needs from an element (a DOM Element fits). */
export interface TargetLike {
  tagName?: string;
  isContentEditable?: boolean;
  getAttribute?(name: string): string | null;
}

const CONTROL_TAGS = new Set(["BUTTON", "A", "INPUT", "SELECT", "TEXTAREA", "SUMMARY"]);
const CONTROL_ROLES = new Set(["button", "link", "checkbox", "radio", "switch", "tab", "menuitem", "option", "slider", "textbox"]);

/** The key went to a control that handles Enter / Space itself (a button, a link, a field): scene hotkeys stand aside. */
export function isControlTarget(el: TargetLike | null | undefined): boolean {
  if (!el || !el.tagName) return false;
  if (CONTROL_TAGS.has(el.tagName.toUpperCase()) || el.isContentEditable) return true;
  const role = el.getAttribute?.("role");
  return !!role && CONTROL_ROLES.has(role);
}

/** The player is typing into a field: no scene key at all. */
export function isTypingTarget(el: TargetLike | null | undefined): boolean {
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable) return true;
  if (tag !== "INPUT") return false;
  const type = (el.getAttribute?.("type") ?? "text").toLowerCase();
  return !["range", "checkbox", "radio", "button", "submit", "reset", "color", "file"].includes(type);
}

/* ------------------------------------------------------------ «две лапы» */

/** A rat has two paws: at most this many pointers catch at once (a third finger only shows a dim ring). */
export const MAX_PAWS = 2;

/** What the gate needs from a tracked pointer: armed (it may catch) and its press order. */
export interface PawLike {
  armed: boolean;
  /** Increasing press counter: lower = pressed earlier. */
  seq: number;
}

/**
 * The pointers that catch this frame: the `max` oldest armed ones (by press order). Unarmed pointers never count, so a
 * finger that has not moved yet after a tap-limited press does not take a paw away from one that is sweeping.
 */
export function catchingPaws<K>(tracks: Iterable<readonly [K, PawLike]>, max = MAX_PAWS): Set<K> {
  const armed: [K, number][] = [];
  for (const [id, tr] of tracks) if (tr.armed) armed.push([id, tr.seq]);
  armed.sort((a, b) => a[1] - b[1]);
  return new Set(armed.slice(0, Math.max(0, max)).map(([id]) => id));
}

/* ------------------------------------------------------------ key maps */

/** Crew positions in key order: 1 — у стены, 2 — у рельсов, 3 — на шпалах. */
export const POSITION_KEYS: readonly CrewPosition[] = ["wall", "rails", "ties"];

export type RumbleKey = { k: "ready" } | { k: "position"; pos: CrewPosition } | { k: "repeat" };

/**
 * «Гул» prep keys: Enter / Space — «По местам!» (unless a focused button takes the key itself), 1 / 2 / 3 — crew
 * position, R (К on a Russian layout) — «Как в прошлый раз» (the nets).
 */
export function rumbleKey(key: string, onControl: boolean): RumbleKey | null {
  if (key === "Enter" || key === " " || key === "Spacebar") return onControl ? null : { k: "ready" };
  const n = POSITION_KEYS[Number(key) - 1];
  if (/^[1-3]$/.test(key) && n) return { k: "position", pos: n };
  if (key === "r" || key === "R" || key === "к" || key === "К") return { k: "repeat" };
  return null;
}

/** The hook's timing bar throws on a fresh Space, Enter or ↑ (a held key auto-repeating into the window is no throw). */
export function isThrowKey(key: string, repeat = false): boolean {
  if (repeat) return false;
  return key === " " || key === "Spacebar" || key === "Enter" || key === "ArrowUp";
}

export type CatchKey = "left" | "right" | "paw";

/**
 * Catch canvas keys: ←/→ walk the paw along the catch line, Space holds it open. Space stays the paw while the hook's
 * bar is up too (the bar throws on the same fresh press), so the paw never closes right at the hook.
 */
export function catchKey(key: string): CatchKey | null {
  if (key === "ArrowLeft") return "left";
  if (key === "ArrowRight") return "right";
  if (key === " " || key === "Spacebar") return "paw";
  return null;
}

export type PilesKey = "dig" | "done";

/** «Разбор завалов»: Space digs the focused pile (hold to keep digging), Enter is «Готово». */
export function pilesKey(key: string): PilesKey | null {
  if (key === " " || key === "Spacebar") return "dig";
  if (key === "Enter") return "done";
  return null;
}
