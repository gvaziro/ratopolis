"use client";

/**
 * The station departures board «🚂 через 2м 31с» pinned to the right of «Наверху».
 * Shows the next capsule (📯) / train (🚂) / royal express (👑); blinks in the last 30 s,
 * reads «НА ПЕРРОНЕ» while a train scene runs. Click opens the «Расписание» tab.
 */
import { nextTrain } from "@/game/engine/events";
import { useGame } from "@/game/store";
import { cx } from "@/components/ui/kit";
import { fmtTime } from "@/lib/format";

const ICON = { capsule: "📯", metro_train: "🚂", royal_express: "👑" } as const;
const NAME = { capsule: "Капсула", metro_train: "Поезд", royal_express: "Экспресс" } as const;

export default function DepartureBoard() {
  const next = useGame((s) => nextTrain(s.game)?.id ?? null);
  const left = useGame((s) => {
    const n = nextTrain(s.game);
    return n ? Math.max(0, Math.ceil(n.at - s.game.time)) : -1;
  });
  const onStage = useGame((s) => {
    const id = s.game.scene?.id;
    return id === "capsule" || id === "metro_train" || id === "royal_express" ? id : null;
  });
  const canOpen = useGame((s) => !!s.game.revealed.tab_schedule);

  const id = onStage ?? next;
  if (!id) return null;
  const soon = !onStage && left >= 0 && left <= 30;
  const label = onStage ? "на перроне!" : `через ${fmtTime(left)}`;

  return (
    <button
      type="button"
      onClick={() => canOpen && useGame.getState().setTab("schedule")}
      title={canOpen ? "Открыть расписание" : undefined}
      aria-label={`${NAME[id]} ${label}`}
      className={cx(
        "group absolute right-1.5 top-1/2 z-10 flex min-h-10 -translate-y-1/2 items-center sm:right-2.5",
        canOpen ? "cursor-pointer" : "cursor-default",
      )}
    >
      <span
        className={cx(
          "relative flex items-center gap-1 rounded-[3px] border px-1.5 py-[3px] font-mono text-[11px] leading-none tabular shadow-[inset_0_1px_3px_rgba(0,0,0,.8),0_2px_6px_rgba(0,0,0,.55)] sm:gap-1.5 sm:px-2 sm:py-1 sm:text-[13px]",
          "border-brass-dark bg-[#0d0b0a]/90",
          onStage || soon ? "text-gaslight" : "text-[#f2c86a]",
          canOpen && "group-hover:border-brass",
        )}
        style={{ textShadow: "0 0 6px rgba(242,184,75,.55)" }}
      >
        {/* two little bolts */}
        <span className="absolute left-0.5 top-0.5 h-[3px] w-[3px] rounded-full bg-brass-dark" />
        <span className="absolute bottom-0.5 right-0.5 h-[3px] w-[3px] rounded-full bg-brass-dark" />
        <span aria-hidden className="text-[12px] sm:text-[14px]">
          {ICON[id]}
        </span>
        <span className={cx("hidden uppercase tracking-wider text-parchment-dim md:inline", onStage && "text-gaslight")}>{NAME[id]}</span>
        <span className={cx("whitespace-nowrap font-bold", (onStage || soon) && "sk-board-blink")}>{label}</span>
      </span>
    </button>
  );
}
