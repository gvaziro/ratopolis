/**
 * npm run sim -- [--bot active|passive|both|newcomer|all] [--runs 1..8] [--minutes N] [--seed N] [--strict] [--quiet]
 *                [--summary] [--replicates N] [--policy never-migrate] [--long] [--steam] [--binding] [--tails]
 *                [--seal railway|silence|dynasty|auto] [--district id[@run]]
 *
 * Deterministic headless balance runs (GDD 15.14): an active and a passive bot drive the real engine.
 * Prints checkpoint tables, the GDD 15.14 checkpoints with PASS/FAIL (±25%), passive windows,
 * runs 2/3 against GDD 14.2, time to coronation and the acceptance checks.
 *
 * v3 (ENG-2):
 * - --bot newcomer: a player who follows the elder's hints and «Выгодно сейчас» (sim-core Bot "newcomer"); prints the
 *   «Новичок» table (zone times, first metro train, hint streaks, idle gaps, forager share, the trash-chute share).
 *   --bot all = active + passive + newcomer.
 * - --replicates N: the same seed with N bot RNG streams (seed ^ k·0x9e37, k = 0 is the plain run) in worker threads;
 *   every check is judged on the median and printed as median (min–max).
 * - --policy never-migrate: an extra active run that never migrates (170 min) and the v3 check that it does not
 *   coronate before the scripted route.
 * - --long (with --runs up to 8): from run 3 on, 20 min of commissions after every coronation, then the migration;
 *   prints «Долгая игра» and the v3 late-game checks (INFO unless --strict).
 * - --steam: the run-2 steam line per minute; --binding: when each project resource was in hand, the last one binds;
 *   --tails: the SUMMARY carries the tails sim-matrix tabulates.
 * - --seal (ENG-8 ablation): the active bot buys and keeps this Great Seal (default railway; auto = Dynasty from the
 *   4th migration on, else Railway).
 * - --district id[@run] (ENG-11 ablation): the active bot's run `run` (default 3) plays in that district, visited or
 *   not (scripts/sim-traits.ts runs all twelve against «Туман»). --long also prints the curios owned and judges
 *   «Кунсткамера» after run 7 (ENG-10: 8–18 of 24).
 * Without the new flags the output keeps its v2 shape; the checkpoint «🪙/с пас» is now the 120-s mean of gross coins
 * (was the EMA30 sample) and «забег 2: Вокзал» (44–56 мин) is judged only on the replicate median (single run: INFO).
 */
import os from "node:os";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";
import { ACHIEVEMENTS, ACHIEVEMENT_ORDER, EDICTS, EDICT_ORDER } from "../src/game/data/meta";
import { RESOURCES } from "../src/game/data/resources";
import { BUILDINGS } from "../src/game/data/buildings";
import { ZONE_ORDER } from "../src/game/data/zones";
import { districtInfo } from "../src/game/data/districts";
import { edictRank } from "../src/game/engine/ranks";
import { DISTRICT_IDS, type DistrictId, type ResId, type ZoneId } from "../src/game/types";
import { applyOverrides, fmtMin, PRE_TUNING_OVERRIDES, simulate, type Checkpoint, type RunReport, type SimPolicy, type SimSeal } from "./sim-core";
import { aggregateChecks, fmtAggregate, fmtValue, judgeValue, type Aggregate, type CheckValue, type Judge, type Unit, type Verdict } from "./simStats";

/* ---------------------------------------------------------------- args */

type BotArg = "active" | "passive" | "both" | "newcomer" | "all";

interface Args {
  bot: BotArg;
  runs: number;
  minutes: number | null;
  seed: number;
  strict: boolean;
  quiet: boolean;
  /** Print one machine-readable SUMMARY line (for tuning scripts). */
  summary: boolean;
  /** Run with the data tables as they were before balance tuning. */
  preTuning: boolean;
  /** Bot RNG streams on the same seed (1 = a single run). */
  replicates: number;
  policy: SimPolicy;
  /** The active bot's Great Seal (ENG-8 --seal). */
  seal: SimSeal;
  long: boolean;
  steam: boolean;
  binding: boolean;
  tails: boolean;
  /** ENG-11 ablation: force run `run`'s district. */
  district: { id: DistrictId; run: number } | null;
}

const MAX_RUNS = 8;
const USAGE =
  "npm run sim -- [--bot active|passive|both|newcomer|all] [--runs 1..8] [--minutes N] [--seed N] [--strict] [--quiet] [--summary] [--replicates N] [--policy never-migrate] [--long] [--steam] [--binding] [--tails] [--seal railway|silence|dynasty|auto] [--district id[@run]]";

function parseArgs(argv: string[]): Args {
  const a: Args = {
    bot: "both",
    runs: 3,
    minutes: null,
    seed: 12345,
    strict: false,
    quiet: false,
    summary: false,
    preTuning: false,
    replicates: 1,
    policy: "scripted",
    seal: "railway",
    long: false,
    steam: false,
    binding: false,
    tails: false,
    district: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === "--bot" && v) {
      if (!["active", "passive", "both", "newcomer", "all"].includes(v)) throw new Error(`--bot must be active|passive|both|newcomer|all, got ${v}`);
      a.bot = v as BotArg;
      i++;
    } else if (k === "--runs" && v) {
      a.runs = Math.max(1, Math.min(MAX_RUNS, Math.floor(Number(v)) || 1));
      i++;
    } else if (k === "--minutes" && v) {
      a.minutes = Math.max(1, Number(v) || 60);
      i++;
    } else if (k === "--seed" && v) {
      a.seed = Math.floor(Number(v)) >>> 0;
      i++;
    } else if (k === "--replicates" && v) {
      a.replicates = Math.max(1, Math.min(16, Math.floor(Number(v)) || 1));
      i++;
    } else if (k === "--policy" && v) {
      if (v !== "never-migrate" && v !== "scripted") throw new Error(`--policy must be never-migrate|scripted, got ${v}`);
      a.policy = v;
      i++;
    } else if (k === "--seal" && v) {
      if (!["railway", "silence", "dynasty", "auto"].includes(v)) throw new Error(`--seal must be railway|silence|dynasty|auto, got ${v}`);
      a.seal = v as SimSeal;
      i++;
    } else if (k === "--district" && v) {
      const [id, run] = v.split("@");
      if (!(DISTRICT_IDS as readonly string[]).includes(id)) throw new Error(`--district must be one of ${DISTRICT_IDS.join("|")}, got ${id}`);
      a.district = { id: id as DistrictId, run: run ? Math.max(1, Math.floor(Number(run)) || 3) : 3 };
      i++;
    } else if (k === "--strict") a.strict = true;
    else if (k === "--quiet") a.quiet = true;
    else if (k === "--summary") a.summary = true;
    else if (k === "--pre-tuning") a.preTuning = true;
    else if (k === "--long") a.long = true;
    else if (k === "--steam") a.steam = true;
    else if (k === "--binding") a.binding = true;
    else if (k === "--tails") a.tails = true;
    else if (k === "--help" || k === "-h") {
      console.log(USAGE);
      process.exit(0);
    }
  }
  return a;
}

const runsActive = (a: Args) => a.bot === "active" || a.bot === "both" || a.bot === "all";
const runsPassive = (a: Args) => a.bot === "passive" || a.bot === "both" || a.bot === "all";
const runsNewcomer = (a: Args) => a.bot === "newcomer" || a.bot === "all";

/* ---------------------------------------------------------------- formatting */

function num(n: number): string {
  if (Number.isNaN(n)) return "—";
  if (!Number.isFinite(n)) return String(n);
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (a >= 1e4) return (n / 1e3).toFixed(1) + "K";
  if (a >= 100) return n.toFixed(0);
  if (a >= 10) return n.toFixed(1);
  return n.toFixed(2);
}

function pct(x: number): string {
  return (x * 100).toFixed(0) + "%";
}

function table(head: string[], rows: string[][]): string {
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (r: string[]) => r.map((c, i) => (i === 0 ? c.padEnd(w[i]) : c.padStart(w[i]))).join("  ");
  return [line(head), w.map((x) => "-".repeat(x)).join("  "), ...rows.map(line)].join("\n");
}

const ZONE_SHORT: Record<ZoneId, string> = { burrow: "Н", sewers: "К", cellars: "П", metro: "М", terminal: "В" };

function cpRows(cps: Checkpoint[]): string[][] {
  return cps.map((c) => [
    String(c.minute),
    `${c.rats}/${c.housing}`,
    ZONE_ORDER.slice(0, c.zones).map((z) => ZONE_SHORT[z]).join(""),
    num(c.crumbsPerSec),
    num(c.coinsPassive),
    num(c.coinsPerSec),
    num(c.eRun),
    `${pct(c.trainShare)}/${pct(c.trainCoinShare)}`,
    pct(c.eventShare),
    String(c.crowns),
    String(c.expressStage),
    c.suspicion.toFixed(0),
  ]);
}
const CP_HEAD = ["мин", "крысы", "зоны", "🍞/с", "🪙/с пас", "🪙/с всё", "E_run", "поезда ц/🪙", "события", "👑", "эксп", "👁"];

const icon = (r: ResId | null) => (r ? RESOURCES[r].icon : "—");

/* ---------------------------------------------------------------- checks */

/**
 * One check: its number and judge (CheckValue: what --replicates aggregates), the single-run text and verdict.
 * `replicated`: judged only on a replicate median (a single run reports INFO); `strictOnly`: INFO unless --strict.
 */
interface Check extends CheckValue {
  actual: string;
  verdict: Verdict;
  replicated?: boolean;
  strictOnly?: boolean;
}

const TOL = 0.25;

/** A check from its value; `actual` defaults to the value in its unit. */
function mk(group: string, name: string, target: string, value: number | null | undefined, unit: Unit, judge: Judge, actual?: string): Check {
  const v = value === undefined || value === null || !Number.isFinite(value) ? null : value;
  return { group, name, target, value: v, unit, judge, actual: actual ?? fmtValue(v, unit), verdict: judgeValue(judge, v) };
}

/** Value within [lo, hi] widened by ±25% (the GDD checkpoints). */
const within = (lo: number, hi: number): Judge => ({ k: "within", lo, hi, tol: TOL });
/** Exact window (v2/v3 targets). */
const range = (lo: number, hi: number): Judge => ({ k: "range", lo, hi });
const bool = (ok: boolean) => (ok ? 1 : 0);
const YES: Judge = { k: "atLeast", lo: 1 };

/** The single-run verdict: replicate-only checks and strict-only checks read INFO. */
function settle(c: Check, args: Args, replicated: boolean): Check {
  if ((c.replicated && !replicated) || (c.strictOnly && !args.strict)) return { ...c, verdict: "INFO", actual: c.verdict === "INFO" ? c.actual : `${c.actual} (${c.verdict === "PASS" ? "в окне" : "вне окна"})` };
  return c;
}

function cpAt(r: RunReport, minute: number): Checkpoint | undefined {
  return r.checkpoints.find((c) => c.minute === minute);
}

function minOf(sec: number | null | undefined): number | null {
  return sec === null || sec === undefined ? null : sec / 60;
}

function activeChecks(r: RunReport): Check[] {
  const g = "GDD 15.14 активный, забег 1";
  const out: Check[] = [];
  const add = (name: string, target: string, value: number | null | undefined, unit: Unit, judge: Judge, actual: string) => out.push(mk(g, name, target, value, unit, judge, actual));
  const c5 = cpAt(r, 5);
  add("мин 5: крысы", "15", c5?.rats, "int", within(15, 15), String(c5?.rats ?? "—"));
  add("мин 5: 🍞/с (пассив)", "≈ 8", c5?.crumbsPerSec, "num", within(8, 8), num(c5?.crumbsPerSec ?? NaN));
  add("мин 5: 🪙/с (пассив)", "≈ 0.6", c5?.coinsPassive, "num", within(0.6, 0.6), num(c5?.coinsPassive ?? NaN));
  add("Канализация открыта", "11:00", minOf(r.zoneOpenAt.sewers), "min", within(11, 11), fmtMin(r.zoneOpenAt.sewers));
  const c11 = cpAt(r, 11);
  add("мин 11: крысы", "25–30", c11?.rats, "int", within(25, 30), String(c11?.rats ?? "—"));
  add("первая капсула", "16:00", minOf(r.firstCapsuleAt), "min", within(16, 16), fmtMin(r.firstCapsuleAt));
  add("Подвалы открыты", "26:00", minOf(r.zoneOpenAt.cellars), "min", within(26, 26), fmtMin(r.zoneOpenAt.cellars));
  const c26 = cpAt(r, 26);
  add("мин 26: крысы", "60–70", c26?.rats, "int", within(60, 70), String(c26?.rats ?? "—"));
  add("мин 26: 🪙/с (пассив)", "≈ 12", c26?.coinsPassive, "num", within(12, 12), num(c26?.coinsPassive ?? NaN));
  add("Метро открыто", "42:00", minOf(r.zoneOpenAt.metro), "min", within(42, 42), fmtMin(r.zoneOpenAt.metro));
  const c42 = cpAt(r, 42);
  add("мин 42: крысы", "130–150", c42?.rats, "int", within(130, 150), String(c42?.rats ?? "—"));
  add("мин 42: 🪙/с (пассив)", "≈ 100", c42?.coinsPassive, "num", within(100, 100), num(c42?.coinsPassive ?? NaN));
  const c50 = cpAt(r, 50);
  add("мин 50: 🪙/с (пассив)", "≈ 150", c50?.coinsPassive, "num", within(150, 150), num(c50?.coinsPassive ?? NaN));
  // v2 (EN-2): the 10-minute window ends at minute 55, so it no longer straddles the metro opening (~42–45)
  const c55 = cpAt(r, 55);
  add("мин 55: доля поездов", "30–45%", c55?.trainShare, "pct", within(0.3, 0.45), c55 ? pct(c55.trainShare) : "—");
  add("E_run ≥ 1M", "62:00", minOf(r.eRun1MAt), "min", within(62, 62), fmtMin(r.eRun1MAt));
  const c80 = cpAt(r, 80);
  add("мин 80: E_run", "5–8M", c80?.eRun, "num", c80 ? within(5e6, 8e6) : { k: "info" }, c80 ? num(c80.eRun) : "—");
  add("мин 80: венцы", "22–28", c80?.crowns ?? r.crownsGained, "int", within(22, 28), c80 ? String(c80.crowns) : String(r.crownsGained) + " (при переселении)");
  return out;
}

function passiveChecks(r: RunReport): Check[] {
  const g = "GDD 15.14 пассивный";
  const win = (name: string, sec: number | null | undefined, lo: number, hi: number) => mk(g, name, `${lo}–${hi} мин`, minOf(sec), "min", within(lo, hi), fmtMin(sec));
  return [win("Канализация", r.zoneOpenAt.sewers, 18, 26), win("Подвалы", r.zoneOpenAt.cellars, 45, 60), win("Метро", r.zoneOpenAt.metro, 75, 100), win("E_run 1M", r.eRun1MAt, 110, 140)];
}

/**
 * GDD 14.2 windows of runs 2 and 3. Run 3 and later are reference only; v3 (ENG-2) set their windows to the spread
 * measured on seeds 12345, 777, 1, 2, 3 (the old table assumed far fewer edicts: Metro 12–15, Terminal 26–32).
 */
function laterRunChecks(r: RunReport): Check[] {
  const g = `GDD 14.2 забег ${r.run}`;
  const w = (name: string, sec: number | null | undefined, lo: number, hi: number) =>
    mk(g, name, `${lo}–${hi} мин`, minOf(sec), "min", lo === 0 && hi === 0 ? { k: "below", hi: 0.5 } : within(lo, hi), fmtMin(sec));
  if (r.run === 2)
    return [
      w("Канализация", r.zoneOpenAt.sewers, 4, 6),
      w("Подвалы", r.zoneOpenAt.cellars, 12, 15),
      w("Метро", r.zoneOpenAt.metro, 24, 28),
      w("Переселение доступно", r.migrateReadyAt, 36, 40),
      w("Вокзал", r.zoneOpenAt.terminal, 45, 55),
      w("Экспресс, этап 5", r.expressStageAt[4], 55, 80),
    ];
  return RUN3_WINDOWS.map(([name, pick, lo, hi]) => w(name, pick(r), lo, hi));
}

/**
 * GDD 14.2, run 3 and later (v3 ENG-2: the medians of seeds 12345, 777, 1, 2, 3 with their spread — Cellars 2:12,
 * Metro 6:12, Terminal 13:54 (8:18–16:12), stage 6 21:18 (16:54–24:30), coronation 37:42 (28:48–38:48)). The Sewers
 * open at once with «Старые ходы»; stages 1–5 are kept by «Чертежи экспресса», so stage 6 is the first one built.
 */
const RUN3_WINDOWS: [string, (r: RunReport) => number | null | undefined, number, number][] = [
  ["Канализация", (r) => r.zoneOpenAt.sewers, 0, 0],
  ["Подвалы", (r) => r.zoneOpenAt.cellars, 2, 3],
  ["Метро", (r) => r.zoneOpenAt.metro, 5, 7],
  ["Переселение доступно", (r) => r.migrateReadyAt, 5, 7],
  ["Вокзал", (r) => r.zoneOpenAt.terminal, 8, 16],
  ["Экспресс, этап 6", (r) => r.expressStageAt[5], 17, 25],
  ["Коронация", (r) => r.coronationAt, 29, 40],
];

function acceptance(active: RunReport[] | null, passive: RunReport[] | null, newcomer: RunReport[] | null): Check[] {
  const g = "Приёмка";
  const out: Check[] = [];
  const all = [...(active ?? []), ...(passive ?? []), ...(newcomer ?? [])];
  const bad = all.flatMap((r) => r.nonFinite.map((b) => `${r.bot}#${r.run} ${b}`));
  out.push(mk(g, "нет NaN/Infinity в ресурсах", "0", bad.length, "int", { k: "atMost", hi: 0 }, bad.length ? bad.slice(0, 3).join("; ") : "0"));
  if (active) {
    const worst = active.reduce((a, r) => (r.maxStorageStall > a.maxStorageStall ? r : a), active[0]);
    out.push(mk(g, "активный: простой из-за склада", "≤ 3:00", worst.maxStorageStall, "sec", { k: "atMost", hi: 180 }, `${fmtMin(worst.maxStorageStall)} (забег ${worst.run}, ${fmtMin(worst.maxStorageStallAt)})`));
    const off = active[0].offlineCheck;
    if (off) out.push(mk(g, "офлайн 8 ч ≤ T·доход·η + поезда", `≤ ${num(off.boundValue)}`, bool(off.ok), "bool", YES, `${num(off.gainedValue)} (сим. ${fmtMin(off.simulated)}, η ${off.eta})`));
  }
  if (passive) {
    const r = passive[0];
    // goals land on the bot's check-ins, so a gap of exactly four of them is 240 s plus float drift of the 0.1 s ticks
    out.push(mk(g, "пассивный: ожидание новой цели", "≤ 4:00", Math.round(r.maxGoalGap), "sec", { k: "atMost", hi: 240 }, `${fmtMin(r.maxGoalGap)} (в ${fmtMin(r.maxGoalGapAt)})`));
  }
  return out;
}

/** Gaps between consecutive express stages built in this run (kept stages excluded): [from stage, to stage, seconds]. */
function expressGaps(r: RunReport): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let n = r.expressKept + 2; n <= r.expressStageAt.length; n++) out.push([n - 1, n, r.expressStageAt[n - 1] - r.expressStageAt[n - 2]]);
  return out;
}

/** The gap a→a+1 of a run (seconds), null when the run did not build both stages itself. */
function gapOf(r: RunReport, from: number): number | null {
  return expressGaps(r).find(([a]) => a === from)?.[2] ?? null;
}

/** Coronation total over the active runs (seconds), null without one. */
function coronationTotal(active: RunReport[]): number | null {
  let total = 0;
  for (const r of active) {
    if (r.coronationAt !== null) return total + r.coronationAt;
    total += r.seconds;
  }
  return null;
}

/** v2 roadmap targets (EN-1..EN-4, validated together in EN-13); tallied separately from the GDD checkpoints. */
function v2Checks(active: RunReport[] | null, passive: RunReport[] | null): Check[] {
  const g = "v2";
  const out: Check[] = [];
  const add = (c: Check) => out.push(c);
  if (active) {
    const r1 = active[0];
    add(mk(g, "забег 1: Подвалы", "24–28 мин", minOf(r1.zoneOpenAt.cellars), "min", range(24, 28), fmtMin(r1.zoneOpenAt.cellars)));
    add(mk(g, "забег 1: венцы", "20–28", r1.crownsGained, "int", range(20, 28), String(r1.crownsGained)));
    const c60 = cpAt(r1, 60);
    add(mk(g, "забег 1: доля поездов, мин 50–60", "≥ 25%", c60?.trainShare, "pct", { k: "atLeast", lo: 0.25 }, c60 ? pct(c60.trainShare) : "—"));
    const r2 = active[1];
    if (r2) {
      // K6 (ENG-2): the run-2 Terminal comes with a train haul (±6 min); judged on the replicate median only
      add({ ...mk(g, "забег 2: Вокзал", "44–56 мин", minOf(r2.zoneOpenAt.terminal), "min", range(44, 56), fmtMin(r2.zoneOpenAt.terminal)), replicated: true });
      add(
        mk(
          g,
          "забег 2: венцы при коронации",
          "120–220",
          r2.coronationAt !== null ? r2.crownsGained : null,
          "int",
          range(120, 220),
          r2.coronationAt !== null ? String(r2.crownsGained) : `нет коронации (${r2.crownsGained})`,
        ),
      );
      add(mk(g, "забег 2: steamEff < 1 хоть раз", "да", bool(r2.minSteamEff < 1), "bool", YES, r2.minSteamEff < 1 ? `да (мин ${r2.minSteamEff.toFixed(2)})` : "нет"));
      const press = r2.buildingLevels.steam_press ?? 0;
      const clock = r2.buildingLevels.clocktower ?? 0;
      add(mk(g, "забег 2: прессы / часы", "< 19 / < 9", bool(press < 19 && clock < 9), "bool", YES, `${press} / ${clock}`));
    }
    for (const r of active.slice(1)) {
      const gaps = expressGaps(r);
      if (!gaps.length) continue;
      const short = gaps.filter(([, , sec]) => sec < 45);
      const long = gaps.filter(([a, , sec]) => sec > 360 && a !== 9);
      const show = (list: [number, number, number][]) => list.map(([a, b, sec]) => `${a}→${b} ${fmtMin(sec)}`).join(", ");
      const minGap = Math.min(...gaps.map((x) => x[2]));
      const maxGap = Math.max(0, ...gaps.filter(([a]) => a !== 9).map((x) => x[2]));
      add(mk(g, `забег ${r.run}: этапы экспресса не чаще 45 с`, "≥ 0:45", minGap, "sec", { k: "atLeast", lo: 45 }, short.length ? show(short) : `мин ${fmtMin(minGap)}`));
      add(mk(g, `забег ${r.run}: этапы не реже 6 мин (кроме 9→10)`, "≤ 6:00", maxGap, "sec", { k: "atMost", hi: 360 }, long.length ? show(long) : "ок"));
    }
    const r3 = active[2];
    if (r3) {
      const t = r3.expressStageAt.slice(5, 10);
      const distinct = t.length === 5 && new Set(t.map((x) => Math.floor(x))).size === 5;
      add(mk(g, "забег 3: этапы 6–10 в разное время", "да", bool(distinct), "bool", YES, t.map(fmtMin).join(" ") || "—"));
      add(mk(g, "забег 3: коронация", "≥ 30 мин", minOf(r3.coronationAt), "min", { k: "atLeast", lo: 30 }, fmtMin(r3.coronationAt)));
    }
  }
  if (passive) {
    const r = passive[0];
    add(mk(g, "пассивный: Вокзал", "≤ 165 мин", minOf(r.zoneOpenAt.terminal), "min", { k: "atMost", hi: 165 }, fmtMin(r.zoneOpenAt.terminal)));
    // EN-13: a dead zone is full housing that blocks an otherwise (nearly) paid expedition; the raw stretch (any full
    // housing below the requirement, also while the price is still far off) is printed with the passive run
    const byZone = Object.entries(r.housingBlockByZone).map(([z, sec]) => `${ZONE_SHORT[z as ZoneId]} ${fmtMin(sec)}`).join(", ");
    add(mk(g, "пассивный: жильё-тупик (цена собрана, мало жилья)", "≤ 3:00", r.maxHousingBlock, "sec", { k: "atMost", hi: 180 }, `${fmtMin(r.maxHousingBlock)} (в ${fmtMin(r.maxHousingBlockAt)}; ${byZone || "нигде"})`));
    add(mk(g, "пассивный: выплаты разведчиков", "> 0", r.scouts, "int", YES, String(r.scouts)));
  }
  return out;
}

/** EN-6, EN-9, EN-11, EN-12 and the exact coronation window (EN-13), tallied with the v2 targets. */
function metaChecks(active: RunReport[]): Check[] {
  const g = "v2";
  const out: Check[] = [];
  const add = (c: Check) => out.push(c);
  // coronation total, exact window
  const crowned = coronationTotal(active);
  add(mk(g, "коронация, всего (точно)", "2:30–3:30 ч", crowned === null ? null : crowned / 3600, "h", range(2.5, 3.5), crowned === null ? "нет" : `${(crowned / 3600).toFixed(2)} ч`));
  // EN-6 variety over the whole active session (to the first coronation)
  const upto = crowned === null ? active : active.slice(0, active.findIndex((r) => r.coronationAt !== null) + 1);
  const variants = new Set(upto.flatMap((r) => Object.keys(r.variants)));
  add(mk(g, "варианты поездов (EN-6)", "≥ 4", variants.size, "int", { k: "atLeast", lo: 4 }, [...variants].join(", ") || "—"));
  const cheese = upto.reduce((a, r) => a + r.cheeseCars, 0);
  add(mk(g, "сырный вагон (EN-6)", "≥ 1", cheese, "int", YES, String(cheese)));
  const royal = upto.reduce((a, r) => a + (r.scenes.royal_express ?? 0), 0);
  add(mk(g, "королевских экспрессов до коронации (EN-6)", "≥ 2", royal, "int", { k: "atLeast", lo: 2 }, String(royal)));
  // EN-9 spending
  const r2 = active[1];
  if (r2 && r2.migrated) {
    const share = r2.crownsGained > 0 ? r2.crownsSpent / r2.crownsGained : 0;
    add(mk(g, "после забега 2 потрачено 👑 (EN-9)", "≥ 50% заработанных", share, "pct", { k: "atLeast", lo: 0.5 }, `${r2.crownsSpent} из ${r2.crownsGained} (${pct(share)})`));
  }
  const last = active[active.length - 1];
  if (active.length >= 3) {
    const m = last.final.meta;
    const left = EDICT_ORDER.filter((e) => EDICTS[e].ranks && edictRank(last.final, e) < 3).length;
    add(mk(g, "ранги III ещё не куплены после забега 3 (EN-9)", "≥ 3", left, "int", { k: "atLeast", lo: 3 }, `${left} (👑 ${m.crowns})`));
    // EN-11 medals
    const r3 = active[2];
    add(mk(g, "забег 3: новых медалей (EN-11)", "≥ 4", r3.medals.length, "int", { k: "atLeast", lo: 4 }, String(r3.medals.length)));
  }
  const r1 = active[0];
  const nonSecret = ACHIEVEMENT_ORDER.filter((id) => !ACHIEVEMENTS[id].secret);
  const r1Medals = nonSecret.filter((id) => r1.medals.includes(id)).length;
  add(mk(g, "забег 1: медали из несекретных (EN-11)", "≤ 40%", r1Medals, "int", { k: "atMost", hi: 0.4 * nonSecret.length }, `${r1Medals}/${nonSecret.length}`));
  const FEATS = ["clean_car_10", "no_spark", "gold_streak", "ties_survivor", "dry_paws", "cat_nightmare", "royal_retinue", "full_consist"];
  const feats = active.flatMap((r) => r.medals.filter((id) => FEATS.includes(id)).map((id) => `${r.run}:${id}`));
  const runsWithFeats = new Set(feats.map((x) => x.split(":")[0])).size;
  add(mk(g, "подвиги за сессию (EN-11)", "≥ 4, не разом", runsWithFeats >= 2 ? feats.length : 0, "int", { k: "atLeast", lo: 4 }, feats.join(", ") || "—"));
  // EN-12
  add(mk(g, "поручения за 20 мин после коронации (EN-12)", "≥ 3", last.coronationAt !== null ? last.commissionsDone : 0, "int", { k: "atLeast", lo: 3 }, String(last.commissionsDone)));
  return out;
}

/** v3 (ENG-2) late-game checks of a --long session (INFO unless --strict). */
function longChecks(active: RunReport[]): Check[] {
  const g = "v3 долгая игра";
  const out: Check[] = [];
  const add = (c: Check) => out.push({ ...c, strictOnly: true });
  const collectibles = active.map((r) => r.medals.length + r.curiosGained);
  const minCol = Math.min(...collectibles);
  add(mk(g, "≥ 1 новая медаль или диковина за забег", "≥ 1", minCol, "int", YES, collectibles.join(" / ")));
  const g910 = active.filter((r) => r.run >= 3).map((r) => gapOf(r, 9));
  const known = g910.filter((x): x is number => x !== null);
  add(mk(g, "9→10 не дольше 8 мин (забеги 3+)", "≤ 8:00", known.length && known.length === g910.length ? Math.max(...known) : null, "sec", { k: "atMost", hi: 480 }, g910.map((x) => fmtMin(x)).join(" / ") || "—"));
  const late = active.filter((r) => r.run >= 4 && r.coronationAt !== null);
  add(mk(g, "≥ 1 вагон после коронации (забеги 4+)", "≥ 1", late.length ? Math.min(...late.map((r) => r.wagons)) : null, "int", YES, late.map((r) => String(r.wagons)).join(" / ") || "—"));
  const crowned3 = active.filter((r) => r.run >= 3 && r.coronationAt !== null);
  add(mk(g, "≥ 2 поручения за 20 мин после коронации", "≥ 2", crowned3.length ? Math.min(...crowned3.map((r) => r.commissionsDone)) : null, "int", { k: "atLeast", lo: 2 }, crowned3.map((r) => String(r.commissionsDone)).join(" / ") || "—"));
  const dry = active.find((r) => r.sinksLeft <= 0);
  add(mk(g, "венцам есть куда идти до 6-го забега", "≥ 6", dry ? dry.run : 99, "int", { k: "atLeast", lo: 6 }, dry ? `всё куплено после забега ${dry.run}` : "не кончились"));
  // ENG-10: «Кунсткамера» is still incomplete after run 7, but well on its way
  const r7 = active.find((r) => r.run === 7);
  add(mk(g, "Кунсткамера после 7-го забега (ENG-10)", "8–18 из 24", r7 ? r7.curiosOwned : null, "int", { k: "range", lo: 8, hi: 18 }, r7 ? `${r7.curiosOwned}/24` : "—"));
  const lens = active.slice(0, -1).map((r) => r.seconds / 60);
  add(mk(g, "каждый забег ≥ 20 мин", "≥ 20 мин", lens.length ? Math.min(...lens) : null, "min", { k: "atLeast", lo: 20 }, active.map((r) => fmtMin(r.seconds)).join(" / ")));
  return out;
}

/** v3 (ENG-2): the never-migrate run must not coronate before the scripted route (hours later; no coronation = PASS). */
function neverMigrateCheck(scripted: number | null, nm: RunReport): Check {
  const nmSec = nm.coronationAt;
  const value = nmSec === null ? 1 : scripted === null ? -1 : (nmSec - scripted) / 3600;
  const actual = `${nmSec === null ? `нет коронации за ${fmtMin(nm.seconds)}` : `коронация ${fmtMin(nmSec)}`} против ${scripted === null ? "нет коронации" : fmtMin(scripted)} по сценарию`;
  return mk("v3", "без переселения нет коронации быстрее сценарного маршрута", "позже сценарного", value, "h", { k: "atLeast", lo: 1e-9 }, actual);
}

/** GDD 15.14 «Новичок» (ENG-2): the newcomer bot follows the elder; the windows of the onboarding pass. */
function newcomerChecks(r: RunReport): Check[] {
  const g = "Новичок";
  const nc = r.newcomer!;
  const buys30 = nc.buys.filter((b) => b.t < 1800);
  const trash = buys30.length ? buys30.filter((b) => b.id === "trash_chute").length / buys30.length : 0;
  return [
    mk(g, "Канализация", "≤ 15 мин", minOf(r.zoneOpenAt.sewers), "min", { k: "atMost", hi: 15 }),
    mk(g, "Подвалы", "≤ 40 мин", minOf(r.zoneOpenAt.cellars), "min", { k: "atMost", hi: 40 }),
    mk(g, "Метро", "≤ 70 мин", minOf(r.zoneOpenAt.metro), "min", { k: "atMost", hi: 70 }),
    mk(g, "первый поезд метро", "≤ 75 мин", minOf(r.firstTrainAt), "min", { k: "atMost", hi: 75 }),
    { ...mk(g, "одна подсказка подряд", "≤ 3:00", nc.hintStreak, "sec", { k: "atMost", hi: 180 }, `${fmtMin(nc.hintStreak)} (${nc.hintStreakId || "—"})`), strictOnly: true },
    { ...mk(g, "«Мусорный лаз» среди покупок 30 мин", "< 30%", trash, "pct", { k: "below", hi: 0.3 }, `${pct(trash)} (${buys30.filter((b) => b.id === "trash_chute").length} из ${buys30.length})`), strictOnly: true },
    { ...mk(g, "голод подряд", "≤ 0:10", r.maxHungry, "sec", { k: "atMost", hi: 10 }), strictOnly: true },
  ];
}

/* ---------------------------------------------------------------- printouts */

function runLines(r: RunReport, args: Args): string[] {
  const out: string[] = [];
  out.push(`\n=== Активный бот, забег ${r.run} (${fmtMin(r.seconds)}${r.migrated ? ", переселение" : ""}${r.coronationAt ? `, коронация ${fmtMin(r.coronationAt)}` : ""}) ===`);
  if (r.edictsBought.length) out.push(`Указы перед забегом: ${r.edictsBought.join(", ")}`);
  out.push(table(CP_HEAD, cpRows(r.checkpoints)));
  out.push(
    `Зоны: ${ZONE_ORDER.map((z) => `${ZONE_SHORT[z]} ${fmtMin(r.zoneOpenAt[z])}`).join("  ")} | капсула ${fmtMin(r.firstCapsuleAt)} | поезд ${fmtMin(r.firstTrainAt)} | переселение доступно ${fmtMin(r.migrateReadyAt)} | E 1M ${fmtMin(r.eRun1MAt)} | этапы экспресса ${r.expressStageAt.map(fmtMin).join(" ") || "—"} | 👑 +${r.crownsGained}`,
  );
  out.push(`Постройки: ${Object.entries(r.buildingLevels).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  out.push(
    `Улучшений: ${r.upgradesBought}; сцены: ${Object.entries(r.scenes).map(([k, v]) => `${k} ${v}`).join(", ")} | дождь у решётки ${r.rainPasses} | туман ${r.fogs} | поездов без «К путям!» ${r.unwarnedTrains}`,
  );
  out.push(
    `Варианты поездов: ${Object.entries(r.variants).map(([k, v]) => `${k} ${v}`).join(", ") || "—"} | сырных вагонов ${r.cheeseCars} | королевских экспрессов ${r.scenes.royal_express ?? 0} | медалей +${r.medals.length} | поручений ${r.commissionsDone} | 👑 за забег +${r.crownsGained}, потрачено после ${r.crownsSpent}`,
  );
  if (r.commissionLog.length) out.push(`Поручения: ${r.commissionLog.join("; ")}`);
  out.push(`Медали: ${r.medals.join(", ")}`);
  if (args.binding) out.push(...bindingLines(r));
  if (args.steam && r.run === 2) out.push(...steamLines(r));
  return out;
}

/** «этап 8 73:10 (4:50) last=💍 prev=🛤️» for every project of a run (ENG-2 binding report). */
function bindingLines(r: RunReport): string[] {
  if (!r.binding.length) return [];
  return [
    "Узкие места (последний собранный ресурс):",
    ...r.binding.map((b) =>
      b.end === null
        ? `  ${b.label} — не собран к ${fmtMin(r.seconds)} (с ${fmtMin(b.start)}); готово: ${Object.keys(b.doneAt).map((x) => icon(x as ResId)).join(" ") || "—"}`
        : `  ${b.label} ${fmtMin(b.end)} (${fmtMin(b.end - b.start)}) last=${icon(b.last)} prev=${icon(b.prev)}${b.last && b.prev ? ` (+${fmtMin((b.doneAt[b.last] ?? 0) - (b.doneAt[b.prev] ?? 0))})` : ""}`,
    ),
  ];
}

/** The run-2 steam line per minute (ENG-2 --steam): supply, demand, efficiency, boilers, the buffer. */
function steamLines(r: RunReport): string[] {
  const rows = r.steamLog.filter((x) => x.supply > 0 || x.need > 0);
  if (!rows.length) return ["Пар: в этом забеге не было ни кочегаров, ни потребителей"];
  return [
    `Пар, забег ${r.run} (с < 0.9: ${fmtMin(r.steamShortSec)}; мин steamEff ${r.minSteamEff.toFixed(2)}):`,
    table(
      ["мин", "💨 могут/с", "нужно/с", "steamEff", "котлы", "буфер"],
      rows.map((x) => [String(x.min), num(x.supply), num(x.need), x.eff.toFixed(2), String(x.boiler), num(x.stock)]),
    ),
  ];
}

function longTable(active: RunReport[]): string[] {
  const rows = active.map((r) => [
    String(r.run),
    districtInfo(r.final.meta).name,
    fmtMin(r.seconds),
    fmtMin(r.coronationAt),
    `+${r.crownsGained} / −${r.crownsSpent} / ${r.crownsLeft}`,
    String(r.sinksLeft),
    String(r.medals.length),
    `+${r.curiosGained} (${r.curiosOwned}/24)`,
    String(r.wagons),
    String(r.commissionsDone),
    fmtMin(gapOf(r, 8)),
    fmtMin(gapOf(r, 9)),
  ]);
  return ["\n=== Долгая игра ===", table(["забег", "район", "длина", "коронация", "👑 +/−/ост.", "стоков", "медали", "диковины", "вагоны", "поручения", "8→9", "9→10"], rows)];
}

function newcomerLines(r: RunReport): string[] {
  const nc = r.newcomer!;
  const buys30 = nc.buys.filter((b) => b.t < 1800);
  const trash = buys30.filter((b) => b.id === "trash_chute").length;
  const top = Object.entries(nc.hintsApplied)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, n]) => `${id} ×${n}`)
    .join(", ");
  const share = [10, 26, 45].map((m) => `мин ${m} — ${r.foragerShare[m] === undefined ? "—" : pct(r.foragerShare[m]!)}`).join(", ");
  const byPick = nc.buys.filter((b) => b.via === "pick").length;
  return [
    `\n=== Новичок (${fmtMin(r.seconds)}) ===`,
    table(CP_HEAD, cpRows(r.checkpoints)),
    `Зоны: ${ZONE_ORDER.map((z) => `${ZONE_SHORT[z]} ${fmtMin(r.zoneOpenAt[z])}`).join("  ")} | капсула ${fmtMin(r.firstCapsuleAt)} | первый поезд метро ${fmtMin(r.firstTrainAt)}`,
    `Подсказки: дольше всех подряд «${nc.hintStreakId || "—"}» ${fmtMin(nc.hintStreak)} (до ${fmtMin(nc.hintStreakAt)}); выполнено чаще всех: ${top || "—"}`,
    `Нечего делать (ни подсказки с делом, ни «Выгодно сейчас» по карману): дольше всего ${fmtMin(nc.idleGap)} (до ${fmtMin(nc.idleGapAt)}) | голод подряд: ${fmtMin(r.maxHungry)}`,
    `Доля собирателей: ${share}`,
    `Покупки: ${nc.buys.length} (по подсказке ${nc.buys.length - byPick}, «Выгодно сейчас» ${byPick}); за первые 30 мин ${buys30.length}, из них «${BUILDINGS.trash_chute.name}» ${trash} (${buys30.length ? pct(trash / buys30.length) : "—"})`,
    `Постройки: ${Object.entries(r.buildingLevels).map(([k, v]) => `${k} ${v}`).join(", ")}`,
  ];
}

/* ---------------------------------------------------------------- one simulation */

interface RunSummary {
  run: number;
  len: number | null;
  z: (number | null)[];
  e1m: number | null;
  mig: number | null;
  exp: (number | null)[];
  cor: number | null;
  crowns: number;
  cp: Record<string, (number | null)[]>;
  stall: number;
  gap: number;
  housingStall: number;
  housingBlock: number;
  scouts: number;
  steamEffMin: number;
}

/** What sim-matrix tabulates per seed (--tails): the K3–K6 tails and the newcomer's zones. Minutes / hours / seconds. */
export interface Tails {
  coronationH: number | null;
  /** max(7→8, 8→9) of run 2, seconds. */
  r2gap: number | null;
  r2steamMin: number | null;
  r2steamShort: number | null;
  r2terminal: number | null;
  passiveGap: number | null;
  passiveTerminal: number | null;
  ncSewers: number | null;
  ncCellars: number | null;
  ncMetro: number | null;
  ncTrain: number | null;
}

interface SimResult {
  lines: string[];
  checks: Check[];
  v2: Check[];
  v3: Check[];
  nc: Check[];
  info: Check[];
  summary: Record<string, unknown>;
  tails: Tails;
  ms: number;
}

function runSummary(r: RunReport): RunSummary {
  const m = (x: number | null | undefined) => (x === null || x === undefined ? null : Math.round((x / 60) * 10) / 10);
  return {
    run: r.run,
    len: m(r.seconds),
    z: ZONE_ORDER.slice(1).map((z) => m(r.zoneOpenAt[z])),
    e1m: m(r.eRun1MAt),
    mig: m(r.migrateReadyAt),
    exp: r.expressStageAt.map(m),
    cor: m(r.coronationAt),
    crowns: r.crownsGained,
    cp: Object.fromEntries(r.checkpoints.map((c) => [c.minute, [c.rats, +c.coinsPassive.toFixed(1), +c.coinsPerSec.toFixed(1), +c.eRun.toPrecision(3), +(c.trainShare * 100).toFixed(0), c.crowns, +(c.trainCoinShare * 100).toFixed(0)]])),
    stall: r.maxStorageStall,
    gap: r.maxGoalGap,
    housingStall: r.maxHousingStall,
    housingBlock: r.maxHousingBlock,
    scouts: r.scouts,
    steamEffMin: +r.minSteamEff.toFixed(3),
  };
}

function tailsOf(active: RunReport[] | null, passive: RunReport[] | null, newcomer: RunReport[] | null): Tails {
  const r2 = active?.[1];
  const cor = active ? coronationTotal(active) : null;
  const gaps = r2 ? [gapOf(r2, 7), gapOf(r2, 8)].filter((x): x is number => x !== null) : [];
  const nc = newcomer?.[0];
  return {
    coronationH: cor === null ? null : cor / 3600,
    r2gap: gaps.length ? Math.max(...gaps) : null,
    r2steamMin: r2 ? r2.minSteamEff : null,
    r2steamShort: r2 ? r2.steamShortSec : null,
    r2terminal: minOf(r2?.zoneOpenAt.terminal),
    passiveGap: passive ? Math.round(passive[0].maxGoalGap) : null,
    passiveTerminal: minOf(passive?.[0].zoneOpenAt.terminal),
    ncSewers: minOf(nc?.zoneOpenAt.sewers),
    ncCellars: minOf(nc?.zoneOpenAt.cellars),
    ncMetro: minOf(nc?.zoneOpenAt.metro),
    ncTrain: minOf(nc?.firstTrainAt),
  };
}

/**
 * The whole simulation for one bot RNG stream `k` (k = 0: the plain run; replicate k uses seed ^ k·0x9e37 for each
 * bot's own RNG). Pure of printing: returns the log lines, the checks and the SUMMARY payload.
 */
function runSim(args: Args, k: number): SimResult {
  const t0 = Date.now();
  const lines: string[] = [];
  const botSeed = (seed: number) => (seed ^ (k * 0x9e37)) >>> 0;
  const checks: Check[] = [];
  const info: Check[] = [];
  const v3: Check[] = [];
  const nc: Check[] = [];
  let active: RunReport[] | null = null;
  let passive: RunReport[] | null = null;
  let newcomer: RunReport[] | null = null;
  const cpMinutes = [5, 11, 16, 26, 42, 50, 55, 62, 80];

  if (runsActive(args)) {
    active = simulate({
      seed: args.seed,
      botSeed: botSeed(args.seed),
      bot: "active",
      runs: args.runs,
      minutes: args.minutes ?? 150,
      checkpointMinutes: cpMinutes,
      offlineAtMinute: 60,
      postCoronationMinutes: 20,
      long: args.long,
      seal: args.seal,
      ...(args.district ? { district: args.district } : {}),
    });
    for (const r of active) lines.push(...runLines(r, args));
    if (args.long) lines.push(...longTable(active));
    checks.push(...activeChecks(active[0]));
    if (active[1]) checks.push(...laterRunChecks(active[1]));
    // run 3 is reached since v2 (the sim migrates after the run-2 coronation); its GDD 14.2 windows are reference only
    for (const r of active.slice(2)) info.push(...laterRunChecks(r).map((c) => ({ ...c, actual: `${c.actual} (${c.verdict === "FAIL" ? "вне окна" : "в окне"})`, verdict: "INFO" as const })));
    if (args.long) v3.push(...longChecks(active));
    if (args.policy === "never-migrate") {
      const [nm] = simulate({ seed: args.seed, botSeed: botSeed(args.seed), bot: "active", runs: 1, minutes: 170, checkpointMinutes: cpMinutes, policy: "never-migrate" });
      lines.push(`\n=== Без переселения (${fmtMin(nm.seconds)}) ===`);
      lines.push(
        `Зоны: ${ZONE_ORDER.map((z) => `${ZONE_SHORT[z]} ${fmtMin(nm.zoneOpenAt[z])}`).join("  ")} | этапы экспресса ${nm.expressStageAt.map(fmtMin).join(" ") || "—"} | коронация ${fmtMin(nm.coronationAt)} | 👑 за забег ${nm.crownsGained}`,
      );
      if (args.binding) lines.push(...bindingLines(nm));
      v3.push(neverMigrateCheck(coronationTotal(active), nm));
    }
  }
  if (runsPassive(args)) {
    passive = simulate({ seed: args.seed + 1, botSeed: botSeed(args.seed + 1), bot: "passive", runs: 1, minutes: args.minutes ?? 170, checkpointMinutes: [5, 26, 42, 60, 80, 100, 120, 140, 160] });
    const r = passive[0];
    lines.push(`\n=== Пассивный бот (${fmtMin(r.seconds)}) ===`);
    lines.push(table(CP_HEAD, cpRows(r.checkpoints)));
    lines.push(
      `Зоны: ${ZONE_ORDER.map((z) => `${ZONE_SHORT[z]} ${fmtMin(r.zoneOpenAt[z])}`).join("  ")} | E 1M ${fmtMin(r.eRun1MAt)} | разведчики ${r.scouts} | жильё-тупик ${fmtMin(r.maxHousingBlock)} (полное жильё ниже требования вообще: ${fmtMin(r.maxHousingStall)}; ${Object.entries(r.housingStallByZone).map(([z, sec]) => `${ZONE_SHORT[z as ZoneId]} ${fmtMin(sec)}`).join(", ") || "нигде"})`,
    );
    if (args.binding) lines.push(...bindingLines(r));
    checks.push(...passiveChecks(r));
  }
  if (runsNewcomer(args)) {
    newcomer = simulate({ seed: args.seed, botSeed: botSeed(args.seed), bot: "newcomer", runs: 1, minutes: args.minutes ?? 100, checkpointMinutes: [5, 10, 15, 26, 45, 60, 75] });
    const r = newcomer[0];
    lines.push(...newcomerLines(r));
    if (args.binding) lines.push(...bindingLines(r));
    nc.push(...newcomerChecks(r));
  }
  checks.push(...acceptance(active, passive, newcomer));

  if (active) {
    const crowned = coronationTotal(active);
    let total = 0;
    for (const r of active) total += r.seconds;
    checks.push(
      mk(
        "Итог",
        "коронация, всего",
        "2:30–3:30 ч",
        crowned === null ? null : crowned / 3600,
        "h",
        args.runs < 2 ? { k: "info" } : within(2.5, 3.5),
        crowned === null ? `нет (сыграно ${fmtMin(total)})` : `${(crowned / 3600).toFixed(2)} ч (${fmtMin(crowned)})`,
      ),
    );
  }

  const v2 = v2Checks(active, passive);
  if (active) v2.push(...metaChecks(active));
  const summary: Record<string, unknown> = {
    active: active?.map(runSummary) ?? null,
    passive: passive?.map(runSummary) ?? null,
    fails: checks.filter((c) => c.verdict === "FAIL").map((c) => c.group.slice(-9) + ":" + c.name),
    v2fails: v2.filter((c) => settle(c, args, false).verdict === "FAIL").map((c) => c.name),
  };
  if (newcomer) summary.newcomer = runSummary(newcomer[0]);
  const tails = tailsOf(active, passive, newcomer);
  if (args.tails) summary.tails = tails;
  return { lines, checks, v2, v3, nc, info, summary, tails, ms: Date.now() - t0 };
}

/* ---------------------------------------------------------------- output */

const HEAD5 = ["группа", "проверка", "цель", "факт", "итог"];

/** «; цели v3: 3/4 (+2 справочно)»: the v3 and newcomer tallies count the judged checks only. */
function tally(label: string, list: { verdict: Verdict }[]): string {
  if (!list.length) return "";
  const judged = list.filter((c) => c.verdict !== "INFO");
  const fails = judged.filter((c) => c.verdict === "FAIL").length;
  const info = list.length - judged.length;
  return `; ${label}: ${judged.length ? `${judged.length - fails}/${judged.length}` : "—"}${info ? ` (+${info} справочно)` : ""}`;
}
const row5 = (c: Check) => [c.group, c.name, c.target, c.actual, c.verdict];

function printSingle(args: Args, r: SimResult, t0: number): void {
  if (!args.quiet) for (const l of r.lines) console.log(l);
  const checks = r.checks.map((c) => settle(c, args, false));
  const v2 = r.v2.map((c) => settle(c, args, false));
  const v3 = r.v3.map((c) => settle(c, args, false));
  const nc = r.nc.map((c) => settle(c, args, false));
  if (args.summary) console.log("SUMMARY " + JSON.stringify(r.summary));
  console.log("\n=== Проверки ===");
  console.log(table(HEAD5, checks.map(row5)));
  const fails = checks.filter((c) => c.verdict === "FAIL").length;
  console.log("\n=== Цели v2 (точные окна, EN-1..EN-4; сводная проверка — EN-13) ===");
  console.log(table(HEAD5, v2.map(row5)));
  const v2fails = v2.filter((c) => c.verdict === "FAIL").length;
  if (v3.length) {
    console.log(`\n=== Цели v3 (ENG-2${args.strict ? "" : "; поздняя игра справочно, итог — с --strict"}) ===`);
    console.log(table(HEAD5, v3.map(row5)));
  }
  if (nc.length) {
    console.log("\n=== Новичок (GDD 15.14) ===");
    console.log(table(HEAD5, nc.map(row5)));
  }
  if (r.info.length) {
    console.log("\n=== Справочно (не входит в итог) ===");
    console.log(table(HEAD5, r.info.map(row5)));
  }
  const v3fails = v3.filter((c) => c.verdict === "FAIL").length;
  const ncfails = nc.filter((c) => c.verdict === "FAIL").length;
  const extra = `${tally("цели v3", v3)}${tally("новичок", nc)}`;
  console.log(`\n${checks.length - fails}/${checks.length} в допуске (±25%), ${fails} FAIL; цели v2: ${v2.length - v2fails}/${v2.length}${extra}. Время прогона ${((Date.now() - t0) / 1000).toFixed(1)} с.`);
  if (args.strict && fails + v3fails + ncfails > 0) process.exit(1);
}

const HEAD_AGG = ["группа", "проверка", "цель", "медиана (мин–макс)", "итог"];
const rowAgg = (a: Aggregate) => [a.group, a.name, a.target, fmtAggregate(a), a.verdict];

/** Aggregate the replicates' checks by median; strict-only checks read INFO without --strict. */
function aggregate(args: Args, lists: Check[][]): Aggregate[] {
  return aggregateChecks(lists).map((a) => {
    const c = lists.flat().find((x) => x.group === a.group && x.name === a.name)!;
    return c.strictOnly && !args.strict ? { ...a, verdict: "INFO" as const } : a;
  });
}

function printReplicates(args: Args, results: SimResult[], t0: number): void {
  console.log(`\n=== Повторы: ${results.length} потоков бота на сиде ${args.seed} (ГСЧ бота = сид ^ k·0x9e37) ===`);
  console.log(
    table(
      ["k", "коронация", "забег 2: Вокзал", "max(7→8, 8→9)", "пассив: ожидание", "новичок К/П/М", "время"],
      results.map((r, k) => [
        String(k),
        fmtValue(r.tails.coronationH, "h"),
        fmtValue(r.tails.r2terminal, "min"),
        fmtValue(r.tails.r2gap, "sec"),
        fmtValue(r.tails.passiveGap, "sec"),
        [r.tails.ncSewers, r.tails.ncCellars, r.tails.ncMetro].map((x) => fmtValue(x, "min")).join(" / "),
        `${(r.ms / 1000).toFixed(0)} с`,
      ]),
    ),
  );
  const checks = aggregate(args, results.map((r) => r.checks));
  const v2 = aggregate(args, results.map((r) => r.v2));
  const v3 = aggregate(args, results.map((r) => r.v3));
  const nc = aggregate(args, results.map((r) => r.nc));
  const info = aggregate(args, results.map((r) => r.info)).map((a) => ({ ...a, verdict: "INFO" as const }));
  if (args.summary) {
    const pack = (list: Aggregate[]) => list.map((a) => ({ g: a.group, n: a.name, median: a.median, min: a.min, max: a.max, missing: a.missing, verdict: a.verdict }));
    console.log(
      "SUMMARY " +
        JSON.stringify({
          replicates: results.length,
          seed: args.seed,
          runs: results.map((r) => r.summary),
          checks: pack(checks),
          v2: pack(v2),
          v3: pack(v3),
          newcomer: pack(nc),
          info: pack(info),
          fails: checks.filter((c) => c.verdict === "FAIL").map((c) => c.group.slice(-9) + ":" + c.name),
          v2fails: v2.filter((c) => c.verdict === "FAIL").map((c) => c.name),
        }),
    );
  }
  console.log(`\n=== Проверки (медиана по ${results.length}) ===`);
  console.log(table(HEAD_AGG, checks.map(rowAgg)));
  console.log("\n=== Цели v2 (медиана) ===");
  console.log(table(HEAD_AGG, v2.map(rowAgg)));
  if (v3.length) {
    console.log("\n=== Цели v3 (медиана) ===");
    console.log(table(HEAD_AGG, v3.map(rowAgg)));
  }
  if (nc.length) {
    console.log("\n=== Новичок (медиана) ===");
    console.log(table(HEAD_AGG, nc.map(rowAgg)));
  }
  if (info.length) {
    console.log("\n=== Справочно (медиана, не входит в итог) ===");
    console.log(table(HEAD_AGG, info.map(rowAgg)));
  }
  const fails = checks.filter((c) => c.verdict === "FAIL").length;
  const v2fails = v2.filter((c) => c.verdict === "FAIL").length;
  const v3fails = v3.filter((c) => c.verdict === "FAIL").length;
  const ncfails = nc.filter((c) => c.verdict === "FAIL").length;
  const extra = `${tally("цели v3", v3)}${tally("новичок", nc)}`;
  console.log(
    `\nПо медиане ${results.length} повторов: ${checks.length - fails}/${checks.length} в допуске (±25%), ${fails} FAIL; цели v2: ${v2.length - v2fails}/${v2.length}${extra}. Время ${((Date.now() - t0) / 1000).toFixed(1)} с.`,
  );
  if (args.strict && fails + v3fails + ncfails > 0) process.exit(1);
}

/** Run the replicates in worker threads (at most availableParallelism − 1 at once). */
async function runReplicates(args: Args): Promise<SimResult[]> {
  const n = args.replicates;
  const width = Math.max(1, Math.min(n, (os.availableParallelism?.() ?? os.cpus().length) - 1));
  const results: SimResult[] = new Array(n);
  let next = 0;
  const one = (k: number) =>
    new Promise<SimResult>((resolve, reject) => {
      const w = new Worker(__filename, { workerData: { args, k } });
      w.once("message", (r: SimResult) => resolve(r));
      w.once("error", reject);
      w.once("exit", (code) => {
        if (code !== 0) reject(new Error(`повтор ${k}: поток завершился с кодом ${code}`));
      });
    });
  await Promise.all(
    Array.from({ length: width }, async () => {
      for (let k = next++; k < n; k = next++) results[k] = await one(k);
    }),
  );
  return results;
}

function applyArgsOverrides(args: Args): void {
  if (args.preTuning) applyOverrides(PRE_TUNING_OVERRIDES);
  applyOverrides(process.env.SIM_OVERRIDES); // dev: JSON patch of the data tables for tuning experiments
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  applyArgsOverrides(args);
  const t0 = Date.now();
  if (args.replicates > 1) printReplicates(args, await runReplicates(args), t0);
  else printSingle(args, runSim(args, 0), t0);
}

if (isMainThread) void main();
else {
  const { args, k } = workerData as { args: Args; k: number };
  applyArgsOverrides(args);
  parentPort!.postMessage(runSim(args, k));
}
