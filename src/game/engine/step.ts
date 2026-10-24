import { HUMAN_ACTIVITIES } from "../data/headlines";
import { RESOURCES } from "../data/resources";
import { UPGRADE_IDS, ZONE_IDS, RES_IDS, type EngineCtx, type GameState, type TickInput } from "../types";
import { autoContribute, click, currentExpedition, foremanTick, openZone, smartAssign, upgradeVisible } from "./actions";
import { check } from "./conditions";
import { award, news } from "./core";
import { derive, type Derived } from "./derive";
import { tickEconomy } from "./economy";
import { onZoneOpen, tickEvents } from "./events";
import { canMigrate, humanClock } from "./formulas";

export const TICK = 0.1; // seconds per fixed step (10 Hz)

/**
 * Advance the whole game by dt seconds. Mutates `s`.
 * Order: time → bustle/autoclick → economy → digging → events → once-per-second housekeeping.
 */
export function step(s: GameState, dt: number, input: TickInput, ctx: EngineCtx): Derived {
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

  // housekeeping once per game second
  if (Math.floor(s.time) !== Math.floor(prevTime) || dt >= 1) {
    housekeeping(s, d, input, ctx);
    if (s.upgrades.foreman && Math.floor(s.time) % 2 === 0) foremanTick(s, d, ctx);
    if (s.autoContribute) autoContribute(s, d, ctx);
    if (s.assignMode === "smart" && s.upgrades.tube_orders && Math.floor(s.time) % 5 === 0) smartAssign(s, d);
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
    ctx.fx.push({ k: "frenzy" });
    news(s, "frenzy", {}, ctx);
  }
  void d;
}

function housekeeping(s: GameState, d: Derived, input: TickInput, ctx: EngineCtx): void {
  // achievements that are plain thresholds
  if (s.resEver.crumbs >= 1) award(s, "first_crumb", ctx);
  if (s.rats >= 100) award(s, "colony_100", ctx);
  if (s.rats >= 1000) award(s, "colony_1000", ctx);
  if (s.meta.lifetime.clicks >= 1000) award(s, "click_1000", ctx);
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
  const R = s.revealed;
  const set = (k: string, cond: boolean) => {
    if (!R[k] && cond) R[k] = true;
  };
  for (const r of RES_IDS) set(`res_${r}`, check(s, RESOURCES[r].reveal) || s.res[r] > 0);
  set("tab_buildings", !!s.flags.vagrants || s.resEver.crumbs >= 10);
  set("tab_jobs", s.rats >= 2);
  set("tab_upgrades", UPGRADE_IDS.some((u) => upgradeVisible(s, u)));
  set("news", s.rats >= 5 || s.meta.migrations > 0);
  set("goal", s.time >= 120 || s.meta.migrations > 0);
  set("tab_map", s.rats >= 12 || !!s.zones.sewers);
  set("tab_schedule", !!s.flags.first_capsule || !!s.zones.metro || !!s.zones.sewers);
  set("suspicion", !!s.zones.cellars);
  set("tab_migration", !!s.zones.metro || s.meta.migrations > 0);
  set("tab_medals", Object.keys(s.meta.achievements).length > 0);
  set("steam", s.buildings.boiler > 0);
  set("bustle", !!s.upgrades.bustle);
  const exp = currentExpedition(s);
  if (exp) set(`exp_${exp}`, true);
  for (const z of ZONE_IDS) if (s.zones[z]) set(`zone_${z}`, true);

  if (canMigrate(s) && !s.flags.migration_ready) {
    s.flags.migration_ready = true;
    news(s, "migration_ready", {}, ctx);
    ctx.fx.push({ k: "toast", text: "Великое Переселение доступно! Загляните во вкладку «Переселение»", icon: "👑", tone: "gold" });
  }

  // a new rat generation every 3 real minutes (flavour)
  if (!input.offline && s.time >= s.timers.nextGeneration) {
    s.timers.nextGeneration += 180;
    s.generation++;
    const hh = humanClock(s).hh;
    let act = HUMAN_ACTIVITIES[0][1];
    for (const [h, a] of HUMAN_ACTIVITIES) if (hh >= h) act = a;
    news(s, "generation", { n: s.generation, human: act }, ctx);
  } else if (input.offline && s.time >= s.timers.nextGeneration) {
    const gens = Math.floor((s.time - s.timers.nextGeneration) / 180) + 1;
    s.generation += gens;
    s.timers.nextGeneration += 180 * gens;
  }
  void d;
}
