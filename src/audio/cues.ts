/**
 * v2 named sound cues (UiFx {k:"sfx", cue, intensity, pitch} from scenes and the shell) and the voices of the
 * new engine Fx (scout, migration, record, commission). Every cue is an ordinary throttled voice, so the voice
 * caps and the limiter hold; `intensity` 0..1 is the voice gain, `pitch` multiplies its frequencies.
 * v3: the giant steps and the arrival thump play on the world bus with a giantBody a phone can hear (AUD-2); the
 * live-rating cues are foreground (the world dips under them), the crown ticks are ceremony voices (AUD-1).
 */
import type { SfxCue } from "@/game/fx";
import { play } from "./core";
import { brass, CHIME, coinTink, giantBody, GLOCK, HAND_BELL, ping, ratchet, rustle, SMALL_BELL, stampAt } from "./instruments";
import { rumbleCut } from "./loops";
import { filter, noise, panner, rnd, semi, strike, tone, vibrato } from "./synth";
import { dopplerPitch } from "./trainVoices";

type CueFn = (gain: number, p: number) => void;

const CUES: Record<SfxCue, CueFn> = {
  /** A giant hobnailed boot on stone: a 45 → 30 Hz sine under low-passed brown noise, the sole's knock and a giantBody. */
  footstep: (gain, p) =>
    play("footstep", { max: 3, gapMs: 120 }, { gain, bus: "world" }, (v) => {
      const t = v.t;
      tone(v, { f: 45 * p, to: 30 * p, glide: 0.3, t, a: 0.006, d: 0.3, peak: 0.67 });
      tone(v, { type: "triangle", f: 140 * p, to: 80 * p, glide: 0.08, t, a: 0.003, d: 0.1, peak: 0.16 });
      noise(v, { kind: "brown", t, a: 0.004, d: 0.24, peak: 0.45, filter: "lowpass", f: 320 * p });
      noise(v, { kind: "pink", t: t + 0.008, a: 0.002, d: 0.06, peak: 0.07, filter: "bandpass", f: 900, q: 0.8 });
      giantBody(v, t, 45 * p, 0.3, 0.65);
    }),

  /** The train's arrival: a 38 Hz sine under 120 Hz low-passed noise, the crack of the impact and a giantBody. */
  thump: (gain, p) =>
    play("thump", { max: 2, gapMs: 150 }, { gain, bus: "world" }, (v) => {
      const t = v.t;
      tone(v, { f: 38 * p, to: 32 * p, glide: 0.35, t, a: 0.004, d: 0.35, peak: 0.76 });
      tone(v, { type: "triangle", f: 76 * p, to: 48 * p, glide: 0.2, t, a: 0.003, d: 0.18, peak: 0.22 });
      noise(v, { kind: "brown", t, a: 0.003, d: 0.32, peak: 0.54, filter: "lowpass", f: 120 * p, q: 0.8 });
      noise(v, { t, a: 0.001, d: 0.04, peak: 0.1, filter: "bandpass", f: 650, q: 0.9 });
      giantBody(v, t, 38 * p, 0.35, 1);
    }),

  /**
   * The engine's whistle as it passes the middle of the screen: gliding down 1.5 semitones over 0.6 s. v3 (AUD-4):
   * at the train's own whistle (chord root / 880, its ±25 cent detune; trainVoices.ts).
   */
  doppler: (gain, pitch) =>
    play("doppler", { max: 1, gapMs: 500 }, { gain, send: 0.35 }, (v) => {
      const t = v.t;
      const p = pitch * dopplerPitch();
      const dur = 0.6;
      const lp = filter(v, "lowpass", 2600, 0.7);
      for (const [f, pk] of [
        [880, 0.11],
        [1760, 0.016],
      ] as const) {
        const { osc } = tone(v, { f: f * p * semi(0.4), to: f * p * semi(-1.1), glide: dur, t, a: 0.05, hold: dur - 0.15, d: 0.3, peak: pk, dest: lp });
        vibrato(v, osc.frequency, t, t + dur + 0.35, 6, f * p * 0.003, 0.1);
      }
      noise(v, { t, a: 0.03, hold: dur - 0.15, d: 0.25, peak: 0.045, filter: "bandpass", f: 880 * p, to: 820 * p, q: 2.5, dest: lp });
    }),

  /** Ringing silence after the train: a faint 5.2 kHz sine for 0.9 s (with a slow beat). */
  tinnitus: (gain, p) =>
    play("tinnitus", { max: 1, gapMs: 800 }, { gain }, (v) => {
      const t = v.t;
      tone(v, { f: 5200 * p, t, a: 0.12, hold: 0.33, d: 0.45, peak: 0.032 });
      tone(v, { f: 5200 * p * 1.0012, t, a: 0.16, hold: 0.25, d: 0.45, peak: 0.012 });
    }),

  /** Not a voice: the train rumble drops to nothing in 120 ms. */
  rumbleCut: () => rumbleCut(0.12),

  /** A rising 3-note brass arpeggio (a live rating tier reached). */
  medalTier: (gain, p) =>
    play("medalTier", { max: 2, gapMs: 200 }, { gain, send: 0.25, fg: true }, (v) => {
      const t = v.t;
      brass(v, t, 523.25 * p, 0.08, 0.075);
      brass(v, t + 0.085, 659.25 * p, 0.08, 0.075);
      brass(v, t + 0.17, 783.99 * p, 0.32, 0.085);
    }),

  /** A soft dull tick (a tier slipped out of reach). */
  tierLost: (gain, p) =>
    play("tierLost", { max: 2, gapMs: 150 }, { gain: gain * 0.8, send: 0.1 }, (v) => {
      const t = v.t;
      tone(v, { f: 230 * p, to: 160 * p, glide: 0.05, t, a: 0.002, d: 0.07, peak: 0.24 });
      tone(v, { type: "triangle", f: 460 * p, t, a: 0.001, d: 0.02, peak: 0.04 });
      noise(v, { kind: "brown", t, a: 0.001, d: 0.04, peak: 0.18, filter: "lowpass", f: 500 });
    }),

  /** «Вагон чист!»: a rail clack and a 2-note chime. */
  carClear: (gain, p) =>
    play("carClear", { max: 3, gapMs: 90 }, { gain, send: 0.25, fg: true }, (v) => {
      const t = v.t;
      noise(v, { t, a: 0.0008, d: 0.03, peak: 0.26, filter: "bandpass", f: 2200, q: 1.8 });
      tone(v, { f: 1180 * rnd(0.98, 1.02), t, a: 0.001, d: 0.06, peak: 0.12 });
      tone(v, { f: 95, to: 60, glide: 0.06, t, a: 0.002, d: 0.08, peak: 0.3 });
      strike(v, t + 0.07, 1568 * p, CHIME, 1.2);
      strike(v, t + 0.17, 2093 * p, CHIME, 1.3);
    }),

  /** A paper thud: a rubber stamp hits the form (a giant's stamp: the lineman's, on the rat's scale). */
  stamp: (gain, p) =>
    play("stamp", { max: 3, gapMs: 80 }, { gain, send: 0.12 }, (v) => {
      stampAt(v, v.t, p * rnd(0.97, 1.03), 1);
      giantBody(v, v.t, 150 * p, 0.13, 0.3);
    }),

  /** A short clock click at the pitch multiplier (countdowns: pitch 1, 1.12, 1.26…). */
  tick: (gain, p) =>
    play("tick", { max: 4, gapMs: 40 }, { gain, send: 0.12 }, (v) => {
      const t = v.t;
      tone(v, { f: 1800 * p, t, a: 0.0008, d: 0.028, peak: 0.2 });
      tone(v, { type: "triangle", f: 900 * p, t, a: 0.001, d: 0.02, peak: 0.07 });
      noise(v, { t, a: 0.0005, d: 0.01, peak: 0.12, filter: "bandpass", f: Math.min(6000, 3000 * p), q: 1.5 });
    }),

  /** Two low thumps, lub-dub (a piper's note about to reach the burrow). */
  heartbeat: (gain, p) =>
    play("heartbeat", { max: 2, gapMs: 350 }, { gain, send: 0.12 }, (v) => {
      const beat = (t: number, g: number, body: number) => {
        tone(v, { f: 64 * p, to: 42 * p, glide: 0.12, t, a: 0.006, d: 0.17, peak: 0.6 * g });
        tone(v, { type: "triangle", f: 124 * p, to: 82 * p, glide: 0.07, t, a: 0.004, d: 0.08, peak: 0.13 * g });
        noise(v, { kind: "brown", t, a: 0.004, d: 0.09, peak: 0.25 * g, filter: "lowpass", f: 220 });
        giantBody(v, t, 64 * p, 0.17, body);
      };
      beat(v.t, 1, 0.5);
      beat(v.t + 0.26, 0.72, 0.36);
    }),

  /** A patent granted: the stamp, then a gear ratchet. */
  patent: (gain, p) =>
    play("patent", { max: 2, gapMs: 250 }, { gain, send: 0.15 }, (v) => {
      stampAt(v, v.t, p, 1);
      ratchet(v, v.t + 0.16, 6, 0.042, p, 0.9);
      strike(v, v.t + 0.45, 2093 * p, SMALL_BELL, 0.5);
    }),

  /** A bright 2-note ping (something new is open). */
  unlock: (gain, p) =>
    play("unlock", { max: 2, gapMs: 150 }, { gain, send: 0.3 }, (v) => {
      ping(v, v.t, 1568 * p, 0.95);
      ping(v, v.t + 0.09, 2349.3 * p, 1.05);
    }),

  /** A valve wheel turns: a metal creak (stick-slip saw through two resonances, 0.12 s). */
  valveCreak: (gain, p) =>
    play("valveCreak", { max: 3, gapMs: 60 }, { gain, send: 0.2, pan: rnd(-0.2, 0.2) }, (v) => {
      const t = v.t;
      const ctx = v.ctx;
      const k = p * rnd(0.92, 1.08);
      const amp = v.keep(ctx.createGain());
      amp.connect(v.out);
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(0.5, t + 0.012);
      amp.gain.setValueAtTime(0.5, t + 0.07);
      amp.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      const r1 = filter(v, "bandpass", 1150 * k, 7, amp);
      const r2g = v.keep(ctx.createGain());
      r2g.gain.value = 0.6;
      r2g.connect(amp);
      const r2 = filter(v, "bandpass", 2350 * k, 9, r2g);
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(48 * k, t);
      o.frequency.exponentialRampToValueAtTime(82 * k, t + 0.05);
      o.frequency.exponentialRampToValueAtTime(61 * k, t + 0.12);
      o.connect(r1);
      o.connect(r2);
      v.run(o, t, t + 0.13);
      noise(v, { t, a: 0.004, d: 0.1, peak: 0.05, filter: "bandpass", f: 1800 * k, q: 3 });
    }),

  /** Water over the rim: 4 rising sine blips, 300–900 Hz. */
  bubbles: (gain, p) =>
    play("bubbles", { max: 2, gapMs: 300 }, { gain, send: 0.3 }, (v) => {
      let t = v.t;
      for (let i = 0; i < 4; i++) {
        const f = rnd(300, 900) * p;
        tone(v, { f, to: f * 1.7, glide: 0.045, t, a: 0.003, d: 0.06, peak: rnd(0.1, 0.15), dest: panner(v, rnd(-0.35, 0.35)) });
        t += rnd(0.05, 0.12);
      }
    }),

  /** A high coin tink (the crown counter ticking up every 60 ms; a ceremony voice). */
  crownTick: (gain, p) =>
    play("crownTick", { max: 6, gapMs: 40 }, { gain: gain * 0.7, send: 0.15, pan: rnd(-0.2, 0.2), prio: "ceremony" }, (v) => coinTink(v, v.t, 2637 * p * rnd(0.998, 1.002), 1)),

  /** A small bell. */
  chime: (gain, p) => play("chime", { max: 3, gapMs: 100 }, { gain, send: 0.3 }, (v) => strike(v, v.t, 1318.5 * p * rnd(0.997, 1.003), HAND_BELL, 1)),
};

/** Every SfxCue (the test bench renders each). */
export const CUE_NAMES = Object.keys(CUES) as SfxCue[];

export const clampGain = (x: number | undefined): number => (x === undefined || !Number.isFinite(x) ? 1 : Math.max(0, Math.min(1, x)));
export const clampPitch = (x: number | undefined): number => (x === undefined || !Number.isFinite(x) || x <= 0 ? 1 : Math.max(0.25, Math.min(4, x)));

/** Play one named cue: intensity 0..1 (default 1) scales the volume, pitch (default 1) multiplies the frequency. */
export function playCue(cue: SfxCue, intensity?: number, pitch?: number): void {
  const fn = CUES[cue];
  if (!fn) return; // an unknown cue from a newer UI: stay quiet
  const g = clampGain(intensity);
  if (g <= 0.001 && cue !== "rumbleCut") return;
  fn(g, clampPitch(pitch));
}

/* ------------------------------------------------------------ engine Fx */

/** Scouts are back: a map unfolds, then an unlock-like ping. Later payouts ring a step higher. */
export function scoutVoice(step: number): void {
  const k = semi(2 * (Math.max(1, Math.min(3, Math.round(step) || 1)) - 1));
  play("scout", { max: 2, gapMs: 300 }, { send: 0.25 }, (v) => {
    rustle(v, v.t, 0.24, 1);
    ping(v, v.t + 0.2, 1174.7 * k, 0.9);
    ping(v, v.t + 0.29, 1568 * k, 1);
  });
}

/** The Great Migration: a low brass swell, C major opening out over two seconds (a ceremony voice). */
export function migrationVoice(): void {
  play("migration", { max: 1, gapMs: 3000 }, { send: 0.4, prio: "ceremony" }, (v) => {
    const t = v.t;
    brass(v, t, 65.41, 2.2, 0.07, undefined, 1.1);
    brass(v, t, 130.81, 2.2, 0.075, undefined, 1.0);
    brass(v, t + 0.25, 196, 1.95, 0.06, undefined, 0.9);
    brass(v, t + 0.5, 261.63, 1.7, 0.05, undefined, 0.8);
    brass(v, t + 0.75, 329.63, 1.45, 0.04, undefined, 0.7);
    noise(v, { kind: "brown", t, a: 1.2, hold: 0.6, d: 1.4, peak: 0.12, filter: "lowpass", f: 160 });
  });
}

/** A colony record: a four-note fanfare to a full chord, with glockenspiel sparkle on top (a ceremony voice). */
export function recordVoice(): void {
  play("record", { max: 1, gapMs: 1500 }, { send: 0.3, prio: "ceremony" }, (v) => {
    const t = v.t;
    brass(v, t, 392, 0.09, 0.1);
    brass(v, t + 0.11, 523.25, 0.09, 0.1);
    brass(v, t + 0.22, 659.25, 0.09, 0.1);
    brass(v, t + 0.33, 783.99, 0.7, 0.11);
    brass(v, t + 0.33, 659.25, 0.7, 0.06);
    brass(v, t + 0.33, 523.25, 0.7, 0.055);
    brass(v, t + 0.33, 261.63, 0.7, 0.05);
    [2093, 2637, 3136].forEach((f, i) => strike(v, t + 0.36 + i * 0.07, f, GLOCK, 0.7));
  });
}

/** A royal commission: accepted = the seal stamped on the order; done = the stamp and two hand-bell strikes. */
export function commissionVoice(done: boolean): void {
  play("commission", { max: 2, gapMs: 400 }, { send: 0.25 }, (v) => {
    stampAt(v, v.t, 0.92, 1);
    if (!done) return;
    strike(v, v.t + 0.14, 1245, HAND_BELL, 0.9);
    strike(v, v.t + 0.3, 1568, HAND_BELL, 1);
  });
}
