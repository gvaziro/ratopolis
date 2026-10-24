"use client";

/** «Суета» meter that follows the grate on screen; pulses «АВРАЛ!» during a frenzy. */
import { memo, useEffect, useRef } from "react";
import { Bar, cx } from "@/components/ui/kit";
import { useGame } from "@/game/store";
import { fmtInt } from "@/lib/format";
import { onCamera } from "./camera";
import { GRATE } from "./geometry";

const WIDTH = 150;

export const BustleMeter = memo(function BustleMeter() {
  const revealed = useGame((s) => !!s.game.revealed.bustle);
  const value = useGame((s) => Math.round(s.game.bustle.value));
  const frenzyLeft = useGame((s) => Math.max(0, Math.ceil(s.game.buffs.frenzyUntil - s.game.time)));
  const cooling = useGame((s) => s.game.buffs.frenzyCooldownUntil > s.game.time && s.game.buffs.frenzyUntil <= s.game.time);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!revealed) return;
    return onCamera((v) => {
      const el = ref.current;
      if (!el) return;
      const k = Math.max(1, 104 / (GRATE.w * v.s));
      const x = v.cw / 2 + (GRATE.x - v.cx) * v.s - WIDTH / 2;
      const y = v.ch / 2 + (GRATE.y + 30 * k - v.cy) * v.s + 6;
      const cxp = Math.max(6, Math.min(v.cw - WIDTH - 6, x));
      const cyp = Math.max(6, Math.min(v.ch - 70, y));
      el.style.transform = `translate(${cxp.toFixed(0)}px, ${cyp.toFixed(0)}px)`;
    });
  }, [revealed]);

  if (!revealed) return null;
  const frenzy = frenzyLeft > 0;
  return (
    <div ref={ref} className="pointer-events-none absolute left-0 top-0 z-10" style={{ width: WIDTH }} aria-live="polite">
      <div className="rounded-md border border-line/80 bg-soot-2/75 px-2 pb-1.5 pt-1 shadow-[0_2px_8px_rgba(0,0,0,.45)]">
        <div className="flex items-center justify-between font-display text-[11px] font-bold tracking-wide text-brass-light">
          <span>{frenzy ? "Аврал идёт" : cooling ? "Переводим дух" : "Суета"}</span>
          <span className="font-mono tabular text-parchment-dim">{frenzy ? `${fmtInt(frenzyLeft)}с` : `${fmtInt(value)}%`}</span>
        </div>
        <Bar
          value={frenzy ? frenzyLeft : value}
          max={frenzy ? 10 : 100}
          color={frenzy ? "linear-gradient(90deg,#ff5a3c,#ffd34d)" : value > 80 ? "linear-gradient(90deg,#f2b84b,#ff6a4a)" : "linear-gradient(90deg,#7d5f2c,#e8c983)"}
          glow={frenzy || value > 80}
          className={cx("mt-0.5 h-2", cooling && "opacity-50")}
        />
      </div>
      {frenzy && (
        <div className="cv-avral mt-1 text-center font-display text-2xl font-bold tracking-widest text-[#ffd34d] [text-shadow:0_0_10px_rgba(255,90,60,.9),0_2px_0_#2a1a0c]">АВРАЛ!</div>
      )}
    </div>
  );
});
