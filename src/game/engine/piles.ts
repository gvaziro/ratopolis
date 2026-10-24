/**
 * Piles phase as a race against the giant human lineman (EN-5, SC-1). Pure helpers shared by the scene UI,
 * the engine and the balance sim. Piles are laid left→right in car order; pile i is centred at (i + 0.5) / n
 * of the strip, and the lineman's boot sweeps it away (locks it) when he reaches it.
 */

/** Recovered fraction per click on a pile. */
export const PILE_STEP = 0.06;
/** While a pile is held: PILE_STEP × PILE_HOLD_RATE per second (0.30/s). */
export const PILE_HOLD_RATE = 5;
/** Seconds into the phase when the lineman enters from the left edge. */
export const LINEMAN_START = 1.5;
/** He reaches the right edge at this share of the phase duration. */
export const LINEMAN_END_FRAC = 0.85;

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Lineman position across the strip (0 = left edge, 1 = right edge) at phase time t of a `dur`-second phase. */
export function linemanX(t: number, dur: number): number {
  const end = LINEMAN_END_FRAC * dur;
  if (end <= LINEMAN_START) return t >= LINEMAN_START ? 1 : 0;
  return clamp01((t - LINEMAN_START) / (end - LINEMAN_START));
}

/** Phase time at which the lineman's boot reaches pile i of n (the pile locks: no more input). */
export function pileLockTime(i: number, n: number, dur: number): number {
  const x = n > 0 ? (i + 0.5) / n : 0;
  const end = Math.max(LINEMAN_START, LINEMAN_END_FRAC * dur);
  return LINEMAN_START + x * (end - LINEMAN_START);
}

/**
 * Advance one pile's recovered fraction by dt seconds of input: `clicks` taps plus a hold if `holding`.
 * Progress starts from the auto-collect share `auto` (the engine pays at least that anyway) and caps at 1.
 * The carts take share `auto` of every scoop whatever the paws do, so digging only adds to the rest:
 * after dug share p of the pile (p = clicks·STEP + hold·STEP·HOLD_RATE·dt) the pile stands at
 * 1 − (1 − auto)(1 − p) = auto + (1 − auto)·p. A full pile takes 1 / (STEP·HOLD_RATE) ≈ 3.3 s of holding at any
 * auto share, so the lineman lets a perfect player recover ~80% of a 4–6 pile strip (EN-5: piles alone never
 * replace catching).
 */
export function stepPile(frac: number, dt: number, holding: boolean, clicks: number, auto: number): number {
  const a = clamp01(auto);
  let dug = Math.max(0, clicks) * PILE_STEP;
  if (holding && dt > 0) dug += PILE_STEP * PILE_HOLD_RATE * dt;
  return clamp01(Math.max(frac, a) + (1 - a) * dug);
}
