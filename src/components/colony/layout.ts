/**
 * Pure screen-space layout of the colony's overlays (px inside the colony view), kept apart from the components so it
 * can be tested: the chamber tip and the zone-pip rail.
 */
import type { CamView } from "./camera";
import type { Slot } from "./geometry";

/* ------------------------------------------------------------ chamber tip */

/** Half the tip's width (w-56) plus a margin: the tip's centre never goes nearer the colony's sides. */
export const TIP_HALF = 118;

export interface TipBox {
  /** Centre x (the tip is translated −50%). */
  left: number;
  top: number;
  maxH: number;
}

/**
 * Where the chamber tip goes for camera view `v`: above the niche, else over it from its top, kept inside the colony
 * (a short colony caps it at `maxH`: its body scrolls, the buttons stay). `natH` = the tip's unclamped height.
 * Null once the chamber has left the view.
 */
export function tipBox(v: Readonly<CamView>, slot: Slot, natH: number): TipBox | null {
  const x = v.cw / 2 + (slot.cx - v.cx) * v.s;
  const top = v.ch / 2 + (slot.floor - 150 - v.cy) * v.s;
  const floor = v.ch / 2 + (slot.floor - v.cy) * v.s;
  const half = 88 * v.s;
  if (floor < 0 || top > v.ch || x + half < 0 || x - half > v.cw) return null;
  const maxH = Math.max(80, v.ch - 16);
  const h = Math.min(natH, maxH);
  const y = top - h >= 8 ? top - h : Math.max(8, Math.min(top + 8, v.ch - 8 - h));
  return { left: Math.max(TIP_HALF, Math.min(v.cw - TIP_HALF, x)), top: Math.round(y), maxH };
}

/* ------------------------------------------------------------ zone pips */

/** Pip size and gap; the rail is one column (5 zones + 🔭 a step lower) or a 2-column grid of 3 rows. */
const PIP = 32;
const GAP = 4;
export const RAIL_COL_H = 6 * PIP + 5 * GAP + 4;
export const RAIL_GRID_H = 3 * PIP + 2 * GAP;
/** Kept free at the bottom right for «⤒ К решётке» (44 px at bottom-2; always kept, so the pips never jump). */
export const AWAY_H = 56;

export interface RailBox {
  grid: boolean;
  top: number;
  right: number;
}

/**
 * The rail sits between the steam gauge (its measured box at top-2 right-2; 0×0 while hidden) and the «⤒ К решётке»
 * button: a column when it fits, else a 2-column grid; when not even the grid fits under the gauge (landscape phones,
 * short windows) the grid moves beside the gauge.
 */
export function railBox(ch: number, gauge: { w: number; h: number }): RailBox {
  const top = gauge.h > 0 ? 8 + gauge.h + 6 : 8;
  const room = ch - top - AWAY_H;
  if (room >= RAIL_COL_H) return { grid: false, top: Math.round(top + (room - RAIL_COL_H) / 2), right: 4 };
  if (room >= RAIL_GRID_H || gauge.w <= 0) return { grid: true, top: Math.round(top + Math.max(0, room - RAIL_GRID_H) / 2), right: 4 };
  return { grid: true, top: Math.round(8 + Math.max(0, ch - 8 - AWAY_H - RAIL_GRID_H) / 2), right: 8 + gauge.w + 8 };
}
