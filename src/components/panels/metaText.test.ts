import { describe, expect, it } from "vitest";
import { derive } from "@/game/engine/derive";
import { charterAtCap, charterMult } from "@/game/engine/metaMath";
import { createInitialState } from "@/game/engine/state";
import type { GameState } from "@/game/types";
import { charterText, crownBonus, expressBonus, pctText } from "./metaText";

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
      expect(b.total, `wagons ${w}`).toBe(pctText((part(s, "Крысиный экспресс") - 1) * 100));
      // the «следующий вагон добавит» line: derive with one wagon more
      expect(b.next, `wagons ${w}`).toBe(pctText((part(withExpress(10, w + 1), "Крысиный экспресс") - part(s, "Крысиный экспресс")) * 100));
    }
  });

  it("before the coronation the next step is the next stage", () => {
    for (let st = 0; st < 10; st++) {
      const s = withExpress(st, 0);
      expect(expressBonus(s).total).toBe(pctText((part(s, "Крысиный экспресс") - 1) * 100));
      expect(expressBonus(s).next).toBe(pctText((part(withExpress(st + 1, 0), "Крысиный экспресс") - part(s, "Крысиный экспресс")) * 100));
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
    }
  });
});
