"use client";

/**
 * "Постройки": buy-mode toggle, foreman switches, cards grouped by open zone (collapsible),
 * and up to two "скоро" silhouettes per zone for buildings whose unlock is not met yet.
 * The layout (and the «выгодно» payback pick) is sampled twice a second (PA-1, PA-3).
 * On phones the ×1/×10/Макс toggle moves into the sheet's handle row (SheetSlot), so the half sheet shows more
 * cards; the desktop toolbar keeps it (PAN-3).
 */
import { memo, useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { BUILDING_ORDER, BUILDINGS } from "@/game/data/buildings";
import { ZONE_ORDER, ZONES } from "@/game/data/zones";
import { buildingVisible } from "@/game/engine/actions";
import { paybackSeconds } from "@/game/engine/economy";
import { atMaxLevel, maxAffordable } from "@/game/engine/formulas";
import { onUiFx } from "@/game/fx";
import { derivedOf, useGame } from "@/game/store";
import type { BuildingId, BuyMode, GameState, ZoneId } from "@/game/types";
import { useSampled } from "@/game/useSampled";
import { cx } from "@/components/ui/kit";
import BuildingCard from "./BuildingCard";
import { Segmented, Switch, Toolbar, condHint, type SegOption } from "./common";
import { SheetSlot, useSheetSlot } from "./sheetSlot";
import { BuildingThumb } from "./Thumb";

interface ZoneGroup {
  zone: ZoneId;
  ids: BuildingId[];
  soon: { id: BuildingId; hint: string }[];
  levels: number;
}

interface Layout {
  groups: ZoneGroup[];
  /** Visible producer whose next level pays for itself soonest («выгодно»). */
  best: BuildingId | null;
  /** Most levels «Макс» could buy on any one card. */
  maxN: number;
}

function layoutOf(s: GameState): Layout {
  const d = derivedOf(s);
  let best: BuildingId | null = null;
  let bestT = Infinity;
  let maxN = 0;
  const groups = ZONE_ORDER.filter((z) => s.zones[z]).map((zone) => {
    const ids: BuildingId[] = [];
    const soon: ZoneGroup["soon"] = [];
    let levels = 0;
    for (const id of BUILDING_ORDER) {
      const def = BUILDINGS[id];
      if (def.zone !== zone) continue;
      if (buildingVisible(s, id)) {
        ids.push(id);
        levels += s.buildings[id];
        maxN = Math.max(maxN, maxAffordable(s, id));
        if (def.effects.some((e) => e.t === "produce") && !atMaxLevel(s, id)) {
          const t = paybackSeconds(s, d, id, 1);
          if (t < bestT) {
            bestT = t;
            best = id;
          }
        }
      } else if (soon.length < 2) soon.push({ id, hint: condHint(s, def.unlock) });
    }
    return { zone, ids, soon, levels };
  });
  return { groups, best, maxN };
}

const COLLAPSE_KEY = "ratropolis.ui.collapsedZones";

function readCollapsed(): Partial<Record<ZoneId, boolean>> {
  try {
    return JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? "{}") as Partial<Record<ZoneId, boolean>>;
  } catch {
    return {};
  }
}

function saveCollapsed(c: Partial<Record<ZoneId, boolean>>): void {
  try {
    localStorage.setItem(COLLAPSE_KEY, JSON.stringify(c));
  } catch {
    /* storage blocked: keep it in memory */
  }
}

export default function BuildingsTab() {
  const mode = useGame((s) => s.buyMode);
  const layoutKey = useSampled((s) => JSON.stringify(layoutOf(s.game)), 2, Object.is);
  const { groups, best, maxN } = useMemo(() => JSON.parse(layoutKey) as Layout, [layoutKey]);
  const [collapsed, setCollapsed] = useState<Partial<Record<ZoneId, boolean>>>(readCollapsed);

  const toggle = (z: ZoneId) => {
    setCollapsed((c) => {
      const next = { ...c, [z]: !c[z] };
      saveCollapsed(next);
      return next;
    });
  };

  // a focus on a card inside a folded zone unfolds it (SidePanel retries the scroll until the card is there)
  useEffect(
    () =>
      onUiFx((fx) => {
        if (fx.k !== "focus" || !fx.target?.startsWith("b_")) return;
        const def = BUILDINGS[fx.target.slice(2) as BuildingId];
        if (!def) return;
        setCollapsed((c) => {
          if (!c[def.zone]) return c;
          const next = { ...c, [def.zone]: false };
          saveCollapsed(next);
          return next;
        });
      }),
    [],
  );

  const modes: SegOption<BuyMode>[] = [
    { value: 1, label: "×1" },
    { value: 10, label: "×10", title: "Ровно 10 уровней — или ничего" },
    { value: "max", label: maxN > 0 ? `Макс(${maxN})` : "Макс", title: "Сколько хватит денег" },
  ];
  const setMode = (v: BuyMode) => useGame.getState().setBuyMode(v);
  // phones: the toggle lives in the sheet's handle row and the toolbar keeps only the foreman (or takes no room)
  const slot = useSheetSlot();
  const foreman = useGame((s) => !!s.game.upgrades.foreman);

  return (
    <>
      <Toolbar icon="🏗️" title="Постройки" right={slot ? undefined : <Segmented label="Сколько строить" dense value={mode} options={modes} onChange={setMode} />}>
        {foreman ? <ForemanBar /> : null}
      </Toolbar>
      {slot && (
        <SheetSlot>
          <Segmented label="Сколько строить" slot value={mode} options={modes} onChange={setMode} />
        </SheetSlot>
      )}

      {groups.length === 0 || groups.every((g) => g.ids.length === 0 && g.soon.length === 0) ? (
        <p className="py-8 text-center text-sm italic text-parchment-dim">Подрядчики ещё не прибыли. Наберите крошек на первое гнездо.</p>
      ) : (
        <div className="space-y-3 md:space-y-4">
          {groups.map((g) => (
            <ZoneSection key={g.zone} group={g} best={best} collapsed={!!collapsed[g.zone]} onToggle={() => toggle(g.zone)} />
          ))}
        </div>
      )}
    </>
  );
}

interface ZoneProps {
  group: ZoneGroup;
  best: BuildingId | null;
  collapsed: boolean;
  onToggle: () => void;
}

/** Re-renders only when its own zone's layout changes (onToggle is a fresh closure with the same effect). */
const ZoneSection = memo(function ZoneSection({ group, best, collapsed, onToggle }: ZoneProps) {
  const z = ZONES[group.zone];
  return (
    <section>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="group mb-1 flex min-h-10 w-full items-center gap-2 rounded-md border-l-4 px-2 py-0.5 text-left transition hover:brightness-110 md:mb-2 md:py-1"
        style={{ borderColor: z.palette.accent, background: `linear-gradient(90deg, ${z.palette.bg}, transparent 85%)` }}
      >
        <span className="text-lg leading-none md:text-xl">{z.icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-base font-bold leading-tight text-parchment">{z.name}</span>
          <span className="block text-[10px] uppercase tracking-wider text-parchment-dim max-md:hidden">
            построек: {group.ids.length} · уровней: {group.levels}
          </span>
        </span>
        <span className="shrink-0 font-mono text-[11px] tabular text-parchment-dim md:hidden">{group.levels} ур.</span>
        <span className={cx("text-brass transition-transform duration-200", collapsed ? "-rotate-90" : "rotate-0")} aria-hidden>
          ▾
        </span>
      </button>
      {!collapsed && (
        <div className="space-y-1 md:space-y-2">
          {group.ids.map((id) => (
            <BuildingCard key={id} id={id} best={id === best} />
          ))}
          {group.soon.map((s) => (
            <Silhouette key={s.id} id={s.id} hint={s.hint} />
          ))}
        </div>
      )}
    </section>
  );
}, sameZone);

function sameZone(a: ZoneProps, b: ZoneProps): boolean {
  return a.best === b.best && a.collapsed === b.collapsed && JSON.stringify(a.group) === JSON.stringify(b.group);
}

function Silhouette({ id, hint }: { id: BuildingId; hint: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-dashed border-line/90 bg-black/20 p-1.5 md:p-2">
      <span className="relative block h-10 w-12 shrink-0 rounded-md border border-black/40 bg-black/40 shadow-[inset_0_2px_6px_rgba(0,0,0,.6)] md:h-12 md:w-14">
        <BuildingThumb id={id} lvl={1} className="rr-silhouette absolute inset-0.5 h-[calc(100%-4px)] w-[calc(100%-4px)]" />
      </span>
      <div className="min-w-0">
        <p className="font-display text-[15px] font-bold leading-tight tracking-[0.2em] text-parchment-dim">???</p>
        <p className="text-[11px] leading-snug text-parchment-dim">
          <span className="font-bold text-brass">скоро:</span> {hint}
        </p>
      </div>
    </div>
  );
}

function ForemanBar() {
  const f = useGame(
    useShallow((s) => ({ has: !!s.game.upgrades.foreman, nests: s.game.foreman.nests, storage: s.game.foreman.storage })),
  );
  if (!f.has) return null;
  // phones: the toggle went to the handle row, so the foreman is the toolbar's first row and needs no rule above it
  return (
    <div className="-mx-1 mt-0.5 flex flex-wrap items-center gap-x-3 border-t border-line/50 pt-0.5 max-md:mt-0 max-md:border-t-0">
      <span className="text-[10px] font-bold uppercase tracking-wider text-parchment-dim">👷 Прораб:</span>
      <Switch on={f.nests} onToggle={() => useGame.getState().setForeman("nests", !f.nests)} label="гнёзда" />
      <Switch on={f.storage} onToggle={() => useGame.getState().setForeman("storage", !f.storage)} label="склады" />
    </div>
  );
}
