"use client";

/**
 * Chamber illustrations per building and visual stage.
 * `lvl` is the reached VISUAL_TIERS threshold (1/5/10/25/50) or, for max-level buildings, the raw level.
 * Local coordinates: origin = chamber floor centre, art fits x ∈ [-80, 80], y ∈ [-130, 0].
 */
import type { ReactNode } from "react";
import { BUILDINGS } from "@/game/data/buildings";
import type { BuildingId, ZoneId } from "@/game/types";
import { lampX } from "./geometry";
import {
  BarrelEnd,
  Barrel,
  Book,
  BottleCap,
  Bunting,
  Candle,
  CandyTin,
  CheeseWedge,
  CheeseWheel,
  Coins,
  Cork,
  CrumbPile,
  Gear,
  Glow,
  Lantern,
  Matchbox,
  NICHE,
  Peg,
  Pennant,
  Pipe,
  RagPile,
  Shelf,
  Sign,
  Snuffbox,
  Sock,
  SpokeWheel,
  Spool,
  StarPlaque,
  Steam,
  Suitcase,
  Teapot,
  Thimble,
  ThimbleCart,
  TinCan,
} from "./parts";

const INK = "#1a120c";

/* ------------------------------------------------------------ local helpers */

function TopHat({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <rect x="-7" y="-16" width="14" height="14" rx="1" fill="#1d1a1f" stroke="#000" strokeWidth=".6" />
      <rect x="-7" y="-6" width="14" height="2.5" fill="#7a2a24" />
      <rect x="-11" y="-2.5" width="22" height="2.5" rx="1.2" fill="#1d1a1f" />
    </g>
  );
}

function Chute({ x, top, bottom, w = 20 }: { x: number; top: number; bottom: number; w?: number }) {
  const rings: ReactNode[] = [];
  for (let y = top + 12; y < bottom - 4; y += 14) rings.push(<path key={y} d={`M${x - w / 2} ${y}h${w}`} stroke="#6e757b" strokeWidth="1.2" />);
  return (
    <g>
      <rect x={x - w / 2} y={top} width={w} height={bottom - top} fill="url(#cv-silver)" stroke="#3b3f42" strokeWidth=".9" />
      {rings}
      <rect x={x - w / 2 - 3} y={bottom - 5} width={w + 6} height="5" rx="2" fill="#9aa2a8" stroke="#3b3f42" strokeWidth=".8" />
    </g>
  );
}

function Falling({ x, y, fall, items, color = "#e6c27a", size = 3 }: { x: number; y: number; fall: number; items: number; color?: string; size?: number }) {
  return (
    <g>
      {Array.from({ length: items }, (_, i) => (
        <rect
          key={i}
          x={x - 4 + ((i * 5) % 9)}
          y={y}
          width={size}
          height={size}
          rx="1"
          fill={color}
          className="cv-fall"
          style={{ animationDelay: `${(i * 1.4) / items}s`, ["--fall" as string]: `${fall}px` }}
        />
      ))}
    </g>
  );
}

function CoalPile({ x, y, w = 50 }: { x: number; y: number; w?: number }) {
  const lumps = [
    [-0.36, 4, 5],
    [-0.14, 9, 6],
    [0.1, 12, 7],
    [0.3, 6, 5],
    [-0.02, 3, 5],
    [0.2, 2, 4],
  ];
  return (
    <g>
      <path d={`M${x - w / 2} ${y}Q${x} ${y - w * 0.45} ${x + w / 2} ${y}z`} fill="#26232a" stroke="#0e0d10" strokeWidth=".8" />
      {lumps.map(([dx, dy, r], i) => (
        <path key={i} d={`M${x + dx * w - r} ${y - dy}l${r} ${-r}l${r} ${r * 0.6}l${-r * 0.4} ${r}z`} fill={i % 2 ? "#3a3640" : "#1a181d"} stroke="#55505c" strokeWidth=".5" />
      ))}
    </g>
  );
}

function Tenement({ x, y, cols, rows, colors }: { x: number; y: number; cols: number; rows: number; colors: string[] }) {
  const out: ReactNode[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) out.push(<Matchbox key={`${r}-${c}`} x={x + c * 36 + (r % 2) * 3} y={y - r * 22} w={34} h={22} color={colors[(r * cols + c) % colors.length]} windows={2} />);
  return <g>{out}</g>;
}

function Clothesline({ x1, x2, y }: { x1: number; x2: number; y: number }) {
  return (
    <g>
      <path d={`M${x1} ${y}Q${(x1 + x2) / 2} ${y + 6} ${x2} ${y}`} stroke="#d9c9a4" strokeWidth=".8" fill="none" />
      <rect x={(x1 + x2) / 2 - 12} y={y + 3} width="7" height="10" fill="#c4453a" />
      <rect x={(x1 + x2) / 2 + 2} y={y + 3} width="7" height="12" fill="#8fb8ff" />
    </g>
  );
}

function Slate({ x, y, w, h, text }: { x: number; y: number; w: number; h: number; text: string }) {
  return (
    <g>
      <rect x={x} y={y - h} width={w} height={h} rx="2" fill="#2f3a36" stroke="#a8743f" strokeWidth="3" />
      <text x={x + w / 2} y={y - h / 2 + 3} fontSize="9" textAnchor="middle" fill="#eadcc0" className="font-display cv-fine" fontWeight="700">
        {text}
      </text>
      <path d={`M${x + 6} ${y - 6}l10 -2`} stroke="#eadcc0" strokeWidth=".8" />
    </g>
  );
}

function Gauge({ x, y, r = 8, angle = -30 }: { x: number; y: number; r?: number; angle?: number }) {
  return (
    <g>
      <circle cx={x} cy={y} r={r} fill="#efe2c4" stroke="url(#cv-brass)" strokeWidth="2.5" />
      <path d={`M${x} ${y}l${Math.cos(((angle - 90) * Math.PI) / 180) * r * 0.8} ${Math.sin(((angle - 90) * Math.PI) / 180) * r * 0.8}`} stroke="#c4453a" strokeWidth="1.2" />
      <circle cx={x} cy={y} r="1.3" fill={INK} />
    </g>
  );
}

function Water({ w = 150, y = 0 }: { w?: number; y?: number }) {
  return (
    <g>
      <rect x={-w / 2} y={y - 12} width={w} height="12" fill="#2f6b6a" opacity=".85" />
      <g className="cv-wave">
        <path d={`M${-w / 2} ${y - 12}${Array.from({ length: Math.ceil(w / 24) + 3 }, () => "q6 -3 12 0t12 0").join("")}`} stroke="#7fd1b9" strokeWidth="1.4" fill="none" opacity=".8" />
      </g>
    </g>
  );
}

function Capsule({ x, y, rot = 0 }: { x: number; y: number; rot?: number }) {
  return (
    <g transform={`rotate(${rot} ${x} ${y})`}>
      <rect x={x - 12} y={y - 6} width="24" height="12" rx="6" fill="url(#cv-brass)" stroke={INK} strokeWidth=".8" />
      <path d={`M${x - 4} ${y - 6}v12M${x + 4} ${y - 6}v12`} stroke="#7d5f2c" strokeWidth="1" />
    </g>
  );
}

function Basket({ x, y, w = 56 }: { x: number; y: number; w?: number }) {
  const h = w * 0.42;
  return (
    <g>
      <path d={`M${x - w / 2 + 6} ${y - h - 4}Q${x} ${y - h - 30} ${x + w / 2 - 6} ${y - h - 4}`} stroke="#8a5a2a" strokeWidth="3" fill="none" />
      <path d={`M${x - w / 2} ${y - h}h${w}l-5 ${h}h${-w + 10}z`} fill="#c08a4a" stroke={INK} strokeWidth=".9" />
      <path d={`M${x - w / 2 + 3} ${y - h * 0.66}h${w - 6}M${x - w / 2 + 4} ${y - h * 0.33}h${w - 8}`} stroke="#8a5a2a" strokeWidth="1.4" />
      <path d={`M${x - w / 2 + 2} ${y - h}q${w / 4} -8 ${w / 2} -2q${w / 4} -6 ${w / 2 - 4} 2`} fill="#d65a4a" stroke={INK} strokeWidth=".7" />
    </g>
  );
}

function Baby({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <ellipse cx={x} cy={y} rx="6" ry="4.5" fill="#f2b8b8" stroke={INK} strokeWidth=".6" />
      <circle cx={x - 3.5} cy={y - 4} r="2" fill="#f2b8b8" stroke={INK} strokeWidth=".5" />
      <circle cx={x + 3.5} cy={y - 4} r="2" fill="#f2b8b8" stroke={INK} strokeWidth=".5" />
      <circle cx={x - 1.8} cy={y - 0.5} r=".7" fill={INK} />
      <circle cx={x + 1.8} cy={y - 0.5} r=".7" fill={INK} />
    </g>
  );
}

function ClothesIron({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path d="M-26 0h48q6 0 8 -6l-6 -14h-44q-6 0 -6 6z" fill="url(#cv-iron)" stroke="#0e0d10" strokeWidth="1" />
      <path d="M-14 -20q2 -12 14 -12q10 0 12 12" fill="none" stroke="#2b2622" strokeWidth="4" />
      <rect x="-24" y="-4" width="50" height="3" fill="#8d949a" />
    </g>
  );
}

function RailStack({ x, y, n = 3 }: { x: number; y: number; n?: number }) {
  return (
    <g>
      {Array.from({ length: n }, (_, i) => (
        <g key={i}>
          <rect x={x + (i % 2) * 4} y={y - 6 - i * 6} width="56" height="6" fill="#b0c4cc" stroke="#3b3f42" strokeWidth=".8" />
          <rect x={x + (i % 2) * 4} y={y - 4 - i * 6} width="56" height="1.5" fill="#6e757b" />
        </g>
      ))}
    </g>
  );
}

function Hammer({ x, y, rot = -30, cls }: { x: number; y: number; rot?: number; cls?: string }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot})`}>
      <g className={cls}>
        <rect x="-1.5" y="-26" width="3" height="26" fill="#a8743f" stroke={INK} strokeWidth=".6" />
        <rect x="-8" y="-32" width="16" height="7" rx="1" fill="url(#cv-iron)" stroke={INK} strokeWidth=".7" />
      </g>
    </g>
  );
}

function Ingot({ x, y }: { x: number; y: number }) {
  return <path d={`M${x} ${y}h22l-3 -7h-16z`} fill="url(#cv-brass)" stroke={INK} strokeWidth=".7" />;
}

function Globe({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <line x1={x} y1={y} x2={x} y2={y - 10} stroke="#7d5f2c" strokeWidth="2" />
      <rect x={x - 7} y={y - 2} width="14" height="2" fill="#7d5f2c" />
      <circle cx={x} cy={y - 20} r="11" fill="#4f9d8a" stroke={INK} strokeWidth=".8" />
      <path d={`M${x - 11} ${y - 20}h22M${x} ${y - 31}q-8 11 0 22q8 -11 0 -22`} stroke="#e8c983" strokeWidth=".7" fill="none" />
      <path d={`M${x - 6} ${y - 25}q4 -2 7 1q-2 4 -6 2z`} fill="#8fbf5a" />
    </g>
  );
}

function Pocketwatch({ x, y, r = 8 }: { x: number; y: number; r?: number }) {
  return (
    <g>
      <circle cx={x} cy={y} r={r} fill="#efe2c4" stroke="url(#cv-brass)" strokeWidth="2.2" />
      <path d={`M${x} ${y}v${-r * 0.65}M${x} ${y}h${r * 0.45}`} stroke={INK} strokeWidth="1" />
      <circle cx={x} cy={y - r - 2} r="2" fill="none" stroke="#d4af37" strokeWidth="1.2" />
    </g>
  );
}

function Signal({ x, y, color = "#c4453a" }: { x: number; y: number; color?: string }) {
  return (
    <g>
      <line x1={x} y1={y} x2={x} y2={y - 44} stroke="#3b3f42" strokeWidth="2.2" />
      <rect x={x - 6} y={y - 52} width="12" height="22" rx="3" fill="#1d1a1f" stroke="#8d949a" strokeWidth=".8" />
      <circle cx={x} cy={y - 46} r="3.4" fill={color} />
      <circle cx={x} cy={y - 36} r="3.4" fill="#2a3a2a" />
      <Glow x={x} y={y - 46} r={12} kind="red" className="cv-glow" />
    </g>
  );
}

/** COL-3: the rail forge's chimney hood and flue (its tall element from tier 1). */
function ForgeHood() {
  return (
    <g>
      <rect x="-66" y="-145" width="14" height="23" fill="#2c2a30" stroke={INK} strokeWidth=".8" />
      <path d="M-86 -96L-70 -124H-48L-32 -96Z" fill="#3a3640" stroke={INK} strokeWidth=".9" />
      <path d="M-85 -97H-33" stroke="#8d949a" strokeWidth="2" />
    </g>
  );
}

/** COL-3: the clock tower's long-case: a walnut box with a dark glass front for the pendulum. (x, y) = top-left. */
function PendulumCase({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  return (
    <g>
      <path d={`M${x - 2} ${y}l${w / 2 + 2} -8 ${w / 2 + 2} 8z`} fill="#5a3a22" stroke={INK} strokeWidth=".8" />
      <rect x={x} y={y} width={w} height={h} rx="2" fill="#3a2414" stroke={INK} strokeWidth=".9" />
      <rect x={x + 4} y={y + 6} width={w - 8} height={h - 12} fill="#1d140c" stroke="url(#cv-brass)" strokeWidth="1" />
    </g>
  );
}

function Track({ x1, x2, y }: { x1: number; x2: number; y: number }) {
  return (
    <g>
      <line x1={x1} y1={y - 1} x2={x2} y2={y - 1} stroke="#6e4523" strokeWidth="4" strokeDasharray="3 5" />
      <line x1={x1} y1={y - 3} x2={x2} y2={y - 3} stroke="#b0c4cc" strokeWidth="1.6" />
    </g>
  );
}

/* ------------------------------------------------------------ buildings */

const ART: Record<BuildingId, (l: number) => ReactNode> = {
  nest: (l) =>
    l < 5 ? (
      <>
        <RagPile x={0} y={0} w={96} />
        <CrumbPile x={56} y={0} w={20} h={6} />
      </>
    ) : l < 10 ? (
      <>
        <RagPile x={-26} y={0} w={80} />
        <Cork x={10} y={0} h={54} w={10} />
        <Cork x={72} y={0} h={54} w={10} />
        <path d="M12 -48Q41 -14 70 -48" stroke="#8a5a9a" strokeWidth="10" fill="none" strokeLinecap="round" />
        <path d="M16 -43Q41 -16 66 -43" stroke="#eadcc0" strokeWidth="2.2" strokeDasharray="4 5" fill="none" />
        <Candle x={-66} y={0} h={12} />
      </>
    ) : l < 25 ? (
      <>
        <Matchbox x={-72} y={0} w={54} h={24} open={10} />
        <Matchbox x={-68} y={-24} w={54} h={24} color="#3d6b8a" />
        <Matchbox x={2} y={0} w={54} h={24} color="#7a5a8a" />
        <Matchbox x={6} y={-24} w={54} h={24} color="#b8402e" open={8} />
        <RagPile x={-40} y={-48} w={40} />
        <path d="M66 0V-50M74 0V-50M66 -10h8M66 -22h8M66 -34h8M66 -46h8" stroke="#d9b07a" strokeWidth="1.6" />
        <Candle x={-8} y={-48} h={9} />
      </>
    ) : (
      <>
        <Tenement x={-74} y={0} cols={2} rows={l >= 50 ? 5 : 4} colors={["#b8402e", "#3d6b8a", "#7a5a8a", "#4f7a4a"]} />
        <Cork x={-50} y={-(l >= 50 ? 110 : 88)} h={14} w={8} />
        <Steam x={-50} y={-(l >= 50 ? 124 : 102)} n={2} color="#9b948a" />
        <Tenement x={6} y={0} cols={2} rows={l >= 50 ? 3 : 2} colors={["#4f7a4a", "#b8402e", "#8a6438"]} />
        <Clothesline x1={-2} x2={72} y={l >= 50 ? -74 : -52} />
      </>
    ),

  trash_chute: (l) =>
    l < 5 ? (
      <>
        <Chute x={0} top={-150} bottom={-74} w={20} />
        <Falling x={0} y={-72} fall={58} items={3} />
        <CrumbPile x={0} y={0} w={60} h={16} />
      </>
    ) : l < 10 ? (
      <>
        <Chute x={-6} top={-150} bottom={-80} w={28} />
        <Falling x={-6} y={-78} fall={62} items={5} />
        <CrumbPile x={-6} y={0} w={86} h={22} />
        <BottleCap x={52} y={0} w={26} color="#3d6b8a" fill="#e6c27a" />
        <Sign x={50} y={-96} text="БУЛОЧНАЯ ↑" size={7} />
      </>
    ) : (
      <>
        <Chute x={-40} top={-150} bottom={-84} w={26} />
        <Chute x={30} top={-150} bottom={-96} w={20} />
        <Falling x={-40} y={-82} fall={66} items={5} />
        <Falling x={30} y={-94} fall={74} items={4} color="#f0d49a" />
        <CrumbPile x={-30} y={0} w={92} h={26} />
        <Track x1={10} x2={78} y={0} />
        <ThimbleCart x={52} y={-3} cargo="🍞" />
        <Lantern x={66} y={-140} />
      </>
    ),

  pantry: (l) =>
    l < 5 ? (
      <>
        <CrumbPile x={4} y={-17} w={44} h={14} />
        <CandyTin x={4} y={0} w={64} h={18} lid={16} />
        <CrumbPile x={-52} y={0} w={18} h={5} />
      </>
    ) : l < 10 ? (
      <>
        <CandyTin x={-14} y={0} w={74} h={20} color="#5b7fa8" />
        <CandyTin x={-12} y={-26} w={54} h={16} color="#a83a4a" lid={14} />
        <CrumbPile x={-12} y={-42} w={34} h={10} />
        <Sock x={40} y={-30} s={0.9} rot={-75} color="#c08a4a" />
        <CrumbPile x={58} y={0} w={22} h={7} />
      </>
    ) : (
      <>
        <Shelf x={-74} y={-58} w={148} legs={54} />
        <CandyTin x={-46} y={-58} w={40} h={14} color="#5b7fa8" />
        <CandyTin x={0} y={-58} w={40} h={16} color="#a83a4a" gold={l >= 50} />
        <CandyTin x={46} y={-58} w={36} h={13} color="#4f7a4a" />
        <TinCan x={-34} y={0} w={30} h={36} band="#c4453a" />
        <TinCan x={0} y={0} w={26} h={30} band="#3d6b8a" />
        <CrumbPile x={44} y={0} w={44} h={16} />
        <Sign x={0} y={-100} text="ЗАПАСЫ" size={8} />
      </>
    ),

  stash: (l) =>
    l < 5 ? (
      <>
        <Snuffbox x={-32} y={0} w={64} h={24} />
        <Coins x={46} y={0} n={2} />
      </>
    ) : l < 10 ? (
      <>
        <Coins x={-10} y={-24} n={4} />
        <Coins x={8} y={-24} n={3} />
        <Snuffbox x={-34} y={0} w={68} h={26} lid={38} />
        <Coins x={52} y={0} n={5} />
        <circle cx={-56} cy={-6} r="6" fill="#e39ab0" stroke={INK} strokeWidth=".7" />
        <circle cx={-58} cy={-6} r="1" fill={INK} />
        <circle cx={-54} cy={-6} r="1" fill={INK} />
      </>
    ) : (
      <>
        <Snuffbox x={-70} y={0} w={70} h={28} />
        <Snuffbox x={-64} y={-34} w={60} h={24} lid={30} />
        <Coins x={-34} y={-58} n={4} />
        <g transform="translate(-6 -16)">
          <path d="M-5 0v-6q5 -8 10 0v6" fill="none" stroke="#8d949a" strokeWidth="2.2" />
          <rect x="-7" y="-1" width="14" height="11" rx="2" fill="url(#cv-brass)" stroke={INK} strokeWidth=".8" />
        </g>
        <TinCan x={34} y={0} w={30} h={34} band="#e39ab0" />
        <Coins x={64} y={0} n={6} />
        <Coins x={34} y={-37} n={3} />
      </>
    ),

  pickpocket_school: (l) =>
    l < 5 ? (
      <>
        <Cork x={-50} y={0} h={30} w={8} />
        <Cork x={-6} y={0} h={30} w={8} />
        <Slate x={-60} y={-30} w={64} h={40} text="Урок 1" />
        <Matchbox x={14} y={0} w={50} h={20} color="#7a2a24" />
        <TopHat x={42} y={-26} />
      </>
    ) : l < 10 ? (
      <>
        <Cork x={-56} y={0} h={30} w={8} />
        <Cork x={-12} y={0} h={30} w={8} />
        <Slate x={-66} y={-30} w={64} h={40} text="Не тянуть!" />
        <line x1="38" y1="0" x2="38" y2="-96" stroke="#a8743f" strokeWidth="3" />
        <path d="M22 -86h32l6 62h-44z" fill="#3a3040" stroke={INK} strokeWidth="1" />
        <rect x="26" y="-56" width="14" height="10" fill="#2a2230" stroke={INK} strokeWidth=".6" />
        <path d="M33 -52q10 8 18 -4" stroke="#d4af37" strokeWidth="1.4" fill="none" />
        <Pocketwatch x={52} y={-50} r={5} />
        <TopHat x={38} y={-96} s={1.1} />
      </>
    ) : (
      <>
        <Slate x={-74} y={-60} w={92} h={50} text="Ловкость лап" />
        <line x1="20" y1="-40" x2="-20" y2="-80" stroke="#d9b07a" strokeWidth="1.6" />
        <Matchbox x={-72} y={0} w={40} h={18} color="#7a2a24" />
        <Matchbox x={-24} y={0} w={40} h={18} color="#3d6b8a" />
        <Matchbox x={24} y={0} w={40} h={18} color="#4f7a4a" />
        <TopHat x={-50} y={-22} s={0.8} />
        <TopHat x={-2} y={-22} s={0.8} />
        <TopHat x={46} y={-22} s={0.8} />
        <g transform="translate(52 -88)">
          <path d="M-8 10q0 -14 8 -14t8 14z" fill="url(#cv-brass)" stroke={INK} strokeWidth=".8" />
          <circle cy="11" r="2" fill="#7d5f2c" />
        </g>
      </>
    ),

  sorting_den: (l) =>
    l < 5 ? (
      <>
        <BottleCap x={-44} y={0} color="#c4453a" fill="#e39ab0" />
        <BottleCap x={0} y={0} color="#3d6b8a" fill="#9cc7cf" />
        <BottleCap x={44} y={0} color="#4f7a4a" />
        <Sign x={0} y={-44} text="🔘 ←  → ➰" size={8} />
      </>
    ) : l < 10 ? (
      <>
        <Shelf x={-72} y={-50} w={144} legs={46} />
        {[-54, -18, 18, 54].map((x, i) => (
          <Thimble key={x} x={x} y={-50} w={20} h={22} gold={i === 3} />
        ))}
        <BottleCap x={-40} y={0} color="#c4453a" fill="#e39ab0" />
        <BottleCap x={0} y={0} color="#3d6b8a" fill="#9cc7cf" />
        <BottleCap x={40} y={0} color="#b8693d" fill="#e6c27a" />
      </>
    ) : (
      <>
        <Spool x={-60} y={-34} h={22} w={16} color="#8a6438" />
        <Spool x={60} y={-34} h={22} w={16} color="#8a6438" />
        <rect x="-60" y="-50" width="120" height="5" rx="2.5" fill="#c4453a" stroke={INK} strokeWidth=".7" />
        <g className="cv-wave">
          {[-50, -26, -2, 22, 46].map((x, i) => (
            <circle key={x} cx={x + 20} cy={-53} r="3" fill={i % 2 ? "#e39ab0" : "#9cc7cf"} stroke={INK} strokeWidth=".5" />
          ))}
        </g>
        <Cork x={-60} y={0} h={34} w={8} />
        <Cork x={60} y={0} h={34} w={8} />
        <BottleCap x={-30} y={0} color="#c4453a" fill="#e39ab0" />
        <BottleCap x={4} y={0} color="#3d6b8a" fill="#9cc7cf" />
        <Sign x={0} y={-82} text="СОРТИРОВКА" size={8} />
      </>
    ),

  drain_sieve: (l) =>
    l < 5 ? (
      <>
        <Water />
        <line x1="20" y1="-58" x2="2" y2="-20" stroke="#8d949a" strokeWidth="3" />
        <circle cx="-6" cy="-14" r="16" fill="rgba(200,210,215,.25)" stroke="#9aa2a8" strokeWidth="2" />
        <path d="M-18 -14h24M-14 -22h16M-14 -6h16M-6 -28v28M-12 -26v24M0 -26v24" stroke="#9aa2a8" strokeWidth=".6" />
        <CrumbPile x={-6} y={-16} w={14} h={5} />
      </>
    ) : l < 10 ? (
      <>
        <Water />
        <Spool x={-60} y={0} h={56} w={14} color="#8a6438" />
        <Spool x={60} y={0} h={56} w={14} color="#8a6438" />
        <rect x="-54" y="-48" width="108" height="40" fill="rgba(200,210,215,.18)" stroke="#9aa2a8" strokeWidth="2" />
        <path d="M-54 -38h108M-54 -28h108M-54 -18h108M-36 -48v40M-18 -48v40M0 -48v40M18 -48v40M36 -48v40" stroke="#9aa2a8" strokeWidth=".6" />
        <circle cx="-20" cy="-14" r="3.5" fill="#e39ab0" />
        <path d="M10 -14q4 -6 8 0t8 0" stroke="#9cc7cf" strokeWidth="1.6" fill="none" />
        <CrumbPile x={28} y={-9} w={14} h={5} />
      </>
    ) : (
      <>
        <Water />
        <Spool x={-70} y={0} h={70} w={14} color="#8a6438" />
        <Spool x={0} y={0} h={70} w={14} color="#8a6438" />
        <Spool x={70} y={0} h={70} w={14} color="#8a6438" />
        <rect x="-64" y="-56" width="58" height="46" fill="rgba(200,210,215,.18)" stroke="#9aa2a8" strokeWidth="2" />
        <rect x="6" y="-56" width="58" height="46" fill="rgba(200,210,215,.18)" stroke="#9aa2a8" strokeWidth="2" />
        <path d="M-64 -44h58M-64 -32h58M-64 -20h58M6 -44h58M6 -32h58M6 -20h58" stroke="#9aa2a8" strokeWidth=".6" />
        <line x1="-70" y1="-70" x2="-70" y2="-120" stroke="#d9c9a4" strokeWidth="1" />
        <Spool x={-70} y={-118} h={14} w={18} color="#c4453a" />
        <Thimble x={-70} y={-68} w={14} h={14} />
      </>
    ),

  sewer_warehouse: (l) => {
    const pipe = (y: number, w: number) => (
      <g>
        <rect x={-w / 2} y={y - 62} width={w} height="62" rx="28" fill="#2c3638" stroke="#0e1415" strokeWidth="2" />
        <rect x={-w / 2 + 6} y={y - 56} width={w - 12} height="50" rx="22" fill="#151d1e" />
        {[-w / 2 + 14, 0, w / 2 - 14].map((x) => (
          <circle key={x} cx={x} cy={y - 59} r="1.6" fill="#7e868c" />
        ))}
      </g>
    );
    return l < 5 ? (
      <>
        {pipe(0, 150)}
        <Matchbox x={-40} y={-6} w={34} h={20} color="#8a6438" />
        <Matchbox x={4} y={-6} w={30} h={18} color="#6e4523" />
      </>
    ) : l < 10 ? (
      <>
        {pipe(0, 156)}
        <Matchbox x={-58} y={-6} w={34} h={20} color="#8a6438" />
        <Matchbox x={-54} y={-26} w={30} h={18} color="#6e4523" />
        <Matchbox x={-16} y={-6} w={34} h={20} color="#8a6438" />
        <Sock x={28} y={-34} s={0.75} rot={-80} color="#c08a4a" />
        <Matchbox x={40} y={-6} w={26} h={16} color="#6e4523" />
      </>
    ) : (
      <>
        {pipe(0, 156)}
        {pipe(-66, 120)}
        <Matchbox x={-58} y={-6} w={34} h={20} color="#8a6438" />
        <Matchbox x={-18} y={-6} w={34} h={20} color="#6e4523" />
        <Matchbox x={24} y={-6} w={34} h={20} color="#8a6438" />
        <Matchbox x={-40} y={-72} w={30} h={18} color="#6e4523" />
        <line x1="62" y1="-140" x2="62" y2="-36" stroke="#d9c9a4" strokeWidth="1" />
        <path d="M62 -36q0 6 -5 6" stroke="#8d949a" strokeWidth="2" fill="none" />
        <Matchbox x={50} y={-12} w={22} h={14} color="#b8402e" />
      </>
    );
  },

  workshop: (l) => {
    const bench = (x: number) => (
      <>
        <Matchbox x={x} y={0} w={92} h={26} color="#3d6b8a" />
        <Peg x={x + 20} y={-28} rot={-8} />
        <path d={`M${x + 50} -32q4 -8 8 0t8 0t8 0`} stroke="#9cc7cf" strokeWidth="1.8" fill="none" />
      </>
    );
    return l < 5 ? (
      <>
        {bench(-58)}
        <Spool x={56} y={0} h={24} w={18} color="#9cc7cf" />
        <Candle x={-66} y={-32} h={8} />
      </>
    ) : l < 10 ? (
      <>
        {bench(-64)}
        <Gear x={-36} y={-92} r={16} teeth={10} spin="slow" />
        <path d="M10 -110v18M20 -110v14M30 -110v20" stroke="#9aa2a8" strokeWidth="1.6" />
        <circle cx="10" cy="-92" r="1.6" fill="#9aa2a8" />
        <Spool x={50} y={0} h={24} w={18} color="#9cc7cf" />
        <Lantern x={58} y={-140} />
      </>
    ) : (
      <>
        {bench(-72)}
        <Spool x={50} y={-26} h={24} w={18} color="#c4453a" />
        <rect x="34" y="-26" width="40" height="26" fill="#2c3638" stroke={INK} strokeWidth=".8" />
        <Gear x={54} y={-56} r={14} teeth={10} spin="cw" />
        <Gear x={30} y={-72} r={9} teeth={8} spin="ccw" />
        <Gear x={-36} y={-96} r={18} teeth={12} spin="slow" />
        <path d="M40 -40l-6 -4M42 -38l-8 2" stroke="#ffb03a" strokeWidth="1.2" className="cv-glow" />
      </>
    );
  },

  water_wheel: (l) =>
    l < 5 ? (
      <>
        <Water />
        <SpokeWheel x={0} y={-38} r={34} spokes={8} spin paddles />
        <rect x="-3" y="-40" width="6" height="40" fill="#6e4523" />
      </>
    ) : l < 10 ? (
      <>
        <Water />
        <SpokeWheel x={-14} y={-50} r={46} spokes={10} spin paddles />
        <Gear x={50} y={-60} r={14} spin="ccw" />
        <Gear x={64} y={-86} r={9} teeth={8} spin="cw" />
        <rect x="-18" y="-50" width="8" height="50" fill="#6e4523" />
      </>
    ) : (
      <>
        <Water />
        <SpokeWheel x={-34} y={-44} r={40} spokes={10} spin paddles />
        <SpokeWheel x={44} y={-34} r={30} spokes={8} spin paddles />
        <Gear x={4} y={-100} r={16} spin="ccw" />
        <Gear x={30} y={-112} r={10} teeth={8} spin="cw" />
        <path d="M-34 -44L4 -100M44 -34L30 -112" stroke="#3a2a1a" strokeWidth="1.4" />
      </>
    ),

  rat_rail: (l) =>
    l < 5 ? (
      <>
        <Track x1={-76} x2={76} y={0} />
        <Cork x={70} y={-2} h={18} w={10} />
        <ThimbleCart x={10} y={-3} cargo="⚙️" />
        <Sign x={-34} y={-64} text="УЗКОКОЛЕЙКА" size={8} />
      </>
    ) : l < 10 ? (
      <>
        <Track x1={-76} x2={76} y={0} />
        <Cork x={70} y={-2} h={18} w={10} />
        <ThimbleCart x={-30} y={-3} cargo="🍞" />
        <ThimbleCart x={6} y={-3} cargo="🪙" />
        <Signal x={-66} y={0} color="#8fbf5a" />
        <Sign x={20} y={-76} text="УЗКОКОЛЕЙКА" size={8} />
      </>
    ) : (
      <>
        <path d="M-70 0V-54Q-70 -96 -24 -96Q22 -96 22 -54V0" fill="url(#cv-silver)" stroke="#3b3f42" strokeWidth="1.2" />
        <path d="M-58 0V-52Q-58 -84 -24 -84Q10 -84 10 -52V0z" fill="#1c2224" />
        {[-58, -44, -30, -16, -2].map((x) => (
          <path key={x} d={`M${x + 10} -88v6`} stroke="#6e757b" strokeWidth="1.2" />
        ))}
        <Track x1={-76} x2={76} y={0} />
        <ThimbleCart x={-24} y={-3} cargo="⚙️" flag />
        <ThimbleCart x={50} y={-3} cargo="🧀" />
        <Signal x={70} y={0} color="#8fbf5a" />
      </>
    ),

  capsule_tap: (l) => (
    <>
      {/* COL-3: the tall element — a glass tube up to the apex with a capsule on its way */}
      <rect x="57" y="-146" width="14" height="134" rx="6" fill="rgba(200,230,240,.16)" stroke="#9cc7cf" strokeWidth=".9" />
      <path d="M60.5 -138V-22" stroke="#fff" strokeWidth="1.2" opacity=".35" />
      <rect x="54" y="-14" width="20" height="14" rx="2" fill="url(#cv-brass)" stroke={INK} strokeWidth=".8" />
      <Capsule x={64} y={-64} rot={90} />
      <Pipe x1={-40} y1={-150} x2={-40} y2={-70} r={7} />
      <Pipe x1={-40} y1={-70} x2={20} y2={-70} r={7} />
      <SpokeWheel x={-40} y={-104} r={9} spokes={4} />
      <circle cx="-40" cy="-104" r="9" fill="none" stroke="#c4453a" strokeWidth="2.4" />
      <Steam x={24} y={-70} n={2} />
      {l >= 2 && (
        <>
          <CandyTin x={30} y={0} w={60} h={12} color="#7a4a2a" />
          <Capsule x={22} y={-18} rot={-6} />
        </>
      )}
      {l >= 3 && (
        <>
          <Capsule x={46} y={-30} rot={14} />
          <Capsule x={-52} y={-6} rot={0} />
          <Gauge x={-12} y={-90} r={9} angle={40} />
          <g transform="translate(64 -122)">
            <path d="M-8 10q0 -14 8 -14t8 14z" fill="url(#cv-brass)" stroke={INK} strokeWidth=".8" />
          </g>
        </>
      )}
    </>
  ),

  cheese_tap: (l) =>
    l < 5 ? (
      <>
        <BarrelEnd x={-24} y={0} r={46} />
        <path d="M-34 -10q-6 -18 8 -22q16 -2 14 18q-2 6 -22 4z" fill="#140c06" />
        <CheeseWedge x={20} y={0} s={1.1} />
      </>
    ) : l < 10 ? (
      <>
        <BarrelEnd x={-36} y={0} r={42} />
        <path d="M-46 -10q-6 -18 8 -22q16 -2 14 18q-2 6 -22 4z" fill="#140c06" />
        <CheeseWheel x={44} y={0} w={44} h={16} />
        <CheeseWheel x={44} y={-16} w={40} h={15} />
        <CheeseWheel x={42} y={-31} w={34} h={14} />
        <CheeseWedge x={-6} y={0} s={0.9} />
      </>
    ) : (
      <>
        <rect x="-70" y="-74" width="120" height="74" rx="4" fill="#e8b84b" stroke={INK} strokeWidth="1.2" />
        <ellipse cx="-10" cy="-74" rx="60" ry="10" fill="#ffd96b" stroke={INK} strokeWidth="1.2" />
        <path d="M-30 0v-34q0 -16 16 -16t16 16v34z" fill="#3a2410" stroke={INK} strokeWidth="1" />
        <circle cx="-48" cy="-40" r="5" fill="#c99a30" />
        <circle cx="22" cy="-50" r="4" fill="#c99a30" />
        <circle cx="30" cy="-20" r="6" fill="#c99a30" />
        <CheeseWedge x={46} y={0} s={0.9} />
      </>
    ),

  nursery: (l) =>
    l < 5 ? (
      <>
        <Basket x={0} y={0} w={64} />
        <Baby x={-10} y={-30} />
        <Baby x={10} y={-31} />
      </>
    ) : l < 10 ? (
      <>
        <Basket x={-26} y={0} w={64} />
        <Baby x={-36} y={-30} />
        <Baby x={-16} y={-31} />
        <path d="M30 0q0 -26 22 -26t22 26z" fill="#8a5a2a" stroke={INK} strokeWidth="1" />
        <path d="M36 -10q16 -10 32 0" stroke="#5c3a1a" strokeWidth="1" fill="none" />
        <Baby x={52} y={-16} />
        <line x1="40" y1="-140" x2="40" y2="-96" stroke="#d9c9a4" strokeWidth=".8" />
        <path d="M24 -96h32" stroke="#d9c9a4" strokeWidth=".8" />
        {[24, 40, 56].map((x, i) => (
          <circle key={x} cx={x} cy={-86 + (i % 2) * 4} r="4" fill={["#e39ab0", "#8fb8ff", "#f5d76e"][i]} stroke={INK} strokeWidth=".5" />
        ))}
      </>
    ) : (
      <>
        <Basket x={-44} y={0} w={60} />
        <Basket x={22} y={0} w={56} />
        <Baby x={-52} y={-28} />
        <Baby x={-34} y={-29} />
        <Baby x={16} y={-26} />
        <Baby x={32} y={-27} />
        <Spool x={66} y={0} h={18} w={14} color="#c4453a" />
        <Sign x={-10} y={-104} text="ЯСЛИ" size={9} />
        <path d="M-60 -126h120" stroke="#d9c9a4" strokeWidth=".8" />
        {[-50, -25, 0, 25, 50].map((x, i) => (
          <circle key={x} cx={x} cy={-118 + (i % 2) * 4} r="4" fill={["#e39ab0", "#8fb8ff", "#f5d76e", "#7cc4b0", "#e8705f"][i]} stroke={INK} strokeWidth=".5" />
        ))}
      </>
    ),

  library: (l) =>
    l < 5 ? (
      <>
        <Book x={-46} y={0} w={18} h={78} color="#7a2a24" />
        <Book x={-26} y={0} w={20} h={88} color="#2a4a6a" />
        <Book x={-4} y={0} w={16} h={70} color="#3a5a2a" />
        <g transform="rotate(14 30 0)">
          <Book x={16} y={0} w={16} h={66} color="#6a3a6a" />
        </g>
        <Candle x={58} y={0} h={12} />
      </>
    ) : l < 10 ? (
      <>
        <Shelf x={-76} y={-60} w={152} legs={56} />
        {[-74, -62, -48, -36, -22, -8, 6, 18, 32, 46, 58].map((x, i) => (
          <Book key={x} x={x} y={-60} w={11} h={40 + ((i * 7) % 14)} color={["#7a2a24", "#2a4a6a", "#3a5a2a", "#6a3a6a", "#8a6438"][i % 5]} />
        ))}
        {[-60, -46, -32, -18].map((x, i) => (
          <Book key={x} x={x} y={0} w={13} h={44 + ((i * 5) % 10)} color={["#2a4a6a", "#7a2a24", "#8a6438", "#3a5a2a"][i]} />
        ))}
        <path d="M30 0L46 -60M42 0L58 -60M33 -12h12M37 -28h12M41 -44h12" stroke="#d9b07a" strokeWidth="1.6" />
      </>
    ) : (
      <>
        <rect x="-78" y="-128" width="112" height="128" fill="#3a2414" stroke={INK} strokeWidth="1.2" />
        {[-120, -80, -40].map((y) => (
          <rect key={y} x="-78" y={y + 38} width="112" height="4" fill="#6e4523" />
        ))}
        {[-82, -42, -2].map((yy, row) =>
          [-74, -62, -50, -38, -26, -14, -2, 10, 20].map((x, i) => (
            <Book key={`${row}-${x}`} x={x} y={yy + 0} w={11} h={30 + ((i * 7 + row * 3) % 8)} color={["#7a2a24", "#2a4a6a", "#3a5a2a", "#6a3a6a", "#8a6438"][(i + row) % 5]} />
          )),
        )}
        <Globe x={58} y={0} />
        <Candle x={58} y={-62} h={10} />
        <Shelf x={40} y={-62} w={38} legs={0} />
      </>
    ),

  cellar_vault: (l) =>
    l < 5 ? (
      <>
        <path d="M-40 0l8 -10 8 10zM16 0l8 -10 8 10z" fill="#6e4523" />
        <BarrelEnd x={-4} y={-4} r={34} />
      </>
    ) : l < 10 ? (
      <>
        <BarrelEnd x={-40} y={0} r={30} />
        <BarrelEnd x={22} y={0} r={30} />
        <Barrel x={64} y={0} w={26} h={40} tap />
      </>
    ) : (
      <>
        <BarrelEnd x={-46} y={0} r={28} />
        <BarrelEnd x={10} y={0} r={28} />
        <BarrelEnd x={-18} y={-50} r={28} />
        <Barrel x={62} y={0} w={28} h={46} tap />
        <Sign x={-18} y={-124} text="ХЕРЕС 1851" size={7} />
      </>
    ),

  coal_chute: (l) => {
    const chute = (x: number) => (
      <g>
        <path d={`M${x - 30} -150L${x + 8} -64h18L${x - 10} -150z`} fill="#4a4652" stroke="#0e0d10" strokeWidth="1" />
        <Falling x={x + 14} y={-62} fall={40} items={4} color="#1a181d" size={4} />
      </g>
    );
    return l < 5 ? (
      <>
        {chute(-10)}
        <CoalPile x={6} y={0} w={70} />
      </>
    ) : l < 10 ? (
      <>
        {chute(-30)}
        <CoalPile x={-16} y={0} w={70} />
        <Track x1={20} x2={80} y={0} />
        <ThimbleCart x={50} y={-3} cargo="🪨" />
      </>
    ) : (
      <>
        {chute(-44)}
        {chute(30)}
        <CoalPile x={-30} y={0} w={64} />
        <CoalPile x={40} y={0} w={54} />
        <path d="M66 0l-10 -40" stroke="#a8743f" strokeWidth="2.4" />
        <path d="M52 -42l8 -8 6 6z" fill="#8d949a" />
      </>
    );
  },

  boiler: (l) =>
    l < 5 ? (
      <>
        <Glow x={0} y={-6} r={40} kind="red" className="cv-glow" />
        <Candle x={0} y={0} h={8} glow={false} />
        <rect x="-26" y="-24" width="52" height="4" fill="#3b3f42" />
        <Teapot x={0} y={-24} s={0.95} />
      </>
    ) : l < 10 ? (
      <>
        <Glow x={-10} y={-6} r={44} kind="red" className="cv-glow" />
        <Candle x={-10} y={0} h={8} glow={false} />
        <rect x="-38" y="-24" width="56" height="4" fill="#3b3f42" />
        <Teapot x={-10} y={-24} s={1} steam={false} />
        <Pipe x1={30} y1={-60} x2={64} y2={-60} r={4} />
        <Pipe x1={64} y1={-60} x2={64} y2={-150} r={4} />
        <Gauge x={50} y={-82} r={9} angle={20} />
        <Steam x={34} y={-66} n={3} />
      </>
    ) : (
      <>
        <Glow x={-36} y={-6} r={40} kind="red" className="cv-glow" />
        <Glow x={36} y={-6} r={40} kind="red" className="cv-glow" />
        <Candle x={-36} y={0} h={8} glow={false} />
        <Candle x={36} y={0} h={8} glow={false} />
        <Teapot x={-36} y={-20} s={0.8} steam={false} />
        <Teapot x={36} y={-20} s={0.8} steam={false} />
        <Pipe x1={-36} y1={-62} x2={36} y2={-62} r={4} />
        <Pipe x1={0} y1={-62} x2={0} y2={-120} r={4} />
        <Gauge x={0} y={-82} r={10} angle={60} />
        <Steam x={0} y={-124} n={4} />
      </>
    ),

  brass_foundry: (l) => {
    const crucible = (x: number) => (
      <>
        <Glow x={x} y={-14} r={46} kind="red" className="cv-glow" />
        <CoalPile x={x} y={0} w={60} />
        <Thimble x={x} y={-12} w={30} h={34} gold />
        <ellipse cx={x} cy={-46} rx="10" ry="3" fill="#ffd34d" className="cv-glow" />
      </>
    );
    // COL-3: the tall element — a ladle-crucible hung on a chain from the apex
    const hanging = (
      <>
        <path d="M46 -147V-97" stroke="#3a2a1a" strokeWidth="1.6" strokeDasharray="2.4 1.2" />
        <path d="M35 -97h22l-3 13q-8 5 -16 0z" fill="#3b3f42" stroke={INK} strokeWidth=".8" />
        <ellipse cx="46" cy="-96" rx="9.5" ry="2.2" fill="#ffb03a" />
      </>
    );
    return l < 5 ? (
      <>
        {hanging}
        {crucible(0)}
      </>
    ) : l < 10 ? (
      <>
        {hanging}
        {crucible(-20)}
        <path d="M70 -30q-10 -30 -30 -24l-8 10q16 2 18 16z" fill="#8a5a2a" stroke={INK} strokeWidth="1" />
        <path d="M58 -48l6 -10M64 -44l8 -8M68 -38l9 -5" stroke="#8a5a2a" strokeWidth="5" strokeLinecap="round" />
      </>
    ) : (
      <>
        {hanging}
        {crucible(-34)}
        <rect x="18" y="-8" width="56" height="8" fill="#3b3f42" stroke={INK} strokeWidth=".7" />
        <Ingot x={22} y={-8} />
        <Ingot x={48} y={-8} />
        <Ingot x={34} y={-15} />
        <Ingot x={30} y={-22} />
      </>
    );
  },

  rail_forge: (l) =>
    l < 5 ? (
      <>
        <ForgeHood />
        <ClothesIron x={-6} y={0} s={1.2} />
        <Hammer x={50} y={0} rot={-70} />
      </>
    ) : l < 10 ? (
      <>
        <ForgeHood />
        <Glow x={-50} y={-20} r={40} kind="red" className="cv-glow" />
        <ClothesIron x={-14} y={0} s={1.1} />
        <RailStack x={14} y={0} n={4} />
        <Hammer x={-4} y={-30} rot={-40} />
      </>
    ) : (
      <>
        <ForgeHood />
        <Glow x={-54} y={-26} r={50} kind="red" className="cv-glow" />
        <rect x="-78" y="-56" width="30" height="56" rx="4" fill="#2c2a30" stroke={INK} strokeWidth="1" />
        <rect x="-72" y="-30" width="18" height="16" rx="3" fill="#ff7a3a" className="cv-glow" />
        <ClothesIron x={-6} y={0} s={1.1} />
        <Hammer x={10} y={-24} rot={-20} cls="cv-tap" />
        <path d="M-2 -32l-8 -10M2 -34l2 -12M6 -32l10 -8" stroke="#ffb03a" strokeWidth="1.4" className="cv-glow" />
        <RailStack x={24} y={0} n={5} />
      </>
    ),

  platform_post: (l) => (
    <>
      {/* COL-3: the tall element — sorting pigeonholes with a few letters waiting */}
      <rect x="22" y="-128" width="54" height="60" fill="#5a3a22" stroke={INK} strokeWidth=".9" />
      <path d="M22 -113h54M22 -98h54M22 -83h54M35.5 -128v60M49 -128v60M62.5 -128v60" stroke="#2a1a0e" strokeWidth="1.2" />
      <path d="M26 -124h6v5h-6zM53 -109h6v5h-6zM39.5 -94h6v5h-6zM66 -79h6v5h-6zM26 -79h6v5h-6z" fill="#efe2c4" />
      <rect x="-60" y="-70" width="44" height="70" fill="#7a2a24" stroke={INK} strokeWidth="1" />
      <path d="M-66 -70h56l-6 -10h-44z" fill="#4a1a16" stroke={INK} strokeWidth="1" />
      <rect x="-52" y="-58" width="28" height="18" fill="#ffd98a" stroke={INK} strokeWidth=".8" />
      <path d="M-38 -58v18M-52 -49h28" stroke={INK} strokeWidth=".8" />
      <Pennant x={-16} y={-80} h={30} />
      {l >= 3 && (
        <>
          <rect x="4" y="-14" width="56" height="4" fill="#a8743f" />
          <path d="M8 -10v10M56 -10v10" stroke="#3b3f42" strokeWidth="2" />
        </>
      )}
      {l >= 5 && (
        <>
          <path d="M50 0l14 -40M78 0l-14 -40M64 0v-40" stroke="#a8743f" strokeWidth="1.6" />
          <rect x="46" y="-52" width="36" height="8" rx="4" fill="url(#cv-brass)" stroke={INK} strokeWidth=".8" transform="rotate(-20 64 -48)" />
        </>
      )}
    </>
  ),

  steam_press: (l) => {
    const press = (x: number) => (
      <g>
        <Cork x={x - 24} y={0} h={70} w={10} />
        <Cork x={x + 24} y={0} h={70} w={10} />
        <rect x={x - 32} y={-80} width="64" height="10" fill="url(#cv-iron)" stroke={INK} strokeWidth=".8" />
        <g className="cv-piston">
          <rect x={x - 3} y={-70} width="6" height="22" fill="#8d949a" />
          <g transform={`rotate(180 ${x} -36)`}>
            <Thimble x={x} y={-36} w={22} h={18} />
          </g>
        </g>
        <rect x={x - 20} y={-8} width="40" height="8" fill="#3b3f42" />
        <circle cx={x - 8} cy={-11} r="3.5" fill="#e39ab0" stroke={INK} strokeWidth=".5" />
        <circle cx={x + 8} cy={-11} r="3.5" fill="#f5d76e" stroke={INK} strokeWidth=".5" />
      </g>
    );
    return l < 5 ? (
      press(0)
    ) : l < 10 ? (
      <>
        {press(-20)}
        <Pipe x1={14} y1={-76} x2={60} y2={-76} r={4} />
        <Pipe x1={60} y1={-76} x2={60} y2={-150} r={4} />
        <Gauge x={46} y={-98} r={9} angle={30} />
        <Steam x={18} y={-80} n={2} />
      </>
    ) : (
      <>
        {press(-40)}
        {press(36)}
        <Pipe x1={-40} y1={-96} x2={36} y2={-96} r={4} />
        <Pipe x1={0} y1={-96} x2={0} y2={-150} r={4} />
        <Gauge x={0} y={-114} r={9} angle={50} />
        <Steam x={-4} y={-98} n={3} />
      </>
    );
  },

  lost_luggage: (l) =>
    l < 5 ? (
      <>
        <Suitcase x={-34} y={0} w={66} h={30} open />
        <Pocketwatch x={-10} y={-36} r={7} />
        <text x="12" y="-30" fontSize="12">
          💍
        </text>
      </>
    ) : l < 10 ? (
      <>
        <Suitcase x={-72} y={0} w={70} h={32} color="#5a3a2a" />
        <Suitcase x={-66} y={-32} w={58} h={26} color="#7a2a24" />
        <Suitcase x={-60} y={-58} w={46} h={22} color="#3d5a6a" />
        <rect x="14" y="-34" width="40" height="34" rx="3" fill="#e8d5a3" stroke={INK} strokeWidth="1" />
        <path d="M14 -24h40M14 -14h40" stroke="#c4453a" strokeWidth="2.4" />
        <ellipse cx="34" cy="-34" rx="20" ry="4" fill="#efe2c4" stroke={INK} strokeWidth=".8" />
        <Pocketwatch x={64} y={-8} r={6} />
      </>
    ) : (
      <>
        <rect x="-78" y="-46" width="74" height="46" rx="4" fill="#4a3a2a" stroke={INK} strokeWidth="1.2" />
        <path d="M-78 -30h74M-60 -46v46M-22 -46v46" stroke="url(#cv-brass)" strokeWidth="2.2" />
        <Suitcase x={-74} y={-46} w={60} h={26} color="#7a2a24" />
        <Suitcase x={4} y={0} w={54} h={28} color="#3d5a6a" open />
        <Pocketwatch x={22} y={-36} r={7} />
        <text x="36" y="-30" fontSize="12">
          💍
        </text>
        <path d="M70 0l-6 -70" stroke="#2b2622" strokeWidth="2" />
        <path d="M64 -70q-16 4 -18 22h36q-2 -18 -18 -22z" fill="#2a2a3a" stroke={INK} strokeWidth=".8" />
      </>
    ),

  clocktower: (l) =>
    l < 5 ? (
      <>
        <PendulumCase x={42} y={-128} w={36} h={96} />
        <Gear x={-10} y={-50} r={40} teeth={18} spin="slow" />
        <Gear x={44} y={-24} r={20} teeth={11} spin="ccw" />
        <g transform="translate(60 -120)">
          <g className="cv-pend">
            <line x1="0" y1="0" x2="0" y2="64" stroke="#8d949a" strokeWidth="2" />
            <circle cx="0" cy="68" r="8" fill="url(#cv-brass)" stroke={INK} strokeWidth=".8" />
          </g>
        </g>
      </>
    ) : (
      <>
        <PendulumCase x={51} y={-133} w={30} h={60} />
        <Gear x={-46} y={-38} r={34} teeth={16} spin="slow" />
        <Gear x={8} y={-24} r={20} teeth={11} spin="ccw" />
        {l >= 10 && <Gear x={-58} y={-104} r={18} teeth={10} spin="cw" />}
        {l >= 10 && <Gear x={58} y={-28} r={22} teeth={12} spin="slow" />}
        <g transform="translate(16 -92)">
          <circle r="30" fill="#f4ead2" stroke="url(#cv-brass)" strokeWidth="5" />
          {Array.from({ length: 12 }, (_, i) => (
            <line key={i} x1="0" y1="-25" x2="0" y2="-21" stroke={INK} strokeWidth="1.4" transform={`rotate(${i * 30})`} />
          ))}
          <g className="cv-hand-h">
            <line x1="0" y1="0" x2="0" y2="-14" stroke={INK} strokeWidth="2.4" />
          </g>
          <g className="cv-hand-m">
            <line x1="0" y1="0" x2="0" y2="-22" stroke={INK} strokeWidth="1.4" />
          </g>
          <circle r="2.4" fill="#d4af37" />
        </g>
        <g transform="translate(66 -146)">
          <g className="cv-pend">
            <line x1="0" y1="0" x2="0" y2="56" stroke="#8d949a" strokeWidth="2" />
            <circle cx="0" cy="60" r="7" fill="url(#cv-brass)" stroke={INK} strokeWidth=".8" />
          </g>
        </g>
      </>
    ),

  express_depot: (l) => (
    <>
      {/* COL-3: the tall element — a signal gantry over the royal road */}
      <rect x="72" y="-124" width="4" height="124" fill="url(#cv-iron)" />
      <rect x="34" y="-127" width="42" height="4" fill="url(#cv-iron)" />
      <rect x="38" y="-123" width="12" height="21" rx="2" fill="#1d1a1f" stroke="#8d949a" strokeWidth=".8" />
      <path d="M44 -116h.1" stroke="#c4453a" strokeWidth="5.6" strokeLinecap="round" />
      <path d="M44 -108h.1" stroke="#8fbf5a" strokeWidth="5.6" strokeLinecap="round" />
      <Track x1={-78} x2={78} y={0} />
      <rect x="-78" y="-3" width="156" height="3" fill="#d4af37" />
      <g transform="translate(58 0)">
        <rect x="-8" y="-26" width="16" height="26" fill="url(#cv-brass)" stroke={INK} strokeWidth=".9" />
        <rect x="-14" y="-24" width="28" height="7" rx="3" fill="#c4453a" stroke={INK} strokeWidth=".8" />
        <circle cx="-9" cy="-20" r="3" fill="#ffd34d" />
        <circle cx="9" cy="-20" r="3" fill="#ffd34d" />
      </g>
      {l >= 2 && (
        <>
          <path d="M-64 0V-80Q-64 -122 -14 -122Q36 -122 36 -80V0" fill="none" stroke="url(#cv-brass)" strokeWidth="6" />
          <path d="M-64 -80h100" stroke="#d4af37" strokeWidth="2" />
          <Glow x={-14} y={-90} r={50} kind="gold" className="cv-glow" />
        </>
      )}
      {l >= 3 && (
        <>
          <path d="M-60 -6h96l6 6h-108z" fill="#a82a2a" />
          <g transform="translate(-14 -132)">
            <path d="M-14 6l-4 -16 9 7 9 -12 9 12 9 -7 -4 16z" fill="#ffd34d" stroke="#7d5f2c" strokeWidth="1" />
            <circle cx="0" cy="-10" r="2" fill="#c4453a" />
          </g>
        </>
      )}
    </>
  ),
};

/* ------------------------------------------------------------ the lamp and the tier-25/50 dressing (COL-3) */

/** A static candle stub (no flicker: the chamber's only loop is its lamp). (x, y) = bottom-centre. */
function StillCandle({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <Glow x={x} y={y - 12} r={18} kind="warm" opacity={0.55} />
      <rect x={x - 3} y={y - 8} width="6" height="8" fill="#efe2c4" stroke={INK} strokeWidth=".5" />
      <path d={`M${x} ${y - 17}q3.6 5 0 8.4q-3.6 -3.4 0 -8.4z`} fill="#ffcf6a" stroke="#f08a2a" strokeWidth=".5" />
    </g>
  );
}

/**
 * Tier 25: each zone dresses its chambers its own way — two small upper-half pieces (left, right) instead of the old
 * one-size bunting. Burrow: a framed «Почётная грамота» and a second candle; sewers: a pressure gauge and a valve on
 * copper pipe; cellars: a shelf of jars and a string of drying cheese; metro: an enamel «ЦЕХЪ» sign and a dial;
 * terminal: a gilt mirror and a velvet rope. Each piece is drawn about its own centre.
 */
const ZONE_TIER_PROPS: Record<ZoneId, [ReactNode, ReactNode]> = {
  burrow: [
    <g key="a">
      <rect x="-19" y="-14" width="38" height="28" fill="url(#cv-wood)" stroke={INK} strokeWidth=".8" />
      <rect x="-16" y="-11" width="32" height="22" fill="#efe2c4" />
      <text y="-2.5" fontSize="5.6" textAnchor="middle" fill="#5c3320" className="font-display cv-fine" fontWeight="700">
        <tspan x="0">Почётная</tspan>
        <tspan x="0" dy="6.4">грамота</tspan>
      </text>
      <circle cx="10" cy="9" r="3.2" fill="#c4453a" stroke={INK} strokeWidth=".4" />
    </g>,
    <g key="b">
      <path d="M-8 6h16l-3 4h-10zM0 10v6" fill="url(#cv-brass)" stroke="#5c4520" strokeWidth=".8" />
      <StillCandle x={0} y={6} />
    </g>,
  ],
  sewers: [
    <g key="a">
      <path d="M0 22V-12" stroke="#5c3320" strokeWidth="8" />
      <path d="M0 22V-12" stroke="#b8693d" strokeWidth="6" />
      <circle cy="-2" r="9.5" fill="#efe2c4" stroke="url(#cv-brass)" strokeWidth="2.6" />
      <path d="M0 -2l5.5 -4.5M-6 2h1.5M6 2h-1.5M0 -9v1.5" stroke="#c4453a" strokeWidth="1.2" />
    </g>,
    <g key="b">
      <path d="M-16 0H16" stroke="#5c3320" strokeWidth="8" />
      <path d="M-16 0H16" stroke="#b8693d" strokeWidth="6" />
      <circle cy="-9" r="7" fill="none" stroke="#c4453a" strokeWidth="2.2" />
      <path d="M0 -16V-2M-7 -9H7M0 -2V0" stroke="#8a2a24" strokeWidth="1.3" />
    </g>,
  ],
  cellars: [
    <g key="a">
      <rect x="-20" y="8" width="40" height="4" fill="#a8743f" stroke={INK} strokeWidth=".7" />
      <path d="M-17 8v-12h9v12zM-4 8v-15h9v15zM9 8v-10h8v10z" fill="rgba(210,160,90,.55)" stroke="#e8d5a3" strokeWidth=".7" />
      <path d="M-17 -4h9M-4 -7h9M9 -2h8" stroke="#7a2a24" strokeWidth="2" />
    </g>,
    <g key="b">
      {/* small cheeses drying on a string, each in its own twine sling */}
      <path d="M-21 -12Q0 -6 21 -12M-12 -9.6v5M0 -8.5v6M12 -9.6v4" stroke="#d9c9a4" strokeWidth=".8" fill="none" />
      <path d="M-17 0a5 5 0 1 0 10 0a5 5 0 1 0 -10 0zM-6 2.5a6 6 0 1 0 12 0a6 6 0 1 0 -12 0zM8 0a4.4 4.4 0 1 0 8.8 0a4.4 4.4 0 1 0 -8.8 0z" fill="#ffd34d" stroke="#b07a1e" strokeWidth="1.1" />
      <path d="M-13 1.5h.1M2 4h.1M-2 0h.1M13 1h.1" stroke="#c99a30" strokeWidth="1.8" strokeLinecap="round" />
    </g>,
  ],
  metro: [
    <g key="a">
      <rect x="-21" y="-9" width="42" height="18" rx="2" fill="#1f3550" stroke="#eadcc0" strokeWidth="1.4" />
      <text y="3.4" fontSize="9" textAnchor="middle" fill="#eadcc0" className="font-display cv-fine" fontWeight="700" letterSpacing=".6">
        ЦЕХЪ
      </text>
    </g>,
    <g key="b">
      <circle r="10" fill="#efe2c4" stroke="#3b3f42" strokeWidth="2.4" />
      <path d="M-7 3.5l1.6 -.8M-7.6 -2l1.7 .3M-4.4 -6.6l1.1 1.3M0 -7.8v1.6M4.4 -6.6l-1.1 1.3M7.6 -2l-1.7 .3" stroke={INK} strokeWidth=".9" />
      <path d="M0 0l4.6 -4.2" stroke="#c4453a" strokeWidth="1.3" strokeLinecap="round" />
    </g>,
  ],
  terminal: [
    <g key="a">
      <ellipse rx="12" ry="16" fill="#b9cbd2" stroke="url(#cv-brass)" strokeWidth="3.2" />
      <path d="M-5 -9q-3 6 0 13" stroke="#fff" strokeWidth="1.6" fill="none" opacity=".6" />
    </g>,
    <g key="b">
      <path d="M-20 -8Q0 8 20 -8" stroke="#7a1a24" strokeWidth="3.4" fill="none" strokeLinecap="round" />
      <path d="M-20 -8v.1M20 -8v.1" stroke="url(#cv-brass)" strokeWidth="5" strokeLinecap="round" />
      <path d="M0 0v6" stroke="#d4af37" strokeWidth="2" />
    </g>,
  ],
};

/** Tier 50: a gilded niche rim and a brass nameplate with the building's name under the apex (the star stays). */
function Tier50({ id }: { id: BuildingId }) {
  const name = BUILDINGS[id].name;
  const w = name.length * 3.5 + 12;
  return (
    <g>
      <path d={NICHE} fill="none" stroke="url(#cv-brass)" strokeWidth="4" />
      <rect x={-w / 2} y="-144" width={w} height="10" rx="2" fill="url(#cv-brass)" stroke="#5c4520" strokeWidth=".7" />
      <text y="-136.6" fontSize="6.4" textAnchor="middle" fill="#2a1a0c" className="font-display cv-fine" fontWeight="700">
        {name}
      </text>
      <StarPlaque x={-w / 2 - 6} y={-136} />
    </g>
  );
}

/**
 * The building illustration plus the tier-25/50 dressing (COL-3). The two tier-25 pieces stand in the upper corners
 * and drop below the lamp when it hangs over one of them; both are drawn behind the art. `festive` (the coronation
 * of this run, a frenzy) hangs the old bunting on every chamber from tier 25.
 */
export function BuildingArt({ id, lvl, festive = false }: { id: BuildingId; lvl: number; festive?: boolean }) {
  const lamp = lampX(id, lvl);
  const props = lvl >= 25 ? ZONE_TIER_PROPS[BUILDINGS[id].zone] : null;
  const yA = Math.abs(-60 - lamp) < 30 ? -84 : -118;
  const yB = Math.abs(60 - lamp) < 30 ? -84 : -118;
  return (
    <g>
      {lvl >= 50 && <Glow x={0} y={-60} r={90} kind="gold" opacity={0.5} />}
      {props && (
        <>
          <g transform={`translate(-60 ${yA})`}>{props[0]}</g>
          <g transform={`translate(60 ${yB})`}>{props[1]}</g>
        </>
      )}
      {ART[id](lvl)}
      {lvl >= 50 && <Tier50 id={id} />}
      {festive && lvl >= 25 && <Bunting x1={-80} y1={-128} x2={80} y2={-128} n={9} sag={10} />}
    </g>
  );
}
