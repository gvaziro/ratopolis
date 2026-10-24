"use client";

/**
 * The colony: a living vertical cross-section of the underground that grows as zones open.
 * SVG world (street + zone bands + chambers + rats + rail) under an imperative camera,
 * plus screen-space widgets (Суета, Цели, манометр, кошелёк, блестяшки, кнопки зон).
 */
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { cx } from "@/components/ui/kit";
import { BUILDINGS } from "@/game/data/buildings";
import { RESOURCES } from "@/game/data/resources";
import { ZONES } from "@/game/data/zones";
import { nextMilestone, resMult } from "@/game/engine/derive";
import { buildingCost, canAfford, entries, timeToAfford } from "@/game/engine/formulas";
import { onFx } from "@/game/fx";
import { derivedOf, useGame } from "@/game/store";
import { BUILDING_IDS, ZONE_IDS, type Amounts, type BuildingId, type ResId, type ZoneId } from "@/game/types";
import { fmt, fmtInt, fmtRate, fmtTime } from "@/lib/format";
import { sfx } from "@/audio/sfx";
import { BrassButton } from "@/components/ui/kit";
import { addAnchorResolver, setColonyRectGetter, setFxAnchor } from "../fx/fxBus";
import { BgEvents } from "./BgEvents";
import { BustleMeter } from "./BustleMeter";
import { CameraController, camView, onCamera, toScreen } from "./camera";
import { Chamber, chamberMood } from "./Chamber";
import { COLONY_CSS } from "./colonyCss";
import { FlyingItems } from "./FlyingItems";
import { BAND_H, bandTop, BUILDING_SLOT, GRATE, nextLocked, openZoneCount, shade, SHAFT_W, SHAFT_X, STREET_H, W } from "./geometry";
import { GoalWidget } from "./GoalWidget";
import { LockedBand } from "./LockedBand";
import { Defs } from "./parts";
import { Rail } from "./Rail";
import { RatsLayer, SatietyBadge, spriteCount } from "./Rats";
import { registerCull, setColonyCovered, updateCull } from "./registry";
import { SteamGauge } from "./SteamGauge";
import { Grate, PawHint, Rays, Street, Windup } from "./Street";
import { Traffic } from "./Traffic";
import { WorkBeats } from "./WorkBeats";
import { ZoneBand, ZoneReveal } from "./ZoneBand";
import { ZonePips } from "./ZonePips";

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

const VIG = 260;
const VIG_ALPHA = 0.6;
/** Largest counter-scale of the level plates (a 375 px phone at home needs ~2.35). */
const PLATE_K_MAX = 2.6;
/** World units beyond the view where CSS animations keep running. */
const CULL_MARGIN = Math.round(BAND_H / 3);

/**
 * The flanks: a ±260-unit fade into a zone-tinted 0.6 shade (not a black wall), so the earth and the giant
 * buried human things in it stay visible when the camera zooms out.
 */
const Vignette = memo(function Vignette() {
  const openKey = useGame((s) => ZONE_IDS.filter((z) => s.game.zones[z]).join(","));
  const locked = useGame((s) => nextLocked(s.game));
  const rows: { id: string; y: number; h: number; color: string }[] = [{ id: "street", y: -2400, h: 2400 + STREET_H, color: "#0b0907" }];
  for (const z of openKey.split(",").filter(Boolean) as ZoneId[]) rows.push({ id: z, y: bandTop(z), h: BAND_H, color: shade(ZONES[z].palette.bg, -0.6) });
  const bottom = locked ? bandTop(locked) : rows.length > 1 ? bandTop(rows[rows.length - 1].id as ZoneId) + BAND_H : STREET_H;
  rows.push({ id: "deep", y: bottom, h: 4000, color: "#050403" });
  return (
    <g pointerEvents="none">
      <defs>
        {rows.map((r) => (
          <g key={r.id}>
            <linearGradient id={`cv-vig-${r.id}-l`} x1="1" x2="0">
              <stop offset="0" stopColor={r.color} stopOpacity="0" />
              <stop offset="1" stopColor={r.color} stopOpacity={VIG_ALPHA} />
            </linearGradient>
            <linearGradient id={`cv-vig-${r.id}-r`} x1="0" x2="1">
              <stop offset="0" stopColor={r.color} stopOpacity="0" />
              <stop offset="1" stopColor={r.color} stopOpacity={VIG_ALPHA} />
            </linearGradient>
          </g>
        ))}
      </defs>
      {rows.map((r) => (
        <g key={r.id}>
          <rect x={-VIG} y={r.y} width={VIG} height={r.h} fill={`url(#cv-vig-${r.id}-l)`} />
          <rect x={W} y={r.y} width={VIG} height={r.h} fill={`url(#cv-vig-${r.id}-r)`} />
          <rect x={-VIG - 4000} y={r.y} width={4000} height={r.h} fill={r.color} opacity={VIG_ALPHA} />
          <rect x={W + VIG} y={r.y} width={4000} height={r.h} fill={r.color} opacity={VIG_ALPHA} />
        </g>
      ))}
    </g>
  );
});

/* ------------------------------------------------------------ overlays */

/**
 * CO-7: the chamber tip is a little build counter: output, the price of the next level, «Построить +1» (the same
 * juice as a card buy) and «Карточка →» (the Buildings tab at this card). It stays while hovered or focused.
 */
function ChamberTip({ id, x, y, cw, onHold }: { id: BuildingId; x: number; y: number; cw: number; onHold: (on: boolean) => void }) {
  const level = useGame((s) => s.game.buildings[id]);
  const costKey = useGame((s) => {
    const c = buildingCost(id, s.game.buildings[id]);
    const ok = canAfford(s.game, c);
    const eta = ok ? 0 : timeToAfford(s.game, c);
    return `${ok ? 1 : 0}|${Number.isFinite(eta) ? Math.ceil(eta) : -1}|${entries(c).map(([r, v]) => `${r}:${v}`).join(",")}`;
  });
  const [okS, etaS, listS] = costKey.split("|");
  const affordable = okS === "1";
  const eta = Number(etaS);
  const cost = listS ? listS.split(",").map((p) => p.split(":") as [ResId, string]) : [];
  const maxed = BUILDINGS[id].maxLevel !== undefined && level >= (BUILDINGS[id].maxLevel ?? 0);
  // the same multiplied output the engine adds and the building card shows (tier/global/temp/hunger)
  const out = useGame(
    useShallow((s) => {
      const d = derivedOf(s.game);
      const o: Amounts = {};
      for (const [r, v] of entries(d.buildingOut[id])) o[r] = v * resMult(s.game, d, r);
      return o;
    }),
  );
  const mood = useGame((s) => chamberMood(s.game, id));
  const def = BUILDINGS[id];
  const lines = entries(out).filter(([, v]) => v > 0);
  const next = nextMilestone(level);
  const left = Math.max(118, Math.min(cw - 118, x));
  const below = y < 170;
  return (
    <div
      data-nodrag=""
      className="pointer-events-auto absolute z-30 w-56 rounded-md border border-brass-dark bg-soot-2/95 px-2.5 py-2 text-xs text-parchment shadow-[0_6px_18px_rgba(0,0,0,.6)]"
      style={{ left, top: below ? Math.max(8, y + 8) : y, transform: `translate(-50%, ${below ? "0" : "-100%"})` }}
      role="dialog"
      aria-label={def.name}
      onPointerEnter={() => onHold(true)}
      onPointerLeave={() => onHold(false)}
      onFocus={() => onHold(true)}
      onBlur={() => onHold(false)}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-1.5 font-display text-sm font-bold text-brass-light">
        <span>{def.icon}</span>
        <span className="min-w-0 flex-1 truncate">{def.name}</span>
        {level > 0 && <span className="font-mono text-[11px] text-parchment tabular">ур. {fmtInt(level)}</span>}
      </div>
      {level <= 0 ? (
        <p className="mt-1 text-parchment-dim">
          Свободное место · {ZONES[BUILDING_SLOT[id].zone].icon} {ZONES[BUILDING_SLOT[id].zone].name}
        </p>
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
      {mood === "nosteam" && <p className="mt-1 font-bold text-danger-light">Нет пара: машина стоит. Подбросьте угля кочегарам — манометр подскажет, чего не хватает.</p>}
      {mood === "idle" && <p className="mt-1 font-bold text-parchment-dim">💤 Простаивает: сейчас ничего не производит.</p>}
      {level > 0 && next !== null && lines.length > 0 && <p className="mt-0.5 text-[10px] text-brass">до ×2: ещё {fmtInt(next - level)} ур.</p>}
      <p className="mt-1 italic text-parchment-dim">{def.flavor}</p>
      {!maxed && (
        <p className="mt-1 flex flex-wrap gap-x-2 border-t border-line/60 pt-1 font-mono text-[11px] tabular">
          <span className="font-sans text-parchment-dim">{level > 0 ? "Ур. +1:" : "Цена:"}</span>
          {cost.map(([r, v]) => (
            <span key={r} className={useGame.getState().game.res[r] + 1e-9 >= Number(v) ? "text-parchment" : "text-danger-light"}>
              {RESOURCES[r].icon} {fmt(Number(v))}
            </span>
          ))}
        </p>
      )}
      <div className="mt-1.5 flex gap-1.5">
        {!maxed && (
          <BrassButton
            size="sm"
            className="min-h-10 flex-1 text-xs"
            disabled={!affordable}
            onClick={() => {
              useGame.getState().buyBuilding(id, 1);
              sfx.click();
            }}
          >
            {affordable ? "Построить +1" : eta >= 0 ? `через ${fmtTime(eta)}` : "не копится"}
          </BrassButton>
        )}
        <BrassButton size="sm" tone="ghost" className="min-h-10 flex-1 text-xs" onClick={() => useGame.getState().focus("buildings", `b_${id}`)}>
          Карточка →
        </BrassButton>
      </div>
    </div>
  );
}

/** The Rat King's crown as the colony cursor (medal «Да здравствует Крысиный Король!»). */
const CROWN_CURSOR =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='22' height='18' viewBox='0 0 64 44'><path d='M6 40 L3 10 L18 22 L32 2 L46 22 L61 10 L58 40 Z' fill='%23d4af37' stroke='%235e4520' stroke-width='3'/><circle cx='32' cy='28' r='5' fill='%23c4453a'/></svg>\") 8 8, pointer";

interface Ping {
  id: BuildingId;
  level: number;
  side: "top" | "bottom";
  until: number;
}

/**
 * CO-7: a building bought off-screen announces itself with a chip at the colony's top or bottom edge
 * («⬇ 🔥 Котельная · ур. 31», zone-coloured), 2.2 s; repeated buys of the same building merge; a tap flies there.
 */
const EdgePings = memo(function EdgePings({ onGo }: { onGo: (z: ZoneId) => void }) {
  const [pings, setPings] = useState<Ping[]>([]);
  useEffect(() => {
    const off = onFx((fx) => {
      if (fx.k !== "buy") return;
      const slot = BUILDING_SLOT[fx.building];
      const v = camView();
      if (!slot || v.cw <= 1) return;
      const y = v.ch / 2 + (slot.floor - 70 - v.cy) * v.s;
      const x = v.cw / 2 + (slot.cx - v.cx) * v.s;
      if (y >= 0 && y <= v.ch && x >= 0 && x <= v.cw) return;
      const side: Ping["side"] = y < 0 ? "top" : "bottom";
      const until = performance.now() + 2200;
      setPings((list) => [...list.filter((p) => p.id !== fx.building), { id: fx.building, level: fx.level, side, until }].slice(-3));
    });
    const iv = window.setInterval(() => setPings((list) => (list.some((p) => p.until <= performance.now()) ? list.filter((p) => p.until > performance.now()) : list)), 400);
    return () => {
      off();
      window.clearInterval(iv);
    };
  }, []);
  if (!pings.length) return null;
  return (
    <>
      {(["top", "bottom"] as const).map((side) => {
        const list = pings.filter((p) => p.side === side);
        if (!list.length) return null;
        return (
          <div key={side} className={cx("pointer-events-none absolute left-1/2 z-30 flex -translate-x-1/2 flex-col items-center gap-1", side === "top" ? "top-2" : "bottom-12")}>
            {list.map((p) => {
              const def = BUILDINGS[p.id];
              const zone = BUILDING_SLOT[p.id].zone;
              return (
                <button
                  key={p.id}
                  type="button"
                  data-nodrag=""
                  onClick={() => onGo(zone)}
                  className="cv-ping-in pointer-events-auto flex min-h-9 items-center gap-1.5 rounded-full border-2 bg-soot-2/95 px-3 font-display text-sm font-bold text-parchment shadow-[0_4px_12px_rgba(0,0,0,.6)]"
                  style={{ borderColor: ZONES[zone].palette.accent }}
                >
                  <span aria-hidden>{side === "top" ? "⬆" : "⬇"}</span>
                  <span>{def.icon}</span>
                  <span>{def.name}</span>
                  <span className="font-mono text-xs text-brass-light">· ур. {fmtInt(p.level)}</span>
                </button>
              );
            })}
          </div>
        );
      })}
    </>
  );
});

const MoreRats = memo(function MoreRats() {
  const extra = useGame((s) => Math.max(0, Math.floor(s.game.rats) - spriteCount(s.game.rats)));
  if (extra <= 0) return null;
  return (
    <div className="pointer-events-none absolute bottom-2 left-1/2 z-10 -translate-x-1/2 rounded border border-line/80 bg-soot-2/80 px-2 py-0.5 font-display text-sm font-bold text-parchment shadow">
      🐀 и ещё <span className="font-mono tabular text-brass-light">×{fmtInt(extra)}</span>
    </div>
  );
});

/** A <g> that pauses its CSS animations while its world y-range is far outside the view. */
function Culled({ y0, y1, children }: { y0: number; y1: number; children: ReactNode }) {
  const ref = useRef<SVGGElement>(null);
  useEffect(() => {
    const el = ref.current;
    return el ? registerCull(el, y0, y1) : undefined;
  }, [y0, y1]);
  return <g ref={ref}>{children}</g>;
}

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
  // motion switched back on by hand: the OS «reduce motion» no longer pauses the decorations
  const motionByHand = useGame((s) => !s.game.settings.reducedMotion && s.game.settings.reducedMotionFromOS === false);
  const covered = useGame((s) => s.game.scene !== null);
  const crowned = useGame((s) => s.game.meta.achievements.coronation !== undefined);
  const frenzy = useGame((s) => s.game.buffs.frenzyUntil > s.game.time);
  const [away, setAway] = useState(false);
  const [overview, setOverview] = useState(false);
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
    cam.onOverviewChange = setOverview;
    cam.onDragStart = () => setTip(null);
    camRef.current = cam;
    // the colony rect is cached from the camera (ResizeObserver, resize, scroll): no layout reads per fx
    let rect: DOMRect | null = null;
    setColonyRectGetter(() => rect);
    let plateK = "";
    const offAnchor = onCamera((v) => {
      if (v.cw <= 1) return; // not measured yet
      if (!rect || rect.left !== v.left || rect.top !== v.top || rect.width !== v.cw || rect.height !== v.ch) rect = new DOMRect(v.left, v.top, v.cw, v.ch);
      setFxAnchor(v.left + v.cw / 2 + (GRATE.x - v.cx) * v.s, v.top + v.ch / 2 + (GRATE.y - v.cy) * v.s);
      setCw(Math.round(v.cw));
      // CSS animations pause outside the view ± a third of a band (paused art still draws, so nothing pops;
      // a whole band of margin kept a fully hidden band running on phones)
      const hy = v.ch / 2 / v.s;
      updateCull(v.cy - hy - CULL_MARGIN, v.cy + hy + CULL_MARGIN);
      // level plates keep ≥ 11 css px digits at any home zoom (capped, so the 🔭 overview is not all plates)
      const k = Math.min(PLATE_K_MAX, Math.max(1, 11 / (9.5 * v.s))).toFixed(2);
      if (k !== plateK) {
        plateK = k;
        svg.style.setProperty("--plate-k", k);
      }
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

  // a scene on top: rAF loops skip frames and CSS animations pause
  useEffect(() => {
    setColonyCovered(covered);
    return () => setColonyCovered(false);
  }, [covered]);

  // tooltips fade on their own: 4.5 s, or 6 s after the pointer (or focus) leaves them
  const [tipHold, setTipHold] = useState(false);
  useEffect(() => {
    if (!tip || tipHold) return;
    const t = window.setTimeout(() => setTip(null), 6000);
    return () => window.clearTimeout(t);
  }, [tip, tipHold]);

  const onTip = useCallback((id: BuildingId) => {
    const v = camView();
    const slot = BUILDING_SLOT[id];
    const x = v.cw / 2 + (slot.cx - v.cx) * v.s;
    const y = v.ch / 2 + (slot.floor - 150 - v.cy) * v.s;
    setTip((t) => (t && t.id === id ? null : { id, x, y }));
  }, []);

  const onZone = useCallback((z: ZoneId) => {
    setTip(null);
    camRef.current?.focusZone(z, null);
  }, []);
  const onOverview = useCallback(() => {
    setTip(null);
    camRef.current?.toggleOverview();
  }, []);

  return (
    <div
      ref={containerRef}
      className={cx(
        "cv-root absolute inset-0 isolate z-0 touch-none select-none overflow-hidden bg-soot [-webkit-tap-highlight-color:transparent]",
        rm && "cv-rm",
        motionByHand && "cv-motion",
        covered && "cv-covered",
      )}
      // CO-8: the medal cabinet promises a crown cursor after the coronation
      style={crowned ? { cursor: CROWN_CURSOR } : undefined}
      onPointerDown={(e) => {
        if (tip && !(e.target instanceof Element && e.target.closest("[data-chamber]"))) setTip(null);
      }}
    >
      <style>{COLONY_CSS}</style>
      <svg ref={svgRef} className="absolute inset-0 h-full w-full" preserveAspectRatio="xMinYMin meet" role="img" aria-label="Колония в разрезе: решётка, норы, камеры и крысы">
        <defs>
          <Defs />
        </defs>
        <Culled y0={-400} y1={STREET_H}>
          <Street />
        </Culled>
        <Traffic />
        {ZONE_IDS.map((z) => (
          <ZoneBand key={z} zone={z} />
        ))}
        <LockedBand />
        <Shaft />
        {BUILDING_IDS.map((id) => (
          <Chamber key={id} id={id} onTip={onTip} />
        ))}
        <WorkBeats />
        <Rail />
        <RatsLayer />
        <SatietyBadge />
        <FlyingItems />
        {ZONE_IDS.map((z) => (
          <ZoneReveal key={z} zone={z} />
        ))}
        <Culled y0={-60} y1={STREET_H + 362}>
          <Rays />
          <Windup />
        </Culled>
        <Grate />
        <PawHint />
        <Vignette />
      </svg>

      {frenzy && <div className="cv-frenzy pointer-events-none absolute inset-0 z-20 shadow-[inset_0_0_24px_6px_rgba(255,120,60,.6)]" />}
      <BgEvents />
      <BustleMeter />
      <GoalWidget />
      <SteamGauge />
      <ZonePips onZone={onZone} onOverview={onOverview} overview={overview} />
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
      {tip && <ChamberTip id={tip.id} x={tip.x} y={tip.y} cw={cw} onHold={setTipHold} />}
      <EdgePings onGo={(z) => camRef.current?.focusZone(z, 4000)} />
    </div>
  );
}
