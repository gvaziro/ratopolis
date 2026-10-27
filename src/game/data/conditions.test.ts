import { describe, expect, it } from "vitest";
import { zeroStats } from "../engine/state";
import {
  BUILDING_IDS,
  EDICT_IDS,
  JOB_IDS,
  RES_IDS,
  UPGRADE_IDS,
  ZONE_IDS,
  type Amounts,
  type Cond,
  type FlagId,
} from "../types";
import { BUILDINGS } from "./buildings";
import { TRAIN_CARS } from "./events";
import { JOBS } from "./jobs";
import { EXPRESS_BASE } from "./meta";
import { RESOURCES } from "./resources";
import { UPGRADES } from "./upgrades";
import { ZONES } from "./zones";

/** Every FlagId the engine can set (keep in sync with types.ts). */
const FLAGS: FlagId[] = [
  "vagrants",
  "hit_crumb_cap",
  "hit_any_cap",
  "first_coin",
  "first_button_or_wire",
  "first_capsule",
  "first_train",
  "first_cat",
  "first_purse",
  "first_carriage",
  "first_pocketwatch",
  "starved",
  "coronation",
  "migration_ready",
  "focus_manual",
  "first_rumble",
];

const has = <T extends string>(list: readonly T[], x: string) => (list as readonly string[]).includes(x);

function checkCond(c: Cond, where: string, errors: string[]): void {
  const bad = (msg: string) => errors.push(`${where}: ${msg}`);
  if ("always" in c) return;
  if ("all" in c || "any" in c) {
    const list = "all" in c ? c.all : c.any;
    if (!list.length) bad("empty all/any");
    list.forEach((x, i) => checkCond(x, `${where}[${i}]`, errors));
    return;
  }
  if ("stat" in c) {
    if (!(c.stat in zeroStats())) bad(`unknown stat ${c.stat}`);
  } else if ("rats" in c) {
    if (!(c.rats >= 0)) bad("rats < 0");
  } else if ("building" in c) {
    if (!has(BUILDING_IDS, c.building)) bad(`unknown building ${c.building}`);
  } else if ("job" in c) {
    if (!has(JOB_IDS, c.job)) bad(`unknown job ${c.job}`);
  } else if ("zone" in c) {
    if (!has(ZONE_IDS, c.zone)) bad(`unknown zone ${c.zone}`);
  } else if ("resEver" in c) {
    if (!has(RES_IDS, c.resEver)) bad(`unknown resource ${c.resEver}`);
  } else if ("upgrade" in c) {
    if (!has(UPGRADE_IDS, c.upgrade)) bad(`unknown upgrade ${c.upgrade}`);
  } else if ("edict" in c) {
    if (!has(EDICT_IDS, c.edict)) bad(`unknown edict ${c.edict}`);
  } else if ("flag" in c) {
    if (!FLAGS.includes(c.flag)) bad(`unknown flag ${c.flag}`);
  } else if ("migrations" in c) {
    if (!(c.migrations >= 1)) bad("migrations < 1");
  } else bad(`unknown condition ${JSON.stringify(c)}`);
}

function checkAmounts(a: Amounts, where: string, errors: string[]): void {
  for (const [r, v] of Object.entries(a)) {
    if (!has(RES_IDS, r)) errors.push(`${where}: unknown resource ${r}`);
    if (!(typeof v === "number" && v > 0 && Number.isFinite(v))) errors.push(`${where}: bad amount ${r}=${v}`);
  }
}

describe("content tables", () => {
  it("every condition references existing ids", () => {
    const errors: string[] = [];
    for (const r of RES_IDS) checkCond(RESOURCES[r].reveal, `resource ${r}.reveal`, errors);
    for (const j of JOB_IDS) checkCond(JOBS[j].unlock, `job ${j}.unlock`, errors);
    for (const b of BUILDING_IDS) checkCond(BUILDINGS[b].unlock, `building ${b}.unlock`, errors);
    for (const u of UPGRADE_IDS) checkCond(UPGRADES[u].unlock, `upgrade ${u}.unlock`, errors);
    expect(errors).toEqual([]);
  });

  it("every price, product and effect references existing resources, jobs and buildings", () => {
    const errors: string[] = [];
    for (const b of BUILDING_IDS) {
      const def = BUILDINGS[b];
      if (def.id !== b) errors.push(`building ${b}: id mismatch`);
      checkAmounts(def.cost, `building ${b}.cost`, errors);
      if (!(def.growth > 1)) errors.push(`building ${b}: growth must be > 1`);
      if (!has(ZONE_IDS, def.zone)) errors.push(`building ${b}: unknown zone`);
      for (const e of def.effects) {
        if ("res" in e && !has(RES_IDS, e.res)) errors.push(`building ${b}: effect on unknown resource ${e.res}`);
        if ("job" in e && !has(JOB_IDS, e.job)) errors.push(`building ${b}: effect on unknown job ${e.job}`);
      }
    }
    for (const u of UPGRADE_IDS) {
      if (UPGRADES[u].id !== u) errors.push(`upgrade ${u}: id mismatch`);
      checkAmounts(UPGRADES[u].cost, `upgrade ${u}.cost`, errors);
    }
    for (const j of JOB_IDS) {
      for (const k of ["produces", "consumes"] as const) for (const r of Object.keys(JOBS[j][k])) if (!has(RES_IDS, r)) errors.push(`job ${j}.${k}: ${r}`);
      const slot = JOBS[j].slots;
      if (slot && !has(BUILDING_IDS, slot.building)) errors.push(`job ${j}: slots from unknown building`);
    }
    for (const z of ZONE_IDS) if (ZONES[z].expedition) checkAmounts(ZONES[z].expedition!.cost, `zone ${z}.expedition`, errors);
    checkAmounts(EXPRESS_BASE, "EXPRESS_BASE", errors);
    for (const [k, car] of Object.entries(TRAIN_CARS)) {
      const sum = Object.values(car.drops).reduce((a, x) => a + (x ?? 0), 0);
      if (Math.abs(sum - 1) > 1e-9) errors.push(`train car ${k}: drops sum to ${sum}`);
      for (const r of Object.keys(car.drops)) if (!has(RES_IDS, r)) errors.push(`train car ${k}: ${r}`);
    }
    expect(errors).toEqual([]);
  });

  it("every limited job gets its slots from a building that grants them", () => {
    for (const j of JOB_IDS) {
      const slot = JOBS[j].slots;
      if (!slot) continue;
      const grants = BUILDINGS[slot.building].effects.some((e) => e.t === "slots" && e.job === j);
      expect(grants, `${j} ← ${slot.building}`).toBe(true);
    }
  });
});
