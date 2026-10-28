"use client";

/**
 * Work beats: every 2.4 s each producing chamber in view "exhales" its main output — the resource icon and
 * `+amount` (one beat's worth) pop above the niche, rise and fade, and the chamber gives a little squash.
 * A fixed pool of SVG nodes animated imperatively: no React render per beat or per frame.
 */
import { cancelDecoFrame, decoFrame } from "@/lib/eco";
import { memo, useEffect, useRef } from "react";
import { RESOURCES } from "@/game/data/resources";
import { resMult } from "@/game/engine/derive";
import { entries } from "@/game/engine/formulas";
import { derivedOf, useGame } from "@/game/store";
import { BUILDING_IDS, type BuildingId, type ResId } from "@/game/types";
import { fmt } from "@/lib/format";
import { camView } from "./camera";
import { BUILDING_SLOT } from "./geometry";
import { colonyPaused, pokeChamber } from "./registry";

const BEAT = 2.4; // s
const POOL = 24;
const MAX_POPS = 10;
const RISE = 36; // world units
const DUR = 900; // ms
/** Height of the pop above the chamber floor. */
const LIFT = 118;

interface Pop {
  active: boolean;
  started: boolean;
  start: number;
  x: number;
  y: number;
  id: BuildingId | null;
  rm: boolean;
}

export const WorkBeats = memo(function WorkBeats() {
  const nodes = useRef<(SVGGElement | null)[]>([]);

  useEffect(() => {
    const pops: Pop[] = Array.from({ length: POOL }, () => ({ active: false, started: false, start: 0, x: 0, y: 0, id: null, rm: false }));
    let raf = 0;

    const frame = (now: number) => {
      let any = false;
      for (let i = 0; i < POOL; i++) {
        const p = pops[i];
        if (!p.active) continue;
        const el = nodes.current[i];
        if (!el) {
          p.active = false;
          continue;
        }
        const t = (now - p.start) / DUR;
        if (t < 0) {
          any = true; // staggered: not its turn yet
          continue;
        }
        if (!p.started) {
          p.started = true;
          if (p.id) pokeChamber(p.id, 0.12);
        }
        if (t >= 1) {
          p.active = false;
          el.setAttribute("opacity", "0");
          continue;
        }
        any = true;
        const e = 1 - (1 - t) * (1 - t);
        const rise = p.rm ? 0 : RISE * e;
        const op = t < 0.15 ? t / 0.15 : t > 0.6 ? (1 - t) / 0.4 : 1;
        el.setAttribute("transform", `translate(${p.x.toFixed(1)} ${(p.y - rise).toFixed(1)})`);
        el.setAttribute("opacity", op.toFixed(2));
      }
      raf = any ? decoFrame(frame) : 0;
    };

    const beat = () => {
      if (colonyPaused()) return;
      const g = useGame.getState().game;
      const d = derivedOf(g);
      const v = camView();
      if (v.cw <= 1) return;
      const hw = v.cw / 2 / v.s;
      const hh = v.ch / 2 / v.s;
      // counter-scaled so the numbers stay ≥ 11 css px at home zoom (capped for the 🔭 overview)
      const fs = Math.min(34, Math.max(13, 11 / v.s));
      const rm = g.settings.reducedMotion;
      const now = performance.now();
      let n = 0;
      for (const id of BUILDING_IDS) {
        if (n >= MAX_POPS) break;
        if (g.buildings[id] <= 0) continue;
        const slot = BUILDING_SLOT[id];
        if (!g.zones[slot.zone]) continue;
        const y = slot.floor - LIFT;
        if (slot.cx < v.cx - hw || slot.cx > v.cx + hw || slot.floor - 40 < v.cy - hh || y - RISE > v.cy + hh) continue;
        let best: ResId | null = null;
        let bv = 0;
        for (const [r, x] of entries(d.buildingOut[id])) {
          const val = x * resMult(g, d, r);
          if (val > bv) {
            bv = val;
            best = r;
          }
        }
        if (!best) continue;
        const i = pops.findIndex((p) => !p.active);
        const el = i >= 0 ? nodes.current[i] : null;
        if (i < 0 || !el) break;
        const p = pops[i];
        p.active = true;
        p.started = false;
        p.id = id;
        p.rm = rm;
        p.start = now + slot.col * 120 + slot.row * 60;
        p.x = slot.cx + (n % 2 ? 12 : -12);
        p.y = y;
        const [icon, amount] = el.children;
        icon.textContent = RESOURCES[best].icon;
        amount.textContent = `+${fmt(bv * BEAT)}`;
        amount.setAttribute("fill", RESOURCES[best].color);
        el.setAttribute("font-size", fs.toFixed(1));
        el.setAttribute("stroke-width", (fs * 0.16).toFixed(2));
        el.setAttribute("opacity", "0");
        el.setAttribute("transform", `translate(${p.x.toFixed(1)} ${y.toFixed(1)})`);
        n++;
      }
      if (n > 0 && !raf) raf = decoFrame(frame);
    };

    const timer = window.setInterval(beat, BEAT * 1000);
    return () => {
      window.clearInterval(timer);
      cancelDecoFrame(raf);
    };
  }, []);

  return (
    <g pointerEvents="none" aria-hidden>
      {Array.from({ length: POOL }, (_, i) => (
        <g
          key={i}
          ref={(el) => {
            nodes.current[i] = el;
          }}
          opacity="0"
          fontSize="13"
          stroke="#1a120c"
          strokeLinejoin="round"
        >
          <text x="-2" textAnchor="end" dominantBaseline="central" stroke="none" />
          <text x="1" textAnchor="start" dominantBaseline="central" className="font-mono" fontWeight="700" paintOrder="stroke" />
        </g>
      ))}
    </g>
  );
});
