import { EDICT_IDS, RES_IDS, SEAL_IDS, ZONE_IDS, COMMISSION_IDS, type GameState } from "../types";
import { abortScene } from "./offline";
import { createInitialState, SCHEMA_VERSION } from "./state";

export const SAVE_KEY = "ratropolis.save.v1";
const INF = "__INF__";
const NINF = "__-INF__";

/** deserialize() of a save written by a newer game version: never loaded, never overwritten. */
export interface SaveNewer {
  error: "newer";
  version: number;
}

export function isNewerSave(v: unknown): v is SaveNewer {
  return typeof v === "object" && v !== null && (v as { error?: unknown }).error === "newer";
}

export function serialize(s: GameState): string {
  return JSON.stringify(s, (_k, v) => {
    if (v === Infinity) return INF;
    if (v === -Infinity) return NINF;
    if (typeof v === "number" && Number.isNaN(v)) return 0;
    if (typeof v === "number" && v > 1e300) return 1e300;
    return v;
  });
}

/**
 * Parse a save. Garbage (bad JSON, no schemaVersion, a throw while migrating) → null;
 * a save from a newer schema → {error:"newer", version} (the caller must neither load nor overwrite it).
 */
export function deserialize(str: string): GameState | SaveNewer | null {
  try {
    const raw = JSON.parse(str, (_k, v) => (v === INF ? Infinity : v === NINF ? -Infinity : v));
    if (!isPlain(raw) || typeof raw.schemaVersion !== "number" || !Number.isFinite(raw.schemaVersion)) return null;
    if (raw.schemaVersion > SCHEMA_VERSION) return { error: "newer", version: raw.schemaVersion };
    return migrate(raw);
  } catch {
    return null;
  }
}

/** schemaVersion of a stored save without parsing it all (null when absent). */
export function savedVersion(str: string): number | null {
  const m = /"schemaVersion"\s*:\s*(\d+)/.exec(str.slice(0, 200));
  return m ? Number(m[1]) : null;
}

/** Fill fields missing from older saves with fresh defaults; run version migrations; drop malformed array elements. */
export function migrate(raw: Record<string, unknown>): GameState {
  const def = createInitialState(1, Date.now());
  const merged = mergeDefaults(def, raw) as GameState;
  // v1 → v2: every new field already has its default from mergeDefaults; edicts[id]=true reads as rank 1 (edictRank)
  merged.schemaVersion = SCHEMA_VERSION;
  sanitize(merged);
  // a save made mid-scene (autosave, tab closed during a train): credit the auto-collect share, then drop it
  if (merged.scene) {
    try {
      abortScene(merged, { fx: [] });
    } catch {
      /* malformed scene from an old save: just drop it */
    }
  }
  merged.scene = null;
  // markets saved before they had an id
  if (merged.market && typeof merged.market.id !== "number") merged.market.id = ++merged.sceneSeq;
  return merged;
}

function isPlain(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function mergeDefaults(def: unknown, val: unknown): unknown {
  if (val === undefined || val === null) return def === undefined ? val : def;
  // a null default (digging, scene, purse, market, meta.seal, commissions) carries no type: keep the value, sanitize() checks it
  if (def === null) return val;
  if (isPlain(def)) {
    if (!isPlain(val)) return def;
    const out: Record<string, unknown> = { ...val };
    for (const k of Object.keys(def)) out[k] = mergeDefaults(def[k], val[k]);
    return out;
  }
  if (Array.isArray(def)) return Array.isArray(val) ? val : def;
  if (typeof def === "number") return typeof val === "number" && !Number.isNaN(val) ? val : def;
  if (def !== undefined && typeof val !== typeof def) return def;
  return val;
}

/* ------------------------------------------------------------ sanitizing (EN-8) */

const RES = new Set<string>(RES_IDS);
const ZONES = new Set<string>(ZONE_IDS);
const RATINGS = new Set(["none", "bronze", "silver", "gold", "royal"]);
const STUN_REASONS = new Set(["cat", "piper", "crash"]);
const EVENTS = new Set(["carriage", "capsule", "metro_train", "royal_express", "downpour", "cat", "ratcatcher", "purse", "shiny", "market"]);
const SEALS = new Set<string>(SEAL_IDS);
const COMMISSIONS = new Set<string>(COMMISSION_IDS);
const EDICTS = new Set<string>(EDICT_IDS);

const num = (v: unknown): v is number => typeof v === "number" && !Number.isNaN(v);
const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const str = (v: unknown): v is string => typeof v === "string";

/**
 * Drop malformed elements that would crash the UI or the engine (one bad shiny used to take the whole page down)
 * and clamp settings to their allowed values. Mutates `s`.
 */
function sanitize(s: GameState): void {
  s.shinies = s.shinies.filter((x) => isPlain(x) && fin(x.id) && fin(x.x) && fin(x.y) && RES.has(x.res as string) && num(x.until));
  s.news = s.news.filter((n) => isPlain(n) && str(n.text)).map((n) => ({ t: fin(n.t) ? n.t : 0, text: n.text }));
  s.stunned = s.stunned.filter((g) => isPlain(g) && fin(g.count) && g.count >= 0 && num(g.until) && STUN_REASONS.has(g.reason as string));
  s.haulLog = s.haulLog
    .filter((h) => isPlain(h) && str(h.title) && isPlain(h.gained) && RATINGS.has(h.rating as string))
    .map((h) => ({
      ...h,
      caughtCount: fin(h.caughtCount) ? h.caughtCount : 0,
      totalCount: fin(h.totalCount) ? h.totalCount : 0,
      share: fin(h.share) ? h.share : 0,
      ratingBonus: fin(h.ratingBonus) ? h.ratingBonus : 0,
      combo: fin(h.combo) ? h.combo : 0,
      suspicion: fin(h.suspicion) ? h.suspicion : 0,
      crash: !!h.crash,
      jackpot: !!h.jackpot,
      notes: Array.isArray(h.notes) ? h.notes.filter(str) : [],
      gained: Object.fromEntries(Object.entries(h.gained).filter(([r, v]) => RES.has(r) && fin(v))),
    }))
    .slice(0, 10);
  // saves from before runBestRating: the best of the hauls they still keep
  const order = [...RATINGS];
  if (!RATINGS.has(s.runBestRating)) s.runBestRating = "none";
  for (const h of s.haulLog) if (order.indexOf(h.rating) > order.indexOf(s.runBestRating)) s.runBestRating = h.rating;
  s.clickWindow = s.clickWindow.filter(fin);
  s.newsRecent = s.newsRecent.filter(str).slice(-8);
  s.trainPrefs.lastNets = s.trainPrefs.lastNets.filter((n) => fin(n) && n >= 0 && n <= 2);
  if (!["wall", "rails", "ties"].includes(s.trainPrefs.position)) s.trainPrefs.position = "rails";

  if (s.market !== null) {
    const m = s.market as unknown;
    if (!isPlain(m) || !num(m.until) || !Array.isArray(m.deals)) s.market = null;
    else
      s.market.deals = s.market.deals.filter(
        (d) => isPlain(d) && RES.has(d.give as string) && RES.has(d.get as string) && fin(d.giveAmt) && fin(d.getAmt),
      );
  }
  if (s.purse !== null && !(isPlain(s.purse) && fin(s.purse.x) && fin(s.purse.y) && num(s.purse.until))) s.purse = null;
  if (s.digging !== null && !(isPlain(s.digging) && ZONES.has(s.digging.zone as string) && num(s.digging.until))) s.digging = null;
  for (const [id, list] of Object.entries(s.recentLines)) {
    if (!EVENTS.has(id) || !Array.isArray(list)) delete s.recentLines[id as keyof typeof s.recentLines];
    else s.recentLines[id as keyof typeof s.recentLines] = list.filter(fin).slice(-4);
  }
  for (const [z, v] of Object.entries(s.scouted)) if (!ZONES.has(z) || !fin(v)) delete s.scouted[z as keyof typeof s.scouted];

  if (s.commissions !== null) {
    const c = s.commissions as unknown;
    if (!isPlain(c) || !Array.isArray(c.offered)) s.commissions = null;
    else {
      s.commissions.offered = s.commissions.offered.filter((id) => COMMISSIONS.has(id));
      s.commissions.done = fin(c.done) ? c.done : 0;
      const a = c.active;
      if (a !== undefined && !(isPlain(a) && COMMISSIONS.has(a.id as string) && fin(a.base))) delete s.commissions.active;
    }
  }

  const m = s.meta;
  m.trophies = m.trophies.filter(str);
  m.seenEvents = m.seenEvents.filter((e) => EVENTS.has(e));
  m.sealsOwned = m.sealsOwned.filter((x, i, a) => SEALS.has(x) && a.indexOf(x) === i);
  if (m.seal !== null && !(SEALS.has(m.seal) && m.sealsOwned.includes(m.seal))) m.seal = null;
  for (const [id, r] of Object.entries(m.edictRank)) if (!EDICTS.has(id) || !fin(r)) delete m.edictRank[id as keyof typeof m.edictRank];
  for (const [id, list] of Object.entries(m.seenLines)) {
    if (!EVENTS.has(id) || !Array.isArray(list)) delete m.seenLines[id as keyof typeof m.seenLines];
    else m.seenLines[id as keyof typeof m.seenLines] = list.filter(fin);
  }
  m.history = m.history
    .filter((h) => isPlain(h) && fin(h.district) && fin(h.seconds) && fin(h.eRun) && fin(h.crowns))
    .map((h) => ({ ...h, zones: isPlain(h.zones) ? h.zones : {}, bestRating: RATINGS.has(h.bestRating) ? h.bestRating : "none" }))
    .slice(-20);
  if (!RATINGS.has(m.bestRating)) m.bestRating = "none";
  // saves from before lifetime.wagons: at least this run's wagons
  m.lifetime.wagons = Math.max(fin(m.lifetime.wagons) ? m.lifetime.wagons : 0, s.express.wagons);

  const st = s.settings;
  if (st.textScale !== 1 && st.textScale !== 1.15 && st.textScale !== 1.3) st.textScale = 1;
  st.volume = Math.max(0, Math.min(1, st.volume));
  st.ambience = Math.max(0, Math.min(1, st.ambience));
}

/* ------------------------------------------------------------ export / import */

/** Unicode-safe base64 export string. */
export function exportString(s: GameState): string {
  const json = serialize(s);
  const bytes = new TextEncoder().encode(json);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return "RATRO1:" + btoa(bin);
}

/** Import an export string ("RATRO1:…" base64) or a raw save file (JSON, as rawSave() downloads it). */
export function importAny(str: string): GameState | SaveNewer | null {
  try {
    const trimmed = str.trim();
    if (trimmed.startsWith("{")) return deserialize(trimmed);
    const b64 = trimmed.startsWith("RATRO1:") ? trimmed.slice(7) : trimmed;
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return deserialize(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

/** importAny() for callers that only take a loadable state: a newer-version save counts as unreadable. */
export function importString(str: string): GameState | null {
  const r = importAny(str);
  return r && !isNewerSave(r) ? r : null;
}
