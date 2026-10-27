/**
 * Golden save fixtures (v3 ENG-7): the sim Bot (active, seed 12345) plays the game and real saves, serialized exactly
 * as the game writes them (engine/save.ts serialize), go to src/game/engine/__fixtures__/saves/. save.fixtures.test.ts
 * loads every file there, plays it on and checks the invariants; smartAssign.test.ts and clone.test.ts use them as states
 * (engine/testkit.ts loadFixture).
 *
 *   npx tsx scripts/capture-fixtures.ts [--seed 12345] [--out <dir>] [--only <name,...>]
 *
 * Names start with the schema version that wrote them. Release rule (docs/ARCHITECTURE.md): a schema change ⇒ bump
 * SCHEMA_VERSION, add a MIGRATIONS step, re-run this script for the new version's saves and KEEP the older files:
 * they are the proof that old saves still load.
 *
 * - v3-run1-10min / -60min / -150min: run 1 that never migrates (667 rats and smart assignment by 150 min).
 * - v3-run1-metro-catch: a metro train mid-catch (the loader must settle the scene).
 * - v3-run1-crowned: two minutes after the coronation (commissions on offer).
 * - v3-run3-commission: run 3 with edict ranks, the railway seal and an active royal commission (the sim route leaves
 *   too few crowns for the seal after run 2, so the treasury gets RUN3_TOP_UP 👑 before the bot spends them).
 * - v2-run2-30min: run 2 with the v3-only fields stripped and schemaVersion 2, i.e. the shape a v2 build wrote
 *   (v3 only added fields and reshaped meta.district), so MIGRATIONS[2] runs on a real colony.
 * - v1-early (optional): 10 minutes played by the v1 engine of commit 18a0f85 in a temporary git worktree; skipped
 *   silently when this is not a git checkout or the commit is missing.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { migrate } from "../src/game/engine/actions";
import { edictRank } from "../src/game/engine/ranks";
import { serialize } from "../src/game/engine/save";
import { createInitialState } from "../src/game/engine/state";
import { step, TICK } from "../src/game/engine/step";
import { EDICT_IDS, type EngineCtx, type GameState } from "../src/game/types";
import { Bot } from "./sim-core";

const ROOT = resolve(__dirname, "..");
const DEFAULT_OUT = join(ROOT, "src", "game", "engine", "__fixtures__", "saves");
/** The wall clock the saves claim (lastSaved = this + play seconds): any fixed epoch, so reruns write the same bytes. */
const EPOCH_MS = 1_760_000_000_000;
const V1_COMMIT = "18a0f85";
/** Crowns added before run 3 so the bot's plan reaches the seal and the ranks (it buys them only after all base edicts). */
const RUN3_TOP_UP = 300;

interface Args {
  seed: number;
  out: string;
  only: Set<string> | null;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { seed: 12345, out: DEFAULT_OUT, only: null };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i + 1];
    if (argv[i] === "--seed" && v) a.seed = Number(v);
    else if (argv[i] === "--out" && v) a.out = resolve(v);
    else if (argv[i] === "--only" && v) a.only = new Set(v.split(","));
    else continue;
    i++;
  }
  return a;
}

/** A colony the bot plays tick by tick, the way balance-sim's runOne drives it. */
class Driver {
  readonly ctx: EngineCtx = { fx: [] };
  constructor(
    public s: GameState,
    readonly bot: Bot,
  ) {
    bot.newRun();
  }

  tick(): void {
    const d = step(this.s, TICK, { active: this.bot.isActive(this.s) }, this.ctx);
    this.bot.tick(this.s, this.ctx, d);
    for (const fx of this.ctx.fx) if (fx.k === "scout" || fx.k === "zoneOpen") this.bot.noteScout(this.s);
    this.ctx.fx.length = 0;
  }

  /** Tick until `done` (true) or `limitSec` of run time (false). */
  until(done: (s: GameState) => boolean, limitSec: number): boolean {
    while (this.s.time < limitSec) {
      this.tick();
      if (done(this.s)) return true;
    }
    return false;
  }

  /** Great Migration to the default district; the bot then spends its crowns (plus `topUp`) as the sim does. */
  migrate(topUp = 0): void {
    const next = migrate(this.s, 0, this.ctx);
    if (!next) throw new Error(`capture: migration refused at ${this.s.time.toFixed(0)} s`);
    this.s = next;
    this.s.meta.crowns += topUp;
    this.bot.buyEdicts(this.s, this.ctx);
    this.bot.newRun();
    this.ctx.fx.length = 0;
  }
}

/** The save string the game would write for `s` now. */
function saveOf(s: GameState): string {
  return serialize({ ...s, lastSaved: EPOCH_MS + Math.round(s.meta.lifetime.playSeconds * 1000) });
}

const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Strip what v3 added (types.ts "v3" fields) and stamp schemaVersion 2: the save a v2 build wrote for this colony. */
function asV2(save: string): string {
  const raw = JSON.parse(save) as Record<string, unknown>;
  raw.schemaVersion = 2;
  for (const k of ["steamPriority", "carriagePass", "forceVariant"]) delete raw[k];
  if (isPlain(raw.settings)) for (const k of ["sfxVolume", "music"]) delete raw.settings[k];
  if (isPlain(raw.buffs)) delete raw.buffs.fogUntil;
  if (isPlain(raw.flags)) for (const k of ["focus_manual", "first_rumble"]) delete raw.flags[k];
  if (Array.isArray(raw.haulLog)) for (const h of raw.haulLog) if (isPlain(h)) for (const k of ["vigilance", "curio"]) delete h[k];
  if (Array.isArray(raw.shinies)) for (const x of raw.shinies) if (isPlain(x)) for (const k of ["kind", "amt"]) delete x[k];
  const meta = raw.meta;
  if (isPlain(meta)) {
    for (const k of ["districtId", "visited", "curios"]) delete meta[k];
    if (Array.isArray(meta.history)) for (const h of meta.history) if (isPlain(h)) delete h.districtId;
  }
  return JSON.stringify(raw);
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  mkdirSync(args.out, { recursive: true });
  const written: string[] = [];
  const put = (name: string, save: string) => {
    if (args.only && !args.only.has(name)) return;
    writeFileSync(join(args.out, `${name}.json`), save + "\n");
    written.push(`${name}.json (${(save.length / 1024).toFixed(1)} KB)`);
  };
  const want = (...names: string[]) => !args.only || names.some((n) => args.only!.has(n));
  const t0 = Date.now();

  // ---- run 1 that never migrates: 10, 60 min, a metro catch, the coronation, 150 min
  if (want("v3-run1-10min", "v3-run1-60min", "v3-run1-metro-catch", "v3-run1-crowned", "v3-run1-150min")) {
    const run = new Driver(createInitialState(args.seed, 0), new Bot("active", args.seed));
    const at = (min: number) => (s: GameState) => s.time >= min * 60;
    run.until(at(10), 11 * 60);
    put("v3-run1-10min", saveOf(run.s));
    run.until(at(60), 61 * 60);
    put("v3-run1-60min", saveOf(run.s));
    const midCatch = (s: GameState) => s.scene?.id === "metro_train" && s.scene.phase === "catch" && s.time >= s.scene.phaseStart + 1.5;
    if (!run.until(midCatch, 90 * 60)) throw new Error("capture: no metro catch by 90 min");
    put("v3-run1-metro-catch", saveOf(run.s));
    let crowned: string | null = null;
    run.until((s) => {
      if (!crowned && s.coronatedThisRun && s.coronatedAt >= 0 && s.time >= s.coronatedAt + 120 && !s.scene) crowned = saveOf(s);
      return s.time >= 150 * 60;
    }, 151 * 60);
    put("v3-run1-150min", saveOf(run.s));
    if (crowned) put("v3-run1-crowned", crowned);
    else console.warn("capture: run 1 was not crowned by 150 min, v3-run1-crowned not written");
  }

  // ---- the sim's three-run route: run 2 (as a v2 save), run 3 with ranks, a seal and a commission
  if (want("v2-run2-30min", "v3-run3-commission")) {
    const run = new Driver(createInitialState(args.seed, 0), new Bot("active", args.seed));
    if (!run.until((s) => run.bot.shouldMigrate(s, 1), 100 * 60)) throw new Error("capture: run 1 never ready to migrate");
    run.migrate();
    run.until((s) => s.time >= 30 * 60 && !s.scene, 40 * 60);
    put("v2-run2-30min", asV2(saveOf(run.s)));
    const leave2 = (s: GameState) => run.bot.shouldMigrate(s, 2) || (s.coronatedThisRun && s.time - s.coronatedAt > 30);
    if (!run.until(leave2, 150 * 60)) throw new Error("capture: run 2 never left");
    run.migrate(RUN3_TOP_UP);
    const ready = (s: GameState) =>
      s.coronatedThisRun && !!s.commissions?.active && !s.scene && s.meta.seal !== null && EDICT_IDS.some((e) => edictRank(s, e) >= 2);
    if (!run.until(ready, 120 * 60)) {
      const s = run.s;
      throw new Error(
        `capture: run 3 lacks crowned=${s.coronatedThisRun} commission=${!!s.commissions?.active} seal=${s.meta.seal} ranks=${EDICT_IDS.filter((e) => edictRank(s, e) >= 2).join(",")}`,
      );
    }
    put("v3-run3-commission", saveOf(run.s));
  }

  // ---- optional: a v1 save from the v1 engine itself
  const v1 = want("v1-early") ? captureV1() : null;
  if (v1) put("v1-early", v1);

  console.log(`fixtures → ${args.out} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  for (const w of written) console.log("  " + w);
}

/**
 * Play 10 minutes with the v1 engine of V1_COMMIT in a temporary worktree and return its save, or null when this is
 * not a git checkout, the commit is missing or the old engine does not run (skipped silently: the fixture is optional).
 */
function captureV1(): string | null {
  const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  try {
    git(ROOT, "cat-file", "-e", `${V1_COMMIT}^{commit}`);
  } catch {
    return null;
  }
  const dir = mkdtempSync(join(tmpdir(), "rr-v1-"));
  try {
    git(ROOT, "worktree", "add", "--detach", dir, V1_COMMIT);
    // the old engine drives itself (no bot: its API differs); every call is optional so a renamed export only weakens the save
    const driver = [
      `import * as A from "./src/game/engine/actions";`,
      `import { derive } from "./src/game/engine/derive";`,
      `import { serialize } from "./src/game/engine/save";`,
      `import { createInitialState } from "./src/game/engine/state";`,
      `import { step } from "./src/game/engine/step";`,
      `const s = createInitialState(${12345}, 0);`,
      `const ctx = { fx: [] as unknown[] };`,
      `const act = A as unknown as Record<string, (...x: unknown[]) => unknown>;`,
      `for (let i = 0; i < 6000; i++) {`,
      `  step(s, 0.1, { active: true }, ctx as never);`,
      `  if (i % 3 === 0) act.click?.(s, derive(s), ctx);`,
      `  if (i % 100 === 0) try { act.buyBuilding?.(s, derive(s), "nest", 1, ctx); } catch {}`,
      `  ctx.fx.length = 0;`,
      `}`,
      `process.stdout.write(serialize({ ...s, lastSaved: ${EPOCH_MS} + 600000 }));`,
    ].join("\n");
    writeFileSync(join(dir, "capture-v1.ts"), driver);
    const tsx = join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
    const out = execFileSync(process.execPath, [tsx, join(dir, "capture-v1.ts")], { cwd: dir, stdio: ["ignore", "pipe", "ignore"] }).toString();
    const raw = JSON.parse(out) as { schemaVersion?: unknown };
    return typeof raw.schemaVersion === "number" ? out : null;
  } catch {
    return null;
  } finally {
    try {
      git(ROOT, "worktree", "remove", "--force", dir);
    } catch {
      /* not registered: just delete the folder */
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

main();
