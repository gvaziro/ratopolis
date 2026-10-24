"use client";

/**
 * The management panel: a brass tab bar (only revealed tabs; ⚙ always) and a scrollable content area.
 * Tabs get a "new" dot while they hold fresh keys (see alerts.ts); the keys are marked seen when the
 * tab is left or after a while on it. "Переселение" glows gold once the Great Migration is possible.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type RefObject } from "react";
import { canMigrate } from "@/game/engine/formulas";
import { useGame, type TabId } from "@/game/store";
import { cx } from "@/components/ui/kit";
import { newKeys, tabRevealed } from "./alerts";
import BuildingsTab from "./BuildingsTab";
import { PanelStyles } from "./common";
import JobsTab from "./JobsTab";
import MapTab from "./MapTab";
import MedalsTab from "./MedalsTab";
import MigrationTab from "./MigrationTab";
import ScheduleTab from "./ScheduleTab";
import SettingsTab from "./SettingsTab";
import UpgradesTab from "./UpgradesTab";

const TABS: { id: TabId; icon: string; label: string }[] = [
  { id: "buildings", icon: "🏗️", label: "Постройки" },
  { id: "jobs", icon: "🐀", label: "Работы" },
  { id: "upgrades", icon: "🔬", label: "Улучшения" },
  { id: "map", icon: "🗺️", label: "Карта" },
  { id: "schedule", icon: "🚂", label: "Расписание" },
  { id: "migration", icon: "👑", label: "Переселение" },
  { id: "medals", icon: "🏅", label: "Медали" },
  { id: "settings", icon: "⚙", label: "" },
];
const TAB_BY_ID = Object.fromEntries(TABS.map((t) => [t.id, t])) as Record<TabId, (typeof TABS)[number]>;

/* rough tab widths for deciding how many labels fit (text-xs bold ≈ 6.7 px per glyph) */
const ICON_W = 40;
const labelW = (t: (typeof TABS)[number]) => (t.label ? 34 + t.label.length * 6.7 : ICON_W);

export default function SidePanel() {
  const tab = useGame((s) => s.tab);
  const calm = useGame((s) => s.game.settings.reducedMotion);
  const revealedKey = useGame((s) => TABS.filter((t) => tabRevealed(s.game, t.id)).map((t) => t.id).join(","));
  const revealed = useMemo(() => revealedKey.split(",") as TabId[], [revealedKey]);
  const hasContent = revealed.some((t) => t !== "settings");
  const active: TabId | null = revealed.includes(tab) ? tab : hasContent ? revealed[0] : null;

  const dotsKey = useGame((s) =>
    TABS.filter((t) => t.id !== active && tabRevealed(s.game, t.id) && newKeys(s.game, t.id).length > 0)
      .map((t) => t.id)
      .join(","),
  );
  const migrateReady = useGame((s) => canMigrate(s.game));
  useMarkSeen(active);

  const navRef = useRef<HTMLElement>(null);
  const width = useWidth(navRef);
  const md = useMedia("(min-width: 768px)");
  const labelMode = !md ? "none" : fitsAll(revealed, width) ? "all" : fitsActive(revealed, active, width) ? "active" : "none";

  const select = (id: TabId) => useGame.getState().setTab(id);
  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const i = active ? revealed.indexOf(active) : -1;
    const next = revealed[(i + (e.key === "ArrowRight" ? 1 : -1) + revealed.length) % revealed.length];
    select(next);
    const btn = navRef.current?.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`);
    btn?.focus();
    e.preventDefault();
  };

  return (
    <div className={cx("absolute inset-0 flex flex-col bg-gradient-to-b from-soot-2 to-soot", calm && "rr-calm")}>
      <PanelStyles />
      <nav
        ref={navRef}
        role="tablist"
        aria-label="Разделы колонии"
        onKeyDown={onKey}
        className="relative flex shrink-0 items-end gap-0.5 border-b border-brass-dark/80 bg-gradient-to-b from-panel-3 via-panel-2 to-panel px-1.5 pt-1.5 shadow-[inset_0_1px_0_rgba(232,201,131,.12)]"
      >
        {revealed.map((id) => (
          <TabButton
            key={id}
            id={id}
            active={id === active}
            showLabel={labelMode === "all" || (labelMode === "active" && id === active)}
            grow={labelMode === "all" ? "auto" : labelMode === "active" && id === active ? "none" : "share"}
            dot={dotsKey.split(",").includes(id)}
            glow={id === "migration" && migrateReady}
            onSelect={select}
          />
        ))}
      </nav>
      <div
        role="tabpanel"
        key={active ?? "none"}
        aria-label={active ? TAB_BY_ID[active].label || "Настройки" : undefined}
        className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-4 pb-6 md:px-3"
      >
        <TabContent tab={active} />
      </div>
    </div>
  );
}

function TabContent({ tab }: { tab: TabId | null }) {
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
      return <Boarded />;
  }
}

function TabButton({
  id,
  active,
  showLabel,
  grow,
  dot,
  glow,
  onSelect,
}: {
  id: TabId;
  active: boolean;
  showLabel: boolean;
  /** share: equal slices (icon-only); none: keeps its label width; auto: grows from its label width. */
  grow: "share" | "none" | "auto";
  dot: boolean;
  glow: boolean;
  onSelect: (id: TabId) => void;
}) {
  const t = TAB_BY_ID[id];
  const name = t.label || "Настройки";
  return (
    <button
      type="button"
      role="tab"
      data-tab={id}
      aria-selected={active}
      aria-label={name}
      title={showLabel ? undefined : name}
      tabIndex={active ? 0 : -1}
      onClick={() => onSelect(id)}
      className={cx(
        "relative -mb-px flex min-h-11 min-w-10 items-center justify-center gap-1.5 rounded-t-md border border-b-0 px-1.5 text-xs font-bold tracking-wide transition-colors focus-visible:outline-2 focus-visible:outline-brass",
        active
          ? "z-10 border-brass-dark bg-soot-2 text-brass-light shadow-[inset_0_2px_0_var(--brass)]"
          : "border-transparent text-parchment-dim hover:bg-panel-3/70 hover:text-parchment",
        glow && !active && "rr-glow border-brass bg-gradient-to-b from-brass/35 to-brass/5 text-gaslight",
        glow && active && "text-gaslight",
        id === "settings" ? "max-w-12 flex-none" : grow === "share" ? "flex-1" : grow === "none" ? "flex-none px-2.5" : "flex-auto",
      )}
    >
      <span className={cx("text-lg leading-none", !active && !glow && "opacity-80 grayscale-[.35]")}>{t.icon}</span>
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
function Boarded() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      <div className="text-5xl opacity-80">🪧</div>
      <p className="font-display text-xl font-bold text-brass-light">Контора колонии пока заколочена</p>
      <p className="max-w-72 text-sm leading-snug text-parchment-dim">
        Тащите крошки сквозь решётку. Как только запахнет едой, сюда сбегутся бродяжки, а с ними — сметы, бригады и чертежи.
      </p>
    </div>
  );
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
  const keysKey = useGame((s) => (tab ? newKeys(s.game, tab).join("|") : ""));
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

function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((list) => setW(list[0]?.contentRect.width ?? 0));
    ro.observe(el);
    return () => ro.disconnect();
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
