import { describe, expect, it } from "vitest";
import { BUILDINGS } from "../data/buildings";
import type { EngineCtx, GameState, JobId } from "../types";
import { applyReveals, openZone, setFocus } from "./actions";
import { derive } from "./derive";
import { onZoneOpen } from "./events";
import { buildingCost } from "./formulas";
import {
  autoFocus,
  buildNowPick,
  currentProject,
  expeditionBottleneck,
  expressBottleneck,
  foragersNeeded,
  jobFor,
  newbornTarget,
  potentialRate,
  potentialRates,
  projectBottleneck,
} from "./goals";
import { applyHintAction, HINT_MUTE_SEC, HINT_STALE_SEC, hintTaken, nextHint, storageHintFor, STORE_LEVELS_MAX, trackHint } from "./hints";
import { createInitialState } from "./state";
import { fixtureNames, loadFixture, ticks } from "./testkit";

/** A burrow colony with its first visitors: `rats` rats, `nests` nests, the free jobs as given, rates positive. */
function burrow(rats: number, nests: number, jobs: Partial<Record<JobId, number>>): GameState {
  const s = createInitialState(42, 0);
  s.flags.vagrants = true;
  s.rats = rats;
  s.buildings.nest = nests;
  s.resEver.crumbs = 500;
  s.resEver.coins = 50;
  s.resEver.buttons = 20;
  s.resEver.wire = 20;
  for (const [j, n] of Object.entries(jobs)) s.jobs[j as JobId] = n;
  s.gross.crumbs = 0.3 * (jobs.forager ?? 0);
  for (const r of ["crumbs", "coins", "buttons", "wire"] as const) s.rates[r] = 0.5;
  return s;
}

/** The Sewers open, 40 rats (the Cellars expedition on the map), a workshop nobody works in yet, stores of 🔘➰. */
function sewersColony(): GameState {
  const s = burrow(40, 25, { forager: 20, pickpocket: 10, scavenger: 10 });
  const ctx: EngineCtx = { fx: [] };
  openZone(s, "sewers", ctx);
  onZoneOpen(s, "sewers");
  s.buildings.workshop = 1;
  s.buildings.stash = 5;
  s.res.buttons = 100;
  s.res.wire = 100;
  s.res.crumbs = 50;
  return s;
}

describe("goals: potential production and the bottleneck (ENG-1)", () => {
  it("potential rates ignore a full store; converters run at the inputs there are", () => {
    const s = sewersColony();
    const d = derive(s);
    s.res.crumbs = d.caps.crumbs; // full: s.rates / s.gross would read ~0 here
    // 20 foragers × 0.3 − 40 rats × 0.04 upkeep
    expect(potentialRate(s, d, "crumbs")).toBeCloseTo(20 * 0.3 * d.tierMult * d.global * d.temp - 1.6, 6);
    s.jobs.mechanic = 3;
    s.jobs.scavenger = 7;
    s.res.buttons = 0;
    s.res.wire = 0;
    // 7 scavengers make 0.35 🔘/s, 3 mechanics want 0.3: full speed, and the 🔘 left over is 0.05/s
    const r = potentialRates(s, derive(s));
    expect(r.gears).toBeGreaterThan(0.29);
    expect(r.buttons).toBeCloseTo(0.05, 2);
    s.jobs.scavenger = 1; // 0.05 🔘/s for 0.3 wanted: a sixth
    expect(potentialRates(s, derive(s)).gears).toBeCloseTo(0.3 / 6, 2);
  });

  it("projectBottleneck never returns NaN; Infinity when nothing makes the resource (also on every golden save)", () => {
    const s = sewersColony();
    const d = derive(s);
    expect(projectBottleneck(s, d, { gears: 650 })!.etaSec).toBe(Infinity);
    expect(projectBottleneck(s, d, { coins: 0 })).toBeNull();
    for (const name of fixtureNames()) {
      const f = loadFixture(name);
      const fd = derive(f);
      const p = currentProject(f);
      const b = p?.kind === "expedition" ? expeditionBottleneck(f, fd, p.zone) : p ? expressBottleneck(f, fd) : null;
      if (b) {
        expect(Number.isNaN(b.etaSec), name).toBe(false);
        expect(Number.isFinite(b.remaining), name).toBe(true);
      }
      for (const v of Object.values(potentialRates(f, fd))) expect(Number.isFinite(v), name).toBe(true);
    }
  });

  it("jobFor sends a rat to the input's maker when a converter starves", () => {
    const s = sewersColony();
    expect(jobFor(s, derive(s), "gears")).toBe("mechanic"); // stock of 🔘➰: room and inputs
    s.jobs.mechanic = 3;
    s.res.buttons = 0;
    s.res.wire = 0;
    s.jobs.scavenger = 0;
    s.jobs.forager = 30;
    s.buildings.workshop = 2;
    expect(jobFor(s, derive(s), "gears")).toBe("scavenger");
    s.buildings.workshop = 1;
    s.jobs.scavenger = 10;
    s.res.buttons = 100;
    s.res.wire = 100;
    expect(jobFor(s, derive(s), "gears")).toBeNull(); // 3/3 mechanics: no room
  });
});

describe("the elder 2.0 (ENG-1)", () => {
  it("(a) a workshop nobody works in while the Cellars want ⚙️ → empty_crew:mechanic with an assign", () => {
    const s = sewersColony();
    const d = derive(s);
    expect(currentProject(s)).toEqual({ kind: "expedition", zone: "cellars" });
    const h = nextHint(s, d)!;
    expect(h.id).toBe("empty_crew:mechanic");
    expect(h.action).toEqual({ kind: "assign", job: "mechanic", n: 3 });
    expect(h.text).toMatch(/^«Жестяная мастерская» пустует: поставьте 3 крыс в механики \(\+[\d.]+ ⚙️\/с\)$/);
    expect(h.why).toBe("⚙️ ждёт экспедиция «Подвалы» (650)");
    // «Сделать» takes the foragers first and leaves the colony fed
    applyHintAction(s, d, h, { fx: [] });
    expect(s.jobs).toMatchObject({ mechanic: 3, forager: 17, pickpocket: 10, scavenger: 10 });
  });

  it("(a′) no workshop at all while ⚙️ holds the Cellars up → more_slots:workshop, with «Сделать» when affordable", () => {
    const s = sewersColony();
    s.buildings.workshop = 0;
    s.res.buttons = 30; // no upgrade affordable either: what to save for comes last
    s.res.wire = 30;
    const h = nextHint(s, derive(s))!;
    expect(h.id).toBe("more_slots:workshop");
    expect(h.text).toBe("⚙️ никто не делает — стройте «Жестяная мастерская»: там работают механики");
    expect(h.action).toBeUndefined(); // 🪙 0: not affordable yet
    s.res.coins = 300;
    s.res.buttons = 150;
    s.res.wire = 150;
    expect(nextHint(s, derive(s))!.action).toEqual({ kind: "buyBuilding", id: "workshop" });
    // the slots are full: «ещё одну»
    s.buildings.workshop = 1;
    s.jobs.mechanic = 3;
    s.jobs.forager = 17;
    s.res.coins = 0;
    s.res.buttons = 30;
    s.res.wire = 30;
    s.projects.cellars = { coins: 8500, buttons: 3500 }; // only ⚙️ left: the slow one
    s.buildings.stash = 10; // the second workshop's 390 🪙 fit the store
    const full = nextHint(s, derive(s))!;
    expect(full.id).toBe("more_slots:workshop");
    expect(full.text).toBe("⚙️ делают только механики, мест 3/3 — стройте ещё «Жестяная мастерская»");
  });

  it("(b) 9 foragers on a full pantry, 3 pickpockets, 🪙 holding the Sewers up → rebalance:pickpocket, n ≥ 4", () => {
    const s = burrow(14, 10, { forager: 9, pickpocket: 3, scavenger: 2 });
    const d = derive(s);
    s.res.crumbs = d.caps.crumbs;
    expect(expeditionBottleneck(s, d, "sewers")!.res).toBe("coins");
    const h = nextHint(s, d)!;
    expect(h.id).toBe("rebalance:pickpocket");
    expect(h.action).toMatchObject({ kind: "assign", job: "pickpocket", setFocus: true });
    const n = h.action?.kind === "assign" ? h.action.n : 0;
    expect(n).toBeGreaterThanOrEqual(4);
    expect(h.text).toMatch(/^Крошек вдоволь \(\+2\.7\/с при прокорме 0\.56\/с\), а 🪙 для «Канализации» копить ≈ \d+ ч: переведите \d+ собирател(я|ей) в карманники$/);
    // «Сделать»: the rats move, the newborns follow, the focus is not «manual»
    applyHintAction(s, d, h, { fx: [] });
    expect(s.jobs.pickpocket).toBe(3 + n);
    expect(s.jobs.forager).toBe(9 - n);
    expect(s.focus).toBe("pickpocket");
    expect(s.flags.focus_manual).toBeUndefined();
    // the colony is still fed above 1.3× its upkeep
    expect(s.jobs.forager).toBeGreaterThanOrEqual(foragersNeeded(s, derive(s), 1.3));
  });

  it("(c) with the crew there and a nest costing more than 120 s of income, the elder does not ask for housing", () => {
    // Sewers paid in 🪙➰: only 🍞 is left, so no rebalance; every free job manned
    const s = burrow(21, 9, { forager: 15, pickpocket: 3, scavenger: 3 });
    s.projects.sewers = { coins: 1500, wire: 600 };
    s.buildings.pantry = 40;
    let d = derive(s);
    s.rats = d.housing;
    s.jobs.forager = s.rats - 6;
    d = derive(s);
    const nest = buildingCost("nest", s.buildings.nest).crumbs!;
    s.res.crumbs = Math.min(d.caps.crumbs, nest);
    expect(s.rats).toBeGreaterThanOrEqual(20);
    expect(nest).toBeGreaterThan(120 * potentialRate(s, d, "crumbs"));
    expect(nextHint(s, d)?.id ?? "").not.toMatch(/^housing/);
    // the same nest within two minutes of 🍞: the housing hint is back
    s.buildings.trash_chute = 400;
    d = derive(s);
    expect(nest).toBeLessThan(120 * potentialRate(s, d, "crumbs"));
    expect(nextHint(s, d)?.id).toBe("housing");
  });

  it("(c′) before the crew, a dear nest is still asked for", () => {
    const s = burrow(15, 6, { forager: 3, pickpocket: 6, scavenger: 6 });
    s.buildings.pantry = 40;
    const d = derive(s);
    s.rats = d.housing;
    s.jobs.scavenger = s.rats - 9;
    s.res.crumbs = 5000;
    expect(s.rats).toBeLessThan(20);
    expect(nextHint(s, derive(s))?.id).toBe("housing");
  });

  it("(d) pantry 13 with the Sewers open: the store for a 2.56K nest is the sewer warehouse, never «ур. 29»", () => {
    const s = sewersColony();
    s.buildings.pantry = 13;
    s.buildings.stash = 4;
    const d = derive(s);
    expect(buildingCost("pantry", 13).crumbs!).toBeGreaterThan(d.caps.crumbs); // the pantry is locked behind itself
    const h = storageHintFor(s, d, "crumbs", 2560);
    expect(h.buildingId).toBe("sewer_warehouse");
    expect(h.text).toBe(`${BUILDINGS.sewer_warehouse.icon} ${BUILDINGS.sewer_warehouse.name} ур. 1`);
    // no suggestion ever asks a store for more than 3 levels or names a level locked behind a cap
    for (const pantry of [0, 2, 5, 9, 13, 20]) {
      for (const stash of [0, 4]) {
        for (const price of [150, 500, 2560, 1e4, 1e5, 1e7]) {
          s.buildings.pantry = pantry;
          s.buildings.stash = stash;
          s.flags.hit_crumb_cap = true;
          const dd = derive(s);
          const x = storageHintFor(s, dd, "crumbs", price);
          const m = /ур\. (\d+)/.exec(x.text);
          if (!m || !x.buildingId) continue;
          expect(Number(m[1]) - s.buildings[x.buildingId], `${pantry}/${stash}/${price}`).toBeLessThanOrEqual(STORE_LEVELS_MAX);
          expect(buildingCost(x.buildingId, s.buildings[x.buildingId]).crumbs ?? 0).toBeLessThanOrEqual(dd.caps.crumbs);
        }
      }
    }
  });

  it("5. the contribution keeps back the price of the building that starts a missing resource", () => {
    const s = sewersColony();
    s.buildings.workshop = 0;
    s.buildings.stash = 10;
    s.upgrades.nimble_tails = true; // (else the elder would offer it for the 🪙 left)
    const d = derive(s);
    s.res.coins = d.caps.coins; // a full store of 🪙
    s.res.buttons = 30; // the workshop wants 150 🔘: not affordable yet, its price is kept
    s.res.wire = 30;
    const h = nextHint(s, d)!;
    expect(h.id).toBe("expedition:cellars");
    expect(h.action).toEqual({ kind: "contribute", zone: "cellars", keep: buildingCost("workshop", 0) });
    expect(h.text).toBe(`Внесите в экспедицию «Подвалы»: 🪙 ${d.caps.coins - 300}`);
    expect(h.why).toContain("на «Жестяная мастерская» отложено 300 🪙");
    applyHintAction(s, d, h, { fx: [] });
    expect(s.res.coins).toBeCloseTo(300, 6);
    expect(s.projects.cellars?.coins).toBeCloseTo(d.caps.coins - 300, 6);
    // nothing left to give: what to save for comes last
    expect(nextHint(s, derive(s))?.id).toBe("more_slots:workshop");
  });

  it("6. «Мешочки из носков» on a full pantry nobody needs more of is skipped", () => {
    // 6 foragers make 1.8 🍞/s for a 0.32 upkeep: a surplus; no expedition on the map yet
    const s = burrow(8, 10, { forager: 6, pickpocket: 1, scavenger: 1 });
    s.buildings.pantry = 2;
    s.res.crumbs = 300;
    expect(nextHint(s, derive(s))?.id).toBe("upgrade:forager_sacks");
    s.res.crumbs = derive(s).caps.crumbs;
    expect(nextHint(s, derive(s))?.id).not.toBe("upgrade:forager_sacks");
  });

  it("1b. a paid expedition with its crew: dig", () => {
    const s = burrow(20, 10, { forager: 14, pickpocket: 3, scavenger: 3 });
    s.projects.sewers = { crumbs: 4500, coins: 1500, wire: 600 };
    const h = nextHint(s, derive(s))!;
    expect(h.id).toBe("dig:sewers");
    expect(h.action).toEqual({ kind: "contribute", zone: "sewers" });
    applyHintAction(s, derive(s), h, { fx: [] });
    expect(s.digging?.zone).toBe("sewers");
  });

  it("hysteresis: a hint left alone for 3 minutes yields to the next rule for a minute; taking it restarts the clock", () => {
    const s = burrow(14, 10, { forager: 9, pickpocket: 3, scavenger: 2 });
    const d = derive(s);
    s.res.crumbs = d.caps.crumbs;
    expect(trackHint(s, d)?.id).toBe("rebalance:pickpocket");
    s.time = HINT_STALE_SEC - 1;
    expect(trackHint(s, d)?.id).toBe("rebalance:pickpocket");
    s.time = HINT_STALE_SEC + 1;
    const next = trackHint(s, d);
    expect(next?.id).not.toBe("rebalance:pickpocket");
    expect(s.hintMemo).toMatchObject({ muted: "rebalance:pickpocket", mutedUntil: HINT_STALE_SEC + 1 + HINT_MUTE_SEC });
    expect(nextHint(s, d)?.id).toBe(next?.id);
    s.time += HINT_MUTE_SEC + 1;
    expect(trackHint(s, d)?.id).toBe("rebalance:pickpocket");
    // followed: not muted while the player keeps taking it
    const t0 = s.time;
    s.time = t0 + 150;
    hintTaken(s, "rebalance:pickpocket");
    s.time = t0 + 300;
    expect(trackHint(s, d)?.id).toBe("rebalance:pickpocket");
  });

  it("(h) the goal widget comes with the first visitors", () => {
    const s = createInitialState(5, 0);
    s.time = 15;
    applyReveals(s);
    expect(s.revealed.goal).toBeUndefined();
    s.flags.vagrants = true;
    applyReveals(s);
    expect(s.revealed.goal).toBe(true);
  });
});

describe("the auto newborn focus (ENG-1)", () => {
  /** A fresh colony at the Sewers with 🍞 to spare: 14 rats, room for 20 more. */
  function freshSewers(): GameState {
    const s = burrow(14, 20, { forager: 10, pickpocket: 2, scavenger: 2 });
    s.buildings.trash_chute = 3;
    s.res.crumbs = 60;
    return s;
  }

  function births(s: GameState, n: number): JobId[] {
    const out: JobId[] = [];
    for (let i = 0; i < 4000 && out.length < n; i++) for (const f of ticks(s, 1)) if (f.k === "birth") out.push(f.job);
    return out.slice(0, n);
  }

  it("(e) the next 5 newborns go where the Sewers need them; after the player's own star they go there", () => {
    const s = freshSewers();
    const t = newbornTarget(s, derive(s));
    expect(t.auto).toBe(true);
    expect(t.job).toBe("pickpocket");
    expect(t.reason).toBe("для «Канализации» не хватает 🪙");
    const five = births(s, 5);
    expect(five).toHaveLength(5);
    for (const j of five) expect(["pickpocket", "scavenger"]).toContain(j);
    // store.setFocus = setFocus + flags.focus_manual
    setFocus(s, "forager");
    s.flags.focus_manual = true;
    expect(newbornTarget(s, derive(s))).toEqual({ job: "forager", auto: false, reason: null });
    for (const j of births(s, 3)) expect(j).toBe("forager");
  });

  it("forages while 🍞 is short of 1.3× the upkeep; stays automatic in focus mode, stops with ratios or the smart mode", () => {
    const s = freshSewers();
    s.buildings.trash_chute = 0;
    s.jobs.forager = 2;
    s.jobs.pickpocket = 6;
    s.jobs.scavenger = 6;
    const a = autoFocus(s, derive(s));
    expect(a.job).toBe("forager");
    expect(a.reason).toBe("крошек впритык: сперва прокормить колонию");
    // «Цепочка передачи» bought, the star still never touched: the colony keeps choosing
    s.upgrades.rat_relay = true;
    expect(newbornTarget(s, derive(s)).auto).toBe(true);
    s.assignMode = "ratios";
    expect(newbornTarget(s, derive(s)).auto).toBe(false);
    s.assignMode = "smart";
    expect(newbornTarget(s, derive(s)).auto).toBe(false);
  });

  it("a save with a hand-picked focus keeps the v2 rule (migration sets focus_manual)", () => {
    const s = freshSewers();
    s.focus = "scavenger";
    s.flags.focus_manual = true;
    expect(newbornTarget(s, derive(s))).toEqual({ job: "scavenger", auto: false, reason: null });
  });
});

describe("buildNowPick (ENG-1)", () => {
  it("(f) 🍞 full and 🪙 the Sewers bottleneck: the pickpocket school, not the trash chute", () => {
    const s = burrow(16, 10, { forager: 10, pickpocket: 3, scavenger: 3 });
    s.buildings.pantry = 2;
    let d = derive(s);
    s.res.crumbs = d.caps.crumbs;
    s.res.coins = 45;
    d = derive(s);
    expect(expeditionBottleneck(s, d, "sewers")!.res).toBe("coins");
    const pick = buildNowPick(s, d)!;
    expect(["pickpocket_school", "stash"]).toContain(pick.id);
    expect(pick.kind).toBe("useful");
    expect(pick.minutesSaved!).toBeGreaterThan(1);
  });

  it("the first workshop counts its ⚙️ (its new slots manned) when the Cellars wait for gears", () => {
    const s = sewersColony();
    s.buildings.workshop = 0;
    s.res.coins = 300;
    s.res.buttons = 150;
    s.res.wire = 150;
    const pick = buildNowPick(s, derive(s))!;
    expect(pick).toMatchObject({ id: "workshop", kind: "useful" });
  });
});
