import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COMMISSIONS } from "../data/commissions";
import { CURIOS, CURIO_CHANCE, CURIO_LIFE_ADD, CURIO_SETS, curioCandidates, curioMult, curioPerks, rollCurio } from "../data/curios";
import { DISTRICTS, LEGACY_DISTRICT_SEQ, districtAt, districtFree, districtInfo, districtInfoOf, districtOptions } from "../data/districts";
import { HEADLINES } from "../data/headlines";
import { ACHIEVEMENTS, CORONATION_LINES, EDICTS, EXPRESS_STAGES, EXPRESS_STAGE_LINES, expressStageLine } from "../data/meta";
import { BUILDINGS } from "../data/buildings";
import { CURIO_IDS, DISTRICT_IDS, type CatchResult, type CurioId, type DistrictId, type EngineCtx, type Fx, type GameState, type Scene } from "../types";
import { contributeExpress, migrate } from "./actions";
import { catchCurio } from "./curios";
import { derive } from "./derive";
import { buildTrain, clickShiny, sceneAction } from "./events";
import { charterMult } from "./metaMath";
import { coronationLine, expressLineSet, weeksText } from "./narrative";
import { progressStat } from "./progress";
import { RANKED } from "./ranks";
import { deserialize, migrate as migrateSave, serialize } from "./save";
import { createInitialState, defaultMeta } from "./state";
import { fillerPool, LATE_FILLER_MIGRATIONS, step, TICK } from "./step";
import { metroState, triggerEvent } from "./testkit";

/** A colony with every zone open (Terminal, express depot): metro trains and the Royal Express both run. */
function allZones(seed = 7): GameState {
  const s = metroState(seed, { quiet: true });
  s.zones.terminal = true;
  s.buildings.express_depot = 1;
  return s;
}

/** Does the curio item sit where its source says (car kind, variant, the Cheddar car)? */
function fromSource(sc: Scene, id: CurioId, car: number): boolean {
  const src = CURIOS[id].source;
  const c = sc.cars[car];
  if (src.scene !== sc.id) return !!src.also?.includes(sc.id);
  if (src.special) return c.special === src.special;
  if (src.variant && (sc.variant ?? "normal") !== src.variant) return false;
  return src.car ? c.kind === src.car : c.kind !== "engine";
}

/** Build a train until one carries a curio (hash of the scene seq decides). */
function trainWithCurio(s: GameState, id: "metro_train" | "royal_express" = "metro_train"): Scene {
  for (let i = 0; i < 2000; i++) {
    const sc = buildTrain(s, derive(s), id);
    if (sc.items.some((it) => it.curio)) return sc;
  }
  throw new Error("no curio in 2000 trains");
}

function catchAll(s: GameState, sc: Scene, skipCurio: boolean): Scene {
  const ctx: EngineCtx = { fx: [] };
  s.scene = sc;
  const d = derive(s);
  sceneAction(s, d, { a: "ready" }, ctx);
  const ids = sc.items.filter((it) => !it.spark && !(skipCurio && it.curio)).map((it) => it.id);
  const result: CatchResult = { caught: ids.map((id) => ({ id, combo: 5, lantern: false })), netted: [], sparksHit: 0, hook: "none", maxCombo: 5 };
  sceneAction(s, d, { a: "catch", result }, ctx);
  return sc;
}

describe("ENG-10 «Кунсткамера Короля»: drops", () => {
  it("300 metro trains with every zone open drop ≥ 5 curios, never an owned one, each from its source car", () => {
    const s = allZones();
    const owned: CurioId[] = ["lady_fan", "card_case", "first_class_ticket", "hip_flask"];
    s.meta.curios = [...owned];
    const rngBefore = s.rng;
    let n = 0;
    const seen = new Set<CurioId>();
    for (let i = 0; i < 300; i++) {
      const sc = buildTrain(s, derive(s), "metro_train");
      const curios = sc.items.filter((it) => it.curio);
      expect(curios.length).toBeLessThanOrEqual(1);
      for (const it of curios) {
        const id = it.curio!;
        n++;
        seen.add(id);
        expect(owned).not.toContain(id);
        expect(CURIOS[id].source.scene).toBe("metro_train");
        expect(fromSource(sc, id, it.car), `${id} in ${sc.cars[it.car].kind}`).toBe(true);
        expect(sc.cars[it.car].itemIds).toContain(it.id);
        // rating-neutral, and it lives longer than the rest
        expect(it.value).toBe(0);
        expect(it.weight).toBe(0);
        expect(it.lifeAdd).toBe(CURIO_LIFE_ADD);
      }
    }
    expect(n).toBeGreaterThanOrEqual(5);
    expect(seen.size).toBeGreaterThan(1);
    expect(s.rng).not.toBe(rngBefore);
  });

  it("the roll is a hash of the scene seq: the rest of the build and the RNG stream are the same with or without it", () => {
    const a = allZones(11);
    const b = allZones(11);
    const keep = { ...CURIO_CHANCE };
    let dropped = 0;
    try {
      for (let i = 0; i < 120; i++) {
        const sa = buildTrain(a, derive(a), "metro_train");
        CURIO_CHANCE.metro_train = 0;
        const sb = buildTrain(b, derive(b), "metro_train");
        Object.assign(CURIO_CHANCE, keep);
        if (sa.items.some((it) => it.curio)) dropped++;
        expect(sa.items.filter((it) => !it.curio)).toEqual(sb.items);
        expect(sa.cars.map((c) => c.kind)).toEqual(sb.cars.map((c) => c.kind));
        expect(a.rng).toBe(b.rng);
      }
    } finally {
      Object.assign(CURIO_CHANCE, keep);
    }
    expect(dropped).toBeGreaterThan(0);
  });

  it("the Royal Express drops its royal-car curios at 12%; capsules, carriages and the downpour have theirs", () => {
    const s = allZones(3);
    const sc = trainWithCurio(s, "royal_express");
    const it = sc.items.find((x) => x.curio)!;
    expect(["sapphire_cufflink", "signet_ring", "tower_key"]).toContain(it.curio);
    expect(sc.cars[it.car].kind).toBe("royal");
    expect(CURIO_CHANCE).toMatchObject({ metro_train: 0.04, royal_express: 0.12, carriage: 0.02, capsule: 0.02, downpour: 0.04 });
    const fresh = createInitialState(1, 0);
    const ids = (scene: Scene["id"], kind: Scene["cars"][number]["kind"]) => curioCandidates(fresh, { id: scene, seq: 1, cars: [{ kind }] }).map((c) => c.id);
    expect(ids("capsule", "capsule")).toEqual(["teapot_lid", "watchmaker_loupe"]);
    expect(ids("carriage", "carriage")).toEqual(["lace_glove", "monocle"]);
    expect(ids("downpour", "flotsam")).toEqual(["lace_glove", "monocle"]);
    // first-class and baggage curios double a metro train's chance
    const rich = { id: "metro_train" as const, seq: 1, cars: [{ kind: "engine" as const }, { kind: "first" as const }] };
    const plain = { id: "metro_train" as const, seq: 1, cars: [{ kind: "engine" as const }, { kind: "third" as const }] };
    expect(curioCandidates(fresh, rich).every((c) => c.w === 2)).toBe(true);
    expect(curioCandidates(fresh, plain).every((c) => c.w === 1)).toBe(true);
    let hitsRich = 0;
    let hitsPlain = 0;
    for (let seq = 0; seq < 20000; seq++) {
      if (rollCurio(fresh, { ...rich, seq })) hitsRich++;
      if (rollCurio(fresh, { ...plain, seq })) hitsPlain++;
    }
    expect(hitsRich / 20000).toBeCloseTo(0.08, 1);
    expect(hitsPlain / 20000).toBeCloseTo(0.04, 1);
  });

  it("a curio item changes neither HaulSummary.share nor the caught count; catching it adds it for good", () => {
    const a = allZones(5);
    const sa = trainWithCurio(a);
    const b = structuredClone(a);
    const sb = structuredClone(sa);
    const id = sa.items.find((it) => it.curio)!.curio!;
    catchAll(a, sa, false);
    catchAll(b, sb, true);
    expect(sa.haul!.share).toBe(sb.haul!.share);
    expect(sa.haul!.share).toBe(1);
    expect(sa.haul!.caughtCount).toBe(sb.haul!.caughtCount);
    expect(sa.haul!.totalCount).toBe(sb.haul!.totalCount);
    expect(sa.haul!.gained).toEqual(sb.haul!.gained);
    expect(sa.haul!.curio).toBe(id);
    expect(sb.haul!.curio).toBeUndefined();
    expect(a.meta.curios).toContain(id);
    expect(b.meta.curios).not.toContain(id);
    // a missed curio is no pile
    expect(sb.piles.some((p) => Object.keys(p).length > 0)).toBe(false);
    // the catch phase lasts long enough for the curio's longer life
    const c = allZones(5);
    const sc = trainWithCurio(c);
    c.scene = sc;
    sceneAction(c, derive(c), { a: "ready" }, { fx: [] });
    const cur = sc.items.find((it) => it.curio)!;
    expect(sc.phaseEnds - sc.phaseStart).toBeGreaterThanOrEqual(cur.t + sc.itemLife + CURIO_LIFE_ADD);
  });

  it("catchCurio: Fx, the 👤/🐀 news pair, the medals and the set toast", () => {
    const s = createInitialState(1, 0);
    const ctx: EngineCtx = { fx: [] };
    expect(catchCurio(s, "monocle", ctx)).toBe(true);
    expect(catchCurio(s, "monocle", ctx)).toBe(false);
    expect(ctx.fx).toContainEqual({ k: "curio", id: "monocle" });
    const texts = s.news.map((n) => n.text);
    expect(texts).toContain(`👤 ${CURIOS.monocle.human}`);
    expect(texts).toContain("🐀 В Кунсткамере пополнение: «Монокль»");
    expect(s.meta.achievements.first_curio).toBeDefined();
    for (const id of CURIO_SETS.wiggins.items) catchCurio(s, id, ctx);
    expect(ctx.fx.some((f) => f.k === "toast" && f.text.startsWith("Набор «Мистер Уиггинс» собран!"))).toBe(true);
    for (const id of CURIO_IDS) catchCurio(s, id, ctx);
    expect(s.meta.curios).toHaveLength(24);
    expect(s.meta.achievements.curio_full).toBeDefined();
    expect(progressStat(s, "curios")).toBe(24);
    // the two «Город» trophies are still written for v2 UIs
    expect(s.meta.trophies).toEqual(expect.arrayContaining(["cat_fur", "broken_pipe"]));
  });

  it("a caught curio survives migrate() and a save round-trip; unknown ids are dropped on load", () => {
    const s = metroState();
    s.eRun = 5e6;
    catchCurio(s, "tower_key", { fx: [] });
    const next = migrate(s, 0, { fx: [] })!;
    expect(next.meta.curios).toEqual(["tower_key"]);
    const back = deserialize(serialize(next)) as GameState;
    expect(back.meta.curios).toEqual(["tower_key"]);
    const raw = JSON.parse(serialize(next));
    raw.meta.curios = ["tower_key", "golden_goose", "tower_key", 7];
    expect(migrateSave(raw).meta.curios).toEqual(["tower_key"]);
  });

  it("the cat drops the tuft on the first win, the bell later (always after a rout); the Ratcatcher his pipe", () => {
    const s = metroState(21, { quiet: true });
    const ctx: EngineCtx = { fx: [] };
    const win = (perfect = 0) => {
      triggerEvent(s, "cat");
      for (let i = 0; i < 5 && s.scene?.id !== "cat"; i++) step(s, TICK, { active: true }, ctx);
      expect(s.scene?.id).toBe("cat");
      const d = derive(s);
      sceneAction(s, d, { a: "choice", option: "fight" }, ctx);
      sceneAction(s, d, { a: "taps", cleared: 1, perfect }, ctx);
      s.timers.lastSceneEnd = -999;
    };
    win();
    expect(s.meta.curios).toEqual(["cat_fur_tuft"]);
    expect(s.meta.trophies).toContain("cat_fur");
    win(3);
    expect(s.meta.curios).toEqual(["cat_fur_tuft", "murzifer_bell"]);
    expect(ctx.fx.filter((f): f is Extract<Fx, { k: "curio" }> => f.k === "curio").map((f) => f.id)).toEqual(["cat_fur_tuft", "murzifer_bell"]);
    triggerEvent(s, "ratcatcher");
    for (let i = 0; i < 5 && s.scene?.id !== "ratcatcher"; i++) step(s, TICK, { active: true }, ctx);
    expect(s.scene?.id).toBe("ratcatcher");
    const d = derive(s);
    sceneAction(s, d, { a: "choice", option: "fight" }, ctx);
    sceneAction(s, d, { a: "taps", cleared: s.scene!.taps!.count }, ctx);
    expect(s.meta.curios).toContain("broken_pipe");
    expect(s.meta.trophies).toContain("broken_pipe");
  });

  it("the grate rain after the Metro carries the carriage curio as a shiny: a click adds it, nothing else", () => {
    const s = metroState(4, { quiet: true });
    s.meta.curios = ["lace_glove"];
    let sh: GameState["shinies"][number] | undefined;
    for (let i = 0; i < 3000 && !sh; i++) {
      s.shinies = [];
      s.timers.carriage = s.time;
      step(s, TICK, { active: true }, { fx: [] });
      sh = s.shinies.find((x) => x.curio);
    }
    expect(sh?.curio).toBe("monocle");
    expect(sh?.amt).toBe(0);
    const before = { ...s.res };
    clickShiny(s, derive(s), sh!.id, { fx: [] });
    expect(s.meta.curios).toContain("monocle");
    expect(s.res.trinkets).toBe(before.trinkets);
  });
});

describe("ENG-10 «Кунсткамера Короля»: perks", () => {
  it("+0.5% to everything per exhibit; each full set's perk lands on its hook", () => {
    const s = metroState(9);
    const d0 = derive(s);
    expect(d0.globalParts.find((p) => p.label === "Кунсткамера")).toBeUndefined();
    s.meta.curios = [...CURIO_SETS.pemberley.items, ...CURIO_SETS.wiggins.items];
    const d1 = derive(s);
    expect(d1.globalParts.find((p) => p.label === "Кунсткамера")?.mult).toBeCloseTo(1.04, 12);
    expect(curioMult(s.meta)).toBeCloseTo(1.04, 12);
    expect(d1.purseEffect / d0.purseEffect).toBeCloseTo(1.25, 12);
    expect(d1.dropMult / d0.dropMult).toBeCloseTo(1.25, 12);
    expect(d1.sparkMult).toBe(1);
    s.meta.curios = [...CURIO_IDS];
    const d2 = derive(s);
    expect(d2.sparkMult).toBe(0.8);
    expect(d2.royalExtraItems).toBe(2);
    expect(d2.rumbleMetro - d0.rumbleMetro).toBe(3);
    expect(curioPerks(s.meta)).toEqual({ purseEffect: 1.25, findMult: 1.25, royalItems: 2, sparkMult: 0.8, rumbleAdd: 3, charterMult: 1.06 });
    // charters ×1.06 with «Город» (only when there are any)
    expect(charterMult({ charters: 3, meta: s.meta }) / charterMult({ charters: 3 })).toBeCloseTo(1.06, 12);
    expect(charterMult({ charters: 0, meta: s.meta })).toBe(1);
  });

  it("Лорд Эшби: the royal car carries 2 more items; Полковник Хэтчетт: fewer sparks", () => {
    const a = allZones(13);
    const b = allZones(13);
    b.meta.curios = [...CURIO_SETS.ashby.items, ...CURIO_SETS.hatchett.items];
    const ea = buildTrain(a, derive(a), "royal_express");
    const eb = buildTrain(b, derive(b), "royal_express");
    const royal = (sc: Scene) => sc.cars.find((c) => c.kind === "royal")!.itemIds.filter((id) => !sc.items[id].spark && !sc.items[id].curio).length;
    expect(royal(eb) - royal(ea)).toBe(2);
    let sa = 0;
    let sb = 0;
    for (let i = 0; i < 40; i++) {
      sa += buildTrain(a, derive(a), "metro_train").items.filter((it) => it.spark).length;
      sb += buildTrain(b, derive(b), "metro_train").items.filter((it) => it.spark).length;
    }
    expect(sb).toBeLessThan(sa);
  });
});

/* ================================================================ ENG-11 */

describe("ENG-11 London on a map", () => {
  it("migrate(s, 0, ctx, 'city') sets districtId and the next run's derive applies Сити's mods", () => {
    const s = metroState();
    s.eRun = 5e6;
    const next = migrate(s, 0, { fx: [] }, "city")!;
    expect(next.meta.districtId).toBe("city");
    const d = derive(next);
    expect(d.districtRes.coins).toBe(1.5);
    expect(d.purseFreq).toBe(1.5);
    expect(d.suspicionMult).toBe(DISTRICTS.city.trait.mods.suspicionMult);
    expect(d.suspicionMult).toBeGreaterThan(1);
    expect(districtInfo(next.meta).loc).toBe("в Сити");
  });

  it("the options are free neighbours of the current district (the legacy next one first); none repeats before all 12", () => {
    for (const pickLast of [false, true]) {
      const meta = defaultMeta();
      for (let i = 0; i < 11; i++) {
        const o = districtOptions(meta);
        const here = districtInfo(meta).id;
        const freeNear = DISTRICTS[here].neighbors.filter((id) => districtFree(meta, id));
        expect(o.length).toBe(Math.min(2, 11 - i));
        expect(new Set(o.map((x) => x.id)).size).toBe(o.length);
        for (const x of o) expect(meta.visited).not.toContain(x.id);
        if (freeNear.length >= 2) for (const x of o) expect(freeNear).toContain(x.id);
        else for (const id of freeNear) expect(o.map((x) => x.id)).toContain(id);
        if (freeNear.includes(LEGACY_DISTRICT_SEQ[i + 1])) expect(o[0].id).toBe(LEGACY_DISTRICT_SEQ[i + 1]);
        meta.visited.push(o[pickLast ? o.length - 1 : 0].id);
        meta.district = meta.visited.length - 1;
        meta.migrations++;
      }
      expect(new Set(meta.visited).size).toBe(12);
      const lap2 = districtOptions(meta);
      expect(lap2[0].lap).toBe(2);
      expect(lap2[0].name).toMatch(/ II$/);
      expect(lap2[0].loc).toMatch(/ II$/);
      expect(lap2.map((x) => x.id)).not.toContain(districtInfo(meta).id);
    }
    // the default route keeps the v2 districts for the first three runs
    const m = defaultMeta();
    expect(districtOptions(m)[0].id).toBe("southwark");
    m.visited.push("southwark");
    m.district = 1;
    m.migrations = 1;
    expect(districtOptions(m)[0].id).toBe("lambeth");
  });

  it("traits grow ×1.25 per lap only up to the third lap: every multiplier stays positive on lap 84 (ENG-13)", () => {
    const amp = (id: DistrictId, lap: number) => districtInfoOf(id, lap).trait.mods;
    expect(amp("westminster", 2).expressIntervalMult).toBeCloseTo(0.5);
    expect(amp("westminster", 3).expressIntervalMult).toBeCloseTo(0.375);
    for (const lap of [4, 6, 8, 84]) {
      for (const id of DISTRICT_IDS) expect(amp(id, lap)).toEqual(amp(id, 3));
      const big = amp("westminster", lap);
      expect(big.expressIntervalMult).toBeGreaterThan(0.3);
      expect(big.vigilanceFrom).toBeGreaterThan(10);
      for (const id of DISTRICT_IDS) for (const v of Object.values(amp(id, lap).res ?? {})) expect(v).toBeGreaterThan(0.5);
    }
    // a save clamped to the last run index (MAX_DISTRICT) reads the third lap's strength
    expect(districtAt({ visited: [] }, 999).trait.mods).toEqual(amp(districtAt({ visited: [] }, 999).id, 3));
  });

  it("a run's filler pool holds its own district's four lines and no other district's (index ≥ 6 too)", () => {
    const others = (id: DistrictId) => DISTRICT_IDS.filter((x) => x !== id).flatMap((x) => DISTRICTS[x].fillers);
    for (let i = 0; i < 14; i++) {
      const s = createInitialState(1, 0);
      s.meta.visited = [...LEGACY_DISTRICT_SEQ, ...LEGACY_DISTRICT_SEQ].slice(0, i + 1);
      s.meta.district = i;
      s.meta.migrations = i;
      const id = districtAt(s.meta, i).id;
      const pool = fillerPool(s);
      for (const line of DISTRICTS[id].fillers) expect(pool).toContain(line);
      for (const line of others(id)) expect(pool, `${i} ${id}`).not.toContain(line);
      if (i >= 6 && id !== "whitechapel") expect(pool.some((x) => x.includes("Уайтчепел"))).toBe(false);
    }
    for (const id of DISTRICT_IDS) expect(DISTRICTS[id].fillers.length, id).toBeGreaterThanOrEqual(4);
  });

  it("crowned and late fillers: 8 and 6; a crowned run at migration 4 has ≥ 30 lines to draw from", () => {
    expect(HEADLINES.filler_crowned).toHaveLength(8);
    expect(HEADLINES.filler_late).toHaveLength(6);
    const s = metroState();
    s.meta.coronations = 1;
    s.meta.migrations = LATE_FILLER_MIGRATIONS;
    s.meta.visited = LEGACY_DISTRICT_SEQ.slice(0, 5);
    s.meta.district = 4;
    const pool = fillerPool(s);
    expect(pool.length).toBeGreaterThanOrEqual(30);
    for (const line of HEADLINES.filler_late) expect(pool).toContain(line);
    s.meta.migrations = LATE_FILLER_MIGRATIONS - 1;
    expect(fillerPool(s)).not.toContain(HEADLINES.filler_late[0]);
    const late = HEADLINES.filler_late.join(" ");
    expect(late).toMatch(/Зловони/);
    expect(late).toMatch(/Базалджет/);
    expect(late).toMatch(/юбиле/);
  });

  it("a v2 save with district 6 (or 13) loads to a valid id", () => {
    for (const [district, id] of [
      [6, "city"],
      [13, "southwark"],
    ] as const) {
      const raw = JSON.parse(serialize(createInitialState(1, 0)));
      raw.schemaVersion = 2;
      raw.meta.district = district;
      delete raw.meta.visited;
      delete raw.meta.districtId;
      const m = migrateSave(raw);
      expect(m.meta.districtId).toBe(id);
      expect(DISTRICT_IDS).toContain(m.meta.districtId);
      expect(m.meta.visited).toHaveLength(district + 1);
      expect(() => derive(m)).not.toThrow();
    }
  });

  it("«Весь Лондон наш» counts the districts moved through on the map", () => {
    const s = createInitialState(1, 0);
    s.meta.visited = ["whitechapel", "city", "kings_cross", "bloomsbury", "covent_garden", "mayfair"];
    s.meta.district = 5;
    expect(progressStat(s, "district")).toBe(5);
    expect(ACHIEVEMENTS.all_london.progress).toEqual({ stat: "district", goal: 5 });
  });
});

describe("ENG-11 fresh words for repeat runs", () => {
  it("coronations 1–8 give 8 distinct lines; none says «за неделю» once the story is longer than a week", () => {
    expect(CORONATION_LINES).toHaveLength(10);
    const s = createInitialState(1, 0);
    const lines: string[] = [];
    for (let n = 1; n <= 8; n++) {
      s.meta.coronations = n;
      s.meta.migrations = n + 6;
      const l = coronationLine(s);
      lines.push(`${l.human} ${l.rat}`);
      expect(l.human + l.rat).not.toMatch(/\{/);
      expect(l.rat).not.toContain("за неделю");
    }
    expect(new Set(lines).size).toBe(8);
    s.meta.coronations = 2;
    s.meta.migrations = 2;
    expect(coronationLine(s).rat).toBe("Для крыс — вторая коронация за неделю.");
    s.meta.migrations = 7;
    expect(coronationLine(s).rat).toBe("Для крыс — вторая коронация за 2 недели.");
    expect(weeksText(34)).toBe("за 5 недель");
    expect(weeksText(140)).toBe("за 21 неделю");
    s.meta.coronations = 14;
    expect(coronationLine(s).rat + coronationLine(s).human).toMatch(/четырнадцат|Четырнадцат|^[^{]*$/);
    s.meta.coronations = 25;
    expect(() => coronationLine(s)).not.toThrow();
  });

  it("express stage lines: three per stage, different for the 1st, 2nd and 3rd express", () => {
    expect(EXPRESS_STAGE_LINES).toHaveLength(EXPRESS_STAGES.length);
    for (let stage = 1; stage <= EXPRESS_STAGES.length; stage++) {
      const l = [0, 1, 2].map((c) => expressStageLine(stage, c));
      expect(new Set(l.map((x) => x.human)).size, `stage ${stage}`).toBe(3);
      expect(new Set(l.map((x) => x.rat)).size, `stage ${stage}`).toBe(3);
      expect(expressStageLine(stage, 7)).toEqual(l[2]);
      expect(EXPRESS_STAGE_LINES[stage - 1]).toEqual(l[0]);
    }
    expect(expressStageLine(3, 1)).toEqual({ human: "Леди Пемберли (дом №12) снова без чайника", rat: "Котёл кипит. Старейшины уже не удивляются" });
    expect(BUILDINGS.boiler.flavor).toContain("Леди Пемберли (дом №12) снова без чайника");
  });

  it("the express stage news reads the line for this coronation count", () => {
    const s = metroState();
    s.upgrades.express_plan = true;
    s.meta.coronations = 1;
    s.express.stage = 2;
    s.res.rails = s.res.gears = s.res.brass = s.res.trinkets = s.res.blueprints = 1e12;
    expect(contributeExpress(s, null, { fx: [] })).toBe(true);
    expect(s.express.stage).toBe(3);
    expect(s.news[s.news.length - 1].text).toBe("Этап «Котёл из медного чайника»: Леди Пемберли (дом №12) снова без чайника");
    // the panel reads the same set: the coronation this run's express earned does not count for its own lines
    expect(expressLineSet(s)).toBe(1);
    s.express.stage = 9;
    expect(contributeExpress(s, null, { fx: [] })).toBe(true);
    expect(s.coronatedThisRun).toBe(true);
    expect(s.meta.coronations).toBe(2);
    expect(expressLineSet(s)).toBe(1);
    expect(s.news.some((n) => n.text === `Этап «${EXPRESS_STAGES[9]}»: ${expressStageLine(10, 1).human}`)).toBe(true);
    expect(expressLineSet({ meta: { ...s.meta, coronations: 2 }, coronatedThisRun: false })).toBe(2);
  });
});

describe("ENG-11 copy fixes", () => {
  it("COMMISSIONS and ACHIEVEMENTS names are pairwise distinct (lowercased, last 2 letters dropped)", () => {
    const names = [...Object.values(COMMISSIONS).map((c) => c.name), ...Object.values(ACHIEVEMENTS).map((a) => a.name)];
    const keys = names.map((n) => n.toLowerCase().replaceAll("ё", "е").slice(0, -2));
    const dup = keys.filter((k, i) => keys.indexOf(k) !== i);
    expect(dup).toEqual([]);
    expect(COMMISSIONS.royal_mail).toMatchObject({ name: "Почётный караул", icon: "🚆" });
    expect(COMMISSIONS.dry_paws2.name).toBe("Шлюзовая вахта");
    expect(COMMISSIONS.dry_paws2.desc).toContain("во время ливня");
  });

  it("the texts say what the engine does: royal litter's 🍞, the miser's treasury", () => {
    const texts = [EDICTS.royal_litter.effect, ...(EDICTS.royal_litter.ranks ?? []).map((r) => r.effect)];
    RANKED.royal_litter.crumbs.forEach((c, i) => {
      if (c > 0) expect(texts[i].replace(/\s/g, "")).toContain(`${c}🍞`);
    });
    expect(ACHIEVEMENTS.miser.desc).toBe("Переселиться, храня в казне 200 👑");
  });

  it("the chute is spelt «Жёлоб» everywhere in the game (no plain «е»)", () => {
    const word = ["Же", "лоб"].join("");
    const bad: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(f) && readFileSync(p, "utf8").includes(word)) bad.push(p);
      }
    };
    walk(join(__dirname, "..", ".."));
    expect(bad).toEqual([]);
  });
});
