"use client";

/**
 * "Медали" (PA-7): the medal cabinet (+1% each) grouped into Колония / События и поезда / Мета / Секретные, with
 * progress on counter medals and no spoilers (medals of zones the colony never reached show «???»), trophies,
 * the «Журнал путейца» (car kinds and train variants by best rating), the two-scale bestiary with the share of
 * lines seen, the run chronicle with colony records, and lifetime statistics.
 * One pre-formatted model, sampled three times a second (PA-1).
 */
import { memo, useMemo, useState } from "react";
import { EVENT_LINE_POOLS, EVENT_LINES, RATING_TABLE, TRAIN_CARS, TRAIN_VARIANTS, TRAIN_VARIANT_ORDER } from "@/game/data/events";
import { ACHIEVEMENT_ORDER, ACHIEVEMENTS } from "@/game/data/meta";
import { districtName } from "@/game/data/zones";
import { RECORD_LABEL, fmtRunTime } from "@/game/engine/actions";
import { achievementProgress } from "@/game/engine/progress";
import { useSampled } from "@/game/useSampled";
import type { AchievementId, EventId, GameState, HaulRating, RecordKey, RunStats, SceneEventId, TrainCarKind, ZoneId } from "@/game/types";
import { fmt, fmtInt, fmtTime } from "@/lib/format";
import { Badge, cx } from "@/components/ui/kit";
import { isFresh } from "./alerts";
import { SectionTitle, Toolbar } from "./common";

const TROPHIES: { id: string; icon: string; name: string; desc: string }[] = [
  { id: "cat_fur", icon: "🐈‍⬛", name: "Клок шерсти", desc: "Вырван у Кота Мурзифера в честном бою" },
  { id: "broken_pipe", icon: "🎶", name: "Сломанная дудка", desc: "Отобрана у Крысолова. Больше не поёт" },
];

const BESTIARY: EventId[] = ["carriage", "purse", "shiny", "capsule", "downpour", "market", "cat", "ratcatcher", "metro_train", "royal_express"];

const STATS: { key: keyof RunStats | "playSeconds" | "coinsEver"; label: string; fmt?: (n: number) => string }[] = [
  { key: "playSeconds", label: "Время под землёй", fmt: fmtTime },
  { key: "coinsEver", label: "Монеток за всё время", fmt },
  { key: "births", label: "Родилось крысят" },
  { key: "clicks", label: "Кликов по решётке" },
  { key: "autoClicks", label: "Заводных кликов" },
  { key: "carriages", label: "Экипажей" },
  { key: "purses", label: "Кошельков" },
  { key: "capsules", label: "Пневмокапсул" },
  { key: "trains", label: "Поездов пережито" },
  { key: "expresses", label: "Королевских экспрессов" },
  { key: "downpours", label: "Ливней" },
  { key: "cats", label: "Котов замечено" },
  { key: "catsBeaten", label: "Котов отогнано" },
  { key: "ratcatchers", label: "Крысоловов" },
  { key: "pipersBroken", label: "Дудок сломано" },
  { key: "sparksHit", label: "Искр задето" },
  { key: "bestCombo", label: "Лучшее комбо" },
  { key: "lanternMax", label: "Под фонарём (рекорд)" },
  { key: "hookPerfects", label: "Идеальных крюков" },
];

const GROUPS: { id: "colony" | "events" | "meta" | "secret"; title: string }[] = [
  { id: "colony", title: "Колония" },
  { id: "events", title: "События и поезда" },
  { id: "meta", title: "Мета" },
  { id: "secret", title: "Секретные" },
];

/** The zone a medal belongs to: unearned medals of a zone the colony never reached stay «???» (no spoilers). */
const MEDAL_ZONE: Partial<Record<AchievementId, ZoneId>> = {
  sewers_open: "sewers",
  cellars_open: "cellars",
  metro_open: "metro",
  terminal_open: "terminal",
  first_capsule: "sewers",
  dry_paws: "sewers",
  cat_bonked: "cellars",
  cat_nightmare: "cellars",
  piper_broken: "cellars",
  first_train: "metro",
  royal_haul: "metro",
  combo_25: "metro",
  hook_perfect: "metro",
  first_rail: "metro",
  clean_car_10: "metro",
  no_spark: "metro",
  gold_streak: "metro",
  ties_survivor: "metro",
  full_consist: "metro",
  royal_retinue: "terminal",
  coronation: "terminal",
  long_train: "terminal",
  tail_horizon: "terminal",
  again_throne: "terminal",
};

const JOURNAL_CARS: TrainCarKind[] = ["engine", "tender", "third", "dining", "mail", "first", "baggage", "royal"];
const RECORD_KEYS: RecordKey[] = ["sewers", "cellars", "metro", "terminal", "coronation"];

interface MedalTile {
  id: AchievementId;
  has: boolean;
  /** "secret": only «🔒»; "spoiler": «???»; "open": name and goal. */
  show: "open" | "spoiler" | "secret";
  progress: string | null;
  frac: number;
  fresh: boolean;
}

interface MedalsModel {
  earned: number;
  tiles: MedalTile[];
  best: string;
  trophies: string[];
  seen: string[];
  lines: Partial<Record<SceneEventId, number>>;
  cars: Partial<Record<TrainCarKind, HaulRating>>;
  variants: Partial<Record<string, HaulRating>>;
  records: { what: string; time: string }[];
  history: { district: string; time: string; eRun: string; crowns: number; crowned: boolean; best: string }[];
  stats: string[];
}

/** Everything the cabinet shows, numbers pre-formatted (sampled 3×/s, PA-1). */
function medalsModel(s: GameState): MedalsModel {
  const meta = s.meta;
  const reached = (z: ZoneId) => !!s.zones[z] || meta.achievements[`${z}_open` as AchievementId] !== undefined;
  const tiles = ACHIEVEMENT_ORDER.map((id): MedalTile => {
    const def = ACHIEVEMENTS[id];
    const has = meta.achievements[id] !== undefined;
    const zone = MEDAL_ZONE[id];
    const show = has ? "open" : def.secret ? "secret" : zone && !reached(zone) ? "spoiler" : "open";
    const p = show === "open" && !has ? achievementProgress(s, id) : null;
    return { id, has, show, progress: p ? `${fmtInt(p.cur)}/${fmtInt(p.goal)}` : null, frac: p ? p.cur / p.goal : 0, fresh: has && isFresh(s, `md_${id}`) };
  });
  return {
    earned: tiles.filter((t) => t.has).length,
    tiles,
    best: meta.bestRating,
    trophies: meta.trophies,
    seen: meta.seenEvents,
    lines: Object.fromEntries(Object.entries(meta.seenLines).map(([k, v]) => [k, v?.length ?? 0])),
    cars: meta.carLog,
    variants: meta.variantLog,
    records: RECORD_KEYS.filter((k) => meta.records[k] !== undefined).map((k) => ({ what: RECORD_LABEL[k], time: fmtRunTime(meta.records[k] ?? 0) })),
    history: [...meta.history].reverse().map((h) => ({
      district: districtName(h.district),
      time: fmtRunTime(h.seconds),
      eRun: fmt(h.eRun),
      crowns: h.crowns,
      crowned: h.coronationAt !== undefined,
      best: RATING_TABLE.find((r) => r.id === h.bestRating)?.icon || "—",
    })),
    stats: STATS.map((st) => (st.fmt ?? fmtInt)(meta.lifetime[st.key])),
  };
}

export default function MedalsTab() {
  const json = useSampled((s) => JSON.stringify(medalsModel(s.game)), 3, Object.is);
  const m = useMemo(() => JSON.parse(json) as MedalsModel, [json]);
  const best = RATING_TABLE.find((r) => r.id === m.best);
  const tilesKey = useMemo(() => JSON.stringify(m.tiles), [m.tiles]);

  return (
    <>
      <Toolbar icon="🏅" title="Медали Ратрополиса" right={<Badge tone="good">+{m.earned}% ко всему</Badge>} />
      <p className="mb-2 text-[11px] leading-snug text-parchment-dim">
        Получено {m.earned} из {ACHIEVEMENT_ORDER.length}. Каждая медаль — +1% ко всему производству, навсегда, даже после переселения.
      </p>
      <MedalCabinet tilesKey={tilesKey} />

      <SectionTitle>Трофеи</SectionTitle>
      <div className="grid grid-cols-2 gap-1.5">
        {TROPHIES.map((t) => {
          const has = m.trophies.includes(t.id);
          return (
            <div key={t.id} className={cx("rounded-lg border p-2 text-center", has ? "border-brass-dark bg-brass/10" : "border-dashed border-line bg-black/20")}>
              <div className={cx("text-2xl", !has && "rr-silhouette")}>{t.icon}</div>
              <p className={cx("font-display text-sm font-bold", has ? "text-brass-light" : "text-parchment-dim")}>{has ? t.name : "Пустая полка"}</p>
              <p className="text-[10px] leading-tight text-parchment-dim">{has ? t.desc : "Трофей ещё предстоит добыть"}</p>
            </div>
          );
        })}
      </div>

      <SectionTitle>Журнал путейца</SectionTitle>
      <Journal carsKey={JSON.stringify(m.cars)} variantsKey={JSON.stringify(m.variants)} />

      <SectionTitle>Бестиарий</SectionTitle>
      <Bestiary seenKey={m.seen.join(",")} linesKey={JSON.stringify(m.lines)} />

      <SectionTitle>Летопись забегов</SectionTitle>
      {m.records.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-1.5">
          {m.records.map((r) => (
            <li key={r.what} className="rounded border border-gaslight/50 bg-gaslight/10 px-1.5 py-0.5 text-[11px] text-parchment">
              ⏱️ {r.what}: <b className="font-mono tabular text-gaslight">{r.time}</b>
            </li>
          ))}
        </ul>
      )}
      {m.history.length ? (
        <div className="mb-2 overflow-hidden rounded-md border border-line">
          <table className="w-full table-fixed text-[11px]">
            <thead className="bg-black/30 text-[10px] uppercase tracking-wider text-parchment-dim">
              <tr>
                <th className="w-[34%] px-1.5 py-1 text-left font-bold">Район</th>
                <th className="px-1 py-1 text-right font-bold">Время</th>
                <th className="px-1 py-1 text-right font-bold">🪙</th>
                <th className="px-1 py-1 text-right font-bold">👑</th>
                <th className="w-8 px-1 py-1 text-center font-bold">ул.</th>
              </tr>
            </thead>
            <tbody>
              {m.history.map((h, i) => (
                <tr key={i} className="border-t border-line/50">
                  <td className="truncate px-1.5 py-1 text-parchment">
                    {h.crowned && <span title="Коронация в этом забеге">👑 </span>}
                    {h.district}
                  </td>
                  <td className="px-1 py-1 text-right font-mono tabular text-parchment-dim">{h.time}</td>
                  <td className="px-1 py-1 text-right font-mono tabular text-parchment">{h.eRun}</td>
                  <td className="px-1 py-1 text-right font-mono tabular text-brass-light">+{fmtInt(h.crowns)}</td>
                  <td className="px-1 py-1 text-center">{h.best}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mb-2 rounded-md border border-dashed border-line bg-black/20 px-2.5 py-2 text-[11px] text-parchment-dim">Первая страница летописи откроется после Великого Переселения.</p>
      )}
      <div className="mb-2 flex items-center justify-between rounded-md border border-line bg-black/25 px-2.5 py-1.5">
        <span className="text-xs text-parchment-dim">Лучший рейтинг поезда</span>
        <span className="font-display text-sm font-bold text-brass-light">{best && best.id !== "none" ? `${best.icon} ${best.name}` : "— пока нет"}</span>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 rounded-md border border-line bg-black/20 px-2.5 py-2 text-[11px]">
        {STATS.map((st, i) => (
          <div key={st.key} className="flex min-w-0 items-baseline justify-between gap-2 border-b border-line/40 py-0.5">
            <dt className="truncate text-parchment-dim">{st.label}</dt>
            <dd className="shrink-0 font-mono tabular text-parchment">{m.stats[i]}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}

/** The medal cabinet in four groups of compact tiles; a tap shows the medal's line under its group. */
const MedalCabinet = memo(function MedalCabinet({ tilesKey }: { tilesKey: string }) {
  const tiles = JSON.parse(tilesKey) as MedalTile[];
  const [sel, setSel] = useState<AchievementId | null>(null);
  return (
    <div className="space-y-2">
      {GROUPS.map((g) => {
        const list = tiles.filter((t) => (ACHIEVEMENTS[t.id].group ?? "colony") === g.id);
        if (!list.length) return null;
        const got = list.filter((t) => t.has).length;
        const picked = list.find((t) => t.id === sel);
        return (
          <section key={g.id}>
            <p className="mb-1 flex items-baseline justify-between text-[10px] font-bold uppercase tracking-[0.18em] text-brass">
              <span>{g.title}</span>
              <span className="font-mono tracking-normal text-parchment-dim">
                {got}/{list.length}
              </span>
            </p>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(3.6rem,1fr))] gap-1">
              {list.map((t) => (
                <MedalTileView key={t.id} t={t} selected={t.id === sel} onPick={() => setSel((v) => (v === t.id ? null : t.id))} />
              ))}
            </div>
            {picked && <MedalLine t={picked} />}
          </section>
        );
      })}
    </div>
  );
});

function MedalTileView({ t, selected, onPick }: { t: MedalTile; selected: boolean; onPick: () => void }) {
  const def = ACHIEVEMENTS[t.id];
  const name = t.show === "secret" ? "🔒" : t.show === "spoiler" ? "???" : def.name;
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={selected}
      title={t.show === "open" ? `${def.name}: ${def.desc}` : t.show === "secret" ? "Секретная медаль" : "Ещё не открыто"}
      className={cx(
        "relative flex min-w-0 flex-col items-center gap-0.5 rounded-md border px-0.5 pb-1 pt-1.5 text-center",
        t.has ? "border-brass-dark bg-gradient-to-b from-brass/15 to-panel" : "border-line bg-black/20",
        selected && "outline outline-2 outline-gaslight",
      )}
    >
      <span
        className={cx(
          "grid h-8 w-8 place-items-center rounded-full border-2 text-base",
          t.has ? "border-brass bg-gradient-to-b from-brass-light/30 to-brass-dark/30 shadow-[0_0_8px_rgba(242,184,75,.3)]" : "border-line bg-black/30",
        )}
      >
        <span className={cx(!t.has && "rr-silhouette")}>{t.show === "open" ? def.icon : t.show === "secret" ? "🔒" : "❔"}</span>
      </span>
      <span className={cx("line-clamp-2 w-full text-[9px] font-bold leading-[11px]", t.has ? "text-brass-light" : "text-parchment-dim")}>{name}</span>
      {t.progress && (
        <span className="w-full px-0.5">
          <span className="block h-0.5 overflow-hidden rounded-full bg-black/50">
            <span className="block h-full bg-gaslight" style={{ width: `${Math.round(t.frac * 100)}%` }} />
          </span>
          <span className="block font-mono text-[8px] leading-tight text-parchment-dim tabular">{t.progress}</span>
        </span>
      )}
      {t.fresh && <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-gaslight shadow-[0_0_6px_var(--gaslight)]" aria-label="новая" />}
    </button>
  );
}

function MedalLine({ t }: { t: MedalTile }) {
  const def = ACHIEVEMENTS[t.id];
  if (t.show === "secret") return <p className="mt-1 rounded border border-line/60 bg-black/25 px-2 py-1 text-[11px] text-parchment-dim">🔒 Секретная медаль. Условие узнаете, когда получите.</p>;
  if (t.show === "spoiler") return <p className="mt-1 rounded border border-line/60 bg-black/25 px-2 py-1 text-[11px] text-parchment-dim">??? Колония ещё не добралась туда, где её вручают.</p>;
  return (
    <p className="mt-1 rounded border border-line/60 bg-black/25 px-2 py-1 text-[11px] leading-snug text-parchment">
      <b className="text-brass-light">
        {def.icon} {def.name}
      </b>{" "}
      — {def.desc}
      {t.progress && <span className="text-parchment-dim"> ({t.progress})</span>}
      {t.has && <span className="text-good"> · +1% ко всему{def.reward ? ` · ${def.reward}` : ""}</span>}
    </p>
  );
}

const RATING_COLOR: Record<HaulRating, string> = { none: "#7a6b57", bronze: "#b8693d", silver: "#a9b2b6", gold: "#d4af37", royal: "#f2b84b" };

/** «Журнал путейца»: a stamp per car kind and train variant with the best rating it rode in; unseen ones dashed. */
const Journal = memo(function Journal({ carsKey, variantsKey }: { carsKey: string; variantsKey: string }) {
  const cars = JSON.parse(carsKey) as Partial<Record<TrainCarKind, HaulRating>>;
  const variants = JSON.parse(variantsKey) as Partial<Record<string, HaulRating>>;
  const stamp = (key: string, icon: string, name: string, r: HaulRating | undefined) => {
    const row = r ? RATING_TABLE.find((x) => x.id === r) : null;
    return (
      <div
        key={key}
        title={r ? `${name}: лучший улов — ${row?.name ?? "—"}` : `${name}: ещё не встречался`}
        className={cx("flex min-w-0 flex-col items-center rounded-md border px-0.5 py-1 text-center", r ? "bg-black/25" : "border-dashed border-line/70 bg-black/10")}
        style={r ? { borderColor: RATING_COLOR[r] } : undefined}
      >
        <span className={cx("text-lg leading-none", !r && "rr-silhouette")}>{icon}</span>
        <span className="line-clamp-1 w-full text-[9px] leading-tight text-parchment-dim">{name}</span>
        <span className="text-[10px] leading-tight" style={{ color: r ? RATING_COLOR[r] : undefined }}>
          {r ? (row?.icon || "·") : "—"}
        </span>
      </div>
    );
  };
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(3.6rem,1fr))] gap-1">{JOURNAL_CARS.map((k) => stamp(k, TRAIN_CARS[k].icon, TRAIN_CARS[k].name, cars[k]))}</div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(3.6rem,1fr))] gap-1">
        {TRAIN_VARIANT_ORDER.map((v) => stamp(v, TRAIN_VARIANTS[v].icon, TRAIN_VARIANTS[v].name, variants[v]))}
      </div>
    </div>
  );
});

/** Two-scale bestiary with «реплик увидено x/y»; re-renders only when something new is seen. */
const Bestiary = memo(function Bestiary({ seenKey, linesKey }: { seenKey: string; linesKey: string }) {
  const seen = new Set(seenKey.split(","));
  const lines = JSON.parse(linesKey) as Partial<Record<SceneEventId, number>>;
  return (
    <ul className="space-y-1.5">
      {BESTIARY.map((id) => {
        const l = EVENT_LINES[id];
        const known = seen.has(id);
        const pool = (EVENT_LINE_POOLS as Partial<Record<EventId, unknown[]>>)[id];
        return (
          <li key={id} className={cx("flex gap-2.5 rounded-lg border p-2", known ? "border-line bg-panel/60" : "border-dashed border-line/70 bg-black/20")}>
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-black/30 text-lg">
              <span className={cx(!known && "rr-silhouette")}>{l.icon}</span>
            </span>
            <div className="min-w-0 flex-1">
              <p className={cx("flex items-baseline justify-between gap-2 font-display text-sm font-bold leading-tight", known ? "text-parchment" : "text-parchment-dim")}>
                <span>{known ? l.name : "???"}</span>
                {known && pool && (
                  <span className="shrink-0 font-sans text-[10px] font-normal text-parchment-dim">
                    реплик увидено {Math.min(pool.length, lines[id as SceneEventId] ?? 0)}/{pool.length}
                  </span>
                )}
              </p>
              {known ? (
                <>
                  <p className="text-[11px] leading-snug text-parchment-dim">
                    👤 <i>«{l.human}»</i>
                  </p>
                  <p className="text-[11px] leading-snug text-parchment">
                    🐀 <i>«{l.rat}»</i>
                  </p>
                </>
              ) : (
                <p className="text-[11px] leading-snug text-parchment-dim">Ещё не встречалось. Крысы шепчутся, но толком никто не видел.</p>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
});
