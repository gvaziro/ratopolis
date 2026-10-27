/**
 * v3 (AUD-4): fewer birth squeaks. A filling nursery births 3–4 rats a second, and v2 squeaked each one (capped at
 * 3/s): the most repetitive high sound of an hour. Now births are counted, not voiced: at most one sound per 1.4 s —
 * a single squeak, or, when three or more were born since the last, a litter trill (three short chirps 70 ms apart,
 * ×1, ×1.12, ×1.26, −3 dB, lower and shorter than a squeak). An isolated birth after a quiet spell squeaks at once;
 * none squeak while a close-up is on screen. The squeak itself has four shapes, taken in turn (rise, rise-fall,
 * double, short), so even a slow stream never repeats one sound.
 */
import { clockMs, play, sceneUp, type Voice } from "./core";
import { rnd, tone, vibrato } from "./synth";

/** At most one birth sound per this long. */
export const BIRTH_GAP_MS = 1400;
/** This many births since the last sound make a litter trill. */
export const LITTER_AT = 3;

export type SqueakShape = 0 | 1 | 2 | 3;
let shapeN = 0;

/** One squeak of shape `s` at `t` (base pitch `f`). */
function squeakAt(v: Voice, t: number, s: SqueakShape, f: number): void {
  switch (s) {
    case 0: {
      // the v2 squeak: a rise with a fast vibrato
      const { osc, end } = tone(v, { f, t, a: 0.012, d: 0.11, peak: 0.19 });
      osc.frequency.exponentialRampToValueAtTime(f * 1.5, t + 0.06);
      osc.frequency.exponentialRampToValueAtTime(f * 1.32, t + 0.12);
      vibrato(v, osc.frequency, t, end, 38, f * 0.025);
      break;
    }
    case 1: {
      // up and back down: a question
      const { osc } = tone(v, { f: f * 0.92, t, a: 0.01, d: 0.12, peak: 0.17 });
      osc.frequency.exponentialRampToValueAtTime(f * 1.38, t + 0.045);
      osc.frequency.exponentialRampToValueAtTime(f * 0.96, t + 0.13);
      break;
    }
    case 2: {
      // two quick peeps
      for (const [dt, k] of [
        [0, 1],
        [0.065, 1.08],
      ] as const) {
        const { osc } = tone(v, { f: f * k, t: t + dt, a: 0.006, d: 0.045, peak: 0.15 });
        osc.frequency.exponentialRampToValueAtTime(f * k * 1.3, t + dt + 0.04);
      }
      break;
    }
    default: {
      // a short "ик"
      const { osc } = tone(v, { f: f * 1.05, t, a: 0.005, d: 0.05, peak: 0.16 });
      osc.frequency.exponentialRampToValueAtTime(f * 1.35, t + 0.035);
    }
  }
}

/**
 * A squeak, the next of the four shapes. At most 3 per second; a ceremony voice (the coronation show's boarding rats
 * squeak while the game is held, when no births can happen).
 */
export function squeakVoice(): void {
  const s = (shapeN++ % 4) as SqueakShape;
  play("squeak", { max: 3, perSec: 3 }, { send: 0.1, pan: rnd(-0.4, 0.4), prio: "ceremony" }, (v) => squeakAt(v, v.t, s, 2300 * rnd(0.9, 1.15)));
}

/** A litter: three short chirps 70 ms apart climbing ×1, ×1.12, ×1.26, at −3 dB (a lower, softer squeak). */
export function litterVoice(): void {
  play("litter", { max: 2, gapMs: 500 }, { send: 0.1, pan: rnd(-0.35, 0.35), gain: Math.pow(10, -3 / 20) }, (v) => {
    const f = 1900 * rnd(0.95, 1.05);
    [1, 1.12, 1.26].forEach((k, i) => {
      const t = v.t + i * 0.07;
      const { osc } = tone(v, { f: f * k, t, a: 0.005, d: 0.04, peak: 0.17 });
      osc.frequency.exponentialRampToValueAtTime(f * k * 1.22, t + 0.035);
    });
  });
}

let lastSound = -Infinity;
let pending = 0;

/** Test harness: forget the births counted so far and restart the shapes. */
export function resetBirths(): void {
  lastSound = -Infinity;
  pending = 0;
  shapeN = 0;
}

/** A rat is born (Fx birth): counted, and voiced at most once per 1.4 s — a squeak, or a litter trill for 3+. */
export function birthVoice(): void {
  // a close-up holds the stage: the nursery keeps quiet (and does not save its squeaks for later)
  if (sceneUp()) {
    pending = 0;
    return;
  }
  pending++;
  const now = clockMs();
  if (now - lastSound < BIRTH_GAP_MS) return;
  lastSound = now;
  if (pending >= LITTER_AT) litterVoice();
  else squeakVoice();
  pending = 0;
}
