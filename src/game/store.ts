"use client";

import { create } from "zustand";
import {
  acceptCommission,
  assignJob,
  buyBuilding,
  buyEdict,
  buyEdictRank,
  buySeal,
  buyUpgrade,
  click,
  contributeExpedition,
  contributeExpress,
  devGive,
  migrate,
  openZone,
  setAssignMode,
  setFocus,
  setForeman,
  setRatios,
  setSeal,
  toggleSatiety,
} from "./engine/actions";
import { derive, type Derived } from "./engine/derive";
import { clickPurse, clickShiny, marketDeal, onZoneOpen, sceneAction, whistle } from "./engine/events";
import type { Hint } from "./engine/hints";
import { simulateOffline, type OfflineReport } from "./engine/offline";
import { deserialize, exportString, importAny, isNewerSave, SAVE_KEY, savedVersion, serialize } from "./engine/save";
import { createInitialState, defaultMeta, newRun, SCHEMA_VERSION } from "./engine/state";
import { step, TICK } from "./engine/step";
import { emitFx, emitUiFx, type UiFx } from "./fx";
import type {
  AssignMode,
  BuildingId,
  CommissionId,
  CrewPosition,
  BuyMode,
  EdictId,
  EngineCtx,
  Fx,
  GameState,
  JobId,
  ResId,
  SceneAction,
  SceneEventId,
  SealId,
  Settings,
  TabId,
  UpgradeId,
  ZoneId,
} from "./types";

export type { TabId } from "./types";

/** Why the save is not being written (SH-1 dialogs). While set, the game neither ticks nor saves. */
export type SaveIssue = null | { kind: "corrupt"; quarantineKey: string } | { kind: "newer"; version: number } | { kind: "locked" };

/** A rolling backup slot (bak1 = newest). `at` = epoch ms when that save was written. */
export interface BackupInfo {
  slot: 1 | 2;
  at: number;
  rats: number;
  crownsEver: number;
}

export interface GameStore {
  game: GameState;
  /** True once the save has been loaded on the client. */
  ready: boolean;
  offlineReport: OfflineReport | null;
  /** Real-time ms of the last player input (pointer/keyboard). */
  lastInputAt: number;

  /* ---- UI state (not saved in GameState) */
  tab: TabId;
  buyMode: BuyMode;
  setTab: (t: TabId) => void;
  setBuyMode: (m: BuyMode) => void;
  /** Mobile panel sheet height (PA-2/SH-2). */
  sheet: "half" | "full";
  setSheet: (v: "half" | "full") => void;
  toggleSheet: () => void;
  /** Open a tab, then (next animation frame, once it rendered) emit UiFx focus so the panel scrolls to and glows `target`. */
  focus: (tab: TabId, target?: string) => void;

  /* ---- crash & save safety (EN-8) */
  /** An engine call threw: nothing is published, ticked or saved until resetCrash / restoreBackup / startFresh. */
  crashed: boolean;
  crashError: string | null;
  saveIssue: SaveIssue;
  /** Reload the game from storage (the last good save) and clear the crash. */
  resetCrash: () => void;
  /** A UI render error: freeze ticks and saves like an engine crash (CrashScreen). */
  markCrashed: (error: string) => void;
  /** Rolling backups (every 5 min and before import / reset / a schema migration), newest first. */
  backups: () => BackupInfo[];
  restoreBackup: (slot: 1 | 2) => boolean;
  /** The stored save string as is (for «Скачать сохранение»), null when there is none. */
  rawSave: () => string | null;
  /** Import a downloaded save file (raw JSON) or an export string; a backup is taken first. */
  importSaveFile: (text: string) => boolean;
  /** Move play into this tab when another tab holds the colony (saveIssue "locked"). */
  takeOverTab: () => void;
  /** Start a brand-new colony (corrupt save, crash screen); keeps the settings. Not while "newer" or "locked". */
  startFresh: () => void;

  /* ---- lifecycle */
  /** Load the save and catch up the absence. Its fx (offline medals, zone banners, coronation) wait for flushInitFx. */
  init: () => void;
  /** Emit the fx kept by init() once the listeners are mounted (call when `ready` turns true). Idempotent. */
  flushInitFx: () => void;
  /** Run `steps` fixed ticks (TICK s each) in one state update. */
  advance: (steps: number, active: boolean) => void;
  /** Catch up a long absence (tab hidden > 60 s). */
  catchUp: (seconds: number) => void;
  noteInput: () => void;
  save: () => void;
  dismissOffline: () => void;

  /* ---- player actions */
  click: (x?: number, y?: number) => void;
  /** mode 10 buys exactly 10 levels (or the levels left below maxLevel) or nothing; "max" buys what is affordable. */
  buyBuilding: (id: BuildingId, mode?: BuyMode) => void;
  buyUpgrade: (id: UpgradeId) => void;
  assignJob: (job: JobId, delta: number | "max" | "zero") => void;
  setFocus: (job: JobId) => void;
  setAssignMode: (mode: AssignMode) => void;
  setRatios: (r: Partial<GameState["ratios"]>) => void;
  contributeExpedition: (zone: ZoneId, res?: ResId) => void;
  contributeExpress: (res?: ResId) => void;
  toggleAutoContribute: () => void;
  toggleSatiety: () => void;
  setForeman: (key: "nests" | "storage", on: boolean) => void;
  scene: (action: SceneAction) => void;
  clickPurse: () => void;
  clickShiny: (id: number) => void;
  marketDeal: (i: number) => void;
  whistle: () => void;
  migrate: () => void;
  buyEdict: (id: EdictId) => void;
  /** Rank II/III of a signed edict (after the first coronation ever). */
  buyEdictRank: (id: EdictId) => void;
  /** Buy a Great Seal (120 👑) and activate it; an owned one is activated (only while s.time < 60). */
  buySeal: (id: SealId) => void;
  /** Swap the active seal for free in the first minute of a run. */
  setSeal: (id: SealId) => void;
  /** Accept one of the King's offered commissions. */
  acceptCommission: (id: CommissionId) => void;
  /** «Сделать» on the elder's hint: perform h.action, then focus(h.tab, h.target). */
  applyHint: (h: Hint) => void;
  /** Default crew position for future trains (Расписание tab). */
  setTrainPref: (pos: CrewPosition) => void;
  markSeen: (key: string) => void;
  markSeenMany: (keys: string[]) => void;

  /* ---- settings & saves */
  setSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  exportSave: () => string;
  importSave: (str: string) => boolean;
  hardReset: () => void;

  /* ---- dev tools */
  devGive: (res: ResId, amount: number) => void;
  devWarp: (seconds: number) => void;
  devTrigger: (id: SceneEventId | "purse" | "market") => void;
  devOpenZone: (zone: ZoneId) => void;
}

function seed(): number {
  return (Math.random() * 2 ** 32) >>> 0;
}

/** localStorage key; in dev `?slot=name` keeps a separate save per tab (parallel playtests). */
function saveKey(): string {
  if (process.env.NODE_ENV === "production" || typeof window === "undefined") return SAVE_KEY;
  const slot = new URLSearchParams(window.location.search).get("slot");
  return slot ? `${SAVE_KEY}:${slot}` : SAVE_KEY;
}

/** Fx produced by init() before any onFx listener exists; emitted once by flushInitFx(). */
let initFx: Fx[] = [];
let initUiFx: UiFx[] = [];

function isActive(lastInputAt: number): boolean {
  if (typeof document === "undefined") return false;
  return document.visibilityState === "visible" && Date.now() - lastInputAt < 60_000;
}

function errorText(e: unknown): string {
  if (e instanceof Error) return e.message || e.name;
  return String(e);
}

/* ------------------------------------------------------------ storage helpers (EN-8) */

const BACKUP_EVERY_MS = 5 * 60_000;
/** Real time of the last rolling backup (the first one comes 5 min after load). */
let lastBackupAt = 0;

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function lsSet(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

type BakMeta = Partial<Record<"1" | "2", { at: number; rats: number; crownsEver: number }>>;

function readBakMeta(key: string): BakMeta {
  try {
    const v = JSON.parse(lsGet(`${key}:bakmeta`) ?? "{}");
    return v && typeof v === "object" ? (v as BakMeta) : {};
  } catch {
    return {};
  }
}

/**
 * Copy the stored save (or `raw`) to `${key}:bak1`, shifting bak1 → bak2. Unreadable or newer-version saves are
 * never copied (a corrupt save must not push a good backup out).
 */
function makeBackup(key: string, raw?: string | null): void {
  const src = raw ?? lsGet(key);
  if (!src) return;
  const st = deserialize(src);
  if (!st || isNewerSave(st)) return;
  const metas = readBakMeta(key);
  const b1 = lsGet(`${key}:bak1`);
  if (b1 !== null && lsSet(`${key}:bak2`, b1) && metas["1"]) metas["2"] = metas["1"];
  if (!lsSet(`${key}:bak1`, src)) return;
  metas["1"] = { at: st.lastSaved || Date.now(), rats: st.rats, crownsEver: st.meta.crownsEver };
  lsSet(`${key}:bakmeta`, JSON.stringify(metas));
}

interface Loaded {
  game: GameState;
  report: OfflineReport | null;
  issue: SaveIssue;
  fx: Fx[];
  uiFx: UiFx[];
}

/** Fresh colony; on a first visit reducedMotion follows the OS setting. */
function freshGame(now: number, settings?: Settings): GameState {
  const s = settings ? newRun(defaultMeta(), structuredClone(settings), seed(), now) : createInitialState(seed(), now);
  if (!settings && typeof window !== "undefined" && typeof window.matchMedia === "function") {
    try {
      s.settings.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      s.settings.reducedMotionFromOS = true;
    } catch {
      /* no media queries: keep the defaults */
    }
  }
  return s;
}

/**
 * Read the save under `key`: a newer schema is left alone (issue "newer"), an unreadable one is quarantined to
 * `${key}:corrupt:<ms>` (issue "corrupt"), an older schema is backed up before its first overwrite.
 * The absence is simulated; if that throws, the save loads without the report.
 */
function loadFromStorage(key: string, now: number): Loaded {
  const raw = lsGet(key);
  const fx: Fx[] = [];
  const uiFx: UiFx[] = [];
  if (!raw) return { game: freshGame(now), report: null, issue: null, fx, uiFx };
  const parsed = deserialize(raw);
  if (isNewerSave(parsed)) return { game: freshGame(now), report: null, issue: { kind: "newer", version: parsed.version }, fx, uiFx };
  if (!parsed) {
    const quarantineKey = `${key}:corrupt:${now}`;
    lsSet(quarantineKey, raw);
    return { game: freshGame(now), report: null, issue: { kind: "corrupt", quarantineKey }, fx, uiFx };
  }
  const v = savedVersion(raw);
  if (v !== null && v < SCHEMA_VERSION) makeBackup(key, raw);
  let s: GameState = parsed;
  let report: OfflineReport | null = null;
  try {
    const ctx: EngineCtx = { fx: [] };
    report = simulateOffline(s, (now - s.lastSaved) / 1000, ctx);
    if (report && report.elapsed < 60) report = null;
    fx.push(...ctx.fx);
  } catch {
    // the catch-up mutated the state half-way: start again from the stored save, without the report
    const again = deserialize(raw);
    if (again && !isNewerSave(again)) s = again;
    report = null;
    uiFx.push({ k: "toast", text: "Отчёт об отлучке потерян: летописец уронил перо", icon: "📜" });
  }
  s.lastSaved = now;
  return { game: s, report, issue: null, fx, uiFx };
}

/* ------------------------------------------------------------ single tab (EN-8) */

/** Web Locks state: none = no lock API (play freely), pending = asked, held = ours, lost = another tab has it. */
let lockState: "none" | "pending" | "held" | "lost" = "none";
let releaseLock: (() => void) | null = null;
let channel: BroadcastChannel | null = null;

function lockName(key: string): string {
  return `ratropolis:${key}`;
}

/** Survives a dev hot reload of this module (the page, and its Web Lock, stay the same). */
function lockGlobal(): { __rrLock?: { key: string; release: () => void; channel: BroadcastChannel | null } } {
  return globalThis as unknown as { __rrLock?: { key: string; release: () => void; channel: BroadcastChannel | null } };
}

export const useGame = create<GameStore>((set, get) => {
  /** Ticks, saves and player actions stop while crashed, while a save issue is open and until the tab lock answers. */
  const blocked = () => get().crashed || get().saveIssue !== null || lockState === "pending";

  const crash = (e: unknown) => {
    console.error("[ratropolis] engine error", e);
    set({ crashed: true, crashError: errorText(e) });
  };

  /** Clone, mutate through the engine, publish, emit fx. A throw publishes nothing and marks the game crashed. */
  const mutate = (fn: (s: GameState, d: Derived, ctx: EngineCtx) => GameState | void) => {
    if (blocked()) return;
    const ctx: EngineCtx = { fx: [] };
    let next: GameState;
    try {
      const s = structuredClone(get().game);
      next = fn(s, derive(s), ctx) ?? s;
    } catch (e) {
      crash(e);
      return;
    }
    set({ game: next });
    emitFx(ctx.fx);
  };

  /** Replace the game with a loaded/restored one and resume play. */
  const adopt = (game: GameState, report: OfflineReport | null = null) => {
    set({ game, offlineReport: report, crashed: false, crashError: null, saveIssue: null });
  };

  /**
   * Ask for the per-slot Web Lock (browser only). "try": only if free (page load); "wait": queue behind the holder,
   * then continue from its save (take-over); "reclaim": queue behind our own previous module instance (dev hot reload).
   */
  const requestLock = (key: string, mode: "try" | "wait" | "reclaim") => {
    const locks = typeof window !== "undefined" && typeof navigator !== "undefined" ? navigator.locks : undefined;
    if (!locks) {
      lockState = "none";
      return;
    }
    lockState = "pending";
    const onLock = (lock: Lock | null): Promise<void> | void => {
      if (!lock) {
        lockState = "lost";
        set({ saveIssue: { kind: "locked" } });
        return;
      }
      lockState = "held";
      if (mode === "wait") {
        // the other tab saved just before letting go: continue from its save
        const loaded = loadFromStorage(key, Date.now());
        set({ game: loaded.game, offlineReport: null, crashed: false, crashError: null, saveIssue: loaded.issue, lastInputAt: Date.now() });
        emitFx(loaded.fx);
        for (const f of loaded.uiFx) emitUiFx(f);
      } else if (get().saveIssue?.kind === "locked") set({ saveIssue: null });
      return new Promise<void>((resolve) => {
        releaseLock = resolve;
        lockGlobal().__rrLock = { key, release: resolve, channel };
      });
    };
    const p = mode === "try" ? locks.request(lockName(key), { ifAvailable: true }, onLock) : locks.request(lockName(key), onLock);
    p.catch(() => {
      lockState = "none";
    });
  };

  const setupTabLock = (key: string) => {
    if (typeof window === "undefined" || typeof navigator === "undefined" || !navigator.locks) return;
    if (lockState === "held" || lockState === "pending") return;
    // a hot-reloaded copy of this module still holds the lock in this very page: let it go and take it over
    const prev = lockGlobal().__rrLock;
    if (prev) {
      lockGlobal().__rrLock = undefined;
      prev.channel?.close();
      prev.release();
    }
    if (typeof BroadcastChannel !== "undefined" && !channel) {
      channel = new BroadcastChannel(lockName(key));
      channel.onmessage = (e: MessageEvent) => {
        if (e.data !== "takeover" || lockState !== "held") return;
        get().save();
        lockState = "lost";
        set({ saveIssue: { kind: "locked" } });
        const release = releaseLock;
        releaseLock = null;
        lockGlobal().__rrLock = undefined;
        release?.();
      };
    }
    requestLock(key, prev && prev.key === key ? "reclaim" : "try");
  };

  return {
    game: createInitialState(1, 0),
    ready: false,
    offlineReport: null,
    lastInputAt: 0,
    tab: "buildings",
    buyMode: 1,
    setTab: (tab) => set({ tab }),
    setBuyMode: (buyMode) => set({ buyMode }),
    sheet: "half",
    setSheet: (sheet) => set({ sheet }),
    toggleSheet: () => set({ sheet: get().sheet === "half" ? "full" : "half" }),
    focus: (tab, target) => {
      set({ tab });
      // after the tab has rendered: the next frame, or a short timer where frames are paused (background tab)
      let done = false;
      const fire = () => {
        if (done) return;
        done = true;
        emitUiFx({ k: "focus", tab, target });
      };
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(fire);
      setTimeout(fire, 100);
    },

    crashed: false,
    crashError: null,
    saveIssue: null,

    markCrashed: (error) => {
      if (!get().crashed) set({ crashed: true, crashError: error });
    },

    resetCrash: () => {
      if (get().saveIssue?.kind === "newer" || get().saveIssue?.kind === "locked") {
        set({ crashed: false, crashError: null });
        return;
      }
      const loaded = loadFromStorage(saveKey(), Date.now());
      set({ game: loaded.game, offlineReport: loaded.report, crashed: false, crashError: null, saveIssue: loaded.issue });
      emitFx(loaded.fx);
      for (const f of loaded.uiFx) emitUiFx(f);
    },

    backups: () => {
      const key = saveKey();
      const metas = readBakMeta(key);
      const out: BackupInfo[] = [];
      for (const slot of [1, 2] as const) {
        const m = metas[String(slot) as "1" | "2"];
        if (m && lsGet(`${key}:bak${slot}`)) out.push({ slot, at: m.at, rats: m.rats, crownsEver: m.crownsEver });
      }
      return out;
    },

    restoreBackup: (slot) => {
      const issue = get().saveIssue;
      if (issue?.kind === "newer" || issue?.kind === "locked") return false;
      const key = saveKey();
      const raw = lsGet(`${key}:bak${slot}`);
      if (!raw) return false;
      const s = deserialize(raw);
      if (!s || isNewerSave(s)) return false;
      if (!issue) makeBackup(key); // keep the current save too (skipped when unreadable)
      s.lastSaved = Date.now();
      lastBackupAt = Date.now();
      adopt(s);
      get().save();
      return true;
    },

    rawSave: () => lsGet(saveKey()),

    importSaveFile: (text) => get().importSave(text),

    takeOverTab: () => {
      if (get().saveIssue?.kind !== "locked" || lockState !== "lost") return;
      channel?.postMessage("takeover");
      requestLock(saveKey(), "wait");
    },

    startFresh: () => {
      const issue = get().saveIssue;
      if (issue?.kind === "newer" || issue?.kind === "locked") return;
      const key = saveKey();
      makeBackup(key);
      lastBackupAt = Date.now();
      adopt(freshGame(Date.now(), get().game.settings));
      get().save();
    },

    init: () => {
      if (get().ready) return;
      const now = Date.now();
      const key = saveKey();
      setupTabLock(key);
      const loaded = loadFromStorage(key, now);
      lastBackupAt = now;
      // no listener is mounted yet (GameRoot still shows the loading screen): flushInitFx() emits these later
      initFx = loaded.fx;
      initUiFx = loaded.uiFx;
      set({
        game: loaded.game,
        ready: true,
        offlineReport: loaded.report,
        lastInputAt: now,
        crashed: false,
        crashError: null,
        // the lock may already have said "locked" (it answers asynchronously, usually after this)
        saveIssue: loaded.issue ?? (lockState === "lost" ? { kind: "locked" } : null),
      });
    },

    flushInitFx: () => {
      const list = initFx;
      const ui = initUiFx;
      initFx = [];
      initUiFx = [];
      emitFx(list);
      for (const f of ui) emitUiFx(f);
    },

    advance: (steps, active) => {
      if (!get().ready || steps <= 0 || blocked()) return;
      const ctx: EngineCtx = { fx: [] };
      let s: GameState;
      try {
        s = structuredClone(get().game);
        for (let i = 0; i < steps; i++) step(s, TICK, { active }, ctx);
      } catch (e) {
        crash(e);
        return;
      }
      set({ game: s });
      // a stalled frame (short hidden tab, GC) catches up many ticks at once: drop the per-tick chatter
      emitFx(steps > 3 ? ctx.fx.filter((f) => !(f.k === "click" && f.auto) && f.k !== "birth" && !(f.k === "drop" && !f.big)) : ctx.fx);
    },

    catchUp: (seconds) => {
      if (!get().ready || blocked()) return;
      const ctx: EngineCtx = { fx: [] };
      let s: GameState;
      let report: OfflineReport | null;
      try {
        s = structuredClone(get().game);
        report = simulateOffline(s, seconds, ctx);
      } catch (e) {
        crash(e);
        return;
      }
      set({ game: s, offlineReport: report && report.elapsed >= 60 ? report : get().offlineReport });
      emitFx(ctx.fx);
    },

    noteInput: () => set({ lastInputAt: Date.now() }),

    save: () => {
      const g = get().game;
      if (!get().ready || blocked()) return;
      const key = saveKey();
      const now = Date.now();
      if (now - lastBackupAt >= BACKUP_EVERY_MS) {
        makeBackup(key);
        lastBackupAt = now;
      }
      try {
        const s = { ...g, lastSaved: now };
        localStorage.setItem(key, serialize(s));
        set({ game: { ...g, lastSaved: s.lastSaved } });
      } catch {
        /* storage full or blocked: ignore */
      }
    },

    dismissOffline: () => set({ offlineReport: null }),

    click: (x, y) => {
      set({ lastInputAt: Date.now() });
      mutate((s, d, ctx) => {
        click(s, d, ctx, { x, y });
      });
    },
    buyBuilding: (id, mode) =>
      mutate((s, d, ctx) => {
        buyBuilding(s, d, id, mode ?? get().buyMode, ctx);
      }),
    buyUpgrade: (id) =>
      mutate((s, _d, ctx) => {
        buyUpgrade(s, id, ctx);
      }),
    assignJob: (job, delta) => mutate((s, d) => assignJob(s, d, job, delta)),
    setFocus: (job) => mutate((s) => setFocus(s, job)),
    setAssignMode: (mode) => mutate((s) => setAssignMode(s, mode)),
    setRatios: (r) => mutate((s) => setRatios(s, r)),
    contributeExpedition: (zone, res) =>
      mutate((s, _d, ctx) => {
        contributeExpedition(s, zone, res ?? null, ctx);
      }),
    contributeExpress: (res) =>
      mutate((s, _d, ctx) => {
        contributeExpress(s, res ?? null, ctx);
      }),
    toggleAutoContribute: () =>
      mutate((s) => {
        s.autoContribute = !s.autoContribute;
      }),
    toggleSatiety: () => mutate((s) => toggleSatiety(s)),
    setForeman: (key, on) => mutate((s) => setForeman(s, key, on)),
    // not player input by itself: scene UIs send results on timers (catch expiry, piles/taps time-up) with nobody
    // at the controls; real input is recorded by useGameLoop's window pointerdown/keydown listeners
    scene: (action) => mutate((s, d, ctx) => sceneAction(s, d, action, ctx)),
    clickPurse: () => mutate((s, d, ctx) => clickPurse(s, d, ctx)),
    clickShiny: (id) => mutate((s, d, ctx) => clickShiny(s, d, id, ctx)),
    marketDeal: (i) =>
      mutate((s, d, ctx) => {
        marketDeal(s, d, i, ctx);
      }),
    whistle: () =>
      mutate((s, _d, ctx) => {
        whistle(s, ctx);
      }),
    migrate: () => {
      mutate((s, _d, ctx) => migrate(s, Date.now(), ctx) ?? undefined);
      get().save();
    },
    buyEdict: (id) =>
      mutate((s, _d, ctx) => {
        buyEdict(s, id, ctx);
      }),
    buyEdictRank: (id) =>
      mutate((s, _d, ctx) => {
        buyEdictRank(s, id, ctx);
      }),
    buySeal: (id) =>
      mutate((s, _d, ctx) => {
        buySeal(s, id, ctx);
      }),
    setSeal: (id) =>
      mutate((s, _d, ctx) => {
        setSeal(s, id, ctx);
      }),
    acceptCommission: (id) =>
      mutate((s, _d, ctx) => {
        acceptCommission(s, id, ctx);
      }),
    applyHint: (h) => {
      const a = h.action;
      if (a?.kind === "assign") get().assignJob(a.job, a.n);
      else if (a?.kind === "contribute") get().contributeExpedition(a.zone);
      else if (a?.kind === "buyBuilding") get().buyBuilding(a.id, 1);
      else if (a?.kind === "buyUpgrade") get().buyUpgrade(a.id);
      get().focus(h.tab, h.target);
    },
    setTrainPref: (pos) =>
      mutate((s) => {
        s.trainPrefs.position = pos;
        if (s.scene && s.scene.phase === "rumble") s.scene.position = pos;
      }),
    markSeen: (key) => {
      if (get().game.seen[key]) return;
      mutate((s) => {
        s.seen[key] = true;
      });
    },
    markSeenMany: (keys) => {
      const fresh = keys.filter((k) => !get().game.seen[k]);
      if (!fresh.length) return;
      mutate((s) => {
        for (const k of fresh) s.seen[k] = true;
      });
    },

    setSetting: (key, value) =>
      mutate((s) => {
        s.settings[key] = value;
        // a hand-picked motion setting is no longer «как в системе»
        if (key === "reducedMotion") s.settings.reducedMotionFromOS = false;
      }),
    exportSave: () => exportString({ ...get().game, lastSaved: Date.now() }),
    importSave: (str) => {
      const issue = get().saveIssue;
      if (issue?.kind === "newer" || issue?.kind === "locked") return false;
      const s = importAny(str);
      if (!s || isNewerSave(s)) return false;
      makeBackup(saveKey());
      lastBackupAt = Date.now();
      s.lastSaved = Date.now();
      adopt(s);
      get().save();
      return true;
    },
    hardReset: () => {
      const issue = get().saveIssue;
      if (issue?.kind === "newer" || issue?.kind === "locked") return;
      const key = saveKey();
      makeBackup(key);
      lastBackupAt = Date.now();
      try {
        localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
      adopt(createInitialState(seed(), Date.now()));
      get().save();
    },

    devGive: (res, amount) => mutate((s, d) => devGive(s, d, res, amount)),
    devWarp: (seconds) => {
      if (blocked()) return;
      const steps = Math.round(seconds / TICK);
      const ctx: EngineCtx = { fx: [] };
      const active = isActive(get().lastInputAt);
      let s: GameState;
      try {
        s = structuredClone(get().game);
        for (let i = 0; i < steps; i++) step(s, TICK, { active }, ctx);
      } catch (e) {
        crash(e);
        return;
      }
      set({ game: s });
      emitFx(ctx.fx.filter((f) => f.k !== "birth" && f.k !== "click" && f.k !== "drop"));
    },
    devTrigger: (id) =>
      mutate((s) => {
        if (id === "purse") s.timers.purse = s.time;
        else if (id === "market") s.timers.market = s.time;
        else if (id === "cat") s.timers.catForcedAt = s.time;
        else if (id === "ratcatcher") s.timers.ratcatcherAt = s.time;
        else if (id === "downpour") s.timers.downpour = s.time;
        else s.timers[id] = s.time;
        s.timers.lastSceneEnd = -999;
      }),
    devOpenZone: (zone) =>
      mutate((s, _d, ctx) => {
        if (s.zones[zone]) return;
        openZone(s, zone, ctx);
        onZoneOpen(s, zone);
      }),
  };
});

export { isActive };

/** Derived values for the current state (memoized per state object). */
export function useDerived(): Derived {
  const game = useGame((st) => st.game);
  return derivedOf(game);
}

const cache = new WeakMap<GameState, Derived>();
export function derivedOf(game: GameState): Derived {
  let d = cache.get(game);
  if (!d) {
    d = derive(game);
    cache.set(game, d);
  }
  return d;
}

// dev-only handle for debugging in the browser console
if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
  (window as unknown as { __rr?: typeof useGame }).__rr = useGame;
}
