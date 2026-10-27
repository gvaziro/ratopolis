"use client";

/**
 * Background events on the colony floor: the dropped purse (👛) and shinies (✨) — and, after the Metro, the rain a
 * passing carriage shakes through the grate (brass horseshoes, COL-4).
 * Positions are 0..1 fractions of the colony view (engine contract), so they live in screen space.
 */
import { memo, useMemo, type PointerEvent } from "react";
import { useShallow } from "zustand/react/shallow";
import { RESOURCES } from "@/game/data/resources";
import { useGame } from "@/game/store";
import type { ResId } from "@/game/types";
import { fxBurst, markFxPoint } from "../fx/fxBus";
import { uiX, uiY } from "./geometry";

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
  carriage: boolean;
}

/**
 * COL-4: what a passing carriage shakes through the grate (Shiny.kind "carriage", ENG-9) — a brass horseshoe with a
 * coach-lamp glint and the catch in its crook, so the rain reads apart from the plain sparkles.
 */
function CarriageGlint({ res, seq }: { res: ResId; seq: number }) {
  return (
    <span className="cv-pop relative block h-11 w-11">
      <span className="pointer-events-none absolute inset-0 rounded-full bg-[radial-gradient(circle,rgba(255,214,140,.55),rgba(255,214,140,0)_68%)]" />
      <svg viewBox="-20 -20 40 40" className="cv-hover absolute inset-0 h-full w-full drop-shadow-[0_2px_3px_rgba(0,0,0,.7)]" style={{ animationDelay: `${(seq % 5) * -0.27}s` }} aria-hidden>
        {/* heels up, so the luck stays in */}
        <path d="M-12 -14V1A12 12 0 0 0 12 1V-14" fill="none" stroke="#5c4520" strokeWidth="8.5" strokeLinecap="round" />
        <path d="M-12 -14V1A12 12 0 0 0 12 1V-14" fill="none" stroke="#e8c26a" strokeWidth="6" strokeLinecap="round" />
        <path d="M-12 -7h.1M-12 1h.1M-7 9h.1M7 9h.1M12 1h.1M12 -7h.1" stroke="#5c4520" strokeWidth="2" strokeLinecap="round" />
        <path d="M-9 4A9 9 0 0 0 -2 10" fill="none" stroke="#fff6dc" strokeWidth="1.6" strokeLinecap="round" opacity=".8" />
      </svg>
      <span className="cv-sparkle pointer-events-none absolute -right-1 -top-1 text-sm text-[#fff1c8]">✦</span>
      <span className="pointer-events-none absolute left-1/2 top-[38%] -translate-x-1/2 -translate-y-1/2 text-base leading-none drop-shadow-[0_0_4px_rgba(255,240,180,.9)]">{RESOURCES[res].icon}</span>
    </span>
  );
}

const Shinies = memo(function Shinies() {
  const key = useGame((s) => s.game.shinies.map((x) => `${x.id}:${x.x.toFixed(4)}:${x.y.toFixed(4)}:${x.res}:${x.kind === "carriage" ? 1 : 0}`).join("|"));
  const list = useMemo<ShinyView[]>(
    () =>
      key
        ? key.split("|").map((p) => {
            const [id, x, y, res, c] = p.split(":");
            return { id: Number(id), x: Number(x), y: Number(y), res: res as ResId, carriage: c === "1" };
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
          aria-label={s.carriage ? `Обронено с экипажа: ${RESOURCES[s.res].name} — ловите!` : `Блестяшка: ${RESOURCES[s.res].name}`}
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
          {s.carriage ? (
            <span className="cv-blink-late pointer-events-none relative block">
              <CarriageGlint res={s.res} seq={s.id} />
            </span>
          ) : (
            <span className="cv-blink-late pointer-events-none relative block">
              <span className="cv-pop block">
                <span className="cv-sparkle absolute -left-2 -top-2 text-base">✨</span>
                <span className="block text-xl drop-shadow-[0_0_6px_rgba(255,240,180,.9)]">{RESOURCES[s.res].icon}</span>
              </span>
            </span>
          )}
        </button>
      ))}
    </>
  );
});

export function BgEvents() {
  return (
    <>
      <Purse />
      <Shinies />
    </>
  );
}
