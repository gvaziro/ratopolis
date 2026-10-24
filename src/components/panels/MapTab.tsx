"use client";

/**
 * "Карта": the five zones as strata of a vertical map of the underworld. The next zone carries
 * the expedition project (per-resource contributions, rats requirement, digging); the Rat Express
 * panel sits on top once its blueprint is bought.
 */
import { useEffect, useRef } from "react";
import { UPGRADES } from "@/game/data/upgrades";
import { ZONE_ORDER, ZONES } from "@/game/data/zones";
import { currentExpedition } from "@/game/engine/actions";
import { entries, expeditionCost, isComplete } from "@/game/engine/formulas";
import { useGame } from "@/game/store";
import type { GameState, ResId, ZoneId } from "@/game/types";
import { fmtInt, fmtTime } from "@/lib/format";
import { Badge, Bar, BrassButton, Stamp, cx } from "@/components/ui/kit";
import { isFresh } from "./alerts";
import { ContribRow, Switch, Toolbar } from "./common";
import ExpressPanel from "./ExpressPanel";

const DEPTH: Record<ZoneId, string> = {
  burrow: "−3 фута",
  sewers: "−12 футов",
  cellars: "−20 футов",
  metro: "−45 футов",
  terminal: "−70 футов",
};

type Stage = "open" | "project" | "next" | "unknown";

export default function MapTab() {
  const game = useGame((s) => s.game);
  const exp = currentExpedition(game);
  const firstClosed = ZONE_ORDER.findIndex((z) => !game.zones[z]);

  const stageOf = (z: ZoneId, i: number): Stage => {
    if (game.zones[z]) return "open";
    if (i === firstClosed) return exp === z ? "project" : "next";
    return "unknown";
  };

  return (
    <>
      <Toolbar
        icon="🗺️"
        title="Карта подземелья"
        right={
          <Switch
            on={game.autoContribute}
            onToggle={() => useGame.getState().toggleAutoContribute()}
            label="Автовзнос"
            sub="только то, что не влезает в полный склад"
          />
        }
      />

      {game.upgrades.express_plan ? (
        <ExpressPanel />
      ) : (
        game.zones.terminal && (
          <p className="mb-4 rounded-md border border-dashed border-brass-dark/70 bg-brass/5 px-3 py-2 text-xs leading-snug text-parchment-dim">
            <b className="text-brass-light">🚂 Слухи на вокзале:</b> из хлама можно собрать собственный поезд. Нужен «{UPGRADES.express_plan.name}» во вкладке «Улучшения».
          </p>
        )
      )}

      <ol className="relative">
        {/* the shaft connecting the strata */}
        <span aria-hidden className="absolute bottom-6 left-[19px] top-6 w-0.5 bg-[repeating-linear-gradient(to_bottom,var(--brass-dark)_0_6px,transparent_6px_11px)]" />
        {ZONE_ORDER.map((z, i) => (
          <Stratum key={z} s={game} z={z} stage={stageOf(z, i)} />
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

function Stratum({ s, z, stage }: { s: GameState; z: ZoneId; stage: Stage }) {
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
    <li ref={ref} className="relative mb-3 flex gap-2.5 last:mb-0">
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
              {stage === "project" && isFresh(s, `x_${z}`) && (
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
            {stage === "project" && <Expedition s={s} z={z} />}
          </div>
        ) : (
          <p className="px-2.5 pb-2 pt-1 text-[11px] leading-snug text-parchment-dim">
            {stage === "next"
              ? `Разведчики покажут путь, когда в колонии будет ${fmtInt(def.mapRevealRats)} 🐀 (сейчас ${fmtInt(s.rats)}).`
              : "Глубже не спускался ни один хвост. Говорят, там гудит земля."}
          </p>
        )}
      </div>
    </li>
  );
}

function Expedition({ s, z }: { s: GameState; z: ZoneId }) {
  const exp = ZONES[z].expedition;
  if (!exp) return null;
  const cost = expeditionCost(s, z);
  const prog = s.projects[z] ?? {};
  const done = isComplete(cost, prog);
  const ratsOk = s.rats >= exp.rats;
  const digging = s.digging?.zone === z ? s.digging : null;
  const busy = !!s.digging;
  const anyStock = entries(cost).some(([r, v]) => (prog[r] ?? 0) < v && s.res[r] > 0);
  const give = (r?: ResId) => useGame.getState().contributeExpedition(z, r);

  return (
    <div className="mt-2 rounded-md border border-brass-dark/60 bg-soot/70 p-2 shadow-[inset_0_1px_4px_rgba(0,0,0,.6)]">
      <p className="mb-1.5 flex items-center gap-1.5 font-display text-sm font-bold text-brass-light">
        <span className={cx(digging && "rr-dig")}>⛏️</span>
        Экспедиция: прорыть ход
      </p>

      {digging ? (
        <div className="py-1">
          <Bar value={1 - (digging.until - s.time) / 5} color="var(--gaslight)" className="h-3" />
          <p className="mt-1 text-center font-display text-sm font-bold text-gaslight">
            Копаем! Комья летят во все стороны… {fmtTime(Math.max(0, digging.until - s.time))}
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-1.5">
            {entries(cost).map(([r, v]) => (
              <ContribRow key={r} r={r} need={v} have={prog[r] ?? 0} stock={s.res[r]} locked={busy} onGive={() => give(r)} />
            ))}
          </div>

          <div className="mt-2 flex items-center gap-2 rounded border border-line/70 bg-black/25 px-2 py-1.5 text-xs">
            <span className="text-base">🐀</span>
            <span className="flex-1">
              Землекопов: <b className="font-mono tabular">{fmtInt(s.rats)}</b> / {fmtInt(exp.rats)}
            </span>
            <span className={cx("font-bold", ratsOk ? "text-good" : "text-danger-light")}>{ratsOk ? "✓ хватает" : `ещё ${fmtInt(exp.rats - s.rats)}`}</span>
          </div>

          <div className="mt-2 flex flex-wrap gap-2">
            {done && ratsOk ? (
              <BrassButton tone="copper" className="rr-breathe min-h-10 flex-1" onClick={() => give()}>
                ⛏️ Начать раскопки!
              </BrassButton>
            ) : (
              <BrassButton className={cx("min-h-10 flex-1", anyStock && "rr-breathe")} disabled={!anyStock || busy} onClick={() => give()}>
                Внести всё
              </BrassButton>
            )}
          </div>
          {done && !ratsOk && (
            <p className="mt-1.5 text-[11px] leading-snug text-gaslight">Все взносы на месте. Ждём рабочих лап: нужно ещё {fmtInt(exp.rats - s.rats)} 🐀.</p>
          )}
          <p className="mt-1.5 text-[10px] leading-snug text-parchment-dim">Проекту лимиты складов не помеха — вносите частями.</p>
        </>
      )}
    </div>
  );
}
