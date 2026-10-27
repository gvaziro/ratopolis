/**
 * Pure statistics of the balance sim (v3 ENG-2): how a check is judged from its number (Judge), the median over
 * replicate runs (several bot RNG streams on one seed) and the aggregation of whole check lists by (group, name).
 * Used by scripts/balance-sim.ts (--replicates) and scripts/sim-matrix.ts; covered by scripts/simStats.test.ts.
 */

export type Verdict = "PASS" | "FAIL" | "INFO";

/**
 * How a value is judged:
 * - within: [lo, hi] widened by ±tol (default 25%, the GDD checkpoints);
 * - range: [lo, hi] exactly (the v2/v3 targets);
 * - atMost / below: x ≤ hi / x < hi; atLeast: x ≥ lo;
 * - info: never judged (reference only).
 * A missing or non-finite value fails every judge but info.
 */
export type Judge =
  | { k: "within"; lo: number; hi: number; tol?: number }
  | { k: "range"; lo: number; hi: number }
  | { k: "atMost"; hi: number }
  | { k: "below"; hi: number }
  | { k: "atLeast"; lo: number }
  | { k: "info" };

/**
 * How a value prints: minutes or seconds as m:ss, hours with 2 decimals, a share as %, a plain number, 1/0 as да/нет.
 * An even replicate count can put a median between two whole values (a yes/no split [1, 0] → 0.5, [3, 4] → 3.5): it
 * prints as it is judged — «поровну», «3.5» — never rounded into a verdict it does not get.
 */
export type Unit = "min" | "sec" | "h" | "pct" | "num" | "int" | "bool";

/** One check as a number (what replicates aggregate); `actual` is the single-run text, `target` the window shown. */
export interface CheckValue {
  group: string;
  name: string;
  target: string;
  value: number | null;
  judge: Judge;
  unit: Unit;
}

export const DEFAULT_TOL = 0.25;

export function judgeValue(j: Judge, x: number | null | undefined): Verdict {
  if (j.k === "info") return "INFO";
  if (x === null || x === undefined || !Number.isFinite(x)) return "FAIL";
  switch (j.k) {
    case "within": {
      const tol = j.tol ?? DEFAULT_TOL;
      return x >= j.lo * (1 - tol) && x <= j.hi * (1 + tol) ? "PASS" : "FAIL";
    }
    case "range":
      return x >= j.lo && x <= j.hi ? "PASS" : "FAIL";
    case "atMost":
      return x <= j.hi ? "PASS" : "FAIL";
    case "below":
      return x < j.hi ? "PASS" : "FAIL";
    case "atLeast":
      return x >= j.lo ? "PASS" : "FAIL";
  }
}

/**
 * Median of replicate values; a missing value (null: the milestone was never reached) sorts as +∞, so a median that
 * lands on it is null too. Even counts average the two middle values (a yes/no tie is 0.5: not a «yes» for the judge,
 * and fmtValue prints it «поровну»). null for an empty list.
 */
export function median(xs: readonly (number | null)[]): number | null {
  if (!xs.length) return null;
  const v = xs.map((x) => (x === null || Number.isNaN(x) ? Infinity : x)).sort((a, b) => a - b);
  const m = v.length >> 1;
  const mid = v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  return Number.isFinite(mid) ? mid : null;
}

export interface Aggregate {
  group: string;
  name: string;
  target: string;
  unit: Unit;
  judge: Judge;
  /** Every replicate's value in order (null: not reached). */
  values: (number | null)[];
  median: number | null;
  /** Smallest and largest reached value (null when none was reached). */
  min: number | null;
  max: number | null;
  /** How many replicates did not reach the milestone. */
  missing: number;
  /** The judge applied to the median. */
  verdict: Verdict;
}

/**
 * Aggregate replicate check lists by (group, name), in the order the first list has them (checks only some
 * replicates produce are appended in order of appearance). A replicate without the check counts as missing.
 */
export function aggregateChecks(lists: readonly (readonly CheckValue[])[]): Aggregate[] {
  const keys: string[] = [];
  const first = new Map<string, CheckValue>();
  for (const list of lists)
    for (const c of list) {
      const k = `${c.group}\u0000${c.name}`;
      if (!first.has(k)) {
        first.set(k, c);
        keys.push(k);
      }
    }
  return keys.map((k) => {
    const c = first.get(k)!;
    const values = lists.map((list) => list.find((x) => `${x.group}\u0000${x.name}` === k)?.value ?? null);
    const reached = values.filter((x): x is number => x !== null && Number.isFinite(x));
    const med = median(values);
    return {
      group: c.group,
      name: c.name,
      target: c.target,
      unit: c.unit,
      judge: c.judge,
      values,
      median: med,
      min: reached.length ? Math.min(...reached) : null,
      max: reached.length ? Math.max(...reached) : null,
      missing: values.length - reached.length,
      verdict: judgeValue(c.judge, med),
    };
  });
}

/** A value in its unit: «48:30», «2.63 ч», «34%», «1.2K», «—» when missing. */
export function fmtValue(x: number | null | undefined, unit: Unit): string {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  if (!Number.isFinite(x)) return x > 0 ? "∞" : "−∞";
  switch (unit) {
    case "min":
      return mss(x * 60);
    case "sec":
      return mss(x);
    case "h":
      return `${x.toFixed(2)} ч`;
    case "pct":
      return `${(x * 100).toFixed(0)}%`;
    case "int":
      return Math.abs(x - Math.round(x)) < 1e-9 ? String(Math.round(x)) : x.toFixed(1);
    case "bool":
      return x >= 1 ? "да" : x <= 0 ? "нет" : "поровну";
    case "num": {
      const a = Math.abs(x);
      if (a >= 1e9) return (x / 1e9).toFixed(2) + "B";
      if (a >= 1e6) return (x / 1e6).toFixed(2) + "M";
      if (a >= 1e4) return (x / 1e3).toFixed(1) + "K";
      if (a >= 100) return x.toFixed(0);
      if (a >= 10) return x.toFixed(1);
      return x.toFixed(2);
    }
  }
}

function mss(sec: number): string {
  const sign = sec < 0 ? "−" : "";
  const a = Math.abs(sec);
  const m = Math.floor(a / 60);
  const s = Math.floor(a % 60);
  return `${sign}${m}:${String(s).padStart(2, "0")}`;
}

/** «48:30 (42:13–55:00)», with «, 1 нет» when replicates missed the milestone. */
export function fmtAggregate(a: Aggregate): string {
  const range = a.min === null ? "" : a.min === a.max ? "" : ` (${fmtValue(a.min, a.unit)}–${fmtValue(a.max, a.unit)})`;
  const miss = a.missing ? `, ${a.missing} нет` : "";
  return `${fmtValue(a.median, a.unit)}${range}${miss}`;
}

/**
 * Relative move of a metric against its baseline (sim-matrix --baseline): |now − base| / |base|; 0 when both are
 * equal (both missing included), 1 when only one of them is missing or the baseline is 0 and the value is not.
 */
export function relMove(now: number | null, base: number | null): number {
  if (now === null || base === null) return now === base ? 0 : 1;
  if (now === base) return 0;
  return base !== 0 ? Math.abs(now - base) / Math.abs(base) : 1;
}
