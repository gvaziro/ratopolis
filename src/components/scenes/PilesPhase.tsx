"use client";

/**
 * «Разбор завалов» — the `piles` primitive as a race against a giant human: one pile per car with uncaught loot,
 * laid along a track strip in car order (engine pile leftmost). Every pile starts at the auto share (the engine pays
 * at least that anyway); a tap adds PILE_STEP, holding digs PILE_STEP·PILE_HOLD_RATE per second (engine/piles.ts).
 * «Путевой обходчик» enters from the left at LINEMAN_START and his hobnailed boot sweeps pile after pile away
 * («Сметено»: no more digging there). Narrow-gauge carts (one per rat_rail level, max 12) roll along the rail below.
 * «Готово», the last swept pile or the timer sends the fractions.
 * Keyboard: Tab / Shift-Tab walk the piles, holding Space digs the focused one, Enter is «Готово» (v3 SCN-5).
 * Everything per-frame goes through refs (bars, heaps, the boots) — React only hears about locks and full piles.
 * v3 SCN-1: the lineman, the carts and the digging run on the scene clock; while the game is held nothing is dug or swept.
 * SCN-4: the lineman grumbles (sfxCue3 'giantVoice', deeper) on his first sweep and every third; a pile's blips climb
 * one octave of the G-major scale from empty to full (blip(round(frac·7)), AUD-4).
 */
import { memo, useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { sfx } from "@/audio/sfx";
import { RATING_TABLE, TRAIN_CARS } from "@/game/data/events";
import { RESOURCES } from "@/game/data/resources";
import { unitValue } from "@/game/engine/economy";
import { entries } from "@/game/engine/formulas";
import { LINEMAN_END_FRAC, LINEMAN_START, PILE_HOLD_RATE, PILE_STEP, pileLockTime, stepPile } from "@/game/engine/piles";
import { sfxCue, sfxCue3 } from "@/game/fx";
import { useGame } from "@/game/store";
import type { ResId, Scene } from "@/game/types";
import { fmt, fmtInt, fmtPct } from "@/lib/format";
import { BrassButton, Stamp, cx } from "@/components/ui/kit";
import { TrainDust } from "./TrainBackdrop";
import { isControlTarget, isTypingTarget, pilesKey } from "./sceneInput";
import { act, clamp, hash01, keyboardUsed, makeClock, nearestStanding, noteKeyboard, sceneHeld, sceneNow, shake } from "./sceneUtils";

/** Narrowest pile slot before the strip wraps into another row (375 px phones: 6 piles in a row, 7+ → two rows). */
const MIN_SLOT = 56;
/** Below this slot width a pile drops its loot amounts. */
const COMPACT_SLOT = 76;
/** The lineman's stride: one footstep (and bob) every STEP_S seconds. */
const STEP_S = 0.45;
/** Hold juice: one flying scoop every this many seconds of digging. */
const HOLD_FX_S = 1 / PILE_HOLD_RATE;
/** Within this long after the piles show, Enter is taken as carried over from the catch (the hook's throw), not «Готово». */
const CARRY_MS = 400;

interface PileView {
  /** Car index (into sc.piles / sc.cars). */
  i: number;
  icon: string;
  car: string;
  top: [ResId, number][];
  /** Share of the whole leftover haul by market value. */
  share: number;
  /** Heap size factor 0.7–1.4 by value share. */
  scale: number;
}

function buildViews(sc: Scene): PileView[] {
  const raw: (Omit<PileView, "share" | "scale"> & { value: number })[] = [];
  sc.piles.forEach((pile, i) => {
    const list = entries(pile)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] * unitValue(b[0]) - a[1] * unitValue(a[0]));
    if (!list.length) return;
    const kind = sc.cars[i]?.kind ?? "capsule";
    const value = list.reduce((s, [r, v]) => s + v * Math.max(0.01, unitValue(r)), 0);
    raw.push({ i, icon: TRAIN_CARS[kind].icon, car: TRAIN_CARS[kind].name, top: list, value });
  });
  const total = raw.reduce((s, p) => s + p.value, 0);
  const best = raw.reduce((m, p) => Math.max(m, p.value), 0);
  return raw.map(({ value, ...p }) => ({ ...p, share: total > 0 ? value / total : 1 / raw.length, scale: best > 0 ? 0.7 + 0.7 * (value / best) : 1 }));
}

/** Columns of the strip for n piles at width w (rows are balanced: 7 piles → 4 + 3). */
function stripCols(n: number, w: number): number {
  if (n <= 0) return 1;
  const maxCols = Math.max(1, Math.floor(w / MIN_SLOT));
  const rows = Math.ceil(n / maxCols);
  return Math.ceil(n / rows);
}

function PilesPhaseImpl({ scene }: { scene: Scene }) {
  const [sc] = useState(scene);
  const reduced = useGame((s) => s.game.settings.reducedMotion);
  const railLvl = useGame((s) => s.game.buildings.rat_rail);
  const k = (1 + sc.ratingBonus) * sc.multiplier;
  const capsule = sc.id === "capsule";

  const [views] = useState(() => buildViews(sc));
  const n = views.length;
  const richest = n > 1 ? views.reduce((b, p, j) => (p.share > views[b].share ? j : b), 0) : -1;
  const cartIcons = n ? views.map((p) => RESOURCES[p.top[0][0]].icon) : ["🍞"];
  const carts = Math.min(12, railLvl);

  const barEls = useRef<(HTMLDivElement | null)[]>([]);
  const pctEls = useRef<(HTMLSpanElement | null)[]>([]);
  const heapEls = useRef<(HTMLDivElement | null)[]>([]);
  const pileEls = useRef<(HTMLButtonElement | null)[]>([]);
  const cartEls = useRef<(HTMLDivElement | null)[]>([]);
  const railRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const fxRef = useRef<HTMLDivElement>(null);
  const footRef = useRef<HTMLDivElement>(null);
  const etaRef = useRef<HTMLSpanElement>(null);
  const walkRef = useRef<HTMLDivElement>(null);
  const bootEls = useRef<(HTMLDivElement | null)[]>([]);
  const colsRef = useRef(n);
  const api = useRef<{ press: (j: number) => void; release: () => void; send: () => void } | null>(null);
  const [cols, setCols] = useState(n);
  const [slotW, setSlotW] = useState(120);
  const [full, setFull] = useState<boolean[]>(() => views.map(() => false));
  const [locked, setLocked] = useState<boolean[]>(() => views.map(() => false));
  const [sent, setSent] = useState(() => sc.phase !== "piles");
  const [kbd, setKbd] = useState(keyboardUsed);

  // strip layout: as many columns as fit (≥ MIN_SLOT each), balanced rows; the lineman reads the columns from a ref
  useLayoutEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      if (w <= 0) return;
      const c = stripCols(n, w);
      colsRef.current = c;
      setCols(c);
      setSlotW(Math.round(w / Math.max(1, c)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [n]);

  useEffect(() => {
    const g0 = useGame.getState().game;
    const reducedNow = g0.settings.reducedMotion;
    const helper = Math.min(12, g0.buildings.rat_rail) === 0;
    const clock = makeClock(sc.phaseStart);
    const dur = Math.max(0.5, sc.phaseEnds - sc.phaseStart);
    const endT = Math.max(LINEMAN_START + 0.1, LINEMAN_END_FRAC * dur);
    const auto = clamp(sc.auto);
    const frac = views.map(() => auto);
    const isFull = views.map(() => false);
    const isLocked = views.map(() => false);
    const icons = views.map((v) => v.top.map(([r]) => RESOURCES[r].icon));
    let done = sc.phase !== "piles";
    let holdK = -1;
    let holdAcc = 0;
    let lastStep = -1;
    let etaShown = "";
    let allAt = -1;
    /** Piles the boot has swept so far (the lineman's grumbles go by it). */
    let sweeps = 0;
    let prevT = clock();
    let railW = railRef.current?.clientWidth ?? 300;
    const ro = new ResizeObserver(() => {
      railW = railRef.current?.clientWidth ?? railW;
    });
    if (railRef.current) ro.observe(railRef.current);

    // pile j sits in column j % cols; the boot reaches every row of a column at once
    const lockAt = (j: number) => {
      const c = Math.max(1, colsRef.current);
      return pileLockTime(j % c, c, dur);
    };

    const send = () => {
      if (done) return;
      done = true;
      holdK = -1;
      const fractions = sc.piles.map(() => auto);
      views.forEach((v, j) => (fractions[v.i] = frac[j]));
      act({ a: "piles", fractions });
      setSent(true);
    };

    const hostXY = (el: Element, fy: number) => {
      const host = fxRef.current;
      if (!host) return null;
      const hr = host.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      return { host, x: r.left - hr.left + r.width / 2, y: r.top - hr.top + r.height * fy };
    };

    const floatText = (host: HTMLElement, x: number, y: number, text: string, cls: string) => {
      const t = document.createElement("span");
      t.textContent = text;
      t.className = `pointer-events-none absolute font-mono text-xs font-bold ${cls}`;
      t.style.left = `${x}px`;
      t.style.top = `${y}px`;
      host.appendChild(t);
      const a = t.animate(
        [
          { transform: "translate(-50%,0)", opacity: 1 },
          { transform: "translate(-50%,-30px)", opacity: 0 },
        ],
        { duration: 600, easing: "ease-out" },
      );
      a.onfinish = () => t.remove();
    };

    const scoopFx = (j: number, gain: number) => {
      const el = pileEls.current[j];
      const p = el && hostXY(el, 0.42);
      if (!el || !p) return;
      const count = reducedNow ? 1 : 3;
      for (let m = 0; m < count; m++) {
        const s = document.createElement("span");
        s.textContent = icons[j][Math.floor(Math.random() * icons[j].length)] ?? "🍞";
        s.className = "pointer-events-none absolute text-lg leading-none";
        s.style.left = `${p.x}px`;
        s.style.top = `${p.y}px`;
        p.host.appendChild(s);
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
      floatText(p.host, p.x, p.y - 26, frac[j] >= 1 ? "Чисто!" : `+${Math.round(gain * 100)}%`, "text-good");
      if (!reducedNow) el.animate([{ transform: "scale(1)" }, { transform: "scale(.93,1.06)" }, { transform: "scale(1)" }], { duration: 170, easing: "ease-out" });
    };

    /** Grey dust rolling out from under a boot (skipped for reduced motion). */
    const dust = (host: HTMLElement, x: number, y: number, count: number, spread: number) => {
      if (reducedNow) return;
      for (let m = 0; m < count; m++) {
        const d = document.createElement("span");
        const size = 14 + Math.random() * 18;
        d.className = "pointer-events-none absolute rounded-full";
        d.style.cssText = `left:${x}px;top:${y}px;width:${size}px;height:${size}px;background:radial-gradient(circle,rgba(190,172,140,.55),rgba(150,132,104,0) 70%)`;
        host.appendChild(d);
        const dx = (Math.random() - 0.5) * spread;
        const dy = -10 - Math.random() * 26;
        const a = d.animate(
          [
            { transform: "translate(-50%,-50%) scale(.4)", opacity: 0.9 },
            { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(1.8)`, opacity: 0 },
          ],
          { duration: 650 + Math.random() * 300, easing: "ease-out" },
        );
        a.onfinish = () => d.remove();
      }
    };

    const lock = (j: number, quiet: boolean) => {
      isLocked[j] = true;
      if (holdK === j) holdK = -1;
      if (quiet) return;
      // SCN-4: the lineman grumbles over his first sweep and every third after it
      if (!done && sweeps++ % 3 === 0) sfxCue3("giantVoice", { pitch: 0.9 });
      const el = pileEls.current[j];
      if (el) {
        const p = hostXY(el, 0.7);
        if (p) dust(p.host, p.x, p.y, 7, 110);
        // the boot came down on the pile with the keyboard focus: hand the focus to the nearest pile still standing
        // (either way — in a wrapped strip a later pile in a short last row is swept before the end of row one)
        if (document.activeElement === el) {
          const next = nearestStanding(isLocked, j);
          const target = next >= 0 ? pileEls.current[next] : footRef.current?.querySelector("button");
          target?.focus();
        }
      }
      if (!done && !isFull[j]) sfxCue("stamp");
    };

    // a reload mid-phase: piles the boot already passed stand swept, silently
    {
      const t0 = clock();
      views.forEach((_, j) => {
        if (done || t0 >= lockAt(j)) lock(j, true);
      });
      if (isLocked.some(Boolean)) setLocked([...isLocked]);
    }

    api.current = {
      press: (j) => {
        if (done || sceneHeld() || isLocked[j] || j < 0 || j >= views.length) return;
        holdK = j;
        holdAcc = 0;
        if (frac[j] >= 1) return;
        const before = frac[j];
        frac[j] = stepPile(frac[j], 0, false, 1, auto);
        sfx.blip(Math.round(frac[j] * 7));
        scoopFx(j, frac[j] - before);
      },
      release: () => {
        holdK = -1;
      },
      // the player's «Готово» (the clock's own send below is never held: the clock stands still meanwhile)
      send: () => {
        if (!sceneHeld()) send();
      },
    };

    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const t = clock();
      const dt = Math.max(0, t - prevT);
      prevT = t;

      // digging the held pile (only up to the moment the boot reaches it)
      if (!done && holdK >= 0 && !isLocked[holdK] && frac[holdK] < 1) {
        const span = Math.max(0, Math.min(t, lockAt(holdK)) - (t - dt));
        if (span > 0) {
          const before = frac[holdK];
          frac[holdK] = stepPile(frac[holdK], span, true, 0, auto);
          holdAcc += span;
          if (holdAcc >= HOLD_FX_S) {
            holdAcc %= HOLD_FX_S;
            sfx.blip(Math.round(frac[holdK] * 7));
            scoopFx(holdK, Math.max(PILE_STEP, frac[holdK] - before));
          }
        }
      }

      // the lineman: walks in from the left, sweeps every pile he reaches, walks off to the right
      let lockedNow = false;
      if (!done) {
        for (let j = 0; j < views.length; j++) {
          if (!isLocked[j] && t >= lockAt(j)) {
            lock(j, false);
            lockedNow = true;
          }
        }
      }
      if (lockedNow) setLocked([...isLocked]);
      const xWalk = (t - LINEMAN_START) / (endT - LINEMAN_START);
      const walk = walkRef.current;
      if (walk) {
        const x = t < LINEMAN_START ? -0.35 * clamp((LINEMAN_START - t) / 0.7) : Math.min(1.6, xWalk);
        const hidden = t < LINEMAN_START - 0.7 || x >= 1.6;
        walk.style.visibility = hidden ? "hidden" : "visible";
        walk.style.transform = `translateX(${(x * 100).toFixed(2)}%)`;
        const stepIdx = t >= LINEMAN_START ? Math.floor((t - LINEMAN_START) / STEP_S) : -1;
        const f = t >= LINEMAN_START ? ((t - LINEMAN_START) / STEP_S) % 1 : 0;
        for (let b = 0; b < 2; b++) {
          const el = bootEls.current[b];
          if (!el) continue;
          // the front boot (b = 1) lifts on even steps, the back one on odd steps
          const up = !reducedNow && stepIdx >= 0 && stepIdx % 2 === (b === 1 ? 0 : 1) ? Math.sin(f * Math.PI) : 0;
          el.style.transform = up > 0 ? `translateY(${(-up * 16).toFixed(1)}px) rotate(${(-up * 7).toFixed(1)}deg)` : "";
        }
        if (stepIdx > lastStep && !hidden) {
          if (lastStep >= 0 || stepIdx === 0) {
            sfxCue("footstep", { intensity: 0.4 });
            shake(1, 140);
            const planted = bootEls.current[stepIdx % 2 === 0 ? 0 : 1];
            const p = planted && hostXY(planted, 0.92);
            if (p) dust(p.host, p.x, p.y, 3, 60);
          }
          lastStep = stepIdx;
        }
      }

      // the countdown to the next pile still standing
      let next = Infinity;
      for (let j = 0; j < views.length; j++) if (!isLocked[j]) next = Math.min(next, lockAt(j));
      const eta = Number.isFinite(next) && !done ? `Обходчик дойдёт через ${Math.max(0, Math.ceil(next - t))} с` : "Обходчик всё смёл";
      if (eta !== etaShown && etaRef.current) {
        etaShown = eta;
        etaRef.current.textContent = eta;
      }

      let changed = false;
      for (let j = 0; j < views.length; j++) {
        const c = frac[j];
        const bar = barEls.current[j];
        if (bar) bar.style.width = `${(c * 100).toFixed(1)}%`;
        const pct = pctEls.current[j];
        if (pct) pct.textContent = fmtPct(c);
        const heap = heapEls.current[j];
        if (heap) heap.style.transform = `scaleY(${(1 - 0.72 * c).toFixed(3)})`;
        if (c >= 0.999 && !isFull[j]) {
          isFull[j] = true;
          changed = true;
          if (!done) sfx.tin();
        }
      }
      if (changed) setFull([...isFull]);

      for (let m = 0; m < cartEls.current.length; m++) {
        const el = cartEls.current[m];
        if (!el) continue;
        const v = helper ? 24 : 55 + hash01(m, 7) * 55;
        const span = railW + 100;
        const x = ((t * v + hash01(m, 3) * span) % span) - 50;
        el.style.transform = `translateX(${x.toFixed(1)}px)`;
      }

      // nothing left to dig: the stamp lands, then the fractions go
      if (!done && views.length > 0 && isLocked.every(Boolean)) {
        if (allAt < 0) allAt = t;
        else if (t - allAt >= 0.6) send();
      }
      if (!done && t >= dur) send();
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      api.current = null;
    };
  }, [sc, views]);

  // came over from the catch on the keyboard: start on the first pile
  useEffect(() => {
    if (keyboardUsed()) pileEls.current.find((el) => el && el.tabIndex >= 0)?.focus();
  }, []);

  // SCN-5: Enter is «Готово» from anywhere in the phase (a focused pile handles it itself, a focused button clicks)
  const shownAt = useRef(0);
  useEffect(() => {
    shownAt.current = sceneNow();
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      const el = e.target as Element | null;
      if (isTypingTarget(el) || isControlTarget(el) || pilesKey(e.key) !== "done") return;
      e.preventDefault();
      if (sceneNow() - shownAt.current >= CARRY_MS) api.current?.send();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const rating = sc.haul && !capsule ? RATING_TABLE.find((r) => r.id === sc.haul?.rating) : undefined;
  // a keyboard player lands on the first pile still standing (SceneHost's [data-autofocus])
  const firstStanding = sent ? -1 : locked.findIndex((l) => !l);
  const compact = slotW < COMPACT_SLOT;
  const rows = Math.max(1, Math.ceil(n / Math.max(1, cols)));

  return (
    <div
      className="absolute inset-0"
      onKeyDownCapture={() => {
        noteKeyboard(true);
        if (!kbd) setKbd(true);
      }}
      onPointerDownCapture={() => {
        noteKeyboard(false);
        if (kbd) setKbd(false);
      }}
    >
      <TrainDust intensity={0.22} />
      <div className="pointer-events-none absolute inset-0 bg-black/45" />
      {!reduced && <div className="pointer-events-none absolute inset-0 bg-[#fff1d0]/10" style={{ animation: "rr-flicker 1.2s steps(1) 1 forwards" }} />}
      <div className="relative z-10 flex h-full flex-col gap-1.5 p-2 md:p-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h3 className="font-display text-lg font-bold tracking-wide text-brass-light">Разбор завалов</h3>
          <span className="rounded border border-line bg-black/40 px-1.5 py-0.5 font-mono text-xs text-parchment tabular" aria-live="polite">
            🥾 <span ref={etaRef}>Обходчик на подходе</span>
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
        <p className="text-[11px] text-parchment-dim md:text-xs">
          {capsule ? "Капсула вскрыта, добро рассыпалось по уступу." : "Поезд ушёл, пыль оседает."} Жмите на кучи — или зажмите и гребите, пока {capsule ? "обходчик коллектора" : "путевой обходчик"} не смёл всё сапожищем. Вагонетки вывезут {fmtPct(sc.auto)} и без вас.
          {kbd && <span className="ml-1 whitespace-nowrap font-mono text-brass-light">⌨ Tab — куча, пробел — грести, Enter — готово</span>}
        </p>

        <div className="flex min-h-0 flex-1 flex-col justify-center overflow-y-auto overflow-x-hidden pb-1 pt-3">
          <div ref={stripRef} className="relative">
            <div className="grid gap-x-1 gap-y-2" style={{ gridTemplateColumns: `repeat(${Math.max(1, cols)}, minmax(0, 1fr))` }}>
              {views.map((pl, j) => {
                const isLocked = locked[j];
                const isFull = full[j];
                const inert = sent || isLocked;
                return (
                  <div key={pl.i} className="relative flex flex-col">
                    <button
                      type="button"
                      ref={(el) => {
                        pileEls.current[j] = el;
                      }}
                      tabIndex={inert ? -1 : 0}
                      data-autofocus={j === firstStanding ? "" : undefined}
                      aria-disabled={inert}
                      aria-label={`Куча из вагона «${pl.car}», ${fmtPct(pl.share)} улова: ${isLocked ? "сметено" : "разгрести"}`}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        api.current?.press(j);
                      }}
                      onPointerUp={() => api.current?.release()}
                      onPointerLeave={() => api.current?.release()}
                      onPointerCancel={() => api.current?.release()}
                      onBlur={() => api.current?.release()}
                      onKeyDown={(e) => {
                        const k = pilesKey(e.key);
                        if (!k) return;
                        e.preventDefault();
                        if (e.repeat) return;
                        // Enter: «Готово» (unless it is still the throw carried over from the catch); Space: dig
                        if (k === "done") {
                          if (sceneNow() - shownAt.current >= CARRY_MS) api.current?.send();
                        } else api.current?.press(j);
                      }}
                      onKeyUp={(e) => {
                        if (e.key === " ") {
                          e.preventDefault();
                          api.current?.release();
                        }
                      }}
                      onContextMenu={(e) => e.preventDefault()}
                      className={cx(
                        // pan-y: a swipe that starts on a pile still scrolls the strip (the pan fires pointercancel → release)
                        "relative flex min-h-[118px] touch-pan-y select-none flex-col items-stretch justify-end gap-0.5 rounded-lg border bg-gradient-to-b from-[#1d1712]/80 to-[#0d0a08]/90 px-1 pb-1 pt-4 text-left outline-none transition-[border-color,opacity,filter] focus-visible:ring-2 focus-visible:ring-gaslight",
                        isFull ? "border-good/60" : isLocked ? "border-line/50" : j === richest ? "border-brass/80 hover:border-brass-light" : "border-line hover:border-brass",
                        isLocked && !isFull && "opacity-70 saturate-50",
                      )}
                    >
                      <span className="absolute left-1 top-0.5 text-sm leading-none opacity-80" title={pl.car}>
                        {pl.icon}
                      </span>
                      {j === richest && (
                        <span
                          className={cx(
                            "absolute whitespace-nowrap rounded-sm bg-brass px-1 font-display font-bold leading-[1.3] text-soot shadow-[0_1px_3px_rgba(0,0,0,.6)]",
                            compact ? "-top-2.5 left-1/2 -translate-x-1/2 text-[8px]" : "right-1 top-0.5 text-[9px] uppercase tracking-wide",
                          )}
                        >
                          жирная куча
                        </span>
                      )}
                      <div className="relative flex h-[54px] items-end justify-center">
                        <div
                          ref={(el) => {
                            heapEls.current[j] = el;
                          }}
                          className="relative origin-bottom"
                          style={{ width: `${(pl.scale * 66).toFixed(1)}%`, height: `${(pl.scale * 34).toFixed(1)}px` }}
                        >
                          <svg viewBox="0 0 100 50" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden>
                            <path d="M2 50 C 14 34, 26 12, 50 8 C 74 12, 86 34, 98 50 Z" fill="#3a2f25" />
                            <path d="M14 40 C 26 26, 38 16, 50 14 C 62 16, 72 24, 82 36" fill="none" stroke="#5a4a3a" strokeWidth="2" />
                            <path d="M2 50 C 14 34, 26 12, 50 8" fill="none" stroke="rgba(232,201,131,.25)" strokeWidth="1.5" />
                          </svg>
                          {pl.top.slice(0, 3).map(([r], m) => (
                            <span
                              key={r}
                              className="absolute leading-none drop-shadow"
                              style={{ left: `${[50, 24, 76][m]}%`, top: `${[-18, 18, 22][m]}%`, transform: "translateX(-50%)", fontSize: `${(12 + 6 * pl.scale).toFixed(0)}px` }}
                            >
                              {RESOURCES[r].icon}
                            </span>
                          ))}
                        </div>
                      </div>
                      {!compact && (
                        <div className="flex flex-wrap justify-center gap-x-1.5 font-mono text-[10px] leading-tight tabular">
                          {pl.top.slice(0, 2).map(([r, v]) => (
                            <span key={r} style={{ color: RESOURCES[r].color }}>
                              {RESOURCES[r].icon}
                              {fmt(v * k)}
                            </span>
                          ))}
                        </div>
                      )}
                      <span className={cx("text-center font-mono font-bold leading-tight text-parchment tabular", compact ? "text-[9px]" : "text-[10px]")}>{fmtPct(pl.share)} улова</span>
                      <div className="relative h-2 w-full overflow-visible rounded-full bg-black/60 shadow-[inset_0_1px_2px_rgba(0,0,0,.7)]">
                        <div
                          ref={(el) => {
                            barEls.current[j] = el;
                          }}
                          className={cx("absolute inset-y-0 left-0 rounded-full bg-gradient-to-r", isLocked && !isFull ? "from-[#5d6b5a] to-[#7b8c73]" : "from-verdigris to-good")}
                          style={{ width: `${(sc.auto * 100).toFixed(1)}%` }}
                        />
                        <div className="absolute -inset-y-0.5 w-0.5 bg-brass-light/80" style={{ left: `${(sc.auto * 100).toFixed(1)}%` }} title="автосбор" />
                      </div>
                      <span
                        ref={(el) => {
                          pctEls.current[j] = el;
                        }}
                        className="text-center font-mono text-[10px] leading-tight text-parchment-dim tabular"
                      >
                        {fmtPct(sc.auto)}
                      </span>
                      {isFull ? (
                        <span className="pointer-events-none absolute inset-x-0 top-[34%] flex justify-center" style={{ animation: reduced ? "rr-fadein .3s ease-out both" : "rr-stamp .4s ease-out both" }}>
                          <Stamp color="var(--good)">Чисто</Stamp>
                        </span>
                      ) : (
                        isLocked && (
                          <span className="pointer-events-none absolute inset-x-0 top-[30%] flex justify-center" style={{ animation: reduced ? "rr-fadein .4s ease-out both" : "rr-stamp .4s ease-out both" }}>
                            <Stamp color="var(--danger-light)" className={cx("bg-soot/75", compact ? "px-0.5 text-[8px] tracking-normal" : "px-1.5 text-[11px]")}>
                              Сметено
                            </Stamp>
                          </span>
                        )
                      )}
                    </button>
                    {/* the track under the strip: each pile's stretch of rail and sleepers joins its neighbours' */}
                    <div className="pointer-events-none absolute -bottom-2 -left-[3px] -right-[3px] h-2" aria-hidden>
                      <div className="absolute inset-x-0 bottom-0 h-1 bg-[repeating-linear-gradient(90deg,#3a2e22_0_7px,transparent_7px_13px)]" />
                      <div className="absolute inset-x-0 bottom-1 h-[3px] bg-gradient-to-b from-[#b4ad9f] to-[#55504a]" />
                    </div>
                  </div>
                );
              })}
            </div>
            {n > 0 && <Lineman walkRef={walkRef} bootEls={bootEls} rows={rows} />}
          </div>
        </div>

        {/* narrow-gauge rail with the carts */}
        <div ref={railRef} className="pointer-events-none relative h-11 shrink-0 overflow-hidden" aria-hidden>
          <div className="absolute inset-x-0 bottom-2 h-1 bg-[repeating-linear-gradient(90deg,#3a2e22_0_6px,transparent_6px_14px)]" />
          <div className="absolute inset-x-0 bottom-3 h-[3px] bg-gradient-to-b from-[#a9a296] to-[#55504a]" />
          {(carts > 0 ? Array.from({ length: carts }, (_, m) => m) : [0]).map((m) => (
            <div
              key={m}
              ref={(el) => {
                cartEls.current[m] = el;
              }}
              className="absolute bottom-3 left-0 flex flex-col items-center"
            >
              {carts > 0 ? <Cart icon={cartIcons[m % cartIcons.length]} /> : <PawHelper />}
            </div>
          ))}
        </div>

        <div ref={footRef} className="flex shrink-0 items-center gap-2">
          <span className="min-w-0 flex-1 text-[11px] text-parchment-dim md:text-xs">
            {carts > 0 ? `Вагонеток на узкоколейке: ${fmtInt(carts)}` : "Узкоколейки нет — таскаем лапами"} · автосбор {fmtPct(sc.auto)}
          </span>
          <BrassButton
            size="lg"
            className="min-h-11"
            aria-keyshortcuts="Enter"
            disabled={sent}
            onKeyDown={(e) => {
              // the focus lands here when the last pile is swept: a Space still held from digging must not send
              if ((e.key === " " || e.key === "Enter") && e.repeat) e.preventDefault();
            }}
            onClick={() => api.current?.send()}
          >
            Готово
          </BrassButton>
        </div>
      </div>
      <div ref={fxRef} className="pointer-events-none absolute inset-0 z-20 overflow-hidden" />
    </div>
  );
}

/**
 * «Путевой обходчик»: a pair of giant hobnailed boots (each ~18% of the strip), trouser hems coming down from the top
 * edge and a lantern beam ahead. The walker element spans the strip, so translateX(x·100%) puts the front boot's
 * sweep point at x of the strip width; PilesPhase moves it and bobs the boots through refs.
 */
const Lineman = memo(function Lineman({
  walkRef,
  bootEls,
  rows,
}: {
  walkRef: RefObject<HTMLDivElement | null>;
  bootEls: RefObject<(HTMLDivElement | null)[]>;
  rows: number;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  return (
    <div
      className="pointer-events-none absolute inset-x-0 -bottom-2 -top-4 z-10 overflow-hidden"
      style={{ maskImage: "linear-gradient(to bottom, transparent, #000 22px)", WebkitMaskImage: "linear-gradient(to bottom, transparent, #000 22px)" }}
      aria-hidden
    >
      <div ref={walkRef} className="absolute inset-0" style={{ visibility: "hidden", willChange: "transform" }}>
        {/* lantern beam, slanting ahead onto the piles he is about to reach */}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute left-[3%] top-0 h-full w-[30%]" style={{ mixBlendMode: "screen" }}>
          <defs>
            <linearGradient id={`${uid}b`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="rgba(255,226,150,.55)" />
              <stop offset="100%" stopColor="rgba(255,200,100,0)" />
            </linearGradient>
            <radialGradient id={`${uid}p`} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="rgba(255,222,140,.35)" />
              <stop offset="100%" stopColor="rgba(255,200,100,0)" />
            </radialGradient>
          </defs>
          <polygon points="0,0 9,0 100,100 22,100" fill={`url(#${uid}b)`} />
          <ellipse cx="62" cy="97" rx="40" ry="8" fill={`url(#${uid}p)`} />
        </svg>
        {/* the lantern itself, swinging low at the top edge */}
        <div className="absolute left-[1%] top-2 h-7 w-5 -translate-x-1/2">
          <div className="mx-auto h-2 w-px bg-[#2a2420]" />
          <div className="h-4 w-5 rounded-sm border border-[#4a3a2a] bg-gaslight shadow-[0_0_16px_6px_rgba(242,184,75,.45)]" />
        </div>
        {[0, 1].map((b) => (
          <div key={b} className="absolute bottom-0 w-[18%]" style={{ left: b === 1 ? "-10.8%" : "-27%" }}>
            <div
              ref={(el) => {
                bootEls.current[b] = el;
              }}
              className="relative origin-bottom-left"
            >
              {/* trouser leg from the top edge, with a turned-up hem */}
              <div
                className="absolute bottom-[58%] left-[16%] w-[46%] bg-[repeating-linear-gradient(90deg,#2c2a30_0_7px,#34323a_7px_8px)] shadow-[inset_-6px_0_10px_rgba(0,0,0,.55),inset_4px_0_6px_rgba(255,255,255,.04)]"
                style={{ height: `${120 * rows + 260}px` }}
              >
                <div className="absolute inset-x-[-4%] bottom-0 h-3 rounded-sm bg-gradient-to-b from-[#3d3a42] to-[#24222a] shadow-[0_2px_3px_rgba(0,0,0,.6)]" />
                <div className="absolute inset-y-0 left-1/2 w-px bg-black/30" />
              </div>
              <Boot back={b === 0} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});

/** One giant hobnailed boot, toe to the right (he walks left → right). */
const Boot = memo(function Boot({ back }: { back: boolean }) {
  return (
    <svg viewBox="0 0 120 76" className="relative block h-auto w-full drop-shadow-[0_6px_6px_rgba(0,0,0,.7)]" style={back ? { filter: "brightness(.8)" } : undefined}>
      <path d="M22 0 H60 V36 H22 Z" fill="#2a211b" />
      <path d="M20 10 H60 L62 34 C78 35 98 40 110 50 C116 55 116 61 111 63 H14 C10 52 13 30 20 10 Z" fill="#3b2c22" stroke="#140f0b" strokeWidth="2" />
      <path d="M84 41 C98 44 110 50 112 58 C112 61 110 63 107 63 H80 C82 55 82 47 84 41 Z" fill="#4a3829" />
      <path d="M58 13 L67 19 M58 19 L67 25 M58 25 L67 31 M67 13 L58 19 M67 19 L58 25" stroke="#9a8462" strokeWidth="1.6" />
      <path d="M26 14 C24 30 22 44 22 56" stroke="rgba(232,201,131,.2)" strokeWidth="3" fill="none" />
      <path d="M66 37 C82 39 98 45 106 53" stroke="rgba(255,240,200,.16)" strokeWidth="2" fill="none" />
      <rect x="10" y="62" width="106" height="6" rx="3" fill="#1a1410" />
      <rect x="12" y="66" width="38" height="9" rx="2" fill="#120e0b" />
      <rect x="56" y="66" width="58" height="6" rx="2" fill="#120e0b" />
      {[18, 28, 40, 62, 74, 86, 98, 108].map((x) => (
        <circle key={x} cx={x} cy={x < 52 ? 74 : 71} r="1.7" fill="#b9b2a6" />
      ))}
    </svg>
  );
});

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
