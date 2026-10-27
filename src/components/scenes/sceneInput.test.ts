import { describe, expect, it } from "vitest";
import { catchingPaws, catchKey, isControlTarget, isModalityKey, isThrowKey, isTypingTarget, MAX_PAWS, pilesKey, rumbleKey, type PawLike } from "./sceneInput";

const el = (tagName: string, attrs: Record<string, string> = {}) => ({ tagName, getAttribute: (n: string) => attrs[n] ?? null });

describe("«две лапы»: the catch canvas pointer gate (SCN-5)", () => {
  it("4 held touches on the rail: only the two oldest catch", () => {
    const touches: [number, PawLike][] = [
      [11, { armed: true, seq: 1 }],
      [12, { armed: true, seq: 2 }],
      [13, { armed: true, seq: 3 }],
      [14, { armed: true, seq: 4 }],
    ];
    expect(MAX_PAWS).toBe(2);
    expect([...catchingPaws(touches)].sort()).toEqual([11, 12]);
  });

  it("goes by press order, not by map order", () => {
    const m = new Map<number, PawLike>([
      [5, { armed: true, seq: 9 }],
      [6, { armed: true, seq: 3 }],
      [7, { armed: true, seq: 4 }],
    ]);
    expect([...catchingPaws(m)].sort()).toEqual([6, 7]);
  });

  it("a lifted paw hands its place to the next finger", () => {
    const m = new Map<number, PawLike>([
      [1, { armed: true, seq: 1 }],
      [2, { armed: true, seq: 2 }],
      [3, { armed: true, seq: 3 }],
    ]);
    m.delete(1);
    expect([...catchingPaws(m)].sort()).toEqual([2, 3]);
  });

  it("unarmed pointers (over the tap limit, not moved yet) never take a paw", () => {
    const m = new Map<number, PawLike>([
      [1, { armed: false, seq: 1 }],
      [2, { armed: true, seq: 2 }],
      [3, { armed: true, seq: 3 }],
      [4, { armed: true, seq: 4 }],
    ]);
    expect([...catchingPaws(m)].sort()).toEqual([2, 3]);
  });

  it("the keyboard paw counts like any pointer", () => {
    const m = new Map<number, PawLike>([
      [-7, { armed: true, seq: 1 }],
      [1, { armed: true, seq: 2 }],
      [2, { armed: true, seq: 3 }],
    ]);
    expect([...catchingPaws(m)].sort((a, b) => a - b)).toEqual([-7, 1]);
  });
});

describe("scene key maps (SCN-5)", () => {
  it("modality: Tab, Enter, Space and arrows are keyboard play, letters are not", () => {
    for (const k of ["Tab", "Enter", " ", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]) expect(isModalityKey(k)).toBe(true);
    for (const k of ["a", "1", "Shift", "Escape"]) expect(isModalityKey(k)).toBe(false);
  });

  it("rumble: Enter / Space — «По местам!», 1/2/3 — positions, R or К — the nets", () => {
    expect(rumbleKey("Enter", false)).toEqual({ k: "ready" });
    expect(rumbleKey(" ", false)).toEqual({ k: "ready" });
    expect(rumbleKey("1", false)).toEqual({ k: "position", pos: "wall" });
    expect(rumbleKey("2", true)).toEqual({ k: "position", pos: "rails" });
    expect(rumbleKey("3", false)).toEqual({ k: "position", pos: "ties" });
    expect(rumbleKey("4", false)).toBeNull();
    for (const k of ["r", "R", "к", "К"]) expect(rumbleKey(k, false)).toEqual({ k: "repeat" });
    expect(rumbleKey("x", false)).toBeNull();
  });

  it("rumble: Enter / Space on a focused button is that button's own click, not «По местам!»", () => {
    expect(rumbleKey("Enter", true)).toBeNull();
    expect(rumbleKey(" ", true)).toBeNull();
  });

  it("hook: a fresh Space, Enter or ↑ throws; a held key auto-repeating into the window does not", () => {
    for (const k of [" ", "Enter", "ArrowUp"]) {
      expect(isThrowKey(k)).toBe(true);
      expect(isThrowKey(k, true)).toBe(false);
    }
    expect(isThrowKey("ArrowLeft")).toBe(false);
  });

  it("catch: ←/→ walk the paw, Space is the paw (also while the hook's bar is up)", () => {
    expect(catchKey("ArrowLeft")).toBe("left");
    expect(catchKey("ArrowRight")).toBe("right");
    expect(catchKey(" ")).toBe("paw");
    expect(catchKey("Enter")).toBeNull();
  });

  it("piles: Space digs, Enter is «Готово»", () => {
    expect(pilesKey(" ")).toBe("dig");
    expect(pilesKey("Enter")).toBe("done");
    expect(pilesKey("Tab")).toBeNull();
  });

  it("controls and fields: the hotkeys stand aside", () => {
    expect(isControlTarget(el("BUTTON"))).toBe(true);
    expect(isControlTarget(el("DIV", { role: "button" }))).toBe(true);
    expect(isControlTarget(el("CANVAS"))).toBe(false);
    expect(isControlTarget(el("BODY"))).toBe(false);
    expect(isControlTarget(null)).toBe(false);
    expect(isTypingTarget(el("INPUT"))).toBe(true);
    expect(isTypingTarget(el("INPUT", { type: "range" }))).toBe(false);
    expect(isTypingTarget(el("TEXTAREA"))).toBe(true);
    expect(isTypingTarget(el("BUTTON"))).toBe(false);
  });
});
