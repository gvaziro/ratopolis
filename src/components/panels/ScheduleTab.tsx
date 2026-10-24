"use client";

/**
 * "Расписание": a station arrivals board with live countdowns, the switchman's whistle,
 * the default crew position (GDD 8.2.3), auto-collect shares and the haul log.
 */
import { CREW_POSITIONS, EVENT_LINES, RATING_TABLE } from "@/game/data/events";
import type { Derived } from "@/game/engine/derive";
import { netCost, nextTrain, trainActive } from "@/game/engine/events";
import { humanClock } from "@/game/engine/formulas";
import { derivedOf, useGame } from "@/game/store";
import type { CrewPosition, GameState, SceneEventId } from "@/game/types";
import { fmt, fmtPct, fmtTime } from "@/lib/format";
import { AmountList, Badge, BrassButton, cx } from "@/components/ui/kit";
import { SectionTitle, Toolbar } from "./common";

type BoardId = "carriage" | "capsule" | "metro_train" | "royal_express";

interface BoardRow {
  id: BoardId;
  at: number;
  cars: string;
}

const POSITIONS: CrewPosition[] = ["wall", "rails", "ties"];

/** Run time → "HH:MM" on the human clock (05:00 + 5 human seconds per real second). */
function clockAt(t: number): string {
  const total = 300 + (t * 5) / 60;
  const m = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.floor(m % 60)).padStart(2, "0")}`;
}

function boardRows(s: GameState, d: Derived): BoardRow[] {
  const rows: BoardRow[] = [];
  if (s.flags.vagrants && Number.isFinite(s.timers.carriage)) rows.push({ id: "carriage", at: s.timers.carriage, cars: "кэб" });
  if (trainActive(s, "capsule")) rows.push({ id: "capsule", at: s.timers.capsule, cars: `капсул: ${d.capsuleCount}` });
  if (trainActive(s, "metro_train")) rows.push({ id: "metro_train", at: s.timers.metro_train, cars: `вагонов: ${Math.min(11, 3 + d.trainExtraCars)}` });
  if (trainActive(s, "royal_express"))
    rows.push({ id: "royal_express", at: s.timers.royal_express, cars: `вагонов: ${Math.min(17, 12 + s.buildings.platform_post)}` });
  return rows.sort((a, b) => a.at - b.at);
}

export default function ScheduleTab() {
  const game = useGame((s) => s.game);
  const d = derivedOf(game);
  const rows = boardRows(game, d);
  const nt = nextTrain(game);
  const clock = humanClock(game);

  return (
    <>
      <Toolbar icon="🚂" title="Расписание" />
      <Board s={game} rows={rows} nextId={nt?.id ?? null} clock={`${String(clock.hh).padStart(2, "0")}:${String(clock.mm).padStart(2, "0")}`} />
      <Whistle s={game} />

      <SectionTitle>Бригада на перроне</SectionTitle>
      <Crew s={game} d={d} />

      <SectionTitle>Журнал уловов</SectionTitle>
      <HaulLog s={game} />
    </>
  );
}

/* ------------------------------------------------------------ board */

function Board({ s, rows, nextId, clock }: { s: GameState; rows: BoardRow[]; nextId: SceneEventId | null; clock: string }) {
  return (
    <div className="overflow-hidden rounded-md border-2 border-[#3b2f22] bg-[#0f0d0b] shadow-[inset_0_2px_14px_rgba(0,0,0,.9),0_3px_0_#000,0_6px_16px_rgba(0,0,0,.5)]">
      <div className="flex items-center justify-between border-b border-[#2a2219] bg-gradient-to-b from-[#211b15] to-[#120f0c] px-2.5 py-1.5">
        <span className="font-display text-sm font-bold tracking-[0.25em] text-brass">ПРИБЫТИЯ</span>
        <span className="rr-board-glow font-mono text-sm tabular text-gaslight">
          <span className="rr-tick">🕰</span> {clock}
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="px-3 py-4 text-center font-mono text-xs text-parchment-dim">Табло молчит. Над решёткой пока не ходят даже кэбы.</p>
      ) : (
        <ul className="divide-y divide-[#2a2219]">
          {rows.map((r) => {
            const left = r.at - s.time;
            const live = s.scene?.id === r.id;
            const soon = !live && left <= 30;
            const isNext = r.id === nextId;
            const lines = EVENT_LINES[r.id];
            return (
              <li key={r.id} className={cx("grid grid-cols-[3.2rem_minmax(0,1fr)_auto] items-center gap-x-2 px-2.5 py-1.5", isNext && "bg-gaslight/[.06]")}>
                <span className="rr-board-glow font-mono text-sm tabular text-gaslight">{Number.isFinite(r.at) ? clockAt(r.at) : "--:--"}</span>
                <span className="min-w-0">
                  <span className="block truncate text-xs font-bold text-parchment">
                    {lines.icon} {lines.name}
                  </span>
                  <span className="block truncate font-mono text-[10px] uppercase tracking-wider text-parchment-dim">
                    {r.cars}
                    {isNext && <span className="ml-1.5 text-brass">· следующий</span>}
                  </span>
                </span>
                <span className="text-right">
                  <span className={cx("rr-board-glow block font-mono text-base leading-none tabular", live || soon ? "text-gaslight" : "text-brass-light")}>
                    {live ? "СЕЙЧАС" : Number.isFinite(left) ? fmtTime(Math.max(0, left)) : "—"}
                  </span>
                  <span
                    className={cx(
                      "block text-[9px] font-bold uppercase tracking-widest",
                      live ? "rr-blink text-danger-light" : soon ? "rr-blink text-gaslight" : "text-parchment-dim",
                    )}
                  >
                    {live ? "на путях" : soon ? "прибывает" : "по расписанию"}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Whistle({ s }: { s: GameState }) {
  const nt = nextTrain(s);
  const busy = !!s.scene;
  const used = !!nt && s.timers.whistleUsedFor === nt.at;
  const cost = Math.floor(s.res.coins * 0.1);
  const disabled = !nt || busy || used;
  const note = !nt
    ? "Поездов пока нет — свистеть некому."
    : busy
      ? "Сейчас не до свиста: на путях события."
      : used
        ? "Стрелочник уже подмазан в этом интервале."
        : `${EVENT_LINES[nt.id].name} придёт на минуту раньше. Плата — 10% монеток.`;
  return (
    <div className="mt-2 rounded-md border border-line bg-black/20 p-2">
      <BrassButton tone="verdigris" className="min-h-10 w-full" disabled={disabled} onClick={() => useGame.getState().whistle()}>
        🎺 Свистнуть стрелочнику
        {!disabled && <span className="ml-1.5 font-mono text-xs opacity-80">−{fmt(cost)} 🪙</span>}
      </BrassButton>
      <p className="mt-1 text-[11px] leading-snug text-parchment-dim">{note}</p>
    </div>
  );
}

/* ------------------------------------------------------------ crew */

function Crew({ s, d }: { s: GameState; d: Derived }) {
  const pos = s.trainPrefs.position;
  const half = s.meta.edicts.timetable_in_head ? 0.5 : 1;
  const metro = !!s.zones.metro;
  const trainAuto = Math.min(0.9, d.trainAutoBase * CREW_POSITIONS[pos].auto);
  const readyAuto = Math.min(0.9, (d.trainAutoBase + 0.15) * CREW_POSITIONS[pos].auto);

  return (
    <>
      <div role="radiogroup" aria-label="Позиция бригады по умолчанию" className="grid grid-cols-3 gap-1.5">
        {POSITIONS.map((p) => {
          const c = CREW_POSITIONS[p];
          const sel = p === pos;
          return (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={sel}
              onClick={() => useGame.getState().setTrainPref(p)}
              className={cx(
                "flex min-h-10 flex-col items-center gap-0.5 rounded-md border px-1 py-1.5 text-center transition",
                sel
                  ? "border-brass bg-gradient-to-b from-brass/25 to-brass/5 text-brass-light shadow-[0_0_10px_rgba(242,184,75,.2)]"
                  : "border-line bg-black/20 text-parchment-dim hover:text-parchment",
              )}
            >
              <span className="text-xl leading-none">{c.icon}</span>
              <span className="text-xs font-bold leading-tight">{c.name}</span>
            </button>
          );
        })}
      </div>

      <table className="mt-2 w-full border-separate border-spacing-0 overflow-hidden rounded-md border border-line text-[11px]">
        <thead>
          <tr className="bg-black/30 text-[9px] uppercase tracking-wider text-parchment-dim">
            <th className="px-2 py-1 text-left font-bold">Позиция</th>
            <th className="px-1 py-1 text-right font-bold">Автосбор</th>
            <th className="px-1 py-1 text-right font-bold">Авария</th>
            <th className="px-2 py-1 text-right font-bold">Крюк</th>
          </tr>
        </thead>
        <tbody className="font-mono tabular">
          {POSITIONS.map((p) => {
            const c = CREW_POSITIONS[p];
            const crash = c.crash * half;
            return (
              <tr key={p} className={cx(p === pos ? "bg-brass/10 text-brass-light" : "text-parchment")}>
                <td className="border-t border-line/60 px-2 py-1 font-sans">
                  {c.icon} {c.name}
                </td>
                <td className="border-t border-line/60 px-1 py-1 text-right">×{c.auto}</td>
                <td className={cx("border-t border-line/60 px-1 py-1 text-right", crash > 0 && "text-danger-light")}>{fmtPct(crash)}</td>
                <td className="border-t border-line/60 px-2 py-1 text-right">×{c.hook}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-1 text-[10px] leading-snug text-parchment-dim">
        Авария: 3% крыс (минимум одна) напуганы на 90 с. Насовсем никто не пропадает.
        {!metro && " Позиция пригодится, когда откроется Станция подземки."}
      </p>

      <div className={cx("mt-2 grid gap-2", metro ? "grid-cols-1" : "grid-cols-2")}>
        <div className={cx("rounded-md border border-line bg-black/25 px-2.5 py-2", !metro && "opacity-60")}>
          <p className="text-[10px] font-bold uppercase tracking-wider text-parchment-dim">🚂 Автосбор поездов</p>
          <p className="font-mono text-lg leading-tight tabular text-parchment">{fmtPct(trainAuto)}</p>
          <p className="text-[10px] leading-tight text-parchment-dim">с «По местам!» — {fmtPct(readyAuto)}</p>
        </div>
        {!metro && (
          <div className="rounded-md border border-line bg-black/25 px-2.5 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-parchment-dim">📯 Автосбор капсул</p>
            <p className="font-mono text-lg leading-tight tabular text-parchment">{fmtPct(d.capsuleAuto)}</p>
            <p className="text-[10px] leading-tight text-parchment-dim">капсул в составе: {d.capsuleCount}</p>
          </div>
        )}
      </div>

      {s.upgrades.wire_nets && (
        <p className="mt-2 rounded-md border border-line bg-black/20 px-2.5 py-1.5 text-[11px] leading-snug text-parchment-dim">
          🕸️ Сети: слотов <b className="text-parchment">{d.netSlots}</b>, цена{" "}
          <b className="font-mono text-parchment">{fmt(netCost(s, d))} ➰</b> за штуку.
          {s.trainPrefs.lastNets.length > 0 && <> В прошлый раз: {s.trainPrefs.lastNets.map((n) => ["левая", "центр", "правая"][n] ?? n).join(", ")}.</>}
        </p>
      )}
    </>
  );
}

/* ------------------------------------------------------------ haul log */

function HaulLog({ s }: { s: GameState }) {
  if (s.haulLog.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-line px-3 py-4 text-center text-xs italic text-parchment-dim">
        Журнал пуст. Первый улов впишут каллиграфическим почерком и обведут вензелем.
      </p>
    );
  }
  return (
    <ul className="space-y-1.5">
      {s.haulLog.map((h, i) => {
        const rating = RATING_TABLE.find((r) => r.id === h.rating);
        return (
          <li key={`${i}-${h.title}-${h.caughtCount}`} className="rounded-md border border-line bg-gradient-to-b from-panel-2/70 to-panel/70 px-2.5 py-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate font-display text-sm font-bold text-parchment">{h.title}</span>
              <span className="shrink-0 text-xs font-bold text-brass-light">
                {rating?.icon} {rating && rating.id !== "none" ? rating.name : "без медали"}
              </span>
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-parchment-dim">
              <span>поймано {fmtPct(h.share)}</span>
              {h.combo > 1 && <span>комбо ×{h.combo}</span>}
              {h.ratingBonus > 0 && <span className="text-good">+{fmtPct(h.ratingBonus)} за рейтинг</span>}
              {h.crash && <Badge tone="danger">авария</Badge>}
              {h.jackpot && <Badge>джекпот</Badge>}
            </div>
            <AmountList amounts={h.gained} className="mt-0.5" />
          </li>
        );
      })}
    </ul>
  );
}
