import { describe, expect, it } from "vitest";
import { DISTRICT_ORDER, DISTRICTS, type DistrictId } from "@/game/data/districts";
import { LABEL_SIDE, MAP_H, MAP_W, ROADS, THAMES_PATH, districtMarks, districtXY, labelBox, labelSide, labelTransform, routeLegs, routeOf } from "./londonGeo";

/** The names' widths in px at 10.5 px bold (measured in the browser at 375 px). */
const NAME_W: Record<DistrictId, number> = {
  whitechapel: 48,
  southwark: 42,
  lambeth: 34,
  bloomsbury: 50,
  mayfair: 37,
  westminster: 59,
  city: 22,
  covent_garden: 68,
  kings_cross: 57,
  docklands: 69,
  chelsea: 27,
  greenwich: 37,
};

type Box = { x: number; y: number; w: number; h: number };
const hit = (a: Box, b: Box, pad = 0) => a.x - pad < b.x + b.w && b.x - pad < a.x + a.w && a.y - pad < b.y + b.h && b.y - pad < a.y + a.h;

/** PAN-2: the London map on the migration masthead. */
describe("londonGeo", () => {
  it("every district sits inside the map and has a label side", () => {
    expect(DISTRICT_ORDER).toHaveLength(12);
    for (const id of DISTRICT_ORDER) {
      const { x, y } = districtXY(id);
      expect(x, id).toBeGreaterThan(2);
      expect(x, id).toBeLessThan(MAP_W - 2);
      expect(y, id).toBeGreaterThan(1);
      expect(y, id).toBeLessThan(MAP_H - 2);
      expect(LABEL_SIDE[id], id).toBeDefined();
      expect(labelTransform(LABEL_SIDE[id], false)).toMatch(/^translate\(/);
    }
  });

  it("names never touch each other, another dot or the crown pin, at 320 px to desktop, wherever the colony lives", () => {
    const bad: string[] = [];
    for (const W of [262, 317, 339, 399]) {
      const u = W / MAP_W;
      for (const here of DISTRICT_ORDER) {
        const box = Object.fromEntries(DISTRICT_ORDER.map((id) => [id, labelBox(id, labelSide(id, here), id === here, NAME_W[id], W)])) as Record<DistrictId, Box>;
        const c = districtXY(here);
        const pin = { x: (c.x - 2.4) * u, y: (c.y - 7.6) * u, w: 4.8 * u, h: 7.6 * u };
        for (const a of DISTRICT_ORDER) {
          const r = box[a];
          if (r.x < 0 || r.x + r.w > W || r.y < -3 || r.y + r.h > MAP_H * u) bad.push(`${W} ${here}: ${a} outside`);
          if (a !== here && hit(r, pin)) bad.push(`${W} ${here}: ${a} under the pin`);
          for (const b of DISTRICT_ORDER) {
            if (a === b) continue;
            const d = districtXY(b);
            if (hit(r, { x: (d.x - 1.7) * u, y: (d.y - 1.7) * u, w: 3.4 * u, h: 3.4 * u })) bad.push(`${W} ${here}: ${a} on the dot of ${b}`);
            if (a < b && hit(r, box[b], 1)) bad.push(`${W} ${here}: ${a} × ${b}`);
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("no two districts sit on top of each other", () => {
    for (const a of DISTRICT_ORDER)
      for (const b of DISTRICT_ORDER) {
        if (a >= b) continue;
        const p = districtXY(a);
        const q = districtXY(b);
        // 32 px tap targets at 343 px wide â‰ˆ 9.3 units
        expect(Math.hypot(p.x - q.x, p.y - q.y), `${a}â€“${b}`).toBeGreaterThan(9.3);
      }
  });

  it("roads list each neighbour pair once and both ends are districts", () => {
    const keys = ROADS.map(([a, b]) => [a, b].sort().join("|"));
    expect(new Set(keys).size).toBe(keys.length);
    for (const [a, b] of ROADS) {
      expect(DISTRICTS[a].neighbors).toContain(b);
      expect(DISTRICTS[b].neighbors).toContain(a);
    }
    expect(THAMES_PATH.startsWith("M")).toBe(true);
    expect(THAMES_PATH).not.toMatch(/NaN/);
  });

  it("the route follows meta.visited up to the current run; earlier laps are faint", () => {
    const visited: DistrictId[] = ["whitechapel", "city", "kings_cross"];
    expect(routeOf(visited, 2)).toEqual(visited);
    expect(routeOf(visited, 1)).toEqual(["whitechapel", "city"]);
    expect(routeLegs(visited, 2)).toEqual([
      { from: "whitechapel", to: "city", lap: true },
      { from: "city", to: "kings_cross", lap: true },
    ]);
    const twoLaps = [...DISTRICT_ORDER, "city"] as DistrictId[];
    const legs = routeLegs(twoLaps, 12);
    expect(legs).toHaveLength(12);
    expect(legs.filter((l) => l.lap)).toEqual([{ from: DISTRICT_ORDER[11], to: "city", lap: true }]);
  });

  it("marks: here, the migration's choices, walked this lap, an earlier lap, ahead", () => {
    const m = districtMarks(["whitechapel", "southwark"], 1, ["lambeth", "city"]);
    expect(m.southwark).toBe("here");
    expect(m.whitechapel).toBe("visited");
    expect(m.lambeth).toBe("option");
    expect(m.city).toBe("option");
    expect(m.greenwich).toBe("ahead");
    const lap2 = districtMarks([...DISTRICT_ORDER, "city"] as DistrictId[], 12, ["whitechapel"]);
    expect(lap2.city).toBe("here");
    expect(lap2.whitechapel).toBe("option");
    expect(lap2.greenwich).toBe("past");
  });
});
