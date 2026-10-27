import { describe, expect, it } from "vitest";
import { CHIME_GAP_MS, haulStinger, HAUL_SOUND_END_MS, odometerTicks, ODOMETER_MS, rollUpAt, STINGER_LEN_MS, tickPitch, TICK_GAP_MS } from "./haulSound";

describe("the haul card's odometer ratchet (SCN-3)", () => {
  const ticks = odometerTicks();

  it("plays 12–16 ticks over the roll-up", () => {
    expect(ticks.length).toBeGreaterThanOrEqual(12);
    expect(ticks.length).toBeLessThanOrEqual(16);
    expect(ticks[ticks.length - 1].at).toBe(ODOMETER_MS);
  });

  it("decelerates: the last gap is at least 3× the first", () => {
    const first = ticks[1].at - ticks[0].at;
    const last = ticks[ticks.length - 1].at - ticks[ticks.length - 2].at;
    expect(last).toBeGreaterThanOrEqual(3 * first);
    for (let i = 1; i < ticks.length; i++) expect(ticks[i].at - ticks[i - 1].at).toBeGreaterThanOrEqual(TICK_GAP_MS - 1e-9);
  });

  it("each tick marks a crossed 1/14 of the eased roll-up, pitch rising 1 → 1.5", () => {
    for (const tk of ticks) expect(rollUpAt(tk.at)).toBeGreaterThanOrEqual(tk.k - 1e-9);
    expect(tickPitch(ticks[0].k)).toBeGreaterThan(1);
    expect(tickPitch(1)).toBe(1.5);
  });
});

describe("the landing stinger by rating (SCN-3)", () => {
  const ratings = ["none", "bronze", "silver", "gold", "royal"] as const;

  it("four ratings (and none) end differently", () => {
    const sig = ratings.map((r) => haulStinger(r).map((s) => `${s.sound}${s.pitch ?? ""}`).join("+"));
    expect(new Set(sig).size).toBe(ratings.length);
    expect(haulStinger("none")[0].sound).toBe("tierLost");
    expect(haulStinger("bronze")[0].sound).toBe("tin");
    expect(haulStinger("silver").map((s) => s.sound)).toEqual(["chime", "chime"]);
    expect(haulStinger("gold").map((s) => s.sound)).toEqual(["stamp", "medal"]);
    expect(haulStinger("royal").map((s) => s.sound)).toEqual(["stamp", "record", "jingle"]);
  });

  it("silver rings 1318.5 then 1568 Hz, spaced past the chime cue's 100 ms repeat guard", () => {
    const [a, b] = haulStinger("silver");
    expect(1318.5 * (a.pitch ?? 1)).toBeCloseTo(1318.5);
    expect(1318.5 * (b.pitch ?? 1)).toBeCloseTo(1568);
    expect(b.at - a.at).toBe(CHIME_GAP_MS);
    expect(CHIME_GAP_MS).toBeGreaterThan(100);
  });

  it("lands with the odometer and is over within 2.3 s of the card", () => {
    for (const r of ratings) {
      for (const s of haulStinger(r)) {
        expect(s.at).toBeGreaterThanOrEqual(ODOMETER_MS);
        expect(s.at + STINGER_LEN_MS[s.sound]).toBeLessThanOrEqual(HAUL_SOUND_END_MS);
      }
    }
  });
});
