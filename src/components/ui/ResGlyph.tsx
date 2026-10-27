"use client";

/**
 * Drawn icons for the twelve resources, the five zones and the fog (v3 SHL-5, visuals-6): the colony's own style —
 * 24×24, an INK outline of 0.8, brass / copper / silver gradients — instead of OS emoji, which disagree between
 * systems (on Windows 🔘 is a grey radio button, 🪨 coal a white rock, 🌫️ a blank square).
 * GameRoot (and the dev art gallery) mount <ResGlyphDefs/> once: a 0×0 svg whose <symbol id="rg-<id>"> entries every
 * <ResGlyph/> instances with <use href>, so a glyph costs two DOM nodes wherever it shows (the pills, CostList,
 * AmountList, cards, the haul card through the kit). Emoji inside prose (toasts, the ticker) stay as they are.
 */
import { memo, type ReactNode } from "react";
import type { ResId, ZoneId } from "@/game/types";

const INK = "#1a120c";
const W = 0.8;

export type GlyphId = ResId | `zone-${ZoneId}` | "fog";

/**
 * A glyph sized to the surrounding text (`size`, 1em by default: a text-* class scales it), aligned like an emoji
 * would be. Decorative unless `label` is given.
 */
export function ResGlyph({ id, className, label, size = "1em" }: { id: GlyphId; className?: string; label?: string; size?: string }) {
  // (no cx here: the kit imports this file); the size is inline so a caller's class never fights it
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      style={{ width: size, height: size }}
      className={`inline-block shrink-0 overflow-visible align-[-0.14em]${className ? ` ${className}` : ""}`}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <use href={`#rg-${id}`} />
    </svg>
  );
}

/* ------------------------------------------------------------ the art */

const crumb = (
  <g>
    <path
      d="M4.4 14.4C3.4 10.4 6.6 6.7 10.6 6.4C13 5 16.7 5.6 18.4 8C20.6 9.6 20.8 13.4 19 15.6C17.4 18.6 12.8 19.2 9.6 18.2C6.8 17.8 5 16.6 4.4 14.4Z"
      fill="url(#rg-g-crumb)"
      stroke={INK}
      strokeWidth={W}
    />
    <path d="M6.2 11.2C7.4 8.6 10 7.6 12.4 7.6" stroke="#fff3d0" strokeWidth="1.3" strokeLinecap="round" fill="none" opacity=".75" />
    <ellipse cx="9.2" cy="12.6" rx=".9" ry=".7" fill="#a8702e" />
    <ellipse cx="13.6" cy="10.8" rx=".8" ry=".6" fill="#a8702e" />
    <ellipse cx="15.8" cy="14.2" rx="1" ry=".7" fill="#a8702e" />
    <ellipse cx="11.6" cy="15.8" rx=".7" ry=".5" fill="#a8702e" />
    <circle cx="20.6" cy="19" r="1.4" fill="url(#rg-g-crumb)" stroke={INK} strokeWidth={W} />
    <circle cx="4.2" cy="19.6" r=".9" fill="url(#rg-g-crumb)" stroke={INK} strokeWidth={W * 0.8} />
  </g>
);

const penny = (
  <g>
    <circle cx="12" cy="12" r="9.2" fill="url(#rg-g-copper)" stroke={INK} strokeWidth={W} />
    <circle cx="12" cy="12" r="7.3" fill="none" stroke="#7a3f1c" strokeWidth=".8" opacity=".85" />
    <path d="M8.3 14.2L7.5 9.3L10 11.4L12 8.1L14 11.4L16.5 9.3L15.7 14.2Z" fill="#f5c79a" stroke="#6e3a1c" strokeWidth=".6" strokeLinejoin="round" />
    <rect x="8.3" y="14.2" width="7.4" height="1.5" rx=".4" fill="#f5c79a" stroke="#6e3a1c" strokeWidth=".6" />
    <circle cx="12" cy="7.6" r=".7" fill="#f5c79a" stroke="#6e3a1c" strokeWidth=".4" />
    <path d="M5.8 8.8A7.8 7.8 0 0 1 10.2 4.8" stroke="#ffdcbc" strokeWidth="1.1" strokeLinecap="round" fill="none" opacity=".85" />
  </g>
);

const button = (
  <g>
    <circle cx="12" cy="12" r="9.2" fill="url(#rg-g-bone)" stroke={INK} strokeWidth={W} />
    <circle cx="12" cy="12" r="6.5" fill="#f3e9d2" stroke="#b39c72" strokeWidth="1.2" />
    {[
      [10, 10],
      [14, 10],
      [10, 14],
      [14, 14],
    ].map(([x, y]) => (
      <circle key={`${x}${y}`} cx={x} cy={y} r="1.15" fill="#4a3a26" />
    ))}
    {/* the red thread that says «sewing button», not «radio button» */}
    <path d="M10 10L14 14M14 10L10 14" stroke="#c4453a" strokeWidth=".9" strokeLinecap="round" />
    <path d="M5.6 9A7 7 0 0 1 9.4 4.6" stroke="#fffaf0" strokeWidth="1.1" strokeLinecap="round" fill="none" opacity=".9" />
  </g>
);

const wire = (
  <g fill="none">
    {[6.6, 9.8, 13, 16.2].map((cx) => (
      <ellipse key={cx} cx={cx} cy="12" rx="3.3" ry="6.6" stroke={INK} strokeWidth="2.7" />
    ))}
    {[6.6, 9.8, 13, 16.2].map((cx) => (
      <ellipse key={`c${cx}`} cx={cx} cy="12" rx="3.3" ry="6.6" stroke="url(#rg-g-copper)" strokeWidth="1.5" />
    ))}
    <path d="M19.4 12.6C21 14 21.4 16.6 22.4 19.4" stroke={INK} strokeWidth="2.6" strokeLinecap="round" />
    <path d="M19.4 12.6C21 14 21.4 16.6 22.4 19.4" stroke="#d98a5a" strokeWidth="1.4" strokeLinecap="round" />
    <path d="M5.2 7.2C5.8 6.2 6.8 5.8 7.6 6" stroke="#ffd9b8" strokeWidth=".7" strokeLinecap="round" />
  </g>
);

const gear = (
  <g>
    {Array.from({ length: 8 }, (_, i) => (
      <rect
        key={i}
        x="10.3"
        y="1.6"
        width="3.4"
        height="4.4"
        rx=".6"
        fill="url(#rg-g-brass)"
        stroke={INK}
        strokeWidth=".6"
        transform={`rotate(${i * 45} 12 12)`}
      />
    ))}
    <circle cx="12" cy="12" r="7.3" fill="url(#rg-g-brass)" stroke={INK} strokeWidth={W} />
    <circle cx="12" cy="12" r="4.9" fill="none" stroke="#7d5f2c" strokeWidth=".8" />
    <circle cx="12" cy="12" r="2.5" fill="#2a1f14" stroke={INK} strokeWidth=".6" />
    <path d="M7 9.6A5.6 5.6 0 0 1 10 6.8" stroke="#fff1c9" strokeWidth="1" strokeLinecap="round" fill="none" opacity=".9" />
  </g>
);

const cheese = (
  <g strokeLinejoin="round">
    <path d="M2.8 15.6L15.8 5.2C18.2 6.4 20.4 9.6 21.2 15.6V19.4H2.8Z" fill="#e6ae33" stroke={INK} strokeWidth={W} />
    <path d="M2.8 15.6L15.8 5.2C18.2 6.4 20.4 9.6 21.2 15.6Z" fill="url(#rg-g-cheese)" />
    {/* the rind: a crescent inside the curved edge (a stroke would spill past the outline) */}
    <path d="M15.8 5.2C18.2 6.4 20.4 9.6 21.2 15.6H19.9C19.3 10.6 17.6 7.8 15.1 5.8Z" fill="#d9951f" />
    <path d="M2.8 15.6H21.2" stroke={INK} strokeWidth=".6" opacity=".6" />
    <ellipse cx="13" cy="12.4" rx="1.4" ry=".85" fill="#d99a22" />
    <ellipse cx="17.6" cy="11.2" rx=".95" ry=".6" fill="#d99a22" />
    <ellipse cx="9.2" cy="14.2" rx=".85" ry=".5" fill="#d99a22" />
    <ellipse cx="7.6" cy="17.6" rx="1.05" ry=".8" fill="#c5841a" />
    <ellipse cx="16.4" cy="17.4" rx=".85" ry=".7" fill="#c5841a" />
    <path d="M2.8 15.6L15.8 5.2C18.2 6.4 20.4 9.6 21.2 15.6V19.4H2.8Z" fill="none" stroke={INK} strokeWidth={W} />
  </g>
);

const blueprint = (
  <g>
    <path d="M5.6 3.6H18.6V17.4H5.6Z" fill="#3f6fc0" stroke={INK} strokeWidth={W} />
    <path d="M5.6 7H18.6M5.6 10.4H18.6M5.6 13.8H18.6M9 3.6V17.4M12.4 3.6V17.4M15.8 3.6V17.4" stroke="#9fc0f5" strokeWidth=".35" opacity=".7" />
    <circle cx="10.2" cy="9.4" r="2.4" fill="none" stroke="#f2f7ff" strokeWidth=".8" />
    <path d="M10.2 9.4L14.8 6.2M12.6 11.8H16.6V14.4" stroke="#f2f7ff" strokeWidth=".8" fill="none" strokeLinecap="round" />
    <rect x="3.4" y="16.2" width="17.6" height="4.8" rx="2.4" fill="url(#rg-g-blue)" stroke={INK} strokeWidth={W} />
    <path d="M5.4 17.6H18.8" stroke="#cfe0ff" strokeWidth=".7" strokeLinecap="round" opacity=".8" />
    <ellipse cx="20.6" cy="18.6" rx="1.3" ry="2.4" fill="#8fb8ff" stroke={INK} strokeWidth=".6" />
    <path d="M20.6 17.6Q21.3 18.6 20.6 19.6" stroke="#2a4f8f" strokeWidth=".5" fill="none" />
  </g>
);

const coal = (
  <g strokeLinejoin="round">
    <path d="M2.8 15.4L5.4 9.4L10.8 7.2L14.6 10.6L13.6 16.8L7.8 19Z" fill="url(#rg-g-coal)" stroke={INK} strokeWidth={W} />
    <path d="M5.4 9.4L10.8 7.2L9.8 11.6L5.8 12.4Z" fill="#3c4250" />
    <path d="M6.6 10.2L10 8.6L9.2 10.8Z" fill="#7fa8d8" opacity=".75" />
    <path d="M11.6 17.6L13.8 11L18.6 9.4L21.4 13.6L19.8 18.8L15.2 19.8Z" fill="url(#rg-g-coal)" stroke={INK} strokeWidth={W} />
    <path d="M13.8 11L18.6 9.4L17.6 12.8L14.6 13.4Z" fill="#3c4250" />
    <path d="M15 11.6L18 10.4L16.8 12.2Z" fill="#9cc4ee" opacity=".7" />
    <path d="M17.6 12.8L21.4 13.6L19.8 18.8Z" fill="#0c0d10" opacity=".55" />
    <circle cx="8.2" cy="14.6" r=".45" fill="#bcd6f5" opacity=".8" />
    <circle cx="18.4" cy="15.8" r=".4" fill="#bcd6f5" opacity=".7" />
  </g>
);

const steam = (
  <g>
    <path
      d="M5 15.4C2.9 15.4 2.5 12 4.7 11.4C4.7 8.4 8.4 7.4 10 9C11 6 15.7 6 16.5 9.4C19.3 9 20.9 11.9 19.4 13.8C20.9 16 18.6 17.9 16.6 16.8C15 18.9 11.3 18.7 10.3 16.8C8.5 18 5.7 17.5 5 15.4Z"
      fill="url(#rg-g-steam)"
      stroke={INK}
      strokeWidth={W}
      opacity=".95"
    />
    <path d="M9 13.6C9 11.6 11.8 11.4 12 13.2C12.2 14.6 10.4 14.8 10.4 13.6" stroke="#93a6ad" strokeWidth=".9" fill="none" strokeLinecap="round" />
    <path d="M14.4 12.4C15.4 11.2 17.2 11.8 16.8 13" stroke="#93a6ad" strokeWidth=".8" fill="none" strokeLinecap="round" />
    <path d="M13.2 5.4C12.4 4 14 3.2 14.8 2" stroke="#dfe7ea" strokeWidth="1.2" fill="none" strokeLinecap="round" />
    <path d="M6.4 11.2C6.8 10 7.8 9.4 8.8 9.6" stroke="#fff" strokeWidth=".9" fill="none" strokeLinecap="round" />
  </g>
);

const ingot = (
  <g strokeLinejoin="round">
    <path d="M2.6 17.6L4.6 10.2H16.8L18.8 17.6Z" fill="url(#rg-g-brass)" stroke={INK} strokeWidth={W} />
    <path d="M4.6 10.2L7.6 6.6H19.4L16.8 10.2Z" fill="#f3dc9e" stroke={INK} strokeWidth={W} />
    <path d="M16.8 10.2L19.4 6.6L21.4 13.8L18.8 17.6Z" fill="#7d5f2c" stroke={INK} strokeWidth={W} />
    <path d="M7.8 13.4H13.6M8.4 15.2H13" stroke="#7d5f2c" strokeWidth=".8" strokeLinecap="round" />
    <path d="M9 8.4H16" stroke="#fffaf0" strokeWidth=".8" strokeLinecap="round" opacity=".9" />
  </g>
);

const rail = (
  <g>
    <rect x="2.8" y="17.8" width="18.4" height="2.8" rx=".5" fill="#8a5a32" stroke={INK} strokeWidth=".7" />
    <rect x="4.9" y="12.2" width="14.2" height="2.2" rx=".4" fill="#8a5a32" stroke={INK} strokeWidth=".6" />
    <rect x="6.8" y="7.4" width="10.4" height="1.7" rx=".3" fill="#8a5a32" stroke={INK} strokeWidth=".5" />
    <rect x="8.4" y="3.4" width="7.2" height="1.3" rx=".3" fill="#8a5a32" stroke={INK} strokeWidth=".4" />
    <path d="M6 22L10.1 2M18 22L13.9 2" stroke={INK} strokeWidth="2.6" strokeLinecap="round" />
    <path d="M6 22L10.1 2M18 22L13.9 2" stroke="url(#rg-g-silver)" strokeWidth="1.4" strokeLinecap="round" />
  </g>
);

const ring = (
  <g>
    <ellipse cx="12" cy="15.4" rx="6.6" ry="5.3" fill="none" stroke={INK} strokeWidth="3.6" />
    <ellipse cx="12" cy="15.4" rx="6.6" ry="5.3" fill="none" stroke="url(#rg-g-gold)" strokeWidth="2.2" />
    <path d="M7.2 13.2A5.6 4.4 0 0 1 10.2 10.8" stroke="#fff4c4" strokeWidth=".8" fill="none" strokeLinecap="round" />
    <rect x="10.2" y="9.4" width="3.6" height="2" rx=".5" fill="url(#rg-g-gold)" stroke={INK} strokeWidth=".6" />
    <path d="M12 2.6L15.6 6.4L12 10.6L8.4 6.4Z" fill="url(#rg-g-gem)" stroke={INK} strokeWidth=".7" strokeLinejoin="round" />
    <path d="M8.4 6.4H15.6M10.3 6.4L12 2.6L13.7 6.4L12 10.6Z" stroke="#ffe8ff" strokeWidth=".4" fill="none" opacity=".85" />
    <path d="M19.2 3.2V6M17.8 4.6H20.6" stroke="#fff4c4" strokeWidth=".7" strokeLinecap="round" />
  </g>
);

const burrow = (
  <g>
    <path d="M1.8 19.6C3.6 12.6 8 9.6 12 9.6C16 9.6 20.4 12.6 22.2 19.6Z" fill="#6b4a2e" stroke={INK} strokeWidth={W} />
    <path d="M5 14.4C6.6 12.2 9 11 11 10.8" stroke="#8a6440" strokeWidth=".9" fill="none" strokeLinecap="round" />
    <ellipse cx="12" cy="16.6" rx="5.6" ry="3.2" fill="#0d0907" stroke="#3a2614" strokeWidth=".7" />
    <circle cx="4.2" cy="18.4" r=".9" fill="#8d8478" stroke={INK} strokeWidth=".4" />
    <circle cx="19.6" cy="18.2" r=".7" fill="#8d8478" stroke={INK} strokeWidth=".4" />
    <path d="M7.4 10.6L6.6 8.4M8.2 10.2L8.4 7.8M16.4 10.4L17.4 8.2M15.6 10L15.4 7.6" stroke="#6f8f44" strokeWidth=".8" strokeLinecap="round" />
  </g>
);

const sewers = (
  <g>
    <path d="M2.6 21.4V11.4A9.4 9.4 0 0 1 21.4 11.4V21.4Z" fill="#5a4436" stroke={INK} strokeWidth={W} />
    <path d="M4.2 9.2L6.6 10.4M7.4 4.8L8.8 7.2M12 3V5.6M16.6 4.8L15.2 7.2M19.8 9.2L17.4 10.4" stroke="#2e2219" strokeWidth=".7" />
    <path d="M6.4 21.4V12.2A5.6 5.6 0 0 1 17.6 12.2V21.4Z" fill="#120e0c" stroke={INK} strokeWidth=".6" />
    <path d="M6.4 17.2Q8.3 16 10.2 17.2T14 17.2T17.6 17.2V21.4H6.4Z" fill="#2f7f7a" />
    <path d="M7.6 18.6Q9 17.8 10.4 18.6M13 19.2Q14.4 18.4 15.8 19.2" stroke="#7cc4b0" strokeWidth=".6" fill="none" strokeLinecap="round" />
  </g>
);

const cellars = (
  <g>
    <path d="M6.2 3.6Q3.8 12 6.2 20.4H17.8Q20.2 12 17.8 3.6Z" fill="#8a5a32" stroke={INK} strokeWidth={W} />
    <path d="M9.4 3.6Q8.2 12 9.4 20.4M12 3.6V20.4M14.6 3.6Q15.8 12 14.6 20.4" stroke="#6b4422" strokeWidth=".6" fill="none" />
    <path d="M5.2 7.6H18.8M5.2 16.4H18.8" stroke={INK} strokeWidth="2.2" />
    <path d="M5.2 7.6H18.8M5.2 16.4H18.8" stroke="url(#rg-g-silver)" strokeWidth="1.2" />
    <rect x="10.6" y="10.8" width="2.8" height="2.4" rx=".5" fill="url(#rg-g-brass)" stroke={INK} strokeWidth=".5" />
    <path d="M12 13.2V14.6" stroke="#7a2a24" strokeWidth="1.2" strokeLinecap="round" />
  </g>
);

const metro = (
  <g>
    <path d="M1.8 21.4V12A10.2 10.2 0 0 1 22.2 12V21.4Z" fill="#5a4038" stroke={INK} strokeWidth={W} />
    <path d="M5 21.4V12.6A7 7 0 0 1 19 12.6V21.4Z" fill="#0d0a09" />
    <rect x="7.4" y="10.6" width="9.2" height="10.8" rx="2.4" fill="#2c4a3a" stroke={INK} strokeWidth=".6" />
    <rect x="8.8" y="12.2" width="6.4" height="3.2" rx=".8" fill="#ffd27a" />
    <circle cx="9.7" cy="18.4" r="1" fill="#fff1c9" />
    <circle cx="14.3" cy="18.4" r="1" fill="#fff1c9" />
    <path d="M7.4 16.4H16.6" stroke="url(#rg-g-brass)" strokeWidth=".7" />
  </g>
);

const terminal = (
  <g strokeLinejoin="round">
    <path d="M2.8 9.2L12 3L21.2 9.2Z" fill="#c2b292" stroke={INK} strokeWidth={W} />
    <circle cx="12" cy="6.9" r="1.7" fill="#efe6d0" stroke="url(#rg-g-brass)" strokeWidth=".6" />
    <path d="M12 6.9V5.8M12 6.9H12.9" stroke="#2a1f14" strokeWidth=".4" strokeLinecap="round" />
    <rect x="3" y="9.2" width="18" height="2" fill="#a89878" stroke={INK} strokeWidth=".6" />
    {[4.6, 8.6, 13.4, 17.4].map((x) => (
      <rect key={x} x={x} y="11.2" width="2" height="7.8" fill="#ddd2b8" stroke={INK} strokeWidth=".5" />
    ))}
    <rect x="2.4" y="19" width="19.2" height="2.2" fill="#a89878" stroke={INK} strokeWidth=".6" />
  </g>
);

const fog = (
  <g fill="none" strokeLinecap="round">
    <path d="M3 7.6Q6 5.6 9 7.6T15 7.6T21 7.6" stroke="#c3c8cb" strokeWidth="2.1" />
    <path d="M2.4 12.4Q5.4 10.4 8.4 12.4T14.4 12.4T20.4 12.4" stroke="#a9afb3" strokeWidth="2.1" />
    <path d="M3.6 17.2Q6.6 15.2 9.6 17.2T15.6 17.2T21.6 17.2" stroke="#8f969b" strokeWidth="2.1" />
  </g>
);

/** Every glyph's art (a 24×24 group); the symbols, the gallery and the tests read this one table. */
export const GLYPH_ART: Record<GlyphId, ReactNode> = {
  crumbs: crumb,
  coins: penny,
  buttons: button,
  wire,
  gears: gear,
  cheese,
  blueprints: blueprint,
  coal,
  steam,
  brass: ingot,
  rails: rail,
  trinkets: ring,
  "zone-burrow": burrow,
  "zone-sewers": sewers,
  "zone-cellars": cellars,
  "zone-metro": metro,
  "zone-terminal": terminal,
  fog,
};

export const GLYPH_IDS = Object.keys(GLYPH_ART) as GlyphId[];

/** The gradients the glyphs paint with (ids rg-g-*, next to the colony's cv-* ones). */
function GlyphGradients() {
  const lin = (id: string, stops: [number, string][]) => (
    <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
      {stops.map(([o, c]) => (
        <stop key={o} offset={o} stopColor={c} />
      ))}
    </linearGradient>
  );
  const rad = (id: string, stops: [number, string][]) => (
    <radialGradient id={id} cx=".38" cy=".32" r=".75">
      {stops.map(([o, c]) => (
        <stop key={o} offset={o} stopColor={c} />
      ))}
    </radialGradient>
  );
  return (
    <>
      {lin("rg-g-brass", [
        [0, "#fff1c9"],
        [0.3, "#e8c983"],
        [0.62, "#c9a25a"],
        [1, "#7d5f2c"],
      ])}
      {lin("rg-g-copper", [
        [0, "#f6bd94"],
        [0.35, "#d98a5a"],
        [0.7, "#b8693d"],
        [1, "#6e3a1c"],
      ])}
      {lin("rg-g-silver", [
        [0, "#ffffff"],
        [0.4, "#d6dde0"],
        [0.8, "#9aa4a8"],
        [1, "#5f686c"],
      ])}
      {lin("rg-g-gold", [
        [0, "#fff4c4"],
        [0.35, "#f5d76e"],
        [0.7, "#c99a2a"],
        [1, "#8a6418"],
      ])}
      {lin("rg-g-cheese", [
        [0, "#fff0a8"],
        [0.5, "#ffd34d"],
        [1, "#e7a92c"],
      ])}
      {lin("rg-g-blue", [
        [0, "#a9c8ff"],
        [0.5, "#5a88d8"],
        [1, "#2a4f8f"],
      ])}
      {lin("rg-g-steam", [
        [0, "#ffffff"],
        [0.6, "#eef3f4"],
        [1, "#c9d4d8"],
      ])}
      {rad("rg-g-crumb", [
        [0, "#f6dfa6"],
        [0.55, "#d9a65a"],
        [1, "#9c6428"],
      ])}
      {rad("rg-g-bone", [
        [0, "#fffaf0"],
        [0.6, "#e8dbbd"],
        [1, "#b8a27a"],
      ])}
      {rad("rg-g-coal", [
        [0, "#474e5c"],
        [0.55, "#23262e"],
        [1, "#0e0f12"],
      ])}
      {rad("rg-g-gem", [
        [0, "#ffe6ff"],
        [0.5, "#e07ae0"],
        [1, "#7a2488"],
      ])}
    </>
  );
}

/**
 * The symbol sheet: mounted once at the root (GameRoot) so every <ResGlyph/> can <use> it. Not display:none (the
 * gradients would stop painting in some browsers): a 0×0 svg out of the flow.
 */
export const ResGlyphDefs = memo(function ResGlyphDefs() {
  return (
    <svg aria-hidden focusable="false" width="0" height="0" className="pointer-events-none absolute h-0 w-0 overflow-hidden" data-rg-defs="">
      <defs>
        <GlyphGradients />
        {GLYPH_IDS.map((id) => (
          <symbol key={id} id={`rg-${id}`} viewBox="0 0 24 24" overflow="visible">
            {GLYPH_ART[id]}
          </symbol>
        ))}
      </defs>
    </svg>
  );
});
