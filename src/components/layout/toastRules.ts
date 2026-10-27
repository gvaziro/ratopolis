/**
 * Flood control for the toast stack (v3 SHL-1), kept pure so vitest can pin it down: how many toasts fit, which ones
 * show, how a held toast queues instead of pushing others out, the one-line unlock rows, the grouped early medals and
 * the King's charter and the scouts' wording. Toasts.tsx wires these to the fx buses and the DOM.
 */
import { RESOURCES } from "@/game/data/resources";
import { SCOUT_NEAR_TEXT } from "@/game/engine/actions";
import { charterAtCap } from "@/game/engine/metaMath";
import type { ResId } from "@/game/types";
import { fmt, plural } from "@/lib/format";

/** «The first ten minutes of play» (run time, s): fewer toasts at once and early medals grouped. */
export const EARLY_SEC = 600;
/** Medals awarded this close together (ms) in the first ten minutes share one banner. */
export const MEDAL_MERGE_MS = 5000;
/** Toasts queued while the stack is held (a scene, a modal, the zone newspaper): the oldest drop beyond this. */
export const MAX_QUEUED = 6;
/** Unlock rows shown under «Открыто: N новинок»: desktop, phones. */
export const UNLOCK_ROWS = { desk: 3, phone: 2 } as const;
/**
 * Window event Toasts sends when a medal banner actually comes on screen (it waits for scenes, dialogs and the zone
 * paper): `detail.count` medals on it. Effects that belong to the banner (FxLayer's confetti) can key on it instead
 * of the engine's medal fx, which may arrive under a running train.
 */
export const MEDAL_SHOWN_EVENT = "rr-medal-shown";

/** How many toasts may be on screen at once. */
export function toastCap(o: { phone: boolean; compact: boolean; early: boolean }): number {
  // a phone with the sheet full has one sliver of colony; phones and the first minutes keep two
  if (o.compact) return 1;
  if (o.phone || o.early) return 2;
  return 3;
}

/** The part of a toast the queue cares about: `wait` = arrived while held and not yet on screen. */
export interface Queued {
  wait?: boolean;
  leaving?: boolean;
  /** Train countdowns never queue: they are hidden while held and come back with the time left. */
  train?: unknown;
}

/**
 * Add a toast to the list. Held (a scene, a modal, the zone newspaper): it queues (`wait`) at the back and pushes
 * nobody out; past MAX_QUEUED the oldest queued one drops. Otherwise it shows at once and, as before v3, the oldest
 * shown toast beyond the cap gives way.
 */
export function addToast<T extends Queued>(list: readonly T[], t: T, cap: number, held: boolean): T[] {
  const live = list.filter((x) => !x.leaving);
  if (held && !t.train) {
    const next = [...live, { ...t, wait: true }];
    const waiting = next.filter((x) => x.wait);
    if (waiting.length <= MAX_QUEUED) return next;
    const drop = waiting[0];
    return next.filter((x) => x !== drop);
  }
  const next = [...live, { ...t, wait: false }];
  const direct = next.filter((x) => !x.wait);
  const over = direct.length - Math.max(1, cap);
  if (over <= 0) return next;
  const drop = new Set<T>(direct.slice(0, over));
  return next.filter((x) => !drop.has(x));
}

/**
 * What the stack shows: nothing while held; otherwise the newest `cap` shown toasts, topped up with queued ones in
 * order of arrival (a queued toast that gets a slot is then marked shown by the caller).
 */
export function visibleToasts<T extends Queued>(list: readonly T[], cap: number, held: boolean): T[] {
  if (held) return [];
  const n = Math.max(1, cap);
  const direct = list.filter((x) => !x.wait).slice(-n);
  const room = n - direct.filter((x) => !x.leaving).length;
  const fill = room > 0 ? list.filter((x) => x.wait).slice(0, room) : [];
  const keep = new Set<T>([...direct, ...fill]);
  return list.filter((x) => keep.has(x));
}

/** One unlock row: icon, name and the «что даёт» line (desktop single item, tooltips). */
export interface UnlockRow {
  icon: string;
  name: string;
  desc: string;
}

/**
 * An unlock item as one short row. Structured items (PAN-1: icon/name/desc) are used as they are; a plain `text`
 * is cut at its first « — » and loses the «Открыто:» the toast's title already says:
 * «📦 Открыто: Тайник в табакерке — Лимит 🪙 +50» → name «📦 Тайник в табакерке».
 */
export function unlockRow(it: { text: string; icon?: string; name?: string; desc?: string }): UnlockRow {
  const cut = it.text.indexOf(" — ");
  const head = (cut >= 0 ? it.text.slice(0, cut) : it.text).trim().replace(/^(\S+\s+)?Открыт[оа]:\s*/u, "$1");
  const tail = cut >= 0 ? it.text.slice(cut + 3).trim() : "";
  if (it.name) return { icon: it.icon ?? "", name: it.name, desc: it.desc ?? tail };
  return { icon: it.icon ?? "", name: head, desc: it.desc ?? tail };
}

/** «Открыто!» for one item, «Открыто: 3 новинки» for a batch. */
export function unlockTitle(n: number): string {
  return n > 1 ? `Открыто: ${n} ${plural(n, "новинка", "новинки", "новинок")}` : "Открыто!";
}

/** A banner of medals: one, or several awarded close together in the first ten minutes. */
export interface MedalGroup {
  medals: string[];
  /** performance.now() of the last medal added. */
  at: number;
}

/** A new medal joins `last` (the newest medal banner, shown or waiting) when the run is young and it came quickly. */
export function joinsMedalGroup(last: MedalGroup | null | undefined, now: number, gameTime: number): boolean {
  return !!last && gameTime < EARLY_SEC && now - last.at < MEDAL_MERGE_MS;
}

/** «+2 медали»: the headline of a grouped medal banner. */
export function medalGroupTitle(n: number): string {
  return `+${n} ${plural(n, "медаль", "медали", "медалей")}`;
}

/** «+2 медали: Хомяк в душе, Перегруз!» (the names as they are; a name may end in «!» itself). */
export function medalGroupText(names: readonly string[]): string {
  return `${medalGroupTitle(names.length)}: ${names.join(", ")}`;
}

/**
 * The commission-done toast promises a charter only when the commission actually paid one that counts: judged on
 * the charters before this commission (after it the count may already sit at the cap it just reached).
 */
export function commissionDoneText(name: string, chartersBefore: number): string {
  return charterAtCap({ charters: chartersBefore })
    ? `Поручение Короля исполнено: «${name}». Король доволен — казна грамот и так полна`
    : `Поручение Короля исполнено: «${name}». Грамота уже в казне!`;
}

/**
 * The scouts' toast: steps 1–3 bring a piece of the map, the 90% step (v3 ENG-3) has its own line, as its news does
 * (actions.SCOUT_NEAR_TEXT) — «Разведчики: до цели рукой подать! Принесли +1.2K 🪙».
 */
export function scoutToastText(fx: { res: ResId; amount: number; step: number }): string {
  const loot = `+${fmt(fx.amount)} ${RESOURCES[fx.res].icon}`;
  return fx.step === 4 ? `${SCOUT_NEAR_TEXT}! Принесли ${loot}` : `Разведчики вернулись: ${loot} и кусок карты`;
}
