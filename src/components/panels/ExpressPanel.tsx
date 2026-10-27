"use client";

/**
 * The Rat Express project (GDD 5.2): ten stages that assemble a locomotive from junk,
 * then endless "wagons" after the coronation. Every percent on the plate is the engine's own
 * (metaMath expressBonusPct via metaText, PAN-2). The panel samples a small header model;
 * every resource row of the current stage subscribes to its own (PA-1).
 */
import { memo, useMemo, useState } from "react";
import { COMMISSIONS } from "@/game/data/commissions";
import { EXPRESS_STAGES } from "@/game/data/meta";
import { commissionProgress } from "@/game/engine/progress";
import { expressCost } from "@/game/engine/actions";
import { entries, isComplete } from "@/game/engine/formulas";
import { expressLineSet } from "@/game/engine/narrative";
import { KEPT_STAGES_MAX } from "@/game/engine/state";
import { useGame } from "@/game/store";
import type { CommissionId, GameState, ResId } from "@/game/types";
import { useSampled } from "@/game/useSampled";
import { fmt } from "@/lib/format";
import { Badge, BrassButton, Plate, cx } from "@/components/ui/kit";
import { ContribRow, contribKey } from "./common";
import KingPortrait from "./KingPortrait";
import Locomotive from "./Locomotive";
import { charterText, expressBonus, expressStageLines } from "./metaText";

interface ExpressModel {
  stage: number;
  wagons: number;
  /** «+X% ко всему» now, and what the next stage (or wagon after the coronation) adds. */
  bonus: string;
  next: string;
  /** The badge once the next stage or wagon is built, and a wagon's multiplier («1.1»). */
  after: string;
  wagon: string;
  /** Which set of 👤/🐀 stage lines this run's express reads (narrative.expressLineSet, as the stage news). */
  lineSet: number;
  /** Stage progress in 2.5% steps (the locomotive's assembly animation). */
  frac: number;
  res: ResId[];
  anyStock: boolean;
  complete: boolean;
  kept: boolean;
  calm: boolean;
}

function expressModel(s: GameState): ExpressModel {
  const { stage, wagons, progress } = s.express;
  const cost = expressCost(s);
  const list = entries(cost);
  const frac = list.length ? list.reduce((a, [r, v]) => a + Math.min(1, (progress[r] ?? 0) / v), 0) / list.length : 0;
  const bonus = expressBonus(s);
  return {
    stage,
    wagons,
    bonus: bonus.total,
    next: bonus.next,
    after: bonus.after,
    wagon: bonus.wagon,
    lineSet: expressLineSet(s),
    frac: Math.floor(frac * 40) / 40,
    res: list.map(([r]) => r),
    anyStock: list.some(([r, v]) => (progress[r] ?? 0) < v && s.res[r] > 0),
    complete: isComplete(cost, progress),
    kept: !!s.meta.edicts.express_blueprints,
    calm: s.settings.reducedMotion,
  };
}

export default function ExpressPanel() {
  const json = useSampled((s) => JSON.stringify(expressModel(s.game)), 3, Object.is);
  const m = useMemo(() => JSON.parse(json) as ExpressModel, [json]);
  const [showStages, setShowStages] = useState(false);
  const { stage, wagons, frac } = m;
  const crowned = stage >= 10;
  const lines = useMemo(() => expressStageLines(m.lineSet), [m.lineSet]);

  return (
    <div data-target="x_express" className="mb-4 rounded-lg">
      <Plate title="Крысиный экспресс" icon="🚂" right={<Badge tone="good">+{m.bonus}% ко всему</Badge>}>
        <div className="-mx-1 mb-2 overflow-hidden rounded-md border border-line bg-[radial-gradient(ellipse_at_50%_30%,#3b3022,#14110f_75%)] px-1 pt-2 shadow-[inset_0_2px_10px_rgba(0,0,0,.7)]">
          <Locomotive stage={stage} wagons={wagons} frac={frac} calm={m.calm} />
        </div>

        <div className="mb-2 flex items-baseline justify-between gap-2">
          <p className="min-w-0 font-display text-base font-bold leading-tight text-brass-light">
            {crowned ? `Вагон экспресса №${wagons + 1}` : `Этап ${stage + 1} из 10: ${EXPRESS_STAGES[stage]}`}
          </p>
          <span className="shrink-0 font-mono text-xs tabular text-parchment-dim">{Math.floor(frac * 100)}%</span>
        </div>
        <p className="mb-2 text-[11px] leading-snug text-parchment-dim">
          {crowned
            ? `Король коронован, но Лондон велик: следующий вагон умножит всё производство (кроме 📜 и 💍) ещё на ×${m.wagon} — бонус экспресса станет +${m.after}%.`
            : `Этот этап добавит ещё +${m.next}% ко всему производству (кроме 📜 и 💍).${stage === 9 ? " Последний рывок — и коронация!" : ""}`}
          {m.kept ? ` Указ «Чертежи экспресса»: первые ${KEPT_STAGES_MAX} этапов переживут переселение.` : ""}
        </p>

        {!crowned && lines[stage] && (
          <p className="mb-2 rounded border border-line/60 bg-black/20 px-2 py-1 text-[11px] italic leading-snug text-parchment">👤 {lines[stage].human}</p>
        )}

        <div className="space-y-1.5">
          {m.res.map((r) => (
            <ExpressRow key={`${stage}-${wagons}-${r}`} r={r} />
          ))}
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <BrassButton
            tone="copper"
            className={cx("min-h-10 flex-1", m.anyStock && "rr-breathe")}
            disabled={!m.anyStock || m.complete}
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
                  <span className="min-w-0 flex-1">
                    {name}
                    {(done || cur) && lines[i] && (
                      <span className="block text-[10px] font-normal italic leading-snug text-parchment-dim">
                        👤 {lines[i].human}
                        {done && <span className="block">🐀 {lines[i].rat}</span>}
                      </span>
                    )}
                  </span>
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
      <Commissions />
    </div>
  );
}

interface CommissionModel {
  offered: CommissionId[];
  active: { id: CommissionId; cur: number; goal: number } | null;
  done: number;
  /** charterText of the whole state: the «Город» set's ×1.06 included, as crownsForRun pays it (MigrationTab agrees). */
  ch: ReturnType<typeof charterText>;
  tails: number;
}

/** EN-12/PA-6: «Поручения Короля» after the coronation — three offers, one accepted at a time, crown charters. */
function Commissions() {
  const json = useSampled((s) => {
    const c = s.game.commissions;
    if (!c) return "";
    const m: CommissionModel = { offered: c.offered, active: commissionProgress(s.game), done: c.done, ch: charterText(s.game), tails: 1 + s.game.meta.migrations };
    return JSON.stringify(m);
  }, 3, Object.is);
  // «Отказаться» asks once more (the progress is lost); the question is about this very commission
  const [abandonAsk, setAbandonAsk] = useState<CommissionId | null>(null);
  if (!json) return null;
  const m = JSON.parse(json) as CommissionModel;
  const ch = m.ch;
  return (
    <div className="mt-3">
      <Plate title="Поручения Короля" icon="📜" right={<Badge tone="good">Грамоты: ×{ch.mult}</Badge>}>
        <div className="mb-2 flex items-center gap-2.5">
          <div className="w-12 shrink-0">
            <KingPortrait tails={m.tails} gilded={false} crowned />
          </div>
          <p className="text-[11px] leading-snug text-parchment-dim">
            Его Величество милостив, но скучает. Каждое исполненное поручение — королевская грамота: венцы за забег ×{ch.per} (до ×{ch.cap}). Исполнено: {m.done}.
            {ch.atCap && <span className="text-gaslight"> Грамот уже столько, что новые венцов не прибавят — поручения теперь ради чести.</span>}
          </p>
        </div>
        {m.active ? (
          <div className="rounded-md border border-gaslight/70 bg-gradient-to-b from-[#3b2c12] to-panel p-2">
            <p className="font-display text-sm font-bold text-gaslight">
              {COMMISSIONS[m.active.id].icon} {COMMISSIONS[m.active.id].name}
            </p>
            <p className="text-[11px] text-parchment-dim">{COMMISSIONS[m.active.id].desc}</p>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-black/40">
              <div className="h-full rounded-full bg-gaslight" style={{ width: Math.round((m.active.cur / m.active.goal) * 100) + "%" }} />
            </div>
            <div className="mt-0.5 flex flex-wrap items-center justify-end gap-1.5">
              {abandonAsk === m.active.id ? (
                <>
                  <span className="mr-auto text-[11px] leading-tight text-parchment-dim">Вернуть без грамоты? Взамен — три новых.</span>
                  <BrassButton
                    tone="danger"
                    size="sm"
                    className="min-h-10"
                    onClick={() => {
                      setAbandonAsk(null);
                      useGame.getState().abandonCommission();
                    }}
                  >
                    Да, отказаться
                  </BrassButton>
                  <BrassButton tone="ghost" size="sm" className="min-h-10" onClick={() => setAbandonAsk(null)}>
                    Нет
                  </BrassButton>
                </>
              ) : (
                <>
                  <BrassButton tone="ghost" size="sm" className="mr-auto min-h-10" onClick={() => setAbandonAsk(m.active!.id)}>
                    Отказаться
                  </BrassButton>
                  <span className="font-mono text-[11px] tabular text-brass-light">
                    {m.active.cur} / {m.active.goal}
                  </span>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            {m.offered.map((id) => (
              <div key={id} className="flex items-center gap-2 rounded-md border border-line bg-panel/60 p-2">
                <span className="text-xl">{COMMISSIONS[id].icon}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold leading-tight text-parchment">{COMMISSIONS[id].name}</p>
                  <p className="text-[11px] leading-snug text-parchment-dim">{COMMISSIONS[id].desc}</p>
                </div>
                <BrassButton size="sm" className="min-h-10 shrink-0" onClick={() => useGame.getState().acceptCommission(id)}>
                  Принять
                </BrassButton>
              </div>
            ))}
          </div>
        )}
      </Plate>
    </div>
  );
}

/** One resource of the current stage: need / contributed / stock as displayed, sampled on its own. */
const ExpressRow = memo(function ExpressRow({ r }: { r: ResId }) {
  const key = useSampled((s) => contribKey(expressCost(s.game)[r] ?? 0, s.game.express.progress[r] ?? 0, s.game.res[r]), 3, Object.is);
  const [need, have] = key.split("|").map(Number);
  // the key holds the stock as displayed; the button needs the exact amount, read at render time
  const stock = useGame.getState().game.res[r];
  return <ContribRow r={r} need={need} have={have} stock={stock} onGive={() => useGame.getState().contributeExpress(r)} />;
});
