"use client";

/**
 * Toast stack and the big one-at-a-time banners: medal coat of arms, «ЭКСТРЕННЫЙ ВЫПУСК» newspaper plate, «АВРАЛ!».
 * Placement: desktop — the colony's bottom-right corner above the ticker, clear of the side panel (≤ 3 toasts);
 * phones — right above the bottom sheet, measured from the panel's top edge (≤ 2; 1 with the sheet full), the stack
 * no taller than 38% of the colony (the oldest give way). Both stand clear of Benedict's docked stall. The stack
 * never takes clicks: only ✕ and the action buttons do, so the grate and the colony stay playable underneath.
 * Flood control (v3 SHL-1, rules in ./toastRules): while a modal dialog covers the layout (offline report,
 * coronation, migration, save issue), while a close-up scene runs (haul card included) and while the zone's
 * «ЭКСТРЕННЫЙ ВЫПУСК» is up, nothing shows: new toasts queue (fuses untouched), shown ones pause their fuses, and the
 * banners wait; afterwards the queue fills the free slots in order. Unlocks are one short row per item, early medals
 * that land within 5 s share one banner, and the first ten minutes keep two toasts at most.
 * Fed by the engine fx bus (toast, vagrants, express stages, trains, scouts, records, commissions, medals, zones,
 * frenzy) and the UI bus (batched unlocks with «Открыть», generic toasts).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { COMMISSIONS } from "@/game/data/commissions";
import { EVENT_LINES } from "@/game/data/events";
import { HEADLINES } from "@/game/data/headlines";
import { ACHIEVEMENTS, EXPRESS_STAGES } from "@/game/data/meta";
import { ZONES } from "@/game/data/zones";
import { onFx, onUiFx, type UiFx } from "@/game/fx";
import { useGame, type TabId } from "@/game/store";
import type { AchievementId, Fx, RecordKey, SceneEventId, ZoneId } from "@/game/types";
import { cx } from "@/components/ui/kit";
import { isPhoneLayout, isShortLayout, matchesQuery, usePhoneLayout } from "@/lib/layoutMode";
import { applySwUpdate, SW_UPDATE_TARGET } from "@/components/ui/swClient";
import HudStyles from "./HudStyles";
import {
  EARLY_SEC,
  MEDAL_SHOWN_EVENT,
  UNLOCK_ROWS,
  addToast,
  commissionDoneText,
  joinsMedalGroup,
  medalGroupText,
  medalGroupTitle,
  scoutToastText,
  toastCap,
  unlockRow,
  unlockTitle,
  visibleToasts,
} from "./toastRules";

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
  /** arrived while the stack was held and has not been on screen yet (toastRules.addToast) */
  wait?: boolean;
  train?: { id: SceneEventId; inSec: number; at: number };
  unlock?: UnlockItem[];
  /** «Открыть»: store.focus(tab, target) */
  go?: { tab: TabId; target?: string };
  leaving?: boolean;
}

type Banner =
  | { id: number; k: "medal"; medals: AchievementId[]; at: number }
  | { id: number; k: "zone"; zone: ZoneId }
  | { id: number; k: "frenzy" };

const TOAST_MS = 4000;
/** «Новая версия колонии — обновить» (SHL-6). */
const UPDATE_MS = 20000;
const UNLOCK_MS = 7000;
/** Unlock batches arriving this close together become one toast. */
const MERGE_MS = 3000;
/** Two «К путям!» for the same train (re-sent warning, a whistle that barely moved it) are one toast. */
const TRAIN_SAME_MS = 2000;
/** Phones: room left for the market's folded pill (46 px + a gap) under the stack. */
const STALL_PX = 52;
/** Phones: the stack takes at most this share of the colony's height (the oldest toasts give way). */
const PHONE_STACK_SHARE = 0.38;
const STACK_GAP = 6;
/** Arriving with the «ЭКСТРЕННЫЙ ВЫПУСК» of a zone: toasts wait about this long (ms) for the newspaper to go. */
const ZONE_HOLD_MS = 3000;
/** A purse outcome toast follows its `purse` fx in the same batch. */
const PURSE_PAIR_MS = 60;
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
 * Fuse time left (ms) of toasts that went off screen (a scene, a modal, the zone newspaper, the full sheet's
 * one-toast limit): back on screen they resume from it instead of restarting their whole life. `rev` ties it to the
 * content it counted.
 */
const fuses = new Map<number, { rev: number; left: number }>();

/** The bottom-sheet geometry (CSS `max-md`): the panel sits under the colony instead of beside it. */
const NARROW_MQ = "(max-width: 767px)";

function subscribeNarrow(cb: () => void): () => void {
  const mq = window.matchMedia(NARROW_MQ);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

function useNarrow(): boolean {
  return useSyncExternalStore(
    subscribeNarrow,
    () => matchesQuery(NARROW_MQ),
    () => false,
  );
}

/** How many toasts fit right now (event handlers; the render uses the same rule through hooks). */
function capNow(): number {
  const st = useGame.getState();
  return toastCap({ phone: isPhoneLayout(), compact: matchesQuery(NARROW_MQ) && st.sheet === "full", early: st.game.time < EARLY_SEC });
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
  const phone = usePhoneLayout();
  const narrow = useNarrow();
  // Benedict's docked stall sits in the colony's bottom-left corner: stand on top of it, not over it
  const stall = useGame((s) => !!s.game.market && !s.game.scene);
  useSheetAnchor(stackRef, stall);

  useEffect(() => {
    /** performance.now() until which a zone's newspaper (just announced) holds new toasts */
    let zoneUntil = 0;
    /** the last `purse` fx: its outcome toast follows in the same batch */
    let purse: { outcome: string; at: number } | null = null;
    /** charters before the latest publish: a commission paid in it promises a charter only if one still counted */
    let chartersBefore = useGame.getState().game.charters ?? 0;
    const offStore = useGame.subscribe((st, prev) => {
      if (st.game !== prev.game) chartersBefore = prev.game.charters ?? 0;
    });

    /** A modal, a scene or the zone newspaper: new toasts queue instead of showing. */
    const held = () => modalIn(rootRef.current?.parentElement) || !!useGame.getState().game.scene || performance.now() < zoneUntil;
    const add = (t: ToastItem) => {
      const cap = capNow();
      const hold = held();
      setToasts((list) => addToast(list, t, cap, hold));
    };
    const push = (t: Omit<ToastItem, "id" | "at" | "rev">) => add({ ...t, id: ++seq, at: performance.now(), rev: 0 });
    const banner = (b: Banner) => setBanners((list) => (list.length > 6 ? list : [...list, b]));

    const unlock = (items: UnlockItem[]) => {
      if (items.length === 0) return;
      const now = performance.now();
      const fresh: ToastItem = { id: ++seq, icon: "🔓", text: "", tone: "good", ms: UNLOCK_MS, at: now, rev: 0, unlock: items, go: { tab: items[0].tab, target: items[0].key } };
      const cap = capNow();
      const hold = held();
      setToasts((list) => {
        let last: ToastItem | undefined;
        for (const x of list) if (x.unlock && !x.leaving) last = x;
        if (!last?.unlock || now - last.at >= MERGE_MS) return addToast(list, fresh, cap, hold);
        const known = new Set(last.unlock.map((u) => u.key));
        const merged = [...last.unlock, ...items.filter((it) => !known.has(it.key))];
        const target = last;
        return list.map((x) => (x === target ? { ...x, unlock: merged, at: now, rev: x.rev + 1 } : x));
      });
    };

    /** Phones: a toast whose news is already on screen (Benedict's stall, a purse paid out where it lay) stays unsaid. */
    const redundant = (fx: Extract<Fx, { k: "toast" }>): boolean => {
      if (!isPhoneLayout()) return false;
      const st = useGame.getState();
      // the stall docks in the colony at once (or right after a scene: its lifetime waits for it)
      if (fx.icon === EVENT_LINES.market.icon && st.game.market) return true;
      if (st.game.scene) return false;
      const p = purse;
      if (!p || performance.now() - p.at > PURSE_PAIR_MS) return false;
      purse = null;
      // coins burst out of the purse and a free chamber bounces: both are seen where the purse lay; the buffs
      // (feast, lucky paw) have no other explanation and keep their toast
      const colonyShown = !(matchesQuery(NARROW_MQ) && st.sheet === "full");
      return colonyShown && (p.outcome === "coins" || p.outcome === "button");
    };

    const handle = (fx: Fx) => {
      switch (fx.k) {
        case "toast":
          if (redundant(fx)) break;
          push({ icon: fx.icon ?? "📣", text: fx.text, tone: fx.tone ?? "info", ms: TOAST_MS });
          break;
        case "purse":
          purse = { outcome: fx.outcome, at: performance.now() };
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
          const cap = capNow();
          setToasts((list) => {
            // the same train announced twice: keep the toast already on screen
            if (list.some((x) => !x.leaving && x.train?.id === fx.id && Math.abs(x.train.at - at) < TRAIN_SAME_MS)) return list;
            // a moved train (the whistle) replaces the old countdown: two clocks would disagree; a countdown never
            // queues (it is merely hidden while something holds the stack, and keeps counting)
            return addToast(
              list.filter((x) => !x.train),
              item,
              cap,
              false,
            );
          });
          break;
        }
        case "scout": {
          const map = !!useGame.getState().game.revealed.tab_map;
          push({
            icon: "🧭",
            // the 90% step (v3 ENG-3) has its own line: «до цели рукой подать»
            text: scoutToastText(fx),
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
          push({ icon: c.icon, text: commissionDoneText(c.name, chartersBefore), tone: "gold", ms: TOAST_MS + 1500, go: { tab: "map", target: "x_express" } });
          break;
        }
        case "medal": {
          const now = performance.now();
          const gameTime = useGame.getState().game.time;
          const id = ++seq;
          setBanners((list) => {
            // the first ten minutes: medals within 5 s of each other share one banner (shown or still waiting)
            let last: Extract<Banner, { k: "medal" }> | undefined;
            for (const b of list) if (b.k === "medal") last = b;
            if (last && joinsMedalGroup(last, now, gameTime)) {
              if (last.medals.includes(fx.id)) return list;
              const target = last;
              return list.map((b) => (b === target ? { ...target, medals: [...target.medals, fx.id], at: now } : b));
            }
            return list.length > 6 ? list : [...list, { id, k: "medal", medals: [fx.id], at: now }];
          });
          break;
        }
        case "zoneOpen":
          // the newspaper is exclusive: what arrives with it waits until it has gone
          zoneUntil = performance.now() + ZONE_HOLD_MS;
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
        case "toast": {
          // a new offline version (SHL-6) stays up longer: its «Обновить» reloads the tab
          const update = fx.target === SW_UPDATE_TARGET;
          push({ icon: fx.icon ?? "📣", text: fx.text, tone: update ? "gold" : "info", ms: update ? UPDATE_MS : fx.tab ? TOAST_MS + 2000 : TOAST_MS, go: fx.tab ? { tab: fx.tab, target: fx.target } : undefined });
          break;
        }
        default:
          break;
      }
    };

    const offFx = onFx(handle);
    const offUi = onUiFx(handleUi);
    return () => {
      offStore();
      offFx();
      offUi();
    };
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    window.setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), OUT_MS);
  }, []);
  /** A queued toast got a slot on screen: from now on it is an ordinary shown toast. */
  const shownNow = useCallback((id: number) => {
    setToasts((list) => (list.some((t) => t.id === id && t.wait) ? list.map((t) => (t.id === id ? { ...t, wait: false } : t)) : list));
  }, []);
  // a toast gone from the list (dismissed, pushed out by the stack limit, its train arrived) takes its kept fuse along
  useEffect(() => {
    const ids = new Set(toasts.map((t) => t.id));
    for (const id of fuses.keys()) if (!ids.has(id)) fuses.delete(id);
  }, [toasts]);

  const current = banners[0] ?? null;
  const nextBanner = () => setBanners((list) => list.slice(1));
  const sceneUp = useGame((s) => !!s.game.scene);
  const early = useGame((s) => s.game.time < EARLY_SEC);
  // with the phone sheet full only the newest toast fits, shortened
  const compact = narrow && sheet === "full";
  const held = modal || sceneUp || current?.k === "zone";
  const cap = toastCap({ phone, compact, early });
  const shown = visibleToasts(toasts, cap, held);
  const shownKey = shown.map((t) => `${t.id}.${t.rev}`).join(" ");
  // phones: the stack keeps to 38% of the colony; older toasts that do not fit step aside until there is room
  useLayoutEffect(() => {
    const el = stackRef.current;
    if (el) fitStack(el);
  }, [shownKey, compact, phone]);

  return (
    <div ref={rootRef} className={cx(calm && "hud-calm")}>
      <HudStyles />
      <div
        ref={stackRef}
        className={cx(
          "pointer-events-none fixed inset-x-2 z-40 flex flex-col items-center gap-1.5 md:inset-x-auto md:bottom-[calc(56px_+_env(safe-area-inset-bottom))] md:right-[calc(408px_+_env(safe-area-inset-right))] md:items-end xl:right-[calc(468px_+_env(safe-area-inset-right))] md:short:bottom-[calc(12px_+_env(safe-area-inset-bottom))]",
          // fallback until the panel edge is measured (useSheetAnchor writes the exact bottom on phones)
          sheet === "full" ? "bottom-[calc(74dvh+8px)]" : "bottom-[calc(45dvh+8px)]",
        )}
        aria-live="polite"
        role="status"
      >
        {shown.map((t) => (
          <Toast key={t.id} t={t} compact={compact} phone={phone} onDismiss={dismiss} onShown={shownNow} />
        ))}
      </div>
      {/* mounted (and its timer started) only once nothing covers it; a medal joining it replays its entrance */}
      {current && !modal && !sceneUp && (
        <BannerView key={current.k === "medal" ? `${current.id}.${current.medals.length}` : current.id} b={current} onDone={nextBanner} />
      )}
    </div>
  );
}

/** Phones: hide the oldest toasts that overflow the stack's max-height (the newest always shows). */
function fitStack(el: HTMLElement) {
  const kids = Array.from(el.children) as HTMLElement[];
  for (const k of kids) k.style.display = "";
  const max = parseFloat(el.style.maxHeight);
  if (!Number.isFinite(max) || max <= 0) return;
  let used = 0;
  for (let i = kids.length - 1; i >= 0; i--) {
    const h = kids[i].offsetHeight + (used > 0 ? STACK_GAP : 0);
    if (used > 0 && used + h > max) {
      for (let j = i; j >= 0; j--) kids[j].style.display = "none";
      return;
    }
    used += h;
  }
}

const STALL_SELECTOR = 'main > section [role="region"][aria-label="Лавка Барыги Бенедикта"]';
/**
 * md+: the stack's width (md:w-[340px]) and its 56-px resting line (12 px on short screens: no ticker there); the
 * classes add the safe-area insets (viewport-fit=cover, SHL-3) to it and to the panel's edge.
 */
const DESK_W = 340;
const DESK_BOTTOM = 56;
const SHORT_BOTTOM = 12;

/**
 * Writes the stack's `bottom` and `max-height` directly (no re-render), re-measured by ResizeObservers on the panel
 * and the stall:
 * - bottom sheet (< 768 px): 8 px above the panel sheet's top edge, following the half/full transition, plus room for
 *   the market's folded pill (an expanded stall is the player's choice: the toasts then overlap its top instead of
 *   the grate); with the sheet full the stack is also capped to the colony sliver, so it never climbs over the
 *   resource bar and the header (their buttons stay tappable);
 * - md+: the bottom-14 line, or just above Benedict's docked stall when the colony is too narrow for both side by side;
 * - every phone layout (narrow or short): at most 38% of the colony's height, the oldest toasts stepping aside.
 */
function useSheetAnchor(ref: RefObject<HTMLDivElement | null>, stall: boolean) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const mq = window.matchMedia(NARROW_MQ);
    const aside = document.querySelector("main > aside");
    const colony = document.querySelector("main > section");
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
      const share = isPhoneLayout() && colony ? Math.round(colony.getBoundingClientRect().height * PHONE_STACK_SHARE) : null;
      const setMax = (room: number | null) => {
        const v = room === null ? share : share === null ? room : Math.min(room, share);
        el.style.maxHeight = v === null ? "" : `${v}px`;
        el.style.overflow = v === null ? "" : "hidden";
        fitStack(el);
      };
      if (mq.matches) {
        const top = aside?.getBoundingClientRect().top ?? 0;
        const bottom = top > 0 ? Math.round(vh - top + 8 + (hasStall ? STALL_PX : 0)) : null;
        el.style.bottom = bottom === null ? "" : `${bottom}px`;
        const roof = useGame.getState().sheet === "full" ? colony?.getBoundingClientRect().top : undefined;
        setMax(roof === undefined || bottom === null ? null : Math.max(0, Math.round(vh - bottom - roof - 8)));
        return;
      }
      setMax(null);
      if (!sr || !hasStall) {
        el.style.bottom = "";
        return;
      }
      const right = (aside?.getBoundingClientRect().left ?? window.innerWidth) - 8;
      const sideBySide = sr.right + 8 <= right - DESK_W;
      el.style.bottom = sideBySide ? "" : `${Math.round(Math.max(isShortLayout() ? SHORT_BOTTOM : DESK_BOTTOM, vh - sr.top + 8))}px`;
    };
    const ro = new ResizeObserver(place);
    if (aside) ro.observe(aside);
    if (colony) ro.observe(colony);
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

function Toast({
  t,
  compact,
  phone,
  onDismiss,
  onShown,
}: {
  t: ToastItem;
  compact: boolean;
  phone: boolean;
  onDismiss: (id: number) => void;
  onShown: (id: number) => void;
}) {
  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  });
  // a queued toast that got its slot becomes an ordinary one (later arrivals then queue behind it, not over it)
  useEffect(() => {
    if (t.wait) onShown(t.id);
  }, [t.wait, t.id, onShown]);

  // a toast back on screen resumes its fuse; a merge (rev) restarts it
  const kept = fuses.get(t.id);
  const left = kept && kept.rev === t.rev ? kept.left : t.ms;
  useEffect(() => {
    const start = performance.now();
    // «К путям!» also goes once its train is due: one the scene gap holds back does not sit at «0 с»
    const life = t.train ? Math.min(left, t.train.at - start + 1500) : left;
    const timer = window.setTimeout(() => dismissRef.current(t.id), Math.max(0, life));
    return () => {
      window.clearTimeout(timer);
      fuses.set(t.id, { rev: t.rev, left: Math.max(0, left - (performance.now() - start)) });
    };
  }, [t.id, t.rev, t.train, left]);

  const go = t.go;
  // phones: «К путям!» is one 44-px row (countdown and «К перрону»)
  const row = phone && !!t.train;
  // the action sits in its own column beside ✕, so a toast stays one text block tall (keeps the colony clear on phones)
  const action = t.train ? (
    <ActionButton
      onClick={() => {
        focusColony();
        onDismiss(t.id);
      }}
    >
      К перрону
    </ActionButton>
  ) : go?.target === SW_UPDATE_TARGET ? (
    <ActionButton
      onClick={() => {
        onDismiss(t.id);
        applySwUpdate(() => useGame.getState().save());
      }}
    >
      Обновить
    </ActionButton>
  ) : go ? (
    <ActionButton
      onClick={() => {
        useGame.getState().focus(go.tab, go.target);
        onDismiss(t.id);
      }}
    >
      Открыть
    </ActionButton>
  ) : null;

  return (
    <div
      className={cx(
        // .ui-zoom: «Размер текста» reaches the toasts; the width is divided back so the footprint stays the same
        "ui-zoom pointer-events-none relative flex w-full max-w-[calc(360px/var(--ui-zoom,1))] shrink-0 gap-2 overflow-hidden rounded-md border pl-2.5 pr-1 text-[13px] leading-snug shadow-[0_6px_18px_rgba(0,0,0,.55)] md:w-[calc(340px/var(--ui-zoom,1))]",
        // the phone train row: 40-px controls + 1-px padding + the border = 44 px
        row ? "items-center py-px" : "items-start py-1.5",
        TONE[t.tone],
        t.leaving ? "hud-toast-out" : "hud-toast-in",
      )}
    >
      <span className={cx("shrink-0 text-lg leading-none", !row && "mt-2")} aria-hidden>
        {t.icon}
      </span>
      <div className={cx("flex min-h-10 min-w-0 flex-1 flex-col justify-center", !phone && "py-0.5")}>
        {t.train ? (
          <TrainToastBody train={t.train} row={row} />
        ) : t.unlock ? (
          <UnlockBody items={t.unlock} compact={compact} phone={phone} />
        ) : (
          <span className={cx(phone && "line-clamp-2")}>{t.text}</span>
        )}
      </div>
      {action && <div className={cx("shrink-0", row ? "self-center" : "self-start pt-0.5")}>{action}</div>}
      <button
        type="button"
        onClick={() => onDismiss(t.id)}
        aria-label="Закрыть"
        className={cx(
          "pointer-events-auto inline-flex h-10 w-10 shrink-0 items-center justify-center rounded text-parchment-dim hover:bg-black/20 hover:text-parchment",
          !row && "-my-0.5",
        )}
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
      className="pointer-events-auto inline-flex min-h-10 items-center whitespace-nowrap rounded border border-brass-dark bg-gradient-to-b from-brass-light via-brass to-brass-dark px-2.5 text-xs font-bold text-soot shadow-[inset_0_1px_0_rgba(255,255,255,.45),0_2px_0_#4a3a1a] active:translate-y-px md:min-h-8 md:short:min-h-10"
    >
      {children}
    </button>
  );
}

/**
 * «Открыто!» for one item (with its «что даёт» line), «Открыто: 3 новинки» for a batch: one short row per item
 * (icon and name), at most three («…и ещё N» closes the last row); phones two rows, compact (the sheet full) one.
 * «Открыть» goes to the first item.
 */
function UnlockBody({ items, compact, phone }: { items: UnlockItem[]; compact: boolean; phone: boolean }) {
  const n = items.length;
  const rows = items.slice(0, compact ? 1 : phone ? UNLOCK_ROWS.phone : UNLOCK_ROWS.desk).map(unlockRow);
  const more = n - rows.length;
  const single = n === 1 ? rows[0] : null;
  return (
    <div className="min-w-0">
      <b className={cx("block truncate font-display tracking-wide text-verdigris-light", phone ? "text-[14px] leading-4" : "text-[15px] leading-tight")}>{unlockTitle(n)}</b>
      <ul className={cx("min-w-0", phone ? "text-[12px] leading-[15px]" : "mt-0.5 leading-tight")}>
        {rows.map((r, i) => (
          <li key={items[i].key} className="flex min-w-0 items-baseline gap-1">
            <span className="min-w-0 truncate">
              {r.icon && <span aria-hidden>{r.icon} </span>}
              {r.name}
            </span>
            {/* the rest stays a count on the last row (the title has the total) */}
            {more > 0 && i === rows.length - 1 && <span className="ml-auto shrink-0 whitespace-nowrap text-[11px] italic text-parchment-dim">…и&nbsp;ещё&nbsp;{more}</span>}
          </li>
        ))}
      </ul>
      {single?.desc && <p className={cx("text-[12px] text-parchment-dim", phone ? "truncate leading-[15px]" : "mt-0.5 line-clamp-2 leading-tight")}>{single.desc}</p>}
    </div>
  );
}

function TrainToastBody({ train, row }: { train: NonNullable<ToastItem["train"]>; row: boolean }) {
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
  if (row) {
    // one line: the name of the train gives way first, the countdown never does
    return (
      <span className="flex min-w-0 items-baseline gap-1 whitespace-nowrap">
        <b className="shrink-0 font-display text-[15px] tracking-wide text-gaslight">К путям!</b>
        <span className="min-w-0 truncate">{what}</span>
        <span className="shrink-0">
          через{" "}
          <b ref={secRef} className="font-mono tabular">
            {train.inSec}
          </b>
          &nbsp;с
        </span>
      </span>
    );
  }
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
  // a medal banner on screen (a medal joining it remounts it: one more burst for the newcomer)
  const medals = b.k === "medal" ? b.medals.length : 0;
  const sentRef = useRef(0);
  useEffect(() => {
    // once per banner (StrictMode replays effects in dev)
    if (medals === 0 || sentRef.current === medals) return;
    sentRef.current = medals;
    window.dispatchEvent(new CustomEvent(MEDAL_SHOWN_EVENT, { detail: { count: medals } }));
  }, [medals]);
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
      className={cx("pointer-events-none fixed left-1/2 top-[calc(54px_+_env(safe-area-inset-top))] z-40 w-max max-w-[calc(100vw-24px)] md:top-[calc(60px_+_env(safe-area-inset-top))]", leaving ? "hud-banner-out" : enter)}
      style={{ transform: "translate(-50%,0)" }}
      role="status"
      aria-live="assertive"
    >
      {b.k === "medal" ? <MedalBanner ids={b.medals} /> : b.k === "zone" ? <ZoneBanner zone={b.zone} /> : <FrenzyBanner />}
    </div>
  );
}

/** One medal, or «🏅 +2 медали: …» for medals that landed together in the first ten minutes. */
function MedalBanner({ ids }: { ids: AchievementId[] }) {
  const defs = ids.map((id) => ACHIEVEMENTS[id]).filter(Boolean);
  if (defs.length === 0) return null;
  const many = defs.length > 1;
  const def = defs[0];
  return (
    <div className="relative flex items-center gap-3 rounded-lg border-2 border-brass bg-gradient-to-b from-[#3a2c18] via-panel-2 to-panel px-3 py-2 pr-5 shadow-[0_0_0_1px_#4a3a1a,0_10px_30px_rgba(0,0,0,.65),0_0_30px_rgba(242,184,75,.3)]">
      <CoatOfArms icon={many ? "🏅" : def.icon} />
      <div className="min-w-0">
        <div className="font-display text-[11px] font-bold uppercase tracking-[0.3em] text-brass">{many ? "Медали Ратрополиса" : "Медаль Ратрополиса"}</div>
        {many ? (
          <>
            <div className="hud-brass-text font-display text-xl font-bold leading-tight sm:text-2xl" aria-label={medalGroupText(defs.map((d) => d.name))}>
              {medalGroupTitle(defs.length)}
            </div>
            <div className="line-clamp-2 text-xs text-parchment">
              {defs.map((d) => `${d.icon} ${d.name}`).join(" · ")} · <span className="font-bold text-good">+{defs.length}% ко всему</span>
            </div>
          </>
        ) : (
          <>
            <div className="hud-brass-text truncate font-display text-xl font-bold leading-tight sm:text-2xl">{def.name}</div>
            <div className="text-xs text-parchment-dim">
              {def.desc} · <span className="font-bold text-good">+1% ко всему</span>
            </div>
          </>
        )}
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
        <span>№&nbsp;{ZONES[zone].order}</span>
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
