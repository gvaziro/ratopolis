"use client";

/**
 * Background events on the colony floor: the dropped purse (👛) and shinies (✨).
 * Positions are 0..1 fractions of the colony view (engine contract), so they live in screen space.
 */
import { memo, useMemo, type PointerEvent } from "react";
import { useShallow } from "zustand/react/shallow";
import { RESOURCES } from "@/game/data/resources";
import { useGame } from "@/game/store";
import type { ResId } from "@/game/types";
import { fxBurst, markFxPoint } from "../fx/fxBus";

const Purse = memo(function Purse() {
  const purse = useGame(useShallow((s) => s.game.purse));
  const urgent = useGame((s) => !!s.game.purse && s.game.purse.until - s.game.time < 3);
  if (!purse) return null;
  const grab = (x: number, y: number) => {
    markFxPoint(x, y);
    fxBurst(x, y, "glint", 8, 0.8);
    useGame.getState().clickPurse();
  };
  return (
    <button
      type="button"
      data-nodrag=""
      aria-label="Оброненный кошелёк — открыть!"
      title="Оброненный кошелёк"
      className="absolute z-10 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-brass-light"
      style={{ left: `${uiX(purse.x) * 100}%`, top: `${uiY(purse.y) * 100}%` }}
      onPointerDown={(e: PointerEvent<HTMLButtonElement>) => {
        e.stopPropagation();
        grab(e.clientX, e.clientY);
      }}
      onClick={(e) => {
        if (e.detail !== 0) return; // keyboard activation only; pointer handled on press
        const r = e.currentTarget.getBoundingClientRect();
        grab(r.left + r.width / 2, r.top + r.height / 2);
      }}
    >
      <span className="cv-pop pointer-events-none absolute inset-0 rounded-full bg-[radial-gradient(circle,rgba(255,211,77,.45),rgba(255,211,77,0)_70%)]" />
      <span className={urgent ? "cv-blink" : undefined}>
        <span className="cv-hover block" style={{ perspective: "200px" }}>
          <span className="cv-purse inline-block text-4xl drop-shadow-[0_2px_3px_rgba(0,0,0,.6)]">👛</span>
        </span>
      </span>
      <span className="cv-sparkle pointer-events-none absolute -right-0.5 top-1 text-sm">✨</span>
      <span className="cv-sparkle pointer-events-none absolute bottom-2 left-0 text-xs" style={{ animationDelay: ".5s" }}>
        ✨
      </span>
    </button>
  );
});

interface ShinyView {
  id: number;
  x: number;
  y: number;
  res: ResId;
}

const Shinies = memo(function Shinies() {
  const key = useGame((s) => s.game.shinies.map((x) => `${x.id}:${x.x.toFixed(4)}:${x.y.toFixed(4)}:${x.res}`).join("|"));
  const list = useMemo<ShinyView[]>(
    () =>
      key
        ? key.split("|").map((p) => {
            const [id, x, y, res] = p.split(":");
            return { id: Number(id), x: Number(x), y: Number(y), res: res as ResId };
          })
        : [],
    [key],
  );
  return (
    <>
      {list.map((s) => (
        <button
          key={s.id}
          type="button"
          data-nodrag=""
          aria-label={`Блестяшка: ${RESOURCES[s.res].name}`}
          className="absolute z-10 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-brass-light"
          style={{ left: `${uiX(s.x) * 100}%`, top: `${uiY(s.y) * 100}%` }}
          onPointerDown={(e) => {
            e.stopPropagation();
            markFxPoint(e.clientX, e.clientY);
            fxBurst(e.clientX, e.clientY, "glint", 6, 0.6);
            useGame.getState().clickShiny(s.id);
          }}
          onClick={(e) => {
            if (e.detail !== 0) return;
            const r = e.currentTarget.getBoundingClientRect();
            markFxPoint(r.left + r.width / 2, r.top + r.height / 2);
            useGame.getState().clickShiny(s.id);
          }}
        >
          <span className="cv-blink-late pointer-events-none relative block">
            <span className="cv-pop block">
              <span className="cv-sparkle absolute -left-2 -top-2 text-base">✨</span>
              <span className="block text-xl drop-shadow-[0_0_6px_rgba(255,240,180,.9)]">{RESOURCES[s.res].icon}</span>
            </span>
          </span>
        </button>
      ))}
    </>
  );
});

/** CO-8: the engine's 0..1 spot, remapped into x 0.22–0.78 × y 0.32–0.8 so a purse or shiny never hides under the
 * goal widget, the market or the zone pips (UI only: the engine's coordinates stay as they are). */
function uiX(x: number): number {
  return 0.22 + 0.56 * Math.max(0, Math.min(1, x));
}
function uiY(y: number): number {
  return 0.32 + 0.48 * Math.max(0, Math.min(1, y));
}

export function BgEvents() {
  return (
    <>
      <Purse />
      <Shinies />
    </>
  );
}
