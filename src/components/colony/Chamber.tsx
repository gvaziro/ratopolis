"use client";

/**
 * A building's chamber in the colony cross-section: a carved niche with the building art,
 * a level plate, and reactions to buy / milestone / tier fx. Clicking it shows a tooltip and pokes it.
 */
import { memo, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { BUILDINGS } from "@/game/data/buildings";
import { ZONES } from "@/game/data/zones";
import { buildingVisible } from "@/game/engine/actions";
import { emitUiFx, onFx } from "@/game/fx";
import { useGame } from "@/game/store";
import type { BuildingId, ZoneId } from "@/game/types";
import { fmtInt } from "@/lib/format";
import { fxBurst } from "../fx/fxBus";
import { BuildingArt } from "./buildingArt";
import { toScreen, wasDrag } from "./camera";
import { artLevel, BUILDING_SLOT, shade } from "./geometry";
import { Glow, type GlowKind } from "./parts";
import { registerPoke } from "./registry";

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

function LevelPlate({ level }: { level: number }) {
  const t = fmtInt(level);
  const w = 12 + t.length * 6;
  const gold = level >= 10;
  return (
    <g transform="translate(66 -12)" pointerEvents="none">
      <rect x={-w / 2} y="-8" width={w} height="15" rx="3" fill="url(#cv-brass)" stroke={gold ? "#fff1b8" : INK} strokeWidth={gold ? 1.4 : 0.9} />
      <circle cx={-w / 2 + 3} cy="-0.5" r="1" fill="#5c4520" />
      <circle cx={w / 2 - 3} cy="-0.5" r="1" fill="#5c4520" />
      <text x="0" y="3.4" fontSize="9.5" textAnchor="middle" fill="#2a1a0c" className="font-mono" fontWeight="700">
        {t}
      </text>
    </g>
  );
}

export const Chamber = memo(function Chamber({ id, onTip }: { id: BuildingId; onTip: (id: BuildingId) => void }) {
  const slot = BUILDING_SLOT[id];
  const level = useGame((s) => s.game.buildings[id]);
  const visible = useGame((s) => s.game.buildings[id] > 0 || buildingVisible(s.game, id));
  const zoneOpen = useGame((s) => !!s.game.zones[slot.zone]);
  const [initialBuilt] = useState(level > 0);
  const [ring, setRing] = useState(0);
  const [flash, setFlash] = useState(0);
  const bodyRef = useRef<SVGGElement>(null);
  const lvl = artLevel(id, level);
  const art = useMemo(() => <BuildingArt id={id} lvl={lvl} />, [id, lvl]);

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
    const offFx = onFx((fx) => {
      if (fx.k !== "buy" && fx.k !== "milestone" && fx.k !== "tier") return;
      if (fx.building !== id) return;
      if (fx.k === "buy") {
        animate(rm() ? BOUNCE_SOFT : BOUNCE, 520);
        const p = toScreen(slot.cx, slot.floor - 8);
        fxBurst(p.x, p.y, "dust", 12, 1.4);
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
        emitUiFx({ k: "float", text: "Камера расширена!", x: p.x, y: p.y, color: "#e8c983", big: true });
        emitUiFx({ k: "shake", px: 2, ms: 220 });
      }
    });
    return () => {
      offPoke();
      offFx();
      window.clearTimeout(ringTimer);
      window.clearTimeout(flashTimer);
    };
  }, [id, slot]);

  if (!zoneOpen || (!visible && level <= 0)) return null;

  const pal = ZONES[slot.zone].palette;
  const built = level > 0;
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
    <g transform={`translate(${slot.cx} ${slot.floor})`}>
      <path d={NICHE} fill={shade(pal.bg, built ? -0.55 : -0.4)} stroke={shade(pal.detail, 0.15)} strokeWidth="2" strokeOpacity={built ? 0.55 : 0.4} strokeDasharray={built ? undefined : "6 5"} />
      {built && <Glow x={0} y={-36} r={96} kind={ZONE_GLOW[slot.zone]} opacity={0.3} />}
      <rect x="-86" y="-6" width="172" height="6" fill={shade(pal.bg, 0.1)} opacity=".55" />
      <g ref={bodyRef} data-chamber="" className="cv-fbb" onClick={click} style={{ cursor: "pointer" }}>
        <path d={NICHE} fill="transparent" />
        {built ? (
          <g className={initialBuilt ? undefined : "cv-pop"}>{art}</g>
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
      {built && !initialBuilt && (
        <g transform="translate(0 -86)" pointerEvents="none">
          <text className="cv-boom font-display" fontSize="26" textAnchor="middle" fill="#ffd34d" stroke="#2a1a0c" strokeWidth="1.2" fontWeight="700">
            БУМ!
          </text>
        </g>
      )}
    </g>
  );
});
