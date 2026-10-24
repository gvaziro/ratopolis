/**
 * Shared instruments scheduled on a Voice: wood, coins, bells, brass, typewriter keys, blips, hooves, desk stamps.
 * sfx.ts, the cue handlers, the click feel and the ambience all play from this one drawer.
 */
import type { Voice } from "./core";
import { noise, rnd, semi, strike, tone, vibrato, type BellPart } from "./synth";

/** Hollow wooden "tok". */
export function woodTok(v: Voice, t: number, k: number, level: number, dest?: AudioNode): void {
  tone(v, { f: 620 * k, to: 470 * k, glide: 0.05, t, a: 0.002, d: 0.075, peak: 0.3 * level, dest });
  tone(v, { type: "triangle", f: 1490 * k, t, a: 0.001, d: 0.028, peak: 0.06 * level, dest });
  noise(v, { t, a: 0.001, d: 0.012, peak: 0.09 * level, filter: "bandpass", f: 2600 * k, q: 1.4, dest });
}

/**
 * Tuned wooden "tok" for the grate click: a marimba-ish bar at `f` (a clear pitch, so a streak can climb a scale)
 * whose bright partials and knock thin out as it climbs, so the top octave never turns shrill.
 */
export function clickTok(v: Voice, t: number, f: number, level: number): void {
  const k = f / 620;
  const bright = Math.min(1, 1 / k);
  tone(v, { f, to: f * 0.76, glide: 0.05, t, a: 0.002, d: 0.085, peak: 0.3 * level });
  tone(v, { f: f * 4, t, a: 0.001, d: 0.035, peak: 0.035 * level * bright });
  tone(v, { type: "triangle", f: f * 2.4, t, a: 0.001, d: 0.024, peak: 0.05 * level * bright });
  noise(v, { t, a: 0.001, d: 0.011, peak: 0.085 * level, filter: "bandpass", f: Math.min(4200, 2600 * Math.sqrt(k)), q: 1.4 });
}

/** Muffled "тук" of a box set down (purchase; machinery pulses in the ambience). */
export function thudAt(v: Voice, t: number, k: number, level: number): void {
  tone(v, { f: 160 * k, to: 62, glide: 0.14, t, a: 0.003, d: 0.2, peak: 0.5 * level });
  tone(v, { type: "triangle", f: 260 * k, to: 130 * k, glide: 0.08, t, a: 0.002, d: 0.11, peak: 0.4 * level });
  // the box itself: a short hollow knock so laptop speakers get the "тук"
  tone(v, { f: 480 * k, to: 330 * k, glide: 0.04, t, a: 0.001, d: 0.06, peak: 0.14 * level });
  noise(v, { kind: "brown", t, a: 0.002, d: 0.06, peak: 0.35 * level, filter: "lowpass", f: 700 });
  noise(v, { t, a: 0.001, d: 0.02, peak: 0.08 * level, filter: "bandpass", f: 1800, q: 1 });
}

/** Bright coin "tink" with a short second ring. */
export function coinTink(v: Voice, t: number, f: number, level: number, dest?: AudioNode): void {
  tone(v, { f, t, a: 0.001, d: 0.22, peak: 0.155 * level, dest });
  tone(v, { f: f * 2.76, t, a: 0.001, d: 0.08, peak: 0.055 * level, dest });
  tone(v, { f: f * 1.5, t: t + 0.045, a: 0.001, d: 0.2, peak: 0.085 * level, dest });
  noise(v, { t, a: 0.0005, d: 0.006, peak: 0.07 * level, filter: "highpass", f: 6000, dest });
}

/** G-major pentatonic steps of the coin tinks (1568 Hz = G6); the grate click is tuned to the same key. */
export const COIN_STEPS = [0, 2, 4, 7, 9] as const;

export const GLOCK: readonly BellPart[] = [
  [1, 0.17, 0.5],
  [2.0, 0.035, 0.18],
  [3.99, 0.02, 0.09],
];
export const SMALL_BELL: readonly BellPart[] = [
  [1, 0.15, 0.7],
  [1.003, 0.05, 0.7],
  [2.32, 0.05, 0.28],
  [4.08, 0.025, 0.1],
];
export const HAND_BELL: readonly BellPart[] = [
  [1, 0.15, 0.9],
  [2.03, 0.055, 0.5],
  [2.92, 0.045, 0.35],
  [4.18, 0.025, 0.2],
  [5.4, 0.012, 0.12],
];
export const CHIME: readonly BellPart[] = [
  [1, 0.11, 0.8],
  [2.76, 0.035, 0.3],
  [5.4, 0.014, 0.12],
];
/** Big tower bell: hum, prime (+ beating twin), minor-third tierce, quint, nominal and upper partials. */
export const TOWER_BELL: readonly BellPart[] = [
  [0.5, 0.13, 6.5],
  [1, 0.18, 4.6],
  [1.004, 0.07, 4.6],
  [1.19, 0.12, 3.2],
  [1.5, 0.055, 2.4],
  [2, 0.19, 2.7],
  [2.51, 0.075, 1.6],
  [3.01, 0.06, 1.1],
  [4.07, 0.04, 0.7],
];

/**
 * Detuned-saw brass note with a filter "blat" on the attack. A long `attack` turns it into a swell
 * (the blat opens over the same time).
 */
export function brass(v: Voice, t: number, f: number, dur: number, peak: number, dest?: AudioNode, attack = 0.03): void {
  const ctx = v.ctx;
  const amp = v.keep(ctx.createGain());
  amp.connect(dest ?? v.out);
  const lp = v.keep(ctx.createBiquadFilter());
  lp.type = "lowpass";
  lp.Q.value = 2;
  lp.connect(amp);
  const a = Math.max(0.01, attack);
  lp.frequency.setValueAtTime(f * 1.2, t);
  lp.frequency.linearRampToValueAtTime(f * 6, t + a + 0.01);
  lp.frequency.setTargetAtTime(f * 3.4, t + a + 0.02, 0.08);
  lp.frequency.setTargetAtTime(f * 1.4, t + Math.max(dur, a), 0.05);
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(peak, t + a);
  amp.gain.setTargetAtTime(peak * 0.72, t + a + 0.01, 0.1);
  amp.gain.setTargetAtTime(0, t + Math.max(dur, a), 0.06 + 0.1 * Math.min(1, a));
  const end = t + Math.max(dur, a) + 0.45 + 0.4 * Math.min(1, a);
  for (const cents of [-7, 7]) {
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.detune.setValueAtTime(cents, t);
    o.frequency.setValueAtTime(f * 0.97, t);
    o.frequency.exponentialRampToValueAtTime(f, t + Math.min(0.2, Math.max(0.035, a)));
    o.connect(lp);
    if (dur > 0.3) vibrato(v, o.detune, t, end, 5.5, 9, 0.18);
    v.run(o, t, end);
  }
}

/** One typewriter key: paper-thin clack, type-bar body, a hint of bell metal, the desk. */
export function typeKey(v: Voice, t: number, level: number): void {
  const k = rnd(0.92, 1.08);
  noise(v, { t, a: 0.0005, d: 0.018, peak: 0.45 * level, filter: "bandpass", f: 3200 * k, q: 1.6 });
  tone(v, { type: "square", f: 210 * k, to: 150 * k, glide: 0.018, t, a: 0.001, d: 0.018, peak: 0.09 * level });
  tone(v, { f: 4100 * k, t, a: 0.001, d: 0.03, peak: 0.04 * level });
  noise(v, { kind: "brown", t, a: 0.001, d: 0.025, peak: 0.25 * level, filter: "lowpass", f: 600 });
}

export function blipAt(v: Voice, t: number, step: number, level: number): void {
  const s = ((Math.round(step) % 24) + 24) % 24;
  const f = 523.25 * semi(s);
  tone(v, { type: "triangle", f: f * 0.985, to: f, glide: 0.02, t, a: 0.003, d: 0.16, peak: 0.27 * level });
  tone(v, { f: f * 2, t, a: 0.002, d: 0.08, peak: 0.075 * level });
}

export function hoof(v: Voice, t: number, level: number, dest?: AudioNode): void {
  const k = rnd(0.94, 1.06);
  tone(v, { f: 430 * k, to: 300 * k, glide: 0.035, t, a: 0.001, d: 0.06, peak: 0.24 * level, dest });
  tone(v, { f: 980 * k, t, a: 0.001, d: 0.02, peak: 0.05 * level, dest });
  noise(v, { t, a: 0.0008, d: 0.012, peak: 0.07 * level, filter: "bandpass", f: 1700 * k, q: 1.2, dest });
}

/** A rubber stamp on paper over a wooden desk: the slap, the rubber, the desk. */
export function stampAt(v: Voice, t: number, k: number, level: number): void {
  tone(v, { f: 150 * k, to: 70 * k, glide: 0.1, t, a: 0.002, d: 0.13, peak: 0.42 * level });
  tone(v, { type: "triangle", f: 330 * k, to: 190 * k, glide: 0.04, t, a: 0.001, d: 0.05, peak: 0.2 * level });
  noise(v, { kind: "pink", t, a: 0.001, d: 0.05, peak: 0.32 * level, filter: "bandpass", f: 1100 * k, q: 0.7 });
  noise(v, { kind: "brown", t, a: 0.001, d: 0.06, peak: 0.3 * level, filter: "lowpass", f: 500 });
  noise(v, { t, a: 0.0005, d: 0.014, peak: 0.06 * level, filter: "highpass", f: 3000 });
}

/** Paper being unfolded: a few crinkles over `dur` s. */
export function rustle(v: Voice, t: number, dur: number, level: number): void {
  const n = Math.max(3, Math.round(dur * 22));
  for (let i = 0; i < n; i++) {
    const at = t + (i / n) * dur + rnd(0, dur / n);
    noise(v, { kind: "pink", t: at, a: 0.002, d: rnd(0.012, 0.035), peak: rnd(0.08, 0.17) * level, filter: "bandpass", f: rnd(2200, 4800), q: 1.1 });
  }
  noise(v, { t, a: dur * 0.3, hold: dur * 0.3, d: dur * 0.4, peak: 0.025 * level, filter: "highpass", f: 3500 });
}

/** A brass gear ratchet: `n` pawl clicks `gap` s apart. */
export function ratchet(v: Voice, t: number, n: number, gap: number, k: number, level: number): void {
  for (let i = 0; i < n; i++) {
    const at = t + i * gap;
    noise(v, { t: at, a: 0.0005, d: 0.008, peak: 0.2 * level, filter: "bandpass", f: 2800 * k, q: 2 });
    tone(v, { f: 1320 * k * rnd(0.98, 1.02), t: at, a: 0.0008, d: 0.014, peak: 0.06 * level });
  }
}

/** A bright glockenspiel ping (unlock, scouts). */
export function ping(v: Voice, t: number, f: number, level: number): void {
  strike(v, t, f, GLOCK, level);
  tone(v, { f: f * 3, t, a: 0.001, d: 0.05, peak: 0.02 * level });
}
