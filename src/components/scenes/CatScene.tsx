"use client";

/**
 * «Кот Мурзифер» close-up.
 * Warn: the whole colony wall becomes one gigantic amber eye whose slit pupil tracks the pointer and dilates;
 * the player hides or fights ({a:"choice"}); silence = the engine hides.
 * Taps: a striped paw creeps toward the huddled rats; every «БАЦ!» squashes it and knocks it back.
 * HP gone → {a:"taps", cleared:1} at once; time out → {a:"taps", cleared:0}.
 */
import { memo, useEffect, useId, useRef, useState, type RefObject } from "react";
import { sfx } from "@/audio/sfx";
import { Bar, cx } from "@/components/ui/kit";
import { fxBurst } from "@/components/fx/fxBus";
import { useGame } from "@/game/store";
import type { Scene } from "@/game/types";
import { fmt, fmtInt } from "@/lib/format";
import { catStakes, ChoiceButton, Countdown, flourish, HazardStyles, makeTapLimiter, useReduced, useTimeUp, type CatStakes } from "./HazardKit";
import { act, clamp, hash01, makeClock, shake } from "./sceneUtils";

export default function CatScene({ scene }: { scene: Scene }) {
  return (
    <div className="absolute inset-0 select-none overflow-hidden bg-[#140c07]">
      <HazardStyles />
      {scene.phase === "warn" && <CatWarn key={`w${scene.phaseStart}`} scene={scene} />}
      {scene.phase === "taps" && <CatFight key={`t${scene.phaseStart}`} scene={scene} />}
    </div>
  );
}

/* ================================================================ warn: the eye */

function CatWarn({ scene }: { scene: Scene }) {
  const reduced = useReduced();
  const [stakes] = useState<CatStakes>(() => catStakes(useGame.getState().game));
  const chosen = useRef(false);
  const hp = scene.taps?.hp ?? 15;
  const fightSec = scene.taps?.duration ?? 10;

  // the collar bell jingles, then a low «мрр»
  useEffect(() => {
    sfx.bell();
    const a = window.setTimeout(() => sfx.bell(), 230);
    const b = window.setTimeout(() => sfx.meow(), 1100);
    return () => {
      window.clearTimeout(a);
      window.clearTimeout(b);
    };
  }, []);

  const choose = (option: "hide" | "fight") => {
    if (chosen.current) return;
    chosen.current = true;
    act({ a: "choice", option });
  };

  return (
    <div className="absolute inset-0 flex flex-col">
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <CatEye reduced={reduced} />
        <div className="pointer-events-none absolute left-2 top-2 z-10">
          <Countdown endsAt={scene.phaseEnds} total={Math.max(0.1, scene.phaseEnds - scene.phaseStart)} label="Кот смотрит" warnAt={2} />
        </div>
        <p className="pointer-events-none absolute inset-x-0 bottom-2 z-10 px-3 text-center text-xs text-parchment drop-shadow-[0_1px_2px_#000]">
          Полосатый Ужас заглянул в нору. Без ответа колония спрячется сама.
        </p>
      </div>
      <div className="relative z-10 shrink-0 border-t border-line bg-gradient-to-b from-panel-2 to-soot p-2 shadow-[0_-8px_24px_rgba(0,0,0,.6)] md:p-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <ChoiceButton icon="🙈" title="Спрятаться" tone="ghost" sub="Без потерь и без награды" sub2="Подозрение 👁 −10" onClick={() => choose("hide")} />
          <ChoiceButton
            icon="🥊"
            title="Отбиться"
            tone="danger"
            sub={
              <>
                Лапа: {fmtInt(hp)} ударов за {fmtInt(fightSec)} с · победа: 📜 +{fmt(stakes.blueprints)} 🧀 +{fmt(stakes.cheese)}, 👁 −25
              </>
            }
            sub2={
              <>
                Провал: {fmtInt(stakes.scared)} крыс в испуге на 60 с, −5% 🧀
              </>
            }
            onClick={() => choose("fight")}
          />
        </div>
      </div>
    </div>
  );
}

const LENS = "M18 150 C110 34 290 34 382 150 C290 266 110 266 18 150 Z";

/** Iris fibres and fur flecks, generated once (deterministic). */
const FIBRES = (() => {
  let d = "";
  for (let i = 0; i < 56; i++) {
    const a = (i / 56) * Math.PI * 2 + hash01(i, 3) * 0.08;
    const r0 = 22 + hash01(i, 5) * 10;
    const r1 = 82 + hash01(i, 7) * 24;
    d += `M${(200 + Math.cos(a) * r0).toFixed(1)} ${(150 + Math.sin(a) * r0).toFixed(1)}L${(200 + Math.cos(a) * r1).toFixed(1)} ${(150 + Math.sin(a) * r1).toFixed(1)}`;
  }
  return d;
})();
const FUR = (() => {
  let d = "";
  for (let i = 0; i < 170; i++) {
    const x = hash01(i, 11) * 400;
    const y = hash01(i, 13) * 300;
    const dx = (x - 200) * 0.04;
    const dy = (y - 150) * 0.05 + 6;
    d += `M${x.toFixed(1)} ${y.toFixed(1)}l${dx.toFixed(1)} ${dy.toFixed(1)}`;
  }
  return d;
})();

const CatEye = memo(function CatEye({ reduced }: { reduced: boolean }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const id = { fur: `${uid}f`, iris: `${uid}i`, lens: `${uid}l`, shade: `${uid}s`, glow: `${uid}g` };
  const svgRef = useRef<SVGSVGElement>(null);
  const irisRef = useRef<SVGGElement>(null);
  const pupilRef = useRef<SVGEllipseElement>(null);

  useEffect(() => {
    const svg = svgRef.current;
    const iris = irisRef.current;
    const pupil = pupilRef.current;
    if (!svg || !iris || !pupil) return;
    let tx = 0;
    let ty = 0;
    let x = 0;
    let y = 0;
    let excite = 0.5;
    let lastMove = -1e9;
    let lastPX = -1;
    let lastPY = -1;
    let saccadeAt = 0;
    const onMove = (e: PointerEvent) => {
      const r = svg.getBoundingClientRect();
      const nx = (e.clientX - (r.left + r.width / 2)) / Math.max(1, r.width / 2);
      const ny = (e.clientY - (r.top + r.height / 2)) / Math.max(1, r.height / 2);
      tx = clamp(nx, -1, 1) * 44;
      ty = clamp(ny, -1, 1) * 18;
      if (lastPX >= 0) excite = Math.min(1.3, excite + Math.hypot(e.clientX - lastPX, e.clientY - lastPY) / 240);
      lastPX = e.clientX;
      lastPY = e.clientY;
      lastMove = performance.now();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerdown", onMove);
    const t0 = performance.now();
    let last = t0;
    let raf = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      const t = (now - t0) / 1000;
      // nobody moving? the cat glances around on its own
      if (now - lastMove > 1500 && now > saccadeAt) {
        tx = (Math.random() * 2 - 1) * 36;
        ty = (Math.random() * 2 - 1) * 12;
        excite = Math.min(1.3, excite + 0.25);
        saccadeAt = now + 600 + Math.random() * 900;
      }
      const k = Math.min(1, dt * 9);
      x += (tx - x) * k;
      y += (ty - y) * k;
      excite = Math.max(0, excite - dt * 0.55);
      const rx = 6 + 32 * Math.min(1, excite) + Math.sin(t * 1.9) * 1.4;
      iris.setAttribute("transform", `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
      pupil.setAttribute("rx", rx.toFixed(1));
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onMove);
    };
  }, []);

  return (
    <svg ref={svgRef} viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full" role="img" aria-label="Огромный кошачий глаз во всю стену">
      <defs>
        <radialGradient id={id.fur} cx="50%" cy="50%" r="75%">
          <stop offset="0" stopColor="#8a5428" />
          <stop offset=".55" stopColor="#4a2a14" />
          <stop offset="1" stopColor="#170c06" />
        </radialGradient>
        <radialGradient id={id.iris} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#fff2a8" />
          <stop offset=".28" stopColor="#ffd34d" />
          <stop offset=".62" stopColor="#f2a52a" />
          <stop offset=".86" stopColor="#c46a10" />
          <stop offset="1" stopColor="#5e2c05" />
        </radialGradient>
        <radialGradient id={id.glow} cx="50%" cy="50%" r="50%">
          <stop offset=".55" stopColor="#f2b84b" stopOpacity=".28" />
          <stop offset="1" stopColor="#f2b84b" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={id.shade} x1="0" y1="0" x2="0" y2="1">
          <stop offset=".18" stopColor="#000" stopOpacity=".7" />
          <stop offset=".42" stopColor="#000" stopOpacity="0" />
          <stop offset=".8" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity=".45" />
        </linearGradient>
        <clipPath id={id.lens}>
          <path d={LENS} />
        </clipPath>
      </defs>
      <rect width="400" height="300" fill={`url(#${id.fur})`} />
      <path d={FUR} stroke="#c88a4a" strokeWidth="1.3" strokeLinecap="round" opacity=".22" />
      <g stroke="#1d0f06" strokeWidth="13" strokeLinecap="round" fill="none" opacity=".8">
        <path d="M6 30 Q60 70 34 128" />
        <path d="M394 30 Q340 70 366 128" />
        <path d="M128 4 Q150 30 132 52" />
        <path d="M272 4 Q250 30 268 52" />
        <path d="M200 0 L200 34" />
        <path d="M8 262 Q64 236 74 296" />
        <path d="M392 262 Q336 236 326 296" />
        <path d="M168 300 Q184 272 176 252" />
        <path d="M232 300 Q216 272 224 252" />
      </g>
      <ellipse cx="200" cy="150" rx="230" ry="140" fill={`url(#${id.glow})`} style={reduced ? undefined : { animation: "rh-glow 1.8s ease-in-out infinite" }} />
      <g style={reduced ? undefined : { transformOrigin: "200px 150px", animation: "rh-open .55s cubic-bezier(.3,1.4,.5,1) both" }}>
        <path d={LENS} fill="#0d0703" />
        <g clipPath={`url(#${id.lens})`}>
          <rect width="400" height="300" fill="#b45f0e" />
          <g ref={irisRef}>
            <circle cx="200" cy="150" r="112" fill={`url(#${id.iris})`} />
            <path d={FIBRES} stroke="#9a520a" strokeWidth="1.3" opacity=".5" />
            <circle cx="200" cy="150" r="109" fill="none" stroke="#3e1d04" strokeWidth="6" opacity=".75" />
            <ellipse ref={pupilRef} cx="200" cy="150" rx="8" ry="100" fill="#050302" />
          </g>
          <rect width="400" height="300" fill={`url(#${id.shade})`} />
          {/* a gas-lit window reflected in the eye */}
          <g transform="translate(150 86) rotate(-8)" opacity=".8">
            <rect width="34" height="40" rx="4" fill="rgba(255,252,236,.9)" />
            <rect x="15.5" width="3" height="40" fill="rgba(90,45,10,.55)" />
            <rect y="18.5" width="34" height="3" fill="rgba(90,45,10,.55)" />
          </g>
          <ellipse cx="262" cy="204" rx="11" ry="6" fill="rgba(255,250,235,.3)" />
          {!reduced && <rect x="0" y="40" width="400" height="230" fill="#3a2010" style={{ transformOrigin: "200px 60px", animation: "rh-blink 3.6s ease-in-out 1.4s infinite" }} />}
        </g>
        <path d={LENS} fill="none" stroke="#100803" strokeWidth="10" />
        <path d={LENS} fill="none" stroke="#e8b84b" strokeWidth="1" opacity=".35" />
      </g>
    </svg>
  );
});

/* ================================================================ taps: the paw */

const BAC_WORDS = ["БАЦ!", "БАЦ!", "БАЦ!", "БУМ!", "ХРЯСЬ!", "ПО ЛАПЕ!"];

function CatFight({ scene }: { scene: Scene }) {
  const reduced = useReduced();
  const hp = Math.max(1, scene.taps?.hp ?? 15);
  const total = Math.max(0.1, scene.taps?.duration ?? scene.phaseEnds - scene.phaseStart);
  const [stakes] = useState<CatStakes>(() => catStakes(useGame.getState().game));
  const [hits, setHits] = useState(0);
  const [hint, setHint] = useState(true);
  const timeUp = useTimeUp(scene.phaseEnds);

  const rootRef = useRef<HTMLDivElement>(null);
  const pawRef = useRef<HTMLDivElement>(null);
  const fxRef = useRef<HTMLDivElement>(null);
  const panicRef = useRef<HTMLDivElement>(null);
  const physRef = useRef({ knock: 0, squash: 0, tipX: 0, tipY: 0 });
  const hitsRef = useRef(0);
  const sentRef = useRef(false);
  const limiterRef = useRef<(() => boolean) | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setHint(false), 1800);
    return () => window.clearTimeout(t);
  }, []);

  // the paw creeps in along a diagonal; knock-back and squash decay every frame
  useEffect(() => {
    const root = rootRef.current;
    const paw = pawRef.current;
    if (!root || !paw) return;
    let W = 1;
    let H = 1;
    let pw = 160;
    let ph = 1120;
    const resize = () => {
      W = Math.max(1, root.clientWidth);
      H = Math.max(1, root.clientHeight);
      pw = clamp(W * 0.34, 120, 250);
      ph = pw * 7;
      paw.style.width = `${pw}px`;
      paw.style.height = `${ph}px`;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(root);
    const clock = makeClock(scene.phaseStart);
    const phys = physRef.current;
    let last = performance.now();
    let raf = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      const t = clock();
      const k = clamp(t / total);
      phys.knock = Math.max(0, phys.knock - dt * 0.2);
      phys.squash = Math.max(0, phys.squash - dt * 5.5);
      const reach = clamp(0.2 + 0.62 * k - phys.knock, 0.04, 0.9);
      const sx0 = W * 0.86;
      const sy0 = -H * 0.14;
      const tx = W * 0.36;
      const ty = H * 0.8;
      const x = sx0 + (tx - sx0) * reach;
      const y = sy0 + (ty - sy0) * reach;
      phys.tipX = x;
      phys.tipY = y;
      const ang = Math.atan2(-(tx - sx0), ty - sy0) + (reduced ? 0 : Math.sin(t * 3.1) * 0.035);
      const q = reduced ? 0 : phys.squash;
      paw.style.transform = `translate(${(x - pw / 2).toFixed(1)}px,${(y - ph).toFixed(1)}px) rotate(${ang.toFixed(3)}rad) scale(${(1 + 0.14 * q).toFixed(3)},${(1 - 0.2 * q).toFixed(3)})`;
      if (panicRef.current) panicRef.current.style.opacity = reach > 0.62 ? "1" : "0";
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [scene.phaseStart, total, reduced]);

  // time is up: the cat wins
  useEffect(() => {
    if (!timeUp || sentRef.current) return;
    sentRef.current = true;
    sfx.meow();
    act({ a: "taps", cleared: 0 });
  }, [timeUp]);

  const hit = (clientX: number, clientY: number) => {
    if (sentRef.current) return;
    limiterRef.current ??= makeTapLimiter();
    if (!limiterRef.current()) return;
    const root = rootRef.current;
    const phys = physRef.current;
    hitsRef.current += 1;
    setHits(hitsRef.current);
    setHint(false);
    phys.squash = 1;
    phys.knock = Math.min(0.5, phys.knock + 0.06);
    sfx.bonk();
    shake(3, 130);
    if (root) {
      const r = root.getBoundingClientRect();
      spawnBac(fxRef.current, clientX - r.left, clientY - r.top, reduced);
    }
    fxBurst(clientX, clientY, "glint", 4);
    if (hitsRef.current >= hp) {
      // measure before the scene unmounts; the flourish lives on the global FxLayer
      sentRef.current = true;
      const r = root?.getBoundingClientRect();
      const px = r ? r.left + r.width / 2 : clientX;
      const py = r ? r.top + Math.max(60, phys.tipY - 60) : clientY;
      act({ a: "taps", cleared: 1 });
      flourish("ПО УСАМ!", px, py, "#f2b84b", Math.min(50, (r?.width ?? 400) / 7), "gold", 34);
    }
  };

  // keyboard: Space / Enter bonks the paw where it is
  const hitRef = useRef(hit);
  useEffect(() => {
    hitRef.current = hit;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.code === "Space" || e.key === "Enter") && !e.repeat) {
        e.preventDefault();
        const r = rootRef.current?.getBoundingClientRect();
        if (r) hitRef.current(r.left + physRef.current.tipX, r.top + physRef.current.tipY - 40);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const left = Math.max(0, hp - hits);
  return (
    <div
      ref={rootRef}
      className="absolute inset-0 cursor-crosshair overflow-hidden"
      style={{ touchAction: "manipulation" }}
      onPointerDown={(e) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        e.preventDefault();
        hit(e.clientX, e.clientY);
      }}
      role="button"
      tabIndex={0}
      aria-label={`Бить по лапе: осталось ${left} ударов`}
    >
      <BurrowWall />
      <div ref={pawRef} className="pointer-events-none absolute left-0 top-0 will-change-transform" style={{ transformOrigin: "50% 100%" }}>
        <PawArt />
      </div>
      <RatHuddle panicRef={panicRef} reduced={reduced} />
      <div ref={fxRef} className="pointer-events-none absolute inset-0 z-20" />

      <div className="pointer-events-none absolute inset-x-2 top-2 z-30 flex items-start gap-2">
        <Countdown endsAt={scene.phaseEnds} total={total} />
        <div className="min-w-0 flex-1 rounded-lg border border-danger/60 bg-soot/85 px-2.5 py-1.5 shadow-[0_4px_14px_rgba(0,0,0,.6)]">
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className="font-display text-sm font-bold uppercase tracking-wider text-danger-light">Прочность лапы</span>
            <span className="font-mono font-bold text-parchment tabular">
              {fmtInt(left)}/{fmtInt(hp)}
            </span>
          </div>
          <Bar value={left} max={hp} color="linear-gradient(90deg,#c4453a,#e8705f)" className="mt-1 h-2.5" />
        </div>
      </div>

      {hint && (
        <div className="pointer-events-none absolute inset-x-0 top-[38%] z-30 flex justify-center">
          <span
            className="rounded-lg border border-brass bg-soot/85 px-4 py-2 font-display text-2xl font-bold text-brass-light shadow-[0_6px_20px_rgba(0,0,0,.7)]"
            style={reduced ? undefined : { animation: "rh-hint 1s ease-in-out infinite" }}
          >
            Бей по лапе! Чаще!
          </span>
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-2 bottom-2 z-30 flex justify-center">
        <p className="max-w-lg rounded-lg border border-line bg-soot/85 px-3 py-1.5 text-center text-[11px] leading-snug text-parchment shadow-[0_6px_18px_rgba(0,0,0,.6)]">
          <span className="font-bold text-good">На кону:</span> 📜 +{fmt(stakes.blueprints)} · 🧀 +{fmt(stakes.cheese)} · 👁 −25
          <span className="mx-1 text-muted">|</span>
          <span className="font-bold text-danger-light">Провал:</span> {fmtInt(stakes.scared)} 🐀 в испуге, −{fmt(stakes.cheeseLoss)} 🧀 (5%)
        </p>
      </div>
    </div>
  );
}

/** «БАЦ!» comic burst at a point inside the fight layer (plain DOM, removed after the animation). */
function spawnBac(host: HTMLDivElement | null, x: number, y: number, reduced: boolean) {
  if (!host) return;
  const el = document.createElement("span");
  el.textContent = BAC_WORDS[Math.floor(Math.random() * BAC_WORDS.length)];
  el.className = "pointer-events-none absolute font-display font-black leading-none";
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.fontSize = `${28 + Math.random() * 12}px`;
  el.style.color = "#ffd34d";
  el.style.setProperty("-webkit-text-stroke", "1.5px #3a1d0e");
  el.style.textShadow = "0 3px 0 #7a3f20, 0 0 14px rgba(242,184,75,.6)";
  el.style.setProperty("--r", `${(Math.random() * 24 - 12).toFixed(1)}deg`);
  el.style.transform = "translate(-50%,-50%)";
  el.style.animation = reduced ? "none" : "rh-bac .62s ease-out forwards";
  host.appendChild(el);
  window.setTimeout(() => el.remove(), reduced ? 380 : 650);
}

/* ------------------------------------------------------------ art */

const BurrowWall = memo(function BurrowWall() {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at 40% 85%, #3a2416 0%, #20140c 45%, #0e0805 100%)" }} />
      <div className="absolute inset-0 opacity-40" style={{ background: "repeating-linear-gradient(170deg, transparent 0 22px, rgba(0,0,0,.35) 22px 24px)" }} />
      {/* the cat's face blocking the entrance up top */}
      <svg viewBox="0 0 400 120" preserveAspectRatio="xMidYMin slice" className="absolute inset-x-0 top-0 h-[26%] w-full">
        <path d="M0 0 H400 V40 Q300 118 200 112 Q100 118 0 40 Z" fill="#2a170b" />
        <path d="M60 18 Q120 70 140 40 M340 18 Q280 70 260 40" stroke="#120804" strokeWidth="10" fill="none" strokeLinecap="round" opacity=".7" />
        <g fill="#f2a52a">
          <path d="M120 52 Q150 30 180 52 Q150 72 120 52 Z" />
          <path d="M220 52 Q250 30 280 52 Q250 72 220 52 Z" />
        </g>
        <ellipse cx="150" cy="52" rx="3" ry="13" fill="#050302" />
        <ellipse cx="250" cy="52" rx="3" ry="13" fill="#050302" />
        <path d="M188 84 L212 84 L200 96 Z" fill="#c26a7a" />
        <g stroke="#d8cbb0" strokeWidth="1.4" opacity=".7">
          <path d="M180 96 L70 84 M180 100 L66 104 M220 96 L330 84 M220 100 L334 104" />
        </g>
      </svg>
    </div>
  );
});

/** The paw points straight down with the claw tips at the bottom centre; the arm is long enough to leave the screen. */
const PawArt = memo(function PawArt() {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const arm = `${uid}a`;
  const stripes = Array.from({ length: 17 }, (_, i) => 36 + i * 68);
  const toes: [number, number][] = [
    [54, 556],
    [84, 576],
    [116, 576],
    [146, 556],
  ];
  return (
    <svg viewBox="0 0 200 1400" preserveAspectRatio="xMidYMax meet" className="block h-full w-full overflow-visible" aria-hidden>
      <defs>
        <linearGradient id={arm} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#6e3810" />
          <stop offset=".3" stopColor="#d98a3a" />
          <stop offset=".55" stopColor="#e6a258" />
          <stop offset="1" stopColor="#5e2e0c" />
        </linearGradient>
      </defs>
      <path d="M40 0 H160 L158 1200 Q100 1222 42 1200 Z" fill={`url(#${arm})`} />
      {stripes.map((y) => (
        <path key={y} d={`M40 ${y} Q100 ${y + 26} 160 ${y - 6} L160 ${y + 14} Q100 ${y + 46} 40 ${y + 22} Z`} fill="#5e2e0c" opacity=".88" />
      ))}
      <g transform="translate(0 760)">
        <ellipse cx="100" cy="600" rx="80" ry="22" fill="#000" opacity=".25" />
        <path d="M26 428 Q14 520 58 566 Q100 600 142 566 Q186 520 174 428 Q100 450 26 428 Z" fill={`url(#${arm})`} stroke="#4a240a" strokeWidth="2" />
        <path d="M30 470 l-10 6 M28 500 l-11 3 M170 470 l10 6 M172 500 l11 3" stroke="#e6a258" strokeWidth="3" strokeLinecap="round" />
        <path d="M68 512 Q100 476 132 512 Q144 546 100 550 Q56 546 68 512 Z" fill="#e8899a" stroke="#a84c5e" strokeWidth="2" />
        {toes.map(([x, y]) => (
          <g key={x}>
            <path d={`M${x - 5} ${y + 10} Q${x - 1} ${y + 44} ${x + 3} ${y + 62} Q${x + 7} ${y + 42} ${x + 7} ${y + 10} Z`} fill="#f4ecd8" stroke="#8a7a5a" strokeWidth="1.2" />
            <ellipse cx={x} cy={y} rx="14" ry="15" fill="#e8899a" stroke="#a84c5e" strokeWidth="2" />
          </g>
        ))}
      </g>
    </svg>
  );
});

function RatHuddle({ panicRef, reduced }: { panicRef: RefObject<HTMLDivElement | null>; reduced: boolean }) {
  const rats = [0, 1, 2, 3, 4];
  return (
    <div className="pointer-events-none absolute bottom-[9%] left-[36%] z-10 -translate-x-1/2" aria-hidden>
      <div ref={panicRef} className="absolute -top-9 left-1/2 -translate-x-1/2 text-2xl opacity-0 transition-opacity duration-200">
        😱
      </div>
      <div className="flex items-end gap-0.5">
        {rats.map((i) => (
          <span
            key={i}
            className={cx("inline-block text-2xl leading-none md:text-3xl", i % 2 ? "-scale-x-100" : "")}
            style={reduced ? undefined : { animation: `rh-shiver ${0.16 + i * 0.03}s linear infinite` }}
          >
            🐀
          </span>
        ))}
      </div>
    </div>
  );
}
