"use client";

/**
 * The street strip above the burrow and the sewer grate — the main click target.
 * The grate keeps a minimum on-screen size (counter-scaled against the camera zoom).
 */
import { memo, useEffect, useRef, type KeyboardEvent, type PointerEvent } from "react";
import { humanClock } from "@/game/engine/formulas";
import { useGame } from "@/game/store";
import { fxBurst, getFxAnchor } from "../fx/fxBus";
import { onCamera, toScreen } from "./camera";
import { GRATE, seeded, STREET_H, W } from "./geometry";
import { Glow } from "./parts";

const GX = GRATE.x;
const GY = GRATE.y;
const TOP = GY - 22; // far edge of the opening
const BOT = GY + 22; // near edge
const HALF_T = 74;
const HALF_B = 92;
const MIN_GRATE_PX = 104;

interface Cobble {
  x: number;
  y: number;
  w: number;
  h: number;
  c: string;
}

const COBBLES: Cobble[] = (() => {
  const r = seeded(42);
  const out: Cobble[] = [];
  const shades = ["#4a4036", "#3d352d", "#544a3e", "#433a31"];
  for (let row = 0; row < 3; row++) {
    const y = 40 + row * 20;
    let x = -320 + (row % 2) * 14;
    while (x < W + 320) {
      const w = 22 + r() * 16;
      const inGrate = x + w > GX - HALF_B - 10 && x < GX + HALF_B + 10;
      if (!inGrate) out.push({ x, y, w: w - 3, h: 17, c: shades[Math.floor(r() * shades.length)] });
      x += w;
    }
  }
  return out;
})();

/** Time of day of the human clock (CO-5): night ≤ 05:59 or ≥ 21:00, dawn/dusk 06–07:59 and 18–20:59, else day. */
export type ColonyLight = "day" | "dusk" | "night";

function lightAt(totalMin: number): ColonyLight {
  const h = (totalMin / 60) % 24;
  if (h < 6 || h >= 21) return "night";
  if (h < 8 || h >= 18) return "dusk";
  return "day";
}

/** CO-5: the colony's light follows the human clock (re-read every 10 human minutes). */
export function useColonyLight(): ColonyLight {
  return useGame((s) => lightAt(Math.floor(humanClock(s.game).totalMin / 10) * 10));
}

/** CO-5: it rains up top — the drizzle of the Sewers era, or a downpour scene. */
export function useRain(): boolean {
  return useGame((s) => s.game.scene?.id === "downpour" || (!!s.game.zones.sewers && !s.game.zones.cellars));
}

/** Static part: night air, gas-lamp glow, cobbles, earth under the street. */
export const Street = memo(function Street() {
  const light = useColonyLight();
  const night = light === "night";
  return (
    <g pointerEvents="none">
      <rect x={-2000} y={-400} width={W + 4000} height={440} fill="url(#cv-street)" />
      <Glow x={70} y={10} r={90} kind="warm" opacity={night ? 0.85 : 0.5} className="cv-glow" />
      <Glow x={620} y={6} r={70} kind="warm" opacity={night ? 0.6 : 0.35} className={night ? "cv-glow" : undefined} />
      <rect x={-2000} y={36} width={W + 4000} height={66} fill="#2a231c" />
      {COBBLES.map((c, i) => (
        <rect key={i} x={c.x} y={c.y} width={c.w} height={c.h} rx="6" fill={c.c} stroke="#1d1813" strokeWidth="1" />
      ))}
      <rect x={-2000} y={34} width={W + 4000} height="3" fill="#6b5d4c" opacity=".7" />
      <rect x={-2000} y={100} width={W + 4000} height={STREET_H - 100} fill="#22190f" />
      {/* the throat below the grate */}
      <path d={`M${GX - HALF_B} ${BOT}L${GX - HALF_B - 18} ${STREET_H + 6}H${GX + HALF_B + 18}L${GX + HALF_B} ${BOT}z`} fill="#120c07" />
    </g>
  );
});

/** The rays group, so the passing cab wheel (Traffic) can shade the grate imperatively. */
export const raysRef: { current: SVGGElement | null } = { current: null };

/** Sun/lamp rays from the grate into the burrow, with drifting dust motes; drips fall through in the rain. */
export const Rays = memo(function Rays() {
  const light = useColonyLight();
  const rain = useRain();
  const fill = light === "day" ? "url(#cv-rays)" : `url(#cv-rays-${light})`;
  const motes = [
    [300, 160, 0],
    [350, 210, 1.5],
    [280, 260, 3],
    [380, 300, 4.2],
    [320, 360, 2.2],
    [250, 330, 5.5],
    [410, 240, 0.8],
  ];
  return (
    <g pointerEvents="none">
      <g
        ref={(el) => {
          raysRef.current = el;
        }}
        style={{ transition: "opacity .35s", filter: rain ? "saturate(.2)" : undefined }}
        opacity={rain ? 0.5 : 1}
      >
        <path d={`M${GX - HALF_B + 6} ${BOT}L${GX + HALF_B - 6} ${BOT}L${GX + 220} ${STREET_H + 362}L${GX - 200} ${STREET_H + 362}z`} fill={fill} />
        <path d={`M${GX - 30} ${BOT}L${GX + 10} ${BOT}L${GX + 60} ${STREET_H + 300}L${GX - 50} ${STREET_H + 300}z`} fill={fill} opacity=".55" />
      </g>
      {rain &&
        RAIN_DRIPS.map((d, i) => (
          <g key={i}>
            <ellipse cx={d.x} cy={BOT + 4} rx="1.8" ry="2.8" fill="#a9e3f0" className="cv-drip" style={{ animationDelay: `${d.delay}s`, ["--fall" as string]: `${d.fall}px` }} />
            <ellipse cx={d.x} cy={BOT + 4 + d.fall} rx="7" ry="2" fill="none" stroke="#a9e3f0" strokeWidth="1" className="cv-ripple" style={{ animationDelay: `${d.delay}s` }} />
          </g>
        ))}
      {motes.map(([x, y, d], i) => (
        <circle key={i} cx={x} cy={y} r={1.4} fill="#fff1c8" className="cv-mote" style={{ animationDelay: `${d}s` }} />
      ))}
    </g>
  );
});

/** Rain drips from the grate bars to the burrow floor (CO-5). */
const RAIN_DRIPS = [
  { x: GX - 60, fall: 230, delay: 0 },
  { x: GX - 15, fall: 250, delay: 0.7 },
  { x: GX + 30, fall: 240, delay: 1.3 },
  { x: GX + 70, fall: 225, delay: 0.35 },
];

function ClockworkRat({ x, y, flip, delay }: { x: number; y: number; flip?: boolean; delay: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${flip ? -1 : 1} 1)`}>
      <g className="cv-tap" style={{ animationDelay: `${delay}s` }}>
        <path d="M-11 -6Q-20 -4 -24 -10" stroke="#8d949a" strokeWidth="1.6" fill="none" />
        <ellipse cx="-2" cy="-8" rx="11" ry="7" fill="url(#cv-brass)" stroke="#2a1a0c" strokeWidth=".8" />
        <path d="M-9 -8h14M-6 -13v10M0 -14v12" stroke="#7d5f2c" strokeWidth=".7" />
        <path d="M6 -14Q14 -16 18 -9Q13 -5 6 -6z" fill="url(#cv-brass)" stroke="#2a1a0c" strokeWidth=".8" />
        <circle cx="7" cy="-14" r="3" fill="#c9a25a" stroke="#2a1a0c" strokeWidth=".6" />
        <circle cx="12" cy="-11" r="1.4" fill="#c4453a" />
        <circle cx="4" cy="-1" r="2" fill="#5d554d" />
        <circle cx="-8" cy="-1" r="2" fill="#5d554d" />
        <path d="M16 -8l7 -6" stroke="#8d949a" strokeWidth="1.6" />
        <rect x="20" y="-18" width="6" height="5" fill="#5d554d" transform="rotate(-40 23 -15)" />
      </g>
      <g transform="translate(-4 -16)">
        <g className="cv-key" style={{ animationDelay: `${delay}s` }}>
          <rect x="-1" y="-8" width="2" height="8" fill="#c9a25a" />
          <path d="M-6 -12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0M0 -12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0" fill="none" stroke="#c9a25a" strokeWidth="1.8" />
        </g>
      </g>
    </g>
  );
}

/** Wind-up rats tapping the grate (windup_rat: one; clockwork_legion: a little legion). */
export const Windup = memo(function Windup() {
  const one = useGame((s) => !!s.game.upgrades.windup_rat);
  const legion = useGame((s) => !!s.game.upgrades.clockwork_legion);
  if (!one && !legion) return null;
  if (!legion) return <ClockworkRat x={GX - HALF_T - 24} y={TOP + 2} delay={0} />;
  return (
    <g>
      <ClockworkRat x={GX - HALF_T - 24} y={TOP + 2} delay={0} />
      <ClockworkRat x={GX - HALF_T - 52} y={TOP + 4} delay={0.4} />
      <ClockworkRat x={GX + HALF_T + 24} y={TOP + 2} flip delay={0.2} />
      <ClockworkRat x={GX + HALF_T + 52} y={TOP + 4} flip delay={0.6} />
      <ClockworkRat x={GX - 12} y={TOP - 6} delay={0.8} />
    </g>
  );
});

/** Pulsing paw hint over the grate until the first 3 clicks. */
export const PawHint = memo(function PawHint() {
  const show = useGame((s) => s.game.stats.clicks < 3 && !s.game.scene);
  if (!show) return null;
  return (
    <g pointerEvents="none">
      <g transform={`translate(${GX + 30} ${GY + 6})`}>
        <text className="cv-pulse" fontSize="34" textAnchor="middle" y="12">
          🐾
        </text>
      </g>
      <g transform={`translate(${GX + HALF_B + 20} ${GY + 8})`}>
        <text className="font-display cv-pulse" fontSize="22" fill="#ffd34d" stroke="#2a1a0c" strokeWidth="1" fontWeight="700">
          ← Тащи!
        </text>
      </g>
    </g>
  );
});

/** The grate itself: big iron bars against the bright street. */
export function Grate() {
  const outerRef = useRef<SVGGElement>(null);
  const squashRef = useRef<SVGGElement>(null);
  const lucky = useGame((s) => s.game.buffs.luckyPawUntil > s.game.time);
  // CO-8: «Мегаполис» (1 000 rats) gilds the grate for good
  const gilded = useGame((s) => s.game.meta.achievements.colony_1000 !== undefined);
  const light = useColonyLight();

  // keep the grate at least MIN_GRATE_PX wide on screen
  useEffect(
    () =>
      onCamera((v) => {
        const k = Math.max(1, MIN_GRATE_PX / (GRATE.w * v.s));
        outerRef.current?.setAttribute("transform", k === 1 ? "" : `translate(${GX} ${GY}) scale(${k.toFixed(3)}) translate(${-GX} ${-GY})`);
      }),
    [],
  );

  const squash = () => {
    const rm = useGame.getState().game.settings.reducedMotion;
    squashRef.current?.animate(
      rm
        ? [{ transform: "scale(1)" }, { transform: "scale(.985)" }, { transform: "scale(1)" }]
        : [{ transform: "scale(1)" }, { transform: "scale(.97)", offset: 0.27 }, { transform: "scale(1.012)", offset: 0.6 }, { transform: "scale(1)" }],
      { duration: 300, easing: "ease-out" },
    );
  };

  const press = (x: number, y: number) => {
    useGame.getState().click(x, y);
    squash();
    if (Math.random() < 0.3) {
      const p = toScreen(GX + (Math.random() - 0.5) * 140, BOT + 4);
      fxBurst(p.x, p.y, "dust", 1, 0.3);
    }
  };

  const onDown = (e: PointerEvent<SVGGElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    press(e.clientX, e.clientY);
  };
  const onKey = (e: KeyboardEvent<SVGGElement>) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    const a = getFxAnchor() ?? toScreen(GX, GY);
    press(a.x, a.y);
  };

  const bars = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const xt = GX - HALF_T + 8 + t * (2 * HALF_T - 16);
    const xb = GX - HALF_B + 10 + t * (2 * HALF_B - 20);
    bars.push(
      <g key={i}>
        <line x1={xt} y1={TOP} x2={xb} y2={BOT} stroke={lucky ? "#7d5f2c" : gilded ? "#b8902c" : "#1c1814"} strokeWidth="6.5" strokeLinecap="round" />
        <line x1={xt - 1} y1={TOP + 1} x2={xb - 1.4} y2={BOT - 1} stroke={lucky || gilded ? "#ffe9a8" : "#6b625a"} strokeWidth="1.4" strokeLinecap="round" />
      </g>,
    );
  }

  return (
    <g ref={outerRef}>
      <g
        data-nodrag=""
        role="button"
        tabIndex={0}
        aria-label="Решётка водостока — тащить добычу"
        onPointerDown={onDown}
        onKeyDown={onKey}
        style={{ cursor: "pointer", outline: "none" }}
      >
        <rect x={GX - HALF_B - 26} y={TOP - 26} width={2 * HALF_B + 52} height={BOT - TOP + 56} fill="transparent" />
        <g ref={squashRef} className="cv-fb">
          {lucky && <Glow x={GX} y={GY} r={140} kind="gold" className="cv-glow" />}
          <path d={`M${GX - HALF_T} ${TOP}H${GX + HALF_T}L${GX + HALF_B} ${BOT}H${GX - HALF_B}z`} fill={light === "day" ? "url(#cv-skylight)" : `url(#cv-skylight-${light})`} />
          {light === "night" && (
            <g>
              <path d={`M${GX + 34} ${TOP + 8}a10 10 0 1 0 8 16a8 8 0 1 1 -8 -16z`} fill="#e9eef8" opacity=".85" />
              <circle cx={GX - 40} cy={TOP + 12} r="1.3" fill="#fff" />
              <circle cx={GX - 8} cy={TOP + 26} r="1" fill="#dfe8ff" />
            </g>
          )}
          <ellipse cx={GX - 34} cy={TOP + 10} rx="16" ry="5" fill="#2a2420" opacity=".35" />
          <ellipse cx={GX + 40} cy={TOP + 8} rx="12" ry="4" fill="#2a2420" opacity=".3" />
          {bars}
          <path d={`M${GX - HALF_T - 4} ${GY}H${GX + HALF_T + 4}`} stroke="#1c1814" strokeWidth="5" />
          <path
            d={`M${GX - HALF_T - 6} ${TOP - 4}H${GX + HALF_T + 6}L${GX + HALF_B + 8} ${BOT + 5}H${GX - HALF_B - 8}z`}
            fill="none"
            stroke={gilded ? "url(#cv-brass)" : "url(#cv-iron)"}
            strokeWidth="9"
            strokeLinejoin="round"
          />
          <path d={`M${GX - HALF_T - 6} ${TOP - 6}H${GX + HALF_T + 6}`} stroke="#857a6c" strokeWidth="1.4" />
          {[GX - HALF_B - 4, GX + HALF_B + 4].map((x) => (
            <circle key={x} cx={x} cy={BOT + 2} r="2.4" fill="#857a6c" stroke="#1c1814" strokeWidth=".8" />
          ))}
        </g>
      </g>
    </g>
  );
}
