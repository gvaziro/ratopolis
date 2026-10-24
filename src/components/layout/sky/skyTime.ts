/**
 * Time of day for «Наверху»: sky gradient, tint over the street, lit windows and gas lamps,
 * all as a pure function of the human minute of the day (0..1439).
 * dawn 05–07 (pink), day 07–17, dusk 17–19 (orange), night 19–05 (gas lamps light up one by one).
 */

type RGB = [number, number, number];

interface Key {
  m: number;
  top: RGB;
  bottom: RGB;
  tint: RGB;
  tintA: number;
}

const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

const NIGHT: Omit<Key, "m"> = { top: hex("#070b18"), bottom: hex("#1b2140"), tint: hex("#0a1232"), tintA: 0.56 };

const KEYS: Key[] = [
  { m: 0, ...NIGHT },
  { m: 300, top: hex("#0d1228"), bottom: hex("#2c2546"), tint: hex("#10183a"), tintA: 0.5 },
  { m: 345, top: hex("#3b3058"), bottom: hex("#c98a9a"), tint: hex("#50304a"), tintA: 0.3 },
  { m: 375, top: hex("#5a5a82"), bottom: hex("#f0a8a0"), tint: hex("#ff8fa0"), tintA: 0.14 },
  { m: 420, top: hex("#7f9ab4"), bottom: hex("#e2d2bc"), tint: hex("#ffd0b0"), tintA: 0.04 },
  { m: 720, top: hex("#94abc0"), bottom: hex("#e2d9c6"), tint: hex("#ffffff"), tintA: 0 },
  { m: 1020, top: hex("#8a9db2"), bottom: hex("#dcc9ac"), tint: hex("#ffd8a0"), tintA: 0.04 },
  { m: 1065, top: hex("#5d4a6a"), bottom: hex("#f09a52"), tint: hex("#ff8a3a"), tintA: 0.16 },
  { m: 1110, top: hex("#2f2648"), bottom: hex("#b4544a"), tint: hex("#40204a"), tintA: 0.34 },
  { m: 1140, ...NIGHT },
  { m: 1440, ...NIGHT },
];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const mix = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const css = (c: RGB) => `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`;

export type Phase = "dawn" | "day" | "dusk" | "night";

export interface SkyLook {
  minute: number;
  phase: Phase;
  skyTop: string;
  skyBottom: string;
  tint: string;
  tintA: number;
  /** 0 (day) .. 1 (deep night): drives stars, lamp halo strength, grate glow. */
  dark: number;
  /** Share of windows lit (0..1). */
  windows: number;
  /** Sun (day) or moon (night) position in 0..1 of the arc; null when below the horizon. */
  sun: number | null;
  moon: number | null;
}

export function phaseOf(m: number): Phase {
  if (m >= 300 && m < 420) return "dawn";
  if (m >= 420 && m < 1020) return "day";
  if (m >= 1020 && m < 1140) return "dusk";
  return "night";
}

export function skyLook(minute: number): SkyLook {
  const m = ((minute % 1440) + 1440) % 1440;
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1].m <= m) i++;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const t = b.m === a.m ? 0 : (m - a.m) / (b.m - a.m);
  const dark = m >= 1140 || m < 300 ? 1 : m < 420 ? 1 - (m - 300) / 120 : m >= 1020 ? (m - 1020) / 120 : 0;
  return {
    minute: m,
    phase: phaseOf(m),
    skyTop: css(mix(a.top, b.top, t)),
    skyBottom: css(mix(a.bottom, b.bottom, t)),
    tint: css(mix(a.tint, b.tint, t)),
    tintA: lerp(a.tintA, b.tintA, t),
    dark,
    windows: windowsLit(m),
    sun: m >= 330 && m <= 1110 ? (m - 330) / (1110 - 330) : null,
    moon: m >= 1150 || m <= 290 ? ((m >= 1150 ? m - 1150 : m + 290) / (290 + 290)) : null,
  };
}

/** Share of lit windows: evening peak, a few night owls, an early-morning kettle. */
function windowsLit(m: number): number {
  const pts: [number, number][] = [
    [0, 0.18],
    [180, 0.07],
    [300, 0.1],
    [360, 0.3],
    [420, 0.06],
    [480, 0],
    [990, 0],
    [1050, 0.25],
    [1140, 0.7],
    [1290, 0.45],
    [1440, 0.18],
  ];
  for (let k = 0; k < pts.length - 1; k++) {
    const [m0, v0] = pts[k];
    const [m1, v1] = pts[k + 1];
    if (m >= m0 && m <= m1) return lerp(v0, v1, (m - m0) / (m1 - m0));
  }
  return 0;
}

/**
 * Gas lamp `i` (counted left to right) is lit at this minute: the lamplighter goes round at 19:00
 * lighting one lamp every 6 human minutes and puts them out from 05:30 in the same order.
 */
export function lampLit(m: number, i: number): boolean {
  const on = 1140 + i * 6;
  const off = 330 + i * 6;
  if (m >= on) return true;
  if (m < off) return true;
  return false;
}
