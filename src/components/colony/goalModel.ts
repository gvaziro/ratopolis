/**
 * «Цели колонии» 2.0 (COL-2): the pure model behind GoalWidget. In order: what is worth building right now
 * (goals.ts buildNowPick — «Выгодно сейчас» with the minutes it saves, or the cheapest «Можно построить»), the crowns or
 * the coronation, the dig / the expedition / the next unlock with an honest bottleneck (projectBottleneck: potential
 * production, so a full store never reads «≈ 1e25 д»; a full store the project needs says «склад полон — внесите» and
 * the row contributes it), the Rat Express stage — after the coronation the next wagon and the King's commission —
 * and the nearest building and upgrade with time to afford. No React, no DOM (goalModel.test.ts).
 */
import { BUILDINGS, BUILDING_ORDER } from "@/game/data/buildings";
import { COMMISSIONS } from "@/game/data/commissions";
import { RESOURCES } from "@/game/data/resources";
import { UPGRADES, UPGRADE_ORDER } from "@/game/data/upgrades";
import { ZONES } from "@/game/data/zones";
import { buildingVisible, currentExpedition, expressCost, upgradeVisible } from "@/game/engine/actions";
import type { Derived } from "@/game/engine/derive";
import {
  affordFraction,
  buildingCost,
  canAfford,
  canMigrate,
  crownsForRun,
  entries,
  expeditionCost,
  lockedByCap,
  marketValue,
  nextCrownAt,
  prevCrownAt,
  timeToAfford,
} from "@/game/engine/formulas";
import { buildNowPick, currentProject, ETA_LONG_SEC, projectBottleneck, type Bottleneck } from "@/game/engine/goals";
import { resourceSources } from "@/game/engine/hints";
import { commissionProgress } from "@/game/engine/progress";
import { RES_IDS, T1, type Amounts, type BuildingId, type GameState, type ResId, type TabId, type ZoneId } from "@/game/types";
import { fmt, fmtInt, fmtTime } from "@/lib/format";
import { nextLocked } from "./geometry";

/** A row click that contributes (a full store the project needs) instead of opening the tab. */
export type GoalContribute = { kind: "expedition"; zone: ZoneId; res: ResId[] } | { kind: "express"; res: ResId[] };

export interface Goal {
  /** Stable identity of the goal (a new first goal wakes a faded widget). */
  key: string;
  icon: string;
  name: string;
  /** Seconds to afford; -1 = never at current rates; -2 = not applicable (the note is shown instead). */
  eta: number;
  frac: number;
  note?: string;
  /** Second line (the project's bottleneck). */
  sub?: string;
  /** The sub line is bad news (a resource nobody gathers). */
  warn?: boolean;
  locked?: boolean;
  /** Icons of missing resources nobody produces (eta −1). */
  dry?: string;
  tone?: "good" | "gold";
  tab: TabId;
  target?: string;
  /** Short label for the compact pill when there is no ETA. */
  short: string;
  contribute?: GoalContribute;
}

/* ------------------------------------------------------------ storage-only buildings */

const T1G: readonly ResId[] = [...T1, "gears", "cheese"];

/** Buildings whose every effect is a storage limit (cap / capMult / steamCap) → the resources they hold. */
const STORAGE_RES: Partial<Record<BuildingId, ResId[]>> = (() => {
  const out: Partial<Record<BuildingId, ResId[]>> = {};
  for (const id of BUILDING_ORDER) {
    const effs = BUILDINGS[id].effects;
    if (!effs.length || !effs.every((e) => e.t === "cap" || e.t === "capMult" || e.t === "steamCap")) continue;
    const rs = new Set<ResId>();
    for (const e of effs) {
      if (e.t === "cap") rs.add(e.res);
      else if (e.t === "capMult") (e.group === "T1" ? T1 : T1G).forEach((r) => rs.add(r));
      else if (e.t === "steamCap") rs.add("steam");
    }
    out[id] = [...rs];
  }
  return out;
})();

/** Resources at ≥ 99% of a finite limit. */
export function fullStores(s: GameState, d: Derived): Set<ResId> {
  const out = new Set<ResId>();
  for (const r of RES_IDS) if (isFull(s, d, r)) out.add(r);
  return out;
}

function isFull(s: GameState, d: Derived, r: ResId): boolean {
  const cap = d.caps[r];
  return Number.isFinite(cap) && cap > 0 && s.res[r] >= 0.99 * cap;
}

/* ------------------------------------------------------------ maths and copy */

const round50 = (f: number) => (Number.isFinite(f) ? Math.round(Math.max(0, Math.min(1, f)) * 50) / 50 : 0);

/** Missing parts of a price that nobody produces (net rate ≤ 0), as icons. */
function dryIcons(s: GameState, cost: Amounts): string {
  let out = "";
  for (const [r, v] of entries(cost)) if (v > s.res[r] + 1e-9 && s.rates[r] <= 0) out += RESOURCES[r].icon;
  return out;
}

function projectFrac(cost: Amounts, prog: Amounts): number {
  const list = entries(cost);
  return list.length ? list.reduce((a, [r, v]) => a + Math.min(1, (prog[r] ?? 0) / v), 0) / list.length : 0;
}

/** «≈ 12м 30с» for an ETA, «долго» past ETA_LONG_SEC (never «e+» or «1234д»). */
export function etaWords(sec: number): string {
  if (!Number.isFinite(sec) || sec > ETA_LONG_SEC) return "долго";
  return `≈ ${fmtTime(sec)}`;
}

/** The Elder's fix for a slow resource: «→ больше 🎩» (the job that makes it), else the building's icon. */
function fixFor(s: GameState, r: ResId): string {
  const src = resourceSources(s, r);
  const job = src.find((x) => x.kind === "job");
  if (job) return ` → больше ${job.icon}`;
  const b = src.find((x) => x.kind === "building");
  return b ? ` → ${b.icon}` : "";
}

/** «≈ на 4 мин ближе» for minutesSaved. */
function savedWords(min: number): string {
  if (min * 60 >= ETA_LONG_SEC) return "станет намного ближе";
  if (min < 1) return `≈ на ${Math.max(1, Math.round(min * 60))} с ближе`;
  if (min < 90) return `≈ на ${Math.round(min)} мин ближе`;
  return `≈ на ${fmtTime(min * 60)} ближе`;
}

/** Contributed-and-needed resources of a project whose store is full (worth putting in right away). */
function fullNeeded(s: GameState, d: Derived, need: Amounts, paid: Amounts): ResId[] {
  const out: ResId[] = [];
  for (const [r, v] of entries(need)) if (v - (paid[r] ?? 0) > 1e-9 && s.res[r] > 0 && isFull(s, d, r)) out.push(r);
  return out;
}

/** Everything still missing (the stock already covers it: the project could be finished with one click). */
function coveredNow(need: Amounts, paid: Amounts): ResId[] {
  const out: ResId[] = [];
  for (const [r, v] of entries(need)) if (v - (paid[r] ?? 0) > 1e-9) out.push(r);
  return out;
}

interface ProjectLine {
  sub: string;
  short: string;
  warn: boolean;
  /** ETA column (seconds; -1 = nobody makes `dry`; -2 = the note instead). */
  eta: number;
  note?: string;
  dry?: string;
  /** Resources a click puts in (empty: everything is paid already); null: the click opens the tab. */
  contribute: ResId[] | null;
}

/** The sub line of a project row from its bottleneck and the full stores it needs. */
function projectLine(s: GameState, d: Derived, need: Amounts, paid: Amounts, b: Bottleneck | null): ProjectLine {
  const full = fullNeeded(s, d, need, paid);
  if (full.length) {
    const icons = full.map((r) => RESOURCES[r].icon).join("");
    return { sub: `${icons} склад полон — внесите`, short: `${icons} внесите!`, warn: false, eta: -2, note: "внести!", contribute: full };
  }
  if (!b) return { sub: "всё есть — внесите!", short: "внести!", warn: false, eta: -2, note: "внести!", contribute: coveredNow(need, paid) };
  const icon = RESOURCES[b.res].icon;
  if (!Number.isFinite(b.etaSec)) return { sub: `${icon} не добывается${fixFor(s, b.res)}`, short: `${icon} не добывается`, warn: true, eta: -1, dry: icon, contribute: null };
  if (b.etaSec > ETA_LONG_SEC) return { sub: `дольше всего ждём ${icon} — долго${fixFor(s, b.res)}`, short: `${icon} долго`, warn: false, eta: Math.ceil(b.etaSec), contribute: null };
  return { sub: `дольше всего ждём ${icon} ${etaWords(b.etaSec)}`, short: etaWords(b.etaSec), warn: false, eta: Math.ceil(b.etaSec), contribute: null };
}

/** «Канализация», «Экспресс» or «Вагон №2»: what the current project is called in the «Выгодно сейчас» line. */
function projectName(s: GameState): string {
  const p = currentProject(s);
  if (!p) return "";
  if (p.kind === "expedition") return ZONES[p.zone].name;
  return s.express.stage < 10 ? "Экспресс" : `Вагон №${fmtInt(s.express.wagons + 1)}`;
}

/* ------------------------------------------------------------ the model */

/**
 * The goal rows, most useful first. `full` = the resources whose store counts as full for the storage rule (GoalWidget
 * passes those full for 30 s; default: full right now). The first row is the build-now pick whenever there is one.
 */
export function goalModel(s: GameState, d: Derived, full: ReadonlySet<ResId> = fullStores(s, d)): Goal[] {
  const out: Goal[] = [];
  const maxed = (id: BuildingId) => BUILDINGS[id].maxLevel !== undefined && s.buildings[id] >= BUILDINGS[id].maxLevel!;

  // storage only when a visible goal is held back by a limit, or a store has been brim-full
  const wanted = new Set(full);
  for (const id of BUILDING_ORDER) {
    if (STORAGE_RES[id] || maxed(id) || !buildingVisible(s, id)) continue;
    for (const r of lockedByCap(buildingCost(id, s.buildings[id]), d)) wanted.add(r);
  }
  for (const id of UPGRADE_ORDER) {
    if (s.upgrades[id] || !upgradeVisible(s, id)) continue;
    for (const r of lockedByCap(UPGRADES[id].cost, d)) wanted.add(r);
  }
  const skip = (id: BuildingId) => {
    const rs = STORAGE_RES[id];
    return !!rs && !rs.some((r) => wanted.has(r));
  };

  // 1. what to build right now (goals.ts: useful for the current project, else the cheapest)
  const pick = buildNowPick(s, d);
  if (pick) {
    const def = BUILDINGS[pick.id];
    const useful = pick.kind === "useful" && pick.minutesSaved !== null;
    const name = useful
      ? `Выгодно сейчас: ${def.icon} ${def.name} — «${projectName(s)}» ${savedWords(pick.minutesSaved ?? 0)}`
      : `Можно построить: ${def.name} (${fmtInt(s.buildings[pick.id] + 1)})`;
    out.push({ key: `build:${pick.id}`, icon: "✓", name, eta: -2, frac: 1, tone: "good", tab: "buildings", target: `b_${pick.id}`, short: `${def.icon} ${def.name}` });
  }

  // 2. the crowns of this run / the coronation
  if (s.coronatedThisRun) {
    const k = crownsForRun(s);
    out.push({ key: "crowned", icon: "🧳", name: "Король коронован — переселиться ×1.25", note: `+${fmtInt(k)} 👑`, eta: -2, frac: 1, tone: "gold", tab: "migration", short: `+${fmtInt(k)} 👑` });
  } else if (canMigrate(s)) {
    const k = crownsForRun(s);
    const next = nextCrownAt(s);
    const prev = prevCrownAt(s);
    out.push({
      key: "crowns",
      icon: "👑",
      name: `Венцы: +${fmtInt(k)} 👑`,
      note: `след. через ${fmt(Math.max(0, next - s.eRun))} 🪙`,
      eta: -2,
      frac: round50(next > prev ? (s.eRun - prev) / (next - prev) : 1),
      tab: "migration",
      short: `+${fmtInt(k)} 👑`,
    });
  }

  // 3. the dig, the expedition or the next unlock
  if (s.digging) {
    const z = s.digging.zone;
    const left = Math.max(0, s.digging.until - s.time);
    out.push({ key: `dig:${z}`, icon: "⛏️", name: `Копаем: ${ZONES[z].name}`, eta: Math.ceil(left), frac: round50(1 - left / 5), tab: "map", target: `z_${z}`, short: "копаем!" });
  } else {
    const z = currentExpedition(s);
    if (z) {
      const cost = expeditionCost(s, z);
      const prog = s.projects[z] ?? {};
      const need = ZONES[z].expedition?.rats ?? 0;
      const line = projectLine(s, d, cost, prog, projectBottleneck(s, d, cost, prog));
      // everything is paid: the crew is what we wait for (or, with the crew in, a click sends the expedition off)
      const paidUp = line.contribute !== null && line.contribute.length === 0;
      const go = paidUp && s.rats >= need;
      out.push({
        key: `exp:${z}`,
        icon: "🗺️",
        name: `Экспедиция: ${ZONES[z].name}`,
        note: `🐀 ${fmtInt(s.rats)}/${fmtInt(need)}`,
        sub: paidUp ? (go ? "всё собрано — в путь!" : "запасы есть, ждём крыс") : line.sub,
        warn: line.warn,
        eta: -2,
        frac: round50(projectFrac(cost, prog)),
        tab: "map",
        target: `z_${z}`,
        short: paidUp ? `🐀 ${fmtInt(s.rats)}/${fmtInt(need)}` : line.short,
        contribute: line.contribute && (line.contribute.length > 0 || go) ? { kind: "expedition", zone: z, res: line.contribute } : undefined,
      });
    } else {
      const nz = nextLocked(s);
      if (nz) {
        // two thresholds, both named: the scouts find the way at mapRevealRats, the expedition itself takes more
        const need = ZONES[nz].mapRevealRats;
        const crew = ZONES[nz].expedition?.rats ?? 0;
        out.push({
          key: `scout:${nz}`,
          icon: "🗺️",
          name: `${ZONES[nz].name}: разведка при ${fmtInt(need)} 🐀 (сейчас ${fmtInt(s.rats)})${crew > need ? `, поход — ${fmtInt(crew)} 🐀` : ""}`,
          eta: -2,
          frac: round50(need > 0 ? s.rats / need : 1),
          tab: "map",
          target: `z_${nz}`,
          short: `${fmtInt(s.rats)}/${fmtInt(need)} 🐀`,
        });
      }
    }
  }

  // 4. the Rat Express — after the coronation, the next wagon
  if (s.upgrades.express_plan) {
    const cost = expressCost(s);
    const prog = s.express.progress;
    const line = projectLine(s, d, cost, prog, projectBottleneck(s, d, cost, prog));
    const wagon = s.express.stage >= 10;
    const title = wagon ? `Вагон №${fmtInt(s.express.wagons + 1)}` : `Экспресс: этап ${fmtInt(s.express.stage + 1)}/10`;
    out.push({
      key: wagon ? `wagon:${s.express.wagons}` : `express:${s.express.stage}`,
      icon: wagon ? "🚃" : "🚂",
      name: title,
      note: line.note,
      sub: line.sub,
      warn: line.warn,
      eta: line.eta,
      dry: line.dry,
      frac: round50(projectFrac(cost, prog)),
      tab: "map",
      target: "x_express",
      short: wagon ? `🚃 ${line.short}` : `этап ${fmtInt(s.express.stage + 1)}: ${line.short}`,
      contribute: line.contribute?.length ? { kind: "express", res: line.contribute } : undefined,
    });
  }

  // 4b. the King's commission (after the coronation)
  if (s.commissions) {
    const p = commissionProgress(s);
    if (p) {
      const def = COMMISSIONS[p.id];
      out.push({
        key: `commission:${p.id}`,
        icon: "📜",
        name: def.name,
        note: `${fmtInt(p.cur)}/${fmtInt(p.goal)}`,
        eta: -2,
        frac: round50(p.goal > 0 ? p.cur / p.goal : 1),
        tone: "gold",
        tab: "map",
        target: "x_express",
        short: `📜 ${fmtInt(p.cur)}/${fmtInt(p.goal)}`,
      });
    } else
      out.push({ key: "commission:none", icon: "📜", name: "Король ждёт: выберите поручение", eta: -2, frac: 0, tone: "gold", tab: "map", target: "x_express", short: "📜 поручение" });
  }

  // 5. the nearest building out of reach
  let best: Goal | null = null;
  let bestT = Infinity;
  let bestV = Infinity;
  for (const id of BUILDING_ORDER) {
    if (maxed(id) || skip(id) || !buildingVisible(s, id)) continue;
    const def = BUILDINGS[id];
    const cost = buildingCost(id, s.buildings[id]);
    if (canAfford(s, cost)) continue;
    const t = timeToAfford(s, cost);
    const v = marketValue(cost);
    if (t < bestT || (t === bestT && v < bestV)) {
      bestT = t;
      bestV = v;
      best = {
        key: `b:${id}`,
        icon: def.icon,
        name: s.buildings[id] > 0 ? `${def.name} (${fmtInt(s.buildings[id] + 1)})` : def.name,
        eta: Number.isFinite(t) ? Math.ceil(t) : -1,
        dry: Number.isFinite(t) ? undefined : dryIcons(s, cost),
        frac: round50(affordFraction(s, cost)),
        locked: lockedByCap(cost, d).length > 0,
        tab: "buildings",
        target: `b_${id}`,
        short: def.name,
      };
    }
  }
  if (best) out.push(best);

  // 6. the nearest upgrade out of reach
  let bestU: Goal | null = null;
  bestT = Infinity;
  bestV = Infinity;
  for (const id of UPGRADE_ORDER) {
    if (s.upgrades[id] || !upgradeVisible(s, id)) continue;
    const cost = UPGRADES[id].cost;
    if (canAfford(s, cost)) continue;
    const t = timeToAfford(s, cost);
    const v = marketValue(cost);
    if (t < bestT || (t === bestT && v < bestV)) {
      bestT = t;
      bestV = v;
      bestU = {
        key: `u:${id}`,
        icon: UPGRADES[id].icon,
        name: UPGRADES[id].name,
        eta: Number.isFinite(t) ? Math.ceil(t) : -1,
        dry: Number.isFinite(t) ? undefined : dryIcons(s, cost),
        frac: round50(affordFraction(s, cost)),
        locked: lockedByCap(cost, d).length > 0,
        tab: "upgrades",
        target: `u_${id}`,
        short: UPGRADES[id].name,
      };
    }
  }
  if (bestU) out.push(bestU);

  if (!out.length) out.push({ key: "calm", icon: "🎩", name: "Колония в полном порядке", note: "копим впрок", eta: -2, frac: 1, tab: "buildings", short: "всё в порядке" });
  return out;
}

/* ------------------------------------------------------------ row copy */

/** The ETA column of a row: «🔒 нужен склад», the note, «нет дохода 🪙», «почти!», «≈ 3м 12с» or «долго». */
export function etaText(g: Goal): string {
  if (g.locked) return "🔒 нужен склад";
  if (g.eta === -2) return g.note ?? "";
  if (g.eta === -1) return `нет дохода ${g.dry ?? ""}`.trim();
  if (g.eta <= 0) return "почти!";
  return etaWords(g.eta);
}

/** The compact pill's text for the first goal. */
export function pillText(g: Goal): string {
  if (g.locked) return "🔒 склад";
  if (g.eta === -1) return `нет дохода ${g.dry ?? ""}`.trim();
  if (g.contribute) return g.short;
  if (g.eta >= 0) return g.eta <= 0 ? "почти!" : g.eta > ETA_LONG_SEC ? "долго" : fmtTime(g.eta);
  return g.short;
}
