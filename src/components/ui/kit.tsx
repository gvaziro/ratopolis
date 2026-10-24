"use client";

/**
 * Shared UI kit: brass buttons, riveted plates, cost lists, bars, odometer numbers, tooltips.
 * Every panel/scene should build from these so the game reads as one Victorian-steampunk system.
 */
import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { RESOURCES } from "@/game/data/resources";
import { entries, lockedByCap } from "@/game/engine/formulas";
import type { Derived } from "@/game/engine/derive";
import type { Amounts, GameState, ResId } from "@/game/types";
import { fmt } from "@/lib/format";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/* ------------------------------------------------------------ buttons */

type Tone = "brass" | "copper" | "verdigris" | "danger" | "ghost";

const TONES: Record<Tone, string> = {
  brass:
    "bg-gradient-to-b from-brass-light via-brass to-brass-dark text-soot border-brass-dark shadow-[inset_0_1px_0_rgba(255,255,255,.45),0_2px_0_#4a3a1a] hover:brightness-110",
  copper:
    "bg-gradient-to-b from-copper-light via-copper to-[#7a3f20] text-parchment border-[#5a2e17] shadow-[inset_0_1px_0_rgba(255,255,255,.35),0_2px_0_#3a1d0e] hover:brightness-110",
  verdigris:
    "bg-gradient-to-b from-verdigris-light via-verdigris to-[#2d5f53] text-soot border-[#24493f] shadow-[inset_0_1px_0_rgba(255,255,255,.35),0_2px_0_#183129] hover:brightness-110",
  danger:
    "bg-gradient-to-b from-danger-light via-danger to-[#7a2620] text-parchment border-[#5a1c17] shadow-[inset_0_1px_0_rgba(255,255,255,.3),0_2px_0_#3a120f] hover:brightness-110",
  ghost: "bg-panel-2/60 text-parchment border-line hover:bg-panel-3",
};

export function BrassButton({
  tone = "brass",
  size = "md",
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone; size?: "sm" | "md" | "lg" }) {
  const sz = size === "sm" ? "px-2 py-0.5 text-xs" : size === "lg" ? "px-5 py-2.5 text-base" : "px-3 py-1.5 text-sm";
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        "relative select-none rounded-md border font-bold tracking-wide transition active:translate-y-px active:shadow-none disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:brightness-100",
        TONES[tone],
        sz,
        className,
      )}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------ plates */

/** Riveted panel frame. */
export function Plate({ title, icon, right, className, children }: { title?: ReactNode; icon?: ReactNode; right?: ReactNode; className?: string; children?: ReactNode }) {
  return (
    <section
      className={cx(
        "relative rounded-lg border border-line bg-gradient-to-b from-panel-2 to-panel shadow-[inset_0_1px_0_rgba(232,201,131,.08),0_4px_14px_rgba(0,0,0,.35)]",
        className,
      )}
    >
      <Rivets />
      {(title || right) && (
        <header className="flex items-center justify-between gap-2 border-b border-line/70 px-3 py-1.5">
          <h3 className="font-display text-base font-bold tracking-wide text-brass-light">
            {icon && <span className="mr-1.5">{icon}</span>}
            {title}
          </h3>
          {right}
        </header>
      )}
      <div className="p-3">{children}</div>
    </section>
  );
}

export function Rivets() {
  const r = "absolute h-1.5 w-1.5 rounded-full bg-gradient-to-br from-brass-light to-brass-dark shadow-[0_0_0_1px_rgba(0,0,0,.4)]";
  return (
    <>
      <span className={cx(r, "left-1.5 top-1.5")} />
      <span className={cx(r, "right-1.5 top-1.5")} />
      <span className={cx(r, "bottom-1.5 left-1.5")} />
      <span className={cx(r, "bottom-1.5 right-1.5")} />
    </>
  );
}

/* ------------------------------------------------------------ resources */

export function ResIcon({ res, className }: { res: ResId; className?: string }) {
  return (
    <span className={cx("inline-block leading-none", className)} title={RESOURCES[res].name} aria-label={RESOURCES[res].name}>
      {RESOURCES[res].icon}
    </span>
  );
}

/**
 * Cost list: each resource coloured by affordability, 🔒 when the price exceeds the storage cap.
 */
export function CostList({ cost, game, d, className }: { cost: Amounts; game: GameState; d: Derived; className?: string }) {
  const locked = new Set(lockedByCap(cost, d));
  return (
    <span className={cx("inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-xs tabular", className)}>
      {entries(cost).map(([r, v]) => {
        const ok = game.res[r] + 1e-9 >= v;
        return (
          <span key={r} className={cx("inline-flex items-center gap-0.5", ok ? "text-good" : "text-danger-light")} title={RESOURCES[r].name}>
            <ResIcon res={r} />
            {fmt(v)}
            {locked.has(r) && !ok && <span title="Цена выше лимита склада — нужен склад или добыча событий">🔒</span>}
          </span>
        );
      })}
    </span>
  );
}

export function AmountList({ amounts, className, sign = true }: { amounts: Amounts; className?: string; sign?: boolean }) {
  return (
    <span className={cx("inline-flex flex-wrap items-center gap-x-2 font-mono text-xs tabular", className)}>
      {entries(amounts)
        .filter(([, v]) => Math.abs(v) >= 0.005)
        .map(([r, v]) => (
          <span key={r} className="inline-flex items-center gap-0.5" style={{ color: RESOURCES[r].color }}>
            <ResIcon res={r} />
            {sign && v > 0 ? "+" : ""}
            {fmt(v)}
          </span>
        ))}
    </span>
  );
}

/* ------------------------------------------------------------ bars */

export function Bar({ value, max = 1, color = "var(--brass)", className, glow }: { value: number; max?: number; color?: string; className?: string; glow?: boolean }) {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) * 100 : 0;
  return (
    <div className={cx("relative h-1.5 overflow-hidden rounded-full bg-black/40 shadow-[inset_0_1px_2px_rgba(0,0,0,.6)]", className)}>
      <div
        className={cx("absolute inset-y-0 left-0 rounded-full transition-[width] duration-200", glow && "animate-pulse")}
        style={{ width: `${pct}%`, background: color }}
      />
    </div>
  );
}

/** Circular readiness ring (0..1) drawn around children. */
export function Ring({ value, size = 44, stroke = 3, color = "var(--brass)", children }: { value: number; size?: number; stroke?: number; color?: string; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <span className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="absolute inset-0 -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(0,0,0,.45)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeDasharray={c} strokeDashoffset={c * (1 - v)} strokeLinecap="round" style={{ transition: "stroke-dashoffset .2s" }} />
      </svg>
      <span className="relative">{children}</span>
    </span>
  );
}

/* ------------------------------------------------------------ odometer */

/** A number that eases toward its target (max 1/6 of the gap per frame), like an odometer. */
export function Odometer({ value, format = fmt, className }: { value: number; format?: (n: number) => string; className?: string }) {
  const [shown, setShown] = useState(value);
  useEffect(() => {
    let raf = 0;
    let done = false;
    const tick = () => {
      setShown((cur) => {
        const diff = value - cur;
        if (Math.abs(diff) < Math.max(1e-6, Math.abs(value) * 1e-4)) {
          done = true;
          return value;
        }
        return cur + diff / 6;
      });
      if (!done) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <span className={cx("tabular", className)}>{format(shown)}</span>;
}

/* ------------------------------------------------------------ tooltip */

export function Tip({ tip, children, className }: { tip: ReactNode; children: ReactNode; className?: string }) {
  return (
    <span className={cx("group relative inline-flex", className)}>
      {children}
      <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 hidden w-max max-w-64 -translate-x-1/2 rounded-md border border-brass-dark bg-soot-2/95 px-2 py-1 text-xs text-parchment shadow-lg group-hover:block">
        {tip}
      </span>
    </span>
  );
}

/* ------------------------------------------------------------ badges */

export function Badge({ children, tone = "brass", className }: { children: ReactNode; tone?: "brass" | "good" | "danger" | "verdigris"; className?: string }) {
  const t = {
    brass: "bg-brass/20 text-brass-light border-brass-dark",
    good: "bg-good/15 text-good border-good/40",
    danger: "bg-danger/20 text-danger-light border-danger/50",
    verdigris: "bg-verdigris/20 text-verdigris-light border-verdigris/50",
  }[tone];
  return <span className={cx("inline-flex items-center rounded border px-1.5 py-px text-[10px] font-bold uppercase tracking-wider", t, className)}>{children}</span>;
}

/** Newspaper-style stamp (ПОЛНО, ПЕРЕГРУЗ, ОДОБРЕНО). */
export function Stamp({ children, color = "var(--danger-light)", className }: { children: ReactNode; color?: string; className?: string }) {
  return (
    <span
      className={cx("pointer-events-none inline-block -rotate-[8deg] rounded border-2 px-1 font-display text-[10px] font-bold uppercase leading-tight tracking-widest", className)}
      style={{ color, borderColor: color }}
    >
      {children}
    </span>
  );
}
