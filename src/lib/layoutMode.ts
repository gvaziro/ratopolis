"use client";

import { useSyncExternalStore } from "react";

/**
 * Phone layout mode (v3 ENG-12, SHL-3): one definition of "phone" for every package, so the colony, the panels, the
 * scenes and the shell switch together. A phone is narrow (< 768 px) or short (≤ 520 px tall: a phone in landscape);
 * "short" alone drives the landscape / short-viewport mode. CSS mirrors these with Tailwind's max-md and the shell's
 * `short:` custom variant.
 */
export const PHONE_MQ = "(max-width: 767px), (max-height: 520px)";
export const SHORT_MQ = "(max-height: 520px)";

const lists = new Map<string, MediaQueryList | null>();

function mediaList(query: string): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  let m = lists.get(query);
  if (m === undefined) {
    try {
      m = window.matchMedia(query);
    } catch {
      m = null;
    }
    lists.set(query, m);
  }
  return m;
}

/** The media query matches right now (false on the server or without matchMedia). */
export function matchesQuery(query: string): boolean {
  return mediaList(query)?.matches ?? false;
}

/** Phone layout right now (non-React callers: event handlers, the store). False on the server. */
export function isPhoneLayout(): boolean {
  return matchesQuery(PHONE_MQ);
}

/** Short viewport (landscape phone) right now. False on the server. */
export function isShortLayout(): boolean {
  return matchesQuery(SHORT_MQ);
}

function subscriber(query: string): (cb: () => void) => () => void {
  return (cb) => {
    const m = mediaList(query);
    if (!m) return () => {};
    if (typeof m.addEventListener === "function") {
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    }
    // Safari < 14
    m.addListener(cb);
    return () => m.removeListener(cb);
  };
}

const subscribePhone = subscriber(PHONE_MQ);
const subscribeShort = subscriber(SHORT_MQ);
const serverSnapshot = () => false;

/** Re-renders when the phone layout turns on or off; false during server rendering and hydration. */
export function usePhoneLayout(): boolean {
  return useSyncExternalStore(subscribePhone, isPhoneLayout, serverSnapshot);
}

/** Re-renders when the short (landscape phone) viewport turns on or off; false on the server. */
export function useShortLayout(): boolean {
  return useSyncExternalStore(subscribeShort, isShortLayout, serverSnapshot);
}
