"use client";

/**
 * Epilogue «Город Наверху» (v3 SHL-5, meta-10; GDD 7.2): once the colony has crowned its King, the street up top
 * quietly belongs to the rats.
 * - RoyalStreet (the [data-royal] layer, for good after the first coronation): rat-sized bunting strung over the
 *   grate, a tiny crown on the nearest gas lamp, and every ~3 minutes a flag-decked miniature Rat Express running
 *   along the gutter while the Londoners step over it without a glance.
 * - Epilogue (once in every run that has a coronation, after the ceremony and never during a close-up): the street
 *   turns upside down for 8 s — the human world hangs below, the rats' own city stands on top. Reduced motion gets a
 *   still banner instead. The marker of a played flip is kept per save slot and run, so a reload does not replay it.
 * Moving parts are rAF tweens (attribute writes, no React state per frame) and WAAPI on whole layers; the loops
 * carry data-decor (the shell's one motion switch) and nothing schedules while the tab is hidden.
 */
import { memo, useEffect, useRef, useState, type RefObject } from "react";
import { isHeld, useGame } from "@/game/store";
import { MARGIN, PAVE_FRONT, ROAD_TOP, type SkyLayout } from "./skyGeo";

const INK = "#1a120c";
const FLAGS = ["#c4453a", "#e8c983", "#3a5a9a", "#e8c983"];
/** The miniature express: first run this long after the street turns royal, then every EXPRESS_EVERY ± jitter. */
const EXPRESS_FIRST_MS = 25_000;
const EXPRESS_EVERY_MS = 180_000;
const EXPRESS_JITTER_MS = 30_000;
const EXPRESS_RUN_MS = 9_000;
const FLIP_MS = 8_000;
/** The flip waits this long after the ceremony (or a scene) has gone. */
const FLIP_DELAY_MS = 2_500;

/* ================================================================ the royal street */

export const RoyalStreet = memo(function RoyalStreet({ L, calm, busy }: { L: SkyLayout; calm: boolean; busy: boolean }) {
  const lamp = L.lamps.length ? L.lamps.reduce((a, b) => (Math.abs(b - L.grate) < Math.abs(a - L.grate) ? b : a)) : null;
  return (
    <g data-royal="" aria-hidden>
      <GrateBunting x={L.grate} />
      {lamp !== null && <LampCrown x={lamp} />}
      {!calm && <MiniExpressRuns L={L} busy={busy} />}
    </g>
  );
});

/** Two matchstick poles at the grate's ends and a sagging string of seven thumbnail flags. */
function GrateBunting({ x }: { x: number }) {
  const x0 = x - 15;
  const x1 = x + 15;
  const y = 77.2;
  const sag = 1.6;
  const n = 7;
  return (
    <g>
      {[x0, x1].map((px) => (
        <g key={px}>
          <rect x={px - 0.25} y={y - 0.6} width={0.5} height={ROAD_TOP + 5 - y} fill="#6b4a2a" />
          <circle cx={px} cy={y - 0.7} r={0.45} fill="#e8c983" />
        </g>
      ))}
      <path d={`M${x0} ${y} Q${x} ${y + sag * 2} ${x1} ${y}`} stroke="#2a1f14" strokeWidth={0.22} fill="none" />
      <g data-decor="" className="sk-bob" style={{ animationDuration: "1.8s" }}>
        {Array.from({ length: n }, (_, i) => {
          const t = (i + 0.5) / n;
          const fx = x0 + (x1 - x0) * t;
          const fy = y + sag * 4 * t * (1 - t);
          return (
            <path key={i} d={`M${(fx - 0.8).toFixed(2)} ${fy.toFixed(2)} h1.6 l-0.8 2.1Z`} fill={FLAGS[i % FLAGS.length]} stroke={INK} strokeWidth={0.12} />
          );
        })}
      </g>
    </g>
  );
}

/** A tiny gilt crown on top of the gas lamp nearest the grate (the lamp's finial tops out at y ≈ 38.8). */
function LampCrown({ x }: { x: number }) {
  return (
    <g transform={`translate(${x} 38.9)`}>
      <path d="M-2.2 0V-1.9L-1.1 -0.9L0 -2.7L1.1 -0.9L2.2 -1.9V0Z" fill="url(#sk-gold)" stroke={INK} strokeWidth={0.18} strokeLinejoin="round" />
      <rect x={-2.2} y={-0.1} width={4.4} height={0.7} fill="#d4af37" stroke={INK} strokeWidth={0.12} />
      <circle cx={0} cy={-2.75} r={0.35} fill="#c4453a" />
      <circle data-decor="" className="sk-glow" cx={0.6} cy={-1.6} r={0.5} fill="#fff1c9" />
    </g>
  );
}

/**
 * Schedules the miniature Rat Express: the first run soon after the street turns royal, then about every three
 * minutes. A hidden tab or a close-up skips the turn (and tries again a minute later).
 */
function MiniExpressRuns({ L, busy }: { L: SkyLayout; busy: boolean }) {
  const [run, setRun] = useState(0);
  const busyRef = useRef(busy);
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);
  useEffect(() => {
    let timer = 0;
    const plan = (ms: number) => {
      timer = window.setTimeout(() => {
        if (document.hidden || busyRef.current) {
          plan(60_000);
          return;
        }
        setRun((n) => n + 1);
        plan(EXPRESS_EVERY_MS + (Math.random() * 2 - 1) * EXPRESS_JITTER_MS);
      }, ms);
    };
    plan(EXPRESS_FIRST_MS);
    return () => window.clearTimeout(timer);
  }, []);
  if (run === 0) return null;
  return <MiniExpress key={run} L={L} />;
}

/** One run along the gutter, left to right, then it is gone (opacity 0 at the end of the tween). */
function MiniExpress({ L }: { L: SkyLayout }) {
  const ref = useRef<SVGGElement>(null);
  const from = -MARGIN - 40;
  const to = (L.cut ?? L.W + MARGIN) + 4;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / EXPRESS_RUN_MS);
      el.setAttribute("transform", `translate(${(from + (to - from) * k).toFixed(1)} 0)`);
      if (k < 1) raf = requestAnimationFrame(step);
      else el.setAttribute("opacity", "0");
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [from, to]);
  const car = (x: number, i: number) => (
    <g key={i}>
      <rect x={x} y={ROAD_TOP - 3.2} width={6.4} height={2.6} rx={0.5} fill="#5a1c17" stroke={INK} strokeWidth={0.18} />
      <rect x={x + 0.6} y={ROAD_TOP - 2.7} width={5.2} height={0.9} fill="#ffd27a" opacity={0.85} />
      <rect x={x} y={ROAD_TOP - 3.4} width={6.4} height={0.45} fill="url(#sk-gold)" />
      <line x1={x + 3.2} y1={ROAD_TOP - 3.4} x2={x + 3.2} y2={ROAD_TOP - 5.6} stroke={INK} strokeWidth={0.15} />
      <path d={`M${x + 3.3} ${ROAD_TOP - 5.6} l1.5 0.45 l-1.5 0.45Z`} fill={FLAGS[i % FLAGS.length]} />
      <circle cx={x + 1.4} cy={ROAD_TOP - 0.4} r={0.55} fill="#141317" />
      <circle cx={x + 5} cy={ROAD_TOP - 0.4} r={0.55} fill="#141317" />
    </g>
  );
  return (
    <g ref={ref} transform={`translate(${from} 0)`}>
      {[0, 1, 2].map((i) => car(i * 7.2, i))}
      {/* the engine leads (right), crowned */}
      <g transform="translate(21.8 0)">
        <rect x={0} y={ROAD_TOP - 3.6} width={3} height={3} rx={0.4} fill="#4a1612" stroke={INK} strokeWidth={0.18} />
        <rect x={2.6} y={ROAD_TOP - 2.6} width={4.4} height={2} rx={1} fill="#4a1612" stroke={INK} strokeWidth={0.18} />
        <rect x={5} y={ROAD_TOP - 4.2} width={0.9} height={1.8} fill="#141317" />
        <path d="M0.4 -0.1 l0.4 -0.9 l0.5 0.6 l0.5 -0.6 l0.4 0.9Z" transform={`translate(0 ${ROAD_TOP - 3.6})`} fill="#d4af37" />
        <circle cx={7} cy={ROAD_TOP - 1.6} r={0.4} fill="#fff1c9" />
        <circle cx={1.2} cy={ROAD_TOP - 0.4} r={0.6} fill="#141317" />
        <circle cx={5.2} cy={ROAD_TOP - 0.4} r={0.6} fill="#141317" />
        <circle
          data-decor=""
          className="sk-smoke"
          cx={5.4}
          cy={ROAD_TOP - 4.6}
          r={0.7}
          fill="#e3e8e8"
          opacity={0}
          style={{ animationDuration: "1.4s", ["--dx" as string]: "-6px" }}
        />
      </g>
      {/* the gutter's shadow under the tiny train, so it reads as running in the kerb, not floating */}
      <rect x={-1} y={PAVE_FRONT + 1.6} width={30} height={0.5} fill="#000" opacity={0.25} />
    </g>
  );
}

/* ================================================================ the flip */

/** The slot this page plays (?slot= in dev and with ?dev): each save keeps its own «already flipped» marker. */
function slotName(): string {
  try {
    return new URLSearchParams(window.location.search).get("slot") ?? "";
  } catch {
    return "";
  }
}

const KEY = () => `rr-epilogue:${slotName()}`;
/** Without storage (private mode): once per page load. */
let flippedHere: string | null = null;

function flipped(marker: string): boolean {
  if (flippedHere === marker) return true;
  try {
    return window.localStorage.getItem(KEY()) === marker;
  } catch {
    return false;
  }
}

function markFlipped(marker: string): void {
  flippedHere = marker;
  try {
    window.localStorage.setItem(KEY(), marker);
  } catch {
    /* the page-load marker above still holds */
  }
}

type Play = { kind: "flip" | "banner" } | null;

/**
 * The epilogue's once-per-crowned-run moment. `world` is the strip's human layers (the parallax art, tint, lights and
 * rain): the flip turns it over into the lower half while the rat city rises into the upper one.
 */
export function Epilogue({ world, W, calm, folded }: { world: RefObject<HTMLDivElement | null>; W: number; calm: boolean; folded: boolean }) {
  const crowned = useGame((s) => s.game.coronatedThisRun);
  // one coronation per run: the run is told apart by the migrations, the coronation count and when it happened
  const marker = useGame((s) => `${s.game.meta.migrations}:${s.game.meta.coronations}:${Math.round(s.game.coronatedAt)}`);
  const sceneUp = useGame((s) => !!s.game.scene);
  const held = useGame(isHeld);
  // a coronation finished while away waits behind the offline report (coronationGate): so does the flip, to follow it
  const report = useGame((s) => s.offlineReport !== null);
  const [play, setPlay] = useState<Play>(null);
  const bandRef = useRef<HTMLDivElement>(null);
  const free = crowned && !sceneUp && !held && !report && !folded;
  // the moment shows only while nothing covers it; a scene or a ceremony mid-way ends it for good
  const active = play && free ? play : null;

  // start: a little after the ceremony (and any scene) has gone, with the tab in view
  useEffect(() => {
    if (!free || play || flipped(marker)) return;
    let timer = 0;
    const arm = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (document.hidden) return;
        markFlipped(marker);
        setPlay({ kind: calm ? "banner" : "flip" });
      }, FLIP_DELAY_MS);
    };
    const onVis = () => {
      if (!document.hidden) arm();
    };
    if (!document.hidden) arm();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [free, play, marker, calm]);

  // play: WAAPI on the whole human world and the rat band (compositor work, no React per frame), or a still banner
  useEffect(() => {
    if (!active) return;
    let over = false;
    const end = () => {
      if (over) return;
      over = true;
      setPlay(null);
    };
    const anims: Animation[] = [];
    let timer = 0;
    if (active.kind === "flip") {
      const w = world.current;
      const band = bandRef.current;
      // (the world turns about its top edge: SkyStrip gives it transform-origin 50% 0)
      if (w) {
        anims.push(
          w.animate(
            [
              { transform: "translateY(0) scaleY(1)", offset: 0 },
              { transform: "translateY(100%) scaleY(-0.5)", offset: 0.13 },
              { transform: "translateY(100%) scaleY(-0.5)", offset: 0.87 },
              { transform: "translateY(0) scaleY(1)", offset: 1 },
            ],
            { duration: FLIP_MS, easing: "ease-in-out" },
          ),
        );
      }
      if (band) {
        anims.push(
          band.animate(
            [
              { opacity: 0, transform: "translateY(-30%)", offset: 0 },
              { opacity: 0, transform: "translateY(-30%)", offset: 0.07 },
              { opacity: 1, transform: "translateY(0)", offset: 0.15 },
              { opacity: 1, transform: "translateY(0)", offset: 0.85 },
              { opacity: 0, transform: "translateY(-30%)", offset: 0.93 },
              { opacity: 0, transform: "translateY(-30%)", offset: 1 },
            ],
            { duration: FLIP_MS, easing: "ease-in-out", fill: "both" },
          ),
        );
      }
      if (anims.length) anims[0].finished.then(end, end);
      else end();
    } else {
      timer = window.setTimeout(end, FLIP_MS);
    }
    return () => {
      window.clearTimeout(timer);
      for (const a of anims) a.cancel();
      // cut short (a scene, a ceremony, the sheet over the strip): it does not come back
      if (!over) {
        over = true;
        setPlay(null);
      }
    };
  }, [active, world]);

  if (!active) return null;
  if (active.kind === "banner") {
    return (
      <div className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center" role="status">
        <span
          className="max-w-[92%] truncate rounded-sm border border-[#7d5f2c] bg-gradient-to-b from-[#fff1c9] via-[#e8c983] to-[#c9a25a] px-2 py-px font-display text-[11px] font-bold uppercase tracking-[0.18em] text-[#2a1f14] shadow-[0_2px_6px_rgba(0,0,0,.6)] md:text-[13px]"
          style={{ animation: "hud-fade-in .4s ease-out both" }}
        >
          👑 Город Наверху: теперь крысы — над людьми
        </span>
      </div>
    );
  }
  return (
    <div
      ref={bandRef}
      className="pointer-events-none absolute inset-x-0 top-0 z-[5] h-1/2 overflow-hidden"
      style={{ opacity: 0 }}
      role="status"
      aria-label="Город Наверху: теперь крысы — над людьми"
    >
      <RatCity W={W} />
    </div>
  );
}

/** The rats' city on top of the world: matchbox houses, thimble towers, a teapot dome, crowned rats and a banner. */
const RatCity = memo(function RatCity({ W }: { W: number }) {
  const H = 44;
  const C = W / 2;
  const blocks: { x: number; w: number; h: number; kind: "box" | "thimble" | "pot" }[] = [];
  let x = -10;
  let i = 0;
  while (x < W + 10) {
    const kind = i % 5 === 2 ? "thimble" : i % 7 === 4 ? "pot" : "box";
    const w = kind === "thimble" ? 14 : kind === "pot" ? 22 : 18 + ((i * 37) % 17);
    const h = kind === "thimble" ? 26 : kind === "pot" ? 20 : 12 + ((i * 53) % 14);
    blocks.push({ x, w, h, kind });
    x += w + 2 + ((i * 29) % 6);
    i++;
  }
  const rats = Math.max(3, Math.min(14, Math.round(W / 60)));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMax slice" className="absolute inset-0 h-full w-full" aria-hidden>
      <defs>
        <linearGradient id="rr-ratcity-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2a1c10" />
          <stop offset="1" stopColor="#7d5f2c" />
        </linearGradient>
      </defs>
      <rect x={0} y={0} width={W} height={H} fill="url(#rr-ratcity-sky)" />
      {blocks.map((b, k) => {
        const top = H - 4 - b.h;
        return (
          <g key={k}>
            {b.kind === "thimble" ? (
              <path
                d={`M${b.x} ${H - 4} L${b.x + 2} ${top + 3} Q${b.x + b.w / 2} ${top - 3} ${b.x + b.w - 2} ${top + 3} L${b.x + b.w} ${H - 4}Z`}
                fill="#b8b2a6"
                stroke={INK}
                strokeWidth={0.5}
              />
            ) : b.kind === "pot" ? (
              <g>
                <path
                  d={`M${b.x} ${H - 4} Q${b.x - 1} ${top + 6} ${b.x + b.w / 2} ${top + 4} Q${b.x + b.w + 1} ${top + 6} ${b.x + b.w} ${H - 4}Z`}
                  fill="#c9a25a"
                  stroke={INK}
                  strokeWidth={0.5}
                />
                <path d={`M${b.x + b.w} ${top + 10} q5 -2 6 -7`} stroke="#c9a25a" strokeWidth={1.6} fill="none" />
                <circle cx={b.x + b.w / 2} cy={top + 3} r={1.4} fill="#7d5f2c" />
              </g>
            ) : (
              <rect x={b.x} y={top} width={b.w} height={b.h} fill={k % 2 ? "#b8402e" : "#5b7fa8"} stroke={INK} strokeWidth={0.5} />
            )}
            {Array.from({ length: Math.max(1, Math.floor(b.w / 7)) }, (_, j) => (
              <rect key={j} x={b.x + 3 + j * 7} y={top + 5} width={2.6} height={3} fill="#ffd27a" opacity={0.9} />
            ))}
          </g>
        );
      })}
      {/* the rats' pavement: the humans' kerb, seen from above */}
      <rect x={0} y={H - 4} width={W} height={4} fill="#6f665b" />
      {Array.from({ length: rats }, (_, k) => {
        const rx = ((k + 0.5) / rats) * W;
        return (
          <g key={k} transform={`translate(${rx.toFixed(1)} ${H - 4}) scale(${k % 2 ? -0.32 : 0.32} 0.32)`}>
            <path d="M-12 -6Q-24 -1 -31 -8" stroke="#c98b8b" strokeWidth={1.8} fill="none" strokeLinecap="round" />
            <ellipse cx={-2} cy={-9} rx={13} ry={8} fill="#8a7f78" stroke={INK} strokeWidth={0.8} />
            <path d="M5 -15Q14 -19 21.5 -11Q16 -6 6 -5.5z" fill="#8a7f78" stroke={INK} strokeWidth={0.8} />
            <circle cx={8} cy={-16.5} r={4.3} fill="#8a7f78" stroke={INK} strokeWidth={0.7} />
            <circle cx={14} cy={-12.5} r={1.35} fill="#111" />
            <path d="M4 -21V-26L7 -23L10 -28L13 -23L16 -26V-21Z" fill="#d4af37" stroke={INK} strokeWidth={0.6} />
          </g>
        );
      })}
      <g transform={`translate(${C} 9)`}>
        <rect x={-46} y={-6} width={92} height={11} rx={1.5} fill="#e8c983" stroke="#7d5f2c" strokeWidth={0.8} />
        <text
          x={0}
          y={2.2}
          textAnchor="middle"
          fontSize={6.4}
          fontWeight={700}
          fill="#2a1f14"
          style={{ fontFamily: "var(--font-display), serif", letterSpacing: ".6px" }}
        >
          👑 ГОРОД НАВЕРХУ
        </text>
      </g>
    </svg>
  );
});
