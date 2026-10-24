"use client";

/**
 * The colony: a living vertical cross-section of the underground that grows as zones open.
 * SVG world (street + zone bands + chambers + rats + rail) under an imperative camera,
 * plus screen-space widgets (Суета, Цели, манометр, кошелёк, блестяшки).
 */
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { cx } from "@/components/ui/kit";
import { BUILDINGS } from "@/game/data/buildings";
import { RESOURCES } from "@/game/data/resources";
import { nextMilestone } from "@/game/engine/derive";
import { entries } from "@/game/engine/formulas";
import { onFx } from "@/game/fx";
import { derivedOf, useGame } from "@/game/store";
import { BUILDING_IDS, ZONE_IDS, type BuildingId } from "@/game/types";
import { fmtInt, fmtRate } from "@/lib/format";
import { addAnchorResolver, setColonyRectGetter, setFxAnchor } from "../fx/fxBus";
import { BgEvents } from "./BgEvents";
import { BustleMeter } from "./BustleMeter";
import { CameraController, camView, onCamera, toScreen } from "./camera";
import { Chamber } from "./Chamber";
import { COLONY_CSS } from "./colonyCss";
import { FlyingItems } from "./FlyingItems";
import { BAND_H, BUILDING_SLOT, GRATE, nextLocked, openZoneCount, SHAFT_W, SHAFT_X, STREET_H, W } from "./geometry";
import { GoalWidget } from "./GoalWidget";
import { LockedBand } from "./LockedBand";
import { Defs } from "./parts";
import { Rail } from "./Rail";
import { RatsLayer, SatietyBadge, spriteCount } from "./Rats";
import { SteamGauge } from "./SteamGauge";
import { Grate, PawHint, Rays, Street, Windup } from "./Street";
import { ZoneBand, ZoneReveal } from "./ZoneBand";

/* ------------------------------------------------------------ small world pieces */

const Shaft = memo(function Shaft() {
  const open = useGame((s) => openZoneCount(s.game));
  const top = STREET_H + 22;
  const bottom = STREET_H + open * BAND_H - 18;
  const x = SHAFT_X - SHAFT_W / 2;
  return (
    <g pointerEvents="none">
      <rect x={x} y={top} width={SHAFT_W} height={bottom - top} rx="18" fill="#000" opacity=".42" />
      <line x1={SHAFT_X} y1={top + 8} x2={SHAFT_X} y2={bottom - 6} stroke="#8a6438" strokeWidth="26" strokeDasharray="2.2 13" />
      <line x1={SHAFT_X - 13} y1={top} x2={SHAFT_X - 13} y2={bottom} stroke="#a8743f" strokeWidth="1.6" />
      <line x1={SHAFT_X + 13} y1={top} x2={SHAFT_X + 13} y2={bottom} stroke="#a8743f" strokeWidth="1.6" />
    </g>
  );
});

const Vignette = memo(function Vignette() {
  return (
    <g pointerEvents="none">
      <rect x={-260} y={-400} width="260" height="4000" fill="url(#cv-vig-l)" />
      <rect x={W} y={-400} width="260" height="4000" fill="url(#cv-vig-r)" />
      <rect x={-2300} y={-400} width="2040" height="4000" fill="#000" opacity=".85" />
      <rect x={W + 260} y={-400} width="2040" height="4000" fill="#000" opacity=".85" />
    </g>
  );
});

/* ------------------------------------------------------------ overlays */

function ChamberTip({ id, x, y, cw }: { id: BuildingId; x: number; y: number; cw: number }) {
  const level = useGame((s) => s.game.buildings[id]);
  const out = useGame(useShallow((s) => derivedOf(s.game).buildingOut[id]));
  const def = BUILDINGS[id];
  const lines = entries(out).filter(([, v]) => v > 0);
  const next = nextMilestone(level);
  const left = Math.max(118, Math.min(cw - 118, x));
  const below = y < 130;
  return (
    <div
      className="pointer-events-none absolute z-30 w-56 rounded-md border border-brass-dark bg-soot-2/95 px-2.5 py-2 text-xs text-parchment shadow-[0_6px_18px_rgba(0,0,0,.6)]"
      style={{ left, top: below ? Math.max(8, y + 8) : y, transform: `translate(-50%, ${below ? "0" : "-100%"})` }}
      role="tooltip"
    >
      <div className="flex items-center gap-1.5 font-display text-sm font-bold text-brass-light">
        <span>{def.icon}</span>
        <span className="min-w-0 flex-1 truncate">{def.name}</span>
        {level > 0 && <span className="font-mono text-[11px] text-parchment tabular">ур. {fmtInt(level)}</span>}
      </div>
      {level <= 0 ? (
        <p className="mt-1 text-parchment-dim">Свободное место. Стройте во вкладке «Постройки».</p>
      ) : lines.length > 0 ? (
        <div className="mt-1 flex flex-wrap gap-x-2 font-mono text-[11px] tabular">
          {lines.map(([r, v]) => (
            <span key={r} style={{ color: RESOURCES[r].color }}>
              {RESOURCES[r].icon} {fmtRate(v)}
            </span>
          ))}
        </div>
      ) : (
        <p className="mt-1 text-parchment">{def.desc}</p>
      )}
      {level > 0 && next !== null && lines.length > 0 && <p className="mt-0.5 text-[10px] text-brass">до ×2: ещё {fmtInt(next - level)} ур.</p>}
      <p className="mt-1 italic text-parchment-dim">{def.flavor}</p>
    </div>
  );
}

const MoreRats = memo(function MoreRats() {
  const extra = useGame((s) => Math.max(0, Math.floor(s.game.rats) - spriteCount(s.game.rats)));
  if (extra <= 0) return null;
  return (
    <div className="pointer-events-none absolute bottom-2 left-2 z-10 rounded border border-line/80 bg-soot-2/80 px-2 py-0.5 font-display text-sm font-bold text-parchment shadow">
      🐀 и ещё <span className="font-mono tabular text-brass-light">×{fmtInt(extra)}</span>
    </div>
  );
});

/* ------------------------------------------------------------ the view */

interface TipState {
  id: BuildingId;
  x: number;
  y: number;
}

export default function ColonyView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const camRef = useRef<CameraController | null>(null);
  const open = useGame((s) => openZoneCount(s.game));
  const hasLocked = useGame((s) => nextLocked(s.game) !== null);
  const rm = useGame((s) => s.game.settings.reducedMotion);
  const frenzy = useGame((s) => s.game.buffs.frenzyUntil > s.game.time);
  const [away, setAway] = useState(false);
  const [tip, setTip] = useState<TipState | null>(null);
  const [cw, setCw] = useState(800);

  useLayoutEffect(() => {
    const c = containerRef.current;
    const svg = svgRef.current;
    if (!c || !svg) return;
    const cam = new CameraController(c, svg);
    const g0 = useGame.getState().game;
    cam.setInputs({ open: openZoneCount(g0), hasLocked: nextLocked(g0) !== null, reducedMotion: g0.settings.reducedMotion });
    cam.onAwayChange = setAway;
    cam.onDragStart = () => setTip(null);
    camRef.current = cam;
    setColonyRectGetter(() => c.getBoundingClientRect());
    const offAnchor = onCamera((v) => {
      if (v.cw <= 1) return; // not measured yet
      setFxAnchor(v.left + v.cw / 2 + (GRATE.x - v.cx) * v.s, v.top + v.ch / 2 + (GRATE.y - v.cy) * v.s);
      setCw(Math.round(v.cw));
    });
    const offResolver = addAnchorResolver((key) => {
      if (!key.startsWith("building:")) return null;
      const slot = BUILDING_SLOT[key.slice(9) as BuildingId];
      return slot ? toScreen(slot.cx, slot.floor - 70) : null;
    });
    const offFx = onFx((fx) => {
      if (fx.k === "zoneDig") cam.focusZone(fx.zone, null);
      else if (fx.k === "zoneOpen") cam.focusZone(fx.zone, 4500);
    });
    cam.attach();
    return () => {
      offFx();
      offResolver();
      offAnchor();
      cam.detach();
      camRef.current = null;
      setColonyRectGetter(null);
    };
  }, []);

  useEffect(() => {
    camRef.current?.setInputs({ open, hasLocked, reducedMotion: rm });
  }, [open, hasLocked, rm]);

  // tooltips fade on their own
  useEffect(() => {
    if (!tip) return;
    const t = window.setTimeout(() => setTip(null), 4500);
    return () => window.clearTimeout(t);
  }, [tip]);

  const onTip = useCallback((id: BuildingId) => {
    const v = camView();
    const slot = BUILDING_SLOT[id];
    const x = v.cw / 2 + (slot.cx - v.cx) * v.s;
    const y = v.ch / 2 + (slot.floor - 150 - v.cy) * v.s;
    setTip((t) => (t && t.id === id ? null : { id, x, y }));
  }, []);

  return (
    <div
      ref={containerRef}
      className={cx("absolute inset-0 isolate z-0 touch-none select-none overflow-hidden bg-soot [-webkit-tap-highlight-color:transparent]", rm && "cv-rm")}
      onPointerDown={(e) => {
        if (tip && !(e.target instanceof Element && e.target.closest("[data-chamber]"))) setTip(null);
      }}
    >
      <style>{COLONY_CSS}</style>
      <svg ref={svgRef} className="absolute inset-0 h-full w-full" preserveAspectRatio="xMinYMin meet" role="img" aria-label="Колония в разрезе: решётка, норы, камеры и крысы">
        <defs>
          <Defs />
        </defs>
        <Street />
        {ZONE_IDS.map((z) => (
          <ZoneBand key={z} zone={z} />
        ))}
        <LockedBand />
        <Shaft />
        {BUILDING_IDS.map((id) => (
          <Chamber key={id} id={id} onTip={onTip} />
        ))}
        <Rail />
        <RatsLayer />
        <SatietyBadge />
        <FlyingItems />
        {ZONE_IDS.map((z) => (
          <ZoneReveal key={z} zone={z} />
        ))}
        <Rays />
        <Windup />
        <Grate />
        <PawHint />
        <Vignette />
      </svg>

      {frenzy && <div className="cv-frenzy pointer-events-none absolute inset-0 z-20 shadow-[inset_0_0_24px_6px_rgba(255,120,60,.6)]" />}
      <BgEvents />
      <BustleMeter />
      <GoalWidget />
      <SteamGauge />
      <MoreRats />
      {away && (
        <button
          type="button"
          data-nodrag=""
          onClick={() => camRef.current?.home()}
          className="absolute bottom-2 right-2 z-20 flex h-11 items-center gap-1 rounded-full border border-brass-dark bg-soot-2/90 px-3 font-display text-sm font-bold text-brass-light shadow-[0_2px_8px_rgba(0,0,0,.5)] hover:bg-panel-2"
        >
          ⤒ К решётке
        </button>
      )}
      {tip && <ChamberTip id={tip.id} x={tip.x} y={tip.y} cw={cw} />}
    </div>
  );
}
