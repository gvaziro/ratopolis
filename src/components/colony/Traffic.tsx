"use client";

/**
 * Two scales at home (CO-5): the giant human traffic on the street above the colony. One pooled boot and one cab
 * wheel on a single rAF, moved with setAttribute (no React renders per frame):
 * - a hobnailed boot (≈300×70 world units) stamps down onto the cobbles (220 ms down, 350 ms hold, 300 ms up), puffs
 *   dust at both sole edges and nudges the screen, never right over the grate;
 * - an iron-rimmed cab wheel (r 260, only its bottom arc shows) rolls across in 2.6 s; while it rolls over the grate the
 *   rays dim to 25% and three crumbs shake loose.
 * Every 9–22 s, ×0.4 as often at night, ×1.5 once the Metro is open; never under a scene or with the street off-screen.
 * Reduced motion: actors fade in and out in place, no stomp or shake.
 */
import { memo, useEffect, useRef } from "react";
import { humanClock } from "@/game/engine/formulas";
import { emitUiFx } from "@/game/fx";
import { useGame } from "@/game/store";
import { fxBurst } from "../fx/fxBus";
import { camView, toScreen } from "./camera";
import { GRATE, STREET_H } from "./geometry";
import { colonyPaused } from "./registry";
import { raysRef } from "./Street";

const COBBLE_TOP = 38;
const BOOT_W = 300;
const BOOT_H = 70;
const WHEEL_R = 260;
const WHEEL_FROM = -420;
const WHEEL_TO = 1140;
const WHEEL_MS = 2600;
const SPOKES = 12;

type Actor = "boot" | "wheel";

function nextGap(): number {
  const g = useGame.getState().game;
  const h = (humanClock(g).totalMin / 60) % 24;
  const night = h < 6 || h >= 21;
  const busy = !!g.zones.metro;
  return (
    (9000 + Math.random() * 13000) / ((night ? 0.4 : 1) * (busy ? 1.5 : 1))
  );
}

export const Traffic = memo(function Traffic() {
  const bootRef = useRef<SVGGElement>(null);
  const wheelRef = useRef<SVGGElement>(null);
  const spokesRef = useRef<SVGGElement>(null);

  useEffect(() => {
    const boot = bootRef.current;
    const wheel = wheelRef.current;
    const spokes = spokesRef.current;
    if (!boot || !wheel || !spokes) return;
    let raf = 0;
    let timer = 0;
    let nextAt = performance.now() + 4000 + Math.random() * 5000;
    let act: {
      kind: Actor;
      t0: number;
      x: number;
      stomped: boolean;
      crumbs: boolean;
      dimmed: boolean;
    } | null = null;

    const hide = () => {
      boot.setAttribute("opacity", "0");
      wheel.setAttribute("opacity", "0");
      if (raysRef.current) raysRef.current.style.opacity = "";
    };
    hide();

    const streetVisible = () => {
      const v = camView();
      if (v.cw <= 1 || v.s <= 0) return false;
      const top = v.cy - v.ch / 2 / v.s;
      return top < STREET_H;
    };

    // between actors the loop sleeps on a timer (no frame callbacks for the 9–22 s of empty street)
    const sleep = (ms: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = 0;
        if (!raf) raf = requestAnimationFrame(frame);
      }, Math.max(0, ms));
    };

    const frame = (now: number) => {
      raf = 0;
      if (colonyPaused()) {
        // under a scene or in a hidden tab an actor keeps its clock (and ends unseen); an empty street naps
        if (act) raf = requestAnimationFrame(frame);
        else sleep(1000);
        return;
      }
      const g = useGame.getState().game;
      const calm = g.settings.reducedMotion;
      if (!act) {
        if (now < nextAt) return sleep(nextAt - now);
        nextAt = now + nextGap();
        if (g.scene || !streetVisible()) return sleep(nextAt - now);
        if (Math.random() < 0.5) {
          // a boot lands anywhere along the street but not on the grate
          let x = -80 + Math.random() * 880;
          if (Math.abs(x - GRATE.x) < 110 + BOOT_W / 2)
            x =
              x < GRATE.x
                ? GRATE.x - 110 - BOOT_W / 2
                : GRATE.x + 110 + BOOT_W / 2;
          act = {
            kind: "boot",
            t0: now,
            x,
            stomped: false,
            crumbs: false,
            dimmed: false,
          };
        } else
          act = {
            kind: "wheel",
            t0: now,
            x: WHEEL_FROM,
            stomped: false,
            crumbs: false,
            dimmed: false,
          };
      }
      raf = requestAnimationFrame(frame);
      const t = now - act.t0;
      if (act.kind === "boot") {
        const down = 220;
        const hold = 350;
        const up = 300;
        let y: number;
        let alpha = 1;
        if (calm) {
          y = COBBLE_TOP - BOOT_H;
          alpha =
            t < 250
              ? t / 250
              : t > down + hold + up - 250
                ? Math.max(0, (down + hold + up - t) / 250)
                : 1;
        } else if (t < down) {
          const k = t / down;
          y = -140 + (COBBLE_TOP - BOOT_H + 140) * k * k; // ease-in
        } else if (t < down + hold) {
          y = COBBLE_TOP - BOOT_H;
        } else {
          const k = Math.min(1, (t - down - hold) / up);
          y = COBBLE_TOP - BOOT_H - (BOOT_H + 140) * k * (2 - k);
        }
        boot.setAttribute(
          "transform",
          `translate(${(act.x - BOOT_W / 2).toFixed(1)} ${y.toFixed(1)})`,
        );
        boot.setAttribute("opacity", alpha.toFixed(2));
        if (!act.stomped && t >= down) {
          act.stomped = true;
          if (!calm) {
            for (const ex of [
              act.x - BOOT_W / 2 + 10,
              act.x + BOOT_W / 2 - 10,
            ]) {
              const p = toScreen(ex, COBBLE_TOP);
              fxBurst(p.x, p.y, "dust", 10, 1.2);
            }
            if (!g.settings.noShake) emitUiFx({ k: "shake", px: 1.5, ms: 120 });
          }
        }
        if (t >= down + hold + up) {
          act = null;
          hide();
        }
      } else {
        const k = Math.min(1, t / WHEEL_MS);
        const x = calm
          ? GRATE.x + 260
          : WHEEL_FROM + (WHEEL_TO - WHEEL_FROM) * k;
        const cy = COBBLE_TOP - WHEEL_R;
        wheel.setAttribute("transform", `translate(${x.toFixed(1)} ${cy})`);
        wheel.setAttribute(
          "opacity",
          calm
            ? (k < 0.15 ? k / 0.15 : k > 0.85 ? (1 - k) / 0.15 : 1).toFixed(2)
            : "1",
        );
        if (!calm)
          spokes.setAttribute(
            "transform",
            `rotate(${(((x - WHEEL_FROM) / WHEEL_R) * 180) / Math.PI})`,
          );
        const over = Math.abs(x - GRATE.x) < 98;
        if (over !== act.dimmed && raysRef.current) {
          act.dimmed = over;
          raysRef.current.style.opacity = over ? "0.25" : "";
        }
        if (!calm && !act.crumbs && x >= GRATE.x) {
          act.crumbs = true;
          const p = toScreen(GRATE.x, GRATE.y);
          fxBurst(p.x, p.y, "crumb", 3, 0.8);
        }
        if (k >= 1) {
          act = null;
          hide();
        }
      }
    };
    sleep(nextAt - performance.now());
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      if (raysRef.current) raysRef.current.style.opacity = "";
    };
  }, []);

  return (
    <g pointerEvents="none" aria-hidden>
      {/* the boot: sole, heel and welt, hobnails and a trouser hem */}
      <g ref={bootRef} opacity="0">
        <rect
          x={BOOT_W * 0.3}
          y={-260}
          width={BOOT_W * 0.42}
          height={262}
          fill="#2b2d33"
        />
        <rect
          x={BOOT_W * 0.3}
          y={-4}
          width={BOOT_W * 0.42}
          height={8}
          fill="#1d1e22"
        />
        <path
          d={`M${BOOT_W * 0.22} 6 H${BOOT_W * 0.78} Q${BOOT_W * 1.0} 14 ${BOOT_W} ${BOOT_H - 14} V${BOOT_H - 6} H0 V${BOOT_H - 22} Q0 10 ${BOOT_W * 0.22} 6 Z`}
          fill="#2a1d14"
        />
        <rect
          x="-2"
          y={BOOT_H - 8}
          width={BOOT_W + 4}
          height="8"
          rx="3"
          fill="#1a120c"
        />
        <rect
          x={BOOT_W * 0.02}
          y={BOOT_H - 26}
          width={BOOT_W * 0.2}
          height="20"
          rx="4"
          fill="#20160f"
        />
        {Array.from({ length: 11 }, (_, i) => (
          <circle
            key={i}
            cx={14 + i * ((BOOT_W - 28) / 10)}
            cy={BOOT_H - 1}
            r="3"
            fill="#8d949a"
          />
        ))}
      </g>
      {/* the cab wheel: iron rim, wooden felloe and 12 spokes; only the bottom arc shows above the kerb */}
      <clipPath id="cv-traffic-clip">
        <rect x={-3000} y={-90} width={8000} height={90 + COBBLE_TOP + 2} />
      </clipPath>
      <g clipPath="url(#cv-traffic-clip)">
        <g ref={wheelRef} opacity="0">
          <circle r={WHEEL_R} fill="none" stroke="#3a3f45" strokeWidth="12" />
          <circle
            r={WHEEL_R - 12}
            fill="none"
            stroke="#6b4a2a"
            strokeWidth="16"
          />
          <g ref={spokesRef}>
            {Array.from({ length: SPOKES }, (_, i) => {
              const a = (i / SPOKES) * Math.PI * 2;
              return (
                <line
                  key={i}
                  x1="0"
                  y1="0"
                  x2={Math.cos(a) * (WHEEL_R - 18)}
                  y2={Math.sin(a) * (WHEEL_R - 18)}
                  stroke="#5a3e22"
                  strokeWidth="10"
                />
              );
            })}
            <circle r="34" fill="#4a3420" stroke="#2a1d14" strokeWidth="4" />
          </g>
        </g>
      </g>
    </g>
  );
});
