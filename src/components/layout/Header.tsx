"use client";

/**
 * The masthead: title, the human clock with the district chip (md+), rats, suspicion, crowns, sound and settings.
 * One compact row (~44 px); on phones the title shrinks to a crest, the date and the chip hide (the clock's tooltip
 * still names the district and its trait).
 */
import { memo } from "react";
import { sfx } from "@/audio/sfx";
import { districtName, districtTrait } from "@/game/data/zones";
import { humanClock } from "@/game/engine/formulas";
import { suspicionInfo } from "@/game/engine/hints";
import { derivedOf, useGame } from "@/game/store";
import { useSampled } from "@/game/useSampled";
import { cx } from "@/components/ui/kit";
import { fmt, fmtInt, fmtRate, fmtTime } from "@/lib/format";
import { humanActivity, humanDate, pad } from "./clock";
import FloatTip from "./FloatTip";
import HudStyles from "./HudStyles";

export default function Header() {
  const calm = useGame((s) => s.game.settings.reducedMotion);
  return (
    <header
      className={cx(
        "relative z-30 flex min-h-11 shrink-0 items-center gap-x-2 gap-y-0.5 border-b border-brass-dark/70 bg-gradient-to-b from-panel-2 via-panel to-soot-2 px-2 py-0.5 shadow-[inset_0_1px_0_rgba(232,201,131,.14),0_2px_8px_rgba(0,0,0,.45)] sm:gap-x-3 sm:px-4",
        calm && "hud-calm",
      )}
    >
      <HudStyles />
      <Title />
      <Clock />
      <div className="ml-auto flex min-w-0 items-center gap-1.5 sm:gap-2.5">
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
    <div className="flex shrink-0 items-center gap-2">
      <Crest />
      <div className="hidden flex-col leading-none sm:flex">
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
  const district = useGame((s) => s.game.meta.district);
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
        Район колонии: {districtName(district)} · {districtTrait(district).icon} {districtTrait(district).name}
      </span>
    </span>
  );
  return (
    <div className="flex min-h-10 min-w-0 shrink flex-col justify-center leading-none">
      <FloatTip tip={tip} className="min-w-0" width={260}>
        <span className="flex min-h-5 min-w-0 cursor-default items-center whitespace-nowrap font-mono text-[12px] tabular text-parchment max-md:min-h-10 sm:text-[13px]">
          <span className="text-brass-light">{d.wd}</span>
          <span className="hidden sm:inline">
            , {d.date} {d.month} {d.year}
          </span>
          <span className="text-brass-dark">&nbsp;·&nbsp;</span>
          <span className="font-bold">{time}</span>
        </span>
      </FloatTip>
      <DistrictChip district={district} className="min-w-0 max-md:hidden" />
    </div>
  );
}

/** «🧺 Саутварк · Боро-маркет»: the district this run lives in and its trait; the perk and the quirk in the tooltip. */
function DistrictChip({ district, className }: { district: number; className?: string }) {
  const trait = districtTrait(district);
  const name = districtName(district);
  const tip = (
    <span className="block">
      <span className="block font-display text-sm font-bold text-brass-light">
        {trait.icon} {name}: «{trait.name}»
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
    <FloatTip tip={tip} width={270} className={className}>
      <span className="mt-0.5 inline-flex min-w-0 max-w-full cursor-default items-center gap-1 rounded-full border border-brass-dark/60 bg-soot/50 px-1.5 py-px font-display text-[11px] font-semibold leading-tight tracking-wide text-parchment-dim">
        <span aria-hidden>{trait.icon}</span>
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
          <span className="text-parchment-dim">/{fmtInt(housing)}</span>
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
  if (!shown) return null;
  const color = suspicionColor(pct);
  const alarm = pct >= 80;
  return (
    <FloatTip tip={<SuspicionTip />} width={270}>
      <span className="flex min-h-10 cursor-default items-center gap-1 whitespace-nowrap font-mono text-[12px] tabular sm:text-[13px]">
        <span aria-hidden className={cx(alarm && "hud-throb inline-block")}>
          👁
        </span>
        <span className="relative hidden h-2 w-10 overflow-hidden rounded-full bg-black/50 shadow-[inset_0_1px_2px_rgba(0,0,0,.7)] min-[400px]:block md:w-14">
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
      eta: i.etaSec === null ? -1 : Math.round(i.etaSec),
      reducers: i.reducers.map((r) => `${r.label} ${r.amount}`).join(", "),
    };
  }, 2);
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
      {info.pct >= 100 ? (
        <span className="block font-bold text-danger-light">Крысолов уже на пороге!</span>
      ) : (
        info.eta > 0 && (
          <span className="block">
            <b className="font-mono tabular">≈ {fmtTime(info.eta)}</b> до Крысолова
          </span>
        )
      )}
      <span className="mt-1 block text-parchment-dim">Снижают: {info.reducers}.</span>
      <span className="mt-1 block text-parchment-dim">Чем выше, тем чаще заглядывает Кот, а на 100% является Крысолов с дудочкой.</span>
      {info.pct >= 80 && info.pct < 100 && <span className="block text-danger-light">Наверху уже шепчутся о крысолове!</span>}
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
      onClick={() => useGame.getState().setTab("settings")}
    >
      <span className={cx("inline-block transition-transform duration-500", active && "rotate-90")}>⚙</span>
    </button>
  );
}
