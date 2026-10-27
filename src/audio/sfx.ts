/**
 * WebAudio synthesized sound effects — no audio files. Short, warm, Victorian-mechanical.
 * Every call is a safe no-op before unlock() (first user gesture) and while muted;
 * identical sounds are throttled so none stacks past its voice limit.
 * v2: tuned grate clicks (clicks.ts), named cues and engine-Fx voices (cues.ts), the zone ambience (ambience.ts).
 * v3: the world bus and the hold gate (core.ts, AUD-1: hold(), ceremony()), foreground voices duck the train,
 * giant impacts a phone can hear, the giants' and rats' voices and the formerly silent events (voices.ts, AUD-2).
 * AUD-3: a real mixer (setSfxVolume «Эффекты», setMusic «Музыка»; setVolume is the master «Громкость») and the
 * generative district music (music.ts: music(state), the coronation anthem after the bells). AUD-4: a voice per
 * train variant (trainVoices.ts: train(variant) — whistle chord, chuff range, rumble, joints), a softer capsule
 * that alternates its hiss with a pneumatic thunk, catch blips in G major, births thinned to an occasional squeak or
 * litter trill (births.ts), the ambience rebalanced with «Наверху».
 */
import type { SfxCue, SfxCue3 } from "@/game/fx";
import type { TrainVariantId } from "@/game/types";
import { ambienceSet, ambienceStop, ambienceTick, type AmbienceState } from "./ambience";
import { birthVoice, squeakVoice } from "./births";
import { clickVoice, coinVoice, playerClick, playerDrop } from "./clicks";
import { ceremonyAmbienceCore, cutKey, duckAmbienceCore, live, onCoreRunning, pauseCore, play, sceneUp, setAmbienceCore, setHoldCore, setMusicCore, setSfxVolumeCore, setVolumeCore, unlockCore } from "./core";
import { commissionVoice, migrationVoice, playCue, recordVoice, scoutVoice } from "./cues";
import { blipAt, brass, CHIME, coinTink, COIN_STEPS, giantBody, GLOCK, HAND_BELL, hoof, ratchet, SMALL_BELL, thudAt, TOWER_BELL, typeKey } from "./instruments";
import { chuffSet, chuffStart, chuffStop, holdLoops, rumbleCut, rumbleKind, rumbleSet, rumbleStart, rumbleStop, rumbleTweak, type RumbleKind } from "./loops";
import { musicAnthem, musicCeremony, musicSet, musicStop, musicTick, type MusicState } from "./music";
import { filter, noise, panner, pick, rnd, semi, strike, tone, vibrato } from "./synth";
import { chuffRateOf, setTrain, train, whistleOf } from "./trainVoices";
import { crowdVoice, curioVoice, deepRumbleVoice, hoofVoice, hungerVoice, nibbleVoice, playCue3, ratChatterVoice, valveVoice } from "./voices";

export type { AmbienceState } from "./ambience";
export type { MusicState } from "./music";

// the context is back (a hidden tab shown again, an iOS call over): the loops and the music pick up at once
onCoreRunning(() => {
  ambienceTick();
  musicTick();
});

/**
 * Steam whistle: pure sines that scoop up, waver and sag as the steam drops, plus breath noise. v3 (AUD-4): the
 * chord, timbre and muffling of the train on screen (trainVoices.ts) — a circus calliope rolls its chord on breathy
 * pipes, the fog's whistle comes through a 900 Hz lowpass.
 */
function whistleVoice(royal: boolean, far: boolean): void {
  const w = whistleOf(royal);
  play(far ? "whistleFar" : "whistle", { max: 2, gapMs: 300 }, { send: far ? 0.55 : 0.28, gain: far ? 0.32 : 1 }, (v) => {
    const t = v.t;
    const dur = royal ? 1.25 : 0.85;
    const cut = Math.min(far ? 1500 : Infinity, w.lp ?? Infinity);
    const dest = Number.isFinite(cut) ? filter(v, "lowpass", cut, 0.7) : v.out;
    const each = w.freqs.length > 2 ? 0.8 : 1;
    if (w.timbre === "calliope") {
      w.freqs.forEach((f, i) => {
        const at = t + i * 0.07;
        const { osc, end } = tone(v, { f: f * 0.98, t: at, a: 0.03, hold: dur - i * 0.07, d: 0.2, peak: 0.1 * each, dest });
        osc.frequency.exponentialRampToValueAtTime(f, at + 0.05);
        vibrato(v, osc.frequency, at, end, 7, f * 0.009, 0.05);
        tone(v, { type: "triangle", f: f * 2, t: at, a: 0.03, hold: dur - i * 0.07, d: 0.2, peak: 0.022 * each, dest });
        noise(v, { t: at, a: 0.02, hold: dur - i * 0.07, d: 0.2, peak: 0.03, filter: "bandpass", f, q: 3, dest });
      });
      noise(v, { t, a: 0.004, d: 0.12, peak: 0.05, filter: "highpass", f: 2500, dest });
      return;
    }
    for (const f of w.freqs) {
      for (const [mul, pk] of [
        [1, 0.12],
        [2, 0.018],
      ] as const) {
        const { osc } = tone(v, { f: f * mul * 0.93, t, a: 0.06, hold: dur, d: 0.28, peak: pk * each, dest });
        osc.frequency.exponentialRampToValueAtTime(f * mul, t + 0.09);
        osc.frequency.setValueAtTime(f * mul, t + dur);
        osc.frequency.exponentialRampToValueAtTime(f * mul * 0.95, t + dur + 0.3);
        vibrato(v, osc.frequency, t, t + dur + 0.35, 6, f * mul * 0.004, 0.12);
      }
    }
    noise(v, { t, a: 0.02, hold: dur, d: 0.25, peak: 0.05, filter: "bandpass", f: royal ? w.freqs[0] * 1.125 : w.freqs[0], q: 2.5, dest });
    noise(v, { t, a: 0.004, d: 0.16, peak: 0.07, filter: "highpass", f: 2500, dest });
  });
}

/** The capsule's joints alternate the hiss and a pneumatic thunk (counted from the pass's start). */
let hissN = 0;

/** Seconds from a coronationBells() call to its first strike (Voice start 6 ms + 0.25 s), and between strikes. */
const BELL_LEAD = 0.006 + 0.25;
const BELL_GAP = 0.9;
/**
 * The coronation's bell sequence in progress: its context and its last strike (context time). A second call before
 * that strike is the same coronation heard twice (the late path: CoronationOverlay and the AudioDirector both ring),
 * so it leaves the bells and the anthem's time as the first call set them.
 */
let bellsOn: { ctx: BaseAudioContext; last: number } | null = null;

/** A pneumatic thunk: a 180 → 90 Hz knock and a puff of air at 900 Hz (a capsule joint). */
function thunkVoice(): void {
  play("thunk", { max: 3, gapMs: 60 }, { send: 0.1 }, (v) => {
    tone(v, { f: 180, to: 90, glide: 0.08, t: v.t, a: 0.002, d: 0.08, peak: 0.5 });
    tone(v, { type: "triangle", f: 360, to: 200, glide: 0.04, t: v.t, a: 0.001, d: 0.04, peak: 0.12 });
    noise(v, { t: v.t, a: 0.002, d: 0.05, peak: 0.22, filter: "bandpass", f: 900, q: 1.2 });
  });
}

/**
 * v3 (AUD-4) the capsule tube's air: a band of noise sweeping 3600 → 1800 Hz at 0.14, held 0.1 s (v2: 5200 → 2600 at
 * 0.2, held 0.18 s — the brightest sound of the game, as loud as an upgrade's ring).
 */
function hissVoice(): void {
  play("hiss", { max: 3, gapMs: 90 }, { send: 0.12 }, (v) => {
    noise(v, { t: v.t, a: 0.025, hold: 0.1, d: 0.3, peak: 0.14, filter: "bandpass", f: 3600, to: 1800, q: 0.8 });
    noise(v, { kind: "pink", t: v.t, a: 0.01, d: 0.2, peak: 0.05, filter: "bandpass", f: 1500, q: 0.7 });
  });
}

/* --------------------------------------------------------------- public */

export const sfx = {
  /** Resume/create the AudioContext on the first user gesture. */
  unlock(): void {
    unlockCore();
  },

  /** The master («Громкость»): v 0..1 slider value; enabled=false mutes instantly (short ramp). */
  setVolume(v: number, enabled: boolean): void {
    setVolumeCore(v, enabled);
  },

  /** v3 (AUD-3): settings.sfxVolume 0..1 («Эффекты»): every effect, not the ambience or the music. */
  setSfxVolume(v: number): void {
    setSfxVolumeCore(v);
  },

  /** v3 (AUD-3): settings.music 0..1 («Музыка»); 0 builds no music at all. */
  setMusic(v: number): void {
    setMusicCore(v);
    musicTick();
  },

  /**
   * Soft wooden "tok". With `step`: tuned to that G-major pentatonic step (0 = G4, 5 = G5, 10 = G6);
   * without: untuned, pitch ±5% (scenes' incidental clicks).
   */
  click(step?: number): void {
    clickVoice(step);
  },

  /**
   * A player's click on the grate (v2 click feel): the step comes from the bustle meter (`bustle` 0..100, or null
   * before «Суматоха»: a shadow meter stands in), «Аврал» (`frenzy`) runs the top octave; fast and long streaks soften.
   */
  playerClick(bustle: number | null, frenzy: boolean): void {
    playerClick(bustle, frenzy);
  },

  /** A drop from a player click: a coin tink, thinned to every 3rd above 8 clicks/s. */
  playerDrop(): void {
    playerDrop();
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

  /** Bright metallic tink (random pentatonic pitch so a stream of coins sparkles); in a scene it ducks the train. */
  coin(): void {
    coinVoice(sceneUp());
  },

  /** Small bell "тинь" — readiness ring. */
  tin(): void {
    play("tin", { max: 4, gapMs: 60 }, { send: 0.2 }, (v) => strike(v, v.t, 1760 * rnd(0.99, 1.01), SMALL_BELL));
  },

  /** Muffled purchase "тук". */
  thud(): void {
    play("thud", { max: 4, gapMs: 50 }, { send: 0.06 }, (v) => {
      const k = rnd(0.96, 1.04);
      thudAt(v, v.t, k, 1);
      giantBody(v, v.t, 160 * k, 0.14, 0.3);
    });
  },

  /**
   * Tiny chirp, the next of four shapes (rise, rise-fall, double, short). At most 3 per second. A ceremony voice:
   * the coronation show's boarding rats squeak while the game is held (births cannot happen then).
   */
  squeak(): void {
    squeakVoice();
  },

  /**
   * v3 (AUD-4): a rat is born (Fx birth). Counted, not voiced each time: at most one sound per 1.4 s — a squeak, or a
   * litter trill when 3+ were born since the last; none under a close-up.
   */
  birth(): void {
    birthVoice();
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

  /**
   * Catch pickup; pitch climbs the G-major scale from G4, a degree per combo step (Peggle-style), wrapping every 14
   * steps (two octaves; v3 AUD-4 — v2 climbed chromatically from C5). Ducks the train.
   */
  blip(step: number): void {
    play("blip", { max: 8, gapMs: 18 }, { send: 0.15, fg: true }, (v) => blipAt(v, v.t, Number.isFinite(step) ? step : 0, 1));
  },

  /** Dull low "бум" — combo broken. */
  bump(): void {
    play("bump", { max: 3, gapMs: 80 }, { send: 0.08, fg: true }, (v) => {
      const t = v.t;
      tone(v, { f: 120, to: 52, glide: 0.22, t, a: 0.004, d: 0.3, peak: 0.5 });
      tone(v, { type: "triangle", f: 300, to: 150, glide: 0.18, t, a: 0.004, d: 0.18, peak: 0.32 });
      // a deflating "womp" that small speakers can carry
      tone(v, { type: "sawtooth", f: 220, to: 105, glide: 0.2, t, a: 0.006, d: 0.2, peak: 0.12, dest: filter(v, "lowpass", 900, 1) });
      noise(v, { kind: "brown", t, a: 0.002, d: 0.08, peak: 0.3, filter: "lowpass", f: 400 });
      giantBody(v, t, 120, 0.22, 0.3);
    });
  },

  /** Squeaky "Ай!" with a spark crackle. */
  ouch(): void {
    play("ouch", { max: 3, gapMs: 90 }, { send: 0.1, fg: true }, (v) => {
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

  /**
   * Double rail-joint click "клац-клац". v3 (AUD-4): on a freight the chains clank after it, on a flooded train the
   * wheels splash (the train on screen, trainVoices.ts).
   */
  clack(): void {
    const joint = train()?.voice.joint;
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
      if (joint === "chain") {
        // the couplings' chains: a slack clank and a short ratchet
        const at = v.t + 0.16;
        ratchet(v, at, 3, 0.05, 0.5, 1.2);
        tone(v, { type: "triangle", f: 640 * rnd(0.96, 1.04), t: at + 0.02, a: 0.001, d: 0.14, peak: 0.07 });
        tone(v, { f: 1010 * rnd(0.97, 1.03), t: at + 0.06, a: 0.001, d: 0.09, peak: 0.04 });
      } else if (joint === "splash") {
        // the wheels throw up the water in the cut
        const at = v.t + 0.04;
        noise(v, { t: at, a: 0.004, d: 0.2, peak: 0.24, filter: "bandpass", f: 2200, to: 700, q: 0.9 });
        noise(v, { kind: "pink", t: at, a: 0.002, d: 0.08, peak: 0.16, filter: "lowpass", f: 900 });
        for (let i = 0; i < 2; i++) {
          const f = rnd(700, 1300);
          tone(v, { f, to: f * 1.8, glide: 0.03, t: at + rnd(0.05, 0.18), a: 0.002, d: 0.05, peak: 0.07 });
        }
      }
    });
  },

  /** Steam whistle of the train on screen (v3: its variant's chord); royal = two sines (880 & 1100 Hz). */
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

  /**
   * Band-passed air hiss (capsule tube). v3 (AUD-4): softer and lower (3600 → 1800 Hz, peak 0.14); the capsule's
   * joints alternate it with a pneumatic thunk (every second call since passStart()).
   */
  hiss(): void {
    if (hissN++ % 2 === 1) thunkVoice();
    else hissVoice();
  },

  /** v3 (AUD-4): a capsule joint's pneumatic thunk (180 → 90 Hz and a puff at 900 Hz). */
  thunk(): void {
    thunkVoice();
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
    play("jackpot", { max: 2, gapMs: 300 }, { send: 0.35, fg: true }, (v) => {
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
      giantBody(v, t, 90, 0.18, 0.3);
    });
  },

  /** A single typewriter key (a ceremony voice too: the coronation show types its line while the game is held). */
  typewriter(): void {
    play("type", { max: 4, gapMs: 32 }, { send: 0.06, pan: rnd(-0.2, 0.2), prio: "ceremony" }, (v) => typeKey(v, v.t, 1));
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
  /** The train is gone: the rumble drops to nothing in `sec` (default 120 ms) and stays down until the next rumbleStart/Stop. */
  rumbleCut(sec?: number): void {
    rumbleCut(sec);
  },

  /** Steam chuff at `rate` beats per second (2 → 8; v3: mapped onto the train variant's range — a freight 1.5 → 5). */
  chuffStart(rate: number): void {
    chuffStart(chuffRateOf(rate));
  },
  chuffSet(rate: number): void {
    chuffSet(chuffRateOf(rate));
  },
  chuffStop(): void {
    chuffStop();
  },

  /**
   * `n` deep bell strikes (twelve for the whole ride, three for a repeat coronation's short form; coronationGate's
   * bellsOf): the first 0.25 s from now, then every 0.9 s (Celebration keeps in step), the last one louder.
   * v3 (AUD-3): after the last the colony's tune is played as the anthem (music.ts, while the ceremony lasts).
   * `restart` («Полная церемония ›»): the sequence still sounding and its anthem are cut, and the bells ring again
   * from the first (the limiter would drop them otherwise). Without it, a call while a sequence still has strikes to
   * come is the same coronation rung twice and changes nothing.
   */
  coronationBells(n = 12, restart = false): void {
    const count = Math.max(1, Math.floor(Number.isFinite(n) ? n : 12));
    const c = live();
    if (restart) {
      cutKey("coronation");
      cutKey("music");
      bellsOn = null;
    } else if (c && bellsOn?.ctx === c.ctx && c.ctx.currentTime < bellsOn.last) return;
    const span = (count - 1) * BELL_GAP;
    let lastBell = -1;
    play("coronation", { max: 1, gapMs: 4000 }, { send: 0.45, prio: "ceremony" }, (v) => {
      for (let i = 0; i < count; i++) {
        const t = v.t + 0.25 + i * BELL_GAP;
        const g = i === count - 1 ? 1.2 : 1;
        strike(v, t, 164.8, TOWER_BELL, g);
        noise(v, { t, a: 0.001, d: 0.03, peak: 0.08 * g, filter: "bandpass", f: 2200, q: 1 });
        noise(v, { kind: "brown", t, a: 0.002, d: 0.09, peak: 0.18 * g, filter: "lowpass", f: 400 });
      }
      lastBell = v.t + 0.25 + span;
    });
    // «Эффекты» at 0 rings no bells, but the anthem still keeps their time
    if (lastBell < 0 && c) lastBell = c.ctx.currentTime + BELL_LEAD + span;
    if (lastBell < 0 || !c) return;
    bellsOn = { ctx: c.ctx, last: lastBell };
    musicAnthem(lastBell);
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

  /** The same whistle heard from far down the tunnel (train announced; v3: its variant's chord). */
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
      // G B D G B: blip steps are G-major degrees (v3)
      [0, 2, 4, 7, 9].forEach((s, i) => blipAt(v, v.t + i * 0.055, s, i === 4 ? 1.2 : 0.9));
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

  /** One water drip in a cavern, on the effects bus (a scene's own drip; the sewer ambience drips by itself). */
  drip(): void {
    play("drip", { max: 2, gapMs: 150 }, { send: 0.6, pan: rnd(-0.6, 0.6), gain: 0.8 }, (v) => {
      const f = rnd(850, 1350);
      tone(v, { f, to: f * 1.9, glide: 0.028, t: v.t, a: 0.001, d: 0.07, peak: 0.09 });
    });
  },

  /* ------------------------------------------------------------------- v2 */

  /** A named UI cue (UiFx {k:"sfx"}): intensity 0..1 scales the volume, pitch multiplies the frequency. */
  cue(cue: SfxCue, intensity?: number, pitch?: number): void {
    playCue(cue, intensity, pitch);
  },

  /** Scouts are back with a share of the expedition (Fx scout, step 1..3). */
  scout(step: number): void {
    scoutVoice(step);
  },

  /** The Great Migration: a low brass swell (Fx migration). */
  migration(): void {
    migrationVoice();
  },

  /** A new colony record (Fx record): a fanfare. */
  record(): void {
    recordVoice();
  },

  /** A royal commission accepted (stamp) or done (stamp and bells) (Fx commission). */
  commission(done: boolean): void {
    commissionVoice(done);
  },

  /** settings.ambience 0..1: the background bus level (settings.volume stays the effects/master volume). */
  setAmbience(v: number): void {
    setAmbienceCore(v);
  },

  /** What the colony sounds like right now: open zones, the clock tower, machinery density, a close-up (ducks −9 dB). */
  ambience(st: Partial<AmbienceState>): void {
    if (st.duck !== undefined) duckAmbienceCore(st.duck);
    ambienceSet(st);
  },

  /** Stop the ambience scheduler and its loops. */
  ambienceStop(): void {
    ambienceStop();
  },

  /* ------------------------------------------------------------------- v3 */

  /**
   * The game is held (store isHeld: a ceremony, a crash, a save issue). On: every new voice but the ceremony's own
   * is dropped, the rumble parks at zero and the chuff skips its beats. Off: the rumble and the chuff come back at
   * the scene's current intensity and rate (K2).
   */
  hold(on: boolean): void {
    setHoldCore(on);
    holdLoops(on);
  },

  /** A ceremony is open: the ambience sits −15 dB down (back over 1.5 s); closing it ends the coronation anthem. */
  ceremony(on: boolean): void {
    ceremonyAmbienceCore(on);
    musicCeremony(on);
  },

  /**
   * v3 (AUD-3): what the colony's music should do (music.ts): a building stands (`ready`), the district and run (the
   * theme), the Cellars (the organ's pah-pah) and the Terminal (the brass bass), a close-up or a hold (silence).
   */
  music(st: Partial<MusicState>): void {
    musicSet(st);
  },

  /** Stop the music's sequencer (AudioDirector unmount). */
  musicStop(): void {
    musicStop();
  },

  /**
   * v3 (AUD-4): a train's scene starts (its variant; the royal express and the capsule pass "normal") or ends (null):
   * the whistle's chord, the doppler's pitch, the chuff range, the rumble and the joints follow it, ±25 cents per train.
   */
  train(variant: TrainVariantId | null): void {
    const t = setTrain(variant);
    rumbleTweak(t?.voice.rumble);
  },

  /**
   * v3 (AUD-4): a train's (or capsule's) pass begins: the capsule's joints count hiss / thunk from here; under a
   * rush-hour train the crowd on the platform above starts muttering (after the arrival's thump).
   */
  passStart(): void {
    hissN = 0;
    if (train()?.voice.crowd) crowdVoice(1, 0.6);
  },

  /** v3 (AUD-4): the rush-hour crowd on the platform above mutters while the train passes. */
  crowd(): void {
    crowdVoice();
  },

  /** A v3 cue (UiFx "sfx3"): giant/rat voices, the coachman, a hoof, a curio, a countered lunge, the cat's growl. */
  cue3(cue: SfxCue3, intensity?: number, pitch?: number): void {
    playCue3(cue, intensity, pitch);
  },

  /** One hoof on the cobbles (fore and hind feet alternate). */
  hoof(pitch = 1): void {
    hoofVoice(1, pitch);
  },

  /** The crew chatters: `voices` rats (1–4) staggered; `cheer` = a rising squeal (a gold haul, a new zone). */
  chatter(voices = 1, cheer = false): void {
    ratChatterVoice(1, 1, voices, cheer, cheer ? "ratCheer" : "ratChatter");
  },

  /** Hunger: the belly growls and a squeak falls; `gain` 0.5 for the reminders while the colony stays hungry. */
  hunger(gain = 1): void {
    hungerVoice(gain);
  },

  /** Hunger is over: three nibbles. */
  nibbles(): void {
    nibbleVoice();
  },

  /** A store blows its safety valve (Fx overload): a pop and a falling hiss. */
  valve(): void {
    valveVoice();
  },

  /** «Гул из глубины» (Fx deepRumble): 2.5 s of a far train under the burrow. */
  deepRumble(): void {
    deepRumbleVoice();
  },

  /** A curio for the King's Kunstkamera (Fx curio): a small bell and a sparkle. */
  curio(): void {
    curioVoice();
  },
};
