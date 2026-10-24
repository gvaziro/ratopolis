/**
 * WebAudio core: a lazily created context and the output chain
 *   voices → bus → high shelf (−4 dB, never harsh) → compressor → master volume → speakers,
 * a small synthetic "brick tunnel" reverb on a send, shared noise buffers, and voice bookkeeping
 * (per-sound throttling so one sound never stacks past its voice limit, node cleanup on end).
 * Nothing here touches the DOM until unlock() runs on a user gesture.
 */

export type NoiseKind = "white" | "pink" | "brown";

export interface Core {
  ctx: BaseAudioContext;
  /** Dry input for every voice. */
  bus: GainNode;
  /** Reverb send input. */
  verb: GainNode;
  /** User volume, after the compressor. */
  master: GainNode;
  noise: Record<NoiseKind, AudioBuffer>;
}

/** Hard ceiling on simultaneously sounding voices (one voice = one sound call). */
const MAX_VOICES = 72;
/** Sounds scheduled this soon after a resume request still play (the first tap unlocks and clicks). */
const RESUME_GRACE_MS = 700;

let core: Core | null = null;
let enabled = true;
let volume = 0.4;
let resumeAskedAt = -Infinity;
let testMode = false;
let voiceCount = 0;

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : Number.isFinite(x) ? x : 0);
/** Perceptual volume curve: 40% on the slider ≈ −12 dB. */
const volumeGain = (v: number): number => Math.pow(clamp01(v), 1.5);

type AudioCtor = new (opts?: AudioContextOptions) => AudioContext;

/** Create (first call) and resume the context. Call from a user gesture. */
export function unlockCore(): void {
  if (typeof window === "undefined" || testMode) return;
  if (!core) {
    const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
    const Ctor = w.AudioContext ?? w.webkitAudioContext;
    if (!Ctor) return;
    try {
      core = build(new Ctor({ latencyHint: "interactive" }));
    } catch {
      core = null;
      return;
    }
  }
  const ctx = core.ctx as AudioContext;
  if (ctx.state === "running" || ctx.state === "closed") return;
  resumeAskedAt = performance.now();
  try {
    void ctx.resume().catch(() => undefined);
    // iOS: a silent buffer started inside the gesture opens the output
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    src.connect(ctx.destination);
    src.start(0);
  } catch {
    /* ignore: the next gesture tries again */
  }
}

/** Suspend output while the page is hidden (no droning rumble in a background tab); resume when shown. */
export function pauseCore(paused: boolean): void {
  if (!core || testMode) return;
  const ctx = core.ctx as AudioContext;
  try {
    if (paused) {
      if (ctx.state === "running") void ctx.suspend().catch(() => undefined);
    } else if (ctx.state === "suspended") {
      resumeAskedAt = performance.now();
      void ctx.resume().catch(() => undefined);
    }
  } catch {
    /* ignore */
  }
}

export function setVolumeCore(v: number, on: boolean): void {
  volume = clamp01(v);
  enabled = on;
  if (!core) return;
  const g = core.master.gain;
  const now = core.ctx.currentTime;
  g.cancelScheduledValues(now);
  g.setValueAtTime(g.value, now);
  g.setTargetAtTime(on ? volumeGain(volume) : 0, now, on ? 0.03 : 0.012);
}

/** The core when sounds may be scheduled right now (unlocked, running, not muted), else null. */
export function live(): Core | null {
  if (!core) return null;
  if (testMode) return core;
  if (!enabled || volume <= 0.001) return null;
  const st = core.ctx.state;
  if (st === "running") return core;
  if (st === "suspended" && performance.now() - resumeAskedAt < RESUME_GRACE_MS) return core;
  return null;
}

/** Test harness only: render the synth into an OfflineAudioContext. */
export function attachForTest(ctx: BaseAudioContext): void {
  testMode = true;
  core = build(ctx);
  gates.clear();
  voiceCount = 0;
}

/* ------------------------------------------------------------------ graph */

function build(ctx: BaseAudioContext): Core {
  // last-resort brick wall so stacked events at 100% volume never clip the speakers
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -2;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.1;
  limiter.connect(ctx.destination);

  const master = ctx.createGain();
  master.gain.value = enabled ? volumeGain(volume) : 0;
  master.connect(limiter);

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value = 14;
  comp.ratio.value = 3.5;
  comp.attack.value = 0.003;
  comp.release.value = 0.2;
  comp.connect(master);

  const shelf = ctx.createBiquadFilter();
  shelf.type = "highshelf";
  shelf.frequency.value = 6500;
  shelf.gain.value = -4;
  shelf.connect(comp);

  const bus = ctx.createGain();
  bus.gain.value = 0.9;
  bus.connect(shelf);

  const verb = ctx.createGain();
  const conv = ctx.createConvolver();
  conv.normalize = true;
  conv.buffer = impulse(ctx, 1.7);
  const ret = ctx.createGain();
  ret.gain.value = 0.5;
  verb.connect(conv);
  conv.connect(ret);
  ret.connect(shelf);

  return {
    ctx,
    bus,
    verb,
    master,
    noise: { white: noiseBuffer(ctx, "white", 2), pink: noiseBuffer(ctx, "pink", 4), brown: noiseBuffer(ctx, "brown", 4) },
  };
}

/** Stereo room impulse: a few early reflections off brick, then a tail that darkens as it decays. */
function impulse(ctx: BaseAudioContext, sec: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * sec);
  const pre = Math.floor(rate * 0.011);
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const x = i / len;
      const k = 0.8 - 0.68 * x;
      lp += k * (Math.random() * 2 - 1 - lp);
      d[i] = lp * Math.pow(1 - x, 3.4);
    }
    for (let r = 0; r < 6; r++) {
      const at = pre + Math.floor(rate * (0.008 + Math.random() * 0.05));
      if (at < len) d[at] += (Math.random() < 0.5 ? -1 : 1) * (0.5 - r * 0.06);
    }
  }
  return buf;
}

/** Loopable noise (pink/brown get a crossfaded seam so long loops never click). */
function noiseBuffer(ctx: BaseAudioContext, kind: NoiseKind, sec: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * sec);
  const fade = kind === "white" ? 0 : Math.floor(ctx.sampleRate * 0.05);
  const raw = new Float32Array(len + fade);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let br = 0;
  let sum = 0;
  for (let i = 0; i < raw.length; i++) {
    const w = Math.random() * 2 - 1;
    let v: number;
    if (kind === "white") v = w;
    else if (kind === "pink") {
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      v = b0 + b1 + b2 + w * 0.1848;
    } else {
      br = (br + 0.02 * w) / 1.02;
      v = br;
    }
    raw[i] = v;
    sum += v;
  }
  const mean = sum / raw.length;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = raw[i] - mean;
  // seam: the head fades in while the overflow tail fades out, so d[len-1] → d[0] is continuous
  for (let j = 0; j < fade; j++) {
    const k = j / fade;
    d[j] = (raw[j] - mean) * k + (raw[len + j] - mean) * (1 - k);
  }
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]));
  const s = peak > 0 ? 0.95 / peak : 1;
  for (let i = 0; i < len; i++) d[i] *= s;
  return buf;
}

/* ----------------------------------------------------------------- voices */

export interface VoiceOpts {
  /** Output gain of the whole voice. */
  gain?: number;
  /** Stereo position −1..1. */
  pan?: number;
  /** Reverb send amount. */
  send?: number;
  /** Start this many seconds from now. */
  delay?: number;
  /** Absolute start time on the context clock (overrides delay). */
  at?: number;
}

/** One sound call: owns its nodes and disconnects them all when its last source ends. */
export class Voice {
  readonly c: Core;
  readonly ctx: BaseAudioContext;
  /** Start time on the context clock. */
  readonly t: number;
  readonly out: GainNode;
  /** Latest stop time of any source. */
  end: number;
  sources = 0;
  private nodes: AudioNode[] = [];
  private pending = 0;
  private done = false;

  constructor(c: Core, o: VoiceOpts = {}) {
    this.c = c;
    this.ctx = c.ctx;
    this.t = o.at ?? c.ctx.currentTime + 0.006 + (o.delay ?? 0);
    this.end = this.t;
    this.out = c.ctx.createGain();
    this.out.gain.value = o.gain ?? 1;
    let tail: AudioNode = this.out;
    if (o.pan) {
      const p = c.ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, o.pan));
      this.out.connect(p);
      this.nodes.push(p);
      tail = p;
    }
    tail.connect(c.bus);
    if (o.send) {
      const s = c.ctx.createGain();
      s.gain.value = o.send;
      tail.connect(s);
      s.connect(c.verb);
      this.nodes.push(s);
    }
    voiceCount++;
  }

  /** Register a node for cleanup. */
  keep<T extends AudioNode>(n: T): T {
    this.nodes.push(n);
    return n;
  }

  /** Start/stop a source and track it; the voice cleans up after the last one ends. */
  run(src: AudioScheduledSourceNode, t0: number, t1: number, offset?: number): void {
    this.nodes.push(src);
    this.pending++;
    this.sources++;
    src.onended = () => {
      this.pending--;
      if (this.pending <= 0) this.dispose();
    };
    if (offset !== undefined && src instanceof AudioBufferSourceNode) src.start(t0, Math.max(0, offset));
    else src.start(t0);
    src.stop(t1);
    if (t1 > this.end) this.end = t1;
  }

  dispose(): void {
    if (this.done) return;
    this.done = true;
    voiceCount--;
    for (const n of this.nodes) {
      try {
        n.disconnect();
      } catch {
        /* already disconnected */
      }
    }
    try {
      this.out.disconnect();
    } catch {
      /* already disconnected */
    }
    this.nodes.length = 0;
  }
}

export interface Limits {
  /** Max overlapping voices of this sound (default 12). */
  max?: number;
  /** Min real-time gap between starts. */
  gapMs?: number;
  /** Max starts per rolling second. */
  perSec?: number;
}

interface Gate {
  last: number;
  ends: number[];
  starts: number[];
}
const gates = new Map<string, Gate>();

/**
 * Play one sound: throttled per `key`, a no-op before unlock / when muted.
 * `build` schedules sources on the voice starting at `v.t`.
 */
export function play(key: string, lim: Limits, opts: VoiceOpts, build: (v: Voice) => void): void {
  const c = live();
  if (!c || voiceCount >= MAX_VOICES) return;
  let g = gates.get(key);
  if (!g) {
    g = { last: -Infinity, ends: [], starts: [] };
    gates.set(key, g);
  }
  const nowMs = performance.now();
  if (lim.gapMs && nowMs - g.last < lim.gapMs) return;
  const now = c.ctx.currentTime;
  g.ends = g.ends.filter((e) => e > now);
  if (g.ends.length >= (lim.max ?? 12)) return;
  if (lim.perSec) {
    g.starts = g.starts.filter((s) => nowMs - s < 1000);
    if (g.starts.length >= lim.perSec) return;
  }
  const v = new Voice(c, opts);
  try {
    build(v);
  } catch {
    v.dispose();
    return;
  }
  if (v.sources === 0) {
    v.dispose();
    return;
  }
  g.last = nowMs;
  g.ends.push(v.end);
  if (lim.perSec) g.starts.push(nowMs);
}
