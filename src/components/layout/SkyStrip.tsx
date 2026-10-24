"use client";

/**
 * «Наверху»: the human-scale London street above the colony (88 px on desktop; on phones a slim 32-px street band
 * without the «НАВЕРХУ» plate, folded away entirely while the panel sheet is full).
 * Three parallax layers drift slowly; the scene follows the highest open zone, the time of day
 * follows the human clock, events start here as tiny mini-scenes, and the departures board
 * sits on the right. Art lives in ./sky/*; this file owns sizing, selection and the motion loop.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { EVENT_LINES } from "@/game/data/events";
import { ZONES, ZONE_ORDER } from "@/game/data/zones";
import { highestZone } from "@/game/engine/derive";
import { humanClock } from "@/game/engine/formulas";
import { useGame } from "@/game/store";
import type { SceneEventId, ScenePhase } from "@/game/types";
import { cx } from "@/components/ui/kit";
import FloatTip from "./FloatTip";
import HudStyles from "./HudStyles";
import DepartureBoard from "./sky/DepartureBoard";
import { Backdrop, Clouds, FarLayer, MidLayer, MidLights, NearGround, NearLights, NearProps, PAN, SkyDefs, StationClock } from "./sky/SkyArt";
import { AmbientCat, NearEvents, Rain, type SceneInfo } from "./sky/SkyEvents";
import { farRoofs, H, layoutFor, midHouses } from "./sky/skyGeo";
import { skyLook } from "./sky/skyTime";
import { Walkers } from "./sky/Walkers";

const PAN_PERIOD = 70; // seconds for one slow sway of the parallax camera
/** A strip slimmer than this (phones: 32 px) keeps the art at the 56-px scale and shows its street band only. */
const SLIM_PX = 48;
const SLIM_SCALE_PX = 56;

export default function SkyStrip() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerWidth >= 768 ? 88 : 32 }));

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const w = Math.round(e.contentRect.width);
      const h = Math.round(e.contentRect.height);
      if (w > 0 && h > 0) setSize((s) => (s.w === w && s.h === h ? s : { w, h }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const z = useGame((s) => highestZone(s.game));
  const minute = useGame((s) => Math.floor(humanClock(s.game).totalMin) % 1440);
  const calm = useGame((s) => s.game.settings.reducedMotion);
  const market = useGame((s) => !!s.game.market);
  const sceneKey = useGame((s) => {
    const sc = s.game.scene;
    return sc ? `${sc.id}|${sc.seq}|${sc.phase}|${sc.cars.length}|${sc.perCar}` : "";
  });
  const scene = useMemo(() => parseScene(sceneKey), [sceneKey]);
  // phones: the full sheet takes the room, so the strip folds away (the departures stay in the panel's «Расписание»)
  const folded = useGame((s) => s.sheet === "full");

  // geometry in viewBox units (88 units = strip height); a slim strip draws at the 56-px scale and crops to the street
  const slim = size.h < SLIM_PX;
  const drawH = slim ? SLIM_SCALE_PX : size.h;
  const unit = H / drawH;
  const W = Math.max(200, Math.round(size.w * unit));
  const panel = size.w >= 1280 ? 460 : size.w >= 768 ? 400 : 0;
  const C = Math.round(Math.min(Math.max(((size.w - panel) / 2) * unit, 200), W - 220));

  const L = useMemo(() => layoutFor(W, C, z), [W, C, z]);
  const roofs = useMemo(() => farRoofs(W), [W]);
  const houses = useMemo(() => midHouses(L), [L]);
  const look = useMemo(() => skyLook(minute), [minute]);

  const downpour = scene?.id === "downpour";
  const drizzle = z === 2 && !downpour;
  const rainy = downpour || drizzle;
  const dayShare = look.phase === "day" ? 1 : look.phase === "night" ? 0.3 : 0.65;
  const walkers = Math.max(1, Math.round(Math.min(9, Math.max(3, W / 190)) * dayShare * (calm ? 0.5 : 1)));

  usePanLoop(wrapRef, W, drawH / H, calm, folded && size.w < 768);
  const fit = slim ? "xMidYMax slice" : "xMidYMid slice";

  const zoneId = ZONE_ORDER[Math.max(0, Math.min(4, z - 1))];
  const zone = ZONES[zoneId];
  const caption = scene ? EVENT_LINES[scene.id].human : market ? EVENT_LINES.market.human : null;
  const captionIcon = scene ? EVENT_LINES[scene.id].icon : market ? EVENT_LINES.market.icon : "";

  return (
    <div
      ref={wrapRef}
      className={cx("relative z-10 h-8 shrink-0 overflow-hidden border-b border-brass-dark/60 bg-soot md:h-[88px]", folded && "max-md:hidden", calm && "hud-calm")}
    >
      <HudStyles />
      {/* Stacked SVG layers: each pans as a whole (GPU-composited), so the parallax never repaints the art. */}
      <Layer fit={fit} W={W}>
        <SkyDefs look={look} z={z} />
        <Backdrop W={W} look={look} />
        <Clouds W={W} rainy={rainy} />
      </Layer>
      <Layer fit={fit} W={W} pan={PAN.far}>
        <FarLayer roofs={roofs} L={L} calm={calm} />
      </Layer>
      <Layer fit={fit} W={W} pan={PAN.mid}>
        <MidLayer houses={houses} L={L} />
        <StationClock L={L} minute={minute} />
        {scene?.id !== "cat" && <AmbientCat L={L} />}
      </Layer>
      <Layer fit={fit} W={W} pan={PAN.near}>
        <NearGround L={L} />
        <Walkers L={L} count={walkers} rain={rainy} topHats={z >= 4} />
        <NearProps L={L} />
        <NearEvents L={L} scene={scene} market={market} />
      </Layer>
      {/* time of day */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: look.tint, opacity: look.tintA, transition: "background-color 3s linear, opacity 3s linear" }}
      />
      <Layer fit={fit} W={W} pan={PAN.mid}>
        <MidLights houses={houses} L={L} look={look} />
      </Layer>
      <Layer fit={fit} W={W} pan={PAN.near}>
        <NearLights L={L} look={look} z={z} />
      </Layer>
      {rainy && (
        <Layer fit={fit} W={W}>
          <Rain W={W} heavy={downpour} />
        </Layer>
      )}

      {/* soften the edges into the HUD */}
      <div className="pointer-events-none absolute inset-0 bg-[#3a2814]/10 shadow-[inset_0_8px_10px_-8px_rgba(0,0,0,.75),inset_0_-8px_10px_-8px_rgba(0,0,0,.75)]" />

      <FloatTip
        className="absolute left-1.5 top-1 z-10 max-md:hidden sm:left-2.5"
        width={250}
        tip={
          <span className="block">
            <span className="block font-display text-sm font-bold text-brass-light">
              {zone.icon} {zone.name}: что видно наверху
            </span>
            <span className="mt-0.5 block">👤 «{zone.humanLine}»</span>
            <span className="block">🐀 «{zone.ratLine}»</span>
          </span>
        }
      >
        <span className="cursor-default rounded-sm border border-brass-dark/70 bg-soot/75 px-1.5 py-px font-display text-[9px] font-bold uppercase leading-tight tracking-[0.32em] text-brass-light shadow-[0_1px_3px_rgba(0,0,0,.6)] md:text-[10px]">
          Наверху
        </span>
      </FloatTip>

      {caption && (
        <span
          key={scene ? `${scene.id}${scene.seq}` : "market"}
          className="hud-slide-l pointer-events-none absolute bottom-1 left-1.5 z-10 max-w-[58%] truncate rounded-sm bg-soot/75 px-1.5 py-px text-[10px] italic leading-tight text-parchment shadow-[0_1px_3px_rgba(0,0,0,.6)] sm:left-2.5 md:text-[11px]"
        >
          <span className="not-italic">{captionIcon}</span> 👤 «{caption}»
        </span>
      )}

      <DepartureBoard />
      <span className="sr-only">Наверху: {zone.sky}</span>
    </div>
  );
}

function parseScene(key: string): SceneInfo | null {
  if (!key) return null;
  const [id, seq, phase, cars, perCar] = key.split("|");
  return { id: id as SceneEventId, seq: Number(seq), phase: phase as ScenePhase, cars: Number(cars), perCar: Number(perCar) };
}

/** One full-size SVG layer; `pan` (viewBox units) marks it for the parallax sway. `fit`: how the art meets a slim strip. */
function Layer({ W, pan, fit, children }: { W: number; pan?: number; fit: string; children: ReactNode }) {
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio={fit}
      data-pan={pan}
      className={cx("pointer-events-none absolute inset-0 h-full w-full overflow-visible", pan !== undefined && "will-change-transform")}
      aria-hidden
    >
      {children}
    </svg>
  );
}

/**
 * Sways the `data-pan` layers (CSS transforms on whole SVGs: composited, no repaint) and drifts the
 * `data-drift` clouds (attribute writes only when they moved a quarter unit). One rAF for the strip.
 */
function usePanLoop(wrapRef: RefObject<HTMLDivElement | null>, W: number, pxPerUnit: number, calm: boolean, paused: boolean) {
  const live = useRef({ W, pxPerUnit, calm, paused });
  useEffect(() => {
    live.current = { W, pxPerUnit, calm, paused };
  }, [W, pxPerUnit, calm, paused]);

  useEffect(() => {
    let raf = 0;
    let frame = 0;
    let pans: SVGSVGElement[] = [];
    let drifts: SVGGElement[] = [];
    const shown = new WeakMap<Element, string>();
    const t0 = performance.now();
    let cloudT = 0;
    let last = t0;
    const put = (el: Element, attr: "transform" | "style", v: string) => {
      if (shown.get(el) === v) return;
      shown.set(el, v);
      if (attr === "style") (el as SVGSVGElement).style.transform = v;
      else el.setAttribute("transform", v);
    };
    const loop = (now: number) => {
      const root = wrapRef.current;
      const { W: w, pxPerUnit: ppu, calm: still, paused } = live.current;
      cloudT += ((now - last) / 1000) * (still ? 0.4 : 1);
      last = now;
      // folded away (phone, full sheet) or a background tab: nothing to move
      if (root && !paused && !document.hidden) {
        // layers only change on re-render; refresh the lists twice a second
        if (frame++ % 30 === 0) {
          pans = Array.from(root.querySelectorAll<SVGSVGElement>("svg[data-pan]"));
          drifts = Array.from(root.querySelectorAll<SVGGElement>("[data-drift]"));
        }
        const k = still ? 0 : Math.sin(((now - t0) / 1000 / PAN_PERIOD) * Math.PI * 2);
        for (const el of pans) put(el, "style", `translate3d(${(k * Number(el.dataset.pan) * ppu).toFixed(1)}px,0,0)`);
        const span = w + 240;
        for (const el of drifts) {
          const x = ((((Number(el.dataset.base) - cloudT * Number(el.dataset.drift)) % span) + span) % span) - 120;
          put(el, "transform", `translate(${(Math.round(x * 4) / 4).toFixed(2)} 0)`);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [wrapRef]);
}
