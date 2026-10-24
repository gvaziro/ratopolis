"use client";

/**
 * «Гул» — the prep phase before a pass: dust from the ceiling, growing tremor and rumble, the big countdown,
 * and (metro / express) the translucent prep panel: crew position, nets, «По местам!», «Пропустить».
 * Capsules only get the shaking tube, the countdown and «Пропустить».
 */
import { useEffect, useRef } from "react";
import { sfx } from "@/audio/sfx";
import { CREW_POSITIONS, TRAIN_CARS, TRAIN_VARIANTS } from "@/game/data/events";
import { sfxCue } from "@/game/fx";
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
/** How each position feels in the pass (POSITION_FEEL: hit radius, sparks present, sticky sparks at 'ties'). */
const POSITION_HINT: Record<CrewPosition, string> = {
  wall: "безопасно, меньше искр",
  rails: "золотая середина, как учили",
  ties: "шире хват, предметы дольше, искры липнут",
};

export default function TrainRumble({ scene }: { scene: Scene }) {
  const time = useGame((s) => s.game.time);
  const reduced = useGame((s) => s.game.settings.reducedMotion);
  const total = Math.max(0.1, scene.phaseEnds - scene.phaseStart);
  const remain = Math.max(0, scene.phaseEnds - time);
  const p = clamp(1 - remain / total);
  const capsule = scene.id === "capsule";

  // tremor and rumble ramp (AudioDirector starts/stops the rumble itself); the giant gentleman's three beats (SC-5)
  const beats = useRef(0);
  useEffect(() => {
    const iv = window.setInterval(() => {
      const sc = useGame.getState().game.scene;
      if (!sc || sc.phase !== "rumble") return;
      const k = clamp(1 - (sc.phaseEnds - useGame.getState().game.time) / Math.max(0.1, sc.phaseEnds - sc.phaseStart));
      shake(0.3 + 1.7 * k, 400);
      sfx.rumbleSet(0.25 + 0.75 * k);
      if (sc.id === "capsule") return;
      while (beats.current < GENT_BEATS.length && k >= GENT_BEATS[beats.current]) {
        const b = beats.current++;
        sfxCue("footstep", { intensity: b === 1 ? 1 : 0.55 });
        if (b === 1) shake(3, 300);
      }
    }, 200);
    return () => window.clearInterval(iv);
  }, []);

  const n = Math.ceil(remain);
  return (
    <div className="absolute inset-0">
      {capsule && <CapsuleTube amp={reduced ? 0 : 0.4 + 2.6 * p} pressure={0.15 + 0.8 * p} />}
      {/* the heavy step back raises a cloud of dust */}
      <TrainDust intensity={Math.min(1, 0.2 + 0.8 * p + (!capsule && p >= GENT_BEATS[1] && p < GENT_BEATS[1] + 0.08 ? 0.8 : 0))} />
      {!capsule && <Headlamp p={p} />}
      {!capsule && <GiantGent p={p} reduced={reduced} />}
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
        {!capsule && <VariantBanner scene={scene} reduced={reduced} />}
        {capsule ? <CapsulePanel /> : <PrepPanel scene={scene} />}
      </div>
      {!capsule && <NetSections scene={scene} />}
    </div>
  );
}

/** SC-4: «🎩 Час пик», «📮 Почтовый на Эдинбург»… and the Cheddar announcement, over the countdown. */
function VariantBanner({ scene, reduced }: { scene: Scene; reduced: boolean }) {
  const v = scene.variant && scene.variant !== "normal" ? TRAIN_VARIANTS[scene.variant] : null;
  if (!v && !scene.announce) return null;
  return (
    <div className="pointer-events-none flex flex-col items-center gap-1" style={reduced ? undefined : { animation: "rr-pop .5s ease-out both" }}>
      {v && (
        <span className="rounded border-2 px-3 py-0.5 font-display text-base font-bold uppercase tracking-widest shadow-[0_4px_12px_rgba(0,0,0,.6)]" style={{ borderColor: v.tint ?? "#c9a25a", background: "rgba(20,17,15,.85)", color: "#f3d77a" }}>
          {v.icon} {v.name}
        </span>
      )}
      {scene.announce && <span className="rounded bg-[#e8b43a] px-2.5 py-0.5 text-sm font-bold text-soot shadow">🧀 {scene.announce}</span>}
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

/** Rumble progress at which the giant gentleman taps his foot, steps back heavily and shuffles (SC-5). */
export const GENT_BEATS = [0.15, 0.6, 0.9] as const;

/**
 * SC-5: a giant gentleman waiting on the platform above — two pinstriped trouser legs coming down from the top edge,
 * hobnailed boots (each ~22% of the scene wide) standing on the platform line at 20% height, a cane ferrule and a
 * dripping umbrella tip. At the beats he taps a toe, steps back heavily (−30 px) and shuffles; reduced motion: still.
 */
function GiantGent({ p, reduced }: { p: number; reduced: boolean }) {
  const back = !reduced && p >= GENT_BEATS[1];
  const tap = !reduced && p >= GENT_BEATS[0] && p < GENT_BEATS[0] + 0.06;
  const shuffle = !reduced && p >= GENT_BEATS[2];
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 h-[20%]">
      <div className="absolute inset-0 transition-transform duration-300 ease-out" style={{ transform: `translateY(${back ? -30 : 0}px) translateX(${shuffle ? -6 : 0}px)` }}>
        <Leg left="14%" toe={tap ? -10 : 0} />
        <Leg left="44%" toe={0} mirror />
        {/* cane ferrule and the umbrella's dripping tip */}
        <div className="absolute bottom-0 left-[70%] h-[140%] w-[5px] -translate-y-0 rounded-b bg-gradient-to-b from-[#2a2018] to-[#5a4a32]">
          <span className="absolute -bottom-1 left-1/2 h-2 w-[7px] -translate-x-1/2 rounded-b bg-[#c9a25a]" />
        </div>
        <div className="absolute bottom-[6%] left-[80%] h-[120%] w-[3%] min-w-[10px] rounded-b-full bg-gradient-to-b from-[#1b1613] to-[#2e3a44]">
          {!reduced && <span className="absolute -bottom-3 left-1/2 h-2 w-1 -translate-x-1/2 rounded-full bg-[#9cc7cf]" style={{ animation: "rr-drip-fall 1.3s ease-in infinite" }} />}
        </div>
      </div>
      <style>{"@keyframes rr-drip-fall{0%{transform:translate(-50%,0);opacity:0}20%{opacity:.9}100%{transform:translate(-50%,40px);opacity:0}}"}</style>
    </div>
  );
}

/** One trouser leg and its boot; the boot's bottom sits on the platform line (the container's bottom). */
function Leg({ left, toe, mirror }: { left: string; toe: number; mirror?: boolean }) {
  return (
    <svg
      viewBox="0 0 220 120"
      className="absolute bottom-0 w-[22%] overflow-visible"
      style={{ left, transform: mirror ? "scaleX(-1)" : undefined }}
      aria-hidden
    >
      <defs>
        <pattern id="gent-pin" width="9" height="10" patternUnits="userSpaceOnUse">
          <rect width="9" height="10" fill="#2b2d33" />
          <rect x="4" width="1" height="10" fill="#4b4e57" />
        </pattern>
      </defs>
      {/* trouser leg running up past the top edge */}
      <path d="M58 -900 H162 L170 70 Q110 80 50 70 Z" fill="url(#gent-pin)" />
      <path d="M50 66 Q110 78 170 66 L172 74 Q110 86 48 74 Z" fill="#1d1e22" />
      {/* the boot: heel, welt, toe cap; the toe taps on beat 1 */}
      <g style={{ transformBox: "fill-box", transformOrigin: "20% 90%", transform: `rotate(${toe}deg)`, transition: "transform .12s" }}>
        <path d="M44 74 H176 Q214 80 216 104 L216 112 H14 L16 96 Q20 78 44 74 Z" fill="#2a1d14" />
        <path d="M150 78 Q206 84 212 104" stroke="#4a3424" strokeWidth="4" fill="none" />
        <rect x="12" y="110" width="206" height="8" rx="3" fill="#1a120c" />
        {[30, 60, 90, 120, 150, 180].map((x) => (
          <circle key={x} cx={x} cy="118" r="2.6" fill="#8d949a" />
        ))}
      </g>
    </svg>
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
              <span className={cx("mt-0.5 text-[10px] italic leading-tight", on ? "text-brass-light" : "text-parchment-dim")}>{POSITION_HINT[id]}</span>
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
      {hook && <HookTarget scene={scene} />}
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

/** Where the grappling hook will go this time (known from the start: the engine picks the car when the train forms). */
function HookTarget({ scene }: { scene: Scene }) {
  const k = scene.hookCar;
  const car = k >= 0 ? scene.cars[k] : undefined;
  if (!car) return <p className="mt-1 text-xs text-parchment-dim">🪝 Крюку сегодня не за что зацепиться: ни багажа, ни первого класса.</p>;
  const def = TRAIN_CARS[car.kind];
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-1 text-xs text-parchment">
      <span className="font-bold text-gaslight">🪝 Цель крюка:</span>
      <span className="text-base leading-none">{def.icon}</span>
      <span>
        {def.name} — {k + 1}-й вагон
      </span>
    </p>
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
