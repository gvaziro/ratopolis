import { describe, expect, it } from "vitest";
import { TRAIN_VARIANTS } from "@/game/data/events";
import { acceptsPointerDown, bounceRule, CRASH_LOCK_S, FOG_DIM, FOG_FADE_PX, FOG_GLINT_S, FOG_NEAR_PX, fogAlpha, MAX_BOUNCES, rebound } from "./catchRules";

describe("crash lockout: the catch canvas pointer gate (SCN-2)", () => {
  it("rejects pointer downs for t < 1.2 s of a crashed pass", () => {
    expect(CRASH_LOCK_S).toBe(1.2);
    for (const t of [0, 0.3, 0.9, 1.19]) expect(acceptsPointerDown(t, true)).toBe(false);
    for (const t of [1.2, 1.5, 9]) expect(acceptsPointerDown(t, true)).toBe(true);
  });

  it("never gates a pass without a crash", () => {
    for (const t of [0, 0.5, 1.19, 3]) expect(acceptsPointerDown(t, false)).toBe(true);
  });

  it("a NaN clock does not lock the paws for good", () => {
    expect(acceptsPointerDown(Number.NaN, true)).toBe(true);
  });
});

/** Drop an item from the car floor onto the rail with the canvas' own numbers and count its arcs. */
function arcs(rule: ReturnType<typeof bounceRule>, life = 2.5, H = 600): number {
  const g = 2.4 * H * Math.pow(2 / life, 2);
  const ground = 0.7 * H - 14;
  let y = 0.29 * H;
  let vy = -(2 + 3 * 0.5) * H * 0.06 * rule.launch;
  let n = 0;
  const dt = 1 / 120;
  for (let t = 0; t < life; t += dt) {
    vy += g * dt;
    y += vy * dt;
    if (y >= ground) {
      y = ground;
      const nv = rebound(vy, n, rule, H * 0.15);
      if (nv === null) break;
      vy = nv;
      n++;
    }
  }
  return n;
}

describe("circus rebounds (SCN-2)", () => {
  it("plain trains bounce once on the rail (0.42), the carriage floor 0.34", () => {
    expect(bounceRule("train", TRAIN_VARIANTS.normal, false)).toEqual({ max: 1, restitution: 0.42, launch: 1 });
    expect(bounceRule("train", null, false)).toEqual({ max: 1, restitution: 0.42, launch: 1 });
    expect(bounceRule("fall", TRAIN_VARIANTS.circus, false)).toEqual({ max: 1, restitution: 0.34, launch: 1 });
  });

  it("the circus juggles: up to 3 rebounds, restitution .72, launch ×1.25 — sparks do not", () => {
    expect(bounceRule("train", TRAIN_VARIANTS.circus, false)).toEqual({ max: 3, restitution: 0.72, launch: 1.25 });
    expect(bounceRule("train", TRAIN_VARIANTS.circus, true)).toEqual({ max: 1, restitution: 0.42, launch: 1 });
    expect(bounceRule("train", { bounces: 9, restitution: 0.72, launchMul: 1 }, false).max).toBe(MAX_BOUNCES);
  });

  it("a circus item arcs 2–3 times within its life, a plain one once", () => {
    const circusLife = 2 + TRAIN_VARIANTS.circus.itemLifeAdd;
    const n = arcs(bounceRule("train", TRAIN_VARIANTS.circus, false), circusLife);
    expect(n).toBeGreaterThanOrEqual(2);
    expect(n).toBeLessThanOrEqual(3);
    expect(arcs(bounceRule("train", TRAIN_VARIANTS.normal, false))).toBe(1);
  });

  it("a slow landing settles even with rebounds left", () => {
    const rule = bounceRule("train", TRAIN_VARIANTS.circus, false);
    expect(rebound(50, 0, rule, 90)).toBeNull();
    expect(rebound(200, 0, rule, 90)).toBeCloseTo(-144);
    expect(rebound(200, 3, rule, 90)).toBeNull();
  });
});

describe("«Гороховый суп»: fog alpha (SCN-2)", () => {
  it("unlit loot is dim", () => {
    expect(fogAlpha(Infinity, false, -1)).toBe(FOG_DIM);
    expect(FOG_DIM).toBe(0.25);
    expect(fogAlpha(FOG_NEAR_PX + FOG_FADE_PX + 1, false, 5)).toBe(FOG_DIM);
  });

  it("brightens within 110 px of a pointer or the paw, with a soft edge", () => {
    expect(FOG_NEAR_PX).toBe(110);
    expect(fogAlpha(0, false, -1)).toBe(1);
    expect(fogAlpha(110, false, -1)).toBe(1);
    const mid = fogAlpha(110 + FOG_FADE_PX / 2, false, -1);
    expect(mid).toBeGreaterThan(FOG_DIM);
    expect(mid).toBeLessThan(1);
  });

  it("the lantern cone and a fresh landing light it up", () => {
    expect(fogAlpha(Infinity, true, -1)).toBe(1);
    expect(fogAlpha(Infinity, false, 0)).toBe(1);
    expect(fogAlpha(Infinity, false, FOG_GLINT_S)).toBe(1);
    expect(fogAlpha(Infinity, false, FOG_GLINT_S + 0.01)).toBe(FOG_DIM);
  });

  it("never returns NaN", () => {
    expect(fogAlpha(Number.NaN, false, Number.NaN)).toBe(FOG_DIM);
  });
});
