import { describe, expect, it } from "vitest";
import { aggregateChecks, fmtAggregate, fmtValue, judgeValue, median, relMove, type CheckValue } from "./simStats";

const check = (name: string, value: number | null, extra: Partial<CheckValue> = {}): CheckValue => ({
  group: "v2",
  name,
  target: "44–56 мин",
  value,
  judge: { k: "range", lo: 44, hi: 56 },
  unit: "min",
  ...extra,
});

describe("simStats (ENG-2 replicate medians)", () => {
  it("median: odd and even counts, unordered input", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([7])).toBe(7);
    expect(median([])).toBeNull();
  });

  it("median: a missed milestone (null) sorts last, so a majority of misses gives null", () => {
    expect(median([50, null, 40])).toBe(50);
    expect(median([null, null, 40])).toBeNull();
    expect(median([42, null])).toBeNull(); // (42 + ∞) / 2
    expect(median([NaN, 1, 2])).toBe(2);
  });

  it("judgeValue: every judge, and a missing value fails all but info", () => {
    expect(judgeValue({ k: "within", lo: 11, hi: 11 }, 13.7)).toBe("PASS"); // ±25%
    expect(judgeValue({ k: "within", lo: 11, hi: 11 }, 13.8)).toBe("FAIL");
    expect(judgeValue({ k: "within", lo: 10, hi: 10, tol: 0 }, 10)).toBe("PASS");
    expect(judgeValue({ k: "range", lo: 44, hi: 56 }, 56)).toBe("PASS");
    expect(judgeValue({ k: "range", lo: 44, hi: 56 }, 43.9)).toBe("FAIL");
    expect(judgeValue({ k: "atMost", hi: 240 }, 240)).toBe("PASS");
    expect(judgeValue({ k: "below", hi: 0.5 }, 0.5)).toBe("FAIL");
    expect(judgeValue({ k: "atLeast", lo: 1 }, 1)).toBe("PASS");
    expect(judgeValue({ k: "atLeast", lo: 1 }, null)).toBe("FAIL");
    expect(judgeValue({ k: "atMost", hi: 1 }, Infinity)).toBe("FAIL");
    expect(judgeValue({ k: "info" }, null)).toBe("INFO");
  });

  it("aggregateChecks: groups by (group, name), keeps order, judges the median, counts the misses", () => {
    const a = [check("забег 2: Вокзал", 50.3), check("забег 1: венцы", 24, { judge: { k: "range", lo: 20, hi: 28 }, unit: "int", target: "20–28" })];
    const b = [check("забег 2: Вокзал", 42.4), check("забег 1: венцы", 19, { judge: { k: "range", lo: 20, hi: 28 }, unit: "int", target: "20–28" })];
    const c = [check("забег 2: Вокзал", 48.5), check("забег 1: венцы", 30, { judge: { k: "range", lo: 20, hi: 28 }, unit: "int", target: "20–28" }), check("только тут", null)];
    const agg = aggregateChecks([a, b, c]);
    expect(agg.map((x) => x.name)).toEqual(["забег 2: Вокзал", "забег 1: венцы", "только тут"]);
    const terminal = agg[0];
    expect(terminal.median).toBe(48.5);
    expect(terminal.min).toBe(42.4);
    expect(terminal.max).toBe(50.3);
    expect(terminal.verdict).toBe("PASS"); // one sample below 44, the median inside
    expect(agg[1].median).toBe(24);
    expect(agg[1].verdict).toBe("PASS");
    expect(agg[2]).toMatchObject({ values: [null, null, null], median: null, missing: 3, verdict: "FAIL" });
  });

  it("formats values and aggregates: «48:30 (42:24–50:18)», «, 1 нет» for a miss", () => {
    expect(fmtValue(48.5, "min")).toBe("48:30");
    expect(fmtValue(240, "sec")).toBe("4:00");
    expect(fmtValue(2.634, "h")).toBe("2.63 ч");
    expect(fmtValue(0.341, "pct")).toBe("34%");
    expect(fmtValue(12345, "num")).toBe("12.3K");
    expect(fmtValue(null, "min")).toBe("—");
    expect(fmtValue(1, "bool")).toBe("да");
    expect(fmtValue(0, "bool")).toBe("нет");
    const [x] = aggregateChecks([[check("Вокзал", 50.3)], [check("Вокзал", 42.4)], [check("Вокзал", null)]]);
    expect(fmtAggregate(x)).toBe("50:18 (42:24–50:18), 1 нет");
  });

  it("an even replicate count prints a split median as it is judged, never «да … FAIL» (goals-8)", () => {
    const yes = { k: "atLeast", lo: 1 } as const;
    const offline = (v: number) => check("офлайн 8 ч", v, { judge: yes, unit: "bool", target: "да" });
    const [split] = aggregateChecks([[offline(1)], [offline(0)]]);
    expect(split.median).toBe(0.5);
    expect(split.verdict).toBe("FAIL");
    expect(fmtValue(split.median, "bool")).toBe("поровну");
    expect(fmtAggregate(split)).toBe("поровну (нет–да)");
    const [both] = aggregateChecks([[offline(1)], [offline(1)]]);
    expect([fmtValue(both.median, "bool"), both.verdict]).toEqual(["да", "PASS"]);
    // int checks: [3, 4] judged ≥ 4 is a 3.5 that fails — it reads 3.5, not «4»
    const trains = (v: number) => check("варианты поездов", v, { judge: { k: "atLeast", lo: 4 }, unit: "int", target: "≥ 4" });
    const [half] = aggregateChecks([[trains(3)], [trains(4)]]);
    expect([fmtValue(half.median, "int"), half.verdict]).toEqual(["3.5", "FAIL"]);
    expect(fmtValue(4, "int")).toBe("4");
  });

  it("relMove: the baseline diff of sim-matrix (> 10% marks a regression)", () => {
    expect(relMove(2.9, 2.63)).toBeCloseTo(0.1027, 3);
    expect(relMove(2.7, 2.63)).toBeLessThan(0.1);
    expect(relMove(null, null)).toBe(0);
    expect(relMove(5, null)).toBe(1);
    expect(relMove(0, 0)).toBe(0);
    expect(relMove(3, 0)).toBe(1);
  });
});
