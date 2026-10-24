"use client";

/**
 * Building card (GDD 12.3). Subscribes to a compact JSON "view model" so it re-renders only
 * when something it shows actually changes, not on every tick. The next-levels gain (levelGain derives
 * a whole state) is sampled separately, twice a second (PA-1, PA-3).
 */
import { memo, useEffect, useMemo, useRef, type MouseEvent } from "react";
import { BUILDINGS } from "@/game/data/buildings";
import { JOBS } from "@/game/data/jobs";
import { RESOURCES } from "@/game/data/resources";
import { JOB_PLURAL } from "@/game/data/sources";
import { ZONES } from "@/game/data/zones";
import { milestoneMult, milestonesReached, resMult, type Derived } from "@/game/engine/derive";
import { buildingCostFor, levelGain, milestoneInfo, unitValue } from "@/game/engine/economy";
import { affordFraction, buildingCost, buyCount, entries } from "@/game/engine/formulas";
import { emitUiFx, onFx } from "@/game/fx";
import { derivedOf, useGame } from "@/game/store";
import type { BuildingId, BuyMode, GameState, JobId, ResId } from "@/game/types";
import { useSampled } from "@/game/useSampled";
import { fmt } from "@/lib/format";
import { Badge, Bar, BrassButton, Ring, Stamp, cx } from "@/components/ui/kit";
import { isFresh } from "./alerts";
import { CostView, HoverTip, WaitView, costItems, floatAt, squash, waitInfo, type CostItem, type WaitInfo } from "./common";

interface CardModel {
  lv: number;
  maxed: boolean;
  /** Levels the button buys (×10 shows 10 even before it is affordable). */
  k: number;
  cost: CostItem[];
  ok: boolean;
  frac: number;
  wait: WaitInfo | null;
  out: { r: ResId; v: string; pct: number }[];
  now: string;
  /** Progress to the next ×2 milestone and what it brings. */
  ms: { left: number; frac: number; tail: string } | null;
  mult: number;
  fresh: boolean;
}

/** Current total of the non-production effects ("жильё +10 · лимит 🍞 +450"). */
function effectNow(s: GameState, d: Derived, id: BuildingId, L: number): string {
  if (L <= 0) return "";
  const u = s.upgrades;
  const rm = id === "rat_rail" ? d.railMult : 1;
  const e = s.steamEff;
  const parts: string[] = [];
  for (const ef of BUILDINGS[id].effects) {
    switch (ef.t) {
      case "housing":
        parts.push(`жильё +${fmt(id === "nest" ? L * (u.communal_nest ? 3 : ef.amt) * (u.bunk_nests ? 2 : 1) : L * ef.amt)}`);
        break;
      case "cap":
        parts.push(`лимит ${RESOURCES[ef.res].icon} +${fmt(ef.amt * L)}`);
        break;
      case "capMult":
        parts.push(`лимиты ×${fmt(Math.pow(ef.mult, L))}`);
        break;
      case "jobPct":
        parts.push(`${JOBS[ef.job].icon} +${fmt(ef.pct * L)}%`);
        break;
      case "slots":
        parts.push(`мест ${JOBS[ef.job].icon} ${fmt(ef.amt * L)}`);
        break;
      case "tierPct":
        parts.push(`🍞🪙🔘➰ +${fmt(ef.pct * L)}%`);
        break;
      case "globalPct":
        parts.push(`всё +${fmt(ef.pct * L * rm)}%`);
        break;
      case "birthPct":
        parts.push(`рождаемость +${fmt(ef.pct * L)}%`);
        break;
      case "steamCap":
        parts.push(`буфер 💨 +${fmt(ef.amt * L)}`);
        break;
      case "steamPress":
        parts.push(`всё +${fmt(ef.pct * L * e)}% (пара ${Math.round(e * 100)}%)`);
        break;
      case "steamClock":
        parts.push(`всё ×${fmt(Math.pow(ef.mult, L * e))} (пара ${Math.round(e * 100)}%)`);
        break;
      case "trainCars":
        parts.push(`вагонов +${fmt(ef.amt * L)}`);
        break;
      case "trainAuto":
        parts.push(`автосбор поездов +${fmt(ef.amt * L * rm * 100)}%`);
        break;
      case "capsuleAuto":
        parts.push(`автосбор капсул +${fmt(ef.amt * L * rm * 100)}%`);
        break;
      case "capsuleCount":
        parts.push(`капсул +${fmt(ef.amt * L)}`);
        break;
      case "trainValuePct":
        parts.push(`ценность добычи +${fmt(ef.pct * L)}%`);
        break;
      default:
        break;
    }
  }
  return parts.join(" · ");
}

/**
 * "special" effects (handled by the engine per building id) that def.desc leaves out. A building whose only
 * effect is special already describes it in desc (the depot), so it gets none.
 */
function specialTexts(id: BuildingId): string[] {
  const effects = BUILDINGS[id].effects;
  return effects.length > 1 ? effects.flatMap((e) => (e.t === "special" ? [e.text] : [])) : [];
}

/** Producers double at milestones (no milestones for capped buildings like the capsule post). */
function isProducer(id: BuildingId): boolean {
  const def = BUILDINGS[id];
  return def.effects.some((e) => e.t === "produce") && def.maxLevel === undefined;
}

/** The job whose yield a producer's milestones boost (EN-4: its jobPct job, else the job it houses). */
function linkedJob(id: BuildingId): JobId | null {
  const effects = BUILDINGS[id].effects;
  for (const e of effects) if (e.t === "jobPct") return e.job;
  for (const e of effects) if (e.t === "slots") return e.job;
  return null;
}

/** Only produce effects: the static «+0.5 🍞/с за уровень» desc is replaced by the live gain line. */
function pureProducer(id: BuildingId): boolean {
  return BUILDINGS[id].effects.every((e) => e.t === "produce");
}

/** Levels a click buys in this mode and their price: ×1, ×10 (always 10, honest), Макс (as many as affordable). */
function purchase(s: GameState, id: BuildingId, mode: BuyMode): { k: number; ok: boolean; raw: ReturnType<typeof buildingCost> } {
  const lv = s.buildings[id];
  const room = (BUILDINGS[id].maxLevel ?? Infinity) - lv;
  if (room <= 0) return { k: 0, ok: false, raw: {} };
  if (mode === 10) {
    const k = Math.min(10, room);
    return { k, ok: buyCount(s, id, 10) === k, raw: buildingCostFor(s, id, k) };
  }
  const can = buyCount(s, id, mode);
  const k = Math.max(1, Math.min(can || 1, room));
  return { k, ok: can > 0, raw: buildingCost(id, lv, k) };
}

function cardModel(s: GameState, d: Derived, id: BuildingId, mode: BuyMode): CardModel {
  const lv = s.buildings[id];
  const { k, ok, raw } = purchase(s, id, mode);
  const maxed = k === 0;

  const out: CardModel["out"] = [];
  for (const [r, v] of Object.entries(d.buildingOut[id]) as [ResId, number][]) {
    const rate = v * resMult(s, d, r);
    const g = s.gross[r];
    out.push({ r, v: fmt(rate), pct: g > 0 ? Math.round((rate / g) * 100) : 0 });
  }

  const producer = isProducer(id);
  let ms: CardModel["ms"] = null;
  if (producer) {
    const info = milestoneInfo(lv);
    if (Number.isFinite(info.next)) {
      const job = linkedJob(id);
      ms = {
        left: info.next - lv,
        frac: Math.round(((lv - info.prev) / (info.next - info.prev)) * 20) / 20,
        tail: `→ выход ×2${job ? `, ${JOB_PLURAL[job].toLowerCase()} ×${fmt(info.jobBoost)}` : ""}`,
      };
    }
  }

  return {
    lv,
    maxed,
    k,
    cost: maxed ? [] : costItems(s, d, raw),
    ok,
    // 2% steps: a ring creeping by a pixel is not worth a render
    frac: ok ? 1 : Math.floor(affordFraction(s, raw) * 50) / 50,
    wait: ok || maxed ? null : waitInfo(s, d, raw),
    out,
    now: effectNow(s, d, id, lv),
    ms,
    mult: producer ? milestoneMult(lv) : 1,
    fresh: isFresh(s, `b_${id}`),
  };
}

/** «+1.04 🍞/с за +1 ур.» and «★ ×2 · 🎩 ×1.2» when the levels cross a milestone (PA-3). */
function gainKey(s: GameState, id: BuildingId, mode: BuyMode): string {
  const { k } = purchase(s, id, mode);
  if (k <= 0) return "";
  const gain = entries(levelGain(s, derivedOf(s), id, k))
    .filter(([, v]) => v > 1e-9)
    .sort((a, b) => b[1] * unitValue(b[0]) - a[1] * unitValue(a[0]));
  const line = gain.length
    ? `${gain
        .slice(0, 3)
        .map(([r, v]) => `+${fmt(v)} ${RESOURCES[r].icon}/с`)
        .join(", ")}${gain.length > 3 ? " и др." : ""} за +${k} ур.`
    : "";
  let star = "";
  const lv = s.buildings[id];
  const crossed = isProducer(id) ? milestonesReached(lv + k) - milestonesReached(lv) : 0;
  if (crossed > 0) {
    const job = linkedJob(id);
    star = `★ ×${Math.pow(2, crossed)}${job ? ` · ${JOBS[job].icon} ×${fmt(Math.pow(milestoneInfo(lv).jobBoost, crossed))}` : ""}`;
  }
  return line || star ? `${line}\n${star}` : "";
}

function BuildingCard({ id, best }: { id: BuildingId; best?: boolean }) {
  const json = useGame((s) => JSON.stringify(cardModel(s.game, derivedOf(s.game), id, s.buyMode)));
  const m = useMemo(() => JSON.parse(json) as CardModel, [json]);
  const [gain, star] = useSampled((s) => gainKey(s.game, id, s.buyMode), 2, Object.is).split("\n");
  const calm = useGame((s) => s.game.settings.reducedMotion);
  const def = BUILDINGS[id];
  const pal = ZONES[def.zone].palette;
  const cardRef = useRef<HTMLElement>(null);
  const iconRef = useRef<HTMLSpanElement>(null);
  const btnRef = useRef<HTMLSpanElement>(null);

  // golden ring when a ×2 milestone is reached
  useEffect(
    () =>
      onFx((fx) => {
        if (fx.k !== "milestone" || fx.building !== id) return;
        const el = cardRef.current;
        if (!el || useGame.getState().game.settings.reducedMotion) return;
        el.animate(
          [
            { boxShadow: "0 0 0 0 rgba(242,184,75,0)" },
            { boxShadow: "0 0 0 3px rgba(242,184,75,.95), 0 0 26px 8px rgba(242,184,75,.55)", offset: 0.25 },
            { boxShadow: "0 0 0 0 rgba(242,184,75,0)" },
          ],
          { duration: 1400, easing: "ease-out" },
        );
      }),
    [id],
  );

  /** Shift-click buys exactly 10, Ctrl/⌘-click as many as affordable; the toggle itself stays put. */
  const buy = (e: MouseEvent<HTMLButtonElement>) => {
    const mode: BuyMode | undefined = e.shiftKey ? 10 : e.ctrlKey || e.metaKey ? "max" : undefined;
    const before = useGame.getState().game.buildings[id];
    useGame.getState().buyBuilding(id, mode);
    const after = useGame.getState().game.buildings[id];
    if (after <= before) {
      if (mode === 10) floatAt(btnRef.current, "на ×10 не хватает", "#d9a07a");
      return;
    }
    squash(btnRef.current, calm);
    squash(iconRef.current, calm);
    floatAt(btnRef.current, after - before > 1 ? `+${after - before} ур.` : `ур. ${after}`, "#e8c983");
    const r = btnRef.current?.getBoundingClientRect();
    if (r) emitUiFx({ k: "fly", from: { x: r.left + r.width / 2, y: r.top + r.height / 2 }, target: `building:${id}`, icon: def.icon });
  };

  const single = m.out.length === 1 ? m.out[0] : null;
  const specials = specialTexts(id);
  const hideDesc = !!gain && pureProducer(id);

  return (
    <article
      ref={cardRef}
      data-target={`b_${id}`}
      className={cx(
        "relative scroll-my-16 rounded-lg border bg-gradient-to-b py-1 pl-1.5 pr-2 shadow-[inset_0_1px_0_rgba(232,201,131,.06),0_2px_8px_rgba(0,0,0,.3)] transition-colors duration-300 md:p-2 md:pr-2.5",
        m.ok ? "border-brass-dark from-panel-3 to-panel" : "border-line from-panel-2 to-panel",
      )}
    >
      <div className="flex items-start gap-2 md:gap-2.5">
        <div className="flex shrink-0 flex-col items-center">
          <HoverTip
            tip={
              <>
                <b className="font-display text-sm text-brass-light">{def.name}</b>
                <br />
                <span className="md:hidden">
                  {def.desc}
                  {m.ms && ` До вехи: ещё ${m.ms.left} ур. ${m.ms.tail}.`}
                  <br />
                </span>
                <i>{def.flavor}</i>
              </>
            }
          >
            <span
              ref={iconRef}
              className="relative grid h-10 w-10 shrink-0 cursor-help place-items-center rounded-md border border-black/50 text-[22px] shadow-[inset_0_2px_6px_rgba(0,0,0,.65)] md:h-12 md:w-12 md:text-[26px]"
              style={{ background: `radial-gradient(circle at 50% 30%, ${pal.glow}40, ${pal.bg} 72%)` }}
            >
              <span className={cx(m.lv === 0 && "opacity-50 grayscale")}>{def.icon}</span>
              <span className="absolute -bottom-1.5 -right-1.5 min-w-6 rounded-full border border-brass-dark bg-soot px-1 text-center font-mono text-[11px] font-bold leading-5 text-brass-light tabular shadow">
                {m.lv}
              </span>
            </span>
          </HoverTip>
          {/* phones: the milestone progress shrinks to a gauge under the icon (the text is in the icon's tooltip) */}
          {m.ms && <Bar value={m.ms.frac} color="var(--gaslight)" className="mt-2.5 h-1 w-10 md:hidden" />}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
            <h4 className="font-display text-[15px] font-bold leading-tight text-parchment">{def.name}</h4>
            {m.mult > 1 && <Badge>×{m.mult}</Badge>}
            {best && (
              <HoverTip tip="Быстрее всех окупает следующий уровень: цена ÷ прирост дохода">
                <Badge tone="good" className="cursor-help">
                  выгодно
                </Badge>
              </HoverTip>
            )}
            {m.fresh && <Badge tone="verdigris">новинка</Badge>}
          </div>
          {!hideDesc && <p className="mt-0.5 text-[11px] leading-snug text-parchment-dim max-md:hidden">{def.desc}</p>}
          {specials.length > 0 && (
            <p className="mt-0.5 text-[11px] leading-snug text-parchment-dim">
              <span className="text-brass">✦</span> {specials.join(" · ")}
            </p>
          )}

          {/* phones: output, the current effect and the next-level gain share one wrapping line */}
          <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 md:mt-0 md:block">
            {single ? (
              <p className="font-mono text-[11px] leading-snug tabular text-verdigris-light md:mt-0.5">
                +{single.v} {RESOURCES[single.r].icon}/с<span className="max-md:hidden"> · всего {single.pct}%</span>
              </p>
            ) : (
              m.out.length > 1 && (
                <p className="flex flex-wrap gap-x-2 font-mono text-[11px] leading-snug tabular text-verdigris-light md:mt-0.5">
                  {m.out.map((o) => (
                    <span key={o.r} className="whitespace-nowrap">
                      +{o.v} {RESOURCES[o.r].icon}/с <span className="text-parchment-dim max-md:hidden">({o.pct}%)</span>
                    </span>
                  ))}
                </p>
              )
            )}
            {m.now && <p className="text-[11px] leading-snug text-brass md:mt-0.5">{m.now}</p>}
            {(gain || star) && (
              <p className="font-mono text-[11px] leading-snug tabular md:mt-0.5">
                {gain && <span className="text-verdigris">{gain}</span>}
                {star && (
                  <span className="ml-1.5 whitespace-nowrap font-bold text-gaslight" title="Веха: выход постройки удвоится">
                    {star}
                  </span>
                )}
              </p>
            )}
          </div>

          {m.ms && (
            <div className="mt-1 flex items-center gap-2 max-md:hidden">
              <Bar value={m.ms.frac} color="var(--gaslight)" className="h-1 w-14 shrink-0" />
              <span className="min-w-0 text-[10px] leading-tight text-parchment-dim">
                до вехи: ещё {m.ms.left} ур. {m.ms.tail}
              </span>
            </div>
          )}

          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 md:mt-1">
            {m.maxed ? <Stamp color="var(--brass-light)">макс.</Stamp> : <CostView items={m.cost} />}
            <WaitView w={m.wait} />
          </div>
        </div>

        {!m.maxed && (
          <span ref={btnRef} className="inline-flex shrink-0 self-center">
            <span className={cx("inline-flex", m.ok && "rr-breathe")}>
              <Ring value={m.frac} size={52} stroke={3} color={m.ok ? "var(--gaslight)" : "var(--brass-dark)"}>
                <BrassButton
                  size="sm"
                  className="h-10 w-10 rounded-full! p-0! font-mono text-[11px]"
                  disabled={!m.ok}
                  onClick={buy}
                  title="Shift — ровно 10 ур., Ctrl — сколько хватит"
                  aria-label={`Построить: ${def.name}, +${m.k} ур.`}
                >
                  +{m.k}
                </BrassButton>
              </Ring>
            </span>
          </span>
        )}
      </div>
    </article>
  );
}

export default memo(BuildingCard);
