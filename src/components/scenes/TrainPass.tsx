"use client";

/**
 * Pass phase of a train or a capsule run: the catch canvas with the train painted underneath,
 * the joint rhythm (clack + shake), chuffing, the grappling hook timing bar and the jackpot.
 * 1.5 s before the hook window the target car's tag pulses and three rising ticks count it in.
 * SC-4: the variant tints the train, the Cheddar car is painted cheese-yellow.
 * SC-5: the arrival hits — half speed for 0.45 s, a pale flash, a thump, a sideways gust of dust; a doppler as the engine
 * passes the middle; at the last car the rumble cuts to a ringing silence (rumbleCut + tinnitus), a drip, flickering
 * lamps. Phones get a «Наверху» inset with the human train above (in the tag column, so the hook's count-in tag stays
 * in view under it). Reduced motion: no slow-mo, flash, streaks or gust (read when the arrival happens, so toggling it
 * mid-pass does not replay the arrival).
 * v3 SCN-1: slow-mo and the sound throttles run on the scene clock (the canvas stands still while the game is held).
 * SCN-2: a crew of four rats holds a tarp on the rail head under the wheels (crew.ts; the stance follows the crew
 * position, catches near a span sag it, a rat ducks as a wheel crests over it; after a crash they lie dazed under 💫).
 * SCN-4: the conductor shouts down with the arrival thump.
 */
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { sfx } from "@/audio/sfx";
import { CREW_POSITIONS, HOOK_JACKPOT, TRAIN_CARS, TRAIN_VARIANTS } from "@/game/data/events";
import { humanClock } from "@/game/engine/formulas";
import { sfxCue, sfxCue3 } from "@/game/fx";
import { useGame } from "@/game/store";
import type { CatchItem, CatchResult, Scene } from "@/game/types";
import { fmt } from "@/lib/format";
import { CatchCanvasCore, newCatchControl, type CatchControl } from "./CatchCanvas";
import { CRASH_LOCK_S } from "./catchRules";
import { crewCatch, drawCrew, newCrew } from "./crew";
import { CrewSprites } from "./CrewArt";
import TimingBar, { type TimingResult } from "./TimingBar";
import { TrainDust } from "./TrainBackdrop";
import { UpstairsInset } from "./UpstairsInset";
import { createTrainPainter, type TrainPainter } from "./TrainPainter";
import { act, carLeft, EMOJI_FONT, reducedNow, sceneNow, shake, trainGeom } from "./sceneUtils";

type HookUi = "hidden" | "open" | "thrown";

/** The hook is counted in this long before its window opens: three ticks, 0.5 s apart, rising in pitch. */
const HOOK_LEAD = 1.5;
const HOOK_TICKS = [1, 1.12, 1.26];

function TrainPassImpl({ scene }: { scene: Scene }) {
  // the catch phase is fixed once it starts: keep the snapshot taken at mount
  const [sc] = useState(scene);
  const reduced = useGame((s) => s.game.settings.reducedMotion);
  const hookOwned = useGame((s) => !!s.game.upgrades.grappling_hook);
  const capsule = sc.id === "capsule";
  const royal = sc.id === "royal_express";
  const n = sc.cars.length;
  const hookCar = hookOwned && !capsule ? sc.hookCar : -1;
  // the engine scales the jackpot (HOOK_JACKPOT ×4 perfect / ×2.5 hit, royal car ×6 / ×4) by the crew position's hook factor
  const hm = CREW_POSITIONS[sc.position].hook;
  const royalHook = hookCar >= 0 && sc.cars[hookCar]?.kind === "royal";

  const control = useRef<CatchControl>(newCatchControl());
  const painter = useRef<TrainPainter | null>(null);
  const crew = useRef(newCrew());
  const wheelXs = useRef<number[]>([]);
  const lastJoint = useRef(-1);
  const chuffAt = useRef(0);
  const popAt = useRef(0);
  const hookUi = useRef<HookUi>("hidden");
  const ticks = useRef(0);
  const soon = useRef(false);
  const [hookSoon, setHookSoon] = useState(false);
  const [hookState, setHookState] = useState<HookUi>("hidden");
  const [carIdx, setCarIdx] = useState(0);
  const [jackpot, setJackpot] = useState<TimingResult | null>(null);
  // the arrival flash is the first one (pale); the jackpot's flashes count on from it. The style is fixed when a flash
  // fires: deriving it from `jackpot` restarted the animation (a stray pale flash) when the jackpot text went away
  const [flash, setFlash] = useState(() => ({ n: !capsule && !reduced ? 1 : 0, strong: false }));
  const [arrival, setArrival] = useState(!capsule && !reduced);
  const [departed, setDeparted] = useState(false);
  const variant = sc.variant ? TRAIN_VARIANTS[sc.variant] : null;
  // the human clock when the pass began (the «Наверху» inset's caption)
  const [clock] = useState(() => {
    const c = humanClock(useGame.getState().game);
    return `${String(c.hh).padStart(2, "0")}:${String(c.mm).padStart(2, "0")}`;
  });

  useEffect(() => {
    if (capsule) sfx.hiss();
    else {
      sfx.chuffStart(2);
      sfx.whistle(royal);
      // SC-5 arrival impact: hit-stop at half speed, a pale flash and a thump; SCN-4: the conductor shouts down
      sfxCue("thump");
      sfxCue3("giantVoice", { intensity: 1 });
      if (!reducedNow()) {
        control.current.slowUntil = sceneNow() + 450;
      }
    }
    shake(capsule ? 3 : 6, 500);
    const gust = window.setTimeout(() => setArrival(false), 900);
    return () => {
      window.clearTimeout(gust);
      if (!capsule) sfx.chuffStop();
    };
  }, [capsule, royal]);

  const drawBack = useCallback(
    (g: CanvasRenderingContext2D, w: number, h: number, t: number, dt: number) => {
      if (!painter.current) {
        painter.current = createTrainPainter({
          kinds: sc.cars.map((c) => c.kind),
          perCar: sc.perCar,
          capsule,
          royal,
          hookCar,
          reduced,
          tint: variant?.tint ?? null,
          specials: sc.cars.map((c) => c.special),
          onCentre: capsule ? undefined : () => sfxCue("doppler"),
        });
      }
      painter.current.draw(g, w, h, t, dt);
      if (capsule) return;
      // SCN-2: the crew on the rail head, under the loot (the canvas draws the items after us)
      const G = trainGeom(w, h, sc.perCar, false);
      const xs = wheelXs.current;
      xs.length = 0;
      for (let i = 0; i < n; i++) xs.push(carLeft(G, i, t, sc.perCar) + G.carLen / 2);
      drawCrew(
        g,
        crew.current,
        { w, h, railY: G.railY, position: sc.position, wheelXs: xs, wheelR: G.wheelR, t, crash: !!sc.crash, crashLock: CRASH_LOCK_S, reduced, emojiFont: EMOJI_FONT, dpr: Math.min(2, window.devicePixelRatio || 1), vmin: Math.min(window.innerWidth, window.innerHeight) },
        dt,
      );
    },
    [sc, capsule, royal, hookCar, reduced, variant, n],
  );

  // SCN-2: a catch near a tarp span sags it and the nearest rat hops
  const onCatch = useCallback(
    (_combo: number, x: number, y: number) => {
      if (!capsule) crewCatch(crew.current, x, y);
    },
    [capsule],
  );

  const onFrame = useCallback(
    (t: number) => {
      const k = Math.floor(t / sc.perCar);
      if (k !== lastJoint.current) {
        const prev = lastJoint.current;
        lastJoint.current = k;
        if (prev >= 0 && k > prev && k <= n) {
          if (k < n) {
            if (capsule) sfx.hiss();
            else {
              sfx.clack();
              shake(4, 400);
            }
          } else if (!capsule) {
            sfx.clack();
            sfx.chuffStop();
            // SC-5 departure: the roar cuts out, the ears ring, one drip, the lamps flicker
            sfxCue("rumbleCut");
            sfxCue("tinnitus");
            sfx.drip();
            setDeparted(true);
          }
        }
        setCarIdx(Math.max(0, Math.min(n - 1, k)));
      }
      if (!capsule && t < n * sc.perCar) {
        const now = sceneNow();
        if (now - chuffAt.current > 200) {
          chuffAt.current = now;
          sfx.chuffSet(2 + 6 * Math.min(1, t / (n * sc.perCar)));
        }
      }
      if (hookCar >= 0 && hookUi.current !== "thrown") {
        const from = hookCar * sc.perCar - 0.6;
        const to = (hookCar + 1) * sc.perCar + 0.3;
        // count the window in, so the timing bar never pops up out of nowhere
        const lead = from - HOOK_LEAD;
        while (ticks.current < HOOK_TICKS.length && t >= lead + 0.5 * ticks.current) {
          // a tick that is long gone (late mount) stays silent
          if (t - (lead + 0.5 * ticks.current) < 0.3) sfxCue("tick", { pitch: HOOK_TICKS[ticks.current] });
          ticks.current++;
        }
        const wantSoon = t >= lead && t < from;
        if (wantSoon !== soon.current) {
          soon.current = wantSoon;
          setHookSoon(wantSoon);
        }
        const want: HookUi = t >= from && t <= to ? "open" : "hidden";
        if (want !== hookUi.current) {
          hookUi.current = want;
          control.current.hookOpen = want === "open";
          setHookState(want);
        }
      }
    },
    [sc.perCar, n, capsule, hookCar],
  );

  const onSpawn = useCallback((it: CatchItem, x: number, y: number) => {
    // capsules "sneeze" their loot out of the tube
    control.current.burst?.(x, y + 4, "#dfe7ea", it.spark ? 2 : 5);
    const now = sceneNow();
    if (now - popAt.current > 70) {
      popAt.current = now;
      sfx.pop();
    }
  }, []);

  const onDone = useCallback((result: CatchResult) => act({ a: "catch", result }), []);

  const onThrow = useCallback(
    (r: TimingResult) => {
      hookUi.current = "thrown";
      control.current.hookOpen = false;
      setHookState("thrown");
      if (r === "miss") {
        control.current.hook = "miss";
        sfx.tin();
      } else {
        control.current.hook = r === "perfect" ? "perfect" : "hit";
        control.current.slowUntil = sceneNow() + 300;
        sfx.jackpot();
        shake(10, 600);
        setJackpot(r);
        if (!reduced) setFlash((f) => ({ n: f.n + 1, strong: true }));
        control.current.burst?.(0.5, 0.42, "#f5d76e", 34, true);
        control.current.burst?.(0.5, 0.42, "#f5a3ff", 10, true);
        window.setTimeout(() => setJackpot(null), 1900);
      }
      window.setTimeout(() => setHookState("hidden"), 1100);
    },
    [reduced],
  );

  const car = sc.cars[carIdx];
  const def = car ? TRAIN_CARS[car.kind] : null;
  const target = hookCar >= 0 && sc.cars[hookCar] ? TRAIN_CARS[sc.cars[hookCar].kind] : null;

  return (
    <div className="absolute inset-0">
      {!capsule && <CrewSprites />}
      <CatchCanvasCore scene={sc} mode="train" onDone={onDone} onCatch={onCatch} control={control} drawBack={drawBack} onFrame={onFrame} onSpawn={capsule ? onSpawn : undefined} className="absolute inset-0" />
      <div className="pointer-events-none absolute left-2 top-2 flex flex-col items-start gap-1 md:left-3 md:top-3">
        {def && (
          <div className="flex items-center gap-1.5 rounded border border-brass-dark/70 bg-soot/75 px-2 py-1 text-xs shadow">
            <span className="text-base leading-none">{def.icon}</span>
            <span className="font-display font-bold text-brass-light">{def.name}</span>
            <span className="font-mono tabular text-parchment-dim">
              {Math.min(carIdx + 1, n)}/{n}
            </span>
            {carIdx === hookCar && hookState !== "thrown" && <span className="text-gaslight">🪝</span>}
          </div>
        )}
        {/* phones only (md:hidden); stacked here, the count-in tag below never ends up under it */}
        {!capsule && <UpstairsInset n={n} perCar={sc.perCar} clock={clock} reduced={reduced} cab={false} className="relative" />}
        {hookSoon && target && (
          <div className="relative">
            {!reduced && <span className="absolute inset-0 rounded border-2 border-gaslight" style={{ animation: "rr-scene-ping .5s cubic-bezier(0,0,.2,1) 3" }} />}
            <div className="relative flex items-center gap-1.5 rounded border border-gaslight bg-[#3a2a0e]/90 px-2 py-1 text-xs font-bold text-gaslight shadow-[0_0_14px_rgba(242,184,75,.45)]">
              🪝 Цель близко: <span className="text-base leading-none">{target.icon}</span> {target.name}
            </div>
          </div>
        )}
      </div>
      {hookState !== "hidden" && (
        <div className="pointer-events-none absolute inset-x-0 bottom-[3%] z-10 flex justify-center px-3">
          <TimingBar onThrow={onThrow} hm={hm} royal={royalHook} title={royal ? "Крюк — на королевский вагон!" : "Крюк — на багажную полку!"} />
        </div>
      )}
      {jackpot && <Jackpot perfect={jackpot === "perfect"} hm={hm} royal={royal} reduced={reduced} />}
      {flash.n > 0 && (
        <div key={flash.n} className="pointer-events-none absolute inset-0 z-20 bg-[#fff6dc]" style={{ animation: flash.strong ? "rr-flash .4s ease-out forwards" : "rr-flash-soft .45s ease-out forwards" }} />
      )}
      {arrival && (
        <div className="pointer-events-none absolute inset-y-0 left-0 w-[60%] -scale-x-100">
          <TrainDust intensity={1} />
        </div>
      )}
      {departed && !reduced && <div className="pointer-events-none absolute inset-0 z-10 bg-[radial-gradient(ellipse_at_50%_0%,rgba(255,214,140,.22),transparent_60%)]" style={{ animation: "rr-flicker .9s ease-in-out 2" }} />}
    </div>
  );
}

function Jackpot({ perfect, hm, royal, reduced }: { perfect: boolean; hm: number; royal: boolean; reduced: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      <div className="absolute left-1/2 top-[30%] text-6xl md:text-7xl" style={{ animation: reduced ? undefined : "rr-drop .9s cubic-bezier(.3,.7,.4,1) both", transform: reduced ? "translate(-50%,0)" : undefined }}>
        🧳{royal && <span className="absolute -right-3 -top-3 text-3xl">👑</span>}
      </div>
      <div
        className="absolute left-1/2 top-[22%] whitespace-nowrap text-center font-display text-5xl font-bold tracking-wider text-gaslight md:text-6xl"
        style={{
          animation: reduced ? undefined : "rr-jackpot 1.8s ease-out forwards",
          transform: reduced ? "translate(-50%,-50%)" : undefined,
          textShadow: "0 3px 0 #4a2a0a, 0 0 22px rgba(255,190,80,.9), 0 0 2px #000",
        }}
      >
        ДЖЕКПОТ!
        <div className="font-sans text-sm font-bold tracking-normal text-parchment">{`${perfect ? "Идеальный бросок: чемодан" : "Чемодан с полки"} ×${fmt((royal ? (perfect ? HOOK_JACKPOT.royalPerfect : HOOK_JACKPOT.royalHit) : perfect ? HOOK_JACKPOT.perfect : HOOK_JACKPOT.hit) * hm)} + 💍💍`}</div>
      </div>
    </div>
  );
}

const TrainPass = memo(TrainPassImpl, (a, b) => a.scene.seq === b.scene.seq && a.scene.phaseStart === b.scene.phaseStart);
export default TrainPass;
