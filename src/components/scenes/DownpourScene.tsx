"use client";

/**
 * «Ливень» close-up. Phase `taps`: rain drums through the street grate, murky water rises (faster for every
 * gushing outlet) and the player spins three valve wheels shut → {a:"taps", cleared: valves closed by hand}.
 * Phase `catch`: the water settles into a current and flotsam drifts right→left (CatchCanvas, float mode).
 * SC-6: the wheels are rotary — drag around a wheel and every 72° clockwise is one turn (a tap or a key still counts
 * one); the three outlets gush at 1.6 / 1.0 / 0.6 of the flood rate (shuffled per downpour, stream width shows it), so
 * shutting the widest first visibly slows the water; past 55% the scene dims and bubbles; «до затопления N с» comes
 * from the water integrator. The result carries fastMs (first to last valve shut by hand).
 * v3 SCN-1: the water, the rain and fastMs run on the scene clock; while the game is held no wheel turns.
 */
import { memo, useCallback, useEffect, useId, useRef, useState, type RefObject } from "react";
import { sfx } from "@/audio/sfx";
import { cx, Stamp } from "@/components/ui/kit";
import { sfxCue } from "@/game/fx";
import { useGame } from "@/game/store";
import type { CatchResult, Scene } from "@/game/types";
import { fmtInt, plural } from "@/lib/format";
import CatchCanvas from "./CatchCanvas";
import { Countdown, HazardStyles, makeTapLimiter, useReduced, useTimeUp } from "./HazardKit";
import { act, hash01, sceneHeld, sceneNow, shake, WATER_FRAC } from "./sceneUtils";

/* Geometry, as fractions of the scene body (shared by the DOM valves and the water canvas). */
const VALVE_X = [0.2, 0.5, 0.8];
const VALVE_Y = 0.3;
const OUTLET_Y = 0.46;
const GRATE_Y = 0.09;
/** Water height (fraction from the bottom): start, flood cap, and the flotsam current of the catch phase. */
const LEVEL0 = 0.07;
const LEVEL_MAX = 0.74;
const CALM_LEVEL = 1 - WATER_FRAC;
/** Height gained per second per fully open valve: three open valves for 12 s ≈ the flood cap. */
const FLOOD_RATE = 0.0175;
const TURN_DEG = 72;

/** Outlet strengths (× FLOOD_RATE), dealt to the three valves in a shuffled order each downpour. */
const GUSH = [1.6, 1, 0.6];
/** Above this water level the scene dims and the drowned outlets bubble. */
const DIM_LEVEL = 0.55;

/** Mutable channel between the React layer and the water canvas (no re-renders). */
interface Shared {
  open: number[]; // 0..1 per valve: how hard its outlet gushes
  /** Outlet strength per valve (GUSH, shuffled). */
  mul: number[];
  catching: boolean;
  splash: ((nx: number, ny: number, n: number) => void) | null;
  /** The canvas writes «до затопления N с» here and dims the scene through `dim`. */
  eta: HTMLSpanElement | null;
  dim: HTMLDivElement | null;
  /** Phase end (run time) and the game clock offset, for the shown seconds. */
  endsAt: number;
}

function closedBy(hits: number[], pre: number, hp: number): number {
  let n = 0;
  for (let i = pre; i < 3; i++) if (hits[i] >= hp) n++;
  return n;
}

export default function DownpourScene({ scene }: { scene: Scene }) {
  const reduced = useReduced();
  const taps = scene.phase === "taps";
  const pre = Math.max(0, Math.min(3, scene.preCleared));
  const hp = Math.max(1, scene.taps?.hp ?? 6);
  const total = Math.max(0.1, scene.taps?.duration ?? scene.phaseEnds - scene.phaseStart);

  const [mul] = useState(() => {
    // a fixed shuffle per downpour (the scene seq), so a remount keeps the same outlets
    const order = [0, 1, 2].sort((a, b) => hash01(scene.seq, a + 1) - hash01(scene.seq, b + 1));
    const m = [0, 0, 0];
    order.forEach((v, k) => (m[v] = GUSH[k]));
    return m;
  });
  const shared = useRef<Shared>({ open: [1, 1, 1], mul, catching: !taps, splash: null, eta: null, dim: null, endsAt: scene.phaseEnds });
  const hitsRef = useRef<number[]>([0, 0, 0]);
  const shutAt = useRef<number[]>([]);
  const sentRef = useRef(false);
  const limiter = useRef<(() => boolean) | null>(null);
  const [hits, setHits] = useState<number[]>([0, 0, 0]);
  const timeUp = useTimeUp(taps ? scene.phaseEnds : Infinity);

  const send = useCallback(() => {
    if (sentRef.current) return;
    sentRef.current = true;
    const at = shutAt.current;
    const fastMs = at.length >= 2 ? Math.round(at[at.length - 1] - at[0]) : at.length === 1 && pre >= 2 ? 0 : undefined;
    act(fastMs === undefined ? { a: "taps", cleared: closedBy(hitsRef.current, pre, hp) } : { a: "taps", cleared: closedBy(hitsRef.current, pre, hp), fastMs });
  }, [pre, hp]);

  // time is up: report whatever got closed (the engine waits a short grace for us)
  useEffect(() => {
    if (taps && timeUp) send();
  }, [taps, timeUp, send]);

  // which wheels are shut: pre-closed by the water wheel, turned by hand, or (after a remount) per the engine
  const localClosed = pre + closedBy(hits, pre, hp);
  const engineClosed = !taps && scene.choice !== null && !Number.isNaN(Number(scene.choice)) ? Number(scene.choice) : localClosed;
  const closed = [0, 1, 2].map((i) => i < pre || hits[i] >= hp || (engineClosed > localClosed && i < engineClosed));
  const openKey = closed.map((c, i) => (c ? 0 : 1 - Math.min(1, hits[i] / hp)).toFixed(3)).join(",");

  useEffect(() => {
    shared.current.open = openKey.split(",").map(Number);
    shared.current.catching = !taps;
  }, [openKey, taps]);

  const turn = (i: number) => {
    if (!taps || sentRef.current || i < pre || sceneHeld()) return;
    const h = hitsRef.current;
    if (h[i] >= hp) return;
    limiter.current ??= makeTapLimiter();
    if (!limiter.current()) return;
    h[i] += 1;
    setHits([...h]);
    sfx.splash();
    sfxCue("valveCreak", { intensity: 0.7, pitch: 0.9 + 0.05 * h[i] });
    shared.current.splash?.(VALVE_X[i], OUTLET_Y, 12);
    if (h[i] >= hp) {
      sfx.clack();
      shake(2, 160);
      shutAt.current.push(sceneNow());
    }
    if (closedBy(h, pre, hp) >= 3 - pre) send();
  };

  const onDone = useCallback((result: CatchResult) => act({ a: "catch", result }), []);

  return (
    <div className="absolute inset-0 select-none overflow-hidden bg-[#0b1110]" style={{ touchAction: "manipulation" }}>
      <HazardStyles />
      <SewerWall />
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(ellipse at 50% 32%, transparent 22%, rgba(0,0,0,.74) 100%)", animation: reduced ? undefined : "rh-darken 2.4s ease-out both" }}
      />
      <Pipes />
      <WaterCanvas sharedRef={shared} reduced={reduced} />
      <div ref={(el) => void (shared.current.dim = el)} className="pointer-events-none absolute inset-0 bg-[#020606] opacity-0 transition-opacity duration-500" />
      {!reduced && taps && <div className="pointer-events-none absolute inset-0 bg-[#dfe9ff] opacity-0" style={{ animation: "rh-lightning 1.7s ease-out 1.15s both" }} />}

      {[0, 1, 2].map((i) => (
        <Valve key={i} i={i} turns={i < pre ? 0 : hits[i]} hp={hp} closed={closed[i]} preClosed={i < pre} active={taps} reduced={reduced} onTurn={turn} gush={mul[i]} />
      ))}

      {taps ? (
        <>
          <div className="pointer-events-none absolute inset-x-2 top-[calc(9%_+_6px)] z-20 flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <Countdown endsAt={scene.phaseEnds} total={total} label="Шлюзы!" warnAt={3} />
              <span className="whitespace-nowrap rounded-full border border-[#4f9d8a] bg-soot/85 px-2.5 py-1 text-xs font-bold text-verdigris-light shadow-[0_4px_14px_rgba(0,0,0,.6)]">
                до затопления <span ref={(el) => void (shared.current.eta = el)} className="font-mono tabular">…</span>
              </span>
            </div>
            <div className="rounded-full border border-brass-dark bg-soot/85 px-3 py-1.5 text-xs font-bold text-parchment shadow-[0_4px_14px_rgba(0,0,0,.6)]">
              Задраено <span className="font-mono text-brass-light tabular">{fmtInt(localClosed)}/3</span>
            </div>
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center px-3">
            <p className="max-w-md rounded-lg border border-line bg-soot/85 px-3 py-1.5 text-center text-xs leading-snug text-parchment shadow-[0_6px_18px_rgba(0,0,0,.6)]">
              <span className="font-display text-sm font-bold text-brass-light">Крутите вентили!</span> По {fmtInt(hp)} оборотов на каждый, пока Великие Воды не залили нору.
              {pre > 0 && <span className="block text-verdigris-light">Водяное колесо уже задраило шлюз — меньше работы лапам.</span>}
            </p>
          </div>
        </>
      ) : (
        scene.phase === "catch" && (
          <>
            <CatchCanvas key={`c${scene.phaseStart}`} scene={scene} mode="float" onDone={onDone} className="absolute inset-0 z-20" />
            <CatchBanner closed={engineClosed} />
          </>
        )
      )}
    </div>
  );
}

/* ------------------------------------------------------------ valves */

function Valve({
  i,
  turns,
  hp,
  closed,
  preClosed,
  active,
  reduced,
  onTurn,
  gush,
}: {
  i: number;
  turns: number;
  hp: number;
  closed: boolean;
  preClosed: boolean;
  active: boolean;
  reduced: boolean;
  onTurn: (i: number) => void;
  /** Outlet strength of this valve (×FLOOD_RATE). */
  gush: number;
}) {
  const progress = closed ? 1 : Math.min(1, turns / hp);
  // rotary drag: the swept angle around the wheel's centre; every 72° clockwise is a turn, a tap is one turn
  const wheelRef = useRef<HTMLSpanElement>(null);
  const drag = useRef<{ id: number; cx: number; cy: number; a: number; sweep: number; credited: number } | null>(null);
  const setSpin = (extra: number) => {
    const el = wheelRef.current;
    if (el) el.style.transform = `rotate(${turns * TURN_DEG + extra}deg)`;
  };
  const C = 2 * Math.PI * 46;
  const turnsLeft = hp - turns;
  const label = preClosed ? "Вентиль задраен водяным колесом" : closed ? "Вентиль задраен" : `Вентиль ${i + 1}: ещё ${turnsLeft} ${plural(turnsLeft, "оборот", "оборота", "оборотов")}`;
  return (
    <button
      type="button"
      aria-label={label}
      disabled={!active || closed}
      onPointerDown={(e) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        e.preventDefault();
        const r = e.currentTarget.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        drag.current = { id: e.pointerId, cx, cy, a: Math.atan2(e.clientY - cy, e.clientX - cx), sweep: 0, credited: 0 };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || d.id !== e.pointerId) return;
        const a = Math.atan2(e.clientY - d.cy, e.clientX - d.cx);
        let da = ((a - d.a) * 180) / Math.PI;
        if (da > 180) da -= 360;
        else if (da < -180) da += 360;
        d.a = a;
        if (da >= 0) {
          d.sweep += da;
          while (d.sweep - d.credited * TURN_DEG >= TURN_DEG) {
            d.credited++;
            onTurn(i);
          }
          setSpin(reduced ? 0 : d.sweep - d.credited * TURN_DEG);
        } else {
          // against the thread: the wheel only shudders
          setSpin(reduced ? 0 : Math.max(-6, da));
        }
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        if (!d || d.id !== e.pointerId) return;
        drag.current = null;
        // a plain tap still turns once
        if (d.credited === 0 && d.sweep < TURN_DEG / 2) onTurn(i);
        setSpin(0);
      }}
      onPointerCancel={() => {
        drag.current = null;
        setSpin(0);
      }}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !e.repeat) {
          e.preventDefault();
          onTurn(i);
        }
      }}
      className={cx(
        // touch-none: otherwise a circular swipe turns into a pan after the touch slop and pointercancel eats the turns
        "absolute z-10 -translate-x-1/2 -translate-y-1/2 touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-brass-light",
        active && !closed ? "cursor-pointer hover:brightness-110" : "cursor-default",
      )}
      style={{ left: `${VALVE_X[i] * 100}%`, top: `${VALVE_Y * 100}%`, width: "clamp(80px, 24vw, 124px)", height: "clamp(80px, 24vw, 124px)" }}
    >
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden>
        <circle cx={50} cy={50} r={46} fill="rgba(8,12,12,.55)" stroke="rgba(0,0,0,.6)" strokeWidth={5} />
        <circle
          cx={50}
          cy={50}
          r={46}
          fill="none"
          stroke={closed ? "var(--good)" : "var(--brass-light)"}
          strokeWidth={4}
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - progress)}
          style={{ transition: "stroke-dashoffset .2s" }}
        />
      </svg>
      <span
        ref={wheelRef}
        className="absolute inset-[10%] block"
        style={{ transform: `rotate(${turns * TURN_DEG}deg)`, transition: reduced ? "transform .12s linear" : "transform .2s cubic-bezier(.2,1.4,.45,1)" }}
      >
        <ValveWheel shut={closed} />
      </span>
      {/* static glint (does not spin with the wheel) */}
      <span className="pointer-events-none absolute inset-[14%] rounded-full shadow-[inset_6px_8px_10px_-6px_rgba(255,255,255,.25)]" />
      {active && !closed && (
        <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 translate-y-full whitespace-nowrap rounded-full border border-brass-dark bg-soot/90 px-2 py-0.5 font-mono text-xs font-bold text-brass-light tabular shadow">
          ×{fmtInt(hp - turns)} <span className="text-verdigris-light">{gush >= 1.5 ? "💦💦" : gush >= 1 ? "💦" : "·"}</span>
        </span>
      )}
      {closed && (
        <span className="absolute inset-0 flex items-center justify-center" style={reduced ? undefined : { animation: "rh-stamp .45s ease-out both" }}>
          <Stamp color={preClosed ? "var(--verdigris-light)" : "var(--good)"} className="bg-soot/75 px-1.5 text-[11px]">
            {preClosed ? "Колесо" : "Задраен"}
          </Stamp>
        </span>
      )}
    </button>
  );
}

const ValveWheel = memo(function ValveWheel({ shut }: { shut: boolean }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const rim = `${uid}r`;
  const hub = `${uid}h`;
  return (
    <svg viewBox="-50 -50 100 100" className="h-full w-full drop-shadow-[0_4px_5px_rgba(0,0,0,.7)]" aria-hidden>
      <defs>
        <linearGradient id={rim} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={shut ? "#a9e0cf" : "#f0846f"} />
          <stop offset=".5" stopColor={shut ? "#4f9d8a" : "#b23a2e"} />
          <stop offset="1" stopColor={shut ? "#24493f" : "#5a1c17"} />
        </linearGradient>
        <radialGradient id={hub} cx=".35" cy=".35" r=".8">
          <stop offset="0" stopColor="#f6e2a8" />
          <stop offset=".55" stopColor="#c9a25a" />
          <stop offset="1" stopColor="#5e4520" />
        </radialGradient>
      </defs>
      {[0, 72, 144, 216, 288].map((a) => (
        <rect key={a} x={-3.4} y={-39} width={6.8} height={31} rx={2} fill={`url(#${rim})`} stroke="#2a0f0b" strokeWidth={0.8} transform={`rotate(${a})`} />
      ))}
      <circle r={40} fill="none" stroke="#1a0b08" strokeWidth={11.5} />
      <circle r={40} fill="none" stroke={`url(#${rim})`} strokeWidth={8} />
      <circle r={40} fill="none" stroke="rgba(255,255,255,.18)" strokeWidth={1} strokeDasharray="3 6" />
      {[36, 108, 180, 252, 324].map((a) => {
        const r = (a * Math.PI) / 180;
        return <circle key={a} cx={Math.cos(r) * 40} cy={Math.sin(r) * 40} r={5.2} fill={`url(#${rim})`} stroke="#1a0b08" strokeWidth={1.1} />;
      })}
      <circle r={12} fill={`url(#${hub})`} stroke="#3b2a12" strokeWidth={1.5} />
      <rect x={-4} y={-4} width={8} height={8} fill="#2a1f12" transform="rotate(45)" />
    </svg>
  );
});

/* ------------------------------------------------------------ backdrop */

const SewerWall = memo(function SewerWall() {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      <svg className="absolute inset-0 h-full w-full">
        <defs>
          <pattern id={`${uid}b`} width="56" height="26" patternUnits="userSpaceOnUse">
            <rect width="56" height="26" fill="#0d1817" />
            <rect x="1" y="1" width="54" height="11" rx="2" fill="#1a2c29" />
            <rect x="-27" y="14" width="54" height="11" rx="2" fill="#172725" />
            <rect x="29" y="14" width="54" height="11" rx="2" fill="#172725" />
          </pattern>
          <linearGradient id={`${uid}m`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#3f7f86" stopOpacity="0" />
            <stop offset=".45" stopColor="#3f7f86" stopOpacity=".16" />
            <stop offset="1" stopColor="#5e7a4a" stopOpacity=".32" />
          </linearGradient>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${uid}b)`} />
        {[7, 33, 61, 89].map((x, k) => (
          <rect key={x} x={`${x}%`} y="9%" width={`${3 + (k % 2) * 3}%`} height="91%" fill={`url(#${uid}m)`} />
        ))}
      </svg>
      {/* stone ceiling with the storm-grey daylight of the street grate */}
      <div className="absolute inset-x-0 top-0" style={{ height: `${GRATE_Y * 100}%`, background: "linear-gradient(#2c3234,#141819)" }} />
      <div className="absolute top-0" style={{ left: "14%", right: "14%", height: `${GRATE_Y * 100}%`, background: "linear-gradient(180deg,#4d5961,#76848c 60%,#434d53)" }} />
      <div className="absolute top-0" style={{ left: "14%", right: "14%", height: `${GRATE_Y * 100}%`, background: "repeating-linear-gradient(90deg,#121416 0 7px,transparent 7px 30px)" }} />
      <div className="absolute inset-x-0" style={{ top: `${GRATE_Y * 100}%`, height: 8, background: "linear-gradient(rgba(0,0,0,.75),transparent)" }} />
    </div>
  );
});

const Pipes = memo(function Pipes() {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      {VALVE_X.map((x) => {
        const left = `${x * 100}%`;
        return (
          <div key={x}>
            <div
              className="absolute w-4 -translate-x-1/2"
              style={{ left, top: `${GRATE_Y * 100}%`, height: `${(VALVE_Y - GRATE_Y) * 100}%`, background: "linear-gradient(90deg,#161918,#56625e 35%,#8b9894 50%,#36403d 75%,#121514)" }}
            />
            <div className="absolute h-1.5 w-6 -translate-x-1/2 rounded-sm bg-[#4a5552]" style={{ left, top: `${(GRATE_Y + 0.035) * 100}%` }} />
            <div
              className="absolute w-[22px] -translate-x-1/2"
              style={{ left, top: `${VALVE_Y * 100}%`, height: `${(OUTLET_Y - VALVE_Y) * 100}%`, background: "linear-gradient(90deg,#26170f,#8a5a3a 35%,#c98a5a 50%,#6e3a1d 75%,#1d120b)" }}
            />
            <div
              className="absolute h-2 w-9 -translate-x-1/2 rounded-sm shadow-[0_2px_4px_rgba(0,0,0,.6)]"
              style={{ left, top: `calc(${OUTLET_Y * 100}% - 8px)`, background: "linear-gradient(180deg,#d98a5a,#7a3f20)" }}
            />
          </div>
        );
      })}
    </div>
  );
});

function CatchBanner({ closed }: { closed: number }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[13%] z-30 flex justify-center px-4" style={{ animation: "rh-banner 3.6s ease-out forwards" }}>
      <div className="rounded-lg border border-brass bg-soot/85 px-4 py-2 text-center shadow-[0_6px_20px_rgba(0,0,0,.7)]">
        <p className="font-display text-xl font-bold text-brass-light">{closed >= 3 ? "Шлюзы задраены!" : `Задраено ${fmtInt(closed)} из 3`}</p>
        <p className="text-xs text-parchment">По течению плывёт добро — лови, пока не утонуло!</p>
        {closed < 3 && <p className="text-[11px] text-danger-light">Открытый вентиль: добыча 🍞🪙🔘➰ ×0.8 на 25 с</p>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ rain & water canvas */

interface Drop {
  x: number;
  y: number;
  v: number;
  l: number;
}
interface Droplet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  r: number;
}
interface Ripple {
  x: number;
  age: number;
  life: number;
}

function WaterCanvas({ sharedRef, reduced }: { sharedRef: RefObject<Shared>; reduced: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  // read per frame: re-running the effect on a «Меньше анимации» toggle would reset the water level
  const reducedRef = useRef(reduced);
  useEffect(() => {
    reducedRef.current = reduced;
  }, [reduced]);

  useEffect(() => {
    const canvas = ref.current;
    const g = canvas?.getContext("2d");
    if (!canvas || !g) return;
    let W = 1;
    let H = 1;
    let dpr = 1;
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      W = Math.max(1, r.width);
      H = Math.max(1, r.height);
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    // resume at the right height after a remount mid-phase
    const g0 = useGame.getState().game;
    const elapsed = g0.scene ? Math.max(0, g0.time - g0.scene.phaseStart) : 0;
    let level = g0.scene?.phase === "catch" ? CALM_LEVEL : Math.min(LEVEL_MAX, LEVEL0 + FLOOD_RATE * 3 * elapsed);

    const k = () => (reducedRef.current ? 0.3 : 1);
    const drops: Drop[] = Array.from({ length: 150 }, () => ({ x: Math.random() * 1.25, y: Math.random(), v: 0.8 + Math.random() * 0.7, l: Math.random() }));
    const droplets: Droplet[] = [];
    const ripples: Ripple[] = [];
    const spawn = (x: number, y: number, n: number, up: number) => {
      for (let i = 0; i < n && droplets.length < 160; i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
        const sp = up * (0.5 + Math.random() * 0.8);
        droplets.push({ x: x + (Math.random() - 0.5) * 14, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, age: 0, life: 0.45 + Math.random() * 0.4, r: 1.4 + Math.random() * 2.4 });
      }
    };
    sharedRef.current.splash = (nx, ny, n) => spawn(nx * W, ny * H, Math.max(1, Math.round(n * k())), 230);

    const wave = (x: number, t: number, calm: boolean) =>
      calm ? Math.sin(x * 0.022 + t * 2.3) * 4 + Math.sin(x * 0.053 + t * 3.6) * 2 : Math.sin(x * 0.02 + t * 2.7) * 5 + Math.sin(x * 0.047 - t * 3.4) * 3;

    let t = 0;
    let wasDeep = false;
    let last = sceneNow();
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      // SCN-1: held — the flood waits (the canvas keeps its last frame)
      if (sceneHeld()) return;
      const now = sceneNow();
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      t += dt;
      const sh = sharedRef.current;
      const calm = sh.catching;
      let gush = 0;
      sh.open.forEach((o, i) => (gush += o * (sh.mul[i] ?? 1)));
      level = calm ? level + (CALM_LEVEL - level) * Math.min(1, dt * 1.2) : Math.min(LEVEL_MAX, level + FLOOD_RATE * gush * dt);
      // «до затопления N с»: the level integrator's own forecast, never longer than the time left
      if (sh.eta && !calm) {
        const left = Math.max(0, sh.endsAt - useGame.getState().game.time);
        const flood = gush > 0.01 ? (LEVEL_MAX - level) / (FLOOD_RATE * gush) : Infinity;
        const n = Math.ceil(Math.max(0, Math.min(left, flood)));
        const txt = level >= LEVEL_MAX - 1e-3 ? "затопило!" : `${n} с`;
        if (sh.eta.textContent !== txt) sh.eta.textContent = txt;
      }
      const deep = !calm && level > DIM_LEVEL;
      if (deep !== wasDeep) {
        wasDeep = deep;
        if (sh.dim) sh.dim.style.opacity = deep ? "0.35" : "0";
        if (deep) sfxCue("bubbles");
      }
      const sy = H * (1 - level);
      const top = H * GRATE_Y;

      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);

      // rain streaks (lighter once the storm passes, and with reduced motion); the rest fall unseen
      const count = Math.round(drops.length * k() * (calm ? 0.4 : 1));
      g.strokeStyle = "rgba(190,215,228,.36)";
      g.lineWidth = 1.2;
      g.beginPath();
      for (let i = 0; i < drops.length; i++) {
        const d = drops[i];
        d.y += ((620 + 380 * d.v) * dt) / Math.max(1, H - top);
        const py = top + d.y * (H - top);
        const px = d.x * W - (py - top) * 0.17;
        if (py >= sy + wave(px, t, calm) - 2) {
          if (i < count && ripples.length < 36 && Math.random() < 0.3) ripples.push({ x: px, age: 0, life: 0.5 + Math.random() * 0.3 });
          d.y = 0;
          d.x = Math.random() * 1.25;
          continue;
        }
        if (i >= count) continue;
        const L = 12 + 12 * d.l;
        g.moveTo(px, py);
        g.lineTo(px + L * 0.17, py - L);
      }
      g.stroke();

      // outlets: gushing streams (or bubbles once the water drowned the pipe mouth)
      for (let i = 0; i < 3; i++) {
        const o = sh.open[i] ?? 0;
        if (o < 0.02) continue;
        const x = VALVE_X[i] * W;
        const y0 = OUTLET_Y * H;
        if (sy <= y0 + 4) {
          g.fillStyle = "rgba(210,235,235,.35)";
          for (let b = 0; b < 4; b++) {
            const age = (t * 1.6 + b * 0.25 + i * 0.13) % 1;
            g.beginPath();
            g.arc(x + Math.sin(t * 5 + b * 2) * 6, y0 - age * Math.max(10, y0 - sy), 1.5 + o * 2.5 * (1 - age), 0, Math.PI * 2);
            g.fill();
          }
          continue;
        }
        const w = (4 + 13 * o) * (0.55 + 0.45 * (sh.mul[i] ?? 1));
        const wob = Math.sin(t * 19 + i) * 1.4;
        const yb = sy + wave(x, t, calm);
        const grd = g.createLinearGradient(x - w, 0, x + w, 0);
        grd.addColorStop(0, "rgba(120,170,165,.25)");
        grd.addColorStop(0.5, "rgba(185,222,218,.7)");
        grd.addColorStop(1, "rgba(120,170,165,.25)");
        g.fillStyle = grd;
        g.beginPath();
        g.moveTo(x - w / 2, y0);
        g.lineTo(x + w / 2, y0);
        g.lineTo(x + (w / 2) * 1.4 + wob, yb);
        g.lineTo(x - (w / 2) * 1.4 + wob, yb);
        g.closePath();
        g.fill();
        g.strokeStyle = "rgba(240,252,252,.55)";
        g.lineWidth = 1;
        g.setLineDash([6, 11]);
        g.lineDashOffset = -t * 260;
        g.beginPath();
        g.moveTo(x - w * 0.18, y0);
        g.lineTo(x - w * 0.24 + wob, yb);
        g.moveTo(x + w * 0.16, y0);
        g.lineTo(x + w * 0.22 + wob, yb);
        g.stroke();
        g.setLineDash([]);
        g.fillStyle = "rgba(225,242,242,.35)";
        for (let f = 0; f < 4; f++) {
          g.beginPath();
          g.arc(x + Math.sin(t * 9 + f * 1.7) * w * 0.9, yb - 2 + Math.cos(t * 7 + f) * 2, 2.5 + o * 3, 0, Math.PI * 2);
          g.fill();
        }
        if (Math.random() < dt * 14 * o * k()) spawn(x, yb, 1, 160);
      }

      // the water body
      const grd = g.createLinearGradient(0, sy - 8, 0, H);
      grd.addColorStop(0, "rgba(84,146,140,.5)");
      grd.addColorStop(0.35, "rgba(36,72,70,.78)");
      grd.addColorStop(1, "rgba(10,24,24,.92)");
      g.fillStyle = grd;
      g.beginPath();
      g.moveTo(0, H);
      for (let x = 0; x <= W + 12; x += 12) g.lineTo(x, sy + wave(x, t, calm));
      g.lineTo(W, H);
      g.closePath();
      g.fill();
      g.strokeStyle = "rgba(205,238,230,.55)";
      g.lineWidth = 2;
      g.beginPath();
      for (let x = 0; x <= W + 12; x += 12) {
        const y = sy + wave(x, t, calm);
        if (x === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();

      // current streaks under the surface (right→left once the flotsam flows)
      g.strokeStyle = "rgba(200,235,228,.13)";
      g.lineWidth = 2;
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const span = W + 120;
        const speed = calm ? 70 + 30 * ((i * 37) % 5) : 18 * (i % 2 ? 1 : -1);
        const x = ((((i * 197) % span) - t * speed) % span + span) % span - 60;
        const y = sy + 14 + (i / 10) * (H - sy - 18);
        if (y > H) continue;
        const len = 22 + ((i * 53) % 34);
        g.moveTo(x, y);
        g.lineTo(x + len, y);
      }
      g.stroke();

      // rain rings on the surface
      g.strokeStyle = "rgba(210,238,238,.5)";
      g.lineWidth = 1;
      for (let i = ripples.length - 1; i >= 0; i--) {
        const r = ripples[i];
        r.age += dt;
        if (r.age >= r.life) {
          ripples.splice(i, 1);
          continue;
        }
        const q = r.age / r.life;
        g.globalAlpha = 1 - q;
        g.beginPath();
        g.ellipse(r.x, sy + wave(r.x, t, calm), 2 + q * 14, 1 + q * 4, 0, 0, Math.PI * 2);
        g.stroke();
      }
      g.globalAlpha = 1;

      // splash droplets
      g.fillStyle = "rgba(200,232,236,.85)";
      for (let i = droplets.length - 1; i >= 0; i--) {
        const p = droplets[i];
        p.age += dt;
        if (p.age >= p.life) {
          droplets.splice(i, 1);
          continue;
        }
        p.vy += 900 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        g.globalAlpha = 1 - p.age / p.life;
        g.beginPath();
        g.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
    };
    raf = requestAnimationFrame(loop);

    const sh = sharedRef.current;
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      sh.splash = null;
    };
  }, [sharedRef]);

  return <canvas ref={ref} className="pointer-events-none absolute inset-0 block h-full w-full" aria-hidden />;
}
