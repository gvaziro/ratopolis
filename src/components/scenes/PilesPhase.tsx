"use client";

/**
 * «Разбор завалов» — the `piles` primitive: one pile per car with uncaught loot. Each pile's share grows
 * linearly to the auto-collect value over the phase; every click adds +0.08 (holding = 6 per second).
 * Narrow-gauge carts (one per rat_rail level, max 12) roll along the rail below. «Готово» or the timer sends
 * the fractions.
 */
import { memo, useEffect, useRef, useState } from "react";
import { sfx } from "@/audio/sfx";
import { RATING_TABLE, TRAIN_CARS } from "@/game/data/events";
import { RESOURCES } from "@/game/data/resources";
import { entries } from "@/game/engine/formulas";
import { useGame } from "@/game/store";
import type { ResId, Scene } from "@/game/types";
import { fmt, fmtInt, fmtPct, fmtTime } from "@/lib/format";
import { BrassButton, Stamp, cx } from "@/components/ui/kit";
import { TrainDust } from "./TrainBackdrop";
import { act, clamp, hash01, makeClock } from "./sceneUtils";

const STEP = 0.08;
const HOLD_RATE = 6;

interface PileView {
  i: number;
  icon: string;
  car: string;
  top: [ResId, number][];
}

function PilesPhaseImpl({ scene }: { scene: Scene }) {
  const [sc] = useState(scene);
  const reduced = useGame((s) => s.game.settings.reducedMotion);
  const railLvl = useGame((s) => s.game.buildings.rat_rail);
  const k = (1 + sc.ratingBonus) * sc.multiplier;

  const piles: PileView[] = [];
  sc.piles.forEach((pile, i) => {
    const list = entries(pile)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] * (RESOURCES[b[0]].market ?? 40) - a[1] * (RESOURCES[a[0]].market ?? 40));
    if (!list.length) return;
    const kind = sc.cars[i]?.kind ?? "capsule";
    piles.push({ i, icon: TRAIN_CARS[kind].icon, car: TRAIN_CARS[kind].name, top: list });
  });
  const cartIcons = piles.length ? piles.map((p) => RESOURCES[p.top[0][0]].icon) : ["🍞"];
  const carts = Math.min(12, railLvl);

  const barEls = useRef<(HTMLDivElement | null)[]>([]);
  const pctEls = useRef<(HTMLSpanElement | null)[]>([]);
  const heapEls = useRef<(HTMLDivElement | null)[]>([]);
  const pileEls = useRef<(HTMLButtonElement | null)[]>([]);
  const cartEls = useRef<(HTMLDivElement | null)[]>([]);
  const railRef = useRef<HTMLDivElement>(null);
  const fxRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<HTMLSpanElement>(null);
  const api = useRef<{ press: (i: number) => void; release: () => void; send: () => void } | null>(null);
  const [full, setFull] = useState<boolean[]>(() => sc.piles.map(() => false));
  const [sent, setSent] = useState(false);

  useEffect(() => {
    const g0 = useGame.getState().game;
    const reducedNow = g0.settings.reducedMotion;
    const helper = Math.min(12, g0.buildings.rat_rail) === 0;
    const clock = makeClock(sc.phaseStart);
    const dur = Math.max(0.5, sc.phaseEnds - sc.phaseStart);
    const extra = sc.piles.map(() => 0);
    const isFull = sc.piles.map(() => false);
    const icons = sc.piles.map((p) => {
      const e = entries(p).filter(([, v]) => v > 0);
      return e.length ? e.map(([r]) => RESOURCES[r].icon) : ["🍞"];
    });
    let done = false;
    let frozenP = 0;
    let holdIv = 0;
    let railW = railRef.current?.clientWidth ?? 300;
    const ro = new ResizeObserver(() => {
      railW = railRef.current?.clientWidth ?? railW;
    });
    if (railRef.current) ro.observe(railRef.current);

    const frac = (i: number, p: number) => Math.min(1, sc.auto * p + extra[i]);

    // the engine credits at least the auto share whenever the phase ends, so an early «Готово» sends (and freezes
    // the bars at) the full auto share plus the scoops — otherwise scoops below auto·(1−p) would be lost
    const send = () => {
      if (done) return;
      done = true;
      window.clearInterval(holdIv);
      frozenP = 1;
      act({ a: "piles", fractions: sc.piles.map((_, i) => frac(i, 1)) });
      setSent(true);
    };

    const scoopFx = (i: number, c: number) => {
      const host = fxRef.current;
      const el = pileEls.current[i];
      if (!host || !el) return;
      const hr = host.getBoundingClientRect();
      const pr = el.getBoundingClientRect();
      const x = pr.left - hr.left + pr.width / 2;
      const y = pr.top - hr.top + pr.height * 0.42;
      const count = reducedNow ? 1 : 3;
      for (let n = 0; n < count; n++) {
        const s = document.createElement("span");
        s.textContent = icons[i][Math.floor(Math.random() * icons[i].length)];
        s.className = "pointer-events-none absolute text-lg leading-none";
        s.style.left = `${x}px`;
        s.style.top = `${y}px`;
        host.appendChild(s);
        const dx = (Math.random() - 0.5) * 90;
        const dy = -50 - Math.random() * 60;
        const a = s.animate(
          [
            { transform: "translate(-50%,-50%) scale(.5)", opacity: 1 },
            { transform: `translate(calc(-50% + ${dx * 0.6}px), calc(-50% + ${dy}px)) scale(1.1)`, opacity: 1, offset: 0.45 },
            { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy * 0.3 + 50}px)) scale(.7)`, opacity: 0 },
          ],
          { duration: 700, easing: "cubic-bezier(.2,.7,.3,1)" },
        );
        a.onfinish = () => s.remove();
      }
      const t = document.createElement("span");
      t.textContent = c >= 1 ? "Чисто!" : `+${Math.round(STEP * 100)}%`;
      t.className = "pointer-events-none absolute font-mono text-xs font-bold text-good";
      t.style.left = `${x}px`;
      t.style.top = `${y - 26}px`;
      host.appendChild(t);
      const ta = t.animate(
        [
          { transform: "translate(-50%,0)", opacity: 1 },
          { transform: "translate(-50%,-30px)", opacity: 0 },
        ],
        { duration: 600, easing: "ease-out" },
      );
      ta.onfinish = () => t.remove();
      if (!reducedNow) el.animate([{ transform: "scale(1)" }, { transform: "scale(.93,1.06)" }, { transform: "scale(1)" }], { duration: 170, easing: "ease-out" });
    };

    const scoop = (i: number) => {
      if (done) return;
      const p = clamp(clock() / dur);
      if (frac(i, p) >= 1) return;
      extra[i] += STEP;
      const c = frac(i, p);
      sfx.blip(Math.round(c * 12));
      scoopFx(i, c);
    };

    api.current = {
      press: (i) => {
        window.clearInterval(holdIv);
        scoop(i);
        holdIv = window.setInterval(() => scoop(i), 1000 / HOLD_RATE);
      },
      release: () => window.clearInterval(holdIv),
      send,
    };

    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const t = clock();
      const p = clamp(t / dur);
      let changed = false;
      for (let i = 0; i < sc.piles.length; i++) {
        const c = frac(i, done ? frozenP : p);
        const bar = barEls.current[i];
        if (bar) bar.style.width = `${(c * 100).toFixed(1)}%`;
        const pct = pctEls.current[i];
        if (pct) pct.textContent = fmtPct(c);
        const heap = heapEls.current[i];
        if (heap) heap.style.transform = `scaleY(${(1 - 0.72 * c).toFixed(3)})`;
        if (c >= 0.999 && !isFull[i]) {
          isFull[i] = true;
          changed = true;
          if (!done) sfx.tin();
        }
      }
      if (changed) setFull([...isFull]);
      if (timerRef.current) timerRef.current.textContent = fmtTime(Math.ceil(Math.max(0, dur - t)));
      for (let n = 0; n < cartEls.current.length; n++) {
        const el = cartEls.current[n];
        if (!el) continue;
        const v = helper ? 24 : 55 + hash01(n, 7) * 55;
        const span = railW + 100;
        const x = ((t * v + hash01(n, 3) * span) % span) - 50;
        el.style.transform = `translateX(${x.toFixed(1)}px)`;
      }
      if (!done && sc.phase === "piles" && t >= dur) send();
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(holdIv);
      ro.disconnect();
      api.current = null;
    };
  }, [sc]);

  const rating = sc.haul && sc.id !== "capsule" ? RATING_TABLE.find((r) => r.id === sc.haul?.rating) : undefined;

  return (
    <div className="absolute inset-0">
      <TrainDust intensity={0.22} />
      <div className="pointer-events-none absolute inset-0 bg-black/45" />
      {!reduced && <div className="pointer-events-none absolute inset-0 bg-[#fff1d0]/10" style={{ animation: "rr-flicker 1.2s steps(1) 1 forwards" }} />}
      <div className="relative z-10 flex h-full flex-col gap-1.5 p-2 md:p-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h3 className="font-display text-lg font-bold tracking-wide text-brass-light">Разбор завалов</h3>
          <span className="rounded border border-line bg-black/40 px-1.5 py-0.5 font-mono text-xs text-parchment tabular">
            ⏱ <span ref={timerRef}>{fmtTime(Math.ceil(sc.phaseEnds - sc.phaseStart))}</span>
          </span>
          {sc.haul && (
            <span className="text-xs text-parchment-dim">
              Поймано {fmtInt(sc.haul.caughtCount)}/{fmtInt(sc.haul.totalCount)} ({fmtPct(sc.share)})
              {rating && rating.id !== "none" && (
                <span className="ml-1.5 font-bold text-brass-light">
                  {rating.icon} {rating.name}
                  {rating.bonus > 0 && ` +${fmtPct(rating.bonus)}`}
                </span>
              )}
            </span>
          )}
        </div>
        <p className="text-[11px] text-parchment-dim md:text-xs">Поезд ушёл, пыль оседает. Жмите на кучи — или зажмите, чтобы грести без устали. Вагонетки вывезут {fmtPct(sc.auto)} и без вас.</p>

        <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-3 gap-1.5 overflow-y-auto pb-1 sm:grid-cols-4 lg:grid-cols-6">
          {piles.map((pl) => (
            <button
              key={pl.i}
              type="button"
              ref={(el) => {
                pileEls.current[pl.i] = el;
              }}
              disabled={sent}
              aria-label={`Куча из вагона «${pl.car}»: разгрести`}
              onPointerDown={(e) => {
                e.preventDefault();
                api.current?.press(pl.i);
              }}
              onPointerUp={() => api.current?.release()}
              onPointerLeave={() => api.current?.release()}
              onPointerCancel={() => api.current?.release()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  api.current?.press(pl.i);
                  api.current?.release();
                }
              }}
              onContextMenu={(e) => e.preventDefault()}
              className={cx(
                // pan-y: a swipe that starts on a pile still scrolls the grid (the pan fires pointercancel → release)
                "relative flex min-h-[112px] touch-pan-y select-none flex-col items-stretch justify-end gap-1 rounded-lg border bg-gradient-to-b from-black/10 to-black/45 px-1.5 pb-1.5 pt-1 text-left transition-colors",
                full[pl.i] ? "border-good/60" : "border-line hover:border-brass",
              )}
            >
              <span className="absolute left-1.5 top-1 text-sm leading-none opacity-80" title={pl.car}>
                {pl.icon}
              </span>
              <div
                ref={(el) => {
                  heapEls.current[pl.i] = el;
                }}
                className="relative mx-auto h-12 w-full origin-bottom"
              >
                <svg viewBox="0 0 100 50" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden>
                  <path d="M2 50 C 14 34, 26 12, 50 8 C 74 12, 86 34, 98 50 Z" fill="#3a2f25" />
                  <path d="M14 40 C 26 26, 38 16, 50 14 C 62 16, 72 24, 82 36" fill="none" stroke="#5a4a3a" strokeWidth="2" />
                  <path d="M2 50 C 14 34, 26 12, 50 8" fill="none" stroke="rgba(232,201,131,.25)" strokeWidth="1.5" />
                </svg>
                {pl.top.slice(0, 3).map(([r], j) => (
                  <span key={r} className="absolute text-xl leading-none drop-shadow" style={{ left: `${[50, 26, 72][j]}%`, top: `${[2, 30, 32][j]}%`, transform: "translateX(-50%)" }}>
                    {RESOURCES[r].icon}
                  </span>
                ))}
              </div>
              <div className="flex flex-wrap justify-center gap-x-1.5 font-mono text-[10px] leading-tight tabular">
                {pl.top.slice(0, 2).map(([r, v]) => (
                  <span key={r} style={{ color: RESOURCES[r].color }}>
                    {RESOURCES[r].icon}
                    {fmt(v * k)}
                  </span>
                ))}
              </div>
              <div className="relative h-2 w-full overflow-visible rounded-full bg-black/60 shadow-[inset_0_1px_2px_rgba(0,0,0,.7)]">
                <div
                  ref={(el) => {
                    barEls.current[pl.i] = el;
                  }}
                  className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-verdigris to-good"
                  style={{ width: "0%" }}
                />
                <div className="absolute -inset-y-0.5 w-0.5 bg-brass-light/80" style={{ left: `${(sc.auto * 100).toFixed(1)}%` }} title="автосбор" />
              </div>
              <span
                ref={(el) => {
                  pctEls.current[pl.i] = el;
                }}
                className="text-center font-mono text-[10px] text-parchment-dim tabular"
              >
                0%
              </span>
              {full[pl.i] && (
                <span className="pointer-events-none absolute right-1 top-1" style={{ animation: reduced ? undefined : "rr-stamp .4s ease-out both" }}>
                  <Stamp color="var(--good)">Чисто</Stamp>
                </span>
              )}
            </button>
          ))}
        </div>

        {/* narrow-gauge rail with the carts */}
        <div ref={railRef} className="pointer-events-none relative h-11 shrink-0 overflow-hidden" aria-hidden>
          <div className="absolute inset-x-0 bottom-2 h-1 bg-[repeating-linear-gradient(90deg,#3a2e22_0_6px,transparent_6px_14px)]" />
          <div className="absolute inset-x-0 bottom-3 h-[3px] bg-gradient-to-b from-[#a9a296] to-[#55504a]" />
          {(carts > 0 ? Array.from({ length: carts }, (_, n) => n) : [0]).map((n) => (
            <div
              key={n}
              ref={(el) => {
                cartEls.current[n] = el;
              }}
              className="absolute bottom-3 left-0 flex flex-col items-center"
            >
              {carts > 0 ? <Cart icon={cartIcons[n % cartIcons.length]} /> : <PawHelper />}
            </div>
          ))}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <span className="min-w-0 flex-1 text-[11px] text-parchment-dim md:text-xs">
            {carts > 0 ? `Вагонеток на узкоколейке: ${fmtInt(carts)}` : "Узкоколейки нет — таскаем лапами"} · автосбор {fmtPct(sc.auto)}
          </span>
          <BrassButton size="lg" className="min-h-11" disabled={sent} onClick={() => api.current?.send()}>
            Готово
          </BrassButton>
        </div>
      </div>
      <div ref={fxRef} className="pointer-events-none absolute inset-0 z-20 overflow-hidden" />
    </div>
  );
}

function Cart({ icon }: { icon: string }) {
  return (
    <div className="relative h-7 w-11">
      <span className="absolute -top-2 left-1/2 -translate-x-1/2 text-sm leading-none">{icon}</span>
      <svg viewBox="0 0 44 28" className="absolute inset-0 h-full w-full" aria-hidden>
        <path d="M3 6 H41 L37 20 H7 Z" fill="#7d5f2c" stroke="#3a2a12" strokeWidth="1.5" />
        <path d="M5 9 H39" stroke="#e8c983" strokeWidth="1" opacity=".6" />
        <circle cx="13" cy="23" r="4" fill="#2a241f" stroke="#8a8073" strokeWidth="1.5" />
        <circle cx="31" cy="23" r="4" fill="#2a241f" stroke="#8a8073" strokeWidth="1.5" />
      </svg>
    </div>
  );
}

function PawHelper() {
  return (
    <div className="flex flex-col items-center leading-none">
      <span className="text-[9px] text-parchment-dim">лапами</span>
      <span className="text-xl" style={{ animation: "rr-bob .5s ease-in-out infinite" }}>
        🐀
      </span>
    </div>
  );
}

const PilesPhase = memo(PilesPhaseImpl, (a, b) => a.scene.seq === b.scene.seq && a.scene.phaseStart === b.scene.phaseStart);
export default PilesPhase;
