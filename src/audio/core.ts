/**
 * WebAudio core: a lazily created context and the output chain
 *   voices → bus → high shelf (−4 dB, never harsh) → compressor → master volume → speakers,
 * a small synthetic "brick tunnel" reverb on a send, shared noise buffers, and voice bookkeeping
 * (per-sound throttling so one sound never stacks past its voice limit, node cleanup on end).
 * v2: a second input, the ambience bus (× settings.ambience, ducked −9 dB under close-ups), joins the
 * same shelf → compressor → master chain, so the background obeys the master volume and the limiter too.
 * v3 (AUD-1): a third input, the `world` bus (the train rumble, the chuff, giant steps and the ambience bus output),
 * dips −4 dB for a moment under each foreground event (`fg` voices: a catch blip, a coin in a scene…), so the catch
 * stays audible over the train without the compressor pumping (it is gentler now: −10 dB, 2.5:1). A hold gate
 * (setHoldCore) silences every voice but the ceremony's own while the game is held (a ceremony, a halt).
 * v3 (AUD-3): a real mixer. `volume` is the master («Громкость»); settings.sfxVolume («Эффекты») scales the effects
 * at three points (the dry bus, the effects' reverb sends, the world input — the train and the giants), so «Эффекты»
 * at 0 leaves the ambience and the music playing; the music bus (music → musicLevel → musicDuck → shelf, a 0.35
 * reverb send) is built only once a note is due and the «Музыка» slider is above zero. A voice whose builder throws
 * is dropped quietly (play() never throws into an Fx listener). iOS: the audio session is "ambient" (mixes with the
 * player's own music, obeys the silent switch); an interrupted context is resumed like a suspended one, and the
 * scheduler hooks run again the moment the context is back to "running" (onCoreRunning).
 * Nothing here touches the DOM until unlock() runs on a user gesture.
 */

export type NoiseKind = "white" | "pink" | "brown";

export interface Core {
  ctx: BaseAudioContext;
  /** Dry input for every effects voice: → fx (settings.sfxVolume) → shelf. */
  bus: GainNode;
  /** v3: the effects level after the dry bus (curve(sfxVolume)). */
  fx: GainNode;
  /** Reverb send input of the effects voices (v3: scaled by curve(sfxVolume)) → the room. */
  verb: GainNode;
  /** v3: the reverb itself (the ambience, world and music sends join here, unscaled by «Эффекты»). */
  room: GainNode;
  /** The tone stage every bus ends in (high shelf → compressor → master). */
  shelf: BiquadFilterNode;
  /** User volume, after the compressor. */
  master: GainNode;
  noise: Record<NoiseKind, AudioBuffer>;
  /** Ambience bus input: → ambLevel (settings.ambience) → ambDuck (close-ups) → the world mix, plus a reverb send. */
  amb: GainNode;
  ambLevel: GainNode;
  ambDuck: GainNode;
  /**
   * v3: the world input of the effects (rumble, chuff, giant steps; scaled by curve(sfxVolume)) → worldMix (where the
   * ambience joins) → worldDuck → shelf, plus a reverb send from worldMix.
   */
  world: GainNode;
  worldMix: GainNode;
  /** Dips −4 dB for ~0.2 s under each foreground (`fg`) voice. */
  worldDuck: GainNode;
  /** v3 (AUD-3): the music bus, built on the first note (musicBus()); absent while «Музыка» stays at 0. */
  music?: GainNode;
  /** curve(settings.music). */
  musicLevel?: GainNode;
  /** The music's own fade (music.ts: down under a close-up or a hold, up at the next phrase). */
  musicDuck?: GainNode;
}

/** Hard ceiling on simultaneously sounding voices (one voice = one sound call). */
export const MAX_VOICES = 72;
/** Sounds scheduled this soon after a resume request still play (the first tap unlocks and clicks). */
const RESUME_GRACE_MS = 700;
/**
 * The ambience bus input: −1.5 dB on every layer, so with every zone open, the street above, a busy colony and steam
 * trouble its loudest 400 ms stays ≤ −32 LUFS (AUD-2/AUD-4; the zone steps are relative and keep their 1.6–1.8 LU).
 */
const AMB_TRIM = Math.pow(10, -1.5 / 20);
/** Ambience under a close-up: −9 dB. */
const AMB_DUCK = Math.pow(10, -9 / 20);
/** Ambience under a ceremony (the coronation, the migration card): −15 dB. */
const AMB_CEREMONY = Math.pow(10, -15 / 20);
/** The world bus under a foreground event: −4 dB, back over ~0.3 s. */
const WORLD_DUCK = Math.pow(10, -4 / 20);
/** The world bus's reverb send (the tunnel): the ambience's own send is trimmed so its total stays 0.4. */
const WORLD_SEND = 0.3;
/** The music bus's reverb send (a parlour, not a sewer: the music box rings in the same brick room). */
const MUSIC_SEND = 0.35;
/** The dry effects bus trim (v1 level); «Эффекты» scales it further (fx = curve(sfxVolume)). */
const BUS_TRIM = 0.9;
/** Sliders at or below this are off: no voice of that kind is built. */
const OFF = 0.001;
/** A cut voice (cutKey) fades out over this long. */
const CUT_FADE = 0.06;

/**
 * The main compressor (v3 AUD-1: was −16 dB, knee 14, 3.5:1, and pumped every catch sound with the rumble's lows).
 * The test bench's gain-reduction estimate reads the same numbers.
 */
export const COMP = { threshold: -10, knee: 10, ratio: 2.5, attack: 0.003, release: 0.2 } as const;

let core: Core | null = null;
let enabled = true;
let volume = 0.4;
let sfxVolume = 1;
let musicVolume = 0.35;
let ambVolume = 0.5;
let ambDucked = false;
let ambCeremony = false;
let held = false;
let resumeAskedAt = -Infinity;
let testMode = false;
let voiceCount = 0;

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : Number.isFinite(x) ? x : 0);
/** Perceptual volume curve (the master, «Эффекты», «Музыка»): 40% on the slider ≈ −12 dB. */
export const volumeGain = (v: number): number => Math.pow(clamp01(v), 1.5);
/** Ambience slider curve: 0.5 (the default) = unity, 1 ≈ +7 dB, 0.25 ≈ −7 dB, 0 = silence. */
const ambienceGain = (v: number): number => (v <= OFF ? 0 : Math.pow(clamp01(v) * 2, 1.2));

type AudioCtor = new (opts?: AudioContextOptions) => AudioContext;

/** Called when the context is back to "running" (after a suspend or an iOS interruption): the schedulers rebuild. */
const runningHooks = new Set<() => void>();

/** Run `fn` every time the context returns to "running" (sfx.ts registers the ambience and the music). */
export function onCoreRunning(fn: () => void): () => void {
  runningHooks.add(fn);
  return () => {
    runningHooks.delete(fn);
  };
}

function contextRunning(): void {
  for (const fn of runningHooks) {
    try {
      fn();
    } catch {
      /* a hook's failure never blocks the others */
    }
  }
}

/** iOS (Safari 16.4+): an "ambient" session mixes with the player's own music or podcast and obeys the silent switch. */
function ambientSession(): void {
  try {
    const nav = navigator as unknown as { audioSession?: { type: string } };
    if ("audioSession" in navigator && nav.audioSession) nav.audioSession.type = "ambient";
  } catch {
    /* not supported */
  }
}

/** Create (first call) and resume the context. Call from a user gesture. */
export function unlockCore(): void {
  if (typeof window === "undefined" || testMode) return;
  if (!core) {
    const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
    const Ctor = w.AudioContext ?? w.webkitAudioContext;
    if (!Ctor) return;
    ambientSession();
    try {
      const ctx = new Ctor({ latencyHint: "interactive" });
      core = build(ctx);
      ctx.onstatechange = () => {
        if ((ctx.state as string) === "running") contextRunning();
      };
    } catch {
      core = null;
      return;
    }
  }
  const ctx = core.ctx as AudioContext;
  // "interrupted" (iOS: a call, Siri, another app's audio) resumes like "suspended"
  if (ctx.state === "running" || ctx.state === "closed") return;
  resumeAskedAt = performance.now();
  try {
    void ctx.resume().catch(() => undefined);
    // iOS: a silent buffer started inside the gesture opens the output
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    src.connect(ctx.destination);
    src.start(0);
  } catch {
    /* ignore: the next gesture tries again */
  }
}

/** Suspend output while the page is hidden (no droning rumble in a background tab); resume when shown. */
export function pauseCore(paused: boolean): void {
  if (!core || testMode) return;
  const ctx = core.ctx as AudioContext;
  try {
    const st = ctx.state as string;
    if (paused) {
      if (st === "running") void ctx.suspend().catch(() => undefined);
    } else if (st === "suspended" || st === "interrupted") {
      resumeAskedAt = performance.now();
      void ctx.resume().catch(() => undefined);
    }
  } catch {
    /* ignore */
  }
}

/** Glide a gain to `to` (τ 30 ms): the sliders preview live without zipper noise. */
function glide(p: AudioParam, to: number, ctx: BaseAudioContext, tau = 0.03): void {
  const now = ctx.currentTime;
  p.cancelScheduledValues(now);
  p.setValueAtTime(p.value, now);
  p.setTargetAtTime(to, now, tau);
}

/** The master («Громкость») and the sound switch. */
export function setVolumeCore(v: number, on: boolean): void {
  volume = clamp01(v);
  enabled = on;
  if (!core) return;
  glide(core.master.gain, on ? volumeGain(volume) : 0, core.ctx, on ? 0.03 : 0.012);
}

/** v3 (AUD-3): settings.sfxVolume 0..1 («Эффекты»): the effects bus, their reverb sends and the world input. */
export function setSfxVolumeCore(v: number): void {
  sfxVolume = clamp01(v);
  if (!core) return;
  const g = volumeGain(sfxVolume);
  glide(core.fx.gain, g, core.ctx);
  glide(core.verb.gain, g, core.ctx);
  glide(core.world.gain, g, core.ctx);
}

/** v3 (AUD-3): settings.music 0..1 («Музыка»): the music bus level (nothing is built while it is 0). */
export function setMusicCore(v: number): void {
  musicVolume = clamp01(v);
  if (core?.musicLevel) glide(core.musicLevel.gain, volumeGain(musicVolume), core.ctx, 0.05);
}

/** The music bus of this core, built on first use (music → musicLevel → musicDuck → shelf, plus a reverb send). */
export function musicBus(c: Core): { music: GainNode; musicLevel: GainNode; musicDuck: GainNode } {
  if (!c.music || !c.musicLevel || !c.musicDuck) {
    const ctx = c.ctx;
    const music = ctx.createGain();
    const musicLevel = ctx.createGain();
    musicLevel.gain.value = volumeGain(musicVolume);
    const musicDuck = ctx.createGain();
    const send = ctx.createGain();
    send.gain.value = MUSIC_SEND;
    music.connect(musicLevel);
    musicLevel.connect(musicDuck);
    musicDuck.connect(c.shelf);
    // after the fade, so a close-up silences the tail's input as well
    musicDuck.connect(send);
    send.connect(c.room);
    c.music = music;
    c.musicLevel = musicLevel;
    c.musicDuck = musicDuck;
  }
  return { music: c.music, musicLevel: c.musicLevel, musicDuck: c.musicDuck };
}

/** settings.ambience 0..1: the background bus level (master volume still applies after it). */
export function setAmbienceCore(v: number): void {
  ambVolume = clamp01(v);
  if (!core) return;
  const g = core.ambLevel.gain;
  const now = core.ctx.currentTime;
  g.cancelScheduledValues(now);
  g.setValueAtTime(g.value, now);
  g.setTargetAtTime(ambienceGain(ambVolume), now, 0.04);
}

const ambDuckLevel = (): number => (ambCeremony ? AMB_CEREMONY : ambDucked ? AMB_DUCK : 1);

/** Ramp the ambience duck to its level: down over 0.4 s, back up over 1.5 s. */
function applyAmbDuck(down: boolean): void {
  if (!core) return;
  const g = core.ambDuck.gain;
  const now = core.ctx.currentTime;
  const cur = g.value;
  g.cancelScheduledValues(now);
  g.setValueAtTime(cur, now);
  g.linearRampToValueAtTime(ambDuckLevel(), now + (down ? 0.4 : 1.5));
}

/** Duck the ambience −9 dB over 0.4 s while a close-up is on screen; back up over 1.5 s afterwards. */
export function duckAmbienceCore(on: boolean): void {
  if (on === ambDucked) return;
  ambDucked = on;
  applyAmbDuck(on);
}

/** v3: the ambience sits −15 dB down while a ceremony is open (the coronation show, the migration card). */
export function ceremonyAmbienceCore(on: boolean): void {
  if (on === ambCeremony) return;
  ambCeremony = on;
  applyAmbDuck(on);
}

/** A close-up scene is on screen (AudioDirector's ambience state): coins in a scene duck the world bus. */
export function sceneUp(): boolean {
  return ambDucked;
}

/**
 * v3 (AUD-1, K1/K2): the game is held (a ceremony, a crash, a save issue). Every new voice is dropped except the
 * ceremony's own (`prio: "ceremony"`) and the ambience bus (which its driver ducks or stops); loops.ts parks the
 * rumble and the chuff separately (holdLoops).
 */
export function setHoldCore(on: boolean): void {
  held = on;
}

export function heldCore(): boolean {
  return held;
}

/** Dip the world bus −4 dB at `t` (τ 4 ms), back to unity from t + 60 ms (τ 120 ms); a retrigger restarts it. */
function duckWorld(c: Core, t: number): void {
  const g = c.worldDuck.gain;
  const now = c.ctx.currentTime;
  const cur = g.value;
  g.cancelScheduledValues(now);
  g.setValueAtTime(cur, now);
  g.setTargetAtTime(WORLD_DUCK, Math.max(now, t), 0.004);
  g.setTargetAtTime(1, Math.max(now, t) + 0.06, 0.12);
}

/**
 * The core when sounds may be scheduled right now (unlocked, running, the sound switch on, the master above zero),
 * else null. «Эффекты», «Фон» and «Музыка» gate their own voices (play(), ambienceLive(), musicLive()).
 */
export function live(): Core | null {
  if (!core) return null;
  if (!enabled || volume <= OFF) return null;
  if (testMode) return core;
  const st = core.ctx.state;
  if (st === "running") return core;
  if (st === "suspended" && performance.now() - resumeAskedAt < RESUME_GRACE_MS) return core;
  return null;
}

/** live(), and the ambience slider is above zero. */
export function ambienceLive(): Core | null {
  const c = live();
  return c && ambVolume > OFF ? c : null;
}

/** v3: live(), and the music slider is above zero (at zero the music builds nothing). */
export function musicLive(): Core | null {
  const c = live();
  return c && musicVolume > OFF ? c : null;
}

/** v3: live(), and «Эффекты» is above zero (the rumble and the chuff build nothing while it is 0). */
export function fxLive(): Core | null {
  const c = live();
  return c && sfxVolume > OFF ? c : null;
}

/** Milliseconds for throttling; in test mode the audio clock, so an offline render can step through time. */
export function clockMs(): number {
  return testMode && core ? core.ctx.currentTime * 1000 : performance.now();
}

/** Voices sounding right now (test reports). */
export function voicesNow(): number {
  return voiceCount;
}

/** Test harness only: render the synth into an offline context (src/audio/testing/offlineCtx.ts). */
export function attachForTest(ctx: BaseAudioContext): void {
  testMode = true;
  held = false;
  ambDucked = false;
  ambCeremony = false;
  core = build(ctx);
  gates.clear();
  voiceCount = 0;
}

/** Test harness only: the context is back to "running" (what ctx.onstatechange does in a browser). */
export function runningForTest(): void {
  contextRunning();
}

/** Test reports: how many voices this sound key has started since attachForTest. */
export function startsOf(key: string): number {
  return gates.get(key)?.count ?? 0;
}

/* ------------------------------------------------------------------ graph */

function build(ctx: BaseAudioContext): Core {
  // last-resort brick wall so stacked events at 100% volume never clip the speakers
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -2;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.1;
  limiter.connect(ctx.destination);

  const master = ctx.createGain();
  master.gain.value = enabled ? volumeGain(volume) : 0;
  master.connect(limiter);

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = COMP.threshold;
  comp.knee.value = COMP.knee;
  comp.ratio.value = COMP.ratio;
  comp.attack.value = COMP.attack;
  comp.release.value = COMP.release;
  comp.connect(master);

  const shelf = ctx.createBiquadFilter();
  shelf.type = "highshelf";
  shelf.frequency.value = 6500;
  shelf.gain.value = -4;
  shelf.connect(comp);

  // «Эффекты» (v3): the dry bus, the effects' reverb sends and the world input all follow curve(sfxVolume)
  const fxGain = volumeGain(sfxVolume);
  const bus = ctx.createGain();
  bus.gain.value = BUS_TRIM;
  const fx = ctx.createGain();
  fx.gain.value = fxGain;
  bus.connect(fx);
  fx.connect(shelf);

  const room = ctx.createGain();
  const conv = ctx.createConvolver();
  conv.normalize = true;
  conv.buffer = impulse(ctx, 1.7);
  const ret = ctx.createGain();
  ret.gain.value = 0.5;
  room.connect(conv);
  conv.connect(ret);
  ret.connect(shelf);
  const verb = ctx.createGain();
  verb.gain.value = fxGain;
  verb.connect(room);

  // world bus (v3): the big, continuous sounds of the tunnel. The reverb send is taken before the duck, so a
  // foreground dip only thins the dry signal and the tail carries on
  const world = ctx.createGain();
  world.gain.value = fxGain;
  const worldMix = ctx.createGain();
  const worldDuck = ctx.createGain();
  const worldSend = ctx.createGain();
  worldSend.gain.value = WORLD_SEND;
  world.connect(worldMix);
  worldMix.connect(worldDuck);
  worldDuck.connect(shelf);
  worldMix.connect(worldSend);
  worldSend.connect(room);

  // ambience bus: its own level and duck, then the world mix (its dip, tone, compression, master) like the train but
  // past «Эффекты»; the reverb sends are taken after both, so «Фон» at 0 silences the tails as well (0.1 + 0.3)
  const amb = ctx.createGain();
  amb.gain.value = AMB_TRIM;
  const ambLevel = ctx.createGain();
  ambLevel.gain.value = ambienceGain(ambVolume);
  const ambDuck = ctx.createGain();
  ambDuck.gain.value = ambDuckLevel();
  const ambSend = ctx.createGain();
  ambSend.gain.value = 0.4 - WORLD_SEND;
  amb.connect(ambLevel);
  ambLevel.connect(ambDuck);
  ambDuck.connect(worldMix);
  ambDuck.connect(ambSend);
  ambSend.connect(room);

  return {
    ctx,
    bus,
    fx,
    verb,
    room,
    shelf,
    master,
    noise: { white: noiseBuffer(ctx, "white", 2), pink: noiseBuffer(ctx, "pink", 4), brown: noiseBuffer(ctx, "brown", 4) },
    amb,
    ambLevel,
    ambDuck,
    world,
    worldMix,
    worldDuck,
  };
}

/** Stereo room impulse: a few early reflections off brick, then a tail that darkens as it decays. */
function impulse(ctx: BaseAudioContext, sec: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * sec);
  const pre = Math.floor(rate * 0.011);
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const x = i / len;
      const k = 0.8 - 0.68 * x;
      lp += k * (Math.random() * 2 - 1 - lp);
      d[i] = lp * Math.pow(1 - x, 3.4);
    }
    for (let r = 0; r < 6; r++) {
      const at = pre + Math.floor(rate * (0.008 + Math.random() * 0.05));
      if (at < len) d[at] += (Math.random() < 0.5 ? -1 : 1) * (0.5 - r * 0.06);
    }
  }
  return buf;
}

/** Loopable noise (pink/brown get a crossfaded seam so long loops never click). */
function noiseBuffer(ctx: BaseAudioContext, kind: NoiseKind, sec: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * sec);
  const fade = kind === "white" ? 0 : Math.floor(ctx.sampleRate * 0.05);
  const raw = new Float32Array(len + fade);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let br = 0;
  let sum = 0;
  for (let i = 0; i < raw.length; i++) {
    const w = Math.random() * 2 - 1;
    let v: number;
    if (kind === "white") v = w;
    else if (kind === "pink") {
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      v = b0 + b1 + b2 + w * 0.1848;
    } else {
      br = (br + 0.02 * w) / 1.02;
      v = br;
    }
    raw[i] = v;
    sum += v;
  }
  const mean = sum / raw.length;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = raw[i] - mean;
  // seam: the head fades in while the overflow tail fades out, so d[len-1] → d[0] is continuous
  for (let j = 0; j < fade; j++) {
    const k = j / fade;
    d[j] = (raw[j] - mean) * k + (raw[len + j] - mean) * (1 - k);
  }
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]));
  const s = peak > 0 ? 0.95 / peak : 1;
  for (let i = 0; i < len; i++) d[i] *= s;
  return buf;
}

/* ----------------------------------------------------------------- voices */

export interface VoiceOpts {
  /** Output gain of the whole voice. */
  gain?: number;
  /** Stereo position −1..1. */
  pan?: number;
  /** Reverb send amount. */
  send?: number;
  /** Start this many seconds from now. */
  delay?: number;
  /** Absolute start time on the context clock (overrides delay). */
  at?: number;
  /**
   * "amb": play on the ambience bus (its level, duck and reverb) instead of the effects bus; leave `send` unset.
   * "world" (v3): the world bus (giant steps, the chuff): its reverb send and the foreground dip; usually no `send`.
   * "music" (v3 AUD-3): the music bus (its level, fade and reverb); leave `send` unset.
   */
  bus?: "amb" | "world" | "music";
  /** v3: a foreground event — the world bus dips −4 dB under it (catch blips, ouch, bump, a coin in a scene…). */
  fg?: boolean;
  /** v3: "ceremony" voices still sound while the game is held (the coronation bells, the migration, crown ticks). */
  prio?: "ceremony";
}

/** One sound call: owns its nodes and disconnects them all when its last source ends. */
export class Voice {
  readonly c: Core;
  readonly ctx: BaseAudioContext;
  /** Start time on the context clock. */
  readonly t: number;
  readonly out: GainNode;
  /** Latest stop time of any source. */
  end: number;
  sources = 0;
  private nodes: AudioNode[] = [];
  /** Its sources (cut() stops them early). */
  private srcs: AudioScheduledSourceNode[] = [];
  private pending = 0;
  private done = false;

  constructor(c: Core, o: VoiceOpts = {}) {
    this.c = c;
    this.ctx = c.ctx;
    this.t = o.at ?? c.ctx.currentTime + 0.006 + (o.delay ?? 0);
    this.end = this.t;
    this.out = c.ctx.createGain();
    this.out.gain.value = o.gain ?? 1;
    let tail: AudioNode = this.out;
    if (o.pan) {
      const p = c.ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, o.pan));
      this.out.connect(p);
      this.nodes.push(p);
      tail = p;
    }
    tail.connect(o.bus === "amb" ? c.amb : o.bus === "world" ? c.world : o.bus === "music" ? musicBus(c).music : c.bus);
    if (o.send) {
      const s = c.ctx.createGain();
      s.gain.value = o.send;
      tail.connect(s);
      s.connect(c.verb);
      this.nodes.push(s);
    }
    voiceCount++;
  }

  /** Register a node for cleanup. */
  keep<T extends AudioNode>(n: T): T {
    this.nodes.push(n);
    return n;
  }

  /** Start/stop a source and track it; the voice cleans up after the last one ends. */
  run(src: AudioScheduledSourceNode, t0: number, t1: number, offset?: number): void {
    this.nodes.push(src);
    this.srcs.push(src);
    this.pending++;
    this.sources++;
    src.onended = () => {
      this.pending--;
      if (this.pending <= 0) this.dispose();
    };
    if (offset !== undefined && src instanceof AudioBufferSourceNode) src.start(t0, Math.max(0, offset));
    else src.start(t0);
    src.stop(t1);
    if (t1 > this.end) this.end = t1;
  }

  /**
   * Cut the voice short (cutKey): its output fades to nothing over CUT_FADE from now and every source stops then,
   * strikes still to come included, so the voice ends and disposes through its sources' onended like any other (on
   * the audio clock: no timer, the offline bench included).
   */
  cut(): void {
    if (this.done) return;
    const now = this.ctx.currentTime;
    const g = this.out.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + CUT_FADE);
    const stop = now + CUT_FADE + 0.005;
    for (const s of this.srcs) {
      try {
        s.stop(stop);
      } catch {
        /* already gone */
      }
    }
    if (this.end > stop) this.end = stop;
  }

  dispose(): void {
    if (this.done) return;
    this.done = true;
    voiceCount--;
    for (const n of this.nodes) {
      try {
        n.disconnect();
      } catch {
        /* already disconnected */
      }
    }
    try {
      this.out.disconnect();
    } catch {
      /* already disconnected */
    }
    this.nodes.length = 0;
    this.srcs.length = 0;
  }
}

export interface Limits {
  /** Max overlapping voices of this sound (default 12). */
  max?: number;
  /** Min real-time gap between starts. */
  gapMs?: number;
  /** Max starts per rolling second. */
  perSec?: number;
  /** Skip while this many voices already sound (background sounds leave room for gameplay). */
  yieldAt?: number;
}

interface Gate {
  last: number;
  ends: number[];
  starts: number[];
  /** Voices started (test reports). */
  count: number;
  /** Its voices that may still sound (cutKey). */
  live: Voice[];
}
const gates = new Map<string, Gate>();

/**
 * Cut every voice of `key` still sounding (a 60 ms fade, then its sources stop and its nodes go) and reset its
 * limiter, so the next play() of it starts at once: a restarted sequence (the coronation's «Полная церемония ›»).
 */
export function cutKey(key: string): void {
  const g = gates.get(key);
  if (!g) return;
  for (const v of g.live) v.cut();
  g.live = [];
  g.ends = [];
  g.starts = [];
  g.last = -Infinity;
}

let playWarned = false;

/**
 * Play one sound: throttled per `key`, a no-op before unlock / when muted / while held (unless a ceremony voice);
 * v3: effects voices skip while «Эффекты» is at 0, music voices while «Музыка» is (the ambience has its own gate).
 * `build` schedules sources on the voice starting at `v.t`. Never throws: a failing voice (its builder, or the
 * nodes of a broken context) is dropped and logged once, so the other Fx listeners still hear about the event.
 */
export function play(key: string, lim: Limits, opts: VoiceOpts, build: (v: Voice) => void): void {
  let v: Voice | null = null;
  try {
    const c = live();
    if (!c || voiceCount >= MAX_VOICES) return;
    if (opts.bus === "music" ? musicVolume <= OFF : opts.bus !== "amb" && sfxVolume <= OFF) return;
    if (held && opts.prio !== "ceremony" && opts.bus !== "amb") return;
    if (lim.yieldAt !== undefined && voiceCount >= lim.yieldAt) return;
    let g = gates.get(key);
    if (!g) {
      g = { last: -Infinity, ends: [], starts: [], count: 0, live: [] };
      gates.set(key, g);
    }
    const nowMs = clockMs();
    if (lim.gapMs && nowMs - g.last < lim.gapMs) return;
    const now = c.ctx.currentTime;
    g.ends = g.ends.filter((e) => e > now);
    if (g.ends.length >= (lim.max ?? 12)) return;
    if (lim.perSec) {
      g.starts = g.starts.filter((s) => nowMs - s < 1000);
      if (g.starts.length >= lim.perSec) return;
    }
    v = new Voice(c, opts);
    build(v);
    if (v.sources === 0) {
      v.dispose();
      return;
    }
    g.last = nowMs;
    g.ends.push(v.end);
    g.live = g.live.filter((x) => x.end > now);
    g.live.push(v);
    g.count++;
    if (lim.perSec) g.starts.push(nowMs);
    if (opts.fg) duckWorld(c, v.t);
  } catch (e) {
    v?.dispose();
    if (!playWarned && !testMode) {
      playWarned = true;
      console.warn(`[audio] the "${key}" voice failed; it is skipped`, e);
    }
  }
}
