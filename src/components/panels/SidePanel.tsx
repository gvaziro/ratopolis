"use client";

/**
 * The management panel: a brass tab bar (only revealed tabs; ⚙ always) and a scrollable content area.
 * Tabs get a "new" dot while they hold fresh keys (see alerts.ts); the keys are marked seen when the
 * tab is left or after a while on it. "Переселение" glows gold once the Great Migration is possible.
 * On phones (< md) the panel is a bottom sheet: a grab handle (or a tap on the active tab) toggles the
 * half/full height (store.sheet; the shell sizes the grid), and the tabs carry short captions (PA-2).
 * UiFx "focus" scrolls the named [data-target] into view and rings it (store.focus, hints, toasts).
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type RefObject } from "react";
import { BUILDINGS } from "@/game/data/buildings";
import { JOBS } from "@/game/data/jobs";
import { EDICTS, EDICT_ORDER } from "@/game/data/meta";
import { UPGRADES } from "@/game/data/upgrades";
import { edictRank } from "@/game/engine/core";
import { canMigrate, crownsForRun } from "@/game/engine/formulas";
import { emitUiFx, onUiFx } from "@/game/fx";
import type { BuildingId, GameState, JobId, UpgradeId } from "@/game/types";
import { useGame, type TabId } from "@/game/store";
import { useSampled } from "@/game/useSampled";
import { cx } from "@/components/ui/kit";
import { firstSentence, newKeys, tabRevealed } from "./alerts";
import BuildingsTab from "./BuildingsTab";
import { PanelStyles } from "./common";
import JobsTab from "./JobsTab";
import MapTab from "./MapTab";
import MedalsTab from "./MedalsTab";
import MigrationTab from "./MigrationTab";
import ScheduleTab from "./ScheduleTab";
import SettingsTab from "./SettingsTab";
import UpgradesTab from "./UpgradesTab";

const TABS: { id: TabId; icon: string; label: string; caption: string }[] = [
  { id: "buildings", icon: "🏗️", label: "Постройки", caption: "Стройка" },
  { id: "jobs", icon: "🐀", label: "Работы", caption: "Работы" },
  { id: "upgrades", icon: "🔬", label: "Улучшения", caption: "Наука" },
  { id: "map", icon: "🗺️", label: "Карта", caption: "Карта" },
  { id: "schedule", icon: "🚂", label: "Расписание", caption: "Поезда" },
  { id: "migration", icon: "👑", label: "Переселение", caption: "Трон" },
  { id: "medals", icon: "🏅", label: "Медали", caption: "Медали" },
  { id: "settings", icon: "⚙", label: "", caption: "" },
];
const TAB_BY_ID = Object.fromEntries(TABS.map((t) => [t.id, t])) as Record<TabId, (typeof TABS)[number]>;

/* rough tab widths for deciding how many labels fit (text-xs bold ≈ 6.7 px per glyph) */
const ICON_W = 40;
const labelW = (t: (typeof TABS)[number]) => (t.label ? 34 + t.label.length * 6.7 : ICON_W);
/** Below md, a tab bar at least this wide uses the desktop label logic; narrower ones show captions. */
const WIDE_BAR = 600;
/** How long a focused card glows. */
const FOCUS_MS = 1600;

type LabelMode = "all" | "active" | "none" | "caption";

export default function SidePanel() {
  const tab = useGame((s) => s.tab);
  const calm = useGame((s) => s.game.settings.reducedMotion);
  const sheet = useGame((s) => s.sheet);
  const revealedKey = useGame((s) => TABS.filter((t) => tabRevealed(s.game, t.id)).map((t) => t.id).join(","));
  const revealed = useMemo(() => revealedKey.split(",") as TabId[], [revealedKey]);
  // PA-5: until a real tab opens (the medal cabinet alone does not count) the office stays boarded up
  const active: TabId | null = revealed.includes(tab) ? tab : (revealed.find((t) => t !== "medals" && t !== "settings") ?? null);
  const medalsOnly = active === null && revealed.includes("medals");

  // the dots need not be live: newKeys walks every building/upgrade, so sample it twice a second
  const dotsKey = useSampled(
    (s) =>
      TABS.filter((t) => t.id !== active && tabRevealed(s.game, t.id) && newKeys(s.game, t.id).length > 0)
        .map((t) => t.id)
        .join(","),
    2,
    Object.is,
  );
  const migrateReady = useSampled((s) => migrationWorthIt(s.game), 1, Object.is);
  useMarkSeen(active);
  useUnlockNotes();

  const navRef = useRef<HTMLElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const width = useWidth(navRef);
  const md = useMedia("(min-width: 768px)");
  const labelMode: LabelMode =
    !md && width < WIDE_BAR
      ? "caption"
      : fitsAll(revealed, width)
        ? "all"
        : fitsActive(revealed, active, width)
          ? "active"
          : md
            ? "none"
            : "caption";
  useFocusTarget(panelRef);

  const select = (id: TabId) => {
    // phones: a tap on the tab that is already open grows/shrinks the sheet
    if (!md && id === active) useGame.getState().toggleSheet();
    else useGame.getState().setTab(id);
  };
  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const i = active ? revealed.indexOf(active) : -1;
    const next = revealed[(i + (e.key === "ArrowRight" ? 1 : -1) + revealed.length) % revealed.length];
    useGame.getState().setTab(next);
    const btn = navRef.current?.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`);
    btn?.focus();
    e.preventDefault();
  };

  return (
    <div className={cx("absolute inset-0 flex flex-col bg-gradient-to-b from-soot-2 to-soot", calm && "rr-calm")}>
      <PanelStyles />
      <SheetHandle full={sheet === "full"} />
      <nav
        ref={navRef}
        role="tablist"
        aria-label="Разделы колонии"
        onKeyDown={onKey}
        className="relative flex shrink-0 items-end gap-0.5 border-b border-brass-dark/80 bg-gradient-to-b from-panel-3 via-panel-2 to-panel px-1.5 shadow-[inset_0_1px_0_rgba(232,201,131,.12)] md:pt-1.5"
      >
        {revealed.map((id, i) => (
          <TabButton
            key={id}
            id={id}
            hotkey={i < 8 ? i + 1 : undefined}
            active={id === active}
            // roving tabindex: the open tab, or the first one while the office is boarded up (only ⚙/🏅 revealed)
            focusable={id === active || (active === null && i === 0)}
            mode={labelMode}
            dot={dotsKey.split(",").includes(id)}
            glow={id === "migration" && migrateReady}
            onSelect={select}
          />
        ))}
      </nav>
      <div
        ref={panelRef}
        role="tabpanel"
        key={active ?? "none"}
        aria-label={active ? TAB_BY_ID[active].label || "Настройки" : undefined}
        className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-4 pb-6 md:px-3"
      >
        <TabContent tab={active} medalsOnly={medalsOnly} />
      </div>
    </div>
  );
}

/** Phones only: the brass grab bar above the tabs that toggles the half/full sheet. */
function SheetHandle({ full }: { full: boolean }) {
  return (
    <button
      type="button"
      aria-label={full ? "Свернуть панель" : "Развернуть панель"}
      aria-expanded={full}
      onClick={() => useGame.getState().toggleSheet()}
      className="group relative flex h-6 shrink-0 items-center justify-center bg-panel-3 focus-visible:outline-2 focus-visible:outline-brass md:hidden"
    >
      <span className="h-1.5 w-12 rounded-full bg-gradient-to-b from-brass-light to-brass-dark shadow-[0_1px_0_rgba(0,0,0,.6)] transition group-active:scale-x-110" />
      <span aria-hidden className="absolute right-3 text-[10px] leading-none text-brass">
        {full ? "▾" : "▴"}
      </span>
    </button>
  );
}

function TabContent({ tab, medalsOnly }: { tab: TabId | null; medalsOnly: boolean }) {
  switch (tab) {
    case "buildings":
      return <BuildingsTab />;
    case "jobs":
      return <JobsTab />;
    case "upgrades":
      return <UpgradesTab />;
    case "map":
      return <MapTab />;
    case "schedule":
      return <ScheduleTab />;
    case "migration":
      return <MigrationTab />;
    case "medals":
      return <MedalsTab />;
    case "settings":
      return (
        <div className="pt-3">
          <SettingsTab />
        </div>
      );
    default:
      return <Boarded medalsOnly={medalsOnly} />;
  }
}

function TabButton({
  id,
  active,
  focusable,
  mode,
  dot,
  glow,
  onSelect,
  hotkey,
}: {
  id: TabId;
  /** SH-4: the digit that opens it (shown in the tooltip). */
  hotkey?: number;
  active: boolean;
  /** The one tab the Tab key reaches (tabIndex 0); the arrows move between the others. */
  focusable: boolean;
  /** all: every tab labelled; active: only the open one; none: icons; caption: icon over a 9 px caption (phones). */
  mode: LabelMode;
  dot: boolean;
  glow: boolean;
  onSelect: (id: TabId) => void;
}) {
  const t = TAB_BY_ID[id];
  const name = t.label || "Настройки";
  const caption = mode === "caption";
  const showLabel = mode === "all" || (mode === "active" && active);
  // share: equal slices (icon-only); none: keeps its label width; auto: grows from its label width
  const grow = mode === "all" ? "auto" : mode === "active" && active ? "none" : "share";
  return (
    <button
      type="button"
      role="tab"
      data-tab={id}
      aria-selected={active}
      aria-label={name}
      title={hotkey ? `${name} (${hotkey})` : name}
      tabIndex={focusable ? 0 : -1}
      onClick={() => onSelect(id)}
      className={cx(
        "relative -mb-px flex min-h-11 items-center justify-center rounded-t-md border border-b-0 font-bold tracking-wide transition-colors focus-visible:outline-2 focus-visible:outline-brass",
        caption ? "min-w-0 flex-col gap-0 overflow-hidden px-0.5 pt-1 text-[9px]" : "min-w-10 gap-1.5 px-1.5 text-xs",
        active
          ? "z-10 border-brass-dark bg-soot-2 text-brass-light shadow-[inset_0_2px_0_var(--brass)]"
          : "border-transparent text-parchment-dim hover:bg-panel-3/70 hover:text-parchment",
        glow && !active && "rr-glow border-brass bg-gradient-to-b from-brass/35 to-brass/5 text-gaslight",
        glow && active && "text-gaslight",
        id === "settings"
          ? caption
            ? "w-9 flex-none"
            : "max-w-12 flex-none"
          : caption || grow === "share"
            ? "flex-1"
            : grow === "none"
              ? "flex-none px-2.5"
              : "flex-auto",
      )}
    >
      <span className={cx("text-lg leading-none", !active && !glow && "opacity-80 grayscale-[.35]")}>{t.icon}</span>
      {caption && t.caption && <span className="mt-0.5 block whitespace-nowrap leading-[11px] tracking-tight">{t.caption}</span>}
      {showLabel && t.label && <span className="whitespace-nowrap">{t.label}</span>}
      {dot && (
        <span className="pointer-events-none absolute right-1 top-1 h-2 w-2" aria-label="есть новое">
          <span className="rr-ping absolute inset-0 rounded-full bg-gaslight" />
          <span className="absolute inset-0 rounded-full bg-gaslight shadow-[0_0_6px_var(--gaslight)]" />
        </span>
      )}
    </button>
  );
}

/** Before any tab is revealed: the office is still boarded up. */
function Boarded({ medalsOnly }: { medalsOnly: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      <div className="text-5xl opacity-80">🪧</div>
      <p className="font-display text-xl font-bold text-brass-light">Контора колонии пока заколочена</p>
      <p className="max-w-72 text-sm leading-snug text-parchment-dim">
        Тащите крошки сквозь решётку. Как только запахнет едой, сюда сбегутся бродяжки, а с ними — сметы, бригады и чертежи.
      </p>
      {medalsOnly && (
        <button type="button" onClick={() => useGame.getState().setTab("medals")} className="rounded border border-brass-dark/70 bg-panel-2 px-3 py-1.5 text-sm font-bold text-gaslight hover:border-brass">
          Первая медаль уже ваша — загляните в 🏅
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ PA-4/PA-5 helpers */

/**
 * The «Переселение» tab glows only when moving is worth it now: after this run's coronation, or when the crowns in
 * hand plus this run's crowns buy the cheapest unsigned edict (or an edict rank, once ranks are on sale).
 */
function migrationWorthIt(s: GameState): boolean {
  if (!canMigrate(s)) return false;
  if (s.coronatedThisRun) return true;
  const budget = s.meta.crowns + crownsForRun(s);
  let cheapest = Infinity;
  for (const id of EDICT_ORDER) {
    if (!s.meta.edicts[id]) cheapest = Math.min(cheapest, EDICTS[id].cost);
    else if (s.meta.achievements.coronation !== undefined) {
      const ranks = EDICTS[id].ranks;
      const r = edictRank(s, id);
      if (ranks && r >= 1 && r <= ranks.length) cheapest = Math.min(cheapest, ranks[r - 1].cost);
    }
  }
  return budget >= cheapest;
}

/** Fresh keys that announce an unlock (tabs, jobs, buildings, upgrades), first run only (isFresh). */
function unlockKeys(s: GameState): string[] {
  const out: string[] = [];
  for (const t of TABS) {
    if (t.id === "settings" || !tabRevealed(s, t.id)) continue;
    for (const k of newKeys(s, t.id)) if (/^(tab|j|b|u)_/.test(k)) out.push(k);
  }
  return out;
}

/** Tab, icon and line of an unlock note (PA-5). */
function unlockItem(key: string): { key: string; tab: TabId; text: string } | null {
  const [kind, ...rest] = key.split("_");
  const id = rest.join("_");
  if (UNLOCK_TEXT[key]) return { key, tab: kind === "tab" ? (id as TabId) : kind === "j" ? "jobs" : kind === "b" ? "buildings" : "upgrades", text: UNLOCK_TEXT[key] };
  if (kind === "tab") {
    const t = TAB_BY_ID[id as TabId];
    return t ? { key, tab: t.id, text: `${t.icon} Открыта вкладка «${t.label}»` } : null;
  }
  if (kind === "j") {
    const j = JOBS[id as JobId];
    return j ? { key, tab: "jobs", text: `${j.icon} Новая работа: ${j.name} — ${firstSentence(j.desc)}` } : null;
  }
  if (kind === "b") {
    const b = BUILDINGS[id as BuildingId];
    return b ? { key, tab: "buildings", text: `${b.icon} Открыто: ${b.name} — ${firstSentence(b.desc)}` } : null;
  }
  if (kind === "u") {
    const u = UPGRADES[id as UpgradeId];
    return u ? { key, tab: "upgrades", text: `${u.icon} Открыто: ${u.name} — ${firstSentence(u.effect)}` } : null;
  }
  return null;
}

const UNLOCK_TEXT: Record<string, string> = {
  j_pickpocket: `${JOBS.pickpocket.icon} Новая работа: ${JOBS.pickpocket.name} — приносит 🪙`,
  j_scavenger: `${JOBS.scavenger.icon} Новая работа: ${JOBS.scavenger.name} — пуговицы и проволока`,
  b_pantry: "🥫 Можно строить Кладовку — лимит 🍞 +150",
  tab_jobs: "🐀 Открыта вкладка «Работы»",
};

/**
 * PA-5 unlock notes: once a second, the unlock keys that became fresh since the last look go out as one UiFx
 * "unlock" (the shell turns it into a toast with «Открыть»). The first look after mounting only takes the baseline.
 */
function useUnlockNotes(): void {
  const keys = useSampled((s) => unlockKeys(s.game).join("|"), 1, Object.is);
  const prev = useRef<Set<string> | null>(null);
  useEffect(() => {
    const now = new Set(keys ? keys.split("|") : []);
    const before = prev.current;
    prev.current = now;
    if (!before) return;
    const items = [...now].filter((k) => !before.has(k)).map(unlockItem).filter((x): x is NonNullable<typeof x> => !!x);
    if (items.length) emitUiFx({ k: "unlock", items });
  }, [keys]);
}

/* ------------------------------------------------------------ helpers */

function fitsAll(tabs: TabId[], w: number): boolean {
  return w > 0 && tabs.reduce((a, id) => a + labelW(TAB_BY_ID[id]) + 2, 12) <= w;
}

function fitsActive(tabs: TabId[], active: TabId | null, w: number): boolean {
  if (w <= 0 || !active) return false;
  return tabs.reduce((a, id) => a + (id === active ? labelW(TAB_BY_ID[id]) : ICON_W) + 2, 12) <= w;
}

function markAll(tab: TabId): void {
  const keys = newKeys(useGame.getState().game, tab);
  useGame.getState().markSeenMany(keys);
}

/** Mark the active tab's fresh keys as seen when it is left, or after 8 s on it. */
function useMarkSeen(tab: TabId | null): void {
  const keysKey = useSampled((s) => (tab ? newKeys(s.game, tab).join("|") : ""), 2, Object.is);
  useEffect(() => {
    if (!tab) return;
    const since = performance.now();
    // ignore instant remounts (StrictMode) and quick flicks through the tabs
    return () => {
      if (performance.now() - since > 400) markAll(tab);
    };
  }, [tab]);
  useEffect(() => {
    if (!tab || !keysKey) return;
    const t = window.setTimeout(() => markAll(tab), 8000);
    return () => window.clearTimeout(t);
  }, [tab, keysKey]);
}

/**
 * UiFx "focus": once the tab has rendered, scroll [data-target] to the middle of the panel and ring it for 1.6 s.
 * A card that is not in the DOM yet (a collapsed zone opening, a tab still mounting) is retried for ~0.5 s.
 */
function useFocusTarget(panelRef: RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    const timers = new Set<number>();
    const later = (fn: () => void, ms: number) => {
      const id = window.setTimeout(() => {
        timers.delete(id);
        fn();
      }, ms);
      timers.add(id);
    };
    const off = onUiFx((fx) => {
      if (fx.k !== "focus" || !fx.target) return;
      const target = fx.target;
      let tries = 0;
      const attempt = () => {
        const panel = panelRef.current;
        const el = panel?.querySelector<HTMLElement>(`[data-target="${CSS.escape(target)}"]`);
        if (!el) {
          if (++tries < 10) later(attempt, 50);
          return;
        }
        const calm = useGame.getState().game.settings.reducedMotion;
        el.scrollIntoView({ block: "center", behavior: calm ? "auto" : "smooth" });
        el.classList.remove("rr-focus");
        // restart the animation when the same card is focused twice in a row
        void el.offsetWidth;
        el.classList.add("rr-focus");
        later(() => el.classList.remove("rr-focus"), FOCUS_MS);
      };
      attempt();
    });
    return () => {
      off();
      for (const id of timers) window.clearTimeout(id);
    };
  }, [panelRef]);
}

function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // measure right away (ResizeObserver waits for a rendered frame), then follow resizes
    const measure = () => {
      const cs = getComputedStyle(el);
      setW(el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
    };
    measure();
    window.addEventListener("resize", measure);
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver((list) => setW(list[0]?.contentRect.width ?? 0));
    ro?.observe(el);
    return () => {
      window.removeEventListener("resize", measure);
      ro?.disconnect();
    };
  }, [ref]);
  return w;
}

function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
