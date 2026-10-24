/**
 * npm run sim -- [--bot active|passive|both] [--runs 1..3] [--minutes N] [--seed N] [--strict] [--quiet]
 *
 * Deterministic headless balance runs (GDD 15.14): an active and a passive bot drive the real engine.
 * Prints checkpoint tables, the GDD 15.14 checkpoints with PASS/FAIL (±25%), passive windows,
 * runs 2/3 against GDD 14.2, time to coronation and the acceptance checks.
 */
import { ACHIEVEMENTS, ACHIEVEMENT_ORDER, EDICTS, EDICT_ORDER } from "../src/game/data/meta";
import { ZONE_ORDER } from "../src/game/data/zones";
import { edictRank } from "../src/game/engine/ranks";
import type { ZoneId } from "../src/game/types";
import { applyOverrides, fmtMin, PRE_TUNING_OVERRIDES, simulate, type Checkpoint, type RunReport } from "./sim-core";

/* ---------------------------------------------------------------- args */

interface Args {
  bot: "active" | "passive" | "both";
  runs: number;
  minutes: number | null;
  seed: number;
  strict: boolean;
  quiet: boolean;
  /** Print one machine-readable SUMMARY line (for tuning scripts). */
  summary: boolean;
  /** Run with the data tables as they were before balance tuning. */
  preTuning: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { bot: "both", runs: 3, minutes: null, seed: 12345, strict: false, quiet: false, summary: false, preTuning: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === "--bot" && v) {
      if (v !== "active" && v !== "passive" && v !== "both") throw new Error(`--bot must be active|passive|both, got ${v}`);
      a.bot = v;
      i++;
    } else if (k === "--runs" && v) {
      a.runs = Math.max(1, Math.min(3, Math.floor(Number(v)) || 1));
      i++;
    } else if (k === "--minutes" && v) {
      a.minutes = Math.max(1, Number(v) || 60);
      i++;
    } else if (k === "--seed" && v) {
      a.seed = Math.floor(Number(v)) >>> 0;
      i++;
    } else if (k === "--strict") a.strict = true;
    else if (k === "--quiet") a.quiet = true;
    else if (k === "--summary") a.summary = true;
    else if (k === "--pre-tuning") a.preTuning = true;
    else if (k === "--help" || k === "-h") {
      console.log("npm run sim -- [--bot active|passive|both] [--runs 1..3] [--minutes N] [--seed N] [--strict] [--quiet]");
      process.exit(0);
    }
  }
  return a;
}

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

/* ---------------------------------------------------------------- checks */

type Verdict = "PASS" | "FAIL" | "INFO";
interface Check {
  group: string;
  name: string;
  target: string;
  actual: string;
  verdict: Verdict;
}

const TOL = 0.25;
/** Value within [lo, hi] widened by ±25%. */
function within(x: number | null, lo: number, hi: number): Verdict {
  if (x === null || !Number.isFinite(x)) return "FAIL";
  return x >= lo * (1 - TOL) && x <= hi * (1 + TOL) ? "PASS" : "FAIL";
}

function cpAt(r: RunReport, minute: number): Checkpoint | undefined {
  return r.checkpoints.find((c) => c.minute === minute);
}

function minOf(sec: number | null | undefined): number | null {
  return sec === null || sec === undefined ? null : sec / 60;
}

function activeChecks(r: RunReport): Check[] {
  const out: Check[] = [];
  const g = "GDD 15.14 активный, забег 1";
  const add = (name: string, target: string, actual: string, verdict: Verdict) => out.push({ group: g, name, target, actual, verdict });
  const c5 = cpAt(r, 5);
  add("мин 5: крысы", "15", String(c5?.rats ?? "—"), within(c5?.rats ?? null, 15, 15));
  add("мин 5: 🍞/с (пассив)", "≈ 8", num(c5?.crumbsPerSec ?? NaN), within(c5?.crumbsPerSec ?? null, 8, 8));
  add("мин 5: 🪙/с (пассив)", "≈ 0.6", num(c5?.coinsPassive ?? NaN), within(c5?.coinsPassive ?? null, 0.6, 0.6));
  add("Канализация открыта", "11:00", fmtMin(r.zoneOpenAt.sewers), within(minOf(r.zoneOpenAt.sewers), 11, 11));
  const c11 = cpAt(r, 11);
  add("мин 11: крысы", "25–30", String(c11?.rats ?? "—"), within(c11?.rats ?? null, 25, 30));
  add("первая капсула", "16:00", fmtMin(r.firstCapsuleAt), within(minOf(r.firstCapsuleAt), 16, 16));
  add("Подвалы открыты", "26:00", fmtMin(r.zoneOpenAt.cellars), within(minOf(r.zoneOpenAt.cellars), 26, 26));
  const c26 = cpAt(r, 26);
  add("мин 26: крысы", "60–70", String(c26?.rats ?? "—"), within(c26?.rats ?? null, 60, 70));
  add("мин 26: 🪙/с (пассив)", "≈ 12", num(c26?.coinsPassive ?? NaN), within(c26?.coinsPassive ?? null, 12, 12));
  add("Метро открыто", "42:00", fmtMin(r.zoneOpenAt.metro), within(minOf(r.zoneOpenAt.metro), 42, 42));
  const c42 = cpAt(r, 42);
  add("мин 42: крысы", "130–150", String(c42?.rats ?? "—"), within(c42?.rats ?? null, 130, 150));
  add("мин 42: 🪙/с (пассив)", "≈ 100", num(c42?.coinsPassive ?? NaN), within(c42?.coinsPassive ?? null, 100, 100));
  const c50 = cpAt(r, 50);
  add("мин 50: 🪙/с (пассив)", "≈ 150", num(c50?.coinsPassive ?? NaN), within(c50?.coinsPassive ?? null, 150, 150));
  // v2 (EN-2): the 10-minute window ends at minute 55, so it no longer straddles the metro opening (~42–45)
  const c55 = cpAt(r, 55);
  add("мин 55: доля поездов", "30–45%", c55 ? pct(c55.trainShare) : "—", within(c55?.trainShare ?? null, 0.3, 0.45));
  add("E_run ≥ 1M", "62:00", fmtMin(r.eRun1MAt), within(minOf(r.eRun1MAt), 62, 62));
  const c80 = cpAt(r, 80);
  const e80 = c80?.eRun ?? (r.migrated && r.seconds < 80 * 60 ? null : null);
  add("мин 80: E_run", "5–8M", c80 ? num(c80.eRun) : "—", c80 ? within(e80, 5e6, 8e6) : "INFO");
  add("мин 80: венцы", "22–28", c80 ? String(c80.crowns) : String(r.crownsGained) + " (при переселении)", within(c80?.crowns ?? r.crownsGained, 22, 28));
  return out;
}

function passiveChecks(r: RunReport): Check[] {
  const g = "GDD 15.14 пассивный";
  const win = (name: string, sec: number | null | undefined, lo: number, hi: number): Check => {
    const m = minOf(sec);
    return { group: g, name, target: `${lo}–${hi} мин`, actual: fmtMin(sec), verdict: within(m, lo, hi) };
  };
  return [
    win("Канализация", r.zoneOpenAt.sewers, 18, 26),
    win("Подвалы", r.zoneOpenAt.cellars, 45, 60),
    win("Метро", r.zoneOpenAt.metro, 75, 100),
    win("E_run 1M", r.eRun1MAt, 110, 140),
  ];
}

function laterRunChecks(r: RunReport): Check[] {
  const g = `GDD 14.2 забег ${r.run}`;
  const w = (name: string, sec: number | null | undefined, lo: number, hi: number): Check => ({
    group: g,
    name,
    target: `${lo}–${hi} мин`,
    actual: fmtMin(sec),
    verdict: lo === 0 && hi === 0 ? (sec !== undefined && sec !== null && sec < 30 ? "PASS" : "FAIL") : within(minOf(sec), lo, hi),
  });
  if (r.run === 2)
    return [
      w("Канализация", r.zoneOpenAt.sewers, 4, 6),
      w("Подвалы", r.zoneOpenAt.cellars, 12, 15),
      w("Метро", r.zoneOpenAt.metro, 24, 28),
      w("Переселение доступно", r.migrateReadyAt, 36, 40),
      w("Вокзал", r.zoneOpenAt.terminal, 45, 55),
      w("Экспресс, этап 5", r.expressStageAt[4], 55, 80),
    ];
  return [
    w("Канализация", r.zoneOpenAt.sewers, 0, 0),
    w("Подвалы", r.zoneOpenAt.cellars, 5, 7),
    w("Метро", r.zoneOpenAt.metro, 12, 15),
    w("Переселение доступно", r.migrateReadyAt, 20, 24),
    w("Вокзал", r.zoneOpenAt.terminal, 26, 32),
    w("Экспресс, этап 5", r.expressStageAt[4], 32, 45),
    w("Коронация", r.coronationAt, 45, 65),
  ];
}

function acceptance(active: RunReport[] | null, passive: RunReport[] | null): Check[] {
  const g = "Приёмка";
  const out: Check[] = [];
  const all = [...(active ?? []), ...(passive ?? [])];
  const bad = all.flatMap((r) => r.nonFinite.map((b) => `${r.bot}#${r.run} ${b}`));
  out.push({ group: g, name: "нет NaN/Infinity в ресурсах", target: "0", actual: bad.length ? bad.slice(0, 3).join("; ") : "0", verdict: bad.length ? "FAIL" : "PASS" });
  if (active) {
    const worst = active.reduce((a, r) => (r.maxStorageStall > a.maxStorageStall ? r : a), active[0]);
    out.push({
      group: g,
      name: "активный: простой из-за склада",
      target: "≤ 3:00",
      actual: `${fmtMin(worst.maxStorageStall)} (забег ${worst.run}, ${fmtMin(worst.maxStorageStallAt)})`,
      verdict: worst.maxStorageStall <= 180 ? "PASS" : "FAIL",
    });
    const off = active[0].offlineCheck;
    if (off)
      out.push({
        group: g,
        name: "офлайн 8 ч ≤ T·доход·η + поезда",
        target: `≤ ${num(off.boundValue)}`,
        actual: `${num(off.gainedValue)} (сим. ${fmtMin(off.simulated)}, η ${off.eta})`,
        verdict: off.ok ? "PASS" : "FAIL",
      });
  }
  if (passive) {
    const r = passive[0];
    out.push({
      group: g,
      name: "пассивный: ожидание новой цели",
      target: "≤ 4:00",
      actual: `${fmtMin(r.maxGoalGap)} (в ${fmtMin(r.maxGoalGapAt)})`,
      verdict: r.maxGoalGap <= 240 ? "PASS" : "FAIL",
    });
  }
  return out;
}

/** Exact window, no ±25% (v2 targets). */
function inRange(x: number | null | undefined, lo: number, hi: number): Verdict {
  if (x === null || x === undefined || !Number.isFinite(x)) return "FAIL";
  return x >= lo && x <= hi ? "PASS" : "FAIL";
}

/** Gaps between consecutive express stages built in this run (kept stages excluded): [from stage, to stage, seconds]. */
function expressGaps(r: RunReport): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let n = r.expressKept + 2; n <= r.expressStageAt.length; n++) out.push([n - 1, n, r.expressStageAt[n - 1] - r.expressStageAt[n - 2]]);
  return out;
}

/** v2 roadmap targets (EN-1..EN-4, validated together in EN-13); tallied separately from the GDD checkpoints. */
function v2Checks(active: RunReport[] | null, passive: RunReport[] | null): Check[] {
  const g = "v2";
  const out: Check[] = [];
  const add = (name: string, target: string, actual: string, verdict: Verdict) => out.push({ group: g, name, target, actual, verdict });
  if (active) {
    const r1 = active[0];
    add("забег 1: Подвалы", "24–28 мин", fmtMin(r1.zoneOpenAt.cellars), inRange(minOf(r1.zoneOpenAt.cellars), 24, 28));
    add("забег 1: венцы", "20–28", String(r1.crownsGained), inRange(r1.crownsGained, 20, 28));
    const c60 = cpAt(r1, 60);
    add("забег 1: доля поездов, мин 50–60", "≥ 25%", c60 ? pct(c60.trainShare) : "—", c60 && c60.trainShare >= 0.25 ? "PASS" : "FAIL");
    const r2 = active[1];
    if (r2) {
      add("забег 2: Вокзал", "45–60 мин", fmtMin(r2.zoneOpenAt.terminal), inRange(minOf(r2.zoneOpenAt.terminal), 45, 60));
      add(
        "забег 2: венцы при коронации",
        "120–220",
        r2.coronationAt !== null ? String(r2.crownsGained) : `нет коронации (${r2.crownsGained})`,
        r2.coronationAt !== null ? inRange(r2.crownsGained, 120, 220) : "FAIL",
      );
      add("забег 2: steamEff < 1 хоть раз", "да", r2.minSteamEff < 1 ? `да (мин ${r2.minSteamEff.toFixed(2)})` : "нет", r2.minSteamEff < 1 ? "PASS" : "FAIL");
      const press = r2.buildingLevels.steam_press ?? 0;
      const clock = r2.buildingLevels.clocktower ?? 0;
      add("забег 2: прессы / часы", "< 19 / < 9", `${press} / ${clock}`, press < 19 && clock < 9 ? "PASS" : "FAIL");
    }
    for (const r of active.slice(1)) {
      const gaps = expressGaps(r);
      if (!gaps.length) continue;
      const short = gaps.filter(([, , sec]) => sec < 45);
      const long = gaps.filter(([a, , sec]) => sec > 360 && a !== 9);
      const show = (list: [number, number, number][]) => list.map(([a, b, sec]) => `${a}→${b} ${fmtMin(sec)}`).join(", ");
      add(`забег ${r.run}: этапы экспресса не чаще 45 с`, "≥ 0:45", short.length ? show(short) : `мин ${fmtMin(Math.min(...gaps.map((x) => x[2])))}`, short.length ? "FAIL" : "PASS");
      add(`забег ${r.run}: этапы не реже 6 мин (кроме 9→10)`, "≤ 6:00", long.length ? show(long) : "ок", long.length ? "FAIL" : "PASS");
    }
    const r3 = active[2];
    if (r3) {
      const t = r3.expressStageAt.slice(5, 10);
      const distinct = t.length === 5 && new Set(t.map((x) => Math.floor(x))).size === 5;
      add("забег 3: этапы 6–10 в разное время", "да", t.map(fmtMin).join(" ") || "—", distinct ? "PASS" : "FAIL");
      add("забег 3: коронация", "≥ 30 мин", fmtMin(r3.coronationAt), r3.coronationAt !== null && r3.coronationAt >= 1800 ? "PASS" : "FAIL");
    }
  }
  if (passive) {
    const r = passive[0];
    add("пассивный: Вокзал", "≤ 165 мин", fmtMin(r.zoneOpenAt.terminal), r.zoneOpenAt.terminal !== undefined && r.zoneOpenAt.terminal <= 165 * 60 ? "PASS" : "FAIL");
    const byZone = Object.entries(r.housingStallByZone).map(([z, sec]) => `${ZONE_SHORT[z as ZoneId]} ${fmtMin(sec)}`).join(", ");
    add("пассивный: жильё полно, но мало для экспедиции", "≤ 3:00", `${fmtMin(r.maxHousingStall)} (в ${fmtMin(r.maxHousingStallAt)}; ${byZone || "нигде"})`, r.maxHousingStall <= 180 ? "PASS" : "FAIL");
    add("пассивный: выплаты разведчиков", "> 0", String(r.scouts), r.scouts > 0 ? "PASS" : "FAIL");
  }
  return out;
}

/** EN-6, EN-9, EN-11, EN-12 and the exact coronation window (EN-13), tallied with the v2 targets. */
function metaChecks(active: RunReport[], passive: RunReport[] | null): Check[] {
  const g = "v2";
  const out: Check[] = [];
  const add = (name: string, target: string, actual: string, verdict: Verdict) => out.push({ group: g, name, target, actual, verdict });
  // coronation total, exact window
  let total = 0;
  let crowned: number | null = null;
  for (const r of active) {
    if (r.coronationAt !== null) {
      crowned = total + r.coronationAt;
      break;
    }
    total += r.seconds;
  }
  add("коронация, всего (точно)", "2:30–3:30 ч", crowned === null ? "нет" : `${(crowned / 3600).toFixed(2)} ч`, crowned !== null && crowned >= 9000 && crowned <= 12600 ? "PASS" : "FAIL");
  // EN-6 variety over the whole active session (to the first coronation)
  const upto = crowned === null ? active : active.slice(0, active.findIndex((r) => r.coronationAt !== null) + 1);
  const variants = new Set(upto.flatMap((r) => Object.keys(r.variants)));
  add("варианты поездов (EN-6)", "≥ 4", [...variants].join(", ") || "—", variants.size >= 4 ? "PASS" : "FAIL");
  const cheese = upto.reduce((a, r) => a + r.cheeseCars, 0);
  add("сырный вагон (EN-6)", "≥ 1", String(cheese), cheese >= 1 ? "PASS" : "FAIL");
  const royal = upto.reduce((a, r) => a + (r.scenes.royal_express ?? 0), 0);
  add("королевских экспрессов до коронации (EN-6)", "≥ 2", String(royal), royal >= 2 ? "PASS" : "FAIL");
  // EN-9 spending
  const r2 = active[1];
  if (r2 && r2.migrated) {
    const share = r2.crownsGained > 0 ? r2.crownsSpent / r2.crownsGained : 0;
    add("после забега 2 потрачено 👑 (EN-9)", "≥ 50% заработанных", `${r2.crownsSpent} из ${r2.crownsGained} (${pct(share)})`, share >= 0.5 ? "PASS" : "FAIL");
  }
  const last = active[active.length - 1];
  if (active.length >= 3) {
    const m = last.final.meta;
    const left = EDICT_ORDER.filter((e) => EDICTS[e].ranks && edictRank(last.final, e) < 3).length;
    add("ранги III ещё не куплены после забега 3 (EN-9)", "≥ 3", `${left} (👑 ${m.crowns})`, left >= 3 ? "PASS" : "FAIL");
    // EN-11 medals
    const r3 = active[2];
    add("забег 3: новых медалей (EN-11)", "≥ 4", String(r3.medals.length), r3.medals.length >= 4 ? "PASS" : "FAIL");
  }
  const r1 = active[0];
  const nonSecret = ACHIEVEMENT_ORDER.filter((id) => !ACHIEVEMENTS[id].secret);
  const r1Medals = nonSecret.filter((id) => r1.medals.includes(id)).length;
  add("забег 1: медали из несекретных (EN-11)", "≤ 40%", `${r1Medals}/${nonSecret.length}`, r1Medals <= 0.4 * nonSecret.length ? "PASS" : "FAIL");
  const FEATS = ["clean_car_10", "no_spark", "gold_streak", "ties_survivor", "dry_paws", "cat_nightmare", "royal_retinue", "full_consist"];
  const feats = active.flatMap((r) => r.medals.filter((id) => FEATS.includes(id)).map((id) => `${r.run}:${id}`));
  const runsWithFeats = new Set(feats.map((x) => x.split(":")[0])).size;
  add("подвиги за сессию (EN-11)", "≥ 4, не разом", feats.join(", ") || "—", feats.length >= 4 && runsWithFeats >= 2 ? "PASS" : "FAIL");
  // EN-12
  add("поручения за 20 мин после коронации (EN-12)", "≥ 3", String(last.commissionsDone), last.coronationAt !== null && last.commissionsDone >= 3 ? "PASS" : "FAIL");
  void passive;
  return out;
}

/* ---------------------------------------------------------------- summary */

function summarize(active: RunReport[] | null, passive: RunReport[] | null, checks: Check[], v2: Check[]) {
  const m = (x: number | null | undefined) => (x === null || x === undefined ? null : Math.round((x / 60) * 10) / 10);
  const run = (r: RunReport) => ({
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
    scouts: r.scouts,
    steamEffMin: +r.minSteamEff.toFixed(3),
  });
  return {
    active: active?.map(run) ?? null,
    passive: passive?.map(run) ?? null,
    fails: checks.filter((c) => c.verdict === "FAIL").map((c) => c.group.slice(-9) + ":" + c.name),
    v2fails: v2.filter((c) => c.verdict === "FAIL").map((c) => c.name),
  };
}

/* ---------------------------------------------------------------- main */

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.preTuning) applyOverrides(PRE_TUNING_OVERRIDES);
  applyOverrides(process.env.SIM_OVERRIDES); // dev: JSON patch of the data tables for tuning experiments
  const log = (s = "") => {
    if (!args.quiet) console.log(s);
  };
  const t0 = Date.now();
  const checks: Check[] = [];
  const info: Check[] = [];
  let active: RunReport[] | null = null;
  let passive: RunReport[] | null = null;
  const cpMinutes = [5, 11, 16, 26, 42, 50, 55, 62, 80];

  if (args.bot !== "passive") {
    active = simulate({
      seed: args.seed,
      bot: "active",
      runs: args.runs,
      minutes: args.minutes ?? 150,
      checkpointMinutes: cpMinutes,
      offlineAtMinute: 60,
      postCoronationMinutes: 20,
    });
    for (const r of active) {
      log(`\n=== Активный бот, забег ${r.run} (${fmtMin(r.seconds)}${r.migrated ? ", переселение" : ""}${r.coronationAt ? `, коронация ${fmtMin(r.coronationAt)}` : ""}) ===`);
      if (r.edictsBought.length) log(`Указы перед забегом: ${r.edictsBought.join(", ")}`);
      log(table(CP_HEAD, cpRows(r.checkpoints)));
      log(
        `Зоны: ${ZONE_ORDER.map((z) => `${ZONE_SHORT[z]} ${fmtMin(r.zoneOpenAt[z])}`).join("  ")} | капсула ${fmtMin(r.firstCapsuleAt)} | поезд ${fmtMin(r.firstTrainAt)} | переселение доступно ${fmtMin(r.migrateReadyAt)} | E 1M ${fmtMin(r.eRun1MAt)} | этапы экспресса ${r.expressStageAt.map(fmtMin).join(" ") || "—"} | 👑 +${r.crownsGained}`,
      );
      log(`Постройки: ${Object.entries(r.buildingLevels).map(([k, v]) => `${k} ${v}`).join(", ")}`);
      log(`Улучшений: ${r.upgradesBought}; сцены: ${Object.entries(r.scenes).map(([k, v]) => `${k} ${v}`).join(", ")}`);
      log(
        `Варианты поездов: ${Object.entries(r.variants).map(([k, v]) => `${k} ${v}`).join(", ") || "—"} | сырных вагонов ${r.cheeseCars} | королевских экспрессов ${r.scenes.royal_express ?? 0} | медалей +${r.medals.length} | поручений ${r.commissionsDone} | 👑 за забег +${r.crownsGained}, потрачено после ${r.crownsSpent}`,
      );
      if (r.commissionLog.length) log(`Поручения: ${r.commissionLog.join("; ")}`);
      log(`Медали: ${r.medals.join(", ")}`);
    }
    checks.push(...activeChecks(active[0]));
    if (active[1]) checks.push(...laterRunChecks(active[1]));
    // run 3 is reached since v2 (the sim migrates after the run-2 coronation); its GDD 14.2 timings were never
    // validated and assume fewer edicts, so they are shown for reference only and stay out of the tally
    for (const r of active.slice(2)) info.push(...laterRunChecks(r).map((c) => ({ ...c, actual: `${c.actual} (${c.verdict === "FAIL" ? "вне окна" : "в окне"})`, verdict: "INFO" as const })));
  }
  if (args.bot !== "active") {
    passive = simulate({ seed: args.seed + 1, bot: "passive", runs: 1, minutes: args.minutes ?? 170, checkpointMinutes: [5, 26, 42, 60, 80, 100, 120, 140, 160] });
    const r = passive[0];
    log(`\n=== Пассивный бот (${fmtMin(r.seconds)}) ===`);
    log(table(CP_HEAD, cpRows(r.checkpoints)));
    log(`Зоны: ${ZONE_ORDER.map((z) => `${ZONE_SHORT[z]} ${fmtMin(r.zoneOpenAt[z])}`).join("  ")} | E 1M ${fmtMin(r.eRun1MAt)} | разведчики ${r.scouts} | жильё-тупик ${fmtMin(r.maxHousingStall)}`);
    checks.push(...passiveChecks(r));
  }
  checks.push(...acceptance(active, passive));

  if (active) {
    let total = 0;
    let crowned: number | null = null;
    for (const r of active) {
      if (r.coronationAt !== null) {
        crowned = total + r.coronationAt;
        break;
      }
      total += r.seconds;
    }
    checks.push({
      group: "Итог",
      name: "коронация, всего",
      target: "2:30–3:30 ч",
      actual: crowned === null ? `нет (сыграно ${fmtMin(total)})` : `${(crowned / 3600).toFixed(2)} ч (${fmtMin(crowned)})`,
      verdict: args.runs < 2 ? "INFO" : crowned !== null && crowned >= 2.5 * 3600 * (1 - TOL) && crowned <= 3.5 * 3600 * (1 + TOL) ? "PASS" : "FAIL",
    });
  }

  const v2 = v2Checks(active, passive);
  if (active) v2.push(...metaChecks(active, passive));
  if (args.summary) console.log("SUMMARY " + JSON.stringify(summarize(active, passive, checks, v2)));
  console.log("\n=== Проверки ===");
  console.log(table(["группа", "проверка", "цель", "факт", "итог"], checks.map((c) => [c.group, c.name, c.target, c.actual, c.verdict])));
  const fails = checks.filter((c) => c.verdict === "FAIL").length;
  console.log("\n=== Цели v2 (точные окна, EN-1..EN-4; сводная проверка — EN-13) ===");
  console.log(table(["группа", "проверка", "цель", "факт", "итог"], v2.map((c) => [c.group, c.name, c.target, c.actual, c.verdict])));
  const v2fails = v2.filter((c) => c.verdict === "FAIL").length;
  if (info.length) {
    console.log("\n=== Справочно (не входит в итог) ===");
    console.log(table(["группа", "проверка", "цель", "факт", "итог"], info.map((c) => [c.group, c.name, c.target, c.actual, c.verdict])));
  }
  console.log(`\n${checks.length - fails}/${checks.length} в допуске (±25%), ${fails} FAIL; цели v2: ${v2.length - v2fails}/${v2.length}. Время прогона ${((Date.now() - t0) / 1000).toFixed(1)} с.`);
  if (args.strict && fails > 0) process.exit(1);
}

main();
