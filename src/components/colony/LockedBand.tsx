"use client";

/**
 * The next, still-closed zone: dark rock with a faint "?".
 * While an expedition digs (game.digging), cracks spread, clumps of earth fall, the screen shakes and sfx.dig() thuds.
 */
import { memo, useEffect, useRef } from "react";
import { sfx } from "@/audio/sfx";
import { ZONES } from "@/game/data/zones";
import type { ZoneId } from "@/game/types";
import { fmtInt } from "@/lib/format";
import { expeditionFraction } from "@/game/engine/actions";
import { emitUiFx, onFx } from "@/game/fx";
import { useGame } from "@/game/store";
import { BAND_H, bandTop, nextLocked, seeded, W } from "./geometry";
import { Glow, type GlowKind } from "./parts";
import { DECOR } from "./ZoneBand";
import { registerCull } from "./registry";

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

/** Silhouette opacity by scouting payouts 0..3 (CO-8). */
const TEASER_OPACITY = [0.16, 0.24, 0.32, 0.4];

/** Slow hint glows of the zone behind the rock: the river, the moon window, the furnace, the clock rim. */
const HINTS: Partial<Record<ZoneId, { x: number; y: number; r: number; kind: GlowKind }[]>> = {
  sewers: [
    { x: W * 0.3, y: BAND_H * 0.78, r: 120, kind: "teal" },
    { x: W * 0.72, y: BAND_H * 0.82, r: 90, kind: "teal" },
  ],
  cellars: [
    { x: W * 0.78, y: BAND_H * 0.3, r: 70, kind: "white" },
    { x: W * 0.25, y: BAND_H * 0.6, r: 90, kind: "warm" },
  ],
  metro: [
    { x: W * 0.35, y: BAND_H * 0.7, r: 130, kind: "red" },
    { x: W * 0.8, y: BAND_H * 0.45, r: 70, kind: "warm" },
  ],
  terminal: [
    { x: W * 0.5, y: BAND_H * 0.35, r: 120, kind: "gold" },
    { x: W * 0.15, y: BAND_H * 0.7, r: 80, kind: "gold" },
    { x: W * 0.85, y: BAND_H * 0.7, r: 80, kind: "gold" },
  ],
};

/**
 * «🗺️ Экспедиция: Канализация — 62% · 🐀 9/12» on a brass plaque with a verdigris bar (as GoalWidget counts it);
 * a click opens the Map tab at the zone (CO-8).
 */
function ExpeditionPlaque({ zone, digging }: { zone: ZoneId; digging: boolean }) {
  const pct = useGame((s) => Math.floor(expeditionFraction(s.game, zone) * 100));
  const rats = useGame((s) => s.game.rats);
  const need = ZONES[zone].expedition?.rats ?? 0;
  const text = digging ? "⛏️ Копаем! Копаем!" : `🗺️ Экспедиция: ${ZONES[zone].name} — ${pct}% · 🐀 ${fmtInt(Math.min(rats, need))}/${fmtInt(need)}`;
  const w = Math.max(220, text.length * 7.2 + 28);
  const x = W / 2 - w / 2;
  const y = BAND_H / 2 - 22;
  const open = () => useGame.getState().focus("map", `z_${zone}`);
  return (
    <g
      data-nodrag=""
      pointerEvents="auto"
      role="button"
      tabIndex={0}
      aria-label={text}
      style={{ cursor: "pointer" }}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      }}
    >
      <rect x={x} y={y} width={w} height={44} rx="6" fill="#2a2016" stroke="url(#cv-brass)" strokeWidth="3" />
      {[x + 8, x + w - 8].map((cx) => (
        <circle key={cx} cx={cx} cy={y + 8} r="2.2" fill="#c9a25a" />
      ))}
      <text x={W / 2} y={y + 20} fontSize="13" textAnchor="middle" fill="#eadcc0" className="font-display" fontWeight="700">
        {text}
      </text>
      <rect x={x + 14} y={y + 30} width={w - 28} height="5" rx="2.5" fill="#120e0b" />
      <rect x={x + 14} y={y + 30} width={((w - 28) * pct) / 100} height="5" rx="2.5" fill="#4f9d8a" />
      {[0.25, 0.5, 0.75].map((k) => (
        <rect key={k} x={x + 14 + (w - 28) * k - 0.5} y={y + 29} width="1" height="7" fill="#c9a25a" opacity=".7" />
      ))}
    </g>
  );
}

export const LockedBand = memo(function LockedBand() {
  const zone = useGame((s) => nextLocked(s.game));
  const digging = useGame((s) => !!s.game.digging && s.game.digging.zone === nextLocked(s.game));
  const ref = useRef<SVGGElement>(null);
  const teaserRef = useRef<SVGGElement>(null);
  const scouted = useGame((s) => {
    const z = nextLocked(s.game);
    return z ? Math.max(0, Math.floor(s.game.scouted[z] ?? 0)) : 0;
  });

  // a scouting payout flashes the newly revealed part with a short glint
  useEffect(
    () =>
      onFx((fx) => {
        if (fx.k !== "scout" || useGame.getState().game.settings.reducedMotion) return;
        teaserRef.current?.animate([{ filter: "url(#cv-silhouette) brightness(1)" }, { filter: "url(#cv-silhouette) brightness(2.6)" }, { filter: "url(#cv-silhouette) brightness(1)" }], {
          duration: 900,
          easing: "ease-out",
        });
      }),
    [],
  );

  useEffect(() => {
    const el = ref.current;
    if (!zone || !el) return;
    return registerCull(el, bandTop(zone), bandTop(zone) + BAND_H);
  }, [zone]);

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
  const Decor = DECOR[zone];
  return (
    <g ref={ref} transform={`translate(0 ${top})`} pointerEvents="none">
      <rect x={-2000} y="0" width={W + 4000} height={BAND_H} fill="#0d0a08" />
      {ROCK.map((s, i) => (
        <ellipse key={i} cx={s.x} cy={s.y} rx={s.rx} ry={s.ry} fill={i % 2 ? "#17120e" : "#080605"} />
      ))}
      {/* CO-8: the zone behind the rock, a little clearer after every scouting payout */}
      <g ref={teaserRef} opacity={TEASER_OPACITY[Math.min(3, scouted)]} filter="url(#cv-silhouette)" style={{ transition: "opacity .8s" }}>
        <Decor />
      </g>
      {HINTS[zone]?.map((h, i) => <Glow key={i} x={h.x} y={h.y} r={h.r} kind={h.kind} className="cv-glow" opacity={0.18 + 0.08 * Math.min(3, scouted)} />)}
      <rect x={-2000} y="0" width={W + 4000} height="44" fill="url(#cv-feather)" />
      <rect x={-2000} y="0" width={W + 4000} height="14" fill={ZONES[zone].palette.bg} opacity=".25" />
      <ExpeditionPlaque zone={zone} digging={digging} />
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
