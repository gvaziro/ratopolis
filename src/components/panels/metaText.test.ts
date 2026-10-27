import { describe, expect, it } from "vitest";
import { CURIO_SETS } from "@/game/data/curios";
import { EXPRESS_STAGE_LINES, EXPRESS_STAGE_LINE_SETS, EXPRESS_STAGES, expressStageLine } from "@/game/data/meta";
import { derive } from "@/game/engine/derive";
import { charterAtCap, charterMult, crownBonusMult } from "@/game/engine/metaMath";
import { expressLineSet } from "@/game/engine/narrative";
import { createInitialState } from "@/game/engine/state";
import type { GameState } from "@/game/types";
import { charterText, crownBonus, expressBonus, expressStageLines, pctText } from "./metaText";

/** PAN-2 (balance-6): the panels print the multipliers derive() really applies. */
function part(s: GameState, label: string): number {
  return derive(s).globalParts.find((p) => p.label === label)?.mult ?? 1;
}

function withExpress(stage: number, wagons: number): GameState {
  const s = createInitialState(1, 0);
  s.express.stage = stage;
  s.express.wagons = wagons;
  return s;
}

describe("metaText", () => {
  it("pctText: whole numbers whole, one decimal otherwise, compact past a thousand", () => {
    expect(pctText(0)).toBe("0");
    expect(pctText(40)).toBe("40");
    expect(pctText(40.0000001)).toBe("40");
    expect(pctText(33.1)).toBe("33.1");
    expect(pctText(3.993)).toBe("4");
    expect(pctText(2.25)).toBe("2.3");
    expect(pctText(1250)).toBe("1.25K");
    expect(pctText(NaN)).toBe("—");
  });

  it("the express badge equals derive's «Крысиный экспресс» part for wagons 0..5 after the coronation", () => {
    for (let w = 0; w <= 5; w++) {
      const s = withExpress(10, w);
      const b = expressBonus(s);
      const now = part(s, "Крысиный экспресс");
      const then = part(withExpress(10, w + 1), "Крысиный экспресс");
      expect(b.total, `wagons ${w}`).toBe(pctText((now - 1) * 100));
      // pacing-4: the next wagon is ×1.1 on current production, +10% as its toast says (not the badge's +30…+48 points)
      expect(b.next, `wagons ${w}`).toBe(pctText((then / now - 1) * 100));
      expect(b.next).toBe("10");
      expect(b.wagon).toBe("1.1");
      // «бонус экспресса станет +X%»: derive with one wagon more
      expect(b.after, `wagons ${w}`).toBe(pctText((then - 1) * 100));
    }
  });

  it("before the coronation the next step is the next stage", () => {
    for (let st = 0; st < 10; st++) {
      const s = withExpress(st, 0);
      const now = part(s, "Крысиный экспресс");
      const then = part(withExpress(st + 1, 0), "Крысиный экспресс");
      expect(expressBonus(s).total).toBe(pctText((now - 1) * 100));
      expect(expressBonus(s).next).toBe(pctText((then - now) * 100));
      expect(expressBonus(s).after).toBe(pctText((then - 1) * 100));
    }
  });

  it("the crown bonus equals derive's «Венцы» part", () => {
    for (const crowns of [0, 7, 120, 1394]) {
      for (const favor of [false, true]) {
        const s = createInitialState(1, 0);
        s.meta.crownsEver = crowns;
        if (favor) s.meta.edicts.kings_favor = true;
        const c = crownBonus(s.meta);
        expect(c.total).toBe(pctText((part(s, "Венцы") - 1) * 100));
        expect(c.per).toBe(favor ? 3 : 2);
      }
    }
  });

  it("charters read charterMult and charterAtCap", () => {
    for (let n = 0; n <= 10; n++) {
      const t = charterText({ charters: n });
      expect(t.mult).toBe(charterMult({ charters: n }).toFixed(2));
      expect(t.atCap).toBe(charterAtCap({ charters: n }));
      expect(t.cap).toBe("1.63");
    }
  });

  it("with the full «Город» set the charter badge and cap are what the crowns pay (pacing-6)", () => {
    const s = createInitialState(1, 0);
    s.meta.curios = [...CURIO_SETS.city.items];
    for (const n of [0, 1, 5, 10]) {
      s.charters = n;
      const t = charterText(s);
      // crownsForRun multiplies by crownBonusMult: ×1.25 for the coronation (not here) times the charters
      expect(t.mult, `charters ${n}`).toBe(crownBonusMult(s).toFixed(2));
      expect(t.cap).toBe("1.73");
      expect(t.per).toBe("1.05");
    }
    s.charters = 5;
    expect(charterText(s).mult).toBe("1.35");
    expect(charterText({ charters: 5 }).mult).toBe("1.28");
  });

  it("the express stage lines are the set the stage news reads (narrative.expressLineSet, ENG-11)", () => {
    expect(EXPRESS_STAGE_LINE_SETS[0].length).toBeGreaterThan(2);
    const s = createInitialState(1, 0);
    expect(expressStageLines(expressLineSet(s))).toEqual(EXPRESS_STAGE_LINES);
    // the third express of the colony (two coronations before), and the same run once it is crowned
    s.meta.coronations = 2;
    const third = expressStageLines(expressLineSet(s));
    expect(third).toHaveLength(EXPRESS_STAGES.length);
    third.forEach((line, i) => expect(line).toEqual(expressStageLine(i + 1, 2)));
    expect(third.some((line, i) => line.human !== EXPRESS_STAGE_LINES[i].human)).toBe(true);
    s.meta.coronations = 3;
    s.coronatedThisRun = true;
    expect(expressStageLines(expressLineSet(s))).toEqual(third);
  });
});
