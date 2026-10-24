/** Dev helper: multiplier stack + levels at given minutes (npx tsx scripts/sim-stack.ts 5,11,26,42,62,80). */
import { applyOverrides, Bot } from "./sim-core";
import { createInitialState } from "../src/game/engine/state";
import { step, TICK } from "../src/game/engine/step";
import { derive } from "../src/game/engine/derive";
import type { EngineCtx } from "../src/game/types";

applyOverrides(process.env.SIM_OVERRIDES);
const mins = (process.argv[2] ?? "5,11,16,26,42,50,62,80").split(",").map(Number);
const kind = (process.argv[3] ?? "active") as "active" | "passive";
const s = createInitialState(12345, 0);
const bot = new Bot(kind, 12345);
const ctx: EngineCtx = { fx: [] };
const end = Math.max(...mins) * 60;
const nz = (o: Record<string, number>) =>
  Object.entries(o)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${k}:${Math.round(v)}`)
    .join(" ");
let next = 0;
for (let i = 0; i < end / TICK + 1; i++) {
  step(s, TICK, { active: bot.isActive(s) }, ctx);
  bot.tick(s, ctx);
  ctx.fx.length = 0;
  if (next < mins.length && s.time >= mins[next] * 60) {
    next++;
    const d = derive(s);
    console.log(`--- min ${Math.round(s.time / 60)}: rats ${s.rats}/${d.housing} zones ${Object.keys(s.zones).join(",")} E ${Math.round(s.eRun)}`);
    console.log(`  b: ${nz(s.buildings)}`);
    console.log(`  jobs: ${nz(s.jobs)}  ups: ${Object.keys(s.upgrades).length}`);
    console.log(
      `  tier ${d.tierMult.toFixed(2)} global ${d.global.toFixed(2)} [${d.globalParts.map((p) => `${p.label} ${p.mult.toFixed(2)}`).join(", ")}] pickYield ${d.jobYield.pickpocket.toFixed(2)} scavYield ${d.jobYield.scavenger.toFixed(2)} forYield ${d.jobYield.forager.toFixed(2)} click ${d.click}`,
    );
    console.log(`  gross: ${nz(Object.fromEntries(Object.entries(s.gross).map(([k, v]) => [k, v])))} caps: crumbs ${Math.round(d.caps.crumbs)} coins ${Math.round(d.caps.coins)} gears ${Math.round(d.caps.gears)}`);
  }
}
