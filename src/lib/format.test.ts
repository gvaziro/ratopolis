import { afterEach, describe, expect, it } from "vitest";
import { fmt, fmtInt, fmtPct, fmtRate, fmtTime, setSciNotation } from "./format";

describe("fmt", () => {
  afterEach(() => setSciNotation(false));

  it("small numbers", () => {
    expect(fmt(0)).toBe("0");
    expect(fmt(5)).toBe("5");
    expect(fmt(5.25)).toBe("5.25");
    expect(fmt(5.5)).toBe("5.5");
    expect(fmt(12.34)).toBe("12.3");
    expect(fmt(999)).toBe("999");
    expect(fmt(999.9)).toBe("999");
  });

  it("suffixes", () => {
    expect(fmt(1000)).toBe("1K");
    expect(fmt(1234)).toBe("1.23K");
    expect(fmt(123456)).toBe("123.5K");
    expect(fmt(1e6)).toBe("1M");
    expect(fmt(2.5e9)).toBe("2.5B");
    expect(fmt(1.5e33)).toBe("1.5Dc");
    expect(fmt(1e36)).toBe("1.00e36");
  });

  it("negative and non-finite", () => {
    expect(fmt(-1500)).toBe("-1.5K");
    expect(fmt(-3)).toBe("-3");
    expect(fmt(Infinity)).toBe("∞");
    expect(fmt(-Infinity)).toBe("-∞");
    expect(fmt(NaN)).toBe("—");
  });

  it("scientific notation switch", () => {
    setSciNotation(true);
    expect(fmt(1.5e7)).toBe("1.50e7");
    expect(fmt(12345)).toBe("12.35K"); // below 1e6 keeps suffixes
  });
});

describe("fmtInt / fmtRate / fmtPct", () => {
  it("formats", () => {
    expect(fmtInt(12.7)).toBe("12");
    expect(fmtInt(1500)).toBe("1.5K");
    expect(fmtRate(0)).toBe("0/с");
    expect(fmtRate(1.2)).toBe("+1.2/с");
    expect(fmtRate(-3)).toBe("-3/с");
    expect(fmtRate(2500)).toBe("+2.5K/с");
    expect(fmtPct(0.256)).toBe("26%");
    expect(fmtPct(0.256, 1)).toBe("25.6%");
  });
});

describe("fmtTime", () => {
  it("formats durations in Russian short form", () => {
    expect(fmtTime(0)).toBe("0с");
    expect(fmtTime(45.9)).toBe("45с");
    expect(fmtTime(60)).toBe("1м 00с");
    expect(fmtTime(192)).toBe("3м 12с");
    expect(fmtTime(3900)).toBe("1ч 05м");
    expect(fmtTime((2 * 24 + 3) * 3600 + 59)).toBe("2д 3ч");
    expect(fmtTime(-5)).toBe("0с");
    expect(fmtTime(Infinity)).toBe("∞");
  });
});
