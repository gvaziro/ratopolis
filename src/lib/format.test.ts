import { afterEach, describe, expect, it } from "vitest";
import { fmt, fmtDuration, fmtInt, fmtPct, fmtRate, fmtTime, plural, setSciNotation } from "./format";

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
    expect(fmtTime(Infinity)).toBe("—");
    expect(fmtTime(NaN)).toBe("—");
    // v3 (ENG-1): an ETA over 100 h is a shrug, not «1.0100706197823662e+25д»
    expect(fmtTime(1e30)).toBe("> 4 д");
    expect(fmtTime(100 * 3600)).toBe("> 4 д");
    expect(fmtTime(100 * 3600 - 1)).toBe("4д 3ч");
    expect(fmtDuration(30 * 24 * 3600 + 7200)).toBe("30д 2ч");
  });
});

describe("plural", () => {
  it("picks the Russian noun form for a count", () => {
    const rats = (n: number) => `${n} ${plural(n, "крыса", "крысы", "крыс")}`;
    expect(rats(1)).toBe("1 крыса");
    expect(rats(2)).toBe("2 крысы");
    expect(rats(4)).toBe("4 крысы");
    expect(rats(5)).toBe("5 крыс");
    expect(rats(11)).toBe("11 крыс");
    expect(rats(12)).toBe("12 крыс");
    expect(rats(14)).toBe("14 крыс");
    expect(rats(21)).toBe("21 крыса");
    expect(rats(22)).toBe("22 крысы");
    expect(rats(25)).toBe("25 крыс");
    expect(rats(0)).toBe("0 крыс");
    expect(rats(111)).toBe("111 крыс");
    expect(rats(101)).toBe("101 крыса");
    expect(plural(-1, "a", "b", "c")).toBe("a");
    expect(plural(2.7, "a", "b", "c")).toBe("b");
  });
});
