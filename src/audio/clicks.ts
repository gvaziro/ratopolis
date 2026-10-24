/**
 * Grate-click feel (v2). Every player click is a wooden "tok" tuned to a G-major pentatonic step read off the
 * bustle meter (floor(value / 12)), so a streak climbs the scale and «Аврал» runs up and down the top octave.
 * Long and fast streaks soften instead of piling up: above 5 clicks/s each tok is a little quieter, after 4 s of
 * non-stop clicking the streak eases to −3 dB (back after 1 s idle), and above 8 clicks/s only every 3rd coin tinks.
 */
import { clockMs, play } from "./core";
import { clickTok, coinTink, COIN_STEPS, woodTok } from "./instruments";
import { pick, rnd, semi } from "./synth";

/** G4: the coins ring in the same key (1568 Hz = G6). */
const ROOT = 392;
const PENTA = [0, 2, 4, 7, 9] as const;
/** «Аврал»: up and down the top octave, G5 → G6 → G5. */
const FRENZY_STEPS = [5, 6, 7, 8, 9, 10, 9, 8, 7, 6] as const;
/** Before «Суматоха» there is no meter: a shadow one climbs at most one pentatonic run (steps 0–4). */
const SHADOW_CAP = 59;
/** After this much non-stop clicking the streak eases down… */
const LONG_MS = 4000;
const LONG_EASE_MS = 1500;
/** …to −3 dB. */
const LONG_GAIN = Math.pow(10, -3 / 20);
/** A gap this long ends the streak. */
const IDLE_MS = 1000;
/** Above this rate each tok gets quieter (gain × (5 / cps)^0.35: 15/s ≈ −3.3 dB). */
const SOFT_CPS = 5;
/** Above this rate only every 3rd coin tinks. */
const THIN_CPS = 8;

/** Semitones above the root of pentatonic step n (5 steps per octave). */
export function pentaSemis(n: number): number {
  const s = Math.max(0, Math.floor(Number.isFinite(n) ? n : 0));
  return PENTA[s % 5] + 12 * Math.floor(s / 5);
}

/** Bustle 0..100 → pentatonic step 0..8. */
export function bustleStep(value: number): number {
  return Math.max(0, Math.min(8, Math.floor((Number.isFinite(value) ? value : 0) / 12)));
}

let times: number[] = [];
let streakStart = -Infinity;
let lastClick = -Infinity;
let frenzyI = 0;
let shadow = 0;
let shadowAt = -Infinity;
let dropN = 0;
let lastCoin = -Infinity;

/** Test harness: forget the streak. */
export function resetClickFeel(): void {
  times = [];
  streakStart = -Infinity;
  lastClick = -Infinity;
  frenzyI = 0;
  shadow = 0;
  shadowAt = -Infinity;
  dropN = 0;
  lastCoin = -Infinity;
}

/** Player clicks in the last second. */
function cps(now: number): number {
  while (times.length > 0 && now - times[0] >= 1000) times.shift();
  return times.length;
}

/** The shadow meter follows the engine's rules: +3 per click, −10/s once 0.8 s pass without one. */
function shadowBustle(now: number): number {
  const idle = (now - shadowAt) / 1000 - 0.8;
  if (idle > 0) shadow = Math.max(0, shadow - 10 * idle);
  shadow = Math.min(SHADOW_CAP, shadow + 3);
  shadowAt = now;
  return shadow;
}

/**
 * The tuned grate click at pentatonic `step` (0 = G4), `gain` from the click feel.
 * Without a step: the old untuned tok (pitch ±5%), for scenes that just want a click.
 */
export function clickVoice(step?: number, gain = 1): void {
  if (step === undefined || !Number.isFinite(step)) {
    play("click", { max: 6, gapMs: 28 }, { send: 0.08, pan: rnd(-0.15, 0.15), gain }, (v) => woodTok(v, v.t, rnd(0.95, 1.05), 1));
    return;
  }
  const f = ROOT * semi(pentaSemis(step)) * rnd(0.997, 1.003);
  // the ear is keener up there: the top octave comes down ~3 dB so a frenzy never turns shrill
  const level = Math.pow(f / ROOT, -0.25);
  play("click", { max: 6, gapMs: 28 }, { send: 0.08, pan: rnd(-0.12, 0.12), gain }, (v) => clickTok(v, v.t, f, level));
}

/** Bright metallic tink (random pentatonic pitch so a stream of coins sparkles). */
export function coinVoice(): void {
  play("coin", { max: 6, gapMs: 45 }, { send: 0.12, pan: rnd(-0.25, 0.25) }, (v) => coinTink(v, v.t, 1568 * semi(pick(COIN_STEPS)) * rnd(0.996, 1.004), 1));
}

/**
 * One player click on the grate. `bustle` = game.bustle.value (null before the «Суматоха» upgrade: a shadow
 * meter stands in), `frenzy` = «Аврал» is on.
 */
export function playerClick(bustle: number | null, frenzy: boolean): void {
  const now = clockMs();
  if (now - lastClick > IDLE_MS) streakStart = now;
  lastClick = now;
  times.push(now);
  const rate = cps(now);
  const soft = rate > SOFT_CPS ? Math.pow(SOFT_CPS / rate, 0.35) : 1;
  const long = Math.min(1, Math.max(0, (now - streakStart - LONG_MS) / LONG_EASE_MS));
  const gain = soft * (1 - (1 - LONG_GAIN) * long);
  let step: number;
  if (frenzy) step = FRENZY_STEPS[frenzyI++ % FRENZY_STEPS.length];
  else {
    frenzyI = 0;
    step = bustleStep(bustle ?? shadowBustle(now));
  }
  clickVoice(step, gain);
}

/** A coin (or button, wire…) dropped by a player click: every one up to 8 clicks/s, then only every 3rd. */
export function playerDrop(): void {
  const now = clockMs();
  if (cps(now) > THIN_CPS) {
    if (dropN++ % 3 !== 0) return;
  } else {
    dropN = 0;
    if (now - lastCoin <= 80) return;
  }
  lastCoin = now;
  coinVoice();
}
