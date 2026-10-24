"use client";

/**
 * «Базарный день»: Барыга Бенедикт's stall, docked inside the colony window (the shell mounts it in the colony
 * <section>, position: relative): bottom-left, never over the grate centre and never over the side panel.
 * Three trades with a +30% markup in the player's favour, a 60 s countdown, done deals stamped «ПРОДАНО».
 * Collapsible; starts collapsed on phones so it does not cover the bottom sheet. Expanded it takes
 * min(320 px, 62%) of the colony's width.
 * While a close-up runs (the engine pauses the stall's clock meanwhile) it folds into `MarketChip` at the top right
 * of the scene header and opens on demand from the top-right corner.
 * Mounted outside the colony section (an older shell) it falls back to the v1 fixed placement.
 * Subscribes to primitives only (deal keys, affordability bits, whole seconds) — not to the 10 Hz game object.
 */
import { memo, useCallback, useEffect, useId, useMemo, useState, useSyncExternalStore } from "react";
import { Badge, BrassButton, cx, ResIcon, Ring, Rivets, Stamp } from "@/components/ui/kit";
import { RESOURCES } from "@/game/data/resources";
import { EVENT_TIMING } from "@/game/data/events";
import { useGame, type GameStore } from "@/game/store";
import type { MarketDeal, ResId } from "@/game/types";
import { fmt, fmtTime, plural } from "@/lib/format";
import { HazardStyles } from "./HazardKit";

export default function MarketPopup() {
  // keyed on the opening's stable id: `until` moves while a scene pauses the market
  const id = useGame((s) => (s.game.market ? s.game.market.id : -1));
  if (id < 0) return null;
  return <Stall key={id} />;
}

/* A peek at the stall during a scene, shared by the header chip and the stall: the scene seq it was opened in. */
let peekSeq = 0;
const peekSubs = new Set<() => void>();
function setPeekSeq(v: number): void {
  peekSeq = v;
  for (const f of peekSubs) f();
}
function subscribePeek(f: () => void): () => void {
  peekSubs.add(f);
  return () => {
    peekSubs.delete(f);
  };
}
function usePeekSeq(): number {
  return useSyncExternalStore(
    subscribePeek,
    () => peekSeq,
    () => 0,
  );
}

const leftOf = (s: GameStore) => Math.max(0, Math.ceil((s.game.market?.until ?? 0) - s.game.time));
const dealsWord = (n: number) => `${n} ${plural(n, "сделка", "сделки", "сделок")}`;

/** The stall folded into the scene header while a close-up runs: basket, open deals, paused clock; tap to peek. */
export function MarketChip() {
  const on = useGame((s) => !!s.game.market);
  const left = useGame(leftOf);
  const open3 = useGame((s) => (s.game.market?.deals ?? []).filter((d) => !d.done).length);
  const ready = useGame((s) => (s.game.market?.deals ?? []).filter((d) => !d.done && s.game.res[d.give] + 1e-9 >= d.giveAmt).length);
  const sceneSeq = useGame((s) => s.game.scene?.seq ?? 0);
  const reduced = useGame((s) => s.game.settings.reducedMotion);
  const peek = usePeekSeq();
  if (!on || !sceneSeq) return null;
  const expanded = peek === sceneSeq;
  return (
    <>
      <HazardStyles />
      <button
        type="button"
        onClick={() => setPeekSeq(expanded ? 0 : sceneSeq)}
        className={cx("flex h-8 items-center gap-1 rounded-full border bg-black/30 py-0.5 pl-0.5 pr-2 hover:brightness-110", expanded ? "border-brass" : "border-brass-dark")}
        aria-expanded={expanded}
        aria-label={`Лавка Бенедикта: ${dealsWord(open3)}, ждёт конца события (${fmtTime(left)})`}
        title="Лавка Бенедикта ждёт, пока вы заняты"
      >
        <span className="relative flex h-7 w-7 items-center justify-center rounded-full border border-brass-dark bg-[#5a1c17] text-sm">
          🧺
          {ready > 0 && (
            <span
              className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-gaslight px-1 font-mono text-[10px] font-bold text-soot"
              style={reduced ? undefined : { animation: "rh-pulse-dot 1.2s ease-out infinite" }}
            >
              {ready}
            </span>
          )}
        </span>
        <span className="font-mono text-[10px] text-parchment-dim tabular">⏸ {fmtTime(left)}</span>
      </button>
    </>
  );
}

function dealsKeyOf(deals: MarketDeal[] | undefined): string {
  if (!deals) return "";
  return deals.map((d) => `${d.give}|${d.giveAmt}|${d.get}|${d.getAmt}|${d.done ? 1 : 0}`).join(";");
}

function parseDeals(key: string): MarketDeal[] {
  if (!key) return [];
  return key.split(";").map((row) => {
    const [give, giveAmt, get, getAmt, done] = row.split("|");
    return { give: give as ResId, giveAmt: Number(giveAmt), get: get as ResId, getAmt: Number(getAmt), done: done === "1" };
  });
}

function Stall() {
  const left = useGame(leftOf);
  const dealsKey = useGame((s) => dealsKeyOf(s.game.market?.deals));
  const affordKey = useGame((s) => (s.game.market?.deals ?? []).map((d) => (s.game.res[d.give] + 1e-9 >= d.giveAmt ? "1" : "0")).join(""));
  const reduced = useGame((s) => s.game.settings.reducedMotion);
  const deals = useMemo(() => parseDeals(dealsKey), [dealsKey]);
  const [open, setOpen] = useState(() => typeof window === "undefined" || window.matchMedia("(min-width: 768px)").matches);
  // a running close-up owns the colony window (the whole screen on phones): the stall folds into MarketChip in the
  // scene header, and a peek opens it over the scene — above the full-screen scene on phones, at the colony's
  // right edge (clear of the side panel) on md+
  const sceneSeq = useGame((s) => s.game.scene?.seq ?? 0);
  const sceneOn = sceneSeq !== 0;
  const peek = usePeekSeq();
  const expanded = sceneOn ? peek === sceneSeq : open;
  const setExpanded = (v: boolean) => (sceneOn ? setPeekSeq(v ? sceneSeq : 0) : setOpen(v));
  // SH-4: Esc folds the stall into its chip
  useEffect(() => {
    const fold = () => {
      setOpen(false);
      setPeekSeq(0);
    };
    window.addEventListener("rr-escape", fold);
    return () => window.removeEventListener("rr-escape", fold);
  }, []);

  const life = EVENT_TIMING.marketLife;
  const open3 = deals.filter((d) => !d.done).length;
  const ready = deals.filter((d, i) => !d.done && affordKey[i] === "1").length;
  const urgent = left <= 10 && !sceneOn; // the clock stands still during a scene
  // docked = mounted inside the colony <section>; otherwise (older shell) keep the v1 fixed placement
  const [docked, setDocked] = useState(true);
  const dockRef = useCallback((el: HTMLDivElement | null) => {
    if (el) setDocked(!!el.parentElement?.closest("section"));
  }, []);

  if (sceneOn && !expanded) return null;
  return (
    <div
      ref={dockRef}
      role="region"
      className={cx(
        docked
          ? cx(
              "absolute flex flex-col",
              sceneOn ? "right-2 top-11 z-50 max-h-[calc(100%_-_52px)] md:top-12 md:z-30 md:max-h-[calc(100%_-_56px)]" : "bottom-2 left-2 z-30 max-h-[calc(100%_-_16px)]",
              expanded && "w-[min(320px,62%)]",
            )
          : cx(
              "fixed bottom-[calc(env(safe-area-inset-bottom)_+_3rem)] md:bottom-14",
              sceneOn ? "right-2 z-50 md:right-[412px] md:z-30 xl:right-[472px]" : "left-2 z-30 md:left-4",
              expanded && "w-[min(320px,calc(100vw_-_16px))]",
            ),
      )}
      style={reduced ? undefined : { animation: "rh-slide-in .35s ease-out both" }}
      aria-label="Лавка Барыги Бенедикта"
    >
      <HazardStyles />
      {expanded ? (
        <div className="relative min-h-0 w-full overflow-y-auto overflow-x-hidden rounded-lg border border-brass-dark bg-gradient-to-b from-panel-2 to-panel shadow-[0_10px_30px_rgba(0,0,0,.6),inset_0_1px_0_rgba(232,201,131,.08)]">
          <Awning />
          <Rivets />
          <header className="flex items-center gap-2 px-2.5 pb-1 pt-1.5">
            <Benedict className="h-12 w-12 shrink-0" />
            <div className="min-w-0 flex-1">
              <h3 className="truncate font-display text-base font-bold leading-tight text-brass-light">Барыга Бенедикт</h3>
              <p className="text-[11px] italic leading-tight text-parchment-dim">«Знаю, чего вам не хватает. Наценка — в вашу пользу!»</p>
            </div>
            <span className={cx("shrink-0", urgent && !reduced && "animate-pulse")} title="Лавка закроется через…">
              <Ring value={left / life} size={40} stroke={3} color={urgent ? "var(--danger-light)" : "var(--brass)"}>
                <span className={cx("font-mono text-[10px] font-bold tabular", urgent ? "text-danger-light" : "text-parchment")}>{fmtTime(left)}</span>
              </Ring>
            </span>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-line bg-black/20 text-brass-light hover:bg-panel-3"
              aria-expanded="true"
              aria-label="Свернуть лавку"
              title="Свернуть"
            >
              ▾
            </button>
          </header>
          <ul className="space-y-1.5 px-2.5 pb-2.5">
            {deals.map((d, i) => (
              <DealRow key={i} i={i} deal={d} afford={affordKey[i] === "1"} reduced={reduced} />
            ))}
          </ul>
          {open3 === 0 && <p className="px-3 pb-2 text-center text-[11px] italic text-parchment-dim">«Всё распродано! Приятно иметь с вами дело.»</p>}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex min-h-11 items-center gap-2 rounded-full border border-brass-dark bg-gradient-to-b from-panel-2 to-panel py-1 pl-1 pr-3 shadow-[0_8px_22px_rgba(0,0,0,.6)] hover:brightness-110"
          aria-expanded="false"
          aria-label={`Лавка Бенедикта: ${dealsWord(open3)}, закроется через ${fmtTime(left)}`}
        >
          <span className="relative flex h-9 w-9 items-center justify-center rounded-full border border-brass-dark bg-[#5a1c17] text-lg">
            🧺
            {ready > 0 && (
              <span
                className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-gaslight px-1 font-mono text-[10px] font-bold text-soot"
                style={reduced ? undefined : { animation: "rh-pulse-dot 1.2s ease-out infinite" }}
              >
                {ready}
              </span>
            )}
          </span>
          <span className="flex flex-col items-start leading-tight">
            <span className="font-display text-sm font-bold text-brass-light">Бенедикт</span>
            <span className={cx("font-mono text-[10px] tabular", urgent ? "text-danger-light" : "text-parchment-dim")}>{fmtTime(left)}</span>
          </span>
        </button>
      )}
    </div>
  );
}

function DealRow({ i, deal, afford, reduced }: { i: number; deal: MarketDeal; afford: boolean; reduced: boolean }) {
  const short = !deal.done && !afford;
  return (
    <li className={cx("relative flex items-center gap-1.5 rounded-md border px-2 py-1", deal.done ? "border-line/40 bg-black/30" : "border-line/80 bg-black/20")}>
      <div className={cx("flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-0.5", deal.done && "opacity-45")}>
        <span className={cx("inline-flex items-center gap-0.5 font-mono text-sm font-bold tabular", short ? "text-danger-light" : "text-parchment")} title={`Отдаёте: ${RESOURCES[deal.give].name}`}>
          <ResIcon res={deal.give} />
          {fmt(deal.giveAmt)}
        </span>
        <span className="text-brass" aria-hidden>
          →
        </span>
        <span className="inline-flex items-center gap-0.5 font-mono text-sm font-bold text-good tabular" title={`Получаете: ${RESOURCES[deal.get].name}`}>
          <ResIcon res={deal.get} />
          {fmt(deal.getAmt)}
        </span>
        <Badge tone="good">+30%</Badge>
      </div>
      <BrassButton
        size="sm"
        className="min-h-10 min-w-[76px] shrink-0"
        disabled={deal.done || !afford}
        onClick={() => useGame.getState().marketDeal(i)}
        title={deal.done ? "Уже продано" : afford ? `Отдать ${fmt(deal.giveAmt)} ${RESOURCES[deal.give].icon} за ${fmt(deal.getAmt)} ${RESOURCES[deal.get].icon}` : `Не хватает ${RESOURCES[deal.give].icon}`}
      >
        Сделка
      </BrassButton>
      {deal.done && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center" style={reduced ? undefined : { animation: "rh-stamp .4s ease-out both" }}>
          <Stamp className="bg-soot/70 px-2 text-sm">Продано</Stamp>
        </span>
      )}
    </li>
  );
}

/** Striped market awning with a scalloped edge. */
const Awning = memo(function Awning() {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  return (
    <svg viewBox="0 0 340 22" preserveAspectRatio="none" className="block h-5 w-full" aria-hidden>
      <defs>
        <pattern id={`${uid}s`} width="34" height="22" patternUnits="userSpaceOnUse">
          <rect width="17" height="22" fill="#a8322a" />
          <rect x="17" width="17" height="22" fill="#eadcc0" />
        </pattern>
        <clipPath id={`${uid}c`}>
          <path d={`M0 0 H340 V12 ${Array.from({ length: 20 }, (_, k) => `Q${340 - k * 17 - 8.5} 24 ${340 - (k + 1) * 17} 12`).join(" ")} Z`} />
        </clipPath>
      </defs>
      <rect width="340" height="22" fill={`url(#${uid}s)`} clipPath={`url(#${uid}c)`} />
      <rect width="340" height="3" fill="#7d5f2c" />
      <rect y="3" width="340" height="4" fill="#000" opacity=".18" />
    </svg>
  );
});

/** Benedict: a grey rat merchant in a top hat with a monocle. */
const Benedict = memo(function Benedict({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} role="img" aria-label="Барыга Бенедикт">
      <circle cx="32" cy="34" r="29" fill="#3a2c20" stroke="#7d5f2c" strokeWidth="2" />
      {/* ears */}
      <circle cx="18" cy="30" r="8" fill="#8d8378" />
      <circle cx="18" cy="30" r="5" fill="#d79aa4" />
      <circle cx="44" cy="28" r="8" fill="#8d8378" />
      <circle cx="44" cy="28" r="5" fill="#d79aa4" />
      {/* head & snout */}
      <ellipse cx="31" cy="40" rx="13" ry="12" fill="#9a8f84" />
      <path d="M22 44 Q31 60 40 44 Z" fill="#a89d92" />
      <circle cx="31" cy="53" r="2.4" fill="#d79aa4" />
      <path d="M24 50 L10 48 M24 52 L11 55 M38 50 L52 48 M38 52 L51 55" stroke="#eadcc0" strokeWidth=".8" opacity=".8" />
      {/* eyes & monocle */}
      <circle cx="26" cy="39" r="1.8" fill="#14110f" />
      <circle cx="37" cy="39" r="1.8" fill="#14110f" />
      <circle cx="37" cy="39" r="4.6" fill="rgba(200,220,230,.2)" stroke="#e8c983" strokeWidth="1.2" />
      <path d="M41 42 Q46 50 44 58" stroke="#e8c983" strokeWidth=".7" fill="none" />
      {/* top hat */}
      <rect x="20" y="8" width="22" height="18" rx="1.5" fill="#14110f" />
      <rect x="20" y="20" width="22" height="3.5" fill="#a8322a" />
      <rect x="14" y="25" width="34" height="3.5" rx="1.5" fill="#14110f" />
      <path d="M22 10 L24 24" stroke="#fff" strokeOpacity=".12" strokeWidth="2" />
    </svg>
  );
});
