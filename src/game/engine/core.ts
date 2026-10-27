import { ACHIEVEMENTS } from "../data/meta";
import { HEADLINES } from "../data/headlines";
import { JOBS, OPEN_JOBS } from "../data/jobs";
import { JOB_IDS, type AchievementId, type Amounts, type EngineCtx, type GameState, type JobId, type ResId, type StunGroup } from "../types";
import { check } from "./conditions";
import { assignedRats, type Derived } from "./derive";
import { entries } from "./formulas";
import { pick } from "./rng";

/* ------------------------------------------------------------ resources */

/**
 * Add `amt` of r. Passive gains respect the cap (and stop when overloaded);
 * event/click gains with ignoreCap may overflow ("ПЕРЕГРУЗ").
 * Returns the amount actually added.
 */
export function gain(s: GameState, d: Derived, r: ResId, amt: number, ignoreCap: boolean, ctx?: EngineCtx): number {
  if (!(amt > 0) || !Number.isFinite(amt)) return 0;
  const cap = d.caps[r];
  const before = s.res[r];
  let after: number;
  if (ignoreCap || !Number.isFinite(cap)) after = before + amt;
  else if (before >= cap) after = before;
  else after = Math.min(before + amt, cap);
  after = Math.min(after, 1e300);
  const added = after - before;
  if (added <= 0) {
    if (!ignoreCap && Number.isFinite(cap) && before >= cap) markFull(s, r, ctx);
    return 0;
  }
  s.res[r] = after;
  s.resEver[r] += added;
  if (r === "coins") {
    s.eRun += added;
    s.meta.lifetime.coinsEver += added;
  }
  if (Number.isFinite(cap)) {
    if (!ignoreCap && after >= cap) markFull(s, r, ctx);
    if (ignoreCap && after > cap && before <= cap) {
      if (!s.meta.achievements.overload) award(s, "overload", ctx);
      ctx?.fx.push({ k: "overload", res: r });
    }
  }
  return added;
}

function markFull(s: GameState, r: ResId, ctx?: EngineCtx) {
  if (!s.flags.hit_any_cap) {
    s.flags.hit_any_cap = true;
    award(s, "full_storage", ctx);
    news(s, "hit_cap", {}, ctx);
  }
  if (r === "crumbs" && !s.flags.hit_crumb_cap) s.flags.hit_crumb_cap = true;
}

export function gainAll(s: GameState, d: Derived, a: Amounts, ignoreCap: boolean, ctx?: EngineCtx): Amounts {
  const out: Amounts = {};
  for (const [r, v] of entries(a)) {
    const added = gain(s, d, r, v, ignoreCap, ctx);
    if (added > 0) out[r] = (out[r] ?? 0) + added;
  }
  return out;
}

export function spend(s: GameState, cost: Amounts): void {
  for (const [r, v] of entries(cost)) s.res[r] = Math.max(0, s.res[r] - v);
}

export function addAmounts(into: Amounts, a: Amounts, mult = 1): Amounts {
  for (const [r, v] of entries(a)) into[r] = (into[r] ?? 0) + v * mult;
  return into;
}

/* ------------------------------------------------------------ news / fx */

export function news(s: GameState, key: string, vars: Record<string, string | number>, ctx?: EngineCtx): void {
  const list = HEADLINES[key];
  if (!list || list.length === 0) return;
  const fill = (tpl: string) => {
    let text = tpl;
    for (const [k, v] of Object.entries(vars)) text = text.replaceAll(`{${k}}`, String(v));
    return text;
  };
  // EN-10: the paper never prints the same line twice within NEWS_FRESH headlines: a template whose text ran recently
  // is skipped, and when every one did, the news is dropped (a routine carriage is not worth a reprint)
  const recent = new Set(s.news.slice(-NEWS_FRESH).map((n) => n.text));
  const fresh = list.map(fill).filter((t) => !recent.has(t));
  if (!fresh.length) return;
  // a single template takes no RNG draw
  pushNews(s, fresh.length === 1 ? fresh[0] : pick(s, fresh), ctx);
}

/** A headline is not reprinted within this many latest ones. */
const NEWS_FRESH = 9;

export function pushNews(s: GameState, text: string, ctx?: EngineCtx): void {
  s.news.push({ t: s.time, text });
  if (s.news.length > 30) s.news.splice(0, s.news.length - 30);
  ctx?.fx.push({ k: "news", text });
}

export function toast(ctx: EngineCtx | undefined, text: string, icon?: string, tone?: "info" | "good" | "bad" | "gold"): void {
  ctx?.fx.push({ k: "toast", text, icon, tone });
}

/* ------------------------------------------------------------ achievements */

export function award(s: GameState, id: AchievementId, ctx?: EngineCtx): void {
  if (s.meta.achievements[id] !== undefined) return;
  s.meta.achievements[id] = s.meta.lifetime.playSeconds;
  ctx?.fx.push({ k: "medal", id });
  news(s, "medal", { name: ACHIEVEMENTS[id].name }, ctx);
}

/* ------------------------------------------------------------ rats */

export function stun(s: GameState, fraction: number, seconds: number, reason: StunGroup["reason"], minOne = true): number {
  if (s.rats <= 0) return 0;
  let n = Math.floor(s.rats * fraction);
  if (minOne) n = Math.max(1, n);
  n = Math.min(n, s.rats);
  if (n > 0) s.stunned.push({ count: n, until: s.time + seconds, reason });
  return n;
}

export function hasFreeSlot(s: GameState, d: Derived, j: JobId): boolean {
  return s.jobs[j] < d.slots[j];
}

export function jobUnlocked(s: GameState, j: JobId): boolean {
  return check(s, JOBS[j].unlock);
}

/**
 * Choose a job for a newborn rat according to the assignment mode, the Elder rule and free slots. `auto`: the colony's
 * own pick (potential.autoFocus, v3 ENG-1), used instead of s.focus while the player has never picked a focus
 * (!flags.focus_manual) and the newborns follow the star (focus mode; potential.autoFocusOn); called only then (the
 * economy passes it lazily).
 */
export function newbornJob(s: GameState, d: Derived, crumbNet: number, auto?: () => JobId): JobId {
  const fallback: JobId = jobUnlocked(s, "forager") ? "forager" : "idle";
  if (crumbNet < 0) return fallback; // the Elder: feed the colony first
  if (auto && !s.flags.focus_manual && s.assignMode === "focus") {
    const j = auto();
    return j !== "idle" && jobUnlocked(s, j) && hasFreeSlot(s, d, j) ? j : fallback;
  }
  if (s.assignMode === "focus" || !s.upgrades.rat_relay) {
    const f = s.focus;
    if (jobUnlocked(s, f) && hasFreeSlot(s, d, f)) return f;
    return fallback;
  }
  // ratios / smart: fill limited slots first, then follow the ratio sliders
  for (const j of JOB_IDS) {
    if (JOBS[j].slots && jobUnlocked(s, j) && hasFreeSlot(s, d, j)) return j;
  }
  return ratioPick(s);
}

function ratioPick(s: GameState): JobId {
  const open = (["forager", "pickpocket", "scavenger"] as const).filter((j) => jobUnlocked(s, j));
  if (open.length === 0) return "idle";
  const totalW = open.reduce((a, j) => a + Math.max(0, s.ratios[j]), 0) || 1;
  const totalN = open.reduce((a, j) => a + s.jobs[j], 0) + 1;
  let best: JobId = open[0];
  let bestDef = -Infinity;
  for (const j of open) {
    const want = (Math.max(0, s.ratios[j]) / totalW) * totalN;
    const deficit = want - s.jobs[j];
    if (deficit > bestDef) {
      bestDef = deficit;
      best = j;
    }
  }
  return best;
}

/** Keep job counts valid: no more than slots, no more than rats in total. */
export function normalizeJobs(s: GameState, d: Derived): void {
  for (const j of JOB_IDS) {
    if (j === "idle") continue;
    if (s.jobs[j] > d.slots[j]) s.jobs[j] = d.slots[j];
    if (s.jobs[j] < 0) s.jobs[j] = 0;
  }
  let over = assignedRats(s) - s.rats;
  if (over > 0) {
    // remove from open jobs first, then limited ones
    const order: JobId[] = [...OPEN_JOBS.filter((j) => j !== "idle"), ...JOB_IDS.filter((j) => !OPEN_JOBS.includes(j))];
    for (const j of order) {
      if (over <= 0) break;
      const take = Math.min(over, s.jobs[j]);
      s.jobs[j] -= take;
      over -= take;
    }
  }
  s.jobs.idle = Math.max(0, s.rats - assignedRats(s));
}

/* ------------------------------------------------------------ edicts (v2) */

export { edictRank } from "./ranks";
