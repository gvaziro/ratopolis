"use client";

/**
 * «Крысолов с дудочкой» close-up.
 * Warn: a cloaked piper plays on the street corner, notes drifting toward the grate; pay him off or break
 * the pipe ({a:"choice"}); silence = the engine pays.
 * Taps: `taps.count` notes ♪ wave toward the burrow (each flies 3.2 s); tap to pop them (confetti, a semitone
 * higher each time). A note that reaches the burrow lures a hypnotised rat away.
 * Done → {a:"taps", cleared: popped}; ≥ 80% wins (the scene ends early once the win is certain).
 */
import { memo, useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { sfx } from "@/audio/sfx";
import { sfxCue } from "@/game/fx";
import { cx } from "@/components/ui/kit";
import { fxBurst } from "@/components/fx/fxBus";
import { useGame } from "@/game/store";
import type { Scene } from "@/game/types";
import { fmt, fmtInt, plural } from "@/lib/format";
import { ChoiceButton, Countdown, flourish, HazardStyles, piperStakes, useReduced, useTimeUp, type PiperStakes } from "./HazardKit";
import { act, clamp, EMOJI_FONT, fonts, hash01, makeClock } from "./sceneUtils";

const FLY = 3.2; // seconds a note needs to reach the burrow
const WIN_SHARE = 0.8;

export default function RatcatcherScene({ scene }: { scene: Scene }) {
  return (
    <div className="absolute inset-0 select-none overflow-hidden bg-[#120d0a]">
      <HazardStyles />
      {scene.phase === "warn" && <PiperWarn key={`w${scene.phaseStart}`} scene={scene} />}
      {scene.phase === "taps" && <PiperFight key={`t${scene.phaseStart}`} scene={scene} />}
    </div>
  );
}

/* ================================================================ warn */

/** A hypnotic minor-pentatonic loop (semitones; null = rest). */
const TUNE: (number | null)[] = [0, 3, 5, 7, 5, 3, 0, null, 7, 10, 12, 10, 7, 5, 3, null];

const DRIFT = Array.from({ length: 7 }, (_, i) => ({
  glyph: ["♪", "♫", "♬"][i % 3],
  dx: -(140 + hash01(i, 1) * 160),
  dy: -50 + hash01(i, 2) * 150,
  rot: -30 + hash01(i, 3) * 60,
  dur: 2.6 + hash01(i, 4) * 1.4,
  delay: i * 0.45,
  size: 18 + hash01(i, 5) * 14,
}));

function PiperWarn({ scene }: { scene: Scene }) {
  const reduced = useReduced();
  const [stakes] = useState<PiperStakes>(() => piperStakes(useGame.getState().game));
  const canPay = useGame((s) => s.game.res.coins + 1e-6 >= stakes.payCoins && s.game.res.cheese + 1e-6 >= stakes.payCheese);
  const chosen = useRef(false);
  const count = scene.taps?.count ?? 24;
  const fightSec = scene.taps?.duration ?? 15;
  const needed = Math.ceil(WIN_SHARE * count - 1e-9);

  // the piper's tune loops while he waits
  useEffect(() => {
    let i = 0;
    const iv = window.setInterval(() => {
      const n = TUNE[i++ % TUNE.length];
      if (n !== null) sfx.pipe(n);
    }, 340);
    return () => window.clearInterval(iv);
  }, []);

  const choose = (option: "pay" | "fight") => {
    if (chosen.current) return;
    chosen.current = true;
    act({ a: "choice", option });
  };

  // SC-6: keys 1 / 2 pick the choices (the global hotkeys stand aside while a scene runs)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "1") choose("pay");
      else if (e.key === "2") choose("fight");
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="absolute inset-0 flex flex-col">
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <StreetCorner reduced={reduced} />
        <div className="absolute bottom-[4%] right-[3%] h-[78%] md:h-[92%]" style={{ aspectRatio: "200 / 360" }}>
          <Piper />
          {!reduced &&
            DRIFT.map((n, i) => (
              <span
                key={i}
                className="pointer-events-none absolute left-[3%] top-[50%] font-display font-bold text-gaslight drop-shadow-[0_0_6px_rgba(242,184,75,.8)]"
                style={
                  {
                    fontSize: n.size,
                    "--dx": `${n.dx}px`,
                    "--dy": `${n.dy}px`,
                    "--rot": `${n.rot}deg`,
                    animation: `rh-note ${n.dur}s ease-out ${n.delay}s infinite both`,
                  } as CSSProperties
                }
              >
                {n.glyph}
              </span>
            ))}
        </div>
        <div className="pointer-events-none absolute left-2 top-2 z-10">
          <Countdown endsAt={scene.phaseEnds} total={Math.max(0.1, scene.phaseEnds - scene.phaseStart)} label="Дудочник ждёт" warnAt={2} />
        </div>
        <p className="pointer-events-none absolute bottom-2 left-2 z-10 max-w-[58%] text-xs leading-snug text-parchment drop-shadow-[0_1px_2px_#000]">
          Подозрение людей дошло до предела. Без ответа колония откупится сама.
        </p>
      </div>
      <div className="relative z-10 shrink-0 border-t border-line bg-gradient-to-b from-panel-2 to-soot p-2 shadow-[0_-8px_24px_rgba(0,0,0,.6)] md:p-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <ChoiceButton
            icon="💰"
            title="Откупиться"
            tone="brass"
            hotkey="1"
            sub={
              <b>
                −{fmt(stakes.payCoins)} 🪙{stakes.payCheese > 0 && <> · −{fmt(stakes.payCheese)} 🧀</>} · 👁 → 40
              </b>
            }
            sub2={canPay ? "Дудочник уходит, хвосты целы" : <span className="font-bold text-[#7a1d16]">Не хватает: отдадим, что есть, 👁 → 60</span>}
            onClick={() => choose("pay")}
          />
          <ChoiceButton
            icon="🎵"
            title="Сломать дудку"
            tone="verdigris"
            hotkey="2"
            sub={
              <b>
                Лопнуть {fmtInt(needed)} из {fmtInt(count)} {plural(count, "ноты", "нот", "нот")} за {fmtInt(fightSec)} с
              </b>
            }
            sub2={
              <>
                🎵 👁→0 🪙+{fmt(stakes.winCoins)} 📜+{fmt(stakes.winBlueprints)} | провал: 👁→40, 🎶 крысы уйдут за дудкой
              </>
            }
            onClick={() => choose("fight")}
          />
        </div>
      </div>
    </div>
  );
}

const StreetCorner = memo(function StreetCorner({ reduced }: { reduced: boolean }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      <div className="absolute inset-0" style={{ background: "linear-gradient(180deg,#3d3630 0%,#6b5d48 38%,#9d8c6a 62%,#5b5446 100%)" }} />
      <svg className="absolute inset-x-0 bottom-[12%] h-[62%] w-full">
        <defs>
          <pattern id={`${uid}b`} width="44" height="20" patternUnits="userSpaceOnUse">
            <rect width="44" height="20" fill="#2e211a" />
            <rect x="1" y="1" width="42" height="8" rx="1" fill="#4a3226" />
            <rect x="-21" y="11" width="42" height="8" rx="1" fill="#443024" />
            <rect x="23" y="11" width="42" height="8" rx="1" fill="#443024" />
          </pattern>
          <linearGradient id={`${uid}v`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#000" stopOpacity=".55" />
            <stop offset=".5" stopColor="#000" stopOpacity="0" />
          </linearGradient>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${uid}b)`} />
        <rect width="100%" height="100%" fill={`url(#${uid}v)`} />
      </svg>
      {/* cobbles */}
      <div className="absolute inset-x-0 bottom-0 h-[12%]" style={{ background: "repeating-linear-gradient(90deg,#3a3029 0 26px,#2a221d 26px 28px), linear-gradient(#4a3f36,#2a221d)" }} />
      <div className="absolute inset-x-0 bottom-[12%] h-1 bg-black/50" />
      {/* street grate with rat eyes peering up */}
      <div className="absolute bottom-[3%] left-[14%] h-[6%] w-[22%] rounded-sm border border-black/70" style={{ background: "repeating-linear-gradient(90deg,#0b0807 0 5px,#3a3029 5px 9px)" }}>
        <span className="absolute left-[30%] top-1/2 h-1 w-1 -translate-y-1/2 rounded-full bg-gaslight shadow-[0_0_4px_#f2b84b]" />
        <span className="absolute left-[38%] top-1/2 h-1 w-1 -translate-y-1/2 rounded-full bg-gaslight shadow-[0_0_4px_#f2b84b]" />
        <span className="absolute left-[64%] top-1/2 h-1 w-1 -translate-y-1/2 rounded-full bg-gaslight shadow-[0_0_4px_#f2b84b]" />
        <span className="absolute left-[72%] top-1/2 h-1 w-1 -translate-y-1/2 rounded-full bg-gaslight shadow-[0_0_4px_#f2b84b]" />
      </div>
      {/* gas lamp */}
      <div className="absolute bottom-[12%] left-[6%] h-[64%] w-1.5 bg-gradient-to-r from-[#111] via-[#3a3430] to-[#111]" />
      <div className="absolute left-[6%] top-[18%] h-[11%] w-[min(9%,44px)] -translate-x-[40%] rounded-t-md border-2 border-[#1a1614] bg-gaslight/90 shadow-[0_0_30px_10px_rgba(242,184,75,.35)]" style={reduced ? undefined : { animation: "rh-flicker 4s linear infinite" }} />
    </div>
  );
});

/** The piper: stovepipe hat with a red feather, motley cloak, recorder pointing down-left (tip at 3% / 50%). */
const Piper = memo(function Piper({ className }: { className?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const clip = `${uid}c`;
  return (
    <svg viewBox="0 0 200 360" className={cx("block h-full w-full overflow-visible", className)} role="img" aria-label="Крысолов с дудочкой">
      <defs>
        <clipPath id={clip}>
          <path d="M100 140 Q62 200 44 336 L68 328 L84 344 L104 330 L124 346 L146 330 L172 340 Q160 220 134 142 Z" />
        </clipPath>
      </defs>
      {/* boots */}
      <path d="M78 336 L58 352 L92 354 L94 336 Z M122 336 L104 352 L138 354 L138 336 Z" fill="#0d0907" />
      {/* cloak, motley underneath the shadow */}
      <path d="M100 140 Q62 200 44 336 L68 328 L84 344 L104 330 L124 346 L146 330 L172 340 Q160 220 134 142 Z" fill="#17110d" />
      <g clipPath={`url(#${clip})`} opacity=".55">
        <path d="M40 140 L118 140 L80 360 L40 360 Z" fill="#6e2018" />
        <path d="M118 140 L180 140 L180 360 L80 360 Z" fill="#7a5a1a" />
        <path d="M30 250 L190 200 L190 214 L30 264 Z" fill="#17110d" opacity=".6" />
      </g>
      <path d="M134 142 Q160 220 172 340" stroke="rgba(242,184,75,.45)" strokeWidth="2" fill="none" />
      {/* arms reaching to the pipe */}
      <path d="M108 150 Q80 150 64 136 L70 128 Q86 140 112 140 Z" fill="#1d1511" />
      <path d="M118 158 Q86 176 50 152 L56 144 Q86 164 116 148 Z" fill="#1d1511" />
      {/* recorder */}
      <path d="M82 116 L88 122 L10 184 L3 177 Z" fill="#8a6a3a" stroke="#3b2a16" strokeWidth="1" />
      <g fill="#2a1d10">
        <circle cx="62" cy="139" r="1.6" />
        <circle cx="52" cy="147" r="1.6" />
        <circle cx="42" cy="155" r="1.6" />
        <circle cx="32" cy="163" r="1.6" />
      </g>
      <circle cx="58" cy="140" r="5" fill="#2a201a" />
      <circle cx="70" cy="130" r="5" fill="#2a201a" />
      {/* head in profile, long nose */}
      <path d="M98 88 Q84 96 80 110 L66 118 L82 122 Q86 140 106 142 Q128 140 130 112 Q128 92 112 86 Z" fill="#221a15" />
      <circle cx="96" cy="104" r="2" fill="#f2b84b" />
      {/* hat with feather */}
      <path d="M92 20 L134 14 L140 80 L90 84 Z" fill="#120d0a" />
      <path d="M90 70 L140 66 L140 76 L90 80 Z" fill="#6e2018" />
      <path d="M72 86 Q114 72 158 80 L160 88 Q114 80 70 94 Z" fill="#0e0a08" />
      <path d="M136 46 Q170 16 192 -4 Q176 34 140 60 Z" fill="#c4453a" />
      <path d="M140 56 Q168 28 188 2" stroke="#7a2620" strokeWidth="1" fill="none" />
    </svg>
  );
});

/* ================================================================ taps: notes */

interface Note {
  at: number;
  st: 0 | 1 | 2 | 3; // waiting, flying, popped, reached
  x: number;
  y: number;
  phase: number;
  bow: number;
  glyph: string;
}
interface Bit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  age: number;
  life: number;
  color: string;
  w: number;
}
interface PopRing {
  x: number;
  y: number;
  age: number;
}
interface Walker {
  x: number;
  y: number;
  age: number;
}

const STREET_Y = 0.3;
const PIPER_H = 0.27;
const PIPER_RIGHT = 0.05;
const BURROW = { x: 0.13, y: 0.86 };
const CONFETTI = ["#f2b84b", "#c4453a", "#7cc4b0", "#eadcc0", "#d98a5a", "#e39ab0"];

function PiperFight({ scene }: { scene: Scene }) {
  const reduced = useReduced();
  const count = Math.max(1, scene.taps?.count ?? 24);
  const dur = Math.max(FLY + 0.5, scene.taps?.duration ?? 15);
  const needed = Math.ceil(WIN_SHARE * count - 1e-9);
  const [popped, setPopped] = useState(0);
  const [reached, setReached] = useState(0);
  const timeUp = useTimeUp(scene.phaseEnds);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const finishRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
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

    const F = fonts();
    const k = reduced ? 0.3 : 1;
    const clock = makeClock(scene.phaseStart);
    const gap = count > 1 ? (dur - FLY) / (count - 1) : 0;
    const notes: Note[] = Array.from({ length: count }, (_, i) => ({
      at: i * gap,
      st: 0,
      x: 0,
      y: 0,
      phase: hash01(i, 17) * Math.PI * 2,
      bow: hash01(i, 29) - 0.5,
      glyph: i % 3 === 2 ? "♫" : "♪",
    }));
    const bits: Bit[] = [];
    const rings: PopRing[] = [];
    const walkers: Walker[] = [];
    let nPopped = 0;
    let nReached = 0;
    let done = false;
    let burrowHeat = 0;
    // SC-6: where the player aims (mouse hover, or a touch for a moment) — the nearest note gets a dashed hit ring
    const aim = { x: 0, y: 0, until: 0 };
    const beating = new Set<Note>();
    const hitR = () => Math.max(34, 0.075 * Math.min(W, H));

    const pipeTip = () => {
      const ph = PIPER_H * H;
      const pw = (ph * 200) / 360;
      return { x: W * (1 - PIPER_RIGHT) - pw + pw * 0.03, y: STREET_Y * H - ph + ph * 0.5 };
    };
    const place = (n: Note, u: number) => {
      const a = pipeTip();
      const bx = BURROW.x * W;
      const by = BURROW.y * H;
      const dx = bx - a.x;
      const dy = by - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const amp = 0.06 * Math.min(W, H) + 10;
      const env = Math.sin(Math.PI * u);
      const off = amp * Math.sin(Math.PI * 2 * 1.3 * u + n.phase) * Math.sqrt(Math.max(0, env)) + n.bow * 0.22 * len * env;
      n.x = a.x + dx * u + nx * off;
      n.y = a.y + dy * u + ny * off;
    };

    const finish = () => {
      if (done) return;
      done = true;
      // measure before the scene unmounts; flourishes live on the global FxLayer
      const r = canvas.getBoundingClientRect();
      const live = notes.filter((n) => n.st === 1).map((n) => ({ x: r.left + n.x, y: r.top + n.y }));
      act({ a: "taps", cleared: nPopped });
      const size = Math.min(40, W / 10);
      if (nPopped >= needed) {
        for (const p of live) fxBurst(p.x, p.y, "confetti", 10);
        flourish("ДУДКА СЛОМАНА!", r.left + W / 2, r.top + H * 0.3, "#f2b84b", size, "confetti", 40);
      } else {
        flourish("Дудочник увёл хвосты…", r.left + W / 2, r.top + H * 0.45, "#e8705f", size * 0.8, null);
      }
    };
    finishRef.current = finish;

    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      aim.x = e.clientX - r.left;
      aim.y = e.clientY - r.top;
      aim.until = performance.now() + (e.pointerType === "mouse" ? 1e9 : 350);
    };
    const onLeave = () => {
      aim.until = 0;
    };
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeave);
    const onDown = (e: PointerEvent) => {
      if (done || (e.pointerType === "mouse" && e.button !== 0)) return;
      e.preventDefault();
      onMove(e);
      const r = canvas.getBoundingClientRect();
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      const R = hitR();
      let best: Note | null = null;
      let bestD = R;
      for (const n of notes) {
        if (n.st !== 1) continue;
        const d = Math.hypot(n.x - px, n.y - py);
        if (d < bestD) {
          bestD = d;
          best = n;
        }
      }
      if (!best) return;
      best.st = 2;
      sfx.pipe(nPopped);
      nPopped++;
      setPopped(nPopped);
      rings.push({ x: best.x, y: best.y, age: 0 });
      const m = Math.round(22 * k);
      for (let i = 0; i < m && bits.length < 200; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 90 + Math.random() * 220;
        bits.push({
          x: best.x,
          y: best.y,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp - 90,
          rot: Math.random() * 6,
          vr: (Math.random() - 0.5) * 14,
          age: 0,
          life: 0.8 + Math.random() * 0.5,
          color: CONFETTI[i % CONFETTI.length],
          w: 3 + Math.random() * 4,
        });
      }
      if (nPopped >= needed) finish();
    };
    canvas.addEventListener("pointerdown", onDown);
    const offAim = () => {
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
    };

    let last = performance.now();
    let raf = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      const t = clock();

      // advance notes
      for (const n of notes) {
        if (n.st === 0 && t >= n.at) n.st = 1;
        if (n.st !== 1) continue;
        const u = (t - n.at) / FLY;
        // a note close to the burrow makes the colony's heart pound
        if (u > 0.8 && !beating.has(n)) {
          beating.add(n);
          sfxCue("heartbeat", { intensity: 0.7 });
        }
        if (u >= 1) {
          n.st = 3;
          nReached++;
          setReached(nReached);
          burrowHeat = 1;
          walkers.push({ x: BURROW.x * W + 14, y: H * 0.94, age: 0 });
          if (nReached % 2 === 1) sfx.squeak();
          continue;
        }
        place(n, u);
      }
      if (!done && (nPopped + nReached >= count || t >= dur + 0.15)) finish();

      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);

      // the burrow glows red when a note gets in
      burrowHeat = Math.max(0, burrowHeat - dt * 1.5);
      const bx = BURROW.x * W;
      const by = BURROW.y * H;
      const glow = g.createRadialGradient(bx, by, 4, bx, by, 70);
      glow.addColorStop(0, `rgba(${Math.round(242 - 40 * burrowHeat)},${Math.round(184 - 120 * burrowHeat)},75,${0.18 + 0.35 * burrowHeat})`);
      glow.addColorStop(1, "rgba(242,184,75,0)");
      g.fillStyle = glow;
      g.fillRect(bx - 80, by - 80, 160, 160);

      // the dotted trail of the tune
      const tip = pipeTip();
      g.setLineDash([2, 9]);
      g.strokeStyle = "rgba(242,184,75,.18)";
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(tip.x, tip.y);
      g.lineTo(bx, by);
      g.stroke();
      g.setLineDash([]);

      // hypnotised rats trailing off toward the piper
      for (let i = walkers.length - 1; i >= 0; i--) {
        const w = walkers[i];
        w.age += dt;
        w.x += 70 * dt;
        if (w.x > W + 30 || w.age > 6) {
          walkers.splice(i, 1);
          continue;
        }
        g.globalAlpha = Math.min(1, w.age * 3) * clamp((W + 30 - w.x) / 80);
        drawRat(g, w.x, w.y + Math.sin(w.age * 9) * 1.2, 1, w.age);
        g.font = `14px ${F.display}`;
        g.fillStyle = "#f2b84b";
        g.fillText("♪", w.x + 4, w.y - 18 + Math.sin(w.age * 5) * 3);
      }
      g.globalAlpha = 1;

      // the aimed note's hit ring
      if (performance.now() < aim.until) {
        const R = hitR();
        let best: Note | null = null;
        let bestD = R * 2;
        for (const n of notes) {
          if (n.st !== 1) continue;
          const d = Math.hypot(n.x - aim.x, n.y - aim.y);
          if (d < bestD) {
            bestD = d;
            best = n;
          }
        }
        if (best) {
          g.setLineDash([5, 5]);
          g.strokeStyle = bestD <= R ? "rgba(124,196,176,.9)" : "rgba(242,184,75,.45)";
          g.lineWidth = 2;
          g.beginPath();
          g.arc(best.x, best.y, R, 0, Math.PI * 2);
          g.stroke();
          g.setLineDash([]);
        }
      }

      // notes
      g.textAlign = "center";
      g.textBaseline = "middle";
      for (const n of notes) {
        if (n.st !== 1) continue;
        const u = (t - n.at) / FLY;
        const size = 28 + Math.sin(u * Math.PI) * 8;
        g.save();
        g.translate(n.x, n.y);
        g.rotate(Math.sin(t * 4 + n.phase) * 0.25);
        g.font = `bold ${size.toFixed(0)}px ${F.display}, ${EMOJI_FONT}`;
        g.shadowColor = u > 0.75 ? "rgba(232,112,95,.95)" : "rgba(242,184,75,.9)";
        g.shadowBlur = 12;
        g.lineWidth = 3;
        g.strokeStyle = "rgba(20,12,8,.85)";
        g.strokeText(n.glyph, 0, 0);
        g.fillStyle = u > 0.75 ? "#e8705f" : "#f7d27a";
        g.fillText(n.glyph, 0, 0);
        g.restore();
      }

      // pop rings
      g.strokeStyle = "#f2b84b";
      for (let i = rings.length - 1; i >= 0; i--) {
        const r = rings[i];
        r.age += dt;
        if (r.age > 0.35) {
          rings.splice(i, 1);
          continue;
        }
        const q = r.age / 0.35;
        g.globalAlpha = 1 - q;
        g.lineWidth = 3 * (1 - q) + 1;
        g.beginPath();
        g.arc(r.x, r.y, 8 + q * 30, 0, Math.PI * 2);
        g.stroke();
      }
      g.globalAlpha = 1;

      // confetti
      for (let i = bits.length - 1; i >= 0; i--) {
        const b = bits[i];
        b.age += dt;
        if (b.age >= b.life) {
          bits.splice(i, 1);
          continue;
        }
        b.vy += 420 * dt;
        b.vx *= 1 - dt * 1.5;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.rot += b.vr * dt;
        g.save();
        g.globalAlpha = 1 - b.age / b.life;
        g.translate(b.x, b.y);
        g.rotate(b.rot);
        g.fillStyle = b.color;
        g.fillRect(-b.w / 2, -b.w * 0.3, b.w, b.w * 0.6);
        g.restore();
      }
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      offAim();
      finishRef.current = null;
    };
  }, [scene.phaseStart, count, dur, needed, reduced]);

  // the engine clock ran out first (tab hiccup): report what we have
  useEffect(() => {
    if (timeUp) finishRef.current?.();
  }, [timeUp]);

  const spare = count - needed - reached;
  const won = popped >= needed;
  return (
    <div className="absolute inset-0 overflow-hidden" style={{ touchAction: "manipulation" }}>
      <UndergroundBackdrop />
      <div className="pointer-events-none absolute" style={{ right: `${PIPER_RIGHT * 100}%`, top: `${(STREET_Y - PIPER_H) * 100}%`, height: `${PIPER_H * 100}%`, aspectRatio: "200 / 360" }}>
        <Piper />
      </div>
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full cursor-pointer touch-none" aria-label="Лопайте ноты: жмите по каждой ♪, пока она не долетела до норы" />

      <div className="pointer-events-none absolute left-2 top-2 z-10 flex w-[min(64%,440px)] items-start gap-2">
        <Countdown endsAt={scene.phaseEnds} total={Math.max(0.1, scene.phaseEnds - scene.phaseStart)} />
        <div className="min-w-0 flex-1 rounded-lg border border-brass-dark bg-soot/85 px-2.5 py-1.5 shadow-[0_4px_14px_rgba(0,0,0,.6)]">
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className="font-display text-sm font-bold uppercase tracking-wider text-brass-light">Лопнуто нот</span>
            <span className={cx("font-mono font-bold tabular", won ? "text-good" : "text-parchment")}>
              {fmtInt(popped)}/{fmtInt(count)}
            </span>
          </div>
          <ThresholdBar popped={popped} reached={reached} count={count} needed={needed} />
          <p className={cx("mt-1 text-[11px] leading-tight", spare < 0 ? "text-danger-light" : "text-parchment-dim")}>
            {won
              ? "Дудка трещит по швам!"
              : spare >= 0
                ? `Нужно ${fmtInt(needed)} · можно упустить ещё ${fmtInt(spare)}`
                : "Дудку уже не сломать — спасайте хвосты: каждая нота уводит крысу"}
          </p>
        </div>
      </div>
    </div>
  );
}

function ThresholdBar({ popped, reached, count, needed }: { popped: number; reached: number; count: number; needed: number }) {
  const mark = (needed / count) * 100;
  return (
    <div className="relative mt-1 h-2.5 rounded-full bg-black/50 shadow-[inset_0_1px_2px_rgba(0,0,0,.6)]">
      <div
        className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-150"
        style={{ width: `${(popped / count) * 100}%`, background: popped >= needed ? "var(--good)" : "linear-gradient(90deg,var(--brass-dark),var(--brass-light))" }}
      />
      <div className="absolute inset-y-0 right-0 rounded-r-full bg-danger/70 transition-[width] duration-150" style={{ width: `${(reached / count) * 100}%` }} />
      <div className="absolute -inset-y-1 w-0.5 bg-parchment shadow-[0_0_4px_#000]" style={{ left: `${mark}%` }} />
    </div>
  );
}

const UndergroundBackdrop = memo(function UndergroundBackdrop() {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      {/* street */}
      <div className="absolute inset-x-0 top-0" style={{ height: `${STREET_Y * 100}%`, background: "linear-gradient(180deg,#4a4038,#8d7c5e 70%,#5b5446)" }} />
      <div className="absolute inset-x-0" style={{ top: `${(STREET_Y - 0.03) * 100}%`, height: "3%", background: "repeating-linear-gradient(90deg,#3a3029 0 22px,#221b16 22px 24px)" }} />
      {/* earth cross-section */}
      <div
        className="absolute inset-x-0 bottom-0"
        style={{ top: `${STREET_Y * 100}%`, background: "radial-gradient(ellipse at 15% 90%, #3a2618 0%, #23170f 40%, #120c08 100%)" }}
      />
      <div className="absolute inset-x-0 bottom-0 opacity-30" style={{ top: `${STREET_Y * 100}%`, background: "repeating-linear-gradient(175deg, transparent 0 30px, rgba(0,0,0,.4) 30px 32px)" }} />
      {/* the burrow mouth */}
      <div
        className="absolute h-[16%] w-[26%] -translate-x-1/2 -translate-y-1/2 rounded-[50%] shadow-[inset_0_10px_24px_rgba(0,0,0,.9)]"
        style={{ left: `${BURROW.x * 100}%`, top: `${BURROW.y * 100}%`, background: "radial-gradient(ellipse at 50% 60%, #000 40%, #1a110b 75%, #3a2618 100%)" }}
      >
        <span className="absolute left-[38%] top-[48%] h-1 w-1 rounded-full bg-gaslight" />
        <span className="absolute left-[46%] top-[48%] h-1 w-1 rounded-full bg-gaslight" />
      </div>
      <div className="absolute inset-x-0 h-[6%]" style={{ top: "94%", background: "linear-gradient(#2e1f14,#1a110b)" }} />
    </div>
  );
});

/** A tiny walking rat (canvas), facing right. */
function drawRat(g: CanvasRenderingContext2D, x: number, y: number, s: number, t: number) {
  g.save();
  g.translate(x, y);
  g.scale(s, s);
  g.strokeStyle = "#9a8f84";
  g.lineWidth = 1.8;
  g.beginPath();
  g.moveTo(-10, -3);
  g.quadraticCurveTo(-22, -2 + Math.sin(t * 8) * 3, -28, -9);
  g.stroke();
  g.fillStyle = "#7d7268";
  g.beginPath();
  g.ellipse(0, -6, 11, 6.5, 0, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.ellipse(11, -8, 6, 4.5, 0.25, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#d79aa4";
  g.beginPath();
  g.arc(8, -12, 2.6, 0, Math.PI * 2);
  g.arc(17, -7, 1.2, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#f2b84b";
  g.beginPath();
  g.arc(13, -9, 1.3, 0, Math.PI * 2);
  g.fill();
  const a = Math.sin(t * 14) * 3;
  g.strokeStyle = "#5e554d";
  g.lineWidth = 1.6;
  g.beginPath();
  g.moveTo(-5, -1);
  g.lineTo(-5 + a, 3);
  g.moveTo(5, -1);
  g.lineTo(5 - a, 3);
  g.stroke();
  g.restore();
}
