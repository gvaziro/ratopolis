"use client";

/**
 * «Цели колонии» (top-left of the colony): the elder's hint with «Сделать», then the goals — something
 * affordable right now, the expedition (with its bottleneck) or the next unlock, the crowns / the coronation,
 * the Rat Express stage, and the nearest building and upgrade with time-to-afford. Never empty once revealed.
 * Sampled once a second. Shrinks to a pill when the grate leaves too little room beside it, and drops under
 * the grate when even the pill would not fit there. Clicking a goal opens its tab and glows its card.
 */
import { memo, useEffect, useMemo, useState } from "react";
import { Bar, cx } from "@/components/ui/kit";
import { BUILDINGS, BUILDING_ORDER } from "@/game/data/buildings";
import { RESOURCES } from "@/game/data/resources";
import { UPGRADES, UPGRADE_ORDER } from "@/game/data/upgrades";
import { ZONES } from "@/game/data/zones";
import { buildingVisible, currentExpedition, expressCost, upgradeVisible } from "@/game/engine/actions";
import type { Derived } from "@/game/engine/derive";
import {
  affordFraction,
  buildingCost,
  canAfford,
  canMigrate,
  crownsForRun,
  entries,
  expeditionCost,
  lockedByCap,
  marketValue,
  nextCrownAt,
  prevCrownAt,
  timeToAfford,
} from "@/game/engine/formulas";
import { nextHint, type Hint } from "@/game/engine/hints";
import { derivedOf, useGame, type TabId } from "@/game/store";
import { RES_IDS, T1, type Amounts, type BuildingId, type GameState, type ResId } from "@/game/types";
import { useSampled } from "@/game/useSampled";
import { fmt, fmtInt, fmtTime } from "@/lib/format";
import { onCamera } from "./camera";
import { GRATE, nextLocked } from "./geometry";

interface Goal {
  icon: string;
  name: string;
  /** Seconds to afford; -1 = never at current rates; -2 = not applicable (the note is shown instead). */
  eta: number;
  frac: number;
  note?: string;
  /** Second line (the expedition's bottleneck). */
  sub?: string;
  /** The sub line is bad news (a resource nobody gathers). */
  warn?: boolean;
  locked?: boolean;
  /** Icons of missing resources nobody produces (eta −1). */
  dry?: string;
  tone?: "good" | "gold";
  tab: TabId;
  target?: string;
  /** Short label for the compact pill when there is no ETA. */
  short: string;
}

interface View {
  hint: Hint | null;
  goals: Goal[];
}

/* ------------------------------------------------------------ storage-only buildings */

const T1G: readonly ResId[] = [...T1, "gears", "cheese"];

/** Buildings whose every effect is a storage limit (cap / capMult / steamCap) → the resources they hold. */
const STORAGE_RES: Partial<Record<BuildingId, ResId[]>> = (() => {
  const out: Partial<Record<BuildingId, ResId[]>> = {};
  for (const id of BUILDING_ORDER) {
    const effs = BUILDINGS[id].effects;
    if (!effs.length || !effs.every((e) => e.t === "cap" || e.t === "capMult" || e.t === "steamCap")) continue;
    const rs = new Set<ResId>();
    for (const e of effs) {
      if (e.t === "cap") rs.add(e.res);
      else if (e.t === "capMult") (e.group === "T1" ? T1 : T1G).forEach((r) => rs.add(r));
      else if (e.t === "steamCap") rs.add("steam");
    }
    out[id] = [...rs];
  }
  return out;
})();

/** game.time since which each resource has sat at ≥ 99% of its limit (module state: there is one widget). */
const fullSince: Partial<Record<ResId, number>> = {};

/** Resources that have been ≥ 99% full for 30 s. */
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

/* ------------------------------------------------------------ maths */

const round50 = (f: number) => (Number.isFinite(f) ? Math.round(Math.max(0, Math.min(1, f)) * 50) / 50 : 0);

/** Missing parts of a price that nobody produces (net rate ≤ 0), as icons. */
function dryIcons(s: GameState, cost: Amounts): string {
  let out = "";
  for (const [r, v] of entries(cost)) if (v > s.res[r] + 1e-9 && s.rates[r] <= 0) out += RESOURCES[r].icon;
  return out;
}

/** The slowest part of a project: (need − contributed − stock) / net rate, Infinity when nobody produces it. */
function bottleneck(s: GameState, cost: Amounts, prog: Amounts): { res: ResId; t: number } | null {
  let worst: { res: ResId; t: number } | null = null;
  for (const [r, v] of entries(cost)) {
    const lack = v - (prog[r] ?? 0) - s.res[r];
    if (lack <= 1e-9) continue;
    const t = s.rates[r] > 0 ? lack / s.rates[r] : Infinity;
    if (!worst || t > worst.t) worst = { res: r, t };
  }
  return worst;
}

function projectFrac(cost: Amounts, prog: Amounts): number {
  const list = entries(cost);
  return list.length ? list.reduce((a, [r, v]) => a + Math.min(1, (prog[r] ?? 0) / v), 0) / list.length : 0;
}

function computeGoals(s: GameState, d: Derived, full: Set<ResId>): Goal[] {
  const out: Goal[] = [];
  const maxed = (id: BuildingId) => BUILDINGS[id].maxLevel !== undefined && s.buildings[id] >= BUILDINGS[id].maxLevel!;

  // storage only when a visible goal is held back by a limit, or a store has been brim-full for 30 s
  const wanted = new Set(full);
  for (const id of BUILDING_ORDER) {
    if (STORAGE_RES[id] || maxed(id) || !buildingVisible(s, id)) continue;
    for (const r of lockedByCap(buildingCost(id, s.buildings[id]), d)) wanted.add(r);
  }
  for (const id of UPGRADE_ORDER) {
    if (s.upgrades[id] || !upgradeVisible(s, id)) continue;
    for (const r of lockedByCap(UPGRADES[id].cost, d)) wanted.add(r);
  }
  const skip = (id: BuildingId) => {
    const rs = STORAGE_RES[id];
    return !!rs && !rs.some((r) => wanted.has(r));
  };

  // 1. something to build right now
  let ok: BuildingId | null = null;
  let okV = Infinity;
  for (const id of BUILDING_ORDER) {
    if (maxed(id) || skip(id) || !buildingVisible(s, id)) continue;
    const cost = buildingCost(id, s.buildings[id]);
    if (!canAfford(s, cost)) continue;
    const v = marketValue(cost);
    if (v < okV) {
      okV = v;
      ok = id;
    }
  }
  if (ok) {
    const def = BUILDINGS[ok];
    out.push({ icon: "✓", name: `Можно построить: ${def.name} (${fmtInt(s.buildings[ok] + 1)})`, eta: -2, frac: 1, tone: "good", tab: "buildings", target: `b_${ok}`, short: `${def.icon} ${def.name}` });
  }

  // 2. the crowns of this run / the coronation
  if (s.coronatedThisRun) {
    const k = crownsForRun(s);
    out.push({ icon: "🧳", name: "Король коронован — переселиться ×1.25", note: `+${fmtInt(k)} 👑`, eta: -2, frac: 1, tone: "gold", tab: "migration", short: `+${fmtInt(k)} 👑` });
  } else if (canMigrate(s)) {
    const k = crownsForRun(s);
    const next = nextCrownAt(s);
    const prev = prevCrownAt(s);
    out.push({
      icon: "👑",
      name: `Венцы: +${fmtInt(k)} 👑`,
      note: `след. через ${fmt(Math.max(0, next - s.eRun))} 🪙`,
      eta: -2,
      frac: round50(next > prev ? (s.eRun - prev) / (next - prev) : 1),
      tab: "migration",
      short: `+${fmtInt(k)} 👑`,
    });
  }

  // 3. the dig, the expedition or the next unlock
  if (s.digging) {
    const z = s.digging.zone;
    const left = Math.max(0, s.digging.until - s.time);
    out.push({ icon: "⛏️", name: `Копаем: ${ZONES[z].name}`, eta: Math.ceil(left), frac: round50(1 - left / 5), tab: "map", target: `z_${z}`, short: "копаем!" });
  } else {
    const z = currentExpedition(s);
    if (z) {
      const cost = expeditionCost(s, z);
      const prog = s.projects[z] ?? {};
      const need = ZONES[z].expedition?.rats ?? 0;
      const b = bottleneck(s, cost, prog);
      const icon = b ? RESOURCES[b.res].icon : "";
      const dry = !!b && !Number.isFinite(b.t);
      const sub = !b ? (s.rats >= need ? "всё собрано — несите в экспедицию!" : "запасы есть, ждём крыс") : dry ? `${icon} не добывается` : `${icon} узкое место ≈ ${fmtTime(b.t)}`;
      out.push({
        icon: "🗺️",
        name: `Экспедиция: ${ZONES[z].name}`,
        note: `🐀 ${fmtInt(s.rats)}/${fmtInt(need)}`,
        sub,
        warn: dry,
        eta: -2,
        frac: round50(projectFrac(cost, prog)),
        tab: "map",
        target: `z_${z}`,
        short: !b ? `🐀 ${fmtInt(s.rats)}/${fmtInt(need)}` : dry ? `${icon} не добывается` : `≈ ${fmtTime(b.t)}`,
      });
    } else {
      const nz = nextLocked(s);
      if (nz) {
        const need = ZONES[nz].mapRevealRats;
        out.push({
          icon: "🗺️",
          name: `${ZONES[nz].name}: нужно ${fmtInt(need)} 🐀 (сейчас ${fmtInt(s.rats)})`,
          eta: -2,
          frac: round50(need > 0 ? s.rats / need : 1),
          tab: "map",
          target: `z_${nz}`,
          short: `${fmtInt(s.rats)}/${fmtInt(need)} 🐀`,
        });
      }
    }
  }

  // 4. the Rat Express
  if (s.upgrades.express_plan && s.express.stage < 10) {
    const cost = expressCost(s);
    const prog = s.express.progress;
    const b = bottleneck(s, cost, prog);
    const dry = !!b && !Number.isFinite(b.t);
    out.push({
      icon: "🚂",
      name: `Экспресс: этап ${fmtInt(s.express.stage + 1)}/10`,
      note: b ? undefined : "можно внести!",
      eta: !b ? -2 : dry ? -1 : Math.ceil(b.t),
      dry: dry ? RESOURCES[b.res].icon : undefined,
      frac: round50(projectFrac(cost, prog)),
      tab: "map",
      target: "x_express",
      short: !b ? "внести!" : `этап ${fmtInt(s.express.stage + 1)}`,
    });
  }

  // 5. the nearest building out of reach
  let best: Goal | null = null;
  let bestT = Infinity;
  let bestV = Infinity;
  for (const id of BUILDING_ORDER) {
    if (maxed(id) || skip(id) || !buildingVisible(s, id)) continue;
    const def = BUILDINGS[id];
    const cost = buildingCost(id, s.buildings[id]);
    if (canAfford(s, cost)) continue;
    const t = timeToAfford(s, cost);
    const v = marketValue(cost);
    if (t < bestT || (t === bestT && v < bestV)) {
      bestT = t;
      bestV = v;
      best = {
        icon: def.icon,
        name: s.buildings[id] > 0 ? `${def.name} (${fmtInt(s.buildings[id] + 1)})` : def.name,
        eta: Number.isFinite(t) ? Math.ceil(t) : -1,
        dry: Number.isFinite(t) ? undefined : dryIcons(s, cost),
        frac: round50(affordFraction(s, cost)),
        locked: lockedByCap(cost, d).length > 0,
        tab: "buildings",
        target: `b_${id}`,
        short: def.name,
      };
    }
  }
  if (best) out.push(best);

  // 6. the nearest upgrade out of reach
  let bestU: Goal | null = null;
  bestT = Infinity;
  bestV = Infinity;
  for (const id of UPGRADE_ORDER) {
    if (s.upgrades[id] || !upgradeVisible(s, id)) continue;
    const cost = UPGRADES[id].cost;
    if (canAfford(s, cost)) continue;
    const t = timeToAfford(s, cost);
    const v = marketValue(cost);
    if (t < bestT || (t === bestT && v < bestV)) {
      bestT = t;
      bestV = v;
      bestU = {
        icon: UPGRADES[id].icon,
        name: UPGRADES[id].name,
        eta: Number.isFinite(t) ? Math.ceil(t) : -1,
        dry: Number.isFinite(t) ? undefined : dryIcons(s, cost),
        frac: round50(affordFraction(s, cost)),
        locked: lockedByCap(cost, d).length > 0,
        tab: "upgrades",
        target: `u_${id}`,
        short: UPGRADES[id].name,
      };
    }
  }
  if (bestU) out.push(bestU);

  if (!out.length) out.push({ icon: "🎩", name: "Колония в полном порядке", note: "копим впрок", eta: -2, frac: 1, tab: "buildings", short: "всё в порядке" });
  return out;
}

function computeView(s: GameState): string {
  const d = derivedOf(s);
  const hint = nextHint(s, d);
  if (!s.revealed.goal && !hint) return "";
  const v: View = { hint, goals: s.revealed.goal ? computeGoals(s, d, longFull(s, d)) : [] };
  return JSON.stringify(v);
}

/* ------------------------------------------------------------ rendering */

function etaText(g: Goal): string {
  if (g.locked) return "🔒 нужен склад";
  if (g.eta === -2) return g.note ?? "";
  if (g.eta === -1) return `нет дохода ${g.dry ?? ""}`.trim();
  if (g.eta <= 0) return "почти!";
  return `≈ ${fmtTime(g.eta)}`;
}

function pillText(g: Goal): string {
  if (g.locked) return "🔒 склад";
  if (g.eta === -1) return `нет дохода ${g.dry ?? ""}`.trim();
  if (g.eta >= 0) return g.eta <= 0 ? "почти!" : fmtTime(g.eta);
  return g.short;
}

const tabOpen = (tab: TabId) => tab === "settings" || !!useGame.getState().game.revealed[`tab_${tab}`];

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
      {g.sub && <span className={cx("mt-0.5 block w-full truncate text-[10px] leading-tight", g.warn ? "font-bold text-danger-light" : "text-parchment-dim")}>{g.sub}</span>}
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
  /** Desktop layout (≥ 768 px): 4 goal rows, else 3. */
  wide: boolean;
}

export const GoalWidget = memo(function GoalWidget() {
  const key = useSampled((s) => computeView(s.game), 1, Object.is);
  const view = useMemo(() => (key ? (JSON.parse(key) as View) : null), [key]);
  const bustle = useGame((s) => !!s.game.revealed.bustle);
  const [lay, setLay] = useState<Layout>({ room: 260, under: 0, cw: 800, ch: 600, wide: true });
  const [open, setOpen] = useState(false);
  // the full widget can fold to its header and the hint (it sits over the first chamber on desktop)
  const [folded, setFolded] = useState(readFolded);
  // a pressed hint hides until the next sample shows what is left to do (no double «Сделать»)
  const [doneHint, setDoneHint] = useState<string | null>(null);

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

  // SH-4: Esc (the global hotkey event) folds the goal popover
  useEffect(() => {
    const close = () => setOpen(false);
    window.addEventListener("rr-escape", close);
    return () => window.removeEventListener("rr-escape", close);
  }, []);

  useEffect(() => {
    if (doneHint === null) return;
    const t = window.setTimeout(() => setDoneHint(null), 1500);
    return () => window.clearTimeout(t);
  }, [doneHint]);

  if (!view) return null;
  const hintKey = view.hint ? `${view.hint.id}|${view.hint.text}` : null;
  const hint = view.hint && hintKey !== doneHint ? view.hint : null;
  const goals = view.goals.slice(0, lay.wide ? 4 : 3);
  if (!hint && goals.length === 0) return null;
  const { room } = lay;
  // phones always get the pill: the full card would cover half the colony once the camera leaves the grate
  const compact = room < 180 || !lay.wide;

  const go = (g: Goal) => {
    setOpen(false);
    if (tabOpen(g.tab)) useGame.getState().focus(g.tab, g.target);
  };
  const hintRow = hint ? <HintRow h={hint} onDone={() => setDoneHint(hintKey)} /> : null;
  const list = (
    <div className="flex flex-col gap-1">
      {hintRow}
      {goals.map((g, i) => (
        <GoalRow key={i} g={g} onGo={go} />
      ))}
    </div>
  );

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
            className="mt-1 w-64 max-w-[calc(100vw-48px)] overflow-y-auto rounded-lg border border-line bg-soot-2/95 p-1.5 shadow-[0_6px_18px_rgba(0,0,0,.55)]"
            style={{ maxHeight: Math.max(140, lay.ch - top - 56) }}
          >
            <div className="mb-1 px-1 font-display text-xs font-bold tracking-wide text-brass-light">Цели колонии</div>
            {list}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="absolute left-2 top-2 z-20 rounded-lg border border-line/80 bg-soot-2/80 p-1.5 shadow-[0_4px_14px_rgba(0,0,0,.45)]" style={{ width: Math.min(room, hint ? 280 : 260) }} data-nodrag="">
      <button
        type="button"
        data-nodrag=""
        onClick={() => {
          setFolded(!folded);
          writeFolded(!folded);
        }}
        aria-expanded={!folded}
        title={folded ? "Показать цели" : "Свернуть цели (совет останется)"}
        className="mb-1 flex w-full items-center gap-1 rounded px-1 text-left font-display text-xs font-bold tracking-wide text-brass-light hover:text-parchment"
      >
        <span aria-hidden>🎯</span>
        <span className="flex-1">Цели колонии</span>
        {folded && goals.length > 0 && <span className="font-mono text-[10px] font-normal text-parchment-dim tabular">{goals.length}</span>}
        <span aria-hidden className="text-[10px]">
          {folded ? "▾" : "▴"}
        </span>
      </button>
      {folded ? hintRow : list}
    </div>
  );
});

/* ------------------------------------------------------------ folded state (a per-viewer convenience) */

const FOLD_KEY = "rr:goals-folded";

function readFolded(): boolean {
  try {
    return window.localStorage.getItem(FOLD_KEY) === "1";
  } catch {
    return false;
  }
}

function writeFolded(v: boolean): void {
  try {
    window.localStorage.setItem(FOLD_KEY, v ? "1" : "0");
  } catch {
    /* private mode: the widget just opens unfolded next time */
  }
}
