/**
 * The mix on the offline bench (AUD-1, AUD-2): every sound renders clean and at its mix-sheet loudness, nothing
 * leaks, the hold gate parks the loops and lets the ceremony through (K2), the train no longer squeezes the catch,
 * giant impacts reach small speakers, the giants and rats sound like themselves, and the steam economy is audible
 * while the ambience stays in the background. All at 16 kHz with a seeded Math.random, so every number is
 * reproducible; loudness is the K-weighted momentary maximum (LUFS) at the master, volume 1.
 * The music and the mixer (AUD-3) are in music.test.ts, the sound polish (AUD-4) in polish.test.ts, the long renders
 * (five minutes of music, the ambience zone by zone) in mix.slow.test.ts.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ambienceStop, ambienceTick } from "./ambience";
import { COMP, startsOf, voicesNow } from "./core";
import { chuffAt, chuffState, loopsTick } from "./loops";
import { sfx } from "./sfx";
import { bench, renderSound, SFX_CONTROLS, SOUNDS, SR, type Bench } from "./testing/bench";
import { allFinite, centroid, estGainReduction, loudness, peakDb, speakerLoudness } from "./testing/measure";

/**
 * Target loudness of every sound (LUFS, K-weighted momentary max at volume 1, seed 7), ±2 LU. A sound that gets
 * 3 dB louder (or quieter) fails here: change the sheet on purpose, with a listen.
 */
const MIX_SHEET: Record<string, number> = {
  click: -33.7,
  "click(4)": -34.2,
  playerDrop: -30.2,
  find: -25.2,
  coin: -30.2,
  tin: -26.7,
  thud: -24.4,
  squeak: -30.9,
  fanfare: -21.8,
  medal: -22.5,
  blip: -33.0,
  bump: -23.5,
  ouch: -30.7,
  clack: -29.1,
  whistle: -22.5,
  "whistle(royal)": -19.4,
  bell: -26.5,
  // AUD-4: the capsule's hiss is softer and lower (v2 −26.4, as loud as an upgrade ring)
  hiss: -31.1,
  pop: -34.5,
  splash: -29.7,
  meow: -24.9,
  bonk: -26.5,
  pipe: -25.8,
  jackpot: -16.5,
  dig: -26.6,
  typewriter: -38.1,
  whistleFar: -31.1,
  hooves: -33.0,
  rain: -30.6,
  sting: -23.7,
  drone: -27.9,
  flourish: -25.1,
  jingle: -27.2,
  typeBurst: -37.7,
  drip: -44.5,
  scout: -26.6,
  migration: -24.1,
  record: -19.3,
  commission: -29.6,
  "commission(done)": -23.6,
  coronationBells: -16.7,
  hoof: -36.1,
  chatter: -26.5,
  "chatter(3, cheer)": -21.6,
  hunger: -26.8,
  nibbles: -32.0,
  valve: -27.3,
  deepRumble: -28.0,
  curio: -23.7,
  /* AUD-4 */
  birth: -30.9,
  thunk: -29.9,
  crowd: -29.1,
  "cue footstep": -23.8,
  "cue thump": -23.0,
  "cue doppler": -22.9,
  "cue tinnitus": -30.4,
  "cue medalTier": -25.0,
  "cue tierLost": -38.5,
  "cue carClear": -24.3,
  "cue stamp": -27.7,
  "cue tick": -38.5,
  "cue heartbeat": -24.4,
  "cue patent": -29.4,
  "cue unlock": -24.9,
  "cue valveCreak": -39.4,
  "cue bubbles": -35.1,
  "cue crownTick": -33.2,
  "cue chime": -27.2,
  "cue3 giantVoice": -22.3,
  "cue3 ratChatter": -26.5,
  "cue3 coachman": -22.9,
  "cue3 hoof": -36.1,
  "cue3 curio": -23.7,
  "cue3 counter": -23.4,
  "cue3 growl": -27.0,
};

/** v2 full-range loudness of the giant-scale hits on this bench (before giantBody): the rise must stay ≤ 2 LU. */
const V2_FULL_RANGE = { "cue footstep": -25.4, "cue thump": -24.6, "cue heartbeat": -25.7 } as const;

interface Row {
  peak: number;
  lufs: number;
  finite: boolean;
  voicesAfter: number;
  sourcesAfter: number;
  x: Float32Array;
}

const rows = new Map<string, Row>();
let b: Bench | null = null;

afterEach(() => {
  b?.restore();
  b = null;
  ambienceStop();
  sfx.chuffStop();
  sfx.rumbleStop();
  sfx.hold(false);
});

describe("every sound (AUD-1 mix sheet)", () => {
  beforeAll(() => {
    for (const name of Object.keys(SOUNDS)) {
      const r = renderSound(name);
      rows.set(name, { peak: peakDb(r.x), lufs: loudness(r.x, SR), finite: allFinite(r.x), voicesAfter: r.voicesAfter, sourcesAfter: r.sourcesAfter, x: r.x });
    }
  });

  it("catalogues every sfx method (or lists it as a control)", () => {
    const missing = Object.keys(sfx).filter((k) => !SFX_CONTROLS.has(k) && !Object.keys(SOUNDS).some((n) => n === k || n.startsWith(`${k}(`)));
    expect(missing).toEqual([]);
  });

  it("renders finite, non-silent output under +1 dBFS", () => {
    const bad: string[] = [];
    for (const [name, r] of rows) if (!r.finite || r.peak >= 1 || r.peak < -50 || r.lufs < -60) bad.push(`${name}: peak ${r.peak.toFixed(1)} dBFS, ${r.lufs.toFixed(1)} LUFS, finite ${r.finite}`);
    expect(bad).toEqual([]);
  });

  it("matches the mix sheet within ±2 LU", () => {
    const off: string[] = [];
    for (const [name, r] of rows) {
      const want = MIX_SHEET[name];
      if (want === undefined) off.push(`${name}: not on the sheet (measured ${r.lufs.toFixed(1)})`);
      else if (Math.abs(r.lufs - want) > 2) off.push(`${name}: ${r.lufs.toFixed(1)} LUFS, sheet ${want}`);
    }
    expect(off).toEqual([]);
  });

  it("leaks no voice and no source (every sound stops and cleans up)", () => {
    const leaks = [...rows].filter(([, r]) => r.voicesAfter !== 0 || r.sourcesAfter !== 0).map(([n, r]) => `${n}: ${r.voicesAfter} voices, ${r.sourcesAfter} sources`);
    expect(leaks).toEqual([]);
  });

  it("giant impacts reach a small speaker (≥ −40 LUFS) without growing on full range (≤ +2 LU) (AUD-2)", () => {
    for (const [name, v2] of Object.entries(V2_FULL_RANGE)) {
      const r = rows.get(name)!;
      expect(speakerLoudness(r.x, SR), name).toBeGreaterThanOrEqual(-40);
      expect(r.lufs - v2, name).toBeLessThanOrEqual(2);
    }
  });
});

describe("the hold gate (AUD-1, K2)", () => {
  it("parks the chuff under a hold and brings it back at the scene's rate", () => {
    b = bench();
    const ctx = b.ctx;
    const step = (sec: number) => ctx.run(sec, { every: 0.025, fn: loopsTick });
    sfx.chuffStart(4);
    step(1);
    expect(startsOf("chuff")).toBeGreaterThanOrEqual(3);
    sfx.hold(true);
    const atHold = startsOf("chuff");
    // the scene keeps steering the rate meanwhile (TrainPass's chuffSet), and nothing sounds
    sfx.chuffSet(6);
    step(1);
    expect(startsOf("chuff") - atHold).toBe(0);
    sfx.hold(false);
    const atRelease = startsOf("chuff");
    step(1);
    expect(startsOf("chuff") - atRelease).toBeGreaterThanOrEqual(3);
    expect(chuffState()).toMatchObject({ wanted: true, on: true, rate: 6 });
  });

  it("chuffStart is idempotent (sets the rate); a chuff stopped on purpose stays stopped", () => {
    b = bench();
    sfx.chuffStart(3);
    sfx.chuffStart(5);
    expect(chuffState()).toMatchObject({ wanted: true, on: true, rate: 5 });
    sfx.chuffStop();
    sfx.chuffSet(7);
    expect(chuffState()).toMatchObject({ wanted: false, on: false });
  });

  it("silences the rumble within 0.3 s and restores it within 0.5 s", () => {
    b = bench();
    const ctx = b.ctx;
    const world = ctx.tap(b.core.worldDuck);
    sfx.rumbleKind("train");
    sfx.rumbleStart(1);
    ctx.run(2);
    sfx.hold(true);
    sfx.rumbleSet(1); // the frozen scene's driver keeps calling: still parked
    ctx.run(1.3);
    sfx.hold(false);
    ctx.run(1.5);
    const x = world.data();
    const before = loudness(x, SR, 1.5, 2);
    expect(loudness(x, SR, 2.3, 3.3)).toBeLessThan(before - 30);
    expect(loudness(x, SR, 3.8, 4.8)).toBeGreaterThan(before - 3);
  });

  it("lets only the ceremony's voices through", () => {
    b = bench();
    sfx.hold(true);
    sfx.blip(3);
    sfx.clack();
    sfx.cue("footstep");
    sfx.coronationBells();
    sfx.cue("crownTick");
    sfx.migration();
    sfx.record();
    expect([startsOf("blip"), startsOf("clack"), startsOf("footstep")]).toEqual([0, 0, 0]);
    expect([startsOf("coronation"), startsOf("crownTick"), startsOf("migration"), startsOf("record")]).toEqual([1, 1, 1, 1]);
    sfx.hold(false);
    sfx.blip(3);
    expect(startsOf("blip")).toBe(1);
  });
});

describe("the train no longer squeezes the catch (AUD-1)", () => {
  it("royal rumble: mean compressor gain reduction ≤ 1.5 dB (v2: ~7)", () => {
    b = bench();
    sfx.rumbleKind("royal");
    sfx.rumbleStart(1);
    b.ctx.run(3);
    expect(estGainReduction(b.master.data(), SR, COMP, 1.5)).toBeLessThanOrEqual(1.5);
  });

  it("an 8/s blip stream sits within 5 LU of the rumble, and the world bus dips under each blip", () => {
    b = bench();
    const ctx = b.ctx;
    const blips = ctx.tap(b.core.bus);
    const world = ctx.tap(b.core.worldDuck);
    sfx.rumbleKind("train");
    sfx.rumbleStart(1);
    ctx.run(1);
    sfx.blip(0);
    ctx.run(0.03);
    expect(b.core.worldDuck.gain.value).toBeLessThan(0.72);
    ctx.run(0.095);
    for (let i = 1; i < 24; i++) {
      sfx.blip(i);
      ctx.run(1 / 8);
    }
    const gap = loudness(world.data(), SR, 1) - loudness(blips.data(), SR, 1);
    expect(gap).toBeLessThanOrEqual(5);
    ctx.run(0.6);
    expect(b.core.worldDuck.gain.value).toBeGreaterThan(0.97);
  });

  it("the chuff at 8/s is within 12.5 LU of the rumble (v2: 19)", () => {
    b = bench();
    sfx.rumbleKind("train");
    sfx.rumbleStart(1);
    b.ctx.run(3);
    const rumble = loudness(b.master.data(), SR, 1.5);
    b.restore();
    b = bench();
    for (let i = 0; i < 16; i++) chuffAt(0.05 + i / 8, i, 8);
    b.ctx.run(2.2);
    expect(rumble - loudness(b.master.data(), SR)).toBeLessThanOrEqual(12.5);
  });
});

describe("voices at two scales (AUD-2)", () => {
  const voice = (cue: "giantVoice" | "ratChatter", seed: number, dur: number) => {
    b = bench(seed);
    sfx.cue3(cue);
    b.ctx.run(dur);
    const x = b.master.data();
    b.restore();
    b = null;
    return x;
  };

  it("a giant mutters low (centroid ≤ 450 Hz) yet a phone hears him (≥ −42 LUFS)", () => {
    for (const seed of [3, 11, 29, 41]) {
      const x = voice("giantVoice", seed, 2.6);
      expect(centroid(x, SR), `seed ${seed}`).toBeLessThanOrEqual(450);
      expect(speakerLoudness(x, SR), `seed ${seed}`).toBeGreaterThanOrEqual(-42);
    }
  });

  it("a rat chatters high (centroid ≥ 2 kHz)", () => {
    for (const seed of [3, 11, 29, 41]) expect(centroid(voice("ratChatter", seed, 1.2), SR), `seed ${seed}`).toBeGreaterThanOrEqual(2000);
  });

  it("the talking cues wait 4 s between starts; hooves and counters do not", () => {
    b = bench();
    for (let i = 0; i < 3; i++) {
      sfx.cue3("giantVoice");
      sfx.cue3("coachman");
      sfx.cue3("hoof");
      sfx.cue3("counter");
      b.ctx.run(1);
    }
    expect([startsOf("giantVoice"), startsOf("coachman")]).toEqual([1, 1]);
    expect([startsOf("hoof"), startsOf("counter")]).toEqual([3, 3]);
    b.ctx.run(3.2);
    sfx.cue3("giantVoice");
    expect(startsOf("giantVoice")).toBe(2);
  });
});

describe("the ambience (AUD-1, AUD-2 K4)", () => {
  const AMB = { sewers: false, cellars: false, metro: false, terminal: false, clock: false, density: 0, duck: false, steamEff: 1, steamFull: false };
  const runAmb = (sec: number) => b!.ctx.run(sec, { every: 0.12, fn: ambienceTick });

  it("stays in the background with every layer on (≤ −32 LUFS), steam trouble included", () => {
    // seed 23: the loudest of the minute-long renders (mix.slow.test.ts)
    for (const seed of [7, 23]) {
      b?.restore();
      b = bench(seed);
      sfx.ambience({ sewers: true, cellars: true, metro: true, terminal: true, clock: true, density: 1, duck: false, steamEff: 0.3, steamFull: true });
      runAmb(20);
      expect(loudness(b.master.data(), SR, 4), `seed ${seed}`).toBeLessThanOrEqual(-32);
      expect(startsOf("ambWheeze")).toBeGreaterThanOrEqual(1);
      expect(startsOf("ambValve")).toBeGreaterThanOrEqual(1);
    }
  });

  it("the cellar clock drags when the steam runs out, and catches up when it is back", () => {
    b = bench();
    sfx.ambience({ ...AMB, cellars: true, clock: true });
    runAmb(4);
    const full = startsOf("ambClock");
    expect(full).toBeGreaterThanOrEqual(3);
    sfx.ambience({ ...AMB, cellars: true, clock: true, steamEff: 0 });
    runAmb(6);
    // one beat per 1 / 0.35 ≈ 2.9 s (at most one more already scheduled at the old pace)
    expect(startsOf("ambClock") - full).toBeLessThanOrEqual(3);
    const slow = startsOf("ambClock");
    sfx.ambience({ ...AMB, cellars: true, clock: true, steamEff: 1 });
    runAmb(4);
    expect(startsOf("ambClock") - slow).toBeGreaterThanOrEqual(3);
  });

  it("a starved engine wheezes within 12 s; steam at the cap blows the valve within 20 s", () => {
    b = bench();
    sfx.ambience({ ...AMB, steamEff: 0.5 });
    runAmb(12);
    expect(startsOf("ambWheeze")).toBeGreaterThanOrEqual(1);
    expect(startsOf("ambValve")).toBe(0);
    sfx.ambience({ ...AMB, steamFull: true });
    runAmb(20);
    expect(startsOf("ambValve")).toBeGreaterThanOrEqual(1);
  });

  it("without a clock tower or steam trouble there is no clock, wheeze or valve", () => {
    b = bench();
    sfx.ambience({ ...AMB, cellars: true });
    runAmb(25);
    expect([startsOf("ambClock"), startsOf("ambWheeze"), startsOf("ambValve")]).toEqual([0, 0, 0]);
  });

  it("leaves no voice behind once stopped", () => {
    b = bench();
    sfx.ambience({ sewers: true, cellars: true, metro: true, terminal: true, clock: true, density: 1, duck: false, steamEff: 0.4, steamFull: true });
    runAmb(8);
    sfx.ambienceStop();
    b.ctx.skip(30);
    expect(voicesNow()).toBe(0);
    expect(b.ctx.liveSources()).toBe(0);
  });
});
