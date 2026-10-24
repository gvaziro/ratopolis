/** Dev helper: which buildings/upgrades a long active run never sees (npx tsx scripts/sim-reach.ts [minutes] [runs] [seed]). */
import { BUILDING_IDS, UPGRADE_IDS } from "../src/game/types";
import { simulate } from "./sim-core";

const minutes = Number(process.argv[2] ?? 180);
const runs = Number(process.argv[3] ?? 1);
const seed = Number(process.argv[4] ?? 7);
const t0 = Date.now();
const reps = simulate({ seed, bot: "active", runs, minutes });
const b = new Set(reps.flatMap((r) => r.buildingsSeen));
const u = new Set(reps.flatMap((r) => r.upgradesSeen));
console.log(`runs ${reps.map((r) => `${(r.seconds / 60).toFixed(1)}m cor ${r.coronationAt ? (r.coronationAt / 60).toFixed(1) : "-"}`).join(", ")}`);
console.log("unseen buildings:", BUILDING_IDS.filter((x) => !b.has(x)).join(", ") || "none");
console.log("unseen upgrades:", UPGRADE_IDS.filter((x) => !u.has(x)).join(", ") || "none");
console.log("nonFinite:", reps.flatMap((r) => r.nonFinite).join("; ") || "none");
console.log(`took ${((Date.now() - t0) / 1000).toFixed(1)} s`);
