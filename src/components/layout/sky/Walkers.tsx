"use client";

/**
 * Tiny Londoners strolling along the pavement. Positions are driven by one rAF loop writing
 * `transform` attributes directly (no React state per frame); a walker who leaves the street
 * is re-dressed (React state) and comes back after a pause. Legs swing with CSS.
 */
import { memo, useEffect, useRef, useState } from "react";
import type { SkyLayout } from "./skyGeo";

export type WalkerKind = "gent" | "lady" | "boy" | "bobby" | "worker" | "sweep";

interface Spec {
  kind: WalkerKind;
  dir: 1 | -1;
  speed: number; // units/s
  coat: string;
  umbrella: boolean;
}

const COATS = ["#26242c", "#3a2a24", "#2a3340", "#3d3a2a", "#4a2a2e", "#2e3a30"];
const DRESSES = ["#5a3a4a", "#3a4a5a", "#6a4a3a", "#4a3a5a", "#5a5a3a"];
const SLOTS = 9;

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function makeSpec(topHats: boolean, rain: boolean): Spec {
  const roll = Math.random();
  const kind: WalkerKind = topHats
    ? roll < 0.55
      ? "gent"
      : roll < 0.8
        ? "lady"
        : roll < 0.9
          ? "boy"
          : "bobby"
    : roll < 0.32
      ? "gent"
      : roll < 0.58
        ? "lady"
        : roll < 0.72
          ? "worker"
          : roll < 0.84
            ? "boy"
            : roll < 0.93
              ? "bobby"
              : "sweep";
  return {
    kind,
    dir: Math.random() < 0.5 ? 1 : -1,
    speed: (kind === "boy" ? 15 : kind === "lady" ? 8.5 : 10.5) * (0.85 + Math.random() * 0.3),
    coat: kind === "lady" ? pick(DRESSES) : pick(COATS),
    umbrella: rain && kind !== "boy" && Math.random() < 0.85,
  };
}

interface Props {
  L: SkyLayout;
  /** How many walkers are on the street right now (time of day, screen width, reduced motion). */
  count: number;
  rain: boolean;
  /** Metro and above: mostly top hats. */
  topHats: boolean;
}

export const Walkers = memo(function Walkers({ L, count, rain, topHats }: Props) {
  const [specs, setSpecs] = useState<Spec[]>(() => Array.from({ length: SLOTS }, () => makeSpec(topHats, rain)));
  const refs = useRef<(SVGGElement | null)[]>([]);
  const live = useRef({ L, count, rain, topHats });
  useEffect(() => {
    live.current = { L, count, rain, topHats };
  });

  // per-slot motion state (x, waiting time) lives outside React
  const state = useRef<{ x: number; wait: number; dir: 1 | -1; speed: number }[]>([]);

  useEffect(() => {
    const st = state.current;
    const { L: l0 } = live.current;
    for (let i = 0; i < SLOTS; i++) {
      const s = specs[i];
      st[i] = st[i] ?? {
        x: l0.walkMin + Math.random() * (l0.walkMax - l0.walkMin),
        wait: 0,
        dir: s.dir,
        speed: s.speed,
      };
    }
    // `specs` intentionally only seeds missing slots; re-dressing updates dir/speed directly
  }, [specs]);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const { L: l, count: n } = live.current;
      const st = state.current;
      for (let i = 0; i < SLOTS; i++) {
        const el = refs.current[i];
        const w = st[i];
        if (!el || !w) continue;
        if (i >= n) {
          el.setAttribute("visibility", "hidden");
          continue;
        }
        if (w.wait > 0) {
          w.wait -= dt;
          el.setAttribute("visibility", "hidden");
          continue;
        }
        w.x += w.dir * w.speed * dt;
        const out = w.dir > 0 ? w.x > l.walkMax : w.x < l.walkMin;
        if (out) {
          respawn(i);
          continue;
        }
        // fade in/out at the Underground door
        const op = l.door ? Math.max(0, Math.min(1, (l.walkMax - w.x) / 14)) : 1;
        el.setAttribute("visibility", "visible");
        el.setAttribute("opacity", op.toFixed(2));
        el.setAttribute("transform", `translate(${w.x.toFixed(1)} 0) scale(${w.dir} 1)`);
      }
      raf = requestAnimationFrame(loop);
    };
    const respawn = (i: number) => {
      const { L: l, rain: r, topHats: th } = live.current;
      const spec = makeSpec(th, r);
      const w = state.current[i];
      w.dir = spec.dir;
      w.speed = spec.speed;
      w.x = spec.dir > 0 ? l.walkMin : l.walkMax;
      w.wait = 0.8 + Math.random() * 5;
      setSpecs((list) => list.map((s, k) => (k === i ? spec : s)));
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <g>
      {specs.map((s, i) => (
        <g key={i} ref={(el) => void (refs.current[i] = el)} visibility="hidden">
          {/* depth: later slots walk a touch nearer the curb */}
          <g transform={`translate(0 ${(74.6 + i * 0.28).toFixed(2)}) scale(${(0.9 + i * 0.012).toFixed(3)})`}>
            <Walker spec={s} umbrella={s.umbrella || (rain && s.kind !== "boy")} />
          </g>
        </g>
      ))}
    </g>
  );
});

/** One pedestrian, feet at y = 0, facing right, about 20 units tall. */
export const Walker = memo(function Walker({ spec, umbrella }: { spec: Spec; umbrella: boolean }) {
  const skin = "#d9b596";
  const dark = "#17151a";
  const c = spec.coat;
  const legs = (len: number, hip: number) => (
    <>
      <line className="sk-leg" x1={-0.6} y1={-hip} x2={-0.6} y2={-hip + len} stroke={dark} strokeWidth={1.3} strokeLinecap="round" />
      <line className="sk-leg sk-leg2" x1={0.6} y1={-hip} x2={0.6} y2={-hip + len} stroke={dark} strokeWidth={1.3} strokeLinecap="round" />
    </>
  );
  const brolly = umbrella ? (
    <g>
      <line x1={1.8} y1={-12} x2={1.8} y2={-23} stroke={dark} strokeWidth={0.5} />
      <path d="M-5 -22.4 Q1.8 -29.5 8.6 -22.4 Q7 -23.4 5.2 -22.4 Q3.5 -23.4 1.8 -22.4 Q0 -23.4 -1.6 -22.4 Q-3.3 -23.4 -5 -22.4Z" fill="#141317" />
    </g>
  ) : null;

  switch (spec.kind) {
    case "lady":
      return (
        <g>
          <g className="sk-bob">
            <path d="M-1.6 -13 L-4.6 0 H4.2 L2 -13Z" fill={c} />
            <path d="M-2.2 -6.5 Q-6.4 -6 -4.8 -1.5 L-4 -6Z" fill={c} />
            <rect x={-1.7} y={-15} width={3.4} height={3} fill={c} />
            <circle cx={0.2} cy={-16.4} r={1.8} fill={skin} />
            <path d="M-2.2 -16.6 Q0 -20.4 2.6 -16.8 L2.8 -16 Q0 -17.4 -2.2 -15.8Z" fill="#3a2a20" />
            <circle cx={-1.6} cy={-17} r={0.8} fill="#7a2620" />
          </g>
          {brolly ?? (
            <g>
              <line x1={2.4} y1={-11} x2={4.4} y2={-21} stroke={dark} strokeWidth={0.4} />
              <path d="M0.4 -20.4 Q4.6 -24.6 8.6 -21 Z" fill="#e8dcc0" opacity={0.85} />
            </g>
          )}
        </g>
      );
    case "boy":
      return (
        <g>
          {legs(5.5, 6)}
          <path d="M-2 -12 H2 L2.3 -5.6 H-2.3Z" fill={c} />
          <circle cx={0.3} cy={-13.6} r={1.7} fill={skin} />
          <path d="M-1.8 -14.4 Q0.4 -16.6 2.4 -14.6 L3.6 -14.2 L-1.8 -13.8Z" fill="#3a3530" />
          <rect x={-3.6} y={-10.4} width={2.4} height={3.6} fill="#e8dcc0" />
        </g>
      );
    case "bobby":
      return (
        <g>
          {legs(7.5, 8)}
          <path d="M-2.4 -15.5 H2.4 L2.8 -6.6 H-2.8Z" fill="#1e2438" />
          <circle cx={0.2} cy={-17.2} r={1.8} fill={skin} />
          <path d="M-1.8 -18 Q-1.6 -22.6 0.2 -22.8 Q2 -22.6 2.2 -18Z" fill="#1e2438" />
          <rect x={-2.2} y={-18.4} width={4.6} height={0.8} fill="#1e2438" />
          <circle cx={0.2} cy={-21.8} r={0.5} fill="#c9a25a" />
        </g>
      );
    case "worker":
      return (
        <g>
          {legs(7.5, 8)}
          <path d="M-2.4 -15 H2.4 L2.6 -7 H-2.6Z" fill={c} />
          <circle cx={0.2} cy={-16.8} r={1.8} fill={skin} />
          <path d="M-1.9 -17.6 Q0.3 -20 2.4 -17.8 L3.6 -17.3 L-1.9 -17Z" fill="#4a4036" />
          <rect x={-4.6} y={-19.6} width={5.6} height={3.4} rx={0.6} fill="#8a6a42" />
        </g>
      );
    case "sweep":
      return (
        <g>
          {legs(7.5, 8)}
          <path d="M-2.4 -15 H2.4 L2.6 -7 H-2.6Z" fill="#141317" />
          <circle cx={0.2} cy={-16.8} r={1.8} fill="#8a7a6a" />
          <rect x={-1.6} y={-21.6} width={3.4} height={4} fill="#141317" />
          <rect x={-2.6} y={-17.9} width={5.4} height={0.8} fill="#141317" />
          <line x1={-2} y1={-13} x2={-6} y2={-25} stroke="#3a3028" strokeWidth={0.5} />
          <circle cx={-6.2} cy={-25.6} r={2.2} fill="#141317" />
        </g>
      );
    default:
      // gent in a top hat with a cane
      return (
        <g>
          {legs(7.5, 8)}
          <path d="M-2.4 -15.4 H2.4 L3 -6 H-3Z" fill={c} />
          <circle cx={0.2} cy={-17.2} r={1.8} fill={skin} />
          {!umbrella && (
            <>
              <rect x={-1.7} y={-23.6} width={3.6} height={5.2} fill={dark} />
              <rect x={-2.8} y={-18.8} width={5.8} height={0.9} fill={dark} />
            </>
          )}
          {umbrella ? brolly : <line x1={2.6} y1={-9} x2={4.6} y2={0} stroke="#3a2a20" strokeWidth={0.5} />}
          {umbrella && <rect x={-1.6} y={-20.6} width={3.4} height={2.6} fill={dark} />}
        </g>
      );
  }
});
