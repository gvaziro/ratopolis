/**
 * AUD-3 on the offline bench: the generative district music (every note in its key, the motifs and cadences, the
 * duty cycle, the level at the default slider, no hiss on top, silence within a second of a close-up and a phrase
 * boundary ≥ 8 s after it, the coronation anthem) and the real mixer («Эффекты» at 0 leaves the ambience playing,
 * «Громкость» at 0 silences all, «Музыка» at 0 builds nothing, a failing voice never reaches the Fx listeners).
 * The five-minute render of every family is in mix.slow.test.ts.
 */
import { afterEach, describe, expect, it } from "vitest";
import { emitFx, onFx } from "@/game/fx";
import { DISTRICT_IDS, type Fx } from "@/game/types";
import { ambienceStop, ambienceTick } from "./ambience";
import { musicBus, play, runningForTest, setSfxVolumeCore, setVolumeCore, startsOf, voicesNow } from "./core";
import { composeAnthem, composePhrase, E_MINOR, G_MAJOR, MELODY_HI, MELODY_LO, musicFamily, musicState, musicTick } from "./music";
import { sfx } from "./sfx";
import { bench, renderMusic, SR, type Bench } from "./testing/bench";
import { hfShare, loudness, peakDb } from "./testing/measure";

let b: Bench | null = null;

afterEach(() => {
  b?.restore();
  b = null;
  ambienceStop();
  sfx.musicStop();
  setVolumeCore(1, true);
  setSfxVolumeCore(1);
  sfx.setMusic(0.35);
});

const pc = (m: number) => ((m % 12) + 12) % 12;
const MUSIC = { ready: true, district: "whitechapel", run: 0, organ: true, brass: true, scene: false, held: false };
/** Step the clock with the music's scheduler running, like the page's 25 ms timer. */
const runMusic = (sec: number) => b!.ctx.run(sec, { every: 0.025, fn: musicTick });

describe("the composer (AUD-3)", () => {
  it("puts every note in the district's key (or the bar's own chord), the tune in D4–D6", () => {
    const bad: string[] = [];
    for (const d of DISTRICT_IDS) {
      for (const run of [0, 1, 5]) {
        for (const n of [0, 1, 2, 7]) {
          const t = composePhrase(d, run, n, { organ: true, brass: true });
          t.bars.forEach((bar, i) => {
            for (const x of bar.notes) {
              if (!bar.scale.includes(pc(x.midi)) && !bar.chord.pcs.includes(pc(x.midi))) bad.push(`${d}/${run}/${n} bar ${i + 1} ${x.part} ${x.midi} over ${bar.chord.name}`);
              if ((x.part === "lead" || x.part === "motif") && (x.midi < MELODY_LO || x.midi > MELODY_HI)) bad.push(`${d} ${x.midi} out of range`);
            }
          });
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("follows the form: 16 bars of A and A', bar 4 on the fifth, bar 8 on the tonic, whole bars of beats", () => {
    for (const d of DISTRICT_IDS) {
      const t = composePhrase(d, 2, 3);
      expect(t.bars.length, d).toBe(t.family === "polka" ? 32 : 16);
      expect(t.bars.slice(0, 8).map((x) => x.chord.name), d).toEqual(t.key.a.map((c) => c.name));
      expect(t.bars.slice(8, 16).map((x) => x.chord.name), d).toEqual(t.key.a2.map((c) => c.name));
      const lead = (i: number) => t.bars[i].notes.filter((x) => x.part === "lead" || x.part === "motif");
      expect(pc(lead(3)[0].midi), `${d} bar 4`).toBe(t.key.fifth);
      expect(pc(lead(7)[0].midi), `${d} bar 8`).toBe(t.key.tonic);
      expect(pc(lead(15)[0].midi), `${d} bar 16`).toBe(t.key.tonic);
      for (const bar of t.bars) expect(lead(t.bars.indexOf(bar)).reduce((s, x) => s + x.dur, 0)).toBe(t.meter);
    }
  });

  it("gives each district its family and motif, each run its theme, each phrase its variation", () => {
    expect([musicFamily("westminster"), musicFamily("whitechapel"), musicFamily("mayfair"), musicFamily("lambeth")]).toEqual(["chime", "organ", "glock", "polka"]);
    expect(composePhrase("whitechapel", 0, 0).key).toBe(E_MINOR);
    expect(composePhrase("westminster", 0, 0).key).toBe(G_MAJOR);
    const polka = composePhrase("lambeth", 0, 0);
    expect([polka.meter, polka.bpm]).toEqual([2, 120]);
    // the Westminster quarter chime: B A G | D
    const ww = composePhrase("westminster", 4, 9).bars.slice(0, 2).flatMap((x) => x.notes.filter((n) => n.part === "motif").map((n) => n.midi));
    expect(ww).toEqual([71, 69, 67, 62]);
    // every hashed district takes one of the families; the motif is the district's, whatever the run
    const melody = (d: string, run: number, n: number, from: number, to: number) =>
      composePhrase(d, run, n)
        .bars.slice(from, to)
        .flatMap((x) => x.notes.filter((y) => y.part === "lead" || y.part === "motif").map((y) => y.midi))
        .join(" ");
    for (const d of DISTRICT_IDS) {
      expect(["waltz", "chime", "organ", "glock", "polka"]).toContain(musicFamily(d));
      expect(melody(d, 0, 0, 0, 2)).toBe(melody(d, 3, 5, 0, 2));
    }
    // deterministic, a theme per run, a variation per phrase
    expect(melody("city", 1, 2, 0, 16)).toBe(melody("city", 1, 2, 0, 16));
    expect(melody("city", 1, 0, 2, 8)).toBe(melody("city", 1, 4, 2, 8));
    expect(melody("city", 1, 0, 2, 8)).not.toBe(melody("city", 2, 0, 2, 8));
    expect(melody("city", 1, 0, 8, 16)).not.toBe(melody("city", 1, 1, 8, 16));
  });

  it("adds the organ's pah-pah with the Cellars and the brass bass with the Terminal", () => {
    const parts = (o: { organ?: boolean; brass?: boolean }) => new Set(composePhrase("southwark", 0, 0, o).bars.flatMap((x) => x.notes.map((n) => n.part)));
    expect(parts({})).toEqual(new Set(["lead", "motif", "bass"]));
    expect(parts({ organ: true }).has("pah")).toBe(true);
    expect(parts({ organ: true, brass: true }).has("brass")).toBe(true);
    // the anthem: the first eight bars at 66 BPM
    const a = composeAnthem("southwark", 0);
    expect([a.bars.length, a.bpm]).toEqual([8, 66]);
  });
});

describe("the sequencer (AUD-3)", () => {
  it("waits for the first building, then plays a phrase and rests 40–90 s", () => {
    b = bench();
    sfx.music({ ...MUSIC, ready: false });
    runMusic(5);
    expect(startsOf("music")).toBe(0);
    sfx.music({ ready: true });
    runMusic(4);
    expect(musicState().playing).toBe(true);
    expect(startsOf("music")).toBeGreaterThanOrEqual(1);
    // the phrase is 16 bars (~33 s), then a rest
    runMusic(36);
    const st = musicState();
    expect(st.playing).toBe(false);
    expect(st.nextAt! - b.ctx.currentTime).toBeGreaterThanOrEqual(35);
  });

  it("is silent (< −60 dBFS) within 1 s of a close-up and comes back only with a phrase ≥ 8 s after it", () => {
    b = bench();
    sfx.music(MUSIC);
    const tap = b.ctx.tap(musicBus(b.core).musicDuck);
    runMusic(10);
    expect(musicState().playing).toBe(true);
    const at = b.ctx.currentTime;
    sfx.music({ scene: true });
    runMusic(4);
    const x = tap.data();
    expect(peakDb(x.subarray(Math.round((at - 3) * SR), Math.round(at * SR)))).toBeGreaterThan(-40);
    expect(peakDb(x.subarray(Math.round((at + 1) * SR)))).toBeLessThan(-60);
    // the close-up is over: nothing for 8 s, then a fresh phrase (its rest permitting)
    sfx.music({ scene: false });
    const end = b.ctx.currentTime;
    const starts = startsOf("music");
    runMusic(7.5);
    expect(startsOf("music")).toBe(starts);
    for (let i = 0; i < 200 && !musicState().playing; i++) runMusic(0.5);
    expect(musicState().playing).toBe(true);
    expect(b.ctx.currentTime - end).toBeGreaterThanOrEqual(8);
  });

  it("is silent under a hold, but the coronation anthem plays after the twelfth bell", () => {
    b = bench();
    sfx.music(MUSIC);
    runMusic(6);
    sfx.music({ held: true });
    sfx.hold(true);
    sfx.ceremony(true);
    const tap = b.ctx.tap(musicBus(b.core).musicDuck);
    runMusic(2);
    const quiet = startsOf("music");
    sfx.coronationBells();
    runMusic(10);
    expect(startsOf("music")).toBe(quiet);
    runMusic(4);
    expect(musicState().anthem).toBe(true);
    expect(startsOf("music")).toBeGreaterThan(quiet);
    expect(peakDb(tap.data().subarray(Math.round(12.5 * SR)))).toBeGreaterThan(-40);
    // the ceremony closes: the anthem stops
    sfx.ceremony(false);
    expect(musicState().anthem).toBe(false);
  });

  it("the coronation opening mid-phrase (AudioDirector's order: the bells, then the hold) still raises the anthem", () => {
    b = bench();
    sfx.music(MUSIC);
    runMusic(9);
    expect(musicState().playing).toBe(true);
    // the tap records from now: its sample 0 is the ceremony's opening
    const tap = b.ctx.tap(musicBus(b.core).musicDuck);
    // useHold's listener runs before useMusic's: the anthem is planned, then the waltz is cut
    sfx.hold(true);
    sfx.ceremony(true);
    sfx.coronationBells();
    sfx.music({ held: true });
    runMusic(14);
    expect(musicState().playing).toBe(false);
    expect(musicState().anthem).toBe(true);
    const x = tap.data();
    // the waltz is gone within a second and stays gone under the bells…
    expect(peakDb(x.subarray(Math.round(1 * SR), Math.round(10 * SR)))).toBeLessThan(-60);
    // …and the anthem sounds from 1.2 s after the twelfth bell
    expect(peakDb(x.subarray(Math.round((0.25 + 11 * 0.9 + 1.2) * SR)))).toBeGreaterThan(-40);
  });

  it("over five minutes plays ≤ 45% of the time, ≤ −34 LUFS at the default slider, < 1.5% above 4 kHz", () => {
    // Whitechapel with the organ and the brass (the fullest arrangement); every family: mix.slow.test.ts
    const r = renderMusic(MUSIC, 300);
    expect(r.phrases).toBeGreaterThanOrEqual(2);
    expect(r.on / 300).toBeLessThanOrEqual(0.45);
    expect(r.on / 300).toBeGreaterThan(0.15);
    expect(loudness(r.x, SR)).toBeLessThanOrEqual(-34);
    expect(loudness(r.x, SR)).toBeGreaterThan(-42);
    expect(hfShare(r.x, SR)).toBeLessThan(1.5);
  });
});

describe("the coronation bells (v3 SHL-2)", () => {
  /** The ceremony opens (AudioDirector's order): the music held, the hold, the ceremony; then the bells. */
  const open = () => {
    sfx.music({ ...MUSIC, held: true });
    sfx.hold(true);
    sfx.ceremony(true);
  };
  /** Samples of a tap from `from` to `to` seconds (its sample 0 is the bench's start). */
  const win = (x: Float32Array, from: number, to = x.length / SR) => x.subarray(Math.round(from * SR), Math.round(to * SR));
  /** Context time of strike `i` (from 0) of a sequence rung at `at`: the voice starts 6 ms on, the first strike 0.25 s later. */
  const strikeAt = (at: number, i: number) => at + 0.006 + 0.25 + i * 0.9;

  it("a repeat coronation rings three bells, and the anthem follows the third", () => {
    b = bench();
    open();
    const bells = b.ctx.tap(b.core.bus);
    const music = b.ctx.tap(musicBus(b.core).musicDuck);
    sfx.coronationBells(3);
    runMusic(12);
    expect(startsOf("coronation")).toBe(1);
    const x = bells.data();
    for (let i = 0; i < 3; i++) expect(peakDb(win(x, strikeAt(0, i), strikeAt(0, i) + 0.1)), `bell ${i + 1}`).toBeGreaterThan(-30);
    // no fourth bell: the third rings out (its hum lasts 6.5 s) and nothing strikes after it (a twelfth would at 10.2 s)
    expect(peakDb(win(x, strikeAt(0, 2) + 6.7))).toBeLessThan(-60);
    const m = music.data();
    // the anthem 1.2 s after the third bell (3.26 s), not after a twelfth (11.36 s)
    expect(peakDb(win(m, 0, strikeAt(0, 2) + 1.1))).toBeLessThan(-60);
    expect(peakDb(win(m, strikeAt(0, 2) + 1.3, 8))).toBeGreaterThan(-40);
    expect(musicState().anthem).toBe(true);
  });

  it("the late path: a second ring while the bells sound (CoronationOverlay, then the AudioDirector) changes nothing", () => {
    b = bench();
    open();
    const music = b.ctx.tap(musicBus(b.core).musicDuck);
    sfx.coronationBells(3);
    runMusic(0.05);
    sfx.coronationBells(3);
    // a call without the count (twelve) would once have moved the anthem to a twelfth bell's time, 8 s late
    sfx.coronationBells();
    runMusic(8);
    expect(startsOf("coronation")).toBe(1);
    const m = music.data();
    expect(peakDb(win(m, 0, strikeAt(0, 2) + 1.1))).toBeLessThan(-60);
    expect(peakDb(win(m, strikeAt(0, 2) + 1.3, 8))).toBeGreaterThan(-40);
  });

  it("«Полная церемония ›» (restart) cuts the short form's bells and anthem, then rings twelve from the first", () => {
    b = bench();
    open();
    const bells = b.ctx.tap(b.core.bus);
    const music = b.ctx.tap(musicBus(b.core).musicDuck);
    sfx.coronationBells(3);
    runMusic(5);
    // the anthem is on (from 3.26 s) and the third bell still hums
    expect(peakDb(win(music.data(), 4.5, 5))).toBeGreaterThan(-40);
    expect(peakDb(win(bells.data(), 4.5, 5))).toBeGreaterThan(-60);
    const R = b.ctx.currentTime;
    sfx.coronationBells(12, true);
    runMusic(0.2);
    // the limiter let the new sequence through; the old bells and the anthem's bar ended on the audio clock
    expect(startsOf("coronation")).toBe(2);
    expect(voicesNow()).toBe(1);
    runMusic(12);
    const x = bells.data();
    expect(peakDb(win(x, R + 0.1, strikeAt(R, 0) - 0.01))).toBeLessThan(-60);
    for (const i of [0, 1, 11]) expect(peakDb(win(x, strikeAt(R, i), strikeAt(R, i) + 0.1)), `bell ${i + 1}`).toBeGreaterThan(-30);
    const m = music.data();
    // silent from the cut until 1.2 s after the new twelfth bell, then the anthem again
    expect(peakDb(win(m, R + 0.1, strikeAt(R, 11) + 1.1))).toBeLessThan(-60);
    expect(peakDb(win(m, strikeAt(R, 11) + 1.3))).toBeGreaterThan(-40);
    expect(musicState().anthem).toBe(true);
  });
});

describe("the mixer (AUD-3)", () => {
  const AMB = { sewers: true, cellars: false, metro: false, terminal: false, clock: false, density: 0.5, duck: false, steamEff: 1, steamFull: false, hour: NaN };

  it("«Эффекты» at 0: the ambience plays on, the clicks and the train are silent", () => {
    b = bench();
    sfx.setSfxVolume(0);
    sfx.setAmbience(0.5);
    sfx.ambience(AMB);
    sfx.rumbleKind("train");
    sfx.rumbleStart(1);
    const world = b.ctx.tap(b.core.world);
    const fx = b.ctx.tap(b.core.fx);
    for (let i = 0; i < 12; i++) {
      sfx.click(4);
      sfx.blip(i);
      sfx.coin();
      b.ctx.run(0.25, { every: 0.12, fn: ambienceTick });
    }
    b.ctx.run(5, { every: 0.12, fn: ambienceTick });
    expect([startsOf("click"), startsOf("blip"), startsOf("coin")]).toEqual([0, 0, 0]);
    expect(peakDb(fx.data())).toBeLessThan(-100);
    expect(peakDb(world.data())).toBeLessThan(-100);
    expect(loudness(b.master.data(), SR, 4)).toBeGreaterThan(-45);
  });

  it("«Громкость» at 0 silences everything, and nothing is built", () => {
    b = bench();
    setVolumeCore(0, true);
    sfx.ambience(AMB);
    sfx.music(MUSIC);
    sfx.click(4);
    sfx.thud();
    b.ctx.run(6, {
      every: 0.025,
      fn: () => {
        musicTick();
        ambienceTick();
      },
    });
    expect(voicesNow()).toBe(0);
    expect(b.ctx.liveSources()).toBe(0);
    expect(peakDb(b.master.data())).toBeLessThan(-100);
  });

  it("«Музыка» at 0 builds no music nodes; raising it starts a phrase", () => {
    b = bench();
    sfx.setMusic(0);
    sfx.music(MUSIC);
    runMusic(8);
    expect(b.core.music).toBeUndefined();
    expect(startsOf("music")).toBe(0);
    sfx.setMusic(0.5);
    runMusic(3);
    expect(b.core.music).toBeDefined();
    expect(startsOf("music")).toBeGreaterThanOrEqual(1);
  });

  it("a failing voice never throws into the Fx listeners", () => {
    b = bench();
    expect(() => play("stub", {}, {}, () => {
      throw new Error("a broken voice builder");
    })).not.toThrow();
    expect(voicesNow()).toBe(0);
    // a context whose nodes fail (as a broken or closed one can): the sound is dropped, every listener still hears
    const ctx = b.core.ctx as unknown as { createGain: () => GainNode };
    ctx.createGain = () => {
      throw new Error("InvalidStateError");
    };
    const seen: Fx[] = [];
    const offA = onFx(() => sfx.thud());
    const offB = onFx((fx) => seen.push(fx));
    try {
      expect(() => emitFx([{ k: "buy", id: "nest" } as unknown as Fx])).not.toThrow();
    } finally {
      offA();
      offB();
    }
    expect(seen.length).toBe(1);
  });

  it("the context back to running (iOS after a call, a shown tab) runs the schedulers at once", () => {
    b = bench();
    sfx.music(MUSIC);
    expect(musicState().playing).toBe(false);
    // the timers did not fire meanwhile (a suspended page): the hook starts the due phrase
    b.ctx.skip(3);
    runningForTest();
    expect(musicState().playing).toBe(true);
  });

  it("a halt's stopped ambience stays silent when the context comes back to running", () => {
    b = bench();
    sfx.ambience(AMB);
    b.ctx.run(2, { every: 0.12, fn: ambienceTick });
    sfx.ambienceStop();
    // an unlock click on the save-issue screen, a shown tab: the hook runs the schedulers, the ambience builds nothing
    runningForTest();
    b.ctx.run(5);
    expect(b.ctx.liveSources()).toBe(0);
  });
});
