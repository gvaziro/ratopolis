/**
 * Background soundscape on the ambience bus (settings.ambience × master; −9 dB under close-ups; suspended with the
 * rest of the output by pauseCore). A brown-noise room tone is always there; each open zone adds a layer, faded in
 * over 3 s: the sewer trickle (+ drips), the cellar clock (once a clock tower ticks), far Metro trains, the
 * Terminal crowd. Machinery pulses thicken with the colony (density = min(1, building levels / 150)).
 * Loops are persistent nodes (like the train rumble); one-shots are ordinary throttled voices scheduled ahead on
 * the audio clock, so the voice caps hold and they yield to gameplay sounds when the mix is busy.
 * v3 (AUD-2, K4): the steam economy is audible. The cellar clock drags when the presses and clocks run short of
 * steam (period 1 / max(0.35, steamEff), a little lower), a starved engine wheezes and its piston clunks every
 * 6–10 s below 70%, and steam wasted at the cap blows a safety valve every 12–20 s.
 * v3 (AUD-4): a rebalance, so every zone a laptop can hear. The far train gets the rumble's saturated overtones
 * (tanh → 220 Hz and 380 Hz bands) and a louder rattle; the machinery comes up to −17 dB with a mid "piston" on the
 * strong beats and a ratchet every 8 beats once the colony is busy; the sewer trickle steps down to 0.08 once the
 * Cellars open, and the Cellars get a layer of their own (a draught moaning down the coal chute, a barrel creaking now
 * and then). New: «Наверху», the world above the grate from minute one, on the humans' clock (AmbienceState.hour):
 * a cart over the grate every 25–60 s by day (rarely and quietly at night), the feet of the crowd in the rush hours
 * (8–9, 17–19), a muffled tower bell at noon and midnight; it waits while a close-up is on screen. The levels here
 * are before the bus's −1.5 dB trim (core AMB_TRIM), which keeps every layer at once ≤ −32 LUFS.
 */
import { ambienceLive, clockMs, play, type Core, type Limits } from "./core";
import { hoof, ratchet, TOWER_BELL, woodTok } from "./instruments";
import { filter, noise, pick, rnd, strike, tanhCurve, tone } from "./synth";

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
  /** v3: steam efficiency of the presses and clocks 0..1 (game.steamEff, quantised to 0.05; 1 when nothing uses steam). */
  steamEff: number;
  /** v3: the boiler's buffer has sat at its cap for over 5 s (steam wasted). */
  steamFull: boolean;
  /**
   * v3 (AUD-4): the humans' hour 0..23 (humanClock(g).hh) for «Наверху»: carts by day, the rush hours, the tower bell
   * at 12 and 0. Not a finite number: no world above (the test bench measures the zones without it).
   */
  hour: number;
}

const DEFAULT_STATE: AmbienceState = { sewers: false, cellars: false, metro: false, terminal: false, clock: false, density: 0, duck: false, steamEff: 1, steamFull: false, hour: 10 };
const want: AmbienceState = { ...DEFAULT_STATE };

/** Seconds a newly opened layer takes to fade in. */
const FADE_IN = 3;
/** Scheduler period (ms) and how far ahead (s) one-shots are placed on the audio clock. */
const TICK_MS = 120;
const LOOKAHEAD = 0.4;
/** Background one-shots skip while this many voices already sound. */
const YIELD = 40;
/** −17 dB (v2: −24): the machinery under the clicks, yet audible on a laptop. */
const MACHINE_GAIN = Math.pow(10, -17 / 20);
/** Machinery grid (s) and the chance of a pulse on each beat at density 1. */
const MACHINE_BEAT = 0.5;
const MACHINE_PATTERN = [0.9, 0.2, 0.55, 0.25, 0.8, 0.2, 0.6, 0.35] as const;
/** A busy colony (density above this) runs a gear ratchet every 8 beats, two beats long. */
const RATCHET_DENSITY = 0.5;
/** The sewer trickle (pink noise in a 900 Hz band) before and after the Cellars open. */
const TRICKLE = 0.11;
const TRICKLE_CELLARS = 0.08;
/** «Наверху»: a cart over the grate at −20 dB, the crowd's feet at −24 dB, the tower bell at −18 dB. */
const CART_GAIN = Math.pow(10, -20 / 20);
const FEET_GAIN = Math.pow(10, -24 / 20);
const BELL_GAIN = Math.pow(10, -18 / 20);
/** The tower bell's pitch (G2), its strikes and their spacing. */
const BELL_F = 98;
const BELL_STRIKES = 3;
const BELL_GAP = 2.2;
/** Hours the street is busy (carts every 25–60 s; at night every 90–180 s, half as loud) and the rush hours. */
const DAY_FROM = 5;
const DAY_TO = 21;
const RUSH = [8, 9, 17, 18, 19] as const;
/** The far train's saturated overtone band (the 380 Hz band sits at half). */
const FAR_HARM = 0.35;
/** The Cellars' draught, the Metro's vents and the Terminal's crowd: each zone ~1.5 LU over the last on a laptop. */
const DRAUGHT = 0.21;
const VENT = 0.17;
const MURMUR = 0.14;
/** The clock never drags slower than one tick per 1 / 0.35 ≈ 2.9 s. */
const CLOCK_MIN_EFF = 0.35;
/** Below this steam efficiency the engine wheezes. */
const WHEEZE_BELOW = 0.7;
/** −23 dB: the wheeze; −22 dB: the safety valve (v3 AUD-4: −1 / −2 dB, over a louder bed they still stand out). */
const WHEEZE_GAIN = Math.pow(10, -23 / 20);
const VALVE_GAIN = Math.pow(10, -22 / 20);

const steamEff = (): number => {
  const e = want.steamEff;
  return Number.isFinite(e) ? Math.max(0, Math.min(1, e)) : 1;
};

/* ------------------------------------------------------------------ loops */

interface Loop {
  c: Core;
  out: GainNode;
  srcs: AudioScheduledSourceNode[];
  nodes: AudioNode[];
  /** Context time after which a fading-out loop is torn down. */
  killAt: number;
  /** The loop's base level, where a layer steps it (the trickle once the Cellars open), and where it is heading. */
  level?: GainNode;
  target?: number;
}

type LoopId = "room" | "trickle" | "murmur" | "draught" | "vent";
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

/**
 * Sewers: pink noise through a 900 Hz band that swells and wanders on a slow 0.13 Hz LFO — water in the culvert.
 * v3: it steps down to 0.08 once the Cellars open (it was 85% of the late ambience), so the later layers stand out;
 * the swell (±30%; v2 ±45%) rides on its own gain, so it steps down with the level.
 */
function buildTrickle(c: Core): Loop {
  const L = newLoop(c);
  const src = loopNoise(L, "pink");
  const bp = biquad(L, "bandpass", 900, 1.1);
  const swell = gainNode(L, 1);
  const g = gainNode(L, want.cellars ? TRICKLE_CELLARS : TRICKLE);
  src.connect(bp);
  bp.connect(swell);
  swell.connect(g);
  g.connect(L.out);
  lfo(L, 0.13, 0.3, swell.gain);
  lfo(L, 0.13 * 0.71, 160, bp.frequency);
  L.level = g;
  L.target = g.gain.value;
  return L;
}

/**
 * v3 (AUD-4) Cellars: a draught breathing down the coal chute — pink noise through two hollow bands (460 and 740 Hz)
 * that drift on slow LFOs, swelling and dying every ~15–20 s.
 */
function buildDraught(c: Core): Loop {
  const L = newLoop(c);
  const g = gainNode(L, DRAUGHT);
  g.connect(L.out);
  for (const [f, q, lv, rate] of [
    [460, 1.6, 1, 0.05],
    [740, 2, 0.5, 0.067],
  ] as const) {
    const src = loopNoise(L, "pink");
    const bp = biquad(L, "bandpass", f, q);
    const amp = gainNode(L, lv * 0.65);
    src.connect(bp);
    bp.connect(amp);
    amp.connect(g);
    lfo(L, rate, lv * 0.2, amp.gain);
    lfo(L, rate * 0.63, f * 0.08, bp.frequency);
  }
  return L;
}

/**
 * v3 (AUD-4) Metro: the ventilation shafts breathe — pink noise in a 700 Hz band pumped by a slow 0.22 Hz bellows,
 * under the far trains (which only come by every minute or so).
 */
function buildVent(c: Core): Loop {
  const L = newLoop(c);
  const src = loopNoise(L, "pink");
  const bp = biquad(L, "bandpass", 700, 1.1);
  const am = gainNode(L, 0.6);
  const g = gainNode(L, VENT);
  src.connect(bp);
  bp.connect(am);
  am.connect(g);
  g.connect(L.out);
  lfo(L, 0.22, 0.22, am.gain);
  lfo(L, 0.22 * 0.5, 60, bp.frequency);
  return L;
}

/** Terminal: a crowd murmur — pink noise in a ~480 Hz band, three voices each on its own detuned AM LFO, spread wide. */
function buildMurmur(c: Core): Loop {
  const L = newLoop(c);
  const sum = gainNode(L, MURMUR);
  sum.connect(L.out);
  const voices: [number, number, number][] = [
    // band centre, AM rate (Hz), pan
    [430, 2.3, -0.55],
    [480, 3.1, 0],
    [540, 3.9, 0.55],
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
    lfo(L, rate, 0.3, am.gain);
  }
  return L;
}

const BUILDERS: Record<LoopId, (c: Core) => Loop> = { room: buildRoom, trickle: buildTrickle, murmur: buildMurmur, draught: buildDraught, vent: buildVent };

/** The trickle steps to its Cellars level over ~2 s (once per change). */
function trickleLevel(): void {
  const L = loops.trickle;
  if (!L?.level || L.killAt !== Infinity) return;
  const to = want.cellars ? TRICKLE_CELLARS : TRICKLE;
  if (L.target === to) return;
  L.target = to;
  const g = L.level.gain;
  const now = L.c.ctx.currentTime;
  g.cancelScheduledValues(now);
  g.setValueAtTime(g.value, now);
  g.linearRampToValueAtTime(to, now + 2);
}

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

type ShotLayer = "drips" | "clock" | "trains" | "machinery" | "wheeze" | "valve" | "creaks" | "carts" | "feet";
/** Context time each one-shot layer came on (null = off): for its fade-in and first event. */
const since: Record<ShotLayer, number | null> = { drips: null, clock: null, trains: null, machinery: null, wheeze: null, valve: null, creaks: null, carts: null, feet: null };
let dripNext = 0;
let clockNext = 0;
let clockBeat = 0;
let trainNext = 0;
let machNext = 0;
let machBeat = 0;
let wheezeNext = 0;
let valveNext = 0;
let creakNext = 0;
let cartNext = 0;
let feetNext = 0;
/** «Наверху»: the hour last seen (a change to 12 or 0 rings the bell), and a bell waiting for a close-up to end. */
let lastHour: number | null = null;
let bellDue = false;

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

/** The cellar clock: tick, tock (a little lower as the steam runs short: × 0.9 + 0.1·steamEff). */
function clockAt(t: number, beat: number, level: number): void {
  const tock = beat % 2 === 1;
  shot("ambClock", { max: 3 }, t, 0.08 * level, tock ? 0.18 : 0.12, (v) => {
    const k = (tock ? 0.84 : 1) * (0.9 + 0.1 * steamEff());
    tone(v, { f: 2350 * k, t: v.t, a: 0.0008, d: 0.022, peak: 0.22 });
    tone(v, { type: "triangle", f: 1180 * k, t: v.t, a: 0.001, d: 0.03, peak: 0.12 });
    noise(v, { t: v.t, a: 0.0005, d: 0.01, peak: 0.12, filter: "bandpass", f: 3600 * k, q: 1.6 });
  });
}

/**
 * One machinery pulse: a mid "piston" on strong beats (a low wooden tok and a 700 Hz chuff of air — v2's low "тук"
 * was lost on a laptop), a wooden "tok" between.
 */
function machineAt(t: number, beat: number, level: number): void {
  const strong = beat % 4 === 0;
  shot("ambMachine", { max: 4 }, t, MACHINE_GAIN * level, rnd(-0.5, 0.5), (v) => {
    if (strong) {
      woodTok(v, v.t, 0.5 * rnd(0.97, 1.03), 1.2);
      noise(v, { t: v.t + 0.004, a: 0.003, d: 0.04, peak: 0.16, filter: "bandpass", f: 700, q: 1.2 });
    } else woodTok(v, v.t, pick([0.6, 0.67, 0.75] as const) * rnd(0.99, 1.01), 1);
  });
}

/** A busy colony's gear ratchet: two beats of pawl clicks. */
function machineRatchetAt(t: number, level: number): void {
  shot("ambRatchet", { max: 1 }, t, MACHINE_GAIN * level, rnd(-0.4, 0.4), (v) => ratchet(v, v.t, 10, (2 * MACHINE_BEAT) / 10, 0.62, 1));
}

/** Cellars: a barrel creaks on its rack (a slow stick-slip saw through two wooden resonances). */
function creakAt(t: number, level: number): void {
  shot("ambCreak", { max: 1 }, t, 0.12 * level, rnd(-0.6, 0.6), (v) => {
    const ctx = v.ctx;
    const k = rnd(0.85, 1.15);
    const dur = rnd(0.35, 0.6);
    const amp = v.keep(ctx.createGain());
    amp.connect(v.out);
    amp.gain.setValueAtTime(0, v.t);
    amp.gain.linearRampToValueAtTime(0.5, v.t + 0.05);
    amp.gain.setValueAtTime(0.5, v.t + dur - 0.08);
    amp.gain.exponentialRampToValueAtTime(0.0001, v.t + dur);
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(22 * k, v.t);
    o.frequency.linearRampToValueAtTime(34 * k, v.t + dur * 0.6);
    o.frequency.linearRampToValueAtTime(26 * k, v.t + dur);
    o.connect(filter(v, "bandpass", 480 * k, 6, amp));
    o.connect(filter(v, "bandpass", 1150 * k, 8, amp));
    v.run(o, v.t, v.t + dur + 0.02);
  });
}

/* ------------------------------------------------------ «Наверху» (v3 AUD-4) */

/** A cart over the grate: 4–6 hoof pairs and the iron-shod wheels, through the ground, panning across from left to right. */
function cartAt(t: number, level: number): void {
  shot("ambCart", { max: 1 }, t, CART_GAIN * level, 0, (v) => {
    const ctx = v.ctx;
    const n = 4 + Math.floor(Math.random() * 3);
    const step = rnd(0.42, 0.52);
    const dur = n * step + 0.5;
    const sweep = v.keep(ctx.createStereoPanner());
    sweep.connect(v.out);
    sweep.pan.setValueAtTime(-0.6, v.t);
    sweep.pan.linearRampToValueAtTime(0.6, v.t + dur);
    const ground = filter(v, "lowpass", 1500, 0.7, sweep);
    for (let i = 0; i < n; i++) {
      // nearest in the middle of the pass
      const g = 0.55 + 0.45 * Math.sin((Math.PI * (i + 0.5)) / n);
      const at = v.t + i * step + rnd(-0.02, 0.02);
      hoof(v, at, 1.6 * g, ground);
      hoof(v, at + 0.12, 1.3 * g, ground, 0.88);
    }
    // the wheels on the cobbles: a rolling rumble with a grind a laptop hears
    noise(v, { kind: "brown", t: v.t, a: dur * 0.4, hold: dur * 0.2, d: dur * 0.4, peak: 0.9, filter: "lowpass", f: 500, dest: sweep });
    noise(v, { kind: "pink", t: v.t, a: dur * 0.4, hold: dur * 0.2, d: dur * 0.4, peak: 0.12, filter: "bandpass", f: 620, q: 1.4, dest: sweep });
  });
}

/** The rush hour: the crowd's feet crossing the grate (a scatter of steps over a murmur). */
function feetAt(t: number, level: number): void {
  shot("ambFeet", { max: 1 }, t, FEET_GAIN * level, rnd(-0.3, 0.3), (v) => {
    const dur = rnd(3, 4.5);
    const lp = filter(v, "lowpass", 1800, 0.7);
    const n = 12 + Math.floor(Math.random() * 6);
    for (let i = 0; i < n; i++) {
      const at = v.t + rnd(0, dur - 0.2);
      const k = rnd(0.8, 1.2);
      tone(v, { f: 260 * k, to: 170 * k, glide: 0.03, t: at, a: 0.002, d: 0.05, peak: 0.35, dest: lp });
      noise(v, { kind: "pink", t: at, a: 0.001, d: 0.03, peak: 0.25, filter: "bandpass", f: 1300 * k, q: 1.2, dest: lp });
    }
    noise(v, { kind: "pink", t: v.t, a: dur * 0.4, hold: dur * 0.2, d: dur * 0.4, peak: 0.3, filter: "bandpass", f: 450, q: 1, dest: lp });
  });
}

/** Noon or midnight: a tower bell somewhere above, three strikes 2.2 s apart, muffled by the street (600 Hz). */
function towerBellAt(t: number): void {
  shot("ambBell", { max: 1 }, t, BELL_GAIN, rnd(-0.3, 0.3), (v) => {
    const lp = filter(v, "lowpass", 600, 0.7);
    for (let i = 0; i < BELL_STRIKES; i++) strike(v, v.t + i * BELL_GAP, BELL_F, TOWER_BELL, 1.4, lp);
  });
}

const isDay = (h: number): boolean => h >= DAY_FROM && h <= DAY_TO;

/** A starved steam engine: a wheeze sinking 600 → 300 Hz, then the piston clunks to a stop. */
function wheezeAt(t: number, level: number): void {
  shot("ambWheeze", { max: 1 }, t, WHEEZE_GAIN * level, rnd(-0.4, 0.4), (v) => {
    noise(v, { kind: "pink", t: v.t, a: 0.15, d: 0.5, peak: 0.9, filter: "bandpass", f: 600, to: 300, q: 1.6 });
    woodTok(v, v.t + 0.62, 0.45, 1.6);
  });
}

/** Steam wasted at the cap: the safety valve lifts with a tiny pop and hisses (2.4 kHz, Q 3). */
function valveAt(t: number, level: number): void {
  shot("ambValve", { max: 1 }, t, VALVE_GAIN * level, rnd(-0.5, 0.5), (v) => {
    tone(v, { f: 1300, to: 500, glide: 0.025, t: v.t, a: 0.001, d: 0.03, peak: 0.25 });
    noise(v, { t: v.t + 0.01, a: 0.05, hold: 0.4, d: 0.3, peak: 0.7, filter: "bandpass", f: 2400, q: 3 });
  });
}

/**
 * A train far down the Metro tunnels: the rumble's 'train' character at intensity 0.15 under a 120 Hz lowpass
 * swelling over ~12 s; now and then a faint whistle. v3 (AUD-4): the rumble's saturated path (drive 3 → tanh 2.5 →
 * 220 Hz band, plus a 380 Hz band at half) so a laptop hears the train coming, and the rattle up from 0.35 to 0.6.
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
    // the v2 train level (0.62) × 0.15^1.3: the far train kept its loudness when the rumble went −3 dB (AUD-1)
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
    // the saturated low band, as loops.ts drives it: overtones at 220 and 380 Hz
    const harm = v.keep(ctx.createGain());
    harm.gain.value = FAR_HARM;
    harm.connect(env);
    const harm2 = v.keep(ctx.createGain());
    harm2.gain.value = FAR_HARM * 0.5;
    harm2.connect(env);
    const drive = v.keep(ctx.createGain());
    drive.gain.value = 3;
    const sat = v.keep(ctx.createWaveShaper());
    sat.curve = tanhCurve(2.5);
    drive.connect(sat);
    sat.connect(filter(v, "bandpass", 220, 0.8, harm));
    sat.connect(filter(v, "bandpass", 380, 0.9, harm2));
    brown.connect(filter(v, "lowpass", 150, 0.7, drive));
    v.run(brown, t0, end, Math.random() * 3);
    // the rattle of a distant train
    noise(v, { kind: "pink", t: t0, a: rise, hold, d: fall, peak: 0.6, filter: "bandpass", f: 420, q: 1.3, dest: env });
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
    if (id === "wheeze") wheezeNext = now + rnd(1, 3);
    if (id === "valve") valveNext = now + rnd(2, 8);
    if (id === "creaks") creakNext = now + rnd(8, 20);
    // the street is there from the first minute: the first cart soon
    if (id === "carts") cartNext = now + rnd(6, 15);
    if (id === "feet") feetNext = now + rnd(3, 10);
  }
  return true;
}

/** «Наверху»: carts, the rush hour's feet and the tower bell, on the humans' clock; all wait out a close-up. */
function scheduleAbove(now: number, horizon: number): void {
  const h = want.hour;
  const on = Number.isFinite(h);
  const hour = on ? ((Math.floor(h) % 24) + 24) % 24 : -1;
  if (on && lastHour !== null && hour !== lastHour && (hour === 12 || hour === 0)) bellDue = true;
  lastHour = on ? hour : null;
  if (!on) bellDue = false;
  if (bellDue && !want.duck) {
    bellDue = false;
    towerBellAt(now + 0.1);
  }

  if (layer("carts", on, now)) {
    if (cartNext < now - 0.25) cartNext = now + rnd(5, 15);
    const day = isDay(hour);
    while (cartNext < horizon) {
      if (want.duck) {
        cartNext += 8; // not over a close-up
        continue;
      }
      cartAt(cartNext, (day ? 1 : 0.5) * fadeIn("carts", cartNext));
      cartNext += day ? rnd(25, 60) : rnd(90, 180);
    }
  }

  if (layer("feet", on && (RUSH as readonly number[]).includes(hour), now)) {
    if (feetNext < now - 0.25) feetNext = now + rnd(3, 10);
    while (feetNext < horizon) {
      if (!want.duck) feetAt(feetNext, fadeIn("feet", feetNext));
      feetNext += rnd(12, 25);
    }
  }
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
    // short of steam the clock drags: one beat per 1 / max(0.35, steamEff) s
    const period = 1 / Math.max(CLOCK_MIN_EFF, steamEff());
    clockNext = catchUp(clockNext, period);
    // steam back: the clock picks up at once instead of waiting out a tick placed at the slow pace
    if (clockNext > now + period) clockNext = now + period;
    while (clockNext < horizon) {
      clockAt(clockNext, clockBeat++, fadeIn("clock", clockNext));
      clockNext += period;
    }
  }

  // the steam engine: wheezes when starved (presses and clocks short of steam), its valve hisses when steam is wasted
  if (layer("wheeze", steamEff() < WHEEZE_BELOW, now)) {
    if (wheezeNext < now - 0.25) wheezeNext = now + rnd(1, 3);
    while (wheezeNext < horizon) {
      if (!want.duck) wheezeAt(wheezeNext, 1);
      wheezeNext += rnd(6, 10);
    }
  }
  if (layer("valve", want.steamFull, now)) {
    if (valveNext < now - 0.25) valveNext = now + rnd(2, 8);
    while (valveNext < horizon) {
      if (!want.duck) valveAt(valveNext, 1);
      valveNext += rnd(12, 20);
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
      // a busy colony: a two-beat ratchet every 8 beats, between the strong beats
      if (density > RATCHET_DENSITY && beat % 8 === 5) machineRatchetAt(machNext, fadeIn("machinery", machNext));
      machNext += MACHINE_BEAT;
    }
  }

  // the Cellars: a barrel creaks on its rack now and then
  if (layer("creaks", want.cellars, now)) {
    if (creakNext < now - 0.25) creakNext = now + rnd(8, 20);
    while (creakNext < horizon) {
      if (!want.duck) creakAt(creakNext, fadeIn("creaks", creakNext));
      creakNext += rnd(25, 50);
    }
  }

  scheduleAbove(now, horizon);
}

/* --------------------------------------------------------------- driver */

let owner: Core | null = null;
let idleSince: number | null = null;
let timer = 0;
/** No colony to sound (before the first ambienceSet, after ambienceStop): the context coming back builds nothing. */
let stopped = true;

function destroyAll(): void {
  for (const id of Object.keys(loops) as LoopId[]) destroyLoop(id);
  for (const k of Object.keys(since) as ShotLayer[]) since[k] = null;
}

/** One scheduler step (runs every 120 ms; the offline test harness calls it directly while it steps the clock). */
export function ambienceTick(): void {
  // stopped (a halt): the context back to «running» (an unlock click, a shown tab) must not start the room tone
  if (stopped) return;
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
  syncLoop(c, "draught", want.cellars);
  syncLoop(c, "vent", want.metro);
  syncLoop(c, "murmur", want.terminal);
  trickleLevel();
  scheduleShots(c.ctx.currentTime);
}

/** Update what the colony sounds like (AudioDirector calls this when the zones, the clock tower, buildings or scene change). */
export function ambienceSet(st: Partial<AmbienceState>): void {
  Object.assign(want, st);
  stopped = false;
  if (!timer && typeof window !== "undefined") timer = window.setInterval(ambienceTick, TICK_MS);
  ambienceTick();
}

/** Test reports: the loops sounding now (in build order) and the trickle's level. */
export function ambienceReport(): { loops: string[]; trickle: number | null } {
  const order: LoopId[] = ["room", "trickle", "draught", "vent", "murmur"];
  return { loops: order.filter((id) => loops[id]?.killAt === Infinity), trickle: loops.trickle?.target ?? null };
}

/** A far Metro train right now, whatever the zones (previews and the offline test harness). */
export function ambienceFarTrain(): void {
  const c = ambienceLive();
  if (c) farTrainAt(c.ctx.currentTime + 0.05);
}

/** Stop the scheduler, tear the loops down and forget the colony (AudioDirector unmount or halt; it sends all of it again). */
export function ambienceStop(): void {
  if (timer) clearInterval(timer);
  timer = 0;
  stopped = true;
  destroyAll();
  owner = null;
  Object.assign(want, DEFAULT_STATE);
  lastHour = null;
  bellDue = false;
}
