"use client";

/**
 * "Работы": population stats, food balance, satiety, the assignment mode, ratio sliders
 * and one row per unlocked job (with converter efficiency and the bottleneck hint, GDD 4.4).
 */
import { useState, type CSSProperties, type ReactNode } from "react";
import { BUILDINGS } from "@/game/data/buildings";
import { JOBS } from "@/game/data/jobs";
import { RESOURCES } from "@/game/data/resources";
import { check } from "@/game/engine/conditions";
import { idleRats, resMult, stunnedRats, type Derived } from "@/game/engine/derive";
import { entries } from "@/game/engine/formulas";
import { derivedOf, useGame } from "@/game/store";
import { JOB_IDS, type AssignMode, type GameState, type JobId, type ResId } from "@/game/types";
import { fmt, fmtInt, fmtRate, fmtTime } from "@/lib/format";
import { Badge, Bar, BrassButton, ResIcon, cx } from "@/components/ui/kit";
import { isFresh } from "./alerts";
import { HoverTip, SectionTitle, Segmented, Switch, Toolbar, plural } from "./common";

/** Who produces each converter input, with Russian plural forms for the hint. */
const SUPPLIER: Partial<Record<ResId, { job: JobId; forms: [string, string, string] }>> = {
  buttons: { job: "scavenger", forms: ["барахольщик", "барахольщика", "барахольщиков"] },
  wire: { job: "scavenger", forms: ["барахольщик", "барахольщика", "барахольщиков"] },
  cheese: { job: "cheese_thief", forms: ["сырный воришка", "сырных воришки", "сырных воришек"] },
  coal: { job: "coal_miner", forms: ["угольщик", "угольщика", "угольщиков"] },
  steam: { job: "stoker", forms: ["кочегар", "кочегара", "кочегаров"] },
  coins: { job: "pickpocket", forms: ["карманник", "карманника", "карманников"] },
  brass: { job: "smelter", forms: ["плавильщик", "плавильщика", "плавильщиков"] },
};

const MODE_NOTE: Record<AssignMode, string> = {
  focus: "Новорождённые идут на работу со ☆, пока там есть места, иначе — в собиратели. Пока еда в минусе, Старейшина шлёт всех кормить колонию.",
  ratios: "Сначала заполняются ограниченные места, остальные новорождённые делятся по ползункам.",
  smart: "Пневмоприказы раз в 5 с перекраивают бригады: еда в плюсе, конвертеры сыты, остальные — туда, где отдача выше. Ручные правки продержатся до следующего приказа.",
};

const RATIO_JOBS = ["forager", "pickpocket", "scavenger"] as const;

export default function JobsTab() {
  const game = useGame((s) => s.game);
  const d = derivedOf(game);
  const u = game.upgrades;
  const jobs = JOB_IDS.filter((j) => check(game, JOBS[j].unlock));
  const showRatios = !!u.rat_relay && game.assignMode !== "focus";

  return (
    <>
      <Toolbar icon="🐀" title="Работы" />
      <PopulationStats s={game} d={d} />

      <SectionTitle>Распределение</SectionTitle>
      <Segmented<AssignMode>
        label="Режим распределения"
        className="w-full"
        value={game.assignMode}
        onChange={(m) => useGame.getState().setAssignMode(m)}
        options={[
          { value: "focus", label: "Фокус ☆" },
          {
            value: "ratios",
            label: u.rat_relay ? "Пропорции" : "🔒 Пропорции",
            disabled: !u.rat_relay,
            title: u.rat_relay ? "Ползунки пропорций" : "Нужно улучшение «Цепочка передачи»",
          },
          {
            value: "smart",
            label: u.tube_orders ? "Умное" : "🔒 Умное",
            disabled: !u.tube_orders,
            title: u.tube_orders ? "Умное распределение" : "Нужно улучшение «Пневмоприказы»",
          },
        ]}
      />
      <p className="mt-1.5 text-[11px] leading-snug text-parchment-dim">{MODE_NOTE[game.assignMode]}</p>

      {showRatios && <Ratios s={game} />}

      <SectionTitle>Бригады</SectionTitle>
      <div className="space-y-2">
        {jobs.map((j) => (
          <JobRow key={j} s={game} d={d} j={j} />
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

function PopulationStats({ s, d }: { s: GameState; d: Derived }) {
  const full = s.rats >= d.housing;
  const canBirth = !!s.flags.vagrants && !full && s.res.crumbs > 0 && !s.hungry;
  const why = !s.flags.vagrants ? "ждём бродяжек" : full ? "нет места в гнёздах" : s.hungry ? "голод: не до свадеб" : "нет крошек";
  const bal = s.gross.crumbs - d.food;
  const stunned = stunnedRats(s);
  const recover = s.stunned.reduce((a, g) => Math.max(a, g.until - s.time), 0);
  const idle = idleRats(s);

  return (
    <div className="grid grid-cols-2 gap-2">
      <Tile icon="🐀" label="Крысы / жильё">
        <div className="font-mono text-lg leading-tight tabular text-parchment">
          {fmtInt(s.rats)}
          <span className="text-sm text-parchment-dim"> / {fmtInt(d.housing)}</span>
        </div>
        <Bar value={s.rats} max={d.housing} color={full ? "var(--danger-light)" : "var(--brass)"} className="mt-1" />
        <p className={cx("mt-1 text-[10px] leading-tight", full ? "text-danger-light" : "text-parchment-dim")}>
          {full ? "Жильё полно — стройте гнёзда" : `свободно мест: ${fmtInt(d.housing - s.rats)}`}
        </p>
      </Tile>

      <Tile icon="💕" label="Рождаемость">
        <div className="font-mono text-lg leading-tight tabular text-parchment">{canBirth ? fmtRate(d.birthRate) : "—"}</div>
        <div className="mt-1 flex items-center gap-1.5">
          <Bar value={s.birthProgress} color="var(--copper-light)" className="flex-1" />
        </div>
        <p className="mt-1 text-[10px] leading-tight text-parchment-dim">
          {canBirth ? `следующий писк ~${fmtTime(Math.ceil((1 - s.birthProgress) / Math.max(1e-6, d.birthRate)))}` : why}
        </p>
      </Tile>

      <Tile icon="🍞" label="Еда" tone={s.hungry || bal < 0 ? "bad" : undefined}>
        <div className={cx("font-mono text-lg leading-tight tabular", bal < 0 ? "text-danger-light" : "text-good")}>{fmtRate(bal)}</div>
        <p className="mt-1 text-[10px] leading-tight text-parchment-dim">
          добыча {fmtRate(s.gross.crumbs)} · едят −{fmt(d.food)}/с
        </p>
        {s.hungry ? (
          <p className="mt-0.5 text-[10px] font-bold leading-tight text-danger-light">😟 ГОЛОД: всё, кроме 🍞, ×0.5; рождение стоит</p>
        ) : (
          bal < 0 && (
            <p className="mt-0.5 text-[10px] font-bold leading-tight text-danger-light">
              Запасов на {fmtTime(s.res.crumbs / -bal)} — нужны собиратели
            </p>
          )
        )}
      </Tile>

      <Tile icon="💤" label="Без дела">
        <div className="font-mono text-lg leading-tight tabular text-parchment">{fmtInt(idle)}</div>
        {stunned > 0 ? (
          <p className="mt-1 text-[10px] font-bold leading-tight text-gaslight">
            ✨ напуганы: {fmtInt(stunned)} (ещё {fmtTime(recover)})
          </p>
        ) : (
          <p className="mt-1 text-[10px] leading-tight text-parchment-dim">напуганных нет, все бодры</p>
        )}
      </Tile>

      {s.upgrades.cheese_diet && (
        <Tile icon="😋" label="Сытость" className="col-span-2">
          <Switch
            on={s.satiety}
            onToggle={() => useGame.getState().toggleSatiety()}
            label={s.satiety ? (d.satietyActive ? "Сытость: всё ×1.25" : "Сытость ждёт сыра") : "Сытость выключена"}
            sub={
              s.satiety
                ? `едят −${fmt(d.satietyActive ? d.cheeseFood : 0.005 * s.rats)} 🧀/с · запас ${fmt(s.res.cheese)} 🧀`
                : `включите: ×1.25 ко всему за ${fmt(0.005 * s.rats)} 🧀/с`
            }
          />
        </Tile>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ ratios */

function Ratios({ s }: { s: GameState }) {
  const open = RATIO_JOBS.filter((j) => check(s, JOBS[j].unlock));
  const total = open.reduce((a, j) => a + Math.max(0, s.ratios[j]), 0);
  return (
    <div className="mt-2 rounded-md border border-line bg-black/20 px-2.5 py-1">
      {open.map((j) => (
        <RatioSlider key={j} job={j} value={s.ratios[j]} total={total} />
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

/** GDD 4.4 bottleneck hint: "не хватает 🔘. Нужно ещё ~2 барахольщика". */
function bottleneck(s: GameState, d: Derived, j: JobId, eff: number): string | null {
  const n = s.jobs[j];
  if (n <= 0 || eff >= 0.95) return null;
  for (const [r] of entries(JOBS[j].produces)) {
    if (Number.isFinite(d.caps[r]) && s.res[r] >= d.caps[r] * 0.995) return `Склад ${RESOURCES[r].icon} полон — бригада ждёт места. Нужен склад побольше.`;
  }
  let worst: ResId | null = null;
  let worstRatio = Infinity;
  for (const [r, v] of entries(JOBS[j].consumes)) {
    const ratio = s.res[r] / Math.max(1e-9, n * v * d.jobSpeed[j]);
    if (ratio < worstRatio) {
      worstRatio = ratio;
      worst = r;
    }
  }
  if (!worst) return null;
  const icon = RESOURCES[worst].icon;
  const missing = n * (JOBS[j].consumes[worst] ?? 0) * d.jobSpeed[j] * (1 - eff);
  const sup = SUPPLIER[worst];
  if (!sup) return `Не хватает ${icon}.`;
  if (!check(s, JOBS[sup.job].unlock)) return `Не хватает ${icon}: поставщики ещё не открыты.`;
  const per = (JOBS[sup.job].produces[worst] ?? 0) * d.jobSpeed[sup.job] * d.jobYield[sup.job] * resMult(s, d, worst);
  const need = Math.max(1, Math.ceil(missing / Math.max(1e-9, per)));
  let tail = `Нужно ещё ~${need} ${plural(need, ...sup.forms)}`;
  const slots = JOBS[sup.job].slots;
  if (slots && s.jobs[sup.job] + need > d.slots[sup.job]) tail += ` — но мест нет: стройте «${BUILDINGS[slots.building].name}»`;
  return `Не хватает ${icon}. ${tail}.`;
}

function JobRow({ s, d, j }: { s: GameState; d: Derived; j: JobId }) {
  const def = JOBS[j];
  const idle = j === "idle";
  const n = idle ? idleRats(s) : s.jobs[j];
  const slots = d.slots[j];
  const isConv = Object.keys(def.consumes).length > 0;
  const eff = isConv && n > 0 ? (s.convEff[j] ?? 1) : 1;
  const workforce = s.rats > 0 ? 1 - stunnedRats(s) / s.rats : 1;
  const prod = entries(def.produces).map(([r, v]) => [r, v * d.jobSpeed[j] * d.jobYield[j] * resMult(s, d, r)] as const);
  const cons = entries(def.consumes).map(([r, v]) => [r, v * d.jobSpeed[j]] as const);
  const focus = s.focus === j;
  const focusMode = s.assignMode === "focus" || !s.upgrades.rat_relay;
  const room = n < slots;
  const take = canTake(s, d, j);
  const fresh = !idle && isFresh(s, `j_${j}`);
  const hint = isConv ? bottleneck(s, d, j, eff) : null;
  const assign = (delta: number | "max") => useGame.getState().assignJob(j, delta);

  return (
    <div
      className={cx(
        "rounded-lg border p-2 shadow-[inset_0_1px_0_rgba(232,201,131,.05)]",
        focus && !idle ? "border-brass-dark bg-gradient-to-b from-brass/10 to-panel/60" : "border-line bg-panel/60",
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
            {fresh && <Badge tone="verdigris">новинка</Badge>}
          </div>
          <div className="flex flex-wrap gap-x-1.5 font-mono text-[11px] leading-snug tabular">
            <span className="text-parchment-dim">1 крыса:</span>
            {prod.map(([r, v]) => (
              <span key={r} className="whitespace-nowrap text-verdigris-light">
                +{fmt(v)}
                <ResIcon res={r} />
              </span>
            ))}
            {cons.map(([r, v]) => (
              <span key={r} className="whitespace-nowrap text-copper-light">
                −{fmt(v)}
                <ResIcon res={r} />
              </span>
            ))}
          </div>
        </div>
        <div className="shrink-0 text-right font-mono leading-none tabular">
          <span className="text-lg text-parchment">{fmtInt(n)}</span>
          {!idle && <span className="text-xs text-parchment-dim">/{Number.isFinite(slots) ? fmtInt(slots) : "∞"}</span>}
        </div>
        {!idle && (
          <button
            type="button"
            aria-pressed={focus}
            onClick={() => useGame.getState().setFocus(j)}
            title={focusMode ? "Фокус: новорождённые идут сюда" : "Звезда действует только в режиме «Фокус»"}
            className={cx(
              "grid h-10 w-10 shrink-0 place-items-center rounded-md border text-xl transition",
              focus ? "border-brass bg-brass/15 text-gaslight shadow-[0_0_8px_rgba(242,184,75,.35)]" : "border-line text-parchment-dim hover:text-brass-light",
              !focusMode && "opacity-50",
            )}
          >
            {focus ? "★" : "☆"}
          </button>
        )}
      </div>

      {!idle && (
        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <span className="min-w-0 font-mono text-[11px] tabular text-parchment-dim">
            всего{" "}
            {prod.map(([r, v]) => (
              <span key={r} className="mr-1 whitespace-nowrap text-verdigris-light">
                {fmtRate(v * n * workforce * eff)}
                <ResIcon res={r} />
              </span>
            ))}
          </span>
          <div className="ml-auto flex gap-1">
            <BrassButton size="sm" tone="ghost" className="min-h-10 min-w-10" disabled={n <= 0} onClick={() => assign(-1)} aria-label="Снять одну крысу">
              −1
            </BrassButton>
            <BrassButton size="sm" className="min-h-10 min-w-10" disabled={!room || !take} onClick={() => assign(1)} aria-label="Добавить одну крысу">
              +1
            </BrassButton>
            <BrassButton size="sm" className="min-h-10 min-w-10" disabled={!room || !take} onClick={() => assign(10)} aria-label="Добавить десять крыс">
              +10
            </BrassButton>
            <BrassButton
              size="sm"
              tone="copper"
              className="min-h-10 min-w-12"
              disabled={!room || !take || n >= Math.min(slots, s.rats)}
              onClick={() => assign("max")}
              aria-label="Занять все места"
            >
              Макс
            </BrassButton>
          </div>
        </div>
      )}

      {isConv && (
        <div className="mt-1.5 rounded border border-line/70 bg-black/25 px-2 py-1">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-parchment-dim">КПД</span>
            <Bar value={n > 0 ? eff : 0} color={eff < 0.95 ? "var(--gaslight)" : "var(--good)"} className="flex-1" />
            <span className={cx("w-10 text-right font-mono text-xs tabular", n <= 0 ? "text-parchment-dim" : eff < 0.95 ? "rr-blink font-bold text-gaslight" : "text-good")}>
              {n > 0 ? `${Math.round(eff * 100)}%` : "—"}
            </span>
          </div>
          {hint && <p className="mt-0.5 text-[11px] leading-snug text-gaslight">{hint}</p>}
        </div>
      )}
    </div>
  );
}

