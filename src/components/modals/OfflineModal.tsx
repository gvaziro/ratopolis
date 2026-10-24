"use client";

/**
 * «Пока вас не было…»: the offline report as a front page of «Крысиные Ведомости».
 * Gains roll up like odometers, trains passed without you, night-shift efficiency η and the cap note.
 */
import { useEffect, useRef, useState } from "react";
import { RESOURCES, RES_ORDER } from "@/game/data/resources";
import { districtName } from "@/game/data/zones";
import type { OfflineReport } from "@/game/engine/offline";
import { useGame } from "@/game/store";
import type { Amounts, ResId } from "@/game/types";
import { BrassButton, cx, Odometer } from "@/components/ui/kit";
import { clockLine } from "@/components/layout/clock";
import HudStyles from "@/components/layout/HudStyles";
import { fmt, fmtInt, fmtPct, fmtTime, plural } from "@/lib/format";

export default function OfflineModal() {
  const report = useGame((s) => s.offlineReport);
  if (!report) return null;
  return <FrontPage r={report} />;
}

const INK = "#2a1f14";

function rows(a: Amounts): [ResId, number][] {
  return RES_ORDER.filter((r) => Math.abs(a[r] ?? 0) >= 0.005).map((r) => [r, a[r] ?? 0]);
}

/** Word form for a count printed by fmtInt; a compact «1.2K» reads «…тысячи», so it takes the "many" form. */
function countForm(n: number, one: string, few: string, many: string): string {
  return Math.abs(n) < 1000 ? plural(n, one, few, many) : many;
}

/** Witty sub-headline, picked deterministically from the report. */
function kicker(r: OfflineReport): string {
  if (r.trains >= 10) return `Бог Грома проходил ${r.trains} ${countForm(r.trains, "раз", "раза", "раз")}. Бригада встречала его без вас — и, признаться, неплохо`;
  if (r.trains > 0) return "Поезда шли по расписанию, крысы — по привычке. Улов сложен в кладовых";
  if (r.rats >= 5) return "Пока вожак отсутствовал, колония занялась тем, что умеет лучше всего: размножением";
  const lines = [
    "Колония трудилась без надзора и, кажется, даже не заметила",
    "Собиратели клянутся, что работали не покладая лап. Кладовые подтверждают",
    "Наверху сменились газеты, внизу — запасы. Отчёт прилагается",
  ];
  return lines[Math.floor(r.elapsed) % lines.length];
}

function FrontPage({ r }: { r: OfflineReport }) {
  const calm = useGame((s) => s.game.settings.reducedMotion);
  const time = useGame((s) => s.game.time);
  const migrations = useGame((s) => s.game.meta.migrations);
  const district = useGame((s) => s.game.meta.district);
  const nightShift = useGame((s) => !!s.game.upgrades.night_shift);
  const eternal = useGame((s) => !!s.game.meta.edicts.eternal_night_shift);
  const [rolled, setRolled] = useState(false);
  const footRef = useRef<HTMLElement>(null);
  const close = () => useGame.getState().dismissOffline();

  useEffect(() => {
    const t = window.setTimeout(() => setRolled(true), calm ? 0 : 450);
    footRef.current?.querySelector("button")?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") useGame.getState().dismissOffline();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [calm]);

  const gained = rows(r.gained);
  const loot = rows(r.trainLoot);
  const capped = r.simulated < r.elapsed - 1;
  const extend = !nightShift ? "Улучшение «Ночная смена» продлит" : !eternal ? "Указ «Вечная ночная смена» продлит" : "";

  return (
    <div
      className={cx("fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4 backdrop-blur-[2px]", calm && "hud-calm")}
      role="dialog"
      aria-modal="true"
      aria-labelledby="offline-title"
      style={{ animation: "hud-fade-in .3s ease-out both" }}
    >
      <HudStyles />
      <article
        className="hud-paper relative max-h-[calc(100dvh-32px)] w-full max-w-[560px] overflow-y-auto rounded-sm border-2 px-4 pb-4 pt-3 shadow-[0_20px_60px_rgba(0,0,0,.75)] sm:px-6"
        style={{ borderColor: INK, animation: calm ? undefined : "hud-pop .5s cubic-bezier(.2,1.2,.4,1) both", color: INK }}
      >
        {/* masthead */}
        <header className="text-center">
          <div className="flex items-center justify-between font-display text-[10px] font-bold uppercase tracking-[0.18em]">
            <span>Выпуск вечерний</span>
            <span>Цена: одна крошка</span>
          </div>
          <h2 className="mt-0.5 border-y-[3px] border-double py-0.5 font-display text-[26px] font-bold uppercase leading-none tracking-wide sm:text-[34px]" style={{ borderColor: INK }}>
            Крысиные Ведомости
          </h2>
          <div className="mt-0.5 flex flex-wrap items-center justify-between gap-x-3 font-mono text-[10.5px] tabular">
            <span>{clockLine(time, migrations)}</span>
            <span>{districtName(district)}</span>
          </div>
        </header>

        <h3 id="offline-title" className="mt-3 text-center font-display text-[22px] font-bold leading-tight sm:text-[26px]">
          Пока вас не было ({fmtTime(r.elapsed)})…
        </h3>
        <p className="mt-1 text-center text-[13px] italic leading-snug text-[#4a3826]">{kicker(r)}</p>

        <div className="mt-3 grid gap-4 border-t pt-3 sm:grid-cols-[1.15fr_1fr] sm:gap-5" style={{ borderColor: `${INK}55` }}>
          {/* gains */}
          <section>
            <h4 className="mb-1.5 font-display text-[13px] font-bold uppercase tracking-[0.18em]">Склады пополнились</h4>
            {gained.length === 0 ? (
              <p className="text-[13px] italic">Ни крошки. Видимо, все спали.</p>
            ) : (
              <ul className="space-y-1">
                {gained.map(([res, v], i) => (
                  <li
                    key={res}
                    className="hud-countup flex items-center justify-between gap-2 border-b border-dotted pb-0.5 text-[13.5px]"
                    style={{ borderColor: `${INK}40`, animationDelay: `${0.08 * i}s` }}
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span aria-hidden>{RESOURCES[res].icon}</span>
                      <span className="truncate">{RESOURCES[res].name}</span>
                    </span>
                    <Odometer
                      value={rolled ? v : 0}
                      format={(n) => (v > 0 ? "+" : "") + fmt(n)}
                      className={cx("font-mono font-bold", v < 0 ? "text-[#8a2a1f]" : "text-[#2f5d1f]")}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* chronicle */}
          <section className="space-y-2.5 text-[13.5px] leading-snug">
            <h4 className="font-display text-[13px] font-bold uppercase tracking-[0.18em]">Хроника</h4>
            <p>
              <span aria-hidden>🐀 </span>
              {r.rats > 0 ? (
                <>
                  {countForm(r.rats, "Родилась", "Родились", "Родилось")} <b className="font-mono">+{fmtInt(r.rats)}</b>{" "}
                  {countForm(r.rats, "крыса", "крысы", "крыс")}. Старейшины сбились со счёта.
                </>
              ) : (
                <>Новых крыс нет: то ли гнёзда полны, то ли не до того было.</>
              )}
            </p>
            <div>
              <p>
                <span aria-hidden>🚂 </span>
                Поездов пройдено без вас: <b className="font-mono">{fmtInt(r.trains)}</b>
              </p>
              {loot.length > 0 && (
                <p className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 pl-5 font-mono text-[12px] font-bold text-[#2f5d1f]">
                  {loot.map(([res, v]) => (
                    <span key={res} className="whitespace-nowrap">
                      {RESOURCES[res].icon}+{fmt(v)}
                    </span>
                  ))}
                </p>
              )}
            </div>
            <p>
              <span aria-hidden>🌙 </span>
              Ночная смена работала с КПД <b className="whitespace-nowrap font-mono">η = {fmtPct(r.eta)}</b>
            </p>
            {capped && (
              <p className="rounded-sm border border-dashed px-2 py-1 text-[12.5px] italic" style={{ borderColor: `${INK}66` }}>
                Крысы работали только {fmtTime(r.simulated)} — дальше уснули.{extend ? ` ${extend}.` : ""}
              </p>
            )}
          </section>
        </div>

        <footer ref={footRef} className="mt-4 flex flex-col items-center gap-1.5 border-t-[3px] border-double pt-3" style={{ borderColor: INK }}>
          <BrassButton size="lg" onClick={close} className="min-h-11 min-w-40 font-display text-lg uppercase tracking-widest">
            К делу!
          </BrassButton>
          <span className="text-[10.5px] italic text-[#6a5238]">Esc — тоже к делу</span>
        </footer>
      </article>
    </div>
  );
}
