import { describe, expect, it } from "vitest";
import { BUILDINGS } from "../data/buildings";
import { COMMISSIONS, RETIRED_COMMISSIONS, WAGON_OFFER_MAX_SEC } from "../data/commissions";
import { CREW_POSITIONS } from "../data/events";
import { ACHIEVEMENTS, EDICTS, EXPRESS_BASE, SEALS } from "../data/meta";
import { UPGRADES } from "../data/upgrades";
import { ZONES } from "../data/zones";
import type { CommissionId, CrewPosition, EngineCtx, GameState, ResId } from "../types";
import { buyBuilding, buyUpgrade, click, contributeExpress, expeditionFraction, openZone, upgradeVisible } from "./actions";
import { checkCommission, nextWagonEta, offerCommissions } from "./commissions";
import { describeCond } from "./conditions";
import { derive, resMult } from "./derive";
import { steamBudget, unitValue } from "./economy";
import { buildTrain, clickPurse, crashChance, expectedAuto, sceneAction, trainAuto, vigilance } from "./events";
import { expressStageCost } from "./formulas";
import { potentialRate } from "./goals";
import { steamBreakdown, suspicionInfo } from "./hints";
import { charterAtCap, charterMult, expressBonusPct } from "./metaMath";
import { commissionProgress } from "./progress";
import { deserialize, isNewerSave, serialize } from "./save";
import { createInitialState } from "./state";
import { step, TICK } from "./step";
import { metroState } from "./testkit";

const quietCtx = (): EngineCtx => ({ fx: [] });

function load(raw: unknown): GameState {
  const s = deserialize(JSON.stringify(raw));
  if (!s || isNewerSave(s)) throw new Error("load failed");
  return s;
}

/* ================================================================ ENG-3 */

describe("ENG-3: express and meta pacing", () => {
  it("(A) the express plan needs a Great Migration; an owned plan stays", () => {
    const s = metroState(1, { quiet: true });
    openZone(s, "terminal", quietCtx());
    s.buildings.clocktower = 1;
    s.res.blueprints = s.res.trinkets = 1e6;
    expect(s.meta.migrations).toBe(0);
    expect(upgradeVisible(s, "express_plan")).toBe(false);
    expect(buyUpgrade(s, "express_plan", quietCtx())).toBe(false);
    s.meta.migrations = 1;
    expect(upgradeVisible(s, "express_plan")).toBe(true);
    // a save that already owns it keeps it, migration or not
    const owned = metroState(2, { quiet: true });
    owned.upgrades.express_plan = true;
    expect(upgradeVisible(owned, "express_plan")).toBe(true);
    expect(UPGRADES.express_plan.lockedFlavor).toBe("Король выдаёт чертёж только колонии, пережившей Переселение");
    expect(describeCond(UPGRADES.express_plan.unlock, (_k, id) => id)).toContain("после первого Великого Переселения");
  });

  it("(A) «Короткая неделя» is a coronation in the second run", () => {
    expect(ACHIEVEMENTS.forever_tuesday).toMatchObject({ name: "Короткая неделя", desc: "Коронация во втором забеге", secret: true });
    const crown = (migrations: number) => {
      const s = metroState(3, { quiet: true });
      s.meta.migrations = migrations;
      s.upgrades.express_plan = true;
      s.express.stage = 9;
      for (const r of Object.keys(EXPRESS_BASE) as ResId[]) s.res[r] = 1e12;
      contributeExpress(s, null, quietCtx());
      expect(s.coronatedThisRun).toBe(true);
      return s.meta.achievements.forever_tuesday !== undefined;
    };
    expect(crown(0)).toBe(false);
    expect(crown(1)).toBe(true);
    expect(crown(2)).toBe(false);
  });

  it("(C) expeditionFraction weighs by value: one expensive and four cheap resources", () => {
    const s = metroState(4, { quiet: true });
    const cost = ZONES.terminal.expedition!.cost; // 🪙 8M and four cheap ones
    const prog: Partial<Record<ResId, number>> = {};
    let paid = 0;
    let total = 0;
    for (const [r, need] of Object.entries(cost) as [ResId, number][]) {
      // the four cheap ones in full, a quarter of the 🪙
      prog[r] = r === "coins" ? need / 4 : need;
      paid += Math.min(1, prog[r]! / need) * need * unitValue(r);
      total += need * unitValue(r);
    }
    s.projects.terminal = prog;
    expect(expeditionFraction(s, "terminal")).toBeCloseTo(paid / total, 12);
    // v2 read the plain mean: (4 + 0.25) / 5 = 85%; by value it is barely past a quarter
    expect(expeditionFraction(s, "terminal")).toBeLessThan(0.3);
    expect(expeditionFraction(s, "terminal")).toBeGreaterThan(0.25);
  });

  it("(D) every wagon is ×1.10: expressBonusPct equals derive's part for wagons 0..5", () => {
    for (let w = 0; w <= 5; w++) {
      const s = createInitialState(5, 0);
      s.express.stage = 10;
      s.express.wagons = w;
      const part = derive(s).globalParts.find((p) => p.label === "Крысиный экспресс")?.mult ?? 1;
      expect(part).toBeCloseTo(3 * Math.pow(1.1, w), 12);
      expect(expressBonusPct(s)).toBeCloseTo((part - 1) * 100, 9);
    }
    expect(ACHIEVEMENTS.tail_horizon.progress?.goal).toBe(10);
    expect(ACHIEVEMENTS.long_train.progress?.goal).toBe(5);
  });

  it("(E) every charter counts: charterMult(9) < charterMult(10)", () => {
    expect(charterMult({ charters: 9 })).toBeLessThan(charterMult({ charters: 10 }));
    expect(charterMult({ charters: 10 })).toBeCloseTo(Math.pow(1.05, 10), 12);
    expect(charterAtCap({ charters: 9 })).toBe(false);
    expect(charterAtCap({ charters: 10 })).toBe(true);
  });

  it("(F) the King never offers «Пополнение», nor «Ещё вагон» while the next wagon is > 480 s away", () => {
    expect(RETIRED_COMMISSIONS).toContain("replenish");
    expect(COMMISSIONS.clean_three).toMatchObject({ stat: "cleanCars", goal: 3, mode: "delta" });
    const crowned = () => {
      const s = metroState(6, { quiet: true });
      s.upgrades.express_plan = true;
      s.express.stage = 10;
      s.coronatedThisRun = true;
      return s;
    };
    const offered = (s: GameState) => {
      const seen = new Set<CommissionId>();
      for (let i = 0; i < 300; i++) {
        s.rng = (0x9e3779b9 * (i + 1)) >>> 0;
        offerCommissions(s);
        for (const id of s.commissions!.offered) seen.add(id);
      }
      return seen;
    };
    // no 🛤️⚙️🔔💍📜 income: the next wagon never comes
    const far = crowned();
    expect(nextWagonEta(far)).toBeGreaterThan(WAGON_OFFER_MAX_SEC);
    const a = offered(far);
    expect(a.has("replenish")).toBe(false);
    expect(a.has("wagon")).toBe(false);
    expect(a.has("clean_three")).toBe(true);
    // the wagon's price in stock: ETA 0, so the King may ask for it
    const near = crowned();
    for (const [r, v] of Object.entries(expressStageCost(near, 11)) as [ResId, number][]) near.res[r] = v;
    expect(nextWagonEta(near)).toBe(0);
    const b = offered(near);
    expect(b.has("wagon")).toBe(true);
    expect(b.has("replenish")).toBe(false);
  });

  it("(F) a v2 save holding «Пополнение» (offered and active) loads, and it finishes at 60 births", () => {
    const s0 = metroState(7, { quiet: true });
    s0.coronatedThisRun = true;
    s0.commissions = { offered: ["replenish", "wagon", "bullseye"], active: { id: "replenish", base: 10 }, done: 0 };
    s0.stats.births = 10;
    const raw = JSON.parse(serialize(s0)) as Record<string, unknown>;
    raw.schemaVersion = 2;
    delete raw.steamPriority;
    delete raw.hintMemo;
    const s = load(raw);
    expect(s.commissions?.active?.id).toBe("replenish");
    expect(s.commissions?.offered).toContain("replenish");
    expect(commissionProgress(s)).toEqual({ id: "replenish", cur: 0, goal: 60 });
    s.stats.births = 70;
    checkCommission(s, quietCtx());
    expect(s.charters).toBe(1);
    expect(s.commissions?.offered).not.toContain("replenish");
  });
});

/* ================================================================ ENG-4 */

/** Presses want 20 💨/s, smelters 10 and smiths 5; eight stokers make 24. */
function steamShortColony(priority: "works" | "power"): GameState {
  const s = metroState(11, { quiet: true });
  s.buildings.boiler = 4;
  s.buildings.steam_press = 10;
  s.buildings.brass_foundry = 5;
  s.buildings.rail_forge = 3;
  s.rats = 223;
  s.jobs.forager = 200;
  s.jobs.stoker = 8;
  s.jobs.smelter = 10;
  s.jobs.smith = 5;
  s.res.coal = 1e9;
  s.res.coins = 1e9;
  s.res.buttons = 1e9;
  s.res.brass = 1e6;
  s.res.crumbs = 1e9;
  s.steamPriority = priority;
  return s;
}

describe("ENG-4: steam as a budget", () => {
  it("the valve: 'power' feeds the presses first, 'works' the smelters and smiths (v2 order)", () => {
    const run = (p: "works" | "power") => {
      const s = steamShortColony(p);
      const d = derive(s);
      const b = steamBudget(s, d);
      expect(b.supply).toBeCloseTo(24, 6);
      expect(b.press).toBe(20);
      expect(b.conv).toBeCloseTo(15, 6);
      for (let i = 0; i < 400; i++) step(s, TICK, { active: false }, quietCtx());
      return s;
    };
    const power = run("power");
    expect(power.steamEff).toBeCloseTo(1, 6);
    expect(power.convEff.smelter).toBeLessThan(0.6);
    expect(power.convEff.smith).toBeLessThan(0.6);
    const works = run("works");
    expect(works.steamEff).toBeLessThan(0.6);
    expect(works.convEff.smelter).toBeGreaterThan(0.99);
    expect(works.convEff.smith).toBeGreaterThan(0.99);
  });

  it("the boiler stops at level 12; a save with 28 keeps the number, its effects equal level 12", () => {
    expect(BUILDINGS.boiler.maxLevel).toBe(12);
    expect(BUILDINGS.boiler.desc).toContain("макс. 12");
    const s = metroState(12, { quiet: true });
    s.res.wire = s.res.gears = s.res.coal = 1e15;
    s.buildings.boiler = 11;
    expect(buyBuilding(s, derive(s), "boiler", 10, quietCtx())).toBe(1);
    expect(s.buildings.boiler).toBe(12);
    expect(buyBuilding(s, derive(s), "boiler", 1, quietCtx())).toBe(0);
    expect(buyBuilding(s, derive(s), "boiler", "max", quietCtx())).toBe(0);
    const at12 = derive(s);
    s.buildings.boiler = 28;
    const old = load(JSON.parse(serialize(s)));
    expect(old.buildings.boiler).toBe(28);
    const d = derive(old);
    expect(d.boilerMax).toBe(12);
    expect(d.slots.stoker).toBe(at12.slots.stoker);
    expect(d.caps.steam).toBe(at12.caps.steam);
    expect(buyBuilding(old, d, "boiler", 1, quietCtx())).toBe(0);
  });

  it("the budget at the cap: 24 stokers × 3 × 1.5 × 1.25 = 135 💨/s, and the manometer line", () => {
    const s = metroState(13, { quiet: true });
    s.buildings.boiler = 12;
    s.upgrades.safety_valves = true;
    s.upgrades.tube_orders = true;
    s.rats = 224;
    s.jobs.forager = 200;
    s.jobs.stoker = 24;
    s.res.coal = 1e9;
    const d = derive(s);
    expect(d.slots.stoker).toBe(24);
    expect(steamBudget(s, d).supply).toBeCloseTo(135, 9);
    expect(UPGRADES.safety_valves.effect).toContain("+50% к бюджету пара");
    expect(steamBreakdown(s, d).budgetLine).toBe("бюджет 135 💨/с: прессы 0 · часы 0 · плавильни/кузни 0");
  });
});

/* ================================================================ ENG-8 */

describe("ENG-8: real choices", () => {
  it("(A) vigilance takes up to half of every train item above 50 👁, and the haul says how much", () => {
    for (let S = 0; S <= 50; S += 5) expect(vigilance(S)).toBe(1);
    expect(vigilance(100)).toBe(0.5);
    const build = (S: number) => {
      const s = metroState(21, { quiet: true });
      s.suspicion = S;
      return { s, sc: buildTrain(s, derive(s), "metro_train") };
    };
    const calm = build(20).sc;
    const { s, sc: wary } = build(80);
    expect(wary.items.length).toBe(calm.items.length);
    calm.items.forEach((it, i) => expect(wary.items[i].value).toBeCloseTo(it.value * 0.7, 9));
    expect(wary.vigilance).toBeCloseTo(0.3, 12);
    expect(calm.vigilance).toBeUndefined();
    s.scene = wary;
    sceneAction(s, derive(s), { a: "skip" }, quietCtx());
    expect(wary.haul?.vigilance).toBeCloseTo(0.3, 12);
    const info = suspicionInfo(s, derive(s));
    expect(info.vigilanceFrom).toBe(50);
    s.suspicion = 62;
    expect(suspicionInfo(s, derive(s)).vigilanceLine).toBe("Бдительность людей: −12% к добыче поездов (выше 50 👁)");
  });

  it("(B) offline efficiency never passes 100%; the time limit matches the rank texts", () => {
    const hours = (text: string) => Number(/лимит времени \+(\d+) ч/.exec(text)?.[1] ?? NaN);
    const texts = [EDICTS.eternal_night_shift.effect, ...EDICTS.eternal_night_shift.ranks!.map((r) => r.effect)];
    expect(texts.map(hours)).toEqual([4, 6, 8]);
    for (const night of [false, true]) {
      for (let rank = 0; rank <= 3; rank++) {
        const s = createInitialState(22, 0);
        s.upgrades.night_shift = night;
        if (rank > 0) {
          s.meta.edicts.eternal_night_shift = true;
          s.meta.edictRank.eternal_night_shift = rank;
        }
        const d = derive(s);
        expect(d.offline.eta).toBeLessThanOrEqual(1);
        expect(d.offline.capSec).toBe(3600 * (2 + (night ? 2 : 0) + (rank > 0 ? hours(texts[rank - 1]) : 0)));
      }
    }
  });

  it("(C) Dynasty and Silence reach 📜 and 💍; Silence no longer doubles the click; 💨 stays out", () => {
    const s = metroState(23, { quiet: true });
    s.meta.migrations = 3;
    const base = derive(s);
    const before = (r: ResId) => resMult(s, base, r);
    const bp = before("blueprints");
    const tr = before("trinkets");
    const st = before("steam");
    s.meta.sealsOwned = ["dynasty", "silence", "railway"];
    s.meta.seal = "dynasty";
    let d = derive(s);
    expect(d.excludedMult).toBeCloseTo(1.3, 12);
    expect(resMult(s, d, "blueprints") / bp).toBeCloseTo(1.3, 12);
    expect(resMult(s, d, "trinkets") / tr).toBeCloseTo(1.3, 12);
    expect(resMult(s, d, "steam")).toBe(st);
    s.meta.seal = "silence";
    d = derive(s);
    expect(d.excludedMult).toBeCloseTo(1.3, 12);
    expect(d.click).toBe(base.click);
    expect(resMult(s, d, "blueprints") / bp).toBeCloseTo(1.3, 12);
    expect(SEALS.silence.effect).toBe("Подозрение не растёт, Кот и Крысолов не приходят; 📜 и 💍 ×1.3");
    expect(SEALS.dynasty.effect).toContain("включая 📜 и 💍");
  });

  it("(D) «Золотые усы» II/III: 20% / 30% of purses hold 3 / 6 💍; rank I none", () => {
    const watches = (rank: number) => {
      const s = metroState(24, { quiet: true });
      s.meta.edicts.golden_whiskers = true;
      s.meta.edictRank.golden_whiskers = rank;
      let hits = 0;
      for (let i = 0; i < 400; i++) {
        const before = s.res.trinkets;
        s.purse = { x: 0.5, y: 0.5, until: s.time + 10 };
        clickPurse(s, derive(s), quietCtx());
        if (s.res.trinkets > before) hits++;
        s.res.trinkets = before;
      }
      return hits / 400;
    };
    expect(watches(1)).toBe(0);
    expect(watches(2)).toBeGreaterThan(0.15);
    expect(watches(2)).toBeLessThan(0.25);
    expect(watches(3)).toBeGreaterThan(0.25);
    expect(watches(3)).toBeLessThan(0.35);
    for (const r of EDICTS.golden_whiskers.ranks!) expect(r.effect).toMatch(/шансом \d+% несёт ещё \d+ 💍/);
  });

  it("(D) «Лапы предков» II/III: a paw click brings 0.5% / 1% of the potential 📜/s", () => {
    const clickGain = (rank: number, auto = false) => {
      const s = metroState(25, { quiet: true });
      s.buildings.library = 5;
      s.jobs.scholar = 10;
      s.jobs.forager = 190;
      s.res.cheese = 1e6;
      s.meta.edicts.ancestral_paws = true;
      s.meta.edictRank.ancestral_paws = rank;
      const d = derive(s);
      const rate = potentialRate(s, d, "blueprints");
      expect(rate).toBeGreaterThan(0);
      const before = s.res.blueprints;
      click(s, d, quietCtx(), { auto });
      return (s.res.blueprints - before) / rate;
    };
    expect(clickGain(1)).toBe(0);
    expect(clickGain(2)).toBeCloseTo(0.005, 12);
    expect(clickGain(3)).toBeCloseTo(0.01, 12);
    expect(clickGain(3, true)).toBe(0);
    expect(EDICTS.ancestral_paws.ranks!.map((r) => r.effect)).toEqual([
      "Клик ×6 навсегда; каждый клик лапой приносит ещё 0.5% выработки 📜/с",
      "Клик ×12 навсегда; каждый клик лапой приносит ещё 1% выработки 📜/с",
    ]);
  });

  it("(E) the crew position is a gamble: the expected auto table, and no position is best everywhere", () => {
    expect(CREW_POSITIONS.wall.auto).toBe(0.85);
    expect(CREW_POSITIONS.ties.auto).toBe(1.15);
    const rel = (pos: CrewPosition, variant: "normal" | "freight", base: number) => expectedAuto(pos, variant, base) / base;
    expect(rel("ties", "normal", 0.5)).toBeCloseTo(1.064, 3);
    expect(rel("rails", "normal", 0.5)).toBeCloseTo(0.975, 12);
    expect(rel("wall", "normal", 0.5)).toBeCloseTo(0.85, 12);
    const best = (variant: "normal" | "freight", base: number) =>
      (["wall", "rails", "ties"] as const).reduce((a, p) => (expectedAuto(p, variant, base) > expectedAuto(a, variant, base) ? p : a));
    const winners = new Set([best("normal", 0.5), best("freight", 0.5), best("normal", 1.2)]);
    expect(winners.size).toBeGreaterThan(1);
    expect(best("normal", 1.2)).toBe("wall"); // at the 0.9 cap only the safe wall keeps it whole
    expect(crashChance("ties", "freight")).toBeCloseTo(0.3, 12);
  });

  it("(E) a crash sets scene.crash and halves this train's auto-collect", () => {
    let crashes = 0;
    let calm = 0;
    for (let seed = 1; seed <= 80; seed++) {
      const s = metroState(seed, { quiet: true });
      const d = derive(s);
      const sc = buildTrain(s, d, "metro_train");
      sc.position = "ties";
      s.scene = sc;
      const full = trainAuto(s, d, sc);
      const scared = s.stunned.length;
      sceneAction(s, d, { a: "ready" }, quietCtx());
      const ready = Math.min(0.9, (d.trainAutoBase + 0.15) * CREW_POSITIONS.ties.auto);
      if (sc.crash) {
        crashes++;
        expect(sc.auto).toBeCloseTo(0.5 * ready, 12);
        expect(s.stunned.length).toBe(scared + 1); // the 3% / 90 s scare stays; nobody dies (GDD 8.2.8)
        sceneAction(s, d, { a: "skip" }, quietCtx());
        expect(sc.haul?.notes.some((n) => n.startsWith("Авария") && n.includes("автосбор ×0.5"))).toBe(true);
      } else {
        calm++;
        expect(sc.auto).toBeCloseTo(ready, 12);
      }
      expect(full).toBeGreaterThan(0);
    }
    expect(crashes).toBeGreaterThan(0);
    expect(calm).toBeGreaterThan(crashes);
  });
});
