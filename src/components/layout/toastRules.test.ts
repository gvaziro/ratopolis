import { describe, expect, it } from "vitest";
import { CHARTER_MAX } from "@/game/data/commissions";
import {
  EARLY_SEC,
  MAX_QUEUED,
  MEDAL_MERGE_MS,
  addToast,
  commissionDoneText,
  joinsMedalGroup,
  medalGroupText,
  toastCap,
  unlockRow,
  unlockTitle,
  visibleToasts,
} from "./toastRules";

interface T {
  id: number;
  wait?: boolean;
  leaving?: boolean;
  train?: { at: number };
}
const ids = (list: readonly T[]) => list.map((x) => x.id);

describe("toastCap", () => {
  it("keeps three on desktop, two on phones and in the first minutes, one with the phone sheet full", () => {
    expect(toastCap({ phone: false, compact: false, early: false })).toBe(3);
    expect(toastCap({ phone: false, compact: false, early: true })).toBe(2);
    expect(toastCap({ phone: true, compact: false, early: false })).toBe(2);
    expect(toastCap({ phone: true, compact: true, early: false })).toBe(1);
  });
});

describe("addToast / visibleToasts (flood control)", () => {
  it("outside a hold behaves as in v2: the oldest shown toast gives way beyond the cap", () => {
    let list: T[] = [];
    for (let id = 1; id <= 4; id++) list = addToast(list, { id }, 3, false);
    expect(ids(list)).toEqual([2, 3, 4]);
    expect(ids(visibleToasts(list, 3, false))).toEqual([2, 3, 4]);
  });

  it("queues every non-train toast while held and shows nothing; nothing already shown is pushed out", () => {
    let list: T[] = [{ id: 1 }, { id: 2 }];
    for (let id = 3; id <= 6; id++) list = addToast(list, { id }, 2, true);
    expect(ids(list)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(visibleToasts(list, 2, true)).toEqual([]);
    // released: the two shown ones come back first, the queue waits for free slots in order of arrival
    expect(ids(visibleToasts(list, 2, false))).toEqual([1, 2]);
    const after = list.filter((x) => x.id > 2);
    expect(ids(visibleToasts(after, 2, false))).toEqual([3, 4]);
  });

  it("bounds the queue: past MAX_QUEUED the oldest queued toast drops", () => {
    let list: T[] = [];
    for (let id = 1; id <= MAX_QUEUED + 2; id++) list = addToast(list, { id }, 2, true);
    expect(list).toHaveLength(MAX_QUEUED);
    expect(list[0].id).toBe(3);
  });

  it("never queues a train countdown: it stays in the shown set and is merely hidden while held", () => {
    const list = addToast<T>([], { id: 1, train: { at: 0 } }, 2, true);
    expect(list[0].wait).toBe(false);
    expect(visibleToasts(list, 2, true)).toEqual([]);
    expect(ids(visibleToasts(list, 2, false))).toEqual([1]);
  });

  it("a new direct toast does not evict queued ones", () => {
    let list: T[] = addToast<T>([], { id: 1 }, 2, true);
    list = addToast(list, { id: 2 }, 2, true);
    list = addToast(list, { id: 3 }, 2, true);
    list = addToast(list, { id: 4 }, 2, false);
    expect(ids(list)).toEqual([1, 2, 3, 4]);
    expect(ids(visibleToasts(list, 2, false))).toEqual([1, 4]);
  });
});

describe("unlock rows", () => {
  it("uses the structured icon and name when the panel sends them", () => {
    expect(unlockRow({ text: "🦷 Острые резцы — клик +1", icon: "🦷", name: "Острые резцы", desc: "клик +1" })).toEqual({ icon: "🦷", name: "Острые резцы", desc: "клик +1" });
  });
  it("cuts a plain text at its first « — »", () => {
    expect(unlockRow({ text: "📦 Тайник в табакерке — Лимит 🪙 +50, 🔘 +40 — за уровень" })).toEqual({ icon: "", name: "📦 Тайник в табакерке", desc: "Лимит 🪙 +50, 🔘 +40 — за уровень" });
    expect(unlockRow({ text: "🧭 Разведка" })).toEqual({ icon: "", name: "🧭 Разведка", desc: "" });
    // the title already says «Открыто»
    expect(unlockRow({ text: "🦷 Открыто: Острые резцы — Клик +1" }).name).toBe("🦷 Острые резцы");
    expect(unlockRow({ text: "Открыто: Сито — улов" }).name).toBe("Сито");
    expect(unlockRow({ text: "🎩 Новая работа: Карманник — приносит 🪙" }).name).toBe("🎩 Новая работа: Карманник");
    expect(unlockRow({ text: "📑 Открыта вкладка «Постройки»" }).name).toBe("📑 Открыта вкладка «Постройки»");
  });
  it("titles the batch with the right plural", () => {
    expect(unlockTitle(1)).toBe("Открыто!");
    expect(unlockTitle(2)).toBe("Открыто: 2 новинки");
    expect(unlockTitle(5)).toBe("Открыто: 5 новинок");
    expect(unlockTitle(21)).toBe("Открыто: 21 новинка");
  });
});

describe("early medals", () => {
  it("merge within 5 s during the first ten minutes only", () => {
    const g = { medals: ["a"], at: 1000 };
    expect(joinsMedalGroup(g, 1000 + MEDAL_MERGE_MS - 1, 100)).toBe(true);
    expect(joinsMedalGroup(g, 1000 + MEDAL_MERGE_MS + 1, 100)).toBe(false);
    expect(joinsMedalGroup(g, 1500, EARLY_SEC + 1)).toBe(false);
    expect(joinsMedalGroup(null, 1500, 100)).toBe(false);
  });
  it("read as one line", () => {
    expect(medalGroupText(["Хомяк в душе", "Перегруз!"])).toBe("+2 медали: Хомяк в душе, Перегруз!");
    expect(medalGroupText(["a", "b", "c", "d", "e"])).toBe("+5 медалей: a, b, c, d, e");
  });
});

describe("commission-done toast", () => {
  it("promises a charter only while one still counts", () => {
    expect(commissionDoneText("Почётный караул", 0)).toContain("Грамота уже в казне!");
    expect(commissionDoneText("Почётный караул", CHARTER_MAX)).not.toContain("Грамота");
    expect(commissionDoneText("Почётный караул", CHARTER_MAX)).toContain("Король доволен");
  });
});
