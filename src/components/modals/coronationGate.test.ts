import { afterEach, describe, expect, it } from "vitest";
import { openZone } from "@/game/engine/actions";
import { onZoneOpen } from "@/game/engine/events";
import { createInitialState } from "@/game/engine/state";
import { step, TICK } from "@/game/engine/step";
import { emitFx } from "@/game/fx";
import { useGame } from "@/game/store";
import type { OfflineReport } from "@/game/engine/offline";
import type { EngineCtx, GameState } from "@/game/types";
import { bellsOf, coronationWaits, shortCoronation, watchCoronation } from "./coronationGate";

/** A colony with a metro train scene running (rumble phase). */
function withTrain(): GameState {
  const s = createInitialState(11, 0);
  const ctx: EngineCtx = { fx: [] };
  for (const z of ["sewers", "cellars", "metro"] as const) {
    openZone(s, z, ctx);
    onZoneOpen(s, z);
  }
  s.timers.carriage = Infinity;
  s.timers.metro_train = s.time;
  step(s, TICK, { active: false }, ctx);
  return s;
}

/** The overlay's side of the gate: the show opens and holds the clock. */
function watch(log: boolean[]) {
  return watchCoronation((late) => {
    log.push(late);
    useGame.getState().setCeremony(true);
  });
}

let stop: (() => void) | null = null;
afterEach(() => {
  stop?.();
  stop = null;
  // the ceremonies are counted: close every one a test opened
  while (useGame.getState().ceremony) useGame.getState().setCeremony(false);
  useGame.setState({ offlineReport: null });
});

describe("coronation gate (SHL-2)", () => {
  it("a coronation during a scene does not hold the clock until the scene (haul card included) is over", () => {
    const s = withTrain();
    expect(s.scene?.id).toBe("metro_train");
    useGame.setState({ game: s, ready: true, offlineReport: null });
    const log: boolean[] = [];
    stop = watch(log);

    emitFx([{ k: "coronation" }]);
    expect(log).toEqual([]);
    expect(useGame.getState().ceremony).toBe(false);

    // the train goes on through its phases, the haul card last: still waiting
    useGame.setState({ game: { ...s, scene: { ...s.scene!, phase: "haul" } } });
    expect(log).toEqual([]);
    expect(useGame.getState().ceremony).toBe(false);

    // the first sample without the scene opens the show, once (the bells ring again: `late`)
    useGame.setState({ game: { ...s, scene: null } });
    expect(log).toEqual([true]);
    expect(useGame.getState().ceremony).toBe(true);
    useGame.setState({ game: { ...s, scene: null, time: s.time + 1 } });
    expect(log).toEqual([true]);
  });

  it("opens at once when nothing holds it", () => {
    useGame.setState({ game: { ...withTrain(), scene: null }, ready: true, offlineReport: null });
    const log: boolean[] = [];
    stop = watch(log);
    emitFx([{ k: "coronation" }]);
    expect(log).toEqual([false]);
    expect(useGame.getState().ceremony).toBe(true);
  });

  it("waits for both the offline report and a scene, whichever clears last", () => {
    const s = withTrain();
    const report = { coronated: true, elapsed: 3600 } as unknown as OfflineReport;
    useGame.setState({ game: s, ready: true, offlineReport: report });
    const log: boolean[] = [];
    stop = watch(log);
    emitFx([{ k: "coronation" }]);
    useGame.setState({ offlineReport: null });
    expect(log).toEqual([]);
    useGame.setState({ game: { ...s, scene: null } });
    expect(log).toEqual([true]);
  });

  it("knows what waits and which coronations are short", () => {
    expect(coronationWaits({ offlineReport: null, game: { scene: null } })).toBe(false);
    expect(coronationWaits({ offlineReport: null, game: { scene: withTrain().scene } })).toBe(true);
    expect(shortCoronation(1)).toBe(false);
    expect(shortCoronation(2)).toBe(false);
    expect(shortCoronation(3)).toBe(true);
    expect(shortCoronation(1, "?slot=a&coronation=repeat")).toBe(true);
    expect(shortCoronation(1, "?coronation")).toBe(false);
    // the short form rings three bells, the whole ride twelve (the audio side follows the count)
    expect(bellsOf(2)).toBe(12);
    expect(bellsOf(3)).toBe(3);
    expect(bellsOf(1, "?coronation=repeat")).toBe(3);
  });
});
