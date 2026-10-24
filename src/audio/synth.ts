/** Small synthesis building blocks scheduled on a Voice: enveloped tones, filtered noise, bells, vibrato. */
import type { NoiseKind, Voice } from "./core";

export const semi = (n: number): number => Math.pow(2, n / 12);
export const rnd = (a: number, b: number): number => a + Math.random() * (b - a);
export const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];

const FLOOR = 0.0001;

/** 0 → peak in `a`, optional hold, then an exponential fall over `d`. Returns the end time. */
export function env(p: AudioParam, t: number, peak: number, a: number, d: number, hold = 0): number {
  const pk = Math.max(peak, FLOOR * 2);
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(pk, t + a);
  if (hold > 0) p.setValueAtTime(pk, t + a + hold);
  p.exponentialRampToValueAtTime(FLOOR, t + a + hold + d);
  return t + a + hold + d;
}

export interface ToneOpts {
  f: number;
  t: number;
  /** Decay (release) time. */
  d: number;
  peak: number;
  type?: OscillatorType;
  a?: number;
  hold?: number;
  /** Exponential pitch glide target, reached after `glide` s (default: the whole decay). */
  to?: number;
  glide?: number;
  /** Cents. */
  detune?: number;
  dest?: AudioNode;
}

export interface ToneNodes {
  osc: OscillatorNode;
  amp: GainNode;
  end: number;
}

export function tone(v: Voice, o: ToneOpts): ToneNodes {
  const ctx = v.ctx;
  const osc = ctx.createOscillator();
  osc.type = o.type ?? "sine";
  osc.frequency.setValueAtTime(o.f, o.t);
  if (o.to !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.to), o.t + (o.glide ?? o.d));
  if (o.detune) osc.detune.setValueAtTime(o.detune, o.t);
  const amp = v.keep(ctx.createGain());
  const end = env(amp.gain, o.t, o.peak, o.a ?? 0.003, o.d, o.hold);
  osc.connect(amp);
  amp.connect(o.dest ?? v.out);
  v.run(osc, o.t, end + 0.02);
  return { osc, amp, end };
}

export interface NoiseOpts {
  t: number;
  d: number;
  peak: number;
  kind?: NoiseKind;
  a?: number;
  hold?: number;
  filter?: BiquadFilterType;
  f?: number;
  /** Exponential filter sweep target (reached at the end of the envelope). */
  to?: number;
  q?: number;
  rate?: number;
  dest?: AudioNode;
}

export function noise(v: Voice, o: NoiseOpts): { amp: GainNode; filter: BiquadFilterNode | null; end: number } {
  const ctx = v.ctx;
  const src = ctx.createBufferSource();
  const buf = v.c.noise[o.kind ?? "white"];
  src.buffer = buf;
  src.loop = true;
  if (o.rate) src.playbackRate.value = o.rate;
  const amp = v.keep(ctx.createGain());
  const end = env(amp.gain, o.t, o.peak, o.a ?? 0.002, o.d, o.hold);
  let filter: BiquadFilterNode | null = null;
  if (o.filter) {
    filter = v.keep(ctx.createBiquadFilter());
    filter.type = o.filter;
    filter.Q.value = o.q ?? 0.9;
    filter.frequency.setValueAtTime(o.f ?? 1000, o.t);
    if (o.to !== undefined) filter.frequency.exponentialRampToValueAtTime(Math.max(10, o.to), end);
    src.connect(filter);
    filter.connect(amp);
  } else src.connect(amp);
  amp.connect(o.dest ?? v.out);
  v.run(src, o.t, end + 0.02, Math.random() * Math.max(0, buf.duration - 0.6));
  return { amp, filter, end };
}

/** Periodic pitch wobble on `param` (Hz for frequency, cents for detune), faded in after `delay`. */
export function vibrato(v: Voice, param: AudioParam, t: number, end: number, rate: number, depth: number, delay = 0): void {
  const lfo = v.ctx.createOscillator();
  lfo.frequency.setValueAtTime(rate, t);
  const g = v.keep(v.ctx.createGain());
  g.gain.setValueAtTime(0, t);
  g.gain.setValueAtTime(0, t + delay);
  g.gain.linearRampToValueAtTime(depth, t + delay + 0.15);
  lfo.connect(g);
  g.connect(param);
  v.run(lfo, t, end);
}

/** A filter node feeding `dest` (default: the voice output). */
export function filter(v: Voice, type: BiquadFilterType, f: number, q = 0.9, dest?: AudioNode): BiquadFilterNode {
  const n = v.keep(v.ctx.createBiquadFilter());
  n.type = type;
  n.frequency.value = f;
  n.Q.value = q;
  n.connect(dest ?? v.out);
  return n;
}

/** A stereo panner feeding the voice output. */
export function panner(v: Voice, pan: number): AudioNode {
  const p = v.keep(v.ctx.createStereoPanner());
  p.pan.value = Math.max(-1, Math.min(1, pan));
  p.connect(v.out);
  return p;
}

/** [frequency ratio, gain, decay s] */
export type BellPart = readonly [number, number, number];

/** A struck bell / chime: independent decaying partials. */
export function strike(v: Voice, t: number, f: number, parts: readonly BellPart[], level = 1, dest?: AudioNode): void {
  for (const [r, g, d] of parts) tone(v, { f: f * r, t, a: 0.002, d, peak: g * level, dest });
}
