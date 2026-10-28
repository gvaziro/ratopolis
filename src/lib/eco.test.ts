import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cancelDecoFrame, decoFrame, ECO_FRAME_MS, ecoActive, resolveEco, setEco } from "./eco";

// a 60 Hz display: fake timers drive requestAnimationFrame every 16 ms, and timers in between
beforeEach(() => {
  // node has no frame requests: stub them so the fake timers have something to replace
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  vi.stubGlobal("window", globalThis);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame", "performance"] });
});

afterEach(() => {
  setEco(false);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** A decorative loop that re-arms itself every frame; returns the frame times it drew. */
function loop(): number[] {
  const drawn: number[] = [];
  const tick = (t: number) => {
    drawn.push(t);
    decoFrame(tick);
  };
  decoFrame(tick);
  return drawn;
}

/** Counts the frame requests the page makes (a request is a frame the browser has to produce). */
function countRequests(): { n: number } {
  const c = { n: 0 };
  const raf = globalThis.requestAnimationFrame;
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => {
    c.n++;
    return raf(fn);
  });
  return c;
}

describe("decoFrame («Экономия батареи»)", () => {
  it("is plain requestAnimationFrame while eco is off", () => {
    const drawn = loop();
    vi.advanceTimersByTime(1000);
    expect(drawn.length).toBeGreaterThanOrEqual(59);
  });

  it("draws about 20 times a second while eco is on, once per slot", () => {
    setEco(true);
    const drawn = loop();
    vi.advanceTimersByTime(1000);
    expect(drawn.length).toBeGreaterThanOrEqual(18);
    expect(drawn.length).toBeLessThanOrEqual(21);
    const slots = drawn.map((t) => Math.floor(t / ECO_FRAME_MS));
    expect(new Set(slots).size).toBe(slots.length);
  });

  it("different loops draw in the same frames (one shared clock)", () => {
    setEco(true);
    const a = loop();
    vi.advanceTimersByTime(23); // the second loop starts out of phase
    const b = loop();
    vi.advanceTimersByTime(1000);
    const late = new Set(b.slice(1));
    expect(a.filter((t) => late.has(t)).length).toBeGreaterThanOrEqual(b.length - 2);
  });

  it("sleeps between its frames: no frame request on the frames it skips", () => {
    setEco(true);
    const c = countRequests();
    loop();
    vi.advanceTimersByTime(1000);
    expect(c.n).toBeLessThanOrEqual(30); // ~20 draws + a woken-early request now and then, not 60
  });

  it("cancelDecoFrame stops a loop while it sleeps", () => {
    setEco(true);
    let n = 0;
    let h = 0;
    const tick = () => {
      n++;
      h = decoFrame(tick);
    };
    h = decoFrame(tick);
    vi.advanceTimersByTime(20); // one draw, now asleep
    const before = n;
    cancelDecoFrame(h);
    vi.advanceTimersByTime(500);
    expect(n).toBe(before);
  });

  it("auto is on for a coarse pointer only; on/off are forced", () => {
    expect(resolveEco("auto", true)).toBe(true);
    expect(resolveEco("auto", false)).toBe(false);
    expect(resolveEco("on", false)).toBe(true);
    expect(resolveEco("off", true)).toBe(false);
    expect(resolveEco(undefined, true)).toBe(true);
    setEco(true);
    expect(ecoActive()).toBe(true);
  });
});
