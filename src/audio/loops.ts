/**
 * Continuous sounds: the train rumble (dark noise, intensity-smoothed) and the steam chuff
 * (noise bursts on a lookahead scheduler, so tempo stays steady regardless of timer jitter).
 * v3 (AUD-1): both play on the world bus (the catch sounds dip it); intent and gate are separate — rumbleStart/
 * chuffStart say what the scene wants, holdLoops(on) parks both while the game is held (the rumble's level goes to
 * zero, its nodes stay; the chuff skips beats) and brings them back at the scene's current intensity and rate (K2).
 * AUD-3: the rumble is an effect — «Эффекты» at 0 builds none. AUD-4: a metro train's variant tweaks it (rumbleTweak:
 * the freight ×1.15, the night mail's sub-bass at 95 Hz, the flooded train's rattle down at 300 Hz).
 */
import { fxLive, live, play, type Core } from "./core";
import { noise, tanhCurve } from "./synth";

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : Number.isFinite(x) ? x : 0);

/** Held (holdLoops): the rumble is parked at zero and the chuff skips its beats. */
let lHeld = false;

/* ------------------------------------------------------------------ rumble */

export type RumbleKind = "train" | "royal" | "capsule";

/**
 * level: overall gain at intensity 1 (v3: −3 dB, so the catch is not squeezed by the compressor); lp: sub-bass
 * cutoff; rattle: tremolo noise band (what small speakers hear).
 */
const KINDS: Record<RumbleKind, { level: number; lp: number; rattleF: number; rattle: number; harm: number }> = {
  train: { level: 0.44, lp: 80, rattleF: 420, rattle: 1.7, harm: 0.9 },
  royal: { level: 0.5, lp: 75, rattleF: 360, rattle: 1.9, harm: 1.0 },
  capsule: { level: 0.26, lp: 130, rattleF: 950, rattle: 2.0, harm: 0.5 },
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

/** v3 (AUD-4): the metro train's variant tweaks (level ×, sub-bass lowpass Hz, rattle band Hz); royal and capsule ignore them. */
export interface RumbleTweak {
  level?: number;
  lp?: number;
  rattleF?: number;
}
let rTweak: RumbleTweak = {};

/** The rumble's character now: the kind, with the metro variant's tweaks on a "train". */
function kindNow(): { level: number; lp: number; rattleF: number; rattle: number; harm: number } {
  const k = KINDS[rKind];
  if (rKind !== "train") return k;
  const lv = rTweak.level;
  return {
    ...k,
    level: k.level * (lv !== undefined && Number.isFinite(lv) ? Math.max(0.5, Math.min(1.5, lv)) : 1),
    lp: rTweak.lp ?? k.lp,
    rattleF: rTweak.rattleF ?? k.rattleF,
  };
}
/** rumbleCut() latched: rumbleSet() stays silent until the next rumbleStart() / rumbleStop(). */
let rCut = false;

function buildRumble(c: Core): Rumble {
  const ctx = c.ctx;
  const t = ctx.currentTime;
  const k = kindNow();

  const brown = ctx.createBufferSource();
  brown.buffer = c.noise.brown;
  brown.loop = true;
  const pink = ctx.createBufferSource();
  pink.buffer = c.noise.pink;
  pink.loop = true;

  const level = ctx.createGain();
  level.gain.value = 0;
  level.connect(c.world);

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
  const c = fxLive();
  if (!c) return;
  if (R && R.c !== c) destroyRumble();
  if (!R) R = buildRumble(c);
}

function applyRumble(): void {
  if (!R) return;
  const k = kindNow();
  const i = rTarget;
  const now = R.c.ctx.currentTime;
  // held: the level stays parked (holdLoops); the colour still follows, so the release lands on the right sound.
  // Stopped or cut: the level is fading out (rumbleKind / rumbleTweak at a scene's end must not swell it back)
  if (!lHeld && rWanted && !rCut) R.level.gain.setTargetAtTime(k.level * Math.pow(i, 1.3), now, 0.22);
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

/** v3 (AUD-4): the metro train's variant tweaks ({} = the plain train). */
export function rumbleTweak(tw: RumbleTweak | undefined): void {
  rTweak = tw ?? {};
  applyRumble();
}

export function rumbleStart(intensity: number): void {
  rWanted = true;
  rCut = false;
  rTarget = clamp01(intensity);
  if (rKill) {
    clearTimeout(rKill);
    rKill = 0;
  }
  ensureRumble();
  applyRumble();
}

export function rumbleSet(intensity: number): void {
  if (rCut) return;
  const i = clamp01(intensity);
  // called ~10×/s: don't pile up automation events when nothing changed
  if (R && rWanted && Math.abs(i - rTarget) < 0.004) return;
  rTarget = i;
  if (!rWanted) return;
  ensureRumble();
  applyRumble();
}

/**
 * The train is gone: the rumble drops to nothing in `sec` (ringing silence). Latched, so the scene-phase driver's
 * rumbleSet() calls cannot bring it back before the next rumbleStart() / rumbleStop().
 */
export function rumbleCut(sec = 0.12): void {
  rCut = true;
  rTarget = 0;
  if (!R) return;
  const g = R.level.gain;
  const now = R.c.ctx.currentTime;
  g.cancelScheduledValues(now);
  g.setValueAtTime(g.value, now);
  g.linearRampToValueAtTime(0, now + Math.max(0.01, sec));
}

export function rumbleStop(): void {
  rWanted = false;
  rCut = false;
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

/** The scene wants the chuff (chuffStart … chuffStop): intent, kept through a hold. */
let chuffWanted = false;
/** The beat scheduler runs. */
let chuffOn = false;
let chuffRate = 2;
let chuffNext = 0;
let chuffBeat = 0;
let chuffTimer = 0;

const clampRate = (r: number): number => (Number.isFinite(r) ? Math.max(0.5, Math.min(12, r)) : 2);

/** One steam exhaust beat: a hissing burst over a soft low puff, accented every 4th beat (v3: +4 dB, world bus). */
export function chuffAt(t: number, beat: number, rate: number): void {
  const accent = beat % 4 === 0 ? 1 : beat % 2 === 0 ? 0.8 : 0.64;
  const len = Math.min(0.24, 0.8 / rate);
  const bright = 650 + 80 * rate;
  play("chuff", { max: 16 }, { at: t, bus: "world" }, (v) => {
    noise(v, { kind: "white", t, a: 0.006, d: len, peak: 0.48 * accent, filter: "bandpass", f: bright * 1.9, to: bright, q: 0.8 });
    noise(v, { kind: "brown", t, a: 0.005, d: len * 0.7, peak: 0.45 * accent, filter: "lowpass", f: 380 });
  });
}

/** One scheduler step (every 25 ms; the offline test bench calls it while it steps the clock). */
export function loopsTick(): void {
  if (!chuffOn) return;
  const c = live();
  if (!c || lHeld) {
    // muted, suspended or held: skip the beats, start fresh when it comes back
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

function runChuff(): void {
  if (chuffOn) return;
  chuffOn = true;
  chuffBeat = 0;
  chuffNext = 0;
  if (typeof window !== "undefined") chuffTimer = window.setInterval(loopsTick, TICK_MS);
  loopsTick();
}

/** Start the chuff at `rate` beats/s (or just set the rate if it runs). */
export function chuffStart(rate: number): void {
  chuffRate = clampRate(rate);
  chuffWanted = true;
  runChuff();
}

/** Change the rate; a wanted chuff whose scheduler stopped starts again (level-triggered, K2). */
export function chuffSet(rate: number): void {
  chuffRate = clampRate(rate);
  if (chuffWanted && !chuffOn) runChuff();
}

export function chuffStop(): void {
  chuffWanted = false;
  chuffOn = false;
  if (chuffTimer) clearInterval(chuffTimer);
  chuffTimer = 0;
}

/* -------------------------------------------------------------------- hold */

/**
 * Park the loops while the game is held (a ceremony, a halt): the rumble's level falls to zero in ~0.3 s (τ 80 ms)
 * with its nodes kept, the chuff skips its beats. On release the rumble returns to the scene's current intensity
 * and the chuff restarts 50 ms later at the last chuffSet rate — whatever stopped or started meanwhile.
 */
export function holdLoops(on: boolean): void {
  if (on === lHeld) return;
  lHeld = on;
  if (on) {
    chuffNext = 0;
    if (!R) return;
    const g = R.level.gain;
    const now = R.c.ctx.currentTime;
    const cur = g.value;
    g.cancelScheduledValues(now);
    g.setValueAtTime(cur, now);
    g.setTargetAtTime(0, now, 0.08);
    return;
  }
  if (rWanted && !rCut) {
    ensureRumble();
    applyRumble();
  }
  if (chuffWanted) {
    runChuff();
    const c = live();
    if (c) {
      chuffNext = c.ctx.currentTime + 0.05;
      loopsTick();
    }
  }
}

/** Test reports: the chuff is wanted / its scheduler runs. */
export function chuffState(): { wanted: boolean; on: boolean; rate: number } {
  return { wanted: chuffWanted, on: chuffOn, rate: chuffRate };
}
