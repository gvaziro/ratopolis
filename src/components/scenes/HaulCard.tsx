"use client";

/**
 * «Улов» — the newspaper card after a train: loot rolls up like an odometer (1.2 s, ease-out),
 * caught share, rating, combo, suspicion, notes, and the brotherhood's stamp for gold / royal.
 * v3: the odometer rolls on the scene clock (SCN-1); «Дальше» is the keyboard landing spot (SCN-5).
 * SCN-3: a struck medal pinned over the double rule (HaulMedal; below 40% a dashed «нужно 40%»), the odometer ratchets
 * (12–16 ticks, slowing down) and every rating lands on its own sound (haulSound.ts); a chip names the train's variant
 * or the Cheddar car; lines for a curio and for human vigilance; on phones the system «Назад» turns the page.
 */
import { memo, useEffect, useRef, useState } from "react";
import { sfx } from "@/audio/sfx";
import { CURIOS } from "@/game/data/curios";
import { RATING_TABLE, TRAIN_VARIANTS } from "@/game/data/events";
import { RESOURCES } from "@/game/data/resources";
import { entries } from "@/game/engine/formulas";
import { sfxCue } from "@/game/fx";
import { useGame } from "@/game/store";
import type { Scene } from "@/game/types";
import { fmt, fmtInt, fmtPct, fmtTime } from "@/lib/format";
import { useBackCloses } from "@/lib/useBackCloses";
import { BrassButton, cx } from "@/components/ui/kit";
import { HazardStyles } from "./HazardKit";
import HaulMedal from "./HaulMedal";
import { haulStinger, odometerTicks, ODOMETER_MS, tickPitch, type StingerSound } from "./haulSound";
import { isMedalTier } from "./medalArt";
import { act, clamp, easeOutCubic, keyboardUsed, sceneNow, shake } from "./sceneUtils";

const signed = (v: number) => (v >= 0 ? `+${fmt(v)}` : fmt(v));

/** Within this long after the card shows, Space / Enter on «Дальше» are taken as carried over from the catch or the piles. */
const CARRY_MS = 400;

/**
 * Number rolling up from 0 to `value` in 1.2 s with an ease-out (DOM text, no React re-renders). `onTick(k)` fires as
 * the odometer passes each 1/14 of the way (haulSound.odometerTicks: spaced so the tick cue never swallows one).
 */
function RollUp({ value, delay = 0, prefix = "+", onTick }: { value: number; delay?: number; prefix?: string; onTick?: (k: number) => void }) {
  const ref = useRef<HTMLSpanElement>(null);
  const tickRef = useRef(onTick);
  useEffect(() => {
    tickRef.current = onTick;
  });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const t0 = sceneNow() + delay;
    const ticks = tickRef.current ? odometerTicks() : [];
    let next = 0;
    let raf = 0;
    const tick = () => {
      const ms = sceneNow() - t0;
      const k = clamp(ms / ODOMETER_MS);
      el.textContent = prefix + fmt(value * easeOutCubic(k));
      // one tick per frame at most: a late frame (a slow tab) skips the stale ones instead of a burst
      let due = -1;
      while (next < ticks.length && ticks[next].at <= ms) due = next++;
      if (due >= 0 && ms - ticks[due].at < 120) tickRef.current?.(ticks[due].k);
      if (k < 1 || next < ticks.length) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, delay, prefix]);
  return (
    <span ref={ref} className="tabular">
      {prefix}
      {fmt(0)}
    </span>
  );
}

/** The odometer's ratchet: a soft clock tick rising in pitch. */
const odoTick = (k: number) => sfxCue("tick", { intensity: 0.35, pitch: tickPitch(k) });

/** Play one step of the landing stinger (haulSound.haulStinger). */
function playStinger(sound: StingerSound, pitch?: number): void {
  switch (sound) {
    case "tierLost":
      sfxCue("tierLost");
      break;
    case "tin":
      sfx.tin();
      break;
    case "chime":
      sfxCue("chime", { pitch });
      break;
    case "stamp":
      sfx.thud();
      break;
    case "medal":
      sfx.medal();
      break;
    case "record":
      sfx.record();
      break;
    case "jingle":
      sfx.jingle();
      break;
  }
}

/** «📮 Почтовый на Эдинбург», «🧀 Сырный вагон»…: what was special about this train (none for a plain one). */
function variantChip(scene: Scene): string | null {
  const v = scene.variant && scene.variant !== "normal" ? TRAIN_VARIANTS[scene.variant] : null;
  const cheese = scene.cars.some((c) => c.special === "cheese");
  const parts: string[] = [];
  if (v) parts.push(`${v.icon} ${v.name}`);
  if (cheese) parts.push("🧀 Сырный вагон");
  else if (scene.announce) parts.push(`📣 ${scene.announce.replace(/[!.]+$/, "")}`);
  return parts.length ? parts.join(" · ") : null;
}

function HaulCardImpl({ scene }: { scene: Scene }) {
  const [haul] = useState(scene.haul);
  const reduced = useGame((s) => s.game.settings.reducedMotion);
  const showSusp = useGame((s) => !!s.game.zones.cellars || !!s.game.revealed.suspicion);
  const [stamp, setStamp] = useState(false);
  const approved = haul?.rating === "gold" || haul?.rating === "royal";
  // «Дальше» takes the focus only from a keyboard player (a mouse player may be busy in the side panel)
  const [kbdFocus] = useState(keyboardUsed);
  const shownAt = useRef(0);
  const [chip] = useState(() => variantChip(scene));
  // SCN-3: on phones the system «Назад» turns the page like «Дальше»
  useBackCloses(true, () => act({ a: "dismiss" }));

  useEffect(() => {
    shownAt.current = sceneNow();
  }, []);

  // the opening typewriter, then the stinger of the rating as the odometer comes to rest (the stamp lands with it)
  useEffect(() => {
    sfx.typewriter();
    const timers = haulStinger(haul?.rating ?? "none").map((st) =>
      window.setTimeout(() => {
        playStinger(st.sound, st.pitch);
        if (st.sound === "stamp") {
          setStamp(true);
          shake(4, 380);
        }
      }, st.at),
    );
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [haul?.rating]);

  if (!haul) return null;
  const gained = entries(haul.gained)
    .filter(([, v]) => v >= 0.005)
    .sort((a, b) => b[1] * (RESOURCES[b[0]].market ?? 40) - a[1] * (RESOURCES[a[0]].market ?? 40));
  const rating = RATING_TABLE.find((r) => r.id === haul.rating) ?? RATING_TABLE[RATING_TABLE.length - 1];
  const royal = haul.rating === "royal";
  const tier = isMedalTier(haul.rating) ? haul.rating : null;
  // the honest breakdown (EN-5) when the engine sends it; v1 hauls only know the total
  const parts = haul.suspicionParts;
  const suspTotal = parts?.total ?? haul.suspicion;
  const curio = haul.curio ? CURIOS[haul.curio] : undefined;
  const vigilance = haul.vigilance ?? 0;

  return (
    <div className="absolute inset-0 z-10 flex items-start justify-center overflow-y-auto bg-black/60 p-3">
      <HazardStyles />
      {/* md:my-auto centres the card where it fits; a taller card (a phone in landscape) scrolls from its top */}
      <article
        className="relative w-full max-w-md rounded-sm border border-[#8a7a5c] p-4 text-[#2a2118] shadow-[0_18px_50px_rgba(0,0,0,.8)] md:my-auto md:p-5"
        style={{
          animation: reduced ? undefined : "rr-card .55s cubic-bezier(.2,.8,.3,1) both",
          background: "radial-gradient(ellipse at 30% 20%, rgba(255,250,235,.55), transparent 60%), radial-gradient(ellipse at 80% 90%, rgba(120,90,50,.18), transparent 55%), #e6d6b6",
        }}
      >
        <header className="relative border-b-4 border-double border-[#2a2118] pb-1.5 text-center">
          <p className="whitespace-nowrap font-display text-[10px] font-bold uppercase tracking-[0.16em] text-[#5a4a35] sm:tracking-[0.32em] md:text-[11px]">
            <span className="sm:hidden">Экстренный выпуск</span>
            <span className="max-sm:hidden">Крысиные Ведомости · экстренный выпуск</span>
          </p>
          <h3 className="px-12 font-display text-2xl font-bold leading-tight sm:px-14 md:text-3xl">{haul.title}</h3>
          {chip && (
            <p className="mt-1 flex justify-center px-12 sm:px-14">
              <span className="rounded-sm border border-[#2a2118]/50 bg-[#2a2118]/10 px-2 py-0.5 text-xs font-bold leading-tight text-[#3a2c1c]">{chip}</span>
            </p>
          )}
          {/* the struck medal, pinned over the double rule */}
          <div className="absolute -right-2 bottom-0 w-[60px] translate-y-[36%] sm:-right-3 sm:w-[72px]">
            <HaulMedal tier={tier} bonus={rating.bonus} reduced={reduced} />
          </div>
        </header>

        <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 py-3 pr-10 font-mono text-base font-bold sm:pr-12 md:text-lg">
          {gained.map(([r, v], i) => (
            <li key={r} className="flex min-w-0 items-center gap-1.5" title={RESOURCES[r].name}>
              <span className="text-xl leading-none">{RESOURCES[r].icon}</span>
              <RollUp value={v} delay={i * 110} onTick={i === 0 ? odoTick : undefined} />
            </li>
          ))}
          {gained.length === 0 && <li className="col-span-2 font-sans text-sm font-normal italic">Ни крошки. Старейшины хмурятся.</li>}
        </ul>

        <div className="grid grid-cols-1 gap-x-4 gap-y-1 border-t border-[#2a2118]/40 pt-2 text-sm sm:grid-cols-2">
          <p>
            Поймано{" "}
            <b className="font-mono tabular">
              {fmtInt(haul.caughtCount)}/{fmtInt(haul.totalCount)}
            </b>{" "}
            ({fmtPct(haul.share)})
          </p>
          <p className={cx(royal && "text-[#8a5a00]")}>
            {haul.rating === "none" ? (
              <span className="italic">Без рейтинга (меньше 40%)</span>
            ) : (
              <>
                <b>{rating.name}</b>
                {rating.bonus > 0 && <span className="font-mono"> +{fmtPct(rating.bonus)}</span>}
              </>
            )}
          </p>
          {haul.combo > 0 && (
            <p>
              Лучшее комбо <b className="font-mono">×{fmtInt(haul.combo)}</b>
            </p>
          )}
          {showSusp && suspTotal !== 0 && (
            <p className="sm:col-span-2">
              Подозрение:{" "}
              {parts ? (
                <>
                  проход <b className="font-mono text-[#9a2a1f]">{signed(parts.pass)}</b>
                  {parts.lantern !== 0 && (
                    <>
                      {" "}
                      · фонарь <b className="font-mono text-[#9a2a1f]">{signed(parts.lantern)}</b>
                    </>
                  )}
                </>
              ) : (
                <b className={cx("font-mono", suspTotal > 0 ? "text-[#9a2a1f]" : "text-[#3d6b2a]")}>{signed(suspTotal)}</b>
              )}{" "}
              👁
            </p>
          )}
          {vigilance > 0 && (
            <p className="sm:col-span-2" title="Чем выше подозрение (больше 50), тем зорче люди берегут своё добро">
              Бдительность людей <b className="font-mono text-[#9a2a1f]">−{fmtPct(vigilance)}</b>
            </p>
          )}
          {haul.jackpotSeconds !== undefined && haul.jackpotSeconds > 0 && (
            <p className="font-bold text-[#8a5a00] sm:col-span-2">Джекпот: ≈ {fmtTime(haul.jackpotSeconds)} дохода</p>
          )}
          {curio && (
            <p className="font-bold text-[#6a4a10] sm:col-span-2">
              Экспонат: {curio.icon} «{curio.name}»
            </p>
          )}
        </div>

        {(haul.notes.length > 0 || haul.crash) && (
          <ul className="mt-2 space-y-0.5 border-t border-[#2a2118]/40 pt-2 text-sm">
            {haul.notes.map((n) => (
              <li key={n} className={cx(n.includes("ДЖЕКПОТ") && "font-bold text-[#8a5a00]", n.includes("Авария") && "font-bold text-[#9a2a1f]")}>
                ◆ {n}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 flex items-end justify-between gap-3">
          {/* SC-4: «Тем временем наверху» — the human paper's line about this pass (engine pickHumanHeadline) */}
          <div className="max-w-[60%] -rotate-[1.5deg] border border-[#b9a67f] bg-[#efe4c9] px-2 py-1 text-[#2a2018] shadow-[0_2px_5px_rgba(0,0,0,.35)]">
            <p className="border-b border-[#2a2018]/40 font-serif text-[9px] font-bold uppercase tracking-[0.2em]">Тем временем наверху</p>
            <p className="font-serif text-[12px] italic leading-snug">{haul.headline ?? "Люди наверху ничего не заметили. Ну, почти."}</p>
          </div>
          <BrassButton
            size="lg"
            className="min-h-11 shrink-0"
            autoFocus={kbdFocus}
            data-autofocus=""
            onKeyDown={(e) => {
              // a Space held for the paw (auto-repeat) or Enter / Space mashed on the last pile must not close the card
              // unread: a prevented keydown neither arms the button for keyup nor clicks it
              if ((e.key === " " || e.key === "Enter") && (e.repeat || sceneNow() - shownAt.current < CARRY_MS)) e.preventDefault();
            }}
            onClick={() => act({ a: "dismiss" })}
          >
            Дальше
          </BrassButton>
        </div>

        {stamp && approved && (
          <div className="pointer-events-none absolute right-3 top-[38%] md:right-5" style={{ animation: reduced ? undefined : "rr-pop .35s ease-out both" }}>
            <span
              className="inline-block -rotate-[9deg] rounded border-[3px] border-double px-2 py-1 text-center font-display text-xs font-bold uppercase leading-tight tracking-widest md:text-sm"
              style={{ color: royal ? "#a0700a" : "#9a1f1f", borderColor: royal ? "#a0700a" : "#9a1f1f", background: "rgba(255,255,255,.12)", mixBlendMode: "multiply" }}
            >
              Одобрено
              <br />
              путейским братством
            </span>
          </div>
        )}
      </article>
    </div>
  );
}

const HaulCard = memo(HaulCardImpl, (a, b) => a.scene.seq === b.scene.seq && a.scene.phaseStart === b.scene.phaseStart);
export default HaulCard;
