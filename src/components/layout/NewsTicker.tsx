"use client";

/**
 * «Крысиные Ведомости»: masthead + a smooth rAF marquee of the latest headlines (newest first, ✦ between).
 * A fresh headline flashes in over the marquee for a few seconds; a click opens the last 10 headlines.
 * The marquee speeds up during «Аврал»; it pauses under the mouse and while the ticker has keyboard focus.
 * v3 (SHL-4): with reduced motion nothing scrolls — the newest headline stands still (truncated) and the next one
 * takes its place every 8 s with a 300 ms crossfade; on phones the system Back closes the open list (useBackCloses);
 * the 30-px bar takes taps 6 px above itself (hit-slop). SHL-5: after the first coronation the masthead turns into
 * «Придворный выпуск 👑».
 */
import { cancelDecoFrame, decoFrame, useEco } from "@/lib/eco";
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useShallow } from "zustand/react/shallow";
import { onFx } from "@/game/fx";
import { derivedOf, useGame } from "@/game/store";
import { cx } from "@/components/ui/kit";
import { useBackCloses } from "@/lib/useBackCloses";
import { hhmm } from "./clock";
import HudStyles from "./HudStyles";

const FLASH_MS = 5200;
const SPEED = 46; // px/s
/** Reduced motion: one still headline at a time, the next one after this long. */
const STILL_MS = 8000;
const FADE_MS = 300;

export default function NewsTicker() {
  const shown = useGame((s) => !!s.game.revealed.news);
  if (!shown) return null;
  return <Ticker />;
}

function Ticker() {
  // «Экономия батареи» stills the marquee too (a 20 fps crawl would only judder)
  const eco = useEco();
  const calm = useGame((s) => s.game.settings.reducedMotion) || eco;
  const frenzy = useGame((s) => derivedOf(s.game).frenzy);
  // newest first; the ticker only needs the latest dozen
  const items = useGame(useShallow((s) => s.game.news.slice(-12).reverse().map((n) => n.text)));
  const [flash, setFlash] = useState<{ text: string; id: number } | null>(null);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  // the marquee stands still under the mouse and while the ticker button has keyboard focus
  const pausedRef = useRef({ hover: false, focus: false });

  // a new headline flashes in (subscribe to the fx bus: no effect-driven setState)
  useEffect(() => {
    let timer = 0;
    let n = 0;
    const off = onFx((fx) => {
      if (fx.k !== "news") return;
      setFlash({ text: fx.text, id: ++n });
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setFlash(null), FLASH_MS);
    });
    return () => {
      off();
      window.clearTimeout(timer);
    };
  }, []);

  // close the dropdown on outside press / Escape; on phones the system Back closes it too
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  useBackCloses(open, () => setOpen(false));

  return (
    <div ref={rootRef} className={cx("relative z-30 shrink-0", calm && "hud-calm")}>
      <HudStyles />
      {open && <Dropdown onClose={() => setOpen(false)} />}
      <div className="flex h-[30px] items-stretch border-t border-brass-dark/70 bg-[#17130f] shadow-[0_-3px_10px_rgba(0,0,0,.45)]">
        <Masthead />
        {/* mobile-5: the bar is 30 px; hit-slop adds 6 px of tap above it (the screen edge is below) */}
        <button
          type="button"
          aria-expanded={open}
          aria-label="Крысиные Ведомости: последние заголовки"
          onClick={() => setOpen((v) => !v)}
          // the button (its tap pad included) takes the pointer, so it tells the marquee about the hover
          onPointerEnter={(e) => {
            if (e.pointerType === "mouse") pausedRef.current.hover = true;
          }}
          onPointerLeave={() => {
            pausedRef.current.hover = false;
          }}
          onFocus={(e) => {
            pausedRef.current.focus = e.currentTarget.matches(":focus-visible");
          }}
          onBlur={() => {
            pausedRef.current.focus = false;
          }}
          className="hit-slop group min-w-0 flex-1 cursor-pointer text-left [--slop:-6px_0_0] focus-visible:-outline-offset-2"
        >
          <span className="absolute inset-0 overflow-hidden">
            {flash ? (
              <FlashLine key={flash.id} text={flash.text} />
            ) : calm ? (
              <StillLine key={items[0] ?? ""} items={items} />
            ) : (
              <Marquee key={items[0] ?? ""} items={items} speed={SPEED * (frenzy ? 2.4 : 1)} pausedRef={pausedRef} />
            )}
            {/* soft edges */}
            <span className="pointer-events-none absolute inset-y-0 left-0 w-4 bg-gradient-to-r from-[#17130f] to-transparent" />
            <span className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-[#17130f] to-transparent" />
            <span className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 text-[10px] text-brass-dark transition group-hover:text-brass">
              {open ? "▼" : "▲"}
            </span>
          </span>
        </button>
      </div>
    </div>
  );
}

function Masthead() {
  // SHL-5 (meta-10): the colony has a King now, and the paper has a court edition
  const royal = useGame((s) => s.game.meta.achievements.coronation !== undefined);
  return (
    <div className="hud-paper relative flex shrink-0 items-center gap-1.5 border-r-2 border-[#2a1f14] px-2 shadow-[2px_0_6px_rgba(0,0,0,.5)]">
      <span className="text-[13px] leading-none" aria-hidden>
        {royal ? "👑" : "🗞"}
      </span>
      {royal ? (
        <span className="font-display text-[12px] font-bold uppercase leading-none tracking-[0.08em] text-[#2a1f14]">
          <span className="sm:hidden">Ведомости</span>
          <span className="hidden sm:inline">Придворный выпуск 👑</span>
        </span>
      ) : (
        <span className="font-display text-[12px] font-bold uppercase leading-none tracking-[0.08em] text-[#2a1f14]">
          <span className="hidden sm:inline">Крысиные </span>Ведомости
        </span>
      )}
    </div>
  );
}

/**
 * Reduced motion: no marquee. The newest headline stands still (truncated); every 8 s it fades out (300 ms) and the
 * next one fades in. A new headline remounts this (key) and starts again from the top.
 */
function StillLine({ items }: { items: string[] }) {
  const [i, setI] = useState(0);
  const [out, setOut] = useState(false);
  useEffect(() => {
    if (items.length < 2) return;
    let swap = 0;
    const timer = window.setInterval(() => {
      setOut(true);
      swap = window.setTimeout(() => {
        setI((k) => (k + 1) % items.length);
        setOut(false);
      }, FADE_MS);
    }, STILL_MS);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(swap);
    };
  }, [items.length]);
  if (items.length === 0) {
    return <span className="flex h-full items-center px-3 text-xs italic text-parchment-dim">Наборщики ещё спят. Новостей нет — и это тоже новость.</span>;
  }
  const k = Math.min(i, items.length - 1);
  return (
    <span
      className={cx("flex h-full min-w-0 items-center pl-4 pr-8 transition-opacity ease-in-out", out ? "opacity-0" : "opacity-100")}
      style={{ transitionDuration: `${FADE_MS}ms` }}
    >
      <span className={cx("min-w-0 truncate text-[12.5px]", k === 0 ? "font-bold text-brass-light" : "text-parchment/90")}>{items[k]}</span>
    </span>
  );
}

/**
 * rAF-driven marquee: two copies of the strip, wrap when the first scrolls out. Pauses on hover and keyboard focus.
 * The loop never touches layout: the copy's width is cached by a ResizeObserver (re-armed whenever the items change,
 * so the new width arrives with the next frame's layout instead of a forced reflow), and nothing moves while the
 * page is hidden.
 */
function Marquee({ items, speed, pausedRef }: { items: string[]; speed: number; pausedRef: RefObject<{ hover: boolean; focus: boolean }> }) {
  const trackRef = useRef<HTMLSpanElement>(null);
  const copyRef = useRef<HTMLSpanElement>(null);
  const widthRef = useRef(0);
  const speedRef = useRef(speed);

  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  useLayoutEffect(() => {
    const el = copyRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      widthRef.current = e.borderBoxSize?.[0]?.inlineSize ?? el.offsetWidth;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [items]);

  useEffect(() => {
    let raf = 0;
    let x = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const w = widthRef.current;
      const paused = pausedRef.current.hover || pausedRef.current.focus;
      if (!document.hidden && !paused && w > 0) {
        x -= speedRef.current * dt;
        if (x <= -w) x += w;
        if (trackRef.current) trackRef.current.style.transform = `translate3d(${x.toFixed(1)}px,0,0)`;
      }
      raf = decoFrame(loop);
    };
    raf = decoFrame(loop);
    return () => cancelDecoFrame(raf);
  }, [pausedRef]);

  if (items.length === 0) {
    return <span className="flex h-full items-center px-3 text-xs italic text-parchment-dim">Наборщики ещё спят. Новостей нет — и это тоже новость.</span>;
  }
  const strip = (
    <>
      {items.map((t, i) => (
        <span key={i} className="flex items-center">
          <span className={cx("whitespace-nowrap px-3 text-[12.5px]", i === 0 ? "font-bold text-brass-light" : "text-parchment/90")}>{t}</span>
          <span className="text-[11px] text-brass-dark" aria-hidden>
            ✦
          </span>
        </span>
      ))}
    </>
  );
  // spans, not divs: this lives inside the ticker <button>
  return (
    <span className="flex h-full items-center">
      <span ref={trackRef} className="flex h-full items-center will-change-transform">
        <span ref={copyRef} className="flex shrink-0 items-center pl-4">
          {strip}
        </span>
        <span className="flex shrink-0 items-center pl-4" aria-hidden>
          {strip}
        </span>
      </span>
    </span>
  );
}

/** «Свежий номер!»: the fresh headline slides in over a gaslight flash. */
function FlashLine({ text }: { text: string }) {
  return (
    <span className="hud-flash flex h-full min-w-0 items-center gap-2 px-2">
      <span className="shrink-0 rounded-sm bg-danger px-1 py-px font-display text-[10px] font-bold uppercase leading-tight tracking-widest text-parchment shadow-[0_1px_0_rgba(0,0,0,.6)]">
        Свежий номер
      </span>
      <span className="hud-slide-l min-w-0 truncate pr-6 text-[12.5px] font-bold text-gaslight">{text}</span>
    </span>
  );
}

/** The last 10 headlines with human time stamps. */
function Dropdown({ onClose }: { onClose: () => void }) {
  const news = useGame(useShallow((s) => s.game.news.slice(-10).reverse()));
  return (
    <div className="hud-paper absolute bottom-full left-2 right-2 mb-1 max-h-[min(60dvh,420px)] overflow-y-auto rounded-md border-2 border-[#2a1f14] p-3 shadow-[0_-8px_24px_rgba(0,0,0,.6)] sm:left-auto sm:w-[460px]">
      <div className="flex items-center justify-between gap-2 border-b-2 border-[#2a1f14] pb-1">
        <span className="font-display text-lg font-bold uppercase tracking-wider">Крысиные Ведомости</span>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-10 w-10 items-center justify-center rounded text-lg text-[#2a1f14] hover:bg-black/10"
          aria-label="Закрыть"
        >
          ✕
        </button>
      </div>
      <p className="hud-rule mt-0.5 pt-0.5 text-center font-display text-[10px] uppercase tracking-[0.25em] text-[#5a4630]">Последние известия · цена одна крошка</p>
      {news.length === 0 ? (
        <p className="py-4 text-center text-sm italic">Пока ни строчки. Крысы ещё не успели набедокурить.</p>
      ) : (
        <ol className="mt-2 space-y-1.5">
          {news.map((n, i) => (
            <li key={`${n.t}-${i}`} className={cx("flex gap-2 border-b border-dotted border-[#2a1f14]/30 pb-1.5 text-[13px] leading-snug", i === 0 && "font-bold")}>
              <span className="shrink-0 pt-px font-mono text-[11px] tabular text-[#6a5238]">{hhmm(n.t)}</span>
              <span>{n.text}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
