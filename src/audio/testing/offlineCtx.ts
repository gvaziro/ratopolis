/**
 * Test bench (AUD-1): a pull-based mono offline renderer of the WebAudio subset the synth uses, so the real voices,
 * loops and ambience run under vitest in Node and can be measured (./measure.ts, src/audio/mix.test.ts).
 *
 * Streaming like a real context: `run(sec)` renders block by block and moves `currentTime`, sources that have
 * stopped fire `onended` after each block (so voices dispose and disconnect as they do in a browser), and the code
 * under test schedules between runs exactly as it would between timer callbacks. `tap(node)` records any node's
 * output. Mono: StereoPanner passes through (an equal-power centre pan sums back to the same loudness); the Convolver
 * renders dry (a decorrelated reverb tail adds little to momentary loudness, a coherent copy would overstate it);
 * DynamicsCompressor passes through (measure.estGainReduction estimates what it would do). Oscillators are naive
 * (no band-limiting), biquads use the WebAudio formulas (lowpass/highpass Q in dB, bandpass Q linear, shelves S = 1).
 */

type EvType = "set" | "lin" | "exp" | "target";
interface Ev {
  type: EvType;
  v: number;
  t: number;
  tau: number;
}

/** Samples per render quantum (the last one of a run may be shorter). */
const BLOCK = 256;

export class OParam {
  private intrinsic: number;
  private ev: Ev[] = [];
  readonly inputs: ONode[] = [];
  private buf = new Float32Array(BLOCK);
  private q = -1;
  private out: Float32Array = this.buf;
  readonly defaultValue: number;
  readonly minValue = -3.4028234663852886e38;
  readonly maxValue = 3.4028234663852886e38;

  constructor(
    private readonly ctx: OfflineCtx,
    def: number,
  ) {
    this.intrinsic = def;
    this.defaultValue = def;
  }

  get value(): number {
    return this.ev.length ? this.at(this.ctx.currentTime) : this.intrinsic;
  }

  set value(v: number) {
    this.intrinsic = v;
    if (this.ev.length) this.insert("set", v, this.ctx.currentTime, 0);
  }

  private insert(type: EvType, v: number, t: number, tau: number): this {
    if (!Number.isFinite(v) || !Number.isFinite(t)) throw new TypeError(`non-finite automation value ${v} at ${t}`);
    let i = this.ev.length;
    while (i > 0 && this.ev[i - 1].t > t) i--;
    this.ev.splice(i, 0, { type, v, t: Math.max(0, t), tau });
    return this;
  }

  setValueAtTime(v: number, t: number): this {
    return this.insert("set", v, t, 0);
  }

  linearRampToValueAtTime(v: number, t: number): this {
    return this.insert("lin", v, t, 0);
  }

  exponentialRampToValueAtTime(v: number, t: number): this {
    if (v === 0) throw new RangeError("exponentialRampToValueAtTime: value 0");
    return this.insert("exp", v, t, 0);
  }

  setTargetAtTime(v: number, t: number, tau: number): this {
    return this.insert("target", v, t, Math.max(1e-6, tau));
  }

  cancelScheduledValues(t: number): this {
    this.ev = this.ev.filter((e) => e.t < t);
    return this;
  }

  cancelAndHoldAtTime(t: number): this {
    const v = this.at(t);
    this.cancelScheduledValues(t);
    return this.insert("set", v, t, 0);
  }

  /** Automation events (tests: nothing piles up). */
  eventCount(): number {
    return this.ev.length;
  }

  /** The automation curve at time t (inputs excluded). */
  at(t: number): number {
    let vPrev = this.intrinsic;
    let tPrev = 0;
    let tgt: Ev | null = null;
    let tgtV0 = 0;
    for (const e of this.ev) {
      if (e.type === "lin" || e.type === "exp") {
        if (t < e.t) return ramp(e, tPrev, vPrev, t);
        tgt = null;
        vPrev = e.v;
        tPrev = e.t;
        continue;
      }
      if (t < e.t) break;
      const cur = tgt ? tgt.v + (tgtV0 - tgt.v) * Math.exp(-(e.t - tgt.t) / tgt.tau) : vPrev;
      if (e.type === "set") {
        tgt = null;
        vPrev = e.v;
      } else {
        tgt = e;
        tgtV0 = cur;
        vPrev = cur;
      }
      tPrev = e.t;
    }
    return tgt ? tgt.v + (tgtV0 - tgt.v) * Math.exp(-(t - tgt.t) / tgt.tau) : vPrev;
  }

  /** Is the curve constant over [t0, t1]? (no event inside, no ramp or live target running) */
  private steady(t0: number, t1: number): boolean {
    const ev = this.ev;
    if (ev.length === 0) return true;
    for (const e of ev) if (e.t >= t0 && e.t <= t1) return false;
    const last = ev[ev.length - 1];
    if (t0 > last.t) return last.type !== "target" || t0 - last.t > 14 * last.tau;
    // some event lies ahead: steady only if the next one is a step (set) and no target is running now
    let i = 0;
    while (i < ev.length && ev[i].t < t0) i++;
    const next = ev[i];
    if (next.type === "lin" || next.type === "exp") return false;
    const prev = ev[i - 1];
    return !prev || prev.type !== "target" || t0 - prev.t > 14 * prev.tau;
  }

  /** The automation curve for samples [i0, i0 + n), one pass over the events (same rules as at()). */
  private fill(out: Float32Array, i0: number, n: number): void {
    const sr = this.ctx.sampleRate;
    const end = i0 + n;
    let s = i0;
    let vPrev = this.intrinsic;
    let tPrev = 0;
    let tgt: Ev | null = null;
    let tgtV0 = 0;
    const hold = (stop: number) => {
      const b = Math.min(stop, end);
      if (s >= b) return;
      if (tgt) {
        const { v, t, tau } = tgt;
        for (; s < b; s++) out[s - i0] = v + (tgtV0 - v) * Math.exp(-(s / sr - t) / tau);
      } else {
        out.fill(vPrev, s - i0, b - i0);
        s = b;
      }
    };
    for (const e of this.ev) {
      if (s >= end) return;
      const sE = Math.ceil(e.t * sr - 1e-9);
      if (e.type === "lin" || e.type === "exp") {
        const b = Math.min(sE, end);
        const span = e.t - tPrev;
        if (s < b) {
          if (e.type === "lin" || vPrev * e.v > 0) {
            const lin = e.type === "lin";
            const d = lin ? e.v - vPrev : Math.log(e.v / vPrev);
            for (; s < b; s++) {
              const k = span > 0 ? Math.min(1, Math.max(0, (s / sr - tPrev) / span)) : 1;
              out[s - i0] = lin ? vPrev + d * k : vPrev * Math.exp(d * k);
            }
          } else {
            out.fill(vPrev, s - i0, b - i0);
            s = b;
          }
        }
        tgt = null;
        vPrev = e.v;
        tPrev = e.t;
        continue;
      }
      hold(sE);
      const cur = tgt ? tgt.v + (tgtV0 - tgt.v) * Math.exp(-(e.t - tgt.t) / tgt.tau) : vPrev;
      if (e.type === "set") {
        tgt = null;
        vPrev = e.v;
      } else {
        tgt = e;
        tgtV0 = cur;
        vPrev = cur;
      }
      tPrev = e.t;
    }
    hold(end);
  }

  /** Values for samples [i0, i0 + n) of quantum q (automation plus connected inputs). */
  render(q: number, i0: number, n: number): Float32Array {
    if (this.q === q) return this.out;
    this.q = q;
    const out = this.buf.subarray(0, n);
    const sr = this.ctx.sampleRate;
    const t0 = i0 / sr;
    if (this.ev.length === 0) out.fill(this.intrinsic);
    else if (this.steady(t0, (i0 + n) / sr)) out.fill(this.at(t0));
    else this.fill(out, i0, n);
    for (const inp of this.inputs) {
      const x = inp.pull(q, i0, n);
      if (x) for (let i = 0; i < n; i++) out[i] += x[i];
    }
    this.out = out;
    return out;
  }

  /** Constant over the quantum? (k-rate reads and coefficient caching) */
  isConstant(i0: number, n: number): boolean {
    const sr = this.ctx.sampleRate;
    return this.inputs.length === 0 && this.steady(i0 / sr, (i0 + n) / sr);
  }
}

function ramp(e: Ev, tPrev: number, vPrev: number, t: number): number {
  const span = e.t - tPrev;
  const k = span > 0 ? Math.min(1, Math.max(0, (t - tPrev) / span)) : 1;
  if (e.type === "lin") return vPrev + (e.v - vPrev) * k;
  if (vPrev * e.v <= 0) return vPrev;
  return vPrev * Math.pow(e.v / vPrev, k);
}

export class ONode {
  readonly context: OfflineCtx;
  readonly inputs: ONode[] = [];
  private outs: (ONode | OParam)[] = [];
  protected buf = new Float32Array(BLOCK);
  private q = -1;
  private cached: Float32Array | null = null;
  numberOfInputs = 1;
  numberOfOutputs = 1;
  channelCount = 1;

  constructor(ctx: OfflineCtx) {
    this.context = ctx;
  }

  connect<T extends ONode | OParam>(d: T): T {
    d.inputs.push(this);
    this.outs.push(d);
    return d;
  }

  disconnect(): void {
    for (const d of this.outs) {
      const i = d.inputs.indexOf(this);
      if (i >= 0) d.inputs.splice(i, 1);
    }
    this.outs = [];
  }

  /** Output of quantum q (null = silence), computed once per quantum. */
  pull(q: number, i0: number, n: number): Float32Array | null {
    if (this.q === q) return this.cached;
    this.q = q;
    this.cached = this.process(q, i0, n);
    return this.cached;
  }

  /** Sum of the inputs into this node's buffer, or null when every input is silent. */
  protected mix(q: number, i0: number, n: number): Float32Array | null {
    let out: Float32Array | null = null;
    for (const inp of this.inputs) {
      const x = inp.pull(q, i0, n);
      if (!x) continue;
      if (!out) {
        out = this.buf.subarray(0, n);
        out.set(x);
      } else for (let i = 0; i < n; i++) out[i] += x[i];
    }
    return out;
  }

  protected process(q: number, i0: number, n: number): Float32Array | null {
    return this.mix(q, i0, n);
  }
}

class OGain extends ONode {
  readonly gain: OParam;
  constructor(ctx: OfflineCtx) {
    super(ctx);
    this.gain = new OParam(ctx, 1);
  }
  protected process(q: number, i0: number, n: number): Float32Array | null {
    const x = this.mix(q, i0, n);
    if (!x) return null;
    const g = this.gain.render(q, i0, n);
    if (this.gain.isConstant(i0, n)) {
      const k = g[0];
      if (k === 0) return null;
      if (k !== 1) for (let i = 0; i < n; i++) x[i] *= k;
    } else for (let i = 0; i < n; i++) x[i] *= g[i];
    return x;
  }
}

class OScheduled extends ONode {
  t0 = Infinity;
  t1 = Infinity;
  started = false;
  ended = false;
  onended: (() => void) | null = null;
  constructor(ctx: OfflineCtx) {
    super(ctx);
    this.numberOfInputs = 0;
  }
  start(when = 0): void {
    if (this.started) throw new Error("InvalidStateError: start() called twice");
    this.started = true;
    this.t0 = Math.max(when, this.context.currentTime);
    this.context.track(this);
  }
  stop(when = 0): void {
    if (!this.started) throw new Error("InvalidStateError: stop() before start()");
    this.t1 = Math.max(when, this.context.currentTime);
  }
  /** Sample range [s0, s1) of this quantum where the source sounds, or null. */
  protected span(i0: number, n: number): [number, number] | null {
    if (!this.started) return null;
    const sr = this.context.sampleRate;
    const a = Math.max(i0, Math.ceil(this.t0 * sr));
    const b = Math.min(i0 + n, this.t1 === Infinity ? Infinity : Math.ceil(this.t1 * sr));
    return b > a ? [a, b] : null;
  }
}

class OOscillator extends OScheduled {
  type: OscillatorType = "sine";
  readonly frequency: OParam;
  readonly detune: OParam;
  private phase = 0;
  constructor(ctx: OfflineCtx) {
    super(ctx);
    this.frequency = new OParam(ctx, 440);
    this.detune = new OParam(ctx, 0);
  }
  protected process(q: number, i0: number, n: number): Float32Array | null {
    const sp = this.span(i0, n);
    if (!sp) return null;
    const out = this.buf.subarray(0, n);
    out.fill(0);
    const f = this.frequency.render(q, i0, n);
    const useDetune = !(this.detune.isConstant(i0, n) && this.detune.at(i0 / this.context.sampleRate) === 0);
    const d = useDetune ? this.detune.render(q, i0, n) : null;
    const inv = 1 / this.context.sampleRate;
    let ph = this.phase;
    const type = this.type;
    for (let s = sp[0]; s < sp[1]; s++) {
      const i = s - i0;
      let v: number;
      if (type === "square") v = ph < 0.5 ? 1 : -1;
      else if (type === "sawtooth") v = ph < 0.5 ? 2 * ph : 2 * ph - 2;
      else if (type === "triangle") v = ph < 0.25 ? 4 * ph : ph < 0.75 ? 2 - 4 * ph : 4 * ph - 4;
      else v = Math.sin(2 * Math.PI * ph);
      out[i] = v;
      const fr = d ? f[i] * Math.pow(2, d[i] / 1200) : f[i];
      ph += fr * inv;
      ph -= Math.floor(ph);
    }
    this.phase = ph;
    return out;
  }
}

export class OBuffer {
  private readonly data: Float32Array[];
  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.data = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  get duration(): number {
    return this.length / this.sampleRate;
  }
  getChannelData(c: number): Float32Array {
    return this.data[c];
  }
}

class OBufferSource extends OScheduled {
  buffer: OBuffer | null = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  readonly playbackRate: OParam;
  readonly detune: OParam;
  private pos = 0;
  constructor(ctx: OfflineCtx) {
    super(ctx);
    this.playbackRate = new OParam(ctx, 1);
    this.detune = new OParam(ctx, 0);
  }
  start(when = 0, offset = 0): void {
    super.start(when);
    this.pos = Math.max(0, offset) * (this.buffer?.sampleRate ?? this.context.sampleRate);
  }
  protected process(q: number, i0: number, n: number): Float32Array | null {
    const sp = this.span(i0, n);
    const b = this.buffer;
    if (!sp || !b) return null;
    const d = b.getChannelData(0);
    const L = d.length;
    if (!this.loop && this.pos >= L) return null;
    const out = this.buf.subarray(0, n);
    out.fill(0);
    // k-rate playback rate, as in WebAudio
    const r = this.playbackRate.render(q, i0, n)[0] * (b.sampleRate / this.context.sampleRate);
    let pos = this.pos;
    for (let s = sp[0]; s < sp[1]; s++) {
      if (this.loop) {
        if (pos >= L) pos -= L * Math.floor(pos / L);
      } else if (pos >= L) break;
      const k = Math.floor(pos);
      const fr = pos - k;
      const a = d[k];
      const c = k + 1 < L ? d[k + 1] : this.loop ? d[0] : 0;
      out[s - i0] = a + (c - a) * fr;
      pos += r;
    }
    this.pos = pos;
    return out;
  }
}

class OBiquad extends ONode {
  type: BiquadFilterType = "lowpass";
  readonly frequency: OParam;
  readonly Q: OParam;
  readonly gain: OParam;
  readonly detune: OParam;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  private c = [1, 0, 0, 0, 0];
  private key = "";
  constructor(ctx: OfflineCtx) {
    super(ctx);
    this.frequency = new OParam(ctx, 350);
    this.Q = new OParam(ctx, 1);
    this.gain = new OParam(ctx, 0);
    this.detune = new OParam(ctx, 0);
  }
  private coefs(f0: number, q: number, g: number): void {
    const sr = this.context.sampleRate;
    const f = Math.max(1, Math.min(sr / 2 - 1, f0));
    const key = `${this.type}|${f}|${q}|${g}`;
    if (key === this.key) return;
    this.key = key;
    const w0 = (2 * Math.PI * f) / sr;
    const cs = Math.cos(w0);
    const sn = Math.sin(w0);
    const A = Math.pow(10, g / 40);
    let b0 = 1;
    let b1 = 0;
    let b2 = 0;
    let a0 = 1;
    let a1 = 0;
    let a2 = 0;
    switch (this.type) {
      case "lowpass": {
        const al = sn / (2 * Math.pow(10, q / 20));
        b0 = (1 - cs) / 2;
        b1 = 1 - cs;
        b2 = (1 - cs) / 2;
        a0 = 1 + al;
        a1 = -2 * cs;
        a2 = 1 - al;
        break;
      }
      case "highpass": {
        const al = sn / (2 * Math.pow(10, q / 20));
        b0 = (1 + cs) / 2;
        b1 = -(1 + cs);
        b2 = (1 + cs) / 2;
        a0 = 1 + al;
        a1 = -2 * cs;
        a2 = 1 - al;
        break;
      }
      case "bandpass": {
        const al = sn / (2 * Math.max(1e-4, q));
        b0 = al;
        b2 = -al;
        a0 = 1 + al;
        a1 = -2 * cs;
        a2 = 1 - al;
        break;
      }
      case "notch": {
        const al = sn / (2 * Math.max(1e-4, q));
        b0 = 1;
        b1 = -2 * cs;
        b2 = 1;
        a0 = 1 + al;
        a1 = -2 * cs;
        a2 = 1 - al;
        break;
      }
      case "allpass": {
        const al = sn / (2 * Math.max(1e-4, q));
        b0 = 1 - al;
        b1 = -2 * cs;
        b2 = 1 + al;
        a0 = 1 + al;
        a1 = -2 * cs;
        a2 = 1 - al;
        break;
      }
      case "peaking": {
        const al = sn / (2 * Math.max(1e-4, q));
        b0 = 1 + al * A;
        b1 = -2 * cs;
        b2 = 1 - al * A;
        a0 = 1 + al / A;
        a1 = -2 * cs;
        a2 = 1 - al / A;
        break;
      }
      case "lowshelf":
      case "highshelf": {
        const sa = 2 * Math.sqrt(A) * ((sn / 2) * Math.SQRT2);
        if (this.type === "highshelf") {
          b0 = A * (A + 1 + (A - 1) * cs + sa);
          b1 = -2 * A * (A - 1 + (A + 1) * cs);
          b2 = A * (A + 1 + (A - 1) * cs - sa);
          a0 = A + 1 - (A - 1) * cs + sa;
          a1 = 2 * (A - 1 - (A + 1) * cs);
          a2 = A + 1 - (A - 1) * cs - sa;
        } else {
          b0 = A * (A + 1 - (A - 1) * cs + sa);
          b1 = 2 * A * (A - 1 - (A + 1) * cs);
          b2 = A * (A + 1 - (A - 1) * cs - sa);
          a0 = A + 1 + (A - 1) * cs + sa;
          a1 = -2 * (A - 1 + (A + 1) * cs);
          a2 = A + 1 + (A - 1) * cs - sa;
        }
        break;
      }
    }
    this.c = [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
  }
  protected process(q: number, i0: number, n: number): Float32Array | null {
    const x = this.mix(q, i0, n);
    if (!x && Math.abs(this.y1) + Math.abs(this.y2) + Math.abs(this.x1) + Math.abs(this.x2) < 1e-9) {
      this.x1 = this.x2 = this.y1 = this.y2 = 0;
      return null;
    }
    const out = this.buf.subarray(0, n);
    if (!x) out.fill(0);
    const F = this.frequency.render(q, i0, n);
    const Qs = this.Q.render(q, i0, n);
    const G = this.gain.render(q, i0, n);
    const Dt = this.detune.render(q, i0, n);
    const steady = this.frequency.isConstant(i0, n) && this.Q.isConstant(i0, n) && this.gain.isConstant(i0, n) && this.detune.isConstant(i0, n);
    let { x1, x2, y1, y2 } = this;
    for (let i = 0; i < n; i++) {
      if (i === 0 || (!steady && i % 8 === 0)) {
        this.coefs(F[i] * (Dt[i] === 0 ? 1 : Math.pow(2, Dt[i] / 1200)), Qs[i], G[i]);
      }
      const [b0, b1, b2, a1, a2] = this.c;
      const xi = x ? x[i] : 0;
      const y = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1;
      x1 = xi;
      y2 = y1;
      y1 = y;
      out[i] = y;
    }
    // flush denormal-ish tails
    if (Math.abs(y1) < 1e-15) y1 = 0;
    if (Math.abs(y2) < 1e-15) y2 = 0;
    Object.assign(this, { x1, x2, y1, y2 });
    return out;
  }
}

class OShaper extends ONode {
  curve: Float32Array | null = null;
  oversample: OverSampleType = "none";
  protected process(q: number, i0: number, n: number): Float32Array | null {
    const x = this.mix(q, i0, n);
    const c = this.curve;
    if (!x || !c || c.length === 0) return x;
    const N = c.length;
    for (let i = 0; i < n; i++) {
      const v = ((N - 1) / 2) * (x[i] + 1);
      if (v <= 0) x[i] = c[0];
      else if (v >= N - 1) x[i] = c[N - 1];
      else {
        const k = Math.floor(v);
        x[i] = c[k] + (c[k + 1] - c[k]) * (v - k);
      }
    }
    return x;
  }
}

class OPanner extends ONode {
  readonly pan: OParam;
  constructor(ctx: OfflineCtx) {
    super(ctx);
    this.pan = new OParam(ctx, 0);
  }
}

class OCompressor extends ONode {
  readonly threshold: OParam;
  readonly knee: OParam;
  readonly ratio: OParam;
  readonly attack: OParam;
  readonly release: OParam;
  readonly reduction = 0;
  constructor(ctx: OfflineCtx) {
    super(ctx);
    this.threshold = new OParam(ctx, -24);
    this.knee = new OParam(ctx, 30);
    this.ratio = new OParam(ctx, 12);
    this.attack = new OParam(ctx, 0.003);
    this.release = new OParam(ctx, 0.25);
  }
}

class OConvolver extends ONode {
  buffer: OBuffer | null = null;
  normalize = true;
  protected process(q: number, i0: number, n: number): Float32Array | null {
    this.mix(q, i0, n); // keep the graph pulled, render dry
    return null;
  }
}

/** A recording of one node's output across runs. */
export interface Tap {
  /** Everything recorded so far, as one buffer. */
  data(): Float32Array;
}

export class OfflineCtx {
  currentTime = 0;
  state: AudioContextState = "running";
  readonly destination: ONode;
  private pos = 0;
  private q = 0;
  private live: OScheduled[] = [];
  private taps: { node: ONode; chunks: Float32Array[] }[] = [];

  constructor(readonly sampleRate = 16000) {
    this.destination = new ONode(this);
  }

  createGain(): GainNode {
    return new OGain(this) as unknown as GainNode;
  }
  createOscillator(): OscillatorNode {
    return new OOscillator(this) as unknown as OscillatorNode;
  }
  createBufferSource(): AudioBufferSourceNode {
    return new OBufferSource(this) as unknown as AudioBufferSourceNode;
  }
  createBiquadFilter(): BiquadFilterNode {
    return new OBiquad(this) as unknown as BiquadFilterNode;
  }
  createWaveShaper(): WaveShaperNode {
    return new OShaper(this) as unknown as WaveShaperNode;
  }
  createStereoPanner(): StereoPannerNode {
    return new OPanner(this) as unknown as StereoPannerNode;
  }
  createDynamicsCompressor(): DynamicsCompressorNode {
    return new OCompressor(this) as unknown as DynamicsCompressorNode;
  }
  createConvolver(): ConvolverNode {
    return new OConvolver(this) as unknown as ConvolverNode;
  }
  createBuffer(channels: number, length: number, sampleRate: number): AudioBuffer {
    return new OBuffer(channels, length, sampleRate) as unknown as AudioBuffer;
  }
  resume(): Promise<void> {
    this.state = "running";
    return Promise.resolve();
  }
  suspend(): Promise<void> {
    this.state = "suspended";
    return Promise.resolve();
  }

  /** @internal a source was started */
  track(s: OScheduled): void {
    this.live.push(s);
  }

  /** Sources started and not yet ended (a leak shows up here). */
  liveSources(): number {
    return this.live.length;
  }

  /** Record this node's output from now on. */
  tap(node: AudioNode): Tap {
    const rec = { node: node as unknown as ONode, chunks: [] as Float32Array[] };
    this.taps.push(rec);
    return {
      data: () => {
        const len = rec.chunks.reduce((a, c) => a + c.length, 0);
        const out = new Float32Array(len);
        let o = 0;
        for (const c of rec.chunks) {
          out.set(c, o);
          o += c.length;
        }
        return out;
      },
    };
  }

  /**
   * Render `sec` seconds. After every quantum, sources whose stop time has passed fire onended; `tick` (if given)
   * runs every `every` seconds of audio time, like a page timer (schedulers, store-driven drivers).
   */
  run(sec: number, tick?: { every: number; fn: () => void }): void {
    const end = this.pos + Math.round(sec * this.sampleRate);
    let nextTick = tick ? this.currentTime + tick.every : Infinity;
    while (this.pos < end) {
      const n = Math.min(BLOCK, end - this.pos);
      const q = ++this.q;
      for (const t of this.taps) {
        const x = t.node.pull(q, this.pos, n);
        t.chunks.push(x ? Float32Array.from(x) : new Float32Array(n));
      }
      this.destination.pull(q, this.pos, n);
      this.pos += n;
      this.currentTime = this.pos / this.sampleRate;
      this.fireEnded();
      if (tick) {
        while (this.currentTime + 1e-9 >= nextTick) {
          tick.fn();
          nextTick += tick.every;
        }
      }
    }
  }

  /**
   * Jump `sec` ahead without rendering (leak checks after a sound's tail): the clock moves, finished sources fire
   * onended; taps record nothing for the gap and sources keep their old phase.
   */
  skip(sec: number): void {
    this.pos += Math.round(sec * this.sampleRate);
    this.currentTime = this.pos / this.sampleRate;
    this.fireEnded();
  }

  private fireEnded(): void {
    if (this.live.length === 0) return;
    const now = this.currentTime;
    const done: OScheduled[] = [];
    this.live = this.live.filter((s) => {
      if (s.t1 <= now + 1e-9) {
        done.push(s);
        return false;
      }
      return true;
    });
    for (const s of done) {
      if (s.ended) continue;
      s.ended = true;
      s.onended?.();
    }
  }
}

// Voice.run and the ambience loops branch on `instanceof AudioBufferSourceNode`, which Node lacks
const g = globalThis as unknown as Record<string, unknown>;
if (typeof g.AudioBufferSourceNode === "undefined") g.AudioBufferSourceNode = OBufferSource;
