"use client";

/**
 * The street strip above the burrow and the sewer grate — the main click target.
 * The grate keeps a minimum on-screen size (counter-scaled against the camera zoom).
 * COL-1: litter lies on the bars and drops through on every press, the Elder waits in the grate's light and carries
 * the first crumbs to a pile by the ladder, a dashed gaslight ring shows keyboard focus, the rays crossfade.
 */
import { cancelDecoFrame, decoFrame } from "@/lib/eco";
import { memo, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { humanClock } from "@/game/engine/formulas";
import { useGame } from "@/game/store";
import { fxBurst, getFxAnchor } from "../fx/fxBus";
import { camView, onCamera, toScreen } from "./camera";
import { floorY, GRATE, seeded, SHAFT_X, STREET_H, W } from "./geometry";
import { CrumbPile, Glow } from "./parts";
import { RatBody } from "./ratArt";
import { colonyPaused } from "./registry";

const GX = GRATE.x;
const GY = GRATE.y;
const TOP = GY - 22; // far edge of the opening
const BOT = GY + 22; // near edge
const HALF_T = 74;
const HALF_B = 92;
const MIN_GRATE_PX = 104;
/** The grate's transparent tap area: top and full height (cut so it never reaches below the street). */
const HIT_TOP = TOP - 26;
const HIT_H = BOT - TOP + 56;
/** Tap area half-width (world units, before the counter-scale). */
const HIT_HALF = HALF_B + 26;
/** COL-1 / mobile-5: the tap area grows on narrow phones until it is at least this tall on screen (css px). */
const MIN_HIT_PX = 48;
const INK = "#1a120c";

/** Same counter-scale as the level plates (ColonyView --plate-k). */
function plateK(s: number): number {
  return Math.min(2.6, Math.max(1, 11 / (9.5 * s)));
}

/** Client px → world units at the current camera. */
function toWorld(x: number, y: number): { x: number; y: number } {
  const v = camView();
  return { x: v.cx + (x - v.left - v.cw / 2) / v.s, y: v.cy + (y - v.top - v.ch / 2) / v.s };
}

interface Cobble {
  x: number;
  y: number;
  w: number;
  h: number;
  c: string;
}

const COBBLES: Cobble[] = (() => {
  const r = seeded(42);
  const out: Cobble[] = [];
  const shades = ["#4a4036", "#3d352d", "#544a3e", "#433a31"];
  for (let row = 0; row < 3; row++) {
    const y = 40 + row * 20;
    let x = -320 + (row % 2) * 14;
    while (x < W + 320) {
      const w = 22 + r() * 16;
      const inGrate = x + w > GX - HALF_B - 10 && x < GX + HALF_B + 10;
      if (!inGrate) out.push({ x, y, w: w - 3, h: 17, c: shades[Math.floor(r() * shades.length)] });
      x += w;
    }
  }
  return out;
})();

/** Time of day of the human clock (CO-5): night ≤ 05:59 or ≥ 21:00, dawn/dusk 06–07:59 and 18–20:59, else day. */
export type ColonyLight = "day" | "dusk" | "night";

function lightAt(totalMin: number): ColonyLight {
  const h = (totalMin / 60) % 24;
  if (h < 6 || h >= 21) return "night";
  if (h < 8 || h >= 18) return "dusk";
  return "day";
}

/** CO-5: the colony's light follows the human clock (re-read every 10 human minutes). */
export function useColonyLight(): ColonyLight {
  return useGame((s) => lightAt(Math.floor(humanClock(s.game).totalMin / 10) * 10));
}

/** CO-5: it rains up top — the drizzle of the Sewers era, or a downpour scene. */
export function useRain(): boolean {
  return useGame((s) => s.game.scene?.id === "downpour" || (!!s.game.zones.sewers && !s.game.zones.cellars));
}

/** Static part: night air, gas-lamp glow, cobbles, earth under the street. */
export const Street = memo(function Street() {
  const light = useColonyLight();
  const night = light === "night";
  return (
    <g pointerEvents="none">
      <rect x={-2000} y={-400} width={W + 4000} height={440} fill="url(#cv-street)" />
      <Glow x={70} y={10} r={90} kind="warm" opacity={night ? 0.85 : 0.5} className="cv-glow" />
      <Glow x={620} y={6} r={70} kind="warm" opacity={night ? 0.6 : 0.35} className={night ? "cv-glow" : undefined} />
      <rect x={-2000} y={36} width={W + 4000} height={66} fill="#2a231c" />
      {COBBLES.map((c, i) => (
        <rect key={i} x={c.x} y={c.y} width={c.w} height={c.h} rx="6" fill={c.c} stroke="#1d1813" strokeWidth="1" />
      ))}
      <rect x={-2000} y={34} width={W + 4000} height="3" fill="#6b5d4c" opacity=".7" />
      <rect x={-2000} y={100} width={W + 4000} height={STREET_H - 100} fill="#22190f" />
      {/* the throat below the grate */}
      <path d={`M${GX - HALF_B} ${BOT}L${GX - HALF_B - 18} ${STREET_H + 6}H${GX + HALF_B + 18}L${GX + HALF_B} ${BOT}z`} fill="#120c07" />
    </g>
  );
});

/** The rays group, so the passing cab wheel (Traffic) can shade the grate imperatively. */
export const raysRef: { current: SVGGElement | null } = { current: null };

const RAY_FADE_MS = 3000;

/** The two ray beams in one light's colours. */
function RayBeams({ light, className }: { light: ColonyLight; className?: string }) {
  const fill = light === "day" ? "url(#cv-rays)" : `url(#cv-rays-${light})`;
  return (
    <g className={className}>
      <path d={`M${GX - HALF_B + 6} ${BOT}L${GX + HALF_B - 6} ${BOT}L${GX + 220} ${STREET_H + 362}L${GX - 200} ${STREET_H + 362}z`} fill={fill} />
      <path d={`M${GX - 30} ${BOT}L${GX + 10} ${BOT}L${GX + 60} ${STREET_H + 300}L${GX - 50} ${STREET_H + 300}z`} fill={fill} opacity=".55" />
      {/* COL-1: the light from the grate fills the burrow softly, and where the beams land the walkways glow
          (the first frame is no longer a dark cellar: mean luminance ≥ 48 at 05:00) */}
      <ellipse cx={GX + 10} cy={STREET_H + 200} rx="560" ry="300" fill="url(#cv-glow-warm)" opacity={POOL_OPACITY[light] * 0.5} />
      <ellipse cx={GX + 6} cy={POOL_Y[0]} rx="190" ry="70" fill="url(#cv-glow-warm)" opacity={POOL_OPACITY[light]} />
      <ellipse cx={GX + 12} cy={POOL_Y[1]} rx="250" ry="80" fill="url(#cv-glow-warm)" opacity={POOL_OPACITY[light] * 0.8} />
    </g>
  );
}

/** Light pools on the two burrow walkways under the grate, and how strongly each light makes them glow. */
const POOL_Y = [floorY("burrow", 0) - 6, floorY("burrow", 1) - 8] as const;
const POOL_OPACITY: Record<ColonyLight, number> = { day: 0.4, dusk: 0.42, night: 0.46 };

/**
 * Sun/lamp rays from the grate into the burrow, with drifting dust motes; drips fall through in the rain.
 * COL-1: a change of light (day / dusk / night) crossfades the old beams into the new ones over 3 s.
 */
export const Rays = memo(function Rays() {
  const light = useColonyLight();
  const rain = useRain();
  const [shown, setShown] = useState(light);
  const [from, setFrom] = useState<ColonyLight | null>(null);
  if (shown !== light) {
    setFrom(shown);
    setShown(light);
  }
  useEffect(() => {
    if (from === null) return;
    const t = window.setTimeout(() => setFrom(null), RAY_FADE_MS + 100);
    return () => window.clearTimeout(t);
  }, [from, shown]);
  const motes = [
    [300, 160, 0],
    [350, 210, 1.5],
    [280, 260, 3],
    [380, 300, 4.2],
    [320, 360, 2.2],
    [250, 330, 5.5],
    [410, 240, 0.8],
  ];
  return (
    <g pointerEvents="none">
      <g
        ref={(el) => {
          raysRef.current = el;
        }}
        style={{ transition: "opacity .35s", filter: rain ? "saturate(.2)" : undefined }}
        opacity={rain ? 0.5 : 1}
      >
        {from !== null && from !== shown && <RayBeams key={`out-${from}`} light={from} className="cv-ray-out" />}
        <RayBeams key={`in-${shown}`} light={shown} className={from !== null ? "cv-ray-in" : undefined} />
      </g>
      {rain &&
        RAIN_DRIPS.map((d, i) => (
          <g key={i}>
            <ellipse cx={d.x} cy={BOT + 4} rx="1.8" ry="2.8" fill="#a9e3f0" className="cv-drip" style={{ animationDelay: `${d.delay}s`, ["--fall" as string]: `${d.fall}px` }} />
            <ellipse cx={d.x} cy={BOT + 4 + d.fall} rx="7" ry="2" fill="none" stroke="#a9e3f0" strokeWidth="1" className="cv-ripple" style={{ animationDelay: `${d.delay}s` }} />
          </g>
        ))}
      {motes.map(([x, y, d], i) => (
        <circle key={i} cx={x} cy={y} r={1.4} fill="#fff1c8" className="cv-mote" style={{ animationDelay: `${d}s` }} />
      ))}
    </g>
  );
});

/** Rain drips from the grate bars to the burrow floor (CO-5). */
const RAIN_DRIPS = [
  { x: GX - 60, fall: 230, delay: 0 },
  { x: GX - 15, fall: 250, delay: 0.7 },
  { x: GX + 30, fall: 240, delay: 1.3 },
  { x: GX + 70, fall: 225, delay: 0.35 },
];

function ClockworkRat({ x, y, flip, delay }: { x: number; y: number; flip?: boolean; delay: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${flip ? -1 : 1} 1)`}>
      <g className="cv-tap" style={{ animationDelay: `${delay}s` }}>
        <path d="M-11 -6Q-20 -4 -24 -10" stroke="#8d949a" strokeWidth="1.6" fill="none" />
        <ellipse cx="-2" cy="-8" rx="11" ry="7" fill="url(#cv-brass)" stroke="#2a1a0c" strokeWidth=".8" />
        <path d="M-9 -8h14M-6 -13v10M0 -14v12" stroke="#7d5f2c" strokeWidth=".7" />
        <path d="M6 -14Q14 -16 18 -9Q13 -5 6 -6z" fill="url(#cv-brass)" stroke="#2a1a0c" strokeWidth=".8" />
        <circle cx="7" cy="-14" r="3" fill="#c9a25a" stroke="#2a1a0c" strokeWidth=".6" />
        <circle cx="12" cy="-11" r="1.4" fill="#c4453a" />
        <circle cx="4" cy="-1" r="2" fill="#5d554d" />
        <circle cx="-8" cy="-1" r="2" fill="#5d554d" />
        <path d="M16 -8l7 -6" stroke="#8d949a" strokeWidth="1.6" />
        <rect x="20" y="-18" width="6" height="5" fill="#5d554d" transform="rotate(-40 23 -15)" />
      </g>
      <g transform="translate(-4 -16)">
        <g className="cv-key" style={{ animationDelay: `${delay}s` }}>
          <rect x="-1" y="-8" width="2" height="8" fill="#c9a25a" />
          <path d="M-6 -12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0M0 -12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0" fill="none" stroke="#c9a25a" strokeWidth="1.8" />
        </g>
      </g>
    </g>
  );
}

/** Wind-up rats tapping the grate (windup_rat: one; clockwork_legion: a little legion). */
export const Windup = memo(function Windup() {
  const one = useGame((s) => !!s.game.upgrades.windup_rat);
  const legion = useGame((s) => !!s.game.upgrades.clockwork_legion);
  if (!one && !legion) return null;
  if (!legion) return <ClockworkRat x={GX - HALF_T - 24} y={TOP + 2} delay={0} />;
  return (
    <g>
      <ClockworkRat x={GX - HALF_T - 24} y={TOP + 2} delay={0} />
      <ClockworkRat x={GX - HALF_T - 52} y={TOP + 4} delay={0.4} />
      <ClockworkRat x={GX + HALF_T + 24} y={TOP + 2} flip delay={0.2} />
      <ClockworkRat x={GX + HALF_T + 52} y={TOP + 4} flip delay={0.6} />
      <ClockworkRat x={GX - 12} y={TOP - 6} delay={0.8} />
    </g>
  );
});

/** A brass paw print (centre = the pad). */
function PawPrint() {
  return (
    <g fill="#ffd34d" stroke={INK} strokeWidth="1.4">
      <path d="M-10 6Q-12 -4 0 -5Q12 -4 10 6Q8 12 0 10Q-8 12 -10 6z" />
      <ellipse cx="-12" cy="-11" rx="4" ry="5.2" transform="rotate(-20 -12 -11)" />
      <ellipse cx="-4" cy="-17" rx="4" ry="5.4" />
      <ellipse cx="5" cy="-17" rx="4" ry="5.4" />
      <ellipse cx="13" cy="-10" rx="4" ry="5.2" transform="rotate(20 13 -10)" />
    </g>
  );
}

/** A brass-yellow glove pointing down-left at the paw print (fingertip at 0 0). */
function Glove() {
  return (
    <g fill="#ffd34d" stroke={INK} strokeWidth="1.4" strokeLinejoin="round">
      <path d="M0 0Q-3 -2 -2 -6L6 -26Q9 -30 13 -27L9 -16Q16 -24 22 -20Q28 -23 31 -17Q36 -18 37 -12L33 2Q31 8 24 9L12 9Q6 9 4 5z" />
      <path d="M13 -10L19 -16M20 -6L27 -14M8 -3L13 -9" fill="none" strokeWidth="1" />
      <path d="M33 2l6 10h-17l2 -3" fill="#e8c983" />
    </g>
  );
}

/** Label plate «← Тащи!» size (world units, before its counter-scale). */
const LABEL_W = 92;
const LABEL_H = 30;

/**
 * Pulsing brass paw print and a pointing glove over the grate until the first 3 clicks, and «← Тащи!» on a dark plate
 * (contrast ≥ 4.5:1 on the cobbles) right of the grate — or under it when the right side has no room (narrow phones).
 */
export const PawHint = memo(function PawHint() {
  const show = useGame((s) => s.game.stats.clicks < 3 && !s.game.scene);
  const labelRef = useRef<SVGGElement>(null);

  useEffect(() => {
    if (!show) return;
    let written = "";
    return onCamera((v) => {
      if (v.cw <= 1) return;
      const k = Math.max(1, MIN_GRATE_PX / (GRATE.w * v.s));
      // right of the grate's (counter-scaled) frame, if the whole plate fits on screen; else centred under it
      const rightX = GX + (HALF_B + 14) * k;
      const fits = v.cw / 2 + (rightX + LABEL_W * k - v.cx) * v.s <= v.cw - 6;
      const tr = fits
        ? `translate(${rightX.toFixed(1)} ${(GY - (LABEL_H / 2) * k).toFixed(1)}) scale(${k.toFixed(3)})`
        : `translate(${(GX - (LABEL_W / 2) * k).toFixed(1)} ${(GY + (BOT - GY + 12) * k).toFixed(1)}) scale(${k.toFixed(3)})`;
      if (tr === written) return;
      written = tr;
      const el = labelRef.current;
      el?.setAttribute("transform", tr);
      const t = el?.querySelector("text");
      if (t) t.textContent = fits ? "← Тащи!" : "↑ Тащи!";
    });
  }, [show]);

  if (!show) return null;
  return (
    <g pointerEvents="none" aria-hidden>
      <g transform={`translate(${GX + 22} ${GY + 12}) scale(.75)`}>
        <g className="cv-pulse">
          <PawPrint />
        </g>
      </g>
      <g transform={`translate(${GX + 32} ${GY - 9}) scale(.85)`}>
        <g className="cv-glove" data-decor="">
          <Glove />
        </g>
      </g>
      <g ref={labelRef} transform={`translate(${GX + HALF_B + 14} ${GY - LABEL_H / 2})`}>
        <rect width={LABEL_W} height={LABEL_H} rx="7" fill="#1a120c" fillOpacity=".9" stroke="#7d5f2c" strokeWidth="1.2" />
        <text x={LABEL_W / 2} y={LABEL_H / 2 + 7} fontSize="20" textAnchor="middle" fill="#ffd34d" className="font-display" fontWeight="700">
          ← Тащи!
        </text>
      </g>
    </g>
  );
});

/* ------------------------------------------------------------ grate litter (COL-1) */

type LitterKind = "crumb" | "button" | "penny";

/** What lies on the bars: three crumbs, a four-hole button and a penny (centres, local grate units). */
const LITTER: { kind: LitterKind; x: number; y: number; rot: number }[] = [
  { kind: "crumb", x: GX - 48, y: GY - 10, rot: -20 },
  { kind: "button", x: GX - 16, y: GY + 10, rot: 0 },
  { kind: "crumb", x: GX + 8, y: GY - 14, rot: 35 },
  { kind: "penny", x: GX + 56, y: GY + 9, rot: 0 },
  { kind: "crumb", x: GX - 62, y: GY + 12, rot: 80 },
];
/** A dropped item comes back after this long (ms). */
const LITTER_BACK_MS = 500;
const LITTER_FALL_MS = 380;

function LitterArt({ kind, rot, lucky }: { kind: LitterKind; rot: number; lucky: boolean }) {
  if (kind === "crumb")
    return (
      <g transform={`rotate(${rot})`}>
        <path d="M-6 2L-5 -3L0 -5L5 -3L7 1L3 4L-3 4z" fill="#d9a95a" stroke="#6b4a2a" strokeWidth="1" />
        <circle cx="-1.5" cy="-1.5" r="1.3" fill="#f0d49a" />
      </g>
    );
  if (kind === "button")
    return (
      <g>
        <circle r="6.5" fill="#e8dcc0" stroke={INK} strokeWidth="1" />
        <circle r="4.6" fill="none" stroke="#a89878" strokeWidth=".8" />
        {[
          [-1.5, -1.5],
          [1.5, -1.5],
          [-1.5, 1.5],
          [1.5, 1.5],
        ].map(([x, y]) => (
          <circle key={`${x}${y}`} cx={x} cy={y} r=".9" fill="#5c4a32" />
        ))}
      </g>
    );
  return (
    <g>
      {lucky && <Glow x={0} y={0} r={20} kind="gold" className="cv-glow" />}
      <circle r="7" fill={lucky ? "#ffd34d" : "url(#cv-copper)"} stroke={lucky ? "#7d5f2c" : "#4a2412"} strokeWidth="1.1" />
      <circle r="4.8" fill="none" stroke={lucky ? "#fff1b8" : "#f0b48a"} strokeWidth=".7" opacity=".8" />
      <path d="M-.5 -2.6L.8 -3.2V2.8" stroke={lucky ? "#7d5f2c" : "#5c3320"} strokeWidth="1" fill="none" />
    </g>
  );
}

/* ------------------------------------------------------------ the Elder (COL-1) */

type ElderListener = () => void;
let elderPoke: ElderListener | null = null;

const ELDER_Y = floorY("burrow", 0);
const ELDER_HOME_X = GX + 62;
const DROP_X = GX + 8;
/** The first crumbs pile up by the ladder (left of the shaft, clear of the burrow's candle in the gap before it). */
const PILE_X = SHAFT_X - 74;
/** Pile mound sizes [w, h] by stage 1..5 (≈ 1, 3, 5, 7, 10 🍞). */
const PILE_SIZES: [number, number][] = [
  [12, 4],
  [18, 6],
  [24, 8],
  [30, 10],
  [38, 13],
];

function pileStage(crumbs: number): number {
  return crumbs >= 10 ? 5 : crumbs >= 7 ? 4 : crumbs >= 5 ? 3 : crumbs >= 3 ? 2 : crumbs >= 1 ? 1 : 0;
}

/** The Elder's look: grey fur, a pince-nez and a cane (feet at 0 0, facing right). */
const ElderArt = memo(function ElderArt() {
  return (
    <g>
      <path d="M14 0V-12Q14 -16 10 -15.5" stroke="#6b4a2a" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      <RatBody job="idle" fur="#b9b0a6" />
      <circle cx="14" cy="-12.6" r="2.6" fill="rgba(255,255,255,.15)" stroke="#c9a25a" strokeWidth=".8" />
      <path d="M10.5 -18.5q3 -1.5 6 0" stroke="#f4efe4" strokeWidth=".9" fill="none" />
    </g>
  );
});

/**
 * «Старейшина»: decorative only (the engine's rats stay 0). He stands in the grate's light from the first frame,
 * sniffs and looks up; each grate press sends him darting to the drop point, then he carries the crumb to a pile by
 * the ladder (5 sizes up to 10 🍞). He leaves when the vagrants have come and the colony has 3 rats.
 * One rAF loop runs only while he moves; the transform is written straight to the DOM.
 */
export const Elder = memo(function Elder() {
  const show = useGame((s) => !(s.game.flags.vagrants && s.game.rats >= 3));
  const ever = useGame((s) => Math.min(10, Math.floor(s.game.resEver.crumbs)));
  const [stage, setStage] = useState(() => pileStage(ever));
  const posRef = useRef<SVGGElement>(null);
  const flipRef = useRef<SVGGElement>(null);
  const sniffRef = useRef<SVGGElement>(null);
  const crumbRef = useRef<SVGGElement>(null);
  const everRef = useRef(ever);
  useEffect(() => {
    everRef.current = ever;
  }, [ever]);

  useEffect(() => {
    if (!show) return;
    type Mode = "idle" | "toDrop" | "toPile" | "home";
    let mode: Mode = "idle";
    let x = ELDER_HOME_X;
    let dir = -1;
    let pending = 0;
    let raf = 0;
    let last = 0;
    const write = (hop: number) => {
      posRef.current?.setAttribute("transform", `translate(${x.toFixed(1)} ${(ELDER_Y - hop).toFixed(1)})`);
    };
    const face = (d: number) => {
      if (d === dir) return;
      dir = d;
      flipRef.current?.setAttribute("transform", `scale(${d} 1)`);
    };
    const carry = (on: boolean) => crumbRef.current?.setAttribute("opacity", on ? "1" : "0");
    const sniff = (on: boolean) => sniffRef.current?.setAttribute("class", on ? "cv-sniff" : "");
    const frame = (now: number) => {
      raf = 0;
      if (colonyPaused()) {
        last = now;
        raf = decoFrame(frame);
        return;
      }
      // (a frame's timestamp can precede the performance.now() taken when he was poked)
      const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
      last = now;
      const target = mode === "toDrop" ? DROP_X : mode === "toPile" ? PILE_X - 16 : ELDER_HOME_X;
      const speed = mode === "toDrop" ? 170 : mode === "toPile" ? 120 : 60;
      const dx = target - x;
      const step = speed * dt;
      if (Math.abs(dx) > step) {
        face(dx > 0 ? 1 : -1);
        x += Math.sign(dx) * step;
        write(Math.abs(Math.sin(now / 55)) * 1.8);
        raf = decoFrame(frame);
        return;
      }
      x = target;
      write(0);
      if (mode === "toDrop") {
        mode = "toPile";
        carry(true);
      } else if (mode === "toPile") {
        carry(false);
        setStage(pileStage(everRef.current));
        if (pending > 0) {
          pending--;
          mode = "toDrop";
        } else mode = "home";
      } else {
        mode = "idle";
        face(-1);
        sniff(true);
        return;
      }
      raf = decoFrame(frame);
    };
    elderPoke = () => {
      if (mode === "idle" || mode === "home") {
        mode = "toDrop";
        sniff(false);
        if (useGame.getState().game.settings.reducedMotion) {
          // no darting about: the crumb simply lands on the pile
          mode = "idle";
          sniff(true);
          window.setTimeout(() => setStage(pileStage(everRef.current)), 120);
          return;
        }
        if (!raf) {
          last = performance.now();
          raf = decoFrame(frame);
        }
      } else pending = Math.min(3, pending + 1);
    };
    return () => {
      elderPoke = null;
      cancelDecoFrame(raf);
    };
  }, [show]);

  if (!show) return null;
  const pile = PILE_SIZES[Math.max(0, Math.min(5, stage)) - 1];
  return (
    <g pointerEvents="none" aria-hidden>
      {pile && <CrumbPile x={PILE_X} y={ELDER_Y} w={pile[0]} h={pile[1]} />}
      <g ref={posRef} transform={`translate(${ELDER_HOME_X} ${ELDER_Y})`}>
        <g ref={flipRef} transform="scale(-1 1)">
          <g ref={sniffRef} className="cv-sniff" data-decor="">
            <ElderArt />
          </g>
          <g ref={crumbRef} opacity="0" transform="translate(-6 -18)">
            <path d="M-5 2L-4 -3L0 -5L5 -3L6 1L2 4L-3 4z" fill="#d9a95a" stroke="#6b4a2a" strokeWidth=".9" />
          </g>
        </g>
      </g>
    </g>
  );
});

/* ------------------------------------------------------------ the grate */

/** The grate itself: big iron bars against the bright street. */
export function Grate() {
  const outerRef = useRef<SVGGElement>(null);
  const hitRef = useRef<SVGRectElement>(null);
  const squashRef = useRef<SVGGElement>(null);
  const litterRefs = useRef<(SVGGElement | null)[]>([]);
  const litterGone = useRef<boolean[]>(LITTER.map(() => false));
  const dropTimers = useRef<Set<number>>(new Set());
  const kRef = useRef(1);
  const lucky = useGame((s) => s.game.buffs.luckyPawUntil > s.game.time);
  // CO-8: «Мегаполис» (1 000 rats) gilds the grate for good
  const gilded = useGame((s) => s.game.meta.achievements.colony_1000 !== undefined);
  const light = useColonyLight();

  // keep the grate at least MIN_GRATE_PX wide on screen; its tap area stays in the street (scaled up in the 🔭
  // overview it would reach down over the burrow's top chambers and steal their taps). COL-1: on narrow phones the
  // tap area grows (up to the --plate-k counter-scale) until it is MIN_HIT_PX tall, from the street's bottom upwards.
  useEffect(() => {
    let written = "";
    return onCamera((v) => {
      const k = Math.max(1, MIN_GRATE_PX / (GRATE.w * v.s));
      kRef.current = k;
      const pk = plateK(v.s);
      // world y of the tap area's top: the counter-scaled HIT_TOP, raised until the area is tall enough (not above y −8)
      const topW = Math.max(-8, Math.min(GY - (GY - HIT_TOP) * k, STREET_H - MIN_HIT_PX / v.s));
      const half = (HIT_HALF * Math.min(1.5, Math.max(1, pk / k))).toFixed(1);
      const key = `${k.toFixed(3)}|${topW.toFixed(1)}|${half}`;
      if (key === written) return;
      written = key;
      const ks = k.toFixed(3);
      outerRef.current?.setAttribute("transform", k === 1 ? "" : `translate(${GX} ${GY}) scale(${ks}) translate(${-GX} ${-GY})`);
      const hit = hitRef.current;
      if (hit) {
        const localTop = GY + (topW - GY) / k;
        hit.setAttribute("y", localTop.toFixed(1));
        hit.setAttribute("height", (GY + (STREET_H - GY) / k - localTop).toFixed(1));
        hit.setAttribute("x", (GX - Number(half)).toFixed(1));
        hit.setAttribute("width", (2 * Number(half)).toFixed(1));
      }
    });
  }, []);

  // pending reappearances of dropped litter
  useEffect(() => {
    const timers = dropTimers.current;
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      timers.clear();
    };
  }, []);

  /** The litter item nearest to a press (world point) falls through the bars; a new one appears 500 ms later. */
  const dropLitter = (wx: number, wy: number) => {
    const k = kRef.current;
    const lx = GX + (wx - GX) / k;
    const ly = GY + (wy - GY) / k;
    let best = -1;
    let bestD = Infinity;
    LITTER.forEach((it, i) => {
      if (litterGone.current[i]) return;
      const d = Math.hypot(it.x - lx, it.y - ly);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    const el = best >= 0 ? litterRefs.current[best] : null;
    if (!el || typeof el.animate !== "function") return;
    const i = best;
    litterGone.current[i] = true;
    const rm = useGame.getState().game.settings.reducedMotion;
    el.getAnimations().forEach((a) => a.cancel());
    const spin = (i % 2 ? 1 : -1) * (120 + i * 30);
    el.animate(
      rm
        ? [{ opacity: 1 }, { opacity: 0 }]
        : [
            { transform: "translate(0px, 0px) rotate(0deg)", opacity: 1 },
            { transform: `translate(${(i % 2 ? 4 : -4).toFixed(0)}px, 70px) rotate(${spin}deg)`, opacity: 0 },
          ],
      { duration: LITTER_FALL_MS, easing: "ease-in", fill: "forwards" },
    );
    const t = window.setTimeout(() => {
      dropTimers.current.delete(t);
      litterGone.current[i] = false;
      el.getAnimations().forEach((a) => a.cancel());
      el.animate(
        rm
          ? [{ opacity: 0 }, { opacity: 1 }]
          : [
              { transform: "scale(.3)", opacity: 0 },
              { transform: "scale(1.15)", opacity: 1, offset: 0.7 },
              { transform: "scale(1)", opacity: 1 },
            ],
        { duration: 240, easing: "ease-out" },
      );
    }, LITTER_BACK_MS);
    dropTimers.current.add(t);
  };

  const squash = () => {
    const rm = useGame.getState().game.settings.reducedMotion;
    squashRef.current?.animate(
      rm
        ? [{ transform: "scale(1)" }, { transform: "scale(.985)" }, { transform: "scale(1)" }]
        : [{ transform: "scale(1)" }, { transform: "scale(.97)", offset: 0.27 }, { transform: "scale(1.012)", offset: 0.6 }, { transform: "scale(1)" }],
      { duration: 300, easing: "ease-out" },
    );
  };

  const press = (x: number, y: number, world: { x: number; y: number }) => {
    useGame.getState().click(x, y);
    squash();
    dropLitter(world.x, world.y);
    elderPoke?.();
    if (Math.random() < 0.3) {
      const p = toScreen(GX + (Math.random() - 0.5) * 140, BOT + 4);
      fxBurst(p.x, p.y, "dust", 1, 0.3);
    }
  };

  const onDown = (e: PointerEvent<SVGGElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    press(e.clientX, e.clientY, toWorld(e.clientX, e.clientY));
  };
  const onKey = (e: KeyboardEvent<SVGGElement>) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    const a = getFxAnchor() ?? toScreen(GX, GY);
    press(a.x, a.y, { x: GX, y: GY });
  };

  const bars = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const xt = GX - HALF_T + 8 + t * (2 * HALF_T - 16);
    const xb = GX - HALF_B + 10 + t * (2 * HALF_B - 20);
    bars.push(
      <g key={i}>
        <line x1={xt} y1={TOP} x2={xb} y2={BOT} stroke={lucky ? "#7d5f2c" : gilded ? "#b8902c" : "#1c1814"} strokeWidth="6.5" strokeLinecap="round" />
        <line x1={xt - 1} y1={TOP + 1} x2={xb - 1.4} y2={BOT - 1} stroke={lucky || gilded ? "#ffe9a8" : "#6b625a"} strokeWidth="1.4" strokeLinecap="round" />
      </g>,
    );
  }

  return (
    <g ref={outerRef}>
      <g
        data-nodrag=""
        role="button"
        tabIndex={0}
        aria-label="Решётка водостока — тащить добычу"
        onPointerDown={onDown}
        onKeyDown={onKey}
        style={{ cursor: "pointer" }}
      >
        <rect ref={hitRef} x={GX - HIT_HALF} y={HIT_TOP} width={2 * HIT_HALF} height={HIT_H} fill="transparent" />
        {/* mobile-4: the keyboard focus ring (colonyCss shows it on :focus-visible) */}
        <path
          className="cv-grate-ring"
          d={`M${GX - HALF_T - 17} ${TOP - 15}H${GX + HALF_T + 17}L${GX + HALF_B + 21} ${BOT + 16}H${GX - HALF_B - 21}z`}
          fill="none"
          stroke="#f2b84b"
          strokeWidth="3"
          strokeDasharray="9 6"
          strokeLinejoin="round"
          pointerEvents="none"
        />
        <g ref={squashRef} className="cv-fb" pointerEvents="none">
          {lucky && <Glow x={GX} y={GY} r={140} kind="gold" className="cv-glow" />}
          <path d={`M${GX - HALF_T} ${TOP}H${GX + HALF_T}L${GX + HALF_B} ${BOT}H${GX - HALF_B}z`} fill={light === "day" ? "url(#cv-skylight)" : `url(#cv-skylight-${light})`} />
          {light === "night" && (
            <g>
              <path d={`M${GX + 34} ${TOP + 8}a10 10 0 1 0 8 16a8 8 0 1 1 -8 -16z`} fill="#e9eef8" opacity=".85" />
              <circle cx={GX - 40} cy={TOP + 12} r="1.3" fill="#fff" />
              <circle cx={GX - 8} cy={TOP + 26} r="1" fill="#dfe8ff" />
            </g>
          )}
          <ellipse cx={GX - 34} cy={TOP + 10} rx="16" ry="5" fill="#2a2420" opacity=".35" />
          <ellipse cx={GX + 40} cy={TOP + 8} rx="12" ry="4" fill="#2a2420" opacity=".3" />
          {bars}
          <path d={`M${GX - HALF_T - 4} ${GY}H${GX + HALF_T + 4}`} stroke="#1c1814" strokeWidth="5" />
          {LITTER.map((it, i) => (
            <g key={i} transform={`translate(${it.x} ${it.y})`}>
              <g
                className="cv-litter"
                ref={(el) => {
                  litterRefs.current[i] = el;
                }}
              >
                <LitterArt kind={it.kind} rot={it.rot} lucky={lucky} />
              </g>
            </g>
          ))}
          <path
            d={`M${GX - HALF_T - 6} ${TOP - 4}H${GX + HALF_T + 6}L${GX + HALF_B + 8} ${BOT + 5}H${GX - HALF_B - 8}z`}
            fill="none"
            stroke={gilded ? "url(#cv-brass)" : "url(#cv-iron)"}
            strokeWidth="9"
            strokeLinejoin="round"
          />
          <path d={`M${GX - HALF_T - 6} ${TOP - 6}H${GX + HALF_T + 6}`} stroke="#857a6c" strokeWidth="1.4" />
          {[GX - HALF_B - 4, GX + HALF_B + 4].map((x) => (
            <circle key={x} cx={x} cy={BOT + 2} r="2.4" fill="#857a6c" stroke="#1c1814" strokeWidth=".8" />
          ))}
        </g>
      </g>
    </g>
  );
}
