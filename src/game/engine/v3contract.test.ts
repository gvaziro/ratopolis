import { describe, expect, it } from "vitest";
import { CURIOS, CURIO_SETS, curioSets } from "../data/curios";
import { DISTRICTS, districtInfo, districtOptions } from "../data/districts";
import { TRAIN_VARIANTS } from "../data/events";
import { onUiFx, sfxCue3, type UiFx } from "../fx";
import { devHandleAllowed, isHeld } from "../store";
import { CURIO_IDS, DISTRICT_IDS, type EngineCtx, type Fx } from "../types";
import { click, migrate } from "./actions";
import { check, describeCond } from "./conditions";
import { derive } from "./derive";
import { steamBudget } from "./economy";
import {
  addSuspicion,
  CAT_COUNTER_WINDOW,
  catLungeAt,
  crashChance,
  deferTrainsForReturn,
  expectedAuto,
  fogActive,
  metroTeaser,
  pickVariant,
  releaseDeferredToast,
  sceneAction,
  vigilance,
} from "./events";
import { buildNowPick, currentProject, ETA_LONG_SEC, expeditionBottleneck, newbornTarget, potentialRate, projectBottleneck } from "./goals";
import { holdCredit } from "./hold";
import { charterAtCap, charterMult, crownBonusMult, crownPctPer, crownsMult, expressBonusPct, expressMult } from "./metaMath";
import { migrationPreview } from "./narrative";
import { createInitialState } from "./state";
import { step, TICK } from "./step";
import { fixtureNames, loadFixture, metroState } from "./testkit";

describe("v3 contract: hold and trains (ENG-5)", () => {
  it("isHeld is true for a ceremony, a crash and a save issue", () => {
    const base = { ceremony: false, crashed: false, saveIssue: null };
    expect(isHeld(base)).toBe(false);
    expect(isHeld({ ...base, ceremony: true })).toBe(true);
    expect(isHeld({ ...base, crashed: true })).toBe(true);
    expect(isHeld({ ...base, saveIssue: { kind: "locked" } })).toBe(true);
  });

  it("holdCredit: a short hold under a ceremony or a driven scene is a pause, otherwise ticks; long ones catch up", () => {
    expect(holdCredit({ away: 20, ceremony: false, scene: { interactive: true } })).toBe("pause");
    expect(holdCredit({ away: 20, ceremony: true, scene: null })).toBe("pause");
    expect(holdCredit({ away: 20, ceremony: false, scene: { interactive: false } })).toBe("ticks");
    expect(holdCredit({ away: 61, ceremony: true, scene: { interactive: true } })).toBe("catchUp");
  });

  it("deferTrainsForReturn: a train due in 10 s waits behind a fresh «К путям!» after a 40 s credit", () => {
    const s = metroState();
    s.timers.carriage = Infinity;
    s.timers.metro_train = s.time + 10;
    s.timers.whistleUsedFor = s.timers.metro_train;
    const trains = s.stats.trains;
    const ctx: EngineCtx = { fx: [] };
    const deferred = deferTrainsForReturn(s, 40);
    expect(deferred).toEqual([s.timers.metro_train]);
    expect(s.timers.whistleUsedFor).toBe(s.timers.metro_train);
    for (let i = 0; i < 400; i++) step(s, TICK, { active: false }, ctx);
    expect(ctx.fx.some((f) => f.k === "trainSoon")).toBe(false); // held back during the credit
    releaseDeferredToast(s, deferred);
    expect(s.stats.trains).toBe(trains);
    expect(s.scene).toBeNull();
    const left = s.timers.metro_train - s.time;
    expect(left).toBeGreaterThanOrEqual(15 - 1e-6);
    expect(left).toBeLessThanOrEqual(25 + 1e-6);
    const soon: Fx[] = [];
    for (let i = 0; i < 10; i++) {
      const c: EngineCtx = { fx: [] };
      step(s, TICK, { active: false }, c);
      soon.push(...c.fx);
    }
    expect(soon.some((f) => f.k === "trainSoon")).toBe(true);
  });
});

describe("v3 contract: trains, hazards, fog (ENG-8, ENG-9)", () => {
  it("vigilance, crashChance and expectedAuto", () => {
    expect(vigilance(0)).toBe(1);
    expect(vigilance(50)).toBe(1);
    expect(vigilance(100)).toBe(0.5);
    expect(vigilance(60, 40)).toBeCloseTo(0.8, 12);
    expect(crashChance("wall")).toBe(0);
    expect(crashChance("rails", "freight")).toBeCloseTo(0.1, 12);
    expect(crashChance("ties", "normal", true)).toBeCloseTo(0.225, 12);
    expect(crashChance("rails", "edinburgh_mail")).toBeCloseTo(0.025, 12);
    expect(expectedAuto("rails", "normal", 0.5)).toBeCloseTo(0.5 * (1 - 0.025), 12);
    expect(expectedAuto("ties", "normal", 10)).toBeCloseTo(0.9 * (1 - 0.075), 12);
  });

  it("the cat's lunges: peaks 1.1 s apart within ±0.15 s, the counter window is 0.18 s", () => {
    expect(CAT_COUNTER_WINDOW).toBe(0.18);
    for (let n = 0; n < 6; n++) {
      const t = catLungeAt(42, n);
      expect(Math.abs(t - (0.6 + 1.1 * n))).toBeLessThanOrEqual(0.15);
      expect(catLungeAt(42, n)).toBe(t);
    }
  });

  it("three countered lunges pay ×1.5 and the cat runs", () => {
    const run = (perfect: number) => {
      const s = metroState(5);
      s.ema.blueprints = 1;
      s.timers.catForcedAt = s.time;
      s.timers.carriage = Infinity;
      s.timers.metro_train = Infinity;
      const ctx: EngineCtx = { fx: [] };
      for (let i = 0; i < 30 && s.scene?.id !== "cat"; i++) step(s, TICK, { active: true }, ctx);
      expect(s.scene?.id).toBe("cat");
      sceneAction(s, derive(s), { a: "choice", option: "fight" }, ctx);
      sceneAction(s, derive(s), { a: "taps", cleared: 1, perfect }, ctx);
      const toastText = ctx.fx.filter((f): f is Extract<Fx, { k: "toast" }> => f.k === "toast").pop()?.text ?? "";
      return { bp: s.resEver.blueprints, toastText };
    };
    const plain = run(0);
    const routed = run(3);
    expect(routed.bp).toBeCloseTo(plain.bp * 1.5, 6);
    expect(routed.toastText).toContain("Кот бежит, поджав хвост");
  });

  it("fog forces the 'fog' variant and stops suspicion; circus can be forced (its odds: v3events.test)", () => {
    const s = metroState();
    s.suspicion = 40;
    s.buffs.fogUntil = s.time + 180;
    expect(fogActive(s)).toBe(true);
    addSuspicion(s, derive(s), 5);
    expect(s.suspicion).toBe(40);
    expect(pickVariant(s)).toBe("fog");
    expect(TRAIN_VARIANTS.fog.fog).toBe(true);
    expect(TRAIN_VARIANTS.circus).toMatchObject({ bounces: 3, restitution: 0.72, launchMul: 1.25, physics: "bounce" });
    s.buffs.fogUntil = 0;
    expect(fogActive(s)).toBe(false);
    s.forceVariant = "circus";
    expect(pickVariant(s)).toBe("circus");
    expect(s.forceVariant).toBeUndefined();
  });

  it("metroTeaser shows after «Гул из глубины» until the Metro opens", () => {
    const s = createInitialState(1, 0);
    expect(metroTeaser(s)).toBeNull();
    s.flags.first_rumble = true;
    expect(metroTeaser(s)).toBe("🚇 ??? — там ходит Бог Грома");
    s.zones.metro = true;
    expect(metroTeaser(s)).toBeNull();
  });
});

describe("v3 contract: districts and curios (ENG-10, ENG-11)", () => {
  it("12 districts with symmetric neighbours, fillers and a map position", () => {
    for (const id of DISTRICT_IDS) {
      const d = DISTRICTS[id];
      expect(d.id).toBe(id);
      expect(d.fillers.length).toBeGreaterThan(0);
      expect(d.pos.x).toBeGreaterThanOrEqual(0);
      expect(d.pos.x).toBeLessThanOrEqual(100);
      for (const n of d.neighbors) expect(DISTRICTS[n].neighbors, `${id} ↔ ${n}`).toContain(id);
    }
  });

  it("options[0] follows the v2 sequence; migrate(to) goes where asked and derive applies that district", () => {
    const s = metroState();
    s.eRun = 5e6;
    const opts = migrationPreview(s).options;
    expect(opts[0].id).toBe("southwark");
    expect(opts.length).toBe(2);
    expect(new Set(opts.map((o) => o.id)).size).toBe(2);
    const ctx: EngineCtx = { fx: [] };
    const next = migrate(s, 0, ctx, "city")!;
    expect(next.meta.districtId).toBe("city");
    expect(next.meta.visited).toEqual(["whitechapel", "city"]);
    expect(next.meta.district).toBe(1);
    expect(districtInfo(next.meta).name).toBe("Сити");
    expect(derive(next).districtRes.coins).toBe(1.5);
    const mig = ctx.fx.find((f): f is Extract<Fx, { k: "migration" }> => f.k === "migration");
    expect(mig?.districtId).toBe("city");
    expect(next.meta.history[0].districtId).toBe("whitechapel");
    // the default stays the old sequence for a colony that never picked
    const s2 = metroState();
    s2.eRun = 5e6;
    expect(migrate(s2, 0, { fx: [] })!.meta.districtId).toBe("southwark");
  });

  it("no district repeats until all 12 are visited; the second lap is «… II» and amplified", () => {
    const meta = createInitialState(1, 0).meta;
    for (let i = 0; i < 11; i++) {
      const o = districtOptions(meta);
      expect(meta.visited).not.toContain(o[0].id);
      meta.visited.push(o[o.length - 1].id);
      meta.district = meta.visited.length - 1;
      meta.migrations++;
    }
    expect(new Set(meta.visited).size).toBe(12);
    const lap2 = districtOptions(meta)[0];
    expect(lap2.lap).toBe(2);
    expect(lap2.name).toMatch(/ II$/);
  });

  it("24 curios in 6 sets of 4; curioSets reports ownership", () => {
    expect(Object.keys(CURIOS)).toHaveLength(24);
    const inSets = Object.values(CURIO_SETS).flatMap((x) => x.items);
    expect(new Set(inSets)).toEqual(new Set(CURIO_IDS));
    for (const id of CURIO_IDS) expect(CURIO_SETS[CURIOS[id].owner].items).toContain(id);
    const s = createInitialState(1, 0);
    s.meta.curios = [...CURIO_SETS.grant.items];
    const sets = curioSets(s);
    expect(sets).toHaveLength(6);
    expect(sets.find((x) => x.owner === "grant")?.done).toBe(true);
    expect(sets.filter((x) => x.done)).toHaveLength(1);
  });
});

describe("v3 contract: meta maths, goals, steam, settings (ENG-1, ENG-3, ENG-4, ENG-7, ENG-12)", () => {
  it("metaMath equals derive's parts", () => {
    for (const [stage, wagons, crowns, favor] of [
      [0, 0, 0, false],
      [3, 0, 40, false],
      [10, 2, 150, true],
      [10, 5, 999, true],
    ] as const) {
      const s = createInitialState(1, 0);
      s.express.stage = stage;
      s.express.wagons = wagons;
      s.meta.crownsEver = crowns;
      if (favor) s.meta.edicts.kings_favor = true;
      const parts = derive(s).globalParts;
      const part = (label: string) => parts.find((p) => p.label === label)?.mult ?? 1;
      expect(expressBonusPct(s)).toBeCloseTo((part("Крысиный экспресс") - 1) * 100, 9);
      expect((crownPctPer(s.meta) / 100) * crowns).toBeCloseTo(part("Венцы") - 1, 9);
    }
  });

  it("metaMath equals derive's parts and the migration preview on the golden saves (ENG-7: one source)", () => {
    const names = fixtureNames();
    expect(names.length).toBeGreaterThanOrEqual(5);
    for (const name of names) {
      const s = loadFixture(name);
      const parts = derive(s).globalParts;
      const part = (label: string) => parts.find((p) => p.label === label)?.mult ?? 1;
      expect(crownsMult(s.meta), name).toBe(part("Венцы"));
      expect(expressMult(s), name).toBe(part("Крысиный экспресс"));
      expect(expressBonusPct(s), name).toBeCloseTo((part("Крысиный экспресс") - 1) * 100, 9);
      // MigrationTab «Бонус ко всему» = (part «Венцы» − 1) × 100
      expect(migrationPreview(s).bonusBefore, name).toBeCloseTo((part("Венцы") - 1) * 100, 9);
      expect(crownBonusMult(s), name).toBeCloseTo((s.coronatedThisRun ? 1.25 : 1) * charterMult(s), 12);
    }
  });

  it("charters: mult, cap flag and the crown bonus", () => {
    expect(charterMult({ charters: 0 })).toBe(1);
    expect(charterAtCap({ charters: 10 })).toBe(true);
    expect(charterAtCap({ charters: 0 })).toBe(false);
    expect(crownBonusMult({ coronatedThisRun: true, charters: 0 })).toBe(1.25);
  });

  it("goals: never NaN, Infinity when a resource is not produced, a project and a pick on a played state", () => {
    const s = createInitialState(3, 0);
    const ctx: EngineCtx = { fx: [] };
    // a player at the grate (the nest shows from 10 🍞 ever): a click every third tick
    for (let i = 0; i < 3000; i++) {
      step(s, TICK, { active: true }, ctx);
      if (i % 3 === 0) click(s, derive(s), ctx);
    }
    const d = derive(s);
    expect(ETA_LONG_SEC).toBe(7200);
    expect(Number.isFinite(potentialRate(s, d, "crumbs"))).toBe(true);
    const b = projectBottleneck(s, d, { coins: 1e9, blueprints: 5 });
    expect(b).not.toBeNull();
    expect(Number.isNaN(b!.etaSec)).toBe(false);
    expect(projectBottleneck(s, d, { blueprints: 5 })!.etaSec).toBe(Infinity);
    expect(projectBottleneck(s, d, {})).toBeNull();
    s.revealed.exp_sewers = true;
    expect(currentProject(s)).toEqual({ kind: "expedition", zone: "sewers" });
    const eb = expeditionBottleneck(s, d, "sewers");
    if (eb) expect(Number.isNaN(eb.etaSec)).toBe(false);
    s.res.crumbs = 1e6;
    s.res.coins = 1e6;
    s.res.buttons = 1e6;
    s.res.wire = 1e6;
    const pick = buildNowPick(s, derive(s));
    expect(pick).not.toBeNull();
    const t = newbornTarget(s, derive(s));
    expect(typeof t.job).toBe("string");
  });

  it("steamBudget reads supply, cap and the three consumers", () => {
    const s = metroState();
    s.buildings.boiler = 2;
    s.buildings.steam_press = 1;
    s.jobs.stoker = 2;
    s.res.coal = 100;
    const b = steamBudget(s, derive(s));
    expect(b.supply).toBeGreaterThan(0);
    expect(b.press).toBeGreaterThan(0);
    expect(b.clock).toBe(0);
    expect(b.conv).toBe(0);
    expect(Number.isFinite(b.cap)).toBe(true);
  });

  it("Cond {migrations} and its description", () => {
    const s = createInitialState(1, 0);
    expect(check(s, { migrations: 1 })).toBe(false);
    s.meta.migrations = 1;
    expect(check(s, { migrations: 1 })).toBe(true);
    expect(describeCond({ migrations: 1 }, () => "")).toBe("после первого Великого Переселения");
  });

  it("sfxCue3 emits UiFx sfx3; the dev handle is on in dev, in production only with ?dev", () => {
    const got: UiFx[] = [];
    const off = onUiFx((f) => got.push(f));
    sfxCue3("hoof", { intensity: 0.5 });
    off();
    expect(got).toEqual([{ k: "sfx3", cue: "hoof", intensity: 0.5, pitch: undefined }]);
    expect(devHandleAllowed("development", "")).toBe(true);
    expect(devHandleAllowed("production", "")).toBe(false);
    expect(devHandleAllowed("production", "?dev")).toBe(true);
    expect(devHandleAllowed("production", "?slot=e2e&dev=1")).toBe(true);
    expect(devHandleAllowed("production", "?devtools")).toBe(false);
  });

  it("fresh settings carry the v3 sound buses", () => {
    expect(createInitialState(1, 0).settings).toMatchObject({ sfxVolume: 1, music: 0.35 });
    expect(createInitialState(1, 0).steamPriority).toBe("works");
  });
});
