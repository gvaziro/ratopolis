/**
 * v3 voices (AUD-2). The giants upstairs and the rats below finally speak — one formant `mutter` at two scales —
 * through the v3 cues (UiFx "sfx3" from sfxCue3(): giantVoice, ratChatter, coachman, hoof, curio, counter, growl),
 * and the colony events that used to pass in silence get a sound: hunger (a belly growl and a thin squeak; nibbles
 * when it ends), a store blowing its safety valve, the Thunder God's «Гул из глубины», a curio for the King's
 * Kunstkamera, the crew's chatter. Every one is an ordinary throttled voice (the voice caps and the hold gate apply);
 * the talking cues wait at least 4 s between starts so a scene never chatters over itself.
 */
import type { SfxCue3 } from "@/game/fx";
import { play } from "./core";
import { coinTink, giantBody, GLOCK, hoof, mutter, SMALL_BELL, woodTok, type MutterOpts } from "./instruments";
import { filter, noise, panner, rnd, strike, tanhCurve, tone, vibrato } from "./synth";
import { clampGain, clampPitch } from "./cues";

type CueFn = (gain: number, p: number) => void;

const int = (a: number, b: number): number => Math.floor(rnd(a, b + 1));

/**
 * A giant's mutter heard through the street: low, slow, chesty, behind a 650 Hz lowpass (spectral centroid ≈ 350 Hz).
 * `level` is the phrase's inner level, `gain` the voice gain.
 */
export const GIANT = { f0: [82, 110], syll: 3.2, n: [4, 7], formK: 0.8, lp: 650, chest: 0.9, level: 1, gain: 0.5 } as const;
/** A rat's chatter: high, quick, thin — «и», «е», «а» with the second formant up front (centroid ≥ 2 kHz). */
export const RAT = { f0: [1100, 1400], syll: 11, n: [3, 6], formK: 2.3, hp: 700, f1: 0.4, f2: 1.6, pool: ["i", "e", "a"], level: 1.4, gain: 0.18 } as const;

function giantPhrase(p: number, o: Partial<MutterOpts> = {}): MutterOpts {
  return {
    f0: rnd(GIANT.f0[0], GIANT.f0[1]) * p,
    syll: GIANT.syll,
    n: int(GIANT.n[0], GIANT.n[1]),
    formK: GIANT.formK,
    lp: GIANT.lp,
    chest: GIANT.chest,
    level: GIANT.level,
    ...o,
  };
}

function ratPhrase(p: number, o: Partial<MutterOpts> = {}): MutterOpts {
  return {
    f0: rnd(RAT.f0[0], RAT.f0[1]) * p,
    syll: RAT.syll,
    n: int(RAT.n[0], RAT.n[1]),
    formK: RAT.formK,
    hp: RAT.hp,
    f1: RAT.f1,
    f2: RAT.f2,
    pool: RAT.pool,
    level: RAT.level,
    ...o,
  };
}

/** Where the chattering rats stand (first in the middle). */
const CHATTER_PANS = [0, -0.45, 0.4, -0.2] as const;

/** The crew murmurs: `voices` rats (≤ 4), staggered and spread; `cheer` ends each phrase on a rising squeal. */
export function ratChatterVoice(gain = 1, p = 1, voices = 1, cheer = false, key = "ratChatter"): void {
  play(key, { max: 2, gapMs: 4000 }, { gain: RAT.gain * gain, send: 0.12 }, (v) => {
    const n = Math.max(1, Math.min(CHATTER_PANS.length, Math.round(voices)));
    for (let i = 0; i < n; i++) {
      const at = v.t + i * rnd(0.18, 0.3);
      const dest = n > 1 && i > 0 ? panner(v, CHATTER_PANS[i]) : undefined;
      mutter(v, at, ratPhrase(p * rnd(0.94, 1.06), { contour: cheer ? "shout" : "fall", dest }));
    }
  });
}

/** Where the giants on the platform stand. */
const CROWD_PANS = [-0.55, 0.5, -0.15, 0.25] as const;

/**
 * v3 (AUD-4): the rush-hour crowd on the platform above, heard under the pass: four giants muttering over each other
 * through the street (a 500 Hz lowpass), staggered over ~2.5 s, well under the train.
 */
export function crowdVoice(gain = 1, delay = 0): void {
  play("crowd", { max: 1, gapMs: 6000 }, { gain: 0.35 * GIANT.gain * gain, send: 0.3, delay }, (v) => {
    CROWD_PANS.forEach((pan, i) => {
      mutter(v, v.t + i * rnd(0.5, 0.75), giantPhrase(rnd(0.85, 1.15), { lp: 500, chest: 0.5, n: int(5, 8), dest: panner(v, pan) }));
    });
  });
}

/** A giant's muttered sentence from above (the conductor, a lady, the lineman): pitch < 1 = deeper. */
export function giantVoiceAt(gain = 1, p = 1): void {
  play("giantVoice", { max: 1, gapMs: 4000 }, { gain: GIANT.gain * gain, send: 0.3 }, (v) => {
    mutter(v, v.t, giantPhrase(p));
  });
}

/** The coachman's «Но-о!»: a nasal hum into two shouted «о», the second drawn out. */
function coachmanVoice(gain: number, p: number): void {
  play("coachman", { max: 1, gapMs: 4000 }, { gain: 0.7 * GIANT.gain * gain, send: 0.35 }, (v) => {
    const f0 = 100 * p * rnd(0.95, 1.05);
    // «н»: a closed-mouth hum before the vowel
    tone(v, { type: "triangle", f: f0, t: v.t, a: 0.02, hold: 0.05, d: 0.05, peak: 0.12, dest: filter(v, "lowpass", 320, 0.7) });
    mutter(v, v.t + 0.07, giantPhrase(p, { f0, n: 2, vowels: ["o", "o"], contour: "shout", holds: [0.7, 2.6] }));
  });
}

let hoofN = 0;

/** One hoof on the cobbles, fore and hind feet alternating (pitch 1 / 0.88). */
export function hoofVoice(gain = 1, p = 1): void {
  const k = hoofN++ % 2 === 0 ? 1 : 0.88;
  play("hoof", { max: 6, gapMs: 40 }, { gain, send: 0.2, pan: rnd(-0.25, 0.25) }, (v) => hoof(v, v.t, 1.1, undefined, k * p));
}

/** A curio for «Кунсткамера Короля»: a small bell and a sparkle running up over it. */
export function curioVoice(gain = 1, p = 1): void {
  play("curio", { max: 1, gapMs: 4000 }, { gain: 0.8 * gain, send: 0.35, fg: true }, (v) => {
    strike(v, v.t, 1568 * p, SMALL_BELL, 1.1);
    [2637, 3136, 3951, 4699].forEach((f, i) => strike(v, v.t + 0.12 + i * 0.05, f * p, GLOCK, 0.5 + 0.12 * i, panner(v, -0.3 + 0.2 * i)));
    coinTink(v, v.t + 0.36, 3520 * p, 0.35);
  });
}

/** A countered cat lunge: a heavy «БОНГ» — the paw meets a frying pan. */
function counterVoice(gain: number, p: number): void {
  play("counter", { max: 3, gapMs: 60 }, { gain, send: 0.18, fg: true }, (v) => {
    const t = v.t;
    const k = p * rnd(0.96, 1.04);
    tone(v, { f: 210 * k, to: 58 * k, glide: 0.09, t, a: 0.001, d: 0.22, peak: 0.6 });
    // the pan: inharmonic partials of a struck iron plate
    for (const [r, g, d] of [
      [1, 0.16, 0.32],
      [2.41, 0.08, 0.16],
      [3.93, 0.045, 0.09],
    ] as const) {
      tone(v, { f: 470 * r * k, t, a: 0.001, d, peak: g });
    }
    noise(v, { t, a: 0.0005, d: 0.04, peak: 0.25, filter: "bandpass", f: 1900 * k, q: 0.9 });
    noise(v, { kind: "brown", t, a: 0.001, d: 0.12, peak: 0.35, filter: "lowpass", f: 500 });
    giantBody(v, t, 110 * k, 0.15, 0.3);
  });
}

/** The cat's growl before a lunge: a low rattling «ррр» through an open throat, swelling and dying. */
function catGrowl(gain: number, p: number): void {
  play("growl", { max: 1, gapMs: 4000 }, { gain, send: 0.25 }, (v) => {
    const t = v.t;
    const ctx = v.ctx;
    const dur = 0.75;
    const lp = filter(v, "lowpass", 1600, 0.7);
    const amp = v.keep(ctx.createGain());
    amp.connect(lp);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(0.55, t + 0.25);
    amp.gain.setValueAtTime(0.55, t + 0.5);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    // the rattle: a fast tremolo
    const trem = v.keep(ctx.createGain());
    trem.gain.value = 0.6;
    trem.connect(amp);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 23;
    const depth = v.keep(ctx.createGain());
    depth.gain.value = 0.4;
    lfo.connect(depth);
    depth.connect(trem.gain);
    v.run(lfo, t, t + dur + 0.05);
    const f1 = filter(v, "bandpass", 480 * p, 3, trem);
    const f2g = v.keep(ctx.createGain());
    f2g.gain.value = 0.45;
    f2g.connect(trem);
    const f2 = filter(v, "bandpass", 1050 * p, 4, f2g);
    for (const [type, mul, g] of [
      ["sawtooth", 1, 1],
      ["square", 1.012, 0.3],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(72 * p * mul, t);
      o.frequency.linearRampToValueAtTime(88 * p * mul, t + 0.3);
      o.frequency.linearRampToValueAtTime(68 * p * mul, t + dur);
      const og = v.keep(ctx.createGain());
      og.gain.value = g;
      o.connect(og);
      og.connect(f1);
      og.connect(f2);
      v.run(o, t, t + dur + 0.05);
    }
    noise(v, { kind: "pink", t, a: 0.2, hold: 0.2, d: 0.3, peak: 0.06, filter: "bandpass", f: 700 * p, q: 1.5 });
  });
}

const CUES3: Record<SfxCue3, CueFn> = {
  giantVoice: (gain, p) => giantVoiceAt(gain, p),
  ratChatter: (gain, p) => ratChatterVoice(gain, p, 1),
  coachman: coachmanVoice,
  hoof: (gain, p) => hoofVoice(gain, p),
  curio: (gain, p) => curioVoice(gain, p),
  counter: counterVoice,
  growl: catGrowl,
};

/** Every SfxCue3 (the test bench renders each). */
export const CUE3_NAMES = Object.keys(CUES3) as SfxCue3[];

/** Play one v3 cue: intensity 0..1 (default 1) scales the volume, pitch (default 1) multiplies the frequency. */
export function playCue3(cue: SfxCue3, intensity?: number, pitch?: number): void {
  const fn = CUES3[cue];
  if (!fn) return; // an unknown cue from a newer UI: stay quiet
  const g = clampGain(intensity);
  if (g <= 0.001) return;
  fn(g, clampPitch(pitch));
}

/* ------------------------------------------------------------ colony events */

/** Hunger: the colony's belly growls (brown noise under 160 Hz, wobbling at 7 Hz) and a thin squeak falls. */
export function hungerVoice(gain = 1): void {
  play("hunger", { max: 1, gapMs: 5000 }, { gain: 0.7 * gain, send: 0.12 }, (v) => {
    const t = v.t;
    const ctx = v.ctx;
    const dur = 0.9;
    const amp = v.keep(ctx.createGain());
    amp.connect(v.out);
    amp.gain.value = 0.4;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 7;
    const depth = v.keep(ctx.createGain());
    depth.gain.value = 0.6 * 0.4;
    lfo.connect(depth);
    depth.connect(amp.gain);
    v.run(lfo, t, t + dur + 0.05);
    noise(v, { kind: "brown", t, a: 0.15, hold: 0.35, d: 0.4, peak: 1.2, filter: "lowpass", f: 160, dest: amp });
    // the gurgle a laptop can hear
    noise(v, { kind: "brown", t: t + 0.1, a: 0.12, hold: 0.25, d: 0.35, peak: 0.5, filter: "bandpass", f: 380, to: 260, q: 2.5, dest: amp });
    const sq = t + 0.55;
    const { osc, end } = tone(v, { f: 2300, to: 1500, glide: 0.22, t: sq, a: 0.015, hold: 0.06, d: 0.16, peak: 0.12 });
    vibrato(v, osc.frequency, sq, end, 30, 40);
  });
}

/** Hunger is over: three quick nibbles. */
export function nibbleVoice(): void {
  play("nibble", { max: 1, gapMs: 1500 }, { send: 0.08, pan: rnd(-0.3, 0.3) }, (v) => {
    for (let i = 0; i < 3; i++) woodTok(v, v.t + i * 0.06, 1.6 * rnd(0.97, 1.03), 0.75 - 0.1 * i);
  });
}

/** A store overflows: its safety valve pops and hisses (band 3.6 → 2 kHz, 0.35 s). */
export function valveVoice(gain = 1): void {
  play("valve", { max: 1, gapMs: 1200 }, { gain, send: 0.15, pan: rnd(-0.3, 0.3) }, (v) => {
    const t = v.t;
    tone(v, { f: 900, to: 300, glide: 0.03, t, a: 0.001, d: 0.045, peak: 0.25 });
    noise(v, { t, a: 0.0005, d: 0.015, peak: 0.2, filter: "bandpass", f: 1500, q: 1.2 });
    noise(v, { t: t + 0.02, a: 0.02, hold: 0.12, d: 0.2, peak: 0.24, filter: "bandpass", f: 3600, to: 2000, q: 1.2 });
  });
}

/**
 * «Гул из глубины»: the Thunder God passes somewhere under the burrow — 2.5 s of the train's rumble at 40% of its
 * level, rising and fading, with the rails' rattle barely there. On the world bus, like the real thing.
 */
export function deepRumbleVoice(): void {
  play("deepRumble", { max: 1, gapMs: 8000 }, { bus: "world", gain: 0.4 }, (v) => {
    const ctx = v.ctx;
    const t0 = v.t;
    const env = v.keep(ctx.createGain());
    env.connect(v.out);
    // the train rumble's level at intensity ~0.9 (loops.ts KINDS.train), shaped 0.8 s up, 0.7 s on, 1 s away
    const peak = 0.44 * Math.pow(0.9, 1.3);
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(peak, t0 + 0.8);
    env.gain.setValueAtTime(peak, t0 + 1.5);
    env.gain.linearRampToValueAtTime(0, t0 + 2.5);
    const end = t0 + 2.55;
    const brown = ctx.createBufferSource();
    brown.buffer = v.c.noise.brown;
    brown.loop = true;
    const body = v.keep(ctx.createGain());
    body.gain.value = 0.6;
    body.connect(env);
    brown.connect(filter(v, "lowpass", 85, 0.7, body));
    // the rumble's saturated 220 Hz overtones (what a laptop hears), driven like loops.ts does
    const drive = v.keep(ctx.createGain());
    drive.gain.value = 3;
    const sat = v.keep(ctx.createWaveShaper());
    sat.curve = tanhCurve(2.5);
    drive.connect(sat);
    const harm = v.keep(ctx.createGain());
    harm.gain.value = 0.9;
    harm.connect(env);
    sat.connect(filter(v, "bandpass", 220, 0.8, harm));
    brown.connect(filter(v, "lowpass", 150, 0.7, drive));
    v.run(brown, t0, end, Math.random() * 3);
    // the rails' rattle, trembling at ~10 Hz
    const trem = v.keep(ctx.createGain());
    trem.gain.value = 0.55;
    trem.connect(env);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 10;
    const depth = v.keep(ctx.createGain());
    depth.gain.value = 0.45;
    lfo.connect(depth);
    depth.connect(trem.gain);
    v.run(lfo, t0, end);
    noise(v, { kind: "pink", t: t0, a: 0.8, hold: 0.7, d: 1, peak: 1.5, filter: "bandpass", f: 420, q: 1.3, dest: trem });
    giantBody(v, t0 + 0.75, 42, 0.6, 0.25);
  });
}
