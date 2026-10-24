"use client";

/**
 * Shared bits for the side-panel tabs: condition hints, 🔒 storage hints, a cost list with
 * richer tooltips, a portal tooltip that is not clipped by the scroll area, switches,
 * segmented controls, sticky toolbars, contribution rows and the panel keyframes.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { BUILDINGS } from "@/game/data/buildings";
import { JOBS } from "@/game/data/jobs";
import { EDICTS } from "@/game/data/meta";
import { RESOURCES } from "@/game/data/resources";
import { UPGRADES } from "@/game/data/upgrades";
import { ZONES } from "@/game/data/zones";
import { buildingVisible } from "@/game/engine/actions";
import { check, describeCond } from "@/game/engine/conditions";
import type { Derived } from "@/game/engine/derive";
import { canAfford, entries, lockedByCap, timeToAfford } from "@/game/engine/formulas";
import { resourceSources, storageHintFor } from "@/game/engine/hints";
import { emitUiFx } from "@/game/fx";
import { derivedOf, useGame } from "@/game/store";
import {
  BUILDING_IDS,
  type Amounts,
  type BuildingId,
  type Cond,
  type EdictId,
  type GameState,
  type JobId,
  type ResId,
  type TabId,
  type UpgradeId,
  type ZoneId,
} from "@/game/types";
import { useSampled } from "@/game/useSampled";
import { fmt, fmtInt, fmtRate, fmtTime, plural } from "@/lib/format";
import { Bar, BrassButton, ResIcon, cx } from "@/components/ui/kit";

/* ------------------------------------------------------------ names & conditions */

export function nameOf(kind: string, id: string): string {
  switch (kind) {
    case "building":
      return BUILDINGS[id as BuildingId]?.name ?? id;
    case "job":
      return JOBS[id as JobId]?.name ?? id;
    case "zone":
      return ZONES[id as ZoneId]?.name ?? id;
    case "res":
      return RESOURCES[id as ResId]?.icon ?? id;
    case "upgrade":
      return UPGRADES[id as UpgradeId]?.name ?? id;
    case "edict":
      return EDICTS[id as EdictId]?.name ?? id;
    default:
      return id;
  }
}

function condProgress(s: GameState, c: Cond): string | null {
  if ("rats" in c) return `сейчас ${fmtInt(s.rats)}`;
  if ("building" in c) return `сейчас ${s.buildings[c.building]}`;
  if ("job" in c) return `сейчас ${s.jobs[c.job]}`;
  if ("resEver" in c) return c.gte >= 1 ? `собрано ${fmt(s.resEver[c.resEver])}` : null;
  if ("stat" in c) return `сейчас ${fmt(s.stats[c.stat])}`;
  return null;
}

/** "Скоро" hint: only the unmet parts of the condition, with current progress. */
export function condHint(s: GameState, c: Cond): string {
  if ("all" in c) {
    const unmet = c.all.filter((x) => !check(s, x));
    return (unmet.length ? unmet : c.all).map((x) => condHint(s, x)).join(" и ");
  }
  if ("any" in c) return c.any.map((x) => condHint(s, x)).join(" или ");
  const base = describeCond(c, nameOf);
  const prog = condProgress(s, c);
  return prog ? `${base} (${prog})` : base;
}

/** Russian plural: plural(2, "крыса", "крысы", "крыс") → "крысы". */
export { plural } from "@/lib/format";

/* ------------------------------------------------------------ 🔒 storage hints */

/**
 * Which storage building (and which level) would lift the cap of `r` above `price`.
 * Flat adders: extra levels = (price − cap) / (amt × M), M = current multiplier on flat caps.
 * Multipliers: extra levels = log(price / cap) / log(mult).
 */
export function storageHint(s: GameState, d: Derived, r: ResId, price: number): string {
  const def = RESOURCES[r];
  const cap = d.caps[r];
  let flat = def.baseCap ?? 0;
  const adders: { id: BuildingId; amt: number }[] = [];
  const mults: { id: BuildingId; m: number }[] = [];
  for (const id of BUILDING_IDS) {
    for (const ef of BUILDINGS[id].effects) {
      if ((ef.t === "cap" && ef.res === r) || (ef.t === "steamCap" && r === "steam")) {
        flat += ef.amt * s.buildings[id];
        adders.push({ id, amt: ef.amt });
      } else if (ef.t === "capMult") {
        const applies = def.capGroup === "T1" || (ef.group === "T1G" && def.capGroup === "T2");
        if (applies) mults.push({ id, m: ef.mult });
      }
    }
  }
  const M = flat > 0 ? cap / flat : 1;
  const opts: string[] = [];
  // a store in an already open zone that has not appeared yet (the pantry before the first cap hit)
  let soon: BuildingId | null = null;
  for (const a of adders) {
    const L = s.buildings[a.id];
    const k = Math.max(1, Math.ceil((price - cap) / (a.amt * M)));
    if (L + k > (BUILDINGS[a.id].maxLevel ?? Infinity)) continue;
    if (buildingVisible(s, a.id)) opts.push(`«${BUILDINGS[a.id].name}» ур. ${L + k}`);
    else if (s.zones[BUILDINGS[a.id].zone]) soon ??= a.id;
  }
  for (const m of mults) {
    if (!buildingVisible(s, m.id)) {
      if (s.zones[BUILDINGS[m.id].zone]) soon ??= m.id;
      continue;
    }
    const k = Math.max(1, Math.ceil(Math.log(price / cap) / Math.log(m.m)));
    opts.push(`«${BUILDINGS[m.id].name}» ур. ${s.buildings[m.id] + k}`);
  }
  const head = `Цена ${fmt(price)} ${def.icon} выше лимита склада (${fmt(cap)}).`;
  const body = opts.length
    ? ` Нужен склад: ${opts.slice(0, 3).join(" или ")}.`
    : soon
      ? ` Склад «${BUILDINGS[soon].name}» откроется: ${condHint(s, BUILDINGS[soon].unlock)}.`
      : " Подходящий склад откроется в новой зоне.";
  return `${head}${body} Или добыча событий — ей лимит не писан.`;
}

/* ------------------------------------------------------------ «Где взять» */

/** «🎩 Карманники (0 из 13 крыс) · 👆 клик по решётке · 🐎 Экипаж» (PA-3). */
export function sourcesText(s: GameState, r: ResId): string {
  const list = resourceSources(s, r);
  if (!list.length) return "пока нигде — источник откроется позже";
  return list
    .map((x) =>
      x.kind === "job" ? `${x.icon} ${x.label} (${fmtInt(x.workers ?? 0)} из ${fmtInt(s.rats)} ${plural(s.rats, "крысы", "крыс", "крыс")})` : `${x.icon} ${x.label}`,
    )
    .join(" · ");
}

/** Tooltip body that reads the store while it is open (3 Hz), so the card models need not carry live numbers. */
function LiveText({ get }: { get: (s: GameState, d: Derived) => string }) {
  const text = useSampled((st) => get(st.game, derivedOf(st.game)), 3, Object.is);
  return <span className="whitespace-pre-line">{text}</span>;
}

/** «Не хватает N · +X/с · ≈ T» + «Где взять: …» for one red cost item (live while the tooltip is open). */
function shortText(s: GameState, d: Derived, r: ResId, v: number, lock: string | null): string {
  const icon = RESOURCES[r].icon;
  const lack = Math.max(0, v - s.res[r]);
  const rate = s.rates[r];
  const lines: string[] = [];
  if (lock) lines.push(lock);
  if (lack > 0) {
    const pace = rate > 1e-9 ? `${fmtRate(rate)} · ≈ ${fmtTime(Math.ceil(lack / rate))}` : "не добывается";
    lines.push(`Не хватает ${fmt(lack)} ${icon} · ${pace}`);
  } else lines.push(`${icon} хватает`);
  lines.push(`Где взять ${icon}: ${sourcesText(s, r)}`);
  return lines.join("\n");
}

/* ------------------------------------------------------------ costs */

export interface CostItem {
  r: ResId;
  v: number;
  ok: boolean;
  /** Tooltip when the price exceeds the cap and stock is short. */
  lock: string | null;
}

export function costItems(s: GameState, d: Derived, cost: Amounts): CostItem[] {
  const locked = new Set(lockedByCap(cost, d));
  return entries(cost).map(([r, v]) => {
    const ok = s.res[r] + 1e-9 >= v;
    return { r, v, ok, lock: !ok && locked.has(r) ? storageHint(s, d, r, v) : null };
  });
}

/**
 * Like kit's CostList (red/green/🔒). A red item explains itself on hover/tap: what is missing, the pace, the ETA,
 * where to get it, and (🔒) which storage building and level would hold the price.
 */
export function CostView({ items, className }: { items: CostItem[]; className?: string }) {
  return (
    <span className={cx("inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-xs tabular", className)}>
      {items.map((c) => {
        const body = (
          <>
            <ResIcon res={c.r} />
            {fmt(c.v)}
            {c.lock && <span aria-label="нужен склад">🔒</span>}
          </>
        );
        if (c.ok) {
          return (
            <span key={c.r} className="inline-flex items-center gap-0.5 whitespace-nowrap text-good">
              {body}
            </span>
          );
        }
        return (
          <HoverTip key={c.r} tip={<LiveText get={(s, d) => shortText(s, d, c.r, c.v, c.lock)} />}>
            <span className="inline-flex cursor-help items-center gap-0.5 whitespace-nowrap text-danger-light underline decoration-danger/40 decoration-dotted underline-offset-2">
              {body}
            </span>
          </HoverTip>
        );
      })}
    </span>
  );
}

/* ------------------------------------------------------------ "when can I buy it" */

/** Serializable "why not yet" of a price (part of the card models). */
export type WaitInfo =
  | { k: "eta"; text: string }
  /** Price above the cap: a store to build (target b_<id> / z_<zone>, or none when it is not unlocked yet). */
  | { k: "lock"; text: string; target?: string }
  /** A short resource nobody produces. */
  | { k: "none"; r: ResId };

/** ETA, 🔒 store or «не добывается» for a price that is not affordable yet (null when it is). */
export function waitInfo(s: GameState, d: Derived, cost: Amounts): WaitInfo | null {
  if (canAfford(s, cost)) return null;
  const locked = lockedByCap(cost, d).find((r) => s.res[r] < (cost[r] ?? 0));
  if (locked) {
    const h = storageHintFor(s, d, locked, cost[locked]);
    return { k: "lock", text: h.text, target: h.target };
  }
  const t = timeToAfford(s, cost);
  if (Number.isFinite(t)) return { k: "eta", text: `через ${fmtTime(Math.ceil(t))}` };
  const dry = entries(cost).find(([r, v]) => s.res[r] + 1e-9 < v && !(s.rates[r] > 0));
  return dry ? { k: "none", r: dry[0] } : { k: "eta", text: "не копится" };
}

const TARGET_TAB: Record<string, TabId> = { b: "buildings", j: "jobs", u: "upgrades", e: "migration", z: "map", x: "map" };

/** Tab that holds a data-target (b_ → buildings, z_ → map, …). */
export function tabOfTarget(target: string): TabId {
  return TARGET_TAB[target.split("_")[0]] ?? "buildings";
}

/** The "через 3м 12с" / «🔒 Кладовка ур. 3» (a button to that card) / «🪙 не добывается» (with «Где взять») chip. */
export function WaitView({ w }: { w: WaitInfo | null }) {
  if (!w) return null;
  const chip = "whitespace-nowrap font-mono text-[10px] tabular";
  if (w.k === "eta") return <span className={cx(chip, "text-parchment-dim")}>{w.text}</span>;
  if (w.k === "lock") {
    if (!w.target) {
      return (
        <HoverTip tip={`Цена выше лимита склада. Нужен склад: ${w.text}`}>
          <span className={cx(chip, "cursor-help whitespace-normal text-gaslight")}>🔒 {w.text}</span>
        </HoverTip>
      );
    }
    const target = w.target;
    return (
      <button
        type="button"
        onClick={() => useGame.getState().focus(tabOfTarget(target), target)}
        title="Цена выше лимита склада — показать, какой склад строить"
        className={cx(
          chip,
          "-my-1 inline-flex min-h-7 items-center gap-0.5 whitespace-normal rounded border border-gaslight/40 bg-gaslight/10 px-1.5 text-left text-gaslight transition hover:border-gaslight hover:bg-gaslight/20",
        )}
      >
        🔒 {w.text}
        <span aria-hidden>{" →"}</span>
      </button>
    );
  }
  const icon = RESOURCES[w.r].icon;
  return (
    <HoverTip tip={<LiveText get={(s) => `Где взять ${icon}:\n${sourcesText(s, w.r)}`} />}>
      <span className={cx(chip, "cursor-help text-danger-light underline decoration-dotted underline-offset-2")}>{icon} не добывается</span>
    </HoverTip>
  );
}

/* ------------------------------------------------------------ small tags */

/** A Badge-like tag with the extra gaslight / dim tones the panels need (kit's Badge has four tones). */
export function Tag({ children, tone = "gaslight", className }: { children: ReactNode; tone?: "gaslight" | "dim" | "verdigris"; className?: string }) {
  const t = {
    gaslight: "border-gaslight/50 bg-gaslight/15 text-gaslight",
    dim: "border-line bg-black/30 text-parchment-dim",
    verdigris: "border-verdigris/50 bg-verdigris/20 text-verdigris-light",
  }[tone];
  return (
    <span className={cx("inline-flex items-center whitespace-nowrap rounded border px-1.5 py-px text-[10px] font-bold uppercase leading-tight tracking-wider", t, className)}>
      {children}
    </span>
  );
}

/* ------------------------------------------------------------ tooltip */

/**
 * Tooltip rendered in a fixed-position portal, so the scroll area never clips it.
 * Mouse: hover. Touch/pen: tap toggles (auto-hides after 4 s).
 */
export function HoverTip({ tip, children, className }: { tip: ReactNode; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number; below: boolean; touch: boolean } | null>(null);

  const open = (touch: boolean) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = r.top < 120;
    const x = Math.min(Math.max(r.left + r.width / 2, 120), window.innerWidth - 120);
    setPos({ x, y: below ? r.bottom + 6 : r.top - 6, below, touch });
  };

  useEffect(() => {
    if (!pos) return;
    const off = () => setPos(null);
    window.addEventListener("scroll", off, true);
    window.addEventListener("resize", off);
    const t = pos.touch ? window.setTimeout(off, 4000) : 0;
    return () => {
      window.removeEventListener("scroll", off, true);
      window.removeEventListener("resize", off);
      window.clearTimeout(t);
    };
  }, [pos]);

  return (
    <span
      ref={ref}
      className={cx("inline-flex", className)}
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse") open(false);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse") setPos(null);
      }}
      onPointerUp={(e) => {
        if (e.pointerType === "mouse") return;
        if (pos) setPos(null);
        else open(true);
      }}
    >
      {children}
      {pos &&
        createPortal(
          <span
            role="tooltip"
            className="pointer-events-none fixed z-[300] w-max max-w-56 rounded-md border border-brass-dark bg-soot-2/95 px-2 py-1 text-left text-xs font-normal normal-case leading-snug tracking-normal text-parchment shadow-[0_6px_18px_rgba(0,0,0,.6)]"
            style={{ left: pos.x, top: pos.y, transform: pos.below ? "translateX(-50%)" : "translate(-50%, -100%)" }}
          >
            {tip}
          </span>,
          document.body,
        )}
    </span>
  );
}

/* ------------------------------------------------------------ controls */

export function Switch({
  on,
  onToggle,
  label,
  sub,
  disabled,
  className,
}: {
  on: boolean;
  onToggle: () => void;
  label: ReactNode;
  sub?: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={onToggle}
      className={cx(
        "inline-flex min-h-10 items-center gap-2 rounded-md px-1 text-left text-xs text-parchment transition hover:bg-panel-3/40 disabled:cursor-not-allowed disabled:opacity-45",
        className,
      )}
    >
      <span
        className={cx(
          "relative h-5 w-9 shrink-0 rounded-full border shadow-[inset_0_1px_3px_rgba(0,0,0,.6)] transition-colors",
          on ? "border-[#24493f] bg-gradient-to-b from-verdigris to-[#2d5f53]" : "border-line bg-black/40",
        )}
      >
        <span
          className={cx(
            "absolute top-0.5 h-3.5 w-3.5 rounded-full bg-gradient-to-br from-brass-light to-brass-dark shadow-[0_1px_2px_rgba(0,0,0,.6)] transition-[left] duration-150",
            on ? "left-[18px]" : "left-0.5",
          )}
        />
      </span>
      <span className="min-w-0">
        <span className="block font-bold leading-tight">{label}</span>
        {sub && <span className="block text-[11px] leading-tight text-parchment-dim">{sub}</span>}
      </span>
    </button>
  );
}

export interface SegOption<T> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
  title?: string;
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  className,
  label,
  dense,
}: {
  value: T;
  options: SegOption<T>[];
  onChange: (v: T) => void;
  className?: string;
  label?: string;
  /** Phone toolbars: 36 px buttons below md. */
  dense?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cx("inline-flex rounded-md border border-brass-dark/70 bg-black/35 p-0.5 shadow-[inset_0_1px_3px_rgba(0,0,0,.6)]", className)}
    >
      {options.map((o) => {
        const sel = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={sel}
            disabled={o.disabled}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={cx(
              "min-h-10 min-w-11 flex-1 whitespace-nowrap rounded px-2.5 text-xs font-bold transition",
              dense && "max-md:min-h-9",
              sel
                ? "bg-gradient-to-b from-brass-light via-brass to-brass-dark text-soot shadow-[inset_0_1px_0_rgba(255,255,255,.45)]"
                : "text-parchment-dim hover:text-parchment disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-parchment-dim",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Sticky header of a tab: title on the left, controls on the right. Below md (the phone sheet) the tab bar already
 * names the tab, so the title is screen-reader only and the controls take the full width (PA-2); a toolbar with
 * no controls takes no room at all there.
 */
export function Toolbar({ icon, title, right, children }: { icon: ReactNode; title: ReactNode; right?: ReactNode; children?: ReactNode }) {
  const bare = !right && !children;
  return (
    <div
      className={cx(
        "sticky top-0 z-20 -mx-4 mb-1.5 border-b border-line/70 bg-soot-2/95 px-4 py-0.5 shadow-[0_6px_12px_-8px_rgba(0,0,0,.8)] backdrop-blur-sm md:-mx-3 md:mb-3 md:px-3 md:py-1",
        bare && "max-md:sr-only",
      )}
    >
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-x-3 gap-y-1 md:min-h-10">
        <h2 className="font-display text-lg font-bold leading-none tracking-wide text-brass-light max-md:sr-only">
          <span className="mr-1.5">{icon}</span>
          {title}
        </h2>
        {right && <div className="flex min-w-0 items-center max-md:w-full max-md:*:flex-1">{right}</div>}
      </div>
      {children}
    </div>
  );
}

export function SectionTitle({ children, right, className }: { children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={cx("mb-2 mt-5 flex items-center gap-2", className)}>
      <span className="font-display text-sm font-bold uppercase tracking-[0.12em] text-brass">{children}</span>
      <span className="h-px flex-1 bg-gradient-to-r from-brass-dark/70 to-transparent" />
      {right}
    </div>
  );
}

/** Model key of a ContribRow (need | contributed | stock as displayed): rows re-render only when their text changes. */
export function contribKey(need: number, have: number, stock: number): string {
  return `${need}|${have}|${fmt(stock)}|${stock > 0 ? 1 : 0}`;
}

/** One resource line of a contribution project: bar, "внесено / нужно", "внести" button. */
export function ContribRow({
  r,
  need,
  have,
  stock,
  onGive,
  locked,
}: {
  r: ResId;
  need: number;
  have: number;
  stock: number;
  onGive: () => void;
  locked?: boolean;
}) {
  const left = Math.max(0, need - have);
  const full = left <= 1e-9;
  const give = Math.min(left, stock);
  return (
    <div className="grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-x-2">
      <ResIcon res={r} className="text-center text-lg" />
      <div className="min-w-0">
        <Bar value={have} max={need} color={full ? "var(--good)" : RESOURCES[r].color} className="h-2" />
        <div className="mt-0.5 flex justify-between gap-2 font-mono text-[10px] tabular text-parchment-dim">
          <span className={full ? "text-good" : "text-parchment"}>
            {fmt(have)} / {fmt(need)}
          </span>
          <span className="truncate">{full ? "внесено ✓" : `в запасе ${fmt(stock)}`}</span>
        </div>
      </div>
      <BrassButton
        size="sm"
        tone={full ? "ghost" : "brass"}
        className="min-h-10 min-w-[4.5rem]"
        disabled={full || give <= 0 || locked}
        onClick={onGive}
        title={full ? "Этот ресурс уже внесён" : give > 0 ? `Внести ${fmt(give)} ${RESOURCES[r].name.toLowerCase()}` : "В запасе пусто"}
      >
        {full ? "✓" : "внести"}
      </BrassButton>
    </div>
  );
}

/* ------------------------------------------------------------ juice */

/** Squash-and-stretch press: 1 → 0.95 → 1.05 → 1 (skipped in reduced motion). */
export function squash(el: Element | null, calm: boolean): void {
  if (!el || calm || typeof (el as HTMLElement).animate !== "function") return;
  el.animate([{ transform: "scale(1)" }, { transform: "scale(0.95)" }, { transform: "scale(1.05)" }, { transform: "scale(1)" }], {
    duration: 280,
    easing: "ease-out",
  });
}

/** Floating text above an element (FxLayer draws it in screen coordinates). */
export function floatAt(el: Element | null, text: string, color: string, big = false): void {
  if (!el) return;
  const r = el.getBoundingClientRect();
  emitUiFx({ k: "float", text, x: r.left + r.width / 2, y: r.top, color, big });
}

/* ------------------------------------------------------------ keyframes */

const CSS = `
@keyframes rr-breathe { 0%,100% { transform: scale(1); filter: drop-shadow(0 0 0 rgba(242,184,75,0)); } 50% { transform: scale(1.06); filter: drop-shadow(0 0 7px rgba(242,184,75,.6)); } }
@keyframes rr-sheen { 0% { transform: translateX(-160%) skewX(-18deg); } 55%,100% { transform: translateX(420%) skewX(-18deg); } }
@keyframes rr-blink { 0%,100% { opacity: 1; } 50% { opacity: .35; } }
@keyframes rr-glow { 0%,100% { box-shadow: 0 0 0 0 rgba(242,184,75,0), inset 0 0 6px rgba(242,184,75,.25); } 50% { box-shadow: 0 0 14px 2px rgba(242,184,75,.55), inset 0 0 12px rgba(242,184,75,.45); } }
@keyframes rr-ping { 0% { transform: scale(1); opacity: .85; } 80%,100% { transform: scale(2.6); opacity: 0; } }
@keyframes rr-dig { 0%,100% { transform: rotate(-22deg); } 50% { transform: rotate(28deg) translateY(2px); } }
@keyframes rr-spin { to { transform: rotate(360deg); } }
@keyframes rr-puff { 0% { transform: translate(0,0) scale(.4); opacity: 0; } 15% { opacity: .85; } 100% { transform: translate(-40px,-28px) scale(1.7); opacity: 0; } }
@keyframes rr-sway { 0%,100% { transform: rotate(-3deg); } 50% { transform: rotate(3deg); } }
@keyframes rr-tick { 0%,92% { opacity: 1; } 96% { opacity: .55; } 100% { opacity: 1; } }
.rr-breathe { animation: rr-breathe 2.2s ease-in-out infinite; }
.rr-sheen { position: absolute; inset: 0; overflow: hidden; pointer-events: none; border-radius: inherit; }
.rr-sheen::after { content: ""; position: absolute; top: 0; bottom: 0; left: 0; width: 30%; background: linear-gradient(90deg, transparent, rgba(255,236,190,.17), transparent); animation: rr-sheen 3.4s ease-in-out infinite; }
.rr-blink { animation: rr-blink 1s ease-in-out infinite; }
.rr-glow { animation: rr-glow 1.8s ease-in-out infinite; }
.rr-ping { animation: rr-ping 1.6s cubic-bezier(0,0,.2,1) infinite; }
.rr-dig { display: inline-block; transform-origin: 80% 80%; animation: rr-dig .45s ease-in-out infinite; }
.rr-spin { transform-box: fill-box; transform-origin: center; animation: rr-spin 1.1s linear infinite; }
.rr-puff { transform-box: fill-box; transform-origin: center; animation: rr-puff 1.9s ease-out infinite; }
.rr-sway { transform-box: fill-box; transform-origin: 50% 0%; animation: rr-sway 2.6s ease-in-out infinite; }
.rr-tick { animation: rr-tick 1s steps(1) infinite; }
@keyframes rr-focus-ring { 0%,100% { box-shadow: 0 0 0 0 rgba(242,184,75,0); } 35% { box-shadow: 0 0 0 2px rgba(242,184,75,.95), 0 0 18px 4px rgba(242,184,75,.55); } }
.rr-focus { animation: rr-focus-ring .8s ease-in-out 2; }
.rr-board-glow { text-shadow: 0 0 6px rgba(242,184,75,.55), 0 0 1px rgba(242,184,75,.9); }
.rr-silhouette { filter: brightness(0) drop-shadow(0 0 1px rgba(201,162,90,.75)); opacity: .7; }
.rr-range { -webkit-appearance: none; appearance: none; background: transparent; height: 40px; width: 100%; cursor: pointer; touch-action: pan-y; }
.rr-range:focus-visible { outline: 2px solid var(--brass); outline-offset: 2px; border-radius: 6px; }
.rr-range::-webkit-slider-runnable-track { height: 6px; border-radius: 9999px; background: linear-gradient(90deg, var(--brass-dark), var(--brass-light)) 0 0 / var(--pct, 50%) 100% no-repeat, rgba(0,0,0,.45); box-shadow: inset 0 1px 2px rgba(0,0,0,.6); }
.rr-range::-moz-range-track { height: 6px; border-radius: 9999px; background: linear-gradient(90deg, var(--brass-dark), var(--brass-light)) 0 0 / var(--pct, 50%) 100% no-repeat, rgba(0,0,0,.45); box-shadow: inset 0 1px 2px rgba(0,0,0,.6); }
.rr-range::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 22px; height: 22px; margin-top: -8px; border-radius: 9999px; background: radial-gradient(circle at 35% 35%, var(--brass-light), var(--brass-dark)); border: 1px solid #4a3a1a; box-shadow: 0 2px 3px rgba(0,0,0,.6); }
.rr-range::-moz-range-thumb { width: 22px; height: 22px; border-radius: 9999px; background: radial-gradient(circle at 35% 35%, var(--brass-light), var(--brass-dark)); border: 1px solid #4a3a1a; box-shadow: 0 2px 3px rgba(0,0,0,.6); }
.rr-calm .rr-breathe, .rr-calm .rr-sheen::after, .rr-calm .rr-blink, .rr-calm .rr-glow, .rr-calm .rr-ping, .rr-calm .rr-dig,
.rr-calm .rr-spin, .rr-calm .rr-puff, .rr-calm .rr-sway, .rr-calm .rr-tick, .rr-calm .rr-focus { animation: none !important; }
.rr-calm .rr-focus { box-shadow: 0 0 0 2px var(--gaslight); }
@media (prefers-reduced-motion: reduce) {
  .rr-breathe, .rr-sheen::after, .rr-blink, .rr-glow, .rr-ping, .rr-dig, .rr-spin, .rr-puff, .rr-sway, .rr-tick, .rr-focus { animation: none !important; }
  .rr-focus { box-shadow: 0 0 0 2px var(--gaslight); }
}
`;

/** Keyframes and helper classes used by the panel (mounted once by SidePanel). */
export function PanelStyles() {
  return <style>{CSS}</style>;
}
