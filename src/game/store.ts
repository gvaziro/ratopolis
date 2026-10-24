"use client";

import { create } from "zustand";
import {
  assignJob,
  buyBuilding,
  buyEdict,
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
  toggleSatiety,
} from "./engine/actions";
import { derive, type Derived } from "./engine/derive";
import { clickPurse, clickShiny, marketDeal, onZoneOpen, sceneAction, whistle } from "./engine/events";
import { simulateOffline, type OfflineReport } from "./engine/offline";
import { deserialize, exportString, importString, SAVE_KEY, serialize } from "./engine/save";
import { createInitialState } from "./engine/state";
import { step, TICK } from "./engine/step";
import { emitFx } from "./fx";
import type {
  AssignMode,
  BuildingId,
  CrewPosition,
  BuyMode,
  EdictId,
  EngineCtx,
  GameState,
  JobId,
  ResId,
  SceneAction,
  SceneEventId,
  Settings,
  UpgradeId,
  ZoneId,
} from "./types";

export type TabId = "buildings" | "jobs" | "upgrades" | "map" | "schedule" | "migration" | "medals" | "settings";

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

  /* ---- lifecycle */
  init: () => void;
  /** Run `steps` fixed ticks (TICK s each) in one state update. */
  advance: (steps: number, active: boolean) => void;
  /** Catch up a long absence (tab hidden > 60 s). */
  catchUp: (seconds: number) => void;
  noteInput: () => void;
  save: () => void;
  dismissOffline: () => void;

  /* ---- player actions */
  click: (x?: number, y?: number) => void;
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

function isActive(lastInputAt: number): boolean {
  if (typeof document === "undefined") return false;
  return document.visibilityState === "visible" && Date.now() - lastInputAt < 60_000;
}

export const useGame = create<GameStore>((set, get) => {
  /** Clone, mutate through the engine, publish, emit fx. */
  const mutate = (fn: (s: GameState, d: Derived, ctx: EngineCtx) => GameState | void) => {
    const s = structuredClone(get().game);
    const ctx: EngineCtx = { fx: [] };
    const replaced = fn(s, derive(s), ctx);
    set({ game: replaced ?? s });
    emitFx(ctx.fx);
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

    init: () => {
      if (get().ready) return;
      const now = Date.now();
      let s: GameState | null = null;
      try {
        const raw = localStorage.getItem(saveKey());
        if (raw) s = deserialize(raw);
      } catch {
        s = null;
      }
      let report: OfflineReport | null = null;
      const ctx: EngineCtx = { fx: [] };
      if (s) {
        const away = (now - s.lastSaved) / 1000;
        report = simulateOffline(s, away, ctx);
        if (report && report.elapsed < 60) report = null;
      } else {
        s = createInitialState(seed(), now);
      }
      s.lastSaved = now;
      set({ game: s, ready: true, offlineReport: report, lastInputAt: now });
      emitFx(ctx.fx);
    },

    advance: (steps, active) => {
      if (!get().ready || steps <= 0) return;
      const s = structuredClone(get().game);
      const ctx: EngineCtx = { fx: [] };
      for (let i = 0; i < steps; i++) step(s, TICK, { active }, ctx);
      set({ game: s });
      // a stalled frame (short hidden tab, GC) catches up many ticks at once: drop the per-tick chatter
      emitFx(steps > 3 ? ctx.fx.filter((f) => !(f.k === "click" && f.auto) && f.k !== "birth" && !(f.k === "drop" && !f.big)) : ctx.fx);
    },

    catchUp: (seconds) => {
      if (!get().ready) return;
      const s = structuredClone(get().game);
      const ctx: EngineCtx = { fx: [] };
      const report = simulateOffline(s, seconds, ctx);
      set({ game: s, offlineReport: report && report.elapsed >= 60 ? report : get().offlineReport });
      emitFx(ctx.fx);
    },

    noteInput: () => set({ lastInputAt: Date.now() }),

    save: () => {
      const g = get().game;
      if (!get().ready) return;
      try {
        const s = { ...g, lastSaved: Date.now() };
        localStorage.setItem(saveKey(), serialize(s));
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
    scene: (action) => {
      // mounting/unmounting a scene UI is not player input (would un-gate harmful events for an AFK player)
      if (action.a !== "attach" && action.a !== "detach") set({ lastInputAt: Date.now() });
      mutate((s, d, ctx) => sceneAction(s, d, action, ctx));
    },
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
        s.meta = s.meta; // settings live on GameState; meta untouched
      }),
    exportSave: () => exportString({ ...get().game, lastSaved: Date.now() }),
    importSave: (str) => {
      const s = importString(str);
      if (!s) return false;
      s.lastSaved = Date.now();
      set({ game: s, offlineReport: null });
      get().save();
      return true;
    },
    hardReset: () => {
      try {
        localStorage.removeItem(saveKey());
      } catch {
        /* ignore */
      }
      const s = createInitialState(seed(), Date.now());
      set({ game: s, offlineReport: null });
      get().save();
    },

    devGive: (res, amount) => mutate((s, d) => devGive(s, d, res, amount)),
    devWarp: (seconds) => {
      const steps = Math.round(seconds / TICK);
      const s = structuredClone(get().game);
      const ctx: EngineCtx = { fx: [] };
      const active = isActive(get().lastInputAt);
      for (let i = 0; i < steps; i++) step(s, TICK, { active }, ctx);
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
