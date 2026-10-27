"use client";

/**
 * The masthead: title, the human clock with the district chip (md+), rats, suspicion, crowns, sound and settings.
 * One compact row (~44 px); on phones the title shrinks to a crest, the date and the chip hide (the clock's tooltip
 * still names the district and its trait). v3 (SHL-3): short screens (a phone in landscape) keep the crest only and
 * drop the 44-px minimum; the notch pads the top. The right group never shrinks, so ⚙ always stays on screen; the
 * left part gives way by container queries, which measure in the header's own (zoomed) pixels and so follow
 * «Размер текста» as well as the screen: the title's name, then the date, the weekday and the crest, and the time
 * itself goes only when not even «17:30» fits (never clipped mid-digit). A header under 368 px (a 360-px phone, any
 * phone with the text enlarged) also drops the rats' «/max» (the tooltip has it).
 */
import { memo } from "react";
import { sfx } from "@/audio/sfx";
import { districtInfo, districtInfoOf, type DistrictInfo } from "@/game/data/districts";
import { humanClock } from "@/game/engine/formulas";
import { suspicionInfo } from "@/game/engine/hints";
import { derivedOf, useGame } from "@/game/store";
import { useSampled } from "@/game/useSampled";
import { cx } from "@/components/ui/kit";
import { ResGlyph } from "@/components/ui/ResGlyph";
import { fmt, fmtInt, fmtRate, fmtTime } from "@/lib/format";
import { humanActivity, humanDate, pad } from "./clock";
import FloatTip from "./FloatTip";
import HudStyles from "./HudStyles";

export default function Header() {
  const calm = useGame((s) => s.game.settings.reducedMotion);
  return (
    <header
      className={cx(
        // safe area: the notch pads the top (viewport-fit=cover); short screens drop the 44-px minimum (the buttons keep 40)
        "@container/hdr relative z-30 flex min-h-11 shrink-0 items-center gap-x-2 gap-y-0.5 border-b border-brass-dark/70 bg-gradient-to-b from-panel-2 via-panel to-soot-2 px-2 pb-0.5 pt-[max(2px,env(safe-area-inset-top))] shadow-[inset_0_1px_0_rgba(232,201,131,.14),0_2px_8px_rgba(0,0,0,.45)] short:min-h-0 short:pb-0 short:pt-[env(safe-area-inset-top)] sm:gap-x-3 sm:px-4",
        calm && "hud-calm",
      )}
    >
      <HudStyles />
      {/* the left part takes the room the right group leaves and decides what of the title and the clock fits in it */}
      <div className="@container/left flex min-w-0 flex-1 items-center gap-x-2 sm:gap-x-3">
        <Title />
        <Clock />
      </div>
      {/* the right group never shrinks: the left part gives way so ⚙ stays on screen at any text scale */}
      <div className="flex shrink-0 items-center gap-1.5 @max-[368px]/hdr:gap-1 sm:gap-2.5">
        <Rats />
        <Suspicion />
        <Crowns />
        <div className="flex items-center gap-0.5">
          <SoundButton />
          <GearButton />
        </div>
      </div>
      {/* brass hairline */}
      <span className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-brass/70 to-transparent" />
    </header>
  );
}

/* ------------------------------------------------------------ title */

const Title = memo(function Title() {
  return (
    // the crest goes when the left part could not keep «17:30» beside it
    <div className="flex shrink-0 items-center gap-2 @max-[76px]/left:hidden">
      <Crest />
      {/* the name gives way first: on short screens, and wherever it would squeeze the clock below «Вт · 17:30» */}
      <div className="hidden flex-col leading-none @min-[344px]/left:flex short:hidden">
        <span className="hud-brass-text font-display text-[17px] font-bold tracking-wide lg:text-lg">Ratropolis Underground</span>
        <span className="mt-0.5 font-display text-[10px] font-semibold uppercase tracking-[0.28em] text-parchment-dim">Крысиный мегаполис</span>
      </div>
    </div>
  );
});

/** A small brass cog with a rat's profile: the colony's coat of arms. */
function Crest() {
  const teeth = Array.from({ length: 10 }, (_, i) => i * 36);
  return (
    <svg viewBox="-16 -16 32 32" className="h-7 w-7 shrink-0 drop-shadow-[0_1px_1px_rgba(0,0,0,.7)]" aria-hidden>
      <defs>
        <radialGradient id="hud-crest" cx="35%" cy="30%" r="80%">
          <stop offset="0" stopColor="#fff1c9" />
          <stop offset=".45" stopColor="#c9a25a" />
          <stop offset="1" stopColor="#5e4520" />
        </radialGradient>
      </defs>
      {teeth.map((a) => (
        <rect key={a} x={-2.6} y={-15.5} width={5.2} height={6} rx={1} fill="url(#hud-crest)" transform={`rotate(${a})`} />
      ))}
      <circle r={11.5} fill="url(#hud-crest)" stroke="#4a3a1a" strokeWidth={0.8} />
      <circle r={8.6} fill="#231c16" stroke="#7d5f2c" strokeWidth={0.8} />
      {/* rat profile */}
      <path d="M-6.5 3.2 C-5 -2.5 0 -4.6 3.6 -2.2 L7 0.6 L3.4 1.9 C2 4 -2.5 4.6 -6.5 3.2Z" fill="#e8c983" />
      <circle cx={-0.6} cy={-3.4} r={1.9} fill="#e8c983" />
      <circle cx={-0.6} cy={-3.4} r={0.9} fill="#b8693d" />
      <circle cx={2.6} cy={-0.6} r={0.55} fill="#231c16" />
      <path d="M-6.4 3 C-9 3.6 -9.5 6 -7.5 6.8" stroke="#e8c983" strokeWidth={0.8} fill="none" strokeLinecap="round" />
    </svg>
  );
}

/* ------------------------------------------------------------ clock */

function Clock() {
  // minute resolution: one human minute is 12 real seconds
  const totalMin = useGame((s) => Math.floor(humanClock(s.game).totalMin));
  const migrations = useGame((s) => s.game.meta.migrations);
  // the district this run lives in (v3: meta.visited, not the old fixed sequence)
  const districtId = useGame((s) => districtInfo(s.game.meta).id);
  const lap = useGame((s) => districtInfo(s.game.meta).lap);
  const district = districtInfoOf(districtId, lap);
  const day = Math.floor(totalMin / 1440);
  const m = totalMin - day * 1440;
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  const d = humanDate(migrations, day);
  const time = `${pad(hh)}:${pad(mm)}`;
  const tip = (
    <span className="block">
      <span className="block font-display text-sm font-bold text-brass-light">
        {d.wdFull[0].toUpperCase() + d.wdFull.slice(1)}, {d.date} {d.monthFull} {d.year}
      </span>
      <span className="block">Люди наверху {humanActivity(hh)}.</span>
      <span className="mt-1 block text-parchment-dim">
        Наша секунда — пять человеческих. Для людей это один день. Для крыс — целая история.
      </span>
      <span className="mt-1 block text-parchment-dim">
        Район колонии: {district.name} · <TraitIcon icon={district.trait.icon} /> {district.trait.name}
      </span>
    </span>
  );
  // The column is the `clock` container and carries the clock's monospace font, so its `ch` is one character of the
  // line: the date shows from 23.5 ch («Вт, 18 окт 1887 · 07:14»), the weekday from 10.5 ch («Вт · 07:14»), and
  // the time hides rather than clip below 5 ch (the tooltip still has all of it).
  return (
    <div className="@container/clock flex min-h-10 min-w-0 flex-1 flex-col justify-center overflow-hidden font-mono text-[12px] leading-none sm:text-[13px]">
      {/* the column clips (SHL-3): the focus rings of the clock and the chip are drawn inside their boxes */}
      <FloatTip tip={tip} className="min-w-0 max-w-full self-start rounded-sm focus-visible:-outline-offset-2" width={260}>
        <span className="flex min-h-5 min-w-0 cursor-default items-center whitespace-nowrap tabular text-parchment max-md:min-h-10">
          <span className="text-brass-light @max-[10.5ch]/clock:hidden">{d.wd}</span>
          <span className="hidden @min-[23.5ch]/clock:inline">
            , {d.date} {d.month} {d.year}
          </span>
          <span className="text-brass-dark @max-[10.5ch]/clock:hidden">&nbsp;·&nbsp;</span>
          <span className="font-bold @max-[5ch]/clock:invisible">{time}</span>
        </span>
      </FloatTip>
      <DistrictChip district={district} className="min-w-0 max-w-full self-start max-md:hidden" />
    </div>
  );
}

/** A trait's icon; the fog is drawn (🌫️ is a blank square on Windows, v3 SHL-5). */
function TraitIcon({ icon }: { icon: string }) {
  return icon === "🌫️" || icon === "🌫" ? <ResGlyph id="fog" size="1.15em" /> : <>{icon}</>;
}

/** «🧺 Саутварк · Боро-маркет»: the district this run lives in and its trait; the perk and the quirk in the tooltip. */
function DistrictChip({ district, className }: { district: DistrictInfo; className?: string }) {
  const trait = district.trait;
  const name = district.name;
  const tip = (
    <span className="block">
      <span className="block font-display text-sm font-bold text-brass-light">
        <TraitIcon icon={trait.icon} /> {name}: «{trait.name}»
      </span>
      <span className="mt-0.5 block">
        <span className="font-bold text-good">Выгода:</span> {trait.perk}
      </span>
      <span className="block">
        <span className="font-bold text-danger-light">Причуда:</span> {trait.quirk}
      </span>
      <span className="mt-1 block text-parchment-dim">Каждое Великое Переселение уводит колонию в новый район — со своим нравом.</span>
    </span>
  );
  return (
    <FloatTip tip={tip} width={270} className={cx(className, "rounded-full focus-visible:-outline-offset-2")}>
      <span className="mt-0.5 inline-flex min-w-0 max-w-full cursor-default items-center gap-1 rounded-full border border-brass-dark/60 bg-soot/50 px-1.5 py-px font-display text-[11px] font-semibold leading-tight tracking-wide text-parchment-dim">
        <span aria-hidden className="inline-flex">
          <TraitIcon icon={trait.icon} />
        </span>
        <span className="truncate">
          {name} · {trait.name}
        </span>
      </span>
    </FloatTip>
  );
}

/* ------------------------------------------------------------ rats */

function Rats() {
  const rats = useGame((s) => s.game.rats);
  const housing = useGame((s) => derivedOf(s.game).housing);
  const hungry = useGame((s) => s.game.hungry);
  const growing = useGame((s) => !!s.game.flags.vagrants && s.game.rats < derivedOf(s.game).housing && s.game.res.crumbs > 0 && !s.game.hungry);
  const birth = useGame((s) => derivedOf(s.game).birthRate);
  const full = rats >= housing;
  const tip = (
    <span className="block">
      <span className="block font-bold text-brass-light">
        Крысы: {fmtInt(rats)} из {fmtInt(housing)} мест
      </span>
      {growing && <span className="block text-good">Рождается {fmtRate(birth)}</span>}
      {full && <span className="block text-gaslight">Жильё заполнено — стройте гнёзда, иначе молодёжь не родится.</span>}
      {hungry && <span className="block text-danger-light">😟 Голод: рождение стоит, всё кроме крошек ×0.5.</span>}
    </span>
  );
  return (
    <FloatTip tip={tip}>
      <span className="flex min-h-10 cursor-default items-center gap-1 whitespace-nowrap font-mono text-[12px] tabular sm:text-[13px]">
        <span aria-hidden>{hungry ? "😟" : "🐀"}</span>
        <span>
          <span className={cx("font-bold", hungry ? "text-danger-light" : full ? "text-gaslight" : "text-parchment")}>{fmtInt(rats)}</span>
          {/* a header under 368 px (a 360-px phone, any phone with the text enlarged): «/max» gives way (the tooltip has it) */}
          <span className="text-parchment-dim @max-[368px]/hdr:hidden">/{fmtInt(housing)}</span>
        </span>
        {growing && <span className="hidden text-[10px] text-good sm:inline">({fmtRate(birth)})</span>}
      </span>
    </FloatTip>
  );
}

/* ------------------------------------------------------------ suspicion */

function suspicionColor(p: number): string {
  // green → amber → red
  const lerp = (a: number[], b: number[], t: number) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  const g = [143, 191, 90];
  const a = [242, 184, 75];
  const r = [214, 69, 58];
  const c = p < 50 ? lerp(g, a, p / 50) : lerp(a, r, (p - 50) / 50);
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function Suspicion() {
  const shown = useGame((s) => !!s.game.revealed.suspicion);
  const pct = useGame((s) => Math.floor(s.game.suspicion));
  // the district's ratcatcher threshold (100%, Мэйфэр 80%): the colour and the alarm count towards it
  const threshold = useGame((s) => derivedOf(s.game).ratcatcherAt);
  if (!shown) return null;
  const color = suspicionColor(Math.min(100, (pct * 100) / Math.max(1, threshold)));
  const alarm = pct >= threshold - 20;
  return (
    <FloatTip tip={<SuspicionTip />} width={270}>
      <span className="flex min-h-10 cursor-default items-center gap-1 whitespace-nowrap font-mono text-[12px] tabular sm:text-[13px]">
        <span aria-hidden className={cx(alarm && "hud-throb inline-block")}>
          👁
        </span>
        <span className="relative hidden h-2 w-10 overflow-hidden rounded-full bg-black/50 shadow-[inset_0_1px_2px_rgba(0,0,0,.7)] @min-[400px]/hdr:block md:w-14">
          <span
            className={cx("absolute inset-y-0 left-0 rounded-full transition-[width] duration-300", alarm && "hud-alarm")}
            style={{ width: `${pct}%`, background: `linear-gradient(90deg, #8fbf5a, ${color})` }}
          />
        </span>
        <span className="font-bold" style={{ color }}>
          {pct}%
        </span>
      </span>
    </FloatTip>
  );
}

/** Concrete numbers from suspicionInfo: the rate, the time left until the Ratcatcher, what brings it down. Mounted only while open. */
function SuspicionTip() {
  const info = useSampled((s) => {
    const i = suspicionInfo(s.game, derivedOf(s.game));
    return {
      pct: Math.floor(i.pct),
      perMin: i.perMin,
      threshold: i.threshold,
      eta: i.etaSec === null ? -1 : Math.round(i.etaSec),
      reducers: i.reducers.map((r) => `${r.label} ${r.amount}`).join(", "),
    };
  }, 2);
  // the Ratcatcher is on his way (etaSec 0) or the threshold is reached
  const coming = info.pct >= info.threshold || info.eta === 0;
  return (
    <span className="block">
      <span className="block font-bold text-brass-light">👁 Подозрение людей: {info.pct}%</span>
      {info.perMin > 0 ? (
        <span className="block">
          <b className="font-mono tabular text-gaslight">+{fmt(info.perMin)}%/мин</b>, пока вы играете <span className="text-good">(в офлайне не растёт)</span>
        </span>
      ) : (
        <span className="block">Пока не растёт: наверху колонию ещё не замечают.</span>
      )}
      {coming ? (
        <span className="block font-bold text-danger-light">Крысолов уже на пороге!</span>
      ) : (
        info.eta > 0 && (
          <span className="block">
            <b className="whitespace-nowrap font-mono tabular">≈ {fmtTime(info.eta)}</b> до Крысолова
          </span>
        )
      )}
      <span className="mt-1 block text-parchment-dim">Снижают: {info.reducers}.</span>
      <span className="mt-1 block text-parchment-dim">
        Чем выше, тем чаще заглядывает Кот, а на {info.threshold}% является Крысолов с дудочкой.
      </span>
      {!coming && info.pct >= info.threshold - 20 && <span className="block text-danger-light">Наверху уже шепчутся о крысолове!</span>}
    </span>
  );
}

/* ------------------------------------------------------------ crowns */

function Crowns() {
  const ever = useGame((s) => s.game.meta.crownsEver);
  const crowns = useGame((s) => s.game.meta.crowns);
  const favor = useGame((s) => !!s.game.meta.edicts.kings_favor);
  if (ever <= 0) return null;
  const tip = (
    <span className="block">
      <span className="block font-bold text-brass-light">👑 Венцы: {fmtInt(crowns)} в казне</span>
      <span className="block">
        Всего получено {fmtInt(ever)}: +{fmtInt(ever * (favor ? 3 : 2))}% ко всему производству.
      </span>
      <span className="block text-parchment-dim">Тратятся на королевские указы во вкладке «Переселение».</span>
    </span>
  );
  return (
    <FloatTip tip={tip}>
      <span className="flex min-h-10 cursor-default items-center gap-1 whitespace-nowrap font-mono text-[12px] font-bold tabular text-gaslight sm:text-[13px]">
        <span aria-hidden>👑</span>
        {fmtInt(crowns)}
      </span>
    </FloatTip>
  );
}

/* ------------------------------------------------------------ buttons */

const ICON_BTN =
  "inline-flex h-10 w-10 items-center justify-center rounded-md border border-transparent text-lg transition hover:border-brass-dark/70 hover:bg-panel-3/60 active:translate-y-px focus-visible:outline-2 focus-visible:outline-brass";

function SoundButton() {
  const on = useGame((s) => s.game.settings.sound);
  const volume = useGame((s) => s.game.settings.volume);
  return (
    <button
      type="button"
      className={cx(ICON_BTN, !on && "opacity-60")}
      aria-pressed={on}
      aria-label={on ? "Выключить звук" : "Включить звук"}
      title={on ? "Звук: вкл" : "Звук: выкл"}
      onClick={() => {
        const next = !on;
        sfx.unlock();
        sfx.setVolume(volume, next);
        useGame.getState().setSetting("sound", next);
        if (next) sfx.tin();
      }}
    >
      {on ? "🔊" : "🔇"}
    </button>
  );
}

function GearButton() {
  const active = useGame((s) => s.tab === "settings");
  return (
    <button
      type="button"
      className={cx(ICON_BTN, active && "border-brass-dark bg-panel-3 text-brass-light")}
      aria-label="Настройки"
      title="Настройки"
      onClick={() => useGame.getState().focus("settings")}
    >
      <span className={cx("inline-block transition-transform duration-500", active && "rotate-90")}>⚙</span>
    </button>
  );
}
