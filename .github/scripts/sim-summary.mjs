// Turns one `npm run sim -- --summary` log into Markdown for $GITHUB_STEP_SUMMARY (balance.yml, REP-1) and saves the
// SUMMARY JSON next to it for the artifact.
//   node .github/scripts/sim-summary.mjs <sim.log> <seed> [<summary.json>]
import { readFileSync, writeFileSync } from "node:fs";

const [logPath, seed = "?", jsonPath] = process.argv.slice(2);
if (!logPath) {
  console.error("usage: node .github/scripts/sim-summary.mjs <sim.log> <seed> [<summary.json>]");
  process.exit(2);
}

let log = "";
try {
  log = readFileSync(logPath, "utf8");
} catch {
  log = "";
}
const lines = log.split(/\r?\n/);
const fence = (lang, body) => `\`\`\`${lang}\n${body.trim()}\n\`\`\``;
const details = (summary, body) => `<details><summary>${summary}</summary>\n\n${body}\n\n</details>`;
const out = [`### Balance sim, seed ${seed}`, ""];

const raw = lines.find((l) => l.startsWith("SUMMARY "));
let summary = null;
try {
  summary = raw ? JSON.parse(raw.slice("SUMMARY ".length)) : null;
} catch {
  summary = null;
}

if (!summary) {
  out.push("**No SUMMARY line: the sim did not finish.** Last lines of the log:", "", fence("text", lines.slice(-40).join("\n")));
  console.log(out.join("\n"));
  process.exit(0);
}
if (jsonPath) writeFileSync(jsonPath, JSON.stringify(summary, null, 2) + "\n");

const tally = lines.find((l) => /в допуске/.test(l));
if (tally) out.push(`**${tally.trim()}**`, "");

/** Seconds to m:ss; minutes (one decimal, as SUMMARY stores run lengths) to h:mm. */
const clock = (n) => {
  const t = Math.round(n);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};
const mmss = (sec) => (typeof sec === "number" && Number.isFinite(sec) ? clock(sec) : "—");
const hm = (min) => (typeof min === "number" && Number.isFinite(min) ? clock(min) : "—");

let crowned = null;
let played = 0;
for (const r of summary.active ?? []) {
  if (r.cor !== null && r.cor !== undefined) {
    crowned = played + r.cor;
    break;
  }
  played += r.len ?? 0;
}

const rows = [["Metric", "Value"], ["---", "---"]];
rows.push(["Coronation, total", crowned === null ? `none (${hm(played)} played)` : `${(crowned / 60).toFixed(2)} h (${hm(crowned)})`]);
for (const r of summary.active ?? []) {
  rows.push([`Active run ${r.run}`, `${hm(r.len)}${r.cor !== null && r.cor !== undefined ? `, crowned at ${hm(r.cor)}` : ""}, max goal gap ${mmss(r.gap)}, min steam eff ${r.steamEffMin ?? "—"}`]);
}
for (const r of summary.passive ?? []) rows.push(["Passive run", `${hm(r.len)}, max goal gap ${mmss(r.gap)}`]);
/** `group:name` as the sim prints it (the group cut to its last 9 characters, hence the stray leading comma). */
const names = (list) => (list?.length ? list.map((f) => `\`${String(f).replace(/^[,\s]+/, "")}\``).join(", ") : "none");
rows.push(["GDD check FAILs", names(summary.fails)]);
rows.push(["v2 goal FAILs", names(summary.v2fails)]);
out.push(...rows.map((r) => `| ${r.join(" | ")} |`), "");

const start = lines.findIndex((l) => l.includes("=== Проверки ==="));
if (start >= 0) out.push(details("Checks", fence("text", lines.slice(start).join("\n"))), "");
out.push(details("SUMMARY JSON", fence("json", JSON.stringify(summary, null, 2))), "");

console.log(out.join("\n"));
