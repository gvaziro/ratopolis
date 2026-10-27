/**
 * Plain-data copies of the game state for the store (v3 ENG-6).
 *
 * GameState is JSON-like data: plain objects, arrays, numbers (±Infinity included: "never" timers), strings,
 * booleans and null. No Map, Set, Date, class instances, functions or undefined holes that matter (tests: testkit
 * assertPlain). That makes a hand-rolled copy safe and about 6× cheaper than structuredClone on a late colony, which
 * the store paid 10 times a second before every tick.
 *
 * shareState lets the published snapshot reuse the previous one's objects wherever nothing changed, so a selector
 * such as `s => s.game.scene` keeps returning the same object through a quiet rumble and React skips the re-render.
 * This is safe because a published snapshot is never mutated: the store clones before every step and every action.
 */

/** A deep copy of plain data (see the file comment); the result shares no object with `s`. */
export function cloneState<T>(s: T): T {
  return typeof s === "object" && s !== null ? (copy(s) as T) : s;
}

/** Shallow copy first (V8's fast path for spread / slice), then replace the object children by their copies. */
function copy(v: object): object {
  if (Array.isArray(v)) {
    const out = v.slice();
    for (let i = 0; i < out.length; i++) {
      const x: unknown = out[i];
      if (typeof x === "object" && x !== null) out[i] = copy(x);
    }
    return out;
  }
  const out: Record<string, unknown> = { ...v };
  for (const k in out) {
    const x = out[k];
    if (typeof x === "object" && x !== null) out[k] = copy(x);
  }
  return out;
}

/**
 * `next` with every subtree that deep-equals the same place in `prev` replaced by prev's object (prev itself when
 * nothing changed at all). Mutates `next` (only to swap references in); never touches `prev`. Arrays are compared
 * index by index; NaN never counts as equal (it only costs the sharing, never correctness).
 */
export function shareState<T>(prev: T, next: T): T {
  return share(prev, next) as T;
}

function share(p: unknown, n: unknown): unknown {
  if (p === n || typeof p !== "object" || p === null || typeof n !== "object" || n === null) return p === n ? p : n;
  if (Array.isArray(n)) {
    if (!Array.isArray(p)) return n;
    const len = n.length;
    let same = len === p.length;
    for (let i = 0; i < len; i++) {
      const x: unknown = n[i];
      const was: unknown = p[i];
      if (typeof x === "object" && x !== null) {
        const y = share(was, x);
        if (y !== x) n[i] = y;
        if (y !== was) same = false;
      } else if (x !== was) same = false;
    }
    return same ? p : n;
  }
  if (Array.isArray(p)) return n;
  const po = p as Record<string, unknown>;
  const no = n as Record<string, unknown>;
  let same = true;
  let keys = 0;
  for (const k in no) {
    keys++;
    const x = no[k];
    const was = po[k];
    if (typeof x === "object" && x !== null) {
      const y = share(was, x);
      if (y !== x) no[k] = y;
      if (y !== was) same = false;
    } else if (x !== was || (x === undefined && !(k in po))) same = false;
  }
  // a key the step deleted (delete s.forceVariant, a finished commission…) makes prev differ too
  if (same && Object.keys(po).length !== keys) same = false;
  return same ? p : n;
}
