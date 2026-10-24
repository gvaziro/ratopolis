"use client";

/**
 * Shared SVG parts the colony is built from: everyday junk at rat scale.
 * All parts are pure, hook-free components drawn around a local origin (usually bottom-centre or bottom-left).
 */
import type { ReactNode } from "react";
import { shade } from "./geometry";

const INK = "#1a120c";

/** Gradients shared by the whole colony SVG (rendered once inside <defs>). */
export function Defs() {
  return (
    <>
      <linearGradient id="cv-silver" x1="0" x2="1">
        <stop offset="0" stopColor="#8d949a" />
        <stop offset=".35" stopColor="#e9eef0" />
        <stop offset=".7" stopColor="#b4bcc2" />
        <stop offset="1" stopColor="#6e757b" />
      </linearGradient>
      <linearGradient id="cv-copper" x1="0" x2="1">
        <stop offset="0" stopColor="#7a3f20" />
        <stop offset=".4" stopColor="#e09a63" />
        <stop offset="1" stopColor="#8a4626" />
      </linearGradient>
      <linearGradient id="cv-brass" x1="0" x2="1">
        <stop offset="0" stopColor="#7d5f2c" />
        <stop offset=".45" stopColor="#f2d896" />
        <stop offset="1" stopColor="#8f6c30" />
      </linearGradient>
      <linearGradient id="cv-wood" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stopColor="#a8743f" />
        <stop offset="1" stopColor="#6e4523" />
      </linearGradient>
      <linearGradient id="cv-iron" x1="0" x2="1">
        <stop offset="0" stopColor="#2a2622" />
        <stop offset=".5" stopColor="#5d554d" />
        <stop offset="1" stopColor="#24201c" />
      </linearGradient>
      <linearGradient id="cv-rays" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stopColor="#fff1c8" stopOpacity=".34" />
        <stop offset=".55" stopColor="#f2d48a" stopOpacity=".08" />
        <stop offset="1" stopColor="#f2d48a" stopOpacity="0" />
      </linearGradient>
      <linearGradient id="cv-street" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stopColor="#3a3226" />
        <stop offset="1" stopColor="#1d1813" />
      </linearGradient>
      <linearGradient id="cv-skylight" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stopColor="#fff4d0" />
        <stop offset="1" stopColor="#e2b862" />
      </linearGradient>
      {/* CO-5: the grate glass and its rays follow the human clock */}
      <linearGradient id="cv-skylight-dusk" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stopColor="#ffd2a0" />
        <stop offset="1" stopColor="#c9784a" />
      </linearGradient>
      <linearGradient id="cv-skylight-night" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stopColor="#26314d" />
        <stop offset="1" stopColor="#46557a" />
      </linearGradient>
      <linearGradient id="cv-rays-dusk" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stopColor="#ffb36b" stopOpacity=".3" />
        <stop offset=".55" stopColor="#ffb36b" stopOpacity=".07" />
        <stop offset="1" stopColor="#ffb36b" stopOpacity="0" />
      </linearGradient>
      <linearGradient id="cv-rays-night" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stopColor="#a9c1ff" stopOpacity=".18" />
        <stop offset=".55" stopColor="#a9c1ff" stopOpacity=".04" />
        <stop offset="1" stopColor="#a9c1ff" stopOpacity="0" />
      </linearGradient>
      {(
        [
          ["warm", "#f2b84b"],
          ["teal", "#7fd1b9"],
          ["red", "#ff4a2a"],
          ["gold", "#ffd34d"],
          ["white", "#fff6dc"],
          ["blue", "#9ec9ff"],
        ] as const
      ).map(([k, c]) => (
        <radialGradient key={k} id={`cv-glow-${k}`}>
          <stop offset="0" stopColor={c} stopOpacity=".85" />
          <stop offset=".45" stopColor={c} stopOpacity=".28" />
          <stop offset="1" stopColor={c} stopOpacity="0" />
        </radialGradient>
      ))}
      <linearGradient id="cv-vig-l" x1="1" x2="0">
        <stop offset="0" stopColor="#000" stopOpacity="0" />
        <stop offset="1" stopColor="#000" stopOpacity=".85" />
      </linearGradient>
      <linearGradient id="cv-vig-r" x1="0" x2="1">
        <stop offset="0" stopColor="#000" stopOpacity="0" />
        <stop offset="1" stopColor="#000" stopOpacity=".85" />
      </linearGradient>
      <pattern id="cv-bricks" width="40" height="20" patternUnits="userSpaceOnUse">
        <rect width="40" height="20" fill="#2a4a48" />
        <path d="M0 .5H40M0 10.5H40M10 0V10M30 10V20" stroke="#173130" strokeWidth="1.4" />
      </pattern>
      <pattern id="cv-tiles" width="24" height="12" patternUnits="userSpaceOnUse">
        <rect width="24" height="12" fill="#d9d6cc" />
        <path d="M0 .5H24M.5 0V12M12.5 0V0" stroke="#9c988e" strokeWidth="1" />
      </pattern>
      <linearGradient id="cv-band-shade" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stopColor="#000" stopOpacity=".45" />
        <stop offset=".25" stopColor="#000" stopOpacity="0" />
        <stop offset=".8" stopColor="#000" stopOpacity=".05" />
        <stop offset="1" stopColor="#000" stopOpacity=".35" />
      </linearGradient>
      <linearGradient id="cv-terminal-light" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stopColor="#ffe6a8" stopOpacity=".35" />
        <stop offset=".5" stopColor="#e8d5a3" stopOpacity=".08" />
        <stop offset="1" stopColor="#000" stopOpacity="0" />
      </linearGradient>
      <linearGradient id="cv-soot" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stopColor="#14121a" stopOpacity=".92" />
        <stop offset=".5" stopColor="#1e1c26" stopOpacity=".55" />
        <stop offset="1" stopColor="#2a2833" stopOpacity=".2" />
      </linearGradient>
      {/* CO-8: the next zone seen through the rock — desaturated and darkened */}
      <filter id="cv-silhouette" x="-5%" y="-5%" width="110%" height="110%">
        <feColorMatrix type="matrix" values=".22 .22 .22 0 .02  .2 .2 .2 0 .02  .18 .18 .18 0 .03  0 0 0 1 0" />
      </filter>
      <linearGradient id="cv-feather" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stopColor="#0d0a08" stopOpacity="1" />
        <stop offset="1" stopColor="#0d0a08" stopOpacity="0" />
      </linearGradient>
    </>
  );
}

export type GlowKind = "warm" | "teal" | "red" | "gold" | "white" | "blue";

export function Glow({ x, y, r, kind = "warm", className, opacity = 1 }: { x: number; y: number; r: number; kind?: GlowKind; className?: string; opacity?: number }) {
  return <circle cx={x} cy={y} r={r} fill={`url(#cv-glow-${kind})`} className={className} opacity={opacity} />;
}

/** A matchbox lying on its long side. (x, y) = bottom-left. */
export function Matchbox({ x, y, w = 44, h = 22, color = "#b8402e", open = 0, windows = 0, label = true }: { x: number; y: number; w?: number; h?: number; color?: string; open?: number; windows?: number; label?: boolean }) {
  const d = 6;
  return (
    <g>
      {open > 0 && <rect x={x - open} y={y - h + 3} width={open + 4} height={h - 3} fill="#d9b07a" stroke={INK} strokeWidth=".8" />}
      <path d={`M${x} ${y - h}l${d} ${-d}h${w}l${-d} ${d}z`} fill={shade(color, 0.25)} stroke={INK} strokeWidth=".8" />
      <path d={`M${x + w} ${y - h}l${d} ${-d}v${h}l${-d} ${d}z`} fill="#5c3320" stroke={INK} strokeWidth=".8" />
      <rect x={x} y={y - h} width={w} height={h} fill={color} stroke={INK} strokeWidth=".9" />
      {label && windows === 0 && (
        <>
          <rect x={x + w * 0.18} y={y - h * 0.68} width={w * 0.64} height={h * 0.36} fill="#efe2c4" />
          <circle cx={x + w / 2} cy={y - h / 2} r={Math.min(3.2, h * 0.14)} fill={color} />
        </>
      )}
      {windows > 0 &&
        Array.from({ length: windows }, (_, i) => (
          <rect key={i} x={x + 5 + i * ((w - 10) / windows)} y={y - h * 0.72} width={(w - 10) / windows - 4} height={h * 0.42} rx="1" fill={i % 3 === 1 ? "#3a2a1a" : "#ffd98a"} stroke={INK} strokeWidth=".6" />
        ))}
    </g>
  );
}

/** Silver snuffbox with a crest. (x, y) = bottom-left. */
export function Snuffbox({ x, y, w = 56, h = 20, lid = 0 }: { x: number; y: number; w?: number; h?: number; lid?: number }) {
  return (
    <g>
      <rect x={x} y={y - h} width={w} height={h} rx="4" fill="url(#cv-silver)" stroke="#3b3f42" strokeWidth="1" />
      <rect x={x + 3} y={y - h + 4} width={w - 6} height={h - 8} rx="3" fill="none" stroke="#7e868c" strokeWidth=".8" />
      <circle cx={x + w / 2} cy={y - h / 2} r={h * 0.26} fill="#d8dee2" stroke="#6d757b" strokeWidth=".8" />
      <path d={`M${x + w / 2 - 3} ${y - h / 2 + 2}l3 -5 3 5z`} fill="#8a6f3a" />
      <g transform={`rotate(${-lid} ${x} ${y - h})`}>
        <rect x={x - 1} y={y - h - 6} width={w + 2} height="7" rx="3" fill="url(#cv-silver)" stroke="#3b3f42" strokeWidth="1" />
      </g>
    </g>
  );
}

/** Silver thimble standing upright. (x, y) = bottom-centre. */
export function Thimble({ x, y, w = 22, h = 24, gold = false }: { x: number; y: number; w?: number; h?: number; gold?: boolean }) {
  const dots: ReactNode[] = [];
  for (let r = 0; r < 3; r++)
    for (let c = -2; c <= 2; c++) dots.push(<circle key={`${r}${c}`} cx={x + c * w * 0.14} cy={y - h * (0.35 + r * 0.17)} r=".9" fill="rgba(0,0,0,.35)" />);
  return (
    <g>
      <path d={`M${x - w / 2} ${y}L${x - w * 0.38} ${y - h * 0.82}Q${x} ${y - h * 1.12} ${x + w * 0.38} ${y - h * 0.82}L${x + w / 2} ${y}z`} fill={gold ? "url(#cv-brass)" : "url(#cv-silver)"} stroke="#3b3f42" strokeWidth=".9" />
      {dots}
      <rect x={x - w / 2 - 1} y={y - 4} width={w + 2} height="4" rx="1.5" fill={gold ? "#b8913f" : "#9aa2a8"} stroke="#3b3f42" strokeWidth=".7" />
    </g>
  );
}

/** Thimble on wheels (narrow-gauge wagon). (x, y) = rail level centre. */
export function ThimbleCart({ x, y, cargo, flag }: { x: number; y: number; cargo?: string; flag?: boolean }) {
  return (
    <g>
      <path d={`M${x - 13} ${y - 15}h26l-3 10h-20z`} fill="url(#cv-silver)" stroke="#3b3f42" strokeWidth=".8" />
      <circle cx={x - 7} cy={y - 3} r="3.2" fill="#2b2622" stroke="#9aa2a8" strokeWidth="1" />
      <circle cx={x + 7} cy={y - 3} r="3.2" fill="#2b2622" stroke="#9aa2a8" strokeWidth="1" />
      {cargo && (
        <text x={x} y={y - 15} fontSize="11" textAnchor="middle">
          {cargo}
        </text>
      )}
      {flag && (
        <g>
          <line x1={x + 11} y1={y - 15} x2={x + 11} y2={y - 30} stroke="#3a2a1a" strokeWidth="1" />
          <path d={`M${x + 11} ${y - 30}l9 3 -9 3z`} fill="#c4453a" />
        </g>
      )}
    </g>
  );
}

/** Copper teapot. (x, y) = bottom-centre. */
export function Teapot({ x, y, s = 1, steam = true }: { x: number; y: number; s?: number; steam?: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path d="M22 -20 Q40 -22 44 -40 L40 -40 Q34 -28 22 -27z" fill="url(#cv-copper)" stroke={INK} strokeWidth="1" />
      <path d="M-24 -14 Q-40 -18 -36 -30 Q-32 -38 -22 -32" fill="none" stroke="#8a4626" strokeWidth="4" />
      <ellipse cx="0" cy="-20" rx="26" ry="20" fill="url(#cv-copper)" stroke={INK} strokeWidth="1.1" />
      <ellipse cx="0" cy="-38" rx="14" ry="4" fill="#c97c47" stroke={INK} strokeWidth="1" />
      <circle cx="0" cy="-44" r="3.5" fill="#e8c983" stroke={INK} strokeWidth=".8" />
      <path d="M-14 -26 Q-6 -34 6 -30" fill="none" stroke="#f6c9a0" strokeWidth="2" opacity=".7" />
      <rect x="-22" y="-3" width="44" height="3" rx="1.5" fill="#5c3320" />
      {steam && <Steam x={44} y={-42} n={2} />}
    </g>
  );
}

/** Tin can (cylinder). (x, y) = bottom-centre. */
export function TinCan({ x, y, w = 30, h = 34, band = "#b8402e", lidTilt = 0 }: { x: number; y: number; w?: number; h?: number; band?: string; lidTilt?: number }) {
  return (
    <g>
      <rect x={x - w / 2} y={y - h} width={w} height={h} fill="url(#cv-silver)" stroke="#3b3f42" strokeWidth=".9" />
      <rect x={x - w / 2} y={y - h * 0.68} width={w} height={h * 0.4} fill={band} stroke="#3b3f42" strokeWidth=".6" />
      <path d={`M${x - w / 2 + 3} ${y - h * 0.5}h${w - 6}`} stroke="#efe2c4" strokeWidth="1.4" strokeDasharray="3 2" />
      <ellipse cx={x} cy={y} rx={w / 2} ry="3" fill="#7e868c" />
      <g transform={`rotate(${-lidTilt} ${x - w / 2} ${y - h})`}>
        <ellipse cx={x} cy={y - h} rx={w / 2 + 1} ry="3.4" fill="#d6dce0" stroke="#3b3f42" strokeWidth=".8" />
      </g>
    </g>
  );
}

/** Round candy tin (low and wide). (x, y) = bottom-centre. */
export function CandyTin({ x, y, w = 50, h = 16, color = "#5b7fa8", lid = 0, gold = false }: { x: number; y: number; w?: number; h?: number; color?: string; lid?: number; gold?: boolean }) {
  return (
    <g>
      <rect x={x - w / 2} y={y - h} width={w} height={h} rx="3" fill={color} stroke={INK} strokeWidth=".9" />
      <path d={`M${x - w / 2 + 4} ${y - h / 2}h${w - 8}`} stroke="#efe2c4" strokeWidth="1.2" strokeDasharray="2 3" />
      <g transform={`rotate(${-lid} ${x + w / 2} ${y - h})`}>
        <rect x={x - w / 2 - 2} y={y - h - 5} width={w + 4} height="6" rx="3" fill={gold ? "url(#cv-brass)" : "url(#cv-silver)"} stroke={INK} strokeWidth=".8" />
      </g>
    </g>
  );
}

/** Wooden thread spool. (x, y) = bottom-centre. */
export function Spool({ x, y, h = 26, w = 20, color = "#c4453a" }: { x: number; y: number; h?: number; w?: number; color?: string }) {
  return (
    <g>
      <rect x={x - w / 2} y={y - 4} width={w} height="4" rx="1.5" fill="#c19a64" stroke={INK} strokeWidth=".7" />
      <rect x={x - w / 2 + 3} y={y - h + 4} width={w - 6} height={h - 8} fill={color} stroke={INK} strokeWidth=".6" />
      <path d={`M${x - w / 2 + 3} ${y - h * 0.4}h${w - 6}M${x - w / 2 + 3} ${y - h * 0.6}h${w - 6}`} stroke="rgba(0,0,0,.25)" strokeWidth=".8" />
      <rect x={x - w / 2} y={y - h} width={w} height="4" rx="1.5" fill="#c19a64" stroke={INK} strokeWidth=".7" />
    </g>
  );
}

/** Wine cork. (x, y) = bottom-centre. */
export function Cork({ x, y, w = 12, h = 22 }: { x: number; y: number; w?: number; h?: number }) {
  return (
    <g>
      <rect x={x - w / 2} y={y - h} width={w} height={h} rx="2" fill="#c49a62" stroke={INK} strokeWidth=".8" />
      <circle cx={x - 2} cy={y - h * 0.3} r=".9" fill="#8a6438" />
      <circle cx={x + 2} cy={y - h * 0.65} r="1" fill="#8a6438" />
    </g>
  );
}

/** Crimped bottle cap used as a bin. (x, y) = bottom-centre. */
export function BottleCap({ x, y, w = 26, color = "#c4453a", fill }: { x: number; y: number; w?: number; color?: string; fill?: string }) {
  const n = 8;
  let d = `M${x - w / 2} ${y - 9}`;
  for (let i = 0; i <= n; i++) d += `L${x - w / 2 + (i * w) / n} ${y - (i % 2 ? 6 : 9)}`;
  d += `L${x + w / 2} ${y}L${x - w / 2} ${y}z`;
  return (
    <g>
      {fill && <ellipse cx={x} cy={y - 9} rx={w / 2 - 2} ry="4" fill={fill} />}
      <path d={d} fill={color} stroke={INK} strokeWidth=".8" />
      <path d={`M${x - w / 2 + 2} ${y - 3}h${w - 4}`} stroke="rgba(255,255,255,.35)" strokeWidth="1" />
    </g>
  );
}

/** Striped sock (hanging or lying). Path in a 40×40 box, (x, y) = top-left. */
export function Sock({ x, y, s = 1, color = "#8a5a9a", stripe = "#eadcc0", rot = 0 }: { x: number; y: number; s?: number; color?: string; stripe?: string; rot?: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot}) scale(${s})`}>
      <path d="M4 0h14v24q0 6 6 7l10 2q6 2 4 8-1 4-7 3l-18-3Q4 40 4 30z" fill={color} stroke={INK} strokeWidth="1" />
      <path d="M4 6h14M4 12h14M4 18h14" stroke={stripe} strokeWidth="2.4" />
      <path d="M30 34q4 1 6 4" stroke={stripe} strokeWidth="2" fill="none" />
    </g>
  );
}

/** Oak barrel standing. (x, y) = bottom-centre. */
export function Barrel({ x, y, w = 40, h = 48, tap = false }: { x: number; y: number; w?: number; h?: number; tap?: boolean }) {
  const b = w * 0.12;
  return (
    <g>
      <path d={`M${x - w / 2 + b} ${y}Q${x - w / 2 - b} ${y - h / 2} ${x - w / 2 + b} ${y - h}H${x + w / 2 - b}Q${x + w / 2 + b} ${y - h / 2} ${x + w / 2 - b} ${y}z`} fill="url(#cv-wood)" stroke={INK} strokeWidth="1" />
      <path d={`M${x - w / 4} ${y}Q${x - w / 3} ${y - h / 2} ${x - w / 4} ${y - h}M${x + w / 4} ${y}Q${x + w / 3} ${y - h / 2} ${x + w / 4} ${y - h}M${x} ${y}V${y - h}`} stroke="rgba(0,0,0,.25)" strokeWidth=".8" fill="none" />
      <path d={`M${x - w / 2 + 1} ${y - h * 0.22}H${x + w / 2 - 1}M${x - w / 2 + 1} ${y - h * 0.78}H${x + w / 2 - 1}`} stroke="#3b3f42" strokeWidth="2.6" />
      {tap && (
        <g>
          <rect x={x - 3} y={y - h * 0.45} width="10" height="4" fill="url(#cv-brass)" stroke={INK} strokeWidth=".6" />
          <circle cx={x + 5} cy={y - h * 0.38} r="1.6" fill="#b04a2a" className="cv-drip" style={{ ["--fall" as string]: "18px" }} />
        </g>
      )}
    </g>
  );
}

/** Barrel lying on its side (round end facing us). (x, y) = bottom-centre. */
export function BarrelEnd({ x, y, r = 22 }: { x: number; y: number; r?: number }) {
  return (
    <g>
      <circle cx={x} cy={y - r} r={r} fill="url(#cv-wood)" stroke={INK} strokeWidth="1" />
      <circle cx={x} cy={y - r} r={r - 4} fill="none" stroke="#3b3f42" strokeWidth="2.4" />
      <path d={`M${x - r + 5} ${y - r}H${x + r - 5}M${x} ${y - 2 * r + 5}V${y - 5}`} stroke="rgba(0,0,0,.25)" strokeWidth=".8" />
    </g>
  );
}

/** Cheese wheel (side view) — (x, y) = bottom-centre. */
export function CheeseWheel({ x, y, w = 40, h = 16 }: { x: number; y: number; w?: number; h?: number }) {
  return (
    <g>
      <rect x={x - w / 2} y={y - h} width={w} height={h} fill="#e8b84b" stroke={INK} strokeWidth=".9" />
      <ellipse cx={x} cy={y - h} rx={w / 2} ry={h * 0.28} fill="#ffd96b" stroke={INK} strokeWidth=".9" />
      <circle cx={x - w * 0.2} cy={y - h * 0.45} r="1.8" fill="#c99a30" />
      <circle cx={x + w * 0.22} cy={y - h * 0.6} r="1.3" fill="#c99a30" />
    </g>
  );
}

/** Cheese wedge. (x, y) = bottom-left. */
export function CheeseWedge({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path d="M0 0h30v-12z" fill="#ffd34d" stroke={INK} strokeWidth="1" />
      <path d="M0 0l30 -12v-4L0 -4z" fill="#ffe388" stroke={INK} strokeWidth=".8" />
      <circle cx="18" cy="-4" r="1.8" fill="#d9a92c" />
      <circle cx="25" cy="-6" r="1.2" fill="#d9a92c" />
    </g>
  );
}

/** Book standing on a shelf, spine facing us. (x, y) = bottom-left. */
export function Book({ x, y, w = 12, h = 44, color = "#7a2a24" }: { x: number; y: number; w?: number; h?: number; color?: string }) {
  return (
    <g>
      <rect x={x} y={y - h} width={w} height={h} rx="1.5" fill={color} stroke={INK} strokeWidth=".8" />
      <path d={`M${x} ${y - h + 5}h${w}M${x} ${y - 5}h${w}`} stroke="#e8c983" strokeWidth="1.2" />
      <rect x={x + 2} y={y - h * 0.62} width={w - 4} height={h * 0.22} fill="#e8c983" opacity=".75" />
    </g>
  );
}

const gearCache = new Map<string, string>();
function gearPath(r: number, teeth: number): string {
  const key = `${r}:${teeth}`;
  const hit = gearCache.get(key);
  if (hit) return hit;
  let d = "";
  const ro = r;
  const ri = r * 0.78;
  for (let i = 0; i < teeth; i++) {
    const a0 = (i / teeth) * Math.PI * 2;
    const a1 = ((i + 0.25) / teeth) * Math.PI * 2;
    const a2 = ((i + 0.5) / teeth) * Math.PI * 2;
    const a3 = ((i + 0.75) / teeth) * Math.PI * 2;
    const p = (a: number, rr: number) => `${(Math.cos(a) * rr).toFixed(2)} ${(Math.sin(a) * rr).toFixed(2)}`;
    d += `${i === 0 ? "M" : "L"}${p(a0, ri)}L${p(a1, ro)}L${p(a2, ro)}L${p(a3, ri)}`;
  }
  d += "z";
  gearCache.set(key, d);
  return d;
}

/** Brass gear centred at (x, y). */
export function Gear({ x, y, r = 14, teeth = 10, spin, color = "url(#cv-brass)" }: { x: number; y: number; r?: number; teeth?: number; spin?: "cw" | "ccw" | "slow"; color?: string }) {
  const cls = spin === "cw" ? "cv-spin" : spin === "ccw" ? "cv-spin-rev" : spin === "slow" ? "cv-spin-slow" : undefined;
  return (
    <g transform={`translate(${x} ${y})`}>
      <g className={cls}>
        <path d={gearPath(r, teeth)} fill={color} stroke={INK} strokeWidth=".9" />
        <circle r={r * 0.32} fill="#3a2a1a" stroke={INK} strokeWidth=".8" />
        <circle r={r * 0.55} fill="none" stroke="rgba(0,0,0,.25)" strokeWidth="1" />
      </g>
    </g>
  );
}

/** Candle stub with a flickering flame. (x, y) = bottom-centre. */
export function Candle({ x, y, h = 14, glow = true }: { x: number; y: number; h?: number; glow?: boolean }) {
  return (
    <g>
      {glow && <Glow x={x} y={y - h - 6} r={26} kind="warm" className="cv-glow" />}
      <rect x={x - 4} y={y - h} width="8" height={h} rx="1.5" fill="#efe2c4" stroke={INK} strokeWidth=".7" />
      <path d={`M${x - 4} ${y - h + 3}q2 3 0 6`} stroke="#d9c9a4" strokeWidth="1.4" fill="none" />
      <line x1={x} y1={y - h} x2={x} y2={y - h - 3} stroke={INK} strokeWidth="1" />
      <path className="cv-flicker" d={`M${x} ${y - h - 13}q5 7 0 10q-5 -3 0 -10z`} fill="#ffcf6a" stroke="#f08a2a" strokeWidth=".6" />
    </g>
  );
}

/** Bunting of candy-wrapper flags between two points (sagging). */
export function Bunting({ x1, y1, x2, y2, n = 7, sag = 10 }: { x1: number; y1: number; x2: number; y2: number; n?: number; sag?: number }) {
  const colors = ["#c4453a", "#e8c983", "#4f9d8a", "#8fb8ff", "#e39ab0", "#f2b84b"];
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2 + sag;
  const flags: ReactNode[] = [];
  for (let i = 1; i <= n; i++) {
    const t = i / (n + 1);
    const px = (1 - t) * (1 - t) * x1 + 2 * (1 - t) * t * mx + t * t * x2;
    const py = (1 - t) * (1 - t) * y1 + 2 * (1 - t) * t * my + t * t * y2;
    flags.push(<path key={i} d={`M${px - 4} ${py}h8l-4 9z`} fill={colors[i % colors.length]} stroke={INK} strokeWidth=".5" />);
  }
  return (
    <g>
      <path d={`M${x1} ${y1}Q${mx} ${my + sag * 0.0} ${x2} ${y2}`} stroke="#3a2a1a" strokeWidth=".8" fill="none" />
      {flags}
    </g>
  );
}

/** Pennant on a matchstick pole. (x, y) = pole bottom. */
export function Pennant({ x, y, h = 30, color = "#c4453a" }: { x: number; y: number; h?: number; color?: string }) {
  return (
    <g>
      <line x1={x} y1={y} x2={x} y2={y - h} stroke="#d9b07a" strokeWidth="2" />
      <circle cx={x} cy={y - h - 1} r="2" fill="#c4453a" />
      <path d={`M${x + 1} ${y - h + 1}l14 4 -14 5z`} fill={color} stroke={INK} strokeWidth=".5" />
    </g>
  );
}

/** Pile of coins. (x, y) = bottom-centre. */
export function Coins({ x, y, n = 3, gold = "#f5d76e" }: { x: number; y: number; n?: number; gold?: string }) {
  return (
    <g>
      {Array.from({ length: n }, (_, i) => (
        <ellipse key={i} cx={x + (i % 2 ? 1.5 : -1)} cy={y - 2 - i * 3} rx="7" ry="2.6" fill={gold} stroke="#8a6f3a" strokeWidth=".7" />
      ))}
    </g>
  );
}

/** Mound of crumbs. (x, y) = bottom-centre. */
export function CrumbPile({ x, y, w = 40, h = 12 }: { x: number; y: number; w?: number; h?: number }) {
  return (
    <g>
      <path d={`M${x - w / 2} ${y}Q${x - w / 4} ${y - h} ${x} ${y - h}Q${x + w / 4} ${y - h} ${x + w / 2} ${y}z`} fill="#d9a95a" stroke="#8a6438" strokeWidth=".8" />
      <circle cx={x - w * 0.18} cy={y - h * 0.55} r="2.2" fill="#f0d49a" />
      <circle cx={x + w * 0.1} cy={y - h * 0.75} r="2.6" fill="#e6c27a" />
      <circle cx={x + w * 0.28} cy={y - h * 0.35} r="1.8" fill="#f0d49a" />
    </g>
  );
}

/** Heap of rags. (x, y) = bottom-centre. */
export function RagPile({ x, y, w = 70 }: { x: number; y: number; w?: number }) {
  const h = w * 0.36;
  return (
    <g>
      <path d={`M${x - w / 2} ${y}Q${x - w * 0.42} ${y - h} ${x - w * 0.1} ${y - h * 0.9}Q${x + w * 0.1} ${y - h * 1.25} ${x + w * 0.3} ${y - h * 0.8}Q${x + w * 0.52} ${y - h * 0.5} ${x + w / 2} ${y}z`} fill="#7a5a8a" stroke={INK} strokeWidth="1" />
      <path d={`M${x - w * 0.42} ${y}Q${x - w * 0.3} ${y - h * 0.7} ${x - w * 0.05} ${y - h * 0.55}Q${x + w * 0.05} ${y - h * 0.2} ${x} ${y}z`} fill="#b8693d" stroke={INK} strokeWidth=".8" />
      <path d={`M${x + w * 0.02} ${y}Q${x + w * 0.12} ${y - h * 0.8} ${x + w * 0.35} ${y - h * 0.55}Q${x + w * 0.46} ${y - h * 0.3} ${x + w * 0.44} ${y}z`} fill="#4f9d8a" stroke={INK} strokeWidth=".8" />
      <path d={`M${x - w * 0.2} ${y - h * 0.45}l${w * 0.12} -3M${x + w * 0.15} ${y - h * 0.4}l${w * 0.1} 2`} stroke="#eadcc0" strokeWidth="1" strokeDasharray="2 2" />
    </g>
  );
}

/** Copper pipe from (x1, y1) to (x2, y2) with joint collars. */
export function Pipe({ x1, y1, x2, y2, r = 5, color = "#b8693d" }: { x1: number; y1: number; x2: number; y2: number; r?: number; color?: string }) {
  return (
    <g>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#5c3320" strokeWidth={r * 2 + 2} strokeLinecap="round" />
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={r * 2} strokeLinecap="round" />
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#f0b48a" strokeWidth={r * 0.5} strokeLinecap="round" opacity=".55" transform={`translate(${-r * 0.35} ${-r * 0.35})`} />
    </g>
  );
}

/** Spoked wheel (pram wheel / water wheel). */
export function SpokeWheel({ x, y, r = 24, spokes = 8, spin, paddles = false }: { x: number; y: number; r?: number; spokes?: number; spin?: boolean; paddles?: boolean }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <g className={spin ? "cv-spin-slow" : undefined}>
        <circle r={r} fill="none" stroke="#2b2622" strokeWidth="4" />
        <circle r={r} fill="none" stroke="#8d949a" strokeWidth="1.6" />
        {Array.from({ length: spokes }, (_, i) => {
          const a = (i / spokes) * Math.PI * 2;
          return (
            <g key={i}>
              <line x1="0" y1="0" x2={Math.cos(a) * r} y2={Math.sin(a) * r} stroke="#8d949a" strokeWidth="1.4" />
              {paddles && <rect x={Math.cos(a) * r - 4} y={Math.sin(a) * r - 4} width="8" height="8" fill="#a8743f" stroke="#3a2a1a" strokeWidth=".7" transform={`rotate(${(a * 180) / Math.PI} ${Math.cos(a) * r} ${Math.sin(a) * r})`} />}
            </g>
          );
        })}
        <circle r={r * 0.18} fill="url(#cv-brass)" stroke={INK} strokeWidth=".8" />
      </g>
    </g>
  );
}

/** Hanging oil lantern. (x, y) = hook point. */
export function Lantern({ x, y, kind = "warm" }: { x: number; y: number; kind?: GlowKind }) {
  return (
    <g>
      <Glow x={x} y={y + 16} r={34} kind={kind} className="cv-glow" />
      <line x1={x} y1={y} x2={x} y2={y + 6} stroke="#2b2622" strokeWidth="1" />
      <path d={`M${x - 6} ${y + 8}h12l-2 14h-8z`} fill="#ffe3a0" stroke="#2b2622" strokeWidth="1.4" />
      <path d={`M${x - 7} ${y + 6}h14l-2 3h-10z`} fill="#2b2622" />
    </g>
  );
}

/** Small wooden sign with text. (x, y) = centre. */
export function Sign({ x, y, text, w, color = "#a8743f", ink = "#2a1a0c", size = 8 }: { x: number; y: number; text: string; w?: number; color?: string; ink?: string; size?: number }) {
  const ww = w ?? text.length * size * 0.72 + 10;
  return (
    <g>
      <rect x={x - ww / 2} y={y - size} width={ww} height={size * 1.9} rx="2" fill={color} stroke={INK} strokeWidth=".8" />
      <text x={x} y={y + size * 0.32} fontSize={size} textAnchor="middle" fill={ink} className="font-display" fontWeight="700">
        {text}
      </text>
    </g>
  );
}

/** Rising steam puffs. (x, y) = vent. */
export function Steam({ x, y, n = 3, color = "#e6ecee" }: { x: number; y: number; n?: number; color?: string }) {
  return (
    <g>
      {Array.from({ length: n }, (_, i) => (
        <circle
          key={i}
          cx={x}
          cy={y}
          r={5 + i * 1.5}
          fill={color}
          className="cv-steam"
          style={{ animationDelay: `${(i * 3.4) / n}s`, ["--dx" as string]: `${(i % 2 ? -1 : 1) * (6 + i * 3)}px` }}
        />
      ))}
    </g>
  );
}

/** Brass plaque with a star (tier 50 decoration). (x, y) = centre. */
export function StarPlaque({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <circle cx={x} cy={y} r="9" fill="url(#cv-brass)" stroke={INK} strokeWidth=".9" />
      <path d={`M${x} ${y - 6}l1.8 3.8 4.2.6-3 2.9.7 4.2-3.7-2-3.7 2 .7-4.2-3-2.9 4.2-.6z`} fill="#fff1b8" stroke="#7d5f2c" strokeWidth=".5" />
    </g>
  );
}

/** Clothes-peg (used as a vice / clamp). (x, y) = bottom-centre. */
export function Peg({ x, y, rot = 0 }: { x: number; y: number; rot?: number }) {
  return (
    <g transform={`rotate(${rot} ${x} ${y})`}>
      <rect x={x - 5} y={y - 26} width="4" height="26" rx="1.5" fill="#d9b07a" stroke={INK} strokeWidth=".7" />
      <rect x={x + 1} y={y - 26} width="4" height="26" rx="1.5" fill="#cfa66e" stroke={INK} strokeWidth=".7" />
      <circle cx={x} cy={y - 12} r="3" fill="none" stroke="#8d949a" strokeWidth="1.4" />
    </g>
  );
}

/** Plank shelf on two corks. (x, y) = left end at plank top. */
export function Shelf({ x, y, w = 80, legs = 22 }: { x: number; y: number; w?: number; legs?: number }) {
  return (
    <g>
      <Cork x={x + 6} y={y + legs + 4} h={legs} w={9} />
      <Cork x={x + w - 6} y={y + legs + 4} h={legs} w={9} />
      <rect x={x} y={y} width={w} height="4" rx="1" fill="#a8743f" stroke={INK} strokeWidth=".8" />
    </g>
  );
}

/** Suitcase (front view). (x, y) = bottom-left. */
export function Suitcase({ x, y, w = 46, h = 30, color = "#7a4a2a", open = false }: { x: number; y: number; w?: number; h?: number; color?: string; open?: boolean }) {
  return (
    <g>
      {open && <rect x={x} y={y - h - h * 0.7} width={w} height={h * 0.7} rx="3" fill={shade(color, -0.2)} stroke={INK} strokeWidth=".9" />}
      <rect x={x} y={y - h} width={w} height={h} rx="3" fill={color} stroke={INK} strokeWidth="1" />
      <path d={`M${x + 6} ${y - h}v${h}M${x + w - 6} ${y - h}v${h}`} stroke="#3a2416" strokeWidth="2.4" />
      {!open && <path d={`M${x + w / 2 - 7} ${y - h}q7 -8 14 0`} fill="none" stroke="#3a2416" strokeWidth="2.4" />}
      <rect x={x + w / 2 - 3} y={y - h + 3} width="6" height="4" fill="url(#cv-brass)" />
      <rect x={x + 9} y={y - h * 0.55} width="10" height="7" fill="#efe2c4" transform={`rotate(-8 ${x + 14} ${y - h * 0.5})`} />
    </g>
  );
}
