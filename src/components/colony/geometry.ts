import { BUILDINGS, VISUAL_TIERS } from "@/game/data/buildings";
import { ZONES, ZONE_ORDER } from "@/game/data/zones";
import type { BuildingId, GameState, JobId, ZoneId } from "@/game/types";

/**
 * World geometry of the colony cross-section (SVG user units).
 * The street strip sits on top, then one band per zone stacked downwards.
 * Each band has 2 rows × 3 columns of chamber slots plus a ladder shaft on the right.
 */

export const W = 720;
export const STREET_H = 120;
export const BAND_H = 380;
export const COLS = [125, 325, 525] as const;
export const SLOT_W = 176;
export const SLOT_H = 148;
/** Floors (rat walkways) relative to the band top. */
export const ROW_FLOOR = [182, 360] as const;
export const SHAFT_X = 676;
export const SHAFT_W = 44;
export const RAIL_L = 16;
export const RAIL_R = 630;
/** Grate centre and size (the main click target). */
export const GRATE = { x: 325, y: 70, w: 196, h: 54 } as const;

/** Camera zoom by number of open zones (1..5). */
export const ZOOMS = [1, 0.85, 0.72, 0.62, 0.55] as const;

export function bandTop(z: ZoneId): number {
  return STREET_H + (ZONES[z].order - 1) * BAND_H;
}

export function floorY(z: ZoneId, row: 0 | 1): number {
  return bandTop(z) + ROW_FLOOR[row];
}

/** Hand-placed slot order per zone (null = decorative slot). Index → row = i / 3, col = i % 3. */
export const ZONE_SLOTS: Record<ZoneId, (BuildingId | null)[]> = {
  burrow: ["trash_chute", "nest", "pantry", "stash", "pickpocket_school", "sorting_den"],
  sewers: ["capsule_tap", "workshop", "sewer_warehouse", "drain_sieve", "water_wheel", "rat_rail"],
  cellars: ["library", "nursery", null, "cheese_tap", null, "cellar_vault"],
  metro: ["boiler", "brass_foundry", "steam_press", "coal_chute", "rail_forge", "platform_post"],
  terminal: [null, "clocktower", null, "lost_luggage", null, "express_depot"],
};

export interface Slot {
  zone: ZoneId;
  row: 0 | 1;
  col: 0 | 1 | 2;
  cx: number;
  floor: number;
}

function slotOf(zone: ZoneId, i: number): Slot {
  const row = (i < 3 ? 0 : 1) as 0 | 1;
  const col = (i % 3) as 0 | 1 | 2;
  return { zone, row, col, cx: COLS[col], floor: floorY(zone, row) };
}

export const BUILDING_SLOT = {} as Record<BuildingId, Slot>;
export const DECOR_SLOTS: Slot[] = [];
for (const z of ZONE_ORDER) {
  ZONE_SLOTS[z].forEach((b, i) => {
    if (b) BUILDING_SLOT[b] = slotOf(z, i);
    else DECOR_SLOTS.push(slotOf(z, i));
  });
}
// any building not hand-placed (future content) falls back to a free slot of its zone
for (const id of Object.keys(BUILDINGS) as BuildingId[]) {
  if (BUILDING_SLOT[id]) continue;
  const z = BUILDINGS[id].zone;
  const free = DECOR_SLOTS.findIndex((s) => s.zone === z);
  if (free >= 0) BUILDING_SLOT[id] = DECOR_SLOTS.splice(free, 1)[0];
  else BUILDING_SLOT[id] = slotOf(z, 0);
}

/** Visual stage of a chamber: the highest VISUAL_TIERS threshold reached (max-level buildings use the raw level). */
export function artLevel(id: BuildingId, level: number): number {
  if (level <= 0) return 0;
  if (BUILDINGS[id].maxLevel !== undefined && BUILDINGS[id].maxLevel! <= 5) return level;
  let t = 0;
  for (const v of VISUAL_TIERS) if (level >= v) t = v;
  return t;
}

export function openZoneCount(s: GameState): number {
  let n = 0;
  for (const z of ZONE_ORDER) if (s.zones[z]) n++;
  return Math.max(1, n);
}

export function deepestOpen(s: GameState): ZoneId {
  let last: ZoneId = "burrow";
  for (const z of ZONE_ORDER) if (s.zones[z]) last = z;
  return last;
}

export function nextLocked(s: GameState): ZoneId | null {
  for (const z of ZONE_ORDER) if (!s.zones[z]) return z;
  return null;
}

/**
 * CO-8: the engine's 0..1 spot of a purse or shiny, remapped into x 0.22–0.78 × y 0.32–0.8 of the colony view so it
 * never hides under the goal widget, the market or the zone pips (UI only: the engine's coordinates stay as they are).
 * Everything that places or reads those spots (BgEvents, the pips' loot dot, FxLayer's reward floats) goes through these.
 */
export function uiX(x: number): number {
  return 0.22 + 0.56 * Math.max(0, Math.min(1, x));
}
export function uiY(y: number): number {
  return 0.32 + 0.48 * Math.max(0, Math.min(1, y));
}

/* ------------------------------------------------------------ rat routing */

export interface Pt {
  x: number;
  y: number;
}

/** Buildings whose existence changes where rats walk. */
export const ROUTE_BUILDINGS: BuildingId[] = [
  "nest",
  "pantry",
  "trash_chute",
  "stash",
  "pickpocket_school",
  "sorting_den",
  "workshop",
  "cheese_tap",
  "library",
  "coal_chute",
  "boiler",
  "brass_foundry",
  "rail_forge",
  "lost_luggage",
];

const JOB_BUILDING: Partial<Record<JobId, BuildingId>> = {
  mechanic: "workshop",
  cheese_thief: "cheese_tap",
  scholar: "library",
  coal_miner: "coal_chute",
  stoker: "boiler",
  smelter: "brass_foundry",
  smith: "rail_forge",
  appraiser: "lost_luggage",
};

const at = (id: BuildingId): Pt => ({ x: BUILDING_SLOT[id].cx, y: BUILDING_SLOT[id].floor });
const UNDER_GRATE: Pt = { x: GRATE.x, y: floorY("burrow", 0) };

/** Where a rat of this job works and where it carries the loot. */
export function jobRoute(job: JobId, built: ReadonlySet<BuildingId>): { work: Pt; home: Pt; spread: number } {
  const home = built.has("pantry") ? at("pantry") : at("nest");
  switch (job) {
    case "idle":
      return { work: { x: 320, y: floorY("burrow", 1) }, home: { x: 320, y: floorY("burrow", 1) }, spread: 260 };
    case "forager":
      return { work: built.has("trash_chute") ? at("trash_chute") : UNDER_GRATE, home, spread: 50 };
    case "pickpocket":
      return { work: UNDER_GRATE, home: built.has("pickpocket_school") ? at("pickpocket_school") : built.has("stash") ? at("stash") : at("nest"), spread: 45 };
    case "scavenger":
      return {
        work: built.has("sorting_den") ? at("sorting_den") : built.has("trash_chute") ? at("trash_chute") : { x: 480, y: floorY("burrow", 1) },
        home: built.has("stash") ? at("stash") : home,
        spread: 50,
      };
    default: {
      const b = JOB_BUILDING[job];
      if (b && built.has(b)) return { work: at(b), home: at("nest"), spread: 50 };
      return { work: { x: 200, y: floorY("burrow", 1) }, home: at("nest"), spread: 120 };
    }
  }
}

/** Waypoints from a position to a target: along the floor to the shaft, climb, then along the target floor. */
export function routeBetween(from: Pt, to: Pt): Pt[] {
  if (Math.abs(from.y - to.y) < 1) return [to];
  return [
    { x: SHAFT_X, y: from.y },
    { x: SHAFT_X, y: to.y },
    to,
  ];
}

/* ------------------------------------------------------------ colours */

/** Mix a #rrggbb colour toward black (amt < 0) or white (amt > 0). */
export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  const t = amt < 0 ? 0 : 255;
  const k = Math.abs(amt);
  r = Math.round(r + (t - r) * k);
  g = Math.round(g + (t - g) * k);
  b = Math.round(b + (t - b) * k);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

/** Deterministic PRNG for static decoration (keeps render pure). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
