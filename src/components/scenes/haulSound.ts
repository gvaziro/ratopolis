/**
 * The haul card's sound ladder (v3 SCN-3), as pure timetables so vitest can pin them down: the odometer ratchet
 * (one tick each time the eased roll-up crosses another 1/14, pitch rising) and the landing stinger by rating — none:
 * a dull tick, bronze: a small bell, silver: two chimes, gold: the brotherhood's stamp and the medal arpeggio, royal:
 * the stamp, the record fanfare and a handful of coins. Everything ends within HAUL_SOUND_END_MS of the card.
 */
import type { HaulSummary } from "@/game/types";

/** The roll-up's length (ms) and its steps. */
export const ODOMETER_MS = 1200;
export const ODOMETER_STEPS = 14;
/** Ticks closer than this are spaced out (the «tick» cue drops repeats within 40 ms). */
export const TICK_GAP_MS = 45;
/** Every card sound is over by then (ms after the card shows; bell tails aside). */
export const HAUL_SOUND_END_MS = 2300;

/** The roll-up's easing (sceneUtils.easeOutCubic). */
const ease = (k: number) => 1 - Math.pow(1 - Math.max(0, Math.min(1, k)), 3);

/** When eased progress first reaches `p` (inverse of easeOutCubic), as a share of the duration. */
function reachAt(p: number): number {
  return 1 - Math.cbrt(1 - Math.max(0, Math.min(1, p)));
}

/**
 * The odometer's ticks: ms after its start and the progress step k (1/14 … 1) that each marks. The early crossings come
 * faster than the cue can repeat, so a tick waits until TICK_GAP_MS after the one before; the later ones slow down
 * with the ease-out on their own.
 */
export function odometerTicks(durMs = ODOMETER_MS, steps = ODOMETER_STEPS, minGapMs = TICK_GAP_MS): { at: number; k: number }[] {
  const out: { at: number; k: number }[] = [];
  let last = -Infinity;
  for (let j = 1; j <= steps; j++) {
    const k = j / steps;
    const at = Math.max(reachAt(k) * durMs, last + minGapMs);
    out.push({ at, k });
    last = at;
  }
  return out;
}

/** Tick pitch at step k: 1 + 0.5·k. */
export function tickPitch(k: number): number {
  return 1 + 0.5 * Math.max(0, Math.min(1, k));
}

/** Eased roll-up value at `ms` (for the display). */
export function rollUpAt(ms: number, durMs = ODOMETER_MS): number {
  return ease(ms / durMs);
}

export type StingerSound = "tierLost" | "tin" | "chime" | "stamp" | "medal" | "record" | "jingle";

export interface StingerStep {
  /** ms after the card shows. */
  at: number;
  sound: StingerSound;
  /** chime: pitch multiplier of the cue (1318.5 Hz × pitch). */
  pitch?: number;
}

/** How long each stinger sound's body lasts (ms; src/audio: the record fanfare's last chord ends at 1.03 s). */
export const STINGER_LEN_MS: Record<StingerSound, number> = { tierLost: 100, tin: 450, chime: 500, stamp: 160, medal: 520, record: 1030, jingle: 330 };

/** The chime cue rings at 1318.5 Hz; the silver's second note is 1568 Hz. */
export const CHIME_HZ = 1318.5;
/** The chime cue drops repeats within 100 ms: the silver's two notes are spaced a little wider than the 90 ms asked. */
export const CHIME_GAP_MS = 110;

/** The landing stinger of each rating (≈ 1.25 s, when the odometer comes to rest). */
export function haulStinger(rating: HaulSummary["rating"]): StingerStep[] {
  switch (rating) {
    case "bronze":
      return [{ at: 1250, sound: "tin" }];
    case "silver":
      return [
        { at: 1250, sound: "chime", pitch: 1 },
        { at: 1250 + CHIME_GAP_MS, sound: "chime", pitch: 1568 / CHIME_HZ },
      ];
    case "gold":
      return [
        { at: 1350, sound: "stamp" },
        { at: 1470, sound: "medal" },
      ];
    case "royal":
      return [
        { at: 1200, sound: "stamp" },
        { at: 1240, sound: "record" },
        { at: 1560, sound: "jingle" },
      ];
    default:
      return [{ at: 1250, sound: "tierLost" }];
  }
}
