"use client";

/**
 * Drawn thumbnails for the panel (PAN-3): the card shows the chamber it builds (the colony's niche in its zone colour
 * plus BuildingArt at the chamber's visual tier, 1/5/10/25/50) and a job row shows its rat with the hat or tool the
 * colony draws on it (RatBody). The gradients they use (url(#cv-brass) …) come from PanelArtDefs, one zero-sized svg
 * that SidePanel mounts, so they resolve even while the colony svg is out of view. Thumbnails never animate:
 * PanelStyles stops the colony's loops inside .cv-thumb. A card buy flies a clone of its thumbnail to the chamber.
 */
import { memo } from "react";
import { BUILDINGS } from "@/game/data/buildings";
import { ZONES } from "@/game/data/zones";
import { emitUiFx } from "@/game/fx";
import { useGame } from "@/game/store";
import type { BuildingId, JobId, UpgradeId, ZoneId } from "@/game/types";
import { BuildingArt } from "@/components/colony/buildingArt";
import { NICHE } from "@/components/colony/Chamber";
import { artLevel, shade } from "@/components/colony/geometry";
import { Defs, Glow, type GlowKind } from "@/components/colony/parts";
import { FURS, RatBody } from "@/components/colony/ratArt";
import { clampToColony, flightStart, fxBurst, getColonyRect, resolveAnchor, type Pt } from "@/components/fx/fxBus";
import { cx } from "@/components/ui/kit";

/** The colony's gradients and filters, once, for every thumbnail in the panel (not display:none: that breaks them). */
export function PanelArtDefs() {
  return (
    <svg aria-hidden focusable="false" width={0} height={0} style={{ position: "absolute", overflow: "hidden" }}>
      <defs>
        <Defs />
      </defs>
    </svg>
  );
}

/** A building's chamber in miniature: re-renders its art only when the visual tier changes. */
export const BuildingThumb = memo(function BuildingThumb({ id, lvl, className }: { id: BuildingId; lvl: number; className?: string }) {
  return <ChamberArt id={id} tier={artLevel(id, Math.max(1, lvl))} className={className} />;
});

/** The chamber's lamp colour by zone (as the colony lights a built chamber). */
const ZONE_GLOW: Record<ZoneId, GlowKind> = { burrow: "warm", sewers: "teal", cellars: "warm", metro: "red", terminal: "gold" };

const ChamberArt = memo(function ChamberArt({ id, tier, className }: { id: BuildingId; tier: number; className?: string }) {
  const zone = BUILDINGS[id].zone;
  const pal = ZONES[zone].palette;
  return (
    <svg viewBox="-92 -152 184 156" width={48} height={40} aria-hidden focusable="false" className={cx("cv-thumb", className)} data-tier={tier}>
      <path d={NICHE} fill={shade(pal.bg, -0.45)} stroke={shade(pal.detail, 0.15)} strokeWidth="3" strokeOpacity=".6" />
      <Glow x={0} y={-36} r={96} kind={ZONE_GLOW[zone]} opacity={0.4} />
      <rect x="-86" y="-6" width="172" height="6" fill={shade(pal.bg, 0.1)} opacity=".55" />
      <BuildingArt id={id} lvl={tier} />
    </svg>
  );
});

/** A rat of the job, facing right, with its accessory and the upgrade looks it has earned (UPGRADE_LOOKS). */
export const JobThumb = memo(function JobThumb({ job, looks, className }: { job: JobId; looks?: string; className?: string }) {
  const owned = looks ? (looks.split(",") as UpgradeId[]) : undefined;
  return (
    <svg viewBox="-36 -34 64 36" width={48} height={27} aria-hidden focusable="false" className={cx("cv-thumb", className)}>
      <ellipse cx="-4" cy="0.5" rx="24" ry="2.2" fill="#000" opacity=".35" />
      <RatBody job={job} fur={FURS[1]} looks={owned} />
      {job === "idle" && (
        <g fill="#c9b8a0" fontFamily="serif" fontWeight="bold" opacity=".85">
          <text x="17" y="-22" fontSize="8">z</text>
          <text x="23" y="-28" fontSize="6">z</text>
        </g>
      )}
    </svg>
  );
});

/**
 * The card → chamber flight (CO-7) with the card's own thumbnail instead of the emoji: the same arc, landing burst
 * and flightStart/landing handshake as FxLayer's "fly", so the chamber bounces when the picture arrives. Without a
 * thumbnail it falls back to the UiFx "fly" (emoji). Reduced motion: no flight, as in FxLayer.
 */
export function flyThumb(src: Element | null, from: Pt, target: string, icon: string): void {
  if (!src || typeof document === "undefined" || typeof (src as HTMLElement).animate !== "function") {
    emitUiFx({ k: "fly", from, target, icon });
    return;
  }
  if (useGame.getState().game.settings.reducedMotion) return;
  const r = getColonyRect();
  const centre = r ? { x: r.left + r.width / 2, y: r.top + r.height * 0.35 } : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  const to = clampToColony(resolveAnchor(target) ?? centre, 24, 36);
  const ctrl = { x: (from.x + to.x) / 2, y: Math.min(from.y, to.y) - 120 };
  const W = 48;
  const H = 40;
  // the card's sizing classes (and the grey of an unbuilt level) stay behind; the clone keeps only .cv-thumb
  const el = src.cloneNode(true) as SVGSVGElement;
  el.setAttribute("class", "cv-thumb");
  el.setAttribute("width", String(W));
  el.setAttribute("height", String(H));
  el.setAttribute("aria-hidden", "true");
  el.style.cssText = "position:fixed;left:0;top:0;z-index:60;pointer-events:none;will-change:transform;filter:drop-shadow(0 3px 4px rgba(0,0,0,.6))";
  document.body.appendChild(el);
  const frames: Keyframe[] = [];
  for (let i = 0; i <= 8; i++) {
    const k = i / 8;
    const x = (1 - k) * (1 - k) * from.x + 2 * (1 - k) * k * ctrl.x + k * k * to.x;
    const y = (1 - k) * (1 - k) * from.y + 2 * (1 - k) * k * ctrl.y + k * k * to.y;
    frames.push({ transform: `translate(${x - W / 2}px,${y - H / 2}px) scale(${1 - 0.4 * k})`, offset: k });
  }
  const land = flightStart(target);
  let landed = false;
  let fallback = 0;
  const finish = () => {
    if (landed) return;
    landed = true;
    window.clearTimeout(fallback);
    el.remove();
    fxBurst(to.x, to.y, "glint", 10);
    land();
  };
  const anim = el.animate(frames, { duration: 450, easing: "cubic-bezier(.4,0,.6,1)" });
  anim.onfinish = finish;
  anim.oncancel = finish;
  // a throttled timeline (hidden tab) must not leave the chamber waiting for its bounce
  fallback = window.setTimeout(finish, 700);
}
