"use client";

/**
 * Zone pips (right edge of the colony): one brass button per zone and the 🔭 overview toggle.
 * Locked zones are dimmed with a 🔒, the zone being dug pulses, a gold dot marks a zone with a purse or a shiny
 * lying over it, and the pip of the band at the view centre is ringed (set imperatively from the camera).
 */
import { memo, useEffect, useRef, useState } from "react";
import { cx } from "@/components/ui/kit";
import { ZONES, ZONE_ORDER } from "@/game/data/zones";
import type { GameState, ZoneId } from "@/game/types";
import { useSampled } from "@/game/useSampled";
import { camView, onCamera } from "./camera";
import { BAND_H, bandTop, nextLocked } from "./geometry";

/** Colony height (px) from which the single-column rail (6 × 32 px) fits between the gauge and the bottom buttons. */
const TALL_RAIL = 330;

function zoneAtY(y: number): ZoneId | null {
  for (const z of ZONE_ORDER) if (y >= bandTop(z) && y < bandTop(z) + BAND_H) return z;
  return null;
}

/** The purse and the shinies float in view space (0..1 of the colony view): map them through the camera. */
function lootZones(g: GameState): string {
  const v = camView();
  if (v.cw <= 1) return "";
  const out = new Set<ZoneId>();
  const pts = g.purse ? [g.purse, ...g.shinies] : g.shinies;
  for (const p of pts) {
    const z = zoneAtY(v.cy + ((p.y - 0.5) * v.ch) / v.s);
    if (z && g.zones[z]) out.add(z);
  }
  return [...out].join(",");
}

export const ZonePips = memo(function ZonePips({ onZone, onOverview, overview }: { onZone: (z: ZoneId) => void; onOverview: () => void; overview: boolean }) {
  const st = useSampled(
    (s) => ({
      open: ZONE_ORDER.filter((z) => s.game.zones[z]).join(","),
      dig: s.game.digging?.zone ?? "",
      next: nextLocked(s.game) ?? "",
      loot: lootZones(s.game),
    }),
    2,
  );
  const btns = useRef(new Map<ZoneId, HTMLButtonElement>());
  const openList = st.open.split(",").filter(Boolean);
  const shown = openList.length >= 2;
  // a short colony (small phones) folds the rail into 2 columns so it clears the steam gauge
  const [tall, setTall] = useState(true);

  // ring the pip of the band at the view centre (no React render per camera frame)
  useEffect(() => {
    if (!shown) return;
    let cur: ZoneId | null = null;
    return onCamera((v) => {
      setTall(v.ch >= TALL_RAIL);
      const z = zoneAtY(v.cy);
      if (z === cur) return;
      if (cur) btns.current.get(cur)?.removeAttribute("data-here");
      cur = z;
      if (z) btns.current.get(z)?.setAttribute("data-here", "");
    });
  }, [shown, st.open]);

  if (!shown) return null;
  return (
    <nav
      aria-label="Зоны колонии"
      data-nodrag=""
      className={cx("absolute right-1 top-1/2 z-20 -translate-y-1/2 gap-1", tall ? "flex flex-col items-center" : "grid grid-cols-2")}
    >
      {ZONE_ORDER.map((z) => {
        const isOpen = openList.includes(z);
        const isNext = st.next === z;
        const def = ZONES[z];
        return (
          <button
            key={z}
            ref={(el) => {
              if (el) btns.current.set(z, el);
              else btns.current.delete(z);
            }}
            type="button"
            data-nodrag=""
            disabled={!isOpen && !isNext}
            onClick={() => onZone(z)}
            title={isOpen ? `${def.icon} ${def.name}` : `${def.name} — ещё не раскопано`}
            aria-label={isOpen ? `Показать зону «${def.name}»` : `Зона «${def.name}» ещё закрыта`}
            className={cx(
              "relative flex h-8 w-8 items-center justify-center rounded-full border text-[15px] leading-none shadow-[0_2px_6px_rgba(0,0,0,.55)] transition-transform data-[here]:ring-2 data-[here]:ring-parchment/80",
              isOpen ? "border-brass-light bg-[radial-gradient(circle_at_35%_30%,#f2d896,#c9a25a_45%,#6b4f22)] hover:scale-110" : "border-line bg-soot-2/85",
              isNext && "hover:scale-110",
            )}
          >
            {st.dig === z && <span aria-hidden className="cv-ping pointer-events-none absolute inset-0 rounded-full border-2 border-gaslight" />}
            <span aria-hidden className={cx(!isOpen && "opacity-45 grayscale")}>
              {def.icon}
            </span>
            {!isOpen && (
              <span aria-hidden className="absolute -bottom-1 -right-1 text-[11px] leading-none">
                🔒
              </span>
            )}
            {st.loot.includes(z) && <span aria-hidden className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-[#ffd34d] shadow-[0_0_6px_#ffd34d] ring-1 ring-soot" />}
          </button>
        );
      })}
      <button
        type="button"
        data-nodrag=""
        onClick={onOverview}
        aria-pressed={overview}
        title={overview ? "Вернуться к решётке" : "Вся колония разом"}
        aria-label={overview ? "Вернуться к решётке" : "Показать всю колонию"}
        className={cx(
          "flex h-8 w-8 items-center justify-center rounded-full border text-[15px] leading-none shadow-[0_2px_6px_rgba(0,0,0,.55)] transition-transform hover:scale-110",
          tall && "mt-1",
          overview ? "border-gaslight bg-panel-3 ring-2 ring-gaslight/70" : "border-brass-dark bg-soot-2/85",
        )}
      >
        🔭
      </button>
    </nav>
  );
});
