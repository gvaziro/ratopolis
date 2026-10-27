import { describe, expect, it } from "vitest";
import { describeCond } from "../engine/conditions";
import { ZONE_IDS, type Cond } from "../types";
import { UPGRADES } from "./upgrades";
import { ZONES, zoneAdds } from "./zones";

/** The {migrations: n} part of a condition (undefined without one). */
function migrationsGate(c: Cond): number | undefined {
  if ("migrations" in c) return c.migrations;
  if ("all" in c) for (const x of c.all) if (migrationsGate(x) !== undefined) return migrationsGate(x);
  return undefined;
}

describe("zoneAdds: the map card's «what it brings» (v3 ENG-3, pacing-9)", () => {
  it("the Terminal promises the Крысиный экспресс and the coronation only after the first Great Migration", () => {
    const gate = migrationsGate(UPGRADES.express_plan.unlock);
    expect(gate).toBe(1);
    const run1 = zoneAdds("terminal", { migrations: 0 });
    expect(run1).toContain("Королевский экспресс");
    expect(run1).toContain(describeCond({ migrations: gate! }, () => ""));
    expect(run1).not.toMatch(/экспресс, Крысиный/); // not in the list of what the expedition brings
    const run2 = zoneAdds("terminal", { migrations: gate! });
    expect(run2).toBe("+200 жилья, 💍, Королевский экспресс, Крысиный экспресс и коронация");
    expect(zoneAdds("terminal", { migrations: 5 })).toBe(run2);
  });

  it("every other zone reads its static text in every run", () => {
    for (const z of ZONE_IDS) {
      if (z === "terminal") continue;
      expect(zoneAdds(z, { migrations: 0 })).toBe(ZONES[z].adds);
      expect(zoneAdds(z, { migrations: 3 })).toBe(ZONES[z].adds);
    }
  });
});
