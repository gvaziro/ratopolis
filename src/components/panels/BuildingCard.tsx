"use client";

/**
 * Building card (GDD 12.3). Subscribes to a compact JSON "view model" so it re-renders only
 * when something it shows actually changes, not on every tick.
 */
import { memo, useEffect, useMemo, useRef } from "react";
import { BUILDINGS, MILESTONES } from "@/game/data/buildings";
import { JOBS } from "@/game/data/jobs";
import { RESOURCES } from "@/game/data/resources";
import { ZONES } from "@/game/data/zones";
import { milestoneMult, nextMilestone, resMult, type Derived } from "@/game/engine/derive";
import { affordFraction, buildingCost, buyCount, lockedByCap, timeToAfford } from "@/game/engine/formulas";
import { onFx } from "@/game/fx";
import { derivedOf, useGame } from "@/game/store";
import type { BuildingId, BuyMode, GameState, ResId } from "@/game/types";
import { fmt, fmtTime } from "@/lib/format";
import { Badge, Bar, BrassButton, Ring, Stamp, cx } from "@/components/ui/kit";
import { isFresh } from "./alerts";
import { CostView, HoverTip, costItems, floatAt, squash, type CostItem } from "./common";

interface CardModel {
  lv: number;
  maxed: boolean;
  /** Levels the button buys. */
  k: number;
  cost: CostItem[];
  ok: boolean;
  frac: number;
  wait: string | null;
  out: { r: ResId; v: string; pct: number }[];
  now: string;
  ms: { left: number; frac: number } | null;
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

function cardModel(s: GameState, d: Derived, id: BuildingId, mode: BuyMode): CardModel {
  const def = BUILDINGS[id];
  const lv = s.buildings[id];
  const max = def.maxLevel ?? Infinity;
  const maxed = lv >= max;
  const can = maxed ? 0 : buyCount(s, id, mode);
  const k = Math.max(1, Math.min(can || 1, max - lv));
  const raw = maxed ? {} : buildingCost(id, lv, k);
  const ok = !maxed && can > 0;

  let wait: string | null = null;
  if (!ok && !maxed) {
    const locked = lockedByCap(raw, d).filter((r) => s.res[r] < (raw[r] ?? 0));
    if (locked.length) wait = "🔒 нужен склад";
    else {
      const t = timeToAfford(s, raw);
      wait = Number.isFinite(t) ? `через ${fmtTime(Math.ceil(t))}` : "не копится";
    }
  }

  const out: CardModel["out"] = [];
  for (const [r, v] of Object.entries(d.buildingOut[id]) as [ResId, number][]) {
    const rate = v * resMult(s, d, r);
    const g = s.gross[r];
    out.push({ r, v: fmt(rate), pct: g > 0 ? Math.round((rate / g) * 100) : 0 });
  }

  const producer = def.effects.some((e) => e.t === "produce") && def.maxLevel === undefined;
  const next = producer ? nextMilestone(lv) : null;
  let ms: CardModel["ms"] = null;
  if (next !== null) {
    const prev = MILESTONES.filter((m) => m <= lv).pop() ?? 0;
    ms = { left: next - lv, frac: Math.round(((lv - prev) / (next - prev)) * 100) / 100 };
  }

  return {
    lv,
    maxed,
    k,
    cost: maxed ? [] : costItems(s, d, raw),
    ok,
    frac: ok ? 1 : Math.floor(affordFraction(s, raw) * 100) / 100,
    wait,
    out,
    now: effectNow(s, d, id, lv),
    ms,
    mult: producer ? milestoneMult(lv) : 1,
    fresh: isFresh(s, `b_${id}`),
  };
}

function BuildingCard({ id }: { id: BuildingId }) {
  const json = useGame((s) => JSON.stringify(cardModel(s.game, derivedOf(s.game), id, s.buyMode)));
  const m = useMemo(() => JSON.parse(json) as CardModel, [json]);
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

  const buy = () => {
    const before = useGame.getState().game.buildings[id];
    useGame.getState().buyBuilding(id);
    const after = useGame.getState().game.buildings[id];
    if (after <= before) return;
    squash(btnRef.current, calm);
    squash(iconRef.current, calm);
    floatAt(btnRef.current, after - before > 1 ? `+${after - before} ур.` : `ур. ${after}`, "#e8c983");
  };

  const single = m.out.length === 1 ? m.out[0] : null;
  const specials = specialTexts(id);

  return (
    <article
      ref={cardRef}
      className={cx(
        "relative rounded-lg border bg-gradient-to-b p-2 pr-2.5 shadow-[inset_0_1px_0_rgba(232,201,131,.06),0_2px_8px_rgba(0,0,0,.3)] transition-colors duration-300",
        m.ok ? "border-brass-dark from-panel-3 to-panel" : "border-line from-panel-2 to-panel",
      )}
    >
      <div className="flex items-start gap-2.5">
        <HoverTip
          tip={
            <>
              <b className="font-display text-sm text-brass-light">{def.name}</b>
              <br />
              <i>{def.flavor}</i>
            </>
          }
        >
          <span
            ref={iconRef}
            className="relative grid h-12 w-12 shrink-0 cursor-help place-items-center rounded-md border border-black/50 text-[26px] shadow-[inset_0_2px_6px_rgba(0,0,0,.65)]"
            style={{ background: `radial-gradient(circle at 50% 30%, ${pal.glow}40, ${pal.bg} 72%)` }}
          >
            <span className={cx(m.lv === 0 && "opacity-50 grayscale")}>{def.icon}</span>
            <span className="absolute -bottom-1.5 -right-1.5 min-w-6 rounded-full border border-brass-dark bg-soot px-1 text-center font-mono text-[11px] font-bold leading-5 text-brass-light tabular shadow">
              {m.lv}
            </span>
          </span>
        </HoverTip>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
            <h4 className="font-display text-[15px] font-bold leading-tight text-parchment">{def.name}</h4>
            {m.mult > 1 && <Badge>×{m.mult}</Badge>}
            {m.fresh && <Badge tone="verdigris">новинка</Badge>}
          </div>
          <p className="mt-0.5 text-[11px] leading-snug text-parchment-dim">{def.desc}</p>
          {specials.length > 0 && (
            <p className="mt-0.5 text-[11px] leading-snug text-parchment-dim">
              <span className="text-brass">✦</span> {specials.join(" · ")}
            </p>
          )}

          {single ? (
            <p className="mt-0.5 font-mono text-[11px] leading-snug tabular text-verdigris-light">
              +{single.v} {RESOURCES[single.r].icon}/с · всего {single.pct}%
            </p>
          ) : (
            m.out.length > 1 && (
              <p className="mt-0.5 flex flex-wrap gap-x-2 font-mono text-[11px] leading-snug tabular text-verdigris-light">
                {m.out.map((o) => (
                  <span key={o.r} className="whitespace-nowrap">
                    +{o.v} {RESOURCES[o.r].icon}/с <span className="text-parchment-dim">({o.pct}%)</span>
                  </span>
                ))}
              </p>
            )
          )}
          {m.now && <p className="mt-0.5 text-[11px] leading-snug text-brass">{m.now}</p>}

          {m.ms && (
            <div className="mt-1 flex items-center gap-2">
              <Bar value={m.ms.frac} color="var(--gaslight)" className="h-1 w-14 shrink-0" />
              <span className="text-[10px] text-parchment-dim">
                до ×2: ещё {m.ms.left} ур.
              </span>
            </div>
          )}

          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
            {m.maxed ? <Stamp color="var(--brass-light)">макс.</Stamp> : <CostView items={m.cost} />}
            {m.wait && <span className="whitespace-nowrap font-mono text-[10px] text-parchment-dim tabular">{m.wait}</span>}
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
