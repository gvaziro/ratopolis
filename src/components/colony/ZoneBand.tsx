"use client";

/**
 * One horizontal band of the underground per open zone: rock, floors, and zone-specific ambient life
 * (candles, drips, mushrooms, gas jets, steam, glass arches, the golden clock…).
 */
import { memo, useState, type ReactNode } from "react";
import { ZONES } from "@/game/data/zones";
import { useGame } from "@/game/store";
import type { ZoneId } from "@/game/types";
import { BAND_H, bandTop, COLS, DECOR_SLOTS, ROW_FLOOR, seeded, shade, SHAFT_X, W } from "./geometry";
import { Barrel, BarrelEnd, Candle, CheeseWheel, Glow, Lantern, Sign, Steam, Suitcase } from "./parts";

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

const DECOR: Record<ZoneId, () => ReactNode> = {
  burrow: BurrowDecor,
  sewers: SewersDecor,
  cellars: CellarsDecor,
  metro: MetroDecor,
  terminal: TerminalDecor,
};

/** Background band of an open zone. */
export const ZoneBand = memo(function ZoneBand({ zone }: { zone: ZoneId }) {
  const open = useGame((s) => !!s.game.zones[zone]);
  if (!open) return null;
  const Decor = DECOR[zone];
  return (
    <g transform={`translate(0 ${bandTop(zone)})`}>
      <Rock zone={zone} />
      <Decor />
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
