import { describe, expect, it } from "vitest";
import type { EngineCtx, GameState } from "../types";
import { openZone } from "./actions";
import { derive } from "./derive";
import { onZoneOpen } from "./events";
import {
  converterBottleneck,
  inputRunway,
  jobValuePerRat,
  nextHint,
  ratsAcc,
  resourceSources,
  steamBreakdown,
  storageHintFor,
  suspicionInfo,
} from "./hints";
import { createInitialState } from "./state";

/** A small colony with the first visitors, fed and housed, every free job manned and rates positive. */
function colony(rats: number, nests: number): GameState {
  const s = createInitialState(42, 0);
  s.flags.vagrants = true;
  s.rats = rats;
  s.buildings.nest = nests;
  s.resEver.crumbs = 500;
  s.resEver.coins = 50;
  s.resEver.buttons = 20;
  s.resEver.wire = 20;
  s.jobs.forager = rats;
  s.gross.crumbs = 0.3 * rats;
  for (const r of ["crumbs", "coins", "buttons", "wire"] as const) s.rates[r] = 0.5;
  return s;
}

function open(s: GameState, ...zones: ("sewers" | "cellars" | "metro" | "terminal")[]): void {
  const ctx: EngineCtx = { fx: [] };
  for (const z of zones) {
    openZone(s, z, ctx);
    onZoneOpen(s, z);
  }
}

describe("nextHint", () => {
  it("1. food in deficit → send N rats back to foraging", () => {
    const s = colony(20, 10);
    s.jobs.forager = 1;
    s.jobs.pickpocket = 19;
    s.gross.crumbs = 0.3;
    const d = derive(s);
    const h = nextHint(s, d)!;
    expect(h.id).toBe("hungry");
    // food 0.8/s, one forager makes 0.3/s: a 0.5/s deficit needs 2 more
    expect(h.action).toEqual({ kind: "assign", job: "forager", n: 2 });
    expect(h.text).toBe("Еда в минусе: верните 2 крыс в собиратели");
    expect(h.tab).toBe("jobs");
    expect(h.target).toBe("j_forager");
    s.settings.hints = false;
    expect(nextHint(s, d)).toBeNull();
  });

  it("2. housing full and a nest within reach → build a nest", () => {
    const s = colony(3, 0);
    // every free resource has a gatherer (rule 3 comes first since v3)
    s.jobs.forager = 1;
    s.jobs.pickpocket = 1;
    s.jobs.scavenger = 1;
    s.res.crumbs = 6; // the first nest costs 10 ≤ 2 × 6
    const h = nextHint(s, derive(s))!;
    expect(h.id).toBe("housing");
    expect(h.action).toEqual({ kind: "buyBuilding", id: "nest" });
    expect(h.target).toBe("b_nest");
    s.res.crumbs = 4; // 10 > 2 × 4: too far away, nothing else to say yet
    expect(nextHint(s, derive(s))?.id).not.toBe("housing");
  });

  it("3. nobody picks pockets while a visible price wants coins → 3 rats to pickpockets", () => {
    const s = colony(10, 5);
    s.res.crumbs = 50;
    s.res.coins = 1;
    s.rates.coins = 0;
    s.jobs.scavenger = 2;
    s.jobs.forager = 8;
    const d = derive(s);
    const h = nextHint(s, d)!;
    expect(h.id).toBe("idle_job:pickpocket");
    expect(h.action).toEqual({ kind: "assign", job: "pickpocket", n: 3 });
    expect(h.text).toMatch(/^Монетки сами не копятся: отправьте 3 крыс в карманники \(\+[\d.]+ 🪙\/с\)$/);
    expect(h.why).toContain("«Тайник в табакерке»");
    expect(h.target).toBe("j_pickpocket");
  });

  it("4. a starved converter → the bottleneck text and its suppliers", () => {
    const s = colony(20, 10);
    open(s, "sewers");
    s.buildings.workshop = 1;
    s.jobs.forager = 13;
    s.jobs.pickpocket = 2;
    s.jobs.scavenger = 2;
    s.jobs.mechanic = 3;
    s.convEff.mechanic = 0.3;
    s.res.wire = 0;
    s.res.buttons = 100;
    s.gross.crumbs = 10;
    const d = derive(s);
    const h = nextHint(s, d)!;
    expect(h.id).toBe("converter:mechanic");
    expect(h.text).toContain("Не хватает ➰");
    expect(h.action?.kind).toBe("assign");
    expect(h.action).toMatchObject({ kind: "assign", job: "scavenger" });
    const b = converterBottleneck(s, d, "mechanic")!;
    expect(b.kind).toBe("input");
    expect(b.res).toBe("wire");
    expect(b.supplier).toBe("scavenger");
    expect(b.need).toBeGreaterThanOrEqual(1);
    expect(b.text).toMatch(/^Не хватает ➰\. Нужно ещё ~\d+ барахольщик/);
  });

  it("5. the expedition can take a real contribution → contribute", () => {
    const s = colony(15, 10);
    // no forager surplus (3 × 0.3 = 1.5 × the 0.6 upkeep): the rebalance rule (3b) stays quiet
    s.jobs.forager = 3;
    s.jobs.pickpocket = 6;
    s.jobs.scavenger = 6;
    s.res.crumbs = 100; // at the 100 cap: it would only spill over
    const h = nextHint(s, derive(s))!;
    expect(h.id).toBe("expedition:sewers");
    expect(h.action).toEqual({ kind: "contribute", zone: "sewers" });
    expect(h.tab).toBe("map");
    expect(h.target).toBe("z_sewers");
    expect(h.text).toContain("«Канализация»");
  });

  it("6. an affordable upgrade → invent it", () => {
    const s = colony(8, 3);
    s.jobs.forager = 4;
    s.jobs.pickpocket = 2;
    s.jobs.scavenger = 2;
    s.stats.clicks = 20;
    s.res.crumbs = 50;
    const h = nextHint(s, derive(s))!;
    expect(h.id).toBe("upgrade:sharp_teeth");
    expect(h.text).toBe("Можно изобрести «Острые резцы»");
    expect(h.action).toEqual({ kind: "buyUpgrade", id: "sharp_teeth" });
    expect(h.target).toBe("u_sharp_teeth");
  });

  it("7. a full store and an affordable bigger one → build it", () => {
    const s = colony(8, 3);
    s.jobs.forager = 4;
    s.jobs.pickpocket = 2;
    s.jobs.scavenger = 2;
    s.flags.hit_crumb_cap = true;
    s.revealed.res_crumbs = true;
    s.res.crumbs = 100;
    const h = nextHint(s, derive(s))!;
    expect(h.id).toBe("storage:crumbs");
    expect(h.action).toEqual({ kind: "buyBuilding", id: "pantry" });
    expect(h.text).toBe("Склад 🍞 полон — постройте «Кладовка в жестянке»");
  });

  it("returns null with hints off and on an empty colony", () => {
    const s = createInitialState(1, 0);
    expect(nextHint(s, derive(s))).toBeNull();
    const t = colony(3, 0);
    t.res.crumbs = 6;
    t.settings.hints = false;
    expect(nextHint(t, derive(t))).toBeNull();
  });
});

describe("storageHintFor", () => {
  it("names a visible store with its next level", () => {
    const s = colony(8, 3);
    s.flags.hit_crumb_cap = true;
    s.buildings.pantry = 2;
    const h = storageHintFor(s, derive(s), "crumbs");
    expect(h).toEqual({ text: "🥫 Кладовка в жестянке ур. 3", target: "b_pantry", buildingId: "pantry" });
  });

  it("explains a store of an open zone that is not unlocked yet", () => {
    const s = colony(8, 3);
    const h = storageHintFor(s, derive(s), "crumbs");
    expect(h.text).toBe("«Кладовка в жестянке» — откроется, когда упрётесь в лимит 🍞");
    expect(h.target).toBeUndefined();
    expect(h.buildingId).toBe("pantry");
  });

  it("says «в новой зоне» only when the store's zone is closed", () => {
    const s = colony(8, 3);
    const h = storageHintFor(s, derive(s), "gears");
    expect(h.text).toBe("«Жестяная мастерская» — в новой зоне «Канализация»");
    expect(h.target).toBe("z_sewers");
    open(s, "sewers");
    s.buildings.stash = 5; // the workshop's 300 🪙 and 150 🔘➰ fit the stores (a cap-locked store is never suggested)
    expect(storageHintFor(s, derive(s), "gears").text).not.toContain("в новой зоне");
  });
});

describe("suspicionInfo", () => {
  it("at 47% with no upgrades the ratcatcher is ≈ 53 minutes away, only while playing", () => {
    const s = colony(10, 5);
    open(s, "sewers", "cellars");
    s.suspicion = 47;
    const info = suspicionInfo(s, derive(s));
    expect(info.pct).toBe(47);
    expect(info.perMin).toBeCloseTo(1, 9);
    expect(info.activeOnly).toBe(true);
    expect(Math.abs(info.etaSec! - 3180)).toBeLessThanOrEqual(60);
    expect(info.reducers.map((r) => r.amount)).toEqual(expect.arrayContaining(["−10", "−25", "×0.7"]));
    s.upgrades.quiet_paws = true;
    const slow = suspicionInfo(s, derive(s));
    expect(slow.perMin).toBeCloseTo(0.7, 9);
    expect(slow.reducers.some((r) => r.amount === "×0.7")).toBe(false);
  });

  it("does not grow before the cellars", () => {
    const s = colony(10, 5);
    const info = suspicionInfo(s, derive(s));
    expect(info.perMin).toBe(0);
    expect(info.etaSec).toBeNull();
  });
});

describe("resourceSources / steam / jobs numbers", () => {
  it("lists open jobs with workers, producing buildings and event sources", () => {
    const s = colony(10, 5);
    s.jobs.pickpocket = 0;
    const src = resourceSources(s, "coins");
    expect(src[0]).toEqual({ icon: "🎩", label: "Карманники", kind: "job", job: "pickpocket", workers: 0 });
    expect(src.some((x) => x.kind === "click")).toBe(true);
    expect(src.some((x) => x.label === "Экипаж")).toBe(true);
    expect(src.some((x) => x.label === "пневмокапсулы")).toBe(false); // sewers still closed
    s.buildings.trash_chute = 1;
    expect(resourceSources(s, "crumbs").some((x) => x.kind === "building" && x.label === "Мусорный лаз")).toBe(true);
  });

  it("steamBreakdown names the fix", () => {
    const s = colony(40, 20);
    open(s, "sewers", "cellars", "metro");
    s.buildings.boiler = 1;
    s.buildings.brass_foundry = 2;
    s.jobs.smelter = 4;
    s.jobs.stoker = 0;
    s.gross.steam = 0;
    const d = derive(s);
    const b = steamBreakdown(s, d);
    expect(b.slots).toBe(2);
    expect(b.consumers.map((c) => c.id)).toEqual(["smelter"]);
    expect(b.consumers[0].perSec).toBeCloseTo(4, 9);
    expect(b.fix).toBe("stokers");
    s.jobs.stoker = 2;
    s.convEff.stoker = 0.4;
    expect(steamBreakdown(s, derive(s)).fix).toBe("miners");
    s.convEff.stoker = 1;
    s.gross.steam = 1;
    expect(steamBreakdown(s, derive(s)).fix).toBe("boiler");
    s.gross.steam = 10;
    s.steamEff = 1;
    expect(steamBreakdown(s, derive(s)).fix).toBeNull();
  });

  it("jobValuePerRat flags capped outputs and a crumb surplus; inputRunway finds the falling input", () => {
    const s = colony(10, 5);
    const d = derive(s);
    const pick = jobValuePerRat(s, d, "pickpocket");
    expect(pick.value).toBeCloseTo(0.065 * 1, 9);
    expect(pick.surplus).toBe(false);
    s.res.coins = d.caps.coins;
    expect(jobValuePerRat(s, d, "pickpocket")).toEqual({ value: 0, net: 0, surplus: false, capped: ["coins"] });
    expect(jobValuePerRat(s, d, "forager").surplus).toBe(true); // 3/s vs 0.4/s upkeep

    open(s, "sewers");
    s.buildings.workshop = 1;
    s.jobs.mechanic = 3;
    s.res.wire = 30;
    s.rates.wire = -0.5;
    s.rates.buttons = 0.2;
    expect(inputRunway(s, derive(s), "mechanic")).toEqual({ res: "wire", seconds: 60 });
    s.rates.wire = 0.1;
    expect(inputRunway(s, derive(s), "mechanic")).toBeNull();
  });

  it("ratsAcc agrees numerals with «крыса» in the accusative", () => {
    expect([1, 2, 3, 4, 5, 11, 21, 22, 25].map((n) => `${n} ${ratsAcc(n)}`)).toEqual([
      "1 крысу",
      "2 крыс",
      "3 крыс",
      "4 крыс",
      "5 крыс",
      "11 крыс",
      "21 крысу",
      "22 крысы",
      "25 крыс",
    ]);
  });
});
