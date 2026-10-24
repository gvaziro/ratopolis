"use client";

/**
 * «Цель» widget (top-left of the colony): the expedition in progress plus the nearest
 * not-yet-affordable building and upgrade with time-to-afford. Clicking a goal opens its tab.
 * Shrinks to a pill when the grate leaves too little room beside it.
 */
import { memo, useEffect, useMemo, useState } from "react";
import { Bar, cx } from "@/components/ui/kit";
import { BUILDINGS, BUILDING_ORDER } from "@/game/data/buildings";
import { UPGRADES, UPGRADE_ORDER } from "@/game/data/upgrades";
import { ZONES } from "@/game/data/zones";
import { buildingVisible, currentExpedition, upgradeVisible } from "@/game/engine/actions";
import { affordFraction, buildingCost, canAfford, entries, expeditionCost, lockedByCap, marketValue, timeToAfford } from "@/game/engine/formulas";
import { derivedOf, useGame, type TabId } from "@/game/store";
import type { GameState } from "@/game/types";
import { fmtInt, fmtTime } from "@/lib/format";
import { onCamera } from "./camera";
import { GRATE } from "./geometry";

interface Goal {
  icon: string;
  name: string;
  /** Seconds to afford; -1 = never at current rates; -2 = not applicable. */
  eta: number;
  frac: number;
  note?: string;
  locked?: boolean;
  tab: TabId;
}

function computeGoals(s: GameState): Goal[] {
  const d = derivedOf(s);
  const out: Goal[] = [];

  if (s.digging) {
    const z = s.digging.zone;
    const left = Math.max(0, s.digging.until - s.time);
    out.push({ icon: "⛏️", name: `Копаем: ${ZONES[z].name}`, eta: Math.ceil(left), frac: Math.round((1 - left / 5) * 50) / 50, tab: "map" });
  } else {
    const z = currentExpedition(s);
    if (z) {
      const cost = expeditionCost(s, z);
      const prog = s.projects[z] ?? {};
      const list = entries(cost);
      const frac = list.length ? list.reduce((a, [r, v]) => a + Math.min(1, (prog[r] ?? 0) / v), 0) / list.length : 0;
      const need = ZONES[z].expedition?.rats ?? 0;
      out.push({ icon: "🗺️", name: `Экспедиция: ${ZONES[z].name}`, eta: -2, frac: Math.round(frac * 50) / 50, note: `🐀 ${fmtInt(s.rats)}/${fmtInt(need)}`, tab: "map" });
    }
  }

  let best: Goal | null = null;
  let bestT = Infinity;
  let bestV = Infinity;
  for (const id of BUILDING_ORDER) {
    if (!buildingVisible(s, id)) continue;
    const def = BUILDINGS[id];
    if (def.maxLevel !== undefined && s.buildings[id] >= def.maxLevel) continue;
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
        frac: Math.round(affordFraction(s, cost) * 50) / 50,
        locked: lockedByCap(cost, d).length > 0,
        tab: "buildings",
      };
    }
  }
  if (best) out.push(best);

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
        frac: Math.round(affordFraction(s, cost) * 50) / 50,
        locked: lockedByCap(cost, d).length > 0,
        tab: "upgrades",
      };
    }
  }
  if (bestU) out.push(bestU);
  return out.slice(0, 3);
}

function etaText(g: Goal): string {
  if (g.locked) return "🔒 нужен склад";
  if (g.eta === -2) return g.note ?? "";
  if (g.eta === -1) return "копим…";
  if (g.eta <= 0) return "почти!";
  return `≈ ${fmtTime(g.eta)}`;
}

export const GoalWidget = memo(function GoalWidget() {
  const revealed = useGame((s) => !!s.game.revealed.goal);
  const key = useGame((s) => (s.game.revealed.goal ? JSON.stringify(computeGoals(s.game)) : "[]"));
  const goals = useMemo(() => JSON.parse(key) as Goal[], [key]);
  const [room, setRoom] = useState(260);
  const [open, setOpen] = useState(false);

  // width available left of the grate (so the widget never covers it)
  useEffect(
    () =>
      onCamera((v) => {
        const k = Math.max(1, 104 / (GRATE.w * v.s));
        const left = v.cw / 2 + (GRATE.x - (GRATE.w / 2 + 12) * k - v.cx) * v.s;
        const bottom = v.ch / 2 + (GRATE.y + 34 * k - v.cy) * v.s;
        const free = bottom < 0 ? 280 : Math.floor((left - 16) / 10) * 10;
        setRoom(Math.max(56, Math.min(280, free)));
      }),
    [],
  );

  if (!revealed || goals.length === 0) return null;
  const compact = room < 180;
  const go = (tab: TabId) => {
    useGame.getState().setTab(tab);
    setOpen(false);
  };

  const list = (
    <div className="flex flex-col gap-1">
      {goals.map((g, i) => (
        <button
          key={i}
          type="button"
          data-nodrag=""
          onClick={() => go(g.tab)}
          className="group flex min-h-10 w-full flex-col justify-center rounded border border-line/60 bg-panel/70 px-2 py-1 text-left transition hover:border-brass-dark hover:bg-panel-2"
        >
          <span className="flex w-full items-center gap-1.5 text-xs text-parchment">
            <span className="shrink-0 text-sm leading-none">{g.icon}</span>
            <span className="min-w-0 flex-1 truncate">{g.name}</span>
            <span className={cx("shrink-0 font-mono text-[10px] tabular", g.locked ? "text-danger-light" : g.eta === -1 ? "text-parchment-dim" : "text-brass-light")}>{etaText(g)}</span>
          </span>
          <Bar value={g.frac} className="mt-1 h-1 w-full" color={g.tab === "map" ? "var(--verdigris)" : "var(--brass)"} />
        </button>
      ))}
    </div>
  );

  if (compact) {
    const g = goals[0];
    return (
      <div className="absolute left-2 top-2 z-20" data-nodrag="">
        <button
          type="button"
          data-nodrag=""
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label="Ближайшие цели"
          className="flex h-10 items-center gap-1 rounded-full border border-brass-dark bg-soot-2/85 px-2.5 text-xs text-parchment shadow-[0_2px_8px_rgba(0,0,0,.45)]"
          style={{ maxWidth: Math.max(56, room) }}
        >
          <span>🎯</span>
          <span className="text-sm leading-none">{g.icon}</span>
          {room >= 96 && <span className="truncate font-mono text-[10px] text-brass-light tabular">{g.eta >= 0 ? fmtTime(g.eta) : g.eta === -2 ? `${Math.round(g.frac * 100)}%` : "…"}</span>}
        </button>
        {open && (
          <div className="mt-1 w-60 max-w-[calc(100vw-48px)] rounded-lg border border-line bg-soot-2/95 p-1.5 shadow-[0_6px_18px_rgba(0,0,0,.55)]">
            <div className="mb-1 px-1 font-display text-xs font-bold tracking-wide text-brass-light">Ближайшие цели</div>
            {list}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="absolute left-2 top-2 z-20 rounded-lg border border-line/80 bg-soot-2/80 p-1.5 shadow-[0_4px_14px_rgba(0,0,0,.45)]" style={{ width: Math.min(room, 260) }} data-nodrag="">
      <div className="mb-1 flex items-center gap-1 px-1 font-display text-xs font-bold tracking-wide text-brass-light">
        <span>🎯</span> Цели колонии
      </div>
      {list}
    </div>
  );
});
