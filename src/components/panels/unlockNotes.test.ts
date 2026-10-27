import { describe, expect, it } from "vitest";
import { BUILDING_IDS, JOB_IDS, UPGRADE_IDS } from "@/game/types";
import { TABS, unlockItem } from "./unlockNotes";

const keys = [
  ...TABS.filter((t) => t.id !== "settings").map((t) => `tab_${t.id}`),
  ...JOB_IDS.filter((j) => j !== "idle").map((j) => `j_${j}`),
  ...BUILDING_IDS.map((b) => `b_${b}`),
  ...UPGRADE_IDS.map((u) => `u_${u}`),
];

describe("unlock notes (PAN-1, ENG-12 structured items)", () => {
  it("every unlock carries an icon and a name, and the full line still starts with the icon", () => {
    for (const k of keys) {
      const it = unlockItem(k);
      expect(it, k).not.toBeNull();
      expect(it!.icon.length, k).toBeGreaterThan(0);
      expect(it!.name.length, k).toBeGreaterThan(0);
      expect(it!.text.startsWith(it!.icon), k).toBe(true);
      expect(it!.desc ?? "", k).not.toMatch(/\.$/);
    }
  });

  it("keeps the v2 lines and adds the parts", () => {
    expect(unlockItem("j_pickpocket")).toMatchObject({ tab: "jobs", icon: "🎩", name: "Карманник", desc: "приносит 🪙", text: "🎩 Новая работа: Карманник — приносит 🪙" });
    expect(unlockItem("b_pantry")).toMatchObject({ tab: "buildings", text: "🥫 Можно строить Кладовку — лимит 🍞 +150", desc: "лимит 🍞 +150" });
    expect(unlockItem("tab_jobs")).toMatchObject({ tab: "jobs", icon: "🐀", name: "Вкладка «Работы»", text: "🐀 Открыта вкладка «Работы»" });
    expect(unlockItem("tab_map")?.text).toBe("🗺️ Открыта вкладка «Карта»");
    expect(unlockItem("tab_map")?.desc).toBe("экспедиции в новые зоны");
  });

  it("ignores keys that are not unlocks", () => {
    expect(unlockItem("e_bread_tax")).toBeNull();
    expect(unlockItem("tab_settings")).toBeNull();
    expect(unlockItem("j_nobody")).toBeNull();
  });
});
