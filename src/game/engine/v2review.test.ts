import { describe, expect, it } from "vitest";
import { EDICTS, ACHIEVEMENTS } from "../data/meta";
import { RAT_MEMORY_RANKS, UPGRADES } from "../data/upgrades";
import type { CommissionId, EngineCtx, GameState } from "../types";
import { acceptCommission, buySeal, contributeExpress, expressCost, migrate } from "./actions";
import { abandonCommission, offerCommissions } from "./commissions";
import { converterPotential, derive } from "./derive";
import { levelGain } from "./economy";
import { offlineTrains, rescheduleAfterAbsence, whistle } from "./events";
import { canAfford, marketValue } from "./formulas";
import { nextHint, resourceSources, suspicionInfo } from "./hints";
import { simulateOffline } from "./offline";
import { progressStat } from "./progress";
import { deserialize, isNewerSave, serialize } from "./save";
import { createInitialState, defaultMeta, defaultSettings, newRun } from "./state";
import { step, TICK } from "./step";

/** Fixes from the v2 review (engine area). */

const quiet = (): EngineCtx => ({ fx: [] });

/** Burrow, Sewers and Cellars open; the random background events parked so only the economy runs. */
function cellarsColony(seed = 5): GameState {
  const s = createInitialState(seed, 0);
  s.flags.vagrants = true;
  s.zones.sewers = true;
  s.zoneOpenedAt.sewers = 0;
  s.zones.cellars = true;
  s.zoneOpenedAt.cellars = 0;
  for (const k of ["carriage", "purse", "shiny", "capsule", "downpour", "cat", "catForcedAt", "market"] as const) s.timers[k] = Infinity;
  return s;
}

function run(s: GameState, seconds: number, active = false, each?: (s: GameState) => void): void {
  const ctx = quiet();
  for (let i = 0; i < Math.round(seconds / TICK); i++) {
    each?.(s);
    step(s, TICK, { active }, ctx);
    ctx.fx.length = 0;
  }
}

describe("«Автовзнос» of capped resources", () => {
  it("keeps the ⚙️ mechanics running once the gears store is full (their gross reads 0 there)", () => {
    const s = cellarsColony();
    s.revealed.exp_metro = true; // the Metro expedition is offered
    s.autoContribute = true;
    s.buildings.workshop = 2;
    s.rats = 6;
    s.jobs.mechanic = 6;
    const d0 = derive(s);
    s.res.gears = d0.caps.gears;
    s.res.wire = d0.caps.wire;
    s.res.buttons = d0.caps.buttons;
    const potential = converterPotential(s, derive(s), "gears");
    expect(potential).toBeGreaterThan(0);
    run(s, 120, false, (st) => {
      const d = derive(st);
      st.res.wire = d.caps.wire;
      st.res.buttons = d.caps.buttons;
      st.res.crumbs = d.caps.crumbs;
    });
    // half a second of the mechanics' output every second
    expect(s.projects.metro?.gears ?? 0).toBeGreaterThan(0.4 * potential * 120);
    expect(s.convEff.mechanic).toBeGreaterThan(0.3);
  });

  it("offline, each coarse step gives half of that step's production (not half a second's)", () => {
    const s = cellarsColony(11);
    s.revealed.exp_metro = true;
    s.autoContribute = true;
    s.rats = 60;
    s.jobs.pickpocket = 40;
    s.jobs.forager = 20;
    const d = derive(s);
    s.res.coins = d.caps.coins;
    s.res.crumbs = d.caps.crumbs;
    run(s, 10);
    const before = s.projects.metro?.coins ?? 0;
    const rep = simulateOffline(s, 3600, quiet())!;
    expect(rep.eta).toBe(0.5);
    const contributed = (s.projects.metro?.coins ?? 0) - before;
    // s.gross is the offline rate (×η): half of an hour of it
    const expected = 0.5 * s.gross.coins * 3600;
    expect(contributed).toBeGreaterThan(0.85 * expected);
    expect(contributed).toBeLessThan(1.15 * expected);
  });
});

describe("offline catch-up", () => {
  it("an 8 h absence keeps the steam chain (press, clocktower, global multiplier) running like online play", () => {
    const s = cellarsColony(9);
    s.zones.metro = true;
    s.zoneOpenedAt.metro = 0;
    s.timers.metro_train = Infinity;
    s.upgrades.night_shift = true;
    s.meta.edicts.eternal_night_shift = true;
    s.buildings.boiler = 10; // a 1050 buffer: 30 s of the presses' demand, less than one 48 s offline step
    s.buildings.steam_press = 10;
    s.buildings.clocktower = 3;
    s.rats = 160;
    s.jobs.stoker = 20;
    s.jobs.forager = 140;
    s.res.coal = 1e9;
    run(s, 60);
    const online = derive(s);
    expect(s.steamEff).toBeGreaterThan(0.99);
    expect(online.offline.capSec).toBe(8 * 3600);
    const rep = simulateOffline(s, 9 * 3600, quiet())!;
    expect(rep.simulated).toBe(8 * 3600);
    expect(s.steamEff).toBeGreaterThan(0.99);
    expect(derive(s).global).toBeGreaterThan(0.98 * online.global);
  });

  it("the Foreman builds while away whatever second the player left at (offline steps are all even)", () => {
    const stash = (t0: number) => {
      const s = cellarsColony(13);
      s.time = t0;
      s.upgrades.foreman = true;
      s.foreman.nests = false;
      s.foreman.storage = true;
      s.rats = 60;
      s.jobs.pickpocket = 40;
      s.jobs.forager = 20;
      s.res.crumbs = 1000;
      simulateOffline(s, 3 * 3600, quiet());
      return s.buildings.stash;
    };
    const even = stash(600.05);
    expect(even).toBeGreaterThan(0);
    expect(stash(601.05)).toBe(even);
  });

  it("trains are paid only for the time their line ran: a Metro opened near the end pays capsules, not 30 trains", () => {
    const s = cellarsColony(17);
    s.time = 10_000;
    s.zones.metro = true;
    s.zoneOpenedAt.metro = s.time - 10; // the dig finished 10 s before the return
    const d = derive(s);
    const late = offlineTrains(s, d, 7200, 0.5);
    expect(late.count).toBe(30); // capsules: 7190 s / 150 s, at most 30; no metro train
    expect(late.loot.coins ?? 0).toBeGreaterThan(0);
    const s2 = cellarsColony(17);
    s2.time = 10_000;
    s2.zones.metro = true;
    s2.zoneOpenedAt.metro = s2.time - 7190; // open almost the whole absence: metro trains, no capsules
    const early = offlineTrains(s2, derive(s2), 7200, 0.5);
    expect(early.count).toBe(Math.floor(7190 / d.intervals.metro));
    expect(marketValue(late.loot)).toBeLessThan(0.5 * marketValue(early.loot)); // capsules carry far less than trains
    // the next train still leaves the «К путям!» lead
    expect(s2.timers.metro_train).toBeGreaterThanOrEqual(s2.time + 45);
    expect(s2.timers.capsule).toBe(Infinity);
  });

  it("after an absence no train comes sooner than 45 s, even one that was not overdue", () => {
    const s = cellarsColony();
    s.zones.metro = true;
    s.time = 5000;
    s.timers.metro_train = s.time + 10;
    rescheduleAfterAbsence(s);
    expect(s.timers.metro_train).toBeGreaterThanOrEqual(s.time + 45);
    expect(s.timers.metro_train).toBeLessThanOrEqual(s.time + 75);
    s.timers.metro_train = s.time + 100;
    rescheduleAfterAbsence(s);
    expect(s.timers.metro_train).toBe(s.time + 100);
  });
});

describe("economy", () => {
  it("with production above upkeep the crumbs sit exactly at the cap, so a price equal to the cap is payable", () => {
    const s = createInitialState(3, 0);
    s.flags.vagrants = true;
    s.rats = 3;
    s.jobs.forager = 3;
    s.res.coins = 10;
    run(s, 200);
    const d = derive(s);
    expect(d.caps.crumbs).toBe(100);
    expect(s.res.crumbs).toBe(100);
    expect(canAfford(s, UPGRADES.long_whiskers.cost)).toBe(true);
    // the colony still eats: below the cap the stock falls by the food bill
    s.jobs.forager = 0;
    s.jobs.pickpocket = 3;
    run(s, 10);
    expect(s.res.crumbs).toBeLessThan(100);
  });

  it("levelGain promises a press nothing when no steam can feed it, and a gain when the stokers have spare steam", () => {
    const s = cellarsColony(15);
    s.zones.metro = true;
    s.buildings.boiler = 1;
    s.rats = 40;
    s.jobs.pickpocket = 40;
    expect(levelGain(s, derive(s), "steam_press", 1)).toEqual({});
    s.rats = 42;
    s.jobs.stoker = 2;
    s.res.coal = 1e6;
    run(s, 30);
    expect(levelGain(s, derive(s), "steam_press", 1).coins ?? 0).toBeGreaterThan(0);
  });
});

describe("events", () => {
  /** A Metro colony whose next train is always 30 s away (a fast Royal Express keeps it so). */
  function trainAlwaysSoon(): GameState {
    const s = cellarsColony(21);
    s.zones.metro = true;
    s.time = 3000;
    s.timers.lastSceneEnd = 2000;
    s.timers.metro_train = s.time + 30;
    return s;
  }

  it("a background event overdue for a minute starts despite the train guard, and the train waits for it", () => {
    const s = trainAlwaysSoon();
    s.timers.catForcedAt = s.time - 61;
    step(s, TICK, { active: true }, quiet());
    expect(s.scene?.id).toBe("cat");
    expect(s.timers.metro_train).toBeGreaterThanOrEqual(s.time + 40 - 1e-9);

    const c = trainAlwaysSoon();
    c.timers.carriage = c.time - 61;
    step(c, TICK, { active: false }, quiet());
    expect(c.scene?.id).toBe("carriage");
  });

  it("a freshly due background event still keeps away from a train under the guard", () => {
    const s = trainAlwaysSoon();
    s.timers.catForcedAt = s.time - 10;
    s.timers.carriage = s.time - 10;
    step(s, TICK, { active: true }, quiet());
    expect(s.scene).toBeNull();
    expect(s.timers.metro_train).toBeCloseTo(3030, 9);
  });

  it("the whistle refuses a train already at the platform and brings a farther one no closer than 5 s", () => {
    const near = trainAlwaysSoon();
    near.res.coins = 1000;
    near.timers.metro_train = near.time + 3;
    expect(whistle(near, quiet())).toBe(false);
    expect(near.res.coins).toBe(1000);
    expect(near.timers.metro_train).toBe(near.time + 3);

    const far = trainAlwaysSoon();
    far.res.coins = 1000;
    far.timers.metro_train = far.time + 40;
    const ctx = quiet();
    expect(whistle(far, ctx)).toBe(true);
    expect(far.res.coins).toBe(900);
    expect(far.timers.metro_train).toBe(far.time + 5);
    expect(JSON.stringify(ctx.fx)).toContain("на 35с раньше");
    // once per train
    expect(whistle(far, quiet())).toBe(false);
    expect(far.res.coins).toBe(900);
  });
});

describe("Печать Тишины and the King's commissions", () => {
  const NOISY: CommissionId[] = ["whiskers_twice", "pipe_splinters"];

  function crowned(seal: boolean): GameState {
    const s = cellarsColony(23);
    s.zones.metro = true;
    s.meta.crowns = 500;
    if (seal) {
      s.meta.sealsOwned = ["silence"];
      s.meta.seal = "silence";
    }
    return s;
  }

  it("never offers or accepts a commission that needs the Cat or the Ratcatcher", () => {
    const s = crowned(true);
    for (let i = 0; i < 40; i++) {
      offerCommissions(s);
      expect(s.commissions!.offered.some((id) => NOISY.includes(id))).toBe(false);
    }
    s.commissions = { offered: ["whiskers_twice", "bullseye", "replenish"], done: 0 };
    expect(acceptCommission(s, "whiskers_twice", quiet())).toBe(false);
    expect(acceptCommission(s, "bullseye", quiet())).toBe(true);
  });

  it("sealing silence hands back an active noisy commission; any commission can be given up", () => {
    const s = crowned(false);
    s.commissions = { offered: ["whiskers_twice", "bullseye", "replenish"], done: 2 };
    expect(acceptCommission(s, "whiskers_twice", quiet())).toBe(true);
    expect(buySeal(s, "silence", quiet())).toBe(true);
    expect(s.commissions!.active).toBeUndefined();
    expect(s.commissions!.done).toBe(2);
    expect(s.commissions!.offered).toHaveLength(3);
    expect(s.commissions!.offered.some((id) => NOISY.includes(id))).toBe(false);

    const id = s.commissions!.offered[0];
    expect(acceptCommission(s, id, quiet())).toBe(true);
    expect(abandonCommission(s, quiet())).toBe(true);
    expect(s.commissions!.active).toBeUndefined();
    expect(s.commissions!.offered).not.toContain(id);
    expect(abandonCommission(s, quiet())).toBe(false);
  });

  it("«Где взять» leaves out the Cat and the Ratcatcher under the seal", () => {
    const labels = (s: GameState) => resourceSources(s, "blueprints").map((x) => x.label);
    expect(labels(crowned(false))).toEqual(expect.arrayContaining(["победа над Котом", "сломанная дудка Крысолова"]));
    expect(labels(crowned(true))).not.toContain("победа над Котом");
    expect(labels(crowned(true))).not.toContain("сломанная дудка Крысолова");
  });
});

describe("suspicion tooltip", () => {
  it("counts down to the district's threshold at the real rate", () => {
    const s = cellarsColony();
    s.meta.district = 4; // Особняки: the Ratcatcher at 80%
    s.suspicion = 70;
    let i = suspicionInfo(s, derive(s));
    expect(i.threshold).toBe(80);
    expect(i.etaSec).toBeCloseTo(600, 9);
    s.commissions = { offered: [], done: 0, active: { id: "pipe_splinters", base: 0 } };
    i = suspicionInfo(s, derive(s));
    expect(i.perMin).toBeCloseTo(3, 9);
    expect(i.etaSec).toBeCloseTo(200, 9);
    s.timers.ratcatcherAt = s.time + 10; // summoned: he is on his way
    expect(suspicionInfo(s, derive(s)).etaSec).toBe(0);
  });
});

describe("the elder's hints", () => {
  it("food in deficit with the rats in slot jobs: names the crew to cut instead of a «Сделать» that moves nobody", () => {
    const s = cellarsColony();
    s.rats = 60;
    s.jobs.forager = 3;
    s.jobs.mechanic = 30;
    s.jobs.cheese_thief = 27;
    s.gross.crumbs = 1;
    const h = nextHint(s, derive(s))!;
    expect(h.id).toBe("hungry:mechanic");
    expect(h.text).toContain("из механиков");
    expect(h.target).toBe("j_mechanic");
    expect(h.action).toBeUndefined();
    // an idle rat can be moved: then «Сделать» assigns it
    s.jobs.cheese_thief = 26;
    const h2 = nextHint(s, derive(s))!;
    expect(h2.id).toBe("hungry");
    expect(h2.action).toEqual({ kind: "assign", job: "forager", n: 1 });
  });

  it("a nest dearer than the pantry holds asks for a bigger pantry, not the nest", () => {
    const s = createInitialState(777, 0);
    s.flags.vagrants = true;
    s.buildings.nest = 6;
    s.buildings.pantry = 2;
    s.rats = derive(s).housing;
    s.jobs.forager = s.rats;
    s.gross.crumbs = 50;
    s.res.crumbs = 350;
    const d = derive(s);
    expect(d.caps.crumbs).toBe(400);
    const h = nextHint(s, d)!;
    expect(h.id).toBe("housing:store");
    expect(h.target).toBe("b_pantry");
    expect(h.text).toContain("Гнездо стоит 640");
  });
});

describe("run records and texts", () => {
  it("the chronicle's best rating covers the whole run, not just the last 10 hauls", () => {
    const s = cellarsColony();
    s.zones.metro = true;
    s.eRun = 1e6; // the first crown
    s.runBestRating = "royal";
    s.haulLog = [];
    const ctx = quiet();
    const next = migrate(s, 0, ctx)!;
    expect(next.meta.history[next.meta.history.length - 1].bestRating).toBe("royal");
    expect(next.runBestRating).toBe("none");
    const summary = ctx.fx.find((f) => f.k === "migration");
    expect(summary && summary.k === "migration" && summary.summary.bestRating).toBe("royal");
  });

  it("an older save without the field takes the best of the hauls it kept", () => {
    const s = createInitialState(1, 0);
    s.haulLog = [{ title: "x", gained: {}, caughtCount: 1, totalCount: 1, share: 1, rating: "gold", ratingBonus: 0, combo: 0, suspicion: 0, crash: false, jackpot: false, notes: [] }];
    const raw = JSON.parse(serialize(s)) as Record<string, unknown>;
    delete raw.runBestRating;
    const back = deserialize(JSON.stringify(raw));
    expect(back && !isNewerSave(back) && back.runBestRating).toBe("gold");
  });

  it("express wagons count over all runs for «Хвост за горизонтом»", () => {
    const s = cellarsColony();
    s.upgrades.express_plan = true;
    s.express.stage = 10;
    s.meta.lifetime.wagons = 4;
    for (const [r, v] of Object.entries(expressCost(s))) s.res[r as keyof typeof s.res] = v as number;
    expect(contributeExpress(s, null, quiet())).toBe(true);
    expect(s.express.wagons).toBe(1);
    expect(s.meta.lifetime.wagons).toBe(5);
    expect(ACHIEVEMENTS.tail_horizon.progress).toEqual({ stat: "lifetime.wagons", goal: 15 });
    expect(progressStat(s, "lifetime.wagons")).toBe(5);
  });

  it("«Старые ходы» II opens the Cellars with the district's market interval (Боро-маркет sooner)", () => {
    const at = (district: number) => {
      const meta = defaultMeta();
      meta.edicts.old_tunnels = true;
      meta.edictRank.old_tunnels = 2;
      meta.district = district;
      return newRun(meta, defaultSettings(), 1, 0).timers.market;
    };
    expect(at(0)).toBe(540);
    expect(at(1)).toBe(270);
  });

  it("edict and upgrade texts name what the engine does", () => {
    const ranks = EDICTS.rat_memory.ranks!;
    // rank texts are whole statements (the edict card shows them instead of the base text): rank III repeats rank II
    RAT_MEMORY_RANKS.forEach((ids, i) => {
      for (const id of ids) for (let r = i; r < ranks.length; r++) expect(ranks[r].effect).toContain(`«${UPGRADES[id].name}»`);
    });
    expect(ranks[0].effect).toBe("Сохраняются первые 11 улучшений, а также «Бездонные карманы», «Зубчатые передачи» и «Расписание пневмопочты»");
    for (const r of EDICTS.timetable_in_head.ranks!) expect(r.effect).toContain("«Гул» +5 с, автосбор +0.10, риск аварии ×0.5");
    for (const r of EDICTS.old_tunnels.ranks!) expect(r.effect).toContain("Канализация и Подвалы открыты с начала");
    const hook = UPGRADES.grappling_hook.effect;
    expect(hook).toContain("×2.5…×4");
    expect(hook).toContain("до ×6");
    expect(hook).toContain("2 мин дохода");
    expect(hook).not.toContain("×5…×8");
  });
});
