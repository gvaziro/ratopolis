/**
 * Dev helper: trace one bot run.
 * npx tsx scripts/sim-trace.ts [minutes] [every] [bot] [debugFromMin] [debugToMin]
 * env: SIM_OVERRIDES (json), TRACE_EDICTS=a,b,c, TRACE_CROWNS=N (start as a later run), TRACE_SEED=N
 */
import { applyOverrides, Bot } from "./sim-core";
import { createInitialState, newRun } from "../src/game/engine/state";
import { step, TICK } from "../src/game/engine/step";
import { derive } from "../src/game/engine/derive";
import type { EdictId, EngineCtx } from "../src/game/types";

applyOverrides(process.env.SIM_OVERRIDES);
const minutes = Number(process.argv[2] ?? 12);
const every = Number(process.argv[3] ?? 30);
const kind = (process.argv[4] ?? "active") as "active" | "passive";
const dbgFrom = Number(process.argv[5] ?? 1e9) * 60;
const dbgTo = Number(process.argv[6] ?? 1e9) * 60;
const seed = Number(process.env.TRACE_SEED ?? 12345);
let s = createInitialState(seed, 0);
if (process.env.TRACE_EDICTS || process.env.TRACE_CROWNS) {
  const meta = s.meta;
  for (const e of (process.env.TRACE_EDICTS ?? "").split(",").filter(Boolean)) meta.edicts[e as EdictId] = true;
  meta.crownsEver = Number(process.env.TRACE_CROWNS ?? 0);
  meta.migrations = 1;
  s = newRun(meta, s.settings, seed, 0);
}
const bot = new Bot(kind, seed);
const ctx: EngineCtx = { fx: [] };
let last = -1;
const nz = (o: Record<string, number>) =>
  Object.entries(o)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${k}:${v >= 100 ? Math.round(v) : Math.round(v * 10) / 10}`)
    .join(" ");
for (let i = 0; i < (minutes * 60) / TICK; i++) {
  step(s, TICK, { active: bot.isActive(s) }, ctx);
  bot.debug = s.time >= dbgFrom && s.time <= dbgTo ? (m) => console.log(`  [${Math.floor(s.time)}] ${m}`) : null;
  bot.tick(s, ctx);
  for (const f of ctx.fx) {
    if (f.k === "upgrade") console.log(`  ${Math.floor(s.time)}s upgrade ${f.upgrade}`);
    else if (f.k === "zoneOpen") console.log(`  ${Math.floor(s.time)}s ZONE ${f.zone}`);
    else if (f.k === "expressStage") console.log(`  ${Math.floor(s.time)}s EXPRESS ${f.stage}`);
    else if (f.k === "buy" && s.time >= dbgFrom && s.time <= dbgTo) console.log(`  ${Math.floor(s.time)}s buy ${f.building} ${f.level}`);
  }
  ctx.fx.length = 0;
  const sec = Math.floor(s.time);
  if (sec !== last && sec % every === 0) {
    last = sec;
    const d = derive(s);
    console.log(
      `t=${sec}s rats=${s.rats}/${d.housing} res[${nz(s.res)}] ema[${nz(s.ema)}] jobs[${nz(s.jobs)}] b[${nz(s.buildings)}] rush=${bot.rush} mode=${s.assignMode} E=${Math.round(s.eRun)}`,
    );
    if (s.digging === null && s.express.stage > 0) console.log(`   express ${s.express.stage} progress ${nz(s.express.progress)}`);
  }
}
