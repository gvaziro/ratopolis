"use client";

/**
 * «Крысиные Ведомости»: masthead + a smooth rAF marquee of the latest headlines (newest first, ✦ between).
 * A fresh headline flashes in over the marquee for a few seconds; a click opens the last 10 headlines.
 * The marquee speeds up during «Аврал» and slows down with reduced motion.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { onFx } from "@/game/fx";
import { derivedOf, useGame } from "@/game/store";
import { cx } from "@/components/ui/kit";
import { hhmm } from "./clock";
import HudStyles from "./HudStyles";

const FLASH_MS = 5200;
const SPEED = 46; // px/s

export default function NewsTicker() {
  const shown = useGame((s) => !!s.game.revealed.news);
  if (!shown) return null;
  return <Ticker />;
}

function Ticker() {
  const calm = useGame((s) => s.game.settings.reducedMotion);
  const frenzy = useGame((s) => derivedOf(s.game).frenzy);
  // newest first; the ticker only needs the latest dozen
  const items = useGame(useShallow((s) => s.game.news.slice(-12).reverse().map((n) => n.text)));
  const [flash, setFlash] = useState<{ text: string; id: number } | null>(null);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

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

  // close the dropdown on outside press / Escape
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

  return (
    <div ref={rootRef} className={cx("relative z-30 shrink-0", calm && "hud-calm")}>
      <HudStyles />
      {open && <Dropdown onClose={() => setOpen(false)} />}
      <div className="flex h-[30px] items-stretch border-t border-brass-dark/70 bg-[#17130f] shadow-[0_-3px_10px_rgba(0,0,0,.45)]">
        <Masthead />
        <button
          type="button"
          aria-expanded={open}
          aria-label="Крысиные Ведомости: последние заголовки"
          onClick={() => setOpen((v) => !v)}
          className="group relative min-w-0 flex-1 cursor-pointer overflow-hidden text-left"
        >
          {flash ? (
            <FlashLine key={flash.id} text={flash.text} />
          ) : (
            <Marquee key={items[0] ?? ""} items={items} speed={SPEED * (frenzy ? 2.4 : 1) * (calm ? 0.6 : 1)} />
          )}
          {/* soft edges */}
          <span className="pointer-events-none absolute inset-y-0 left-0 w-4 bg-gradient-to-r from-[#17130f] to-transparent" />
          <span className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-[#17130f] to-transparent" />
          <span className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 text-[10px] text-brass-dark transition group-hover:text-brass">
            {open ? "▼" : "▲"}
          </span>
        </button>
      </div>
    </div>
  );
}

function Masthead() {
  return (
    <div className="hud-paper relative flex shrink-0 items-center gap-1.5 border-r-2 border-[#2a1f14] px-2 shadow-[2px_0_6px_rgba(0,0,0,.5)]">
      <span className="text-[13px] leading-none" aria-hidden>
        🗞
      </span>
      <span className="font-display text-[12px] font-bold uppercase leading-none tracking-[0.08em] text-[#2a1f14]">
        <span className="hidden sm:inline">Крысиные </span>Ведомости
      </span>
    </div>
  );
}

/**
 * rAF-driven marquee: two copies of the strip, wrap when the first scrolls out. Pauses on hover.
 * The loop never touches layout: the copy's width is cached by a ResizeObserver (re-armed whenever the items change,
 * so the new width arrives with the next frame's layout instead of a forced reflow), and nothing moves while the
 * page is hidden.
 */
function Marquee({ items, speed }: { items: string[]; speed: number }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const copyRef = useRef<HTMLDivElement>(null);
  const widthRef = useRef(0);
  const speedRef = useRef(speed);
  const pausedRef = useRef(false);

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
      if (!document.hidden && !pausedRef.current && w > 0) {
        x -= speedRef.current * dt;
        if (x <= -w) x += w;
        if (trackRef.current) trackRef.current.style.transform = `translate3d(${x.toFixed(1)}px,0,0)`;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

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
  return (
    <div
      className="flex h-full items-center"
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse") pausedRef.current = true;
      }}
      onPointerLeave={() => {
        pausedRef.current = false;
      }}
    >
      <div ref={trackRef} className="flex h-full items-center will-change-transform">
        <div ref={copyRef} className="flex shrink-0 items-center pl-4">
          {strip}
        </div>
        <div className="flex shrink-0 items-center pl-4" aria-hidden>
          {strip}
        </div>
      </div>
    </div>
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
