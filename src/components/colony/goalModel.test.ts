import { describe, expect, it } from "vitest";
import { BUILDINGS } from "@/game/data/buildings";
import { currentExpedition, expeditionFraction } from "@/game/engine/actions";
import { derive } from "@/game/engine/derive";
import { entries, expeditionCost, unitValue } from "@/game/engine/formulas";
import { buildNowPick, ETA_LONG_SEC } from "@/game/engine/goals";
import { loadFixture, metroState } from "@/game/engine/testkit";
import { BUILDING_IDS, RES_IDS, type GameState } from "@/game/types";
import { etaText, etaWords, goalModel, pillText, type Goal } from "./goalModel";

const FIXTURES = ["v3-run1-10min", "v3-run1-60min", "v3-run1-crowned"] as const;

/** Every player-facing string of a goal row. */
function texts(g: Goal): string[] {
  return [g.name, g.sub ?? "", g.note ?? "", g.short, etaText(g), pillText(g)];
}

/** Mulberry32: a seeded stream for the sampled states. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("goalModel (COL-2 «Цели колонии» 2.0)", () => {
  it("opens with the buildNowPick line on the golden saves (as they are and with a fat purse)", () => {
    let picks = 0;
    for (const name of FIXTURES) {
      for (const rich of [false, true]) {
        const s = loadFixture(name);
        if (rich) for (const r of RES_IDS) s.res[r] *= 20;
        const d = derive(s);
        const pick = buildNowPick(s, d);
        const goals = goalModel(s, d);
        expect(goals.length).toBeGreaterThan(0);
        if (!pick) {
          expect(goals[0].key.startsWith("build:")).toBe(false);
          continue;
        }
        picks++;
        const g = goals[0];
        expect(g.key).toBe(`build:${pick.id}`);
        expect(g.target).toBe(`b_${pick.id}`);
        expect(g.name).toContain(BUILDINGS[pick.id].name);
        expect(g.name.startsWith(pick.kind === "useful" ? "Выгодно сейчас:" : "Можно построить:")).toBe(true);
        if (pick.kind === "useful") expect(g.name).toMatch(/ближе|намного ближе/);
      }
    }
    expect(picks).toBeGreaterThanOrEqual(3);
  });

  it("never prints «e+», NaN, Infinity or a 4-digit day count on 50 sampled states", () => {
    const rand = rng(20261026);
    const bases = FIXTURES.map((n) => loadFixture(n));
    for (let i = 0; i < 50; i++) {
      const s: GameState = structuredClone(bases[i % bases.length]);
      for (const r of RES_IDS) {
        const u = rand();
        s.res[r] = u < 0.15 ? 0 : Math.pow(10, -2 + rand() * 42);
        const v = rand();
        // net rates: zero, a crawl that would read «1e25 д», or anything up to 1e30/s
        s.rates[r] = v < 0.2 ? 0 : v < 0.4 ? Math.pow(10, -30 + rand() * 20) : (rand() < 0.15 ? -1 : 1) * Math.pow(10, -3 + rand() * 33);
      }
      for (const id of BUILDING_IDS) if (rand() < 0.3) s.buildings[id] = Math.floor(rand() * 400);
      s.rats = Math.floor(rand() * 2000);
      s.eRun = Math.pow(10, rand() * 40);
      const d = derive(s);
      for (const g of goalModel(s, d)) {
        for (const t of texts(g)) {
          expect(t, `${g.key}: ${t}`).not.toMatch(/e\+/);
          expect(t, `${g.key}: ${t}`).not.toMatch(/NaN|Infinity|undefined|∞/);
          expect(t, `${g.key}: ${t}`).not.toMatch(/\d{4,}\s?д/);
        }
      }
    }
  });

  it("a full store the expedition still needs reads «склад полон — внесите» and the row contributes it", () => {
    const s = loadFixture("v3-run1-10min");
    s.digging = null;
    const zone = currentExpedition(s);
    expect(zone).not.toBeNull();
    if (!zone) return;
    const d0 = derive(s);
    const paid = s.projects[zone] ?? {};
    // reopen the most expensive line of the expedition and fill that store to the brim
    const [r] = entries(expeditionCost(s, zone)).sort(([, a], [, b]) => b - a)[0];
    paid[r] = 0;
    s.projects[zone] = paid;
    s.res[r] = d0.caps[r];
    const goals = goalModel(s, derive(s));
    const row = goals.find((g) => g.key === `exp:${zone}`);
    expect(row?.sub).toContain("склад полон");
    expect(row?.contribute).toEqual({ kind: "expedition", zone, res: expect.arrayContaining([r]) });
  });

  it("the expedition ring is value-weighted, as the map plaque and the scout steps (pacing-5, ENG-3 K5)", () => {
    // the Terminal with every line paid but the coins (8M 🪙, worth most of it) at 10%: the plain mean says ~82%
    const s = metroState(99, { quiet: true });
    s.revealed.exp_terminal = true;
    const zone = currentExpedition(s);
    expect(zone).toBe("terminal");
    if (!zone) return;
    const cost = entries(expeditionCost(s, zone));
    expect(cost.length).toBeGreaterThan(2);
    const [top] = [...cost].sort(([ra, a], [rb, b]) => b * unitValue(rb) - a * unitValue(ra))[0];
    s.projects[zone] = Object.fromEntries(cost.map(([r, v]) => [r, r === top ? v * 0.1 : v]));
    const plain = cost.reduce((a, [r, v]) => a + Math.min(1, (s.projects[zone]![r] ?? 0) / v), 0) / cost.length;
    const weighted = expeditionFraction(s, zone);
    expect(plain - weighted).toBeGreaterThan(0.3);
    const row = goalModel(s, derive(s)).find((g) => g.key === `exp:${zone}`);
    expect(row?.frac).toBe(Math.round(weighted * 50) / 50);
  });

  it("after the coronation lists the next wagon and the King's commission", () => {
    const s = loadFixture("v3-run1-crowned");
    const goals = goalModel(s, derive(s));
    const wagon = goals.find((g) => g.key.startsWith("wagon:"));
    expect(wagon?.name).toBe(`Вагон №${s.express.wagons + 1}`);
    const com = goals.find((g) => g.key.startsWith("commission:"));
    expect(com).toBeDefined();
    if (s.commissions?.active) expect(com?.note).toMatch(/^\d+\/\d+$/);
    // nothing accepted: the King is waiting
    s.commissions = { offered: s.commissions?.offered ?? [], done: s.commissions?.done ?? 0 };
    const idle = goalModel(s, derive(s)).find((g) => g.key === "commission:none");
    expect(idle?.name).toBe("Король ждёт: выберите поручение");
  });

  it("spells a long wait «долго», never a number", () => {
    expect(etaWords(ETA_LONG_SEC + 1)).toBe("долго");
    expect(etaWords(Infinity)).toBe("долго");
    expect(etaWords(754)).toBe("≈ 12м 34с");
  });
});
