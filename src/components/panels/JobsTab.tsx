"use client";

/**
 * "Работы": population stats, food balance, satiety, the assignment mode, ratio sliders
 * and one row per unlocked job: what one rat brings (in coin-equivalents), surplus/full-store tags,
 * idle brigades and who needs them, converter intake, efficiency, runway and bottleneck (GDD 4.4, PA-4).
 * Every block subscribes to its own pre-formatted JSON model, so a tick re-renders only rows whose text
 * changed (PA-1).
 */
import { memo, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { BUILDING_ORDER, BUILDINGS } from "@/game/data/buildings";
import { JOBS } from "@/game/data/jobs";
import { RESOURCES } from "@/game/data/resources";
import { UPGRADE_ORDER, UPGRADES } from "@/game/data/upgrades";
import { ZONES } from "@/game/data/zones";
import { buildingVisible, currentExpedition, upgradeVisible } from "@/game/engine/actions";
import { check } from "@/game/engine/conditions";
import { idleRats, stunnedRats, resMult, type Derived } from "@/game/engine/derive";
import { unitValue } from "@/game/engine/economy";
import { buildingCost, entries, expeditionCost, remaining } from "@/game/engine/formulas";
import { converterBottleneck, inputRunway, jobValuePerRat } from "@/game/engine/hints";
import { derivedOf, useGame } from "@/game/store";
import { JOB_IDS, type AssignMode, type GameState, type JobId, type ResId } from "@/game/types";
import { useSampled } from "@/game/useSampled";
import { fmt, fmtInt, fmtRate, fmtTime } from "@/lib/format";
import { Badge, Bar, BrassButton, ResIcon, cx } from "@/components/ui/kit";
import { isFresh } from "./alerts";
import { HoverTip, SectionTitle, Segmented, Switch, Tag, Toolbar } from "./common";

const MODE_NOTE: Record<AssignMode, string> = {
  focus: "Новорождённые идут на работу со ☆, пока там есть места, иначе — в собиратели. Пока еда в минусе, Старейшина шлёт всех кормить колонию.",
  ratios: "Сначала заполняются ограниченные места, остальные новорождённые делятся по ползункам.",
  smart: "Пневмоприказы раз в 5 с перекраивают бригады: еда в плюсе, конвертеры сыты, остальные — туда, где отдача выше. Ручные правки продержатся до следующего приказа.",
};

const RATIO_JOBS = ["forager", "pickpocket", "scavenger"] as const;

/** Net market value one more rat adds per second: outputs (jobValuePerRat) minus a converter's intake. */
function netValue(s: GameState, d: Derived, j: JobId): { value: number; surplus: boolean; capped: ResId[] } {
  const v = jobValuePerRat(s, d, j);
  return { value: v.net, surplus: v.surplus, capped: v.capped };
}

/** Has the job an output with a market price? (💨 has none: stokers only feed the boilers.) */
function priced(j: JobId): boolean {
  return entries(JOBS[j].produces).some(([r]) => unitValue(r) > 0);
}

/** «4.02K», «−0.45» (a real minus sign). */
function signed(v: number): string {
  return v < 0 ? `−${fmt(-v)}` : fmt(v);
}

/** The brigade that earns most per rat, among those whose output is not in surplus («выгоднее всего»). */
function bestJob(s: GameState): JobId | null {
  const d = derivedOf(s);
  let best: JobId | null = null;
  let top = 1e-12;
  for (const j of JOB_IDS) {
    if (j === "idle" || !check(s, JOBS[j].unlock) || !priced(j)) continue;
    const v = netValue(s, d, j);
    if (v.surplus || v.value <= top) continue;
    top = v.value;
    best = j;
  }
  return best;
}

export default function JobsTab() {
  const jobsKey = useGame((s) => JOB_IDS.filter((j) => check(s.game, JOBS[j].unlock)).join(","));
  const jobs = useMemo(() => jobsKey.split(",") as JobId[], [jobsKey]);
  const mode = useGame((s) => s.game.assignMode);
  const relay = useGame((s) => !!s.game.upgrades.rat_relay);
  const tube = useGame((s) => !!s.game.upgrades.tube_orders);
  const best = useSampled((s) => bestJob(s.game), 2, Object.is);
  const showRatios = relay && mode !== "focus";

  return (
    <>
      <Toolbar icon="🐀" title="Работы" />
      <PopulationStats />

      {relay || tube ? (
        <>
          <SectionTitle
            right={
              <HoverTip tip={MODE_NOTE[mode]}>
                <span
                  className="grid h-6 w-6 cursor-help place-items-center rounded-full border border-brass-dark text-[11px] font-bold text-brass"
                  aria-label="Как работает режим"
                >
                  ?
                </span>
              </HoverTip>
            }
          >
            Распределение
          </SectionTitle>
          <Segmented<AssignMode>
            label="Режим распределения"
            className="w-full"
            value={mode}
            onChange={(m) => useGame.getState().setAssignMode(m)}
            options={[
              { value: "focus", label: "Фокус ☆" },
              {
                value: "ratios",
                label: relay ? "Пропорции" : "🔒 Пропорции",
                disabled: !relay,
                title: relay ? "Ползунки пропорций" : "Нужно улучшение «Цепочка передачи»",
              },
              {
                value: "smart",
                label: tube ? "Умное" : "🔒 Умное",
                disabled: !tube,
                title: tube ? "Умное распределение" : "Нужно улучшение «Пневмоприказы»",
              },
            ]}
          />
          {showRatios && <Ratios />}
        </>
      ) : (
        <p className="mt-3 text-[11px] leading-snug text-parchment-dim">
          Новорождённые идут в <span className="text-gaslight">☆</span> — нажмите звезду у нужной работы.
        </p>
      )}

      <SectionTitle>Бригады</SectionTitle>
      <div className="space-y-2">
        {jobs.map((j) => (
          <JobRow key={j} j={j} best={best === j} />
        ))}
      </div>
    </>
  );
}

/* ------------------------------------------------------------ stats */

function Tile({ icon, label, tone, className, children }: { icon: string; label: string; tone?: "bad"; className?: string; children: ReactNode }) {
  return (
    <div
      className={cx(
        "min-w-0 rounded-md border bg-black/25 px-2.5 py-2 shadow-[inset_0_1px_3px_rgba(0,0,0,.5)]",
        tone === "bad" ? "border-danger/70 bg-danger/10" : "border-line",
        className,
      )}
    >
      <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-parchment-dim">
        <span className="text-xs">{icon}</span>
        {label}
      </div>
      {children}
    </div>
  );
}

interface PopModel {
  rats: string;
  housing: string;
  ratsFrac: number;
  full: boolean;
  free: string;
  birth: string;
  birthFrac: number;
  birthNote: string;
  bal: string;
  balBad: boolean;
  foodLine: string;
  hungry: boolean;
  runOut: string | null;
  idle: string;
  stunned: string | null;
  showIdle: boolean;
  satiety: { on: boolean; label: string; sub: string } | null;
}

function popModel(s: GameState, d: Derived): PopModel {
  const full = s.rats >= d.housing;
  const canBirth = !!s.flags.vagrants && !full && s.res.crumbs > 0 && !s.hungry;
  const why = !s.flags.vagrants ? "ждём бродяжек" : full ? "нет места в гнёздах" : s.hungry ? "голод: не до свадеб" : "нет крошек";
  const bal = s.gross.crumbs - d.food;
  const stunned = stunnedRats(s);
  const recover = s.stunned.reduce((a, g) => Math.max(a, g.until - s.time), 0);
  const idle = idleRats(s);
  return {
    rats: fmtInt(s.rats),
    housing: fmtInt(d.housing),
    ratsFrac: d.housing > 0 ? Math.round((s.rats / d.housing) * 50) / 50 : 0,
    full,
    free: fmtInt(d.housing - s.rats),
    birth: canBirth ? fmtRate(d.birthRate) : "—",
    birthFrac: Math.floor(s.birthProgress * 50) / 50,
    birthNote: canBirth ? `следующий писк ~${fmtTime(Math.ceil((1 - s.birthProgress) / Math.max(1e-6, d.birthRate)))}` : why,
    bal: fmtRate(bal),
    balBad: bal < 0,
    foodLine: `добыча ${fmtRate(s.gross.crumbs)} · едят −${fmt(d.food)}/с`,
    hungry: s.hungry,
    runOut: !s.hungry && bal < 0 ? fmtTime(s.res.crumbs / -bal) : null,
    idle: fmtInt(idle),
    stunned: stunned > 0 ? `✨ напуганы: ${fmtInt(stunned)} (ещё ${fmtTime(recover)})` : null,
    showIdle: idle > 0 || stunned > 0,
    satiety: s.upgrades.cheese_diet
      ? {
          on: s.satiety,
          label: s.satiety ? (d.satietyActive ? "Сытость: всё ×1.25" : "Сытость ждёт сыра") : "Сытость выключена",
          sub: s.satiety
            ? `едят −${fmt(d.satietyActive ? d.cheeseFood : 0.005 * s.rats)} 🧀/с · запас ${fmt(s.res.cheese)} 🧀`
            : `включите: ×1.25 ко всему за ${fmt(0.005 * s.rats)} 🧀/с`,
        }
      : null,
  };
}

function PopulationStats() {
  const json = useGame((s) => JSON.stringify(popModel(s.game, derivedOf(s.game))));
  const m = useMemo(() => JSON.parse(json) as PopModel, [json]);

  return (
    <div className="grid grid-cols-2 gap-2">
      <Tile icon="🐀" label="Крысы / жильё">
        <div className="font-mono text-lg leading-tight tabular text-parchment">
          {m.rats}
          <span className="text-sm text-parchment-dim"> / {m.housing}</span>
        </div>
        <Bar value={m.ratsFrac} color={m.full ? "var(--danger-light)" : "var(--brass)"} className="mt-1" />
        <p className={cx("mt-1 text-[10px] leading-tight", m.full ? "text-danger-light" : "text-parchment-dim")}>
          {m.full ? "Жильё полно — стройте гнёзда" : `свободно мест: ${m.free}`}
        </p>
      </Tile>

      <Tile icon="💕" label="Рождаемость">
        <div className="font-mono text-lg leading-tight tabular text-parchment">{m.birth}</div>
        <div className="mt-1 flex items-center gap-1.5">
          <Bar value={m.birthFrac} color="var(--copper-light)" className="flex-1" />
        </div>
        <p className="mt-1 text-[10px] leading-tight text-parchment-dim">{m.birthNote}</p>
      </Tile>

      <Tile icon="🍞" label="Еда" tone={m.hungry || m.balBad ? "bad" : undefined} className={m.showIdle ? undefined : "col-span-2"}>
        <div className={cx("font-mono text-lg leading-tight tabular", m.balBad ? "text-danger-light" : "text-good")}>{m.bal}</div>
        <p className="mt-1 text-[10px] leading-tight text-parchment-dim">{m.foodLine}</p>
        {m.hungry ? (
          <p className="mt-0.5 text-[10px] font-bold leading-tight text-danger-light">😟 ГОЛОД: всё, кроме 🍞, ×0.5; рождение стоит</p>
        ) : (
          m.runOut && <p className="mt-0.5 text-[10px] font-bold leading-tight text-danger-light">Запасов на {m.runOut} — нужны собиратели</p>
        )}
      </Tile>

      {m.showIdle && (
        <Tile icon="💤" label="Без дела">
          <div className="font-mono text-lg leading-tight tabular text-parchment">{m.idle}</div>
          {m.stunned ? (
            <p className="mt-1 text-[10px] font-bold leading-tight text-gaslight">{m.stunned}</p>
          ) : (
            <p className="mt-1 text-[10px] leading-tight text-parchment-dim">напуганных нет, все бодры</p>
          )}
        </Tile>
      )}

      {m.satiety && (
        <Tile icon="😋" label="Сытость" className="col-span-2">
          <Switch on={m.satiety.on} onToggle={() => useGame.getState().toggleSatiety()} label={m.satiety.label} sub={m.satiety.sub} />
        </Tile>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ ratios */

function Ratios() {
  const json = useGame((s) => {
    const open = RATIO_JOBS.filter((j) => check(s.game, JOBS[j].unlock));
    return JSON.stringify(open.map((j) => [j, s.game.ratios[j]]));
  });
  const rows = useMemo(() => JSON.parse(json) as [(typeof RATIO_JOBS)[number], number][], [json]);
  const total = rows.reduce((a, [, v]) => a + Math.max(0, v), 0);
  return (
    <div className="mt-2 rounded-md border border-line bg-black/20 px-2.5 py-1">
      {rows.map(([j, v]) => (
        <RatioSlider key={j} job={j} value={v} total={total} />
      ))}
    </div>
  );
}

function RatioSlider({ job, value, total }: { job: (typeof RATIO_JOBS)[number]; value: number; total: number }) {
  const [drag, setDrag] = useState<number | null>(null);
  const v = drag ?? value;
  const sum = total - value + v;
  const commit = (x: number) => {
    useGame.getState().setRatios({ [job]: x });
    setDrag(null);
  };
  return (
    <label className="flex items-center gap-2">
      <span className="w-[6.5rem] shrink-0 truncate text-xs text-parchment">
        {JOBS[job].icon} {JOBS[job].name}
      </span>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={v}
        aria-label={`Доля: ${JOBS[job].name}`}
        className="rr-range min-w-0 flex-1"
        style={{ "--pct": `${v}%` } as CSSProperties}
        onChange={(e) => setDrag(Number(e.target.value))}
        onPointerUp={(e) => commit(Number(e.currentTarget.value))}
        onKeyUp={(e) => commit(Number(e.currentTarget.value))}
        onTouchEnd={(e) => commit(Number(e.currentTarget.value))}
        onBlur={(e) => {
          if (drag !== null) commit(Number(e.currentTarget.value));
        }}
      />
      <span className="w-10 shrink-0 text-right font-mono text-xs tabular text-brass-light">{sum > 0 ? Math.round((v / sum) * 100) : 0}%</span>
    </label>
  );
}

/* ------------------------------------------------------------ job rows */

/** Can a +1 find a rat? (idle first, then open jobs except the forager reserve — mirrors assignJob). */
function canTake(s: GameState, d: Derived, j: JobId): boolean {
  if (idleRats(s) > 0) return true;
  const keep = Math.ceil((0.04 * s.rats) / Math.max(0.0001, 0.3 * d.jobYield.forager));
  return (["forager", "scavenger", "pickpocket"] as JobId[]).some((o) => o !== j && s.jobs[o] - (o === "forager" ? keep : 0) > 0);
}

/** Visible goals still short of r: the expedition, buildings, upgrades («нужны для: «Тайник в табакерке»»). */
function goalsShortOf(s: GameState, r: ResId): string[] {
  const out: string[] = [];
  for (const id of BUILDING_ORDER) {
    const def = BUILDINGS[id];
    if (!buildingVisible(s, id) || s.buildings[id] >= (def.maxLevel ?? Infinity)) continue;
    if ((buildingCost(id, s.buildings[id])[r] ?? 0) > s.res[r] + 1e-9) out.push(`«${def.name}»`);
  }
  for (const id of UPGRADE_ORDER) {
    if (s.upgrades[id] || !upgradeVisible(s, id)) continue;
    if ((UPGRADES[id].cost[r] ?? 0) > s.res[r] + 1e-9) out.push(`«${UPGRADES[id].name}»`);
  }
  const z = currentExpedition(s);
  if (z && !s.digging && (remaining(expeditionCost(s, z), s.projects[z] ?? {})[r] ?? 0) > s.res[r] + 1e-9) out.push(`экспедиция «${ZONES[z].name}»`);
  return out;
}

interface JobModel {
  n: number;
  nText: string;
  slots: string;
  prod: { r: ResId; v: string }[];
  cons: { r: ResId; v: string }[];
  focus: boolean;
  focusMode: boolean;
  room: boolean;
  take: boolean;
  full: boolean;
  fresh: boolean;
  /** Brigade totals; capped outputs are greyed and tagged «склад полон». */
  total: { r: ResId; v: string; capped: boolean }[];
  /** Converter intake per second at the current efficiency. */
  eat: { r: ResId; v: string }[];
  value: string | null;
  /** Output without a market price (💨): no coin value line. */
  unpriced: boolean;
  surplus: boolean;
  anyCapped: boolean;
  idleBrigade: boolean;
  needFor: string[];
  conv: { pct: number; low: boolean; hint: string | null; runway: { r: ResId; t: string; low: boolean } | null } | null;
}

function jobModel(s: GameState, d: Derived, j: JobId): JobModel {
  const def = JOBS[j];
  const idle = j === "idle";
  const n = idle ? idleRats(s) : s.jobs[j];
  const slots = d.slots[j];
  const isConv = Object.keys(def.consumes).length > 0;
  const eff = isConv && n > 0 ? (s.convEff[j] ?? 1) : 1;
  const workforce = s.rats > 0 ? 1 - stunnedRats(s) / s.rats : 1;
  const perRat = entries(def.produces).map(([r, v]) => [r, v * d.jobSpeed[j] * d.jobYield[j] * resMult(s, d, r)] as const);
  const intake = entries(def.consumes).map(([r, v]) => [r, v * d.jobSpeed[j]] as const);
  const val = idle || !priced(j) ? null : netValue(s, d, j);
  const capped = new Set(val?.capped ?? []);
  const unlocked = !idle && n <= 0;

  let conv: JobModel["conv"] = null;
  if (isConv) {
    const b = converterBottleneck(s, d, j);
    const run = eff >= 0.95 ? inputRunway(s, d, j) : null;
    conv = {
      pct: n > 0 ? Math.round(eff * 100) : -1,
      low: n > 0 && eff < 0.95,
      hint: b?.text ?? null,
      runway: run && Number.isFinite(run.seconds) ? { r: run.res, t: fmtTime(run.seconds), low: run.seconds < 60 } : null,
    };
  }

  return {
    n,
    nText: fmtInt(n),
    slots: Number.isFinite(slots) ? fmtInt(slots) : "∞",
    prod: perRat.map(([r, v]) => ({ r, v: fmt(v) })),
    cons: intake.map(([r, v]) => ({ r, v: fmt(v) })),
    focus: s.focus === j,
    focusMode: s.assignMode === "focus" || !s.upgrades.rat_relay,
    room: n < slots,
    take: canTake(s, d, j),
    full: n >= Math.min(slots, s.rats),
    fresh: !idle && isFresh(s, `j_${j}`),
    total: perRat.map(([r, v]) => ({ r, v: fmtRate(v * n * workforce * eff), capped: capped.has(r) })),
    eat: isConv ? intake.map(([r, v]) => ({ r, v: fmt(v * n * workforce * eff) })) : [],
    value: val ? signed(val.value) : null,
    unpriced: !idle && !val,
    surplus: !!val?.surplus,
    anyCapped: capped.size > 0,
    idleBrigade: unlocked,
    needFor: unlocked ? [...new Set(entries(def.produces).flatMap(([r]) => goalsShortOf(s, r)))].slice(0, 3) : [],
    conv,
  };
}

const JobRow = memo(function JobRow({ j, best }: { j: JobId; best: boolean }) {
  const json = useGame((s) => JSON.stringify(jobModel(s.game, derivedOf(s.game), j)));
  const m = useMemo(() => JSON.parse(json) as JobModel, [json]);
  const def = JOBS[j];
  const idle = j === "idle";
  const assign = (delta: number | "max") => useGame.getState().assignJob(j, delta);

  return (
    <div
      data-target={`j_${j}`}
      className={cx(
        "scroll-my-16 rounded-lg border p-2 shadow-[inset_0_1px_0_rgba(232,201,131,.05)]",
        m.focus && !idle ? "border-brass-dark bg-gradient-to-b from-brass/10 to-panel/60" : "border-line bg-panel/60",
      )}
    >
      <div className="flex items-center gap-2">
        <HoverTip tip={def.desc}>
          <span className="grid h-10 w-10 shrink-0 cursor-help place-items-center rounded-md border border-black/40 bg-black/30 text-xl shadow-[inset_0_2px_5px_rgba(0,0,0,.5)]">
            {def.icon}
          </span>
        </HoverTip>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-display text-[15px] font-bold leading-tight text-parchment">{def.name}</span>
            {m.idleBrigade && <Tag>простаивает</Tag>}
            {m.fresh && <Badge tone="verdigris">новинка</Badge>}
          </div>
          <div className="flex flex-wrap gap-x-1.5 font-mono text-[11px] leading-snug tabular">
            <span className="text-parchment-dim">1 крыса:</span>
            {m.prod.map((p) => (
              <span key={p.r} className="whitespace-nowrap text-verdigris-light">
                +{p.v}
                <ResIcon res={p.r} />
              </span>
            ))}
            {m.cons.map((c) => (
              <span key={c.r} className="whitespace-nowrap text-copper-light">
                −{c.v}
                <ResIcon res={c.r} />
              </span>
            ))}
          </div>
        </div>
        <div className="shrink-0 text-right font-mono leading-none tabular">
          <span className="text-lg text-parchment">{m.nText}</span>
          {!idle && <span className="text-xs text-parchment-dim">/{m.slots}</span>}
        </div>
        {!idle && (
          <button
            type="button"
            aria-pressed={m.focus}
            onClick={() => useGame.getState().setFocus(j)}
            title={m.focusMode ? "Фокус: новорождённые идут сюда" : "Звезда действует только в режиме «Фокус»"}
            className={cx(
              "grid h-10 w-10 shrink-0 place-items-center rounded-md border text-xl transition",
              m.focus ? "border-brass bg-brass/15 text-gaslight shadow-[0_0_8px_rgba(242,184,75,.35)]" : "border-line text-parchment-dim hover:text-brass-light",
              !m.focusMode && "opacity-50",
            )}
          >
            {m.focus ? "★" : "☆"}
          </button>
        )}
      </div>

      {m.value !== null && (
        <div className={cx("mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 font-mono text-[11px] tabular", m.surplus ? "text-parchment-dim opacity-70" : "text-brass-light")}>
          <HoverTip tip="Рыночная цена того, что одна крыса этой бригады приносит за секунду, в монетках (у переработчиков — за вычетом сырья).">
            <span className="cursor-help">≈ {m.value} 🪙-экв/крыса</span>
          </HoverTip>
          {m.surplus && (
            <HoverTip tip="Крошек больше чем на 50% сверх прокорма: лишние руки полезнее на другой работе.">
              <Tag tone="dim" className="cursor-help">
                в избытке
              </Tag>
            </HoverTip>
          )}
          {m.anyCapped && <Tag tone="dim">склад полон</Tag>}
          {best && <Tag tone="verdigris">★ выгоднее всего</Tag>}
        </div>
      )}
      {m.unpriced && (
        <p className="mt-1 text-[11px] leading-snug text-parchment-dim">
          {m.prod.map((p) => RESOURCES[p.r].icon).join("")} на рынке не в ходу, но без пара встанут плавильни, кузни и прессы.
        </p>
      )}
      {m.needFor.length > 0 && (
        <p className="mt-0.5 text-[11px] leading-snug text-gaslight">
          нужны для: <span className="text-parchment">{m.needFor.join(", ")}</span>
        </p>
      )}

      {!idle && (
        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <span className="min-w-0 font-mono text-[11px] tabular text-parchment-dim">
            всего{" "}
            {m.total.map((t) => (
              <span key={t.r} className={cx("mr-1 whitespace-nowrap", t.capped ? "text-parchment-dim opacity-70" : "text-verdigris-light")}>
                {t.v}
                <ResIcon res={t.r} />
              </span>
            ))}
            {m.eat.length > 0 && (
              <>
                · ест{" "}
                {m.eat.map((e) => (
                  <span key={e.r} className="mr-1 whitespace-nowrap text-copper-light">
                    −{e.v}
                    <ResIcon res={e.r} />
                  </span>
                ))}
              </>
            )}
          </span>
          <div className="ml-auto flex gap-1">
            <BrassButton size="sm" tone="ghost" className="min-h-10 min-w-10" disabled={m.n <= 0} onClick={() => assign(-1)} aria-label="Снять одну крысу">
              −1
            </BrassButton>
            <BrassButton size="sm" className="min-h-10 min-w-10" disabled={!m.room || !m.take} onClick={() => assign(1)} aria-label="Добавить одну крысу">
              +1
            </BrassButton>
            <BrassButton size="sm" className="min-h-10 min-w-10" disabled={!m.room || !m.take} onClick={() => assign(10)} aria-label="Добавить десять крыс">
              +10
            </BrassButton>
            <BrassButton
              size="sm"
              tone="copper"
              className="min-h-10 min-w-12"
              disabled={!m.room || !m.take || m.full}
              onClick={() => assign("max")}
              aria-label="Занять все места"
            >
              Макс
            </BrassButton>
          </div>
        </div>
      )}

      {m.conv && (
        <div className="mt-1.5 rounded border border-line/70 bg-black/25 px-2 py-1">
          <div className="flex items-center gap-2">
            <HoverTip tip="Какую долю работы бригада успевает сделать: мешают нехватка сырья или полный склад.">
              <span className="cursor-help text-[10px] font-bold uppercase tracking-wider text-parchment-dim">Загрузка</span>
            </HoverTip>
            <Bar value={m.conv.pct < 0 ? 0 : m.conv.pct / 100} color={m.conv.low ? "var(--gaslight)" : "var(--good)"} className="flex-1" />
            <span
              className={cx(
                "w-10 text-right font-mono text-xs tabular",
                m.conv.pct < 0 ? "text-parchment-dim" : m.conv.low ? "rr-blink font-bold text-gaslight" : "text-good",
              )}
            >
              {m.conv.pct < 0 ? "—" : `${m.conv.pct}%`}
            </span>
          </div>
          {m.conv.hint && <p className="mt-0.5 text-[11px] leading-snug text-gaslight">{m.conv.hint}</p>}
          {m.conv.runway && (
            <p className={cx("mt-0.5 font-mono text-[11px] leading-snug tabular", m.conv.runway.low ? "text-gaslight" : "text-parchment-dim")}>
              {RESOURCES[m.conv.runway.r].icon} хватит на {m.conv.runway.t}
            </p>
          )}
        </div>
      )}
    </div>
  );
});
