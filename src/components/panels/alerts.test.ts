import { describe, expect, it } from "vitest";
import { BUILDINGS } from "@/game/data/buildings";
import { JOBS } from "@/game/data/jobs";
import { UPGRADES } from "@/game/data/upgrades";
import { firstSentence } from "./alerts";

const balanced = (x: string) => {
  let round = 0;
  let quote = 0;
  for (const c of x) {
    if (c === "(") round++;
    else if (c === ")") round--;
    else if (c === "«") quote++;
    else if (c === "»") quote--;
    if (round < 0 || quote < 0) return false;
  }
  return round === 0 && quote === 0;
};

describe("firstSentence (unlock notes)", () => {
  it("stops at the first full stop outside brackets and quotes", () => {
    expect(firstSentence("Капсулы чаще. Ещё одна фраза.")).toBe("Капсулы чаще");
    expect(firstSentence("Автосбор +0.05 за уровень (макс. 3). Дальше.")).toBe("Автосбор +0.05 за уровень (макс. 3)");
    expect(firstSentence("1 слот сети (+1 на 3 и 5 ур.). Потом.")).toBe("1 слот сети (+1 на 3 и 5 ур.)");
    expect(firstSentence("Бонус от «Поста ур. 5» растёт. Ещё.")).toBe("Бонус от «Поста ур. 5» растёт");
    expect(firstSentence("Одна фраза.")).toBe("Одна фраза");
    expect(firstSentence("Ура! Ещё.")).toBe("Ура!");
    expect(firstSentence("×1.5 к добыче")).toBe("×1.5 к добыче");
  });

  it("never cuts a building, job or upgrade text mid-bracket", () => {
    const texts = [...Object.values(BUILDINGS).map((b) => b.desc), ...Object.values(JOBS).map((j) => j.desc), ...Object.values(UPGRADES).map((u) => u.effect)];
    for (const t of texts) {
      if (!balanced(t)) continue; // the source itself is unbalanced: nothing to keep
      expect(balanced(firstSentence(t)), t).toBe(true);
    }
  });
});
