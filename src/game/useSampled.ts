"use client";

import { useEffect, useRef, useState } from "react";
import { shallow } from "zustand/shallow";
import { useGame, type GameStore } from "./store";

/**
 * Subscribe to a slice of the store at most `hz` times per second (PA-1): the game state is replaced 10× a second,
 * but panels only need ~3 fresh readings. The value is read immediately on mount, then on store changes with a
 * trailing-edge throttle, and the component re-renders only when `eq` says the slice changed (default: shallow).
 * Selectors may build new objects/arrays freely — keep them cheap and flat for the shallow comparison.
 */
export function useSampled<T>(selector: (s: GameStore) => T, hz = 3, eq: (a: T, b: T) => boolean = shallow): T {
  const [value, setValue] = useState<T>(() => selector(useGame.getState()));
  // latest selector/eq without resubscribing on every render
  const selRef = useRef(selector);
  const eqRef = useRef(eq);
  const valueRef = useRef(value);
  useEffect(() => {
    selRef.current = selector;
    eqRef.current = eq;
  });

  useEffect(() => {
    const period = 1000 / Math.max(0.1, hz);
    let lastRun = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const sample = () => {
      timer = null;
      lastRun = performance.now();
      const next = selRef.current(useGame.getState());
      if (!eqRef.current(valueRef.current, next)) {
        valueRef.current = next;
        setValue(() => next);
      }
    };
    // the selector may have changed between the first render and this effect
    sample();

    const unsub = useGame.subscribe(() => {
      if (timer !== null) return;
      const wait = period - (performance.now() - lastRun);
      if (wait <= 0) sample();
      else timer = setTimeout(sample, wait);
    });
    return () => {
      unsub();
      if (timer !== null) clearTimeout(timer);
    };
  }, [hz]);

  return value;
}
