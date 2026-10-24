"use client";

/**
 * Invisible conductor for the synthesized sound: unlocks WebAudio on the first gesture, keeps the effects and
 * ambience volumes in step with the settings, turns engine Fx and UI sound cues into sounds, tunes the grate
 * clicks to the bustle meter, drives the train/capsule rumble from the scene phase, and tells the ambience which
 * zones are open (ducking it under close-ups).
 * Scene components play their own in-scene sounds (catch blips, clacks, chuffing, the cat's bell…) or send cues.
 */
import { useEffect } from "react";
import { sfx } from "@/audio/sfx";
import { emitUiFx, onFx, onUiFx, sfxCue, type UiFx } from "@/game/fx";
import { useGame } from "@/game/store";
import type { BuildingId, Fx, GameState, SceneEventId } from "@/game/types";

const UNLOCK_EVENTS = ["pointerdown", "pointerup", "touchend", "keydown", "click"] as const;

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Building levels at which the machinery pulses reach full density. */
const MACHINERY_FULL = 150;

export default function AudioDirector() {
  useUnlock();
  useVolumeSync();
  useFxSounds();
  useCueSounds();
  useRumble();
  useAmbience();
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

/** Apply settings.sound / volume / ambience only when they change (the sliders preview live themselves). */
function useVolumeSync(): void {
  useEffect(() => {
    let sound: boolean | null = null;
    let volume = -1;
    let ambience = -1;
    const apply = (g: GameState) => {
      const st = g.settings;
      if (st.sound !== sound || st.volume !== volume) {
        sound = st.sound;
        volume = st.volume;
        sfx.setVolume(st.volume, st.sound);
      }
      const a = typeof st.ambience === "number" ? st.ambience : 0.5;
      if (a !== ambience) {
        ambience = a;
        sfx.setAmbience(a);
      }
    };
    apply(useGame.getState().game);
    return useGame.subscribe((s) => apply(s.game));
  }, []);
}

function useFxSounds(): void {
  useEffect(() => {
    const timers = new Set<number>();
    const later = (ms: number, fn: () => void) => {
      const id = window.setTimeout(() => {
        timers.delete(id);
        fn();
      }, ms);
      timers.add(id);
    };
    let lastNews = -Infinity;
    let lastAutoCoin = -Infinity;
    let afterAutoClick = false;

    const off = onFx((fx: Fx) => {
      const now = performance.now();
      switch (fx.k) {
        case "click":
          // the wind-up rats' clicks stay silent; only their rare finds speak
          afterAutoClick = fx.auto;
          if (!fx.auto) {
            // the store publishes before it emits: the meter already holds this click's +3
            const g = useGame.getState().game;
            sfx.playerClick(g.upgrades.bustle ? (g.bustle?.value ?? 0) : null, (g.buffs?.frenzyUntil ?? 0) > g.time);
          }
          break;
        case "drop":
          if (fx.big) sfx.jingle();
          else if (afterAutoClick) {
            if (now - lastAutoCoin > 2000) {
              lastAutoCoin = now;
              sfx.coin();
            }
          } else sfx.playerDrop();
          break;
        case "find":
          sfx.find();
          break;
        case "buy":
          sfx.thud();
          break;
        case "milestone":
          sfx.fanfare();
          break;
        case "upgrade":
          sfx.tin();
          break;
        case "birth":
          sfx.squeak(); // ≤ 3/s inside sfx
          break;
        case "vagrants":
          sfx.squeak();
          later(170, sfx.squeak);
          break;
        case "medal":
          sfx.medal();
          break;
        case "zoneDig":
          sfx.dig();
          break;
        case "zoneOpen":
          sfx.fanfare();
          break;
        case "expressStage":
          sfx.thud();
          later(120, sfx.medal);
          break;
        case "purse":
          sfx.jingle();
          break;
        case "trainSoon":
          if (useGame.getState().game.settings.trainToasts) {
            sfx.bell();
            later(420, sfx.bell);
          }
          break;
        case "news":
          if (now - lastNews >= 8000) {
            lastNews = now;
            sfx.typeBurst(3);
          }
          break;
        case "frenzy":
          sfx.flourish();
          break;
        case "coronation":
          // under an offline report the overlay waits and rings the bells itself when it opens
          if (!useGame.getState().offlineReport) sfx.coronationBells();
          break;
        case "sceneStart":
          sceneIntro(fx.id, later);
          break;
        case "sceneEnd":
          sfx.chuffStop();
          break;
        case "scout":
          sfx.scout(fx.step);
          break;
        case "migration":
          sfx.migration();
          break;
        case "record":
          sfx.record();
          break;
        case "commission":
          sfx.commission(fx.done);
          break;
        default:
          break;
      }
    });
    return () => {
      off();
      for (const id of timers) window.clearTimeout(id);
      timers.clear();
    };
  }, []);
}

/** Named cues from scenes and the shell: sfxCue(cue, {intensity, pitch}). */
function useCueSounds(): void {
  useEffect(
    () =>
      onUiFx((fx: UiFx) => {
        switch (fx.k) {
          case "sfx":
            sfx.cue(fx.cue, fx.intensity, fx.pitch);
            break;
          default:
            break;
        }
      }),
    [],
  );
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
 * A `rumbleCut` cue (the train is gone) holds it at zero until this driver stops it.
 */
function useRumble(): void {
  useEffect(() => {
    let on = false;
    let kind: string | null = null;
    const drive = (g: GameState) => {
      const sc = g.scene;
      const train = sc && (sc.id === "capsule" || sc.id === "metro_train" || sc.id === "royal_express") && (sc.phase === "rumble" || sc.phase === "catch") ? sc : null;
      if (!train) {
        if (on) {
          on = false;
          kind = null;
          sfx.rumbleStop();
          sfx.chuffStop();
        }
        return;
      }
      const k = train.id === "capsule" ? "capsule" : train.id === "royal_express" ? "royal" : "train";
      if (k !== kind) {
        kind = k;
        sfx.rumbleKind(k);
      }
      if (train.phase === "rumble") {
        const p = clamp01((g.time - train.phaseStart) / Math.max(0.1, train.phaseEnds - train.phaseStart));
        const i = 0.2 + 0.6 * p;
        if (!on) {
          on = true;
          sfx.rumbleStart(i);
        } else if (!train.interactive) sfx.rumbleSet(i);
        return;
      }
      const pass = Math.max(0.5, train.cars.length * train.perCar);
      const p = (g.time - train.phaseStart) / pass;
      const i = p < 0.7 ? 1 : clamp01(1 - (p - 0.7) / 0.4);
      if (!on) {
        on = true;
        sfx.rumbleStart(i);
      } else sfx.rumbleSet(i);
    };
    drive(useGame.getState().game);
    const unsub = useGame.subscribe((s) => drive(s.game));
    return () => {
      unsub();
      if (on) sfx.rumbleStop();
    };
  }, []);
}

/**
 * The background soundscape follows the colony: one layer per open zone, the cellar clock once a clock tower
 * stands, machinery pulses thickening with the building levels, ducked while a close-up is on screen.
 * Only real changes reach the audio module (the store publishes 10×/s).
 */
function useAmbience(): void {
  useEffect(() => {
    let last = "";
    const apply = (g: GameState) => {
      let levels = 0;
      for (const id in g.buildings) levels += g.buildings[id as BuildingId] || 0;
      const st = {
        sewers: !!g.zones.sewers,
        cellars: !!g.zones.cellars,
        metro: !!g.zones.metro,
        terminal: !!g.zones.terminal,
        clock: (g.buildings.clocktower ?? 0) > 0,
        density: Math.round(Math.min(1, levels / MACHINERY_FULL) * 100) / 100,
        duck: !!g.scene,
      };
      const key = `${+st.sewers}${+st.cellars}${+st.metro}${+st.terminal}${+st.clock}${+st.duck}:${st.density}`;
      if (key === last) return;
      last = key;
      sfx.ambience(st);
    };
    apply(useGame.getState().game);
    const unsub = useGame.subscribe((s) => apply(s.game));
    return () => {
      unsub();
      sfx.ambienceStop();
    };
  }, []);
}

/** Dev only: `__rrAudio.sfxCue("doppler")` from the console (goes through the UiFx bus like a scene would), or `__rrAudio.sfx.…` directly. */
function useDevHandle(): void {
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const w = window as unknown as { __rrAudio?: unknown };
    w.__rrAudio = { sfxCue, emitUiFx, sfx };
    return () => {
      delete w.__rrAudio;
    };
  }, []);
}
