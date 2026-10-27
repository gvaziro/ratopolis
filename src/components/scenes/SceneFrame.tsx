"use client";

/**
 * Common frame of every event close-up: header with the event name and the two-scale lines
 * ("👤 Человек видит / 🐀 Крысы видят", typed letter by letter), a 1 s "Наверху" cut-in and the keyframes
 * used by all scene components.
 * v3: a «пауза» badge while the game is held by a ceremony, a crash or a save issue (SCN-1; a hidden tab needs none),
 * and the typed lines wait for the release;
 * on short screens (a phone in landscape) a one-row header, so the close-up keeps the height (SCN-5).
 */
import { useEffect, useState, type ReactNode } from "react";
import { sfx } from "@/audio/sfx";
import { EVENT_LINES } from "@/game/data/events";
import { isHeld, useGame } from "@/game/store";
import type { SceneEventId } from "@/game/types";
import { useShortLayout } from "@/lib/layoutMode";
import { cx } from "@/components/ui/kit";
import { setPeekHost } from "./MarketPopup";
import { sceneHeld } from "./sceneClock";

/** Keyframes shared by the scene components (prefixed rr- to stay out of everyone's way). */
const KEYFRAMES = `
@keyframes rr-scene-in{from{opacity:0;transform:scale(1.035)}to{opacity:1;transform:none}}
@keyframes rr-intro{0%{transform:scale(.6);opacity:0}16%{transform:scale(1);opacity:1}52%{transform:scale(1.12);opacity:1}100%{transform:scale(5);opacity:0}}
@keyframes rr-iris{0%{opacity:1}60%{opacity:.6}100%{opacity:0}}
@keyframes rr-mini-move{from{transform:translateX(-70px)}to{transform:translateX(70px)}}
@keyframes rr-pop{0%{transform:scale(1.9);opacity:0}40%{transform:scale(.9);opacity:1}70%{transform:scale(1.06)}100%{transform:scale(1);opacity:1}}
@keyframes rr-stamp{0%{transform:scale(3.2) rotate(-24deg);opacity:0}55%{transform:scale(.88) rotate(-8deg);opacity:1}75%{transform:scale(1.06) rotate(-8deg)}100%{transform:scale(1) rotate(-8deg);opacity:1}}
@keyframes rr-drop{0%{transform:translate(-50%,-160%) rotate(-14deg)}50%{transform:translate(-50%,0) rotate(5deg)}66%{transform:translate(-50%,-22%) rotate(-3deg)}82%{transform:translate(-50%,0) rotate(1deg)}100%{transform:translate(-50%,0) rotate(0)}}
@keyframes rr-jackpot{0%{transform:translate(-50%,-50%) scale(.2) rotate(-8deg);opacity:0}22%{transform:translate(-50%,-50%) scale(1.3) rotate(3deg);opacity:1}40%{transform:translate(-50%,-50%) scale(1) rotate(-2deg)}85%{opacity:1}100%{transform:translate(-50%,-50%) scale(1.12);opacity:0}}
@keyframes rr-paw{0%{transform:translate(-80px,26px) rotate(-10deg);opacity:0}12%{opacity:1}68%{transform:translate(80px,-14px) rotate(8deg);opacity:1}100%{transform:translate(90px,-16px) rotate(8deg);opacity:0}}
@keyframes rr-jitter{0%,100%{transform:translate(0,0)}25%{transform:translate(calc(var(--amp) * -1),var(--amp))}50%{transform:translate(var(--amp),calc(var(--amp) * -.5))}75%{transform:translate(calc(var(--amp) * .5),calc(var(--amp) * -1))}}
@keyframes rr-flash{from{opacity:.85}to{opacity:0}}
@keyframes rr-flash-soft{from{opacity:.3}to{opacity:0}}
@keyframes rr-card{0%{transform:translateY(36px) rotate(-2.5deg) scale(.95);opacity:0}70%{transform:translateY(-4px) rotate(.4deg) scale(1.01);opacity:1}100%{transform:none;opacity:1}}
@keyframes rr-flicker{0%,100%{opacity:.25}8%{opacity:.95}16%{opacity:.35}30%{opacity:1}44%{opacity:.5}60%{opacity:.9}}
@keyframes rr-glow{0%,100%{opacity:.6}50%{opacity:1}}
@keyframes rr-blink{50%{opacity:.35}}
@keyframes rr-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
@keyframes rr-hint{0%,100%{transform:scale(1)}50%{transform:scale(1.06)}}
@keyframes rr-fadein{from{opacity:0}to{opacity:1}}
@keyframes rr-scene-ping{0%{transform:scale(1);opacity:.85}80%,100%{transform:scale(1.9);opacity:0}}
[data-scene-dialog][data-held] :is([data-hold-pause],[data-hold-pause] *){animation-play-state:paused!important}
`;

export function SceneStyles() {
  return <style>{KEYFRAMES}</style>;
}

/** Text that types itself letter by letter (remount with a new key to restart). */
export function Typewriter({ text, delay = 0, speed = 26, instant, onDone }: { text: string; delay?: number; speed?: number; instant?: boolean; onDone?: () => void }) {
  const [n, setN] = useState(instant ? text.length : 0);
  useEffect(() => {
    if (instant) {
      onDone?.();
      return;
    }
    let i = 0;
    let iv = 0;
    const start = window.setTimeout(() => {
      iv = window.setInterval(() => {
        // SCN-1: the line waits (and keeps quiet) while the game is held
        if (sceneHeld()) return;
        i++;
        setN(i);
        if (i % 3 === 1 && text[i - 1] !== " ") sfx.typewriter();
        if (i >= text.length) {
          window.clearInterval(iv);
          onDone?.();
        }
      }, speed);
    }, delay);
    return () => {
      window.clearTimeout(start);
      window.clearInterval(iv);
    };
    // the component is keyed by text; callbacks are fire-and-forget
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <span>
      {text.slice(0, n)}
      {n < text.length && <span className="inline-block w-[0.5em] text-brass" style={{ animation: "rr-blink .7s steps(1) infinite" }}>▍</span>}
    </span>
  );
}

const SKY: Record<SceneEventId, { sky: string; ground: string; icon: string; move: boolean; label: string }> = {
  carriage: { sky: "linear-gradient(#9fb7c9,#d9c9a3)", ground: "#4a4038", icon: "🐎", move: true, label: "Кэб у тротуара" },
  capsule: { sky: "linear-gradient(#a7b4bd,#cdbb98)", ground: "#3e3a35", icon: "📯", move: false, label: "Банк, пневмопочта" },
  metro_train: { sky: "linear-gradient(#2b2f3a,#6b5a45)", ground: "#2a2522", icon: "🚂", move: true, label: "Перрон подземки" },
  royal_express: { sky: "linear-gradient(#3a2f4a,#b08a3e)", ground: "#2a2522", icon: "👑", move: true, label: "Вокзал, перрон оцеплен" },
  downpour: { sky: "linear-gradient(#4a5662,#78858d)", ground: "#2f3438", icon: "🌧️", move: false, label: "Ливень над мостовой" },
  cat: { sky: "linear-gradient(#5a4a3a,#a08560)", ground: "#3a3029", icon: "🐈‍⬛", move: true, label: "Кот у решётки" },
  ratcatcher: { sky: "linear-gradient(#5b5446,#9d8c6a)", ground: "#3a3029", icon: "🎶", move: true, label: "Крысолов на углу" },
};

/** A tiny "Наверху" vignette that zooms into the close-up (1 s, skipped for reduced motion). */
function IntroCutIn({ id }: { id: SceneEventId }) {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const t = window.setTimeout(() => setOn(false), 1050);
    return () => window.clearTimeout(t);
  }, []);
  if (!on) return null;
  const v = SKY[id];
  return (
    <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center overflow-hidden">
      <div className="absolute inset-0 bg-soot" style={{ animation: "rr-iris 1s ease-in forwards" }} />
      <div className="relative" style={{ animation: "rr-intro 1s cubic-bezier(.5,0,.75,0) forwards" }}>
        <div className="relative h-16 w-60 overflow-hidden rounded border-2 border-brass-dark shadow-[0_0_30px_rgba(0,0,0,.8)]" style={{ background: v.sky }}>
          <div className="absolute inset-x-0 bottom-0 h-4" style={{ background: v.ground }} />
          <div className="absolute bottom-3 left-3 h-7 w-1 bg-[#2a2420]" />
          <div className="absolute bottom-9 left-2 h-2 w-3 rounded-sm bg-gaslight shadow-[0_0_8px_#f2b84b]" />
          <div className="absolute bottom-3 right-6 h-8 w-10 bg-[#3a312a]" />
          <div className="absolute bottom-1 left-1/2 -ml-3 h-2 w-6 rounded-sm border border-[#222] bg-[repeating-linear-gradient(90deg,#111_0_2px,transparent_2px_5px)]" />
          <div className="absolute bottom-3 left-1/2 -ml-3 text-xl leading-none" style={v.move ? { animation: "rr-mini-move 1s linear forwards" } : undefined}>
            {v.icon}
          </div>
        </div>
        <p className="mt-1 text-center font-display text-xs uppercase tracking-[0.3em] text-brass-light">Наверху · {v.label}</p>
      </div>
    </div>
  );
}

/**
 * «⏸ пауза» while a ceremony, a crash or a save issue holds the game (the scene clock stands still meanwhile). Below
 * sm only the ⏸ shows (the word stays for screen readers), so the scene title keeps its room at 360 px.
 */
function PauseBadge({ reduced }: { reduced: boolean }) {
  const held = useGame(isHeld);
  if (!held) return null;
  return (
    <span
      data-decor=""
      className="rounded border border-gaslight/70 bg-black/40 px-1.5 py-0.5 font-display text-[11px] font-bold uppercase tracking-widest text-gaslight max-sm:tracking-normal"
      style={reduced ? undefined : { animation: "rr-blink 1.6s steps(1) infinite" }}
      role="status"
      title="Пауза"
    >
      <span aria-hidden>⏸</span>
      <span className="max-sm:sr-only"> пауза</span>
    </span>
  );
}

/** Header + body of a scene. `right` goes to the header's right edge. */
export default function SceneFrame({ id, right, children }: { id: SceneEventId; right?: ReactNode; children: ReactNode }) {
  const reduced = useGame((s) => s.game.settings.reducedMotion);
  const short = useShortLayout();
  const [humanDone, setHumanDone] = useState(false);
  const lines = EVENT_LINES[id];
  // SC-4: this scene's own 👤/🐀 pair from the engine (EN-6 pools and variants), else the v1 pair
  const human = useGame((s) => (s.game.scene?.id === id ? s.game.scene.line?.human : undefined)) ?? lines.human;
  const rat = useGame((s) => (s.game.scene?.id === id ? s.game.scene.line?.rat : undefined)) ?? lines.rat;
  // SC-6: a warning scene (cat, ratcatcher) starts with its choice buttons: no cut-in may cover them
  const cutIn = !reduced && id !== "cat" && id !== "ratcatcher";
  const royal = id === "royal_express";
  return (
    <div
      className={cx("relative flex h-full w-full flex-col overflow-hidden bg-soot text-parchment", royal && "shadow-[inset_0_0_0_3px_#d4af37]")}
      style={reduced ? undefined : { animation: "rr-scene-in .35s ease-out" }}
    >
      <SceneStyles />
      <header
        className={cx(
          "relative z-20 shrink-0 border-b px-3",
          short ? "py-0.5" : "py-1.5 md:px-4 md:py-2",
          royal ? "border-[#d4af37] bg-gradient-to-b from-[#3b2c12] to-panel" : "border-line bg-gradient-to-b from-panel-2 to-panel",
        )}
      >
        <div className={cx("flex items-center gap-2", short ? "min-h-7" : "min-h-8")}>
          <span className={cx("leading-none", short ? "text-lg" : "text-xl md:text-2xl")} aria-hidden>
            {lines.icon}
          </span>
          <h2 className={cx("min-w-0 truncate font-display font-bold tracking-wide", short ? "text-base" : "text-base sm:text-lg md:text-xl", royal ? "text-[#f3d77a]" : "text-brass-light")}>
            {lines.name}
          </h2>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <PauseBadge reduced={reduced} />
            {right}
          </div>
        </div>
        {/* a phone in landscape: both lines side by side, one line each, so the close-up keeps the height (same tree
            either way: turning the phone does not restart the typing) */}
        <div className={cx("text-[11px] leading-snug", short ? "flex min-w-0 gap-3" : "md:text-xs")}>
          <p className={cx("text-parchment-dim", short && "line-clamp-1 min-w-0 flex-1")} title={short ? human : undefined}>
            <span className="font-bold">{short ? "👤 " : "👤 Человек видит: "}</span>
            <Typewriter key={"h" + id + human} text={human} delay={reduced ? 0 : 450} instant={reduced} onDone={() => setHumanDone(true)} />
          </p>
          <p className={cx("min-h-[1.2em] text-parchment", short && "line-clamp-1 min-w-0 flex-1")} title={short ? rat : undefined}>
            <span className="font-bold text-brass-light">{short ? "🐀 " : "🐀 Крысы видят: "}</span>
            {humanDone && <Typewriter key={"r" + id + rat} text={rat} delay={120} instant={reduced} />}
          </p>
        </div>
      </header>
      <div className="relative min-h-0 flex-1 overflow-hidden" data-scene-body="">
        {children}
        {cutIn && <IntroCutIn id={id} />}
        {/* Benedict's stall, peeked from the header chip, opens here: inside the dialog, under the header */}
        <div ref={setPeekHost} className="pointer-events-none absolute inset-0 z-40 empty:hidden" />
      </div>
      {royal && <div className="pointer-events-none absolute inset-0 z-30 border-[3px] border-[#d4af37] shadow-[inset_0_0_36px_rgba(212,175,55,.45)]" style={{ animation: "rr-glow 2.4s ease-in-out infinite" }} />}
    </div>
  );
}
