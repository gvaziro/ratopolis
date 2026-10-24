"use client";

/**
 * «Экипаж над решёткой»: a cab rolls over the street grate (its wheel's shadow sweeps the light shafts
 * left→right, hooves clop ahead) and loot tumbles through the bars — the catch tutorial before trains.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { sfx } from "@/audio/sfx";
import { useGame } from "@/game/store";
import type { CatchResult, Scene } from "@/game/types";
import { humanClock } from "@/game/engine/formulas";
import { CatchCanvasCore } from "./CatchCanvas";
import { UpstairsInset } from "./UpstairsInset";
import { act, carriageShadowX, fallGeom, shake } from "./sceneUtils";

const TAU = Math.PI * 2;

function paintCarriage(g: CanvasRenderingContext2D, w: number, h: number, t: number) {
  const G = fallGeom(w, h);
  const sx = carriageShadowX(t, w);
  const sw = Math.max(60, w * 0.13);

  // light shafts from each slot of the grate, dimmed where the wheel's shadow falls
  g.save();
  g.globalCompositeOperation = "lighter";
  for (let k = 0; k < G.slots; k++) {
    const x0 = G.x0 + k * G.slotW + 4;
    const x1 = x0 + G.slotW - 8;
    const cx = (x0 + x1) / 2;
    const shade = 1 - 0.88 * Math.exp(-Math.pow((cx - sx) / (sw * 1.2), 2));
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
  const th = (t * w * 0.27) / R;
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
  for (let k = 0; k < 2; k++) {
    const hx = sx + w * (0.3 + k * 0.06);
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
  const [hint, setHint] = useState(first);
  const bammed = useRef(false);
  const reduced = useGame((s) => s.game.settings.reducedMotion);
  // SC-5: the «Наверху» inset shows the human clock when the cab came by
  const [clock] = useState(() => {
    const c = humanClock(useGame.getState().game);
    return String(c.hh).padStart(2, "0") + ":" + String(c.mm).padStart(2, "0");
  });
  const clopAt = useRef(0);

  useEffect(() => {
    if (!hint) return;
    const t = window.setTimeout(() => setHint(false), 5500);
    return () => window.clearTimeout(t);
  }, [hint]);

  const onDone = useCallback((result: CatchResult) => act({ a: "catch", result }), []);
  const onCatch = useCallback(() => setHint(false), []);
  const drawBack = useCallback((g: CanvasRenderingContext2D, w: number, h: number, t: number) => paintCarriage(g, w, h, t), []);
  const onFrame = useCallback((t: number) => {
    const w = 1000; // only ratios matter here
    const sx = carriageShadowX(t, w);
    const hooves = sx + w * 0.33;
    if (hooves > 0 && hooves < w * 1.05 && t - clopAt.current > 0.37) {
      clopAt.current = t;
      sfx.click(); // "цок" (no dedicated hoof sound in sfx yet)
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
      {scene.phase === "catch" && (
        <CatchCanvasCore key={`c${scene.phaseStart}`} scene={scene} mode="fall" onDone={onDone} onCatch={onCatch} drawBack={drawBack} onFrame={onFrame} className="absolute inset-0" />
      )}
      {/* phones: parked on the wet floor below the catch line, clear of the grate where the loot drops in */}
      {scene.phase === "catch" && <UpstairsInset n={1} perCar={6} clock={clock} reduced={reduced} cab className="absolute bottom-1.5 right-2" />}
      {hint && <CatchHint reduced={reduced} />}
    </div>
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
