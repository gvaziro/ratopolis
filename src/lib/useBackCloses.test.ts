import { describe, expect, it, vi } from "vitest";
import { createBackCloser } from "./useBackCloses";

/**
 * A browser-like history: pushState drops the forward entries and makes a new key; replaceState keeps the entry's key
 * (the Navigation API's currentEntry.key); back()/go() traverse asynchronously (flush) and fire one popstate, or none
 * when the target is out of range. `nav: false`: a browser without the Navigation API.
 */
function mockEnv(nav: boolean) {
  const entries: { state: unknown; key: string }[] = [{ state: { page: true }, key: "k0" }];
  let index = 0;
  let keys = 0;
  const listeners = new Set<() => void>();
  const pending: (() => void)[] = [];
  const history = {
    get state() {
      return entries[index].state;
    },
    get length() {
      return entries.length;
    },
    pushState(data: unknown) {
      entries.splice(index + 1);
      entries.push({ state: data, key: `k${++keys}` });
      index = entries.length - 1;
    },
    replaceState(data: unknown) {
      entries[index] = { state: data, key: entries[index].key };
    },
    back() {
      history.go(-1);
    },
    go(delta: number) {
      pending.push(() => {
        const to = index + delta;
        if (delta === 0 || to < 0 || to >= entries.length) return;
        index = to;
        for (const fn of [...listeners]) fn();
      });
    },
  };
  const env = {
    history,
    navigation: nav
      ? {
          get currentEntry() {
            return { key: entries[index].key };
          },
        }
      : undefined,
    addEventListener: (_t: "popstate", fn: () => void) => {
      listeners.add(fn);
    },
    removeEventListener: (_t: "popstate", fn: () => void) => {
      listeners.delete(fn);
    },
    /** Run the traversals asked for, in order (including ones asked for meanwhile). */
    flush() {
      while (pending.length) pending.shift()!();
    },
    /** Traversals asked for and not run yet. */
    inFlight: () => pending.length,
    /** The player's Back gesture. */
    userBack() {
      history.go(-1);
      env.flush();
    },
    /** Next's HistoryUpdater after a soft navigation or (dev) an HMR refresh: the current entry's state without ours. */
    nextRewrite() {
      history.replaceState({ __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: {} });
    },
    position: () => index,
    listeners: () => listeners.size,
  };
  return env;
}

describe.each([
  ["with the Navigation API", true],
  ["marker only (no Navigation API)", false],
])("useBackCloses (v3 ENG-12, SHL-4), %s", (_name, nav) => {
  it("open/close from the UI ten times never grows history", () => {
    const env = mockEnv(nav);
    const ctl = createBackCloser(env);
    const close = vi.fn();
    const t1 = ctl.open(close);
    ctl.release(t1);
    env.flush();
    const after1 = env.history.length;
    for (let i = 0; i < 10; i++) {
      const t = ctl.open(close);
      expect(env.history.state).toMatchObject({ rr: "ov" });
      ctl.release(t);
      env.flush();
    }
    expect(env.history.length).toBe(after1);
    expect(env.history.state).toEqual({ page: true });
    expect(close).not.toHaveBeenCalled(); // our own back() is not a Back press
    expect(ctl.depth()).toBe(0);
    expect(env.listeners()).toBe(0);
  });

  it("the system Back closes the topmost overlay only, and release afterwards is a no-op", () => {
    const env = mockEnv(nav);
    const ctl = createBackCloser(env);
    const closeA = vi.fn();
    const closeB = vi.fn();
    const a = ctl.open(closeA);
    const b = ctl.open(closeB);
    env.userBack();
    expect(closeB).toHaveBeenCalledTimes(1);
    expect(closeA).not.toHaveBeenCalled();
    ctl.release(b); // the overlay unmounts after its close(): no second back()
    env.flush();
    expect(env.history.state).toMatchObject({ rr: "ov", token: a });
    env.userBack();
    expect(closeA).toHaveBeenCalledTimes(1);
    ctl.release(a);
    env.flush();
    expect(env.history.state).toEqual({ page: true });
    expect(env.listeners()).toBe(0);
  });

  it("does not go back when the top entry is not ours", () => {
    const env = mockEnv(nav);
    const ctl = createBackCloser(env);
    const t = ctl.open(() => {});
    env.history.pushState({ other: true }); // something else pushed on top (a router)
    const back = vi.spyOn(env.history, "back");
    const go = vi.spyOn(env.history, "go");
    ctl.release(t);
    expect(back).not.toHaveBeenCalled();
    expect(go).not.toHaveBeenCalled();
  });

  it("an overlay closed under another leaves no dead entry: both go with the top one, in one traversal", () => {
    const env = mockEnv(nav);
    const ctl = createBackCloser(env);
    const go = vi.spyOn(env.history, "go");
    const a = ctl.open(() => {});
    const b = ctl.open(() => {});
    ctl.release(a);
    expect(go).not.toHaveBeenCalled(); // its entry sits under B's
    expect(ctl.depth()).toBe(1);
    ctl.release(b);
    expect(go.mock.calls).toEqual([[-2]]);
    env.flush();
    expect(env.history.state).toEqual({ page: true });
    expect(env.position()).toBe(0);
    expect(ctl.depth()).toBe(0);
    expect(env.listeners()).toBe(0);
  });

  it("the system Back over a dead entry closes the top overlay only and skips the dead one", () => {
    const env = mockEnv(nav);
    const ctl = createBackCloser(env);
    const closeA = vi.fn();
    const closeB = vi.fn();
    const a = ctl.open(closeA);
    const b = ctl.open(closeB);
    ctl.release(a);
    env.userBack();
    expect(closeB).toHaveBeenCalledTimes(1);
    expect(closeA).not.toHaveBeenCalled();
    expect(env.history.state).toEqual({ page: true });
    expect(env.position()).toBe(0);
    ctl.release(b);
    ctl.release(a);
    env.flush();
    expect(env.position()).toBe(0);
    expect(env.listeners()).toBe(0);
  });

  it("three deep, the middle one released, then the top: lands on the bottom one's entry, whose Back still closes it", () => {
    const env = mockEnv(nav);
    const ctl = createBackCloser(env);
    const closeA = vi.fn();
    const a = ctl.open(closeA);
    const b = ctl.open(() => {});
    const c = ctl.open(() => {});
    ctl.release(b);
    ctl.release(c);
    env.flush();
    expect(env.history.state).toMatchObject({ rr: "ov", token: a });
    expect(ctl.depth()).toBe(1);
    env.userBack();
    expect(closeA).toHaveBeenCalledTimes(1);
    expect(env.history.state).toEqual({ page: true });
  });

  it("closing one overlay and opening the next in the same tick (and StrictMode's open, release, open): the push waits for our back()", () => {
    const env = mockEnv(nav);
    const ctl = createBackCloser(env);
    const push = vi.spyOn(env.history, "pushState");
    const a = ctl.open(() => {});
    ctl.release(a);
    const closeB = vi.fn();
    const b = ctl.open(closeB);
    expect(push).toHaveBeenCalledTimes(1); // A's only: B's waits for the back() in flight
    env.flush();
    expect(push).toHaveBeenCalledTimes(2);
    expect(env.history.state).toMatchObject({ rr: "ov", token: b });
    expect(env.position()).toBe(1);
    expect(env.history.length).toBe(2);
    env.userBack();
    expect(closeB).toHaveBeenCalledTimes(1);
    expect(env.history.state).toEqual({ page: true });
  });

  it("a release while our back() is in flight is owed: never a second traversal racing it", () => {
    const env = mockEnv(nav);
    const ctl = createBackCloser(env);
    const a = ctl.open(() => {});
    const b = ctl.open(() => {});
    ctl.release(b);
    ctl.release(a);
    expect(env.inFlight()).toBe(1);
    env.flush();
    expect(env.history.state).toEqual({ page: true });
    expect(env.position()).toBe(0);
    expect(env.listeners()).toBe(0);
  });

  it("an overlay released before its push never reaches history", () => {
    const env = mockEnv(nav);
    const ctl = createBackCloser(env);
    const push = vi.spyOn(env.history, "pushState");
    const a = ctl.open(() => {});
    ctl.release(a);
    const b = ctl.open(() => {});
    ctl.release(b);
    env.flush();
    expect(push).toHaveBeenCalledTimes(1);
    expect(env.history.state).toEqual({ page: true });
    expect(ctl.depth()).toBe(0);
    expect(env.listeners()).toBe(0);
  });

  it("a refused push (Safari's 100 per 30 s) leaves the overlay without an entry instead of throwing", () => {
    const env = mockEnv(nav);
    const ctl = createBackCloser(env);
    vi.spyOn(env.history, "pushState").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    const t = ctl.open(() => {});
    expect(ctl.depth()).toBe(0);
    expect(env.listeners()).toBe(0);
    expect(() => ctl.release(t)).not.toThrow();
  });
});

describe("useBackCloses and Next's history rewrite (v3 SHL-4)", () => {
  it("with the Navigation API the entry is still ours after Next rewrote its state: the UI close goes back over it", () => {
    const env = mockEnv(true);
    const ctl = createBackCloser(env);
    const t = ctl.open(() => {});
    env.nextRewrite();
    expect(env.history.state).not.toMatchObject({ rr: "ov" });
    ctl.release(t);
    env.flush();
    expect(env.history.state).toEqual({ page: true });
    expect(env.position()).toBe(0);
  });

  it("without it a rewritten entry is left alone: never a back() over an entry that may not be ours", () => {
    const env = mockEnv(false);
    const ctl = createBackCloser(env);
    const t = ctl.open(() => {});
    env.nextRewrite();
    ctl.release(t);
    expect(env.inFlight()).toBe(0);
    expect(env.listeners()).toBe(0);
  });

  it("the key decides over the state: a new entry on top is not ours even when it carries our marker", () => {
    const env = mockEnv(true);
    const ctl = createBackCloser(env);
    const t = ctl.open(() => {});
    env.history.pushState({ ...(env.history.state as object) });
    ctl.release(t);
    expect(env.inFlight()).toBe(0);
  });

  it("the system Back still closes the topmost overlay after the rewrite", () => {
    const env = mockEnv(true);
    const ctl = createBackCloser(env);
    const closeA = vi.fn();
    const closeB = vi.fn();
    const a = ctl.open(closeA);
    const b = ctl.open(closeB);
    env.nextRewrite();
    env.userBack();
    expect(closeB).toHaveBeenCalledTimes(1);
    ctl.release(b);
    ctl.release(a);
    env.flush();
    expect(closeA).not.toHaveBeenCalled();
    expect(env.history.state).toEqual({ page: true });
  });
});
