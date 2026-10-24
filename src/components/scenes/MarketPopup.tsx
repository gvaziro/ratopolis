"use client";

/**
 * «Базарный день»: Барыга Бенедикт's floating stall (bottom-left, over the colony, never over the grate centre).
 * Three trades with a +30% markup in the player's favour, a 60 s countdown, done deals stamped «ПРОДАНО».
 * Collapsible; starts collapsed on phones so it does not cover the bottom sheet.
 * Subscribes to primitives only (deal keys, affordability bits, whole seconds) — not to the 10 Hz game object.
 */
import { memo, useId, useMemo, useState } from "react";
import { Badge, BrassButton, cx, ResIcon, Ring, Rivets, Stamp } from "@/components/ui/kit";
import { RESOURCES } from "@/game/data/resources";
import { EVENT_TIMING } from "@/game/data/events";
import { useGame } from "@/game/store";
import type { MarketDeal, ResId } from "@/game/types";
import { fmt, fmtTime } from "@/lib/format";
import { HazardStyles } from "./HazardKit";

export default function MarketPopup() {
  const until = useGame((s) => s.game.market?.until ?? 0);
  if (!until) return null;
  return <Stall key={until} until={until} />;
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

function Stall({ until }: { until: number }) {
  const left = useGame((s) => Math.max(0, Math.ceil(until - s.game.time)));
  const dealsKey = useGame((s) => dealsKeyOf(s.game.market?.deals));
  const affordKey = useGame((s) => (s.game.market?.deals ?? []).map((d) => (s.game.res[d.give] + 1e-9 >= d.giveAmt ? "1" : "0")).join(""));
  const reduced = useGame((s) => s.game.settings.reducedMotion);
  const deals = useMemo(() => parseDeals(dealsKey), [dealsKey]);
  const [open, setOpen] = useState(() => typeof window === "undefined" || window.matchMedia("(min-width: 768px)").matches);
  // a running close-up owns the colony window: tuck the stall away to the right as a pill meanwhile
  const sceneSeq = useGame((s) => s.game.scene?.seq ?? 0);
  const sceneOn = sceneSeq !== 0;
  const [peekSeq, setPeekSeq] = useState(0);
  const expanded = sceneOn ? peekSeq === sceneSeq : open;
  const setExpanded = (v: boolean) => (sceneOn ? setPeekSeq(v ? sceneSeq : 0) : setOpen(v));

  const life = EVENT_TIMING.marketLife;
  const open3 = deals.filter((d) => !d.done).length;
  const ready = deals.filter((d, i) => !d.done && affordKey[i] === "1").length;
  const urgent = left <= 10;

  return (
    <aside
      className={cx("fixed bottom-[calc(env(safe-area-inset-bottom)_+_3rem)] z-30 md:bottom-14", sceneOn ? "right-2 md:right-4" : "left-2 md:left-4")}
      style={reduced ? undefined : { animation: "rh-slide-in .35s ease-out both" }}
      aria-label="Лавка Барыги Бенедикта"
    >
      <HazardStyles />
      {expanded ? (
        <div className="relative w-[min(340px,calc(100vw_-_16px))] overflow-hidden rounded-lg border border-brass-dark bg-gradient-to-b from-panel-2 to-panel shadow-[0_10px_30px_rgba(0,0,0,.6),inset_0_1px_0_rgba(232,201,131,.08)]">
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
          aria-label={`Лавка Бенедикта: ${open3} сделок, закроется через ${fmtTime(left)}`}
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
    </aside>
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
