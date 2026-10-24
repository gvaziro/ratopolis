/**
 * Continuous sounds: the train rumble (dark noise, intensity-smoothed) and the steam chuff
 * (noise bursts on a lookahead scheduler, so tempo stays steady regardless of timer jitter).
 */
import { live, play, type Core } from "./core";
import { noise } from "./synth";

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : Number.isFinite(x) ? x : 0);

/* ------------------------------------------------------------------ rumble */

export type RumbleKind = "train" | "royal" | "capsule";

/** level: overall gain at intensity 1; lp: sub-bass cutoff; rattle: tremolo noise band (what small speakers hear). */
const KINDS: Record<RumbleKind, { level: number; lp: number; rattleF: number; rattle: number; harm: number }> = {
  train: { level: 0.62, lp: 80, rattleF: 420, rattle: 1.7, harm: 0.9 },
  royal: { level: 0.7, lp: 75, rattleF: 360, rattle: 1.9, harm: 1.0 },
  capsule: { level: 0.32, lp: 130, rattleF: 950, rattle: 2.0, harm: 0.5 },
};

interface Rumble {
  c: Core;
  level: GainNode;
  lp: BiquadFilterNode;
  harm: GainNode;
  rattle: GainNode;
  rattleBp: BiquadFilterNode;
  lfo: OscillatorNode;
  srcs: AudioScheduledSourceNode[];
  nodes: AudioNode[];
}

let R: Rumble | null = null;
let rWanted = false;
let rTarget = 0;
let rKind: RumbleKind = "train";
let rKill = 0;

function tanhCurve(drive: number): Float32Array<ArrayBuffer> {
  const n = 1024;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * drive) / Math.tanh(drive);
  }
  return curve;
}

function buildRumble(c: Core): Rumble {
  const ctx = c.ctx;
  const t = ctx.currentTime;
  const k = KINDS[rKind];

  const brown = ctx.createBufferSource();
  brown.buffer = c.noise.brown;
  brown.loop = true;
  const pink = ctx.createBufferSource();
  pink.buffer = c.noise.pink;
  pink.loop = true;

  const level = ctx.createGain();
  level.gain.value = 0;
  level.connect(c.bus);

  // sub-bass body (felt on headphones)
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = k.lp;
  lp.Q.value = 0.7;
  const body = ctx.createGain();
  body.gain.value = 0.6;
  brown.connect(lp);
  lp.connect(body);
  body.connect(level);

  // saturated low band → harmonics around 200 Hz, so laptop speakers "hear" the bass
  const pre = ctx.createBiquadFilter();
  pre.type = "lowpass";
  pre.frequency.value = 150;
  const drive = ctx.createGain();
  drive.gain.value = 3;
  const shaper = ctx.createWaveShaper();
  shaper.curve = tanhCurve(2.5);
  const hb = ctx.createBiquadFilter();
  hb.type = "bandpass";
  hb.frequency.value = 220;
  hb.Q.value = 0.8;
  const harm = ctx.createGain();
  harm.gain.value = k.harm;
  brown.connect(pre);
  pre.connect(drive);
  drive.connect(shaper);
  shaper.connect(hb);
  hb.connect(harm);
  harm.connect(level);

  // rattle: a band of pink noise trembling at ~8–14 Hz (rails, crockery, loose bricks)
  const rattleBp = ctx.createBiquadFilter();
  rattleBp.type = "bandpass";
  rattleBp.frequency.value = k.rattleF;
  rattleBp.Q.value = 1.3;
  const trem = ctx.createGain();
  trem.gain.value = 0.55;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 9;
  const lfoAmt = ctx.createGain();
  lfoAmt.gain.value = 0.45;
  lfo.connect(lfoAmt);
  lfoAmt.connect(trem.gain);
  const rattle = ctx.createGain();
  rattle.gain.value = 0;
  pink.connect(rattleBp);
  rattleBp.connect(trem);
  trem.connect(rattle);
  rattle.connect(level);

  brown.start(t, Math.random() * 3);
  pink.start(t, Math.random() * 3);
  lfo.start(t);
  return {
    c,
    level,
    lp,
    harm,
    rattle,
    rattleBp,
    lfo,
    srcs: [brown, pink, lfo],
    nodes: [level, lp, body, pre, drive, shaper, hb, harm, rattleBp, trem, lfoAmt, rattle, brown, pink, lfo],
  };
}

function destroyRumble(): void {
  if (!R) return;
  for (const s of R.srcs) {
    try {
      s.stop();
    } catch {
      /* not started / already stopped */
    }
  }
  for (const n of R.nodes) {
    try {
      n.disconnect();
    } catch {
      /* ignore */
    }
  }
  R = null;
}

function ensureRumble(): void {
  if (!rWanted) return;
  const c = live();
  if (!c) return;
  if (R && R.c !== c) destroyRumble();
  if (!R) R = buildRumble(c);
}

function applyRumble(): void {
  if (!R) return;
  const k = KINDS[rKind];
  const i = rTarget;
  const now = R.c.ctx.currentTime;
  R.level.gain.setTargetAtTime(k.level * Math.pow(i, 1.3), now, 0.22);
  R.lp.frequency.setTargetAtTime(k.lp * (0.8 + 0.5 * i), now, 0.3);
  R.harm.gain.setTargetAtTime(k.harm * (0.6 + 0.4 * i), now, 0.3);
  R.rattle.gain.setTargetAtTime(k.rattle * (0.25 + 0.75 * i * i), now, 0.25);
  R.rattleBp.frequency.setTargetAtTime(k.rattleF, now, 0.2);
  R.lfo.frequency.setTargetAtTime(8 + 6 * i, now, 0.4);
}

export function rumbleKind(kind: RumbleKind): void {
  rKind = kind;
  applyRumble();
}

export function rumbleStart(intensity: number): void {
  rWanted = true;
  rTarget = clamp01(intensity);
  if (rKill) {
    clearTimeout(rKill);
    rKill = 0;
  }
  ensureRumble();
  applyRumble();
}

export function rumbleSet(intensity: number): void {
  const i = clamp01(intensity);
  // called ~10×/s: don't pile up automation events when nothing changed
  if (R && rWanted && Math.abs(i - rTarget) < 0.004) return;
  rTarget = i;
  if (!rWanted) return;
  ensureRumble();
  applyRumble();
}

export function rumbleStop(): void {
  rWanted = false;
  if (!R) return;
  const now = R.c.ctx.currentTime;
  R.level.gain.cancelScheduledValues(now);
  R.level.gain.setValueAtTime(R.level.gain.value, now);
  R.level.gain.setTargetAtTime(0, now, 0.35);
  if (rKill) clearTimeout(rKill);
  if (typeof window === "undefined") {
    destroyRumble();
    return;
  }
  rKill = window.setTimeout(() => {
    rKill = 0;
    if (!rWanted) destroyRumble();
  }, 2200);
}

/* ------------------------------------------------------------------- chuff */

const LOOKAHEAD = 0.12; // s scheduled ahead
const TICK_MS = 25;

let chuffOn = false;
let chuffRate = 2;
let chuffNext = 0;
let chuffBeat = 0;
let chuffTimer = 0;

const clampRate = (r: number): number => (Number.isFinite(r) ? Math.max(0.5, Math.min(12, r)) : 2);

/** One steam exhaust beat: a hissing burst over a soft low puff, accented every 4th beat. */
export function chuffAt(t: number, beat: number, rate: number): void {
  const accent = beat % 4 === 0 ? 1 : beat % 2 === 0 ? 0.8 : 0.64;
  const len = Math.min(0.24, 0.8 / rate);
  const bright = 650 + 80 * rate;
  play("chuff", { max: 16 }, { at: t, send: 0.1 }, (v) => {
    noise(v, { kind: "white", t, a: 0.006, d: len, peak: 0.3 * accent, filter: "bandpass", f: bright * 1.9, to: bright, q: 0.8 });
    noise(v, { kind: "brown", t, a: 0.005, d: len * 0.7, peak: 0.34 * accent, filter: "lowpass", f: 380 });
  });
}

function chuffTick(): void {
  if (!chuffOn) return;
  const c = live();
  if (!c) {
    chuffNext = 0;
    return;
  }
  const now = c.ctx.currentTime;
  if (chuffNext < now) chuffNext = now + 0.03; // first beat, or the tab was throttled
  while (chuffNext < now + LOOKAHEAD) {
    chuffAt(chuffNext, chuffBeat++, chuffRate);
    chuffNext += 1 / chuffRate;
  }
}

export function chuffStart(rate: number): void {
  chuffRate = clampRate(rate);
  if (chuffOn) return;
  chuffOn = true;
  chuffBeat = 0;
  chuffNext = 0;
  if (typeof window !== "undefined") chuffTimer = window.setInterval(chuffTick, TICK_MS);
  chuffTick();
}

export function chuffSet(rate: number): void {
  chuffRate = clampRate(rate);
}

export function chuffStop(): void {
  chuffOn = false;
  if (chuffTimer) clearInterval(chuffTimer);
  chuffTimer = 0;
}
