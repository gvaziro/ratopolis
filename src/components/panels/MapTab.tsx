"use client";

/**
 * "Карта": the five zones as strata of a vertical map of the underworld. The next zone carries
 * the expedition project (per-resource contributions, rats requirement, digging); the Rat Express
 * panel sits on top once its blueprint is bought. The map samples a small model three times a
 * second; the expedition and each of its rows sample their own (PA-1).
 */
import { memo, useEffect, useMemo, useRef } from "react";
import { UPGRADES } from "@/game/data/upgrades";
import { ZONE_ORDER, ZONES } from "@/game/data/zones";
import { currentExpedition, fmtRunTime } from "@/game/engine/actions";
import { entries, expeditionCost, isComplete } from "@/game/engine/formulas";
import { useGame } from "@/game/store";
import type { GameState, ResId, ZoneId } from "@/game/types";
import { useSampled } from "@/game/useSampled";
import { fmtInt, fmtTime } from "@/lib/format";
import { Badge, Bar, BrassButton, Stamp, cx } from "@/components/ui/kit";
import { isFresh } from "./alerts";
import { ContribRow, Switch, Toolbar, contribKey } from "./common";
import ExpressPanel from "./ExpressPanel";

const DEPTH: Record<ZoneId, string> = {
  burrow: "−3 фута",
  sewers: "−12 футов",
  cellars: "−20 футов",
  metro: "−45 футов",
  terminal: "−70 футов",
};

type Stage = "open" | "project" | "next" | "unknown";

interface MapModel {
  plan: boolean;
  terminal: boolean;
  /** record: best run time to open the zone (EN-11), m:ss, empty when none. */
  strata: { z: ZoneId; stage: Stage; fresh: boolean; record: string }[];
  rats: string;
}

function mapModel(s: GameState): MapModel {
  const exp = currentExpedition(s);
  const firstClosed = ZONE_ORDER.findIndex((z) => !s.zones[z]);
  return {
    plan: !!s.upgrades.express_plan,
    terminal: !!s.zones.terminal,
    strata: ZONE_ORDER.map((z, i) => {
      const stage: Stage = s.zones[z] ? "open" : i === firstClosed ? (exp === z ? "project" : "next") : "unknown";
      const rec = z === "burrow" ? undefined : s.meta.records[z];
      return { z, stage, fresh: stage === "project" && isFresh(s, `x_${z}`), record: rec !== undefined && Number.isFinite(rec) ? fmtRunTime(rec) : "" };
    }),
    rats: fmtInt(s.rats),
  };
}

export default function MapTab() {
  const json = useSampled((s) => JSON.stringify(mapModel(s.game)), 3, Object.is);
  const m = useMemo(() => JSON.parse(json) as MapModel, [json]);
  const auto = useGame((s) => s.game.autoContribute);

  return (
    <>
      <Toolbar
        icon="🗺️"
        title="Карта подземелья"
        right={
          <Switch
            on={auto}
            onToggle={() => useGame.getState().toggleAutoContribute()}
            label="Автовзнос"
            sub="излишки полных складов и ½ дохода безлимитных ресурсов"
          />
        }
      />

      {m.plan ? (
        <ExpressPanel />
      ) : (
        m.terminal && (
          <p className="mb-4 rounded-md border border-dashed border-brass-dark/70 bg-brass/5 px-3 py-2 text-xs leading-snug text-parchment-dim">
            <b className="text-brass-light">🚂 Слухи на вокзале:</b> из хлама можно собрать собственный поезд. Нужен «{UPGRADES.express_plan.name}» во вкладке «Улучшения».
          </p>
        )
      )}

      <ol className="relative">
        {/* the shaft connecting the strata */}
        <span aria-hidden className="absolute bottom-6 left-[19px] top-6 w-0.5 bg-[repeating-linear-gradient(to_bottom,var(--brass-dark)_0_6px,transparent_6px_11px)]" />
        {m.strata.map((st) => (
          <Stratum key={st.z} z={st.z} stage={st.stage} fresh={st.fresh} record={st.record} rats={st.stage === "next" ? m.rats : ""} />
        ))}
      </ol>
    </>
  );
}

/** Relative brightness of a #rrggbb colour (0..255). */
function lum(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
}

const Stratum = memo(function Stratum({ z, stage, fresh, rats, record }: { z: ZoneId; stage: Stage; fresh: boolean; rats: string; record: string }) {
  const def = ZONES[z];
  const pal = def.palette;
  const ink = lum(pal.glow) >= lum(pal.accent) ? pal.glow : pal.accent;
  const known = stage === "open" || stage === "project";
  const ref = useRef<HTMLLIElement>(null);
  // open the map at the frontier: bring the expedition into view
  useEffect(() => {
    const el = ref.current;
    const panel = el?.closest<HTMLElement>("[role=tabpanel]");
    // scroll only the panel (never the page), leaving room for the sticky toolbar
    if (stage === "project" && el && panel) panel.scrollTop += el.getBoundingClientRect().top - panel.getBoundingClientRect().top - 64;
  }, [stage]);
  return (
    <li ref={ref} data-target={`z_${z}`} className="relative mb-3 flex scroll-my-16 gap-2.5 rounded-lg last:mb-0">
      <span
        className={cx(
          "relative z-10 mt-1 grid h-10 w-10 shrink-0 place-items-center rounded-full border-2 text-xl shadow-[0_2px_6px_rgba(0,0,0,.6)]",
          stage === "open" ? "border-brass" : stage === "project" ? "border-gaslight" : "border-line",
        )}
        style={{ background: known ? pal.bg : "#14110f" }}
      >
        {known ? def.icon : "❓"}
        {stage === "open" && (
          <span className="absolute -bottom-1 -right-1 grid h-4 w-4 place-items-center rounded-full bg-good text-[10px] font-bold text-soot">✓</span>
        )}
      </span>

      <div
        className={cx(
          "min-w-0 flex-1 overflow-hidden rounded-lg border shadow-[inset_0_1px_0_rgba(255,255,255,.05)]",
          stage === "open" ? "border-line" : stage === "project" ? "border-brass-dark" : "border-dashed border-line/70",
        )}
        style={{
          background: known ? `linear-gradient(135deg, ${pal.bg} 0%, #14110f 95%)` : "rgba(0,0,0,.25)",
        }}
      >
        <div className="flex items-start gap-2 px-2.5 pt-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[10px] uppercase tracking-[0.18em] text-parchment-dim">
              {def.order}-й ярус · {DEPTH[z]}
            </p>
            <h3 className="font-display text-base font-bold leading-tight" style={{ color: known ? ink : "var(--parchment-dim)" }}>
              {known ? def.name : "Неизведанные глубины"}
              {fresh && (
                <Badge tone="verdigris" className="ml-1.5 align-middle">
                  новинка
                </Badge>
              )}
            </h3>
          </div>
          {stage === "open" && <Stamp color="var(--good)">открыто</Stamp>}
          {known && (
            <span className="flex shrink-0 gap-0.5 pt-1" aria-hidden>
              {[pal.bg, pal.accent, pal.glow, pal.detail].map((c) => (
                <span key={c} className="h-3 w-3 rounded-sm border border-black/50" style={{ background: c }} />
              ))}
            </span>
          )}
        </div>

        {known ? (
          <div className="px-2.5 pb-2">
            <p className="mt-1 text-[11px] leading-snug text-parchment">
              <span className="mr-1">👤</span>
              <span className="italic text-parchment-dim">«{def.humanLine}»</span>
            </p>
            <p className="text-[11px] leading-snug text-parchment">
              <span className="mr-1">🐀</span>
              <span className="italic">«{def.ratLine}»</span>
            </p>
            <p className="mt-1 text-[11px] leading-snug" style={{ color: ink }}>
              {def.adds}
            </p>
            {record && <p className="mt-0.5 font-mono text-[10px] tabular text-gaslight">⏱️ рекорд: {record}</p>}
            {stage === "project" && <Expedition z={z} />}
          </div>
        ) : (
          <p className="px-2.5 pb-2 pt-1 text-[11px] leading-snug text-parchment-dim">
            {stage === "next"
              ? `Разведчики покажут путь, когда в колонии будет ${fmtInt(def.mapRevealRats)} 🐀 (сейчас ${rats})${
                  (def.expedition?.rats ?? 0) > def.mapRevealRats ? `; для похода нужно ${fmtInt(def.expedition!.rats)} 🐀` : ""
                }.`
              : "Глубже не спускался ни один хвост. Говорят, там гудит земля."}
          </p>
        )}
      </div>
    </li>
  );
});

interface ExpeditionModel {
  res: ResId[];
  done: boolean;
  rats: string;
  need: string;
  missing: string | null;
  digging: { frac: number; left: string } | null;
  busy: boolean;
  anyStock: boolean;
}

function expeditionModel(s: GameState, z: ZoneId): ExpeditionModel | null {
  const exp = ZONES[z].expedition;
  if (!exp) return null;
  const cost = expeditionCost(s, z);
  const prog = s.projects[z] ?? {};
  const digging = s.digging?.zone === z ? s.digging : null;
  return {
    res: entries(cost).map(([r]) => r),
    done: isComplete(cost, prog),
    rats: fmtInt(s.rats),
    need: fmtInt(exp.rats),
    missing: s.rats >= exp.rats ? null : fmtInt(exp.rats - s.rats),
    digging: digging ? { frac: Math.round((1 - (digging.until - s.time) / 5) * 50) / 50, left: fmtTime(Math.max(0, digging.until - s.time)) } : null,
    busy: !!s.digging,
    anyStock: entries(cost).some(([r, v]) => (prog[r] ?? 0) < v && s.res[r] > 0),
  };
}

function Expedition({ z }: { z: ZoneId }) {
  const json = useSampled((s) => JSON.stringify(expeditionModel(s.game, z)), 3, Object.is);
  const m = useMemo(() => JSON.parse(json) as ExpeditionModel | null, [json]);
  if (!m) return null;
  const give = (r?: ResId) => useGame.getState().contributeExpedition(z, r);

  return (
    <div className="mt-2 rounded-md border border-brass-dark/60 bg-soot/70 p-2 shadow-[inset_0_1px_4px_rgba(0,0,0,.6)]">
      <p className="mb-1.5 flex items-center gap-1.5 font-display text-sm font-bold text-brass-light">
        <span className={cx(m.digging && "rr-dig")}>⛏️</span>
        Экспедиция: прорыть ход
      </p>

      {m.digging ? (
        <div className="py-1">
          <Bar value={m.digging.frac} color="var(--gaslight)" className="h-3" />
          <p className="mt-1 text-center font-display text-sm font-bold text-gaslight">Копаем! Комья летят во все стороны… {m.digging.left}</p>
        </div>
      ) : (
        <>
          <div className="space-y-1.5">
            {m.res.map((r) => (
              <ExpeditionRow key={r} z={z} r={r} busy={m.busy} />
            ))}
          </div>

          <div className="mt-2 flex items-center gap-2 rounded border border-line/70 bg-black/25 px-2 py-1.5 text-xs">
            <span className="text-base">🐀</span>
            <span className="flex-1">
              Землекопов: <b className="font-mono tabular">{m.rats}</b> / {m.need}
            </span>
            <span className={cx("font-bold", m.missing ? "text-danger-light" : "text-good")}>{m.missing ? `ещё ${m.missing}` : "✓ хватает"}</span>
          </div>

          <div className="mt-2 flex flex-wrap gap-2">
            {m.done && !m.missing ? (
              <BrassButton tone="copper" className="rr-breathe min-h-10 flex-1" onClick={() => give()}>
                ⛏️ Начать раскопки!
              </BrassButton>
            ) : (
              <BrassButton className={cx("min-h-10 flex-1", m.anyStock && "rr-breathe")} disabled={!m.anyStock || m.busy} onClick={() => give()}>
                Внести всё
              </BrassButton>
            )}
          </div>
          {m.done && m.missing && (
            <p className="mt-1.5 text-[11px] leading-snug text-gaslight">Все взносы на месте. Ждём рабочих лап: нужно ещё {m.missing} 🐀.</p>
          )}
          <p className="mt-1.5 text-[10px] leading-snug text-parchment-dim">Проекту лимиты складов не помеха — вносите частями.</p>
        </>
      )}
    </div>
  );
}

const ExpeditionRow = memo(function ExpeditionRow({ z, r, busy }: { z: ZoneId; r: ResId; busy: boolean }) {
  const key = useSampled((s) => contribKey(expeditionCost(s.game, z)[r] ?? 0, s.game.projects[z]?.[r] ?? 0, s.game.res[r]), 3, Object.is);
  const [need, have] = key.split("|").map(Number);
  // the key holds the stock as displayed; the button needs the exact amount, read at render time
  const stock = useGame.getState().game.res[r];
  return <ContribRow r={r} need={need} have={have} stock={stock} locked={busy} onGive={() => useGame.getState().contributeExpedition(z, r)} />;
});
