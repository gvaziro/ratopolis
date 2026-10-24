"use client";

/**
 * Static scenery for train-like scenes (tunnel wall, gas lamps, the giant rail head at the bottom 30%;
 * a slimy sewer with a ledge for capsules) plus a dust canvas used while the ground trembles.
 */
import { memo, useEffect, useRef } from "react";
import { useGame } from "@/game/store";
import { hash01 } from "./sceneUtils";

export type TrainVariant = "metro" | "royal" | "capsule";

export const TrainBackdrop = memo(function TrainBackdrop({ variant }: { variant: TrainVariant }) {
  if (variant === "capsule") return <SewerBackdrop />;
  const royal = variant === "royal";
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <svg className="absolute inset-0 h-full w-full">
        <defs>
          <pattern id="rr-bricks" width="56" height="28" patternUnits="userSpaceOnUse">
            <rect width="56" height="28" fill="#1f1813" />
            <rect x="1" y="1" width="54" height="12" rx="1.5" fill="#33261d" />
            <rect x="-27" y="15" width="54" height="12" rx="1.5" fill="#2e2219" />
            <rect x="29" y="15" width="54" height="12" rx="1.5" fill="#2e2219" />
          </pattern>
          <radialGradient id="rr-vig" cx="50%" cy="42%" r="75%">
            <stop offset="35%" stopColor="#000" stopOpacity="0" />
            <stop offset="100%" stopColor="#000" stopOpacity=".8" />
          </radialGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#rr-bricks)" />
        <rect width="100%" height="100%" fill="url(#rr-vig)" />
      </svg>
      {/* tunnel mouth on the right: the train comes out of it */}
      <div className="absolute -right-[12%] top-[6%] h-[70%] w-[42%] rounded-t-full border-[10px] border-b-0 border-[#3b2c22] bg-[radial-gradient(ellipse_at_40%_70%,#050403,#0d0a08_60%,#1a1410)] shadow-[inset_0_0_40px_#000]" />
      {/* platform edge high on the wall */}
      <div className="absolute inset-x-0 top-[20%] h-[5%] bg-gradient-to-b from-[#6b5d4b] to-[#3a3128] shadow-[0_6px_14px_rgba(0,0,0,.6)]" />
      <div className={`absolute inset-x-0 top-[20%] h-[1.2%] ${royal ? "bg-[#9a1f1f]" : "bg-[#c9a25a]/70"}`} />
      {/* gas lamps */}
      {[16, 58].map((x) => (
        <div key={x} className="absolute top-[30%]" style={{ left: `${x}%` }}>
          <div className="mx-auto h-5 w-1 bg-[#2a2420]" />
          <div className="relative -ml-1.5 h-4 w-4 rounded-sm border border-[#4a3a2a] bg-gaslight shadow-[0_0_14px_#f2b84b]" />
          <div
            className={`absolute -left-24 -top-16 h-48 w-48 rounded-full ${royal ? "bg-[radial-gradient(circle,rgba(255,215,110,.32),transparent_65%)]" : "bg-[radial-gradient(circle,rgba(242,184,75,.25),transparent_65%)]"}`}
            style={{ animation: "rr-glow 3.2s ease-in-out infinite", animationDelay: `${x * 30}ms` }}
          />
        </div>
      ))}
      <RailHead royal={royal} />
    </div>
  );
});

/** The rail head seen from the trackbed: a wall of steel along the bottom 30% (items bounce on its top). */
function RailHead({ royal }: { royal: boolean }) {
  return (
    <div className="absolute inset-x-0 bottom-0 top-[70%]">
      <div className="absolute inset-x-0 top-0 h-[7%] bg-gradient-to-b from-[#efe8d8] via-[#aaa397] to-[#6c665d]" />
      <div className="absolute inset-x-0 top-0 h-[7%] bg-[linear-gradient(90deg,transparent_10%,rgba(242,184,75,.45)_30%,transparent_48%,transparent_60%,rgba(242,184,75,.3)_72%,transparent_86%)]" />
      <div className="absolute inset-x-0 top-[7%] h-[28%] bg-gradient-to-b from-[#625c53] via-[#48433c] to-[#2c2824]" />
      <div className="absolute inset-x-0 top-[35%] h-[35%] bg-gradient-to-b from-[#141210] via-[#25211d] to-[#171411]" />
      {[8, 58].map((x) => (
        <div key={x} className="absolute top-[30%] h-[46%] w-[26%] rounded-sm border border-black/50 bg-gradient-to-b from-[#4c463f] to-[#2b2622] shadow-[0_3px_8px_rgba(0,0,0,.6)]" style={{ left: `${x}%` }}>
          {[14, 38, 62, 86].map((b) => (
            <span key={b} className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle_at_35%_35%,#9a9084,#3a342e)] shadow-[0_1px_2px_#000]" style={{ left: `${b}%` }} />
          ))}
        </div>
      ))}
      <div className="absolute inset-x-0 top-[70%] h-[12%] bg-gradient-to-b from-[#4a453e] to-[#25221e]" />
      <div className="absolute inset-x-0 bottom-0 top-[82%] bg-[#120f0c] bg-[radial-gradient(circle,#2a241e_1.5px,transparent_2px)] bg-[length:9px_7px]" />
      {royal && <div className="absolute inset-x-0 top-[7%] h-[2%] bg-[#d4af37]/40" />}
    </div>
  );
}

function SewerBackdrop() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <svg className="absolute inset-0 h-full w-full">
        <defs>
          <pattern id="rr-sewer" width="48" height="24" patternUnits="userSpaceOnUse">
            <rect width="48" height="24" fill="#141a16" />
            <rect x="1" y="1" width="46" height="10" rx="1.5" fill="#23302a" />
            <rect x="-23" y="13" width="46" height="10" rx="1.5" fill="#1f2a24" />
            <rect x="25" y="13" width="46" height="10" rx="1.5" fill="#1f2a24" />
          </pattern>
          <radialGradient id="rr-sewer-vig" cx="50%" cy="40%" r="75%">
            <stop offset="35%" stopColor="#000" stopOpacity="0" />
            <stop offset="100%" stopColor="#000" stopOpacity=".8" />
          </radialGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#rr-sewer)" />
        <rect width="100%" height="100%" fill="url(#rr-sewer-vig)" />
      </svg>
      {/* slime drips */}
      {Array.from({ length: 7 }, (_, i) => (
        <div
          key={i}
          className="absolute top-[30%] w-1 rounded-b-full bg-gradient-to-b from-[#4f9d8a]/50 to-transparent"
          style={{ left: `${8 + i * 13 + hash01(i, 3) * 6}%`, height: `${8 + hash01(i, 5) * 18}%` }}
        />
      ))}
      <div className="absolute left-[6%] top-[38%] h-10 w-10 rounded-full bg-[radial-gradient(circle,rgba(242,184,75,.35),transparent_70%)]" style={{ animation: "rr-glow 2.6s ease-in-out infinite" }} />
      {/* stone ledge (items bounce on its top, 72%) and murky water below */}
      <div className="absolute inset-x-0 top-[72%] h-[9%] bg-gradient-to-b from-[#6b6458] via-[#4a443c] to-[#2a2621] shadow-[0_8px_16px_rgba(0,0,0,.7)]" />
      <div className="absolute inset-x-0 top-[72%] h-[1.4%] bg-[#a39a88]/60" />
      <div className="absolute inset-x-0 bottom-0 top-[81%] bg-gradient-to-b from-[#15302b] to-[#08110f]">
        <div className="absolute inset-0 bg-[repeating-linear-gradient(180deg,rgba(124,196,176,.12)_0_1px,transparent_1px_9px)]" />
      </div>
    </div>
  );
}

/** Falling ceiling dust; `intensity` 0..1 (70% fewer motes with reduced motion). */
export function TrainDust({ intensity, color = "200,182,150" }: { intensity: number; color?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const level = useRef(intensity);
  useEffect(() => {
    level.current = intensity;
  }, [intensity]);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduced = useGame.getState().game.settings.reducedMotion;
    const k = reduced ? 0.3 : 1;
    let W = 1;
    let H = 1;
    let dpr = 1;
    const motes: { x: number; y: number; vx: number; vy: number; s: number; a: number }[] = [];
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
    let last = performance.now();
    let raf = 0;
    let acc = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      acc += dt * 80 * level.current * k;
      while (acc >= 1 && motes.length < 120) {
        acc -= 1;
        const big = Math.random() < 0.12;
        motes.push({ x: Math.random() * W, y: -4, vx: (Math.random() - 0.5) * 14, vy: 30 + Math.random() * 70 + (big ? 80 : 0), s: big ? 2.5 + Math.random() * 2 : 0.8 + Math.random() * 1.4, a: 0.25 + Math.random() * 0.5 });
      }
      if (acc > 1) acc = 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      for (let i = motes.length - 1; i >= 0; i--) {
        const m = motes[i];
        m.vy += 40 * dt;
        m.x += m.vx * dt;
        m.y += m.vy * dt;
        if (m.y > H + 6) {
          motes.splice(i, 1);
          continue;
        }
        ctx.fillStyle = `rgba(${color},${m.a})`;
        ctx.fillRect(m.x, m.y, m.s, m.s * (m.s > 2 ? 0.8 : 1.6));
      }
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [color]);
  return <canvas ref={ref} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden />;
}
