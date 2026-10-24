"use client";

/**
 * The next, still-closed zone: dark rock with a faint "?".
 * While an expedition digs (game.digging), cracks spread, clumps of earth fall, the screen shakes and sfx.dig() thuds.
 */
import { memo, useEffect } from "react";
import { sfx } from "@/audio/sfx";
import { ZONES } from "@/game/data/zones";
import { emitUiFx } from "@/game/fx";
import { useGame } from "@/game/store";
import { BAND_H, bandTop, nextLocked, seeded, W } from "./geometry";
import { Glow } from "./parts";

const CRACKS: { d: string; len: number }[] = (() => {
  const r = seeded(7);
  const out: { d: string; len: number }[] = [];
  for (let i = 0; i < 7; i++) {
    let x = 80 + r() * (W - 160);
    let y = 0;
    let d = `M${x.toFixed(0)} ${y}`;
    let len = 0;
    for (let k = 0; k < 7; k++) {
      const nx = x + (r() - 0.5) * 70;
      const ny = y + 18 + r() * 34;
      len += Math.hypot(nx - x, ny - y);
      x = nx;
      y = ny;
      d += `L${x.toFixed(0)} ${y.toFixed(0)}`;
    }
    out.push({ d, len: Math.ceil(len) });
  }
  return out;
})();

const CLUMPS = Array.from({ length: 12 }, (_, i) => ({ x: 60 + ((i * 97) % (W - 120)), y: 6 + (i % 3) * 8, r: 3 + (i % 4), delay: (i * 0.37) % 1.2, dx: ((i % 5) - 2) * 6 }));

const ROCK = (() => {
  const r = seeded(31);
  return Array.from({ length: 40 }, () => ({ x: -200 + r() * (W + 400), y: 10 + r() * (BAND_H - 30), rx: 4 + r() * 12, ry: 3 + r() * 6 }));
})();

export const LockedBand = memo(function LockedBand() {
  const zone = useGame((s) => nextLocked(s.game));
  const digging = useGame((s) => !!s.game.digging && s.game.digging.zone === nextLocked(s.game));

  useEffect(() => {
    if (!digging) return;
    // AudioDirector plays the first thud on zoneDig; keep the pick-axes going for the rest of the dig
    const timers = [0, 1250, 2500, 3750].map((ms, i) =>
      window.setTimeout(() => {
        emitUiFx({ k: "shake", px: 6, ms: 420 });
        if (i > 0) sfx.dig();
      }, ms),
    );
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [digging]);

  if (!zone) return null;
  const top = bandTop(zone);
  return (
    <g transform={`translate(0 ${top})`} pointerEvents="none">
      <rect x={-2000} y="0" width={W + 4000} height={BAND_H} fill="#0d0a08" />
      {ROCK.map((s, i) => (
        <ellipse key={i} cx={s.x} cy={s.y} rx={s.rx} ry={s.ry} fill={i % 2 ? "#17120e" : "#080605"} />
      ))}
      <rect x={-2000} y="0" width={W + 4000} height="14" fill={ZONES[zone].palette.bg} opacity=".25" />
      <text x={W / 2} y={BAND_H / 2 + 30} fontSize="110" textAnchor="middle" fill="#3a2e22" opacity=".45" className="font-display" fontWeight="700">
        ?
      </text>
      <text x={W / 2} y={BAND_H / 2 + 70} fontSize="14" textAnchor="middle" fill="#5a4a38" opacity=".7" className="font-display" fontWeight="700">
        {digging ? "Копаем! Копаем!" : "Неизведанные глубины"}
      </text>
      {digging && (
        <g>
          <Glow x={W / 2} y={30} r={160} kind="warm" className="cv-glow" opacity={0.7} />
          {CRACKS.map((c, i) => (
            <path key={i} d={c.d} fill="none" stroke="#f2b84b" strokeOpacity=".55" strokeWidth="2.4" className="cv-crack" style={{ ["--len" as string]: c.len, animationDelay: `${i * 0.25}s` }} />
          ))}
          {CLUMPS.map((c, i) => (
            <circle key={i} cx={c.x} cy={c.y} r={c.r} fill={i % 2 ? "#5a3a22" : "#3d2a1a"} className="cv-clump" style={{ animationDelay: `${c.delay}s`, ["--dx" as string]: `${c.dx}px` }} />
          ))}
        </g>
      )}
    </g>
  );
});
