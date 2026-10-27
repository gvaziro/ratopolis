/**
 * Geometry of the London map on the «Переселение» masthead (PAN-2): the twelve districts at DISTRICTS[id].pos, the
 * Thames, the roads between neighbours, the colony's route and the status of every district. Pure (LondonMap.tsx draws
 * it, londonGeo.test.ts checks it). Map units: MAP_W wide (= 100% of the map's width, so 1 unit = 1cqw), MAP_H tall.
 */
import { DISTRICTS, DISTRICT_ORDER, type DistrictId } from "@/game/data/districts";

export const MAP_W = 100;
export const MAP_H = 58;

/** Districts per lap of London (a second lap starts over with «II»). */
export const LAP = DISTRICT_ORDER.length;

/** DISTRICTS[id].pos (0..100 both ways) → map units: a small margin, the north–south axis squeezed ×0.75. */
export function mapXY(p: { x: number; y: number }): { x: number; y: number } {
  return { x: 4 + p.x * 0.92, y: 3 + (p.y - 10) * 0.75 };
}

export function districtXY(id: DistrictId): { x: number; y: number } {
  return mapXY((DISTRICTS[id] ?? DISTRICTS.whitechapel).pos);
}

/**
 * Where a district's name sits: centred above (n) or below (s) its dot, beside it (e, w), or above/below running off
 * to one side from just past the dot (ne, nw, se, sw).
 */
export type LabelSide = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/**
 * Searched, not guessed: at 262–400 px of map width (320 px phones to the desktop panel) no two names, no name and
 * another district's dot and no name and the crown pin touch, whichever district the colony lives in (PIN_DODGE moves
 * the one name a particular pin would cover). londonGeo.test.ts re-checks it with the names' measured widths.
 */
export const LABEL_SIDE: Record<DistrictId, LabelSide> = {
  whitechapel: "ne",
  southwark: "s",
  lambeth: "s",
  bloomsbury: "nw",
  mayfair: "w",
  westminster: "w",
  city: "n",
  covent_garden: "se",
  kings_cross: "e",
  docklands: "s",
  chelsea: "s",
  greenwich: "s",
};

/** With the crown pin on the key district, these names move to another side. */
export const PIN_DODGE: Partial<Record<DistrictId, Partial<Record<DistrictId, LabelSide>>>> = {
  chelsea: { westminster: "s" },
};

/** Gaps between a dot's centre and its name, in map units: above/below, beside, and above the crown pin. */
export const LABEL_GAP = { ns: 2.3, ew: 2.4, ewPin: 2.8, nPin: 8.4, lean: 1.6 };

/** The side of `id`'s name while the colony lives in `here`. */
export function labelSide(id: DistrictId, here: DistrictId): LabelSide {
  return PIN_DODGE[here]?.[id] ?? LABEL_SIDE[id] ?? "s";
}

/**
 * The name's box in px for a map `widthPx` wide (labelTransform's offsets; `w` = the name's width in px, 11 px tall):
 * londonGeo.test.ts checks the placement with it.
 */
export function labelBox(id: DistrictId, side: LabelSide, pin: boolean, w: number, widthPx: number): { x: number; y: number; w: number; h: number } {
  const u = widthPx / MAP_W;
  const h = 11;
  const g = LABEL_GAP;
  const { x, y } = districtXY(id);
  const cx = x * u;
  const cy = y * u;
  const above = cy - (pin ? g.nPin : g.ns) * u - h;
  const below = cy + g.ns * u;
  switch (side) {
    case "n":
      return { x: cx - w / 2, y: above, w, h };
    case "s":
      return { x: cx - w / 2, y: below, w, h };
    case "ne":
      return { x: cx - g.lean * u, y: above, w, h };
    case "nw":
      return { x: cx + g.lean * u - w, y: above, w, h };
    case "se":
      return { x: cx - g.lean * u, y: below, w, h };
    case "sw":
      return { x: cx + g.lean * u - w, y: below, w, h };
    case "e":
      return { x: cx + (pin ? g.ewPin : g.ew) * u, y: cy - h / 2, w, h };
    default:
      return { x: cx - (pin ? g.ewPin : g.ew) * u - w, y: cy - h / 2, w, h };
  }
}

/** The CSS transform that puts a name (absolutely placed at its dot's centre) where labelBox says. */
export function labelTransform(side: LabelSide, pin: boolean): string {
  const g = LABEL_GAP;
  const above = `calc(-100% - ${pin ? g.nPin : g.ns}cqw)`;
  const below = `${g.ns}cqw`;
  switch (side) {
    case "n":
      return `translate(-50%, ${above})`;
    case "s":
      return `translate(-50%, ${below})`;
    case "ne":
      return `translate(-${g.lean}cqw, ${above})`;
    case "nw":
      return `translate(calc(-100% + ${g.lean}cqw), ${above})`;
    case "se":
      return `translate(-${g.lean}cqw, ${below})`;
    case "sw":
      return `translate(calc(-100% + ${g.lean}cqw), ${below})`;
    case "e":
      return `translate(${pin ? g.ewPin : g.ew}cqw, -50%)`;
    default:
      return `translate(calc(-100% - ${pin ? g.ewPin : g.ew}cqw), -50%)`;
  }
}

/** The Thames through the districts' own coordinates: south of Chelsea, between Westminster and Lambeth, the City and
 * Southwark, round the Isle of Dogs north of Greenwich; it runs off both edges of the map. */
const THAMES: [number, number][] = [
  [-8, 67],
  [6, 68],
  [18, 66],
  [28, 63],
  [34, 60],
  [42, 57],
  [52, 55],
  [62, 53],
  [72, 53],
  [80, 55],
  [84, 60],
  [86, 65],
  [90, 66.5],
  [94, 62],
  [100, 57],
  [110, 56],
];

/** A smooth SVG path through points (Catmull–Rom as cubic Béziers), rounded to 0.01. */
export function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return "";
  const r = (n: number) => Math.round(n * 100) / 100;
  let d = `M${r(pts[0].x)} ${r(pts[0].y)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += ` C${r(c1.x)} ${r(c1.y)} ${r(c2.x)} ${r(c2.y)} ${r(p2.x)} ${r(p2.y)}`;
  }
  return d;
}

export const THAMES_PATH = smoothPath(THAMES.map(([x, y]) => mapXY({ x, y })));

/** Every pair of neighbouring districts once (the faint roads of the map). */
export const ROADS: [DistrictId, DistrictId][] = (() => {
  const out: [DistrictId, DistrictId][] = [];
  for (const a of DISTRICT_ORDER) {
    for (const b of DISTRICTS[a].neighbors) {
      if (DISTRICT_ORDER.indexOf(b) > DISTRICT_ORDER.indexOf(a)) out.push([a, b]);
    }
  }
  return out;
})();

/** The colony's route: the visited districts up to the current run (a v2 save without `visited` has none yet). */
export function routeOf(visited: readonly DistrictId[], district: number): DistrictId[] {
  return visited.slice(0, Math.max(0, Math.floor(district)) + 1);
}

/** One leg of the route; `lap` = this leg arrives on the current lap of London (earlier laps are drawn faint). */
export interface RouteLeg {
  from: DistrictId;
  to: DistrictId;
  lap: boolean;
}

export function routeLegs(visited: readonly DistrictId[], district: number): RouteLeg[] {
  const route = routeOf(visited, district);
  const lapStart = Math.floor((route.length - 1) / LAP) * LAP;
  const out: RouteLeg[] = [];
  for (let i = 1; i < route.length; i++) out.push({ from: route[i - 1], to: route[i], lap: i >= lapStart });
  return out;
}

/**
 * here — the colony lives here; option — the next Great Migration may lead here; visited — walked on this lap;
 * past — walked on an earlier lap only; ahead — not yet.
 */
export type DistrictMark = "here" | "option" | "visited" | "past" | "ahead";

export function districtMarks(visited: readonly DistrictId[], district: number, options: readonly DistrictId[]): Record<DistrictId, DistrictMark> {
  const route = routeOf(visited, district);
  const here = route[route.length - 1];
  const lapStart = Math.floor((route.length - 1) / LAP) * LAP;
  const lap = new Set(route.slice(lapStart));
  const before = new Set(route.slice(0, lapStart));
  const out = {} as Record<DistrictId, DistrictMark>;
  for (const id of DISTRICT_ORDER) {
    out[id] = id === here ? "here" : options.includes(id) ? "option" : lap.has(id) ? "visited" : before.has(id) ? "past" : "ahead";
  }
  return out;
}

/** Spoken status of a district (the dot's aria-label and the line under the map). */
export const MARK_TEXT: Record<DistrictMark, string> = {
  here: "колония здесь",
  option: "сюда можно переселиться",
  visited: "уже пройден",
  past: "пройден на прошлом круге",
  ahead: "впереди",
};
