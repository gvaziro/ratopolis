/**
 * Background soundscape on the ambience bus (settings.ambience × master; −9 dB under close-ups; suspended with the
 * rest of the output by pauseCore). A brown-noise room tone is always there; each open zone adds a layer, faded in
 * over 3 s: the sewer trickle (+ drips), the cellar clock (once a clock tower ticks), far Metro trains, the
 * Terminal crowd. Machinery pulses thicken with the colony (density = min(1, building levels / 150)).
 * Loops are persistent nodes (like the train rumble); one-shots are ordinary throttled voices scheduled ahead on
 * the audio clock, so the voice caps hold and they yield to gameplay sounds when the mix is busy.
 */
import { ambienceLive, clockMs, play, type Core, type Limits } from "./core";
import { thudAt, woodTok } from "./instruments";
import { filter, noise, pick, rnd, tone } from "./synth";

export interface AmbienceState {
  sewers: boolean;
  cellars: boolean;
  metro: boolean;
  terminal: boolean;
  /** buildings.clocktower > 0: the cellar clock ticks. */
  clock: boolean;
  /** Machinery density 0..1. */
  density: number;
  /** A close-up is on screen: sfx.ambience() ducks the bus −9 dB; drips and far trains wait. */
  duck: boolean;
}

const want: AmbienceState = { sewers: false, cellars: false, metro: false, terminal: false, clock: false, density: 0, duck: false };

/** Seconds a newly opened layer takes to fade in. */
const FADE_IN = 3;
/** Scheduler period (ms) and how far ahead (s) one-shots are placed on the audio clock. */
const TICK_MS = 120;
const LOOKAHEAD = 0.4;
/** Background one-shots skip while this many voices already sound. */
const YIELD = 40;
/** −24 dB: the machinery sits well under the clicks. */
const MACHINE_GAIN = Math.pow(10, -24 / 20);
/** Machinery grid (s) and the chance of a pulse on each beat at density 1. */
const MACHINE_BEAT = 0.5;
const MACHINE_PATTERN = [0.9, 0.2, 0.55, 0.25, 0.8, 0.2, 0.6, 0.35] as const;

/* ------------------------------------------------------------------ loops */

interface Loop {
  c: Core;
  out: GainNode;
  srcs: AudioScheduledSourceNode[];
  nodes: AudioNode[];
  /** Context time after which a fading-out loop is torn down. */
  killAt: number;
}

type LoopId = "room" | "trickle" | "murmur";
const loops: Partial<Record<LoopId, Loop>> = {};

function newLoop(c: Core): Loop {
  const out = c.ctx.createGain();
  const now = c.ctx.currentTime;
  out.gain.setValueAtTime(0, now);
  out.gain.linearRampToValueAtTime(1, now + FADE_IN);
  out.connect(c.amb);
  return { c, out, srcs: [], nodes: [out], killAt: Infinity };
}

function loopNoise(L: Loop, kind: "pink" | "brown"): AudioBufferSourceNode {
  const src = L.c.ctx.createBufferSource();
  src.buffer = L.c.noise[kind];
  src.loop = true;
  L.srcs.push(src);
  L.nodes.push(src);
  return src;
}

function loopNode<T extends AudioNode>(L: Loop, n: T): T {
  L.nodes.push(n);
  return n;
}

function biquad(L: Loop, type: BiquadFilterType, f: number, q: number): BiquadFilterNode {
  const b = loopNode(L, L.c.ctx.createBiquadFilter());
  b.type = type;
  b.frequency.value = f;
  b.Q.value = q;
  return b;
}

function gainNode(L: Loop, g: number): GainNode {
  const n = loopNode(L, L.c.ctx.createGain());
  n.gain.value = g;
  return n;
}

/** A sine LFO of `rate` Hz and `depth` added onto `param`. */
function lfo(L: Loop, rate: number, depth: number, param: AudioParam): void {
  const o = L.c.ctx.createOscillator();
  o.frequency.value = rate;
  const amt = gainNode(L, depth);
  o.connect(amt);
  amt.connect(param);
  L.srcs.push(o);
  L.nodes.push(o);
}

function startLoop(L: Loop): void {
  const t = L.c.ctx.currentTime;
  for (const s of L.srcs) {
    if (s instanceof AudioBufferSourceNode) s.start(t, Math.random() * 3);
    else s.start(t);
  }
}

/** Room tone: looped brown noise under 220 Hz, about −29 dB. */
function buildRoom(c: Core): Loop {
  const L = newLoop(c);
  const src = loopNoise(L, "brown");
  const lp = biquad(L, "lowpass", 220, 0.7);
  const g = gainNode(L, 0.035);
  src.connect(lp);
  lp.connect(g);
  g.connect(L.out);
  return L;
}

/** Sewers: pink noise through a 900 Hz band that swells and wanders on a slow 0.13 Hz LFO — water in the culvert. */
function buildTrickle(c: Core): Loop {
  const L = newLoop(c);
  const src = loopNoise(L, "pink");
  const bp = biquad(L, "bandpass", 900, 1.1);
  const g = gainNode(L, 0.11);
  src.connect(bp);
  bp.connect(g);
  g.connect(L.out);
  lfo(L, 0.13, 0.05, g.gain);
  lfo(L, 0.13 * 0.71, 160, bp.frequency);
  return L;
}

/** Terminal: a crowd murmur — pink noise in a 400 Hz band, three voices each on its own detuned AM LFO, spread wide. */
function buildMurmur(c: Core): Loop {
  const L = newLoop(c);
  const sum = gainNode(L, 0.1);
  sum.connect(L.out);
  const voices: [number, number, number][] = [
    // band centre, AM rate (Hz), pan
    [380, 2.3, -0.55],
    [420, 3.1, 0],
    [470, 3.9, 0.55],
  ];
  for (const [f, rate, pan] of voices) {
    const src = loopNoise(L, "pink");
    const bp = biquad(L, "bandpass", f, 1.2);
    const am = gainNode(L, 0.55);
    const p = loopNode(L, c.ctx.createStereoPanner());
    p.pan.value = pan;
    src.connect(bp);
    bp.connect(am);
    am.connect(p);
    p.connect(sum);
    lfo(L, rate, 0.4, am.gain);
  }
  return L;
}

const BUILDERS: Record<LoopId, (c: Core) => Loop> = { room: buildRoom, trickle: buildTrickle, murmur: buildMurmur };

function destroyLoop(id: LoopId): void {
  const L = loops[id];
  if (!L) return;
  delete loops[id];
  for (const s of L.srcs) {
    try {
      s.stop();
    } catch {
      /* not started / already stopped */
    }
  }
  for (const n of L.nodes) {
    try {
      n.disconnect();
    } catch {
      /* ignore */
    }
  }
}

function fadeOutLoop(L: Loop): void {
  if (L.killAt !== Infinity) return;
  const g = L.out.gain;
  const now = L.c.ctx.currentTime;
  g.cancelScheduledValues(now);
  g.setValueAtTime(g.value, now);
  g.setTargetAtTime(0, now, 0.4);
  L.killAt = now + 2.2;
}

function syncLoop(c: Core, id: LoopId, on: boolean): void {
  const L = loops[id];
  if (on) {
    if (L && L.killAt !== Infinity) destroyLoop(id); // was fading out: start over with a fresh fade-in
    if (!loops[id]) {
      const n = BUILDERS[id](c);
      startLoop(n);
      loops[id] = n;
    }
  } else if (L) {
    if (c.ctx.currentTime >= L.killAt) destroyLoop(id);
    else fadeOutLoop(L);
  }
}

/* --------------------------------------------------------------- one-shots */

type ShotLayer = "drips" | "clock" | "trains" | "machinery";
/** Context time each one-shot layer came on (null = off): for its fade-in and first event. */
const since: Record<ShotLayer, number | null> = { drips: null, clock: null, trains: null, machinery: null };
let dripNext = 0;
let clockNext = 0;
let clockBeat = 0;
let trainNext = 0;
let machNext = 0;
let machBeat = 0;

const fadeIn = (layer: ShotLayer, t: number): number => {
  const s = since[layer];
  return s === null ? 0 : Math.max(0.05, Math.min(1, (t - s) / FADE_IN));
};

function shot(key: string, lim: Limits, t: number, gain: number, pan: number, build: Parameters<typeof play>[3]): void {
  play(key, { yieldAt: YIELD, ...lim }, { at: t, gain, pan, bus: "amb" }, build);
}

/** One water drip in the culvert. */
function dripAt(t: number, level: number): void {
  shot("ambDrip", { max: 2 }, t, 0.8 * level, rnd(-0.6, 0.6), (v) => {
    const f = rnd(850, 1350);
    tone(v, { f, to: f * 1.9, glide: 0.028, t: v.t, a: 0.001, d: 0.07, peak: 0.09 });
  });
}

/** The cellar clock: tick, tock. */
function clockAt(t: number, beat: number, level: number): void {
  const tock = beat % 2 === 1;
  shot("ambClock", { max: 3 }, t, 0.08 * level, tock ? 0.18 : 0.12, (v) => {
    const k = tock ? 0.84 : 1;
    tone(v, { f: 2350 * k, t: v.t, a: 0.0008, d: 0.022, peak: 0.22 });
    tone(v, { type: "triangle", f: 1180 * k, t: v.t, a: 0.001, d: 0.03, peak: 0.12 });
    noise(v, { t: v.t, a: 0.0005, d: 0.01, peak: 0.12, filter: "bandpass", f: 3600 * k, q: 1.6 });
  });
}

/** One machinery pulse: a low "тук" on strong beats, a wooden "tok" between. */
function machineAt(t: number, beat: number, level: number): void {
  const strong = beat % 4 === 0;
  shot("ambMachine", { max: 4 }, t, MACHINE_GAIN * level, rnd(-0.5, 0.5), (v) => {
    if (strong) thudAt(v, v.t, rnd(0.9, 1.0), 1);
    else woodTok(v, v.t, pick([0.6, 0.67, 0.75] as const) * rnd(0.99, 1.01), 1);
  });
}

/**
 * A train far down the Metro tunnels: the rumble's 'train' character at intensity 0.15 under a 120 Hz lowpass
 * (with its 220 Hz overtone band so small speakers hear it) swelling over ~12 s; now and then a faint whistle.
 */
function farTrainAt(t: number): void {
  shot("ambTrain", { max: 1 }, t, 1, rnd(-0.4, 0.4), (v) => {
    const ctx = v.ctx;
    const t0 = v.t;
    const rise = 5;
    const hold = 1.5;
    const fall = 6;
    const env = v.keep(ctx.createGain());
    env.connect(v.out);
    // KINDS.train.level × 0.15^1.3
    const peak = 0.62 * Math.pow(0.15, 1.3);
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(peak, t0 + rise);
    env.gain.setValueAtTime(peak, t0 + rise + hold);
    env.gain.linearRampToValueAtTime(0, t0 + rise + hold + fall);
    const end = t0 + rise + hold + fall + 0.05;
    const brown = ctx.createBufferSource();
    brown.buffer = v.c.noise.brown;
    brown.loop = true;
    const body = v.keep(ctx.createGain());
    body.gain.value = 0.6;
    body.connect(env);
    const lp = filter(v, "lowpass", 120, 0.7, body);
    brown.connect(lp);
    const harm = v.keep(ctx.createGain());
    harm.gain.value = 0.35;
    harm.connect(env);
    brown.connect(filter(v, "bandpass", 220, 0.8, harm));
    v.run(brown, t0, end, Math.random() * 3);
    // the rattle of a distant train, barely there
    noise(v, { kind: "pink", t: t0, a: rise, hold, d: fall, peak: 0.35, filter: "bandpass", f: 420, q: 1.3, dest: env });
    if (Math.random() < 0.35) {
      const wt = t0 + rise + rnd(-0.5, 0.8);
      const lpw = filter(v, "lowpass", 1300, 0.7);
      tone(v, { f: 880 * 0.96, to: 880, glide: 0.1, t: wt, a: 0.12, hold: 0.7, d: 0.5, peak: 0.012, dest: lpw });
    }
  });
}

function layer(id: ShotLayer, on: boolean, now: number): boolean {
  if (!on) {
    since[id] = null;
    return false;
  }
  if (since[id] === null) {
    since[id] = now;
    if (id === "drips") dripNext = now + rnd(2, 5);
    if (id === "clock") clockNext = Math.ceil(now + 0.05);
    if (id === "trains") trainNext = now + rnd(15, 35);
    if (id === "machinery") machNext = Math.ceil(now / MACHINE_BEAT) * MACHINE_BEAT;
  }
  return true;
}

function scheduleShots(now: number): void {
  const horizon = now + LOOKAHEAD;
  // a throttled/suspended stretch: never fire a backlog, just pick up from now
  const catchUp = (next: number, period: number) => (next < now - 0.25 ? Math.ceil(now / period) * period : next);

  if (layer("drips", want.sewers, now)) {
    if (dripNext < now - 0.25) dripNext = now + rnd(1, 4);
    while (dripNext < horizon) {
      const t = dripNext;
      if (!want.duck) {
        const lv = fadeIn("drips", t);
        dripAt(t, lv);
        // now and then a second drop follows the first
        if (Math.random() < 0.25) dripAt(t + rnd(0.18, 0.44), lv * 0.8);
      }
      dripNext = t + rnd(3.5, 10);
    }
  }

  if (layer("clock", want.cellars && want.clock, now)) {
    clockNext = catchUp(clockNext, 1);
    while (clockNext < horizon) {
      clockAt(clockNext, clockBeat++, fadeIn("clock", clockNext));
      clockNext += 1;
    }
  }

  if (layer("trains", want.metro, now)) {
    if (trainNext < now - 0.25) trainNext = now + rnd(5, 15);
    while (trainNext < horizon) {
      if (want.duck) {
        trainNext += 8; // not over a close-up: try again a little later
        continue;
      }
      farTrainAt(trainNext);
      trainNext += rnd(40, 90);
    }
  }

  const density = Math.max(0, Math.min(1, Number.isFinite(want.density) ? want.density : 0));
  if (layer("machinery", density > 0.001, now)) {
    machNext = catchUp(machNext, MACHINE_BEAT);
    while (machNext < horizon) {
      const beat = machBeat++;
      if (Math.random() < density * MACHINE_PATTERN[beat % MACHINE_PATTERN.length]) machineAt(machNext, beat, fadeIn("machinery", machNext) * rnd(0.75, 1));
      machNext += MACHINE_BEAT;
    }
  }
}

/* --------------------------------------------------------------- driver */

let owner: Core | null = null;
let idleSince: number | null = null;
let timer = 0;

function destroyAll(): void {
  for (const id of Object.keys(loops) as LoopId[]) destroyLoop(id);
  for (const k of Object.keys(since) as ShotLayer[]) since[k] = null;
}

/** One scheduler step (runs every 120 ms; the offline test harness calls it directly while it steps the clock). */
export function ambienceTick(): void {
  const c = ambienceLive();
  if (!c) {
    // muted, «Фон» at 0, hidden tab (suspended) or not unlocked yet: after 3 s let the loops go
    if (idleSince === null) idleSince = clockMs();
    else if (clockMs() - idleSince > 3000 && Object.keys(loops).length > 0) destroyAll();
    // one-shot layers fade in again when the sound comes back
    for (const k of Object.keys(since) as ShotLayer[]) since[k] = null;
    return;
  }
  idleSince = null;
  if (owner !== c) {
    destroyAll();
    owner = c;
  }
  syncLoop(c, "room", true);
  syncLoop(c, "trickle", want.sewers);
  syncLoop(c, "murmur", want.terminal);
  scheduleShots(c.ctx.currentTime);
}

/** Update what the colony sounds like (AudioDirector calls this when the zones, the clock tower, buildings or scene change). */
export function ambienceSet(st: Partial<AmbienceState>): void {
  Object.assign(want, st);
  if (!timer && typeof window !== "undefined") timer = window.setInterval(ambienceTick, TICK_MS);
  ambienceTick();
}

/** A far Metro train right now, whatever the zones (previews and the offline test harness). */
export function ambienceFarTrain(): void {
  const c = ambienceLive();
  if (c) farTrainAt(c.ctx.currentTime + 0.05);
}

/** Stop the scheduler and tear the loops down (AudioDirector unmount). */
export function ambienceStop(): void {
  if (timer) clearInterval(timer);
  timer = 0;
  destroyAll();
  owner = null;
}
