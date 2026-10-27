/**
 * The audio test bench (AUD-1): a fresh offline context with the real synth attached (volume 1, «Эффекты» 1,
 * «Фон» 0.5, «Музыка» 0.35, a seeded Math.random), and the catalogue of every one-shot sound the game can make — each
 * sfx method, each SfxCue and SfxCue3 — with how long to render it. src/audio/mix.test.ts renders each once and checks
 * it against its mix sheet. v3: the music sequencer, the train on screen and the birth counter start fresh too.
 */
import { ambienceStop } from "../ambience";
import { resetBirths } from "../births";
import { resetClickFeel } from "../clicks";
import { attachForTest, live, musicBus, setAmbienceCore, setMusicCore, setSfxVolumeCore, setVolumeCore, voicesNow, type Core } from "../core";
import { CUE_NAMES } from "../cues";
import { musicState, musicStop, musicTick, type MusicState } from "../music";
import { sfx } from "../sfx";
import { CUE3_NAMES } from "../voices";
import { OfflineCtx, type Tap } from "./offlineCtx";
import { seedRandom } from "./seed";

export const SR = 16000;

export interface Bench {
  ctx: OfflineCtx;
  core: Core;
  /** The master output (= the compressor's input: the bench's compressor passes through, the master is 1). */
  master: Tap;
  /** Put Math.random back. */
  restore: () => void;
}

/**
 * A fresh context with the synth attached and every loop, hold and click streak reset. `sr`: a lower rate for long
 * renders of the low and mid bands (the ambience's beds) — never for anything measured above 4 kHz.
 */
export function bench(seed = 7, sr = SR): Bench {
  const restore = seedRandom(seed);
  sfx.chuffStop();
  sfx.rumbleStop();
  ambienceStop();
  musicStop();
  const ctx = new OfflineCtx(sr);
  setVolumeCore(1, true);
  setSfxVolumeCore(1);
  setAmbienceCore(0.5);
  setMusicCore(0.35);
  attachForTest(ctx as unknown as BaseAudioContext);
  sfx.hold(false);
  sfx.ceremony(false);
  sfx.train(null);
  sfx.passStart();
  resetClickFeel();
  resetBirths();
  const c = live();
  if (!c) throw new Error("bench: no core");
  return { ctx, core: c, master: ctx.tap(c.master), restore };
}

export interface SoundDef {
  play: () => void;
  /** Seconds to render (the loud part; the leak check skips past the tail). */
  dur: number;
}

/** sfx members that are controls, loops or dispatchers, not one-shot sounds (each is covered elsewhere). */
export const SFX_CONTROLS = new Set([
  "unlock",
  "setVolume",
  "pause",
  "playerClick",
  "rumbleStart",
  "rumbleSet",
  "rumbleStop",
  "rumbleCut",
  "rumbleKind",
  "chuffStart",
  "chuffSet",
  "chuffStop",
  "cue",
  "cue3",
  "setAmbience",
  "ambience",
  "ambienceStop",
  "hold",
  "ceremony",
  "setSfxVolume",
  "setMusic",
  "music",
  "musicStop",
  "train",
  "passStart",
]);

const s = (play: () => void, dur = 1.2): SoundDef => ({ play, dur });

/** Every one-shot sound, by name. */
export const SOUNDS: Record<string, SoundDef> = {
  click: s(() => sfx.click()),
  "click(4)": s(() => sfx.click(4)),
  playerDrop: s(() => sfx.playerDrop()),
  find: s(() => sfx.find()),
  coin: s(() => sfx.coin()),
  tin: s(() => sfx.tin()),
  thud: s(() => sfx.thud()),
  squeak: s(() => sfx.squeak()),
  fanfare: s(() => sfx.fanfare(), 1.5),
  medal: s(() => sfx.medal()),
  blip: s(() => sfx.blip(0)),
  bump: s(() => sfx.bump()),
  ouch: s(() => sfx.ouch()),
  clack: s(() => sfx.clack()),
  whistle: s(() => sfx.whistle(false), 1.6),
  "whistle(royal)": s(() => sfx.whistle(true), 2),
  bell: s(() => sfx.bell()),
  hiss: s(() => sfx.hiss()),
  pop: s(() => sfx.pop()),
  splash: s(() => sfx.splash()),
  meow: s(() => sfx.meow(), 1.6),
  bonk: s(() => sfx.bonk()),
  pipe: s(() => sfx.pipe(0)),
  jackpot: s(() => sfx.jackpot(), 2),
  dig: s(() => sfx.dig()),
  typewriter: s(() => sfx.typewriter()),
  whistleFar: s(() => sfx.whistleFar(false), 1.6),
  hooves: s(() => sfx.hooves(), 2),
  rain: s(() => sfx.rain(), 3.5),
  sting: s(() => sfx.sting(), 2),
  drone: s(() => sfx.drone(), 4),
  flourish: s(() => sfx.flourish()),
  jingle: s(() => sfx.jingle()),
  typeBurst: s(() => sfx.typeBurst(3)),
  drip: s(() => sfx.drip()),
  scout: s(() => sfx.scout(1)),
  migration: s(() => sfx.migration(), 3.5),
  record: s(() => sfx.record(), 2),
  commission: s(() => sfx.commission(false)),
  "commission(done)": s(() => sfx.commission(true), 1.5),
  coronationBells: s(() => sfx.coronationBells(), 4.5),
  hoof: s(() => sfx.hoof()),
  chatter: s(() => sfx.chatter(1), 1.5),
  "chatter(3, cheer)": s(() => sfx.chatter(3, true), 2.2),
  hunger: s(() => sfx.hunger(), 1.6),
  nibbles: s(() => sfx.nibbles()),
  valve: s(() => sfx.valve()),
  deepRumble: s(() => sfx.deepRumble(), 3),
  curio: s(() => sfx.curio(), 1.6),
  birth: s(() => sfx.birth()),
  thunk: s(() => sfx.thunk()),
  crowd: s(() => sfx.crowd(), 4.5),
};
for (const c of CUE_NAMES) if (c !== "rumbleCut") SOUNDS[`cue ${c}`] = s(() => sfx.cue(c), 1.5);
for (const c of CUE3_NAMES) SOUNDS[`cue3 ${c}`] = s(() => sfx.cue3(c), c === "giantVoice" ? 2.6 : 1.6);

export interface MusicRender {
  /** The master, the music bus (after its fade), both with the skipped rests left out. */
  x: Float32Array;
  music: Float32Array;
  /** Seconds the music bus sounded (100 ms windows above −60 dBFS RMS) out of `sec`. */
  on: number;
  phrases: number;
}

/**
 * `sec` seconds of the district music (v3 AUD-3) on a fresh bench, its scheduler ticking every 25 ms like the page's
 * timer; the rests between phrases (nothing sounds then) are skipped, not rendered, so five minutes take seconds.
 */
export function renderMusic(st: Partial<MusicState>, sec: number, seed = 7): MusicRender {
  const b = bench(seed);
  try {
    sfx.music({ ready: true, district: "whitechapel", run: 0, organ: true, brass: true, scene: false, held: false, ...st });
    const tap = b.ctx.tap(musicBus(b.core).musicDuck);
    let t = 0;
    while (t < sec - 1e-6) {
      const ms = musicState();
      const gap = ms.nextAt !== null ? ms.nextAt - b.ctx.currentTime - 0.5 : 0;
      if (!ms.playing && voicesNow() === 0 && gap > 1) {
        const jump = Math.min(gap, sec - t);
        b.ctx.skip(jump);
        t += jump;
      } else {
        const step = Math.min(0.5, sec - t);
        b.ctx.run(step, { every: 0.025, fn: musicTick });
        t += step;
      }
    }
    const music = tap.data();
    const W = b.ctx.sampleRate / 10;
    let on = 0;
    for (let i = 0; i + W <= music.length; i += W) {
      let s = 0;
      for (let j = i; j < i + W; j++) s += music[j] * music[j];
      if (s / W > 1e-6) on += 0.1;
    }
    return { x: b.master.data(), music, on, phrases: musicState().phrases };
  } finally {
    musicStop();
    b.restore();
  }
}

export interface Rendered {
  x: Float32Array;
  /** Voices / sources still alive 30 s after the start (a leak if > 0). */
  voicesAfter: number;
  sourcesAfter: number;
}

/** Render one catalogued sound on a fresh bench. */
export function renderSound(name: string, seed = 7): Rendered {
  const b = bench(seed);
  try {
    SOUNDS[name].play();
    b.ctx.run(SOUNDS[name].dur);
    const x = b.master.data();
    b.ctx.skip(30);
    return { x, voicesAfter: voicesNow(), sourcesAfter: b.ctx.liveSources() };
  } finally {
    b.restore();
  }
}
