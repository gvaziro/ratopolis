"use client";

/**
 * Event mini-scenes in «Наверху»: every event starts tiny up here, at human scale, while the colony
 * view shows the rat-scale close-up. Driven by game.scene (id/phase/seq) and game.market.
 * Moving actors use a small rAF tween that writes `transform` attributes directly.
 * v3 (SHL-5, trains-12): the train wears its variant's colours (a freight is grey, the mail red) and the rare Cheddar
 * dining car is painted yellow; after the Metro a carriage that only passes over the grate (s.carriagePass, ENG-9)
 * trots by up here while its loot rains into the colony.
 */
import { cancelDecoFrame, decoFrame } from "@/lib/eco";
import { memo, useEffect, useRef, type CSSProperties, type RefObject } from "react";
import { TRAIN_VARIANTS } from "@/game/data/events";
import type { SceneEventId, ScenePhase, TrainVariantId } from "@/game/types";
import { H, MARGIN, PAVE_TOP, type SkyLayout } from "./skyGeo";

export interface SceneInfo {
  id: SceneEventId;
  seq: number;
  phase: ScenePhase;
  cars: number;
  perCar: number;
  /** v3: the metro train's variant (absent = normal). */
  variant?: TrainVariantId;
  /** v3: index in scene.cars of the Cheddar dining car (0 is the engine), or -1. */
  cheese?: number;
}

const vars = (v: Record<string, string>) => v as CSSProperties;

/** Tween an element's x from `from` to `to` over `ms`, with optional fade in/out (units). */
function useTweenX(ref: RefObject<SVGGElement | null>, from: number, to: number, ms: number, fade = 0, y = 0) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / ms);
      const x = from + (to - from) * k;
      el.setAttribute("transform", `translate(${x.toFixed(1)} ${y})`);
      if (fade > 0) {
        const d = Math.min(Math.abs(x - from), Math.abs(to - x));
        el.setAttribute("opacity", Math.min(1, d / fade).toFixed(2));
      }
      if (k < 1) raf = decoFrame(step);
    };
    raf = decoFrame(step);
    return () => cancelDecoFrame(raf);
  }, [ref, from, to, ms, fade, y]);
}

/* ================================================================ near layer (street level) */

export const NearEvents = memo(function NearEvents({
  L,
  scene,
  market,
  pass,
}: {
  L: SkyLayout;
  scene: SceneInfo | null;
  market: boolean;
  /** A carriage passing over the grate (no close-up): its seq and how long it takes (ms). */
  pass?: { seq: number; ms: number } | null;
}) {
  return (
    <g>
      {market && <MarketStall x={L.grate} />}
      {scene?.id === "carriage" && <Carriage key={scene.seq} L={L} />}
      {!scene && pass && <Carriage key={`pass${pass.seq}`} L={L} ms={pass.ms} />}
      {scene?.id === "capsule" && <CapsuleTube x={L.pillar ?? L.grate + 56} phase={scene.phase} />}
      {(scene?.id === "metro_train" || scene?.id === "royal_express") && (
        <Train key={`${scene.seq}-${scene.phase === "catch" ? "go" : scene.phase}`} L={L} s={scene} />
      )}
      {scene?.id === "cat" && <Cat L={L} warn={scene.phase === "warn"} />}
      {scene?.id === "ratcatcher" && <Ratcatcher key={scene.seq} L={L} playing={scene.phase === "taps" || scene.phase === "warn"} />}
    </g>
  );
});

/** A hansom cab trotting along the road and splashing through the puddle at the grate. */
function Carriage({ L, ms = 5200 }: { L: SkyLayout; ms?: number }) {
  const ref = useRef<SVGGElement>(null);
  const from = Math.max(-70, L.C - 360);
  const to = Math.min(L.cut !== null ? L.cut - 8 : L.W + 70, L.C + 380);
  useTweenX(ref, from, to, ms, 36);
  const splashAt = ((L.grate - from) / (to - from)) * ms;
  return (
    <g>
      <g ref={ref} transform={`translate(${from} 0)`} opacity={0}>
        <Cab />
      </g>
      {/* puddle splash when the wheels cross the grate */}
      <g>
        {[-6, -2, 3, 7].map((dx, i) => (
          <circle
            key={dx}
            className="sk-note"
            cx={L.grate + dx}
            cy={83}
            r={0.9}
            fill="#a8c4d0"
            opacity={0}
            style={{ animation: `sk-note .7s ease-out ${splashAt / 1000 + i * 0.04}s 2 both`, ...vars({ "--dx": `${dx * 0.8}px` }) }}
          />
        ))}
      </g>
    </g>
  );
}

export function Cab() {
  const dark = "#1c1a1f";
  return (
    <g>
      {/* horse */}
      <g transform="translate(26 0)">
        <ellipse cx={0} cy={74.5} rx={7.5} ry={3.6} fill="#3a2a20" />
        <path d="M5.5 72.5 L9 66.5 L12.4 67.4 L11.6 69.4 L9.6 69.2 L7.6 74Z" fill="#3a2a20" />
        <path d="M5.5 72 L8.2 66.8 L6.6 70.8Z" fill="#1c1410" />
        {[-5.2, -3.4, 3.2, 5].map((x, i) => (
          <line key={x} className={`sk-leg${i % 2 ? " sk-leg2" : ""}`} x1={x} y1={76.5} x2={x} y2={84.6} stroke="#2a1d16" strokeWidth={1.2} strokeLinecap="round" style={{ animationDuration: ".22s" }} />
        ))}
        <path d="M-7.4 73.5 Q-10 75 -9.4 79" stroke="#1c1410" strokeWidth={1} fill="none" />
      </g>
      {/* shafts */}
      <line x1={8} y1={76} x2={22} y2={75} stroke={dark} strokeWidth={0.7} />
      {/* cab body */}
      <path d="M-6 62 H6 Q9 62 9 66 V77 H-8 V66 Q-8 62 -6 62Z" fill="#2c2a30" />
      <rect x={-5.5} y={65} width={7.5} height={5.5} rx={0.8} fill="#56667a" opacity={0.6} />
      <rect x={-8} y={77} width={17} height={1.4} fill={dark} />
      <path d="M-10 57.5 H-6 V62 H-9Z" fill={dark} />
      {/* cabby in a top hat on the box behind */}
      <rect x={-10.2} y={51} width={3.2} height={5} fill={dark} />
      <rect x={-11} y={55.4} width={4.6} height={0.7} fill={dark} />
      <circle cx={-8.6} cy={57} r={1.5} fill="#d9b596" />
      <line x1={-7} y1={60} x2={20} y2={70} stroke={dark} strokeWidth={0.3} />
      {/* big wheel */}
      <g className="sk-spin" style={{ animationDuration: ".45s" }}>
        <circle cx={0} cy={80.5} r={6.4} fill="none" stroke={dark} strokeWidth={1.2} />
        {[0, 45, 90, 135].map((a) => (
          <line key={a} x1={0} y1={74.4} x2={0} y2={86.6} stroke={dark} strokeWidth={0.5} transform={`rotate(${a} 0 80.5)`} />
        ))}
      </g>
    </g>
  );
}

/** Pneumatic post: the glass tube glows and capsules zip down into the street. */
function CapsuleTube({ x, phase }: { x: number; phase: ScenePhase }) {
  const rumble = phase === "rumble";
  return (
    <g className={rumble ? "sk-shake" : undefined}>
      <rect className="sk-glow" x={x + 4.2} y={43.6} width={3.6} height={33.8} rx={1.4} fill="#bff0ea" opacity={0.5} />
      {!rumble &&
        [0, 0.5, 1].map((d) => (
          <g key={d} className="sk-capsule" style={{ animationDelay: `${-d}s` }}>
            <rect x={x + 4.7} y={44} width={2.6} height={5} rx={1.2} fill="url(#sk-brass)" />
          </g>
        ))}
      <circle className="sk-puff" cx={x + 6} cy={43} r={3} fill="#e6eeee" />
      <circle className="sk-puff" cx={x + 6} cy={77} r={3.4} fill="#e6eeee" style={{ animationDelay: "-.7s" }} />
    </g>
  );
}

/** The Underground train (or the Royal Express) bursting out of the tunnel portal into the cutting. */
function Train({ L, s }: { L: SkyLayout; s: SceneInfo }) {
  const ref = useRef<SVGGElement>(null);
  const royal = s.id === "royal_express";
  const cars = Math.max(3, Math.min(12, s.cars || (royal ? 12 : 5)));
  const len = 40 + cars * 34;
  const c = L.cut;
  const passing = s.phase === "catch";
  const from = (c ?? L.grate) - len;
  const to = L.W + MARGIN + 10;
  const ms = Math.max(4000, Math.min(16000, cars * (s.perCar || 1.6) * 1000));
  useTweenX(ref, from, to, ms);
  if (c === null) {
    // no cutting below the metro: only a rumble of smoke from the grate
    return <SteamBurst x={L.grate} y={80} big={s.phase !== "rumble"} />;
  }
  return (
    <g>
      <clipPath id={`sk-cutclip-${s.seq}`}>
        <rect x={c + 1.5} y={0} width={L.W + MARGIN * 2} height={H} />
      </clipPath>
      {s.phase === "rumble" && (
        <g>
          <ellipse className="sk-glow" cx={c + 10.5} cy={78} rx={6} ry={5} fill="#fff1c9" opacity={0.5} />
          <SteamBurst x={c + 12} y={66} big={false} />
        </g>
      )}
      {passing && (
        <g clipPath={`url(#sk-cutclip-${s.seq})`}>
          <g ref={ref} transform={`translate(${from} 0)`}>
            <TrainArt cars={cars} royal={royal} tint={royal ? null : (TRAIN_VARIANTS[s.variant ?? "normal"]?.tint ?? null)} cheese={s.cheese ?? -1} />
          </g>
        </g>
      )}
      {!passing && s.phase !== "rumble" && <SteamBurst x={c + 30} y={64} big />}
    </g>
  );
}

/**
 * The train seen from the street. `tint`: the variant's body colour (TRAIN_VARIANTS[v].tint; null = the usual
 * brown); `cheese`: index in scene.cars of the Cheddar dining car (0 is the engine), painted cheese-yellow.
 */
export function TrainArt({ cars, royal, tint = null, cheese = -1 }: { cars: number; royal: boolean; tint?: string | null; cheese?: number }) {
  const body = royal ? "#5a1c17" : (tint ?? "#3a2418");
  const trim = royal ? "url(#sk-gold)" : "#7a5a3a";
  const engine = royal ? "#4a1612" : tint === "#4b4b52" ? "#2a2a30" : "#2c4a3a";
  // the engine leads at the right end of the group, carriages trail to the left: car k (from the engine) sits at
  // i = cars - k
  return (
    <g>
      {Array.from({ length: cars }, (_, i) => {
        const x = i * 34;
        const cheddar = cheese > 0 && i === cars - cheese;
        return (
          <g key={i}>
            <path d={`M${x + 1} 71.5 Q${x + 16.5} 66.5 ${x + 32} 71.5 V92 H${x + 1}Z`} fill={cheddar ? "#e8b84b" : body} />
            <rect x={x + 1} y={73.6} width={31} height={1.1} fill={cheddar ? "#b8861e" : trim} />
            {[4, 11, 18, 25].map((dx) => (
              <rect key={dx} x={x + dx} y={76} width={4.4} height={5.2} rx={0.6} fill={cheddar ? "#fff4c4" : "#ffd27a"} opacity={0.85} />
            ))}
            {cheddar && (
              <g>
                {[7, 16, 26].map((dx) => (
                  <ellipse key={dx} cx={x + dx} cy={86} rx={1.5} ry={1.1} fill="#c98a1a" />
                ))}
              </g>
            )}
            {royal && (
              <g>
                <line x1={x + 16.5} y1={68.5} x2={x + 16.5} y2={63} stroke="#2a1f14" strokeWidth={0.4} />
                <path d={`M${x + 16.7} 63 l4.6 1.4 l-4.6 1.4Z`} fill={i % 2 ? "#e8c983" : "#7a2620"} />
              </g>
            )}
          </g>
        );
      })}
      {/* engine */}
      <g transform={`translate(${cars * 34 + 2} 0)`}>
        <rect x={0} y={70} width={14} height={22} rx={1} fill={engine} />
        <rect x={2} y={72.6} width={8} height={5} rx={0.6} fill="#ffd27a" opacity={0.7} />
        <rect x={12} y={75} width={24} height={17} rx={6} fill={engine} />
        <rect x={12} y={77.4} width={24} height={1} fill={trim} />
        <rect x={28} y={68} width={4} height={8} fill="#141317" />
        <rect x={27.2} y={67} width={5.6} height={1.6} fill={royal ? "#d4af37" : "#141317"} />
        <path d="M18 75 a3 3 0 0 1 6 0Z" fill={royal ? "#d4af37" : "#c9a25a"} />
        <circle cx={36} cy={82} r={1.6} fill="#fff1c9" />
        {royal && <path d="M4 66.5 l1.4 -3 l1.6 2 l1.6 -2 l1.4 3Z" fill="#d4af37" />}
        {[0, 0.7, 1.4].map((d) => (
          <circle key={d} className="sk-bigsmoke" cx={30} cy={66} r={3.2} fill="#e3e8e8" opacity={0} style={{ animationDuration: "2.1s", animationDelay: `${-d}s`, ...vars({ "--dx": "-38px" }) }} />
        ))}
      </g>
    </g>
  );
}

function SteamBurst({ x, y, big }: { x: number; y: number; big: boolean }) {
  return (
    <g>
      {[0, 0.8, 1.6, 2.4].map((d, i) => (
        <circle
          key={d}
          className={big ? "sk-bigsmoke" : "sk-smoke"}
          cx={x + (i - 1.5) * 3}
          cy={y}
          r={big ? 4 : 2.6}
          fill="#dfe6e6"
          opacity={0}
          style={{ animationDuration: big ? "3.2s" : "2.6s", animationDelay: `${-d}s`, ...vars({ "--dx": `${(i - 1.5) * 6}px` }) }}
        />
      ))}
    </g>
  );
}

/** Murzifer: a big silhouette with lamp eyes in the basement window (or by the grate). */
function Cat({ L, warn }: { L: SkyLayout; warn: boolean }) {
  if (L.house) {
    const x = L.house.win;
    return (
      <g>
        <rect x={x - 6.5} y={PAVE_TOP + 0.6} width={13} height={3.6} fill="#0c0a09" />
        <path d={`M${x - 5} ${PAVE_TOP + 4.2} V${PAVE_TOP + 1.4} l1.4 -1.6 l1.2 1.4 h4.8 l1.2 -1.4 l1.4 1.6 V${PAVE_TOP + 4.2}Z`} fill="#141210" />
        <g className="sk-eyes">
          <ellipse cx={x - 2} cy={PAVE_TOP + 2.4} rx={warn ? 1.3 : 1} ry={0.8} fill="#ffd34d" />
          <ellipse cx={x + 2} cy={PAVE_TOP + 2.4} rx={warn ? 1.3 : 1} ry={0.8} fill="#ffd34d" />
          <rect x={x - 2.15} y={PAVE_TOP + 1.7} width={0.3} height={1.4} fill="#141210" />
          <rect x={x + 1.85} y={PAVE_TOP + 1.7} width={0.3} height={1.4} fill="#141210" />
        </g>
        <circle cx={x} cy={PAVE_TOP + 2.4} r={9} fill="url(#sk-pool)" opacity={warn ? 0.5 : 0.25} />
        {/* …and Murzifer himself, perched on the area railing: tiny to humans, a striped horror to rats */}
        <circle className="sk-glow" cx={x - 5} cy={PAVE_TOP - 11} r={10} fill="url(#sk-halo)" opacity={warn ? 0.9 : 0.5} />
        <SittingCat x={x - 5} y={PAVE_TOP - 6} eyes scale={0.85} />
      </g>
    );
  }
  return <SittingCat x={L.grate + 19} y={77} eyes />;
}

export function SittingCat({ x, y, eyes = false, scale = 1 }: { x: number; y: number; eyes?: boolean; scale?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} fill="#141210">
      <path d="M-3 0 Q-4 -5 -1.6 -7.4 L-2.2 -10.6 L-0.4 -9 H1.6 L3.2 -10.6 L2.8 -7.2 Q4.6 -4.6 3.4 0Z" />
      <path className="sk-tail" d="M3 -0.6 Q7.4 -0.2 6.6 -5" stroke="#141210" strokeWidth={1.1} fill="none" strokeLinecap="round" />
      {eyes && (
        <g className="sk-eyes">
          <circle cx={-0.4} cy={-7.6} r={0.6} fill="#ffd34d" />
          <circle cx={1.8} cy={-7.6} r={0.6} fill="#ffd34d" />
        </g>
      )}
    </g>
  );
}

/** The municipal ratcatcher walks up to the grate and plays his pipe. */
function Ratcatcher({ L, playing }: { L: SkyLayout; playing: boolean }) {
  const ref = useRef<SVGGElement>(null);
  const stand = L.grate + 24;
  const from = L.door ? L.walkMax : Math.min(L.W + 30, stand + 260);
  useTweenX(ref, from, stand, 3600, 0);
  return (
    <g ref={ref} transform={`translate(${from} 0)`}>
      <g transform="translate(0 76.6) scale(-1 1)">
        <line className="sk-leg" x1={-0.8} y1={-8} x2={-0.8} y2={0} stroke="#141317" strokeWidth={1.4} />
        <line className="sk-leg sk-leg2" x1={0.8} y1={-8} x2={0.8} y2={0} stroke="#141317" strokeWidth={1.4} />
        <path d="M-3.6 -17 H3 L4.4 -4 H-4.6Z" fill="#2a2420" />
        <path d="M-4.6 -16 Q-8.6 -12 -6.6 -6 L-4 -9Z" fill="#3a3028" />
        <circle cx={0.3} cy={-18.6} r={1.9} fill="#c9a88a" />
        <path d="M-5 -19.8 H5.6 L4 -21 Q0.4 -24.6 -3.4 -21Z" fill="#141317" />
        <line x1={1.6} y1={-18} x2={6.6} y2={-15.4} stroke="#8a6a42" strokeWidth={0.7} />
      </g>
      {playing &&
        ["♪", "♫", "♪"].map((n, i) => (
          <text
            key={i}
            className="sk-note"
            x={-6 - i * 2}
            y={58}
            fontSize={5}
            fill="#e8c983"
            opacity={0}
            style={{ animationDelay: `${-i * 0.8}s`, ...vars({ "--dx": `${-8 - i * 4}px` }) }}
          >
            {n}
          </text>
        ))}
    </g>
  );
}

/** Benedict's tiny stall right by the grate: rat-sized, so humans never notice it. */
function MarketStall({ x }: { x: number }) {
  const s = x - 24;
  return (
    <g>
      <rect x={s} y={79.8} width={0.7} height={4.8} fill="#3a2a20" />
      <rect x={s + 9.3} y={79.8} width={0.7} height={4.8} fill="#3a2a20" />
      <path d={`M${s - 1} 80 H${s + 11} L${s + 10} 78 H${s}Z`} fill="#8a2a22" />
      <path d={`M${s - 1} 80 H${s + 11} L${s + 10} 78 H${s}Z`} fill="url(#sk-stripes)" opacity={0.7} />
      <rect x={s + 0.5} y={82.4} width={9} height={2.6} fill="#6a4a2a" />
      <circle cx={s + 2.6} cy={82.1} r={0.9} fill="#e8b84b" />
      <circle cx={s + 5} cy={82.1} r={0.9} fill="#d98a5a" />
      <circle cx={s + 7.4} cy={82.1} r={0.9} fill="#9cc7cf" />
      {/* Benedict in his tiny top hat */}
      <g fill="#4a3e36">
        <ellipse cx={s + 5} cy={81.2} rx={1.6} ry={1.1} />
        <rect x={s + 4.3} y={79.1} width={1.4} height={1.3} fill="#141317" />
      </g>
      <circle className="sk-glow" cx={s + 10.6} cy={81} r={2.4} fill="url(#sk-halo)" />
    </g>
  );
}

/* ================================================================ mid layer */

/** The ambient cat on a windowsill of the cellars' town house (hidden while Murzifer is on stage). */
export const AmbientCat = memo(function AmbientCat({ L }: { L: SkyLayout }) {
  if (!L.house) return null;
  return <SittingCat x={L.house.x0 + 36} y={44.6} scale={0.7} />;
});

/* ================================================================ weather (top) */

/** Rain over the whole strip: drizzle in the sewers zone, a proper downpour during the event. */
export const Rain = memo(function Rain({ W, heavy }: { W: number; heavy: boolean }) {
  return (
    <g pointerEvents="none">
      {heavy && <rect x={-MARGIN} y={-2} width={W + MARGIN * 2} height={H + 4} fill="#0e1622" opacity={0.38} />}
      {heavy && <rect x={-MARGIN} y={-2} width={W + MARGIN * 2} height={22} fill="#2a2e38" opacity={0.65} />}
      <g className="sk-rain" opacity={heavy ? 0.85 : 0.35}>
        <rect x={-MARGIN} y={-24} width={W + MARGIN * 2} height={H + 30} fill="url(#sk-rain)" />
        {heavy && <rect x={-MARGIN + 5} y={-12} width={W + MARGIN * 2} height={H + 18} fill="url(#sk-rain)" opacity={0.7} />}
      </g>
      {heavy &&
        Array.from({ length: Math.max(4, Math.round(W / 120)) }, (_, i) => (
          <ellipse
            key={i}
            className="sk-ripple"
            cx={20 + ((i * 137) % Math.max(60, W - 40))}
            cy={82 + (i % 3) * 2}
            rx={3.4}
            ry={0.9}
            fill="none"
            stroke="#b8ccd6"
            strokeWidth={0.4}
            style={{ animationDelay: `${-(i % 5) * 0.27}s` }}
          />
        ))}
    </g>
  );
});
