/**
 * Geometry of the «Наверху» street. Units: the viewBox is W × 88 (88 = strip height on desktop),
 * so one unit is one CSS pixel at 88 px and 0.64 px on phones (56 px).
 * Everything zone-specific is placed relative to the focal x `C` (the grate, above the colony's grate).
 */

export const H = 88;
export const PAVE_TOP = 70; // where the house fronts stand
export const PAVE_FRONT = 77;
export const ROAD_TOP = 79;
export const MARGIN = 44; // drawn beyond the edges so the parallax pan never shows a gap

export function rng(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Span {
  x0: number;
  x1: number;
}

export interface SkyLayout {
  W: number;
  C: number;
  z: number;
  grate: number;
  lamps: number[];
  manhole: number | null;
  pillar: number | null;
  house: (Span & { win: number }) | null;
  shop: Span | null;
  entrance: (Span & { door: number }) | null;
  /** Start of the open railway cutting (metro+), null below. */
  cut: number | null;
  station: (Span & { mid: number }) | null;
  walkMin: number;
  walkMax: number;
  /** Walkers disappear into the Underground entrance at walkMax. */
  door: boolean;
}

export function layoutFor(W: number, C: number, z: number): SkyLayout {
  const metro = z >= 4;
  const terminal = z >= 5;
  const entrance = metro ? { x0: C + 118, x1: C + 176, door: C + 147 } : null;
  const cut = metro ? C + 176 : null;
  const pillar = z >= 2 && !metro ? C + 56 : null;
  const manhole = z >= 2 ? C - 118 : null;
  const station = terminal ? { x0: C - 172, x1: C + 104, mid: C - 34 } : null;
  const house = z >= 3 && !terminal ? { x0: C + 14, x1: C + 150, win: C + 100 } : null;
  const shop = z >= 3 ? (terminal ? { x0: C - 300, x1: C - 182 } : { x0: C - 196, x1: C - 78 }) : null;

  // gas lamps every 160 units from just left of the grate, kept clear of the pillar and the entrance
  const lamps: number[] = [];
  const right = cut !== null ? cut - 14 : W + MARGIN;
  for (let x = C - 40; x > -MARGIN; x -= 160) lamps.unshift(x);
  for (let x = C + 120; x < right; x += 160) lamps.push(x);
  const clear = (x: number) =>
    (pillar === null || Math.abs(x - pillar) > 16) && (entrance === null || x < entrance.x0 - 8 || x > entrance.x1 + 8);
  const lampsOk = lamps.filter(clear);

  return {
    W,
    C,
    z,
    grate: C,
    lamps: lampsOk,
    manhole,
    pillar,
    house,
    shop,
    entrance,
    cut,
    station,
    walkMin: -30,
    walkMax: entrance ? entrance.door : W + 30,
    door: !!entrance,
  };
}

/* ------------------------------------------------------------ far rooftops */

export interface Roof {
  x: number;
  w: number;
  h: number; // height above the far base line
  kind: "flat" | "gable" | "mansard";
  chimneys: { x: number; h: number; smoke: boolean }[];
}

export const FAR_BASE = 66;

/** Far skyline from -MARGIN to W+MARGIN, stable per position (seeded by a fixed seed, not by W). */
export function farRoofs(W: number): Roof[] {
  const r = rng(1887);
  const out: Roof[] = [];
  let x = -MARGIN - 20;
  const maxSmoke = Math.min(8, 2 + Math.floor(W / 220));
  let smokes = 0;
  while (x < W + MARGIN) {
    const w = 26 + r() * 44;
    const h = 24 + r() * 20;
    const kr = r();
    const kind: Roof["kind"] = kr < 0.45 ? "flat" : kr < 0.8 ? "gable" : "mansard";
    const chimneys: Roof["chimneys"] = [];
    const n = r() < 0.75 ? 1 + Math.floor(r() * 2) : 0;
    for (let i = 0; i < n; i++) {
      const smoke = r() < 0.22 && smokes < maxSmoke;
      if (smoke) smokes++;
      chimneys.push({ x: 4 + r() * (w - 12), h: 4 + r() * 5, smoke });
    }
    out.push({ x, w, h, kind, chimneys });
    x += w - 2;
  }
  return out;
}

/* ------------------------------------------------------------ mid houses */

export interface House {
  x: number;
  w: number;
  h: number;
  color: string;
  trim: string;
  roof: "flat" | "mansard" | "gable";
  cols: number;
  rows: number;
  door: number | null; // x offset of a door
  shopfront: boolean;
  awning: string | null;
  chimney: number | null;
  windows: { x: number; y: number; w: number; h: number; r: number }[];
}

const BRICKS = ["#5b3f31", "#4e3a30", "#634536", "#46393a", "#574a3f", "#6e5c49", "#3f3433"];
const TRIMS = ["#8a7a66", "#7a6a58", "#9a8a72", "#6a5c4c"];
const AWNINGS = ["#7a2620", "#2d5f53", "#7d5f2c", "#3a3a5a"];

/** Fill [a, b] with terraced houses (exactly), seeded by the interval so it is stable. */
export function fillHouses(a: number, b: number, seed: number): House[] {
  const out: House[] = [];
  if (b - a < 8) return out;
  const r = rng(seed);
  let x = a;
  while (x < b - 1) {
    let w = 40 + r() * 46;
    if (b - (x + w) < 34) w = b - x; // stretch the last one to close the gap
    // a terrace is two or three storeys; now and then a taller block
    const h = r() < 0.18 ? 38 + r() * 8 : 21 + r() * 16;
    out.push(makeHouse(x, w, h, r));
    x += w;
    // an alley now and then lets the far roofs show through
    if (b - x > 60 && r() < 0.22) x += 6 + r() * 10;
  }
  return out;
}

function makeHouse(x: number, w: number, h: number, r: () => number): House {
  const rr = r();
  const roof: House["roof"] = rr < 0.55 ? "flat" : rr < 0.8 ? "mansard" : "gable";
  const shopfront = r() < 0.3 && w > 50 && h >= 30;
  const cols = Math.max(1, Math.floor((w - 8) / 12));
  const rows = Math.max(1, Math.floor((h - (shopfront ? 16 : 12)) / 12));
  const windows: House["windows"] = [];
  const gx = (w - cols * 12) / 2 + 4;
  for (let row = 0; row < rows; row++) {
    for (let c = 0; c < cols; c++) {
      windows.push({ x: x + gx + c * 12, y: PAVE_TOP - h + 7 + row * 12, w: 4.4, h: 6.4, r: r() });
    }
  }
  if (shopfront) windows.push({ x: x + 5, y: PAVE_TOP - 11, w: w - 22, h: 7, r: r() * 0.6 });
  return {
    x,
    w,
    h,
    color: BRICKS[Math.floor(r() * BRICKS.length)],
    trim: TRIMS[Math.floor(r() * TRIMS.length)],
    roof,
    cols,
    rows,
    door: !shopfront && r() < 0.6 ? 3 + r() * (w - 10) : shopfront ? w - 12 : null,
    shopfront,
    awning: shopfront ? AWNINGS[Math.floor(r() * AWNINGS.length)] : null,
    chimney: r() < 0.6 ? 4 + r() * (w - 12) : null,
    windows,
  };
}

/** Mid-layer houses around the special buildings of this layout. */
export function midHouses(L: SkyLayout): House[] {
  const specials: Span[] = [];
  if (L.house) specials.push(L.house);
  if (L.shop) specials.push(L.shop);
  if (L.station) specials.push(L.station);
  specials.sort((p, q) => p.x0 - q.x0);
  const out: House[] = [];
  let a = -MARGIN - 10;
  for (const s of specials) {
    if (s.x0 > a) out.push(...fillHouses(a, s.x0, Math.round(a * 7 + 13)));
    a = Math.max(a, s.x1);
  }
  out.push(...fillHouses(a, L.W + MARGIN + 10, Math.round(a * 7 + 13)));
  return out;
}
