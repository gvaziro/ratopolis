import { describe, expect, it } from "vitest";
import { derive } from "@/game/engine/derive";
import { metroState } from "@/game/engine/testkit";
import { suspicionTipModel } from "./suspicionTip";

describe("the 👁 tooltip (SH-3, pacing-8: vigilance before the train)", () => {
  it("names the share of train loot the humans keep above vigilanceFrom, as a warning", () => {
    const s = metroState(99, { quiet: true });
    s.suspicion = 90;
    const d = derive(s);
    expect(d.vigilanceFrom).toBe(50);
    const m = suspicionTipModel(s, d);
    expect(m.lost).toBe(true);
    expect(m.vig).toContain("Бдительность людей");
    expect(m.vig).toContain("−40%");
    expect(m.vig).toContain("выше 50 👁");
  });

  it("below the line it explains the rule instead, calmly", () => {
    const s = metroState(99, { quiet: true });
    s.suspicion = 30;
    const m = suspicionTipModel(s, derive(s));
    expect(m.lost).toBe(false);
    expect(m.vig).toContain("Бдительность людей");
    expect(m.vig).not.toMatch(/−\d+%/);
    // the old fields are unchanged
    expect(m.pct).toBe(30);
    expect(m.reducers).toContain("спрятаться от Кота −10");
  });
});
