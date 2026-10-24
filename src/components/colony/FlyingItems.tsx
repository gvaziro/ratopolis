"use client";

/**
 * Loot that falls through the grate and flies in an arc (500 ms, ease-out) into the pantry / nest.
 * A fixed pool of <text> nodes animated imperatively; the target chamber gets a little poke on landing.
 */
import { memo, useEffect, useRef } from "react";
import { RESOURCES } from "@/game/data/resources";
import { onFx } from "@/game/fx";
import { useGame } from "@/game/store";
import type { BuildingId } from "@/game/types";
import { camView } from "./camera";
import { BAND_H, BUILDING_SLOT, GRATE, STREET_H } from "./geometry";
import { colonyPaused, pokeChamber } from "./registry";

const POOL = 14;
const DUR = 500;

interface Flight {
  start: number;
  x0: number;
  y0: number;
  cx: number;
  cy: number;
  x1: number;
  y1: number;
  spin: number;
  target: BuildingId | null;
  active: boolean;
}

export const FlyingItems = memo(function FlyingItems() {
  const nodes = useRef<(SVGTextElement | null)[]>([]);

  useEffect(() => {
    const flights: Flight[] = Array.from({ length: POOL }, () => ({ start: 0, x0: 0, y0: 0, cx: 0, cy: 0, x1: 0, y1: 0, spin: 0, target: null, active: false }));
    let raf = 0;
    let lastPoke = 0;

    const frame = (now: number) => {
      let any = false;
      for (let i = 0; i < POOL; i++) {
        const f = flights[i];
        const el = nodes.current[i];
        if (!f.active || !el) continue;
        const t = Math.min(1, (now - f.start) / DUR);
        const e = 1 - (1 - t) * (1 - t);
        const u = 1 - e;
        const x = u * u * f.x0 + 2 * u * e * f.cx + e * e * f.x1;
        const y = u * u * f.y0 + 2 * u * e * f.cy + e * e * f.y1;
        const sc = 1.25 - 0.45 * e;
        el.setAttribute("transform", `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${(f.spin * e).toFixed(0)}) scale(${sc.toFixed(2)})`);
        el.setAttribute("opacity", t > 0.85 ? ((1 - t) / 0.15).toFixed(2) : "1");
        if (t >= 1) {
          f.active = false;
          el.setAttribute("opacity", "0");
          if (f.target && now - lastPoke > 140) {
            lastPoke = now;
            pokeChamber(f.target, 0.35);
          }
        } else any = true;
      }
      raf = any ? requestAnimationFrame(frame) : 0;
    };

    const launch = (icon: string) => {
      const f = flights.find((x) => !x.active);
      const i = f ? flights.indexOf(f) : -1;
      const el = nodes.current[i];
      if (!f || !el) return;
      const b = useGame.getState().game.buildings;
      const target: BuildingId | null = b.pantry > 0 ? "pantry" : b.nest > 0 ? "nest" : null;
      const slot = target ? BUILDING_SLOT[target] : BUILDING_SLOT.nest;
      f.x0 = GRATE.x + (Math.random() - 0.5) * 90;
      f.y0 = GRATE.y + 16;
      f.x1 = slot.cx + (Math.random() - 0.5) * 50;
      f.y1 = slot.floor - (target ? 34 : 6);
      f.cx = (f.x0 + f.x1) / 2 + (Math.random() - 0.5) * 30;
      f.cy = Math.min(f.y0, f.y1) - 30;
      f.spin = (Math.random() - 0.5) * 540;
      f.target = target;
      f.start = performance.now();
      f.active = true;
      el.textContent = icon;
      if (!raf) raf = requestAnimationFrame(frame);
    };

    let lastAuto = 0;
    const off = onFx((fx) => {
      if (fx.k !== "click" && fx.k !== "drop") return;
      // nothing to see under a scene, in a hidden tab, or when the camera is down below the burrow
      if (colonyPaused()) return;
      const v = camView();
      if (v.cy - v.ch / 2 / v.s > STREET_H + BAND_H) return;
      if (fx.k === "click") {
        if (fx.auto) {
          // wind-up rats: a crumb every half second is plenty
          const now = performance.now();
          if (now - lastAuto < 500) return;
          lastAuto = now;
        }
        launch(RESOURCES.crumbs.icon);
      } else if (fx.x !== undefined && fx.x > 1.0001) launch(RESOURCES[fx.res].icon);
    });
    return () => {
      off();
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <g pointerEvents="none">
      {Array.from({ length: POOL }, (_, i) => (
        <text
          key={i}
          ref={(el) => {
            nodes.current[i] = el;
          }}
          opacity="0"
          fontSize="16"
          textAnchor="middle"
          dominantBaseline="central"
        />
      ))}
    </g>
  );
});
