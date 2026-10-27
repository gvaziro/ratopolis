/**
 * v3 (AUD-4): a voice for each train variant, so a freight is recognisable by ear before its cars are on screen.
 * The AudioDirector names the train as its scene starts (setTrain: game.scene.variant, plus a fresh ±25 cent detune
 * per train, never within 10 cents of the last one) and clears it when the scene ends; every train sound reads it —
 * the whistle's chord and timbre (whistle, whistleFar), the doppler cue's pitch (chord root / 880), the chuff's rate
 * range (TrainPass steers 2 → 8; it lands on the variant's range), the rumble's tweaks and a sound on each joint.
 * Off a train (null) everything is the plain v2 train.
 */
import type { TrainVariantId } from "@/game/types";

export interface TrainVoice {
  /** Whistle chord, Hz (sounded together; the circus calliope rolls it). */
  whistle: readonly number[];
  /** Chuff rate range (beats/s) the scene's 2 → 8 maps onto. */
  chuff: readonly [number, number];
  /** Rumble tweaks for a metro train: level ×, sub-bass lowpass (Hz), rattle band (Hz). */
  rumble?: { level?: number; lp?: number; rattleF?: number };
  /** An extra sound with every joint's clack: a freight's chains, a flooded train's splash. */
  joint?: "chain" | "splash";
  /** "steam" (pure sines that scoop and sag) or "calliope" (breathy pipes, a fast wide vibrato, a rolled chord). */
  timbre?: "steam" | "calliope";
  /** The whistle heard through a pea-souper: lowpass (Hz). */
  lp?: number;
  /** A crowd of giants mutters on the platform above while the train passes (rush hour). */
  crowd?: boolean;
}

/** The scene's chuff range (TrainPass: 2 at the start of the pass, 8 at its end). */
const SCENE_CHUFF: readonly [number, number] = [2, 8];

export const TRAIN_VOICES: Record<TrainVariantId, TrainVoice> = {
  normal: { whistle: [880], chuff: [2, 8] },
  // G5 and B5: two whistles at once, the 8:15 is late again
  rush_hour: { whistle: [784, 988], chuff: [2, 8], crowd: true },
  // the three-chime whistle of the night mail (F#5 A5 C#6), quicker and lower in the chest
  edinburgh_mail: { whistle: [740, 880, 1109], chuff: [3, 10], rumble: { lp: 95 } },
  // a heavy C5 – Eb5 moan, a slow labouring chuff, chains clanking at every joint
  freight: { whistle: [523, 622], chuff: [1.5, 5], rumble: { level: 1.15 }, joint: "chain" },
  // a waterlogged F5, splashes at every joint, the rattle down in the bilge
  flooded: { whistle: [698], chuff: [2, 7], rumble: { rattleF: 300 }, joint: "splash" },
  // Sanger's circus: an E-major calliope roll
  circus: { whistle: [659, 831, 988], chuff: [2, 8], timbre: "calliope" },
  // a pea-souper: one low A4, muffled
  fog: { whistle: [440], chuff: [2, 8], lp: 900 },
};

/** The royal express's two-note whistle (880 & 1100 Hz). */
export const ROYAL_WHISTLE: readonly number[] = [880, 1100];

export interface TrainNow {
  variant: TrainVariantId;
  voice: TrainVoice;
  /** Cents, ±25. */
  detune: number;
}

/** Two trains in a row differ by at least this much (cents). */
export const MIN_DETUNE_GAP = 10;
const MAX_DETUNE = 25;

let cur: TrainNow | null = null;
let lastDetune: number | null = null;

/** A detune ±25 cents at least MIN_DETUNE_GAP away from the last train's. */
function freshDetune(): number {
  for (let i = 0; i < 8; i++) {
    const d = (Math.random() * 2 - 1) * MAX_DETUNE;
    if (lastDetune === null || Math.abs(d - lastDetune) >= MIN_DETUNE_GAP) return d;
  }
  const prev = lastDetune ?? 0;
  return prev > 0 ? prev - 2 * MIN_DETUNE_GAP : prev + 2 * MIN_DETUNE_GAP;
}

/**
 * A train's scene starts (`variant`; unknown ids sound like a normal train) or ends (null). Each new train gets its
 * own detune; `detune` (cents) pins it (tests).
 */
export function setTrain(variant: TrainVariantId | null, detune?: number): TrainNow | null {
  if (variant === null) {
    cur = null;
    return null;
  }
  const v: TrainVariantId = TRAIN_VOICES[variant] ? variant : "normal";
  const d = detune !== undefined && Number.isFinite(detune) ? Math.max(-MAX_DETUNE, Math.min(MAX_DETUNE, detune)) : freshDetune();
  lastDetune = d;
  cur = { variant: v, voice: TRAIN_VOICES[v], detune: d };
  return cur;
}

/** The train on screen now (null between trains). */
export function train(): TrainNow | null {
  return cur;
}

/** The detune of the train on screen as a frequency factor (1 between trains). */
export function trainDetuneK(): number {
  return cur ? Math.pow(2, cur.detune / 1200) : 1;
}

/** The whistle of the train on screen: its chord (detuned), timbre and lowpass; the royal express keeps its own two notes. */
export function whistleOf(royal: boolean): { freqs: number[]; timbre: "steam" | "calliope"; lp?: number } {
  const k = trainDetuneK();
  if (royal) return { freqs: ROYAL_WHISTLE.map((f) => f * k), timbre: "steam" };
  const v = cur?.voice ?? TRAIN_VOICES.normal;
  return { freqs: v.whistle.map((f) => f * k), timbre: v.timbre ?? "steam", lp: v.lp };
}

/** The doppler cue's pitch factor: the chord root over the v2 880 Hz, detuned. */
export function dopplerPitch(): number {
  const v = cur?.voice ?? TRAIN_VOICES.normal;
  return (v.whistle[0] / 880) * trainDetuneK();
}

/** TrainPass's chuff rate (2 → 8) on the variant's range. */
export function chuffRateOf(rate: number): number {
  const v = cur?.voice;
  if (!v || !Number.isFinite(rate)) return rate;
  const [lo, hi] = v.chuff;
  const x = (rate - SCENE_CHUFF[0]) / (SCENE_CHUFF[1] - SCENE_CHUFF[0]);
  return lo + x * (hi - lo);
}
