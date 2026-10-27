"use client";

/**
 * The management panel: a brass tab bar (only revealed tabs; ⚙ always) and a scrollable content area.
 * Tabs get a "new" dot while they hold fresh keys (see alerts.ts); the keys are marked seen when the
 * tab is left or after a while on it. "Переселение" glows gold once the Great Migration is possible.
 * On phones (< md) the panel is a bottom sheet: a grab handle (or a tap on the active tab) toggles the
 * half/full height (store.sheet; the shell sizes the grid), and the tabs carry short captions (PA-2). The handle is a
 * 40 px row whose left slot the open tab may fill (SheetSlot, PAN-3); Android «Назад» shrinks a full sheet to half.
 * Until the vagrants arrive the phone sheet stays a 56 px strip with the «Запах еды» goal, so the grate and the
 * colony fill the screen (PAN-1; the strip sets the shell's grid rows through [data-rr-sheet="peek"]).
 * UiFx "focus" scrolls the named [data-target] into view and rings it (store.focus, hints, toasts).
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type RefObject } from "react";
import { EDICTS, EDICT_ORDER } from "@/game/data/meta";
import { edictRank } from "@/game/engine/core";
import { canMigrate, crownsForRun } from "@/game/engine/formulas";
import { emitUiFx, onUiFx } from "@/game/fx";
import type { GameState } from "@/game/types";
import { useGame, type TabId } from "@/game/store";
import { useSampled } from "@/game/useSampled";
import { useBackCloses } from "@/lib/useBackCloses";
import { Bar, cx } from "@/components/ui/kit";
import { newKeys, tabRevealed } from "./alerts";
import BuildingsTab from "./BuildingsTab";
import { PanelStyles } from "./common";
import JobsTab from "./JobsTab";
import MapTab from "./MapTab";
import MedalsTab from "./MedalsTab";
import MigrationTab from "./MigrationTab";
import ScheduleTab from "./ScheduleTab";
import SettingsTab from "./SettingsTab";
import { SheetSlotContext } from "./sheetSlot";
import { PanelArtDefs } from "./Thumb";
import { TAB_BY_ID, TABS, unlockItem, unlockKeys, type TabMeta } from "./unlockNotes";
import UpgradesTab from "./UpgradesTab";

/* rough tab widths for deciding how many labels fit (text-xs bold ≈ 6.7 px per glyph) */
const ICON_W = 40;
const labelW = (t: TabMeta) => (t.label ? 34 + t.label.length * 6.7 : ICON_W);
/** Below md, a tab bar at least this wide uses the desktop label logic; narrower ones show captions. */
const WIDE_BAR = 600;
/** How long a focused card glows. */
const FOCUS_MS = 1600;
/** Crumbs that bring the vagrants (economy.ts: flags.vagrants at resEver.crumbs ≥ 10). */
const VAGRANT_CRUMBS = 10;

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

  // PAN-1: phones keep the sheet down to a strip until the vagrants come (a tap, ⚙ or a focus opens it)
  const vagrants = useGame((s) => !!s.game.flags.vagrants);
  const [opened, setOpened] = useState(false);
  const peek = !md && !vagrants && !opened;
  useEffect(() => onUiFx((fx) => fx.k === "focus" && setOpened(true)), []);
  // a new game (reset, import, backup) starts as the strip again; a tab picked from outside (the header ⚙, hotkeys)
  // or the Great Migration (its ceremony closes onto the edicts) opens the board
  useEffect(
    () =>
      useGame.subscribe((s, p) => {
        if (s.runSeq !== p.runSeq) setOpened(false);
        else if (s.tab !== p.tab || s.game.meta.migrations !== p.game.meta.migrations) setOpened(true);
      }),
    [],
  );
  // Android «Назад», one entry each: a full sheet goes back to half, then the board opened before the vagrants folds
  // into the strip (declared first, so its entry sits below the full sheet's)
  useBackCloses(!md && !vagrants && opened, () => setOpened(false));
  useBackCloses(!md && !peek && sheet === "full", () => useGame.getState().setSheet("half"));
  const toggleSheet = () => {
    // before the vagrants the board only opens and folds back into the strip
    if (!vagrants && sheet === "half") setOpened(false);
    else useGame.getState().toggleSheet();
  };
  // PAN-3: the handle row's left slot, offered to the open tab only where the handle shows
  const [slotEl, setSlotEl] = useState<HTMLDivElement | null>(null);

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
    <div
      data-rr-sheet={peek ? "peek" : undefined}
      className={cx("absolute inset-0 flex flex-col bg-gradient-to-b from-soot-2 to-soot", calm && "rr-calm")}
    >
      <PanelStyles />
      <PanelArtDefs />
      {peek ? (
        <PeekStrip
          tabs={revealed}
          onOpen={(id) => {
            if (id) useGame.getState().setTab(id);
            setOpened(true);
          }}
        />
      ) : (
        <SheetHandle full={sheet === "full"} folds={!vagrants && sheet === "half"} onToggle={toggleSheet} slotRef={setSlotEl} />
      )}
      {/* the strip hides the tabs instead of unmounting them, so their width and content survive it */}
      <nav
        ref={navRef}
        role="tablist"
        aria-label="Разделы колонии"
        onKeyDown={onKey}
        className={cx(
          "relative flex shrink-0 items-end gap-0.5 border-b border-brass-dark/80 bg-gradient-to-b from-panel-3 via-panel-2 to-panel px-1.5 shadow-[inset_0_1px_0_rgba(232,201,131,.12)] md:pt-1.5",
          peek && "hidden",
        )}
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
        className={cx("relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-4 pb-6 md:px-3", peek && "hidden")}
      >
        <SheetSlotContext.Provider value={md ? null : slotEl}>
          <TabContent tab={active} medalsOnly={medalsOnly} />
        </SheetSlotContext.Provider>
      </div>
    </div>
  );
}

/**
 * Phones only: the 40 px row above the tabs. Its left slot holds the open tab's compact control (SheetSlot); the rest
 * of the row is the brass grab bar that toggles the half/full sheet (centred in the row while the slot is empty).
 * `folds`: before the vagrants a half sheet folds back into the strip instead of growing.
 */
function SheetHandle({
  full,
  folds,
  onToggle,
  slotRef,
}: {
  full: boolean;
  folds: boolean;
  onToggle: () => void;
  slotRef: (el: HTMLDivElement | null) => void;
}) {
  const shrink = full || folds;
  return (
    <div className="relative flex h-10 shrink-0 items-stretch bg-panel-3 md:hidden">
      <div ref={slotRef} className="flex shrink-0 items-center pl-3 empty:pl-0" />
      <button
        type="button"
        aria-label={folds ? "Свернуть контору" : full ? "Свернуть панель" : "Развернуть панель"}
        aria-expanded={shrink}
        onClick={onToggle}
        className="group relative flex min-w-0 flex-1 items-center justify-center focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brass"
      >
        <span className="h-1.5 w-12 rounded-full bg-gradient-to-b from-brass-light to-brass-dark shadow-[0_1px_0_rgba(0,0,0,.6)] transition group-active:scale-x-110" />
        <span aria-hidden className="absolute right-3 text-[10px] leading-none text-brass">
          {shrink ? "▾" : "▴"}
        </span>
      </button>
    </div>
  );
}

/**
 * Phones before the vagrants (PAN-1): the sheet is a 56 px strip — the «Запах еды» goal (a tap opens the boarded
 * office) and the tabs that already exist (⚙, maybe 🏅).
 */
function PeekStrip({ tabs, onOpen }: { tabs: TabId[]; onOpen: (tab?: TabId) => void }) {
  const n = useGame((s) => Math.min(VAGRANT_CRUMBS, Math.floor(s.game.resEver.crumbs)));
  return (
    <div className="relative flex h-full items-center gap-1 bg-gradient-to-b from-panel-3 to-panel-2 pr-2">
      <button
        type="button"
        aria-label={`Развернуть контору. Запах еды: ${n} из ${VAGRANT_CRUMBS}`}
        aria-expanded={false}
        onClick={() => onOpen()}
        className="group flex h-full min-w-0 flex-1 flex-col justify-center gap-1 pl-4 pr-1 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brass"
      >
        <span aria-hidden className="absolute left-1/2 top-1.5 h-1 w-10 -translate-x-1/2 rounded-full bg-gradient-to-b from-brass-light to-brass-dark opacity-80" />
        <span className="flex min-w-0 items-baseline gap-1.5 text-[11px] leading-tight text-parchment">
          <b className="shrink-0 font-display text-sm text-brass-light">Запах еды</b>
          <span className="shrink-0 font-mono tabular text-gaslight">
            {n}/{VAGRANT_CRUMBS} 🍞
          </span>
          <span className="truncate text-parchment-dim">— сбегутся бродяжки</span>
          <span aria-hidden className="ml-auto shrink-0 text-[10px] text-brass">
            ▴
          </span>
        </span>
        <Bar value={n} max={VAGRANT_CRUMBS} color="var(--gaslight)" className="h-1.5" />
      </button>
      {tabs.map((id) => (
        <button
          key={id}
          type="button"
          onClick={() => onOpen(id)}
          aria-label={TAB_BY_ID[id].label || "Настройки"}
          title={TAB_BY_ID[id].label || "Настройки"}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-line bg-panel-2 text-lg text-parchment-dim focus-visible:outline-2 focus-visible:outline-brass"
        >
          {TAB_BY_ID[id].icon}
        </button>
      ))}
    </div>
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
  /** all: every tab labelled; active: only the open one; none: icons; caption: icon over a 10 px caption (phones). */
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
        caption ? "min-w-0 flex-col gap-0 overflow-hidden px-0.5 pt-1 text-[10px]" : "min-w-10 gap-1.5 px-1.5 text-xs",
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

/** What waits behind the boards (greyed until the vagrants open the office). */
const BEHIND_BOARDS: { icon: string; label: string }[] = [
  { icon: "🏗️", label: "Стройка" },
  { icon: "🐀", label: "Работы" },
  { icon: "🔬", label: "Наука" },
];

/** Before any tab is revealed: the office is still boarded up, with the first goal on the door (PAN-1). */
function Boarded({ medalsOnly }: { medalsOnly: boolean }) {
  // one primitive selector: the board re-renders once per crumb, not per tick
  const n = useGame((s) => Math.min(VAGRANT_CRUMBS, Math.floor(s.game.resEver.crumbs)));
  const done = n >= VAGRANT_CRUMBS;
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-3 px-2 py-5 text-center short:gap-2 short:py-2">
      <OfficeDoor />
      <p className="font-display text-xl font-bold leading-tight text-brass-light short:text-base">Контора колонии пока заколочена</p>
      <div className="w-full max-w-72 rounded-md border border-brass-dark/60 bg-black/30 px-3 py-2 text-left shadow-[inset_0_1px_3px_rgba(0,0,0,.5)]">
        <p className="flex items-baseline justify-between gap-2 text-sm leading-snug">
          <b className="font-display text-brass-light">Запах еды</b>
          <span className="font-mono tabular text-gaslight">
            {n}/{VAGRANT_CRUMBS} 🍞
          </span>
        </p>
        <Bar value={n} max={VAGRANT_CRUMBS} color="var(--gaslight)" className="mt-1 h-2" />
        <p className="mt-1 text-[11px] leading-snug text-parchment-dim">
          {done ? "Пахнет на всю округу — бродяжки уже принюхиваются у решётки!" : "Тащите крошки сквозь решётку — на запах сбегутся бродяжки."}
        </p>
      </div>
      <div aria-label="Скоро откроется" className="flex flex-wrap justify-center gap-1.5">
        {BEHIND_BOARDS.map((b) => (
          <span key={b.label} className="inline-flex items-center gap-1 rounded border border-dashed border-line px-2 py-1 text-xs text-parchment-dim opacity-60">
            <span className="grayscale">{b.icon}</span>
            {b.label}
          </span>
        ))}
      </div>
      {medalsOnly && (
        <button type="button" onClick={() => useGame.getState().setTab("medals")} className="min-h-10 rounded border border-brass-dark/70 bg-panel-2 px-3 py-1.5 text-sm font-bold text-gaslight hover:border-brass">
          Первая медаль уже ваша — загляните в 🏅
        </button>
      )}
    </div>
  );
}

/**
 * The boarded office door: an arched plank door in a brick frame, three planks nailed across it in a Z, a brass
 * «КОНТОРА» plate and a cobweb in the corner. Static (no loops); gradients from PanelArtDefs.
 */
function OfficeDoor() {
  const ink = "#1a120c";
  const plank = (d: string) => <path d={d} fill="#8a5a2e" stroke={ink} strokeWidth="1.2" strokeLinejoin="round" />;
  const nail = (x: number, y: number) => <circle key={`${x}:${y}`} cx={x} cy={y} r="1.8" fill="#9aa1a6" stroke={ink} strokeWidth=".7" />;
  return (
    <svg viewBox="0 0 160 150" className="h-32 w-auto shrink-0 drop-shadow-[0_4px_8px_rgba(0,0,0,.6)] md:h-40 short:max-h-24" aria-hidden focusable="false">
      {/* brick frame */}
      <path d="M22 148V54Q22 10 80 10Q138 10 138 54V148Z" fill="#4a2f1e" stroke={ink} strokeWidth="1.5" />
      <path
        d="M22 70H40M120 70H138M22 90H40M120 90H138M22 110H40M120 110H138M22 130H40M120 130H138M31 70V90M129 90V110M31 110V130M129 130V148M31 50L40 56M129 50L120 56M58 16L62 26M102 16L98 26"
        stroke="#2a1a10"
        strokeWidth="1.2"
      />
      {/* the door */}
      <path d="M38 148V58Q38 26 80 26Q122 26 122 58V148Z" fill="url(#cv-wood)" stroke={ink} strokeWidth="1.5" />
      <path d="M59 32V148M80 26V148M101 32V148" stroke="#5a3a1c" strokeWidth="1.2" opacity=".8" />
      <circle cx="110" cy="102" r="3.4" fill="url(#cv-brass)" stroke={ink} strokeWidth=".8" />
      <path d="M109 110h2v6h-2z" fill={ink} />
      {/* the brass plate */}
      <g transform="translate(80 50)">
        <rect x="-30" y="-8" width="60" height="15" rx="2" fill="url(#cv-brass)" stroke={ink} strokeWidth="1" />
        <circle cx="-26.5" cy="-.5" r="1.1" fill={ink} />
        <circle cx="26.5" cy="-.5" r="1.1" fill={ink} />
        <text x="0" y="3" textAnchor="middle" fontSize="8" fontWeight="700" letterSpacing=".6" fill="#2a1a0c" fontFamily="Georgia, serif">
          КОНТОРА
        </text>
      </g>
      {/* three planks nailed in a Z */}
      {plank("M30 68L130 62L131 74L31 81Z")}
      {plank("M36 134L118 70L127 80L45 144Z")}
      {plank("M28 124L132 120L133 132L29 137Z")}
      <path d="M40 72L120 67M46 129L118 126M60 118L110 80" stroke="#5a3a1c" strokeWidth=".8" opacity=".7" />
      {[nail(35, 74), nail(125, 68), nail(35, 130), nail(126, 126), nail(42, 136), nail(121, 76)]}
      {/* cobweb in the top-left corner of the frame */}
      <g stroke="#e8dcc4" strokeWidth=".6" fill="none" opacity=".45">
        <path d="M24 60L52 34M24 60L44 52M24 60L34 30M24 60L56 46" />
        <path d="M28 52Q34 50 36 44M30 46Q38 44 41 38M33 40Q41 38 46 32" />
      </g>
      {/* threshold */}
      <rect x="16" y="144" width="128" height="6" rx="1" fill="#3a2a1e" stroke={ink} strokeWidth="1" />
    </svg>
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
