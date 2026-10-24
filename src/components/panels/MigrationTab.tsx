"use client";

/**
 * "Переселение" (GDD 10): district & weekday, crown forecast, the Rat King's portrait,
 * royal edicts and the Great Migration button with a two-step confirmation.
 */
import { useState } from "react";
import { EDICT_ORDER, EDICTS } from "@/game/data/meta";
import { WEEKDAYS_FULL, districtName } from "@/game/data/zones";
import { canMigrate, crownsForRun, nextCrownAt } from "@/game/engine/formulas";
import { emitUiFx } from "@/game/fx";
import { useGame } from "@/game/store";
import type { EdictId, GameState } from "@/game/types";
import { fmt, fmtInt } from "@/lib/format";
import { Badge, Bar, BrassButton, Stamp, cx } from "@/components/ui/kit";
import { isFresh } from "./alerts";
import { SectionTitle, Toolbar, plural } from "./common";
import KingPortrait from "./KingPortrait";

const KEPT = [
  "венцы 👑 (свободные и полученные за всё время)",
  "королевские указы",
  "медали и статистика",
  "номер района и день недели",
  "трофеи, Бестиарий, лучшие рейтинги поездов",
  "настройки; по указам — часть улучшений и этапы экспресса",
];
const RESET = [
  "ресурсы, крысы, постройки",
  "улучшения и зоны",
  "подозрение и проекты",
  "таймеры событий и 🪙 за забег",
  "человеческие часы — снова 05:00",
];

export default function MigrationTab() {
  const game = useGame((s) => s.game);
  const meta = game.meta;
  const ready = canMigrate(game);
  const crowns = crownsForRun(game);
  const pct = (meta.edicts.kings_favor ? 3 : 2) * meta.crownsEver;

  return (
    <>
      <Toolbar icon="👑" title="Великое Переселение" />

      {/* newspaper masthead */}
      <div className="rounded-sm border border-[#b9a67f] bg-gradient-to-b from-[#efe4c9] to-[#ddcba3] px-3 py-2 text-soot shadow-[0_3px_10px_rgba(0,0,0,.5)]">
        <p className="border-b border-soot/40 pb-0.5 text-center font-display text-[11px] font-bold tracking-[0.3em]">КРЫСИНЫЕ ВЕДОМОСТИ</p>
        <h3 className="mt-1 text-center font-display text-xl font-bold leading-tight">Район: {districtName(meta.district)}</h3>
        <p className="text-center text-[11px] italic">
          Наверху {WEEKDAYS_FULL[meta.district % 7]} · переселений: {meta.migrations}
        </p>
      </div>

      <div className="mt-3 grid grid-cols-[7.5rem_minmax(0,1fr)] gap-3">
        <div>
          <KingPortrait tails={1 + meta.migrations} gilded={meta.achievements.before_noon !== undefined} crowned={meta.achievements.coronation !== undefined} />
          <p className="mt-0.5 text-center text-[10px] leading-tight text-parchment-dim">
            Его Величество · {1 + meta.migrations} {plural(1 + meta.migrations, "хвост", "хвоста", "хвостов")}
          </p>
        </div>
        <div className="min-w-0 space-y-2">
          <Stat label="Венцы в казне" value={`${fmtInt(meta.crowns)} 👑`} />
          <Stat label="Получено за всё время" value={`${fmtInt(meta.crownsEver)} 👑`} />
          <Stat label="Бонус ко всему" value={`+${fmt(pct)}%`} sub={`по ${meta.edicts.kings_favor ? 3 : 2}% за каждый венец`} good />
        </div>
      </div>

      <SectionTitle>Прогноз венцов</SectionTitle>
      <Forecast s={game} crowns={crowns} />

      <MigrateBox s={game} ready={ready} crowns={crowns} />

      <SectionTitle>Королевские указы</SectionTitle>
      <div className="space-y-1.5">
        {EDICT_ORDER.map((id) => (
          <EdictCard key={id} s={game} id={id} />
        ))}
      </div>
    </>
  );
}

function Stat({ label, value, sub, good }: { label: string; value: string; sub?: string; good?: boolean }) {
  return (
    <div className="rounded-md border border-line bg-black/25 px-2.5 py-1.5">
      <p className="text-[10px] font-bold uppercase tracking-wider text-parchment-dim">{label}</p>
      <p className={cx("font-mono text-lg leading-tight tabular", good ? "text-good" : "text-brass-light")}>{value}</p>
      {sub && <p className="text-[10px] leading-tight text-parchment-dim">{sub}</p>}
    </div>
  );
}

function Forecast({ s, crowns }: { s: GameState; crowns: number }) {
  const e = s.eRun;
  const bonus = s.coronatedThisRun ? 1.25 : 1;
  const first = e < 1e6;
  const from = first ? 0 : 1e6 * Math.pow(crowns / (10 * bonus), 2);
  const to = first ? 1e6 : nextCrownAt(s);
  return (
    <div className="rounded-md border border-line bg-black/20 p-2.5">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-parchment-dim">🪙 за забег</span>
        <span className="font-mono tabular text-parchment">
          {fmt(e)} / {fmt(to)}
        </span>
      </div>
      <Bar value={e - from} max={to - from} color="var(--gaslight)" className="mt-1 h-2" glow={!first} />
      <p className="mt-1.5 text-sm leading-snug text-parchment">
        {first ? (
          <>
            Первые <b className="text-brass-light">10 👑</b> — при 1M 🪙 за забег. Осталось {fmt(1e6 - e)} 🪙.
          </>
        ) : (
          <>
            Сейчас: <b className="text-brass-light">+{fmtInt(crowns)} 👑</b>. Следующий через <b className="font-mono">{fmt(Math.max(0, to - e))}</b> 🪙
          </>
        )}
      </p>
      {s.coronatedThisRun && <p className="mt-0.5 text-[11px] text-good">Коронация в этом забеге: венцов ×1.25</p>}
      <p className="mt-0.5 text-[10px] leading-snug text-parchment-dim">Считаются все монетки забега: пассив, клики, поезда. Траты не вычитаются.</p>
    </div>
  );
}

function MigrateBox({ s, ready, crowns }: { s: GameState; ready: boolean; crowns: number }) {
  const [step, setStep] = useState<0 | 1>(0);
  const nextDistrict = districtName(s.meta.district + 1);

  if (!ready) {
    const metro = !!s.zones.metro;
    return (
      <div className="mt-3 rounded-md border border-dashed border-line bg-black/20 px-3 py-2.5 text-xs leading-snug text-parchment-dim">
        <p className="font-display text-sm font-bold text-parchment">Великое Зловоние ещё не наступило</p>
        <p className="mt-1">
          Старейшины уведут колонию, когда {metro ? "" : "она доберётся до Станции подземки и "}за забег будет добыто 1M 🪙
          {metro ? ` (сейчас ${fmt(s.eRun)})` : ""}.
        </p>
        <ul className="mt-1.5 space-y-0.5">
          <li className={metro ? "text-good" : ""}>{metro ? "✓" : "○"} Станция подземки открыта</li>
          <li className={s.eRun >= 1e6 ? "text-good" : ""}>
            {s.eRun >= 1e6 ? "✓" : "○"} 1M 🪙 за забег
          </li>
        </ul>
      </div>
    );
  }

  const go = () => {
    if (!useGame.getState().game.settings.reducedMotion) emitUiFx({ k: "shake", px: 8, ms: 600 });
    useGame.getState().migrate();
    setStep(0);
  };

  return (
    <div className="mt-3">
      {step === 0 ? (
        <BrassButton size="lg" className="rr-glow min-h-14 w-full" onClick={() => setStep(1)}>
          <span className="block font-display text-lg leading-tight tracking-wider">👑 Великое Переселение</span>
          <span className="block text-xs font-bold opacity-80">унести в новый район +{fmtInt(crowns)} 👑</span>
        </BrassButton>
      ) : (
        <div className="rounded-md border-2 border-brass bg-gradient-to-b from-[#efe4c9] to-[#d8c59a] p-3 text-soot shadow-[0_0_24px_rgba(242,184,75,.3)]">
          <p className="text-center font-display text-[11px] font-bold tracking-[0.25em]">ЭКСТРЕННЫЙ ВЫПУСК</p>
          <p className="text-center font-display text-lg font-bold leading-tight">ВЕЛИКОЕ ЗЛОВОНИЕ!</p>
          <p className="mt-1 text-center text-xs italic">
            Люди перекладывают канализацию. Колония с узелками уходит в {nextDistrict} и уносит {fmtInt(crowns)} 👑.
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] leading-snug">
            <div>
              <p className="font-bold uppercase tracking-wider text-[#2d5f53]">Уносим</p>
              <ul className="mt-0.5 list-inside list-disc">
                {KEPT.map((k) => (
                  <li key={k}>{k}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="font-bold uppercase tracking-wider text-[#7a2620]">Бросаем</p>
              <ul className="mt-0.5 list-inside list-disc">
                {RESET.map((k) => (
                  <li key={k}>{k}</li>
                ))}
              </ul>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <BrassButton tone="ghost" className="min-h-10 flex-1 text-parchment" onClick={() => setStep(0)}>
              Повременим
            </BrassButton>
            <BrassButton tone="danger" className="min-h-10 flex-[2]" onClick={go}>
              Да, уводим колонию!
            </BrassButton>
          </div>
        </div>
      )}
    </div>
  );
}

function EdictCard({ s, id }: { s: GameState; id: EdictId }) {
  const def = EDICTS[id];
  const owned = !!s.meta.edicts[id];
  const ok = !owned && s.meta.crowns >= def.cost;
  const fresh = ok && isFresh(s, `e_${id}`);
  return (
    <div
      className={cx(
        "relative flex items-center gap-2.5 overflow-hidden rounded-lg border p-2",
        owned ? "border-good/40 bg-good/5" : ok ? "border-brass bg-gradient-to-b from-panel-3 to-panel" : "border-line bg-panel/60",
      )}
    >
      {ok && <span className="rr-sheen" aria-hidden />}
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-black/40 bg-black/30 text-xl">{def.icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={cx("font-display text-[15px] font-bold leading-tight", owned ? "text-good" : "text-parchment")}>{def.name}</span>
          {fresh && <Badge tone="verdigris">по карману</Badge>}
        </div>
        <p className="text-[11px] leading-snug text-parchment-dim">{def.effect}</p>
      </div>
      {owned ? (
        <Stamp color="var(--good)" className="shrink-0">
          подписан
        </Stamp>
      ) : (
        <BrassButton size="sm" className={cx("min-h-10 min-w-16 shrink-0 font-mono", ok && "rr-breathe")} disabled={!ok} onClick={() => useGame.getState().buyEdict(id)}>
          {def.cost} 👑
        </BrassButton>
      )}
    </div>
  );
}
