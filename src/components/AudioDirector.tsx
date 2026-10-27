"use client";

/**
 * Invisible conductor for the synthesized sound: unlocks WebAudio on the first gesture, keeps the effects and
 * ambience volumes in step with the settings, turns engine Fx and UI sound cues into sounds, tunes the grate
 * clicks to the bustle meter, drives the train/capsule rumble from the scene phase, and tells the ambience which
 * zones are open (ducking it under close-ups).
 * Scene components play their own in-scene sounds (catch blips, clacks, chuffing, the cat's bell…) or send cues.
 * v3 (AUD-1): one store subscription holds the sound while the game is held (isHeld: a ceremony, a crash, a save
 * issue) — the rumble and the chuff park and come back at the scene's current level and rate (K2), only the
 * ceremony's own voices sound, the ambience sits −15 dB down under a ceremony; the coronation bells ring when the
 * show actually opens. AUD-2: the v3 cues (UiFx "sfx3"), sounds for the formerly silent events (full, hunger,
 * overload, tier, toast tones, «Открыто!», «Гул из глубины», curios), the crew's chatter, the steam economy in the
 * ambience; an exception in a sound handler is logged once and never reaches the other listeners.
 * AUD-3: the mixer (settings.volume = the master, sfxVolume «Эффекты», ambience «Фон», music «Музыка») and the
 * district music (useMusic: the first building, the district and run, the Cellars and the Terminal, a close-up or a
 * hold). AUD-4: each train names its variant to the audio (whistle, chuff, rumble, joints; the rush-hour crowd at the
 * pass), births are counted into an occasional squeak or litter trill, the ambience hears the humans' hour («Наверху»).
 */
import { useEffect } from "react";
import { startsOf, voicesNow } from "@/audio/core";
import { musicState } from "@/audio/music";
import { sfx } from "@/audio/sfx";
import { train } from "@/audio/trainVoices";
import { bellsOf } from "@/components/modals/coronationGate";
import { districtInfo } from "@/game/data/districts";
import { humanClock } from "@/game/engine/formulas";
import { emitFx, emitUiFx, onFx, onUiFx, sfxCue, sfxCue3, type UiFx } from "@/game/fx";
import { derivedOf, isHeld, useGame, type GameStore } from "@/game/store";
import type { BuildingId, Fx, GameState, ResId, SceneEventId } from "@/game/types";

const UNLOCK_EVENTS = ["pointerdown", "pointerup", "touchend", "keydown", "click"] as const;

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : Number.isFinite(x) ? x : 0);

/** Building levels at which the machinery pulses reach full density. */
const MACHINERY_FULL = 150;
/** A full store's tick, once per resource per this long. */
const FULL_GAP_MS = 30_000;
/** The hunger growl: at most once per this long (the Fx and the reminders while hungry share it: ≤ 3 a minute). */
const HUNGER_REPEAT_MS = 20_000;
/** Steam at the cap this long counts as wasted (the safety valve hisses in the ambience). */
const STEAM_FULL_MS = 5_000;
/** A toast's tone stays quiet when another sound-bearing Fx played this close to it (the same engine batch). */
const TOAST_QUIET_MS = 400;

/**
 * Nothing ticks while a save issue is open (another tab holds the colony, a corrupt or newer save) or the engine
 * crashed: the soundscape falls silent instead of droning on (it starts again from the current state afterwards).
 */
const halted = (s: GameStore): boolean => s.saveIssue !== null || s.crashed;

/** A coronation Fx was heard: the bells ring when the ceremony opens (the show may wait for a scene or a report). */
let bellsPending = false;
/** performance.now() of the last hunger growl. */
let lastGrowl = -Infinity;

let warned = false;
/** Run a sound handler; an audio exception is logged once and never aborts the other Fx listeners. */
function guard(where: string, fn: () => void): void {
  try {
    fn();
  } catch (e) {
    if (!warned) {
      warned = true;
      console.warn(`[audio] ${where} failed; sound may be incomplete`, e);
    }
  }
}

export default function AudioDirector() {
  useUnlock();
  useVolumeSync();
  useHold();
  useFxSounds();
  useCueSounds();
  useRumble();
  useAmbience();
  useMusic();
  useHunger();
  useDevHandle();
  return null;
}

/**
 * Any gesture may (re)open the context; cheap once it runs. Kept registered: iOS can suspend it again.
 * A hidden tab suspends the output (the game loop pauses too, so a train rumble would drone on forever).
 */
function useUnlock(): void {
  useEffect(() => {
    const h = () => sfx.unlock();
    const vis = () => sfx.pause(document.visibilityState === "hidden");
    for (const e of UNLOCK_EVENTS) window.addEventListener(e, h, { capture: true, passive: true });
    document.addEventListener("visibilitychange", vis);
    return () => {
      for (const e of UNLOCK_EVENTS) window.removeEventListener(e, h, { capture: true });
      document.removeEventListener("visibilitychange", vis);
    };
  }, []);
}

/**
 * Apply settings.sound / volume (the master) / sfxVolume / ambience / music only when they change (the sliders
 * preview live themselves). A save without the v3 fields plays at the defaults (effects 1, music 0.35).
 */
function useVolumeSync(): void {
  useEffect(() => {
    let sound: boolean | null = null;
    let volume = -1;
    let ambience = -1;
    let effects = -1;
    let music = -1;
    const num = (x: unknown, dflt: number) => (typeof x === "number" && Number.isFinite(x) ? x : dflt);
    const apply = (g: GameState) => {
      const st = g.settings;
      if (st.sound !== sound || st.volume !== volume) {
        sound = st.sound;
        volume = st.volume;
        sfx.setVolume(st.volume, st.sound);
      }
      const a = num(st.ambience, 0.5);
      if (a !== ambience) {
        ambience = a;
        sfx.setAmbience(a);
      }
      const e = num(st.sfxVolume, 1);
      if (e !== effects) {
        effects = e;
        sfx.setSfxVolume(e);
      }
      const m = num(st.music, 0.35);
      if (m !== music) {
        music = m;
        sfx.setMusic(m);
      }
    };
    apply(useGame.getState().game);
    return useGame.subscribe((s) => apply(s.game));
  }, []);
}

/**
 * The hold gate (AUD-1, K1/K2): while isHeld, new voices are dropped except the ceremony's own and the rumble and
 * chuff park; under a ceremony the ambience sits −15 dB down. The coronation bells ring as the show opens.
 */
function useHold(): void {
  useEffect(() => {
    let hold = false;
    let ceremony = false;
    const apply = (s: GameStore) =>
      guard("hold", () => {
        const h = isHeld(s);
        if (h !== hold) {
          hold = h;
          sfx.hold(h);
        }
        if (s.ceremony !== ceremony) {
          ceremony = s.ceremony;
          sfx.ceremony(ceremony);
          if (ceremony && bellsPending) {
            bellsPending = false;
            sfx.coronationBells(bellsOf(s.game.meta.coronations, window.location.search));
          }
        }
      });
    apply(useGame.getState());
    const unsub = useGame.subscribe(apply);
    return () => {
      unsub();
      sfx.hold(false);
      sfx.ceremony(false);
    };
  }, []);
}

function useFxSounds(): void {
  useEffect(() => {
    const timers = new Set<number>();
    const later = (ms: number, fn: () => void) => {
      const id = window.setTimeout(() => {
        timers.delete(id);
        guard("timer", fn);
      }, ms);
      timers.add(id);
    };
    let lastNews = -Infinity;
    let lastAutoCoin = -Infinity;
    let afterAutoClick = false;
    /** When the last sound-bearing Fx played (a toast's tone stays quiet under it). */
    let lastLoud = -Infinity;
    const fullAt = new Map<ResId, number>();

    /** Play the sound of one Fx; true if it made one (beyond the click stream). */
    const sound = (fx: Fx, now: number): boolean => {
      switch (fx.k) {
        case "click":
          // the wind-up rats' clicks stay silent; only their rare finds speak
          afterAutoClick = fx.auto;
          if (!fx.auto) {
            // the store publishes before it emits: the meter already holds this click's +3
            const g = useGame.getState().game;
            sfx.playerClick(g.upgrades.bustle ? (g.bustle?.value ?? 0) : null, (g.buffs?.frenzyUntil ?? 0) > g.time);
          }
          return false;
        case "drop":
          if (fx.big) sfx.jingle();
          // a tapped shiny (the only drop with `frac`, and no click Fx before it) always tinks, whatever clicked last
          else if (fx.frac) sfx.coin();
          else if (afterAutoClick) {
            if (now - lastAutoCoin > 2000) {
              lastAutoCoin = now;
              sfx.coin();
            }
          } else sfx.playerDrop();
          return !!fx.big;
        case "find":
          sfx.find();
          return true;
        case "buy":
          sfx.thud();
          return true;
        case "milestone":
          sfx.fanfare();
          return true;
        case "upgrade":
          sfx.tin();
          return true;
        case "birth":
          sfx.birth(); // counted: ≤ 1 squeak or litter trill per 1.4 s, none under a close-up
          return false;
        case "vagrants":
          sfx.squeak();
          later(170, sfx.squeak);
          return true;
        case "medal":
          sfx.medal();
          return true;
        case "zoneDig":
          sfx.dig();
          return true;
        case "zoneOpen":
          sfx.fanfare();
          // the crew can't believe its luck: three voices, staggered
          later(650, () => sfx.chatter(3, true));
          return true;
        case "expressStage":
          sfx.thud();
          later(120, sfx.medal);
          return true;
        case "purse":
          sfx.jingle();
          return true;
        case "trainSoon":
          if (useGame.getState().game.settings.trainToasts) {
            sfx.bell();
            later(420, sfx.bell);
            return true;
          }
          return false;
        case "news":
          if (now - lastNews >= 8000) {
            lastNews = now;
            sfx.typeBurst(3);
          }
          return false;
        case "frenzy":
          sfx.flourish();
          return true;
        case "coronation":
          // the show may wait for a scene or the offline report: the bells ring when the ceremony opens (useHold)
          // a repeat coronation's short form rings three (bellsOf); the anthem follows the last bell
          if (useGame.getState().ceremony) sfx.coronationBells(bellsOf(useGame.getState().game.meta.coronations, window.location.search));
          else bellsPending = true;
          return true;
        case "sceneStart":
          // a train names its variant first: the far whistle below is already its own
          if (fx.id === "metro_train" || fx.id === "royal_express") sfx.train(trainVariant(useGame.getState().game));
          // a capsule's intro hiss is a hiss, whatever the last capsule's joints left the count at
          if (fx.id === "capsule") sfx.passStart();
          sceneIntro(fx.id, later);
          return true;
        case "sceneEnd":
          sfx.train(null);
          sfx.chuffStop();
          if (fx.haul && (fx.haul.rating === "gold" || fx.haul.rating === "royal")) {
            later(300, () => sfx.chatter(2, true));
            return true;
          }
          return false;
        case "scout":
          sfx.scout(fx.step);
          return true;
        case "migration":
          sfx.migration();
          return true;
        case "record":
          sfx.record();
          return true;
        case "commission":
          sfx.commission(fx.done);
          return true;
        /* v3 (AUD-2): the formerly silent events */
        case "full": {
          if (now - (fullAt.get(fx.res) ?? -Infinity) < FULL_GAP_MS) return false;
          fullAt.set(fx.res, now);
          sfx.cue("tierLost", 0.5, 0.75);
          return true;
        }
        case "hunger":
          if (fx.on) {
            if (now - lastGrowl < HUNGER_REPEAT_MS) return false;
            lastGrowl = now;
            sfx.hunger(1);
          } else sfx.nibbles();
          return true;
        case "overload":
          sfx.valve();
          return true;
        case "tier":
          // after the purchase's «тук»: the chamber is promoted with a stamp and a ratchet
          later(140, () => sfx.cue("patent"));
          return true;
        case "toast": {
          const tone = fx.tone;
          if (tone !== "good" && tone !== "bad" && tone !== "gold") return false;
          // after the batch: under another event's sound the toast stays quiet
          later(0, () => {
            if (performance.now() - lastLoud < TOAST_QUIET_MS) return;
            if (tone === "good") sfx.cue("chime");
            else if (tone === "bad") sfx.cue("tierLost");
            else sfx.medal();
          });
          return false;
        }
        case "deepRumble":
          sfx.deepRumble();
          return true;
        case "curio":
          sfx.curio();
          return true;
        default:
          return false;
      }
    };

    const off = onFx((fx: Fx) =>
      guard(`fx ${fx.k}`, () => {
        const now = performance.now();
        if (sound(fx, now)) lastLoud = now;
      }),
    );
    return () => {
      off();
      for (const id of timers) window.clearTimeout(id);
      timers.clear();
    };
  }, []);
}

/** Named cues from scenes and the shell: sfxCue(cue, {intensity, pitch}), sfxCue3(…), the «Открыто!» batches. */
function useCueSounds(): void {
  useEffect(
    () =>
      onUiFx((fx: UiFx) =>
        guard(`ui ${fx.k}`, () => {
          switch (fx.k) {
            case "sfx":
              sfx.cue(fx.cue, fx.intensity, fx.pitch);
              break;
            case "sfx3":
              sfx.cue3(fx.cue, fx.intensity, fx.pitch);
              break;
            case "unlock":
              // one ping per batch, however many things opened
              if (fx.items.length > 0) sfx.cue("unlock");
              break;
            default:
              break;
          }
        }),
      ),
    [],
  );
}

/** The variant of the train on screen (the royal express and an unmarked metro train sound "normal"). */
function trainVariant(g: GameState) {
  const sc = g.scene;
  return sc?.id === "metro_train" ? (sc.variant ?? "normal") : "normal";
}

/** Opening sound of each close-up. The scene components add the rest (the cat's bell and meow, the piper's tune, hooves under the grate…). */
function sceneIntro(id: SceneEventId, later: (ms: number, fn: () => void) => void): void {
  switch (id) {
    case "carriage":
      sfx.hooves();
      break;
    case "capsule":
      sfx.hiss();
      later(380, sfx.pop);
      break;
    case "metro_train":
      sfx.whistleFar(false);
      break;
    case "royal_express":
      sfx.whistleFar(true);
      break;
    case "downpour":
      sfx.rain();
      later(260, sfx.splash);
      break;
    case "cat":
      sfx.sting();
      break;
    case "ratcatcher":
      sfx.drone();
      break;
  }
}

/**
 * Train / capsule rumble from the scene phase:
 * rumble → grows 0.2 → 0.8 toward phaseEnds (while the prep UI is mounted it drives the ramp itself);
 * catch → full while the cars pass, then fades with the last one; anything else → silence.
 * A `rumbleCut` cue (the train is gone) holds it at zero until this driver stops it. A held game (a ceremony, a halt)
 * no longer stops it: the hold gate parks the rumble and the chuff and brings both back where the scene is (K2).
 * v3 (AUD-4): the pass's start restarts the capsule's hiss / thunk count (and brings the rush-hour crowd); a train the
 * audio missed the start of (a hot reload) is named here.
 */
function useRumble(): void {
  useEffect(() => {
    let on = false;
    let kind: string | null = null;
    let passOf: number | null = null;
    const drive = (g: GameState) =>
      guard("rumble", () => {
        const sc = g.scene;
        const tr = sc && (sc.id === "capsule" || sc.id === "metro_train" || sc.id === "royal_express") && (sc.phase === "rumble" || sc.phase === "catch") ? sc : null;
        if (!tr) {
          if (on) {
            on = false;
            kind = null;
            sfx.rumbleStop();
            sfx.chuffStop();
          }
          passOf = null;
          return;
        }
        if (tr.id !== "capsule" && !train()) sfx.train(trainVariant(g));
        if (tr.phase === "catch" && passOf !== tr.phaseStart) {
          passOf = tr.phaseStart;
          sfx.passStart();
        }
        const k = tr.id === "capsule" ? "capsule" : tr.id === "royal_express" ? "royal" : "train";
        if (k !== kind) {
          kind = k;
          sfx.rumbleKind(k);
        }
        if (tr.phase === "rumble") {
          const p = clamp01((g.time - tr.phaseStart) / Math.max(0.1, tr.phaseEnds - tr.phaseStart));
          const i = 0.2 + 0.6 * p;
          if (!on) {
            on = true;
            sfx.rumbleStart(i);
          } else if (!tr.interactive) sfx.rumbleSet(i);
          return;
        }
        const pass = Math.max(0.5, tr.cars.length * tr.perCar);
        const p = (g.time - tr.phaseStart) / pass;
        const i = p < 0.7 ? 1 : clamp01(1 - (p - 0.7) / 0.4);
        if (!on) {
          on = true;
          sfx.rumbleStart(i);
        } else sfx.rumbleSet(i);
      });
    drive(useGame.getState().game);
    const unsub = useGame.subscribe((s, prev) => {
      if (s.game !== prev.game) drive(s.game);
    });
    return () => {
      unsub();
      if (on) {
        sfx.rumbleStop();
        sfx.chuffStop();
      }
    };
  }, []);
}

/**
 * The background soundscape follows the colony: one layer per open zone, the cellar clock once a clock tower
 * stands, machinery pulses thickening with the building levels, ducked while a close-up is on screen; silent while
 * the game is halted (it starts again from the current state when that clears). v3 (AUD-2, K4): the steam economy —
 * steamEff (0.05 steps) drags the clock and starts the wheeze, steam at the cap for over 5 s blows the valve.
 * AUD-4: the humans' hour (humanClock: one hour per 12 real minutes) drives «Наверху».
 * Only real changes reach the audio module (the store publishes 10×/s).
 */
function useAmbience(): void {
  useEffect(() => {
    let last = "";
    let fullSince: number | null = null;
    const apply = (s: GameStore) =>
      guard("ambience", () => {
        if (halted(s)) {
          fullSince = null;
          if (last !== "halted") {
            last = "halted";
            sfx.ambienceStop();
          }
          return;
        }
        const g = s.game;
        let levels = 0;
        for (const id in g.buildings) levels += g.buildings[id as BuildingId] || 0;
        // steam: only once there is a boiler, a press or a clock tower (derive is memoised per snapshot)
        const b = g.buildings;
        let steamEff = 1;
        let atCap = false;
        if ((b.boiler ?? 0) > 0 || (b.steam_press ?? 0) > 0 || (b.clocktower ?? 0) > 0) {
          const d = derivedOf(g);
          if (d.steamNeed > 0) steamEff = Math.round(clamp01(g.steamEff) * 20) / 20;
          const cap = d.caps.steam;
          atCap = (b.boiler ?? 0) > 0 && Number.isFinite(cap) && cap > 0 && g.res.steam >= 0.99 * cap;
        }
        const now = performance.now();
        if (!atCap) fullSince = null;
        else if (fullSince === null) fullSince = now;
        const st = {
          sewers: !!g.zones.sewers,
          cellars: !!g.zones.cellars,
          metro: !!g.zones.metro,
          terminal: !!g.zones.terminal,
          clock: (b.clocktower ?? 0) > 0,
          density: Math.round(Math.min(1, levels / MACHINERY_FULL) * 100) / 100,
          duck: !!g.scene,
          steamEff,
          steamFull: fullSince !== null && now - fullSince > STEAM_FULL_MS,
          hour: humanClock(g).hh,
        };
        const key = `${+st.sewers}${+st.cellars}${+st.metro}${+st.terminal}${+st.clock}${+st.duck}${+st.steamFull}:${st.density}:${st.steamEff}:${st.hour}`;
        if (key === last) return;
        last = key;
        sfx.ambience(st);
      });
    apply(useGame.getState());
    const unsub = useGame.subscribe(apply);
    return () => {
      unsub();
      sfx.ambienceStop();
    };
  }, []);
}

/**
 * The district music (AUD-3): the first phrase waits for the first building; the theme follows the district and the
 * run; the Cellars add the organ's pah-pah, the Terminal the brass bass; a close-up or a hold fades it out (a new
 * phrase comes ≥ 8 s after). Only real changes reach the sequencer.
 */
function useMusic(): void {
  useEffect(() => {
    let last = "";
    const apply = (s: GameStore) =>
      guard("music", () => {
        const g = s.game;
        let ready = false;
        for (const id in g.buildings) {
          if ((g.buildings[id as BuildingId] || 0) > 0) {
            ready = true;
            break;
          }
        }
        const st = {
          ready,
          district: g.meta.districtId || districtInfo(g.meta).id,
          run: Math.max(0, Math.floor(g.meta.district || 0)),
          organ: !!g.zones.cellars,
          brass: !!g.zones.terminal,
          scene: !!g.scene,
          held: isHeld(s),
        };
        const key = `${+st.ready}${+st.organ}${+st.brass}${+st.scene}${+st.held}:${st.district}:${st.run}`;
        if (key === last) return;
        last = key;
        sfx.music(st);
      });
    apply(useGame.getState());
    const unsub = useGame.subscribe(apply);
    return () => {
      unsub();
      sfx.musicStop();
    };
  }, []);
}

/** A hungry colony growls again every 20 s at −6 dB (the Fx growls first; neither more than 3 times a minute). */
function useHunger(): void {
  useEffect(
    () =>
      useGame.subscribe((s) =>
        guard("hunger", () => {
          if (!s.game.hungry || isHeld(s)) return;
          const now = performance.now();
          if (now - lastGrowl < HUNGER_REPEAT_MS) return;
          lastGrowl = now;
          sfx.hunger(0.5);
        }),
      ),
    [],
  );
}

/**
 * Dev only: `__rrAudio.sfxCue("doppler")` / `sfxCue3("giantVoice")` (through the UiFx bus like a scene would),
 * `emitFx([{ k: "deepRumble" }])` (like the engine), `sfx.…` directly; `voicesNow()` and `startsOf("hunger")` count;
 * `musicState()` (a phrase playing, the next one due) and `train()` (the train variant the audio thinks is on screen).
 */
function useDevHandle(): void {
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const w = window as unknown as { __rrAudio?: unknown };
    w.__rrAudio = { sfxCue, sfxCue3, emitUiFx, emitFx, sfx, voicesNow, startsOf, musicState, train };
    return () => {
      delete w.__rrAudio;
    };
  }, []);
}
