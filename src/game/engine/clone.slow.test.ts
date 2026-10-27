import { describe, expect, it } from "vitest";
import { Bot } from "../../../scripts/sim-core";
import type { EngineCtx, GameState, SceneEventId } from "../types";
import { openZone } from "./actions";
import { cloneState } from "./clone";
import { onZoneOpen } from "./events";
import { createInitialState } from "./state";
import { step, TICK } from "./step";
import { assertPlain, loadFixture, tourScenes } from "./testkit";

/** The store's plain clone over long play (v3 ENG-6 acceptance 2); the fast checks are in clone.test.ts. */
describe("cloneState over long play (slow)", () => {
  it("equals structuredClone and stays plain data on every 600th tick of a 3 h active run", () => {
    const s = createInitialState(12345, 0);
    const bot = new Bot("active", 12345);
    const ctx: EngineCtx = { fx: [] };
    let checks = 0;
    for (let i = 0; i < (3 * 3600) / TICK; i++) {
      const d = step(s, TICK, { active: true }, ctx);
      bot.tick(s, ctx, d);
      ctx.fx.length = 0;
      if (i % 600 === 0) {
        assertPlain(s);
        expect(cloneState(s)).toEqual(structuredClone(s));
        checks++;
      }
    }
    expect(checks).toBe(180);
  }, 300_000);

  it("step() on a clone never writes to the original: 30 min of play through every kind of scene (frozen original)", async () => {
    // a capsule needs the Sewers before the Metro
    const early = createInitialState(4, 0);
    openZone(early, "sewers", { fx: [] });
    onZoneOpen(early, "sewers");
    early.flags.vagrants = true;
    early.rats = 30;
    early.jobs.forager = 30;
    const first = await tourScenes(early, ["capsule", "carriage", "downpour"], 600);
    expect([...first.seen].sort()).toEqual(["capsule", "carriage", "downpour"]);

    const all: (SceneEventId | "purse" | "market")[] = ["metro_train", "carriage", "cat", "ratcatcher", "downpour", "royal_express", "purse", "market"];
    let s: GameState = loadFixture("v3-run1-150min");
    const t0 = s.time;
    const seen = new Set<SceneEventId>();
    while (s.time - t0 < 30 * 60) {
      const lap = await tourScenes(s, all, 600);
      for (const id of lap.seen) seen.add(id);
      s = lap.end;
    }
    // after the Metro the carriage is grate rain (ENG-9): no close-up, its shinies go through the clone instead
    expect([...seen].sort()).toEqual(["cat", "downpour", "metro_train", "ratcatcher", "royal_express"]);
  }, 300_000);
});
