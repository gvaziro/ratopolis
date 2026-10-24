import { CONVERTERS, JOBS } from "../data/jobs";
import { RESOURCES } from "../data/resources";
import { BUILDING_IDS, JOB_IDS, RES_IDS, type EngineCtx, type GameState, type ResId, type TickInput } from "../types";
import { autoContributeUncapped } from "./actions";
import { award, gain, newbornJob, news, normalizeJobs, toast } from "./core";
import { resMult, stunnedRats, type Derived } from "./derive";
import { entries } from "./formulas";
import { zeroRes } from "./state";

/**
 * Passive economy for one fixed step: producers -> converters -> steam consumers -> food -> births.
 * Mutates `s`. `dt` may be large (offline simulation); everything here is stable for big steps.
 */
export function tickEconomy(s: GameState, d: Derived, dt: number, input: TickInput, ctx: EngineCtx): void {
  const eta = input.offline?.eta ?? 1;
  const before = { ...s.res };

  // stunned rats recover
  if (s.stunned.length) s.stunned = s.stunned.filter((g) => g.until > s.time);
  const workforce = s.rats > 0 ? 1 - stunnedRats(s) / s.rats : 1;

  const gross = zeroRes(); // actual passive production per second (with temp mult)
  // for EMA (event values): the online-equivalent rate, without η — offline train loot applies η once itself
  const grossNoTemp = zeroRes();

  // ---- 1. plain producers: jobs without inputs + buildings
  const base = zeroRes();
  for (const j of JOB_IDS) {
    const def = JOBS[j];
    const n = s.jobs[j];
    if (n <= 0 || Object.keys(def.consumes).length > 0) continue;
    const k = n * d.jobSpeed[j] * d.jobYield[j] * workforce;
    for (const [r, v] of entries(def.produces)) base[r] += v * k;
  }
  for (const id of BUILDING_IDS) {
    if (s.buildings[id] <= 0) continue;
    for (const [r, v] of entries(d.buildingOut[id])) base[r] += v;
  }
  for (const r of RES_IDS) {
    if (base[r] <= 0) continue;
    const perSec = base[r] * resMult(s, d, r, true) * eta;
    gross[r] += perSec;
    grossNoTemp[r] += base[r] * resMult(s, d, r, false);
    gain(s, d, r, perSec * dt, false, ctx);
  }

  // ---- 2. converters in fixed order
  for (const j of CONVERTERS) {
    const def = JOBS[j];
    const n = s.jobs[j];
    if (n <= 0) {
      s.convEff[j] = 1;
      continue;
    }
    const rate = n * d.jobSpeed[j] * workforce * eta; // throughput per second
    let e = 1;
    for (const [r, v] of entries(def.consumes)) {
      const need = rate * v * dt;
      if (need > 0) e = Math.min(e, s.res[r] / need);
    }
    const outs: [ResId, number][] = [];
    for (const [r, v] of entries(def.produces)) {
      const amt = rate * v * d.jobYield[j] * resMult(s, d, r, true) * dt;
      outs.push([r, amt]);
      const cap = d.caps[r];
      if (Number.isFinite(cap) && amt > 0) e = Math.min(e, Math.max(0, cap - s.res[r]) / amt);
    }
    e = Math.max(0, Math.min(1, e));
    if (e > 0) {
      for (const [r, v] of entries(def.consumes)) s.res[r] = Math.max(0, s.res[r] - rate * v * dt * e);
      for (const [r, amt] of outs) {
        gain(s, d, r, amt * e, false, ctx);
        gross[r] += (amt * e) / dt;
        grossNoTemp[r] += (amt * e) / dt / (RESOURCES[r].excludeGlobal ? 1 : d.temp) / eta; // rate includes η
      }
    }
    const prev = s.convEff[j] ?? e;
    s.convEff[j] = prev + (e - prev) * (1 - Math.exp(-dt / 5));
  }

  // ---- 3. steam consumers (press, clocktower)
  if (d.steamNeed > 0) {
    const need = d.steamNeed * dt * eta;
    const e = need > 0 ? Math.min(1, s.res.steam / need) : 1;
    s.res.steam = Math.max(0, s.res.steam - need * e);
    s.steamEff = e;
  } else {
    s.steamEff = 1;
  }

  // ---- 4. food
  const food = 0.04 * s.rats * dt * eta;
  s.res.crumbs = Math.max(0, s.res.crumbs - food);
  if (s.satiety && s.upgrades.cheese_diet && s.rats > 0) {
    const needC = 0.005 * s.rats * dt * eta;
    if (s.res.cheese >= needC) s.res.cheese -= needC;
    else {
      s.res.cheese = 0;
      s.satiety = false;
      news(s, "satiety_off", {}, ctx);
      toast(ctx, "Сыр кончился — Сытость выключена", "🧀", "bad");
    }
  }
  const crumbNet = gross.crumbs - 0.04 * s.rats * eta;
  if (!s.hungry && s.res.crumbs <= 1e-6 && crumbNet < 0 && s.rats > 0) {
    s.hungry = true;
    ctx.fx.push({ k: "hunger", on: true });
    news(s, "hunger", {}, ctx);
    if (!s.flags.starved) {
      s.flags.starved = true;
      award(s, "starved", ctx);
    }
  } else if (s.hungry && s.res.crumbs > 5) {
    s.hungry = false;
    ctx.fx.push({ k: "hunger", on: false });
  }

  // ---- 5. population
  if (!s.flags.vagrants && s.resEver.crumbs >= 10) {
    s.flags.vagrants = true;
    s.rats += 2;
    s.jobs.forager += 2;
    ctx.fx.push({ k: "vagrants" });
    news(s, "vagrants", {}, ctx);
  }
  if (s.flags.vagrants && s.rats < d.housing && s.res.crumbs > 0 && !s.hungry) {
    s.birthProgress += d.birthRate * dt * eta;
    let guard = 0;
    while (s.birthProgress >= 1 && s.rats < d.housing && guard++ < 10000) {
      s.birthProgress -= 1;
      s.rats += 1;
      s.stats.births += 1;
      s.meta.lifetime.births += 1;
      const job = newbornJob(s, d, crumbNet);
      if (job !== "idle") s.jobs[job] += 1;
      if (!input.offline) ctx.fx.push({ k: "birth", job });
    }
    if (s.rats >= d.housing) s.birthProgress = Math.min(s.birthProgress, 0.999);
  }
  normalizeJobs(s, d);

  // ---- «Автовзнос» of uncapped resources: half of this tick's gain, before the rates are measured
  if (s.autoContribute) autoContributeUncapped(s, d, before);

  // ---- 6. stats: rates, gross, EMA30
  const kEma = 1 - Math.exp(-dt / 30);
  const kRate = 1 - Math.exp(-dt / 1.5);
  for (const r of RES_IDS) {
    s.gross[r] = gross[r];
    s.ema[r] += (grossNoTemp[r] - s.ema[r]) * kEma;
    const inst = (s.res[r] - before[r]) / dt;
    s.rates[r] += (inst - s.rates[r]) * (input.offline ? 1 : kRate);
    if (!Number.isFinite(s.rates[r])) s.rates[r] = 0;
  }
}

/** Approximate crumbs net rate (production - food) used by the Elder rule and UI. */
export function crumbBalance(s: GameState, d: Derived): number {
  return s.gross.crumbs - d.food;
}

