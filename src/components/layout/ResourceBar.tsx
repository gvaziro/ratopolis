"use client";

/**
 * One row of resource pills under «Наверху». Each pill: icon, odometer amount, thin cap bar, net rate.
 * Full storage stamps «ПОЛНО» (bar blinks every 2 s); event loot above the cap glows gold with «ПЕРЕГРУЗ».
 * Phones (< 640 px) drop the «/cap» text and swap the stamps for a corner badge, so four pills fit across 375 px.
 * Always one row: scrolls sideways (touch swipe or mouse wheel) when the colony is rich in kinds of loot.
 */
import { memo, useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { RESOURCES, RES_ORDER } from "@/game/data/resources";
import { derivedOf, useGame } from "@/game/store";
import type { ResId } from "@/game/types";
import { cx, Odometer, Stamp } from "@/components/ui/kit";
import { fmt, fmtRate } from "@/lib/format";
import FloatTip from "./FloatTip";
import HudStyles from "./HudStyles";

export default function ResourceBar() {
  const shown = useGame(useShallow((s) => RES_ORDER.filter((r) => s.game.revealed[`res_${r}`])));
  const calm = useGame((s) => s.game.settings.reducedMotion);
  // pills already revealed on load appear without the pop
  const [initial] = useState(() => new Set(shown));
  const { ref, fade } = useScrollRow(shown.length);
  const mask =
    fade.l || fade.r
      ? `linear-gradient(90deg, ${fade.l ? "transparent 0, #000 18px" : "#000 0"}, ${fade.r ? "#000 calc(100% - 18px), transparent 100%" : "#000 100%"})`
      : undefined;
  return (
    <div className={cx("relative z-20 shrink-0 border-b border-line bg-gradient-to-b from-soot-2 to-soot shadow-[0_3px_8px_rgba(0,0,0,.35)]", calm && "hud-calm")}>
      <HudStyles />
      <div
        ref={ref}
        className="hud-noscroll flex items-stretch gap-1 overflow-x-auto overflow-y-hidden overscroll-x-contain px-2 py-1.5 sm:gap-1.5 sm:px-3"
        style={{ touchAction: "pan-x", maskImage: mask, WebkitMaskImage: mask }}
        role="list"
        aria-label="Запасы колонии"
      >
        {shown.map((r) => (
          <Pill key={r} r={r} pop={!initial.has(r)} />
        ))}
      </div>
    </div>
  );
}

/** One scrollable row: edge fades while there is more to see; the mouse wheel scrolls it sideways. */
function useScrollRow(count: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState({ l: false, r: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const l = el.scrollLeft > 2;
      const r = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
      setFade((f) => (f.l === l && f.r === r ? f : { l, r }));
    };
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      el.scrollLeft += e.deltaY;
      e.preventDefault();
    };
    const ro = new ResizeObserver(update);
    ro.observe(el);
    el.addEventListener("scroll", update, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: false });
    const t = window.setTimeout(update, 0);
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", update);
      el.removeEventListener("wheel", onWheel);
      window.clearTimeout(t);
    };
  }, [count]);
  return { ref, fade };
}

/* ------------------------------------------------------------ pill */

const Pill = memo(function Pill({ r, pop }: { r: ResId; pop: boolean }) {
  const def = RESOURCES[r];
  const amount = useGame((s) => s.game.res[r]);
  const cap = useGame((s) => derivedOf(s.game).caps[r]);
  const rate = useGame((s) => s.game.rates[r]);
  const gross = useGame((s) => s.game.gross[r]);
  const hungry = useGame((s) => r === "crumbs" && s.game.hungry);
  const finite = Number.isFinite(cap) && cap > 0;
  const full = finite && amount >= cap - 1e-9;
  const over = finite && amount > cap * 1.001;
  const showRate = Math.abs(rate) >= 0.005;
  const isSteam = r === "steam";

  const tip = (
    <span className="block">
      <span className="flex items-center gap-1.5 font-display text-sm font-bold text-brass-light">
        <span>{def.icon}</span>
        {def.name}
      </span>
      <span className="mt-0.5 block text-parchment-dim">{def.desc}</span>
      <span className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 font-mono tabular">
        <span className="text-parchment-dim">Запас</span>
        <span>{fmt(amount)}</span>
        <span className="text-parchment-dim">{isSteam ? "Буфер" : "Лимит"}</span>
        <span>{finite ? fmt(cap) : "без лимита"}</span>
        <span className="text-parchment-dim">Добыча</span>
        <span className="text-good">{fmtRate(gross)}</span>
        <span className="text-parchment-dim">Итог</span>
        <span className={rate < -0.005 ? "text-danger-light" : "text-parchment"}>{fmtRate(rate)}</span>
      </span>
      {over && <span className="mt-1 block text-gaslight">ПЕРЕГРУЗ: добыча событий не сгорает, но пассивный доход стоит, пока запас выше лимита.</span>}
      {full && !over && <span className="mt-1 block text-danger-light">ПОЛНО: пассивная добыча упёрлась в лимит — нужен склад.</span>}
      {hungry && <span className="mt-1 block text-danger-light">😟 Голод! Всё, кроме крошек, ×0.5, рождение стоит. Нужны собиратели.</span>}
    </span>
  );

  return (
    <div role="listitem" className={cx("shrink-0", pop && "hud-pop")}>
      <FloatTip tip={tip} width={260}>
        <span
          className={cx(
            "relative flex min-h-10 cursor-default items-center gap-1 rounded-md border py-0.5 pl-1 pr-1.5 shadow-[inset_0_1px_0_rgba(232,201,131,.07)] transition-colors sm:gap-1.5 sm:pl-1.5 sm:pr-2",
            hungry
              ? "border-danger/70 bg-danger/20"
              : over
                ? "hud-over border-gaslight/80 bg-gradient-to-b from-[#4a3818] to-panel"
                : full
                  ? "border-danger/50 bg-panel"
                  : "border-line bg-gradient-to-b from-panel-2/90 to-panel/90",
          )}
        >
          <span className="relative text-base leading-none sm:text-lg" aria-hidden>
            {isSteam && finite ? <SteamGaugeIcon frac={amount / cap} /> : def.icon}
            {hungry && <span className="hud-throb absolute -right-1.5 -top-1.5 text-[11px]">😟</span>}
          </span>
          <span className="flex min-w-[2.6rem] flex-col justify-center leading-none sm:min-w-[3.3rem]">
            <span className="flex items-baseline gap-0.5 whitespace-nowrap">
              <Odometer
                value={amount}
                className={cx("font-mono text-[13px] font-bold", hungry ? "text-danger-light" : over ? "text-gaslight" : "text-parchment")}
              />
              {/* phones: the bar under the number already shows how full the store is */}
              {finite && <span className="hidden font-mono text-[10px] tabular text-parchment-dim sm:inline">/{fmt(cap)}</span>}
            </span>
            {finite && !isSteam && (
              <span className={cx("mt-[3px] block h-[3px] overflow-hidden rounded-full bg-black/50", full && !over && "hud-blink2")}>
                <span
                  className="block h-full rounded-full transition-[width] duration-200"
                  style={{
                    width: `${Math.min(1, amount / cap) * 100}%`,
                    background: over ? "linear-gradient(90deg,#f2b84b,#fff1c9,#f2b84b)" : full ? "var(--danger-light)" : def.color,
                  }}
                />
              </span>
            )}
            {showRate && (
              <span className={cx("mt-[2px] whitespace-nowrap font-mono text-[10px] tabular", rate < 0 ? "text-danger-light" : "text-good/90")}>
                {fmtRate(rate)}
              </span>
            )}
          </span>
          {/* the stamp sits beside the numbers (never on top of them); phones get a 14-px corner badge instead */}
          {over ? (
            <>
              <Stamp color="var(--gaslight)" className="hud-pop shrink-0 bg-soot/50 px-0.5 text-[8px] shadow-[0_0_6px_rgba(242,184,75,.5)] max-sm:hidden">
                Перегруз
              </Stamp>
              <CornerBadge over />
              <Sparkles />
            </>
          ) : (
            full && (
              <>
                <Stamp className="hud-pop shrink-0 bg-soot/50 px-0.5 text-[8px] max-sm:hidden">Полно</Stamp>
                <CornerBadge over={false} />
              </>
            )
          )}
        </span>
      </FloatTip>
    </div>
  );
});

/** Phones (< 640 px): «ПЕРЕГРУЗ» / «ПОЛНО» shrink to a 14-px badge on the pill's corner (the tooltip explains). */
function CornerBadge({ over }: { over: boolean }) {
  return (
    <span
      role="img"
      aria-label={over ? "Перегруз" : "Полно"}
      className={cx(
        "hud-pop absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full border text-[9px] font-bold leading-none sm:hidden",
        over
          ? "border-[#7d5f2c] bg-gaslight text-soot shadow-[0_0_6px_rgba(242,184,75,.7)]"
          : "border-[#5a1c17] bg-danger text-parchment shadow-[0_0_4px_rgba(196,69,58,.6)]",
      )}
    >
      {over ? "✦" : "!"}
    </span>
  );
}

/** Three twinkling ✦ around an overloaded pill. */
function Sparkles() {
  const spots = [
    { l: "8%", t: "-8%", d: "0s" },
    { l: "55%", t: "70%", d: "-.5s" },
    { l: "88%", t: "30%", d: "-.95s" },
  ];
  return (
    <>
      {spots.map((p, i) => (
        <span
          key={i}
          aria-hidden
          className="hud-twinkle pointer-events-none absolute text-[9px] leading-none text-[#fff1c9] drop-shadow-[0_0_3px_rgba(242,184,75,.9)]"
          style={{ left: p.l, top: p.t, animationDelay: p.d }}
        >
          ✦
        </span>
      ))}
    </>
  );
}

/** Steam gets a tiny pressure dial instead of an icon + bar. */
function SteamGaugeIcon({ frac }: { frac: number }) {
  const f = Math.max(0, Math.min(1, frac));
  const a = Math.PI * (1 - f); // 180° (empty) → 0° (full)
  const nx = Math.cos(a) * 7.5;
  const ny = -Math.sin(a) * 7.5;
  const arc = (from: number, to: number) => {
    const p = (t: number) => `${(Math.cos(Math.PI * (1 - t)) * 9).toFixed(2)} ${(-Math.sin(Math.PI * (1 - t)) * 9).toFixed(2)}`;
    return `M${p(from)} A9 9 0 0 1 ${p(to)}`;
  };
  return (
    <svg viewBox="-11 -11 22 14" className="h-[18px] w-[26px]" aria-label="Пар">
      <path d="M-10.5 0 A10.5 10.5 0 0 1 10.5 0Z" fill="#1b1613" stroke="#7d5f2c" strokeWidth="1" />
      <path d={arc(0, 0.6)} stroke="#4f9d8a" strokeWidth="2" fill="none" />
      <path d={arc(0.6, 0.85)} stroke="#f2b84b" strokeWidth="2" fill="none" />
      <path d={arc(0.85, 1)} stroke="#c4453a" strokeWidth="2" fill="none" />
      <line x1="0" y1="0" x2={nx.toFixed(2)} y2={ny.toFixed(2)} stroke="#eadcc0" strokeWidth="1.3" strokeLinecap="round" style={{ transition: "all .3s" }} />
      <circle r="1.6" fill="#c9a25a" />
    </svg>
  );
}
