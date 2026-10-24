"use client";

/**
 * Toast stack and the big one-at-a-time banners: medal coat of arms, «ЭКСТРЕННЫЙ ВЫПУСК» newspaper plate, «АВРАЛ!».
 * Placement: desktop — the colony's bottom-right corner above the ticker, clear of the side panel (≤ 3 toasts);
 * phones — right above the bottom sheet, measured from the panel's top edge (≤ 2; 1 with the sheet full; none
 * while a full-screen close-up runs). Both stand clear of Benedict's docked stall. The stack never takes clicks:
 * only ✕ and the action buttons do, so the grate and the colony stay playable underneath.
 * While a modal dialog covers the layout (offline report, coronation, migration, save issue) the banners and toasts
 * wait for it to close, their fuses paused, instead of playing out unseen underneath.
 * Fed by the engine fx bus (toast, vagrants, express stages, trains, scouts, records, commissions, medals, zones,
 * frenzy) and the UI bus (batched unlocks with «Открыть», generic toasts).
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { COMMISSIONS } from "@/game/data/commissions";
import { HEADLINES } from "@/game/data/headlines";
import { ACHIEVEMENTS, EXPRESS_STAGES } from "@/game/data/meta";
import { RESOURCES } from "@/game/data/resources";
import { ZONES } from "@/game/data/zones";
import { onFx, onUiFx, type UiFx } from "@/game/fx";
import { useGame, type TabId } from "@/game/store";
import type { AchievementId, Fx, RecordKey, SceneEventId, ZoneId } from "@/game/types";
import { cx } from "@/components/ui/kit";
import { fmt, plural } from "@/lib/format";
import HudStyles from "./HudStyles";

type Tone = "info" | "good" | "bad" | "gold";
type UnlockItem = Extract<UiFx, { k: "unlock" }>["items"][number];

interface ToastItem {
  id: number;
  icon: string;
  text: string;
  tone: Tone;
  ms: number;
  /** performance.now() of the last content change: an unlock batch within MERGE_MS joins the previous toast */
  at: number;
  /** bumps when merged content arrives: restarts the life fuse */
  rev: number;
  train?: { id: SceneEventId; inSec: number; at: number };
  unlock?: UnlockItem[];
  /** «Открыть»: store.focus(tab, target) */
  go?: { tab: TabId; target?: string };
  leaving?: boolean;
}

type Banner =
  | { id: number; k: "medal"; medal: AchievementId }
  | { id: number; k: "zone"; zone: ZoneId }
  | { id: number; k: "frenzy" };

/** Visible toasts: phones keep the colony clear, desktop has the corner to itself. */
const MAX_TOASTS = { phone: 2, desk: 3 } as const;
const TOAST_MS = 4000;
const UNLOCK_MS = 7000;
/** Unlock batches arriving this close together become one toast. */
const MERGE_MS = 3000;
/** Two «К путям!» for the same train (re-sent warning, a whistle that barely moved it) are one toast. */
const TRAIN_SAME_MS = 2000;
/** Phones: room left for the market's folded pill (46 px + a gap) under the stack. */
const STALL_PX = 52;
const BANNER_MS = { medal: 2500, zone: 2600, frenzy: 1500 } as const;
const OUT_MS = 260;

const RECORD_WHAT: Record<RecordKey, string> = {
  sewers: "Канализация открыта",
  cellars: "Подвалы открыты",
  metro: "Станция подземки открыта",
  terminal: "Большой вокзал открыт",
  coronation: "Коронация",
};

let seq = 0;

/**
 * Fuse time left (ms) of toasts that went off screen (a scene on a phone, a modal, the full sheet's one-toast limit):
 * back on screen they resume from it instead of restarting their whole life. `rev` ties it to the content it counted.
 */
const fuses = new Map<number, { rev: number; left: number }>();

const DESK_MQ = "(min-width: 768px)";

/** Phones with the full sheet have only a sliver of colony above it: one toast at a time there. */
function maxToasts(): number {
  if (window.matchMedia(DESK_MQ).matches) return MAX_TOASTS.desk;
  return useGame.getState().sheet === "full" ? 1 : MAX_TOASTS.phone;
}

function subscribeDesk(cb: () => void): () => void {
  const mq = window.matchMedia(DESK_MQ);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

/** Run time as «12:34» or «1:02:03». */
function runClock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

export default function Toasts() {
  const calm = useGame((s) => s.game.settings.reducedMotion);
  const sheet = useGame((s) => s.sheet);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [banners, setBanners] = useState<Banner[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const stackRef = useRef<HTMLDivElement>(null);
  const modal = useModalOpen(rootRef);
  // Benedict's docked stall sits in the colony's bottom-left corner: stand on top of it, not over it
  const stall = useGame((s) => !!s.game.market && !s.game.scene);
  useSheetAnchor(stackRef, stall);

  useEffect(() => {
    const add = (list: ToastItem[], t: ToastItem) => [...list.filter((x) => !x.leaving), t].slice(-maxToasts());
    const push = (t: Omit<ToastItem, "id" | "at" | "rev">) => {
      const item: ToastItem = { ...t, id: ++seq, at: performance.now(), rev: 0 };
      setToasts((list) => add(list, item));
    };
    const banner = (b: Banner) => setBanners((list) => (list.length > 6 ? list : [...list, b]));

    const unlock = (items: UnlockItem[]) => {
      if (items.length === 0) return;
      const now = performance.now();
      const fresh: ToastItem = { id: ++seq, icon: "🔓", text: "", tone: "good", ms: UNLOCK_MS, at: now, rev: 0, unlock: items, go: { tab: items[0].tab, target: items[0].key } };
      setToasts((list) => {
        let last: ToastItem | undefined;
        for (const x of list) if (x.unlock && !x.leaving) last = x;
        if (!last?.unlock || now - last.at >= MERGE_MS) return add(list, fresh);
        const known = new Set(last.unlock.map((u) => u.key));
        const merged = [...last.unlock, ...items.filter((it) => !known.has(it.key))];
        const target = last;
        return list.map((x) => (x === target ? { ...x, unlock: merged, at: now, rev: x.rev + 1 } : x));
      });
    };

    const handle = (fx: Fx) => {
      switch (fx.k) {
        case "toast":
          push({ icon: fx.icon ?? "📣", text: fx.text, tone: fx.tone ?? "info", ms: TOAST_MS });
          break;
        case "vagrants":
          push({ icon: "🐀", text: "Запах крошек привлёк гостей: +2 крысы", tone: "good", ms: TOAST_MS });
          break;
        case "expressStage": {
          const name = EXPRESS_STAGES[fx.stage - 1] ?? `этап ${fx.stage}`;
          push({ icon: "🚂", text: `Крысиный экспресс, этап ${fx.stage}/10: «${name}» готов!`, tone: "gold", ms: TOAST_MS + 1000 });
          break;
        }
        case "sceneStart":
          // the train is here: its «К путям!» countdown is over (and must not come back after the scene)
          if (fx.id === "capsule" || fx.id === "metro_train" || fx.id === "royal_express") setToasts((list) => list.filter((x) => !x.train));
          break;
        case "trainSoon": {
          if (!useGame.getState().game.settings.trainToasts) break;
          const at = performance.now() + fx.inSec * 1000;
          const icon = fx.id === "capsule" ? "📯" : fx.id === "royal_express" ? "👑" : "🚂";
          const item: ToastItem = { id: ++seq, icon, text: "", tone: "gold", ms: 8000, at: performance.now(), rev: 0, train: { id: fx.id, inSec: fx.inSec, at } };
          setToasts((list) => {
            // the same train announced twice: keep the toast already on screen
            if (list.some((x) => !x.leaving && x.train?.id === fx.id && Math.abs(x.train.at - at) < TRAIN_SAME_MS)) return list;
            // a moved train (the whistle) replaces the old countdown: two clocks would disagree
            return add(
              list.filter((x) => !x.train),
              item,
            );
          });
          break;
        }
        case "scout": {
          const map = !!useGame.getState().game.revealed.tab_map;
          push({
            icon: "🧭",
            text: `Разведчики вернулись: +${fmt(fx.amount)} ${RESOURCES[fx.res].icon} и кусок карты`,
            tone: "good",
            ms: TOAST_MS + 1500,
            go: map ? { tab: "map", target: `z_${fx.zone}` } : undefined,
          });
          break;
        }
        case "record": {
          const was = Number.isFinite(fx.prev) && fx.prev > 0 ? ` (было ${runClock(fx.prev)})` : "";
          push({ icon: "⏱️", text: `РЕКОРД: ${RECORD_WHAT[fx.what] ?? fx.what} за ${runClock(fx.time)}${was}`, tone: "gold", ms: TOAST_MS + 1500 });
          break;
        }
        case "commission": {
          if (!fx.done) break;
          const c = COMMISSIONS[fx.id];
          if (!c) break;
          push({ icon: c.icon, text: `Поручение Короля исполнено: «${c.name}». Грамота уже в казне!`, tone: "gold", ms: TOAST_MS + 1500, go: { tab: "map", target: "x_express" } });
          break;
        }
        case "medal":
          banner({ id: ++seq, k: "medal", medal: fx.id });
          break;
        case "zoneOpen":
          banner({ id: ++seq, k: "zone", zone: fx.zone });
          break;
        case "frenzy":
          banner({ id: ++seq, k: "frenzy" });
          break;
        default:
          break;
      }
    };

    const handleUi = (fx: UiFx) => {
      switch (fx.k) {
        case "unlock":
          unlock(fx.items);
          break;
        case "toast":
          push({ icon: fx.icon ?? "📣", text: fx.text, tone: "info", ms: fx.tab ? TOAST_MS + 2000 : TOAST_MS, go: fx.tab ? { tab: fx.tab, target: fx.target } : undefined });
          break;
        default:
          break;
      }
    };

    const offFx = onFx(handle);
    const offUi = onUiFx(handleUi);
    return () => {
      offFx();
      offUi();
    };
  }, []);

  const dismiss = (id: number) => {
    setToasts((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    window.setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), OUT_MS);
  };
  // a toast gone from the list (dismissed, pushed out by the stack limit, its train arrived) takes its kept fuse along
  useEffect(() => {
    const ids = new Set(toasts.map((t) => t.id));
    for (const id of fuses.keys()) if (!ids.has(id)) fuses.delete(id);
  }, [toasts]);

  const current = banners[0] ?? null;
  const nextBanner = () => setBanners((list) => list.slice(1));
  // phones: a close-up takes the whole screen — toasts wait for it to end (their fuses paused) instead of floating
  // over the falling loot; with the sheet full only the newest one fits, shortened. Everywhere: a modal holds them all.
  const desk = useSyncExternalStore(
    subscribeDesk,
    () => window.matchMedia(DESK_MQ).matches,
    () => true,
  );
  const sceneUp = useGame((s) => !!s.game.scene);
  const compact = !desk && sheet === "full";
  const shown = modal ? [] : desk ? toasts : sceneUp ? [] : compact ? toasts.slice(-1) : toasts;

  return (
    <div ref={rootRef} className={cx(calm && "hud-calm")}>
      <HudStyles />
      <div
        ref={stackRef}
        className={cx(
          "pointer-events-none fixed inset-x-2 z-40 flex flex-col items-center gap-1.5 md:inset-x-auto md:bottom-14 md:right-[408px] md:items-end xl:right-[468px]",
          // fallback until the panel edge is measured (useSheetAnchor writes the exact bottom on phones)
          sheet === "full" ? "bottom-[calc(74dvh+8px)]" : "bottom-[calc(45dvh+8px)]",
        )}
        aria-live="polite"
        role="status"
      >
        {shown.map((t) => (
          <Toast key={t.id} t={t} compact={compact} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
      {/* mounted (and its timer started) only once nothing covers it */}
      {current && !modal && <BannerView key={current.id} b={current} onDone={nextBanner} />}
    </div>
  );
}

const STALL_SELECTOR = 'main > section [role="region"][aria-label="Лавка Барыги Бенедикта"]';
/** md+: the stack's width (md:w-[340px]) and its bottom-14 resting line. */
const DESK_W = 340;
const DESK_BOTTOM = 56;

/**
 * Writes the stack's `bottom` directly (no re-render), re-measured by ResizeObservers on the panel and the stall:
 * - phones: 8 px above the panel sheet's top edge, following the half/full transition, plus room for the market's
 *   folded pill (an expanded stall is the player's choice: the toasts then overlap its top instead of the grate);
 *   with the sheet full the stack is also capped to the colony sliver, so it never climbs over the resource bar and
 *   the header (their buttons stay tappable);
 * - md+: the bottom-14 line, or just above Benedict's docked stall when the colony is too narrow for both side by side.
 */
function useSheetAnchor(ref: RefObject<HTMLDivElement | null>, stall: boolean) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const mq = window.matchMedia(DESK_MQ);
    const aside = document.querySelector("main > aside");
    let stallEl: HTMLElement | null = null;
    const place = () => {
      const vh = window.innerHeight;
      // the stall may mount a moment later (or remount): pick it up and watch its size (fold / unfold)
      if (stall && !stallEl?.isConnected) {
        stallEl = document.querySelector<HTMLElement>(STALL_SELECTOR);
        if (stallEl) ro.observe(stallEl);
      }
      const sr = stallEl?.isConnected ? stallEl.getBoundingClientRect() : null;
      const hasStall = !!sr && sr.height > 0;
      if (!mq.matches) {
        const top = aside?.getBoundingClientRect().top ?? 0;
        const bottom = top > 0 ? Math.round(vh - top + 8 + (hasStall ? STALL_PX : 0)) : null;
        el.style.bottom = bottom === null ? "" : `${bottom}px`;
        const roof = useGame.getState().sheet === "full" ? document.querySelector("main > section")?.getBoundingClientRect().top : undefined;
        const room = roof === undefined || bottom === null ? null : Math.max(0, Math.round(vh - bottom - roof - 8));
        el.style.maxHeight = room === null ? "" : `${room}px`;
        el.style.overflow = room === null ? "" : "hidden";
        return;
      }
      el.style.maxHeight = "";
      el.style.overflow = "";
      if (!sr || !hasStall) {
        el.style.bottom = "";
        return;
      }
      const right = (aside?.getBoundingClientRect().left ?? window.innerWidth) - 8;
      const sideBySide = sr.right + 8 <= right - DESK_W;
      el.style.bottom = sideBySide ? "" : `${Math.round(Math.max(DESK_BOTTOM, vh - sr.top + 8))}px`;
    };
    const ro = new ResizeObserver(place);
    if (aside) ro.observe(aside);
    place();
    window.addEventListener("resize", place);
    mq.addEventListener("change", place);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", place);
      mq.removeEventListener("change", place);
      el.style.bottom = "";
      el.style.maxHeight = "";
      el.style.overflow = "";
    };
  }, [ref, stall]);
}

/** A child of the layout root that is a modal dialog: the offline report, a ceremony, a save issue (or its loader). */
function modalIn(host: Element | null | undefined): boolean {
  if (!host) return false;
  for (const el of host.children) if (el.getAttribute("role") === "dialog" && el.getAttribute("aria-modal") === "true") return true;
  return false;
}

/**
 * Whether a modal dialog covers the layout. The overlays are children of the layout root (GameRoot), siblings of this
 * component's root: a childList observer on that root alone, so the colony's busy subtree costs nothing.
 */
function useModalOpen(ref: RefObject<HTMLDivElement | null>): boolean {
  const subscribe = useCallback(
    (cb: () => void) => {
      const host = ref.current?.parentElement;
      if (!host) return () => {};
      const mo = new MutationObserver(cb);
      mo.observe(host, { childList: true });
      return () => mo.disconnect();
    },
    [ref],
  );
  return useSyncExternalStore(
    subscribe,
    () => modalIn(ref.current?.parentElement),
    () => false,
  );
}

/* ------------------------------------------------------------ toast */

const TONE: Record<Tone, string> = {
  info: "border-brass-dark/80 bg-gradient-to-b from-panel-2 to-panel text-parchment",
  good: "border-verdigris/70 bg-gradient-to-b from-[#1f3b33] to-panel text-parchment",
  bad: "border-danger/80 bg-gradient-to-b from-[#4a1d18] to-panel text-parchment",
  gold: "border-gaslight/80 bg-gradient-to-b from-[#4a3818] to-panel text-parchment shadow-[0_0_14px_rgba(242,184,75,.35)]",
};

function Toast({ t, compact, onDismiss }: { t: ToastItem; compact: boolean; onDismiss: () => void }) {
  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  });

  // a toast back on screen resumes its fuse; a merge (rev) restarts it
  const kept = fuses.get(t.id);
  const left = kept && kept.rev === t.rev ? kept.left : t.ms;
  useEffect(() => {
    const start = performance.now();
    // «К путям!» also goes once its train is due: one the scene gap holds back does not sit at «0 с»
    const life = t.train ? Math.min(left, t.train.at - start + 1500) : left;
    const timer = window.setTimeout(() => dismissRef.current(), Math.max(0, life));
    return () => {
      window.clearTimeout(timer);
      fuses.set(t.id, { rev: t.rev, left: Math.max(0, left - (performance.now() - start)) });
    };
  }, [t.id, t.rev, t.train, left]);

  const go = t.go;
  // the action sits in its own column beside ✕, so a toast stays one text block tall (keeps the colony clear on phones)
  const action = t.train ? (
    <ActionButton
      onClick={() => {
        focusColony();
        onDismiss();
      }}
    >
      К перрону
    </ActionButton>
  ) : go ? (
    <ActionButton
      onClick={() => {
        useGame.getState().focus(go.tab, go.target);
        onDismiss();
      }}
    >
      Открыть
    </ActionButton>
  ) : null;

  return (
    <div
      className={cx(
        "pointer-events-none relative flex w-full max-w-[360px] items-start gap-2 overflow-hidden rounded-md border py-1.5 pl-2.5 pr-1 text-[13px] leading-snug shadow-[0_6px_18px_rgba(0,0,0,.55)] md:w-[340px]",
        TONE[t.tone],
        t.leaving ? "hud-toast-out" : "hud-toast-in",
      )}
    >
      <span className="mt-2 shrink-0 text-lg leading-none" aria-hidden>
        {t.icon}
      </span>
      <div className="flex min-h-10 min-w-0 flex-1 flex-col justify-center py-0.5">
        {t.train ? <TrainToastBody train={t.train} /> : t.unlock ? <UnlockBody items={t.unlock} compact={compact} /> : <span>{t.text}</span>}
      </div>
      {action && <div className="shrink-0 self-start pt-0.5">{action}</div>}
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Закрыть"
        className="pointer-events-auto -my-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded text-parchment-dim hover:bg-black/20 hover:text-parchment"
      >
        ✕
      </button>
      {/* life fuse */}
      <span
        key={t.rev}
        className="absolute inset-x-0 bottom-0 h-[2px] origin-left bg-current opacity-30"
        style={{ animation: t.leaving ? undefined : `hud-fuse ${t.ms}ms linear ${Math.round(left - t.ms)}ms both` }}
      />
    </div>
  );
}

function ActionButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="pointer-events-auto inline-flex min-h-10 items-center rounded border border-brass-dark bg-gradient-to-b from-brass-light via-brass to-brass-dark px-2.5 text-xs font-bold text-soot shadow-[inset_0_1px_0_rgba(255,255,255,.45),0_2px_0_#4a3a1a] active:translate-y-px md:min-h-8"
    >
      {children}
    </button>
  );
}

/**
 * «Открыто!» for one item, «Открыто: 3 новинки» with the list for a batch; «Открыть» goes to the first.
 * Compact (a phone with the sheet full: one sliver of colony) lists the first item only.
 */
function UnlockBody({ items, compact }: { items: UnlockItem[]; compact: boolean }) {
  const n = items.length;
  const shown = items.slice(0, compact ? 1 : 4);
  return (
    <div>
      <b className="font-display text-[15px] leading-tight tracking-wide text-verdigris-light">
        {n > 1 ? `Открыто: ${n} ${plural(n, "новинка", "новинки", "новинок")}` : "Открыто!"}
      </b>
      <ul className="mt-0.5 space-y-0.5">
        {shown.map((it) => (
          <li key={it.key} className="leading-snug">
            {it.text}
          </li>
        ))}
        {n > shown.length && <li className="italic text-parchment-dim">…и ещё {n - shown.length}</li>}
      </ul>
    </div>
  );
}

function TrainToastBody({ train }: { train: NonNullable<ToastItem["train"]> }) {
  // the seconds are written straight into the <b> (4×/s), the toast itself never re-renders for them
  const secRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const put = () => {
      const el = secRef.current;
      const v = String(Math.max(0, Math.ceil((train.at - performance.now()) / 1000)));
      if (el && el.textContent !== v) el.textContent = v;
    };
    put();
    const iv = window.setInterval(put, 250);
    return () => window.clearInterval(iv);
  }, [train.at]);
  const what = train.id === "capsule" ? "капсула" : train.id === "royal_express" ? "Королевский экспресс" : "поезд";
  return (
    <span>
      <b className="font-display text-[15px] tracking-wide text-gaslight">К путям!</b> {what} через{" "}
      <b ref={secRef} className="font-mono tabular">
        {train.inSec}
      </b>
      &nbsp;с
    </span>
  );
}

/** Bring the colony view into sight (it is always on screen in the default layout; this helps zoomed/odd viewports). */
function focusColony() {
  const el = document.querySelector("main > section");
  if (el instanceof HTMLElement) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

/* ------------------------------------------------------------ banners */

function BannerView({ b, onDone }: { b: Banner; onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  });
  useEffect(() => {
    const ms = BANNER_MS[b.k];
    const t1 = window.setTimeout(() => setLeaving(true), ms);
    const t2 = window.setTimeout(() => doneRef.current(), ms + 360);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [b.k]);

  const enter = b.k === "medal" ? "hud-banner-drop" : b.k === "zone" ? "hud-banner-spin" : "hud-banner-slam";
  return (
    <div
      className={cx("pointer-events-none fixed left-1/2 top-[54px] z-40 w-max max-w-[calc(100vw-24px)] md:top-[60px]", leaving ? "hud-banner-out" : enter)}
      style={{ transform: "translate(-50%,0)" }}
      role="status"
      aria-live="assertive"
    >
      {b.k === "medal" ? <MedalBanner id={b.medal} /> : b.k === "zone" ? <ZoneBanner zone={b.zone} /> : <FrenzyBanner />}
    </div>
  );
}

function MedalBanner({ id }: { id: AchievementId }) {
  const def = ACHIEVEMENTS[id];
  return (
    <div className="relative flex items-center gap-3 rounded-lg border-2 border-brass bg-gradient-to-b from-[#3a2c18] via-panel-2 to-panel px-3 py-2 pr-5 shadow-[0_0_0_1px_#4a3a1a,0_10px_30px_rgba(0,0,0,.65),0_0_30px_rgba(242,184,75,.3)]">
      <CoatOfArms icon={def.icon} />
      <div className="min-w-0">
        <div className="font-display text-[11px] font-bold uppercase tracking-[0.3em] text-brass">Медаль Ратрополиса</div>
        <div className="hud-brass-text truncate font-display text-xl font-bold leading-tight sm:text-2xl">{def.name}</div>
        <div className="text-xs text-parchment-dim">
          {def.desc} · <span className="font-bold text-good">+1% ко всему</span>
        </div>
      </div>
    </div>
  );
}

/** Shield with laurels and the medal icon. */
function CoatOfArms({ icon }: { icon: string }) {
  return (
    <span className="relative inline-flex h-14 w-14 shrink-0 items-center justify-center">
      <svg viewBox="-30 -30 60 60" className="hud-rays absolute -inset-2 h-[72px] w-[72px] opacity-60" aria-hidden>
        {Array.from({ length: 12 }, (_, i) => (
          <path key={i} d="M0 0 L-3 -30 L3 -30Z" fill="#f2b84b" opacity=".35" transform={`rotate(${i * 30})`} />
        ))}
      </svg>
      <svg viewBox="-24 -26 48 52" className="absolute inset-0 h-14 w-14" aria-hidden>
        <defs>
          <linearGradient id="hud-shield" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#e8c983" />
            <stop offset=".5" stopColor="#c9a25a" />
            <stop offset="1" stopColor="#7d5f2c" />
          </linearGradient>
        </defs>
        {/* laurels */}
        {[-1, 1].map((s) => (
          <g key={s} transform={`scale(${s},1)`}>
            {Array.from({ length: 5 }, (_, i) => (
              <ellipse key={i} cx={-19 + i * 1.2} cy={14 - i * 7} rx={2.2} ry={4.4} fill="#4f9d8a" transform={`rotate(${-35 + i * 9} ${-19 + i * 1.2} ${14 - i * 7})`} />
            ))}
          </g>
        ))}
        <path d="M-15 -20 H15 V2 C15 13 6 19 0 23 C-6 19 -15 13 -15 2Z" fill="url(#hud-shield)" stroke="#4a3a1a" strokeWidth="1.5" />
        <path d="M-11.5 -16.5 H11.5 V2 C11.5 10.5 4.5 15.5 0 18.5 C-4.5 15.5 -11.5 10.5 -11.5 2Z" fill="#231c16" />
        <path d="M-6 -24 L-3 -20 L0 -25 L3 -20 L6 -24 L5 -19 H-5Z" fill="#f2b84b" stroke="#7d5f2c" strokeWidth=".6" />
      </svg>
      <span className="relative -mt-1 text-[22px] leading-none">{icon}</span>
    </span>
  );
}

function ZoneBanner({ zone }: { zone: ZoneId }) {
  const lines = HEADLINES[`zone_${zone}`] ?? [];
  const head = (lines[0] ?? `КРЫСЫ ОСВОИЛИ: ${ZONES[zone].name.toUpperCase()}!`).replace(/^ЭКСТРЕННЫЙ ВЫПУСК:\s*/, "");
  const sub = lines[1] ?? ZONES[zone].ratLine;
  return (
    <div className="hud-paper w-[min(92vw,520px)] rounded-sm border-2 border-[#2a1f14] px-4 py-2.5 text-center shadow-[0_14px_36px_rgba(0,0,0,.7)]">
      <div className="flex items-center justify-between border-b-2 border-[#2a1f14] pb-0.5 font-display text-[10px] font-bold uppercase tracking-[0.2em]">
        <span>№ {ZONES[zone].order}</span>
        <span>Крысиные Ведомости</span>
        <span>{ZONES[zone].icon}</span>
      </div>
      <div className="mt-1 font-display text-[11px] font-bold uppercase tracking-[0.35em] text-[#8a2a1f]">Экстренный выпуск</div>
      <div className="font-display text-[22px] font-bold uppercase leading-[1.05] tracking-wide sm:text-[28px]">{head}</div>
      <div className="hud-rule mt-1.5 pt-1 text-[12px] italic leading-snug text-[#4a3826]">{sub}</div>
    </div>
  );
}

function FrenzyBanner() {
  return (
    <div className="relative rounded-md border-2 border-gaslight bg-gradient-to-b from-[#7a2620] via-danger to-[#5a1c17] px-6 py-1.5 text-center shadow-[0_0_0_2px_#3a120f,0_0_34px_rgba(242,184,75,.65)]">
      <div
        className="hud-shine font-display text-[34px] font-bold uppercase leading-none tracking-[0.12em] text-transparent sm:text-[42px]"
        style={{
          backgroundImage: "linear-gradient(100deg,#f2b84b 0%,#fff1c9 25%,#f2b84b 45%,#e8c983 70%,#fff1c9 85%,#f2b84b 100%)",
          WebkitBackgroundClip: "text",
          backgroundClip: "text",
          filter: "drop-shadow(0 2px 0 rgba(0,0,0,.6))",
        }}
      >
        Аврал!
      </div>
      <div className="text-[11px] font-bold uppercase tracking-[0.25em] text-parchment">Все бегают, все пищат, все тащат</div>
    </div>
  );
}
