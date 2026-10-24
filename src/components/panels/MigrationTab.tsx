"use client";

/**
 * "Переселение" (GDD 10, v2 PA-6): district, its trait and the human weekday, crown forecast, the Rat King's portrait,
 * the Great Seals, royal edicts with ranks I·II·III and their decrees, and the Great Migration button with a
 * confirmation card built from engine migrationPreview() (what the crowns will buy, the next district and its trait).
 * The tab samples one pre-formatted model three times a second; cards are memoized (PA-1).
 */
import { memo, useMemo, useState } from "react";
import { EDICT_ORDER, EDICTS, SEAL_ORDER, SEALS } from "@/game/data/meta";
import { districtName, districtTrait } from "@/game/data/zones";
import { edictRank } from "@/game/engine/core";
import { canMigrate, crownsForRun, nextCrownAt, prevCrownAt } from "@/game/engine/formulas";
import { humanWeekday, migrationPreview } from "@/game/engine/narrative";
import { emitUiFx } from "@/game/fx";
import { useGame } from "@/game/store";
import type { EdictId, GameState, SealId } from "@/game/types";
import { useSampled } from "@/game/useSampled";
import { fmt, fmtInt } from "@/lib/format";
import { Badge, Bar, BrassButton, Stamp, cx } from "@/components/ui/kit";
import { isFresh } from "./alerts";
import { SectionTitle, Toolbar, plural } from "./common";
import KingPortrait from "./KingPortrait";

const KEPT = [
  "венцы 👑 (свободные и полученные за всё время)",
  "королевские указы и печати",
  "медали, рекорды и летопись",
  "номер района и день недели",
  "трофеи, Бестиарий, журнал путейца",
  "настройки; по указам — часть улучшений и этапы экспресса",
];
const RESET = [
  "ресурсы, крысы, постройки",
  "улучшения и зоны",
  "подозрение, проекты, грамоты",
  "таймеры событий и 🪙 за забег",
  "человеческие часы — снова 05:00",
];

const ROMAN = ["", "I", "II", "III"];

interface EdictRow {
  id: EdictId;
  owned: boolean;
  ok: boolean;
  fresh: boolean;
  rank: number;
  maxRank: number;
  /** Cost of the next rank, 0 = none on sale (unranked, max rank or no coronation yet). */
  rankCost: number;
  rankOk: boolean;
}

interface SealRow {
  id: SealId;
  owned: boolean;
  active: boolean;
  ok: boolean;
}

interface MigrationModel {
  district: string;
  trait: string;
  weekday: string;
  migrations: number;
  gilded: boolean;
  crowned: boolean;
  crowns: string;
  crownsEver: string;
  pct: string;
  per: number;
  ready: boolean;
  metro: boolean;
  /** Crowns this run would carry away. */
  gain: number;
  coronated: boolean;
  charters: number;
  e: string;
  eDone: boolean;
  first: boolean;
  to: string;
  /** Progress from the current crown to the next one, 1% steps. */
  frac: number;
  left: string;
  preview: { bonusBefore: string; bonusAfter: string; buys: string[]; nextDistrict: string; weekday: string; trait: string };
  swapOpen: boolean;
  seals: SealRow[];
  edicts: EdictRow[];
}

function traitLine(i: number): string {
  const t = districtTrait(i);
  return `${t.icon} ${t.name}: ${t.perk} · ${t.quirk}`;
}

function migrationModel(s: GameState): MigrationModel {
  const meta = s.meta;
  const per = meta.edicts.kings_favor ? 3 : 2;
  const e = s.eRun;
  const first = e < 1e6;
  const from = first ? 0 : prevCrownAt(s);
  const to = first ? 1e6 : nextCrownAt(s);
  const ranksOn = meta.achievements.coronation !== undefined;
  const p = migrationPreview(s);
  return {
    district: districtName(meta.district),
    trait: traitLine(meta.district),
    weekday: humanWeekday(s),
    migrations: meta.migrations,
    gilded: meta.achievements.before_noon !== undefined,
    crowned: meta.achievements.coronation !== undefined,
    crowns: fmtInt(meta.crowns),
    crownsEver: fmtInt(meta.crownsEver),
    pct: fmt(per * meta.crownsEver),
    per,
    ready: canMigrate(s),
    metro: !!s.zones.metro,
    gain: crownsForRun(s),
    coronated: s.coronatedThisRun,
    charters: s.charters,
    e: fmt(e),
    eDone: e >= 1e6,
    first,
    to: fmt(to),
    frac: to > from ? Math.floor(((e - from) / (to - from)) * 100) / 100 : 1,
    left: fmt(Math.max(0, to - e)),
    preview: {
      bonusBefore: fmt(p.bonusBefore),
      bonusAfter: fmt(p.bonusAfter),
      buys: [...p.affordable.map((id) => `${EDICTS[id].icon} ${EDICTS[id].name}`), ...p.affordableRanks.map((x) => `${EDICTS[x.id].icon} ${EDICTS[x.id].name} ${ROMAN[x.rank]}`)],
      nextDistrict: p.nextDistrict,
      weekday: p.weekday,
      trait: `${p.nextTrait.icon} ${p.nextTrait.name}: ${p.nextTrait.perk} · ${p.nextTrait.quirk}`,
    },
    swapOpen: s.time < 60,
    seals: SEAL_ORDER.map((id) => {
      const owned = meta.sealsOwned.includes(id);
      return { id, owned, active: meta.seal === id && owned, ok: !owned && meta.crowns >= SEALS[id].cost };
    }),
    edicts: EDICT_ORDER.map((id) => {
      const owned = !!meta.edicts[id];
      const ok = !owned && meta.crowns >= EDICTS[id].cost;
      const ranks = EDICTS[id].ranks;
      const rank = edictRank(s, id);
      const maxRank = 1 + (ranks?.length ?? 0);
      const rankCost = ranksOn && ranks && owned && rank < maxRank ? ranks[rank - 1].cost : 0;
      return { id, owned, ok, fresh: ok && isFresh(s, `e_${id}`), rank, maxRank, rankCost, rankOk: rankCost > 0 && meta.crowns >= rankCost };
    }),
  };
}

export default function MigrationTab() {
  const json = useSampled((s) => JSON.stringify(migrationModel(s.game)), 3, Object.is);
  const m = useMemo(() => JSON.parse(json) as MigrationModel, [json]);
  const tails = 1 + m.migrations;

  return (
    <>
      <Toolbar icon="👑" title="Великое Переселение" />

      {/* newspaper masthead */}
      <div className="rounded-sm border border-[#b9a67f] bg-gradient-to-b from-[#efe4c9] to-[#ddcba3] px-3 py-2 text-soot shadow-[0_3px_10px_rgba(0,0,0,.5)]">
        <p className="border-b border-soot/40 pb-0.5 text-center font-display text-[11px] font-bold tracking-[0.3em]">КРЫСИНЫЕ ВЕДОМОСТИ</p>
        <h3 className="mt-1 text-center font-display text-xl font-bold leading-tight">Район: {m.district}</h3>
        <p className="text-center text-[11px] font-bold leading-snug">{m.trait}</p>
        <p className="text-center text-[11px] italic">
          Наверху {m.weekday} · переселений: {m.migrations}
        </p>
      </div>

      <div className="mt-3 grid grid-cols-[7.5rem_minmax(0,1fr)] gap-3">
        <div>
          <KingPortrait tails={tails} gilded={m.gilded} crowned={m.crowned} />
          <p className="mt-0.5 text-center text-[10px] leading-tight text-parchment-dim">
            Его Величество · {tails} {plural(tails, "хвост", "хвоста", "хвостов")}
          </p>
        </div>
        <div className="min-w-0 space-y-2">
          <Stat label="Венцы в казне" value={`${m.crowns} 👑`} />
          <Stat label="Получено за всё время" value={`${m.crownsEver} 👑`} />
          <Stat label="Бонус ко всему" value={`+${m.pct}%`} sub={`по ${m.per}% за каждый венец`} good />
        </div>
      </div>

      <SectionTitle>Прогноз венцов</SectionTitle>
      <Forecast m={m} />

      <MigrateBox m={m} />

      {(m.crowned || m.seals.some((x) => x.owned)) && (
        <>
          <SectionTitle>Великие печати</SectionTitle>
          <p className="-mt-1 mb-1.5 text-[11px] leading-snug text-parchment-dim">
            Действует одна печать. Купленную можно сделать главной бесплатно — {m.swapOpen ? "сейчас, пока идёт первая минута забега" : "сменить можно в начале забега"}.
          </p>
          <div className="space-y-1.5">
            {m.seals.map((x) => (
              <SealCard key={x.id} id={x.id} owned={x.owned} active={x.active} ok={x.ok} swapOpen={m.swapOpen} />
            ))}
          </div>
        </>
      )}

      <SectionTitle>Королевские указы</SectionTitle>
      {m.crowned && <p className="-mt-1 mb-1.5 text-[11px] leading-snug text-parchment-dim">После коронации указы можно переподписать: ранги II и III.</p>}
      <div className="space-y-1.5">
        {m.edicts.map((ed) => (
          <EdictCard key={ed.id} row={ed} />
        ))}
      </div>
    </>
  );
}

const Stat = memo(function Stat({ label, value, sub, good }: { label: string; value: string; sub?: string; good?: boolean }) {
  return (
    <div className="rounded-md border border-line bg-black/25 px-2.5 py-1.5">
      <p className="text-[10px] font-bold uppercase tracking-wider text-parchment-dim">{label}</p>
      <p className={cx("font-mono text-lg leading-tight tabular", good ? "text-good" : "text-brass-light")}>{value}</p>
      {sub && <p className="text-[10px] leading-tight text-parchment-dim">{sub}</p>}
    </div>
  );
});

function Forecast({ m }: { m: MigrationModel }) {
  return (
    <div className="rounded-md border border-line bg-black/20 p-2.5">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-parchment-dim">🪙 за забег</span>
        <span className="font-mono tabular text-parchment">
          {m.e} / {m.to}
        </span>
      </div>
      <Bar value={m.frac} color="var(--gaslight)" className="mt-1 h-2" glow={!m.first} />
      <p className="mt-1.5 text-sm leading-snug text-parchment">
        {m.first ? (
          <>
            Первые <b className="text-brass-light">10 👑</b> — при 1M 🪙 за забег. Осталось {m.left} 🪙.
          </>
        ) : (
          <>
            Сейчас: <b className="text-brass-light">+{fmtInt(m.gain)} 👑</b>. Следующий через <b className="font-mono">{m.left}</b> 🪙
          </>
        )}
      </p>
      {m.coronated && <p className="mt-0.5 text-[11px] text-good">Коронация в этом забеге: венцов ×1.25</p>}
      {m.charters > 0 && (
        <p className="mt-0.5 text-[11px] text-good">
          Королевские грамоты: {m.charters} · венцов ×{Math.min(1.5, Math.pow(1.05, m.charters)).toFixed(2)}
        </p>
      )}
      <p className="mt-0.5 text-[10px] leading-snug text-parchment-dim">Считаются все монетки забега: пассив, клики, поезда. Траты не вычитаются.</p>
    </div>
  );
}

function MigrateBox({ m }: { m: MigrationModel }) {
  const [step, setStep] = useState<0 | 1>(0);

  if (!m.ready) {
    const metro = m.metro;
    return (
      <div className="mt-3 rounded-md border border-dashed border-line bg-black/20 px-3 py-2.5 text-xs leading-snug text-parchment-dim">
        <p className="font-display text-sm font-bold text-parchment">Великое Зловоние ещё не наступило</p>
        <p className="mt-1">
          Старейшины уведут колонию, когда {metro ? "" : "она доберётся до Станции подземки и "}за забег будет добыто 1M 🪙
          {metro ? ` (сейчас ${m.e})` : ""}.
        </p>
        <ul className="mt-1.5 space-y-0.5">
          <li className={metro ? "text-good" : ""}>{metro ? "✓" : "○"} Станция подземки открыта</li>
          <li className={m.eDone ? "text-good" : ""}>
            {m.eDone ? "✓" : "○"} 1M 🪙 за забег
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
  const p = m.preview;

  return (
    <div className="mt-3">
      {step === 0 ? (
        <BrassButton size="lg" className="rr-glow min-h-14 w-full" onClick={() => setStep(1)}>
          <span className="block font-display text-lg leading-tight tracking-wider">👑 Великое Переселение</span>
          <span className="block text-xs font-bold opacity-80">унести в новый район +{fmtInt(m.gain)} 👑</span>
        </BrassButton>
      ) : (
        <div className="rounded-md border-2 border-brass bg-gradient-to-b from-[#efe4c9] to-[#d8c59a] p-3 text-soot shadow-[0_0_24px_rgba(242,184,75,.3)]">
          <p className="text-center font-display text-[11px] font-bold tracking-[0.25em]">ЭКСТРЕННЫЙ ВЫПУСК</p>
          <p className="text-center font-display text-lg font-bold leading-tight">ВЕЛИКОЕ ЗЛОВОНИЕ!</p>
          <p className="mt-1 text-center text-xs italic">
            Люди перекладывают канализацию. Колония с узелками уходит в {p.nextDistrict}.
          </p>
          <ul className="mt-2 space-y-1 rounded border border-soot/25 bg-white/30 px-2 py-1.5 text-[12px] leading-snug">
            <li>
              <b>+{fmtInt(m.gain)} 👑</b> → бонус ко всему +{p.bonusBefore}% → <b>+{p.bonusAfter}%</b>
            </li>
            <li>
              <b>Хватит на:</b> {p.buys.length ? p.buys.join(", ") : "пока ни на один указ — копите венцы"}
            </li>
            <li>
              <b>Новый район:</b> {p.nextDistrict} · {p.weekday} — {p.trait}
            </li>
          </ul>
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

const SealCard = memo(function SealCard({ id, owned, active, ok, swapOpen }: { id: SealId; owned: boolean; active: boolean; ok: boolean; swapOpen: boolean }) {
  const def = SEALS[id];
  return (
    <div
      className={cx(
        "relative flex items-center gap-2.5 overflow-hidden rounded-lg border p-2",
        active ? "border-gaslight bg-gradient-to-b from-[#3b2c12] to-panel shadow-[0_0_12px_rgba(242,184,75,.25)]" : owned ? "border-good/40 bg-good/5" : ok ? "border-brass bg-panel-2" : "border-line bg-panel/60",
      )}
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border-2 border-[#7a2620] bg-[#a23a2c] text-xl shadow-[inset_0_2px_4px_rgba(0,0,0,.4)]">{def.icon}</span>
      <div className="min-w-0 flex-1">
        <p className={cx("font-display text-[15px] font-bold leading-tight", active ? "text-gaslight" : "text-parchment")}>{def.name}</p>
        <p className="text-[11px] leading-snug text-parchment-dim">{def.effect}</p>
      </div>
      {active ? (
        <Stamp color="var(--gaslight)" className="shrink-0">
          действует
        </Stamp>
      ) : owned ? (
        <BrassButton size="sm" tone="ghost" className="min-h-10 shrink-0 text-xs" disabled={!swapOpen} title={swapOpen ? undefined : "Сменить можно в начале забега"} onClick={() => useGame.getState().setSeal(id)}>
          Сделать главной
        </BrassButton>
      ) : (
        <BrassButton size="sm" className="min-h-10 min-w-16 shrink-0 font-mono" disabled={!ok} onClick={() => useGame.getState().buySeal(id)}>
          {def.cost} 👑
        </BrassButton>
      )}
    </div>
  );
});

/** I·II·III: filled pips up to the rank. */
function RankPips({ rank, max }: { rank: number; max: number }) {
  if (max <= 1) return null;
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`ранг ${ROMAN[rank] || "—"} из ${ROMAN[max]}`}>
      {Array.from({ length: max }, (_, i) => (
        <span
          key={i}
          className={cx("grid h-4 min-w-4 place-items-center rounded-sm border px-0.5 font-display text-[9px] font-bold leading-none", i < rank ? "border-gaslight bg-gaslight/25 text-gaslight" : "border-line text-parchment-dim/60")}
        >
          {ROMAN[i + 1]}
        </span>
      ))}
    </span>
  );
}

const EdictCard = memo(function EdictCard({ row }: { row: EdictRow }) {
  const { id, owned, ok, fresh, rank, maxRank, rankCost, rankOk } = row;
  const def = EDICTS[id];
  const nextEffect = rankCost > 0 ? def.ranks?.[rank - 1]?.effect : undefined;
  const effect = owned && rank > 1 ? (def.ranks?.[rank - 2]?.effect ?? def.effect) : def.effect;
  return (
    <div
      data-target={`e_${id}`}
      className={cx(
        "relative scroll-my-16 overflow-hidden rounded-lg border p-2",
        owned ? "border-good/40 bg-good/5" : ok ? "border-brass bg-gradient-to-b from-panel-3 to-panel" : "border-line bg-panel/60",
      )}
    >
      {(ok || rankOk) && <span className="rr-sheen" aria-hidden />}
      <div className="flex items-center gap-2.5">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-black/40 bg-black/30 text-xl">{def.icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={cx("font-display text-[15px] font-bold leading-tight", owned ? "text-good" : "text-parchment")}>{def.name}</span>
            <RankPips rank={rank} max={maxRank} />
            {fresh && <Badge tone="verdigris">по карману</Badge>}
          </div>
          <p className="text-[11px] leading-snug text-parchment-dim">{effect}</p>
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
      <p className="mt-1 pl-[50px] font-serif text-[11px] italic leading-snug text-parchment/80">«{def.decree}»</p>
      {rankCost > 0 && (
        <div className="mt-1.5 flex items-center gap-2 pl-[50px]">
          <p className="min-w-0 flex-1 text-[11px] leading-snug text-parchment-dim">{nextEffect}</p>
          <BrassButton size="sm" className="min-h-9 shrink-0 text-xs" disabled={!rankOk} onClick={() => useGame.getState().buyEdictRank(id)}>
            Переподписать ({ROMAN[rank + 1]}) — {fmtInt(rankCost)} 👑
          </BrassButton>
        </div>
      )}
    </div>
  );
});
