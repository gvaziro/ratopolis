"use client";

/**
 * Static art of «Наверху» (memoized; re-rendered only on resize / zone change / human minute).
 * Layers: backdrop (sky, sun/moon, stars) → clouds → far rooftops → mid houses → near street → props,
 * then a time-of-day tint and the lights drawn above it so windows and gas lamps glow at night.
 * Groups with `data-pan` are panned by SkyStrip's loop (parallax); `data-drift` groups are clouds.
 */
import { memo } from "react";
import { ZONES, ZONE_ORDER } from "@/game/data/zones";
import { FAR_BASE, H, MARGIN, PAVE_FRONT, PAVE_TOP, ROAD_TOP, rng, type House, type Roof, type SkyLayout } from "./skyGeo";
import { lampLit, type SkyLook } from "./skyTime";

export const PAN = { far: 5, mid: 11, near: 18 } as const;

/* ================================================================ defs */

export const SkyDefs = memo(function SkyDefs({ look, z }: { look: SkyLook; z: number }) {
  const glow = ZONES[ZONE_ORDER[Math.max(0, Math.min(4, z - 1))]].palette.glow;
  const t = "stop-color 3s linear";
  return (
    <defs>
      <linearGradient id="sk-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" style={{ stopColor: look.skyTop, transition: t }} />
        <stop offset="0.85" style={{ stopColor: look.skyBottom, transition: t }} />
      </linearGradient>
      <radialGradient id="sk-sunglow">
        <stop offset="0" stopColor="#fff2c8" stopOpacity=".9" />
        <stop offset="1" stopColor="#ffd08a" stopOpacity="0" />
      </radialGradient>
      <radialGradient id="sk-halo">
        <stop offset="0" stopColor="#ffd98a" stopOpacity=".75" />
        <stop offset=".35" stopColor="#f2b84b" stopOpacity=".28" />
        <stop offset="1" stopColor="#f2b84b" stopOpacity="0" />
      </radialGradient>
      <radialGradient id="sk-pool">
        <stop offset="0" stopColor="#ffd98a" stopOpacity=".55" />
        <stop offset="1" stopColor="#f2b84b" stopOpacity="0" />
      </radialGradient>
      <radialGradient id="sk-grateglow">
        <stop offset="0" stopColor={glow} stopOpacity=".95" />
        <stop offset="1" stopColor={glow} stopOpacity="0" />
      </radialGradient>
      <linearGradient id="sk-ray" x1="0" y1="1" x2="0" y2="0">
        <stop offset="0" stopColor={glow} stopOpacity=".55" />
        <stop offset="1" stopColor={glow} stopOpacity="0" />
      </linearGradient>
      <linearGradient id="sk-brass" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#7d5f2c" />
        <stop offset=".4" stopColor="#e8c983" />
        <stop offset="1" stopColor="#6a4f22" />
      </linearGradient>
      <linearGradient id="sk-gold" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#fff1c9" />
        <stop offset=".45" stopColor="#d4af37" />
        <stop offset="1" stopColor="#7d5f2c" />
      </linearGradient>
      <linearGradient id="sk-door" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#0c0a09" />
        <stop offset="1" stopColor="#2a221b" />
      </linearGradient>
      <radialGradient id="sk-portal" cx=".5" cy=".7" r=".7">
        <stop offset="0" stopColor="#000" />
        <stop offset="1" stopColor="#1a1411" />
      </radialGradient>
      <pattern id="sk-cobbles2" width="7" height="6.4" patternUnits="userSpaceOnUse">
        <rect x=".4" y=".35" width="6.1" height="2.6" rx="1.2" fill="#584e44" />
        <rect x="3.9" y="3.55" width="6.1" height="2.6" rx="1.2" fill="#51473e" />
        <rect x="-3.1" y="3.55" width="6.1" height="2.6" rx="1.2" fill="#51473e" />
      </pattern>
      <pattern id="sk-slabs" width="15" height="7" patternUnits="userSpaceOnUse">
        <path d="M0 0 V7 M0 3.6 H15" stroke="#4f473e" strokeWidth=".5" fill="none" />
      </pattern>
      <pattern id="sk-brick" width="6" height="3" patternUnits="userSpaceOnUse">
        <path d="M0 2.8 H6 M2 0 V1.4 M5 1.4 V2.8" stroke="#000" strokeWidth=".35" opacity=".22" fill="none" />
      </pattern>
      <pattern id="sk-stripes" width="3" height="10" patternUnits="userSpaceOnUse">
        <rect width="1.5" height="10" fill="#efe2c4" opacity=".85" />
      </pattern>
      <pattern id="sk-rails" width="2.6" height="10" patternUnits="userSpaceOnUse">
        <rect x="1" width=".55" height="10" fill="#1a1715" />
      </pattern>
      <pattern id="sk-valance" width="3" height="2" patternUnits="userSpaceOnUse">
        <path d="M0 0 H3 L1.5 2Z" fill="#6a5c4c" />
      </pattern>
      <pattern id="sk-rain" width="11" height="24" patternUnits="userSpaceOnUse">
        <path d="M9 0 L7.4 7 M3.5 9 L1.9 16 M7 15 L5.6 21" stroke="#c6d4dc" strokeWidth=".55" strokeLinecap="round" opacity=".75" />
      </pattern>
      <mask id="sk-moonmask">
        <rect x="-10" y="-10" width="20" height="20" fill="#fff" />
        <circle cx="2.6" cy="-1.4" r="4.6" fill="#000" />
      </mask>
    </defs>
  );
});

/* ================================================================ sky */

export const Backdrop = memo(function Backdrop({ W, look }: { W: number; look: SkyLook }) {
  const stars = starField(W);
  const sun = look.sun;
  const moon = look.moon;
  const sunX = sun !== null ? W * (0.08 + 0.84 * sun) : 0;
  const sunY = sun !== null ? 62 - 46 * Math.sin(Math.PI * sun) : 0;
  const low = sun !== null ? 1 - Math.sin(Math.PI * sun) : 0;
  const moonX = moon !== null ? W * (0.1 + 0.8 * moon) : 0;
  const moonY = moon !== null ? 50 - 36 * Math.sin(Math.PI * moon) : 0;
  return (
    <g>
      <rect x={-MARGIN} y={-2} width={W + MARGIN * 2} height={H + 4} fill="url(#sk-sky)" />
      {look.dark > 0.05 && (
        <g opacity={look.dark * 0.85}>
          {stars.map((s, i) => (
            <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#f4ecd8" opacity={s.o} />
          ))}
        </g>
      )}
      {sun !== null && (
        <g opacity={0.85}>
          <circle cx={sunX} cy={sunY} r={22} fill="url(#sk-sunglow)" opacity={0.55} />
          <circle cx={sunX} cy={sunY} r={6.5} fill={low > 0.6 ? "#ffb27a" : "#fff4d8"} />
        </g>
      )}
      {moon !== null && (
        <g transform={`translate(${moonX.toFixed(1)} ${moonY.toFixed(1)})`}>
          <circle r={11} fill="url(#sk-sunglow)" opacity={0.18} />
          <circle r={4.6} fill="#ece6cf" mask="url(#sk-moonmask)" />
        </g>
      )}
    </g>
  );
});

function starField(W: number): { x: number; y: number; r: number; o: number }[] {
  const r = rng(77);
  const n = Math.min(60, Math.round(W / 24));
  return Array.from({ length: n }, () => ({ x: r() * W, y: 2 + r() * 40, r: 0.35 + r() * 0.55, o: 0.4 + r() * 0.6 }));
}

/** Drifting clouds; rainy = the sewers' drizzle / a downpour. */
export const Clouds = memo(function Clouds({ W, rainy }: { W: number; rainy: boolean }) {
  const r = rng(rainy ? 31 : 13);
  const n = Math.max(3, Math.round(W / (rainy ? 140 : 260)));
  const span = W + 240;
  return (
    <g>
      {Array.from({ length: n }, (_, i) => {
        const base = (i / n) * span + r() * 60;
        const y = (rainy ? 6 : 8) + r() * (rainy ? 14 : 22);
        const s = 0.7 + r() * 0.8;
        const speed = (rainy ? 2.6 : 1.4) + r() * 1.2;
        return (
          <g key={i} data-drift={speed.toFixed(2)} data-base={base.toFixed(1)} transform={`translate(${(base - 120).toFixed(1)} 0)`}>
            <g transform={`translate(0 ${y.toFixed(1)}) scale(${s.toFixed(2)})`} opacity={rainy ? 0.85 : 0.5}>
              <ellipse cx={0} cy={4} rx={22} ry={5} fill={rainy ? "#5a5e68" : "#e4ddd0"} />
              <ellipse cx={-8} cy={1} rx={10} ry={6} fill={rainy ? "#646873" : "#ece6da"} />
              <ellipse cx={6} cy={-1} rx={12} ry={7.5} fill={rainy ? "#6b707b" : "#f2ece2"} />
              <ellipse cx={16} cy={3} rx={8} ry={4.5} fill={rainy ? "#5f636d" : "#e8e1d4"} />
            </g>
          </g>
        );
      })}
    </g>
  );
});

/* ================================================================ far */

export const FarLayer = memo(function FarLayer({ roofs, L, calm }: { roofs: Roof[]; L: SkyLayout; calm: boolean }) {
  const fill = "#2b2936";
  const smokes: { x: number; y: number; k: number }[] = [];
  return (
    <g opacity={0.74}>
      <Landmarks L={L} fill={fill} />
      {roofs.map((r, i) => {
        const top = FAR_BASE - r.h;
        let d: string;
        if (r.kind === "gable") d = `M${r.x} ${top + 5} L${r.x + r.w / 2} ${top - 4} L${r.x + r.w} ${top + 5} V${FAR_BASE + 8} H${r.x}Z`;
        else if (r.kind === "mansard") d = `M${r.x} ${top + 3} L${r.x + 4} ${top - 3} H${r.x + r.w - 4} L${r.x + r.w} ${top + 3} V${FAR_BASE + 8} H${r.x}Z`;
        else d = `M${r.x} ${top} H${r.x + r.w} V${FAR_BASE + 8} H${r.x}Z`;
        const roofTop = r.kind === "gable" ? top + 2 : r.kind === "mansard" ? top - 2 : top;
        for (const c of r.chimneys) if (c.smoke && !calm) smokes.push({ x: r.x + c.x + 2, y: roofTop - c.h, k: i });
        return (
          <g key={i}>
            <path d={d} fill={fill} />
            {r.chimneys.map((c, j) => (
              <g key={j}>
                <rect x={r.x + c.x} y={roofTop - c.h} width={4.2} height={c.h + 2} fill={fill} />
                <rect x={r.x + c.x + 0.4} y={roofTop - c.h - 1.6} width={1.2} height={1.8} fill={fill} />
                <rect x={r.x + c.x + 2.4} y={roofTop - c.h - 1.2} width={1.2} height={1.4} fill={fill} />
              </g>
            ))}
          </g>
        );
      })}
      {smokes.map((s, i) =>
        [0, 1, 2].map((p) => (
          <circle
            key={`${i}-${p}`}
            className="sk-smoke"
            cx={s.x}
            cy={s.y - 1}
            r={2.4}
            fill="#cfd6d6"
            opacity={0.5}
            style={{ animationDelay: `${-(p * 1.7 + (s.k % 5) * 0.6)}s`, ["--dx" as string]: `${-10 - (i % 3) * 4}px` }}
          />
        )),
      )}
    </g>
  );
});

/** St Paul's dome and a clock tower far behind the roofs. */
function Landmarks({ L, fill }: { L: SkyLayout; fill: string }) {
  const d = L.C - 214;
  const t = L.C + 330;
  return (
    <g fill={fill}>
      {/* dome */}
      <rect x={d - 15} y={36} width={30} height={34} />
      <rect x={d - 18} y={34} width={36} height={3} />
      <path d={`M${d - 13} 34 A13 12 0 0 1 ${d + 13} 34Z`} />
      <rect x={d - 2.4} y={17} width={4.8} height={6} />
      <path d={`M${d - 3} 17 L${d} 12 L${d + 3} 17Z`} />
      <rect x={d - 0.5} y={8} width={1} height={5} />
      <rect x={d - 2} y={9.5} width={4} height={1} />
      {/* clock tower */}
      <rect x={t - 6} y={18} width={12} height={52} />
      <rect x={t - 7.5} y={24} width={15} height={11} />
      <path d={`M${t - 7} 18 L${t} 4 L${t + 7} 18Z`} />
      <circle cx={t} cy={29.5} r={3.6} fill="#d8cfb8" opacity={0.55} />
    </g>
  );
}

/* ================================================================ mid */

export const MidLayer = memo(function MidLayer({ houses, L }: { houses: House[]; L: SkyLayout }) {
  return (
    <g>
      {houses.map((h, i) => (
        <HouseArt key={i} h={h} />
      ))}
      {L.station && <Station L={L} />}
      {L.house && <TownHouse L={L} />}
      {L.shop && <Shop L={L} />}
    </g>
  );
});

function HouseArt({ h }: { h: House }) {
  const top = PAVE_TOP - h.h;
  return (
    <g>
      {h.roof === "mansard" && <path d={`M${h.x + 1} ${top} L${h.x + 4} ${top - 7} H${h.x + h.w - 4} L${h.x + h.w - 1} ${top}Z`} fill="#3a3540" />}
      {h.roof === "gable" && <path d={`M${h.x} ${top} L${h.x + h.w / 2} ${top - 9} L${h.x + h.w} ${top}Z`} fill="#40363a" />}
      {h.chimney !== null && (
        <g fill="#3d302a">
          <rect x={h.x + h.chimney} y={top - (h.roof === "flat" ? 8 : 12)} width={5.5} height={12} />
          <rect x={h.x + h.chimney - 0.5} y={top - (h.roof === "flat" ? 8.8 : 12.8)} width={6.5} height={1.4} fill="#5a4a40" />
        </g>
      )}
      <rect x={h.x} y={top} width={h.w} height={h.h + 2} fill={h.color} />
      <rect x={h.x} y={top} width={h.w} height={h.h + 2} fill="url(#sk-brick)" />
      <rect x={h.x - 0.6} y={top - 1.6} width={h.w + 1.2} height={2.4} fill={h.trim} />
      <rect x={h.x} y={top + 0.8} width={0.8} height={h.h} fill="#000" opacity={0.25} />
      {h.windows.map((w, j) => (
        <g key={j}>
          <rect x={w.x} y={w.y} width={w.w} height={w.h} fill="#1c232c" />
          <rect x={w.x} y={w.y} width={w.w} height={w.h * 0.45} fill="#56667a" opacity={0.35} />
          <rect x={w.x - 0.5} y={w.y + w.h} width={w.w + 1} height={0.9} fill={h.trim} />
        </g>
      ))}
      {h.shopfront && h.awning && (
        <g>
          <rect x={h.x + 2} y={PAVE_TOP - 15} width={h.w - 4} height={3.2} fill="#2b2420" />
          <path d={`M${h.x + 2} ${PAVE_TOP - 12} H${h.x + h.w - 2} L${h.x + h.w} ${PAVE_TOP - 8} H${h.x}Z`} fill={h.awning} />
          <path d={`M${h.x + 2} ${PAVE_TOP - 12} H${h.x + h.w - 2} L${h.x + h.w} ${PAVE_TOP - 8} H${h.x}Z`} fill="url(#sk-stripes)" opacity={0.55} />
        </g>
      )}
      {h.door !== null && (
        <g>
          <rect x={h.x + h.door} y={PAVE_TOP - 10} width={5.4} height={10} fill="#2a1d16" />
          <path d={`M${h.x + h.door} ${PAVE_TOP - 10} A2.7 2.7 0 0 1 ${h.x + h.door + 5.4} ${PAVE_TOP - 10}Z`} fill="#56667a" opacity={0.5} />
        </g>
      )}
    </g>
  );
}

/** The cellars' town house: tall stucco front, its basement light-well is drawn in the near layer. */
function TownHouse({ L }: { L: SkyLayout }) {
  const s = L.house!;
  const w = s.x1 - s.x0;
  const top = 16;
  const cols = 5;
  const step = (w - 16) / cols;
  return (
    <g>
      <path d={`M${s.x0 + 2} ${top} L${s.x0 + 7} ${top - 8} H${s.x1 - 7} L${s.x1 - 2} ${top}Z`} fill="#3a3540" />
      {[0.22, 0.7].map((f) => (
        <g key={f} fill="#3d302a">
          <rect x={s.x0 + w * f} y={top - 15} width={7} height={10} />
          <rect x={s.x0 + w * f - 0.6} y={top - 16} width={8.2} height={1.6} fill="#5a4a40" />
        </g>
      ))}
      {[0, 1, 2].map((i) => (
        <rect key={i} x={s.x0 + 10 + i * (w - 24) / 2} y={top - 6} width={5} height={5} fill="#1c232c" />
      ))}
      <rect x={s.x0} y={top} width={w} height={PAVE_TOP - top + 2} fill="#7d6a54" />
      <rect x={s.x0 - 1} y={top - 1.6} width={w + 2} height={2.6} fill="#a8977a" />
      <rect x={s.x0} y={PAVE_TOP - 12} width={w} height={1.2} fill="#a8977a" />
      {[0, 1, 2, 3].map((row) =>
        Array.from({ length: cols }, (_, c) => {
          const x = s.x0 + 8 + c * step + (step - 6) / 2;
          const y = top + 6 + row * 12.5;
          if (row === 3 && c === 1) return null; // the front door sits here
          return (
            <g key={`${row}-${c}`}>
              <rect x={x - 0.8} y={y - 1} width={7.6} height={1} fill="#a8977a" />
              <rect x={x} y={y} width={6} height={8} fill="#1c232c" />
              <rect x={x} y={y} width={6} height={3.4} fill="#56667a" opacity={0.35} />
              <rect x={x - 0.8} y={y + 8} width={7.6} height={1} fill="#a8977a" />
            </g>
          );
        }),
      )}
      {/* front door with steps */}
      <rect x={s.x0 + 8 + step + (step - 8) / 2} y={PAVE_TOP - 13} width={8} height={13} fill="#2d1f17" />
      <path d={`M${s.x0 + 8 + step + (step - 8) / 2} ${PAVE_TOP - 13} a4 4 0 0 1 8 0Z`} fill="#c9a25a" opacity={0.5} />
      <rect x={s.x0 + 6 + step + (step - 8) / 2} y={PAVE_TOP - 1.5} width={12} height={1.5} fill="#8a7a66" />
    </g>
  );
}

function Shop({ L }: { L: SkyLayout }) {
  const s = L.shop!;
  const w = s.x1 - s.x0;
  const top = PAVE_TOP - 40;
  return (
    <g>
      <rect x={s.x0} y={top} width={w} height={42} fill="#5a4a3e" />
      <rect x={s.x0} y={top} width={w} height={42} fill="url(#sk-brick)" />
      <rect x={s.x0 - 1} y={top - 2} width={w + 2} height={2.6} fill="#8a7a66" />
      {Array.from({ length: Math.floor((w - 10) / 14) }, (_, i) => (
        <g key={i}>
          <rect x={s.x0 + 8 + i * 14} y={top + 6} width={5} height={7.5} fill="#1c232c" />
          <rect x={s.x0 + 8 + i * 14} y={top + 6} width={5} height={3} fill="#56667a" opacity={0.35} />
        </g>
      ))}
      {/* sign */}
      <rect x={s.x0 + 6} y={PAVE_TOP - 24} width={w - 12} height={7.5} fill="#24402f" stroke="#c9a25a" strokeWidth={0.6} />
      <text x={(s.x0 + s.x1) / 2} y={PAVE_TOP - 18.6} textAnchor="middle" fontSize={5} fontWeight={700} fill="#e8c983" style={{ fontFamily: "var(--font-display), serif", letterSpacing: ".4px" }}>
        СЫРЫ · ПИРОГИ
      </text>
      {/* shop window & door */}
      <rect x={s.x0 + 5} y={PAVE_TOP - 15} width={w - 26} height={13} fill="#1c232c" stroke="#3a2a20" strokeWidth={1} />
      <rect x={s.x1 - 17} y={PAVE_TOP - 15} width={9} height={15} fill="#2a1d16" />
      {/* cheese wheels in the window */}
      {Array.from({ length: Math.floor((w - 32) / 9) }, (_, i) => (
        <g key={i}>
          <ellipse cx={s.x0 + 11 + i * 9} cy={PAVE_TOP - 4.4} rx={3.6} ry={2.2} fill="#e8b84b" />
          <path d={`M${s.x0 + 11 + i * 9} ${PAVE_TOP - 4.4} l3.4 -1 v1.8Z`} fill="#c98a3a" />
        </g>
      ))}
      {/* awning */}
      <path d={`M${s.x0 + 2} ${PAVE_TOP - 16.5} H${s.x1 - 2} L${s.x1 + 3} ${PAVE_TOP - 11} H${s.x0 - 3}Z`} fill="#8a2a22" />
      <path d={`M${s.x0 + 2} ${PAVE_TOP - 16.5} H${s.x1 - 2} L${s.x1 + 3} ${PAVE_TOP - 11} H${s.x0 - 3}Z`} fill="url(#sk-stripes)" opacity={0.75} />
    </g>
  );
}

/** The terminus: stone front, glass train shed behind, the great clock (hands drawn by StationClock). */
function Station({ L }: { L: SkyLayout }) {
  const s = L.station!;
  const m = s.mid;
  const stone = "#b3a385";
  const trim = "#8a7a62";
  return (
    <g>
      {/* glass shed */}
      <path d={`M${s.x0 + 26} ${PAVE_TOP} V34 Q${m} 4 ${s.x1 - 26} 34 V${PAVE_TOP}Z`} fill="#9fb3bf" opacity={0.32} />
      {Array.from({ length: 9 }, (_, i) => {
        const x = s.x0 + 26 + ((s.x1 - s.x0 - 52) * (i + 0.5)) / 9;
        return <line key={i} x1={x} y1={PAVE_TOP} x2={x} y2={18 + Math.abs(x - m) * 0.14} stroke="#5a6a74" strokeWidth={0.6} opacity={0.6} />;
      })}
      {/* wings */}
      <rect x={s.x0} y={34} width={m - 58 - s.x0} height={38} fill={stone} />
      <rect x={m + 58} y={34} width={s.x1 - m - 58} height={38} fill={stone} />
      <rect x={s.x0 - 1} y={32.5} width={s.x1 - s.x0 + 2} height={2} fill={trim} />
      {[...arches(s.x0 + 26, m - 62), ...arches(m + 62, s.x1 - 26)].map((x, i) => (
        <g key={i}>
          <path d={`M${x - 3.2} 66 V48 a3.2 3.2 0 0 1 6.4 0 V66Z`} fill="#1c232c" />
          <rect x={x - 3.2} y={48} width={6.4} height={4} fill="#56667a" opacity={0.3} />
        </g>
      ))}
      {/* towers */}
      {[s.x0, s.x1 - 24].map((x) => (
        <g key={x}>
          <rect x={x} y={12} width={24} height={60} fill={stone} />
          <path d={`M${x - 1} 12 L${x + 12} 1 L${x + 25} 12Z`} fill="#4a4550" />
          <rect x={x + 9} y={20} width={6} height={10} fill="#1c232c" />
          <rect x={x + 9} y={38} width={6} height={10} fill="#1c232c" />
          <rect x={x - 1} y={11.5} width={26} height={1.6} fill={trim} />
        </g>
      ))}
      {/* central block */}
      <rect x={m - 58} y={20} width={116} height={52} fill="#c2b292" />
      <path d={`M${m - 60} 20 L${m} 6 L${m + 60} 20Z`} fill="#a89878" stroke={trim} strokeWidth={0.8} />
      <rect x={m - 60} y={19.2} width={120} height={1.8} fill={trim} />
      <path d={`M${m - 30} 70 V44 a30 18 0 0 1 60 0 V70Z`} fill="#1f2a33" />
      <path d={`M${m - 30} 70 V44 a30 18 0 0 1 60 0 V70Z`} fill="none" stroke={trim} strokeWidth={1.4} />
      {[-20, -10, 0, 10, 20].map((dx) => (
        <line key={dx} x1={m + dx} y1={70} x2={m + dx} y2={dx === 0 ? 26.5 : 29 + Math.abs(dx) * 0.25} stroke="#5a6a74" strokeWidth={0.7} />
      ))}
      <line x1={m - 30} y1={52} x2={m + 30} y2={52} stroke="#5a6a74" strokeWidth={0.7} />
      <rect x={m - 40} y={35} width={80} height={6} fill="#2a3a2e" />
      <text x={m} y={39.7} textAnchor="middle" fontSize={4.4} fontWeight={700} fill="#e8c983" style={{ fontFamily: "var(--font-display), serif", letterSpacing: ".5px" }}>
        БОЛЬШОЙ ВОКЗАЛ
      </text>
      {/* clock face */}
      <circle cx={m} cy={25} r={8.6} fill="#3a3540" />
      <circle cx={m} cy={25} r={7.4} fill="#efe6d0" stroke="#c9a25a" strokeWidth={0.9} />
      {Array.from({ length: 12 }, (_, i) => (
        <rect key={i} x={m - 0.3} y={18.3} width={0.6} height={1.3} fill="#2a1f14" transform={`rotate(${i * 30} ${m} 25)`} />
      ))}
    </g>
  );
}

function arches(a: number, b: number): number[] {
  const out: number[] = [];
  for (let x = a + 6; x < b - 3; x += 12) out.push(x);
  return out;
}

/** Hour and minute hands of the station clock (the human time). */
export const StationClock = memo(function StationClock({ L, minute }: { L: SkyLayout; minute: number }) {
  if (!L.station) return null;
  const m = L.station.mid;
  const hA = ((minute % 720) / 720) * 360;
  const mA = ((minute % 60) / 60) * 360;
  return (
    <g>
      <line x1={m} y1={25} x2={m} y2={20.6} stroke="#2a1f14" strokeWidth={1.1} strokeLinecap="round" transform={`rotate(${hA} ${m} 25)`} />
      <line x1={m} y1={25} x2={m} y2={18.8} stroke="#2a1f14" strokeWidth={0.7} strokeLinecap="round" transform={`rotate(${mA} ${m} 25)`} />
      <circle cx={m} cy={25} r={0.8} fill="#c9a25a" />
    </g>
  );
});

/* ================================================================ near */

export const NearGround = memo(function NearGround({ L }: { L: SkyLayout }) {
  const end = L.cut ?? L.W + MARGIN;
  const x0 = -MARGIN;
  const w = end - x0;
  return (
    <g>
      {/* pavement */}
      <rect x={x0} y={PAVE_TOP} width={w} height={PAVE_FRONT - PAVE_TOP} fill="#6f665b" />
      <rect x={x0} y={PAVE_TOP} width={w} height={PAVE_FRONT - PAVE_TOP} fill="url(#sk-slabs)" />
      <rect x={x0} y={PAVE_TOP} width={w} height={0.9} fill="#000" opacity={0.3} />
      {/* curb & road */}
      <rect x={x0} y={PAVE_FRONT} width={w} height={ROAD_TOP - PAVE_FRONT} fill="#8b8172" />
      <rect x={x0} y={PAVE_FRONT} width={w} height={0.6} fill="#b0a690" />
      <rect x={x0} y={ROAD_TOP} width={w} height={H - ROAD_TOP + 2} fill="#463d35" />
      <rect x={x0} y={ROAD_TOP} width={w} height={H - ROAD_TOP + 2} fill="url(#sk-cobbles2)" />
      <rect x={x0} y={ROAD_TOP} width={w} height={1.3} fill="#000" opacity={0.35} />
      {L.house && <LightWell x={L.house.win} />}
      {L.manhole !== null && <Manhole x={L.manhole} />}
      <Grate x={L.grate} />
      {L.cut !== null && <Cutting L={L} />}
      {L.entrance && <Entrance L={L} />}
    </g>
  );
});

function Grate({ x }: { x: number }) {
  return (
    <g>
      <rect x={x - 13.5} y={80.4} width={27} height={4.6} rx={0.9} fill="#120f0d" stroke="#8a7f6e" strokeWidth={0.8} />
      {Array.from({ length: 9 }, (_, i) => (
        <line key={i} x1={x - 10.4 + i * 2.6} y1={80.9} x2={x - 10.4 + i * 2.6} y2={84.5} stroke="#6e6456" strokeWidth={0.9} />
      ))}
    </g>
  );
}

function Manhole({ x }: { x: number }) {
  return (
    <g>
      <ellipse cx={x} cy={84} rx={9} ry={2.5} fill="#3a332c" stroke="#7a7060" strokeWidth={0.7} />
      <ellipse cx={x} cy={84} rx={6.2} ry={1.6} fill="none" stroke="#5a5046" strokeWidth={0.5} />
      <path d={`M${x - 6} 84 H${x + 6} M${x} 82.4 V85.6`} stroke="#5a5046" strokeWidth={0.5} />
    </g>
  );
}

/** Basement window in a railed light-well in front of the town house. */
function LightWell({ x }: { x: number }) {
  return (
    <g>
      <rect x={x - 10} y={PAVE_TOP} width={20} height={4.8} fill="#17120f" />
      <rect x={x - 6.5} y={PAVE_TOP + 0.6} width={13} height={3.6} fill="#262c30" />
      {[-3.2, 0, 3.2].map((d) => (
        <line key={d} x1={x + d} y1={PAVE_TOP + 0.6} x2={x + d} y2={PAVE_TOP + 4.2} stroke="#3a3530" strokeWidth={0.5} />
      ))}
      <rect x={x - 11} y={PAVE_TOP - 5.8} width={22} height={6} fill="url(#sk-rails)" />
      <rect x={x - 11} y={PAVE_TOP - 6} width={22} height={0.7} fill="#1a1715" />
    </g>
  );
}

/** Open railway cutting (metro+): retaining wall, railing, platform with a canopy, tunnel portal. */
function Cutting({ L }: { L: SkyLayout }) {
  const c = L.cut!;
  const end = L.W + MARGIN;
  const w = end - c;
  return (
    <g>
      <rect x={c} y={52} width={w} height={8} fill="url(#sk-rails)" />
      <rect x={c} y={51.6} width={w} height={0.9} fill="#1a1715" />
      <rect x={c} y={59.5} width={w} height={2.6} fill="#8b8172" />
      <rect x={c} y={62} width={w} height={28} fill="#4a3530" />
      <rect x={c} y={62} width={w} height={28} fill="url(#sk-brick)" />
      <rect x={c} y={62} width={w} height={3} fill="#000" opacity={0.3} />
      {/* platform with canopy and a few waiting gentlemen */}
      <g>
        <rect x={c + 30} y={64} width={150} height={1.6} fill="#5a4a3e" />
        <rect x={c + 30} y={65.4} width={150} height={1.6} fill="url(#sk-valance)" />
        {[c + 36, c + 80, c + 124, c + 172].map((x) => (
          <rect key={x} x={x} y={65} width={1} height={9} fill="#3a302a" />
        ))}
        <rect x={c + 28} y={73.6} width={156} height={14.4} fill="#7a7062" />
        <rect x={c + 28} y={73.6} width={156} height={0.8} fill="#e2d6bc" />
        {[c + 52, c + 96, c + 140].map((x, i) => (
          <TinyGent key={x} x={x} y={73.6} hat={i !== 1} />
        ))}
      </g>
      <rect x={c} y={84.4} width={w} height={4} fill="#28221d" />
      <line x1={c} y1={85.8} x2={end} y2={85.8} stroke="#a8a294" strokeWidth={0.8} />
      {/* tunnel portal under the station entrance */}
      <rect x={c - 3} y={60} width={27} height={30} fill="#5a4038" />
      <rect x={c - 3} y={60} width={27} height={30} fill="url(#sk-brick)" />
      <path d={`M${c + 1} 90 V73 Q${c + 1} 65.5 ${c + 10.5} 65.5 Q${c + 20} 65.5 ${c + 20} 73 V90Z`} fill="url(#sk-portal)" />
      <path d={`M${c + 1} 73 Q${c + 1} 65.5 ${c + 10.5} 65.5 Q${c + 20} 65.5 ${c + 20} 73`} fill="none" stroke="#8b8172" strokeWidth={1.2} />
    </g>
  );
}

function TinyGent({ x, y, hat }: { x: number; y: number; hat: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) scale(.72)`} fill="#1d1b22">
      <rect x={-1.6} y={-7} width={1.2} height={7} />
      <rect x={0.4} y={-7} width={1.2} height={7} />
      <path d="M-3 -7 L-2.4 -15 H2.4 L3 -7Z" />
      <circle cx={0} cy={-16.6} r={2} fill="#c9a88a" />
      {hat ? <rect x={-1.7} y={-23} width={3.4} height={5} /> : <path d="M-2.4 -18 A2.4 2 0 0 1 2.4 -18Z" />}
      {hat && <rect x={-2.8} y={-18.4} width={5.6} height={0.8} />}
    </g>
  );
}

export const NearProps = memo(function NearProps({ L }: { L: SkyLayout }) {
  return (
    <g>
      {L.lamps.map((x) => (
        <LampPost key={x} x={x} />
      ))}
      {L.pillar !== null && <Pillar x={L.pillar} />}
    </g>
  );
});

function LampPost({ x }: { x: number }) {
  return (
    <g fill="#1d1a17">
      <rect x={x - 1.8} y={75.4} width={3.6} height={1.8} rx={0.4} />
      <rect x={x - 0.75} y={47} width={1.5} height={29} />
      <rect x={x - 3.2} y={50} width={6.4} height={0.8} />
      <path d={`M${x - 2.8} 43 H${x + 2.8} L${x + 2.1} 49.2 H${x - 2.1}Z`} fill="#4a4836" stroke="#1d1a17" strokeWidth={0.6} />
      <path d={`M${x - 3.4} 43.2 L${x} 40.4 L${x + 3.4} 43.2Z`} />
      <rect x={x - 0.4} y={38.8} width={0.8} height={1.8} />
    </g>
  );
}

function Pillar({ x }: { x: number }) {
  return (
    <g>
      <rect x={x + 4.6} y={44} width={2.8} height={33} rx={1} fill="#b6dad8" opacity={0.28} stroke="#c9a25a" strokeWidth={0.4} />
      {[50, 60, 70].map((y) => (
        <rect key={y} x={x + 4.2} y={y} width={3.6} height={1.1} fill="#c9a25a" />
      ))}
      <rect x={x - 4.8} y={74} width={9.6} height={3} fill="#7d5f2c" />
      <rect x={x - 3.4} y={52} width={6.8} height={22.5} fill="url(#sk-brass)" />
      <rect x={x - 4.3} y={50.6} width={8.6} height={2} fill="#7d5f2c" />
      <path d={`M${x - 3.8} 50.8 A3.8 4.6 0 0 1 ${x + 3.8} 50.8Z`} fill="url(#sk-brass)" />
      <circle cx={x} cy={44.9} r={0.9} fill="#e8c983" />
      <circle cx={x} cy={58} r={2.1} fill="#efe6d0" stroke="#5e4520" strokeWidth={0.5} />
      <line x1={x} y1={58} x2={x + 1.3} y2={57} stroke="#2a1f14" strokeWidth={0.4} />
      <rect x={x - 2.2} y={63} width={4.4} height={2.6} fill="#2a1f14" opacity={0.6} />
    </g>
  );
}

function Entrance({ L }: { L: SkyLayout }) {
  const e = L.entrance!;
  const w = e.x1 - e.x0;
  const d = e.door;
  return (
    <g>
      <rect x={e.x0} y={42} width={w} height={36} fill="#8d7c66" />
      <rect x={e.x0} y={42} width={w} height={36} fill="url(#sk-brick)" />
      <rect x={e.x0 - 1.2} y={40.6} width={w + 2.4} height={2.4} fill="#6a5c4c" />
      {[e.x0 + 2, e.x1 - 2].map((x) => (
        <circle key={x} cx={x} cy={39.4} r={1.4} fill="#6a5c4c" />
      ))}
      <rect x={e.x0 + 3} y={45.5} width={w - 6} height={7.6} fill="#7a2620" stroke="#c9a25a" strokeWidth={0.5} />
      <text x={(e.x0 + e.x1) / 2} y={51.1} textAnchor="middle" fontSize={5} fontWeight={700} fill="#f2e6c8" style={{ fontFamily: "var(--font-display), serif", letterSpacing: ".3px" }}>
        ПОДЗЕМКА
      </text>
      <path d={`M${d - 10} 77 V63 Q${d - 10} 56.5 ${d} 56.5 Q${d + 10} 56.5 ${d + 10} 63 V77Z`} fill="url(#sk-door)" />
      <path d={`M${d - 10} 63 Q${d - 10} 56.5 ${d} 56.5 Q${d + 10} 56.5 ${d + 10} 63`} fill="none" stroke="#c9a25a" strokeWidth={0.7} />
      {[70, 72.6, 75.2].map((y, i) => (
        <rect key={y} x={d - 8 + i} y={y} width={16 - i * 2} height={0.8} fill="#4a4036" opacity={0.8} />
      ))}
      {[d - 13.5, d + 13.5].map((x) => (
        <g key={x}>
          <rect x={x - 0.4} y={58} width={0.8} height={5} fill="#1d1a17" />
          <circle cx={x} cy={57.4} r={1.9} fill="#d8cfb8" />
        </g>
      ))}
    </g>
  );
}

/* ================================================================ lights (drawn above the tint) */

export const MidLights = memo(function MidLights({ houses, L, look }: { houses: House[]; L: SkyLayout; look: SkyLook }) {
  const lit = look.windows;
  const glowA = Math.min(1, 0.35 + look.dark);
  return (
    <g>
      {lit > 0.005 &&
        houses.map((h) =>
          h.windows
            .filter((w) => w.r < lit)
            .map((w, j) => (
              <g key={`${h.x}-${j}`} opacity={glowA}>
                <rect x={w.x - 0.8} y={w.y - 0.8} width={w.w + 1.6} height={w.h + 1.6} fill="#f2b84b" opacity={0.22} />
                <rect x={w.x} y={w.y} width={w.w} height={w.h} fill={w.r < lit * 0.5 ? "#ffd27a" : "#e8a85a"} />
              </g>
            )),
        )}
      {L.shop && lit > 0.005 && (
        <rect x={L.shop.x0 + 5.5} y={PAVE_TOP - 14.5} width={L.shop.x1 - L.shop.x0 - 27} height={8} fill="#ffcf73" opacity={0.55 * glowA} />
      )}
      {L.station && look.dark > 0.2 && (
        <g opacity={look.dark}>
          <path d={`M${L.station.mid - 29} 69 V44 a29 17 0 0 1 58 0 V69Z`} fill="#f2c86a" opacity={0.45} />
          <circle cx={L.station.mid} cy={25} r={9} fill="#fff1c9" opacity={0.35} />
        </g>
      )}
    </g>
  );
});

export const NearLights = memo(function NearLights({ L, look, z }: { L: SkyLayout; look: SkyLook; z: number }) {
  const m = look.minute;
  const glow = 0.3 + 0.7 * look.dark;
  return (
    <g>
      {/* the colony glows under the grate */}
      <ellipse cx={L.grate} cy={82.6} rx={16} ry={4} fill="url(#sk-grateglow)" opacity={0.25 + 0.55 * look.dark} />
      {look.dark > 0.25 && (
        <path
          className="sk-flicker"
          d={`M${L.grate - 11} 81.5 L${L.grate + 11} 81.5 L${L.grate + 19} 40 L${L.grate - 19} 40Z`}
          fill="url(#sk-ray)"
          opacity={0.26 * look.dark}
        />
      )}
      {L.house && (
        <rect x={L.house.win - 6.5} y={PAVE_TOP + 0.6} width={13} height={3.6} fill="#f2b84b" opacity={0.35 + 0.4 * look.dark} />
      )}
      {L.lamps.map((x, i) =>
        lampLit(m, i) ? (
          <g key={x}>
            <ellipse cx={x} cy={PAVE_FRONT} rx={15} ry={2.6} fill="url(#sk-pool)" opacity={glow} />
            <circle cx={x} cy={46} r={17} fill="url(#sk-halo)" opacity={glow} />
            <path className="sk-flicker" d={`M${x - 2.4} 43.4 H${x + 2.4} L${x + 1.8} 48.8 H${x - 1.8}Z`} fill="#ffe3a0" />
          </g>
        ) : null,
      )}
      {L.entrance && look.dark > 0.3 && (
        <g>
          {[L.entrance.door - 13.5, L.entrance.door + 13.5].map((x) => (
            <g key={x}>
              <circle cx={x} cy={57.4} r={9} fill="url(#sk-halo)" opacity={look.dark} />
              <circle cx={x} cy={57.4} r={1.9} fill="#fff1c9" />
            </g>
          ))}
          <path d={`M${L.entrance.door - 9} 77 V63 Q${L.entrance.door - 9} 57.5 ${L.entrance.door} 57.5 Q${L.entrance.door + 9} 57.5 ${L.entrance.door + 9} 63 V77Z`} fill="#f2b84b" opacity={0.18 * look.dark} />
        </g>
      )}
      {z >= 2 && L.pillar !== null && look.dark > 0.3 && <circle cx={L.pillar} cy={58} r={2.1} fill="#fff1c9" opacity={0.7 * look.dark} />}
    </g>
  );
});
