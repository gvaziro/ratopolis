/**
 * Parallel seed matrix (v3 ENG-2): runs scripts/balance-sim.ts once per (seed, bot) in child processes and prints a
 * «tails» table per seed — the K3–K6 questions answered on many seeds at once — each value marked against its target:
 * coronation total (2.5–3.5 h), run 2's slowest late stage max(7→8, 8→9) (≤ 6:00), run-2 steam (lowest steamEff and
 * the seconds below 0.9: > 0, the shortage is felt), the passive bot's longest wait for a goal (≤ 4:00), the run-2
 * Terminal (45–55 min) and the newcomer's Sewers / Cellars / Metro (≤ 15 / 40 / 70 min).
 *
 *   npm run sim:matrix -- [--seeds 12345,777,1,2,3] [--bots active,passive,newcomer] [--workers N]
 *                         [--baseline scripts/balance-baseline.json] [--write-baseline [path]] [--dump file.json]
 *                         [balance-sim flags…]
 *
 * --baseline: every metric that moved more than 10% against the file is listed and the exit code is 1.
 * --write-baseline: writes the metrics (default scripts/balance-baseline.json; `npm run sim:baseline`).
 * Workers default to os.availableParallelism() − 1; the jobs go longest first (active, passive, newcomer).
 */
import { fork } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { plural } from "../src/lib/format";
import type { Tails } from "./balance-sim";
import { fmtValue, relMove, type Unit } from "./simStats";

type BotName = "active" | "passive" | "newcomer";
const BOTS: BotName[] = ["active", "passive", "newcomer"];
const DEFAULT_BASELINE = path.join(__dirname, "balance-baseline.json");
/** A metric that moved more than this share against the baseline is a regression. */
const MOVE_LIMIT = 0.1;

interface Summary {
  fails: string[];
  v2fails: string[];
  tails?: Partial<Tails>;
}

interface Opts {
  seeds: number[];
  bots: BotName[];
  workers: number;
  baseline: string | null;
  writeBaseline: string | null;
  /** Write every job's SUMMARY to this JSON file (for medians over seeds, e.g. the GDD 14.2 run-3 table). */
  dump: string | null;
  rest: string[];
}

function parseArgs(argv: string[]): Opts {
  const o: Opts = { seeds: [12345, 777, 1, 2, 3], bots: [...BOTS], workers: Math.max(1, (os.availableParallelism?.() ?? os.cpus().length) - 1), baseline: null, writeBaseline: null, dump: null, rest: [] };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === "--seeds" && v) {
      o.seeds = v
        .split(",")
        .map((x) => Number(x.trim()))
        .filter((x) => Number.isFinite(x));
      i++;
    } else if (k === "--bots" && v) {
      o.bots = v.split(",").filter((b): b is BotName => (BOTS as string[]).includes(b));
      i++;
    } else if (k === "--workers" && v) {
      o.workers = Math.max(1, Math.floor(Number(v)) || 1);
      i++;
    } else if (k === "--baseline" && v) {
      o.baseline = path.resolve(v);
      i++;
    } else if (k === "--dump" && v) {
      o.dump = path.resolve(v);
      i++;
    } else if (k === "--write-baseline") {
      if (v && !v.startsWith("--")) {
        o.writeBaseline = path.resolve(v);
        i++;
      } else o.writeBaseline = DEFAULT_BASELINE;
    } else o.rest.push(k);
  }
  return o;
}

interface Job {
  seed: number;
  bot: BotName;
}

interface JobResult extends Job {
  summary: Summary | null;
  ms: number;
  err: string;
}

function runJob(job: Job, rest: string[]): Promise<JobResult> {
  const t0 = Date.now();
  return new Promise((resolve) => {
    const child = fork(path.join(__dirname, "balance-sim.ts"), ["--seed", String(job.seed), "--bot", job.bot, "--summary", "--quiet", "--tails", ...rest], {
      execArgv: ["--import", "tsx"],
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    let out = "";
    let err = "";
    child.stdout?.on("data", (b: Buffer) => (out += b.toString()));
    child.stderr?.on("data", (b: Buffer) => (err += b.toString()));
    child.on("exit", () => {
      const line = out.split("\n").find((l) => l.startsWith("SUMMARY "));
      let summary: Summary | null = null;
      try {
        summary = line ? (JSON.parse(line.slice(8)) as Summary) : null;
      } catch {
        summary = null;
      }
      resolve({ ...job, summary, ms: Date.now() - t0, err: err.trim().split("\n").slice(-3).join(" ") });
    });
  });
}

/* ---------------------------------------------------------------- metrics */

/** One tails column: its key, header, unit, and the target it is marked against (null: shown only). */
interface Metric {
  key: keyof Tails;
  head: string;
  unit: Unit;
  ok: ((x: number) => boolean) | null;
  /** How a missing value reads when missing is the target (the never-migrate coronation): it then passes. */
  none?: string;
}

const METRICS: Metric[] = [
  { key: "coronationH", head: "коронация, ч (2.5–3.5)", unit: "h", ok: (x) => x >= 2.5 && x <= 3.5 },
  // ENG-13: null = no coronation within the never-migrate run's 170 min (the target)
  { key: "nmCoronation", head: "без переселения: коронация (нет за 170)", unit: "min", ok: (x) => x > 170, none: "нет" },
  { key: "r2gap", head: "з2 max(7→8, 8→9) (≤ 6:00)", unit: "sec", ok: (x) => x <= 360 },
  { key: "r2gapMin", head: "з2 мин. этап 2..9 (≥ 0:45)", unit: "sec", ok: (x) => x >= 45 },
  { key: "r2terminal", head: "з2 Вокзал (44–56)", unit: "min", ok: (x) => x >= 44 && x <= 56 },
  { key: "r3coronation", head: "з3 коронация (≥ 30)", unit: "min", ok: (x) => x >= 30 },
  { key: "r3wagons", head: "з3 вагонов за 20 мин после коронации (≥ 3)", unit: "int", ok: (x) => x >= 3 },
  { key: "r2boiler", head: "з2 котёл (12)", unit: "int", ok: (x) => x === 12 },
  { key: "r2steamTight", head: "з2 пар: спрос ≥ 90% (≥ 15 мин)", unit: "int", ok: (x) => x >= 15 },
  { key: "r2steamMin", head: "з2 мин steamEff", unit: "num", ok: null },
  { key: "r2steamShort", head: "з2 пар < 0.9, с", unit: "sec", ok: null },
  { key: "r2press", head: "з2 прессы (< 19)", unit: "int", ok: (x) => x < 19 },
  { key: "r2clock", head: "з2 часы (< 9)", unit: "int", ok: (x) => x < 9 },
  { key: "passiveGap", head: "пассив: ожидание (≤ 4:00)", unit: "sec", ok: (x) => x <= 240 },
  { key: "passiveTerminal", head: "пассив: Вокзал (≤ 165)", unit: "min", ok: (x) => x <= 165 },
  { key: "ncSewers", head: "новичок К (≤ 15)", unit: "min", ok: (x) => x <= 15 },
  { key: "ncCellars", head: "новичок П (≤ 40)", unit: "min", ok: (x) => x <= 40 },
  { key: "ncMetro", head: "новичок М (≤ 70)", unit: "min", ok: (x) => x <= 70 },
  { key: "ncTrain", head: "новичок: поезд (≤ 75)", unit: "min", ok: (x) => x <= 75 },
  { key: "ncMechanics45", head: "новичок: механики, мин 45 (> 0)", unit: "int", ok: (x) => x > 0 },
  { key: "ncHintStreak", head: "новичок: подсказка подряд (≤ 3:00)", unit: "sec", ok: (x) => x <= 180 },
  { key: "unwarned", head: "поезда без «К путям!» (0)", unit: "int", ok: (x) => x === 0 },
  { key: "offlineOk", head: "офлайн 8 ч", unit: "bool", ok: (x) => x === 1 },
];

/** Which bot reports which metric ("sum": every bot of the seed, added up). */
const OWNER: Record<keyof Tails, BotName | "sum"> = {
  coronationH: "active",
  nmCoronation: "active",
  r2gap: "active",
  r2gapMin: "active",
  r2terminal: "active",
  r3coronation: "active",
  r3wagons: "active",
  r2boiler: "active",
  r2steamTight: "active",
  r2steamMin: "active",
  r2steamShort: "active",
  r2press: "active",
  r2clock: "active",
  passiveGap: "passive",
  passiveTerminal: "passive",
  ncSewers: "newcomer",
  ncCellars: "newcomer",
  ncMetro: "newcomer",
  ncTrain: "newcomer",
  ncMechanics45: "newcomer",
  ncHintStreak: "newcomer",
  unwarned: "sum",
  offlineOk: "active",
};

type SeedMetrics = Partial<Record<keyof Tails, number | null>>;

/** The metric's verdict: null passes only where a missing milestone is the target (`none`). */
function okOf(m: Metric, x: number | null | undefined): boolean | null {
  if (!m.ok || x === undefined) return null;
  return x === null ? m.none !== undefined : m.ok(x);
}

function cell(m: Metric, x: number | null | undefined): string {
  if (x === undefined) return "";
  const v = x === null && m.none ? m.none : fmtValue(x, m.unit);
  const ok = okOf(m, x);
  return ok === null ? v : `${v} ${ok ? "✓" : "✗"}`;
}

function table(head: string[], rows: string[][]): string {
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (r: string[]) => r.map((c, i) => (i === 0 ? c.padEnd(w[i]) : c.padStart(w[i]))).join("  ");
  return [line(head), w.map((x) => "-".repeat(x)).join("  "), ...rows.map(line)].join("\n");
}

interface BaselineFile {
  version: 1;
  written: string;
  args: string[];
  seeds: Record<string, SeedMetrics>;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const t0 = Date.now();
  // longest jobs first (whatever order --bots gives): the active bot plays three runs, the passive one, the newcomer
  // the shortest
  const queue: Job[] = [...o.bots].sort((a, b) => BOTS.indexOf(a) - BOTS.indexOf(b)).flatMap((bot) => o.seeds.map((seed) => ({ seed, bot })));
  const results: JobResult[] = [];
  const width = Math.min(o.workers, queue.length);
  await Promise.all(
    Array.from({ length: width }, async () => {
      for (let job = queue.shift(); job !== undefined; job = queue.shift()) results.push(await runJob(job, o.rest));
    }),
  );

  const metrics = new Map<number, SeedMetrics>();
  const fails = new Map<number, { fails: number; v2: number }>();
  for (const seed of o.seeds) {
    metrics.set(seed, {});
    fails.set(seed, { fails: 0, v2: 0 });
  }
  const errors: string[] = [];
  for (const r of results) {
    if (!r.summary) {
      errors.push(`${r.seed}/${r.bot}: ${r.err || "нет SUMMARY"}`);
      continue;
    }
    const m = metrics.get(r.seed)!;
    const t = r.summary.tails ?? {};
    for (const key of Object.keys(OWNER) as (keyof Tails)[]) {
      // a key the job never reported stays undefined (e.g. nmCoronation without --policy never-migrate)
      if (OWNER[key] === "sum") m[key] = (m[key] ?? 0) + (t[key] ?? 0);
      else if (OWNER[key] === r.bot && key in t) m[key] = t[key] ?? null;
    }
    const f = fails.get(r.seed)!;
    f.fails += r.summary.fails.length;
    f.v2 += r.summary.v2fails.length;
  }

  const shown = METRICS.filter((m) => o.seeds.some((seed) => metrics.get(seed)![m.key] !== undefined));
  // metrics down, seeds across (ENG-13: 22 tails do not fit side by side), and how many seeds are on target
  console.log("=== Хвосты по сидам (✓ в цели, ✗ мимо) ===");
  console.log(
    table(
      ["метрика", ...o.seeds.map(String), "в цели"],
      [
        ...shown.map((m) => {
          const vals = o.seeds.map((seed) => metrics.get(seed)![m.key]);
          const judged = vals.map((x) => okOf(m, x)).filter((x): x is boolean => x !== null);
          return [m.head, ...vals.map((x) => cell(m, x)), m.ok ? `${judged.filter(Boolean).length}/${judged.length}` : ""];
        }),
        ["FAIL (GDD 15.14 / 14.2 / приёмка)", ...o.seeds.map((seed) => String(fails.get(seed)!.fails)), ""],
        ["FAIL целей v2", ...o.seeds.map((seed) => String(fails.get(seed)!.v2)), ""],
      ],
    ),
  );
  const misses = o.seeds.reduce((a, seed) => a + shown.filter((m) => okOf(m, metrics.get(seed)![m.key]) === false).length, 0);
  if (errors.length) console.log(`\nОшибки: ${errors.join("; ")}`);

  const longest = Math.max(0, ...results.map((r) => r.ms));
  const wall = Date.now() - t0;
  const n = o.seeds.length;
  console.log(
    `\n${n} ${plural(n, "сид", "сида", "сидов")} × ${o.bots.length} ${plural(o.bots.length, "бот", "бота", "ботов")} за ${(wall / 1000).toFixed(0)} с (${width} ${plural(width, "процесс", "процесса", "процессов")}; самый долгий прогон ${(longest / 1000).toFixed(0)} с); мимо цели: ${misses}`,
  );
  // ENG-2's «≤ 1.6× one seed» is bound by CPU, not by the queue: the matrix never beats Σ runs / processes (nor its
  // longest run), and one seed takes about its longest run — so say how far this machine is from it
  const busy = results.reduce((a, r) => a + r.ms, 0);
  if (n > 1 && width > 0 && longest > 0) {
    const floor = Math.max(longest, busy / width);
    const need = Math.ceil(busy / (1.6 * longest));
    console.log(
      `Быстрее ${(floor / 1000).toFixed(0)} с на ${width} ${plural(width, "процессе", "процессах", "процессах")} не выйдет (сумма прогонов ${(busy / 1000).toFixed(0)} с; загрузка ${Math.round((100 * busy) / (width * wall))}%); ≤ 1.6× одного сида — от ${need} ${plural(need, "процесса", "процессов", "процессов")}`,
    );
  }

  let moved = 0;
  if (o.baseline) {
    if (!existsSync(o.baseline)) {
      console.log(`\nБазовой линии нет: ${o.baseline}`);
      process.exitCode = 1;
    } else {
      const base = JSON.parse(readFileSync(o.baseline, "utf8")) as BaselineFile;
      const rows: string[][] = [];
      for (const seed of o.seeds) {
        const b = base.seeds[String(seed)];
        if (!b) {
          rows.push([String(seed), "(нет в базовой линии)", "", "", ""]);
          continue;
        }
        for (const m of shown) {
          const now = metrics.get(seed)![m.key] ?? null;
          const was = b[m.key] ?? null;
          if (b[m.key] === undefined) continue;
          const d = relMove(now, was);
          if (d > MOVE_LIMIT) {
            moved++;
            rows.push([String(seed), m.head, fmtValue(was, m.unit), fmtValue(now, m.unit), now !== null && was !== null && was !== 0 ? `${now > was ? "+" : "−"}${(d * 100).toFixed(0)}%` : "изменилось"]);
          }
        }
      }
      console.log(`\n=== Против базовой линии ${path.relative(process.cwd(), o.baseline)} (сдвиг > ${MOVE_LIMIT * 100}%) ===`);
      console.log(rows.length ? table(["сид", "метрика", "было", "стало", "сдвиг"], rows) : "ничего не сдвинулось");
      if (moved) process.exitCode = 1;
    }
  }

  if (o.writeBaseline) {
    const file: BaselineFile = {
      version: 1,
      written: new Date().toISOString().slice(0, 10),
      args: o.rest,
      // in the tails' column order, rounded to 3 decimals (minutes, hours, seconds: plenty for a 10% diff)
      seeds: Object.fromEntries(
        o.seeds.map((seed) => {
          const m = metrics.get(seed)!;
          const row = METRICS.filter((x) => m[x.key] !== undefined).map((x) => [x.key, m[x.key] === null ? null : Math.round(m[x.key]! * 1000) / 1000]);
          return [String(seed), Object.fromEntries(row)];
        }),
      ),
    };
    writeFileSync(o.writeBaseline, JSON.stringify(file, null, 2) + "\n");
    console.log(`\nБазовая линия записана: ${path.relative(process.cwd(), o.writeBaseline)}`);
  }
  if (o.dump) writeFileSync(o.dump, JSON.stringify(results.map((r) => ({ seed: r.seed, bot: r.bot, ms: r.ms, summary: r.summary })), null, 1) + "\n");
  if (errors.length) process.exitCode = 1;
}

void main();
