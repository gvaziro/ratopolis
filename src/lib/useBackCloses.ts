"use client";

import { useEffect, useRef } from "react";
import { usePhoneLayout } from "./layoutMode";

/**
 * «Назад» closes the overlay (v3 ENG-12, SHL-4): on the phone layout an open sheet, modal or scene pushes one history
 * entry {rr:"ov", token}; the system Back gesture pops it and closes the overlay instead of leaving the game. Closing
 * from the UI goes back over our own entry (only when the current entry is that overlay's), so open/close cycles never
 * grow history. Overlays stack: Back closes the topmost one. An overlay closed under another one leaves its entry
 * "dead"; it goes together with the live entry above it in one traversal (history.go(-n)), so no Back press is ever
 * spent on it.
 *
 * Our history moves never overlap: while a back() of ours is in flight a new overlay's push waits, and further steps
 * back are owed and taken in one traversal once it lands (browsers differ on a push or a second back() racing a
 * pending traversal: the push can land under it, or two back() calls can count as one).
 *
 * Which entry is ours: Next's app router copies its own keys (__NA and the tree) into the state we push, and after a
 * soft navigation or a refresh — in dev, every HMR refresh — its HistoryUpdater rewrites the current entry's state
 * without ours (pushRef.preserveCustomHistoryState is false then), dropping the marker. So where the browser has the
 * Navigation API an entry is recognised by navigation.currentEntry.key, which a replaceState keeps; the marker and
 * token are the fallback. (In production nothing rewrites it: the game makes no router navigation or refresh, and a
 * Back or Forward traversal keeps custom state.)
 */

/** The marker on our history entries. */
export const BACK_STATE = { rr: "ov" } as const;

/** What the closer needs from window (a mock in tests). */
export interface BackEnv {
  history: {
    readonly state: unknown;
    readonly length: number;
    pushState(data: unknown, unused: string): void;
    back(): void;
    go(delta: number): void;
  };
  /** The Navigation API where the browser has it: an entry's key survives a replaceState of its state. */
  navigation?: { readonly currentEntry: { readonly key: string } | null };
  addEventListener(type: "popstate", fn: () => void): void;
  removeEventListener(type: "popstate", fn: () => void): void;
}

export interface BackCloser {
  /** An overlay opened: push our entry; `close` runs when Back pops it. Returns a token for release(). */
  open(close: () => void): number;
  /** The overlay closed (UI, unmount, phone layout off): drop its entry, going back over it if it is on top. */
  release(token: number): void;
  /** Overlays currently holding an entry (tests, debugging). */
  depth(): number;
}

interface Entry {
  token: number;
  close: () => void;
  /** Its history entry exists (a push waits while a back() of ours is in flight). */
  pushed: boolean;
  /** Released under another overlay: its entry goes with the live one above (the top is live once settled). */
  dead: boolean;
  /** navigation.currentEntry.key right after its push; null without the Navigation API. */
  key: string | null;
}

/** The state of the entry pushed for `token` (Next's own keys may sit beside ours). */
function isOurs(state: unknown, token: number): boolean {
  if (typeof state !== "object" || state === null) return false;
  const s = state as { rr?: unknown; token?: unknown };
  return s.rr === BACK_STATE.rr && s.token === token;
}

export function createBackCloser(env: BackEnv): BackCloser {
  /** Bottom to top: the pushed entries, then (only while a back() of ours is in flight) the ones waiting to be. */
  const stack: Entry[] = [];
  let seq = 0;
  /** A back() or go() of ours is in flight: its popstate is swallowed. */
  let moving = false;
  /** Entries of ours to go back over once the traversal in flight lands. */
  let owed = 0;
  let listening = false;

  const currentKey = (): string | null => {
    try {
      return env.navigation?.currentEntry?.key ?? null;
    } catch {
      return null;
    }
  };
  /** Is the current history entry the one pushed for `e`? */
  const isCurrent = (e: Entry): boolean => {
    const key = currentKey();
    return e.key !== null && key !== null ? key === e.key : isOurs(env.history.state, e.token);
  };
  /** Push the entry of `e`; if the browser refuses (Safari: > 100 pushes in 30 s), `e` leaves the stack (Back leaves). */
  const push = (e: Entry) => {
    try {
      env.history.pushState({ ...BACK_STATE, token: e.token }, "");
    } catch {
      stack.splice(stack.indexOf(e), 1);
      return;
    }
    e.pushed = true;
    e.key = currentKey();
  };
  /** Pop the dead entries now on top; returns how many history entries they hold. */
  const popDead = (): number => {
    let n = 0;
    while (stack.length && stack[stack.length - 1].dead) {
      stack.pop();
      n++;
    }
    return n;
  };
  /** Go back over `n` entries of ours in one traversal (its popstate swallowed); one already in flight: owed. */
  const goBack = (n: number) => {
    if (n <= 0) return;
    if (moving) {
      owed += n;
      return;
    }
    moving = true;
    if (n === 1) env.history.back();
    else env.history.go(-n);
  };
  /** Our traversal landed: take the steps owed meanwhile (a dead entry left on top included), then the waiting pushes. */
  const settle = () => {
    let n = owed + popDead();
    owed = 0;
    if (n === 0) {
      for (const e of [...stack]) if (!e.pushed) push(e);
      n = popDead(); // a refused push can leave a dead entry on top
    }
    goBack(n);
  };
  const onPop = () => {
    if (moving) {
      moving = false;
      settle();
      if (!stack.length) stopListening();
      return;
    }
    // the player pressed Back: the topmost overlay closes; the entries of overlays closed under it go too
    const top = stack.pop();
    goBack(popDead());
    if (!stack.length) stopListening();
    top?.close();
  };
  const startListening = () => {
    if (listening) return;
    listening = true;
    env.addEventListener("popstate", onPop);
  };
  const stopListening = () => {
    // a traversal of ours may still be in flight: keep listening until its popstate has been swallowed
    if (!listening || moving) return;
    listening = false;
    env.removeEventListener("popstate", onPop);
  };

  return {
    open(close) {
      const e: Entry = { token: ++seq, close, pushed: false, dead: false, key: null };
      stack.push(e);
      startListening();
      if (!moving) push(e);
      if (!stack.length) stopListening();
      return e.token;
    },
    release(token) {
      const i = stack.findIndex((e) => e.token === token);
      if (i < 0 || stack[i].dead) return; // already popped by Back, or already released
      const e = stack[i];
      if (!e.pushed) {
        // released before its push: it never reaches history (only the waiting ones sit above it)
        stack.splice(i, 1);
        if (!stack.length) stopListening();
        return;
      }
      if (i < stack.length - 1) {
        e.dead = true; // another overlay sits above: this entry goes with that one's
        return;
      }
      stack.pop();
      const n = 1 + popDead();
      // with a traversal of ours in flight the current entry is not known yet: the bookkeeping says the steps are owed
      if (moving || isCurrent(e)) goBack(n);
      if (!stack.length) stopListening();
    },
    depth: () => stack.filter((e) => !e.dead).length,
  };
}

let shared: BackCloser | null = null;

function windowCloser(): BackCloser | null {
  if (typeof window === "undefined" || !window.history) return null;
  shared ??= createBackCloser(window);
  return shared;
}

/**
 * While `open` on the phone layout, the system Back calls `close()` instead of leaving the page. Desktop: no-op.
 * `close` may change between renders (the latest one is called).
 */
export function useBackCloses(open: boolean, close: () => void): void {
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });
  const phone = usePhoneLayout();
  useEffect(() => {
    if (!open || !phone) return;
    const ctl = windowCloser();
    if (!ctl) return;
    const token = ctl.open(() => closeRef.current());
    return () => ctl.release(token);
  }, [open, phone]);
}
