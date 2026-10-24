import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exportString, SAVE_KEY, serialize } from "./engine/save";
import { createInitialState, SCHEMA_VERSION } from "./engine/state";
import { stepHooks } from "./engine/step";
import { onUiFx, type UiFx } from "./fx";
import { useGame } from "./store";
import type { GameState } from "./types";

/** In-memory localStorage that records writes. */
function memoryStorage(init: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(init));
  const writes: string[] = [];
  return {
    map,
    writes,
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      writes.push(k);
      map.set(k, String(v));
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
}

function savedGame(seed = 7, rats = 42): GameState {
  const s = createInitialState(seed, Date.now() - 1000);
  s.rats = rats;
  s.flags.vagrants = true;
  s.jobs.forager = rats;
  return s;
}

/** Fresh store session over the given storage (node: no window, so no tab lock). */
function boot(storage: ReturnType<typeof memoryStorage>) {
  vi.stubGlobal("localStorage", storage);
  useGame.setState({ ready: false, crashed: false, crashError: null, saveIssue: null, offlineReport: null });
  useGame.getState().init();
  return useGame.getState();
}

beforeEach(() => {
  stepHooks.before = null;
});

afterEach(() => {
  stepHooks.before = null;
  vi.unstubAllGlobals();
});

describe("store: corrupt and newer saves (EN-8)", () => {
  it("a corrupt save is quarantined and never overwritten until the player decides", () => {
    const raw = serialize(savedGame()).slice(0, 500); // truncated mid-JSON
    const ls = memoryStorage({ [SAVE_KEY]: raw });
    const st = boot(ls);
    expect(st.ready).toBe(true);
    const issue = useGame.getState().saveIssue;
    expect(issue?.kind).toBe("corrupt");
    const qk = (issue as { quarantineKey: string }).quarantineKey;
    expect(qk.startsWith(`${SAVE_KEY}:corrupt:`)).toBe(true);
    expect(ls.map.get(qk)).toBe(raw);
    useGame.getState().save();
    useGame.getState().advance(10, true);
    expect(ls.map.get(SAVE_KEY)).toBe(raw);
    expect(useGame.getState().game.time).toBe(0);
    // «Начать заново» unblocks saving with a fresh colony; the quarantined copy stays
    useGame.getState().startFresh();
    expect(useGame.getState().saveIssue).toBeNull();
    expect(ls.map.get(SAVE_KEY)).not.toBe(raw);
    expect(ls.map.get(qk)).toBe(raw);
  });

  it("a newer-version save is reported and neither loaded nor overwritten", () => {
    const g = savedGame(9, 77);
    const raw = serialize({ ...g, schemaVersion: SCHEMA_VERSION + 1 });
    const ls = memoryStorage({ [SAVE_KEY]: raw });
    boot(ls);
    expect(useGame.getState().saveIssue).toEqual({ kind: "newer", version: SCHEMA_VERSION + 1 });
    expect(useGame.getState().game.rats).toBe(0); // not the stored colony
    useGame.getState().save();
    useGame.getState().startFresh();
    expect(useGame.getState().importSave(exportString(g))).toBe(false);
    expect(ls.map.get(SAVE_KEY)).toBe(raw);
    expect(ls.writes.includes(SAVE_KEY)).toBe(false);
  });

  it("a v1 save is backed up before the first v2 write", () => {
    const g = savedGame(3, 12);
    const raw = serialize({ ...g, schemaVersion: 1 });
    const ls = memoryStorage({ [SAVE_KEY]: raw });
    boot(ls);
    expect(useGame.getState().saveIssue).toBeNull();
    expect(useGame.getState().game.rats).toBe(12);
    expect(ls.map.get(`${SAVE_KEY}:bak1`)).toBe(raw);
    useGame.getState().save();
    expect(ls.writes.indexOf(`${SAVE_KEY}:bak1`)).toBeLessThan(ls.writes.indexOf(SAVE_KEY));
    expect(useGame.getState().backups()).toEqual([{ slot: 1, at: g.lastSaved, rats: 12, crownsEver: 0 }]);
  });
});

describe("store: backups (EN-8)", () => {
  it("importSave writes bak1 first; restoreBackup brings the old colony back", () => {
    const old = savedGame(1, 30);
    const ls = memoryStorage({ [SAVE_KEY]: serialize(old) });
    boot(ls);
    useGame.getState().save();
    const before = ls.map.get(SAVE_KEY)!;
    const other = savedGame(2, 99);
    ls.writes.length = 0;
    expect(useGame.getState().importSave(exportString(other))).toBe(true);
    expect(ls.writes[0]).toBe(`${SAVE_KEY}:bak1`);
    expect(ls.map.get(`${SAVE_KEY}:bak1`)).toBe(before);
    expect(useGame.getState().game.rats).toBe(99);
    expect(useGame.getState().backups()[0]).toMatchObject({ slot: 1, rats: 30 });
    // the raw save file round-trips too
    expect(useGame.getState().importSaveFile(useGame.getState().rawSave()!)).toBe(true);
    expect(useGame.getState().game.rats).toBe(99);
    expect(useGame.getState().backups().map((b) => b.slot)).toEqual([1, 2]);
    expect(useGame.getState().restoreBackup(2)).toBe(true);
    expect(useGame.getState().game.rats).toBe(30);
  });

  it("hardReset keeps the old colony as a backup", () => {
    const ls = memoryStorage({ [SAVE_KEY]: serialize(savedGame(4, 55)) });
    boot(ls);
    useGame.getState().hardReset();
    expect(useGame.getState().game.rats).toBe(0);
    expect(useGame.getState().backups()[0].rats).toBe(55);
  });

  it("a corrupt save never pushes a good backup out", () => {
    const good = serialize(savedGame(5, 10));
    const ls = memoryStorage({ [SAVE_KEY]: "{oops", [`${SAVE_KEY}:bak1`]: good, [`${SAVE_KEY}:bakmeta`]: JSON.stringify({ 1: { at: 1, rats: 10, crownsEver: 0 } }) });
    boot(ls);
    expect(useGame.getState().saveIssue?.kind).toBe("corrupt");
    expect(useGame.getState().restoreBackup(1)).toBe(true);
    expect(useGame.getState().saveIssue).toBeNull();
    expect(useGame.getState().game.rats).toBe(10);
    expect(ls.map.get(`${SAVE_KEY}:bak1`)).toBe(good);
  });
});

describe("store: crashes (EN-8)", () => {
  it("a throw inside step sets crashed, publishes nothing and stops save()", () => {
    const ls = memoryStorage({ [SAVE_KEY]: serialize(savedGame(6, 20)) });
    boot(ls);
    useGame.getState().save();
    const game = useGame.getState().game;
    stepHooks.before = () => {
      throw new Error("крыса перегрызла провод");
    };
    useGame.getState().advance(3, true);
    expect(useGame.getState().crashed).toBe(true);
    expect(useGame.getState().crashError).toBe("крыса перегрызла провод");
    expect(useGame.getState().game).toBe(game);
    ls.writes.length = 0;
    useGame.getState().save();
    useGame.getState().click();
    useGame.getState().catchUp(120);
    expect(ls.writes).toEqual([]);
    expect(useGame.getState().game).toBe(game);
    stepHooks.before = null;
    useGame.getState().resetCrash();
    expect(useGame.getState().crashed).toBe(false);
    expect(useGame.getState().game.rats).toBe(20);
    useGame.getState().advance(1, true);
    expect(useGame.getState().game.time).toBeGreaterThan(0);
    // a throw in a player action is caught the same way
    const broken = { ...useGame.getState().game, clickWindow: null as unknown as number[] };
    useGame.setState({ game: broken });
    useGame.getState().click();
    expect(useGame.getState().crashed).toBe(true);
    expect(useGame.getState().game).toBe(broken);
  });

  it("a failing offline catch-up loads the save without the report and says so", () => {
    const g = savedGame(8, 25);
    g.lastSaved = Date.now() - 3600_000;
    const raw = serialize(g);
    const ls = memoryStorage({ [SAVE_KEY]: raw });
    stepHooks.before = () => {
      throw new Error("offline");
    };
    const ui: UiFx[] = [];
    const off = onUiFx((f) => ui.push(f));
    boot(ls);
    stepHooks.before = null;
    expect(useGame.getState().crashed).toBe(false);
    expect(useGame.getState().offlineReport).toBeNull();
    expect(useGame.getState().game.rats).toBe(25);
    expect(useGame.getState().game.time).toBe(g.time);
    expect(ui).toEqual([]);
    useGame.getState().flushInitFx();
    expect(ui.some((f) => f.k === "toast" && f.text.startsWith("Отчёт об отлучке потерян"))).toBe(true);
    off();
  });
});

describe("store: UI state (EN-7)", () => {
  it("sheet, focus and applyHint", async () => {
    const ls = memoryStorage();
    boot(ls);
    expect(useGame.getState().sheet).toBe("half");
    useGame.getState().toggleSheet();
    expect(useGame.getState().sheet).toBe("full");
    useGame.getState().setSheet("half");
    expect(useGame.getState().sheet).toBe("half");

    const ui: UiFx[] = [];
    const off = onUiFx((f) => ui.push(f));
    useGame.getState().focus("jobs", "j_pickpocket");
    expect(useGame.getState().tab).toBe("jobs");
    expect(ui).toEqual([]); // waits a frame for the tab to render
    await new Promise((r) => setTimeout(r, 150));
    expect(ui).toEqual([{ k: "focus", tab: "jobs", target: "j_pickpocket" }]);

    const s = useGame.getState().game;
    const g = structuredClone(s);
    g.flags.vagrants = true;
    g.rats = 10;
    g.jobs.forager = 10;
    g.resEver.coins = 1;
    useGame.setState({ game: g });
    useGame.getState().applyHint({ id: "idle_job:pickpocket", icon: "🎩", text: "", why: "", tab: "jobs", target: "j_pickpocket", action: { kind: "assign", job: "pickpocket", n: 3 } });
    expect(useGame.getState().game.jobs.pickpocket).toBe(3);
    await new Promise((r) => setTimeout(r, 150));
    expect(ui.filter((f) => f.k === "focus")).toHaveLength(2);
    off();
  });

  it("a first visit seeds reducedMotion from the OS; picking it by hand clears «как в системе»", () => {
    vi.stubGlobal("window", { location: { search: "" }, matchMedia: (q: string) => ({ matches: q.includes("reduce") }) });
    vi.stubGlobal("navigator", {}); // no Web Locks: play without the tab lock
    const ls = memoryStorage();
    boot(ls);
    expect(useGame.getState().game.settings.reducedMotion).toBe(true);
    expect(useGame.getState().game.settings.reducedMotionFromOS).toBe(true);
    useGame.getState().setSetting("reducedMotion", false);
    expect(useGame.getState().game.settings.reducedMotionFromOS).toBe(false);
  });
});

/* ------------------------------------------------------------ two tabs (fake Web Locks + BroadcastChannel) */

function fakeLocks() {
  const held = new Map<string, boolean>();
  const queue = new Map<string, (() => void)[]>();
  type Cb = (lock: { name: string } | null) => unknown;
  return {
    request(name: string, a: { ifAvailable?: boolean } | Cb, b?: Cb): Promise<unknown> {
      const opts = typeof a === "function" ? {} : a;
      const cb = (typeof a === "function" ? a : b)!;
      return new Promise((resolve, reject) => {
        const run = () => {
          held.set(name, true);
          Promise.resolve()
            .then(() => cb({ name }))
            .then((v) => {
              held.set(name, false);
              queue.get(name)?.shift()?.();
              resolve(v);
            }, reject);
        };
        if (!held.get(name)) run();
        else if (opts.ifAvailable) Promise.resolve().then(() => cb(null)).then(resolve, reject);
        else {
          if (!queue.has(name)) queue.set(name, []);
          queue.get(name)!.push(run);
        }
      });
    },
  };
}

const channels = new Set<FakeChannel>();
class FakeChannel {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  constructor(public name: string) {
    channels.add(this);
  }
  postMessage(data: unknown) {
    for (const c of channels) if (c !== this && c.name === this.name) queueMicrotask(() => c.onmessage?.({ data }));
  }
  close() {
    channels.delete(this);
  }
}

const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};

describe("store: one colony, one tab (EN-8)", () => {
  it("only the lock holder ticks and saves; «Играть здесь» moves play to the other tab", async () => {
    const ls = memoryStorage({ [`${SAVE_KEY}:t`]: serialize(savedGame(11, 33)) });
    vi.stubGlobal("localStorage", ls);
    vi.stubGlobal("window", { location: { search: "?slot=t" } });
    vi.stubGlobal("navigator", { locks: fakeLocks() });
    vi.stubGlobal("BroadcastChannel", FakeChannel);
    const g = globalThis as { __rrLock?: unknown };

    vi.resetModules();
    const A = (await import("./store")).useGame;
    A.getState().init();
    await flush();
    delete g.__rrLock; // a real second tab has its own globalThis
    vi.resetModules();
    const B = (await import("./store")).useGame;
    B.getState().init();
    await flush();

    expect(A.getState().saveIssue).toBeNull();
    expect(B.getState().saveIssue).toEqual({ kind: "locked" });
    A.getState().advance(20, true);
    B.getState().advance(20, true);
    expect(A.getState().game.time).toBeCloseTo(2, 9);
    expect(B.getState().game.time).toBe(0);
    ls.writes.length = 0;
    B.getState().save();
    expect(ls.writes).toEqual([]);

    B.getState().takeOverTab();
    await flush();
    expect(A.getState().saveIssue).toEqual({ kind: "locked" });
    expect(B.getState().saveIssue).toBeNull();
    expect(B.getState().game.time).toBeCloseTo(2, 9); // continues from A's last save
    expect(B.getState().game.rats).toBe(33);
    A.getState().advance(20, true);
    B.getState().advance(20, true);
    expect(A.getState().game.time).toBeCloseTo(2, 9);
    expect(B.getState().game.time).toBeCloseTo(4, 9);
    for (const c of [...channels]) c.close();
    delete g.__rrLock;
  });
});
