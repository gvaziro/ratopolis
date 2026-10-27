/**
 * One pausable clock for every close-up (v3 SCN-1, K1). A ceremony (the coronation show, the migration card), a
 * crash, a save issue or a hidden tab holds the game; the scene loops read `sceneNow()` instead of performance.now(),
 * so while held their time stands still — no catch resolves unattended, no paw creeps, no note flies, no boot sweeps
 * — and after the release it goes on from where it stopped, without a jump.
 * SceneHost drives it (`isHeld(store) || document.hidden`); this module knows nothing of the store or the DOM, so it
 * is unit-tested with a mocked performance.now().
 */

let held = false;
/** performance.now() when the current hold began. */
let heldSince = 0;
/** Milliseconds spent held so far (all finished holds). */
let heldTotal = 0;
const subs = new Set<(held: boolean) => void>();

const perfNow = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

/** Milliseconds on performance.now()'s timeline with every hold cut out: stands still while held. */
export function sceneNow(): number {
  const now = perfNow();
  return now - heldTotal - (held ? now - heldSince : 0);
}

/** The scenes are held right now (input is ignored, loops only repaint, shake and haptics are off). */
export function sceneHeld(): boolean {
  return held;
}

/** Hold or release the scene clock (SceneHost; tests). Listeners hear only real changes. */
export function setSceneHeld(on: boolean): void {
  if (on === held) return;
  const now = perfNow();
  if (on) heldSince = now;
  else heldTotal += Math.max(0, now - heldSince);
  held = on;
  for (const fn of [...subs]) fn(on);
}

/** Called with the new state whenever the hold starts or ends; returns the unsubscribe. */
export function onSceneHold(fn: (held: boolean) => void): () => void {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}
