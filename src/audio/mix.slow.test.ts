/**
 * The long renders of the audio bench (`npm run test:slow`): five minutes of music for a district of every family
 * (AUD-3), and the ambience zone by zone over a full minute each — the far trains included — at 16 kHz (AUD-4).
 * The fast suite (music.test.ts, polish.test.ts) checks the same targets on one family and on 20 s windows.
 */
import { afterEach, describe, expect, it } from "vitest";
import { ambienceStop, ambienceTick, type AmbienceState } from "./ambience";
import { musicFamily, type MusicFamily } from "./music";
import { sfx } from "./sfx";
import { bench, renderMusic, SR, type Bench } from "./testing/bench";
import { hfShare, loudness, meanLoudness } from "./testing/measure";

let b: Bench | null = null;

afterEach(() => {
  b?.restore();
  b = null;
  ambienceStop();
});

describe("five minutes of music, every family (AUD-3)", () => {
  // the four named districts and a plain waltz
  const ONE_OF_EACH: Record<MusicFamily, string> = { organ: "whitechapel", chime: "westminster", glock: "mayfair", polka: "lambeth", waltz: "southwark" };

  for (const [family, district] of Object.entries(ONE_OF_EACH)) {
    it(`${district} (${family}): ≤ 45% of the time, ≤ −34 LUFS at the default slider, < 1.5% above 4 kHz`, () => {
      expect(musicFamily(district)).toBe(family);
      for (const full of [false, true]) {
        const r = renderMusic({ district, organ: full, brass: full }, 300);
        expect(r.on / 300, `${district} ${full}`).toBeLessThanOrEqual(0.45);
        expect(loudness(r.x, SR), `${district} ${full}`).toBeLessThanOrEqual(-34);
        expect(hfShare(r.x, SR), `${district} ${full}`).toBeLessThan(1.5);
      }
    }, 60_000);
  }
});

describe("the ambience zone by zone (AUD-4)", () => {
  const BASE: AmbienceState = { sewers: false, cellars: false, metro: false, terminal: false, clock: false, density: 0.5, duck: false, steamEff: 1, steamFull: false, hour: NaN };
  const ZONES: Partial<AmbienceState>[] = [{}, { sewers: true }, { sewers: true, cellars: true }, { sewers: true, cellars: true, metro: true }, { sewers: true, cellars: true, metro: true, terminal: true, clock: true }];

  const render = (st: Partial<AmbienceState>, sec: number, seed: number) => {
    b = bench(seed);
    sfx.ambience({ ...BASE, ...st });
    b.ctx.run(sec, { every: 0.12, fn: ambienceTick });
    const x = b.master.data();
    b.restore();
    b = null;
    ambienceStop();
    return x;
  };

  it("every newly opened zone raises it ≥ 1.5 LU on a laptop over a minute; the trickle is ≤ 50% of the whole", () => {
    for (const seed of [7, 11]) {
      const xs = ZONES.map((z) => render(z, 64, seed));
      const level = xs.map((x) => meanLoudness(x, SR, 4, Infinity, true));
      const steps = level.slice(1).map((l, i) => +(l - level[i]).toFixed(2));
      for (const s of steps) expect(s, `seed ${seed}: ${steps.join(", ")}`).toBeGreaterThanOrEqual(1.5);
      // the trickle alone at its Cellars level against the whole colony (v2: ~85%)
      const trickle = meanLoudness(render({ sewers: true, density: 0 }, 64, seed), SR, 4) - 10 * Math.log10(0.11 / 0.08) * 2;
      const all = meanLoudness(xs[4], SR, 4);
      expect(Math.pow(10, (trickle - all) / 10), `seed ${seed}`).toBeLessThanOrEqual(0.5);
    }
  }, 120_000);

  it("stays ≤ −32 LUFS with every zone open, the street above and a busy colony, over a minute", () => {
    for (const seed of [7, 11, 23]) {
      const x = render({ sewers: true, cellars: true, metro: true, terminal: true, clock: true, density: 1, hour: 8 }, 64, seed);
      expect(loudness(x, SR, 4), `seed ${seed}`).toBeLessThanOrEqual(-32);
    }
  }, 120_000);
});
