/**
 * npx tsx scripts/sim-traits.ts [--seed 12345] [--replicates 3] [--run 3] [--districts all|id,id,…] [--tol 0.12] [--detail] [--threads N]
 *
 * v3 (ENG-11) forced-trait ablation: the active bot plays runs 1…run−1 as usual (one bot RNG stream per replicate,
 * seed ^ k·0x9e37, as balance-sim --replicates), then run `run` is replayed from that same snapshot once per district
 * with the district forced (sim-core forceDistrict). Prints each trait's coronation median (min–max) and its shift
 * against «Туман» (Уайтчепел, no mods); the acceptance is every median within ±tol. The geometric-mean shift is printed
 * too (for information): «Туман» itself is bimodal on 12345 (the Terminal opens at 8–26 min), so a median of a few
 * replicates swings by ±15% on its own. Replicates run in worker threads. SIM_OVERRIDES (JSON, sim-core applyOverrides: `districts`, `curios`, …) patches the data for tuning.
 */
import os from "node:os";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";
import { DISTRICTS } from "../src/game/data/districts";
import { RESOURCES } from "../src/game/data/resources";
import { migrate } from "../src/game/engine/actions";
import { cloneState } from "../src/game/engine/clone";
import { createInitialState } from "../src/game/engine/state";
import { DISTRICT_IDS, type DistrictId, type EdictId, type EngineCtx } from "../src/game/types";
import { applyOverrides, Bot, fmtMin, forceDistrict, runOne, type SimOptions } from "./sim-core";

interface Args {
  seed: number;
  replicates: number;
  run: number;
  districts: DistrictId[];
  tol: number;
  /** Print every replicate's coronation and its slowest express stages with the binding resource. */
  detail: boolean;
  /** Worker threads at once (default availableParallelism − 1). */
  threads: number;
}

/** One forced run: its coronation (s into the run, null: none) and the express stages that took longest. */
interface Forced {
  cor: number | null;
  slow: string;
}
type ReplicateResult = Partial<Record<DistrictId, Forced>>;

function parseArgs(argv: string[]): Args {
  const a: Args = { seed: 12345, replicates: 3, run: 3, districts: [...DISTRICT_IDS], tol: 0.12, detail: false, threads: Math.max(1, (os.availableParallelism?.() ?? os.cpus().length) - 1) };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === "--seed" && v) a.seed = Math.floor(Number(v)) >>> 0;
    else if (k === "--replicates" && v) a.replicates = Math.max(1, Math.min(16, Math.floor(Number(v)) || 1));
    else if (k === "--run" && v) a.run = Math.max(2, Math.min(8, Math.floor(Number(v)) || 3));
    else if (k === "--tol" && v) a.tol = Math.max(0, Number(v) || 0.12);
    else if (k === "--threads" && v) a.threads = Math.max(1, Math.floor(Number(v)) || 1);
    else if (k === "--detail") {
      a.detail = true;
      continue;
    }
    else if (k === "--districts" && v) {
      if (v !== "all") {
        const ids = v.split(",");
        for (const id of ids) if (!(DISTRICT_IDS as readonly string[]).includes(id)) throw new Error(`unknown district ${id}`);
        a.districts = ids as DistrictId[];
        if (!a.districts.includes("whitechapel")) a.districts.unshift("whitechapel");
      }
    } else continue;
    i++;
  }
  return a;
}

/** The sim options balance-sim uses for the active bot, so runs 1…run−1 are its runs. */
function simOptions(args: Args, k: number): SimOptions {
  return {
    seed: args.seed,
    botSeed: (args.seed ^ (k * 0x9e37)) >>> 0,
    bot: "active",
    runs: args.run,
    minutes: 150,
    checkpointMinutes: [5, 11, 16, 26, 42, 50, 55, 62, 80],
    offlineAtMinute: 60,
    postCoronationMinutes: 20,
  };
}

/** Play runs 1…run−1, migrate into run `run`, then replay that run once per district from the same snapshot. */
function replicate(args: Args, k: number): ReplicateResult {
  const opts = simOptions(args, k);
  const bot = new Bot("active", opts.botSeed ?? opts.seed, {});
  let s = createInitialState(opts.seed, 0);
  let edicts: EdictId[] = [];
  for (let run = 1; run < args.run; run++) {
    bot.newRun();
    const rep = runOne(s, bot, run, opts, edicts);
    const ctx: EngineCtx = { fx: [] };
    const next = rep.migrated ? migrate(rep.final, 0, ctx) : null;
    if (!next) throw new Error(`повтор ${k}: забег ${run} не дошёл до переселения`);
    s = next;
    edicts = bot.buyEdicts(s, ctx) as EdictId[];
  }
  const out: ReplicateResult = {};
  for (const id of args.districts) {
    const c = cloneState(s);
    forceDistrict(c, id);
    // the bot's bookkeeping (RNG stream, wishes) as it stood at the snapshot
    const b = Object.assign(Object.create(Object.getPrototypeOf(bot)) as Bot, structuredClone({ ...bot }));
    b.newRun();
    const rep = runOne(c, b, args.run, { ...opts, stopAtCoronation: true }, edicts);
    const slow = rep.binding
      .filter((x) => x.kind === "express" && x.end !== null)
      .sort((x, y) => y.end! - y.start - (x.end! - x.start))
      .slice(0, 2)
      .map((x) => `${x.label} ${fmtMin(x.end! - x.start)} ${x.last ? RESOURCES[x.last].icon : ""}`)
      .join(", ");
    const zones = `М ${fmtMin(rep.zoneOpenAt.metro)} В ${fmtMin(rep.zoneOpenAt.terminal)}`;
    out[id] = { cor: rep.coronationAt, slow: `${zones}; ${slow}` };
  }
  return out;
}

/** Geometric mean (coronation times are shifted by multipliers). */
function geoMean(xs: number[]): number {
  return Math.exp(xs.reduce((a, x) => a + Math.log(x), 0) / xs.length);
}

function median(xs: number[]): number {
  const a = [...xs].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

async function runAll(args: Args): Promise<ReplicateResult[]> {
  const n = args.replicates;
  const width = Math.max(1, Math.min(n, args.threads));
  const results: ReplicateResult[] = new Array(n);
  let next = 0;
  const one = (k: number) =>
    new Promise<ReplicateResult>((resolve, reject) => {
      const w = new Worker(__filename, { workerData: { args, k } });
      w.once("message", (r: ReplicateResult) => resolve(r));
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  applyOverrides(process.env.SIM_OVERRIDES);
  const t0 = Date.now();
  const results = await runAll(args);
  const rows = args.districts.map((id) => {
    const xs = results.map((r) => r[id]?.cor).filter((x): x is number => typeof x === "number");
    const all = xs.length === results.length;
    return { id, xs, med: all ? median(xs) : null, geo: all ? geoMean(xs) : null };
  });
  const fog = rows.find((r) => r.id === "whitechapel");
  const base = fog?.med ?? null;
  const baseGeo = fog?.geo ?? null;
  const pct = (x: number | null) => (x === null ? "—" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`);
  console.log(`=== Абляция черт районов (ENG-11): забег ${args.run}, сид ${args.seed}, повторов ${args.replicates}, допуск ±${Math.round(args.tol * 100)}% ===`);
  let fails = 0;
  for (const r of rows) {
    const t = DISTRICTS[r.id].trait;
    const shift = base !== null && r.med !== null ? r.med / base - 1 : null;
    const ok = shift !== null && Math.abs(shift) <= args.tol + 1e-9;
    if (!ok) fails++;
    const range = r.xs.length ? `${fmtMin(Math.min(...r.xs))}–${fmtMin(Math.max(...r.xs))}` : "—";
    const geoShift = baseGeo !== null && r.geo !== null ? r.geo / baseGeo - 1 : null;
    console.log(
      `${r.id.padEnd(14)} ${t.icon} ${t.name.padEnd(22)} коронация ${fmtMin(r.med).padStart(6)} (${range})  ${pct(shift).padStart(7)}  ${ok ? "PASS" : "FAIL"}  (среднее геом. ${fmtMin(r.geo)}, ${pct(geoShift)})`,
    );
    if (args.detail) results.forEach((x, k) => console.log(`    повтор ${k}: ${fmtMin(x[r.id]?.cor)}  дольше всего: ${x[r.id]?.slow || "—"}`));
  }
  console.log(`\n${fails ? `FAIL: ${fails}` : "PASS: все черты"} в пределах ±${Math.round(args.tol * 100)}% от «Тумана»; ${((Date.now() - t0) / 1000).toFixed(0)} с`);
  if (fails) process.exitCode = 1;
}

if (isMainThread) void main();
else {
  const { args, k } = workerData as { args: Args; k: number };
  applyOverrides(process.env.SIM_OVERRIDES);
  parentPort!.postMessage(replicate(args, k));
}
