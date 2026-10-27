"use client";

/**
 * «Цели колонии» (top-left of the colony): the elder's hint with «Сделать», then the goals from goalModel (COL-2) —
 * what is worth building now, the expedition with its slowest resource (or «склад полон — внесите»: a click puts it
 * in), the crowns / the coronation, the Rat Express stage or the next wagon, the King's commission, the nearest
 * building and upgrade. Sampled once a second.
 * COL-2: compact by default — the hint and the first goal, the rest behind «+N цели ▾» (remembered for the session);
 * while it covers a built chamber and nobody has hovered or focused it for 6 s it fades to 0.55 (back on hover,
 * focus or a new goal). Shrinks to a pill when the grate leaves too little room beside it (always on phones), and
 * drops under the grate when even the pill would not fit there; the pill's popover closes with the system Back.
 */
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Bar, cx } from "@/components/ui/kit";
import type { Derived } from "@/game/engine/derive";
import { nextHint, type Hint } from "@/game/engine/hints";
import { onFx } from "@/game/fx";
import { derivedOf, useGame, type TabId } from "@/game/store";
import { BUILDING_IDS, RES_IDS, type GameState, type ResId } from "@/game/types";
import { useSampled } from "@/game/useSampled";
import { plural } from "@/lib/format";
import { useBackCloses } from "@/lib/useBackCloses";
import { camView, onCamera, type CamView } from "./camera";
import { BUILDING_SLOT, GRATE, SLOT_H, SLOT_W } from "./geometry";
import { etaText, goalModel, pillText, type Goal } from "./goalModel";

interface View {
  hint: Hint | null;
  goals: Goal[];
}

/** game.time since which each resource has sat at ≥ 99% of its limit (module state: there is one widget). */
const fullSince: Partial<Record<ResId, number>> = {};

/** Resources that have been ≥ 99% full for 30 s (the storage rule waits that long before it suggests a store). */
function longFull(s: GameState, d: Derived): Set<ResId> {
  const out = new Set<ResId>();
  for (const r of RES_IDS) {
    const cap = d.caps[r];
    if (!Number.isFinite(cap) || cap <= 0 || s.res[r] < 0.99 * cap) {
      delete fullSince[r];
      continue;
    }
    const since = fullSince[r];
    if (since === undefined || since > s.time) fullSince[r] = s.time;
    else if (s.time - since >= 30) out.add(r);
  }
  return out;
}

function computeView(s: GameState): string {
  const d = derivedOf(s);
  const hint = nextHint(s, d);
  if (!s.revealed.goal && !hint) return "";
  const v: View = { hint, goals: s.revealed.goal ? goalModel(s, d, longFull(s, d)) : [] };
  return JSON.stringify(v);
}

/* ------------------------------------------------------------ rendering */

const tabOpen = (tab: TabId) => tab === "settings" || !!useGame.getState().game.revealed[`tab_${tab}`];

/** A goal row's click: contribute the full stores it names, else open its tab at its card. */
function runGoal(g: Goal): void {
  const st = useGame.getState();
  const c = g.contribute;
  if (c) {
    if (c.kind === "expedition") {
      if (!c.res.length) st.contributeExpedition(c.zone);
      for (const r of c.res) st.contributeExpedition(c.zone, r);
    } else for (const r of c.res) st.contributeExpress(r);
    return;
  }
  if (tabOpen(g.tab)) st.focus(g.tab, g.target);
}

function HintRow({ h, onDone }: { h: Hint; onDone: () => void }) {
  const act = !!h.action && h.action.kind !== "focus";
  return (
    <div className="flex items-center gap-1.5 rounded border border-gaslight/50 bg-panel/85 py-1 pl-1.5 pr-1 shadow-[0_0_10px_rgba(242,184,75,.15)]">
      <span aria-hidden className="shrink-0 text-base leading-none">
        💡
      </span>
      <button
        type="button"
        data-nodrag=""
        title={`${h.text}. ${h.why}`}
        onClick={() => {
          onDone();
          useGame.getState().focus(h.tab, h.target);
        }}
        className="min-w-0 flex-1 text-left"
      >
        <span className="line-clamp-2 text-xs leading-snug text-parchment">{h.text}</span>
        <span className="block truncate text-[10px] leading-tight text-parchment-dim">{h.why}</span>
      </button>
      <button
        type="button"
        data-nodrag=""
        onClick={() => {
          onDone();
          if (act) useGame.getState().applyHint(h);
          else useGame.getState().focus(h.tab, h.target);
        }}
        aria-label={act ? `Сделать: ${h.text}` : `Открыть: ${h.text}`}
        className="flex h-10 min-w-10 shrink-0 items-center justify-center rounded border border-brass-light bg-[linear-gradient(#e8c983,#a07a3a)] px-2 font-display text-xs font-bold text-soot shadow-[0_2px_4px_rgba(0,0,0,.45)] hover:brightness-110 active:translate-y-px"
      >
        {act ? "Сделать" : "→"}
      </button>
    </div>
  );
}

function GoalRow({ g, onGo }: { g: Goal; onGo: (g: Goal) => void }) {
  const bad = g.locked || g.eta === -1;
  return (
    <button
      type="button"
      data-nodrag=""
      onClick={() => onGo(g)}
      aria-label={g.contribute ? `${g.name}: ${g.sub ?? "внести"}` : undefined}
      className={cx(
        "group flex min-h-10 w-full flex-col justify-center rounded border px-2 py-1 text-left transition hover:bg-panel-2",
        g.tone === "good" ? "border-good/50 bg-good/10 hover:border-good" : g.tone === "gold" ? "border-[#ffd34d]/60 bg-[#ffd34d]/10 hover:border-[#ffd34d]" : "border-line/60 bg-panel/70 hover:border-brass-dark",
      )}
    >
      <span className="flex w-full items-start gap-1.5 text-xs text-parchment">
        <span className={cx("shrink-0 text-sm leading-4", g.tone === "good" && "font-bold text-good")}>{g.icon}</span>
        <span className={cx("line-clamp-2 min-w-0 flex-1 leading-4", g.tone === "good" && "text-good", g.tone === "gold" && "font-bold text-[#ffd34d]")}>{g.name}</span>
        <span className={cx("shrink-0 font-mono text-[10px] leading-4 tabular", bad ? "text-danger-light" : g.tone === "gold" ? "text-[#ffd34d]" : "text-brass-light")}>{etaText(g)}</span>
      </span>
      {g.sub && (
        <span className={cx("mt-0.5 block w-full truncate text-[10px] leading-tight", g.warn ? "font-bold text-danger-light" : g.contribute ? "font-bold text-gaslight" : "text-parchment-dim")}>
          {g.contribute && <span aria-hidden>📥 </span>}
          {g.sub}
        </span>
      )}
      {g.tone !== "good" && <Bar value={g.frac} className="mt-1 h-1 w-full" color={g.tone === "gold" ? "#ffd34d" : g.tab === "map" ? "var(--verdigris)" : g.tab === "migration" ? "var(--gaslight)" : "var(--brass)"} />}
    </button>
  );
}

interface Layout {
  /** Free width left of the grate (px). */
  room: number;
  /** Bottom of the grate on screen (px), for the pill that drops under it. */
  under: number;
  cw: number;
  ch: number;
  /** Desktop layout (≥ 768 px). */
  wide: boolean;
}

/** The card fades after this long without hover or focus while it covers a built chamber. */
const FADE_IDLE_MS = 6000;
const FADE_TO = 0.55;

/** The card's rect (container px) overlaps a built chamber's niche at this camera. */
function coversChamber(g: GameState, v: Readonly<CamView>, r: { x: number; y: number; w: number; h: number }): boolean {
  if (v.cw <= 1 || r.w <= 0) return false;
  for (const id of BUILDING_IDS) {
    if (g.buildings[id] <= 0) continue;
    const slot = BUILDING_SLOT[id];
    if (!g.zones[slot.zone]) continue;
    const x0 = v.cw / 2 + (slot.cx - SLOT_W / 2 - v.cx) * v.s;
    const x1 = x0 + SLOT_W * v.s;
    const y1 = v.ch / 2 + (slot.floor - v.cy) * v.s;
    const y0 = y1 - SLOT_H * v.s;
    if (x0 < r.x + r.w && x1 > r.x && y0 < r.y + r.h && y1 > r.y) return true;
  }
  return false;
}

export const GoalWidget = memo(function GoalWidget() {
  const key = useSampled((s) => computeView(s.game), 1, Object.is);
  const view = useMemo(() => (key ? (JSON.parse(key) as View) : null), [key]);
  const bustle = useGame((s) => !!s.game.revealed.bustle);
  const [lay, setLay] = useState<Layout>({ room: 260, under: 0, cw: 800, ch: 600, wide: true });
  const [open, setOpen] = useState(false);
  // the full card shows the hint and the first goal; «+N цели ▾» unfolds the rest (remembered for the session)
  const [expanded, setExpanded] = useState(readExpanded);
  // a pressed hint hides until the next sample shows what is left to do (no double «Сделать»)
  const [doneHint, setDoneHint] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const fadeApi = useRef<{ hold: (by: "hover" | "focus", on: boolean) => void; wake: () => void } | null>(null);

  // width available left of the grate (so the widget never covers it)
  useEffect(
    () =>
      onCamera((v) => {
        const k = Math.max(1, 104 / (GRATE.w * v.s));
        const left = v.cw / 2 + (GRATE.x - (GRATE.w / 2 + 12) * k - v.cx) * v.s;
        const bottom = v.ch / 2 + (GRATE.y + 34 * k - v.cy) * v.s;
        const free = bottom < 0 ? 280 : Math.floor((left - 16) / 10) * 10;
        const next: Layout = { room: Math.max(56, Math.min(280, free)), under: Math.round(bottom / 4) * 4, cw: Math.round(v.cw), ch: Math.round(v.ch), wide: window.innerWidth >= 768 };
        setLay((p) => (p.room === next.room && p.under === next.under && p.cw === next.cw && p.ch === next.ch && p.wide === next.wide ? p : next));
      }),
    [],
  );

  // SH-4: Esc (the global hotkey event) folds the goal popover; mobile-14: so does the system Back on phones
  useEffect(() => {
    const close = () => setOpen(false);
    window.addEventListener("rr-escape", close);
    return () => window.removeEventListener("rr-escape", close);
  }, []);
  useBackCloses(open, () => setOpen(false));

  useEffect(() => {
    if (doneHint === null) return;
    const t = window.setTimeout(() => setDoneHint(null), 1500);
    return () => window.clearTimeout(t);
  }, [doneHint]);

  const compact = lay.room < 180 || !lay.wide;
  const hintKey = view?.hint ? `${view.hint.id}|${view.hint.text}` : null;
  const hint = view?.hint && hintKey !== doneHint ? view.hint : null;
  const shown = !!view && (view.goals.length > 0 || !!hint);

  // visuals-10: the card over a built chamber fades after 6 s without hover / focus (style written directly)
  useEffect(() => {
    const el = cardRef.current;
    if (compact || !shown || !el) return;
    // hover and keyboard focus hold the card each on its own (a pointer leaving must not drop a focus hold)
    const st = { hover: false, focus: false, idleFrom: performance.now(), over: false, timer: 0, r: { x: 0, y: 0, w: 0, h: 0 } };
    const apply = () => {
      window.clearTimeout(st.timer);
      let dim = false;
      if (st.over && !st.hover && !st.focus) {
        const left = FADE_IDLE_MS - (performance.now() - st.idleFrom);
        if (left <= 0) dim = true;
        else st.timer = window.setTimeout(apply, left + 30);
      }
      const want = dim ? String(FADE_TO) : "";
      if (el.style.opacity !== want) el.style.opacity = want;
    };
    const check = (v: Readonly<CamView>) => {
      const over = coversChamber(useGame.getState().game, v, st.r);
      if (over === st.over) return;
      st.over = over;
      apply();
    };
    const measure = () => {
      st.r = { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
      check(camView());
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    const offCam = onCamera(check);
    // a chamber built under the card
    const offFx = onFx((fx) => {
      if (fx.k === "buy") check(camView());
    });
    fadeApi.current = {
      hold: (by, on) => {
        const held = st.hover || st.focus;
        if (by === "hover") st.hover = on;
        // only a visible focus ring holds: a control clicked with the mouse lets the card fade once the pointer leaves
        // (re-read on every hover change too: a focused row that unmounts sends no blur)
        st.focus = by === "focus" && !on ? false : !!el.querySelector(":focus-visible");
        if (held && !st.hover && !st.focus) st.idleFrom = performance.now();
        apply();
      },
      wake: () => {
        st.idleFrom = performance.now();
        apply();
      },
    };
    return () => {
      fadeApi.current = null;
      window.clearTimeout(st.timer);
      ro.disconnect();
      offCam();
      offFx();
      el.style.opacity = "";
    };
  }, [compact, shown]);

  // a new first goal (or a new hint) wakes the faded card
  const lead = view ? `${view.hint?.id ?? ""}|${view.goals[0]?.key ?? ""}` : "";
  useEffect(() => {
    fadeApi.current?.wake();
  }, [lead]);

  if (!view || !shown) return null;
  const goals = view.goals;
  const { room } = lay;

  const go = (g: Goal) => {
    setOpen(false);
    runGoal(g);
  };
  const hintRow = hint ? <HintRow h={hint} onDone={() => setDoneHint(hintKey)} /> : null;

  if (compact) {
    const g = goals[0];
    // too tight even for the pill beside the grate: it drops under the grate (and under the Суета meter)
    const below = room < 96;
    const top = below ? Math.max(8, lay.under + (bustle ? 46 : 8)) : 8;
    const maxW = below || room >= 180 ? Math.min(260, lay.cw - 56) : room;
    return (
      <div className="absolute left-2 z-20" style={{ top }} data-nodrag="">
        <button
          type="button"
          data-nodrag=""
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label="Цели колонии и совет старейшины"
          className="flex h-10 min-w-0 items-center gap-1 rounded-full border border-brass-dark bg-soot-2/90 px-2.5 text-xs text-parchment shadow-[0_2px_8px_rgba(0,0,0,.45)]"
          style={{ maxWidth: Math.max(96, maxW) }}
        >
          {hint && (
            <span className="relative shrink-0 text-sm leading-none">
              💡
              <span aria-hidden className="cv-ping absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-gaslight" />
            </span>
          )}
          {g ? (
            <>
              <span className={cx("shrink-0 text-sm leading-none", g.tone === "good" && "font-bold text-good")}>{g.icon}</span>
              <span className={cx("min-w-0 truncate font-mono text-[11px] tabular", g.locked || g.eta === -1 || g.warn ? "text-danger-light" : g.tone === "good" ? "text-good" : "text-brass-light")}>{pillText(g)}</span>
            </>
          ) : (
            <span className="min-w-0 truncate text-[11px] text-gaslight">совет старейшины</span>
          )}
        </button>
        {open && (
          <div
            data-wheel-scroll=""
            className="mt-1 w-64 max-w-[calc(100vw-48px)] overflow-y-auto overscroll-contain rounded-lg border border-line bg-soot-2/95 p-1.5 shadow-[0_6px_18px_rgba(0,0,0,.55)]"
            style={{ maxHeight: Math.max(140, lay.ch - top - 56) }}
          >
            <div className="mb-1 px-1 font-display text-xs font-bold tracking-wide text-brass-light">Цели колонии</div>
            <div className="flex flex-col gap-1">
              {hintRow}
              {goals.map((g) => (
                <GoalRow key={g.key} g={g} onGo={go} />
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  const rest = goals.length - 1;
  const list = expanded ? goals : goals.slice(0, 1);
  const hold = (by: "hover" | "focus", on: boolean) => fadeApi.current?.hold(by, on);
  return (
    <div
      ref={cardRef}
      role="region"
      aria-label="Цели колонии"
      data-wheel-scroll=""
      className="absolute left-2 top-2 z-20 overflow-y-auto overscroll-contain rounded-lg border border-line/80 bg-soot-2/80 p-1.5 shadow-[0_4px_14px_rgba(0,0,0,.45)] transition-opacity duration-500"
      style={{ width: Math.min(room, hint ? 280 : 260), maxHeight: Math.max(120, lay.ch - 16) }}
      data-nodrag=""
      onPointerEnter={() => hold("hover", true)}
      onPointerLeave={() => hold("hover", false)}
      onFocus={() => hold("focus", true)}
      onBlur={() => hold("focus", false)}
    >
      <div className="flex flex-col gap-1">
        {hintRow}
        {list.map((g) => (
          <GoalRow key={g.key} g={g} onGo={go} />
        ))}
      </div>
      {rest > 0 && (
        <button
          type="button"
          data-nodrag=""
          onClick={() => {
            setExpanded(!expanded);
            writeExpanded(!expanded);
          }}
          aria-expanded={expanded}
          className="mt-1 flex min-h-7 w-full items-center gap-1 rounded px-1 text-left font-display text-xs font-bold tracking-wide text-brass-light hover:text-parchment"
        >
          <span aria-hidden>🎯</span>
          <span className="flex-1">{expanded ? "Свернуть цели" : `+${rest} ${plural(rest, "цель", "цели", "целей")}`}</span>
          <span aria-hidden className="text-[10px]">
            {expanded ? "▴" : "▾"}
          </span>
        </button>
      )}
    </div>
  );
});

/* ------------------------------------------------------------ expanded state (a per-session convenience) */

const OPEN_KEY = "rr:goals-open";

function readExpanded(): boolean {
  try {
    return window.sessionStorage.getItem(OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

function writeExpanded(v: boolean): void {
  try {
    window.sessionStorage.setItem(OPEN_KEY, v ? "1" : "0");
  } catch {
    /* private mode: the card just opens compact next time */
  }
}
