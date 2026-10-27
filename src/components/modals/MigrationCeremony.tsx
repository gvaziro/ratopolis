"use client";

/**
 * The Great Migration ceremony card (SH-5), split from MigrationOverlay so it loads only when a migration happens
 * (next/dynamic): the «Крысиные Ведомости» front page drops in, a file of rats with bundles marches into a drainpipe,
 * the crown counter ticks up (sfxCue crownTick, at most 2.5 s, then it jumps to the final value), the King's portrait
 * grows a tail, and a card sums up the run. Reduced motion → a static card with the final numbers.
 */
import { useEffect, useRef, useState } from "react";
import KingPortrait from "@/components/panels/KingPortrait";
import { HazardStyles } from "@/components/scenes/HazardKit";
import { BrassButton, Rivets } from "@/components/ui/kit";
import { RATING_TABLE } from "@/game/data/events";
import { districtAt, districtInfoOf } from "@/game/data/districts";
import { sfxCue } from "@/game/fx";
import { useGame } from "@/game/store";
import type { Fx } from "@/game/types";
import { fmt, fmtDuration, fmtInt, plural } from "@/lib/format";

type MigrationFx = Extract<Fx, { k: "migration" }>;

/** Crown counter: one crown per tick, the whole count in at most this long. */
const TICK_MS = 60;
const COUNT_MAX_MS = 2500;

export default function Ceremony({ data, onClose }: { data: MigrationFx; onClose: () => void }) {
  const reduced = useGame((s) => s.game.settings.reducedMotion);
  const migrations = useGame((s) => s.game.meta.migrations);
  const gilded = useGame((s) => s.game.meta.achievements.before_noon !== undefined);
  const countRef = useRef<HTMLSpanElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [counted, setCounted] = useState(reduced);

  // the crown counter: +1 per tick with a coin-like tick, capped at 2.5 s, then the final value
  useEffect(() => {
    if (reduced) return;
    const el = countRef.current;
    const total = Math.max(0, Math.floor(data.crowns));
    const start = performance.now() + 1200; // after the paper lands
    let shown = -1;
    const iv = window.setInterval(() => {
      const t = performance.now() - start;
      if (t < 0) return;
      const n = t >= COUNT_MAX_MS ? total : Math.min(total, Math.floor(t / TICK_MS) + 1);
      if (n !== shown) {
        if (n > shown && n < total && n % 2 === 1) sfxCue("crownTick", { intensity: 0.5, pitch: 1 + Math.min(0.5, n / Math.max(1, total)) });
        shown = n;
        if (el) el.textContent = `+${fmtInt(n)}`;
      }
      if (n >= total) {
        window.clearInterval(iv);
        sfxCue("crownTick", { intensity: 1, pitch: 1.6 });
        setCounted(true);
      }
    }, TICK_MS / 2);
    return () => window.clearInterval(iv);
  }, [data.crowns, reduced]);

  useEffect(() => {
    if (counted) cardRef.current?.querySelector<HTMLButtonElement>("button[data-settle]")?.focus();
  }, [counted]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const sum = data.summary;
  const rating = RATING_TABLE.find((r) => r.id === sum.bestRating);
  // v3 (ENG-11): the district the colony chose on the London map, not the old fixed sequence by index
  const [district] = useState(() => (data.districtId ? districtInfoOf(data.districtId, districtAt(useGame.getState().game.meta, data.district).lap) : districtAt(useGame.getState().game.meta, data.district)));
  const trait = district.trait;
  const anim = (css: string) => (reduced ? undefined : { animation: css });

  return (
    <div className="fixed inset-0 z-[60] flex overflow-y-auto bg-soot/95 p-3 text-parchment" role="dialog" aria-modal="true" aria-label="Великое Переселение" style={anim("rh-reveal .35s ease-out both")}>
      <HazardStyles />
      <style>{MIG_CSS}</style>
      <div className="m-auto flex w-full max-w-md flex-col items-stretch gap-3">
        {/* the front page */}
        <div className="relative rotate-[-1deg] rounded-sm border border-[#8a7a5a] bg-[#eadcc0] px-4 pb-3 pt-2 text-[#2a2018] shadow-[0_18px_40px_rgba(0,0,0,.7)]" style={anim("mo-drop .7s cubic-bezier(.3,1.3,.5,1) both")}>
          <div className="flex items-baseline justify-between border-b-2 border-double border-[#2a2018] pb-1 font-serif text-[10px] uppercase tracking-widest">
            <span>Крысиные Ведомости</span>
            <span>{data.weekday}, 05:00</span>
          </div>
          <h2 className="mt-1 text-center font-display text-xl font-black uppercase leading-tight tracking-wide sm:text-2xl">Экстренный выпуск: Великое Зловоние!</h2>
          <p className="mt-1 text-center font-serif text-xs italic">Колония снимается с места и уходит в {district.name}</p>
          {/* rats with bundles marching into the pipe */}
          <div className="relative mt-2 h-10 overflow-hidden rounded-sm bg-[#d8c8a4]">
            <div className="absolute inset-y-0 right-0 w-10 rounded-l-full border-l-4 border-[#5a4a32] bg-[#3a2e22]" />
            {!reduced &&
              [0, 1, 2, 3, 4].map((i) => (
                <span key={i} className="absolute bottom-1 text-lg leading-none" style={{ left: "-12%", animation: `mo-march 2s linear ${0.6 + i * 0.22}s both` }}>
                  🐀<span className="relative -left-1 -top-2 text-xs">🎒</span>
                </span>
              ))}
            {reduced && <span className="absolute bottom-1 left-3 text-sm">🐀🎒 🐀🎒 🐀🎒 → труба</span>}
          </div>
        </div>

        {/* crowns and the portrait */}
        <div ref={cardRef} className="relative rounded-xl border-2 border-[#d4af37] bg-gradient-to-b from-[#3b2c12] via-panel-2 to-panel px-4 pb-4 pt-5 text-center shadow-[0_0_50px_rgba(212,175,55,.3)]" style={anim("rh-reveal .5s ease-out .5s both")}>
          <Rivets />
          <div className="flex items-center justify-center gap-4">
            <div className="w-24 shrink-0 sm:w-28">
              <KingPortrait tails={1 + migrations} gilded={gilded} crowned={false} drawNew={!reduced} />
            </div>
            <div className="min-w-0 text-left">
              <p className="font-display text-[11px] uppercase tracking-[0.25em] text-brass">Венцы колонии</p>
              <p className="font-display text-4xl font-bold text-[#f3d77a] tabular">
                <span ref={countRef}>{reduced ? `+${fmtInt(data.crowns)}` : "+0"}</span> 👑
              </p>
              <p className="text-xs text-parchment-dim">
                Хвостов у Короля: {fmtInt(1 + migrations)}
              </p>
            </div>
          </div>
          <p className="mt-3 rounded border border-line/60 bg-soot/50 px-2 py-1.5 text-xs leading-snug text-parchment">
            За забег: {fmt(sum.eRun)} 🪙 · {fmtInt(sum.trains)} {plural(sum.trains, "поезд", "поезда", "поездов")} · лучший улов {rating?.icon ? `${rating.icon} ${rating.name}` : "—"} · {fmtInt(sum.rats)}{" "}
            {plural(sum.rats, "хвост", "хвоста", "хвостов")} · {fmtDuration(Math.round(sum.seconds))}
          </p>
          <p className="mt-2 text-xs text-parchment-dim">
            {trait.icon} {trait.name}: {trait.perk} · {trait.quirk}
          </p>
          {(counted || reduced) && (
            <BrassButton data-settle size="lg" className="mt-3 min-h-12 w-full" onClick={onClose} style={anim("rh-reveal .3s ease-out both")}>
              Обустроиться {district.loc}
            </BrassButton>
          )}
        </div>
      </div>
    </div>
  );
}

const MIG_CSS = `
@keyframes mo-drop{0%{transform:translateY(-120%) rotate(-12deg);opacity:0}70%{transform:translateY(4%) rotate(1deg);opacity:1}100%{transform:rotate(-1deg)}}
@keyframes mo-march{0%{left:-12%}100%{left:88%;opacity:.2}}
`;
