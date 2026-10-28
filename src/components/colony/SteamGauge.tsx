"use client";

/**
 * Brass steam manometer (top-right of the colony). The needle follows steam / buffer with a spring;
 * when the press and the clock tower are starved (steamEff < 0.5) the red zone shakes and «Нет пара!» blinks.
 * Hover or tap opens the breakdown: stock, who makes steam, who burns it, the machines' efficiency and the fix.
 * On phones (layoutMode: narrow or held sideways) the dial shrinks to 44 px and the label shows only while starving.
 */
import { cancelDecoFrame, decoFrame } from "@/lib/eco";
import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { cx } from "@/components/ui/kit";
import { BUILDINGS } from "@/game/data/buildings";
import { JOBS } from "@/game/data/jobs";
import { steamBudget } from "@/game/engine/economy";
import { steamBreakdown } from "@/game/engine/hints";
import { derivedOf, useGame, type TabId } from "@/game/store";
import { useSampled } from "@/game/useSampled";
import { fmt, fmtInt, plural } from "@/lib/format";
import { usePhoneLayout } from "@/lib/layoutMode";
import { onCamera } from "./camera";
import { colonyPaused } from "./registry";

const A0 = -125;
const A1 = 125;

function arc(r: number, a0: number, a1: number): string {
  const p = (a: number) => {
    const t = ((a - 90) * Math.PI) / 180;
    return `${(Math.cos(t) * r).toFixed(2)} ${(Math.sin(t) * r).toFixed(2)}`;
  };
  return `M${p(a0)}A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${p(a1)}`;
}

const FIX: Record<"boiler" | "miners" | "stokers", { text: string; tab: TabId; target: string }> = {
  boiler: { text: `стройте «${BUILDINGS.boiler.name}»`, tab: "buildings", target: "b_boiler" },
  miners: { text: "нужны угольщики — кочегарам нечего кидать в топку", tab: "jobs", target: "j_coal_miner" },
  stokers: { text: "+ кочегаров — у котла есть свободные места", tab: "jobs", target: "j_stoker" },
};

interface Budget {
  supply: number;
  press: number;
  clock: number;
  conv: number;
}

const SPLIT: { key: "press" | "clock" | "conv"; icon: string; label: string; color: string }[] = [
  { key: "press", icon: BUILDINGS.steam_press.icon, label: "пресс", color: "#c4453a" },
  { key: "clock", icon: BUILDINGS.clocktower.icon, label: "часы", color: "#d4af37" },
  { key: "conv", icon: `${JOBS.smelter.icon}${JOBS.smith.icon}`, label: "плавильни и кузни", color: "#e09a63" },
];

/**
 * COL-2: where the steam goes at full speed (engine steamBudget): the demand of the press, the clocks and the
 * smelters / smiths as one stacked bar against what the stokers could give (the tick on the bar).
 */
function BudgetSplit({ b, priority }: { b: Budget; priority: string }) {
  const demand = b.press + b.clock + b.conv;
  if (!(demand > 0)) return null;
  const supply = Number.isFinite(b.supply) ? Math.max(0, b.supply) : 0;
  const top = Math.max(demand, supply, 1e-9);
  const short = demand - supply;
  return (
    <div className="mt-1.5 border-t border-line/60 pt-1">
      <p className="text-[11px] text-parchment-dim">
        На полном ходу нужно <span className="font-mono text-danger-light tabular">{fmt(demand)}/с</span>, кочегары дадут{" "}
        <span className="font-mono text-good tabular">{fmt(supply)}/с</span>
      </p>
      <div className="relative mt-0.5 h-2 w-full overflow-hidden rounded bg-soot" aria-hidden>
        <div className="flex h-full" style={{ width: `${(demand / top) * 100}%` }}>
          {SPLIT.map((p) => (b[p.key] > 0 ? <div key={p.key} style={{ width: `${(b[p.key] / demand) * 100}%`, background: p.color }} /> : null))}
        </div>
        <div className="absolute inset-y-0 w-0.5 bg-[#8fbf5a]" style={{ left: `calc(${Math.min(100, (supply / top) * 100)}% - 1px)` }} />
      </div>
      <ul className="mt-0.5 flex flex-wrap gap-x-2 text-[10px] text-parchment-dim">
        {SPLIT.map((p) =>
          b[p.key] > 0 ? (
            <li key={p.key} className="flex items-center gap-0.5">
              <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: p.color }} />
              {p.icon} {p.label} <span className="font-mono tabular">{fmt(b[p.key])}</span>
            </li>
          ) : null,
        )}
      </ul>
      <p className={cx("mt-0.5 text-[10px]", short > 1e-9 ? "text-danger-light" : "text-good")}>
        {short > 1e-9
          ? `Не хватает ${fmt(short)}/с — первыми пар получают ${priority === "power" ? "пресс и часы" : "плавильни и кузни"}`
          : "Кочегары справятся со всеми разом"}
      </p>
    </div>
  );
}

/** The breakdown, mounted only while the tip is open (sampled twice a second). */
function SteamTip({ onDone }: { onDone: () => void }) {
  // a JSON key (Infinity → -1) so the tip re-renders only when a shown number changes
  const key = useSampled(
    (s) => {
      const d = derivedOf(s.game);
      const x = steamBreakdown(s.game, d);
      const bud = steamBudget(s.game, d);
      return JSON.stringify({
        ...x,
        slots: Number.isFinite(x.slots) ? x.slots : -1,
        buffer: Number.isFinite(x.buffer) ? x.buffer : -1,
        budget: { supply: bud.supply, press: bud.press, clock: bud.clock, conv: bud.conv },
        priority: s.game.steamPriority,
      });
    },
    2,
    Object.is,
  );
  const b = JSON.parse(key) as ReturnType<typeof steamBreakdown> & { budget: Budget; priority: string };
  const slots = b.slots < 0 ? "∞" : fmtInt(b.slots);
  const fix = b.fix ? FIX[b.fix] : null;
  const starving = b.steamEff < 0.5 && b.consumers.length > 0;
  const ref = useRef<HTMLDivElement>(null);

  // the tip opens under the dial and ends at the colony's bottom edge (the breakdown scrolls, «Что делать» stays in
  // view); on a short colony (landscape phones) there is no room under the dial, so it opens beside it instead
  useLayoutEffect(() => {
    const el = ref.current;
    const gauge = el?.offsetParent;
    if (!el || !(gauge instanceof HTMLElement)) return;
    let ch = 0;
    return onCamera((v) => {
      if (v.ch <= 1 || v.ch === ch) return;
      ch = v.ch;
      const below = ch - (gauge.offsetTop + gauge.offsetHeight + 4) - 8;
      const side = below < 150;
      el.style.top = side ? "0px" : "";
      el.style.right = side ? "calc(100% + 6px)" : "";
      el.style.marginTop = side ? "0px" : "";
      el.style.maxHeight = `${Math.max(64, Math.floor(side ? ch - gauge.offsetTop - 8 : below))}px`;
    });
  }, []);

  return (
    <div
      ref={ref}
      role="tooltip"
      className="absolute right-0 top-full z-30 mt-1 flex w-64 max-w-[calc(100vw-24px)] flex-col rounded-md border border-brass-dark bg-soot-2/95 px-2.5 py-2 text-left text-xs text-parchment shadow-[0_6px_18px_rgba(0,0,0,.6)]"
    >
      <div data-wheel-scroll="" className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="flex items-baseline justify-between font-display text-sm font-bold text-brass-light">
          <span>Пар</span>
          <span className="font-mono text-[11px] text-steam tabular">
            {fmt(b.stock)} / {b.buffer < 0 ? "∞" : fmt(b.buffer)}
          </span>
        </div>
        <p className="mt-1">
          <span className="font-mono text-good tabular">+{fmt(b.gross)}/с</span> от кочегаров{" "}
          <span className="text-parchment-dim">
            ({fmtInt(b.stokers)}/{slots} {plural(b.slots < 0 ? 5 : b.slots, "места", "мест", "мест")}, КПД {Math.round(b.convEff * 100)}%)
          </span>
        </p>
        {b.consumers.length > 0 ? (
          <ul className="mt-1 space-y-0.5">
            {b.consumers.map((c) => (
              <li key={c.id} className="flex items-center gap-1.5">
                <span>{c.icon}</span>
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <span className="font-mono text-danger-light tabular">−{fmt(c.perSec)}/с</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-parchment-dim">Пар пока никто не расходует.</p>
        )}
        <p className={cx("mt-1", starving ? "font-bold text-danger-light" : "text-parchment-dim")}>Эффективность пресса и часов: {Math.round(b.steamEff * 100)}%</p>
        <BudgetSplit b={b.budget} priority={b.priority} />
      </div>
      {fix && (
        <button
          type="button"
          data-nodrag=""
          onClick={() => {
            onDone();
            useGame.getState().focus(fix.tab, fix.target);
          }}
          className="mt-1.5 flex min-h-10 w-full shrink-0 items-center gap-1 rounded border border-gaslight/60 bg-panel/80 px-2 text-left font-bold text-gaslight hover:bg-panel-2"
        >
          <span aria-hidden>🔧</span>
          <span className="min-w-0 flex-1">Что делать: {fix.text}</span>
          <span aria-hidden>→</span>
        </button>
      )}
    </div>
  );
}

export const SteamGauge = memo(function SteamGauge() {
  const revealed = useGame((s) => !!s.game.revealed.steam);
  const starving = useGame((s) => s.game.steamEff < 0.5 && derivedOf(s.game).steamNeed > 0);
  const label = useSampled((s) => `${fmt(s.game.res.steam)} / ${fmt(derivedOf(s.game).caps.steam)}`, 3, Object.is);
  const rm = useGame((s) => s.game.settings.reducedMotion);
  // phones, portrait or held sideways (a 260 px tall colony has no room for the big dial and its labels)
  const phone = usePhoneLayout();
  const needle = useRef<SVGGElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);

  useEffect(() => {
    if (!revealed) return;
    let raf = 0;
    let ang = A0;
    let vel = 0;
    let last = performance.now();
    let written = "";
    const aim = () => {
      const g = useGame.getState().game;
      const d = derivedOf(g);
      const cap = d.caps.steam;
      const f = cap > 0 ? Math.max(0, Math.min(1, g.res.steam / cap)) : 0;
      return { target: A0 + (A1 - A0) * f, starved: g.steamEff < 0.5 && d.steamNeed > 0 && !g.settings.reducedMotion };
    };
    // the spring runs only while the needle moves (or shakes): a settled needle costs no frames
    const frame = (now: number) => {
      raf = 0;
      if (colonyPaused()) return; // the store subscription wakes it again
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const { target, starved } = aim();
      // damped spring
      vel += ((target - ang) * 60 - vel * 9) * dt;
      ang += vel * dt;
      const settled = !starved && Math.abs(target - ang) < 0.05 && Math.abs(vel) < 0.05;
      if (settled) {
        ang = target;
        vel = 0;
      }
      const jitter = starved ? Math.sin(now / 23) * 2.5 : 0;
      const tr = `rotate(${(ang + jitter).toFixed(1)})`;
      if (tr !== written) {
        written = tr;
        needle.current?.setAttribute("transform", tr);
      }
      if (!settled) raf = decoFrame(frame);
    };
    // (a quarter of a degree is below what the dial can show: tiny tick-to-tick wobbles of the stock don't wake it)
    const wake = () => {
      if (raf || colonyPaused()) return;
      const { target, starved } = aim();
      if (!starved && Math.abs(target - ang) < 0.25) return;
      last = performance.now();
      raf = decoFrame(frame);
    };
    raf = decoFrame(frame);
    const unsub = useGame.subscribe(wake);
    return () => {
      unsub();
      cancelDecoFrame(raf);
    };
  }, [revealed]);

  // a tap elsewhere closes the pinned tip
  useEffect(() => {
    if (!pinned) return;
    const off = (e: PointerEvent) => {
      if (rootRef.current && e.target instanceof Node && rootRef.current.contains(e.target)) return;
      setPinned(false);
    };
    window.addEventListener("pointerdown", off, true);
    return () => window.removeEventListener("pointerdown", off, true);
  }, [pinned]);

  if (!revealed) return null;
  return (
    <div
      ref={rootRef}
      data-nodrag=""
      // ZonePips measures this box to keep its rail clear of the dial and its labels
      data-gauge=""
      className={cx("pointer-events-auto absolute right-2 top-2 flex flex-col items-end", hover || pinned ? "z-30" : "z-20")}
      onPointerEnter={(e) => e.pointerType === "mouse" && setHover(true)}
      onPointerLeave={(e) => e.pointerType === "mouse" && setHover(false)}
    >
      <button
        type="button"
        data-nodrag=""
        onClick={() => setPinned((p) => !p)}
        aria-expanded={pinned}
        aria-label={`Давление пара ${label}${starving ? ", пара не хватает" : ""}. Подробнее`}
        className={cx("flex cursor-help items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-brass-light", phone ? "flex-row-reverse gap-1" : "flex-col")}
      >
        <span className={cx("relative block", starving && !rm && "cv-vibrate")}>
          <svg viewBox="-40 -40 80 80" className={cx("drop-shadow-[0_3px_6px_rgba(0,0,0,.55)]", phone ? "h-11 w-11" : "h-[72px] w-[72px]")}>
            <circle r="37" fill="url(#cv-gauge-rim)" stroke="#2a1a0c" strokeWidth="1.5" />
            <circle r="30" fill="#f1e6cc" stroke="#7d5f2c" strokeWidth="1.5" />
            <path d={arc(25, A0, A0 + 45)} stroke="#c4453a" strokeWidth="6" fill="none" className={starving ? "cv-blink" : undefined} />
            <path d={arc(25, A1 - 40, A1)} stroke="#8fbf5a" strokeWidth="4" fill="none" opacity=".8" />
            {Array.from({ length: 11 }, (_, i) => {
              const a = A0 + ((A1 - A0) * i) / 10;
              return <line key={i} x1="0" y1="-29" x2="0" y2={i % 5 === 0 ? -21 : -25} stroke="#2a1a0c" strokeWidth={i % 5 === 0 ? 1.6 : 0.9} transform={`rotate(${a})`} />;
            })}
            {/* mobile-8: too small to read on the 44 px phone dial */}
            {!phone && (
              <text y="13" fontSize="7" textAnchor="middle" fill="#5c4520" className="font-display" fontWeight="700">
                ПАР
              </text>
            )}
            <g ref={needle} transform={`rotate(${A0})`}>
              <path d="M-1.6 4L0 -27L1.6 4z" fill="#8b1e1e" />
            </g>
            <circle r="4" fill="url(#cv-gauge-rim)" stroke="#2a1a0c" strokeWidth=".8" />
            <defs>
              <radialGradient id="cv-gauge-rim" cx=".35" cy=".3">
                <stop offset="0" stopColor="#fff1b8" />
                <stop offset=".5" stopColor="#c9a25a" />
                <stop offset="1" stopColor="#6b4f22" />
              </radialGradient>
            </defs>
          </svg>
        </span>
        {/* phones: the labels sit left of the 44 px dial (only while starving); desktop: under the dial */}
        <span className={cx("flex flex-col", phone ? "items-end" : "items-center", phone && !starving && "hidden")}>
          <span className="mt-0.5 rounded bg-soot-2/80 px-1.5 font-mono text-[10px] text-steam tabular">{label}</span>
          {starving && <span className="cv-blink mt-0.5 rounded border border-danger bg-soot-2/90 px-1.5 font-display text-xs font-bold text-danger-light">Нет пара!</span>}
        </span>
      </button>
      {(hover || pinned) && (
        <SteamTip
          onDone={() => {
            setPinned(false);
            setHover(false);
          }}
        />
      )}
    </div>
  );
});
