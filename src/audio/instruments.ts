/**
 * Shared instruments scheduled on a Voice: wood, coins, bells, brass, typewriter keys, blips, hooves, desk stamps.
 * sfx.ts, the cue handlers, the click feel and the ambience all play from this one drawer.
 * v3 (AUD-2): giantBody (the part of a giant's footfall a phone can play) and mutter (one formant voice for the
 * giants upstairs and the rats below, the same instrument at two scales). AUD-3: the music's music box and barrel-organ
 * reed. AUD-4: the catch blips climb G major (blipFreq).
 */
import type { Voice } from "./core";
import { env, filter, noise, pick, rnd, semi, strike, tanhCurve, tone, vibrato, type BellPart } from "./synth";

/**
 * The body of a giant-scale impact on small speakers: a sine falling f0 → 0.7·f0 over `d`, driven hard into a tanh
 * shaper, keeps only its 420 Hz and 700 Hz overtone bands (the "missing fundamental" a phone or a laptop can play),
 * over a short pink-noise gravel crunch at 900 Hz. Sits on top of the sound's own sub-bass.
 */
export function giantBody(v: Voice, t: number, f0: number, d: number, level: number, dest?: AudioNode): void {
  const ws = v.keep(v.ctx.createWaveShaper());
  ws.curve = tanhCurve(8);
  const lo = v.keep(v.ctx.createGain());
  lo.gain.value = 0.8 * level;
  lo.connect(dest ?? v.out);
  const hi = v.keep(v.ctx.createGain());
  hi.gain.value = 0.55 * level;
  hi.connect(dest ?? v.out);
  ws.connect(filter(v, "bandpass", 420, 0.8, lo));
  ws.connect(filter(v, "bandpass", 700, 1.2, hi));
  tone(v, { f: f0, to: f0 * 0.7, glide: d, t, a: 0.004, d, peak: 0.9, dest: ws });
  noise(v, { kind: "pink", t, a: 0.002, d: 0.09, peak: 0.3 * level, filter: "bandpass", f: 900, q: 0.7, dest });
}

/** Vowel formants F1/F2 (Hz) for the mutter, before the speaker's scale `formK`. */
export const VOWELS = { a: [800, 1200], o: [500, 900], u: [350, 700], e: [500, 1800], i: [300, 2200] } as const;
export type Vowel = keyof typeof VOWELS;
const VOWEL_KEYS = Object.keys(VOWELS) as Vowel[];

export interface MutterOpts {
  /** Voice pitch (Hz). */
  f0: number;
  /** Syllables per second. */
  syll: number;
  /** Number of syllables. */
  n: number;
  /** Formant scale: 0.8 a giant's chest, 2.3 a rat's snout. */
  formK: number;
  /** Optional lowpass (a giant heard through the street) / highpass (a rat's thin squeak). */
  lp?: number;
  hp?: number;
  level: number;
  /** "fall" (default): a statement, ×1.1 → ×0.85; "shout": the last syllable rises +30%. */
  contour?: "fall" | "shout";
  /** Fixed vowels (default: random from `pool`). */
  vowels?: readonly Vowel[];
  /** Vowels to pick from (default: all five; a rat squeaks «и», «е», «а»). */
  pool?: readonly Vowel[];
  /** Hold multipliers per syllable (a drawn-out «о-о!»). */
  holds?: readonly number[];
  /** First- and second-formant gains (default 1 and 0.6; a rat's squeak lives in the second). */
  f1?: number;
  f2?: number;
  /** Giant chest resonance per syllable (giantBody at this level × level). */
  chest?: number;
  dest?: AudioNode;
}

/**
 * Murmured speech without words: a sawtooth (±3% jitter per syllable, a falling or shouted contour) through two
 * formant bandpasses (Q 6 / Q 8) that step from vowel to vowel; each syllable has its own envelope (a 30 ms, hold
 * 0.6 / syll, d 80 ms), so fast rat chatter overlaps instead of clicking. Returns the end time.
 */
export function mutter(v: Voice, t: number, o: MutterOpts): number {
  const ctx = v.ctx;
  const n = Math.max(1, Math.round(o.n));
  const gap = 1 / Math.max(0.5, o.syll);
  let post: AudioNode = o.dest ?? v.out;
  if (o.lp) post = filter(v, "lowpass", o.lp, 0.7, post);
  if (o.hp) post = filter(v, "highpass", o.hp, 0.7, post);
  const sum = v.keep(ctx.createGain());
  sum.gain.value = 1;
  const g1 = v.keep(ctx.createGain());
  g1.gain.value = o.f1 ?? 1;
  g1.connect(sum);
  const bp1 = filter(v, "bandpass", 500 * o.formK, 6, g1);
  const g2 = v.keep(ctx.createGain());
  g2.gain.value = o.f2 ?? 0.6;
  g2.connect(sum);
  const bp2 = filter(v, "bandpass", 900 * o.formK, 8, g2);
  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  osc.connect(bp1);
  osc.connect(bp2);
  let end = t;
  for (let i = 0; i < n; i++) {
    const ti = t + i * gap;
    const x = n > 1 ? i / (n - 1) : 0;
    const shape = o.contour === "shout" && i === n - 1 ? 1.3 : 1.1 - 0.25 * x;
    const f = o.f0 * shape * rnd(0.97, 1.03);
    const [F1, F2] = VOWELS[o.vowels?.[i] ?? pick(o.pool ?? VOWEL_KEYS)];
    if (i === 0) {
      osc.frequency.setValueAtTime(f, ti);
      bp1.frequency.setValueAtTime(F1 * o.formK, ti);
      bp2.frequency.setValueAtTime(F2 * o.formK, ti);
    } else {
      osc.frequency.setTargetAtTime(f, ti - 0.01, 0.02);
      bp1.frequency.setTargetAtTime(F1 * o.formK, ti - 0.01, 0.02);
      bp2.frequency.setTargetAtTime(F2 * o.formK, ti - 0.01, 0.02);
    }
    const hold = (0.6 * gap) * (o.holds?.[i] ?? 1);
    const e = v.keep(ctx.createGain());
    e.gain.value = 0; // silent until its syllable (the saw runs through the whole phrase)
    e.connect(post);
    sum.connect(e);
    e.gain.setValueAtTime(0, ti);
    e.gain.linearRampToValueAtTime(o.level, ti + 0.03);
    e.gain.setValueAtTime(o.level, ti + 0.03 + hold);
    e.gain.exponentialRampToValueAtTime(0.0001, ti + 0.03 + hold + 0.08);
    end = Math.max(end, ti + 0.03 + hold + 0.08);
    if (o.chest) giantBody(v, ti, f, hold + 0.08, o.chest * o.level, post);
  }
  v.run(osc, t, end + 0.02);
  return end;
}

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

/** G-major degrees (semitones above G4) of the catch blips: one octave per 7 steps. */
export const BLIP_DEGREES = [0, 2, 4, 5, 7, 9, 11] as const;
/** The blips climb two octaves, then start over. */
export const BLIP_WRAP = 14;
/** G4: the catch blips share the key of the clicks and the coins (and the music). */
const BLIP_ROOT = 392;

/**
 * Frequency of catch-combo step `step` (v3 AUD-4): G-major degrees from G4, 12 semitones per 7 steps, wrapping every
 * 14 steps (G4 … F#6), so a long combo climbs the same scale the clicks and the coins ring in (v2: chromatic from C5).
 */
export function blipFreq(step: number): number {
  const s = (((Math.round(Number.isFinite(step) ? step : 0)) % BLIP_WRAP) + BLIP_WRAP) % BLIP_WRAP;
  return BLIP_ROOT * semi(BLIP_DEGREES[s % 7] + 12 * Math.floor(s / 7));
}

export function blipAt(v: Voice, t: number, step: number, level: number): void {
  const f = blipFreq(step);
  tone(v, { type: "triangle", f: f * 0.985, to: f, glide: 0.02, t, a: 0.003, d: 0.16, peak: 0.27 * level });
  tone(v, { f: f * 2, t, a: 0.002, d: 0.08, peak: 0.075 * level });
}

/** One hoof on the cobbles; `pitch` 1 / 0.88 alternates the fore and hind feet. */
export function hoof(v: Voice, t: number, level: number, dest?: AudioNode, pitch = 1): void {
  const k = rnd(0.94, 1.06) * pitch;
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

/* ------------------------------------------------------------- music (v3 AUD-3) */

/** A music-box comb tooth: the tooth, its octave and a high inharmonic flutter. */
export const MUSIC_BOX: readonly BellPart[] = [
  [1, 0.12, 1.1],
  [2, 0.02, 0.35],
  [5.93, 0.015, 0.08],
];

/** The music box's 3.2 kHz lowpass, shared by every note of one voice (pass it as `dest` to musicBox). */
export function musicBoxOut(v: Voice, dest?: AudioNode): AudioNode {
  return filter(v, "lowpass", 3200, 0.7, dest);
}

/**
 * One plucked music-box note at `f`: the comb partials (MUSIC_BOX) and a 4 ms pluck (noise band 3.5 kHz), all
 * through a 3.2 kHz lowpass (musicBoxOut; built here when no `dest` is given).
 */
export function musicBox(v: Voice, t: number, f: number, level: number, dest?: AudioNode): void {
  const out = dest ?? musicBoxOut(v);
  strike(v, t, f, MUSIC_BOX, level, out);
  noise(v, { t, a: 0.0005, d: 0.004, peak: 0.05 * level, filter: "bandpass", f: 3500, q: 1.5, dest: out });
}

/**
 * A barrel-organ reed: two squares ±6 cents through a 1200 Hz lowpass, a 5.5 Hz tremolo (depth 0.15), attack 20 ms,
 * held `dur` s, released over 0.25 s. The "pah-pah" of the waltz and Whitechapel's lead.
 */
export function organReed(v: Voice, t: number, f: number, dur: number, level: number, dest?: AudioNode): void {
  const ctx = v.ctx;
  const amp = v.keep(ctx.createGain());
  amp.connect(dest ?? v.out);
  const hold = Math.max(0.02, dur - 0.02);
  const end = env(amp.gain, t, level, 0.02, 0.25, hold);
  const trem = v.keep(ctx.createGain());
  trem.gain.value = 1 - 0.15;
  trem.connect(amp);
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 5.5;
  const depth = v.keep(ctx.createGain());
  depth.gain.value = 0.15;
  lfo.connect(depth);
  depth.connect(trem.gain);
  v.run(lfo, t, end + 0.02);
  const lp = filter(v, "lowpass", 1200, 0.7, trem);
  for (const cents of [-6, 6]) {
    const o = ctx.createOscillator();
    o.type = "square";
    o.frequency.setValueAtTime(f, t);
    o.detune.setValueAtTime(cents, t);
    const g = v.keep(ctx.createGain());
    g.gain.value = 0.5;
    o.connect(g);
    g.connect(lp);
    v.run(o, t, end + 0.02);
  }
}
