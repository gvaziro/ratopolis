"use client";

/**
 * One horizontal band of the underground per open zone: rock, floors, and zone-specific ambient life
 * (candles, drips, mushrooms, gas jets, steam, glass arches, the golden clock…), plus giant buried human
 * things in the earth of the flanks (a horseshoe, a clay pipe, a gin bottle, a pocket watch, an umbrella, a ticket).
 */
import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import { ZONES } from "@/game/data/zones";
import { useGame } from "@/game/store";
import type { ZoneId } from "@/game/types";
import { BAND_H, bandTop, COLS, DECOR_SLOTS, ROW_FLOOR, seeded, shade, SHAFT_X, W } from "./geometry";
import { Barrel, BarrelEnd, Candle, CheeseWheel, Glow, Lantern, Sign, Steam, Suitcase } from "./parts";
import { registerCull } from "./registry";

const X0 = -2000;
const XW = W + 4000;

interface Stone {
  x: number;
  y: number;
  rx: number;
  ry: number;
  k: number;
}

/** Static rock speckle per zone (deterministic → render stays pure). */
const STONES: Record<ZoneId, Stone[]> = (() => {
  const out = {} as Record<ZoneId, Stone[]>;
  (["burrow", "sewers", "cellars", "metro", "terminal"] as ZoneId[]).forEach((z, zi) => {
    const r = seeded(1234 + zi * 77);
    const list: Stone[] = [];
    for (let i = 0; i < 46; i++) {
      list.push({ x: -260 + r() * (W + 520), y: 6 + r() * (BAND_H - 16), rx: 3 + r() * 9, ry: 2 + r() * 5, k: r() });
    }
    out[z] = list;
  });
  return out;
})();

const CRUST: string = (() => {
  const r = seeded(99);
  let d = `M${-300} ${BAND_H}V${BAND_H - 10}`;
  for (let x = -300; x <= W + 300; x += 18) d += `L${x} ${BAND_H - 8 - r() * 10}`;
  d += `V${BAND_H}z`;
  return d;
})();

/** Gaps between chamber columns (for candles, gas jets, mushrooms). */
const GAPS = [COLS[0] + 100, COLS[1] + 100, COLS[2] + 108];

function Rock({ zone }: { zone: ZoneId }) {
  const pal = ZONES[zone].palette;
  return (
    <g>
      <rect x={X0} y="0" width={XW} height={BAND_H} fill={pal.bg} />
      <rect x={X0} y="0" width={XW} height={BAND_H} fill="url(#cv-band-shade)" />
      {STONES[zone].map((s, i) => (
        <ellipse key={i} cx={s.x} cy={s.y} rx={s.rx} ry={s.ry} fill={shade(pal.bg, s.k > 0.5 ? 0.08 : -0.22)} opacity={0.7} />
      ))}
      <path d={CRUST} fill={shade(pal.bg, -0.45)} />
    </g>
  );
}

function Floors({ zone }: { zone: ZoneId }) {
  const pal = ZONES[zone].palette;
  return (
    <g>
      {ROW_FLOOR.map((y) => (
        <g key={y}>
          <rect x="-10" y={y} width={SHAFT_X + 10} height="9" fill={shade(pal.bg, -0.32)} />
          <rect x="-10" y={y} width={SHAFT_X + 10} height="1.6" fill={shade(pal.detail, 0.15)} opacity=".55" />
        </g>
      ))}
    </g>
  );
}

/* ------------------------------------------------------------ zone decor */

function Mushrooms({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <Glow x={x} y={y - 8} r={22} kind="teal" className="cv-glow" />
      {[
        [-6, 10, 5],
        [1, 14, 6.5],
        [8, 8, 4],
      ].map(([dx, h, r], i) => (
        <g key={i}>
          <rect x={x + dx - 1.2} y={y - h} width="2.4" height={h} fill="#cfe9df" />
          <path d={`M${x + dx - r} ${y - h}q${r} ${-r * 1.3} ${r * 2} 0z`} fill="#7fd1b9" stroke="#2f6b6a" strokeWidth=".6" />
          <circle cx={x + dx - r * 0.3} cy={y - h - r * 0.4} r=".9" fill="#e6fff8" />
        </g>
      ))}
    </g>
  );
}

function Drip({ x, y, fall, delay }: { x: number; y: number; fall: number; delay: number }) {
  return (
    <g>
      <path d={`M${x - 3} ${y}q3 -2 6 0q-3 4 -6 0z`} fill="#3f7f86" />
      <ellipse cx={x} cy={y + 3} rx="1.8" ry="2.6" fill="#a9e3f0" className="cv-drip" style={{ animationDelay: `${delay}s`, ["--fall" as string]: `${fall}px` }} />
      <ellipse cx={x} cy={y + fall + 3} rx="9" ry="2.4" fill="none" stroke="#a9e3f0" strokeWidth="1" className="cv-ripple" style={{ animationDelay: `${delay}s` }} />
    </g>
  );
}

function GasJet({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <Glow x={x} y={y - 10} r={30} kind="warm" className="cv-glow" />
      <path d={`M${x - 10} ${y + 6}h8v-6h4`} stroke="url(#cv-brass)" strokeWidth="3" fill="none" />
      <path className="cv-gas" d={`M${x + 2} ${y - 16}q6 9 0 15q-6 -6 0 -15z`} fill="#ffcf6a" />
      <path d={`M${x + 2} ${y - 4}q3 2 0 4q-3 -2 0 -4z`} fill="#6ab0ff" />
    </g>
  );
}

function Pigeon({ x, y, flip = false }: { x: number; y: number; flip?: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${flip ? -1 : 1} 1)`}>
      <g className="cv-bob">
        <ellipse cx="0" cy="-6" rx="8" ry="5.5" fill="#8a909a" stroke="#3b3f42" strokeWidth=".6" />
        <circle cx="7" cy="-12" r="3.6" fill="#7a808a" stroke="#3b3f42" strokeWidth=".6" />
        <path d="M10 -12l3 1 -3 1z" fill="#d9a95a" />
        <circle cx="8" cy="-13" r=".8" fill="#000" />
        <path d="M-8 -6l-6 2 6 1z" fill="#6e747e" />
        <path d="M3 -8q2 3 4 2" stroke="#7cc4b0" strokeWidth="1.4" fill="none" />
      </g>
    </g>
  );
}

function decorSlots(zone: ZoneId) {
  return DECOR_SLOTS.filter((s) => s.zone === zone).map((s) => ({ ...s, y: ROW_FLOOR[s.row] }));
}

function BurrowDecor() {
  return (
    <g>
      {[60, 180, 250, 470, 560, 610].map((x, i) => (
        <path key={x} d={`M${x} 0q${i % 2 ? 6 : -6} ${18 + i * 3} ${i % 2 ? -3 : 4} ${32 + (i % 3) * 10}`} stroke="#5a3a22" strokeWidth={2.4 - (i % 3) * 0.5} fill="none" strokeLinecap="round" />
      ))}
      {[30, 300, 590].map((x) => (
        <path key={x} d={`M${x - 20} ${ROW_FLOOR[1]}q20 -9 40 0z`} fill="#5e7a4a" opacity=".85" />
      ))}
      <Candle x={GAPS[0]} y={ROW_FLOOR[0]} h={10} />
      <Candle x={GAPS[1]} y={ROW_FLOOR[1]} h={13} />
      <Candle x={GAPS[2]} y={ROW_FLOOR[0]} h={8} />
      {[90, 270, 400, 520].map((x, i) => (
        <circle key={x} cx={x} cy={ROW_FLOOR[i % 2] - 1.5} r="1.6" fill="#e6c27a" />
      ))}
    </g>
  );
}

function SewersDecor() {
  return (
    <g>
      <rect x={-300} y="0" width={W + 600} height={BAND_H - 20} fill="url(#cv-bricks)" opacity=".45" />
      {/* pneumatic post pipe along the vault */}
      <rect x={-300} y="10" width={W + 600} height="9" fill="#b8693d" stroke="#5c3320" strokeWidth="1" />
      <rect x={-300} y="12" width={W + 600} height="2" fill="#f0b48a" opacity=".5" />
      {[80, 260, 440, 620].map((x) => (
        <rect key={x} x={x} y="7" width="8" height="15" rx="1.5" fill="url(#cv-brass)" stroke="#5c3320" strokeWidth=".7" />
      ))}
      {/* the underground river */}
      <rect x={-300} y={BAND_H - 18} width={W + 600} height="18" fill="#245453" />
      <g className="cv-wave">
        <path d={`M-300 ${BAND_H - 16}${"q12 -4 24 0t24 0".repeat(Math.ceil((W + 650) / 48))}`} stroke="#7fd1b9" strokeWidth="1.6" fill="none" opacity=".7" />
        <path d={`M-290 ${BAND_H - 8}${"q12 -3 24 0t24 0".repeat(Math.ceil((W + 650) / 48))}`} stroke="#3f7f86" strokeWidth="1.2" fill="none" opacity=".8" />
      </g>
      <Drip x={GAPS[0]} y={24} fall={ROW_FLOOR[0] - 26} delay={0} />
      <Drip x={GAPS[1] + 4} y={24} fall={ROW_FLOOR[0] - 26} delay={1.1} />
      <Drip x={GAPS[0] - 4} y={ROW_FLOOR[0] + 12} fall={ROW_FLOOR[1] - ROW_FLOOR[0] - 14} delay={0.6} />
      <Drip x={GAPS[2]} y={ROW_FLOOR[0] + 12} fall={ROW_FLOOR[1] - ROW_FLOOR[0] - 14} delay={1.8} />
      <Mushrooms x={GAPS[0]} y={ROW_FLOOR[1]} />
      <Mushrooms x={GAPS[1]} y={ROW_FLOOR[0]} />
      <Mushrooms x={GAPS[2] + 6} y={ROW_FLOOR[1]} />
      <Mushrooms x={8} y={ROW_FLOOR[0]} />
    </g>
  );
}

function CellarsDecor() {
  const slots = decorSlots("cellars");
  const out: ReactNode[] = [];
  for (const s of slots) {
    if (s.row === 0) {
      // the cellar window with the moon
      out.push(
        <g key="win" transform={`translate(${s.cx} ${s.y})`}>
          <rect x="-40" y="-120" width="80" height="54" fill="#1a2440" stroke="#5c3a1a" strokeWidth="5" />
          <circle cx="16" cy="-102" r="11" fill="#f4ead2" />
          <circle cx="20" cy="-105" r="10" fill="#1a2440" />
          <path d="M-40 -93h80M-14 -120v54M14 -120v54" stroke="#2b2622" strokeWidth="3" />
          <path d="M-36 -66l-18 66h108l-18 -66z" fill="#cfe0ff" opacity=".08" />
          <Barrel x={-34} y={0} w={34} h={42} />
          <CheeseWheel x={30} y={0} w={36} h={14} />
        </g>,
      );
    } else {
      out.push(
        <g key="pile" transform={`translate(${s.cx} ${s.y})`}>
          <BarrelEnd x={-42} y={0} r={24} />
          <BarrelEnd x={4} y={0} r={24} />
          <BarrelEnd x={-19} y={-44} r={22} />
          <CheeseWheel x={52} y={0} w={34} h={14} />
          <CheeseWheel x={52} y={-14} w={30} h={12} />
        </g>,
      );
    }
  }
  return (
    <g>
      {[-300, W + 240].map((x) => (
        <rect key={x} x={x} y="0" width="60" height={BAND_H} fill="#3a2414" opacity=".5" />
      ))}
      <rect x={-300} y="0" width={W + 600} height="14" fill="#3a2414" stroke="#1d1209" strokeWidth="1" />
      {[0, 120, 240, 360, 480, 600].map((x) => (
        <rect key={x} x={x - 4} y="0" width="8" height="26" fill="#4a2f1b" stroke="#1d1209" strokeWidth=".8" />
      ))}
      {out}
      <GasJet x={GAPS[0]} y={110} />
      <GasJet x={GAPS[1]} y={290} />
      <GasJet x={GAPS[2]} y={110} />
    </g>
  );
}

function MetroDecor() {
  return (
    <g>
      <rect x={-300} y="0" width={W + 600} height={ROW_FLOOR[1]} fill="url(#cv-tiles)" opacity=".85" />
      <rect x={-300} y="0" width={W + 600} height={ROW_FLOOR[1]} fill="url(#cv-soot)" />
      <rect x={-300} y={ROW_FLOOR[0] - 70} width={W + 600} height="10" fill="#7a2a24" opacity=".7" />
      <Sign x={W / 2 - 40} y={16} text="ПЕРРОН №1 · НЕ ПЛЕВАТЬ" size={8} color="#1f3550" ink="#eadcc0" />
      {/* furnace glow from the depths */}
      <Glow x={SHAFT_X - 50} y={ROW_FLOOR[1] - 40} r={110} kind="red" className="cv-glow" opacity={0.65} />
      <Glow x={40} y={ROW_FLOOR[0] - 30} r={80} kind="red" className="cv-glow" opacity={0.4} />
      {/* rails along the lower floor */}
      <rect x={-300} y={ROW_FLOOR[1] + 4} width={W + 600} height="6" fill="#3a2a1a" />
      <line x1={-300} y1={ROW_FLOOR[1] + 7} x2={W + 300} y2={ROW_FLOOR[1] + 7} stroke="#4a3426" strokeWidth="5" strokeDasharray="4 8" />
      <line x1={-300} y1={ROW_FLOOR[1] + 3} x2={W + 300} y2={ROW_FLOOR[1] + 3} stroke="#cfd6d6" strokeWidth="1.6" />
      <Steam x={GAPS[0]} y={ROW_FLOOR[1] - 2} n={3} color="#cfd6d6" />
      <Steam x={GAPS[2]} y={ROW_FLOOR[0] - 2} n={3} color="#cfd6d6" />
      <Steam x={GAPS[1]} y={ROW_FLOOR[1] - 2} n={2} color="#cfd6d6" />
      <Lantern x={GAPS[0]} y={ROW_FLOOR[0] + 12} kind="warm" />
    </g>
  );
}

function TerminalDecor() {
  const slots = decorSlots("terminal");
  const arches: ReactNode[] = [];
  for (let i = -2; i < 6; i++) {
    const x = i * 150;
    arches.push(
      <g key={i}>
        <path d={`M${x} 34Q${x + 75} -18 ${x + 150} 34`} fill="rgba(200,224,240,.12)" stroke="#3b3f42" strokeWidth="3" />
        <path d={`M${x + 37} 20V2M${x + 75} 8V-4M${x + 112} 20V2`} stroke="#3b3f42" strokeWidth="1.6" />
      </g>,
    );
  }
  const decor: ReactNode[] = slots.map((s, i) => {
    if (s.row === 0 && s.col === 0) {
      // the great golden clock
      return (
        <g key={i} transform={`translate(${s.cx} ${s.y - 76})`}>
          <Glow x={0} y={0} r={90} kind="gold" className="cv-glow" opacity={0.6} />
          <circle r="58" fill="#f6eedc" stroke="url(#cv-brass)" strokeWidth="9" />
          <circle r="50" fill="none" stroke="#d4af37" strokeWidth="1" />
          {Array.from({ length: 12 }, (_, k) => (
            <text key={k} x={Math.sin((k * Math.PI) / 6) * 40} y={-Math.cos((k * Math.PI) / 6) * 40 + 3.5} fontSize="9" textAnchor="middle" fill="#2a1a0c" className="font-display" fontWeight="700">
              {["XII", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI"][k]}
            </text>
          ))}
          <g className="cv-hand-h">
            <path d="M-2 4L0 -26L2 4z" fill="#2a1a0c" />
          </g>
          <g className="cv-hand-m">
            <path d="M-1.4 6L0 -40L1.4 6z" fill="#2a1a0c" />
          </g>
          <circle r="3.5" fill="#d4af37" stroke="#2a1a0c" strokeWidth=".8" />
        </g>
      );
    }
    if (s.row === 0) {
      return (
        <g key={i} transform={`translate(${s.cx} ${s.y})`}>
          <path d="M-46 -20V-96Q-46 -134 0 -134Q46 -134 46 -96V-20z" fill="#f2d7a0" opacity=".35" stroke="#3b3f42" strokeWidth="3" />
          <path d="M0 -134V-20M-46 -74h92M-46 -48h92" stroke="#3b3f42" strokeWidth="1.6" />
          <rect x="-50" y="-22" width="100" height="5" fill="#3b3f42" />
          <Pigeon x={-24} y={-22} />
          <Pigeon x={18} y={-22} flip />
        </g>
      );
    }
    return (
      <g key={i} transform={`translate(${s.cx} ${s.y})`}>
        <rect x="-60" y="-14" width="120" height="8" fill="#3b3f42" />
        <circle cx="-44" cy="-4" r="5" fill="#2b2622" stroke="#8d949a" />
        <circle cx="44" cy="-4" r="5" fill="#2b2622" stroke="#8d949a" />
        <Suitcase x={-54} y={-14} w={50} h={30} color="#5a3a2a" />
        <Suitcase x={2} y={-14} w={46} h={26} color="#3d5a6a" />
        <Suitcase x={-44} y={-44} w={40} h={22} color="#7a2a24" />
        <Pigeon x={30} y={-40} flip />
      </g>
    );
  });
  return (
    <g>
      <rect x={-300} y="0" width={W + 600} height={BAND_H} fill="url(#cv-terminal-light)" />
      {arches}
      <rect x={-300} y="30" width={W + 600} height="6" fill="#3b3f42" />
      {[GAPS[0], GAPS[1], GAPS[2]].map((x) => (
        <rect key={x} x={x - 4} y="34" width="8" height={BAND_H - 54} fill="#2f3338" stroke="#14171a" strokeWidth="1" />
      ))}
      {decor}
    </g>
  );
}

/** Each zone's background decor (LockedBand shows the next one as a silhouette, CO-8). */
export const DECOR: Record<ZoneId, () => ReactNode> = {
  burrow: BurrowDecor,
  sewers: SewersDecor,
  cellars: CellarsDecor,
  metro: MetroDecor,
  terminal: TerminalDecor,
};

/* ------------------------------------------------------------ giant buried human things (the flanks) */

/** A horseshoe the size of a chamber row, nails and all (burrow, left flank). */
function Horseshoe() {
  const d = "M-64 112V-6A64 64 0 0 1 64 -6V112";
  return (
    <g transform="translate(-150 196) rotate(-17)">
      <path d={d} fill="none" stroke="#5e5248" strokeWidth="38" />
      <path d={d} fill="none" stroke="#a09080" strokeWidth="30" />
      <path d="M-50 108V-6A50 50 0 0 1 50 -6V108" fill="none" stroke="#d8cab8" strokeWidth="3" opacity=".7" />
      {[-0.9, -0.55, -0.2, 0.2, 0.55, 0.9].map((t) => {
        const a = (t * Math.PI) / 2;
        return <rect key={t} x={Math.sin(a) * 64 - 5} y={-6 - Math.cos(a) * 64 - 3} width="10" height="6" rx="1" fill="#231d18" transform={`rotate(${(t * 90).toFixed(0)} ${(Math.sin(a) * 64).toFixed(1)} ${(-6 - Math.cos(a) * 64).toFixed(1)})`} />;
      })}
      {[-64, 64].map((x) => (
        <g key={x}>
          <rect x={x - 5} y="34" width="10" height="6" rx="1" fill="#231d18" />
          <rect x={x - 5} y="72" width="10" height="6" rx="1" fill="#231d18" />
          <rect x={x - 21} y="108" width="42" height="14" rx="3" fill="#6e6258" />
        </g>
      ))}
      <ellipse cx="-58" cy="-30" rx="12" ry="20" fill="#8a4a26" opacity=".55" />
      <ellipse cx="44" cy="60" rx="9" ry="16" fill="#8a4a26" opacity=".45" />
    </g>
  );
}

/** The bowl of a clay pipe with a snapped stem (burrow, right flank). */
function PipeBowl() {
  return (
    <g transform={`translate(${W + 118} 214) rotate(14)`}>
      <path d="M28 46L190 6" stroke="#b8a888" strokeWidth="17" strokeLinecap="round" />
      <path d="M28 46L190 6" stroke="#d9ccb0" strokeWidth="12" strokeLinecap="round" />
      <path d="M186 -2l10 6-4 4 8 4-8 6" fill="none" stroke="#8a7a5e" strokeWidth="2" />
      <path d="M-48 -64Q-54 34 -4 60Q34 70 46 34L50 -64Z" fill="#d9ccb0" stroke="#8a7a5e" strokeWidth="2.5" />
      <path d="M-34 -50Q-38 24 -4 46" fill="none" stroke="#fff6e0" strokeWidth="6" opacity=".35" />
      <path d="M8 62q4 10 14 12" fill="none" stroke="#8a7a5e" strokeWidth="5" strokeLinecap="round" />
      <ellipse cx="1" cy="-64" rx="49" ry="11" fill="#2a1c12" stroke="#8a7a5e" strokeWidth="3" />
      <ellipse cx="-6" cy="-62" rx="30" ry="5" fill="#4a3424" />
      <text x="-2" y="10" fontSize="12" textAnchor="middle" fill="#8a7a5e" className="font-display" fontWeight="700">
        J.B.
      </text>
    </g>
  );
}

/** A green gin bottle lying in the silt (sewers, right flank). */
function GreenBottle() {
  return (
    <g transform={`translate(${W + 138} 176) rotate(58)`}>
      <rect x="-42" y="-74" width="84" height="170" rx="16" fill="#2f6b3e" stroke="#163a22" strokeWidth="3" />
      <path d="M-42 -50Q-42 -96 -14 -104V-150H14V-104Q42 -96 42 -50" fill="#2f6b3e" stroke="#163a22" strokeWidth="3" />
      <rect x="-18" y="-164" width="36" height="16" rx="4" fill="#a8743f" stroke="#5c3a1a" strokeWidth="2" />
      <rect x="-30" y="-20" width="60" height="62" rx="4" fill="#e8d9a8" opacity=".85" />
      <text x="0" y="8" fontSize="13" textAnchor="middle" fill="#5c3320" className="font-display" fontWeight="700">
        ДЖИНЪ
      </text>
      <text x="0" y="26" fontSize="8" textAnchor="middle" fill="#5c3320" className="font-display">
        ЛОНДОНЪ
      </text>
      <path d="M-30 -66V80" stroke="#a8e0b0" strokeWidth="7" strokeLinecap="round" opacity=".35" />
      <ellipse cx="0" cy="92" rx="34" ry="5" fill="#163a22" opacity=".5" />
    </g>
  );
}

/** A broken pocket watch: cracked glass, stopped hands, a few chain links (cellars, left flank). */
function PocketWatch() {
  return (
    <g transform="translate(-140 196) rotate(-12)">
      {[0, 1, 2, 3].map((i) => (
        <ellipse key={i} cx={58 + i * 22} cy={-96 - i * 14} rx="12" ry="7" fill="none" stroke="#b8963e" strokeWidth="4" transform={`rotate(${-30 + i * 25} ${58 + i * 22} ${-96 - i * 14})`} />
      ))}
      <rect x="-10" y="-106" width="20" height="18" rx="4" fill="url(#cv-brass)" stroke="#5c4520" strokeWidth="1.5" />
      <circle cx="0" cy="-112" r="12" fill="none" stroke="url(#cv-brass)" strokeWidth="5" />
      <circle r="86" fill="url(#cv-brass)" stroke="#5c4520" strokeWidth="3" />
      <circle r="72" fill="#efe5cc" stroke="#7d5f2c" strokeWidth="2" />
      {Array.from({ length: 12 }, (_, k) => (
        <rect key={k} x="-2" y="-66" width="4" height={k % 3 === 0 ? 12 : 7} fill="#2a1a0c" transform={`rotate(${k * 30})`} />
      ))}
      <path d="M0 4L-4 -46L4 -46z" fill="#2a1a0c" transform="rotate(-38)" />
      <path d="M0 4L-3 -30L3 -30z" fill="#2a1a0c" transform="rotate(64)" />
      <circle r="5" fill="#2a1a0c" />
      <path d="M-56 -30L-12 -6L-30 30M-12 -6L40 -40M-12 -6L26 44L58 34" fill="none" stroke="#fff" strokeWidth="2" opacity=".7" />
      <path d="M40 -40L62 -20M26 44L8 70" fill="none" stroke="#fff" strokeWidth="1.4" opacity=".55" />
    </g>
  );
}

/** The crook of a gentleman's umbrella with torn canopy ribs (metro, right flank). */
function UmbrellaHandle() {
  return (
    <g transform={`translate(${W + 150} 236) rotate(16)`}>
      <path d="M-20 -170L-90 -60M-20 -170L50 -64M-20 -170L-30 -50" stroke="#3b3f42" strokeWidth="3" />
      <path d="M-20 -170L-90 -60Q-60 -74 -30 -50Q10 -70 50 -64Z" fill="#1d1a1f" opacity=".85" />
      <path d="M-56 -100l14 6-6 10 12 2" fill="none" stroke="#3b3f42" strokeWidth="2" />
      <path d="M-20 -170V40A42 42 0 0 1 -104 40V24" fill="none" stroke="#5c3a1a" strokeWidth="24" strokeLinecap="round" />
      <path d="M-24 -150V38A36 36 0 0 1 -96 38" fill="none" stroke="#8a5a2a" strokeWidth="5" opacity=".6" />
      <rect x="-36" y="-34" width="32" height="18" rx="3" fill="url(#cv-brass)" stroke="#5c4520" strokeWidth="1.5" />
    </g>
  );
}

/** A torn third-class ticket stub (terminal, left flank). */
function TicketStub() {
  return (
    <g transform="translate(-142 192) rotate(-13)">
      <path d="M-104 -56H96L84 -42L96 -28L84 -14L96 0L84 14L96 28L84 42L96 56H-104Z" fill="#e8d9a8" stroke="#7a5a2a" strokeWidth="2.5" />
      <rect x="-94" y="-46" width="170" height="92" fill="none" stroke="#a8743f" strokeWidth="1.4" strokeDasharray="5 3" />
      <text x="-10" y="-22" fontSize="13" textAnchor="middle" fill="#5c3320" className="font-display" fontWeight="700">
        ПОДЗЕМНАЯ ЖЕЛ. ДОР.
      </text>
      <text x="-10" y="6" fontSize="22" textAnchor="middle" fill="#7a2a24" className="font-display" fontWeight="700">
        3-й КЛАССЪ
      </text>
      <text x="-10" y="30" fontSize="11" textAnchor="middle" fill="#5c3320" className="font-mono">
        № 018870 · 1 пенни
      </text>
      {[-40, -20, 0, 20, 40].map((y) => (
        <circle key={y} cx="70" cy={y} r="2.4" fill="#7a5a2a" opacity=".6" />
      ))}
    </g>
  );
}

const RELICS: Record<ZoneId, () => ReactNode> = {
  burrow: () => (
    <>
      <Horseshoe />
      <PipeBowl />
    </>
  ),
  sewers: GreenBottle,
  cellars: PocketWatch,
  metro: UmbrellaHandle,
  terminal: TicketStub,
};

/** Background band of an open zone. */
export const ZoneBand = memo(function ZoneBand({ zone }: { zone: ZoneId }) {
  const open = useGame((s) => !!s.game.zones[zone]);
  const ref = useRef<SVGGElement>(null);
  // drips, waves, gas jets and steam pause while the band is far off-screen
  useEffect(() => {
    const el = ref.current;
    if (!open || !el) return;
    return registerCull(el, bandTop(zone), bandTop(zone) + BAND_H);
  }, [open, zone]);
  if (!open) return null;
  const Decor = DECOR[zone];
  const Relic = RELICS[zone];
  return (
    <g ref={ref} transform={`translate(0 ${bandTop(zone)})`}>
      <Rock zone={zone} />
      <Decor />
      <g opacity=".5" pointerEvents="none">
        <Relic />
      </g>
      <Floors zone={zone} />
      <ZoneLabel zone={zone} />
    </g>
  );
});

function ZoneLabel({ zone }: { zone: ZoneId }) {
  const z = ZONES[zone];
  const text = `${z.icon} ${z.name}`;
  const w = text.length * 6.4 + 16;
  return (
    <g transform={`translate(${W - 6} 18)`} opacity=".9">
      <rect x={-w} y="-9" width={w} height="18" rx="3" fill="#1b1613" stroke={z.palette.accent} strokeWidth="1" opacity=".85" />
      <text x={-w / 2} y="4" fontSize="10" textAnchor="middle" fill="#eadcc0" className="font-display" fontWeight="700">
        {text}
      </text>
    </g>
  );
}

/** Black veil that fades away when a zone opens while the player watches. */
export const ZoneReveal = memo(function ZoneReveal({ zone }: { zone: ZoneId }) {
  const open = useGame((s) => !!s.game.zones[zone]);
  const [wasOpen] = useState(open);
  if (!open || wasOpen) return null;
  return <rect x={X0} y={bandTop(zone) - 4} width={XW} height={BAND_H + 8} fill="#050403" className="cv-reveal" pointerEvents="none" />;
});
