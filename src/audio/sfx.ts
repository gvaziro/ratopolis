/**
 * WebAudio synthesized sound effects — no audio files. Short, warm, Victorian-mechanical.
 * Every call is a safe no-op before unlock() (first user gesture) and while muted;
 * identical sounds are throttled so none stacks past its voice limit.
 */
import { pauseCore, play, setVolumeCore, unlockCore, type Voice } from "./core";
import { chuffSet, chuffStart, chuffStop, rumbleKind, rumbleSet, rumbleStart, rumbleStop, type RumbleKind } from "./loops";
import { filter, noise, panner, pick, rnd, semi, strike, tone, vibrato, type BellPart } from "./synth";

/* ----------------------------------------------------------- instruments */

/** Hollow wooden "tok". */
function woodTok(v: Voice, t: number, k: number, level: number, dest?: AudioNode): void {
  tone(v, { f: 620 * k, to: 470 * k, glide: 0.05, t, a: 0.002, d: 0.075, peak: 0.3 * level, dest });
  tone(v, { type: "triangle", f: 1490 * k, t, a: 0.001, d: 0.028, peak: 0.06 * level, dest });
  noise(v, { t, a: 0.001, d: 0.012, peak: 0.09 * level, filter: "bandpass", f: 2600 * k, q: 1.4, dest });
}

/** Bright coin "tink" with a short second ring. */
function coinTink(v: Voice, t: number, f: number, level: number, dest?: AudioNode): void {
  tone(v, { f, t, a: 0.001, d: 0.22, peak: 0.155 * level, dest });
  tone(v, { f: f * 2.76, t, a: 0.001, d: 0.08, peak: 0.055 * level, dest });
  tone(v, { f: f * 1.5, t: t + 0.045, a: 0.001, d: 0.2, peak: 0.085 * level, dest });
  noise(v, { t, a: 0.0005, d: 0.006, peak: 0.07 * level, filter: "highpass", f: 6000, dest });
}

const GLOCK: readonly BellPart[] = [
  [1, 0.17, 0.5],
  [2.0, 0.035, 0.18],
  [3.99, 0.02, 0.09],
];
const SMALL_BELL: readonly BellPart[] = [
  [1, 0.15, 0.7],
  [1.003, 0.05, 0.7],
  [2.32, 0.05, 0.28],
  [4.08, 0.025, 0.1],
];
const HAND_BELL: readonly BellPart[] = [
  [1, 0.15, 0.9],
  [2.03, 0.055, 0.5],
  [2.92, 0.045, 0.35],
  [4.18, 0.025, 0.2],
  [5.4, 0.012, 0.12],
];
const CHIME: readonly BellPart[] = [
  [1, 0.11, 0.8],
  [2.76, 0.035, 0.3],
  [5.4, 0.014, 0.12],
];
/** Big tower bell: hum, prime (+ beating twin), minor-third tierce, quint, nominal and upper partials. */
const TOWER_BELL: readonly BellPart[] = [
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

/** Detuned-saw brass note with a filter "blat" on the attack. */
function brass(v: Voice, t: number, f: number, dur: number, peak: number): void {
  const ctx = v.ctx;
  const amp = v.keep(ctx.createGain());
  amp.connect(v.out);
  const lp = v.keep(ctx.createBiquadFilter());
  lp.type = "lowpass";
  lp.Q.value = 2;
  lp.connect(amp);
  lp.frequency.setValueAtTime(f * 1.2, t);
  lp.frequency.linearRampToValueAtTime(f * 6, t + 0.04);
  lp.frequency.setTargetAtTime(f * 3.4, t + 0.05, 0.08);
  lp.frequency.setTargetAtTime(f * 1.4, t + dur, 0.05);
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(peak, t + 0.03);
  amp.gain.setTargetAtTime(peak * 0.72, t + 0.04, 0.1);
  amp.gain.setTargetAtTime(0, t + dur, 0.06);
  const end = t + dur + 0.45;
  for (const cents of [-7, 7]) {
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.detune.setValueAtTime(cents, t);
    o.frequency.setValueAtTime(f * 0.97, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.035);
    o.connect(lp);
    if (dur > 0.3) vibrato(v, o.detune, t, end, 5.5, 9, 0.18);
    v.run(o, t, end);
  }
}

/** Steam whistle: pure sines that scoop up, waver and sag as the steam drops, plus breath noise. */
function whistleVoice(royal: boolean, far: boolean): void {
  play(far ? "whistleFar" : "whistle", { max: 2, gapMs: 300 }, { send: far ? 0.55 : 0.28, gain: far ? 0.32 : 1 }, (v) => {
    const t = v.t;
    const dur = royal ? 1.25 : 0.85;
    const dest = far ? filter(v, "lowpass", 1500, 0.7) : v.out;
    const freqs = royal ? [880, 1100] : [880];
    for (const f of freqs) {
      for (const [mul, pk] of [
        [1, 0.12],
        [2, 0.018],
      ] as const) {
        const { osc } = tone(v, { f: f * mul * 0.93, t, a: 0.06, hold: dur, d: 0.28, peak: pk, dest });
        osc.frequency.exponentialRampToValueAtTime(f * mul, t + 0.09);
        osc.frequency.setValueAtTime(f * mul, t + dur);
        osc.frequency.exponentialRampToValueAtTime(f * mul * 0.95, t + dur + 0.3);
        vibrato(v, osc.frequency, t, t + dur + 0.35, 6, f * mul * 0.004, 0.12);
      }
    }
    noise(v, { t, a: 0.02, hold: dur, d: 0.25, peak: 0.05, filter: "bandpass", f: royal ? 990 : 880, q: 2.5, dest });
    noise(v, { t, a: 0.004, d: 0.16, peak: 0.07, filter: "highpass", f: 2500, dest });
  });
}

/** One typewriter key: paper-thin clack, type-bar body, a hint of bell metal, the desk. */
function typeKey(v: Voice, t: number, level: number): void {
  const k = rnd(0.92, 1.08);
  noise(v, { t, a: 0.0005, d: 0.018, peak: 0.45 * level, filter: "bandpass", f: 3200 * k, q: 1.6 });
  tone(v, { type: "square", f: 210 * k, to: 150 * k, glide: 0.018, t, a: 0.001, d: 0.018, peak: 0.09 * level });
  tone(v, { f: 4100 * k, t, a: 0.001, d: 0.03, peak: 0.04 * level });
  noise(v, { kind: "brown", t, a: 0.001, d: 0.025, peak: 0.25 * level, filter: "lowpass", f: 600 });
}

function blipAt(v: Voice, t: number, step: number, level: number): void {
  const s = ((Math.round(step) % 24) + 24) % 24;
  const f = 523.25 * semi(s);
  tone(v, { type: "triangle", f: f * 0.985, to: f, glide: 0.02, t, a: 0.003, d: 0.16, peak: 0.27 * level });
  tone(v, { f: f * 2, t, a: 0.002, d: 0.08, peak: 0.075 * level });
}

function hoof(v: Voice, t: number, level: number, dest?: AudioNode): void {
  const k = rnd(0.94, 1.06);
  tone(v, { f: 430 * k, to: 300 * k, glide: 0.035, t, a: 0.001, d: 0.06, peak: 0.24 * level, dest });
  tone(v, { f: 980 * k, t, a: 0.001, d: 0.02, peak: 0.05 * level, dest });
  noise(v, { t, a: 0.0008, d: 0.012, peak: 0.07 * level, filter: "bandpass", f: 1700 * k, q: 1.2, dest });
}

const COIN_STEPS = [0, 2, 4, 7, 9] as const;

/* --------------------------------------------------------------- public */

export const sfx = {
  /** Resume/create the AudioContext on the first user gesture. */
  unlock(): void {
    unlockCore();
  },

  /** v: 0..1 slider value; enabled=false mutes instantly (short ramp). */
  setVolume(v: number, enabled: boolean): void {
    setVolumeCore(v, enabled);
  },

  /** Soft wooden "tok", pitch ±5%. */
  click(): void {
    play("click", { max: 6, gapMs: 28 }, { send: 0.08, pan: rnd(-0.15, 0.15) }, (v) => woodTok(v, v.t, rnd(0.95, 1.05), 1));
  },

  /** Two-note "ding-ding", a major third up. */
  find(): void {
    play("find", { max: 4, gapMs: 120 }, { send: 0.25 }, (v) => {
      const ding = (t: number, f: number) => {
        tone(v, { f, t, a: 0.003, d: 0.55, peak: 0.19 });
        tone(v, { f: f * 2, t, a: 0.002, d: 0.25, peak: 0.055 });
        tone(v, { f: f * 3.01, t, a: 0.001, d: 0.12, peak: 0.025 });
      };
      ding(v.t, 1046.5);
      ding(v.t + 0.11, 1318.5);
    });
  },

  /** Bright metallic tink (random pentatonic pitch so a stream of coins sparkles). */
  coin(): void {
    play("coin", { max: 6, gapMs: 45 }, { send: 0.12, pan: rnd(-0.25, 0.25) }, (v) => coinTink(v, v.t, 1568 * semi(pick(COIN_STEPS)) * rnd(0.996, 1.004), 1));
  },

  /** Small bell "тинь" — readiness ring. */
  tin(): void {
    play("tin", { max: 4, gapMs: 60 }, { send: 0.2 }, (v) => strike(v, v.t, 1760 * rnd(0.99, 1.01), SMALL_BELL));
  },

  /** Muffled purchase "тук". */
  thud(): void {
    play("thud", { max: 4, gapMs: 50 }, { send: 0.06 }, (v) => {
      const t = v.t;
      const k = rnd(0.96, 1.04);
      tone(v, { f: 160 * k, to: 62, glide: 0.14, t, a: 0.003, d: 0.2, peak: 0.5 });
      tone(v, { type: "triangle", f: 260 * k, to: 130 * k, glide: 0.08, t, a: 0.002, d: 0.11, peak: 0.4 });
      // the box itself: a short hollow knock so laptop speakers get the "тук"
      tone(v, { f: 480 * k, to: 330 * k, glide: 0.04, t, a: 0.001, d: 0.06, peak: 0.14 });
      noise(v, { kind: "brown", t, a: 0.002, d: 0.06, peak: 0.35, filter: "lowpass", f: 700 });
      noise(v, { t, a: 0.001, d: 0.02, peak: 0.08, filter: "bandpass", f: 1800, q: 1 });
    });
  },

  /** Tiny rising chirp (birth). At most 3 per second. */
  squeak(): void {
    play("squeak", { max: 3, perSec: 3 }, { send: 0.1, pan: rnd(-0.4, 0.4) }, (v) => {
      const t = v.t;
      const f = 2300 * rnd(0.9, 1.15);
      const { osc, end } = tone(v, { f, t, a: 0.012, d: 0.11, peak: 0.19 });
      osc.frequency.exponentialRampToValueAtTime(f * 1.5, t + 0.06);
      osc.frequency.exponentialRampToValueAtTime(f * 1.32, t + 0.12);
      vibrato(v, osc.frequency, t, end, 38, f * 0.025);
    });
  },

  /** Three-note brass fanfare ending on a major chord (milestone ×2, zone open). */
  fanfare(): void {
    play("fanfare", { max: 2, gapMs: 400 }, { send: 0.28 }, (v) => {
      const t = v.t;
      brass(v, t, 392, 0.1, 0.105);
      brass(v, t + 0.13, 523.25, 0.1, 0.105);
      brass(v, t + 0.26, 659.25, 0.62, 0.11);
      brass(v, t + 0.26, 523.25, 0.62, 0.062);
      brass(v, t + 0.26, 392, 0.62, 0.05);
    });
  },

  /** Quick glockenspiel arpeggio. */
  medal(): void {
    play("medal", { max: 2, gapMs: 250 }, { send: 0.3 }, (v) => {
      [1046.5, 1318.5, 1568, 2093].forEach((f, i) => strike(v, v.t + i * 0.06, f, GLOCK, i === 3 ? 1.15 : 1));
    });
  },

  /** Catch pickup; pitch rises a semitone per combo step (Peggle-style), wrapping every 2 octaves. */
  blip(step: number): void {
    play("blip", { max: 8, gapMs: 18 }, { send: 0.15 }, (v) => blipAt(v, v.t, Number.isFinite(step) ? step : 0, 1));
  },

  /** Dull low "бум" — combo broken. */
  bump(): void {
    play("bump", { max: 3, gapMs: 80 }, { send: 0.08 }, (v) => {
      const t = v.t;
      tone(v, { f: 120, to: 52, glide: 0.22, t, a: 0.004, d: 0.3, peak: 0.5 });
      tone(v, { type: "triangle", f: 300, to: 150, glide: 0.18, t, a: 0.004, d: 0.18, peak: 0.32 });
      // a deflating "womp" that small speakers can carry
      tone(v, { type: "sawtooth", f: 220, to: 105, glide: 0.2, t, a: 0.006, d: 0.2, peak: 0.12, dest: filter(v, "lowpass", 900, 1) });
      noise(v, { kind: "brown", t, a: 0.002, d: 0.08, peak: 0.3, filter: "lowpass", f: 400 });
    });
  },

  /** Squeaky "Ай!" with a spark crackle. */
  ouch(): void {
    play("ouch", { max: 3, gapMs: 90 }, { send: 0.1 }, (v) => {
      const t = v.t;
      const k = rnd(0.93, 1.08);
      const ctx = v.ctx;
      const amp = v.keep(ctx.createGain());
      amp.connect(v.out);
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(0.38, t + 0.012);
      amp.gain.setValueAtTime(0.38, t + 0.1);
      amp.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
      // "а" → "й": first formant falls, second rises
      const f1 = filter(v, "bandpass", 900, 6, amp);
      f1.frequency.setValueAtTime(900, t);
      f1.frequency.exponentialRampToValueAtTime(420, t + 0.2);
      const f2g = v.keep(ctx.createGain());
      f2g.gain.value = 0.6;
      f2g.connect(amp);
      const f2 = filter(v, "bandpass", 1300, 8, f2g);
      f2.frequency.setValueAtTime(1300, t);
      f2.frequency.exponentialRampToValueAtTime(2400, t + 0.2);
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(820 * k, t);
      o.frequency.exponentialRampToValueAtTime(1250 * k, t + 0.05);
      o.frequency.exponentialRampToValueAtTime(980 * k, t + 0.22);
      o.connect(f1);
      o.connect(f2);
      v.run(o, t, t + 0.26);
      for (const dt of [0, 0.022, 0.05]) noise(v, { t: t + dt, a: 0.0005, d: 0.02, peak: 0.06, filter: "highpass", f: 4000 });
    });
  },

  /** Double rail-joint click "клац-клац". */
  clack(): void {
    play("clack", { max: 4, gapMs: 70 }, { send: 0.12 }, (v) => {
      const hit = (t: number, g: number) => {
        noise(v, { t, a: 0.0008, d: 0.03, peak: 0.3 * g, filter: "bandpass", f: 2200, q: 1.8 });
        tone(v, { f: 1180 * rnd(0.98, 1.02), t, a: 0.001, d: 0.07, peak: 0.15 * g });
        tone(v, { f: 1870, t, a: 0.001, d: 0.05, peak: 0.08 * g });
        tone(v, { type: "triangle", f: 420, to: 300, glide: 0.04, t, a: 0.001, d: 0.05, peak: 0.12 * g });
        tone(v, { f: 95, to: 60, glide: 0.06, t, a: 0.002, d: 0.08, peak: 0.4 * g });
        noise(v, { kind: "brown", t, a: 0.001, d: 0.05, peak: 0.25 * g, filter: "lowpass", f: 500 });
      };
      hit(v.t, 1);
      hit(v.t + 0.105, 0.8);
    });
  },

  /** Steam whistle: royal = two sines (880 & 1100 Hz) with steam breath; metro = a single one. */
  whistle(royal?: boolean): void {
    whistleVoice(!!royal, false);
  },

  /** Station hand-bell: two strikes. */
  bell(): void {
    play("bell", { max: 4, gapMs: 100 }, { send: 0.3 }, (v) => {
      const ring = (t: number, g: number) => {
        strike(v, t, 1245 * rnd(0.995, 1.005), HAND_BELL, g);
        noise(v, { t, a: 0.0005, d: 0.01, peak: 0.05 * g, filter: "bandpass", f: 4000, q: 2 });
      };
      ring(v.t, 1);
      ring(v.t + 0.14, 0.75);
    });
  },

  /** Band-passed steam/air hiss (capsule tube). */
  hiss(): void {
    play("hiss", { max: 3, gapMs: 90 }, { send: 0.12 }, (v) => {
      noise(v, { t: v.t, a: 0.025, hold: 0.18, d: 0.3, peak: 0.2, filter: "bandpass", f: 5200, to: 2600, q: 0.8 });
      noise(v, { kind: "pink", t: v.t, a: 0.01, d: 0.2, peak: 0.1, filter: "highpass", f: 1200 });
    });
  },

  /** Cork pop. */
  pop(): void {
    play("pop", { max: 4, gapMs: 40 }, { send: 0.1, pan: rnd(-0.2, 0.2) }, (v) => {
      const t = v.t;
      const k = rnd(0.9, 1.12);
      tone(v, { f: 1100 * k, to: 320 * k, glide: 0.03, t, a: 0.001, d: 0.05, peak: 0.3 });
      noise(v, { t, a: 0.0005, d: 0.018, peak: 0.22, filter: "bandpass", f: 1400 * k, q: 1.2 });
      tone(v, { type: "triangle", f: 540 * k, to: 700 * k, glide: 0.04, t: t + 0.012, a: 0.002, d: 0.05, peak: 0.05 });
    });
  },

  /** Water splash with a few droplets (valve). */
  splash(): void {
    play("splash", { max: 4, gapMs: 55 }, { send: 0.25, pan: rnd(-0.2, 0.2) }, (v) => {
      const t = v.t;
      noise(v, { t, a: 0.004, d: 0.32, peak: 0.42, filter: "bandpass", f: 2600, to: 700, q: 0.9 });
      noise(v, { kind: "pink", t, a: 0.002, d: 0.1, peak: 0.3, filter: "lowpass", f: 900 });
      for (let i = 0; i < 3; i++) {
        const f = rnd(700, 1500);
        tone(v, { f, to: f * 1.8, glide: 0.03, t: t + rnd(0.04, 0.22), a: 0.002, d: 0.05, peak: 0.1 });
      }
    });
  },

  /** Low, menacing "мрряу" (cat warning). */
  meow(): void {
    play("meow", { max: 1, gapMs: 900 }, { send: 0.3 }, (v) => {
      const t = v.t;
      const ctx = v.ctx;
      const dur = 1.05;
      const lp = filter(v, "lowpass", 3200, 0.7);
      const amp = v.keep(ctx.createGain());
      amp.connect(lp);
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(0.5, t + 0.14);
      amp.gain.setValueAtTime(0.5, t + 0.75);
      amp.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.1);
      // growl: a fast tremolo on the voice
      const growl = v.keep(ctx.createGain());
      growl.gain.value = 0.7;
      growl.connect(amp);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 27;
      const lfoAmt = v.keep(ctx.createGain());
      lfoAmt.gain.value = 0.3;
      lfo.connect(lfoAmt);
      lfoAmt.connect(growl.gain);
      v.run(lfo, t, t + dur + 0.15);
      // vocal tract: "м-р-я-у" formant sweeps
      const fm: [number, number, number, number, number][] = [
        // start, peak, mid, end, gain
        [380, 850, 700, 420, 1],
        [900, 1750, 1300, 780, 0.55],
      ];
      for (const [a, b, c, d, g] of fm) {
        const fg = v.keep(ctx.createGain());
        fg.gain.value = g;
        fg.connect(growl);
        const bp = filter(v, "bandpass", a, 5, fg);
        bp.frequency.setValueAtTime(a, t);
        bp.frequency.exponentialRampToValueAtTime(b, t + 0.35);
        bp.frequency.exponentialRampToValueAtTime(c, t + 0.7);
        bp.frequency.exponentialRampToValueAtTime(d, t + dur);
        for (const [type, mul] of [
          ["sawtooth", 1],
          ["square", 1.007],
        ] as const) {
          const o = ctx.createOscillator();
          o.type = type;
          o.frequency.setValueAtTime(150 * mul, t);
          o.frequency.exponentialRampToValueAtTime(245 * mul, t + 0.35);
          o.frequency.exponentialRampToValueAtTime(200 * mul, t + 0.7);
          o.frequency.exponentialRampToValueAtTime(118 * mul, t + dur);
          const og = v.keep(ctx.createGain());
          og.gain.value = type === "square" ? 0.35 : 1;
          o.connect(og);
          og.connect(bp);
          v.run(o, t, t + dur + 0.15);
        }
      }
    });
  },

  /** Cartoon "БАЦ" (paw hit). */
  bonk(): void {
    play("bonk", { max: 4, gapMs: 45 }, { send: 0.15 }, (v) => {
      const t = v.t;
      const k = rnd(0.94, 1.06);
      tone(v, { f: 260 * k, to: 75 * k, glide: 0.07, t, a: 0.001, d: 0.16, peak: 0.55 });
      tone(v, { type: "square", f: 520 * k, to: 210 * k, glide: 0.05, t, a: 0.001, d: 0.06, peak: 0.045 });
      noise(v, { t, a: 0.0005, d: 0.05, peak: 0.28, filter: "bandpass", f: 1500 * k, q: 0.8 });
      noise(v, { kind: "brown", t, a: 0.001, d: 0.09, peak: 0.3, filter: "lowpass", f: 600 });
    });
  },

  /** Piper's flute note; `note` = semitones above A4. */
  pipe(note: number): void {
    let n = Number.isFinite(note) ? Math.round(note) : 0;
    while (n > 24) n -= 12;
    while (n < -12) n += 12;
    const f = 440 * semi(n);
    play("pipe", { max: 4, gapMs: 30 }, { send: 0.35 }, (v) => {
      const t = v.t;
      const { osc, end } = tone(v, { f: f * semi(-0.4), t, a: 0.035, hold: 0.19, d: 0.1, peak: 0.12 });
      osc.frequency.exponentialRampToValueAtTime(f, t + 0.05);
      vibrato(v, osc.frequency, t, end, 5.8, f * 0.006, 0.09);
      tone(v, { f: f * 2, t, a: 0.04, hold: 0.17, d: 0.08, peak: 0.018 });
      tone(v, { type: "triangle", f: f * 3, t, a: 0.04, hold: 0.15, d: 0.06, peak: 0.0065 });
      noise(v, { t, a: 0.03, hold: 0.18, d: 0.1, peak: 0.028, filter: "bandpass", f, q: 7 });
      noise(v, { t, a: 0.002, d: 0.03, peak: 0.02, filter: "highpass", f: 3000 });
    });
  },

  /** Big chime cascade over a low impact, with a shower of coins. */
  jackpot(): void {
    play("jackpot", { max: 2, gapMs: 300 }, { send: 0.35 }, (v) => {
      const t = v.t;
      tone(v, { f: 95, to: 38, glide: 0.35, t, a: 0.003, d: 0.55, peak: 0.7 });
      tone(v, { type: "triangle", f: 190, to: 80, glide: 0.2, t, a: 0.003, d: 0.3, peak: 0.18 });
      noise(v, { kind: "brown", t, a: 0.002, d: 0.25, peak: 0.45, filter: "lowpass", f: 300 });
      noise(v, { t, a: 0.001, d: 0.06, peak: 0.18, filter: "bandpass", f: 900, q: 0.8 });
      [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24].forEach((s, i) => {
        strike(v, t + 0.05 + i * 0.055, 1046.5 * semi(s), CHIME, 1.5, panner(v, i % 2 ? 0.35 : -0.35));
      });
      for (let i = 0; i < 8; i++) coinTink(v, t + rnd(0.12, 0.85), rnd(1900, 3300), 0.45, panner(v, rnd(-0.6, 0.6)));
    });
  },

  /** Earthy crumble: a spade thump and falling clods. */
  dig(): void {
    play("dig", { max: 3, gapMs: 110 }, { send: 0.12 }, (v) => {
      const t = v.t;
      tone(v, { f: 90, to: 50, glide: 0.12, t, a: 0.004, d: 0.18, peak: 0.45 });
      noise(v, { kind: "brown", t, a: 0.005, d: 0.22, peak: 0.4, filter: "lowpass", f: 900, to: 300 });
      noise(v, { kind: "pink", t, a: 0.004, d: 0.16, peak: 0.35, filter: "bandpass", f: 520, q: 0.8 });
      for (let i = 0; i < 7; i++) {
        noise(v, { kind: "pink", t: t + 0.03 + rnd(0, 0.35), a: 0.002, d: rnd(0.015, 0.05), peak: rnd(0.18, 0.36), filter: "bandpass", f: rnd(600, 2200), q: 1.5 });
      }
    });
  },

  /** A single typewriter key. */
  typewriter(): void {
    play("type", { max: 4, gapMs: 32 }, { send: 0.06, pan: rnd(-0.2, 0.2) }, (v) => typeKey(v, v.t, 1));
  },

  /** Continuous dark rumble; intensity 0..1, smoothed. */
  rumbleStart(intensity: number): void {
    rumbleStart(intensity);
  },
  rumbleSet(intensity: number): void {
    rumbleSet(intensity);
  },
  rumbleStop(): void {
    rumbleStop();
  },

  /** Steam chuff at `rate` beats per second (2 → 8). */
  chuffStart(rate: number): void {
    chuffStart(rate);
  },
  chuffSet(rate: number): void {
    chuffSet(rate);
  },
  chuffStop(): void {
    chuffStop();
  },

  /** Twelve deep bell strikes: the first 0.25 s from now, then every 0.9 s (CoronationOverlay keeps in step). */
  coronationBells(): void {
    play("coronation", { max: 1, gapMs: 4000 }, { send: 0.45 }, (v) => {
      for (let i = 0; i < 12; i++) {
        const t = v.t + 0.25 + i * 0.9;
        const g = i === 11 ? 1.2 : 1;
        strike(v, t, 164.8, TOWER_BELL, g);
        noise(v, { t, a: 0.001, d: 0.03, peak: 0.08 * g, filter: "bandpass", f: 2200, q: 1 });
        noise(v, { kind: "brown", t, a: 0.002, d: 0.09, peak: 0.18 * g, filter: "lowpass", f: 400 });
      }
    });
  },

  /* ---------------------------------------------------- extras (beyond the stub API) */

  /** Silence everything while the page is hidden; resume when it is shown again. */
  pause(hidden: boolean): void {
    pauseCore(hidden);
  },

  /** Set the rumble's character before/while it plays: capsule tubes rattle lighter and higher. */
  rumbleKind(kind: RumbleKind): void {
    rumbleKind(kind);
  },

  /** The same whistle heard from far down the tunnel (train announced). */
  whistleFar(royal?: boolean): void {
    whistleVoice(!!royal, true);
  },

  /** A carriage approaching over the cobbles: clip-clop pairs growing louder. */
  hooves(): void {
    play("hooves", { max: 1, gapMs: 1500 }, { send: 0.22 }, (v) => {
      const dest = filter(v, "lowpass", 2600, 0.7);
      for (let i = 0; i < 4; i++) {
        const t = v.t + i * 0.34;
        const g = 0.35 + 0.65 * (i / 3);
        hoof(v, t, g, dest);
        hoof(v, t + 0.11, g * 0.8, dest);
      }
      noise(v, { kind: "brown", t: v.t, a: 0.9, hold: 0.3, d: 0.4, peak: 0.12, filter: "bandpass", f: 260, q: 0.8, dest });
    });
  },

  /** A gust of rain on the grate with distant thunder (downpour). */
  rain(): void {
    play("rain", { max: 1, gapMs: 2000 }, { send: 0.3 }, (v) => {
      const t = v.t;
      noise(v, { kind: "pink", t, a: 0.6, hold: 1.2, d: 1.2, peak: 0.16, filter: "highpass", f: 1400 });
      noise(v, { kind: "brown", t: t + 0.1, a: 0.35, d: 1.8, peak: 0.32, filter: "lowpass", f: 180 });
      for (let i = 0; i < 26; i++) {
        const f = rnd(1800, 4200);
        tone(v, { f, to: f * 1.3, glide: 0.01, t: t + rnd(0.05, 2.6), a: 0.001, d: 0.018, peak: rnd(0.025, 0.07), dest: panner(v, rnd(-0.7, 0.7)) });
      }
    });
  },

  /** Ominous low cluster swell (the cat arrives). */
  sting(): void {
    play("sting", { max: 1, gapMs: 1500 }, { send: 0.35 }, (v) => {
      const t = v.t;
      const lp = filter(v, "lowpass", 600, 1);
      lp.frequency.setValueAtTime(300, t);
      lp.frequency.exponentialRampToValueAtTime(1300, t + 0.5);
      lp.frequency.exponentialRampToValueAtTime(250, t + 1.4);
      for (const f of [92.5, 98, 185]) {
        tone(v, { type: "sawtooth", f, t, a: 0.45, hold: 0.15, d: 0.9, peak: f > 100 ? 0.05 : 0.11, dest: lp });
      }
      tone(v, { f: 70, to: 45, glide: 0.4, t, a: 0.004, d: 0.6, peak: 0.4 });
    });
  },

  /** The piper's drone (A and E) under his tune. */
  drone(): void {
    play("drone", { max: 1, gapMs: 3000 }, { send: 0.4 }, (v) => {
      const t = v.t;
      const lp = filter(v, "lowpass", 750, 1);
      for (const [f, g] of [
        [110, 0.07],
        [164.8, 0.045],
        [220, 0.03],
      ] as const) {
        const { osc, end } = tone(v, { type: "sawtooth", f, t, a: 0.8, hold: 1.6, d: 1.2, peak: g, dest: lp });
        vibrato(v, osc.detune, t, end, 4.3, 4, 0.5);
      }
    });
  },

  /** Short rising flourish of pickup blips (Аврал!). */
  flourish(): void {
    play("flourish", { max: 1, gapMs: 600 }, { send: 0.25 }, (v) => {
      [0, 4, 7, 12, 16].forEach((s, i) => blipAt(v, v.t + i * 0.055, s, i === 4 ? 1.2 : 0.9));
      coinTink(v, v.t + 0.3, 2637, 0.6);
    });
  },

  /** A handful of coins (purse, big drops). */
  jingle(): void {
    play("jingle", { max: 2, gapMs: 150 }, { send: 0.18 }, (v) => {
      for (let i = 0; i < 4; i++) coinTink(v, v.t + i * rnd(0.05, 0.075), 1568 * semi(pick(COIN_STEPS)) * rnd(0.99, 1.01), 0.85 - i * 0.1, panner(v, rnd(-0.4, 0.4)));
    });
  },

  /** A few typewriter keys in a row (news). */
  typeBurst(keys = 3): void {
    play("typeBurst", { max: 2, gapMs: 200 }, { send: 0.06 }, (v) => {
      let t = v.t;
      for (let i = 0; i < keys; i++) {
        typeKey(v, t, i === 0 ? 1 : 0.8);
        t += rnd(0.06, 0.1);
      }
    });
  },

  /** One water drip in a cavern (sewers ambience). */
  drip(): void {
    play("drip", { max: 2, gapMs: 150 }, { send: 0.6, pan: rnd(-0.6, 0.6), gain: 0.8 }, (v) => {
      const f = rnd(850, 1350);
      tone(v, { f, to: f * 1.9, glide: 0.028, t: v.t, a: 0.001, d: 0.07, peak: 0.09 });
    });
  },
};
