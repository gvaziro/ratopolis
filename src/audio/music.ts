/**
 * Generative Victorian music (v3 AUD-3): a parlour waltz for the colony, in the key the clicks and coins already
 * ring in. A phrase is 16 bars of 3/4 in G at 88 BPM (~33 s): A = G|C|D7|G|Em|Am|D7|G, A' = G|G7|C|Cm|G/D|D7|G|G,
 * then 40–90 s of rest; after three phrases a 2–3 min break (the music sounds well under 40% of the time).
 * The melody is composed, not sampled: beat 1 takes the chord tone nearest the last note, the other onsets step a
 * scale degree or leap to a chord tone, in rhythm cells [q q q] [h q] [q. e q] [e e q q] [h.], D4–D6, bar 4 cadences
 * on the fifth, bar 8 on the tonic. The first two bars are the district's motif (Вестминстер: the B-A-G-D quarter
 * chime on bells; Уайтчепел: E minor on a barrel organ; Мейфэр: a glockenspiel waltz; Ламбет: a 2/4 polka at
 * 120 BPM; the other districts take one of these families by a hash of their id), bars 3–8 the run's theme (seeded
 * by the district and the run index), A' a fresh variation every phrase. A music box carries the tune over its own
 * bass; from the Cellars a barrel organ plays the "pah-pah" on beats 2–3, from the Terminal a brass bass doubles
 * beat 1 an octave down.
 * Behaviour: the first phrase waits for the first building; a close-up or a hold fades the music to nothing in 0.8 s
 * (the train is the music now) and it comes back only with a new phrase ≥ 8 s after; under a ceremony it is silent,
 * except the coronation: after the twelfth bell the colony's tune (phrase A) becomes the anthem, on brass at 66 BPM.
 * Notes go out one bar per voice on a lookahead scheduler (25 ms tick, 0.15 s ahead; 250 ms while resting), on the
 * music bus (core.musicBus: «Музыка» at 0 builds nothing).
 */
import { musicBus, musicLive, play, type Core, type Voice } from "./core";
import { brass, CHIME, GLOCK, musicBox, musicBoxOut, organReed } from "./instruments";
import { filter, strike } from "./synth";

/* ------------------------------------------------------------------ theory */

/** A chord: pitch classes (C = 0), the bass's pitch class, and the scale note its chromatic tone replaces. */
export interface Chord {
  name: string;
  pcs: readonly number[];
  bass: number;
  /** [scale pc, chord pc]: G7's F stands in for F#, Cm's E♭ for E, B7's D♯ for D, E7's G♯ for G. */
  alt?: readonly [number, number];
}

const chord = (name: string, pcs: readonly number[], bass = pcs[0], alt?: readonly [number, number]): Chord => ({ name, pcs, bass, alt });

export interface MusicKey {
  name: string;
  /** Diatonic pitch classes from the tonic. */
  scale: readonly number[];
  tonic: number;
  fifth: number;
  /** Phrase A and phrase A' (eight chords each, one per bar). */
  a: readonly Chord[];
  a2: readonly Chord[];
}

const G = chord("G", [7, 11, 2]);
const C = chord("C", [0, 4, 7]);
const D7 = chord("D7", [2, 6, 9, 0]);
const EM = chord("Em", [4, 7, 11]);
const AM = chord("Am", [9, 0, 4]);

export const G_MAJOR: MusicKey = {
  name: "G",
  scale: [7, 9, 11, 0, 2, 4, 6],
  tonic: 7,
  fifth: 2,
  a: [G, C, D7, G, EM, AM, D7, G],
  a2: [G, chord("G7", [7, 11, 2, 5], 7, [6, 5]), C, chord("Cm", [0, 3, 7], 0, [4, 3]), chord("G/D", [7, 11, 2], 2), D7, G, G],
};

const B7 = chord("B7", [11, 3, 6, 9], 11, [2, 3]);
export const E_MINOR: MusicKey = {
  name: "Em",
  scale: [4, 6, 7, 9, 11, 0, 2],
  tonic: 4,
  fifth: 11,
  a: [EM, AM, B7, EM, C, AM, B7, EM],
  a2: [EM, chord("E7", [4, 8, 11, 2], 4, [7, 8]), AM, C, chord("Em/B", [4, 7, 11], 11), B7, EM, EM],
};

/** The pitch classes a melody may use over `ch`: the key's scale with the chord's chromatic tone swapped in. */
export function barScale(key: MusicKey, ch: Chord): number[] {
  return key.scale.map((pc) => (ch.alt && ch.alt[0] === pc ? ch.alt[1] : pc));
}

export const midiHz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
const pcOf = (m: number): number => ((m % 12) + 12) % 12;

/** The tune's range: D4 – D6. */
export const MELODY_LO = 62;
export const MELODY_HI = 86;

/* ---------------------------------------------------------------- families */

export type MusicFamily = "waltz" | "chime" | "organ" | "glock" | "polka";

interface FamilyDef {
  key: MusicKey;
  /** Beats per bar. */
  meter: 2 | 3;
  bpm: number;
  lead: "box" | "organ" | "glock";
  /** The motif's own voice (Westminster's quarter chime on bells). */
  motif?: "chime";
  /** A + A' passes per phrase (the polka is quick: twice round makes ~32 s). */
  passes: number;
}

const FAMILIES: Record<MusicFamily, FamilyDef> = {
  waltz: { key: G_MAJOR, meter: 3, bpm: 88, lead: "box", passes: 1 },
  chime: { key: G_MAJOR, meter: 3, bpm: 88, lead: "box", motif: "chime", passes: 1 },
  organ: { key: E_MINOR, meter: 3, bpm: 88, lead: "organ", passes: 1 },
  glock: { key: G_MAJOR, meter: 3, bpm: 88, lead: "glock", passes: 1 },
  polka: { key: G_MAJOR, meter: 2, bpm: 120, lead: "box", passes: 2 },
};

/** The four districts with a family of their own; the others hash into these (and the plain waltz). */
const NAMED: Partial<Record<string, MusicFamily>> = { westminster: "chime", whitechapel: "organ", mayfair: "glock", lambeth: "polka" };
const HASHED: readonly MusicFamily[] = ["waltz", "chime", "organ", "glock", "polka"];

/** Two-bar motifs: [midi, beats] per bar (the hashed districts compose theirs from the district's seed). */
const MOTIFS: Partial<Record<string, readonly (readonly (readonly [number, number])[])[]>> = {
  // the Westminster quarters' first change in G: B A G | D
  westminster: [
    [
      [71, 1],
      [69, 1],
      [67, 1],
    ],
    [[62, 3]],
  ],
  // E — B | C B A: a street organ in the fog
  whitechapel: [
    [
      [76, 2],
      [71, 1],
    ],
    [
      [72, 1],
      [71, 1],
      [69, 1],
    ],
  ],
  // D G B | C: a ballroom curtsey on the glockenspiel
  mayfair: [
    [
      [74, 1],
      [79, 1],
      [83, 1],
    ],
    [[84, 3]],
  ],
  // G B D G | E C: the potteries' polka
  lambeth: [
    [
      [67, 0.5],
      [71, 0.5],
      [74, 0.5],
      [79, 0.5],
    ],
    [
      [76, 1],
      [72, 1],
    ],
  ],
};

/** FNV-1a of a string (the composer's seeds and the district families). */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32: the composer's own seeded generator (Math.random stays free for the rests). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The district's musical family (Вестминстер chimes, Уайтчепел's organ, Мейфэр's glockenspiel, Ламбет's polka…). */
export function musicFamily(district: string): MusicFamily {
  return NAMED[district] ?? HASHED[hash32(`tune:${district}`) % HASHED.length];
}

/* ---------------------------------------------------------------- composer */

export type NotePart = "lead" | "motif" | "bass" | "pah" | "brass";

export interface MusicNote {
  /** Beat from the start of its bar. */
  beat: number;
  midi: number;
  /** Length in beats. */
  dur: number;
  part: NotePart;
}

export interface MusicBar {
  chord: Chord;
  /** The pitch classes this bar may use (barScale). */
  scale: readonly number[];
  notes: MusicNote[];
}

export interface Tune {
  family: MusicFamily;
  key: MusicKey;
  meter: 2 | 3;
  bpm: number;
  lead: FamilyDef["lead"];
  motif?: "chime";
  bars: MusicBar[];
}

const CELLS: Record<2 | 3, readonly (readonly number[])[]> = {
  3: [[1, 1, 1], [2, 1], [1.5, 0.5, 1], [0.5, 0.5, 1, 1], [3]],
  2: [[1, 1], [0.5, 0.5, 1], [1, 0.5, 0.5], [2], [0.5, 0.5, 0.5, 0.5]],
};

/** Every midi note in [lo, hi] whose pitch class is in `pcs`, ascending. */
function notesIn(pcs: readonly number[], lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let m = lo; m <= hi; m++) if (pcs.includes(pcOf(m))) out.push(m);
  return out;
}

function nearest(list: readonly number[], to: number): number {
  let best = list[0];
  for (const m of list) if (Math.abs(m - to) < Math.abs(best - to)) best = m;
  return best;
}

interface Pen {
  r: () => number;
  /** The last note. */
  p: number;
  /** Direction of the scale steps. */
  dir: 1 | -1;
}

/** One bar of melody in rhythm `cell`; `cadence`: the pitch class its first note must land on. */
function melodyBar(pen: Pen, ch: Chord, scale: readonly number[], cell: readonly number[], cadence?: number): MusicNote[] {
  const tones = notesIn(ch.pcs, MELODY_LO, MELODY_HI);
  const steps = notesIn(scale, MELODY_LO, MELODY_HI);
  const notes: MusicNote[] = [];
  let beat = 0;
  cell.forEach((dur, i) => {
    let m: number;
    if (i === 0) {
      if (cadence !== undefined) m = nearest(notesIn([cadence], MELODY_LO, MELODY_HI), pen.p);
      else {
        // the chord tone nearest the last note (now and then the next one over, so the tune does not stand still)
        const byDist = [...tones].sort((a, b) => Math.abs(a - pen.p) - Math.abs(b - pen.p));
        m = byDist[0] === pen.p && pen.r() < 0.5 && byDist.length > 1 ? byDist[1] : byDist[0];
      }
    } else if (pen.r() < 0.55) {
      // a step to the next scale degree, turning at the edges of the range and now and then on its own
      if (pen.p >= 81 || (pen.p > 74 && pen.r() < 0.3)) pen.dir = -1;
      else if (pen.p <= 66 || (pen.p < 70 && pen.r() < 0.3)) pen.dir = 1;
      else if (pen.r() < 0.3) pen.dir = pen.dir === 1 ? -1 : 1;
      const at = steps.indexOf(nearest(steps, pen.p));
      m = steps[Math.max(0, Math.min(steps.length - 1, at + pen.dir))];
    } else {
      // a leap to another chord tone, a third to a sixth away
      const far = tones.filter((x) => Math.abs(x - pen.p) >= 3 && Math.abs(x - pen.p) <= 9);
      m = far.length > 0 ? far[Math.floor(pen.r() * far.length)] : nearest(tones, pen.p);
    }
    notes.push({ beat, midi: m, dur, part: "lead" });
    pen.p = m;
    beat += dur;
  });
  return notes;
}

/** The pitch class bar `b` (0-based, of an 8-bar half) cadences on: the fifth at bar 4, the tonic at bar 8. */
function cadenceOf(key: MusicKey, ch: Chord, b: number, near: number): number | undefined {
  if (b % 8 === 7) return key.tonic;
  if (b % 8 !== 3) return undefined;
  if (ch.pcs.includes(key.fifth)) return key.fifth;
  // A' bar 4 is Cm: the chord tone nearest the fifth
  return pcOf(nearest(notesIn(ch.pcs, MELODY_LO, MELODY_HI), nearest(notesIn([key.fifth], MELODY_LO, MELODY_HI), near)));
}

/** The accompaniment of one bar: the box's bass on beat 1, the organ's pah-pah, the Terminal's brass. */
function accompany(ch: Chord, meter: 2 | 3, o: { organ: boolean; brass: boolean; boxBass: boolean }): MusicNote[] {
  const out: MusicNote[] = [];
  const bass = nearest(notesIn([ch.bass], 48, 59), 53);
  if (o.boxBass) out.push({ beat: 0, midi: bass, dur: 1, part: "bass" });
  if (o.brass) out.push({ beat: 0, midi: bass - 12, dur: 0.8, part: "brass" });
  if (o.organ) {
    // the two chord tones above the bass (the third and the fifth, or the third and the seventh)
    const upper = ch.pcs.filter((pc) => pc !== ch.bass);
    const pair = (upper.length > 2 ? [upper[0], upper[upper.length - 1]] : upper).map((pc) => nearest(notesIn([pc], 55, 67), 61));
    for (let beat = 1; beat < meter; beat++) for (const m of pair) out.push({ beat, midi: m, dur: 0.45, part: "pah" });
  }
  return out;
}

export interface ComposeOpts {
  /** The Cellars are open: the organ's pah-pah. */
  organ?: boolean;
  /** The Terminal is open: the brass bass. */
  brass?: boolean;
}

/**
 * Phrase `n` (0 = the first) of district `district` in run `run`: A then A' (twice round for the polka). Bars 1–2 are
 * the district's motif, bars 3–8 the run's theme (seeded by district and run), A' a variation seeded by `n` too.
 * Deterministic: the same arguments give the same notes.
 */
export function composePhrase(district: string, run: number, n: number, o: ComposeOpts = {}): Tune {
  const family = musicFamily(district);
  const F = FAMILIES[family];
  const key = F.key;
  const bars: MusicBar[] = [];
  for (let pass = 0; pass < F.passes; pass++) {
    const motifPen: Pen = { r: rng(hash32(`motif:${district}`)), p: 71, dir: 1 };
    const themePen: Pen = { r: rng(hash32(`theme:${district}:${run}`)), p: 71, dir: 1 };
    const varPen: Pen = { r: rng(hash32(`var:${district}:${run}:${n}:${pass}`)), p: 71, dir: 1 };
    for (let b = 0; b < 16; b++) {
      const ch = b < 8 ? key.a[b] : key.a2[b - 8];
      const scale = barScale(key, ch);
      let notes: MusicNote[];
      const motif = MOTIFS[district];
      if (b < 2 && motif) {
        let beat = 0;
        notes = motif[b].map(([midi, dur]) => {
          const x: MusicNote = { beat, midi, dur, part: "motif" };
          beat += dur;
          return x;
        });
        themePen.p = notes[notes.length - 1].midi;
      } else {
        // bars 1–2: the district's own (composed) motif; 3–8: the run's theme; 9–16: this phrase's variation
        const pen = b < 2 ? motifPen : b < 8 ? themePen : varPen;
        if (b === 2 && !motif) themePen.p = motifPen.p;
        if (b === 8) varPen.p = themePen.p;
        const cad = cadenceOf(key, ch, b, pen.p);
        const cells = CELLS[F.meter];
        const cell = b % 8 === 7 ? [F.meter] : b % 8 === 3 ? (F.meter === 3 ? [2, 1] : [1, 1]) : cells[Math.floor(pen.r() * cells.length)];
        notes = melodyBar(pen, ch, scale, cell, cad);
        if (b < 2) for (const x of notes) x.part = "motif";
      }
      notes.push(...accompany(ch, F.meter, { organ: !!o.organ, brass: !!o.brass, boxBass: true }));
      bars.push({ chord: ch, scale, notes });
    }
  }
  return { family, key, meter: F.meter, bpm: F.bpm, lead: F.lead, motif: F.motif, bars };
}

/** The coronation anthem: the colony's tune (phrase A of its first phrase) on brass at 66 BPM, over a brass bass. */
export function composeAnthem(district: string, run: number): Tune {
  const t = composePhrase(district, run, 0);
  const bars = t.bars.slice(0, 8).map((bar) => ({
    ...bar,
    notes: [
      ...bar.notes.filter((x) => x.part === "lead" || x.part === "motif").map((x) => ({ ...x, part: "lead" as const })),
      ...accompany(bar.chord, t.meter, { organ: true, brass: true, boxBass: false }),
    ],
  }));
  return { ...t, bpm: 66, lead: "organ", motif: undefined, bars };
}

/* ------------------------------------------------------------------ voices */

/**
 * The music sits low: at the default slider (0.35) its momentary max is −35…−38 LUFS by family (≤ −34: 9 LU under a
 * 6/s click stream), about the ambience's level.
 */
const MUSIC_TRIM = 1.35;
/** The anthem stands up for the King: +6 dB over the waltz. */
const ANTHEM_GAIN = 2;

/** One bar of a tune as one voice on the music bus, starting at `t0`. */
function playBar(tune: Tune, bar: MusicBar, t0: number, anthem: boolean): void {
  const beat = 60 / tune.bpm;
  play(
    "music",
    { max: 6, yieldAt: 60 },
    { at: t0, bus: "music", gain: MUSIC_TRIM * (anthem ? ANTHEM_GAIN : 1), prio: anthem ? "ceremony" : undefined },
    (v: Voice) => {
      let box: AudioNode | null = null;
      let soft: AudioNode | null = null;
      const boxOut = () => (box ??= musicBoxOut(v));
      const softOut = () => (soft ??= filter(v, "lowpass", 3400, 0.7));
      for (const n of bar.notes) {
        const t = t0 + n.beat * beat;
        const f = midiHz(n.midi);
        const len = n.dur * beat;
        switch (n.part) {
          case "lead":
          case "motif":
            if (anthem) brass(v, t, f, len * 0.9, 0.06, softOut());
            else if (n.part === "motif" && tune.motif === "chime") strike(v, t, f, CHIME, 1.1, softOut());
            else if (tune.lead === "organ") organReed(v, t, f, len * 0.92, 0.055, softOut());
            else if (tune.lead === "glock") strike(v, t, f, GLOCK, 0.62, softOut());
            else musicBox(v, t, f, 1, boxOut());
            break;
          case "bass":
            musicBox(v, t, f, 0.75, boxOut());
            break;
          case "pah":
            organReed(v, t, f, len, anthem ? 0.022 : 0.028, softOut());
            break;
          case "brass":
            brass(v, t, f, len, anthem ? 0.06 : 0.045, softOut());
            break;
        }
      }
    },
  );
}

/* --------------------------------------------------------------- sequencer */

export interface MusicState {
  /** A building stands: the first phrase waits for the first one. */
  ready: boolean;
  /** DistrictId of this run (districtInfo(meta).id). */
  district: string;
  /** meta.district: the run's index (seeds the theme). */
  run: number;
  /** The Cellars are open: the organ's pah-pah. */
  organ: boolean;
  /** The Terminal is open: the brass bass. */
  brass: boolean;
  /** A close-up is on screen: the music fades out. */
  scene: boolean;
  /** The game is held (a ceremony, a halt): silent. */
  held: boolean;
}

const want: MusicState = { ready: false, district: "whitechapel", run: 0, organ: false, brass: false, scene: false, held: false };

/** Scheduler tick and lookahead (like the chuff); a resting sequencer ticks slower. */
const TICK_MS = 25;
const IDLE_MS = 250;
const LOOKAHEAD = 0.15;
/** The first phrase starts this long after the music is wanted (a beat after the first building's «тук»). */
const FIRST_DELAY = 2.5;
/** Rests between phrases, and the long break after every third. */
const REST: readonly [number, number] = [40, 90];
const BREAK: readonly [number, number] = [120, 180];
const PHRASES_PER_CYCLE = 3;
/** A close-up or a hold fades the music out over this long… */
const FADE_OUT = 0.8;
/** …and a new phrase may start only this long after it is over. */
const RESUME_AFTER = 8;
/** The anthem starts this long after the coronation's twelfth bell. */
const ANTHEM_AFTER_BELL = 1.2;

interface Playing {
  tune: Tune;
  t0: number;
  /** Next bar to schedule. */
  next: number;
  /** When the last bar's notes have rung out. */
  end: number;
  anthem: boolean;
}

let cur: Playing | null = null;
let anthem: Playing | null = null;
/** Context time of the next phrase (null: plan the first one when the music is next wanted). */
let nextAt: number | null = null;
/** No phrase before this (8 s after a close-up or a hold ended). */
let resumeAt = 0;
/** Phrases since the last long break. */
let inCycle = 0;
/** Phrases of this district and run (seeds the variations). */
let phraseN = 0;
let tuneOf = "";
let timer = 0;
let timerMs = 0;

const rnd = (r: readonly [number, number]): number => r[0] + Math.random() * (r[1] - r[0]);
const barLen = (t: Tune): number => (t.meter * 60) / t.bpm;

function arm(ms: number): void {
  if (typeof window === "undefined") return;
  if (timer && timerMs === ms) return;
  if (timer) clearInterval(timer);
  timerMs = ms;
  timer = window.setInterval(musicTick, ms);
}

function disarm(): void {
  if (timer) clearInterval(timer);
  timer = 0;
  timerMs = 0;
}

/** Fade the music bus to nothing over FADE_OUT (a close-up, a hold, the end of a ceremony). */
function fadeOut(c: Core): void {
  const g = musicBus(c).musicDuck.gain;
  const now = c.ctx.currentTime;
  g.cancelScheduledValues(now);
  g.setValueAtTime(g.value, now);
  g.linearRampToValueAtTime(0, now + FADE_OUT);
}

/** Bring the music bus back up by `t` (a new phrase, the anthem). */
function fadeIn(c: Core, t: number): void {
  const g = musicBus(c).musicDuck.gain;
  const now = c.ctx.currentTime;
  g.cancelScheduledValues(now);
  g.setValueAtTime(g.value, now);
  g.linearRampToValueAtTime(1, Math.max(now + 0.02, t));
}

function start(c: Core, tune: Tune, t0: number, isAnthem: boolean): Playing {
  fadeIn(c, t0);
  // the last bar's notes ring on (the box 1.1 s, the brass and the organ ~0.5 s)
  const end = t0 + tune.bars.length * barLen(tune) + 1.4;
  return { tune, t0, next: 0, end, anthem: isAnthem };
}

/** Bars that should have started this long ago are skipped (the sound was off), never played in a burst. */
const LATE = 0.3;

/** Schedule every bar of `pl` that starts in the next LOOKAHEAD seconds. */
function pump(pl: Playing, now: number): void {
  const L = barLen(pl.tune);
  while (pl.next < pl.tune.bars.length) {
    const t = pl.t0 + pl.next * L;
    if (t >= now + LOOKAHEAD) break;
    if (t > now - LATE) playBar(pl.tune, pl.tune.bars[pl.next], t, pl.anthem);
    pl.next++;
  }
}

/** The phrase is over (or cut): rest, or after the third phrase take the long break. */
function rest(from: number): void {
  inCycle++;
  if (inCycle >= PHRASES_PER_CYCLE) {
    inCycle = 0;
    nextAt = from + rnd(BREAK);
  } else nextAt = from + rnd(REST);
}

/** One scheduler step (every 25 ms while a phrase plays; the offline test bench calls it while it steps the clock). */
export function musicTick(): void {
  const c = musicLive();
  if (!c) {
    // muted, «Музыка» at 0, a hidden tab: nothing is built; the plan carries on (bars missed meanwhile are skipped)
    arm(IDLE_MS);
    return;
  }
  const now = c.ctx.currentTime;
  if (anthem) {
    pump(anthem, now);
    if (now > anthem.end) anthem = null;
  }
  const blocked = !want.ready || want.scene || want.held;
  if (blocked) {
    if (cur) {
      fadeOut(c);
      // the coronation opened mid-phrase (its bells came first): the waltz still fades, and the bus stays down
      // until just before the anthem's first bar, then rises for it (fadeOut cancelled the anthem's own fade-in)
      if (anthem) {
        const g = musicBus(c).musicDuck.gain;
        const up = Math.max(now + FADE_OUT + 0.05, anthem.t0);
        g.setValueAtTime(0, Math.max(now + FADE_OUT, up - 0.5));
        g.linearRampToValueAtTime(1, up);
      }
      cur = null;
      rest(now);
    }
    arm(anthem ? TICK_MS : IDLE_MS);
    return;
  }
  if (!cur) {
    if (nextAt === null) nextAt = now + FIRST_DELAY;
    const at = Math.max(nextAt, resumeAt);
    if (at > now + LOOKAHEAD) {
      arm(at - now < 1 || anthem ? TICK_MS : IDLE_MS);
      return;
    }
    const tune = composePhrase(want.district, want.run, phraseN++, { organ: want.organ, brass: want.brass });
    cur = start(c, tune, Math.max(at, now + 0.03), false);
  }
  pump(cur, now);
  if (cur.next >= cur.tune.bars.length && now > cur.end) {
    rest(cur.end);
    cur = null;
  }
  arm(TICK_MS);
}

/** What the colony's music should do now (AudioDirector: buildings, district, zones, a close-up, a hold). */
export function musicSet(st: Partial<MusicState>): void {
  const wasBlocked = want.scene || want.held;
  Object.assign(want, st);
  const key = `${want.district}:${want.run}`;
  if (key !== tuneOf) {
    // a new district or run: a new theme, and its first phrase as soon as a building stands
    tuneOf = key;
    phraseN = 0;
    inCycle = 0;
    nextAt = null;
  }
  const c = musicLive();
  if (c && wasBlocked && !(want.scene || want.held)) resumeAt = c.ctx.currentTime + RESUME_AFTER;
  musicTick();
}

/**
 * The coronation's bells started: the anthem (phrase A on brass, 66 BPM) follows the twelfth bell at `lastBell`
 * (context time), while the ceremony lasts (musicCeremony(false) ends it).
 */
export function musicAnthem(lastBell: number): void {
  const c = musicLive();
  if (!c) return;
  anthem = start(c, composeAnthem(want.district, want.run), lastBell + ANTHEM_AFTER_BELL, true);
  arm(TICK_MS);
}

/** A ceremony closed: the anthem stops (fading over 0.8 s); the waltz comes back ≥ 8 s after the hold ends. */
export function musicCeremony(on: boolean): void {
  if (on || !anthem) return;
  anthem = null;
  const c = musicLive();
  if (c) fadeOut(c);
}

/** Stop the sequencer and forget the plan (AudioDirector unmount, the test bench). */
export function musicStop(): void {
  disarm();
  cur = null;
  anthem = null;
  nextAt = null;
  resumeAt = 0;
  inCycle = 0;
  phraseN = 0;
  tuneOf = "";
  Object.assign(want, { ready: false, scene: false, held: false });
}

/** Test reports: is a phrase or the anthem playing, and when is the next phrase due. */
export function musicState(): { playing: boolean; anthem: boolean; nextAt: number | null; phrases: number } {
  return { playing: cur !== null, anthem: anthem !== null, nextAt, phrases: phraseN };
}
