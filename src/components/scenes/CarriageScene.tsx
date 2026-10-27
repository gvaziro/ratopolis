"use client";

/**
 * «Экипаж над решёткой»: a cab rolls over the street grate (its wheel's shadow sweeps the light shafts
 * left→right, hooves clop ahead) and loot tumbles through the bars — the catch tutorial before trains.
 * v3 SCN-4: the first carriage (scene.tutorial) opens with a 'warn' phase — the cab walks in and pulls up over the
 * grate, the horse stamping, its shadow and the hooves sweeping the light shafts, under «Цок-цок… Экипаж над
 * решёткой!» — and its «Лови! Зажми и веди!» stays up until the first catch. The hooves are hooves (sfxCue3 'hoof',
 * the voice alternates fore and hind), and the coachman's «Но-о!» sends each cab off.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { sfx } from "@/audio/sfx";
import { sfxCue3 } from "@/game/fx";
import { useGame } from "@/game/store";
import type { CatchResult, Scene } from "@/game/types";
import { humanClock } from "@/game/engine/formulas";
import { CatchCanvasCore } from "./CatchCanvas";
import { UpstairsInset } from "./UpstairsInset";
import { act, carriageShadowX, clamp, easeOutCubic, fallGeom, lerp, makeClock, sceneHeld, shake } from "./sceneUtils";

const TAU = Math.PI * 2;
/** The horse walks this far (share of the width) ahead of the cab's wheel. */
const HOOF_LEAD = 0.55;
/** Seconds between two hoof beats: a trot in the pass, a stamp while the cab stands. */
const TROT_S = 0.37;
const STAMP_S = 0.46;

/**
 * The grate's light shafts, the cab's shadow and wheel at `sx` (the wheel's centre), the horse's hooves HOOF_LEAD ahead
 * of it, the iron bars. `t` lifts the hooves.
 */
function paintCarriage(g: CanvasRenderingContext2D, w: number, h: number, t: number, sx = carriageShadowX(t, w)) {
  const G = fallGeom(w, h);
  const sw = Math.max(60, w * 0.13);
  const hx0 = sx + w * HOOF_LEAD;

  // light shafts from each slot of the grate, dimmed where the wheel's shadow (and the horse's) falls
  g.save();
  g.globalCompositeOperation = "lighter";
  for (let k = 0; k < G.slots; k++) {
    const x0 = G.x0 + k * G.slotW + 4;
    const x1 = x0 + G.slotW - 8;
    const cx = (x0 + x1) / 2;
    const horse = 1 - 0.55 * Math.exp(-Math.pow((cx - (hx0 + w * 0.03)) / (w * 0.09), 2));
    const shade = (1 - 0.88 * Math.exp(-Math.pow((cx - sx) / (sw * 1.2), 2))) * horse;
    const gr = g.createLinearGradient(0, G.grateY, 0, G.floorY);
    gr.addColorStop(0, `rgba(255,240,205,${0.17 * shade})`);
    gr.addColorStop(1, "rgba(255,240,205,0)");
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(x0, G.grateY);
    g.lineTo(x1, G.grateY);
    g.lineTo(x1 + G.slotW * 0.45, G.floorY);
    g.lineTo(x0 + G.slotW * 0.25, G.floorY);
    g.closePath();
    g.fill();
    const pool = g.createRadialGradient(cx + G.slotW * 0.35, G.floorY, 0, cx + G.slotW * 0.35, G.floorY, G.slotW * 0.9);
    pool.addColorStop(0, `rgba(255,235,190,${0.12 * shade})`);
    pool.addColorStop(1, "rgba(255,235,190,0)");
    g.fillStyle = pool;
    g.fillRect(cx - G.slotW * 0.6, G.floorY - G.slotW * 0.5, G.slotW * 1.9, G.slotW);
  }
  g.restore();

  // what we see through the grate: the cab's shadow, its wheel and the horse's hooves
  g.save();
  g.beginPath();
  g.rect(G.x0, 0, G.x1 - G.x0, G.grateY);
  g.clip();
  g.fillStyle = "rgba(14,10,8,.5)";
  g.fillRect(sx - w * 0.3, 0, w * 0.48, G.grateY);
  const R = Math.max(G.grateY * 1.3, w * 0.07);
  const cy = G.grateY * 0.55 - R * 0.75;
  // the wheel turns by the distance rolled (the pass's shadow starts at −0.25 w)
  const th = (sx + w * 0.25) / R;
  g.fillStyle = "rgba(10,8,6,.85)";
  g.beginPath();
  g.arc(sx, cy, R, 0, TAU);
  g.fill();
  g.strokeStyle = "rgba(120,110,95,.45)";
  g.lineWidth = 2;
  g.beginPath();
  for (let k = 0; k < 12; k++) {
    const a = th + (k * TAU) / 12;
    g.moveTo(sx + Math.cos(a) * R * 0.15, cy + Math.sin(a) * R * 0.15);
    g.lineTo(sx + Math.cos(a) * R * 0.85, cy + Math.sin(a) * R * 0.85);
  }
  g.stroke();
  g.strokeStyle = "rgba(60,52,44,.9)";
  g.lineWidth = Math.max(3, R * 0.1);
  g.beginPath();
  g.arc(sx, cy, R * 0.93, 0, TAU);
  g.stroke();
  // the horse: its belly's shadow and two hooves striking the cobbles
  g.fillStyle = "rgba(12,9,7,.42)";
  g.beginPath();
  g.ellipse(hx0 + w * 0.03, G.grateY * 0.2, w * 0.1, G.grateY * 0.3, 0, 0, TAU);
  g.fill();
  for (let k = 0; k < 2; k++) {
    const hx = hx0 + w * k * 0.06;
    const lift = Math.max(0, Math.sin(t * 8.5 + k * Math.PI)) * G.grateY * 0.35;
    g.fillStyle = "rgba(12,9,7,.8)";
    g.beginPath();
    g.ellipse(hx, G.grateY * 0.75 - lift, w * 0.018, G.grateY * 0.16, 0, 0, TAU);
    g.fill();
  }
  g.restore();

  // the iron grate itself
  const bar = Math.max(5, G.slotW * 0.14);
  const ig = g.createLinearGradient(0, 0, bar, 0);
  ig.addColorStop(0, "#1b1714");
  ig.addColorStop(0.45, "#5c5248");
  ig.addColorStop(1, "#16120f");
  for (let k = 0; k <= G.slots; k++) {
    const x = G.x0 + k * G.slotW;
    g.save();
    g.translate(x - bar / 2, 0);
    g.fillStyle = ig;
    g.fillRect(0, 0, bar, G.grateY + 2);
    g.restore();
  }
  g.fillStyle = "#2a241f";
  g.fillRect(G.x0 - bar, G.grateY - 3, G.x1 - G.x0 + bar * 2, 7);
  g.fillStyle = "rgba(232,201,131,.25)";
  g.fillRect(G.x0 - bar, G.grateY - 3, G.x1 - G.x0 + bar * 2, 1);
  g.fillStyle = "#231e1a";
  g.fillRect(G.x0 - bar, G.grateY * 0.45, G.x1 - G.x0 + bar * 2, 3);
}

export default function CarriageScene({ scene }: { scene: Scene }) {
  const first = useGame((s) => !s.game.flags.first_carriage);
  // SCN-4: the tutorial carriage keeps its hint until the first catch (the old first carriage: 5.5 s)
  const tutorial = !!scene.tutorial;
  const [hint, setHint] = useState(first || tutorial);
  const bammed = useRef(false);
  const coached = useRef(false);
  const reduced = useGame((s) => s.game.settings.reducedMotion);
  // SC-5: the «Наверху» inset shows the human clock when the cab came by
  const [clock] = useState(() => {
    const c = humanClock(useGame.getState().game);
    return String(c.hh).padStart(2, "0") + ":" + String(c.mm).padStart(2, "0");
  });
  const clopAt = useRef(0);

  useEffect(() => {
    if (!hint || tutorial) return;
    const t = window.setTimeout(() => setHint(false), 5500);
    return () => window.clearTimeout(t);
  }, [hint, tutorial]);

  // SCN-4: «Но-о!» — once per carriage, as the cab sets off over the grate
  useEffect(() => {
    if (scene.phase !== "catch" || coached.current) return;
    coached.current = true;
    sfxCue3("coachman");
  }, [scene.phase]);

  const onDone = useCallback((result: CatchResult) => act({ a: "catch", result }), []);
  const onCatch = useCallback(() => setHint(false), []);
  const drawBack = useCallback((g: CanvasRenderingContext2D, w: number, h: number, t: number) => paintCarriage(g, w, h, t), []);
  const onFrame = useCallback((t: number) => {
    const w = 1000; // only ratios matter here
    const sx = carriageShadowX(t, w);
    const hooves = sx + w * (HOOF_LEAD + 0.03);
    if (hooves > 0 && hooves < w * 1.05 && t - clopAt.current > TROT_S) {
      clopAt.current = t;
      // «цок»: the hoof voice alternates fore and hind feet (1 / 0.88) on its own
      sfxCue3("hoof");
    }
    if (!bammed.current && sx >= w * 0.5) {
      bammed.current = true;
      sfx.clack();
      shake(3, 380);
    }
  }, []);

  return (
    <div className="absolute inset-0 select-none overflow-hidden">
      <CarriageBackdrop />
      {scene.phase === "warn" && <CarriageWarn key={`w${scene.phaseStart}`} scene={scene} reduced={reduced} />}
      {scene.phase === "catch" && (
        <CatchCanvasCore key={`c${scene.phaseStart}`} scene={scene} mode="fall" onDone={onDone} onCatch={onCatch} drawBack={drawBack} onFrame={onFrame} className="absolute inset-0" />
      )}
      {/* phones: parked on the wet floor below the catch line, clear of the grate where the loot drops in */}
      {scene.phase === "catch" && <UpstairsInset n={1} perCar={6} clock={clock} reduced={reduced} cab className="absolute bottom-1.5 right-2" />}
      {hint && scene.phase === "catch" && <CatchHint reduced={reduced} />}
    </div>
  );
}

/**
 * SCN-4: the tutorial carriage's 'warn' phase — the cab walks in and pulls up over the grate (it eases to a stop where
 * the pass starts), the horse stamping, its shadow and the hooves sweeping the light shafts; the plate says what comes.
 */
function CarriageWarn({ scene, reduced }: { scene: Scene; reduced: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const g = canvas?.getContext("2d");
    if (!canvas || !g) return;
    let W = 1;
    let H = 1;
    let dpr = 1;
    const resize = () => {
      W = Math.max(1, canvas.clientWidth);
      H = Math.max(1, canvas.clientHeight);
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    const clock = makeClock(scene.phaseStart);
    const dur = Math.max(0.5, scene.phaseEnds - scene.phaseStart);
    let clop = -1;
    let painted = false;
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      // SCN-1: held — the cab stands where it is (paint once after a resize)
      if (sceneHeld() && painted) return;
      const t = Math.max(0, clock());
      const u = clamp(t / dur);
      // from well off the left edge to the pass's starting point (carriageShadowX(0) = −0.25 w), slowing down
      const sx = lerp(-0.9, -0.25, easeOutCubic(u)) * W;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      paintCarriage(g, W, H, reduced ? 0 : t, sx);
      painted = true;
      // the hooves on the cobbles, louder as the horse comes over the grate
      const hx = sx + W * (HOOF_LEAD + 0.03);
      if (!sceneHeld() && hx > -W * 0.1 && t - clop >= (u < 0.75 ? TROT_S : STAMP_S)) {
        clop = t;
        sfxCue3("hoof", { intensity: 0.45 + 0.55 * u });
      }
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [scene.phaseStart, scene.phaseEnds, reduced]);

  return (
    <>
      <canvas ref={ref} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden />
      <div className="pointer-events-none absolute inset-x-0 top-[34%] z-10 flex flex-col items-center gap-1 px-3" role="status">
        <div
          className="rounded-lg border-2 border-brass bg-soot/85 px-4 py-2 text-center font-display text-xl font-bold text-brass-light shadow-[0_6px_20px_rgba(0,0,0,.7)] md:text-2xl"
          style={reduced ? undefined : { animation: "rr-pop .5s ease-out both" }}
        >
          Цок-цок… Экипаж над решёткой!
        </div>
        <p className="rounded bg-soot/70 px-2 py-0.5 text-center text-xs text-parchment">Сейчас посыплется — лапы наготове!</p>
      </div>
    </>
  );
}

function CarriageBackdrop() {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      <svg className="absolute inset-0 h-full w-full">
        <defs>
          <pattern id="rr-shaft" width="52" height="26" patternUnits="userSpaceOnUse">
            <rect width="52" height="26" fill="#18130f" />
            <rect x="1" y="1" width="50" height="11" rx="1.5" fill="#2b221b" />
            <rect x="-25" y="14" width="50" height="11" rx="1.5" fill="#271f18" />
            <rect x="27" y="14" width="50" height="11" rx="1.5" fill="#271f18" />
          </pattern>
          <radialGradient id="rr-shaft-vig" cx="50%" cy="30%" r="80%">
            <stop offset="30%" stopColor="#000" stopOpacity="0" />
            <stop offset="100%" stopColor="#000" stopOpacity=".8" />
          </radialGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#rr-shaft)" />
        <rect width="100%" height="100%" fill="url(#rr-shaft-vig)" />
      </svg>
      {/* street level: stone ceiling with the daylight window of the grate */}
      <div className="absolute inset-x-0 top-0 h-[11%] bg-gradient-to-b from-[#3a332c] to-[#221d19] shadow-[0_6px_16px_rgba(0,0,0,.7)]" />
      <div className="absolute left-[12%] right-[12%] top-0 h-[11%] bg-[linear-gradient(180deg,#cdd8de,#e9dcb9_70%,#b9a988)]" />
      <div className="absolute left-[12%] right-[12%] top-0 h-[11%] bg-[linear-gradient(90deg,rgba(0,0,0,.25),transparent_20%,transparent_80%,rgba(0,0,0,.25))]" />
      {/* wet floor */}
      <div className="absolute inset-x-0 bottom-0 top-[86%] bg-gradient-to-b from-[#3a332b] via-[#2a241f] to-[#15110e]" />
      <div className="absolute inset-x-0 top-[86%] h-[1.2%] bg-[#8a7d68]/50" />
      <div className="absolute left-[30%] top-[90%] h-[4%] w-[30%] rounded-[50%] bg-[radial-gradient(ellipse,rgba(200,215,220,.18),transparent_70%)]" />
      <span className="absolute bottom-[2%] left-[4%] text-2xl opacity-80">🐀</span>
      <span className="absolute bottom-[2%] right-[5%] -scale-x-100 text-2xl opacity-80">🐀</span>
    </div>
  );
}

/** First-carriage hint; with reduced motion the text stays still and the paw does not swipe. */
function CatchHint({ reduced }: { reduced: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[36%] z-10 flex flex-col items-center gap-1">
      <div
        className="rounded-lg border border-brass bg-soot/80 px-4 py-2 text-center font-display text-2xl font-bold text-brass-light shadow-[0_6px_20px_rgba(0,0,0,.7)]"
        style={reduced ? undefined : { animation: "rr-hint 1.1s ease-in-out infinite" }}
      >
        Лови! Зажми и веди!
      </div>
      <p className="text-xs text-parchment-dim">Проведите лапой (мышью или пальцем) по падающей добыче</p>
      <div className="relative h-14 w-56">
        <span className="absolute left-1/2 top-1/2 -ml-4 -mt-4 text-3xl" style={reduced ? undefined : { animation: "rr-paw 1.4s ease-in-out infinite" }}>
          🐾
        </span>
      </div>
    </div>
  );
}
