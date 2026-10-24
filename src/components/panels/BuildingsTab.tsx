"use client";

/**
 * "Постройки": buy-mode toggle, foreman switches, cards grouped by open zone (collapsible),
 * and up to two "скоро" silhouettes per zone for buildings whose unlock is not met yet.
 */
import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { BUILDING_ORDER, BUILDINGS } from "@/game/data/buildings";
import { ZONE_ORDER, ZONES } from "@/game/data/zones";
import { buildingVisible } from "@/game/engine/actions";
import { useGame } from "@/game/store";
import type { BuildingId, BuyMode, GameState, ZoneId } from "@/game/types";
import { cx } from "@/components/ui/kit";
import BuildingCard from "./BuildingCard";
import { Segmented, Switch, Toolbar, condHint } from "./common";

interface ZoneGroup {
  zone: ZoneId;
  ids: BuildingId[];
  soon: { id: BuildingId; hint: string }[];
  levels: number;
}

function layoutOf(s: GameState): ZoneGroup[] {
  return ZONE_ORDER.filter((z) => s.zones[z]).map((zone) => {
    const ids: BuildingId[] = [];
    const soon: ZoneGroup["soon"] = [];
    let levels = 0;
    for (const id of BUILDING_ORDER) {
      if (BUILDINGS[id].zone !== zone) continue;
      if (buildingVisible(s, id)) {
        ids.push(id);
        levels += s.buildings[id];
      } else if (soon.length < 2) soon.push({ id, hint: condHint(s, BUILDINGS[id].unlock) });
    }
    return { zone, ids, soon, levels };
  });
}

const MODES: { value: BuyMode; label: string }[] = [
  { value: 1, label: "×1" },
  { value: 10, label: "×10" },
  { value: "max", label: "Макс" },
];

const COLLAPSE_KEY = "ratropolis.ui.collapsedZones";

function readCollapsed(): Partial<Record<ZoneId, boolean>> {
  try {
    return JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? "{}") as Partial<Record<ZoneId, boolean>>;
  } catch {
    return {};
  }
}

export default function BuildingsTab() {
  const mode = useGame((s) => s.buyMode);
  const layoutKey = useGame((s) => JSON.stringify(layoutOf(s.game)));
  const groups = useMemo(() => JSON.parse(layoutKey) as ZoneGroup[], [layoutKey]);
  const [collapsed, setCollapsed] = useState<Partial<Record<ZoneId, boolean>>>(readCollapsed);

  const toggle = (z: ZoneId) => {
    setCollapsed((c) => {
      const next = { ...c, [z]: !c[z] };
      try {
        localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next));
      } catch {
        /* storage blocked: keep it in memory */
      }
      return next;
    });
  };

  return (
    <>
      <Toolbar
        icon="🏗️"
        title="Постройки"
        right={<Segmented label="Сколько строить" value={mode} options={MODES} onChange={(v) => useGame.getState().setBuyMode(v)} />}
      >
        <ForemanBar />
      </Toolbar>

      {groups.length === 0 || groups.every((g) => g.ids.length === 0 && g.soon.length === 0) ? (
        <p className="py-8 text-center text-sm italic text-parchment-dim">Подрядчики ещё не прибыли. Наберите крошек на первое гнездо.</p>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <ZoneSection key={g.zone} group={g} collapsed={!!collapsed[g.zone]} onToggle={() => toggle(g.zone)} />
          ))}
        </div>
      )}
    </>
  );
}

function ZoneSection({ group, collapsed, onToggle }: { group: ZoneGroup; collapsed: boolean; onToggle: () => void }) {
  const z = ZONES[group.zone];
  return (
    <section>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="group mb-2 flex min-h-10 w-full items-center gap-2 rounded-md border-l-4 px-2 py-1 text-left transition hover:brightness-110"
        style={{ borderColor: z.palette.accent, background: `linear-gradient(90deg, ${z.palette.bg}, transparent 85%)` }}
      >
        <span className="text-xl leading-none">{z.icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block font-display text-base font-bold leading-tight text-parchment">{z.name}</span>
          <span className="block text-[10px] uppercase tracking-wider text-parchment-dim">
            построек: {group.ids.length} · уровней: {group.levels}
          </span>
        </span>
        <span className={cx("text-brass transition-transform duration-200", collapsed ? "-rotate-90" : "rotate-0")} aria-hidden>
          ▾
        </span>
      </button>
      {!collapsed && (
        <div className="space-y-2">
          {group.ids.map((id) => (
            <BuildingCard key={id} id={id} />
          ))}
          {group.soon.map((s) => (
            <Silhouette key={s.id} id={s.id} hint={s.hint} />
          ))}
        </div>
      )}
    </section>
  );
}

function Silhouette({ id, hint }: { id: BuildingId; hint: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-dashed border-line/90 bg-black/20 p-2">
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-md border border-black/40 bg-black/40 text-[26px] shadow-[inset_0_2px_6px_rgba(0,0,0,.6)]">
        <span className="rr-silhouette">{BUILDINGS[id].icon}</span>
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
  return (
    <div className="-mx-1 mt-0.5 flex flex-wrap items-center gap-x-3 border-t border-line/50 pt-0.5">
      <span className="text-[10px] font-bold uppercase tracking-wider text-parchment-dim">👷 Прораб:</span>
      <Switch on={f.nests} onToggle={() => useGame.getState().setForeman("nests", !f.nests)} label="гнёзда" />
      <Switch on={f.storage} onToggle={() => useGame.getState().setForeman("storage", !f.storage)} label="склады" />
    </div>
  );
}
