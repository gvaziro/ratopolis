import type { GameState } from "../types";
import { createInitialState, SCHEMA_VERSION } from "./state";

export const SAVE_KEY = "ratropolis.save.v1";
const INF = "__INF__";
const NINF = "__-INF__";

export function serialize(s: GameState): string {
  return JSON.stringify(s, (_k, v) => {
    if (v === Infinity) return INF;
    if (v === -Infinity) return NINF;
    if (typeof v === "number" && Number.isNaN(v)) return 0;
    if (typeof v === "number" && v > 1e300) return 1e300;
    return v;
  });
}

export function deserialize(str: string): GameState | null {
  try {
    const raw = JSON.parse(str, (_k, v) => (v === INF ? Infinity : v === NINF ? -Infinity : v));
    if (!raw || typeof raw !== "object" || typeof raw.schemaVersion !== "number") return null;
    return migrate(raw);
  } catch {
    return null;
  }
}

/** Fill fields missing from older saves with fresh defaults; run version migrations. */
export function migrate(raw: Record<string, unknown>): GameState {
  const def = createInitialState(1, Date.now());
  const merged = mergeDefaults(def, raw) as GameState;
  // future: if (merged.schemaVersion < 2) { ... }
  merged.schemaVersion = SCHEMA_VERSION;
  merged.scene = null;
  return merged;
}

function isPlain(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function mergeDefaults(def: unknown, val: unknown): unknown {
  if (val === undefined || val === null) return def === undefined ? val : def;
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

/** Unicode-safe base64 export string. */
export function exportString(s: GameState): string {
  const json = serialize(s);
  const bytes = new TextEncoder().encode(json);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return "RATRO1:" + btoa(bin);
}

export function importString(str: string): GameState | null {
  try {
    const trimmed = str.trim();
    const b64 = trimmed.startsWith("RATRO1:") ? trimmed.slice(7) : trimmed;
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return deserialize(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}
