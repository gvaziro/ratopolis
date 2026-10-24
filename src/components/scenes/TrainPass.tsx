"use client";

/**
 * Pass phase of a train or a capsule run: the catch canvas with the train painted underneath,
 * the joint rhythm (clack + shake), chuffing, the grappling hook timing bar and the jackpot.
 */
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { sfx } from "@/audio/sfx";
import { CREW_POSITIONS, TRAIN_CARS } from "@/game/data/events";
import { useGame } from "@/game/store";
import type { CatchItem, CatchResult, Scene } from "@/game/types";
import { fmt } from "@/lib/format";
import { CatchCanvasCore, newCatchControl, type CatchControl } from "./CatchCanvas";
import TimingBar, { type TimingResult } from "./TimingBar";
import { createTrainPainter, type TrainPainter } from "./TrainPainter";
import { act, shake } from "./sceneUtils";

type HookUi = "hidden" | "open" | "thrown";

function TrainPassImpl({ scene }: { scene: Scene }) {
  // the catch phase is fixed once it starts: keep the snapshot taken at mount
  const [sc] = useState(scene);
  const reduced = useGame((s) => s.game.settings.reducedMotion);
  const hookOwned = useGame((s) => !!s.game.upgrades.grappling_hook);
  const capsule = sc.id === "capsule";
  const royal = sc.id === "royal_express";
  const n = sc.cars.length;
  const hookCar = hookOwned && !capsule ? sc.hookCar : -1;
  // the engine scales the jackpot (×8 perfect / ×5 hit) by the crew position's hook factor
  const hm = CREW_POSITIONS[sc.position].hook;

  const control = useRef<CatchControl>(newCatchControl());
  const painter = useRef<TrainPainter | null>(null);
  const lastJoint = useRef(-1);
  const chuffAt = useRef(0);
  const popAt = useRef(0);
  const hookUi = useRef<HookUi>("hidden");
  const [hookState, setHookState] = useState<HookUi>("hidden");
  const [carIdx, setCarIdx] = useState(0);
  const [jackpot, setJackpot] = useState<TimingResult | null>(null);
  const [flash, setFlash] = useState(0);

  useEffect(() => {
    if (capsule) sfx.hiss();
    else {
      sfx.chuffStart(2);
      sfx.whistle(royal);
    }
    shake(capsule ? 3 : 6, 500);
    return () => {
      if (!capsule) sfx.chuffStop();
    };
  }, [capsule, royal]);

  const drawBack = useCallback(
    (g: CanvasRenderingContext2D, w: number, h: number, t: number, dt: number) => {
      if (!painter.current) {
        painter.current = createTrainPainter({ kinds: sc.cars.map((c) => c.kind), perCar: sc.perCar, capsule, royal, hookCar, reduced });
      }
      painter.current.draw(g, w, h, t, dt);
    },
    [sc, capsule, royal, hookCar, reduced],
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
          }
        }
        setCarIdx(Math.max(0, Math.min(n - 1, k)));
      }
      if (!capsule && t < n * sc.perCar) {
        const now = performance.now();
        if (now - chuffAt.current > 200) {
          chuffAt.current = now;
          sfx.chuffSet(2 + 6 * Math.min(1, t / (n * sc.perCar)));
        }
      }
      if (hookCar >= 0 && hookUi.current !== "thrown") {
        const from = hookCar * sc.perCar - 0.6;
        const to = (hookCar + 1) * sc.perCar + 0.3;
        const want: HookUi = t >= from && t <= to ? "open" : "hidden";
        if (want !== hookUi.current) {
          hookUi.current = want;
          setHookState(want);
        }
      }
    },
    [sc.perCar, n, capsule, hookCar],
  );

  const onSpawn = useCallback((it: CatchItem, x: number, y: number) => {
    // capsules "sneeze" their loot out of the tube
    control.current.burst?.(x, y + 4, "#dfe7ea", it.spark ? 2 : 5);
    const now = performance.now();
    if (now - popAt.current > 70) {
      popAt.current = now;
      sfx.pop();
    }
  }, []);

  const onDone = useCallback((result: CatchResult) => act({ a: "catch", result }), []);

  const onThrow = useCallback(
    (r: TimingResult) => {
      hookUi.current = "thrown";
      setHookState("thrown");
      if (r === "miss") {
        control.current.hook = "miss";
        sfx.tin();
      } else {
        control.current.hook = r === "perfect" ? "perfect" : "hit";
        control.current.slowUntil = performance.now() + 300;
        sfx.jackpot();
        shake(10, 600);
        setJackpot(r);
        if (!reduced) setFlash((f) => f + 1);
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

  return (
    <div className="absolute inset-0">
      <CatchCanvasCore scene={sc} mode="train" onDone={onDone} control={control} drawBack={drawBack} onFrame={onFrame} onSpawn={capsule ? onSpawn : undefined} className="absolute inset-0" />
      {def && (
        <div className="pointer-events-none absolute left-2 top-2 flex items-center gap-1.5 rounded border border-brass-dark/70 bg-soot/75 px-2 py-1 text-xs shadow md:left-3 md:top-3">
          <span className="text-base leading-none">{def.icon}</span>
          <span className="font-display font-bold text-brass-light">{def.name}</span>
          <span className="font-mono tabular text-parchment-dim">
            {Math.min(carIdx + 1, n)}/{n}
          </span>
          {carIdx === hookCar && hookState !== "thrown" && <span className="text-gaslight">🪝</span>}
        </div>
      )}
      {hookState !== "hidden" && (
        <div className="pointer-events-none absolute inset-x-0 bottom-[3%] z-10 flex justify-center px-3">
          <TimingBar onThrow={onThrow} hm={hm} title={royal ? "Крюк — на королевский вагон!" : "Крюк — на багажную полку!"} />
        </div>
      )}
      {jackpot && <Jackpot perfect={jackpot === "perfect"} hm={hm} royal={royal} reduced={reduced} />}
      {flash > 0 && <div key={flash} className="pointer-events-none absolute inset-0 z-20 bg-[#fff6dc]" style={{ animation: "rr-flash .4s ease-out forwards" }} />}
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
        <div className="font-sans text-sm font-bold tracking-normal text-parchment">{`${perfect ? "Идеальный бросок: чемодан" : "Чемодан с полки"} ×${fmt((perfect ? 8 : 5) * hm)} + 💍💍`}</div>
      </div>
    </div>
  );
}

const TrainPass = memo(TrainPassImpl, (a, b) => a.scene.seq === b.scene.seq && a.scene.phaseStart === b.scene.phaseStart);
export default TrainPass;
