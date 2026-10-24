"use client";

/**
 * "Улучшения": available upgrades (cheapest first; affordable ones shine and breathe),
 * then the next three locked ones as silhouettes, then the purchased ones (collapsible).
 */
import { useRef, useState } from "react";
import { UPGRADE_ORDER, UPGRADES } from "@/game/data/upgrades";
import { check } from "@/game/engine/conditions";
import type { Derived } from "@/game/engine/derive";
import { canAfford, lockedByCap, marketValue, timeToAfford } from "@/game/engine/formulas";
import { derivedOf, useGame } from "@/game/store";
import type { GameState, UpgradeId } from "@/game/types";
import { fmtTime } from "@/lib/format";
import { Badge, BrassButton, cx } from "@/components/ui/kit";
import { isFresh } from "./alerts";
import { CostView, HoverTip, SectionTitle, Toolbar, condHint, costItems, floatAt } from "./common";

const KIND: Record<"speed" | "yield", { label: string; tone: "verdigris" | "brass"; tip: string }> = {
  speed: { label: "скорость", tone: "verdigris", tip: "Скорость: умножает и вход, и выход — пропорции цепочки сохраняются." },
  yield: { label: "выход", tone: "brass", tip: "Выход: умножает только выход — ощущается как рост КПД." },
};

export default function UpgradesTab() {
  const game = useGame((s) => s.game);
  const d = derivedOf(game);
  const [showBought, setShowBought] = useState(false);

  const available = UPGRADE_ORDER.filter((u) => !game.upgrades[u] && check(game, UPGRADES[u].unlock)).sort(
    (a, b) => marketValue(UPGRADES[a].cost) - marketValue(UPGRADES[b].cost),
  );
  const soon = UPGRADE_ORDER.filter((u) => !game.upgrades[u] && !check(game, UPGRADES[u].unlock)).slice(0, 3);
  const bought = UPGRADE_ORDER.filter((u) => game.upgrades[u]);
  const ready = available.filter((u) => canAfford(game, UPGRADES[u].cost)).length;

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
            <UpgradeCard key={id} s={game} d={d} id={id} />
          ))}
        </div>
      )}

      {soon.length > 0 && (
        <>
          <SectionTitle>Скоро</SectionTitle>
          <div className="space-y-1.5">
            {soon.map((id) => (
              <div key={id} className="flex items-center gap-2.5 rounded-lg border border-dashed border-line/90 bg-black/20 p-2">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-black/40 text-xl">
                  <span className="rr-silhouette">{UPGRADES[id].icon}</span>
                </span>
                <div className="min-w-0">
                  <p className="font-display text-sm font-bold leading-tight text-parchment-dim">{UPGRADES[id].name}</p>
                  <p className="text-[11px] leading-snug text-parchment-dim">
                    <span className="font-bold text-brass">откроется:</span> {condHint(game, UPGRADES[id].unlock)}
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

function UpgradeCard({ s, d, id }: { s: GameState; d: Derived; id: UpgradeId }) {
  const def = UPGRADES[id];
  const ok = canAfford(s, def.cost);
  const wrap = useRef<HTMLDivElement>(null);
  const fresh = isFresh(s, `u_${id}`);
  let wait: string | null = null;
  if (!ok) {
    if (lockedByCap(def.cost, d).some((r) => s.res[r] < (def.cost[r] ?? 0))) wait = "🔒 нужен склад";
    else {
      const t = timeToAfford(s, def.cost);
      wait = Number.isFinite(t) ? `через ${fmtTime(Math.ceil(t))}` : "не копится";
    }
  }

  const buy = () => {
    const el = wrap.current;
    useGame.getState().buyUpgrade(id);
    if (useGame.getState().game.upgrades[id]) floatAt(el, "Изобретено!", "#7cc4b0", true);
  };

  return (
    <article
      className={cx(
        "relative overflow-hidden rounded-lg border p-2.5 transition-colors duration-300",
        ok
          ? "border-brass bg-gradient-to-b from-panel-3 to-panel shadow-[0_0_0_1px_rgba(201,162,90,.2),0_0_18px_rgba(242,184,75,.12)]"
          : "border-line bg-gradient-to-b from-panel-2/80 to-panel/80",
      )}
    >
      {ok && <span className="rr-sheen" aria-hidden />}
      <div className="relative flex gap-2.5">
        <span
          className={cx(
            "grid h-11 w-11 shrink-0 place-items-center rounded-md border border-black/40 text-2xl shadow-[inset_0_2px_5px_rgba(0,0,0,.55)]",
            ok ? "bg-brass/15" : "bg-black/30",
          )}
        >
          {def.icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h4 className={cx("font-display text-[15px] font-bold leading-tight", ok ? "text-brass-light" : "text-parchment")}>{def.name}</h4>
            {def.kind && (
              <HoverTip tip={KIND[def.kind].tip}>
                <Badge tone={KIND[def.kind].tone} className="cursor-help">
                  {KIND[def.kind].label}
                </Badge>
              </HoverTip>
            )}
            {fresh && <Badge tone="verdigris">новинка</Badge>}
          </div>
          <p className="mt-0.5 text-xs leading-snug text-parchment">{def.effect}</p>
          <p className="mt-0.5 text-[11px] italic leading-snug text-parchment-dim">«{def.flavor}»</p>
          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
              <CostView items={costItems(s, d, def.cost)} />
              {wait && <span className="whitespace-nowrap font-mono text-[10px] text-parchment-dim tabular">{wait}</span>}
            </span>
            <div ref={wrap} className={cx("inline-flex", ok && "rr-breathe")}>
              <BrassButton size="sm" className="min-h-10 px-3" disabled={!ok} onClick={buy}>
                Изобрести
              </BrassButton>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}
