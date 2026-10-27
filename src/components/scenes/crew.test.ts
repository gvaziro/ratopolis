import { describe, expect, it } from "vitest";
import { CREW, CREW_POSE, CREW_X, crewCatch, distToSegment, ducking, HOP_S, hopPose, newCrew, SAG_DIP, SAG_NEAR_PX, stepCrew } from "./crew";

/** A laid-out crew on a 1000-px rail line at y = 500 (what drawCrew stores each frame). */
function laidOut() {
  const st = newCrew();
  st.rats = CREW_X.map((k) => ({ x: k * 1000, y: 500 }));
  st.spans = [0, 1, 2].map((i) => ({ x0: CREW_X[i] * 1000 + 12, y0: 480, x1: CREW_X[i + 1] * 1000 - 12, y1: 480 }));
  return st;
}

describe("the rail crew (SCN-2)", () => {
  it("four rats with varied fur and the four looks", () => {
    expect(CREW).toHaveLength(4);
    expect(new Set(CREW.map((c) => c.fur)).size).toBe(4);
    expect(CREW.map((c) => (c.foreman ? "foreman" : c.job))).toEqual(["coal_miner", "stoker", "mechanic", "foreman"]);
    expect(CREW_X).toEqual([0.14, 0.38, 0.62, 0.86]);
  });

  it("the crew position sets the stance", () => {
    expect(CREW_POSE.wall).toEqual({ dy: -10, scale: 0.85 });
    expect(CREW_POSE.rails).toEqual({ dy: 0, scale: 1 });
    expect(CREW_POSE.ties).toEqual({ dy: 6, scale: 1.1 });
  });

  it("a catch near a span sags it 6 px and the nearest rat hops", () => {
    const st = laidOut();
    expect(crewCatch(st, 500, 470)).toBe(1);
    expect(st.sag[1]).toBe(SAG_DIP);
    expect(st.sag[0]).toBe(0);
    expect(st.hop.indexOf(HOP_S)).toBe(1); // 380 is nearer than 620
  });

  it("a catch far from every span does nothing", () => {
    const st = laidOut();
    expect(crewCatch(st, 500, 480 - SAG_NEAR_PX - 5)).toBe(-1);
    expect(st.sag).toEqual([0, 0, 0]);
    expect(st.hop).toEqual([0, 0, 0, 0]);
  });

  it("the tarp springs back and settles", () => {
    const st = laidOut();
    crewCatch(st, 250, 480);
    let min = 0;
    for (let i = 0; i < 30; i++) {
      stepCrew(st, 1 / 60);
      min = Math.min(min, st.sag[0]);
    }
    expect(min).toBeLessThan(0); // it overshoots once (damped)
    expect(Math.abs(st.sag[0])).toBeLessThan(0.5);
    for (let i = 0; i < 120; i++) stepCrew(st, 1 / 60);
    expect(st.sag[0]).toBe(0);
    expect(st.hop.every((h) => h === 0)).toBe(true);
  });

  it("the squash-hop squashes, then jumps, then rests", () => {
    expect(hopPose(0)).toEqual({ sx: 1, sy: 1, dy: 0 });
    expect(hopPose(HOP_S * 0.85).sy).toBeLessThan(1);
    expect(hopPose(HOP_S * 0.3).dy).toBeLessThan(0);
  });

  it("a rat ducks while a wheel centre is within ±0.4 R", () => {
    expect(ducking(500, [700], 480)).toBe(false);
    expect(ducking(500, [690], 480)).toBe(true);
    expect(ducking(500, [], 480)).toBe(false);
  });

  it("distance to a segment", () => {
    expect(distToSegment(5, 3, 0, 0, 10, 0)).toBe(3);
    expect(distToSegment(-4, 3, 0, 0, 10, 0)).toBe(5);
  });
});
