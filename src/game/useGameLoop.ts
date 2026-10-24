"use client";

import { useEffect } from "react";
import { TICK } from "./engine/step";
import { isActive, useGame } from "./store";

/**
 * Fixed-step loop: requestAnimationFrame + accumulator, 10 Hz, at most 10 steps per frame.
 * Hidden tab > 60 s is treated as offline (catch-up simulation). Autosaves every 15 s.
 */
export function useGameLoop(): void {
  useEffect(() => {
    const store = useGame.getState();
    store.init();

    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let hiddenAt: number | null = null;

    const frame = (now: number) => {
      const dt = Math.min(5, (now - last) / 1000);
      last = now;
      acc += dt;
      let steps = 0;
      while (acc >= TICK && steps < 10) {
        acc -= TICK;
        steps++;
      }
      if (acc > 1) acc = 1; // drop excess after long frames
      if (steps > 0) {
        const st = useGame.getState();
        st.advance(steps, isActive(st.lastInputAt));
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    const onVis = () => {
      const st = useGame.getState();
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        st.save();
      } else {
        if (hiddenAt !== null) {
          const away = (Date.now() - hiddenAt) / 1000;
          if (away > 60) st.catchUp(away);
          else if (away > 0.5) st.advance(Math.min(600, Math.floor(away / TICK)), false);
        }
        hiddenAt = null;
        last = performance.now();
        acc = 0;
      }
    };
    const onInput = () => useGame.getState().noteInput();
    const onUnload = () => useGame.getState().save();
    const saver = window.setInterval(() => useGame.getState().save(), 15_000);

    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pointerdown", onInput, { passive: true });
    window.addEventListener("keydown", onInput);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(saver);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pointerdown", onInput);
      window.removeEventListener("keydown", onInput);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, []);
}
