"use client";

/**
 * The coronation show itself (GDD 13.32), split from CoronationOverlay so its art, timeline and confetti load only
 * when a coronation opens (next/dynamic, SH-5): the express runs through the five zone bands collecting rats while
 * the bell strikes twelve, gears and buttons rain down, then the King's portrait gets its crown and the line of
 * engine coronationLine() types itself. Reduced motion → a static tableau with the card shown at once.
 * v3 (SHL-2): the third and later coronations open straight on the finale card under three bells; «Полная
 * церемония ›» replays the whole ride.
 */
import { memo, useEffect, useId, useRef, useState } from "react";
import { sfx } from "@/audio/sfx";
import KingPortrait from "@/components/panels/KingPortrait";
import { HazardStyles, roman } from "@/components/scenes/HazardKit";
import { BrassButton, Rivets } from "@/components/ui/kit";
import { ZONE_ORDER, ZONES } from "@/game/data/zones";
import { coronationLine } from "@/game/engine/narrative";
import { useGame } from "@/game/store";
import { fmtInt, plural } from "@/lib/format";
import { BELLS, ringBells, shortCoronation, SHORT_BELLS } from "./coronationGate";

/** Seconds between bell strikes; keep in step with sfx.coronationBells(). */
const BELL_GAP = 0.9;
const BELL_START = 0.25;
const TRAIN_START = 0.6;
const BAND_TIME = 1.55;
const FINALE_AT = TRAIN_START + BAND_TIME * ZONE_ORDER.length + 0.25;
const RAT_SLOTS = [0.3, 0.52, 0.74];
const SEATS = 5;
const WAGONS = 3;

/* ================================================================ the show */

interface Burst {
  (x: number, y: number, n: number, speed: number): void;
}

export default function Celebration({ onClose }: { onClose: () => void }) {
  const reduced = useGame((s) => s.game.settings.reducedMotion);
  const rats = useGame((s) => s.game.rats);
  const tails = useGame((s) => 1 + s.game.meta.migrations);
  const gilded = useGame((s) => s.game.meta.achievements.before_noon !== undefined);
  // the line of this coronation, read once when the ceremony opens (SH-5)
  const [LINE] = useState(() => {
    const l = coronationLine(useGame.getState().game);
    return `${l.human} ${l.rat}`;
  });
  // a third and later coronation: the finale card at once, three bells; «Полная церемония ›» rides the whole way
  const [repeat] = useState(() => shortCoronation(useGame.getState().game.meta.coronations, window.location.search));
  const [ride, setRide] = useState(!repeat);
  const bells = ride ? BELLS : SHORT_BELLS;
  const [finale, setFinale] = useState(reduced || repeat);
  const [typed, setTyped] = useState(reduced ? LINE.length : 0);
  const showButton = typed >= LINE.length;
  const replay = () => {
    setRide(true);
    setFinale(false);
    setTyped(0);
    // the twelve bells from the first, in step with the ride (the short form's three may still be sounding)
    ringBells(BELLS, true);
  };

  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const trainRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLDivElement>(null);
  const ringHostRef = useRef<HTMLDivElement>(null);
  const strikeRef = useRef<HTMLSpanElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const burstRef = useRef<Burst | null>(null);

  // the timeline: train, boarding rats, bells, confetti (all imperative; no React state per frame)
  useEffect(() => {
    if (reduced) return;
    const root = rootRef.current;
    const stage = stageRef.current;
    const train = trainRef.current;
    const canvas = canvasRef.current;
    const g = canvas?.getContext("2d");
    if (!root || !stage || !train || !canvas || !g) return;

    let W = 1;
    let H = 1;
    let dpr = 1;
    let bands: { top: number; h: number }[] = [];
    let trainW = 1;
    let trainH = 1;
    const resize = () => {
      W = Math.max(1, root.clientWidth);
      H = Math.max(1, root.clientHeight);
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      bands = Array.from(stage.querySelectorAll<HTMLElement>("[data-band]")).map((el) => ({ top: el.offsetTop, h: el.offsetHeight }));
      trainW = train.offsetWidth;
      trainH = train.offsetHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    const ratEls = Array.from(stage.querySelectorAll<HTMLElement>("[data-rat]")).map((el) => ({ el, band: Number(el.dataset.rat), x: Number(el.dataset.x), gone: false }));
    const seats = Array.from(train.querySelectorAll<SVGGElement>("[data-seat]")).sort((a, b) => Number(a.dataset.seat) - Number(b.dataset.seat));
    let boarded = 0;

    /* confetti: pre-rendered gear and button sprites */
    const sprites = [...["#c9a25a", "#b8693d", "#a9b2b6", "#d4af37"].map((c) => gearSprite(c, 11)), ...["#e39ab0", "#9cc7cf", "#e6c27a", "#eadcc0"].map((c) => buttonSprite(c, 8))];
    interface Bit {
      img: HTMLCanvasElement;
      x: number;
      y: number;
      vx: number;
      vy: number;
      rot: number;
      vr: number;
      age: number;
      life: number;
      grav: number;
    }
    const bits: Bit[] = [];
    const add = (b: Omit<Bit, "img" | "age" | "rot" | "vr">) => {
      if (bits.length >= 200) return;
      bits.push({ ...b, img: sprites[Math.floor(Math.random() * sprites.length)], age: 0, rot: Math.random() * 6.3, vr: (Math.random() - 0.5) * 8 });
    };
    const rain = (n: number) => {
      for (let i = 0; i < n; i++) add({ x: Math.random() * W, y: -20 - Math.random() * 40, vx: (Math.random() - 0.5) * 60, vy: 50 + Math.random() * 110, life: 5 + Math.random() * 2, grav: 90 });
    };
    burstRef.current = (x, y, n, speed) => {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = speed * (0.4 + Math.random() * 0.8);
        add({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - speed * 0.4, life: 2.6 + Math.random() * 1.6, grav: 300 });
      }
    };

    const strike = (n: number) => {
      if (strikeRef.current) strikeRef.current.textContent = `${roman(n)} / ${roman(bells)}`;
      bellRef.current?.animate(
        [{ transform: "rotate(0)" }, { transform: "rotate(20deg)" }, { transform: "rotate(-14deg)" }, { transform: "rotate(7deg)" }, { transform: "rotate(0)" }],
        { duration: 760, easing: "ease-out" },
      );
      const host = ringHostRef.current;
      if (host) {
        const ring = document.createElement("span");
        ring.className = "pointer-events-none absolute inset-0 rounded-full border-2 border-gaslight";
        ring.style.animation = "rh-ring .9s ease-out forwards";
        host.appendChild(ring);
        window.setTimeout(() => ring.remove(), 950);
      }
      glowRef.current?.animate([{ opacity: 0.55 }, { opacity: 0 }], { duration: 700, easing: "ease-out" });
      rain(n === bells ? 26 : 9);
    };

    const t0 = performance.now();
    let last = t0;
    let next = 0;
    let raf = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      const t = (now - t0) / 1000;

      while (next < bells && t >= BELL_START + next * BELL_GAP) strike(++next);

      // the express: left→right through each band, tunnel to tunnel (the full ride only)
      const k = ride ? (t - TRAIN_START) / BAND_TIME : -1;
      const b = Math.floor(k);
      if (k >= 0 && b < bands.length) {
        const u = k - b;
        const front = -0.02 * W + u * (W * 1.04 + trainW);
        const band = bands[b];
        const y = band.top + band.h * 0.9 - trainH + 2;
        train.style.opacity = "1";
        train.style.transform = `translate(${(front - trainW).toFixed(1)}px,${y.toFixed(1)}px)`;
        for (const r of ratEls) {
          if (r.gone || r.band !== b || front < r.x * W + 6) continue;
          r.gone = true;
          r.el.animate(
            [
              { transform: "translateY(0) scale(1)", opacity: 1 },
              { transform: "translateY(-26px) scale(1.15)", opacity: 1, offset: 0.45 },
              { transform: "translateY(-6px) scale(.3)", opacity: 0 },
            ],
            { duration: 420, easing: "ease-out", fill: "forwards" },
          );
          const seat = seats[boarded++];
          if (seat) seat.style.opacity = "1";
          sfx.squeak();
        }
      } else if (b >= bands.length) {
        train.style.opacity = "0";
      }

      // confetti
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      for (let i = bits.length - 1; i >= 0; i--) {
        const p = bits[i];
        p.age += dt;
        p.vy += p.grav * dt;
        p.vx *= 1 - dt * 0.6;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        if (p.age >= p.life || p.y > H + 30) {
          bits.splice(i, 1);
          continue;
        }
        g.save();
        g.globalAlpha = Math.min(1, (p.life - p.age) * 2);
        g.translate(p.x, p.y);
        g.rotate(p.rot);
        g.drawImage(p.img, -p.img.width / 4, -p.img.height / 4, p.img.width / 2, p.img.height / 2);
        g.restore();
      }
    };
    raf = requestAnimationFrame(loop);
    const fin = ride ? window.setTimeout(() => setFinale(true), FINALE_AT * 1000) : 0;

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(fin);
      window.removeEventListener("resize", resize);
      burstRef.current = null;
    };
  }, [reduced, ride, bells]);

  // the card: a confetti burst, then the line types itself
  useEffect(() => {
    if (!finale || reduced) return;
    const card = cardRef.current?.getBoundingClientRect();
    const rr = rootRef.current?.getBoundingClientRect();
    if (card && rr) burstRef.current?.(card.left - rr.left + card.width / 2, card.top - rr.top + card.height * 0.3, 70, 520);
    let i = 0;
    const iv = window.setInterval(() => {
      i += 1;
      setTyped(i);
      if (i % 4 === 1) sfx.typewriter();
      if (i >= LINE.length) window.clearInterval(iv);
    }, 34);
    return () => window.clearInterval(iv);
  }, [finale, reduced, LINE.length]);

  useEffect(() => {
    if (!showButton) return;
    cardRef.current?.querySelector<HTMLButtonElement>("button[data-hail]")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showButton, onClose]);

  return (
    <div
      ref={rootRef}
      className="fixed inset-0 z-[60] flex flex-col overflow-hidden bg-soot/95 pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] pt-[env(safe-area-inset-top)] text-parchment"
      role="dialog"
      aria-modal="true"
      aria-label="Коронация Крысиного Короля"
      style={reduced ? undefined : { animation: "rh-reveal .4s ease-out both" }}
    >
      <HazardStyles />
      <div ref={glowRef} className="pointer-events-none absolute inset-0 z-30 opacity-0" style={{ background: "radial-gradient(ellipse at 50% 10%, rgba(242,184,75,.5), transparent 60%)" }} />

      {/* header: the bell and the strike counter */}
      <header className="relative z-20 flex shrink-0 items-center gap-2 border-b border-[#d4af37]/60 bg-gradient-to-b from-[#3b2c12] to-panel px-3 py-2 md:px-5">
        <div className="relative h-12 w-12 shrink-0">
          <div ref={ringHostRef} className="absolute inset-0" />
          <div ref={bellRef} className="absolute inset-0" style={{ transformOrigin: "50% 8%" }}>
            <BellArt />
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate bg-gradient-to-b from-[#fbe6a0] via-[#d4af37] to-[#8a6a1c] bg-clip-text font-display text-xl font-bold uppercase leading-none tracking-[0.1em] text-transparent sm:text-2xl sm:tracking-[0.18em] md:text-3xl">Коронация</h2>
          <p className="truncate text-[11px] text-parchment-dim md:text-xs">Крысиный экспресс собирает колонию по всем пяти зонам</p>
        </div>
        <span ref={strikeRef} className="shrink-0 font-mono text-xs font-bold text-gaslight tabular sm:text-sm" aria-live="off">
          {reduced ? `${roman(bells)} / ${roman(bells)}` : `— / ${roman(bells)}`}
        </span>
        {!finale && (
          <button type="button" className="ml-1 min-h-10 shrink-0 rounded-md border border-line px-2 text-xs text-parchment-dim hover:bg-panel-3" onClick={() => setFinale(true)}>
            Дальше ›
          </button>
        )}
      </header>

      {/* five zone bands with waiting rats */}
      <div ref={stageRef} className="relative z-0 flex min-h-0 flex-1 flex-col">
        {ZONE_ORDER.map((id, b) => {
          const z = ZONES[id];
          return (
            <div key={id} data-band={b} className="relative min-h-0 flex-1 overflow-hidden border-b border-black/60" style={{ background: `linear-gradient(180deg, ${z.palette.bg}, #0e0a08 140%)` }}>
              <div className="pointer-events-none absolute inset-0 opacity-60" style={{ background: `radial-gradient(ellipse at 50% 100%, ${z.palette.glow}22, transparent 70%)` }} />
              <span className="absolute left-[8%] top-1 font-display text-[11px] font-bold uppercase tracking-widest md:text-xs" style={{ color: z.palette.accent }}>
                {z.icon} {z.name}
              </span>
              <div className="absolute inset-x-0 bottom-[10%] h-[3px] bg-[#8a8a94]" />
              <div className="absolute inset-x-0 h-[5px]" style={{ bottom: "calc(10% - 5px)", background: "repeating-linear-gradient(90deg,#3a2e22 0 8px,transparent 8px 16px)" }} />
              <div className="absolute bottom-0 left-0 h-[78%] w-[6%] rounded-r-[999px] bg-black/75 shadow-[inset_-4px_0_8px_rgba(0,0,0,.6)]" />
              <div className="absolute bottom-0 right-0 h-[78%] w-[6%] rounded-l-[999px] bg-black/75 shadow-[inset_4px_0_8px_rgba(0,0,0,.6)]" />
              {!reduced &&
                RAT_SLOTS.map((x, i) => (
                  <span
                    key={x}
                    data-rat={b}
                    data-x={x + (i - 1) * 0.02 * ((b % 2) * 2 - 1)}
                    className="absolute bottom-[10%] -translate-x-1/2 text-lg leading-none md:text-xl"
                    style={{ left: `${(x + (i - 1) * 0.02 * ((b % 2) * 2 - 1)) * 100}%` }}
                  >
                    🐀
                  </span>
                ))}
            </div>
          );
        })}
        <div
          ref={trainRef}
          className="pointer-events-none absolute left-0 top-0 z-10 flex items-end will-change-transform"
          style={
            reduced
              ? { height: "clamp(40px, min(9vh, 15vw), 80px)", left: "50%", bottom: "calc(2% + 2px)", top: "auto", transform: "translateX(-50%)" }
              : { height: "clamp(40px, min(9vh, 15vw), 80px)", opacity: 0 }
          }
        >
          <ExpressTrain spin={!reduced} filled={reduced} />
        </div>
      </div>

      {!reduced && <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 z-20 h-full w-full" aria-hidden />}

      {/* the finale card; short screens (a phone in landscape, SHL-3) lay it out wide: the portrait beside the words */}
      {finale && (
        <div className="absolute inset-0 z-40 flex overflow-y-auto bg-soot/55 p-4 short:p-2" style={reduced ? undefined : { animation: "rh-reveal .5s ease-out both" }}>
          <div
            ref={cardRef}
            className="relative m-auto w-full max-w-sm rounded-xl border-2 border-[#d4af37] bg-gradient-to-b from-[#3b2c12] via-panel-2 to-panel px-4 pb-4 pt-6 text-center shadow-[0_0_60px_rgba(212,175,55,.35),0_20px_40px_rgba(0,0,0,.7)] short:grid short:max-w-2xl short:grid-cols-[auto_minmax(0,1fr)] short:items-center short:gap-x-6 short:px-6 short:pb-3 short:pt-4"
          >
            <Rivets />
            {/* one line at 375 px: the paper's name joins from sm; the crown (-top-7) clears it by the wrapper's mt-8 */}
            <p className="whitespace-nowrap font-display text-[10px] uppercase tracking-[0.16em] text-brass short:col-span-2 sm:text-[11px] sm:tracking-[0.2em]">
              Экстренный выпуск<span className="max-sm:hidden"> · Крысиные Ведомости</span>
            </p>
            <div className="relative mx-auto mt-8 w-28 sm:w-36 short:w-24">
              <div className="absolute -top-7 left-1/2 z-10 w-14 -translate-x-1/2" style={reduced ? undefined : { animation: "rh-crown .9s cubic-bezier(.3,1.4,.5,1) .15s both" }}>
                <CrownArt />
              </div>
              <KingPortrait tails={tails} gilded={gilded} crowned={false} />
            </div>
            {/* the words: plain children of the card, or its second column on short screens */}
            <div className="contents short:flex short:min-w-0 short:flex-col short:items-center">
              <h2 className="mt-2 font-display text-2xl font-bold text-[#f3d77a] short:mt-0">Коронация свершилась!</h2>
              <p className="mt-2 min-h-[3.2em] font-display text-lg italic leading-snug text-parchment" aria-label={LINE}>
                «{LINE.slice(0, typed)}
                {typed < LINE.length && <span className="text-brass">▍</span>}
                {typed >= LINE.length && "»"}
              </p>
              <p className="mt-1 text-xs text-parchment-dim">На борту экспресса — вся колония: {fmtInt(rats)}&nbsp;{rats < 1000 ? plural(rats, "хвост", "хвоста", "хвостов") : "хвостов"}.</p>
              {showButton && (
                <BrassButton
                  data-hail
                  size="lg"
                  className="mt-4 min-h-12 w-full short:mt-3"
                  onClick={onClose}
                  style={reduced ? undefined : { animation: "rh-reveal .35s ease-out both" }}
                >
                  Да здравствует Крысиный Король!
                </BrassButton>
              )}
              {/* a repeat coronation: the whole ride on request (the card covers the header, so it lives here) */}
              {repeat && !ride && !reduced && (
                <button
                  type="button"
                  className="mt-2 inline-flex min-h-10 items-center rounded-md px-3 font-display text-sm text-brass-light underline decoration-brass-dark underline-offset-4 hover:bg-panel-3/60 hover:text-gaslight short:mt-1"
                  onClick={replay}
                >
                  Полная церемония ›
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ sprites */

function gearSprite(color: string, size: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  const s = size * 4;
  c.width = s;
  c.height = s;
  const g = c.getContext("2d");
  if (!g) return c;
  g.scale(2, 2);
  g.translate(size, size);
  const teeth = 8;
  const R = size * 0.95;
  const r = size * 0.72;
  g.beginPath();
  for (let i = 0; i < teeth; i++) {
    const a0 = (i / teeth) * Math.PI * 2;
    const a1 = ((i + 1) / teeth) * Math.PI * 2;
    const d = (a1 - a0) / 4;
    g.lineTo(Math.cos(a0) * r, Math.sin(a0) * r);
    g.lineTo(Math.cos(a0 + d) * R, Math.sin(a0 + d) * R);
    g.lineTo(Math.cos(a1 - d * 2) * R, Math.sin(a1 - d * 2) * R);
    g.lineTo(Math.cos(a1 - d) * r, Math.sin(a1 - d) * r);
  }
  g.closePath();
  g.moveTo(size * 0.3, 0);
  g.arc(0, 0, size * 0.3, 0, Math.PI * 2, true);
  g.fillStyle = color;
  g.fill("evenodd");
  g.strokeStyle = "rgba(0,0,0,.45)";
  g.lineWidth = 1;
  g.stroke();
  return c;
}

function buttonSprite(color: string, size: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  const s = size * 4;
  c.width = s;
  c.height = s;
  const g = c.getContext("2d");
  if (!g) return c;
  g.scale(2, 2);
  g.translate(size, size);
  g.beginPath();
  g.arc(0, 0, size * 0.92, 0, Math.PI * 2);
  g.fillStyle = color;
  g.fill();
  g.strokeStyle = "rgba(0,0,0,.35)";
  g.lineWidth = 1.2;
  g.beginPath();
  g.arc(0, 0, size * 0.7, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = "rgba(20,14,10,.7)";
  for (const [x, y] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]) {
    g.beginPath();
    g.arc(x * size * 0.22, y * size * 0.22, size * 0.12, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

/* ------------------------------------------------------------ art */

const BellArt = memo(function BellArt() {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  return (
    <svg viewBox="0 0 48 48" className="h-full w-full drop-shadow-[0_2px_4px_rgba(0,0,0,.6)]" aria-hidden>
      <defs>
        <linearGradient id={`${uid}g`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#8a6a1c" />
          <stop offset=".45" stopColor="#fbe6a0" />
          <stop offset="1" stopColor="#7d5f2c" />
        </linearGradient>
      </defs>
      <rect x="21" y="2" width="6" height="5" rx="2" fill="#7d5f2c" />
      <path d="M24 6 C14 6 12 16 12 24 C12 31 9 34 6 38 H42 C39 34 36 31 36 24 C36 16 34 6 24 6 Z" fill={`url(#${uid}g)`} stroke="#5e4520" strokeWidth="1" />
      <rect x="5" y="37" width="38" height="4" rx="2" fill="#c9a25a" stroke="#5e4520" strokeWidth=".8" />
      <circle cx="24" cy="44" r="3.4" fill="#5e4520" />
    </svg>
  );
});

const CrownArt = memo(function CrownArt() {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  return (
    <svg viewBox="0 0 64 44" className="block h-auto w-full drop-shadow-[0_3px_6px_rgba(0,0,0,.6)]" role="img" aria-label="Корона">
      <defs>
        <linearGradient id={`${uid}g`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fbe6a0" />
          <stop offset=".5" stopColor="#d4af37" />
          <stop offset="1" stopColor="#8a6a1c" />
        </linearGradient>
      </defs>
      <path d="M6 40 L3 10 L18 22 L32 2 L46 22 L61 10 L58 40 Z" fill={`url(#${uid}g)`} stroke="#5e4520" strokeWidth="1.4" strokeLinejoin="round" />
      <rect x="5" y="34" width="54" height="7" rx="2" fill="#b8902c" stroke="#5e4520" strokeWidth="1" />
      <circle cx="32" cy="27" r="4" fill="#c4453a" stroke="#5a1c17" />
      <circle cx="17" cy="30" r="2.6" fill="#4f9d8a" />
      <circle cx="47" cy="30" r="2.6" fill="#4f9d8a" />
      {[3, 32, 61].map((x, i) => (
        <circle key={x} cx={x} cy={i === 1 ? 3 : 10} r="2.6" fill="#fbe6a0" stroke="#8a6a1c" strokeWidth=".6" />
      ))}
    </svg>
  );
});

/** The assembled Rat Express: three sardine-tin wagons (seats fill as rats board) and a crowned kettle-boiler locomotive. */
/** A pocket-watch wheel; the hands spin while the express runs. */
function Wheel({ cx, cy, r, spin }: { cx: number; cy: number; r: number; spin: boolean }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill="#efe3c4" stroke="#c9a25a" strokeWidth={2.5} />
      <g style={spin ? { transformBox: "fill-box", transformOrigin: "center", animation: "rh-spin .55s linear infinite" } : undefined}>
        {[0, 90, 180, 270].map((a) => {
          const rad = (a * Math.PI) / 180;
          return <line key={a} x1={cx + Math.cos(rad) * (r - 4)} y1={cy + Math.sin(rad) * (r - 4)} x2={cx + Math.cos(rad) * (r - 1.5)} y2={cy + Math.sin(rad) * (r - 1.5)} stroke="#7d5f2c" strokeWidth={1.2} />;
        })}
        <line x1={cx} y1={cy} x2={cx} y2={cy - r * 0.62} stroke="#3b2a1a" strokeWidth={1.4} strokeLinecap="round" />
        <line x1={cx} y1={cy} x2={cx + r * 0.42} y2={cy + r * 0.2} stroke="#3b2a1a" strokeWidth={1.4} strokeLinecap="round" />
      </g>
      <circle cx={cx} cy={cy} r={1.8} fill="#3b2a1a" />
    </g>
  );
}

const ExpressTrain = memo(function ExpressTrain({ spin, filled }: { spin: boolean; filled: boolean }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const ids = { cu: `${uid}cu`, ag: `${uid}ag`, au: `${uid}au` };
  return (
    <>
      {Array.from({ length: WAGONS }, (_, w) => (
        <svg key={w} viewBox="0 0 110 110" className="block h-full w-auto" style={{ aspectRatio: "1 / 1" }} aria-hidden>
          <defs>
            <linearGradient id={`${ids.ag}${w}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#e4eaea" />
              <stop offset=".5" stopColor="#a9b2b6" />
              <stop offset="1" stopColor="#6b7378" />
            </linearGradient>
          </defs>
          <rect x={4} y={40} width={100} height={42} rx={8} fill={`url(#${ids.ag}${w})`} stroke="#4a5257" strokeWidth={1.5} />
          <rect x={10} y={46} width={88} height={18} rx={3} fill="#2a2420" />
          {Array.from({ length: SEATS }, (_, s) => {
            const x = 19 + s * 17.5;
            return (
              <g key={s} data-seat={(WAGONS - 1 - w) * SEATS + s} style={{ opacity: filled ? 1 : 0, transition: "opacity .2s" }}>
                <circle cx={x - 4} cy={50} r={3} fill="#9a8f84" />
                <circle cx={x - 4} cy={50} r={1.6} fill="#d79aa4" />
                <ellipse cx={x} cy={57} rx={6} ry={5.5} fill="#9a8f84" />
                <circle cx={x + 2} cy={56} r={1} fill="#14110f" />
                <circle cx={x + 6} cy={58} r={1} fill="#d79aa4" />
              </g>
            );
          })}
          <path d="M14 72 H96" stroke="#5e666b" strokeWidth={1.2} />
          <path d="M92 40 q8 -10 14 -2" stroke="#c9a25a" strokeWidth={2} fill="none" />
          <line x1={104} y1={80} x2={110} y2={80} stroke="#3b2a1a" strokeWidth={3} />
          <Wheel cx={30} cy={92} r={13} spin={spin} />
          <Wheel cx={80} cy={92} r={13} spin={spin} />
        </svg>
      ))}
      <svg viewBox="0 0 200 110" className="block h-full w-auto" style={{ aspectRatio: "200 / 110" }} aria-hidden>
        <defs>
          <linearGradient id={ids.cu} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#e8a476" />
            <stop offset=".45" stopColor="#b8693d" />
            <stop offset="1" stopColor="#6e3a1d" />
          </linearGradient>
          <linearGradient id={ids.au} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fbe6a0" />
            <stop offset=".5" stopColor="#d4af37" />
            <stop offset="1" stopColor="#8a6a1c" />
          </linearGradient>
        </defs>
        {/* steam */}
        {spin &&
          [0, 0.5, 1].map((d) => (
            <circle key={d} cx={152} cy={14} r={7} fill="#cfd6d6" opacity={0.8} style={{ transformBox: "fill-box", transformOrigin: "center", animation: `rh-puff 1.4s ease-out ${d}s infinite` }} />
          ))}
        <rect x={26} y={78} width={160} height={8} rx={2} fill="#3b2a1a" />
        {/* cab: a matchbox with the driver */}
        <rect x={28} y={26} width={58} height={52} rx={3} fill="#c4453a" stroke="#5a1c17" strokeWidth={1.2} />
        <rect x={36} y={34} width={30} height={20} rx={2} fill="#eadcc0" />
        <circle cx={52} cy={46} r={6} fill="#8d8378" />
        <circle cx={48} cy={40} r={2.6} fill="#8d8378" />
        <circle cx={55} cy={45} r={1} fill="#14110f" />
        <rect x={22} y={20} width={70} height={8} rx={3} fill="#7a3f20" />
        {/* the crown on the cab roof */}
        <path d="M44 20 L42 6 L50 13 L57 1 L64 13 L72 6 L70 20 Z" fill={`url(#${ids.au})`} stroke="#7d5f2c" strokeWidth={0.8} />
        <circle cx={57} cy={14} r={2.2} fill="#c4453a" />
        {/* kettle boiler with brass bands */}
        <rect x={84} y={40} width={90} height={38} rx={18} fill={`url(#${ids.cu})`} stroke="#5a2e17" strokeWidth={1} />
        {[104, 128, 152].map((x) => (
          <rect key={x} x={x} y={40} width={4} height={38} fill={`url(#${ids.au})`} />
        ))}
        <circle cx={174} cy={59} r={17} fill="#2a2420" stroke="#c9a25a" strokeWidth={2} />
        <circle cx={174} cy={59} r={6} fill="#c9a25a" />
        {/* thimble chimney */}
        <path d="M142 40 L144 20 L160 20 L162 40 Z" fill="#a9b2b6" stroke="#4a5257" strokeWidth={1} />
        <rect x={140} y={16} width={24} height={5} rx={2} fill="#c9a25a" />
        {/* candle-jar headlamp */}
        <rect x={184} y={36} width={10} height={12} rx={2} fill="rgba(234,220,192,.5)" stroke="#c9a25a" />
        <circle cx={189} cy={42} r={3} fill="#f2b84b" />
        <circle cx={189} cy={42} r={9} fill="#f2b84b" opacity={0.25} />
        {/* fork-tine cowcatcher */}
        <path d="M178 84 L198 100 M182 82 L200 94 M174 86 L192 104" stroke="#a9b2b6" strokeWidth={2} strokeLinecap="round" />
        <Wheel cx={56} cy={92} r={14} spin={spin} />
        <Wheel cx={98} cy={92} r={14} spin={spin} />
        <Wheel cx={140} cy={92} r={14} spin={spin} />
      </svg>
    </>
  );
});
