/**
 * AUD-4 on the offline bench: a voice per train variant (distinct whistle chords, a fresh detune per train, the chuff
 * range, the rumble, the joints, the rush-hour crowd), the softer capsule (hiss below 4 kHz, alternating with a
 * thunk), catch blips in G major, births thinned to an occasional squeak or litter trill, and the ambience: every
 * zone a laptop can hear, «Наверху» from the first minute, the whole still in the background. The zone-by-zone
 * minute-long renders are in mix.slow.test.ts.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { TRAIN_VARIANT_IDS } from "@/game/types";
import { ambienceReport, ambienceStop, ambienceTick, type AmbienceState } from "./ambience";
import { BIRTH_GAP_MS } from "./births";
import { play, startsOf, voicesNow } from "./core";
import { BLIP_WRAP, blipFreq } from "./instruments";
import { chuffState } from "./loops";
import { sfx } from "./sfx";
import { rnd, tone, vibrato } from "./synth";
import { bench, SR, type Bench } from "./testing/bench";
import { hfEnergyDb, hfShare, loudness, meanLoudness, peakFreq, speakerLoudness } from "./testing/measure";
import { dopplerPitch, MIN_DETUNE_GAP, setTrain, TRAIN_VOICES, train } from "./trainVoices";

let b: Bench | null = null;

afterEach(() => {
  b?.restore();
  b = null;
  ambienceStop();
  sfx.train(null);
  sfx.chuffStop();
  sfx.rumbleStop();
});

const cents = (a: number, c: number) => 1200 * Math.log2(a / c);

describe("a voice per train variant (AUD-4)", () => {
  it("every variant has its own whistle chord, and the rendered whistle sounds it", () => {
    const sets = TRAIN_VARIANT_IDS.map((v) => [...TRAIN_VOICES[v].whistle].sort((x, y) => x - y).join("/"));
    expect(new Set(sets).size).toBe(TRAIN_VARIANT_IDS.length);
    for (const v of TRAIN_VARIANT_IDS) {
      b = bench();
      setTrain(v, 0);
      sfx.whistle();
      b.ctx.run(1.1);
      const f = peakFreq(b.master.data().subarray(Math.round(0.2 * SR)), SR, 380, 1300);
      const chord = TRAIN_VOICES[v].whistle;
      expect(Math.min(...chord.map((c) => Math.abs(cents(f, c)))), `${v}: ${f.toFixed(1)} Hz`).toBeLessThan(15);
      b.restore();
      b = null;
    }
  });

  it("detunes every train ±25 cents, two in a row at least 10 cents apart — and the whistle follows", () => {
    let prev: number | null = null;
    for (let i = 0; i < 400; i++) {
      const d = setTrain("normal")!.detune;
      expect(Math.abs(d)).toBeLessThanOrEqual(25);
      if (prev !== null) expect(Math.abs(d - prev)).toBeGreaterThanOrEqual(MIN_DETUNE_GAP);
      prev = d;
    }
    const heard: number[] = [];
    for (let i = 0; i < 2; i++) {
      b = bench(30 + i);
      sfx.train("normal");
      sfx.whistle();
      b.ctx.run(1.1);
      heard.push(peakFreq(b.master.data().subarray(Math.round(0.2 * SR)), SR, 700, 1100));
      b.restore();
      b = null;
    }
    expect(Math.abs(cents(heard[0], heard[1]))).toBeGreaterThanOrEqual(9.5);
  });

  it("maps the scene's chuff (2 → 8) onto the variant's range; the doppler takes the chord root", () => {
    b = bench();
    sfx.train("freight");
    sfx.chuffStart(8);
    expect(chuffState().rate).toBeCloseTo(5, 5);
    sfx.chuffSet(2);
    expect(chuffState().rate).toBeCloseTo(1.5, 5);
    sfx.train("edinburgh_mail");
    sfx.chuffSet(8);
    expect(chuffState().rate).toBeCloseTo(10, 5);
    sfx.train(null);
    sfx.chuffSet(6);
    expect(chuffState().rate).toBe(6);
    setTrain("freight", 0);
    expect(dopplerPitch()).toBeCloseTo(523 / 880, 5);
    setTrain("normal", 0);
    expect(dopplerPitch()).toBe(1);
    expect(setTrain("no_such_train" as never, 0)!.variant).toBe("normal");
  });

  it("a freight clanks its chains and a flooded train splashes at every joint; a freight rumbles louder", () => {
    const tail = (variant: "normal" | "freight" | "flooded") => {
      b = bench();
      setTrain(variant, 0);
      sfx.clack();
      b.ctx.run(0.6);
      const x = b.master.data();
      b.restore();
      b = null;
      return meanLoudness(x, SR, 0.17, 0.45);
    };
    const plain = tail("normal");
    expect(tail("freight")).toBeGreaterThan(plain + 6);
    expect(tail("flooded")).toBeGreaterThan(plain + 6);
    const rumble = (variant: "normal" | "freight") => {
      b = bench();
      sfx.train(variant);
      sfx.rumbleKind("train");
      sfx.rumbleStart(1);
      b.ctx.run(2.5);
      const l = meanLoudness(b.master.data(), SR, 1.5);
      sfx.rumbleStop();
      b.restore();
      b = null;
      return l;
    };
    const k = rumble("freight") - rumble("normal");
    expect(k).toBeGreaterThan(0.6);
    expect(k).toBeLessThan(1.8);
  });

  it("the rush hour brings the crowd above at the pass; the scene's end forgets the train", () => {
    b = bench();
    sfx.train("rush_hour");
    sfx.passStart();
    expect(startsOf("crowd")).toBe(1);
    sfx.train(null);
    expect(train()).toBeNull();
    sfx.train("normal");
    sfx.passStart();
    expect(startsOf("crowd")).toBe(1);
  });
});

describe("the capsule (AUD-4)", () => {
  it("hisses below 4 kHz (≤ 25% above) at ≤ −29 LUFS", () => {
    b = bench();
    sfx.passStart();
    sfx.hiss();
    b.ctx.run(1.2);
    const x = b.master.data();
    expect(hfShare(x, SR)).toBeLessThanOrEqual(25);
    expect(loudness(x, SR)).toBeLessThanOrEqual(-29);
  });

  it("alternates the hiss and a pneumatic thunk from the pass's start", () => {
    b = bench();
    sfx.passStart();
    for (let i = 0; i < 5; i++) {
      sfx.hiss();
      b.ctx.run(0.3);
    }
    expect([startsOf("hiss"), startsOf("thunk")]).toEqual([3, 2]);
    sfx.passStart();
    sfx.hiss();
    expect(startsOf("hiss")).toBe(4);
  });

  it("the scene's end (sfx.train(null) after the rumble stopped) never swells the fading rumble back", () => {
    for (const kind of ["capsule", "train"] as const) {
      b = bench();
      const world = b.ctx.tap(b.core.world);
      sfx.rumbleKind(kind);
      sfx.rumbleStart(1);
      b.ctx.run(2);
      // a browser: the rumble fades and is torn down 2.2 s later (the offline run is synchronous, the timer waits)
      vi.stubGlobal("window", globalThis);
      try {
        sfx.rumbleStop();
      } finally {
        vi.unstubAllGlobals();
      }
      b.ctx.run(0.12);
      sfx.train(null);
      sfx.rumbleKind(kind);
      b.ctx.run(2);
      const x = world.data();
      expect(loudness(x, SR, 3, 4.1), kind).toBeLessThan(loudness(x, SR, 1, 2) - 25);
      sfx.rumbleStop();
      b.restore();
      b = null;
    }
  });
});

describe("catch blips in G major (AUD-4)", () => {
  it("every step from 0 to 30 is a G-major note; 14 steps climb two octaves, then start over", () => {
    const G = new Set([7, 9, 11, 0, 2, 4, 6]);
    for (let s = 0; s <= 30; s++) {
      const midi = Math.round(69 + 12 * Math.log2(blipFreq(s) / 440));
      expect(G.has(((midi % 12) + 12) % 12), `step ${s}`).toBe(true);
    }
    for (let s = 1; s < BLIP_WRAP; s++) expect(blipFreq(s)).toBeGreaterThan(blipFreq(s - 1));
    expect(blipFreq(0)).toBeCloseTo(392, 3);
    expect(blipFreq(7)).toBeCloseTo(784, 3);
    expect(blipFreq(BLIP_WRAP)).toBe(blipFreq(0));
    expect(blipFreq(-1)).toBe(blipFreq(BLIP_WRAP - 1));
  });
});

describe("births (AUD-4)", () => {
  /** v2's birth: every one squeaked (the rising chirp, ≤ 3/s). */
  const v2Squeak = () =>
    play("v2squeak", { max: 3, perSec: 3 }, { send: 0.1, pan: rnd(-0.4, 0.4) }, (v) => {
      const t = v.t;
      const f = 2300 * rnd(0.9, 1.15);
      const { osc, end } = tone(v, { f, t, a: 0.012, d: 0.11, peak: 0.19 });
      osc.frequency.exponentialRampToValueAtTime(f * 1.5, t + 0.06);
      osc.frequency.exponentialRampToValueAtTime(f * 1.32, t + 0.12);
      vibrato(v, osc.frequency, t, end, 38, f * 0.025);
    });

  const minute = (born: () => void) => {
    b = bench();
    for (let i = 0; i < 180; i++) {
      born();
      b.ctx.run(1 / 3);
    }
    const x = b.master.data();
    const voices = startsOf("squeak") + startsOf("litter") + startsOf("v2squeak");
    b.restore();
    b = null;
    return { x, voices };
  };

  it("3 births a second for a minute: ≤ 45 voices and ≥ 6 dB less energy above 4 kHz than v2", () => {
    const v2 = minute(v2Squeak);
    const v3 = minute(() => sfx.birth());
    // v2 let ≤ 3 a second through: three-quarters of a births stream at exactly 3/s
    expect(v2.voices).toBeGreaterThanOrEqual(130);
    expect(v3.voices).toBeLessThanOrEqual(45);
    expect(v3.voices).toBeGreaterThanOrEqual(30);
    expect(hfEnergyDb(v2.x, SR) - hfEnergyDb(v3.x, SR)).toBeGreaterThanOrEqual(6);
  });

  it("an isolated birth after a quiet spell squeaks at once; under a close-up none do", () => {
    b = bench();
    b.ctx.run(3.2);
    sfx.birth();
    expect(startsOf("squeak")).toBe(1);
    expect(voicesNow()).toBe(1);
    // within the gap: counted, not voiced
    b.ctx.run((BIRTH_GAP_MS / 1000) * 0.5);
    sfx.birth();
    expect(startsOf("squeak")).toBe(1);
    sfx.ambience({ duck: true });
    b.ctx.run(3);
    for (let i = 0; i < 6; i++) {
      sfx.birth();
      b.ctx.run(0.5);
    }
    expect(startsOf("squeak") + startsOf("litter")).toBe(1);
    // the close-up is over: the next birth squeaks (the ones under it were not saved up)
    sfx.ambience({ duck: false });
    b.ctx.run(1.5);
    sfx.birth();
    expect([startsOf("squeak"), startsOf("litter")]).toEqual([2, 0]);
  });
});

describe("the ambience (AUD-4)", () => {
  const BASE: AmbienceState = { sewers: false, cellars: false, metro: false, terminal: false, clock: false, density: 0.5, duck: false, steamEff: 1, steamFull: false, hour: NaN };

  it("«Наверху»: the burrow alone hears the street from the first minute (≥ −48 LUFS on a laptop); the night is quieter", () => {
    const street = (hour: number) => {
      b = bench(7);
      sfx.ambience({ ...BASE, density: 0, hour });
      b.ctx.run(30, { every: 0.12, fn: ambienceTick });
      const x = b.master.data();
      const carts = startsOf("ambCart");
      b.restore();
      b = null;
      ambienceStop();
      return { spk: speakerLoudness(x, SR, 3), carts };
    };
    const day = street(5);
    expect(day.carts).toBeGreaterThanOrEqual(1);
    expect(day.spk).toBeGreaterThanOrEqual(-48);
    expect(street(2).spk).toBeLessThan(day.spk);
  });

  it("rings the tower bell when the humans' clock strikes noon, after a close-up if one is on", () => {
    b = bench();
    sfx.ambience({ ...BASE, density: 0, hour: 11 });
    b.ctx.run(1, { every: 0.12, fn: ambienceTick });
    sfx.ambience({ hour: 12, duck: true });
    b.ctx.run(2, { every: 0.12, fn: ambienceTick });
    expect(startsOf("ambBell")).toBe(0);
    sfx.ambience({ duck: false });
    b.ctx.run(1, { every: 0.12, fn: ambienceTick });
    expect(startsOf("ambBell")).toBe(1);
    sfx.ambience({ hour: 13 });
    b.ctx.run(1, { every: 0.12, fn: ambienceTick });
    expect(startsOf("ambBell")).toBe(1);
  });

  it("a busy colony's machinery runs a ratchet every 8 beats; the trickle steps down once the Cellars open", () => {
    b = bench();
    sfx.ambience({ ...BASE, density: 1 });
    b.ctx.run(10, { every: 0.12, fn: ambienceTick });
    expect(startsOf("ambRatchet")).toBeGreaterThanOrEqual(2);
    sfx.ambience({ ...BASE, density: 0.4 });
    const r = startsOf("ambRatchet");
    b.ctx.run(10, { every: 0.12, fn: ambienceTick });
    expect(startsOf("ambRatchet")).toBe(r);
    sfx.ambience({ sewers: true });
    b.ctx.run(1, { every: 0.12, fn: ambienceTick });
    expect(ambienceReport()).toMatchObject({ trickle: 0.11, loops: ["room", "trickle"] });
    sfx.ambience({ cellars: true, metro: true, terminal: true });
    b.ctx.run(1, { every: 0.12, fn: ambienceTick });
    expect(ambienceReport()).toMatchObject({ trickle: 0.08, loops: ["room", "trickle", "draught", "vent", "murmur"] });
  });

  it("every newly opened zone raises the ambience ≥ 1.5 LU on a laptop (integrated, 20 s)", () => {
    const SR8 = 8000;
    const zones: Partial<AmbienceState>[] = [{}, { sewers: true }, { sewers: true, cellars: true }, { sewers: true, cellars: true, metro: true }, { sewers: true, cellars: true, metro: true, terminal: true, clock: true }];
    const level = zones.map((z) => {
      b = bench(7, SR8);
      sfx.ambience({ ...BASE, ...z });
      b.ctx.run(24, { every: 0.12, fn: ambienceTick });
      const l = meanLoudness(b.master.data(), SR8, 4, Infinity, true);
      b.restore();
      b = null;
      ambienceStop();
      return l;
    });
    const steps = level.slice(1).map((l, i) => +(l - level[i]).toFixed(2));
    for (const s of steps) expect(s, `steps ${steps.join(", ")}`).toBeGreaterThanOrEqual(1.5);
  });
});
