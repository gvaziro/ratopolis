import type { EngineCtx, GameState, TickInput } from "../types";
import { HEADLINES } from "../data/headlines";
import { ACHIEVEMENT_ORDER, ACHIEVEMENTS } from "../data/meta";
import { applyReveals, autoContribute, click, foremanTick, openZone, smartAssign } from "./actions";
import { award, news, pushNews } from "./core";
import { checkCommission } from "./commissions";
import { progressStat } from "./progress";
import { rand } from "./rng";
import { derive, highestZoneId, type Derived } from "./derive";
import { tickEconomy } from "./economy";
import { onZoneOpen, tickEvents } from "./events";
import { canMigrate, humanActivity, humanClock } from "./formulas";

export const TICK = 0.1; // seconds per fixed step (10 Hz)

/**
 * Test/dev hook (EN-8): called at the start of every step. Tests set it to throw and check that the store stops
 * publishing and saving; production code never sets it.
 */
export const stepHooks: { before: ((s: GameState) => void) | null } = { before: null };

/**
 * Advance the whole game by dt seconds. Mutates `s`.
 * Order: time → bustle/autoclick → economy → digging → events → once-per-second housekeeping.
 */
export function step(s: GameState, dt: number, input: TickInput, ctx: EngineCtx): Derived {
  if (stepHooks.before) stepHooks.before(s);
  const prevTime = s.time;
  s.time += dt;
  s.meta.lifetime.playSeconds += dt;
  const d = derive(s);

  if (!input.offline) {
    tickBustle(s, d, dt, ctx);
    if (d.autoclick.cps > 0) {
      s.autoclickAcc += d.autoclick.cps * dt;
      let n = 0;
      while (s.autoclickAcc >= 1 && n++ < 20) {
        s.autoclickAcc -= 1;
        click(s, d, ctx, { auto: true });
      }
    }
  }

  tickEconomy(s, d, dt, input, ctx);

  if (s.digging && s.time >= s.digging.until) {
    const z = s.digging.zone;
    openZone(s, z, ctx);
    onZoneOpen(s, z);
  }

  tickEvents(s, d, dt, input, ctx);

  // housekeeping once per game second; the Foreman every 2 s, smart assignment every 5 s (a crossing of the period
  // boundary, not floor(time) % n: offline steps of 12/24/48 s would keep the same parity and run every step or never)
  if (Math.floor(s.time) !== Math.floor(prevTime) || dt >= 1) {
    const every = (period: number) => dt >= period || Math.floor(s.time / period) !== Math.floor(prevTime / period);
    housekeeping(s, d, input, ctx);
    if (s.upgrades.foreman && every(2)) foremanTick(s, d, ctx);
    if (s.autoContribute) autoContribute(s, d, ctx, Math.max(1, dt), input.offline?.eta ?? 1);
    if (s.assignMode === "smart" && s.upgrades.tube_orders && every(5)) smartAssign(s, d);
  }
  return d;
}

function tickBustle(s: GameState, d: Derived, dt: number, ctx: EngineCtx): void {
  if (!s.upgrades.bustle) return;
  const b = s.bustle;
  if (s.time - b.lastClickAt > 0.8) b.value = Math.max(0, b.value - 10 * dt);
  if (b.value >= 100 && s.buffs.frenzyUntil <= s.time && s.buffs.frenzyCooldownUntil <= s.time) {
    s.buffs.frenzyUntil = s.time + 10;
    s.buffs.frenzyCooldownUntil = s.time + 25;
    b.value = 0;
    s.stats.frenzies++;
    s.meta.lifetime.frenzies++;
    ctx.fx.push({ k: "frenzy" });
    news(s, "frenzy", {}, ctx);
  }
  void d;
}

/** Medals with a progress counter (awarded by housekeeping when the counter reaches the goal). */
const PROGRESS_MEDALS = ACHIEVEMENT_ORDER.filter((id) => ACHIEVEMENTS[id].progress);

function progressReached(s: GameState, id: (typeof PROGRESS_MEDALS)[number]): boolean {
  const p = ACHIEVEMENTS[id].progress!;
  return progressStat(s, p.stat) >= p.goal;
}

/** The no-repeat ring of filler headlines (EN-10). */
const FILLER_RING = 8;

/**
 * Filler headlines (EN-10): first at 150 s, then every 70–120 s, only when the paper has been quiet for 45 s.
 * Pool: the general filler, the highest open zone's, the district's and the crowned ones; never one of the last 8.
 */
function fillerNews(s: GameState, ctx: EngineCtx): void {
  if (s.time < s.timers.filler) return;
  const last = s.news[s.news.length - 1];
  if (last && s.time - last.t < 45) {
    s.timers.filler = last.t + 45;
    return;
  }
  s.timers.filler = s.time + 70 + 50 * rand(s);
  const pool = [
    ...(HEADLINES.filler ?? []),
    ...(HEADLINES[`filler_${highestZoneId(s)}`] ?? []),
    ...(HEADLINES[`filler_d${s.meta.district % 6}`] ?? []),
    ...(s.flags.coronation || s.meta.coronations > 0 ? (HEADLINES.filler_crowned ?? []) : []),
  ].filter((x) => !s.newsRecent.includes(x));
  if (!pool.length) return;
  const text = pool[Math.floor(rand(s) * pool.length)];
  s.newsRecent.push(text);
  if (s.newsRecent.length > FILLER_RING) s.newsRecent.splice(0, s.newsRecent.length - FILLER_RING);
  pushNews(s, text, ctx);
}

function housekeeping(s: GameState, d: Derived, input: TickInput, ctx: EngineCtx): void {
  // achievements that are plain thresholds; every counter medal (ACHIEVEMENTS[id].progress) is awarded at its goal
  if (s.resEver.crumbs >= 1) award(s, "first_crumb", ctx);
  for (const id of PROGRESS_MEDALS) if (s.meta.achievements[id] === undefined && progressReached(s, id)) award(s, id, ctx);
  if (s.resEver.rails >= 1 && s.meta.achievements.first_rail === undefined) {
    award(s, "first_rail", ctx);
    news(s, "first_rail", {}, ctx);
  }
  if (s.resEver.gears >= 1 && !s.revealed.news_gear) {
    s.revealed.news_gear = true;
    news(s, "first_gear", {}, ctx);
  }
  if (s.resEver.brass >= 1 && !s.revealed.news_brass) {
    s.revealed.news_brass = true;
    news(s, "first_brass", {}, ctx);
  }

  // sticky UI reveals
  applyReveals(s);

  if (canMigrate(s) && !s.flags.migration_ready) {
    s.flags.migration_ready = true;
    news(s, "migration_ready", {}, ctx);
    ctx.fx.push({ k: "toast", text: "Великое Переселение доступно! Загляните во вкладку «Переселение»", icon: "👑", tone: "gold" });
  }

  if (!input.offline) {
    fillerNews(s, ctx);
    checkCommission(s, ctx);
  }

  // a new rat generation every 3 real minutes (flavour)
  if (!input.offline && s.time >= s.timers.nextGeneration) {
    s.timers.nextGeneration += 180;
    s.generation++;
    news(s, "generation", { n: s.generation, human: humanActivity(humanClock(s).hh) }, ctx);
  } else if (input.offline && s.time >= s.timers.nextGeneration) {
    const gens = Math.floor((s.time - s.timers.nextGeneration) / 180) + 1;
    s.generation += gens;
    s.timers.nextGeneration += 180 * gens;
  }
  void d;
}
