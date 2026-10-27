"use client";

import { useEffect } from "react";
import { creditHold } from "./engine/hold";
import { TICK } from "./engine/step";
import { isActive, noteHidden, noteVisible, useGame } from "./store";

/**
 * Fixed-step loop: requestAnimationFrame + accumulator, 10 Hz, at most 10 steps per frame.
 * Hidden tab > 60 s is treated as offline (catch-up simulation), and so is a wall-clock gap between frames
 * while the tab stayed "visible" (system sleep without visibilitychange, long freeze). Autosaves every 15 s.
 * While the store is crashed or has a save issue (corrupt / newer / another tab) nothing ticks and nothing saves;
 * the frame re-arms in `finally`, so a throw anywhere in it cannot silently stop the loop.
 * The game clock is *held* while the tab is hidden or a ceremony is open (store.ceremony: the coronation show, the
 * migration card): nothing ticks, saves stand for the moment the hold began, and once the tab is visible with no
 * ceremony open the held time is credited by engine/hold.creditHold (v3 ENG-5, K1):
 * - above 60 s as an absence (catch-up and its report);
 * - up to 60 s with a ceremony, or with a scene UI driving a scene (alt-tab mid-train), as a pause: nothing is credited,
 *   the scene waits exactly where it was (SCN-1 froze its clock) and an event due meanwhile waits for the player;
 * - up to 60 s otherwise as store.creditShortHold: a train due meanwhile is deferred behind a fresh «К путям!», then
 *   plain ticks.
 */
export function useGameLoop(): void {
  useEffect(() => {
    const store = useGame.getState();
    store.init();

    let raf = 0;
    let stopped = false;
    let last = performance.now();
    let lastWall = Date.now(); // performance.now() may stand still during system sleep: gaps use the wall clock
    let acc = 0;
    /** The tab is hidden (since this wall time). */
    let hiddenAt: number | null = null;
    /** The game clock stands still since this wall time: the tab is hidden or a ceremony is open. */
    let heldAt: number | null = null;
    /** A ceremony was open at some point of the current hold. */
    let heldForCeremony = false;
    /** A scene UI was driving a scene when the current hold began (a short alt-tab mid-train is a pause). */
    let heldForScene = false;

    const halted = () => {
      const st = useGame.getState();
      return st.crashed || st.saveIssue !== null;
    };

    /** Stop the game clock at `at`; every save from now on (interval, unload, take-over) is stamped `at`. */
    const hold = (at: number) => {
      const st = useGame.getState();
      if (st.ceremony) heldForCeremony = true;
      if (heldAt !== null) return;
      heldForScene = !!st.game.scene?.interactive;
      heldAt = at;
      noteHidden(at);
    };

    /** Once the tab is visible and no ceremony is open: credit the held time and tick on from now. */
    const release = () => {
      if (heldAt === null || hiddenAt !== null || useGame.getState().ceremony) return;
      const away = (Date.now() - heldAt) / 1000;
      const ceremony = heldForCeremony;
      const scene = heldForScene;
      heldAt = null;
      heldForCeremony = false;
      heldForScene = false;
      if (!halted()) creditHold(useGame.getState(), away, ceremony, scene);
      noteVisible();
      last = performance.now();
      lastWall = Date.now();
      acc = 0;
    };

    // opened in a background tab: nothing ticks until it is shown, so saves until then stand for the load time
    if (document.visibilityState === "hidden") {
      hiddenAt = Date.now();
      hold(hiddenAt);
    }
    if (useGame.getState().ceremony) hold(Date.now());
    const offCeremony = useGame.subscribe((st, prev) => {
      // the hold starts with the ceremony; it is released by the next frame (or by onVis) once the last one closed
      if (st.ceremony && !prev.ceremony) hold(Date.now());
    });

    const tick = (now: number) => {
      const wall = Date.now();
      const gap = (wall - lastWall) / 1000;
      lastWall = wall;
      if (halted()) {
        // frozen: resume from "now" once the issue is resolved instead of replaying the pause (every way out of a
        // halt reloads the save, which credits its own absence), and a held clock (a ceremony) restarts from here too
        last = now;
        acc = 0;
        if (heldAt !== null) {
          heldAt = wall;
          noteHidden(wall);
        }
        return;
      }
      if (heldAt !== null) {
        release();
        if (heldAt !== null) {
          // a ceremony is still open: the clock stands still (and the frame gap is not caught up as a sleep)
          last = now;
          acc = 0;
        }
        return;
      }
      // a hidden period is caught up by release() instead; a negative gap (clock change) is ignored. A frozen tab
      // (system sleep) is credited like a hold: a scene on screen froze with it and waits, a due train is deferred
      if (gap > 2 && document.visibilityState === "visible") {
        creditHold(useGame.getState(), gap, false);
        last = now;
        acc = 0;
        return;
      }
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
    };

    const frame = (now: number) => {
      try {
        tick(now);
      } finally {
        if (!stopped) raf = requestAnimationFrame(frame);
      }
    };
    raf = requestAnimationFrame(frame);

    const onVis = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        // the game stands still from here (or already did, under a ceremony)
        hold(hiddenAt);
        useGame.getState().save();
      } else {
        hiddenAt = null;
        release();
      }
    };
    const onInput = () => useGame.getState().noteInput();
    const onUnload = () => useGame.getState().save();
    // save() itself is a no-op while crashed or blocked by a save issue
    const saver = window.setInterval(() => useGame.getState().save(), 15_000);

    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pointerdown", onInput, { passive: true });
    window.addEventListener("keydown", onInput);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      offCeremony();
      window.clearInterval(saver);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pointerdown", onInput);
      window.removeEventListener("keydown", onInput);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, []);
}
