"use client";

/**
 * "Медали": the medal cabinet (+1% each), trophies, the two-scale bestiary of events,
 * lifetime statistics and the best train rating.
 */
import { memo } from "react";
import { EVENT_LINES, RATING_TABLE } from "@/game/data/events";
import { ACHIEVEMENT_ORDER, ACHIEVEMENTS } from "@/game/data/meta";
import { useGame } from "@/game/store";
import type { AchievementId, EventId, GameState, RunStats } from "@/game/types";
import { fmt, fmtInt, fmtTime } from "@/lib/format";
import { Badge, cx } from "@/components/ui/kit";
import { isFresh } from "./alerts";
import { SectionTitle, Toolbar } from "./common";

const TROPHIES: { id: string; icon: string; name: string; desc: string }[] = [
  { id: "cat_fur", icon: "🐈‍⬛", name: "Клок шерсти", desc: "Вырван у Кота Мурзифера в честном бою" },
  { id: "broken_pipe", icon: "🎶", name: "Сломанная дудка", desc: "Отобрана у Крысолова. Больше не поёт" },
];

const BESTIARY: EventId[] = ["carriage", "purse", "shiny", "capsule", "downpour", "market", "cat", "ratcatcher", "metro_train", "royal_express"];

const STATS: { key: keyof RunStats | "playSeconds" | "coinsEver"; label: string; fmt?: (n: number) => string }[] = [
  { key: "playSeconds", label: "Время под землёй", fmt: fmtTime },
  { key: "coinsEver", label: "Монеток за всё время", fmt },
  { key: "births", label: "Родилось крысят" },
  { key: "clicks", label: "Кликов по решётке" },
  { key: "autoClicks", label: "Заводных кликов" },
  { key: "carriages", label: "Экипажей" },
  { key: "purses", label: "Кошельков" },
  { key: "capsules", label: "Пневмокапсул" },
  { key: "trains", label: "Поездов пережито" },
  { key: "expresses", label: "Королевских экспрессов" },
  { key: "downpours", label: "Ливней" },
  { key: "cats", label: "Котов замечено" },
  { key: "catsBeaten", label: "Котов отогнано" },
  { key: "ratcatchers", label: "Крысоловов" },
  { key: "pipersBroken", label: "Дудок сломано" },
  { key: "sparksHit", label: "Искр задето" },
  { key: "bestCombo", label: "Лучшее комбо" },
  { key: "lanternMax", label: "Под фонарём (рекорд)" },
  { key: "hookPerfects", label: "Идеальных крюков" },
];

export default function MedalsTab() {
  const game = useGame((s) => s.game);
  const meta = game.meta;
  const earned = ACHIEVEMENT_ORDER.filter((a) => meta.achievements[a] !== undefined);
  const earnedKey = earned.join(",");
  const freshKey = earned.filter((a) => isFresh(game, `md_${a}`)).join(",");
  const best = RATING_TABLE.find((r) => r.id === meta.bestRating);

  return (
    <>
      <Toolbar
        icon="🏅"
        title="Медали Ратрополиса"
        right={<Badge tone="good">+{earned.length}% ко всему</Badge>}
      />
      <p className="mb-2 text-[11px] leading-snug text-parchment-dim">
        Получено {earned.length} из {ACHIEVEMENT_ORDER.length}. Каждая медаль — +1% ко всему производству, навсегда, даже после переселения.
      </p>
      <MedalGrid earnedKey={earnedKey} freshKey={freshKey} />

      <SectionTitle>Трофеи</SectionTitle>
      <div className="grid grid-cols-2 gap-1.5">
        {TROPHIES.map((t) => {
          const has = meta.trophies.includes(t.id);
          return (
            <div key={t.id} className={cx("rounded-lg border p-2 text-center", has ? "border-brass-dark bg-brass/10" : "border-dashed border-line bg-black/20")}>
              <div className={cx("text-2xl", !has && "rr-silhouette")}>{t.icon}</div>
              <p className={cx("font-display text-sm font-bold", has ? "text-brass-light" : "text-parchment-dim")}>{has ? t.name : "Пустая полка"}</p>
              <p className="text-[10px] leading-tight text-parchment-dim">{has ? t.desc : "Трофей ещё предстоит добыть"}</p>
            </div>
          );
        })}
      </div>

      <SectionTitle>Бестиарий</SectionTitle>
      <Bestiary s={game} />

      <SectionTitle>Летопись колонии</SectionTitle>
      <div className="mb-2 flex items-center justify-between rounded-md border border-line bg-black/25 px-2.5 py-1.5">
        <span className="text-xs text-parchment-dim">Лучший рейтинг поезда</span>
        <span className="font-display text-sm font-bold text-brass-light">{best && best.id !== "none" ? `${best.icon} ${best.name}` : "— пока нет"}</span>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 rounded-md border border-line bg-black/20 px-2.5 py-2 text-[11px]">
        {STATS.map((st) => {
          const v = meta.lifetime[st.key];
          return (
            <div key={st.key} className="flex min-w-0 items-baseline justify-between gap-2 border-b border-line/40 py-0.5">
              <dt className="truncate text-parchment-dim">{st.label}</dt>
              <dd className="shrink-0 font-mono tabular text-parchment">{(st.fmt ?? fmtInt)(v)}</dd>
            </div>
          );
        })}
      </dl>
    </>
  );
}

/** Medal cabinet; re-renders only when the earned set changes. */
const MedalGrid = memo(function MedalGrid({ earnedKey, freshKey }: { earnedKey: string; freshKey: string }) {
  const earned = new Set(earnedKey.split(",").filter(Boolean) as AchievementId[]);
  const fresh = new Set(freshKey.split(",").filter(Boolean));
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {ACHIEVEMENT_ORDER.map((id) => {
        const def = ACHIEVEMENTS[id];
        const has = earned.has(id);
        const hidden = !has && def.secret;
        return (
          <div
            key={id}
            className={cx(
              "relative flex min-w-0 gap-2 rounded-lg border p-1.5",
              has ? "border-brass-dark bg-gradient-to-b from-brass/15 to-panel" : "border-line bg-black/20",
            )}
          >
            <span
              className={cx(
                "grid h-9 w-9 shrink-0 place-items-center rounded-full border-2 text-lg",
                has ? "border-brass bg-gradient-to-b from-brass-light/30 to-brass-dark/30 shadow-[0_0_8px_rgba(242,184,75,.3)]" : "border-line bg-black/30",
              )}
            >
              <span className={cx(!has && "rr-silhouette")}>{hidden ? "❔" : def.icon}</span>
            </span>
            <div className="min-w-0">
              <p className={cx("font-display text-[13px] font-bold leading-tight", has ? "text-brass-light" : "text-parchment-dim")}>
                {hidden ? "???" : def.name}
              </p>
              <p className="text-[10px] leading-tight text-parchment-dim">{hidden ? "Секретная медаль" : def.desc}</p>
              {has && (
                <p className="text-[10px] leading-tight text-good">
                  +1% ко всему{def.reward ? ` · ${def.reward}` : ""}
                </p>
              )}
            </div>
            {fresh.has(id) && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-gaslight shadow-[0_0_6px_var(--gaslight)]" aria-label="новая" />}
          </div>
        );
      })}
    </div>
  );
});

function Bestiary({ s }: { s: GameState }) {
  const seen = new Set(s.meta.seenEvents);
  return (
    <ul className="space-y-1.5">
      {BESTIARY.map((id) => {
        const l = EVENT_LINES[id];
        const known = seen.has(id);
        return (
          <li key={id} className={cx("flex gap-2.5 rounded-lg border p-2", known ? "border-line bg-panel/60" : "border-dashed border-line/70 bg-black/20")}>
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-black/30 text-lg">
              <span className={cx(!known && "rr-silhouette")}>{l.icon}</span>
            </span>
            <div className="min-w-0">
              <p className={cx("font-display text-sm font-bold leading-tight", known ? "text-parchment" : "text-parchment-dim")}>{known ? l.name : "???"}</p>
              {known ? (
                <>
                  <p className="text-[11px] leading-snug text-parchment-dim">
                    👤 <i>«{l.human}»</i>
                  </p>
                  <p className="text-[11px] leading-snug text-parchment">
                    🐀 <i>«{l.rat}»</i>
                  </p>
                </>
              ) : (
                <p className="text-[11px] leading-snug text-parchment-dim">Ещё не встречалось. Крысы шепчутся, но толком никто не видел.</p>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
