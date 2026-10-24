"use client";

/**
 * The narrow-gauge railway (rat_rail): a rail loop around the open zones with thimble carts
 * (one per level, up to 12) carrying resource icons. Carts move along the path in a rAF loop.
 */
import { memo, useEffect, useMemo, useRef } from "react";
import { RESOURCES, RES_ORDER } from "@/game/data/resources";
import { useGame } from "@/game/store";
import { BAND_H, RAIL_L, RAIL_R, STREET_H } from "./geometry";
import { ThimbleCart } from "./parts";

const SPEED = 46; // world units per second

function loopPath(open: number): string {
  const top = STREET_H + 10;
  const bottom = STREET_H + open * BAND_H - 6;
  const l = RAIL_L;
  const r = RAIL_R;
  const c = 26;
  return `M${l + c} ${top}H${r - c}Q${r} ${top} ${r} ${top + c}V${bottom - c}Q${r} ${bottom} ${r - c} ${bottom}H${l + c}Q${l} ${bottom} ${l} ${bottom - c}V${top + c}Q${l} ${top} ${l + c} ${top}z`;
}

export const Rail = memo(function Rail() {
  const level = useGame((s) => s.game.buildings.rat_rail);
  const open = useGame((s) => Object.values(s.game.zones).filter(Boolean).length);
  const flags = useGame((s) => s.game.meta.achievements.first_rail !== undefined);
  const cargoKey = useGame((s) => RES_ORDER.filter((r) => r !== "steam" && s.game.revealed[`res_${r}`]).join(","));
  const pathRef = useRef<SVGPathElement>(null);
  const carts = useRef<(SVGGElement | null)[]>([]);
  const count = Math.min(12, level);
  const d = useMemo(() => loopPath(Math.max(2, open)), [open]);
  const cargo = useMemo(() => {
    const ids = cargoKey ? (cargoKey.split(",") as (keyof typeof RESOURCES)[]) : ["crumbs" as const];
    return Array.from({ length: 12 }, (_, i) => RESOURCES[ids[(i * 5) % ids.length]].icon);
  }, [cargoKey]);

  useEffect(() => {
    if (count <= 0) return;
    let raf = 0;
    const frame = (now: number) => {
      const p = pathRef.current;
      if (p) {
        const len = p.getTotalLength();
        const base = ((now / 1000) * SPEED) % len;
        for (let i = 0; i < count; i++) {
          const el = carts.current[i];
          if (!el) continue;
          const at = (base + (i * len) / count) % len;
          const a = p.getPointAtLength(at);
          const b = p.getPointAtLength((at + 4) % len);
          // carts stay upright on the vertical runs and lean a little through the bends
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const tilt = Math.abs(dx) >= Math.abs(dy) ? (Math.sign(dx) * Math.atan2(dy, Math.abs(dx)) * 180) / Math.PI : 0;
          el.setAttribute("transform", `translate(${a.x.toFixed(1)} ${a.y.toFixed(1)}) rotate(${Math.max(-25, Math.min(25, tilt)).toFixed(1)})`);
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [count, d]);

  if (level <= 0) return null;
  return (
    <g pointerEvents="none">
      <path d={d} fill="none" stroke="#3a2a1a" strokeWidth="9" strokeDasharray="3 6" />
      <path d={d} fill="none" stroke="#9aa2a8" strokeWidth="6" />
      <path ref={pathRef} d={d} fill="none" stroke="#1d1813" strokeWidth="3.4" />
      {Array.from({ length: count }, (_, i) => (
        <g
          key={i}
          transform="translate(-600 -600)"
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
