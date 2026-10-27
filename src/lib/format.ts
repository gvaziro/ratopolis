let sci = false;
/** Switch between suffixes (1.2M) and scientific notation (1.2e6) for large numbers. */
export function setSciNotation(on: boolean): void {
  sci = on;
}

const SUFFIXES = ["", "K", "M", "B", "T", "Qa", "Qi", "Sx", "Sp", "Oc", "No", "Dc"];

/** Compact number for display: 999, 1.23K, 45.6M, 1.00e36. */
export function fmt(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return n > 0 ? "∞" : n < 0 ? "-∞" : "—";
  const sign = n < 0 ? "-" : "";
  const a = Math.abs(n);
  if (a < 1000) {
    if (a === 0) return "0";
    if (a < 10 && !Number.isInteger(a)) return sign + trimZeros(a.toFixed(digits));
    if (a < 100 && !Number.isInteger(a)) return sign + trimZeros(a.toFixed(1));
    return sign + Math.floor(a).toString();
  }
  if (sci && a >= 1e6) return sign + a.toExponential(2).replace("e+", "e");
  const tier = Math.floor(Math.log10(a) / 3);
  if (tier < SUFFIXES.length) {
    const scaled = a / Math.pow(1000, tier);
    const d = scaled >= 100 ? 1 : digits;
    return sign + trimZeros(scaled.toFixed(d)) + SUFFIXES[tier];
  }
  return sign + a.toExponential(2).replace("e+", "e");
}

/** Integer-ish display (rats, levels). */
export function fmtInt(n: number): string {
  if (Math.abs(n) < 1000) return Math.floor(n).toString();
  return fmt(n);
}

/** Per-second rate with explicit sign: "+1.2K/с". */
export function fmtRate(perSec: number): string {
  if (perSec === 0) return "0/с";
  return (perSec > 0 ? "+" : "") + fmt(perSec) + "/с";
}

export function fmtPct(fraction: number, digits = 0): string {
  return (fraction * 100).toFixed(digits) + "%";
}

/** Longest ETA fmtTime spells out (100 h); anything longer reads «> 4 д» (v3: no more «1.01e+25д»). */
export const FMT_TIME_MAX_SEC = 100 * 3600;

/**
 * Seconds to a short Russian ETA: "45с", "3м 12с", "1ч 05м", "2д 3ч"; ≥ 100 ч → "> 4 д"; NaN/±∞ → "—".
 * For elapsed time that may run past days (play time, absences) use fmtDuration.
 */
export function fmtTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "—";
  if (seconds >= FMT_TIME_MAX_SEC) return "> 4 д";
  return fmtDuration(seconds);
}

/** Elapsed seconds without the ETA cap: "45с", "3м 12с", "1ч 05м", "12д 3ч" (NaN/±∞ → "—"). */
export function fmtDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return "—";
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}с`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}м ${String(s % 60).padStart(2, "0")}с`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}ч ${String(m % 60).padStart(2, "0")}м`;
  const d = Math.floor(h / 24);
  return `${d}д ${h % 24}ч`;
}

/** Russian noun form for a count: plural(n, "крыса", "крысы", "крыс") — 1/21/31 → one, 2–4/22–24 → few, else many. */
export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(Math.floor(n));
  const m10 = a % 10;
  const m100 = a % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

function trimZeros(s: string): string {
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}
