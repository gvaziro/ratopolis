"use client";

/**
 * «Гул» — the prep phase before a pass: dust from the ceiling, growing tremor and rumble, the big countdown,
 * and (metro / express) the translucent prep panel: crew position, nets, «По местам!», «Пропустить».
 * Capsules only get the shaking tube, the countdown and «Пропустить».
 */
import { useEffect } from "react";
import { sfx } from "@/audio/sfx";
import { CREW_POSITIONS, TRAIN_CARS } from "@/game/data/events";
import { netCost } from "@/game/engine/events";
import { derivedOf, useGame } from "@/game/store";
import type { CrewPosition, Scene } from "@/game/types";
import { fmt, fmtPct } from "@/lib/format";
import { BrassButton, cx } from "@/components/ui/kit";
import CapsuleTube from "./CapsuleTube";
import { TrainDust } from "./TrainBackdrop";
import { act, clamp, shake } from "./sceneUtils";

const POSITIONS: CrewPosition[] = ["wall", "rails", "ties"];
const SECTION_NAMES = ["Левая треть", "Центр", "Правая треть"];

export default function TrainRumble({ scene }: { scene: Scene }) {
  const time = useGame((s) => s.game.time);
  const reduced = useGame((s) => s.game.settings.reducedMotion);
  const total = Math.max(0.1, scene.phaseEnds - scene.phaseStart);
  const remain = Math.max(0, scene.phaseEnds - time);
  const p = clamp(1 - remain / total);
  const capsule = scene.id === "capsule";

  // tremor and rumble ramp (AudioDirector starts/stops the rumble itself)
  useEffect(() => {
    const iv = window.setInterval(() => {
      const sc = useGame.getState().game.scene;
      if (!sc || sc.phase !== "rumble") return;
      const k = clamp(1 - (sc.phaseEnds - useGame.getState().game.time) / Math.max(0.1, sc.phaseEnds - sc.phaseStart));
      shake(0.3 + 1.7 * k, 400);
      sfx.rumbleSet(0.25 + 0.75 * k);
    }, 200);
    return () => window.clearInterval(iv);
  }, []);

  const n = Math.ceil(remain);
  return (
    <div className="absolute inset-0">
      {capsule && <CapsuleTube amp={reduced ? 0 : 0.4 + 2.6 * p} pressure={0.15 + 0.8 * p} />}
      <TrainDust intensity={0.2 + 0.8 * p} />
      {!capsule && <Headlamp p={p} />}
      {!capsule && <Boots p={p} />}
      <div className={cx("absolute inset-x-0 top-0 flex flex-col items-center gap-2 overflow-y-auto px-3 pt-2", capsule ? "bottom-0 justify-center" : "bottom-[30%]")}>
        <div className="pointer-events-none flex flex-col items-center leading-none">
          <span
            key={n}
            className="font-display text-6xl font-bold text-brass-light md:text-7xl"
            style={{ animation: reduced ? undefined : "rr-pop .45s ease-out", textShadow: "0 3px 0 #2a1d0e, 0 0 26px rgba(242,184,75,.55)" }}
          >
            {n}…
          </span>
          <span className="mt-1 text-xs uppercase tracking-[0.25em] text-parchment-dim">{capsule ? "капсулы на подходе" : "до прохода"}</span>
        </div>
        {capsule ? <CapsulePanel /> : <PrepPanel scene={scene} />}
      </div>
      {!capsule && <NetSections scene={scene} />}
    </div>
  );
}

/** The approaching headlamp glowing in the tunnel mouth. */
function Headlamp({ p }: { p: number }) {
  return (
    <div
      className="pointer-events-none absolute right-[-8%] top-[18%] h-[52%] w-[34%] rounded-full bg-[radial-gradient(circle,rgba(255,240,200,.95),rgba(255,200,110,.35)_30%,transparent_68%)]"
      style={{ opacity: 0.08 + 0.92 * p * p, transform: `scale(${0.4 + 0.8 * p})` }}
    />
  );
}

/** Human boots on the platform edge step back as the train approaches. */
function Boots({ p }: { p: number }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[13%] h-[8%]">
      {[22, 41, 70].map((x, i) => (
        <span key={x} className="absolute bottom-0 text-2xl transition-transform duration-500 md:text-3xl" style={{ left: `${x}%`, transform: `translateY(${-p * 26 - i * 2}px) scale(${1 - p * 0.25})`, opacity: 1 - p * 0.6 }}>
          👞
        </span>
      ))}
    </div>
  );
}

function CapsulePanel() {
  const auto = useGame((s) => derivedOf(s.game).capsuleAuto);
  return (
    <div className="pointer-events-auto flex flex-col items-center gap-2 rounded-lg border border-line bg-panel/80 px-4 py-3 text-center shadow-[0_8px_24px_rgba(0,0,0,.6)] backdrop-blur-sm">
      <p className="max-w-xs text-sm text-parchment">Труба дрожит, манометр зашкаливает. Лапы — наготове!</p>
      <p className="text-xs text-parchment-dim">
        Без вас подберём <span className="font-mono tabular text-good">{fmtPct(auto)}</span> добычи
      </p>
      <BrassButton tone="ghost" className="min-h-10" onClick={() => act({ a: "skip" })}>
        Пропустить (только автосбор)
      </BrassButton>
    </div>
  );
}

function PrepPanel({ scene }: { scene: Scene }) {
  const base = useGame((s) => derivedOf(s.game).trainAutoBase);
  const netSlots = useGame((s) => derivedOf(s.game).netSlots);
  const cost = useGame((s) => netCost(s.game, derivedOf(s.game)));
  const wire = useGame((s) => s.game.res.wire);
  const lastNets = useGame((s) => s.game.trainPrefs.lastNets.length);
  const timetable = useGame((s) => !!s.game.upgrades.stolen_timetable);
  const hook = useGame((s) => !!s.game.upgrades.grappling_hook);
  const halfRisk = useGame((s) => !!s.game.meta.edicts.timetable_in_head);
  const pos = CREW_POSITIONS[scene.position];
  const autoNow = Math.min(0.9, (base + (scene.ready ? 0.15 : 0)) * pos.auto);
  const autoReady = Math.min(0.9, (base + 0.15) * pos.auto);

  return (
    <div className="pointer-events-auto w-full max-w-lg rounded-lg border border-line bg-panel/80 p-2.5 shadow-[0_8px_24px_rgba(0,0,0,.6)] backdrop-blur-sm md:p-3">
      <h3 className="mb-1.5 font-display text-sm font-bold uppercase tracking-widest text-brass-light">Позиция бригады</h3>
      <div className="grid grid-cols-3 gap-1.5">
        {POSITIONS.map((id) => {
          const d = CREW_POSITIONS[id];
          const on = scene.position === id;
          const crash = d.crash * (halfRisk ? 0.5 : 1);
          return (
            <button
              key={id}
              type="button"
              aria-pressed={on}
              onClick={() => act({ a: "position", pos: id })}
              className={cx(
                "flex min-h-14 flex-col items-center justify-center rounded-md border px-1 py-1 text-center transition active:translate-y-px",
                on ? "border-brass bg-brass/20 shadow-[0_0_12px_rgba(201,162,90,.35)]" : "border-line bg-black/25 hover:bg-panel-3",
              )}
            >
              <span className="text-sm font-bold leading-tight text-parchment">
                {d.icon} {d.name}
              </span>
              <span className="mt-0.5 font-mono text-[10px] leading-tight text-parchment-dim tabular">
                сбор ×{fmt(d.auto)} · <span className={crash > 0 ? "text-danger-light" : "text-good"}>авария {fmtPct(crash)}</span>
                {hook && <> · крюк ×{fmt(d.hook)}</>}
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-parchment-dim">
        Автосбор: <span className="font-mono font-bold text-good tabular">{fmtPct(autoNow)}</span>
        {!scene.ready && (
          <>
            {" "}
            · с «По местам!» <span className="font-mono text-brass-light tabular">{fmtPct(autoReady)}</span>
          </>
        )}
      </p>
      {timetable && scene.cars.length > 0 && (
        <p className="mt-1 flex flex-wrap items-center gap-x-1 text-xs text-parchment-dim">
          <span>Состав по краденому расписанию:</span>
          {scene.cars.map((c, i) => (
            <span key={i} title={TRAIN_CARS[c.kind].name} className={cx("text-base leading-none", hook && i === scene.hookCar && "rounded ring-1 ring-gaslight")}>
              {TRAIN_CARS[c.kind].icon}
            </span>
          ))}
        </p>
      )}
      {netSlots > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-parchment-dim">
          <span>
            🕸 Сети {scene.nets.length}/{netSlots} · <span className={wire >= cost ? "text-parchment" : "text-danger-light"}>➰ {fmt(cost)}</span> за сеть — ставьте на перроне внизу
          </span>
          <BrassButton size="sm" tone="ghost" className="min-h-10" disabled={lastNets === 0 || scene.nets.length >= netSlots} onClick={() => act({ a: "netsRepeat" })}>
            Как в прошлый раз
          </BrassButton>
        </div>
      )}
      <div className="mt-2.5 flex items-center gap-2">
        <BrassButton size="lg" className="min-h-11 flex-1" onClick={() => act({ a: "ready" })}>
          По местам!
        </BrassButton>
        <BrassButton tone="ghost" className="min-h-11" onClick={() => act({ a: "skip" })}>
          Пропустить
        </BrassButton>
      </div>
    </div>
  );
}

/** Three clickable platform sections over the rail head: place / remove a wire net. */
function NetSections({ scene }: { scene: Scene }) {
  const netSlots = useGame((s) => derivedOf(s.game).netSlots);
  const cost = useGame((s) => netCost(s.game, derivedOf(s.game)));
  const wire = useGame((s) => s.game.res.wire);
  if (netSlots <= 0) return null;
  const full = scene.nets.length >= netSlots;
  return (
    <div className="absolute inset-x-0 bottom-0 top-[70%] grid grid-cols-3 gap-1 p-1.5">
      {[0, 1, 2].map((sec) => {
        const on = scene.nets.includes(sec);
        const can = on || (!full && wire >= cost);
        return (
          <button
            key={sec}
            type="button"
            aria-pressed={on}
            aria-label={`${SECTION_NAMES[sec]}: ${on ? "снять сеть" : "поставить сеть"}`}
            disabled={!can}
            onClick={() => act({ a: "net", section: sec })}
            className={cx(
              "group relative flex min-h-10 flex-col items-center justify-center overflow-hidden rounded-md border-2 text-center text-xs font-bold transition",
              on ? "border-verdigris-light bg-verdigris/15" : "border-dashed border-parchment-dim/50 bg-black/30 hover:border-brass hover:bg-black/45",
              !can && "cursor-not-allowed opacity-45",
            )}
          >
            {on && <span className="absolute inset-0 bg-[repeating-linear-gradient(45deg,rgba(156,199,207,.45)_0_1px,transparent_1px_10px),repeating-linear-gradient(-45deg,rgba(156,199,207,.45)_0_1px,transparent_1px_10px)]" />}
            <span className="relative text-parchment drop-shadow">{on ? "🕸 Сеть стоит" : "+ Сеть"}</span>
            <span className="relative font-mono text-[10px] font-normal text-parchment-dim tabular">{on ? `снять (+➰${fmt(cost)})` : `➰ ${fmt(cost)}`}</span>
          </button>
        );
      })}
    </div>
  );
}
