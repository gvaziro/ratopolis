"use client";

/**
 * «Улов» — the newspaper card after a train: loot rolls up like an odometer (1.2 s, ease-out),
 * caught share, rating, combo, suspicion, notes, and the brotherhood's stamp for gold / royal.
 */
import { memo, useEffect, useRef, useState } from "react";
import { sfx } from "@/audio/sfx";
import { RATING_TABLE } from "@/game/data/events";
import { RESOURCES } from "@/game/data/resources";
import { entries } from "@/game/engine/formulas";
import { useGame } from "@/game/store";
import type { Scene } from "@/game/types";
import { fmt, fmtInt, fmtPct } from "@/lib/format";
import { BrassButton, cx } from "@/components/ui/kit";
import { act, clamp, easeOutCubic, shake } from "./sceneUtils";

/** Number rolling up from 0 to `value` in 1.2 s with an ease-out (DOM text, no React re-renders). */
function RollUp({ value, delay = 0, prefix = "+" }: { value: number; delay?: number; prefix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const t0 = performance.now() + delay;
    let raf = 0;
    const tick = (now: number) => {
      const k = clamp((now - t0) / 1200);
      el.textContent = prefix + fmt(value * easeOutCubic(k));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, delay, prefix]);
  return (
    <span ref={ref} className="tabular">
      {prefix}
      {fmt(0)}
    </span>
  );
}

function HaulCardImpl({ scene }: { scene: Scene }) {
  const [haul] = useState(scene.haul);
  const reduced = useGame((s) => s.game.settings.reducedMotion);
  const showSusp = useGame((s) => !!s.game.zones.cellars || !!s.game.revealed.suspicion);
  const [stamp, setStamp] = useState(false);
  const approved = haul?.rating === "gold" || haul?.rating === "royal";

  useEffect(() => {
    sfx.typewriter();
    const coin = window.setTimeout(() => sfx.coin(), 250);
    if (!approved) return () => window.clearTimeout(coin);
    const t = window.setTimeout(() => {
      setStamp(true);
      sfx.thud();
      shake(4, 380);
    }, 1350);
    return () => {
      window.clearTimeout(coin);
      window.clearTimeout(t);
    };
  }, [approved]);

  if (!haul) return null;
  const gained = entries(haul.gained)
    .filter(([, v]) => v >= 0.005)
    .sort((a, b) => b[1] * (RESOURCES[b[0]].market ?? 40) - a[1] * (RESOURCES[a[0]].market ?? 40));
  const rating = RATING_TABLE.find((r) => r.id === haul.rating) ?? RATING_TABLE[RATING_TABLE.length - 1];
  const royal = haul.rating === "royal";

  return (
    <div className="absolute inset-0 z-10 flex items-start justify-center overflow-y-auto bg-black/60 p-3 md:items-center">
      <article
        className="relative w-full max-w-md rounded-sm border border-[#8a7a5c] p-4 text-[#2a2118] shadow-[0_18px_50px_rgba(0,0,0,.8)] md:p-5"
        style={{
          animation: reduced ? undefined : "rr-card .55s cubic-bezier(.2,.8,.3,1) both",
          background: "radial-gradient(ellipse at 30% 20%, rgba(255,250,235,.55), transparent 60%), radial-gradient(ellipse at 80% 90%, rgba(120,90,50,.18), transparent 55%), #e6d6b6",
        }}
      >
        <header className="border-b-4 border-double border-[#2a2118] pb-1.5 text-center">
          <p className="font-display text-[10px] font-bold uppercase tracking-[0.32em] text-[#5a4a35] md:text-[11px]">Крысиные Ведомости · экстренный выпуск</p>
          <h3 className="font-display text-2xl font-bold leading-tight md:text-3xl">{haul.title}</h3>
        </header>

        <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 py-3 font-mono text-base font-bold md:text-lg">
          {gained.map(([r, v], i) => (
            <li key={r} className="flex min-w-0 items-center gap-1.5" title={RESOURCES[r].name}>
              <span className="text-xl leading-none">{RESOURCES[r].icon}</span>
              <RollUp value={v} delay={i * 110} />
            </li>
          ))}
          {gained.length === 0 && <li className="col-span-2 font-sans text-sm font-normal italic">Ни крошки. Старейшины хмурятся.</li>}
        </ul>

        <div className="grid grid-cols-1 gap-x-4 gap-y-1 border-t border-[#2a2118]/40 pt-2 text-sm sm:grid-cols-2">
          <p>
            Поймано{" "}
            <b className="font-mono tabular">
              {fmtInt(haul.caughtCount)}/{fmtInt(haul.totalCount)}
            </b>{" "}
            ({fmtPct(haul.share)})
          </p>
          <p className={cx(royal && "text-[#8a5a00]")}>
            {haul.rating === "none" ? (
              <span className="italic">Без рейтинга (меньше 40%)</span>
            ) : (
              <>
                {rating.icon} <b>{rating.name}</b>
                {rating.bonus > 0 && <span className="font-mono"> +{fmtPct(rating.bonus)}</span>}
              </>
            )}
          </p>
          {haul.combo > 0 && (
            <p>
              Лучшее комбо <b className="font-mono">×{fmtInt(haul.combo)}</b>
            </p>
          )}
          {showSusp && (
            <p>
              Подозрение людей <b className={cx("font-mono", haul.suspicion > 0 ? "text-[#9a2a1f]" : "text-[#3d6b2a]")}>{haul.suspicion >= 0 ? `+${fmt(haul.suspicion)}` : fmt(haul.suspicion)}</b> 👁
            </p>
          )}
        </div>

        {(haul.notes.length > 0 || haul.crash) && (
          <ul className="mt-2 space-y-0.5 border-t border-[#2a2118]/40 pt-2 text-sm">
            {haul.notes.map((n) => (
              <li key={n} className={cx(n.includes("ДЖЕКПОТ") && "font-bold text-[#8a5a00]", n.includes("Авария") && "font-bold text-[#9a2a1f]")}>
                ◆ {n}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 flex items-end justify-between gap-3">
          <p className="text-[11px] italic text-[#5a4a35]">Люди наверху ничего не заметили. Ну, почти.</p>
          <BrassButton size="lg" className="min-h-11 shrink-0" autoFocus onClick={() => act({ a: "dismiss" })}>
            Дальше
          </BrassButton>
        </div>

        {stamp && (
          <div className="pointer-events-none absolute right-3 top-[38%] md:right-5" style={{ animation: reduced ? undefined : "rr-pop .35s ease-out both" }}>
            <span
              className="inline-block -rotate-[9deg] rounded border-[3px] border-double px-2 py-1 text-center font-display text-xs font-bold uppercase leading-tight tracking-widest md:text-sm"
              style={{ color: royal ? "#a0700a" : "#9a1f1f", borderColor: royal ? "#a0700a" : "#9a1f1f", background: "rgba(255,255,255,.12)", mixBlendMode: "multiply" }}
            >
              Одобрено
              <br />
              путейским братством
            </span>
          </div>
        )}
      </article>
    </div>
  );
}

const HaulCard = memo(HaulCardImpl, (a, b) => a.scene.seq === b.scene.seq && a.scene.phaseStart === b.scene.phaseStart);
export default HaulCard;
