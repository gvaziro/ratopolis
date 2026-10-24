import { MILESTONES, MILESTONE_JOB_BOOST } from "../data/buildings";
import { CONVERTERS, JOBS } from "../data/jobs";
import { RESOURCES } from "../data/resources";
import { BUILDING_IDS, JOB_IDS, RES_IDS, type Amounts, type BuildingId, type EngineCtx, type GameState, type ResId, type ResMap, type TickInput } from "../types";
import { autoContributeUncapped } from "./actions";
import { award, gain, newbornJob, news, normalizeJobs, toast } from "./core";
import { converterPotential, derive, resMult, stunnedRats, type Derived } from "./derive";
import { buildingCost, entries } from "./formulas";
import { zeroRes } from "./state";

/** Longest production slice of an offline step (s): see tickEconomy. */
export const OFFLINE_SLICE = 2;

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
  const perSec = zeroRes();
  for (const r of RES_IDS) {
    if (base[r] <= 0) continue;
    perSec[r] = base[r] * resMult(s, d, r, true) * eta;
    gross[r] += perSec[r];
    grossNoTemp[r] += base[r] * resMult(s, d, r, false);
  }

  // phases 1–3 run in slices of at most OFFLINE_SLICE s offline: a coarse catch-up step (up to 48 s) would let the
  // stokers fill the steam buffer (≈15–30 s of demand) once per step, starving the press, the clocktower and with
  // them the global multiplier. Online a step is one slice. No derive() per slice: multipliers hold for the step.
  const slices = input.offline ? Math.max(1, Math.ceil(dt / OFFLINE_SLICE)) : 1;
  const h = dt / slices;
  let crumbOverflow = 0; // crumbs the full store turned away: they feed the colony first (step 4)
  let steamEffSum = 0;
  for (let slice = 0; slice < slices; slice++) {
    for (const r of RES_IDS) {
      if (perSec[r] <= 0) continue;
      const added = gain(s, d, r, perSec[r] * h, false, ctx);
      if (r === "crumbs") crumbOverflow += perSec[r] * h - added;
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
        const need = rate * v * h;
        if (need > 0) e = Math.min(e, s.res[r] / need);
      }
      const outs: [ResId, number][] = [];
      for (const [r, v] of entries(def.produces)) {
        const amt = rate * v * d.jobYield[j] * resMult(s, d, r, true) * h;
        outs.push([r, amt]);
        const cap = d.caps[r];
        if (Number.isFinite(cap) && amt > 0) e = Math.min(e, Math.max(0, cap - s.res[r]) / amt);
      }
      e = Math.max(0, Math.min(1, e));
      if (e > 0) {
        for (const [r, v] of entries(def.consumes)) s.res[r] = Math.max(0, s.res[r] - rate * v * h * e);
        for (const [r, amt] of outs) {
          gain(s, d, r, amt * e, false, ctx);
          gross[r] += (amt * e) / dt;
          grossNoTemp[r] += (amt * e) / dt / (RESOURCES[r].excludeGlobal ? 1 : d.temp) / eta; // rate includes η
        }
      }
      const prev = s.convEff[j] ?? e;
      s.convEff[j] = prev + (e - prev) * (1 - Math.exp(-h / 5));
    }

    // ---- 3. steam consumers (press, clocktower)
    if (d.steamNeed > 0) {
      const need = d.steamNeed * h * eta;
      const e = need > 0 ? Math.min(1, s.res.steam / need) : 1;
      s.res.steam = Math.max(0, s.res.steam - need * e);
      steamEffSum += e;
    }
  }
  s.steamEff = d.steamNeed > 0 ? steamEffSum / slices : 1;

  // ---- 4. food: eaten out of what the full store turned away first, so with production above upkeep the crumbs
  // sit exactly at the cap (a price equal to the cap stays payable)
  const food = 0.04 * s.rats * dt * eta;
  s.res.crumbs = Math.max(0, s.res.crumbs - Math.max(0, food - crumbOverflow));
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

/* ------------------------------------------------------------ purchase legibility (v2) */

/**
 * Passive gross production per second implied by the state (with temporary multipliers), the same model as
 * tickEconomy: producers × workforce × multipliers, converters at their current efficiency EMA.
 */
export function grossRates(s: GameState, d: Derived): ResMap {
  const workforce = s.rats > 0 ? 1 - stunnedRats(s) / s.rats : 1;
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
  const gross = zeroRes();
  for (const r of RES_IDS) if (base[r] > 0) gross[r] = base[r] * resMult(s, d, r, true);
  for (const j of CONVERTERS) {
    const n = s.jobs[j];
    if (n <= 0) continue;
    const e = Math.max(0, Math.min(1, s.convEff[j] ?? 1));
    for (const [r, v] of entries(JOBS[j].produces)) gross[r] += n * d.jobSpeed[j] * workforce * v * d.jobYield[j] * resMult(s, d, r, true) * e;
  }
  return gross;
}

/** Cost of the next k levels of a building from its current level. */
export function buildingCostFor(s: GameState, id: BuildingId, k: number): Amounts {
  return buildingCost(id, s.buildings[id], Math.max(1, Math.floor(k)));
}

/**
 * Per-second gross gain of buying k more levels of a building: produce effects × multipliers × milestone change,
 * job bonuses on current workers, tier/global multipliers. Exact by construction: derive the state with the
 * extra levels and diff grossRates(). Only non-zero entries are returned. Extra press/clocktower levels share the
 * steam there is: the steam the consumers get now, or the stokers' spare output when the buffer has headroom.
 */
export function levelGain(s: GameState, d: Derived, id: BuildingId, k: number): Partial<Record<ResId, number>> {
  let s2: GameState = { ...s, buildings: { ...s.buildings, [id]: s.buildings[id] + Math.max(1, Math.floor(k)) } };
  let d2 = derive(s2);
  if (d2.steamNeed > d.steamNeed) {
    const avail = Math.max(d.steamNeed > 0 ? s.steamEff * d.steamNeed : 0, converterPotential(s, d, "steam") - converterSteamUse(s, d));
    s2 = { ...s2, steamEff: Math.max(0, Math.min(1, avail / d2.steamNeed)) };
    d2 = derive(s2);
  }
  const before = grossRates(s, d);
  const after = grossRates(s2, d2);
  const out: Partial<Record<ResId, number>> = {};
  for (const r of RES_IDS) {
    const diff = after[r] - before[r];
    if (Math.abs(diff) > 1e-12) out[r] = diff;
  }
  return out;
}

/** Steam per second the converters (smelters, smiths) burn at their current efficiency. */
function converterSteamUse(s: GameState, d: Derived): number {
  const workforce = s.rats > 0 ? 1 - stunnedRats(s) / s.rats : 1;
  let use = 0;
  for (const j of CONVERTERS) {
    const v = JOBS[j].consumes.steam ?? 0;
    if (v > 0 && s.jobs[j] > 0) use += s.jobs[j] * d.jobSpeed[j] * workforce * v * Math.max(0, Math.min(1, s.convEff[j] ?? 1));
  }
  return use;
}

/** Market value of one unit for payback maths (📜💍 have no market price: 50, like marketValue; 💨 counts as 0). */
export function unitValue(r: ResId): number {
  return RESOURCES[r].market ?? (r === "steam" ? 0 : 50);
}

/** Seconds of the extra production needed to pay back k levels (Infinity when the levels produce nothing). */
export function paybackSeconds(s: GameState, d: Derived, id: BuildingId, k: number): number {
  const cost = buildingCostFor(s, id, k);
  let price = 0;
  for (const [r, v] of entries(cost)) price += v * unitValue(r);
  let perSec = 0;
  for (const [r, v] of entries(levelGain(s, d, id, k))) if (v > 0) perSec += v * unitValue(r);
  return perSec > 0 ? price / perSec : Infinity;
}

/**
 * Milestones around a level: prev = the last one reached (0 = none), next = the next one (Infinity past the last),
 * jobBoost = the linked job's yield factor each milestone adds (EN-4).
 */
export function milestoneInfo(level: number): { prev: number; next: number; jobBoost: number } {
  let prev = 0;
  let next = Infinity;
  for (const m of MILESTONES) {
    if (level >= m) prev = m;
    else if (next === Infinity) next = m;
  }
  return { prev, next, jobBoost: MILESTONE_JOB_BOOST };
}
