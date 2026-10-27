"use client";

/**
 * The Rat Express locomotive, assembled from junk part by part (GDD 5.2).
 * Built stages are drawn in full; the stage under construction shows as a faint blueprint
 * that fills in left-to-right with the contribution progress.
 */
import { memo, useId, type ReactNode } from "react";
import { plural } from "./common";

/** Horizontal extent of every part, for the "being built" reveal clip. */
const BBOX: Record<number, [number, number]> = {
  1: [212, 358],
  2: [236, 346],
  3: [220, 354],
  4: [242, 344],
  5: [258, 296],
  6: [8, 182],
  7: [180, 226],
  8: [232, 262],
  9: [8, 350],
  10: [0, 360],
};

/** Back-to-front drawing order of the parts (stage numbers). */
const ORDER = [6, 7, 1, 3, 5, 8, 2, 4, 9, 10];

function WatchWheel({ cx, cy, r, spin }: { cx: number; cy: number; r: number; spin: boolean }) {
  return (
    <g className={spin ? "rr-spin" : undefined}>
      <circle cx={cx} cy={cy} r={r} fill="#efe3c4" stroke="#c9a25a" strokeWidth={2.5} />
      <circle cx={cx} cy={cy} r={r - 3} fill="none" stroke="#7d5f2c" strokeWidth={0.6} />
      {[0, 90, 180, 270].map((a) => {
        const rad = (a * Math.PI) / 180;
        return (
          <line
            key={a}
            x1={cx + Math.cos(rad) * (r - 4.5)}
            y1={cy + Math.sin(rad) * (r - 4.5)}
            x2={cx + Math.cos(rad) * (r - 2.5)}
            y2={cy + Math.sin(rad) * (r - 2.5)}
            stroke="#3b2a1a"
            strokeWidth={1}
          />
        );
      })}
      <line x1={cx} y1={cy} x2={cx} y2={cy - r * 0.55} stroke="#3b2a1a" strokeWidth={1.2} strokeLinecap="round" />
      <line x1={cx} y1={cy} x2={cx + r * 0.38} y2={cy + 1} stroke="#3b2a1a" strokeWidth={1.2} strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={1.4} fill="#c4453a" />
    </g>
  );
}

function SmallWheel({ cx, cy, r, spin }: { cx: number; cy: number; r: number; spin: boolean }) {
  return (
    <g className={spin ? "rr-spin" : undefined}>
      <circle cx={cx} cy={cy} r={r} fill="#2a2833" stroke="#7d5f2c" strokeWidth={1.6} />
      <line x1={cx - r + 2} y1={cy} x2={cx + r - 2} y2={cy} stroke="#6b6b78" strokeWidth={1} />
      <line x1={cx} y1={cy - r + 2} x2={cx} y2={cy + r - 2} stroke="#6b6b78" strokeWidth={1} />
    </g>
  );
}

function parts(ids: { copper: string; silver: string; gold: string }, moving: boolean): Record<number, ReactNode> {
  const copper = `url(#${ids.copper})`;
  const silver = `url(#${ids.silver})`;
  const gold = `url(#${ids.gold})`;
  return {
    // 1. Frame of knitting needles
    1: (
      <>
        <rect x={214} y={98} width={14} height={3} fill="#4a3a2a" />
        <rect x={226} y={96} width={124} height={6} rx={2} fill="#7d5f2c" />
        <line x1={222} y1={93} x2={354} y2={93} stroke="#cfcfc8" strokeWidth={2.2} strokeLinecap="round" />
        <circle cx={220} cy={93} r={3.4} fill="#c4453a" />
        <line x1={224} y1={105} x2={352} y2={105} stroke="#cfcfc8" strokeWidth={2.2} strokeLinecap="round" />
        <circle cx={222} cy={105} r={3.2} fill="#4f9d8a" />
        <rect x={350} y={90} width={7} height={16} rx={1.5} fill="#4a3a2a" stroke="#7d5f2c" />
      </>
    ),
    // 2. Wheel pairs from pocket watches
    2: (
      <>
        <WatchWheel cx={250} cy={111} r={11} spin={moving} />
        <WatchWheel cx={276} cy={111} r={11} spin={moving} />
        <WatchWheel cx={302} cy={111} r={11} spin={moving} />
        <SmallWheel cx={336} cy={114} r={8} spin={moving} />
      </>
    ),
    // 3. Boiler from a copper kettle (with the cab)
    3: (
      <>
        <path d="M222 52 Q243 41 264 52 Z" fill="#5a4632" stroke="#3b2a1a" />
        <rect x={226} y={52} width={34} height={44} rx={2} fill="#3b3022" stroke="#7d5f2c" />
        <rect x={233} y={59} width={14} height={14} rx={2} fill="#f2b84b" fillOpacity={0.75} stroke="#7d5f2c" />
        <rect x={258} y={66} width={88} height={30} rx={13} fill={copper} stroke="#5a2e17" strokeWidth={1.2} />
        <path d="M276 66 Q292 50 308 66" fill="none" stroke="#7d5f2c" strokeWidth={3} strokeLinecap="round" />
        <path d="M318 66 L322 45 L334 45 L338 66 Z" fill={copper} stroke="#5a2e17" />
        <rect x={318} y={40} width={20} height={6} rx={2} fill="#b8693d" stroke="#5a2e17" />
        <ellipse cx={346} cy={81} rx={7} ry={15} fill="#2a2833" stroke="#7d5f2c" strokeWidth={1.4} />
        {[268, 288, 308, 328].map((x) => (
          <circle key={x} cx={x} cy={90} r={1.2} fill="#5a2e17" />
        ))}
      </>
    ),
    // 4. Pistons from thimbles
    4: (
      <>
        <rect x={316} y={96} width={24} height={13} rx={5} fill="#c9bfa8" stroke="#7a6b57" />
        {[321, 327, 333].map((x) => (
          <g key={x}>
            <circle cx={x} cy={100} r={0.9} fill="#7a6b57" />
            <circle cx={x + 3} cy={104} r={0.9} fill="#7a6b57" />
          </g>
        ))}
        <line x1={250} y1={115} x2={302} y2={115} stroke="#cfcfc8" strokeWidth={3} strokeLinecap="round" />
        <line x1={318} y1={103} x2={300} y2={114} stroke="#b0c4cc" strokeWidth={2.4} strokeLinecap="round" />
      </>
    ),
    // 5. Whistle from a smoking pipe
    5: (
      <>
        <path d="M270 63 Q282 72 294 64" fill="none" stroke="#3b2a1a" strokeWidth={3} strokeLinecap="round" />
        <rect x={262} y={50} width={11} height={15} rx={3} fill="#6b3f22" stroke="#3b2a1a" />
        <ellipse cx={267.5} cy={50.5} rx={5.5} ry={1.6} fill="#1b1613" />
      </>
    ),
    // 6. Cars from snuffboxes
    6: (
      <>
        {[14, 100].map((x) => (
          <g key={x}>
            <rect x={x} y={72} width={78} height={32} rx={4} fill={silver} stroke="#4a5257" />
            <line x1={x + 2} y1={79} x2={x + 76} y2={79} stroke="#4a5257" strokeWidth={0.8} />
            <ellipse cx={x + 39} cy={92} rx={9} ry={6} fill="none" stroke="#6b7378" strokeWidth={0.8} />
            {[10, 52].map((dx) => (
              <rect key={dx} x={x + dx} y={83} width={14} height={10} rx={1.5} fill="#f2b84b" fillOpacity={0.7} stroke="#4a5257" />
            ))}
            <SmallWheel cx={x + 14} cy={114} r={8} spin={moving} />
            <SmallWheel cx={x + 64} cy={114} r={8} spin={moving} />
          </g>
        ))}
        <rect x={92} y={96} width={8} height={3} fill="#4a3a2a" />
        <rect x={178} y={96} width={8} height={3} fill="#4a3a2a" />
      </>
    ),
    // 7. Tender from a matchbox factory
    7: (
      <>
        {[188, 193, 198, 203, 208, 213, 218].map((x, i) => (
          <g key={x}>
            <line x1={x} y1={75} x2={x + (i % 2 ? 1 : -1)} y2={62 + (i % 3) * 2} stroke="#e9dcc0" strokeWidth={2} strokeLinecap="round" />
            <circle cx={x + (i % 2 ? 1 : -1)} cy={61 + (i % 3) * 2} r={2.3} fill="#c4453a" />
          </g>
        ))}
        <rect x={184} y={74} width={38} height={30} rx={2} fill="#c4453a" stroke="#5a1c17" />
        <rect x={189} y={80} width={28} height={16} rx={1} fill="#eadcc0" />
        {/* lettering painted on the matchbox: part of the drawing, not text to read */}
        <text aria-hidden x={203} y={91} textAnchor="middle" fontSize={7} fontWeight={700} fill="#5a1c17" fontFamily="serif">
          СПИЧКИ
        </text>
        <SmallWheel cx={192} cy={114} r={7} spin={moving} />
        <SmallWheel cx={214} cy={114} r={7} spin={moving} />
      </>
    ),
    // 8. Clockwork regulator
    8: (
      <>
        <circle cx={255} cy={88} r={4.2} fill="none" stroke="#c9a25a" strokeWidth={2} strokeDasharray="1.6 1.2" />
        <circle cx={243} cy={84} r={7.5} fill="#efe3c4" stroke="#c9a25a" strokeWidth={1.6} />
        <line x1={243} y1={84} x2={243} y2={79} stroke="#3b2a1a" strokeWidth={1} strokeLinecap="round" />
        <line x1={243} y1={84} x2={246.5} y2={85.5} stroke="#3b2a1a" strokeWidth={1} strokeLinecap="round" />
      </>
    ),
    // 9. Gilding and the Rat King's crest
    9: (
      <>
        {[284, 304, 324].map((x) => (
          <rect key={x} x={x} y={66} width={3} height={30} fill={gold} />
        ))}
        <path d="M222 52 Q243 41 264 52" fill="none" stroke={gold} strokeWidth={2} />
        <path d="M236 47 L238 40 L241 45 L243 38 L245 45 L248 40 L250 47 Z" fill={gold} stroke="#7d5f2c" strokeWidth={0.6} />
        {[14, 100].map((x) => (
          <rect key={x} x={x + 2.5} y={74.5} width={73} height={27} rx={3} fill="none" stroke={gold} strokeWidth={1.2} />
        ))}
      </>
    ),
    // 10. Departure: pennant, headlamp, steam
    10: (
      <>
        <line x1={228} y1={50} x2={228} y2={30} stroke="#7d5f2c" strokeWidth={1.4} />
        <path d="M228 30 L244 34 L228 38 Z" fill="#c4453a" className={moving ? "rr-sway" : undefined} />
        <circle cx={352} cy={72} r={4} fill="#f2b84b" />
        <circle cx={352} cy={72} r={9} fill="#f2b84b" fillOpacity={0.25} />
        {[0, 0.6, 1.2].map((delay) => (
          <circle key={delay} cx={328} cy={34} r={7} fill="#cfd6d6" fillOpacity={0.8} className={moving ? "rr-puff" : undefined} style={{ animationDelay: `${delay}s` }} />
        ))}
        {[80, 92, 104].map((y) => (
          <line key={y} x1={0} y1={y} x2={8} y2={y} stroke="#a8977a" strokeWidth={1.2} strokeLinecap="round" opacity={0.6} />
        ))}
      </>
    ),
  };
}

function Locomotive({ stage, wagons, frac, calm }: { stage: number; wagons: number; frac: number; calm: boolean }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const ids = { copper: `${uid}cu`, silver: `${uid}ag`, gold: `${uid}au`, clip: `${uid}clip` };
  const moving = stage >= 10 && !calm;
  const P = parts(ids, moving);
  const building = stage < 10 ? stage + 1 : null;
  const box = building ? BBOX[building] : null;

  return (
    <svg viewBox="0 0 360 132" className="block h-auto w-full" role="img" aria-label={`Крысиный экспресс: построено этапов ${Math.min(stage, 10)} из 10`}>
      <defs>
        <linearGradient id={ids.copper} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e8a476" />
          <stop offset=".45" stopColor="#b8693d" />
          <stop offset="1" stopColor="#6e3a1d" />
        </linearGradient>
        <linearGradient id={ids.silver} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e4eaea" />
          <stop offset=".5" stopColor="#a9b2b6" />
          <stop offset="1" stopColor="#6b7378" />
        </linearGradient>
        <linearGradient id={ids.gold} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fbe6a0" />
          <stop offset=".5" stopColor="#d4af37" />
          <stop offset="1" stopColor="#8a6a1c" />
        </linearGradient>
        {box && (
          <clipPath id={ids.clip}>
            <rect x={box[0]} y={0} width={(box[1] - box[0]) * frac} height={132} />
          </clipPath>
        )}
      </defs>

      {/* rails */}
      {Array.from({ length: 26 }, (_, i) => (
        <rect key={i} x={i * 14 + 2} y={122} width={8} height={5} rx={1} fill="#3a2e22" />
      ))}
      <line x1={0} y1={122} x2={360} y2={122} stroke="#8a8a94" strokeWidth={2} />

      {ORDER.map((n) => {
        if (n <= stage) return <g key={n}>{P[n]}</g>;
        if (n !== building) return null;
        return (
          <g key={n}>
            <g opacity={0.16}>{P[n]}</g>
            <g clipPath={`url(#${ids.clip})`}>{P[n]}</g>
          </g>
        );
      })}

      {wagons > 0 && (
        <g>
          <rect x={4} y={6} width={92} height={18} rx={9} fill="#14110f" fillOpacity={0.8} stroke="#d4af37" />
          <text x={50} y={19} textAnchor="middle" fontSize={11} fontWeight={700} fill="#e8c983">
            +{wagons} {plural(wagons, "вагон", "вагона", "вагонов")}
          </text>
        </g>
      )}
    </svg>
  );
}

export default memo(Locomotive);
