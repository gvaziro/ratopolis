import type { Amounts, EngineCtx, GameState } from "../types";
import { RES_IDS } from "../types";
import { gainAll } from "./core";
import { derive } from "./derive";
import { offlineTrains, rescheduleAfterAbsence, sceneAction, sweepShiny } from "./events";
import { step } from "./step";

export interface OfflineReport {
  elapsed: number; // real seconds away
  simulated: number; // seconds simulated (capped)
  eta: number;
  gained: Amounts; // net change per resource
  rats: number; // rats gained
  trains: number;
  trainLoot: Amounts;
  /** The coronation happened during the absence («Автовзнос» finished express stage 10). */
  coronated: boolean;
}

/** Wrap up any half-finished scene by auto-collect (used before offline catch-up and on load). */
export function abortScene(s: GameState, ctx: EngineCtx): void {
  if (!s.scene) return;
  const d = derive(s);
  sceneAction(s, d, { a: "detach" }, ctx);
  sceneAction(s, d, { a: "skip" }, ctx);
  if (s.scene) sceneAction(s, d, { a: "dismiss" }, ctx);
  s.scene = null;
}

/**
 * Catch up `elapsedSec` of absence: K <= 600 coarse steps of the same `step()` with production x eta,
 * no events, no suspicion; then trains/capsules by auto-collect.
 */
export function simulateOffline(s: GameState, elapsedSec: number, ctx: EngineCtx): OfflineReport | null {
  if (!(elapsedSec > 5)) return null;
  abortScene(s, ctx);
  s.purse = null;
  // grate rain still on the floor is swept up as it would have expired (ENG-9: 25% of each carriage shiny)
  if (s.shinies.length) {
    const d = derive(s);
    for (const sh of s.shinies) sweepShiny(s, d, sh);
  }
  s.shinies = [];
  s.carriagePass = null;
  s.market = null;
  const d0 = derive(s);
  const t = Math.min(elapsedSec, d0.offline.capSec);
  const eta = d0.offline.eta;
  const before = { ...s.res };
  const ratsBefore = s.rats;
  const crownedBefore = s.coronatedThisRun;
  const K = Math.min(600, Math.max(1, Math.ceil(t / 10)));
  const dt = t / K;
  const sink: EngineCtx = { fx: [] };
  for (let i = 0; i < K; i++) step(s, dt, { active: false, offline: { eta } }, sink);
  const d1 = derive(s);
  const tr = offlineTrains(s, d1, t, eta);
  const trainLoot = gainAll(s, d1, tr.loot, true, sink);
  rescheduleAfterAbsence(s);
  if (tr.count > 0) {
    s.stats.trains += 0; // offline trains don't count towards "survived" milestones
  }
  const gained: Amounts = {};
  for (const r of RES_IDS) {
    const diff = s.res[r] - before[r];
    if (Math.abs(diff) > 1e-9) gained[r] = diff;
  }
  // keep a few headlines from the absence (the coronation opens its overlay)
  for (const fx of sink.fx) if (fx.k === "medal" || fx.k === "zoneOpen" || fx.k === "coronation") ctx.fx.push(fx);
  return {
    elapsed: elapsedSec,
    simulated: t,
    eta,
    gained,
    rats: s.rats - ratsBefore,
    trains: tr.count,
    trainLoot,
    coronated: !crownedBefore && s.coronatedThisRun,
  };
}
