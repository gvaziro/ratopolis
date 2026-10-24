"use client";

/**
 * The Rat Express project (GDD 5.2): ten stages that assemble a locomotive from junk,
 * then endless "wagons" (+10% each) after the coronation.
 */
import { useState } from "react";
import { EXPRESS_STAGES } from "@/game/data/meta";
import { expressCost } from "@/game/engine/actions";
import { entries, isComplete } from "@/game/engine/formulas";
import { useGame } from "@/game/store";
import { fmt } from "@/lib/format";
import { Badge, BrassButton, Plate, cx } from "@/components/ui/kit";
import { ContribRow } from "./common";
import Locomotive from "./Locomotive";

export default function ExpressPanel() {
  const game = useGame((s) => s.game);
  const [showStages, setShowStages] = useState(false);
  const { stage, wagons, progress } = game.express;
  const crowned = stage >= 10;
  const cost = expressCost(game);
  const list = entries(cost);
  const frac = list.length ? list.reduce((a, [r, v]) => a + Math.min(1, (progress[r] ?? 0) / v), 0) / list.length : 0;
  const anyStock = list.some(([r, v]) => (progress[r] ?? 0) < v && game.res[r] > 0);
  const bonus = 20 * stage + 10 * wagons;
  const kept = game.meta.edicts.express_blueprints;

  return (
    <Plate
      title="Крысиный экспресс"
      icon="🚂"
      className="mb-4"
      right={<Badge tone="good">+{bonus}% ко всему</Badge>}
    >
      <div className="-mx-1 mb-2 overflow-hidden rounded-md border border-line bg-[radial-gradient(ellipse_at_50%_30%,#3b3022,#14110f_75%)] px-1 pt-2 shadow-[inset_0_2px_10px_rgba(0,0,0,.7)]">
        <Locomotive stage={stage} wagons={wagons} frac={Math.round(frac * 40) / 40} calm={game.settings.reducedMotion} />
      </div>

      <div className="mb-2 flex items-baseline justify-between gap-2">
        <p className="min-w-0 font-display text-base font-bold leading-tight text-brass-light">
          {crowned ? `Вагон экспресса №${wagons + 1}` : `Этап ${stage + 1} из 10: ${EXPRESS_STAGES[stage]}`}
        </p>
        <span className="shrink-0 font-mono text-xs tabular text-parchment-dim">{Math.floor(frac * 100)}%</span>
      </div>
      <p className="mb-2 text-[11px] leading-snug text-parchment-dim">
        {crowned
          ? "Король коронован, но Лондон велик: каждый новый вагон даёт ещё +10% ко всему производству."
          : `Каждый этап — +20% ко всему производству (кроме 📜 и 💍).${stage === 9 ? " Последний рывок — и коронация!" : ""}`}
        {kept ? " Указ «Чертежи экспресса»: этапы переживут переселение." : ""}
      </p>

      <div className="space-y-1.5">
        {list.map(([r, v]) => (
          <ContribRow key={r} r={r} need={v} have={progress[r] ?? 0} stock={game.res[r]} onGive={() => useGame.getState().contributeExpress(r)} />
        ))}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <BrassButton
          tone="copper"
          className={cx("min-h-10 flex-1", anyStock && "rr-breathe")}
          disabled={!anyStock || isComplete(cost, progress)}
          onClick={() => useGame.getState().contributeExpress()}
        >
          Внести всё
        </BrassButton>
      </div>

      <button
        type="button"
        onClick={() => setShowStages((v) => !v)}
        aria-expanded={showStages}
        className="mt-2 min-h-10 w-full rounded text-left text-xs font-bold text-brass hover:text-brass-light"
      >
        {showStages ? "Скрыть смету ▴" : "Смета экспресса: все 10 этапов ▾"}
      </button>
      {showStages && (
        <ol className="mt-1 space-y-0.5">
          {EXPRESS_STAGES.map((name, i) => {
            const done = i < stage;
            const cur = i === stage;
            return (
              <li
                key={name}
                className={cx(
                  "flex items-center gap-2 rounded px-1.5 py-1 text-xs",
                  done ? "text-good" : cur ? "bg-brass/10 font-bold text-brass-light" : "text-parchment-dim opacity-70",
                )}
              >
                <span className="w-5 shrink-0 text-center font-mono tabular">{done ? "✓" : i + 1}</span>
                <span className="min-w-0 flex-1">{name}</span>
                {cur && <span className="font-mono tabular">{fmt(frac * 100)}%</span>}
              </li>
            );
          })}
          {crowned && (
            <li className="flex items-center gap-2 rounded bg-brass/10 px-1.5 py-1 text-xs font-bold text-gaslight">
              <span className="w-5 shrink-0 text-center">👑</span>
              <span className="flex-1">Коронация состоялась · вагонов после неё: {wagons}</span>
            </li>
          )}
        </ol>
      )}
    </Plate>
  );
}
