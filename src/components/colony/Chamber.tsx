"use client";

/**
 * A building's chamber in the colony cross-section: a carved niche with the building art,
 * a level plate (with progress to the next ×2), and reactions to buy / milestone / tier fx.
 * Idle chambers grey out and doze (💤); the press and the clock tower hang a «НЕТ ПАРА» tag when starved.
 * Clicking it shows a tooltip and pokes it.
 */
import { memo, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { BUILDINGS } from "@/game/data/buildings";
import { ZONES } from "@/game/data/zones";
import { buildingVisible } from "@/game/engine/actions";
import { milestoneInfo } from "@/game/engine/economy";
import { entries } from "@/game/engine/formulas";
import { emitUiFx, onFx } from "@/game/fx";
import { derivedOf, useGame } from "@/game/store";
import type { BuildingId, GameState, ZoneId } from "@/game/types";
import { fmtInt } from "@/lib/format";
import { flightPending, fxBurst, inColony, onLand } from "../fx/fxBus";
import { BuildingArt } from "./buildingArt";
import { toScreen, wasDrag } from "./camera";
import { artLevel, BUILDING_SLOT, shade } from "./geometry";
import { Glow, type GlowKind } from "./parts";
import { registerCull, registerCullItems, registerPoke } from "./registry";

export const NICHE = "M-88 0V-108Q-88 -148 -48 -148H48Q88 -148 88 -108V0Z";
const ZONE_GLOW: Record<ZoneId, GlowKind> = { burrow: "warm", sewers: "teal", cellars: "warm", metro: "red", terminal: "gold" };
const INK = "#1a120c";

const BOUNCE: Keyframe[] = [
  { transform: "translateY(0) scale(1,1)" },
  { transform: "translateY(0) scale(1.08,.9)", offset: 0.18 },
  { transform: "translateY(-12px) scale(.95,1.07)", offset: 0.45 },
  { transform: "translateY(0) scale(1.04,.96)", offset: 0.75 },
  { transform: "translateY(0) scale(1,1)" },
];
const BOUNCE_SOFT: Keyframe[] = [{ transform: "scale(1)" }, { transform: "scale(1.03)" }, { transform: "scale(1)" }];

/* ------------------------------------------------------------ mood */

/** Buildings with a production effect (their chamber dozes when that production stops). */
const PRODUCERS = new Set<BuildingId>((Object.keys(BUILDINGS) as BuildingId[]).filter((id) => BUILDINGS[id].effects.some((e) => e.t === "produce")));
const STEAM_MACHINES = new Set<BuildingId>(["steam_press", "clocktower"]);

export type ChamberMood = "ok" | "idle" | "nosteam";

/** "nosteam": the press / clock tower starve (steamEff < 0.5); "idle": a producer whose output is all ≤ 0. */
export function chamberMood(g: GameState, id: BuildingId): ChamberMood {
  if (g.buildings[id] <= 0) return "ok";
  if (STEAM_MACHINES.has(id)) return g.steamEff < 0.5 && derivedOf(g).steamNeed > 0 ? "nosteam" : "ok";
  if (!PRODUCERS.has(id)) return "ok";
  for (const [, v] of entries(derivedOf(g).buildingOut[id])) if (v > 0) return "ok";
  return "idle";
}

/* ------------------------------------------------------------ plates */

/**
 * Level plate (bottom-right of the niche). The inner group scales by --plate-k (set by ColonyView from the
 * camera zoom) from its bottom-right corner, so the digits stay ≥ 11 css px. A bar shows the way to the next ×2;
 * 1–2 levels before it the plate glows and grows a little «×2» tab.
 */
function LevelPlate({ level }: { level: number }) {
  const t = fmtInt(level);
  const w = 12 + t.length * 6;
  const gold = level >= 10;
  const ms = milestoneInfo(level);
  const hasNext = Number.isFinite(ms.next);
  const frac = hasNext ? Math.max(0, Math.min(1, (level - ms.prev) / (ms.next - ms.prev))) : 1;
  const near = hasNext && ms.next - level <= 2;
  return (
    <g transform="translate(66 -12)" pointerEvents="none">
      <g className="cv-plate">
        {near && <rect x={-w / 2 - 4} y="-12" width={w + 8} height="28" rx="5" fill="#ffd34d" className="cv-glow" />}
        <rect x={-w / 2} y="-8" width={w} height="15" rx="3" fill="url(#cv-brass)" stroke={gold ? "#fff1b8" : INK} strokeWidth={gold ? 1.4 : 0.9} />
        <circle cx={-w / 2 + 3} cy="-0.5" r="1" fill="#5c4520" />
        <circle cx={w / 2 - 3} cy="-0.5" r="1" fill="#5c4520" />
        <text x="0" y="3.4" fontSize="9.5" textAnchor="middle" fill="#2a1a0c" className="font-mono" fontWeight="700">
          {t}
        </text>
        {hasNext && (
          <g transform={`translate(${w / 2 - 30} 9)`}>
            <rect width="30" height="3.2" rx="1.6" fill={INK} opacity=".85" />
            <rect width={(30 * frac).toFixed(2)} height="3.2" rx="1.6" fill={near ? "#ffd34d" : "#e8c983"} />
          </g>
        )}
        {near && (
          <g transform={`translate(${-w / 2 - 1} -8)`}>
            <rect x="-14" y="0" width="14" height="10" rx="2" fill="#c4453a" stroke={INK} strokeWidth=".6" />
            <text x="-7" y="7.6" fontSize="7.5" textAnchor="middle" fill="#fff1e0" className="font-display" fontWeight="700">
              ×2
            </text>
          </g>
        )}
      </g>
    </g>
  );
}

/** «НЕТ ПАРА»: a red tag swinging from a hook at the top of the niche. */
function NoSteamTag() {
  return (
    <g transform="translate(0 -142)" pointerEvents="none">
      <g className="cv-tag">
        <g className="cv-pend">
          <path d="M0 0V10" stroke="#3a2a1a" strokeWidth="1.4" />
          <circle r="2" fill="#8d949a" stroke={INK} strokeWidth=".6" />
          <rect x="-31" y="10" width="62" height="17" rx="2.5" fill="#c4453a" stroke={INK} strokeWidth="1" />
          <text x="0" y="22" fontSize="9.5" textAnchor="middle" fill="#fff1e0" className="font-display" fontWeight="700" letterSpacing=".5">
            НЕТ ПАРА
          </text>
        </g>
      </g>
    </g>
  );
}

/** 💤 plate (bottom-left) for a dozing chamber. */
function IdlePlate() {
  return (
    <g transform="translate(-66 -12)" pointerEvents="none">
      <g className="cv-plate-l">
        <rect x="-11" y="-9" width="22" height="17" rx="4" fill="#1b1613" stroke="#5c4520" strokeWidth=".9" opacity=".9" />
        <text x="0" y="4" fontSize="11" textAnchor="middle">
          💤
        </text>
      </g>
    </g>
  );
}

/* ------------------------------------------------------------ the chamber */

export const Chamber = memo(function Chamber({ id, onTip }: { id: BuildingId; onTip: (id: BuildingId) => void }) {
  const slot = BUILDING_SLOT[id];
  const level = useGame((s) => s.game.buildings[id]);
  const visible = useGame((s) => s.game.buildings[id] > 0 || buildingVisible(s.game, id));
  const zoneOpen = useGame((s) => !!s.game.zones[slot.zone]);
  const mood = useGame((s) => chamberMood(s.game, id));
  const [initialBuilt] = useState(level > 0);
  // the first build's scaffolding and «БУМ!» leave the DOM once played (the hammer's loop would tap on unseen)
  const [firstPlayed, setFirstPlayed] = useState(false);
  const firstBuilt = level > 0 && !initialBuilt;
  const [ring, setRing] = useState(0);
  const [flash, setFlash] = useState(0);
  const rootRef = useRef<SVGGElement>(null);
  const bodyRef = useRef<SVGGElement>(null);
  const artRef = useRef<SVGGElement>(null);
  const lvl = artLevel(id, level);
  const art = useMemo(() => <BuildingArt id={id} lvl={lvl} />, [id, lvl]);
  const shown = zoneOpen && (visible || level > 0);

  useEffect(() => {
    let seq = 0;
    let ringTimer = 0;
    let flashTimer = 0;
    const rm = () => useGame.getState().game.settings.reducedMotion;
    const animate = (frames: Keyframe[], ms: number) => {
      bodyRef.current?.animate(frames, { duration: ms, easing: "ease-out" });
    };
    const offPoke = registerPoke(id, (k) => {
      const a = 0.07 * k * (rm() ? 0.35 : 1);
      animate(
        [
          { transform: "scale(1,1)" },
          { transform: `scale(${1 + a},${1 - a * 1.3})`, offset: 0.25 },
          { transform: `scale(${1 - a * 0.5},${1 + a * 0.6})`, offset: 0.6 },
          { transform: "scale(1,1)" },
        ],
        380,
      );
    });
    const target = `building:${id}`;
    // the bounce and its dust (none over the panel when the chamber is off-screen: EdgePings shows that buy)
    const land = () => {
      animate(rm() ? BOUNCE_SOFT : BOUNCE, 520);
      const p = toScreen(slot.cx, slot.floor - 8);
      if (inColony(p)) fxBurst(p.x, p.y, "dust", 12, 1.4);
    };
    const offLand = onLand((t) => {
      if (t === target) land();
    });
    const offFx = onFx((fx) => {
      if (fx.k !== "buy" && fx.k !== "milestone" && fx.k !== "tier") return;
      if (fx.building !== id) return;
      if (fx.k === "buy") {
        // CO-7: a card buy sends its icon flying here right after this fx — the chamber bounces when it lands;
        // a buy from the chamber tip (or with reduced motion: no flight) bounces at once
        queueMicrotask(() => {
          if (!flightPending(target)) land();
        });
        return;
      }
      seq++;
      if (fx.k === "milestone") {
        setRing(seq);
        window.clearTimeout(ringTimer);
        ringTimer = window.setTimeout(() => setRing(0), 1900);
      } else {
        setFlash(seq);
        window.clearTimeout(flashTimer);
        flashTimer = window.setTimeout(() => setFlash(0), 800);
        const p = toScreen(slot.cx, slot.floor - 120);
        if (inColony(p)) {
          emitUiFx({ k: "float", text: "Камера расширена!", x: p.x, y: p.y, color: "#e8c983", big: true });
          emitUiFx({ k: "shake", px: 2, ms: 220 });
        }
      }
    });
    return () => {
      offPoke();
      offLand();
      offFx();
      window.clearTimeout(ringTimer);
      window.clearTimeout(flashTimer);
    };
  }, [id, slot]);

  useEffect(() => {
    if (!firstBuilt) return;
    const t = window.setTimeout(() => setFirstPlayed(true), 1800);
    return () => window.clearTimeout(t);
  }, [firstBuilt]);

  // gears, pistons and steam pause while the chamber is far off-screen, and piece by piece while only its top shows
  useEffect(() => {
    const el = rootRef.current;
    if (!shown || !el) return;
    const offAll = registerCull(el, slot.floor - 170, slot.floor + 12);
    const artRoot = artRef.current?.firstElementChild;
    const offItems = lvl > 0 && artRoot instanceof SVGGElement ? registerCullItems(artRoot, slot.floor) : null;
    return () => {
      offItems?.();
      offAll();
    };
  }, [shown, slot, lvl]);

  if (!shown) return null;

  const pal = ZONES[slot.zone].palette;
  const built = level > 0;
  const dim = built && mood !== "ok";
  const click = (e: MouseEvent) => {
    if (wasDrag()) return;
    e.stopPropagation();
    const a = 0.07 * (useGame.getState().game.settings.reducedMotion ? 0.35 : 1);
    bodyRef.current?.animate(
      [{ transform: "scale(1,1)" }, { transform: `scale(${1 + a},${1 - a * 1.3})`, offset: 0.25 }, { transform: `scale(${1 - a * 0.5},${1 + a * 0.6})`, offset: 0.6 }, { transform: "scale(1,1)" }],
      { duration: 380, easing: "ease-out" },
    );
    onTip(id);
  };

  return (
    <g ref={rootRef} transform={`translate(${slot.cx} ${slot.floor})`}>
      <path d={NICHE} fill={shade(pal.bg, built ? -0.55 : -0.4)} stroke={shade(pal.detail, 0.15)} strokeWidth="2" strokeOpacity={built ? 0.55 : 0.4} strokeDasharray={built ? undefined : "6 5"} />
      {built && <Glow x={0} y={-36} r={96} kind={ZONE_GLOW[slot.zone]} opacity={dim ? 0.08 : 0.3} />}
      <rect x="-86" y="-6" width="172" height="6" fill={shade(pal.bg, 0.1)} opacity=".55" />
      <g ref={bodyRef} data-chamber="" className="cv-fbb" onClick={click} style={{ cursor: "pointer" }}>
        <path d={NICHE} fill="transparent" />
        {built ? (
          <g className={initialBuilt ? undefined : "cv-pop cv-pop-late"}>
            <g ref={artRef} className={dim ? "cv-idle" : undefined}>
              {art}
            </g>
          </g>
        ) : (
          <g opacity=".42" pointerEvents="none">
            <text x="0" y="-62" fontSize="34" textAnchor="middle">
              {BUILDINGS[id].icon}
            </text>
            <text x="0" y="-30" fontSize="10" textAnchor="middle" fill="#eadcc0" className="font-display" fontWeight="700">
              свободное место
            </text>
          </g>
        )}
      </g>
      {flash > 0 && <path key={`f${flash}`} d={NICHE} fill="#fff6dc" className="cv-flash" pointerEvents="none" />}
      {built && <LevelPlate level={level} />}
      {built && mood === "idle" && <IdlePlate />}
      {built && mood === "nosteam" && <NoSteamTag />}
      {ring > 0 && (
        <g key={`r${ring}`} pointerEvents="none">
          <circle cx="0" cy="-70" r="80" fill="none" stroke="#ffd34d" strokeWidth="6" className="cv-ring" />
          <g transform="translate(0 -152)">
            <g className="cv-badge">
              <circle r="17" fill="url(#cv-brass)" stroke="#fff1b8" strokeWidth="2" />
              <text y="5.5" fontSize="15" textAnchor="middle" fill="#2a1a0c" className="font-display" fontWeight="700">
                ×2
              </text>
            </g>
          </g>
        </g>
      )}
      {firstBuilt && !firstPlayed && (
        // CO-7: 0.7 s of scaffolding — two planks, a rope and a tapping hammer — before the art pops
        <g className="cv-scaffold" pointerEvents="none">
          <rect x="-62" y="-118" width="10" height="118" fill="#8a6438" stroke="#3a2a1a" strokeWidth="1.5" />
          <rect x="52" y="-118" width="10" height="118" fill="#8a6438" stroke="#3a2a1a" strokeWidth="1.5" />
          <rect x="-70" y="-74" width="140" height="9" fill="#a8743f" stroke="#3a2a1a" strokeWidth="1.5" />
          <path d="M-57 -118 Q0 -96 57 -118" fill="none" stroke="#d8c39a" strokeWidth="2" />
          <g transform="translate(18 -84)">
            <g className="cv-tap">
              <rect x="-2" y="-26" width="4" height="26" fill="#6b4a2a" />
              <rect x="-9" y="-32" width="18" height="8" rx="1.5" fill="#8d949a" stroke="#3a3a3a" />
            </g>
          </g>
        </g>
      )}
      {firstBuilt && !firstPlayed && (
        <g transform="translate(0 -86)" pointerEvents="none" style={{ animationDelay: ".7s" }}>
          <text className="cv-boom font-display" style={{ animationDelay: ".7s" }} fontSize="26" textAnchor="middle" fill="#ffd34d" stroke="#2a1a0c" strokeWidth="1.2" fontWeight="700">
            БУМ!
          </text>
        </g>
      )}
    </g>
  );
});
