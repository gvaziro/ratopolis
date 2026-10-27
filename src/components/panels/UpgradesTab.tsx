"use client";

/**
 * "Улучшения": available upgrades (cheapest first; affordable ones shine and breathe),
 * then the next three locked ones as silhouettes, then the purchased ones (collapsible).
 * Each card subscribes to its own small model (affordable, readiness in 2% steps, formatted cost — PA-1).
 */
import { memo, useMemo, useRef, useState } from "react";
import { UPGRADE_ORDER, UPGRADES } from "@/game/data/upgrades";
import { check } from "@/game/engine/conditions";
import type { Derived } from "@/game/engine/derive";
import { affordFraction, canAfford, marketValue } from "@/game/engine/formulas";
import { derivedOf, useGame } from "@/game/store";
import type { GameState, UpgradeId } from "@/game/types";
import { useSampled } from "@/game/useSampled";
import { Badge, Bar, BrassButton, cx } from "@/components/ui/kit";
import { isFresh } from "./alerts";
import { CostView, HoverTip, SectionTitle, Toolbar, WaitView, condHint, costItems, floatAt, waitInfo, type CostItem, type WaitInfo } from "./common";

/** Plain words on the tag (PAN-1); the exact terms («скорость», «выход») stay in the tooltip. */
const KIND: Record<"speed" | "yield", { label: string; tone: "verdigris" | "brass"; tip: string }> = {
  speed: { label: "быстрее", tone: "verdigris", tip: "Скорость: умножает и вход, и выход — пропорции цепочки сохраняются." },
  yield: { label: "больше добычи", tone: "brass", tip: "Выход: умножает только выход, сырья уходит столько же — ощущается как рост КПД." },
};

/** Available (cheapest first) and invented ids, and how many are affordable: "a,b|c|2". */
function listKey(s: GameState): string {
  const available = UPGRADE_ORDER.filter((u) => !s.upgrades[u] && check(s, UPGRADES[u].unlock)).sort(
    (a, b) => marketValue(UPGRADES[a].cost) - marketValue(UPGRADES[b].cost),
  );
  const bought = UPGRADE_ORDER.filter((u) => s.upgrades[u]);
  const ready = available.filter((u) => canAfford(s, UPGRADES[u].cost)).length;
  return `${available.join(",")}|${bought.join(",")}|${ready}`;
}

/** The next three locked upgrades with their (progress-bearing) unlock hints. */
function soonKey(s: GameState): string {
  return JSON.stringify(
    UPGRADE_ORDER.filter((u) => !s.upgrades[u] && !check(s, UPGRADES[u].unlock))
      .slice(0, 3)
      .map((id) => [id, condHint(s, UPGRADES[id].unlock)]),
  );
}

const ids = (part: string) => (part ? (part.split(",") as UpgradeId[]) : []);

export default function UpgradesTab() {
  const key = useGame((s) => listKey(s.game));
  const { available, bought, ready } = useMemo(() => {
    const [a, b, r] = key.split("|");
    return { available: ids(a), bought: ids(b), ready: Number(r) };
  }, [key]);
  const soonJson = useSampled((s) => soonKey(s.game), 3, Object.is);
  const soon = useMemo(() => JSON.parse(soonJson) as [UpgradeId, string][], [soonJson]);
  const [showBought, setShowBought] = useState(false);

  return (
    <>
      <Toolbar
        icon="🔬"
        title="Улучшения"
        right={
          <span className="text-[11px] text-parchment-dim">
            доступно: <b className="text-parchment">{available.length}</b>
            {ready > 0 && (
              <>
                {" "}
                · по карману: <b className="text-gaslight">{ready}</b>
              </>
            )}
          </span>
        }
      />

      {available.length === 0 ? (
        <p className="rounded-md border border-dashed border-line px-3 py-4 text-center text-sm italic text-parchment-dim">
          Все чертежи прочитаны. Изобретатели грызут карандаши в ожидании новых идей.
        </p>
      ) : (
        <div className="space-y-2">
          {available.map((id) => (
            <UpgradeCard key={id} id={id} />
          ))}
        </div>
      )}

      {soon.length > 0 && (
        <>
          <SectionTitle>Скоро</SectionTitle>
          <div className="space-y-1.5">
            {soon.map(([id, hint]) => (
              <div key={id} className="flex items-center gap-2.5 rounded-lg border border-dashed border-line/90 bg-black/20 p-2">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-black/40 text-xl">
                  <span className="rr-silhouette">{UPGRADES[id].icon}</span>
                </span>
                <div className="min-w-0">
                  <p className="font-display text-sm font-bold leading-tight text-parchment-dim">{UPGRADES[id].name}</p>
                  <p className="text-[11px] leading-snug text-parchment-dim">
                    <span className="font-bold text-brass">откроется:</span> {hint}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {bought.length > 0 && (
        <>
          <SectionTitle
            right={
              <button
                type="button"
                onClick={() => setShowBought((v) => !v)}
                aria-expanded={showBought}
                className="min-h-10 rounded px-2 text-xs font-bold text-brass hover:text-brass-light"
              >
                {showBought ? "свернуть ▴" : "показать ▾"}
              </button>
            }
          >
            Изобретено · {bought.length}
          </SectionTitle>
          {showBought && (
            <div className="flex flex-wrap gap-1.5">
              {bought.map((id) => (
                <HoverTip
                  key={id}
                  tip={
                    <>
                      <b className="text-brass-light">{UPGRADES[id].name}</b>
                      <br />
                      {UPGRADES[id].effect}
                    </>
                  }
                >
                  <span className="inline-flex cursor-help items-center gap-1 rounded border border-line bg-black/25 px-1.5 py-1 text-xs text-parchment-dim">
                    <span>{UPGRADES[id].icon}</span>
                    {UPGRADES[id].name}
                  </span>
                </HoverTip>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}

interface UpgradeModel {
  ok: boolean;
  /** Readiness in 2% steps (the bar under an unaffordable price). */
  frac: number;
  cost: CostItem[];
  wait: WaitInfo | null;
  fresh: boolean;
}

function upgradeModel(s: GameState, d: Derived, id: UpgradeId): UpgradeModel {
  const cost = UPGRADES[id].cost;
  const ok = canAfford(s, cost);
  return {
    ok,
    frac: ok ? 1 : Math.floor(affordFraction(s, cost) * 50) / 50,
    cost: costItems(s, d, cost),
    wait: ok ? null : waitInfo(s, d, cost),
    fresh: isFresh(s, `u_${id}`),
  };
}

const UpgradeCard = memo(function UpgradeCard({ id }: { id: UpgradeId }) {
  const json = useGame((s) => JSON.stringify(upgradeModel(s.game, derivedOf(s.game), id)));
  const m = useMemo(() => JSON.parse(json) as UpgradeModel, [json]);
  const def = UPGRADES[id];
  const wrap = useRef<HTMLDivElement>(null);

  const buy = () => {
    const el = wrap.current;
    useGame.getState().buyUpgrade(id);
    if (useGame.getState().game.upgrades[id]) floatAt(el, "Изобретено!", "#7cc4b0", true);
  };

  return (
    <article
      data-target={`u_${id}`}
      className={cx(
        "relative scroll-my-16 overflow-hidden rounded-lg border p-2.5 transition-colors duration-300",
        m.ok
          ? "border-brass bg-gradient-to-b from-panel-3 to-panel shadow-[0_0_0_1px_rgba(201,162,90,.2),0_0_18px_rgba(242,184,75,.12)]"
          : "border-line bg-gradient-to-b from-panel-2/80 to-panel/80",
      )}
    >
      {m.ok && <span className="rr-sheen" aria-hidden />}
      <div className="relative flex gap-2.5">
        <span
          className={cx(
            "grid h-11 w-11 shrink-0 place-items-center rounded-md border border-black/40 text-2xl shadow-[inset_0_2px_5px_rgba(0,0,0,.55)]",
            m.ok ? "bg-brass/15" : "bg-black/30",
          )}
        >
          {def.icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h4 className={cx("font-display text-[15px] font-bold leading-tight", m.ok ? "text-brass-light" : "text-parchment")}>{def.name}</h4>
            {def.kind && (
              <HoverTip tip={KIND[def.kind].tip}>
                <Badge tone={KIND[def.kind].tone} className="cursor-help">
                  {KIND[def.kind].label}
                </Badge>
              </HoverTip>
            )}
            {m.fresh && <Badge tone="verdigris">новинка</Badge>}
          </div>
          <p className="mt-0.5 text-xs leading-snug text-parchment">{def.effect}</p>
          <p className="mt-0.5 text-[11px] italic leading-snug text-parchment-dim">«{def.flavor}»</p>
          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
              <CostView items={m.cost} />
              <WaitView w={m.wait} />
            </span>
            <div ref={wrap} className={cx("inline-flex", m.ok && "rr-breathe")}>
              <BrassButton size="sm" className="min-h-10 px-3" disabled={!m.ok} onClick={buy}>
                Изобрести
              </BrassButton>
            </div>
          </div>
          {!m.ok && <Bar value={m.frac} color="var(--brass-dark)" className="mt-1 h-1" />}
        </div>
      </div>
    </article>
  );
});
