import { describe, expect, it } from "vitest";
import { legacyVisited } from "../data/districts";
import { RES_IDS, type EngineCtx, type GameState } from "../types";
import { edictRank } from "./ranks";
import { assignedRats } from "./derive";
import { simulateOffline } from "./offline";
import { deserialize, migrate, MIGRATIONS, serialize, type SaveMigration } from "./save";
import { SCHEMA_VERSION } from "./state";
import { step, TICK } from "./step";
import { assertPlain, fixtureNames, loadFixture, nonFinitePaths, rawFixture } from "./testkit";

/**
 * Golden saves (v3 ENG-7): real saves captured by scripts/capture-fixtures.ts. Every one must load, play on and
 * survive an absence with sane numbers. A schema change adds fixtures; it never deletes the older ones.
 */

/** The sanity every loaded or played state keeps. */
function invariants(s: GameState, when: string): void {
  expect(nonFinitePaths(s), `${when}: non-finite`).toEqual([]);
  for (const r of RES_IDS) expect(s.res[r], `${when}: res.${r}`).toBeGreaterThanOrEqual(0);
  expect(assignedRats(s), `${when}: Σjobs`).toBeLessThanOrEqual(s.rats);
  expect(assignedRats(s) + s.jobs.idle, `${when}: Σjobs + idle`).toBeLessThanOrEqual(s.rats + 1e-9);
  for (const [j, n] of Object.entries(s.jobs)) expect(n, `${when}: jobs.${j}`).toBeGreaterThanOrEqual(0);
  expect(s.rats, `${when}: rats`).toBeGreaterThanOrEqual(0);
  assertPlain(s);
}

describe("golden saves (v3 ENG-7)", () => {
  const names = fixtureNames();

  it("at least six fixtures, including a save of the previous schema", () => {
    expect(names.length).toBeGreaterThanOrEqual(6);
    expect(names.some((n) => n.startsWith(`v${SCHEMA_VERSION - 1}-`))).toBe(true);
  });

  for (const name of names) {
    it(`${name}: loads current and settled, plays 600 ticks and an 8 h absence`, () => {
      const s = loadFixture(name);
      expect(s.schemaVersion).toBe(SCHEMA_VERSION);
      expect(s.scene).toBeNull();
      invariants(s, "load");
      // the loaded save writes and reads back unchanged
      expect(deserialize(serialize(s))).toEqual(s);

      const ctx: EngineCtx = { fx: [] };
      for (let i = 0; i < 600; i++) {
        step(s, TICK, { active: true }, ctx);
        ctx.fx.length = 0;
      }
      invariants(s, "600 ticks");
      const rep = simulateOffline(s, 8 * 3600, ctx);
      expect(rep?.simulated).toBeGreaterThan(0);
      invariants(s, "8 h away");
    });
  }

  it("v2-run2-30min: the 2 → 3 step gives the district of the old route, the v3 defaults and keeps the colony", () => {
    const raw = JSON.parse(rawFixture("v2-run2-30min")) as Record<string, unknown> & { meta: Record<string, unknown> };
    expect(raw.schemaVersion).toBe(2);
    expect(raw.meta.districtId).toBeUndefined();
    const s = loadFixture("v2-run2-30min");
    expect(s.meta.district).toBe(1);
    expect(s.meta.visited).toEqual(legacyVisited(1));
    expect(s.meta.districtId).toBe(legacyVisited(1)[1]);
    expect(s.settings).toMatchObject({ sfxVolume: 1, music: 0.35 });
    expect(s.steamPriority).toBe("works");
    expect(s.flags.focus_manual).toBe(raw.focus !== "forager" ? true : undefined);
    expect(s.rats).toBe(raw.rats);
    expect(s.meta.crownsEver).toBe(raw.meta.crownsEver);
  });

  it("v3-run1-metro-catch: the train under way is settled by auto-collect on load", () => {
    const raw = JSON.parse(rawFixture("v3-run1-metro-catch")) as { scene: { id: string; phase: string } | null; haulLog: unknown[]; res: { coins: number } };
    expect(raw.scene).toMatchObject({ id: "metro_train", phase: "catch" });
    const s = loadFixture("v3-run1-metro-catch");
    expect(s.scene).toBeNull();
    expect(s.haulLog.length).toBe(Math.min(10, raw.haulLog.length + 1));
    expect(s.res.coins).toBeGreaterThanOrEqual(raw.res.coins);
  });

  it("v3-run3-commission and v3-run1-crowned keep their meta: ranks, the seal, the commissions", () => {
    const s = loadFixture("v3-run3-commission");
    expect(s.meta.migrations).toBe(2);
    expect(s.meta.seal).toBe("railway");
    expect(edictRank(s, "royal_litter")).toBeGreaterThanOrEqual(2);
    expect(s.commissions?.active?.id).toBeDefined();
    const c = loadFixture("v3-run1-crowned");
    expect(c.coronatedThisRun).toBe(true);
    expect(c.commissions?.offered.length).toBeGreaterThan(0);
  });
});

describe("MIGRATIONS registry (v3 ENG-7)", () => {
  it("has a step for every schema below the current one", () => {
    for (let v = 1; v < SCHEMA_VERSION; v++) expect(typeof MIGRATIONS[v], `MIGRATIONS[${v}]`).toBe("function");
  });

  it("runs the steps in order from the save's version", () => {
    const calls: number[] = [];
    const registry: Record<number, SaveMigration> = {};
    for (let v = 1; v < SCHEMA_VERSION; v++)
      registry[v] = (raw) => {
        calls.push(v);
        MIGRATIONS[v](raw);
      };
    const raw = JSON.parse(rawFixture("v2-run2-30min")) as Record<string, unknown>;
    raw.schemaVersion = 1;
    migrate(raw, registry);
    expect(calls).toEqual(Array.from({ length: SCHEMA_VERSION - 1 }, (_, i) => i + 1));
  });

  /** A dummy future step, test-only: v3 → v4 moves the run's charters into meta. */
  const moveCharters: SaveMigration = (raw) => {
    (raw.meta as Record<string, unknown>).charters = raw.charters;
    delete raw.charters;
  };

  it("a test-only registry step is applied before the defaults and its value survives (dummy: charters → meta.charters)", () => {
    const raw = JSON.parse(rawFixture("v3-run3-commission")) as Record<string, unknown>;
    raw.charters = 4;
    const registry: Record<number, SaveMigration> = { ...MIGRATIONS, [SCHEMA_VERSION]: moveCharters };
    const m = migrate(raw, registry, SCHEMA_VERSION + 1);
    expect((m.meta as unknown as { charters?: number }).charters).toBe(4);
    expect(m.charters).toBe(0); // the old place gets its default
    expect(m.schemaVersion).toBe(SCHEMA_VERSION + 1);
  });

  it("without the step the value stays where it was (so deleting the step fails the test above)", () => {
    const raw = JSON.parse(rawFixture("v3-run3-commission")) as Record<string, unknown>;
    raw.charters = 4;
    const m = migrate(raw, { ...MIGRATIONS }, SCHEMA_VERSION + 1);
    expect((m.meta as unknown as { charters?: number }).charters).toBeUndefined();
    expect(m.charters).toBe(4);
  });
});
