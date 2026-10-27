"use client";

/**
 * Developer tools: only with NODE_ENV=development or `?dev` in the URL.
 * A floating 🛠 button opens a compact panel: time warp, give resources, open zones,
 * trigger events, shell checks (sample toasts, a render / engine crash), and a live readout of game time, fps and
 * the current scene. In dev the fx buses are on `window.__rrFx`.
 */
import { useEffect, useState, type ReactNode } from "react";
import { EVENT_LINES } from "@/game/data/events";
import { RESOURCES, RES_ORDER } from "@/game/data/resources";
import { ZONES, ZONE_ORDER } from "@/game/data/zones";
import { emitFx, emitUiFx } from "@/game/fx";
import { useGame } from "@/game/store";
import type { GameState, ResId, SceneEventId, ZoneId } from "@/game/types";
import { cx } from "@/components/ui/kit";
import { fmt, fmtDuration } from "@/lib/format";

type Trigger = SceneEventId | "purse" | "market";
const TRIGGERS: Trigger[] = ["carriage", "capsule", "metro_train", "royal_express", "downpour", "cat", "ratcatcher", "purse", "market"];
const WARPS: [string, number][] = [
  ["+1 мин", 60],
  ["+10 мин", 600],
  ["+1 ч", 3600],
];
const ZONE_SHORT: Record<ZoneId, string> = { burrow: "Нора", sewers: "Канализация", cellars: "Подвалы", metro: "Метро", terminal: "Вокзал" };
const GIVES: [string, number][] = [
  ["×100", 100],
  ["×10K", 1e4],
  ["×1M", 1e6],
];

export default function DevPanel() {
  const [enabled] = useState(() => {
    if (process.env.NODE_ENV === "development") return true;
    try {
      return new URLSearchParams(window.location.search).has("dev");
    } catch {
      return false;
    }
  });
  if (!enabled) return null;
  return <Dev />;
}

const BTN =
  "inline-flex min-h-9 items-center justify-center rounded border border-line bg-panel-2 px-2 text-[11px] font-bold text-parchment transition hover:border-brass-dark hover:bg-panel-3 active:translate-y-px disabled:opacity-40";

/**
 * The 🛠 tab: half tucked behind the right edge at mid-height (out of the way of the panel's buttons and the scenes'
 * «Готово» / «Дальше»), sliding out on hover or focus; hidden while a close-up runs unless the panel is open.
 */
function Dev() {
  const [open, setOpen] = useState(false);
  const sceneUp = useGame((s) => !!s.game.scene);
  if (sceneUp && !open) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Инструменты разработчика"
        title="Инструменты разработчика"
        className={cx(
          "fixed right-0 top-1/2 z-50 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-brass-dark bg-soot-2/90 text-lg shadow-[0_3px_10px_rgba(0,0,0,.6)] transition hover:bg-panel-3",
          open ? "translate-x-0 border-brass bg-panel-3" : "translate-x-1/2 hover:translate-x-0 focus-visible:translate-x-0",
        )}
      >
        🛠
      </button>
      {open && <Panel onClose={() => setOpen(false)} />}
    </>
  );
}

function Panel({ onClose }: { onClose: () => void }) {
  const [res, setRes] = useState<ResId>("crumbs");
  const time = useGame((s) => s.game.time);
  const scene = useGame((s) => (s.game.scene ? `${s.game.scene.id} · ${s.game.scene.phase}${s.game.scene.interactive ? " · UI" : ""}` : "—"));
  const zones = useGame((s) => ZONE_ORDER.map((z) => (s.game.zones[z] ? "1" : "0")).join(""));
  const extra = useGame((s) => `${s.game.purse ? "👛 " : ""}${s.game.market ? "🧺 " : ""}${s.game.shinies.length ? `✨${s.game.shinies.length}` : ""}`);
  const fps = useFps();
  const st = () => useGame.getState();

  return (
    <div className="fixed bottom-[84px] right-2 z-50 max-h-[min(70dvh,560px)] w-[min(330px,calc(100vw-16px))] overflow-y-auto rounded-lg border border-brass-dark bg-soot-2/95 p-2.5 text-xs text-parchment shadow-[0_10px_30px_rgba(0,0,0,.7)] backdrop-blur-sm">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-display text-sm font-bold tracking-wide text-brass-light">🛠 Мастерская разработчика</span>
        <button type="button" onClick={onClose} className="inline-flex h-8 w-8 items-center justify-center rounded text-parchment-dim hover:bg-panel-3" aria-label="Закрыть">
          ✕
        </button>
      </div>

      <dl className="mb-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 rounded border border-line bg-soot/70 p-1.5 font-mono text-[11px] tabular">
        <dt className="text-parchment-dim">time</dt>
        <dd>
          {time.toFixed(1)} с ({fmtDuration(time)})
        </dd>
        <dt className="text-parchment-dim">fps</dt>
        <dd className={fps < 45 ? "text-danger-light" : "text-good"}>{fps}</dd>
        <dt className="text-parchment-dim">scene</dt>
        <dd className="truncate">{scene}</dd>
        <dt className="text-parchment-dim">bg</dt>
        <dd>{extra || "—"}</dd>
      </dl>

      <Group title="Варп времени">
        {WARPS.map(([label, sec]) => (
          <button key={sec} type="button" className={BTN} onClick={() => st().devWarp(sec)}>
            ⏩ {label}
          </button>
        ))}
      </Group>

      <Group title="Выдать ресурс">
        <select
          value={res}
          onChange={(e) => setRes(e.target.value as ResId)}
          className="min-h-9 rounded border border-line bg-panel px-1.5 text-[11px] text-parchment focus:border-brass-dark"
          aria-label="Ресурс"
        >
          {RES_ORDER.map((r) => (
            <option key={r} value={r}>
              {RESOURCES[r].icon} {RESOURCES[r].name}
            </option>
          ))}
        </select>
        {GIVES.map(([label, n]) => (
          <button key={n} type="button" className={BTN} onClick={() => st().devGive(res, n)} title={`+${fmt(n)}`}>
            {label}
          </button>
        ))}
      </Group>

      <Group title="Открыть зону">
        {ZONE_ORDER.map((z, i) => (
          <button key={z} type="button" className={BTN} disabled={zones[i] === "1"} onClick={() => st().devOpenZone(z)} title={ZONES[z].name}>
            {ZONES[z].icon} {ZONE_SHORT[z]}
          </button>
        ))}
      </Group>

      <Group title="Вызвать событие">
        {TRIGGERS.map((id) => (
          <button key={id} type="button" className={BTN} onClick={() => st().devTrigger(id)} title={EVENT_LINES[id].name}>
            {EVENT_LINES[id].icon} {id}
          </button>
        ))}
      </Group>

      <Group title="Проверить оболочку">
        <button type="button" className={BTN} onClick={sampleToasts} title="Тост, разведчики, рекорд и пачка «Открыто»">
          🍞 Тосты ×4
        </button>
        <button
          type="button"
          className={BTN}
          onClick={() => useGame.setState((s) => ({ game: { ...s.game, shinies: [{ id: -1 } as GameState["shinies"][number]] } }))}
          title="Битая блестяшка: рендер падает, должен выйти экран «Крысы перегрызли провод»"
        >
          💥 Крэш рендера
        </button>
        <button type="button" className={BTN} onClick={() => useGame.setState({ crashed: true, crashError: "DevPanel: пробный крэш движка" })}>
          ⚙️ Крэш движка
        </button>
      </Group>
    </div>
  );
}

/** Four toasts of different kinds at once (placement checks: the grate, the market and the panel must stay clear). */
function sampleToasts() {
  emitFx([
    { k: "toast", text: "Пробный тост: колония на связи", icon: "📣", tone: "info" },
    { k: "scout", zone: "sewers", res: "coins", amount: 120, step: 1 },
    { k: "record", what: "sewers", time: 754, prev: 902 },
  ]);
  emitUiFx({
    k: "unlock",
    items: [
      { key: "j_pickpocket", tab: "jobs", text: "🎩 Новая работа: Карманник — приносит 🪙" },
      { key: "b_pantry", tab: "buildings", text: "🥫 Можно строить Кладовку — лимит 🍞 +150" },
    ],
  });
}

/** Dev console handle for the fx buses: `__rrFx.emitFx([...])`, `__rrFx.emitUiFx({...})`. */
if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
  (window as unknown as { __rrFx?: { emitFx: typeof emitFx; emitUiFx: typeof emitUiFx } }).__rrFx = { emitFx, emitUiFx };
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-2">
      <div className="mb-1 font-display text-[11px] font-bold uppercase tracking-[0.14em] text-brass">{title}</div>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  );
}

/** Frames per second, sampled twice a second. */
function useFps(): number {
  const [fps, setFps] = useState(0);
  useEffect(() => {
    let raf = 0;
    let frames = 0;
    let since = performance.now();
    const loop = (now: number) => {
      frames++;
      if (now - since >= 500) {
        setFps(Math.round((frames * 1000) / (now - since)));
        frames = 0;
        since = now;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return fps;
}
