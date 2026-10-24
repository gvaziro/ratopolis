"use client";

/**
 * The narrow-gauge railway (rat_rail): a rail loop around the open zones with thimble carts
 * (one per level, up to 12) carrying resource icons. The loop is sampled once into a lookup table;
 * the rAF loop only interpolates it and writes a transform when the rounded string changed.
 */
import { memo, useEffect, useMemo, useRef } from "react";
import { RESOURCES, RES_ORDER } from "@/game/data/resources";
import { useGame } from "@/game/store";
import { camView } from "./camera";
import { BAND_H, RAIL_L, RAIL_R, STREET_H } from "./geometry";
import { ThimbleCart } from "./parts";
import { colonyPaused } from "./registry";

const SPEED = 46; // world units per second
const CORNER = 26;
/** Lookup-table spacing (world units). */
const STEP = 4;

function loopGeom(open: number) {
  return { top: STREET_H + 10, bottom: STREET_H + open * BAND_H - 6, l: RAIL_L, r: RAIL_R, c: CORNER };
}

function loopPath(open: number): string {
  const { top, bottom, l, r, c } = loopGeom(open);
  return `M${l + c} ${top}H${r - c}Q${r} ${top} ${r} ${top + c}V${bottom - c}Q${r} ${bottom} ${r - c} ${bottom}H${l + c}Q${l} ${bottom} ${l} ${bottom - c}V${top + c}Q${l} ${top} ${l + c} ${top}z`;
}

interface RailTable {
  xs: Float32Array;
  ys: Float32Array;
  /** Cart lean in degrees: upright on the vertical runs, a little lean through the bends. */
  tilt: Float32Array;
  n: number;
  len: number;
  step: number;
}

/** Sample the loop (same geometry as loopPath) at ~STEP units, analytically — no getPointAtLength per frame. */
function buildTable(open: number): RailTable {
  const { top, bottom, l, r, c } = loopGeom(open);
  const pts: number[] = [l + c, top];
  const lineTo = (x: number, y: number) => pts.push(x, y);
  const quadTo = (qx: number, qy: number, x: number, y: number) => {
    const x0 = pts[pts.length - 2];
    const y0 = pts[pts.length - 1];
    for (let k = 1; k <= 16; k++) {
      const t = k / 16;
      const u = 1 - t;
      pts.push(u * u * x0 + 2 * u * t * qx + t * t * x, u * u * y0 + 2 * u * t * qy + t * t * y);
    }
  };
  lineTo(r - c, top);
  quadTo(r, top, r, top + c);
  lineTo(r, bottom - c);
  quadTo(r, bottom, r - c, bottom);
  lineTo(l + c, bottom);
  quadTo(l, bottom, l, bottom - c);
  lineTo(l, top + c);
  quadTo(l, top, l + c, top);

  // cumulative length of the dense polyline
  const m = pts.length / 2;
  const cum = new Float64Array(m);
  for (let i = 1; i < m; i++) cum[i] = cum[i - 1] + Math.hypot(pts[2 * i] - pts[2 * i - 2], pts[2 * i + 1] - pts[2 * i - 1]);
  const len = cum[m - 1];
  const n = Math.max(8, Math.ceil(len / STEP));
  const step = len / n;
  const xs = new Float32Array(n);
  const ys = new Float32Array(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const at = i * step;
    while (j < m - 2 && cum[j + 1] < at) j++;
    const seg = Math.max(1e-9, cum[j + 1] - cum[j]);
    const t = Math.max(0, Math.min(1, (at - cum[j]) / seg));
    xs[i] = pts[2 * j] + (pts[2 * j + 2] - pts[2 * j]) * t;
    ys[i] = pts[2 * j + 1] + (pts[2 * j + 3] - pts[2 * j + 1]) * t;
  }
  const tilt = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const k = (i + 1) % n;
    const dx = xs[k] - xs[i];
    const dy = ys[k] - ys[i];
    const a = Math.abs(dx) >= Math.abs(dy) ? (Math.sign(dx) * Math.atan2(dy, Math.abs(dx)) * 180) / Math.PI : 0;
    tilt[i] = Math.max(-25, Math.min(25, a));
  }
  return { xs, ys, tilt, n, len, step };
}

/** Cart transform at arc position `at` (0..len). */
function cartAt(tb: RailTable, at: number): { x: number; y: number; a: number } {
  const f = at / tb.step;
  const i0 = Math.floor(f) % tb.n;
  const i1 = (i0 + 1) % tb.n;
  const t = f - Math.floor(f);
  return {
    x: tb.xs[i0] + (tb.xs[i1] - tb.xs[i0]) * t,
    y: tb.ys[i0] + (tb.ys[i1] - tb.ys[i0]) * t,
    a: tb.tilt[i0] + (tb.tilt[i1] - tb.tilt[i0]) * t,
  };
}

function cartTransform(p: { x: number; y: number; a: number }): string {
  return `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) rotate(${p.a.toFixed(1)})`;
}

export const Rail = memo(function Rail() {
  const level = useGame((s) => s.game.buildings.rat_rail);
  const open = useGame((s) => Object.values(s.game.zones).filter(Boolean).length);
  const flags = useGame((s) => s.game.meta.achievements.first_rail !== undefined);
  const cargoKey = useGame((s) => RES_ORDER.filter((r) => r !== "steam" && s.game.revealed[`res_${r}`]).join(","));
  const rm = useGame((s) => s.game.settings.reducedMotion);
  const carts = useRef<(SVGGElement | null)[]>([]);
  const count = Math.min(12, level);
  const loopOpen = Math.max(2, open);
  const d = useMemo(() => loopPath(loopOpen), [loopOpen]);
  const table = useMemo(() => buildTable(loopOpen), [loopOpen]);
  const cargo = useMemo(() => {
    const ids = cargoKey ? (cargoKey.split(",") as (keyof typeof RESOURCES)[]) : ["crumbs" as const];
    return Array.from({ length: 12 }, (_, i) => RESOURCES[ids[(i * 5) % ids.length]].icon);
  }, [cargoKey]);
  // reduced motion: the carts stand still, evenly spaced around the loop
  const still = useMemo(() => (rm ? Array.from({ length: count }, (_, i) => cartTransform(cartAt(table, (i * table.len) / Math.max(1, count)))) : null), [rm, count, table]);

  useEffect(() => {
    if (count <= 0 || rm) return;
    let raf = 0;
    const last: string[] = [];
    const lastY = new Float64Array(count).fill(NaN);
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (colonyPaused()) return;
      const v = camView();
      const hy = v.ch / 2 / v.s + 40;
      const y0 = v.cy - hy;
      const y1 = v.cy + hy;
      const base = ((now / 1000) * SPEED) % table.len;
      for (let i = 0; i < count; i++) {
        const el = carts.current[i];
        if (!el) continue;
        const p = cartAt(table, (base + (i * table.len) / count) % table.len);
        // a cart that left the view keeps its last (already off-screen) transform
        if ((p.y < y0 || p.y > y1) && (lastY[i] < y0 || lastY[i] > y1)) continue;
        const tr = cartTransform(p);
        if (tr === last[i]) continue;
        last[i] = tr;
        lastY[i] = p.y;
        el.setAttribute("transform", tr);
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [count, table, rm]);

  if (level <= 0) return null;
  return (
    <g pointerEvents="none">
      <path d={d} fill="none" stroke="#3a2a1a" strokeWidth="9" strokeDasharray="3 6" />
      <path d={d} fill="none" stroke="#9aa2a8" strokeWidth="6" />
      <path d={d} fill="none" stroke="#1d1813" strokeWidth="3.4" />
      {Array.from({ length: count }, (_, i) => (
        <g
          key={i}
          transform={still?.[i] ?? "translate(-600 -600)"}
          ref={(el) => {
            carts.current[i] = el;
          }}
        >
          <ThimbleCart x={0} y={0} cargo={cargo[i]} flag={flags} />
        </g>
      ))}
    </g>
  );
});
