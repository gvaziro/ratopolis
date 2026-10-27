/**
 * npx tsx scripts/sim-traits.ts [--seed 12345] [--replicates 3] [--samples 6] [--run 3] [--districts all|id,id,…] [--tol 0.12]
 *                               [--detail] [--threads N]
 *
 * v3 (ENG-11) forced-trait ablation: the active bot plays runs 1…run−1 as usual (one bot RNG stream per replicate,
 * seed ^ k·0x9e37, as balance-sim --replicates), then run `run` is replayed from that same snapshot with each district
 * forced (sim-core forceDistrict). Prints each trait's coronation median (min–max) over every forced run and its shift
 * against «Туман» (Уайтчепел, no mods); the acceptance is every median within ±tol.
 *
 * Samples: one forced run per replicate is not a measurement. From the same snapshot, «Туман» alone crowns anywhere
 * between 27 and 58 minutes depending on the dice (which trains come, what the bot catches, which purchase it can afford
 * first: GDD 15.17), so a median of three runs swings by ±20% with no trait at all and one of nine by ±10%. Each
 * replicate therefore replays its forced run `samples` times — sample 0 with the snapshot's own game and bot RNG,
 * sample m > 0 with both streams reseeded by m, the same m for every district (paired runs) — and the trait's median is
 * taken over replicates × samples runs (3 × 6 = 18 by default: about 35 minutes on four threads). Every run is
 * deterministic, so a trait left untouched gives the same numbers on a rerun. Also printed: the geometric-mean shift,
 * the paired median ratio (trait / «Туман» of the same replicate and sample) and a 90% bootstrap interval of the
 * geometric-mean shift (paired resampling), so a FAIL can be told from noise.
 * Work runs in a pool of worker threads (snapshots first, then one task per replicate × sample × district).
 * SIM_OVERRIDES (JSON, sim-core applyOverrides: `districts`, `curios`, …) patches the data for tuning.
 */
import os from "node:os";
import { isMainThread, parentPort, Worker } from "node:worker_threads";
import { DISTRICTS } from "../src/game/data/districts";
import { RESOURCES } from "../src/game/data/resources";
import { migrate } from "../src/game/engine/actions";
import { cloneState } from "../src/game/engine/clone";
import { createInitialState } from "../src/game/engine/state";
import { DISTRICT_IDS, type DistrictId, type EdictId, type EngineCtx, type GameState } from "../src/game/types";
import { applyOverrides, Bot, fmtMin, forceDistrict, runOne, type SimOptions } from "./sim-core";

interface Args {
  seed: number;
  replicates: number;
  /** Forced runs per replicate and district (sample 0: the snapshot's RNG; m > 0: both streams reseeded by m). */
  samples: number;
  run: number;
  districts: DistrictId[];
  tol: number;
  /** Print every forced run's coronation and its slowest express stages with the binding resource. */
  detail: boolean;
  /** Worker threads at once (default availableParallelism − 1). */
  threads: number;
}

/** One forced run: its coronation (s into the run, null: none) and where the run lost its time. */
interface Forced {
  cor: number | null;
  slow: string;
}

/** Runs 1…run−1 of replicate k: the state right after the migration into run `run`, the bot and the edicts it bought. */
interface Snapshot {
  k: number;
  state: GameState;
  /** The bot's own fields (structured-clone safe); rebuilt on Bot.prototype in the worker. */
  bot: Record<string, unknown>;
  edicts: EdictId[];
}

type Task = { t: "snap"; args: Args; k: number } | { t: "run"; args: Args; snap: Snapshot; m: number; id: DistrictId };
type Reply = { t: "snap"; snap: Snapshot } | { t: "run"; k: number; m: number; id: DistrictId; res: Forced } | { t: "error"; error: string };

function parseArgs(argv: string[]): Args {
  const a: Args = {
    seed: 12345,
    replicates: 3,
    samples: 6,
    run: 3,
    districts: [...DISTRICT_IDS],
    tol: 0.12,
    detail: false,
    threads: Math.max(1, (os.availableParallelism?.() ?? os.cpus().length) - 1),
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === "--seed" && v) a.seed = Math.floor(Number(v)) >>> 0;
    else if (k === "--replicates" && v) a.replicates = Math.max(1, Math.min(16, Math.floor(Number(v)) || 1));
    else if (k === "--samples" && v) a.samples = Math.max(1, Math.min(16, Math.floor(Number(v)) || 1));
    else if (k === "--run" && v) a.run = Math.max(2, Math.min(8, Math.floor(Number(v)) || 3));
    else if (k === "--tol" && v) a.tol = Math.max(0, Number(v) || 0.12);
    else if (k === "--threads" && v) a.threads = Math.max(1, Math.floor(Number(v)) || 1);
    else if (k === "--detail") {
      a.detail = true;
      continue;
    } else if (k === "--districts" && v) {
      if (v !== "all") {
        const ids = v.split(",");
        for (const id of ids) if (!(DISTRICT_IDS as readonly string[]).includes(id)) throw new Error(`unknown district ${id}`);
        a.districts = ids as DistrictId[];
      }
    } else continue;
    i++;
  }
  // «Туман» is the yardstick: always measured, always first
  a.districts = ["whitechapel", ...a.districts.filter((id) => id !== "whitechapel")];
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

/** Play runs 1…run−1 of replicate k and migrate into run `run`. */
function snapshot(args: Args, k: number): Snapshot {
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
  return { k, state: s, bot: structuredClone({ ...bot }) as Record<string, unknown>, edicts };
}

/** Reseed a 32-bit RNG state for sample m (m = 0: unchanged). */
function reseed(rng: number, m: number, salt: number): number {
  return m > 0 ? (rng ^ Math.imul(m, salt)) >>> 0 : rng;
}

/** Replay run `run` of a snapshot in district `id`, sample m, until the coronation. */
function forcedRun(args: Args, snap: Snapshot, m: number, id: DistrictId): Forced {
  const opts = simOptions(args, snap.k);
  const c = cloneState(snap.state);
  forceDistrict(c, id);
  c.rng = reseed(c.rng, m, 0x165667b1);
  // the bot's bookkeeping (RNG stream, wishes) as it stood at the snapshot
  const b = Object.assign(Object.create(Bot.prototype) as Bot, structuredClone(snap.bot));
  b.rnd.rng = reseed(b.rnd.rng, m, 0x27d4eb2d);
  b.newRun();
  const rep = runOne(c, b, args.run, { ...opts, stopAtCoronation: true }, snap.edicts);
  const slow = rep.binding
    .filter((x) => x.kind === "express" && x.end !== null)
    .sort((x, y) => y.end! - y.start - (x.end! - x.start))
    .slice(0, 2)
    .map((x) => `${x.label} ${fmtMin(x.end! - x.start)} ${x.last ? RESOURCES[x.last].icon : ""}`)
    .join(", ");
  const zones = `М ${fmtMin(rep.zoneOpenAt.metro)} В ${fmtMin(rep.zoneOpenAt.terminal)}`;
  return { cor: rep.coronationAt, slow: `${zones}; ${slow}` };
}

/* ---------------------------------------------------------------- statistics */

function median(xs: number[]): number {
  const a = [...xs].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/** Geometric mean (coronation times are shifted by multipliers). */
function geoMean(xs: number[]): number {
  return Math.exp(xs.reduce((a, x) => a + Math.log(x), 0) / xs.length);
}

/** 90% bootstrap interval of geo(trait) / geo(base) − 1 over paired runs (deterministic resampling). */
function bootstrapGeoShift(pairs: [number, number][], rounds = 2000): [number, number] {
  let r = 0x2545f491;
  const next = () => {
    r ^= r << 13;
    r ^= r >>> 17;
    r ^= r << 5;
    return (r >>> 0) / 4294967296;
  };
  const n = pairs.length;
  const out: number[] = [];
  for (let i = 0; i < rounds; i++) {
    let lt = 0;
    let lb = 0;
    for (let j = 0; j < n; j++) {
      const [t, b] = pairs[Math.floor(next() * n)];
      lt += Math.log(t);
      lb += Math.log(b);
    }
    out.push(Math.exp((lt - lb) / n) - 1);
  }
  out.sort((x, y) => x - y);
  return [out[Math.floor(0.05 * rounds)], out[Math.floor(0.95 * rounds) - 1]];
}

/* ---------------------------------------------------------------- the pool */

function runTask(task: Task): Reply {
  if (task.t === "snap") return { t: "snap", snap: snapshot(task.args, task.k) };
  return { t: "run", k: task.snap.k, m: task.m, id: task.id, res: forcedRun(task.args, task.snap, task.m, task.id) };
}

/** Run every task on `threads` persistent workers; `onReply` sees each answer as it comes. */
async function pool(tasks: Task[], threads: number, onReply: (r: Reply) => void): Promise<void> {
  let next = 0;
  const width = Math.max(1, Math.min(threads, tasks.length));
  await Promise.all(
    Array.from(
      { length: width },
      () =>
        new Promise<void>((resolve, reject) => {
          const w = new Worker(__filename);
          const feed = () => {
            if (next >= tasks.length) {
              void w.terminate().then(() => resolve());
              return;
            }
            w.postMessage(tasks[next++]);
          };
          w.on("message", (r: Reply) => {
            if (r.t === "error") {
              void w.terminate();
              reject(new Error(r.error));
              return;
            }
            onReply(r);
            feed();
          });
          w.once("error", reject);
          feed();
        }),
    ),
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  applyOverrides(process.env.SIM_OVERRIDES);
  const t0 = Date.now();
  const snaps: Snapshot[] = [];
  await pool(
    Array.from({ length: args.replicates }, (_, k): Task => ({ t: "snap", args, k })),
    args.threads,
    (r) => {
      if (r.t === "snap") snaps[r.snap.k] = r.snap;
    },
  );
  const runs: Task[] = [];
  let done = 0;
  for (const snap of snaps) for (let m = 0; m < args.samples; m++) for (const id of args.districts) runs.push({ t: "run", args, snap, m, id });
  /** forced[id][k * samples + m] */
  const forced: Partial<Record<DistrictId, (Forced | undefined)[]>> = {};
  await pool(runs, args.threads, (r) => {
    if (r.t !== "run") return;
    (forced[r.id] ??= [])[r.k * args.samples + r.m] = r.res;
    // progress on stderr (stdout stays the table)
    if (++done % 12 === 0 || done === runs.length) process.stderr.write(`  ${done}/${runs.length} забегов, ${((Date.now() - t0) / 1000).toFixed(0)} с\n`);
  });

  const n = args.replicates * args.samples;
  const cors = (id: DistrictId) => Array.from({ length: n }, (_, i) => forced[id]?.[i]?.cor ?? null);
  const base = cors("whitechapel");
  const baseAll = base.every((x) => x !== null) ? (base as number[]) : null;
  const baseMed = baseAll ? median(baseAll) : null;
  const baseGeo = baseAll ? geoMean(baseAll) : null;
  const pct = (x: number | null) => (x === null ? "—" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`);
  console.log(
    `=== Абляция черт районов (ENG-11): забег ${args.run}, сид ${args.seed}, повторов ${args.replicates} × проб ${args.samples} = ${n} забегов на черту, допуск ±${Math.round(args.tol * 100)}% ===`,
  );
  console.log(`${"район / черта".padEnd(39)} ${"медиана (мин–макс)".padEnd(24)} ${"сдвиг".padStart(7)}  итог   ср. геом.  сдвиг [90% интервал]          парная`);
  let fails = 0;
  for (const id of args.districts) {
    const t = DISTRICTS[id].trait;
    const raw = cors(id);
    const all = raw.every((x) => x !== null);
    const xs = raw.filter((x): x is number => x !== null);
    const med = all ? median(xs) : null;
    const geo = all ? geoMean(xs) : null;
    const shift = baseMed !== null && med !== null ? med / baseMed - 1 : null;
    const ok = shift !== null && Math.abs(shift) <= args.tol + 1e-9;
    if (!ok) fails++;
    const range = xs.length ? `${fmtMin(Math.min(...xs))}–${fmtMin(Math.max(...xs))}` : "—";
    const geoShift = baseGeo !== null && geo !== null ? geo / baseGeo - 1 : null;
    let ci = "";
    let paired = "—";
    if (all && baseAll && id !== "whitechapel") {
      const pairs = xs.map((x, i): [number, number] => [x, baseAll[i]]);
      const [lo, hi] = bootstrapGeoShift(pairs);
      ci = ` [${pct(lo)} … ${pct(hi)}]`;
      paired = pct(Math.exp(median(pairs.map(([a, b]) => Math.log(a / b)))) - 1);
    }
    console.log(
      `${id.padEnd(14)} ${t.icon} ${t.name.padEnd(22)} ${`${fmtMin(med).padStart(6)} (${range})`.padEnd(24)} ${pct(shift).padStart(7)}  ${ok ? "PASS" : "FAIL"}   ${fmtMin(geo).padStart(6)}  ${pct(geoShift).padStart(7)}${ci.padEnd(24)}  ${paired.padStart(7)}`,
    );
    if (args.detail) {
      raw.forEach((x, i) => {
        const k = Math.floor(i / args.samples);
        const m = i % args.samples;
        console.log(`    повтор ${k}, проба ${m}: ${fmtMin(x)}  ${forced[id]?.[i]?.slow || "—"}`);
      });
    }
  }
  console.log(`\n${fails ? `FAIL: ${fails}` : "PASS: все черты"} в пределах ±${Math.round(args.tol * 100)}% от «Тумана»; ${((Date.now() - t0) / 1000).toFixed(0)} с`);
  if (fails) process.exitCode = 1;
}

if (isMainThread) void main();
else {
  applyOverrides(process.env.SIM_OVERRIDES);
  parentPort!.on("message", (task: Task) => {
    try {
      parentPort!.postMessage(runTask(task));
    } catch (e) {
      parentPort!.postMessage({ t: "error", error: e instanceof Error ? (e.stack ?? e.message) : String(e) } satisfies Reply);
    }
  });
}
