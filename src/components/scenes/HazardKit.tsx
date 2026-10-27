"use client";

/**
 * Shared bits of the hazard close-ups (Ливень, Кот, Крысолов) and their overlays: countdown medallion,
 * big two-line choice buttons, keyframes (prefixed rh-), stake calculators mirroring the engine formulas,
 * a tap-rate limiter and screen-space flourishes that survive the scene unmounting.
 * v3: the tap limiter counts on the scene clock (SCN-1); a choice button can be the phase's keyboard landing spot
 * (`focusFirst` → data-autofocus, SCN-5).
 */
import type { ReactNode } from "react";
import { BrassButton, cx, Ring } from "@/components/ui/kit";
import { fxBurst, fxText, type BurstKind } from "@/components/fx/fxBus";
import { eventValue } from "@/game/engine/derive";
import { derivedOf, useGame } from "@/game/store";
import type { GameState } from "@/game/types";
import { fmtTime } from "@/lib/format";
import { sceneNow } from "./sceneClock";

/* ------------------------------------------------------------ keyframes */

const CSS = `
@keyframes rh-bac{0%{transform:translate(-50%,-50%) scale(.3) rotate(var(--r,-10deg));opacity:0}22%{transform:translate(-50%,-50%) scale(1.3) rotate(var(--r,-10deg));opacity:1}55%{transform:translate(-50%,-80%) scale(1) rotate(var(--r,-10deg));opacity:1}100%{transform:translate(-50%,-140%) scale(.92) rotate(var(--r,-10deg));opacity:0}}
@keyframes rh-banner{0%{transform:translateY(-16px) scale(.94);opacity:0}10%{transform:none;opacity:1}82%{transform:none;opacity:1}100%{transform:translateY(-6px);opacity:0}}
@keyframes rh-stamp{0%{transform:scale(2.8);opacity:0}60%{transform:scale(.9);opacity:1}80%{transform:scale(1.05)}100%{transform:scale(1);opacity:1}}
@keyframes rh-note{0%{transform:translate(0,0) rotate(0) scale(.5);opacity:0}12%{opacity:1}80%{opacity:.9}100%{transform:translate(var(--dx),var(--dy)) rotate(var(--rot)) scale(1.2);opacity:0}}
@keyframes rh-hint{0%,100%{transform:scale(1)}50%{transform:scale(1.06)}}
@keyframes rh-flicker{0%,100%{opacity:.82}8%{opacity:.96}16%{opacity:.74}30%{opacity:1}44%{opacity:.86}60%{opacity:.95}}
@keyframes rh-urgent{0%,100%{transform:scale(1)}50%{transform:scale(1.13)}}
@keyframes rh-shiver{0%,100%{transform:translateX(0)}25%{transform:translateX(-1.6px)}75%{transform:translateX(1.6px)}}
@keyframes rh-sway{0%,100%{transform:rotate(-3deg)}50%{transform:rotate(3deg)}}
@keyframes rh-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}
@keyframes rh-slide-in{from{transform:translateX(-28px) scale(.97);opacity:0}to{transform:none;opacity:1}}
@keyframes rh-spin{to{transform:rotate(360deg)}}
@keyframes rh-puff{0%{transform:translate(0,0) scale(.35);opacity:0}15%{opacity:.85}100%{transform:translate(-26px,-38px) scale(1.9);opacity:0}}
@keyframes rh-ring{from{transform:scale(.55);opacity:.95}to{transform:scale(2.6);opacity:0}}
@keyframes rh-reveal{from{opacity:0;transform:translateY(12px) scale(.98)}to{opacity:1;transform:none}}
@keyframes rh-crown{0%{transform:translateY(-70px) rotate(-24deg);opacity:0}60%{transform:translateY(5px) rotate(5deg);opacity:1}80%{transform:translateY(-3px) rotate(-2deg)}100%{transform:none;opacity:1}}
@keyframes rh-glow{0%,100%{opacity:.55}50%{opacity:1}}
@keyframes rh-darken{from{opacity:0}to{opacity:1}}
@keyframes rh-lightning{0%,100%{opacity:0}4%{opacity:.55}9%{opacity:.08}13%{opacity:.4}30%{opacity:0}}
@keyframes rh-open{0%{transform:scaleY(.04)}60%{transform:scaleY(1.06)}100%{transform:scaleY(1)}}
@keyframes rh-blink{0%,93%,100%{transform:scaleY(0)}96.5%{transform:scaleY(1)}}
@keyframes rh-gush{0%,100%{transform:scaleX(1)}50%{transform:scaleX(1.08)}}
@keyframes rh-pulse-dot{0%{box-shadow:0 0 0 0 rgba(242,184,75,.7)}100%{box-shadow:0 0 0 10px rgba(242,184,75,0)}}
`;

export function HazardStyles() {
  return <style>{CSS}</style>;
}

/* ------------------------------------------------------------ hooks */

/** True once the game clock passed `endsAt` (re-renders only when it flips). */
export function useTimeUp(endsAt: number): boolean {
  return useGame((s) => s.game.time >= endsAt);
}

export function useReduced(): boolean {
  return useGame((s) => s.game.settings.reducedMotion);
}

/* ------------------------------------------------------------ countdown */

/** Brass countdown medallion driven by the game clock (10 Hz). */
export function Countdown({ endsAt, total, label, warnAt = 3, className }: { endsAt: number; total: number; label?: ReactNode; warnAt?: number; className?: string }) {
  const remain = useGame((s) => Math.max(0, endsAt - s.game.time));
  const calm = useReduced();
  const urgent = remain <= warnAt;
  const secs = Math.ceil(remain);
  return (
    <div
      className={cx(
        "pointer-events-none flex items-center gap-2 rounded-full border bg-soot/85 py-1 pl-1 shadow-[0_4px_14px_rgba(0,0,0,.6)] backdrop-blur-sm",
        label ? "pr-3" : "pr-1",
        urgent ? "border-danger-light" : "border-brass-dark",
        className,
      )}
      role="timer"
      aria-label={`Осталось ${fmtTime(secs)}`}
    >
      <span className="inline-flex" style={urgent && !calm ? { animation: "rh-urgent .5s ease-in-out infinite" } : undefined}>
        <Ring value={total > 0 ? remain / total : 0} size={40} stroke={3.5} color={urgent ? "var(--danger-light)" : "var(--brass-light)"}>
          <span className={cx("font-mono text-[11px] font-bold tabular", urgent ? "text-danger-light" : "text-brass-light")}>{fmtTime(secs)}</span>
        </Ring>
      </span>
      {label && <span className="font-display text-sm font-bold uppercase leading-tight tracking-wider text-parchment">{label}</span>}
    </div>
  );
}

/* ------------------------------------------------------------ buttons */

/** A big decision button: emoji, title and up to two small lines of consequences. */
export function ChoiceButton({
  icon,
  title,
  sub,
  sub2,
  tone,
  onClick,
  className,
  hotkey,
  focusFirst,
}: {
  icon: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  sub2?: ReactNode;
  tone: "brass" | "copper" | "verdigris" | "danger" | "ghost";
  onClick: () => void;
  className?: string;
  hotkey?: string;
  /** SceneHost puts a keyboard player's focus here when the phase opens. */
  focusFirst?: boolean;
}) {
  return (
    <BrassButton
      tone={tone}
      size="lg"
      onClick={onClick}
      className={cx("flex min-h-14 w-full items-center gap-3 px-3! text-left", className)}
      aria-keyshortcuts={hotkey}
      data-autofocus={focusFirst ? "" : undefined}
    >
      <span className="text-3xl leading-none drop-shadow-[0_2px_2px_rgba(0,0,0,.5)]" aria-hidden>
        {icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-display text-lg leading-tight">{title}</span>
        {sub && <span className="text-[11px] font-normal leading-snug opacity-90">{sub}</span>}
        {sub2 && <span className="text-[11px] font-normal leading-snug opacity-80">{sub2}</span>}
      </span>
      {hotkey && <kbd className="hidden rounded border border-current/40 px-1 font-mono text-[10px] opacity-60 md:inline">{hotkey}</kbd>}
    </BrassButton>
  );
}

/* ------------------------------------------------------------ stakes (mirror engine/events.ts) */

export interface CatStakes {
  blueprints: number;
  cheese: number;
  scared: number;
  cheeseLoss: number;
}

/** Rewards and risks of fighting the cat (resolveCat). */
export function catStakes(s: GameState): CatStakes {
  const d = derivedOf(s);
  const bell = s.upgrades.bell_the_cat ? 1.5 : 1;
  return {
    blueprints: Math.max(10, 90 * s.ema.blueprints) * bell,
    cheese: 60 * eventValue(s, d, "cheese") * bell,
    scared: s.rats > 0 ? Math.min(s.rats, Math.max(1, Math.floor(s.rats * 0.03))) : 0,
    cheeseLoss: s.res.cheese * 0.05,
  };
}

export interface PiperStakes {
  payCoins: number;
  payCheese: number;
  winCoins: number;
  winBlueprints: number;
}

/** Ransom and fight rewards of the ratcatcher (ratcatcherPay / resolveRatcatcher). */
export function piperStakes(s: GameState): PiperStakes {
  const d = derivedOf(s);
  return {
    payCoins: 60 * eventValue(s, d, "coins"),
    payCheese: s.zones.cellars ? 30 * eventValue(s, d, "cheese") : 0,
    winCoins: 300 * eventValue(s, d, "coins"),
    winBlueprints: Math.max(20, 300 * s.ema.blueprints),
  };
}

/* ------------------------------------------------------------ misc */

/** Allows at most `perSec` taps per rolling second (autoclicker guard, same as the catch canvas). */
export function makeTapLimiter(perSec = 15): () => boolean {
  const stamps: number[] = [];
  return () => {
    const now = sceneNow();
    while (stamps.length && now - stamps[0] > 1000) stamps.shift();
    if (stamps.length >= perSec) return false;
    stamps.push(now);
    return true;
  };
}

/** Big floating headline in screen space (drawn by FxLayer, so it outlives the scene). */
export function flourish(text: string, x: number, y: number, color: string, size = 40, burst: BurstKind | null = "gold", n = 28): void {
  fxText({ text, x, y, color, big: true, size, dur: 1700 });
  if (burst) fxBurst(x, y, burst, n, 1.3);
}

/** Centre of an element in client coordinates (window centre as a fallback). */
export function centerOf(el: Element | null): { x: number; y: number } {
  if (!el) return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** Roman numerals for the bell strikes and other Victorian flourishes. */
export function roman(n: number): string {
  const map: [number, string][] = [
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ];
  let out = "";
  let v = Math.max(0, Math.floor(n));
  for (const [k, s] of map) {
    while (v >= k) {
      out += s;
      v -= k;
    }
  }
  return out;
}
