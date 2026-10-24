"use client";

/**
 * Toast stack (top-right on desktop, top-centre on phones) and the big one-at-a-time banners:
 * medal coat of arms, «ЭКСТРЕННЫЙ ВЫПУСК» newspaper plate, «АВРАЛ!». Fed by the engine fx bus.
 */
import { useEffect, useRef, useState } from "react";
import { HEADLINES } from "@/game/data/headlines";
import { ACHIEVEMENTS, EXPRESS_STAGES } from "@/game/data/meta";
import { ZONES } from "@/game/data/zones";
import { onFx } from "@/game/fx";
import { useGame } from "@/game/store";
import type { AchievementId, Fx, SceneEventId, ZoneId } from "@/game/types";
import { cx } from "@/components/ui/kit";
import HudStyles from "./HudStyles";

type Tone = "info" | "good" | "bad" | "gold";

interface ToastItem {
  id: number;
  icon: string;
  text: string;
  tone: Tone;
  ms: number;
  train?: { id: SceneEventId; inSec: number; at: number };
  leaving?: boolean;
}

type Banner =
  | { id: number; k: "medal"; medal: AchievementId }
  | { id: number; k: "zone"; zone: ZoneId }
  | { id: number; k: "frenzy" };

const MAX_TOASTS = 4;
const TOAST_MS = 4000;
const BANNER_MS = { medal: 2500, zone: 2600, frenzy: 1500 } as const;
const OUT_MS = 260;

let seq = 0;

export default function Toasts() {
  const calm = useGame((s) => s.game.settings.reducedMotion);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [banners, setBanners] = useState<Banner[]>([]);

  useEffect(() => {
    const push = (t: Omit<ToastItem, "id">) => setToasts((list) => [...list.filter((x) => !x.leaving), { ...t, id: ++seq }].slice(-MAX_TOASTS));
    const banner = (b: Banner) => setBanners((list) => (list.length > 6 ? list : [...list, b]));
    const handle = (fx: Fx) => {
      switch (fx.k) {
        case "toast":
          push({ icon: fx.icon ?? "📣", text: fx.text, tone: fx.tone ?? "info", ms: TOAST_MS });
          break;
        case "vagrants":
          push({ icon: "🐀", text: "Запах крошек привлёк гостей: +2 крысы", tone: "good", ms: TOAST_MS });
          break;
        case "expressStage": {
          const name = EXPRESS_STAGES[fx.stage - 1] ?? `этап ${fx.stage}`;
          push({ icon: "🚂", text: `Крысиный экспресс, этап ${fx.stage}/10: «${name}» готов!`, tone: "gold", ms: TOAST_MS + 1000 });
          break;
        }
        case "trainSoon": {
          if (!useGame.getState().game.settings.trainToasts) break;
          const at = performance.now() + fx.inSec * 1000;
          const icon = fx.id === "capsule" ? "📯" : fx.id === "royal_express" ? "👑" : "🚂";
          const item: ToastItem = { id: ++seq, icon, text: "", tone: "gold", ms: 8000, train: { id: fx.id, inSec: fx.inSec, at } };
          // the new countdown replaces the old one (the whistle moved the train: two clocks would disagree)
          setToasts((list) => [...list.filter((x) => !x.leaving && !x.train), item].slice(-MAX_TOASTS));
          break;
        }
        case "medal":
          banner({ id: ++seq, k: "medal", medal: fx.id });
          break;
        case "zoneOpen":
          banner({ id: ++seq, k: "zone", zone: fx.zone });
          break;
        case "frenzy":
          banner({ id: ++seq, k: "frenzy" });
          break;
        default:
          break;
      }
    };
    return onFx(handle);
  }, []);

  const dismiss = (id: number) => {
    setToasts((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    window.setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), OUT_MS);
  };

  const current = banners[0] ?? null;
  const nextBanner = () => setBanners((list) => list.slice(1));

  return (
    <div className={cx(calm && "hud-calm")}>
      <HudStyles />
      <div
        className={cx(
          "pointer-events-none fixed inset-x-2 z-40 flex flex-col items-center gap-1.5 transition-[top] duration-300 md:inset-x-auto md:right-[412px] md:items-end xl:right-[472px]",
          // make room under a banner instead of hiding behind it
          current ? "top-[146px] md:top-[236px]" : "top-[52px] md:top-[192px]",
        )}
        aria-live="polite"
        role="status"
      >
        {toasts.map((t) => (
          <Toast key={t.id} t={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
      {current && <BannerView key={current.id} b={current} onDone={nextBanner} />}
    </div>
  );
}

/* ------------------------------------------------------------ toast */

const TONE: Record<Tone, string> = {
  info: "border-brass-dark/80 bg-gradient-to-b from-panel-2 to-panel text-parchment",
  good: "border-verdigris/70 bg-gradient-to-b from-[#1f3b33] to-panel text-parchment",
  bad: "border-danger/80 bg-gradient-to-b from-[#4a1d18] to-panel text-parchment",
  gold: "border-gaslight/80 bg-gradient-to-b from-[#4a3818] to-panel text-parchment shadow-[0_0_14px_rgba(242,184,75,.35)]",
};

function Toast({ t, onDismiss }: { t: ToastItem; onDismiss: () => void }) {
  const timer = useRef(0);
  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  });

  useEffect(() => {
    timer.current = window.setTimeout(() => dismissRef.current(), t.ms);
    return () => window.clearTimeout(timer.current);
  }, [t.ms]);

  return (
    <div
      className={cx(
        "pointer-events-auto relative flex w-full max-w-[360px] items-start gap-2 overflow-hidden rounded-md border px-2.5 py-2 text-[13px] leading-snug shadow-[0_6px_18px_rgba(0,0,0,.55)] md:w-[340px]",
        TONE[t.tone],
        t.leaving ? "hud-toast-out" : "hud-toast-in",
      )}
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse") window.clearTimeout(timer.current);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse") timer.current = window.setTimeout(() => dismissRef.current(), 1500);
      }}
    >
      <span className="mt-px shrink-0 text-lg leading-none" aria-hidden>
        {t.icon}
      </span>
      <div className="min-w-0 flex-1">{t.train ? <TrainToastBody train={t.train} onGo={onDismiss} /> : <span>{t.text}</span>}</div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Закрыть"
        className="-mr-1.5 -mt-1.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded text-parchment-dim hover:bg-black/20 hover:text-parchment"
      >
        ✕
      </button>
      {/* life fuse */}
      <span
        className="absolute inset-x-0 bottom-0 h-[2px] origin-left bg-current opacity-30"
        style={{ animation: t.leaving ? undefined : `hud-fuse ${t.ms}ms linear both` }}
      />
    </div>
  );
}

function TrainToastBody({ train, onGo }: { train: NonNullable<ToastItem["train"]>; onGo: () => void }) {
  const [left, setLeft] = useState(train.inSec);
  useEffect(() => {
    const iv = window.setInterval(() => setLeft(Math.max(0, Math.ceil((train.at - performance.now()) / 1000))), 250);
    return () => window.clearInterval(iv);
  }, [train.at]);
  const what = train.id === "capsule" ? "капсула" : train.id === "royal_express" ? "Королевский экспресс" : "поезд";
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span>
        <b className="font-display text-[15px] tracking-wide text-gaslight">К путям!</b>{" "}
        {what} через <b className="font-mono tabular">{left}</b> с
      </span>
      <button
        type="button"
        onClick={() => {
          focusColony();
          onGo();
        }}
        className="inline-flex min-h-10 items-center rounded border border-brass-dark bg-gradient-to-b from-brass-light via-brass to-brass-dark px-2.5 text-xs font-bold text-soot shadow-[inset_0_1px_0_rgba(255,255,255,.45),0_2px_0_#4a3a1a] active:translate-y-px md:min-h-8"
      >
        К перрону
      </button>
    </div>
  );
}

/** Bring the colony view into sight (it is always on screen in the default layout; this helps zoomed/odd viewports). */
function focusColony() {
  const el = document.querySelector("main > section");
  if (el instanceof HTMLElement) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

/* ------------------------------------------------------------ banners */

function BannerView({ b, onDone }: { b: Banner; onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  });
  useEffect(() => {
    const ms = BANNER_MS[b.k];
    const t1 = window.setTimeout(() => setLeaving(true), ms);
    const t2 = window.setTimeout(() => doneRef.current(), ms + 360);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [b.k]);

  const enter = b.k === "medal" ? "hud-banner-drop" : b.k === "zone" ? "hud-banner-spin" : "hud-banner-slam";
  return (
    <div
      className={cx("pointer-events-none fixed left-1/2 top-[54px] z-40 w-max max-w-[calc(100vw-24px)] md:top-[60px]", leaving ? "hud-banner-out" : enter)}
      style={{ transform: "translate(-50%,0)" }}
      role="status"
      aria-live="assertive"
    >
      {b.k === "medal" ? <MedalBanner id={b.medal} /> : b.k === "zone" ? <ZoneBanner zone={b.zone} /> : <FrenzyBanner />}
    </div>
  );
}

function MedalBanner({ id }: { id: AchievementId }) {
  const def = ACHIEVEMENTS[id];
  return (
    <div className="relative flex items-center gap-3 rounded-lg border-2 border-brass bg-gradient-to-b from-[#3a2c18] via-panel-2 to-panel px-3 py-2 pr-5 shadow-[0_0_0_1px_#4a3a1a,0_10px_30px_rgba(0,0,0,.65),0_0_30px_rgba(242,184,75,.3)]">
      <CoatOfArms icon={def.icon} />
      <div className="min-w-0">
        <div className="font-display text-[11px] font-bold uppercase tracking-[0.3em] text-brass">Медаль Ратрополиса</div>
        <div className="hud-brass-text truncate font-display text-xl font-bold leading-tight sm:text-2xl">{def.name}</div>
        <div className="text-xs text-parchment-dim">
          {def.desc} · <span className="font-bold text-good">+1% ко всему</span>
        </div>
      </div>
    </div>
  );
}

/** Shield with laurels and the medal icon. */
function CoatOfArms({ icon }: { icon: string }) {
  return (
    <span className="relative inline-flex h-14 w-14 shrink-0 items-center justify-center">
      <svg viewBox="-30 -30 60 60" className="hud-rays absolute -inset-2 h-[72px] w-[72px] opacity-60" aria-hidden>
        {Array.from({ length: 12 }, (_, i) => (
          <path key={i} d="M0 0 L-3 -30 L3 -30Z" fill="#f2b84b" opacity=".35" transform={`rotate(${i * 30})`} />
        ))}
      </svg>
      <svg viewBox="-24 -26 48 52" className="absolute inset-0 h-14 w-14" aria-hidden>
        <defs>
          <linearGradient id="hud-shield" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#e8c983" />
            <stop offset=".5" stopColor="#c9a25a" />
            <stop offset="1" stopColor="#7d5f2c" />
          </linearGradient>
        </defs>
        {/* laurels */}
        {[-1, 1].map((s) => (
          <g key={s} transform={`scale(${s},1)`}>
            {Array.from({ length: 5 }, (_, i) => (
              <ellipse key={i} cx={-19 + i * 1.2} cy={14 - i * 7} rx={2.2} ry={4.4} fill="#4f9d8a" transform={`rotate(${-35 + i * 9} ${-19 + i * 1.2} ${14 - i * 7})`} />
            ))}
          </g>
        ))}
        <path d="M-15 -20 H15 V2 C15 13 6 19 0 23 C-6 19 -15 13 -15 2Z" fill="url(#hud-shield)" stroke="#4a3a1a" strokeWidth="1.5" />
        <path d="M-11.5 -16.5 H11.5 V2 C11.5 10.5 4.5 15.5 0 18.5 C-4.5 15.5 -11.5 10.5 -11.5 2Z" fill="#231c16" />
        <path d="M-6 -24 L-3 -20 L0 -25 L3 -20 L6 -24 L5 -19 H-5Z" fill="#f2b84b" stroke="#7d5f2c" strokeWidth=".6" />
      </svg>
      <span className="relative -mt-1 text-[22px] leading-none">{icon}</span>
    </span>
  );
}

function ZoneBanner({ zone }: { zone: ZoneId }) {
  const lines = HEADLINES[`zone_${zone}`] ?? [];
  const head = (lines[0] ?? `КРЫСЫ ОСВОИЛИ: ${ZONES[zone].name.toUpperCase()}!`).replace(/^ЭКСТРЕННЫЙ ВЫПУСК:\s*/, "");
  const sub = lines[1] ?? ZONES[zone].ratLine;
  return (
    <div className="hud-paper w-[min(92vw,520px)] rounded-sm border-2 border-[#2a1f14] px-4 py-2.5 text-center shadow-[0_14px_36px_rgba(0,0,0,.7)]">
      <div className="flex items-center justify-between border-b-2 border-[#2a1f14] pb-0.5 font-display text-[10px] font-bold uppercase tracking-[0.2em]">
        <span>№ {ZONES[zone].order}</span>
        <span>Крысиные Ведомости</span>
        <span>{ZONES[zone].icon}</span>
      </div>
      <div className="mt-1 font-display text-[11px] font-bold uppercase tracking-[0.35em] text-[#8a2a1f]">Экстренный выпуск</div>
      <div className="font-display text-[22px] font-bold uppercase leading-[1.05] tracking-wide sm:text-[28px]">{head}</div>
      <div className="hud-rule mt-1.5 pt-1 text-[12px] italic leading-snug text-[#4a3826]">{sub}</div>
    </div>
  );
}

function FrenzyBanner() {
  return (
    <div className="relative rounded-md border-2 border-gaslight bg-gradient-to-b from-[#7a2620] via-danger to-[#5a1c17] px-6 py-1.5 text-center shadow-[0_0_0_2px_#3a120f,0_0_34px_rgba(242,184,75,.65)]">
      <div
        className="hud-shine font-display text-[34px] font-bold uppercase leading-none tracking-[0.12em] text-transparent sm:text-[42px]"
        style={{
          backgroundImage: "linear-gradient(100deg,#f2b84b 0%,#fff1c9 25%,#f2b84b 45%,#e8c983 70%,#fff1c9 85%,#f2b84b 100%)",
          WebkitBackgroundClip: "text",
          backgroundClip: "text",
          filter: "drop-shadow(0 2px 0 rgba(0,0,0,.6))",
        }}
      >
        Аврал!
      </div>
      <div className="text-[11px] font-bold uppercase tracking-[0.25em] text-parchment">Все бегают, все пищат, все тащат</div>
    </div>
  );
}
