/**
 * Measurements for the audio test bench (AUD-1): K-weighted momentary loudness (BS.1770 style, 400 ms windows on a
 * 50 ms hop, reported as the loudest window), a small-speaker simulation (two 2nd-order high-passes at 250 Hz: what
 * a phone or laptop reproduces), the share of energy above 4 kHz, the spectral centroid, and an estimate of the main
 * compressor's gain reduction (peak envelope follower into the static soft-knee curve).
 */

type BiquadKind = "hp" | "lp" | "hs";

/** One RBJ biquad over a whole buffer. */
export function biquad(x: Float32Array, sr: number, type: BiquadKind, f: number, q: number, gainDb = 0): Float32Array {
  const w0 = (2 * Math.PI * Math.min(f, sr / 2 - 1)) / sr;
  const c = Math.cos(w0);
  const s = Math.sin(w0);
  const al = s / (2 * q);
  let b0: number;
  let b1: number;
  let b2: number;
  let a0: number;
  let a1: number;
  let a2: number;
  if (type === "hp") {
    b0 = (1 + c) / 2;
    b1 = -(1 + c);
    b2 = (1 + c) / 2;
    a0 = 1 + al;
    a1 = -2 * c;
    a2 = 1 - al;
  } else if (type === "lp") {
    b0 = (1 - c) / 2;
    b1 = 1 - c;
    b2 = (1 - c) / 2;
    a0 = 1 + al;
    a1 = -2 * c;
    a2 = 1 - al;
  } else {
    const A = Math.pow(10, gainDb / 40);
    const sa = 2 * Math.sqrt(A) * al;
    b0 = A * (A + 1 + (A - 1) * c + sa);
    b1 = -2 * A * (A - 1 + (A + 1) * c);
    b2 = A * (A + 1 + (A - 1) * c - sa);
    a0 = A + 1 - (A - 1) * c + sa;
    a1 = 2 * (A - 1 - (A + 1) * c);
    a2 = A + 1 - (A - 1) * c - sa;
  }
  const y = new Float32Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  return y;
}

/** K-weighting: the BS.1770 head shelf (+4 dB above ~1.7 kHz) and the RLB high-pass (38 Hz). */
export function kWeight(x: Float32Array, sr: number): Float32Array {
  return biquad(biquad(x, sr, "hs", 1681.97, 0.7071752, 3.99984), sr, "hp", 38.13547, 0.5003270);
}

/** A small speaker: everything under ~250 Hz rolls off at 24 dB/octave. */
export function speakerSim(x: Float32Array, sr: number): Float32Array {
  return biquad(biquad(x, sr, "hp", 250, 0.7071), sr, "hp", 250, 0.7071);
}

/** Loudest 400 ms window (50 ms hop) of an already weighted signal, in LUFS; [from, to) in seconds. */
export function momentaryMax(x: Float32Array, sr: number, from = 0, to = Infinity): number {
  const W = Math.round(0.4 * sr);
  const H = Math.round(0.05 * sr);
  const a = Math.max(0, Math.round(from * sr));
  const b = Math.min(x.length, to === Infinity ? x.length : Math.round(to * sr));
  let best = 0;
  if (b - a < W) {
    let s = 0;
    for (let i = a; i < b; i++) s += x[i] * x[i];
    best = s / W;
  } else {
    for (let i = a; i + W <= b; i += H) {
      let s = 0;
      for (let j = i; j < i + W; j++) s += x[j] * x[j];
      if (s / W > best) best = s / W;
    }
  }
  return best > 0 ? -0.691 + 10 * Math.log10(best) : -120;
}

/** Momentary max of the K-weighted signal (full range). */
export function loudness(x: Float32Array, sr: number, from = 0, to = Infinity): number {
  return momentaryMax(kWeight(x, sr), sr, from, to);
}

/** Momentary max as heard on a small speaker. */
export function speakerLoudness(x: Float32Array, sr: number, from = 0, to = Infinity): number {
  return momentaryMax(kWeight(speakerSim(x, sr), sr), sr, from, to);
}

/** Sample peak in dBFS. */
export function peakDb(x: Float32Array): number {
  let p = 0;
  for (let i = 0; i < x.length; i++) {
    const v = Math.abs(x[i]);
    if (v > p) p = v;
  }
  return p > 0 ? 20 * Math.log10(p) : -120;
}

/** Every sample finite? */
export function allFinite(x: Float32Array): boolean {
  for (let i = 0; i < x.length; i++) if (!Number.isFinite(x[i])) return false;
  return true;
}

function energy(x: Float32Array): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return s;
}

/** Share of the energy above 4 kHz, in percent. */
export function hfShare(x: Float32Array, sr: number): number {
  const tot = energy(x);
  if (tot <= 0) return 0;
  return (100 * energy(biquad(biquad(x, sr, "hp", 4000, 0.7071), sr, "hp", 4000, 0.7071))) / tot;
}

/** v3: the energy above 4 kHz in dB (sum of squares; compare two renders of the same length). */
export function hfEnergyDb(x: Float32Array, sr: number): number {
  const e = energy(biquad(biquad(x, sr, "hp", 4000, 0.7071), sr, "hp", 4000, 0.7071));
  return e > 0 ? 10 * Math.log10(e) : -200;
}

/**
 * v3: ungated integrated loudness (the mean K-weighted power over [from, to), LUFS-like), optionally on the small
 * speaker: the level of a bed of loops, which a momentary maximum overstates by its swells.
 */
export function meanLoudness(x: Float32Array, sr: number, from = 0, to = Infinity, speaker = false): number {
  const y = kWeight(speaker ? speakerSim(x, sr) : x, sr);
  const a = Math.max(0, Math.round(from * sr));
  const b = Math.min(y.length, to === Infinity ? y.length : Math.round(to * sr));
  let s = 0;
  for (let i = a; i < b; i++) s += y[i] * y[i];
  return b > a && s > 0 ? -0.691 + 10 * Math.log10(s / (b - a)) : -120;
}

/** v3: the strongest frequency in [lo, hi] Hz (Hann window, zero-padded FFT, parabolic interpolation). */
export function peakFreq(x: Float32Array, sr: number, lo: number, hi: number): number {
  let N = 1;
  while (N < x.length * 4 && N < 1 << 18) N <<= 1;
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const n = Math.min(x.length, N);
  for (let i = 0; i < n; i++) re[i] = x[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  fft(re, im);
  const mag = (k: number) => Math.hypot(re[k], im[k]);
  const k0 = Math.max(1, Math.floor((lo * N) / sr));
  const k1 = Math.min(N / 2 - 2, Math.ceil((hi * N) / sr));
  let best = k0;
  for (let k = k0; k <= k1; k++) if (mag(k) > mag(best)) best = k;
  const [a, b, c] = [mag(best - 1), mag(best), mag(best + 1)];
  const d = a - 2 * b + c;
  const off = d !== 0 ? (0.5 * (a - c)) / d : 0;
  return ((best + off) * sr) / N;
}

/** In-place radix-2 FFT (re/im of length 2^k). */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const ai = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k + len / 2] = re[i + k] - ar;
        im[i + k + len / 2] = im[i + k] - ai;
        re[i + k] += ar;
        im[i + k] += ai;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

/** Power-weighted spectral centroid in Hz (Hann frames of 1024, averaged). */
export function centroid(x: Float32Array, sr: number): number {
  const N = 1024;
  const pow = new Float64Array(N / 2);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let s = 0; s + N <= x.length; s += N / 2) {
    for (let i = 0; i < N; i++) {
      re[i] = x[s + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 1; k < N / 2; k++) pow[k] += re[k] * re[k] + im[k] * im[k];
  }
  let num = 0;
  let den = 0;
  for (let k = 1; k < N / 2; k++) {
    num += pow[k] * ((k * sr) / N);
    den += pow[k];
  }
  return den > 0 ? num / den : 0;
}

export interface CompressorCurve {
  threshold: number;
  knee: number;
  ratio: number;
  attack: number;
  release: number;
}

/**
 * Mean gain reduction (dB, ≥ 0) a compressor with this curve would apply over [from, to): a peak envelope follower
 * (attack/release) feeds the static soft-knee curve.
 */
export function estGainReduction(x: Float32Array, sr: number, c: CompressorCurve, from = 0, to = Infinity): number {
  const ka = Math.exp(-1 / (c.attack * sr));
  const kr = Math.exp(-1 / (c.release * sr));
  const a = Math.max(0, Math.round(from * sr));
  const b = Math.min(x.length, to === Infinity ? x.length : Math.round(to * sr));
  const slope = 1 / c.ratio - 1;
  let env = 0;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < b; i++) {
    const v = Math.abs(x[i]);
    env = v > env ? ka * env + (1 - ka) * v : kr * env + (1 - kr) * v;
    if (i < a) continue;
    const L = env > 1e-9 ? 20 * Math.log10(env) : -180;
    const over = L - c.threshold;
    let gr = 0;
    if (2 * over > c.knee) gr = -slope * over;
    else if (2 * Math.abs(over) <= c.knee && c.knee > 0) gr = (-slope * (over + c.knee / 2) ** 2) / (2 * c.knee);
    sum += gr;
    n++;
  }
  return n > 0 ? sum / n : 0;
}
