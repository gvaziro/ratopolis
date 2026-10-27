import { describe, expect, it } from "vitest";
import { HEADLINES } from "../data/headlines";
import type { EngineCtx, Fx } from "../types";
import { createInitialState } from "./state";
import { step, TICK } from "./step";

/** The living newspaper over a real hour (EN-10). Slow: 36 000 engine steps (moved out of v2depth.test.ts, v3 ENG-7). */
describe("living newspaper over an hour (slow)", () => {
  it("an hour of run 1 has ≥ 15 filler headlines, none repeated within 10 headlines", () => {
    const s = createInitialState(21, 0);
    const ctx: EngineCtx = { fx: [] };
    for (let i = 0; i < 36000; i++) step(s, TICK, { active: true }, ctx);
    const texts = ctx.fx.filter((f): f is Extract<Fx, { k: "news" }> => f.k === "news").map((f) => f.text);
    const fillers = new Set(Object.entries(HEADLINES).filter(([k]) => k.startsWith("filler")).flatMap(([, v]) => v));
    expect(texts.filter((t) => fillers.has(t)).length).toBeGreaterThanOrEqual(15);
    for (let i = 0; i < texts.length; i++) {
      const win = texts.slice(i, i + 10);
      expect(new Set(win).size, win.join(" | ")).toBe(win.length);
    }
  }, 120_000);
});
