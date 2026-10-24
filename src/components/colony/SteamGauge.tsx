"use client";

/**
 * Brass steam manometer (top-right of the colony). The needle follows steam / buffer with a spring;
 * when the press and the clock tower are starved (steamEff < 0.5) the red zone shakes and «Нет пара!» blinks.
 */
import { memo, useEffect, useRef } from "react";
import { cx } from "@/components/ui/kit";
import { derivedOf, useGame } from "@/game/store";
import { fmt } from "@/lib/format";

const A0 = -125;
const A1 = 125;

function arc(r: number, a0: number, a1: number): string {
  const p = (a: number) => {
    const t = ((a - 90) * Math.PI) / 180;
    return `${(Math.cos(t) * r).toFixed(2)} ${(Math.sin(t) * r).toFixed(2)}`;
  };
  return `M${p(a0)}A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${p(a1)}`;
}

export const SteamGauge = memo(function SteamGauge() {
  const revealed = useGame((s) => !!s.game.revealed.steam);
  const starving = useGame((s) => s.game.steamEff < 0.5 && derivedOf(s.game).steamNeed > 0);
  const label = useGame((s) => `${fmt(s.game.res.steam)} / ${fmt(derivedOf(s.game).caps.steam)}`);
  const rm = useGame((s) => s.game.settings.reducedMotion);
  const needle = useRef<SVGGElement>(null);

  useEffect(() => {
    if (!revealed) return;
    let raf = 0;
    let ang = A0;
    let vel = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const g = useGame.getState().game;
      const d = derivedOf(g);
      const cap = d.caps.steam;
      const f = cap > 0 ? Math.max(0, Math.min(1, g.res.steam / cap)) : 0;
      const target = A0 + (A1 - A0) * f;
      // damped spring
      vel += ((target - ang) * 60 - vel * 9) * dt;
      ang += vel * dt;
      const starved = g.steamEff < 0.5 && d.steamNeed > 0 && !g.settings.reducedMotion;
      const jitter = starved ? Math.sin(now / 23) * 2.5 : 0;
      needle.current?.setAttribute("transform", `rotate(${(ang + jitter).toFixed(1)})`);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [revealed]);

  if (!revealed) return null;
  return (
    <div className="pointer-events-none absolute right-2 top-2 z-20 flex flex-col items-center" aria-label={`Давление пара ${label}`}>
      <div className={cx("relative", starving && !rm && "cv-vibrate")}>
        <svg width="72" height="72" viewBox="-40 -40 80 80" className="drop-shadow-[0_3px_6px_rgba(0,0,0,.55)]">
          <circle r="37" fill="url(#cv-gauge-rim)" stroke="#2a1a0c" strokeWidth="1.5" />
          <circle r="30" fill="#f1e6cc" stroke="#7d5f2c" strokeWidth="1.5" />
          <path d={arc(25, A0, A0 + 45)} stroke="#c4453a" strokeWidth="6" fill="none" className={starving ? "cv-blink" : undefined} />
          <path d={arc(25, A1 - 40, A1)} stroke="#8fbf5a" strokeWidth="4" fill="none" opacity=".8" />
          {Array.from({ length: 11 }, (_, i) => {
            const a = A0 + ((A1 - A0) * i) / 10;
            return <line key={i} x1="0" y1={i % 5 === 0 ? -29 : -29} x2="0" y2={i % 5 === 0 ? -21 : -25} stroke="#2a1a0c" strokeWidth={i % 5 === 0 ? 1.6 : 0.9} transform={`rotate(${a})`} />;
          })}
          <text y="13" fontSize="7" textAnchor="middle" fill="#5c4520" className="font-display" fontWeight="700">
            ПАР
          </text>
          <g ref={needle} transform={`rotate(${A0})`}>
            <path d="M-1.6 4L0 -27L1.6 4z" fill="#8b1e1e" />
          </g>
          <circle r="4" fill="url(#cv-gauge-rim)" stroke="#2a1a0c" strokeWidth=".8" />
          <defs>
            <radialGradient id="cv-gauge-rim" cx=".35" cy=".3">
              <stop offset="0" stopColor="#fff1b8" />
              <stop offset=".5" stopColor="#c9a25a" />
              <stop offset="1" stopColor="#6b4f22" />
            </radialGradient>
          </defs>
        </svg>
      </div>
      <div className="mt-0.5 rounded bg-soot-2/80 px-1.5 font-mono text-[10px] text-steam tabular">{label}</div>
      {starving && <div className="cv-blink mt-0.5 rounded border border-danger bg-soot-2/90 px-1.5 font-display text-xs font-bold text-danger-light">Нет пара!</div>}
    </div>
  );
});
