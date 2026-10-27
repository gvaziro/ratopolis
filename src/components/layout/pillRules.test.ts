import { describe, expect, it } from "vitest";
import { RES_ORDER } from "@/game/data/resources";
import { ZONES } from "@/game/data/zones";
import { derive } from "@/game/engine/derive";
import { expeditionCost } from "@/game/engine/formulas";
import { createInitialState } from "@/game/engine/state";
import type { ResId } from "@/game/types";
import { goalResources, isUrgent, orderPills, pillLabel, spoken } from "./pillRules";

describe("spoken", () => {
  it("says the compact numbers the Russian way", () => {
    expect(spoken(10_100)).toBe("10,1 тыс.");
    expect(spoken(11_750)).toBe("11,75 тыс.");
    expect(spoken(1_500_000)).toBe("1,5 млн");
    expect(spoken(51_010_000_000)).toBe("51,01 млрд");
    expect(spoken(51_000_000_000)).toBe("51 млрд");
    expect(spoken(155)).toBe("155");
    expect(spoken(1.25)).toBe("1,25");
    expect(spoken(-3.5)).toBe("−3,5");
  });
});

describe("pillLabel", () => {
  it("names the resource, its stock, limit, rate and state", () => {
    const label = pillLabel({ res: "crumbs", amount: 10_100, cap: 11_800, rate: 155, full: false, over: true, hungry: false });
    expect(label).toBe("Крошки: 10,1 тыс. из 11,8 тыс., +155 в секунду, перегруз");
  });
  it("leaves out an unlimited cap and a standing rate, and says a full store and hunger", () => {
    expect(pillLabel({ res: "coins", amount: 40, cap: Infinity, rate: 0, full: false, over: false, hungry: false })).toBe("Монетки: 40");
    expect(pillLabel({ res: "crumbs", amount: 150, cap: 150, rate: -2, full: true, over: false, hungry: true })).toBe(
      "Крошки: 150 из 150, −2 в секунду, склад полон, голод",
    );
  });
});

describe("orderPills", () => {
  const shown: ResId[] = ["crumbs", "coins", "buttons", "wire", "gears", "cheese", "coal", "steam"];
  it("puts the goal first, then the urgent ones, then RES_ORDER, stable within each group", () => {
    const out = orderPills(shown, ["gears", "wire"], new Set<ResId>(["steam", "crumbs"]));
    expect(out).toEqual(["gears", "wire", "crumbs", "steam", "coins", "buttons", "cheese", "coal"]);
  });
  it("ignores goal resources that are not shown and never repeats a pill", () => {
    const out = orderPills(["crumbs", "coins"], ["brass", "coins"], new Set<ResId>(["coins"]));
    expect(out).toEqual(["coins", "crumbs"]);
  });
  it("keeps RES_ORDER when nothing asks for attention", () => {
    expect(orderPills(shown, [], new Set())).toEqual(shown);
  });
});

describe("isUrgent", () => {
  it("flags draining and full stores", () => {
    expect(isUrgent(10, 100, -1)).toBe(true);
    expect(isUrgent(100, 100, 2)).toBe(true);
    expect(isUrgent(10, 100, 2)).toBe(false);
    expect(isUrgent(10, Infinity, 0)).toBe(false);
  });
});

describe("goalResources", () => {
  it("lists what the offered expedition still lacks, in RES_ORDER", () => {
    const s = createInitialState(1, 0);
    s.settings.hints = false;
    s.revealed.exp_sewers = true;
    const cost = expeditionCost(s, "sewers");
    expect(Object.keys(cost).length).toBeGreaterThan(0);
    const out = goalResources(s, derive(s));
    expect(out).toEqual(RES_ORDER.filter((r) => (cost[r] ?? 0) > 0));
    expect(ZONES.sewers.expedition).toBeTruthy();
  });
  it("drops what has already been put in", () => {
    const s = createInitialState(1, 0);
    s.settings.hints = false;
    s.revealed.exp_sewers = true;
    const cost = expeditionCost(s, "sewers");
    const [first] = RES_ORDER.filter((r) => (cost[r] ?? 0) > 0);
    s.projects.sewers = { [first]: cost[first] };
    expect(goalResources(s, derive(s))).not.toContain(first);
  });
});
