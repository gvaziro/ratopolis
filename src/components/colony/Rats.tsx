"use client";

/**
 * The colony's rats: at most 40 sprites (≈ 4·log2(rats+1)) walking between their job's chamber and the burrow.
 * Positions live in refs and are written straight to the DOM by one rAF loop — React only re-renders
 * when the job mix, stun count or hunger changes.
 */
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { stunnedRats } from "@/game/engine/derive";
import { onFx } from "@/game/fx";
import { derivedOf, useGame } from "@/game/store";
import { JOBS } from "@/game/data/jobs";
import { RESOURCES } from "@/game/data/resources";
import { JOB_IDS, UPGRADE_IDS, type BuildingId, type JobId, type UpgradeId, type ZoneId } from "@/game/types";
import { camView } from "./camera";
import { BUILDING_SLOT, bandTop, floorY, jobRoute, ROUTE_BUILDINGS, routeBetween, type Pt } from "./geometry";
import { FURS, RatBody, UPGRADE_LOOKS } from "./ratArt";
import { colonyPaused, pokeChamber } from "./registry";

type Route = ReturnType<typeof jobRoute>;

export function spriteCount(rats: number): number {
  if (rats <= 0) return 0;
  return Math.min(40, Math.floor(rats), Math.max(1, Math.round(4 * Math.log2(rats + 1))));
}

/** Sprites per job: every present job gets one if possible, the rest proportionally. */
function targetCounts(n: number, jobs: Record<JobId, number>): Map<JobId, number> {
  const present = JOB_IDS.filter((j) => jobs[j] > 0).sort((a, b) => jobs[b] - jobs[a]);
  const total = present.reduce((a, j) => a + jobs[j], 0);
  const out = new Map<JobId, number>();
  if (!total || n <= 0) return out;
  let given = 0;
  for (const j of present) {
    if (given >= n) break;
    out.set(j, 1);
    given++;
  }
  while (given < n) {
    let best = present[0];
    let bestD = -Infinity;
    for (const j of present) {
      const d = (jobs[j] / total) * n - (out.get(j) ?? 0);
      if (d > bestD) {
        bestD = d;
        best = j;
      }
    }
    out.set(best, (out.get(best) ?? 0) + 1);
    given++;
  }
  return out;
}

/** Keep each sprite's previous job where possible so rats don't all switch at once. */
function reassign(prev: JobId[], counts: Map<JobId, number>, n: number): JobId[] {
  const need = new Map(counts);
  const out: (JobId | null)[] = [];
  for (let i = 0; i < n; i++) {
    const j = prev[i];
    if (j && (need.get(j) ?? 0) > 0) {
      out.push(j);
      need.set(j, need.get(j)! - 1);
    } else out.push(null);
  }
  for (let i = 0; i < n; i++) {
    if (out[i]) continue;
    const j = JOB_IDS.find((x) => (need.get(x) ?? 0) > 0) ?? "idle";
    out[i] = j;
    need.set(j, (need.get(j) ?? 0) - 1);
  }
  return out as JobId[];
}

interface Sprite {
  job: JobId;
  x: number;
  y: number;
  path: Pt[];
  wait: number;
  atWork: boolean;
  speed: number;
  dir: 1 | -1;
  climb: number;
  phase: number;
  stunned: boolean;
  tr: string;
  /** The last written position was inside the view (a sprite that left it is not rewritten). */
  shown: boolean;
  /** CO-6: heading home with the job's output on its back. */
  carry: boolean;
  /** Index among the sprites of the same job and their count (spreads the waiting spots, no clumps). */
  slot: number;
  of: number;
}

/** CO-6: chambers with no job route get one resident each (at most 10, on top of the 40 sprites). */
const RESIDENT_BUILDINGS: BuildingId[] = [
  "nursery",
  "cellar_vault",
  "capsule_tap",
  "sewer_warehouse",
  "drain_sieve",
  "water_wheel",
  "rat_rail",
  "steam_press",
  "platform_post",
  "clocktower",
  "express_depot",
];

interface Resident {
  b: BuildingId;
  x: number;
  y: number;
  home: number;
  target: number;
  wait: number;
  dir: 1 | -1;
  hop: number;
  shown: boolean;
}

/** The icon of a job's main output (the cargo a rat carries home). */
function cargoIcon(job: JobId): string {
  const r = Object.keys(JOBS[job]?.produces ?? {})[0] as keyof typeof RESOURCES | undefined;
  return r ? RESOURCES[r].icon : "🎒";
}

interface Guest {
  id: number;
  job: JobId;
  from: Pt;
  to: Pt;
  foreman?: boolean;
}

interface GuestState {
  x: number;
  y: number;
  path: Pt[];
  fade: number;
  dir: 1 | -1;
  done: boolean;
}

const NEST: Pt = { x: BUILDING_SLOT.nest.cx, y: BUILDING_SLOT.nest.floor };
const LIE_Y = floorY("burrow", 1);
const HEART_POOL = 3;

function newSprite(job: JobId, r: Route): Sprite {
  const atWork = Math.random() < 0.5;
  const base = atWork ? r.work : r.home;
  return {
    job,
    x: base.x + (Math.random() * 2 - 1) * r.spread,
    y: base.y,
    path: [],
    wait: Math.random() * 2,
    atWork,
    speed: job === "idle" ? 26 + Math.random() * 10 : 58 + Math.random() * 22,
    dir: Math.random() < 0.5 ? 1 : -1,
    climb: 0,
    phase: Math.random() * 10,
    stunned: false,
    tr: "",
    shown: true,
    carry: false,
    slot: 0,
    of: 1,
  };
}

/** A spot near a base: spread by the sprite's index among its job (≥ 12 units apart), plus a little jitter. */
function spotNear(base: Pt, spread: number, s: Sprite): number {
  const k = Math.max(1, s.of);
  const span = Math.max(spread, 70);
  const u = k > 1 ? ((s.slot % k) / (k - 1)) * 2 - 1 : (Math.random() * 2 - 1) * 0.5;
  return base.x + span * u + (Math.random() * 2 - 1) * 6;
}

function nextLeg(s: Sprite, r: Route): void {
  if (s.job === "idle") {
    s.path = routeBetween(s, { x: spotNear(r.work, r.spread, s), y: r.work.y });
    s.atWork = true;
    s.carry = false;
    return;
  }
  s.atWork = !s.atWork;
  // producers walk home loaded (CO-6)
  s.carry = !s.atWork;
  const base = s.atWork ? r.work : r.home;
  s.path = routeBetween(s, { x: spotNear(base, r.spread, s), y: base.y });
}

/** Move along waypoints; returns true while walking. */
function walk(s: { x: number; y: number; path: Pt[]; dir: 1 | -1 }, speed: number, dt: number): number {
  let budget = speed * dt;
  let climb = 0;
  while (budget > 0 && s.path.length) {
    const p = s.path[0];
    const dx = p.x - s.x;
    const dy = p.y - s.y;
    const vertical = Math.abs(dy) > Math.abs(dx);
    const k = vertical ? 0.7 : 1;
    const d = Math.hypot(dx, dy);
    const step = budget * k;
    if (d <= step) {
      s.x = p.x;
      s.y = p.y;
      s.path.shift();
      budget -= d / k;
    } else {
      s.x += (dx / d) * step;
      s.y += (dy / d) * step;
      budget = 0;
    }
    if (vertical) climb = dy < 0 ? -1 : 1;
    else if (Math.abs(dx) > 0.01) {
      s.dir = dx > 0 ? 1 : -1;
      climb = 0;
    }
  }
  return climb;
}

/** The chamber at a route's home end (for the cargo poke), if any. */
function homeBuilding(r: Route): BuildingId | null {
  for (const b of ["pantry", "stash", "pickpocket_school", "nest"] as BuildingId[]) {
    const slot = BUILDING_SLOT[b];
    if (slot && Math.abs(slot.cx - r.home.x) < 1 && Math.abs(slot.floor - r.home.y) < 1) return b;
  }
  return null;
}

export const RatsLayer = memo(function RatsLayer() {
  const rats = useGame((s) => s.game.rats);
  const jobs = useGame(useShallow((s) => s.game.jobs));
  const stunned = useGame((s) => stunnedRats(s.game));
  const hungry = useGame((s) => s.game.hungry);
  const builtKey = useGame((s) => ROUTE_BUILDINGS.filter((b) => s.game.buildings[b] > 0).join(","));
  // CO-6: the upgrades that change the look, and the chambers that get a resident
  const looksKey = useGame((s) => UPGRADE_IDS.filter((u) => s.game.upgrades[u] && UPGRADE_LOOKS[u]).join(","));
  const looks = useMemo(() => (looksKey ? (looksKey.split(",") as UpgradeId[]) : []), [looksKey]);
  const residentKey = useGame((s) =>
    RESIDENT_BUILDINGS.filter((b) => s.game.buildings[b] > 0 && s.game.zones[BUILDING_SLOT[b].zone])
      .slice(0, 10)
      .join(","),
  );
  const residentList = useMemo(() => (residentKey ? (residentKey.split(",") as BuildingId[]) : []), [residentKey]);
  const residentEls = useRef<(SVGGElement | null)[]>([]);
  const residents = useRef<Resident[]>([]);
  const cargoEls = useRef<(SVGTextElement | null)[]>([]);

  const n = spriteCount(rats);
  const key = `${n}|${JOB_IDS.map((j) => jobs[j]).join(",")}`;
  const [assign, setAssign] = useState(() => ({ key, list: reassign([], targetCounts(n, jobs), n) }));
  if (assign.key !== key) setAssign({ key, list: reassign(assign.list, targetCounts(n, jobs), n) });
  const list = assign.list;
  const stunnedN = rats > 0 && stunned > 0 ? Math.min(list.length, Math.max(1, Math.round((list.length * stunned) / rats))) : 0;

  const routes = useMemo(() => {
    const set = new Set(builtKey.split(",").filter(Boolean) as BuildingId[]);
    return Object.fromEntries(JOB_IDS.map((j) => [j, jobRoute(j, set)])) as Record<JobId, Route>;
  }, [builtKey]);

  const els = useRef<(SVGGElement | null)[]>([]);
  const sprites = useRef<Sprite[]>([]);
  const cfg = useRef<{ routes: Record<JobId, Route> | null; hungry: boolean }>({ routes: null, hungry: false });
  const [guests, setGuests] = useState<Guest[]>([]);
  const guestsRef = useRef<Guest[]>([]);
  const guestEls = useRef(new Map<number, SVGGElement>());
  const guestState = useRef(new Map<number, GuestState>());
  const heartEls = useRef<(SVGTextElement | null)[]>([]);

  // reconcile sprite state with the job assignment / routes
  useEffect(() => {
    const sp = sprites.current;
    const routesChanged = cfg.current.routes !== routes;
    cfg.current = { routes, hungry };
    sp.length = Math.min(sp.length, list.length);
    for (let i = 0; i < list.length; i++) {
      const job = list[i];
      const s = sp[i];
      if (!s) {
        sp[i] = newSprite(job, routes[job]);
        continue;
      }
      if (s.job !== job || routesChanged) {
        s.job = job;
        s.path = [];
        s.wait = Math.random() * 0.6;
        s.atWork = false;
        s.speed = job === "idle" ? 26 + Math.random() * 10 : 58 + Math.random() * 22;
      }
    }
    // index among the same job, for the de-clumped waiting spots
    const seen = new Map<JobId, number>();
    const totals = new Map<JobId, number>();
    for (const s of sp) totals.set(s.job, (totals.get(s.job) ?? 0) + 1);
    for (const s of sp) {
      const k = seen.get(s.job) ?? 0;
      seen.set(s.job, k + 1);
      s.slot = k;
      s.of = totals.get(s.job) ?? 1;
    }
    for (let i = 0; i < sp.length; i++) {
      const st = i >= sp.length - stunnedN;
      if (st && !sp[i].stunned) {
        sp[i].x = 40 + ((i * 53) % 560);
        sp[i].y = LIE_Y;
        sp[i].path = [];
      }
      sp[i].stunned = st;
    }
  }, [list, routes, stunnedN, hungry]);

  useEffect(() => {
    guestsRef.current = guests;
  }, [guests]);

  // residents: one per chamber without a job route, pacing in front of its machine
  useEffect(() => {
    const prev = new Map(residents.current.map((r) => [r.b, r]));
    residents.current = residentList.map((b) => {
      const old = prev.get(b);
      if (old) return old;
      const slot = BUILDING_SLOT[b];
      return { b, x: slot.cx, y: slot.floor, home: slot.cx, target: slot.cx, wait: Math.random() * 2, dir: 1, hop: 0, shown: true };
    });
  }, [residentList]);

  // births and vagrants
  useEffect(() => {
    let seq = 0;
    let lastBirth = 0;
    let lastForeman = 0;
    let heartSeq = 0;
    // ♥ over the nest: pooled SVG nodes animated with WAAPI (kept off the particle canvas, so births
    // do not keep its loop awake; they also stay glued to the nest while the camera moves)
    const popHeart = () => {
      if (colonyPaused()) return;
      const el = heartEls.current[heartSeq++ % HEART_POOL];
      if (!el) return;
      const rm = useGame.getState().game.settings.reducedMotion;
      const dx = (Math.random() * 2 - 1) * 14;
      el.animate(
        rm
          ? [{ opacity: 0 }, { opacity: 1, offset: 0.25 }, { opacity: 0 }]
          : [
              { transform: `translate(${dx.toFixed(0)}px, 0) scale(.6)`, opacity: 0 },
              { transform: `translate(${dx.toFixed(0)}px, -14px) scale(1.15)`, opacity: 1, offset: 0.25 },
              { transform: `translate(${(dx * 1.5).toFixed(0)}px, -46px) scale(1)`, opacity: 0 },
            ],
        { duration: 1100, easing: "ease-out" },
      );
    };
    return onFx((fx) => {
      if (fx.k === "buy") {
        // the foreman in his hard hat runs to every construction site
        const now = performance.now();
        if (!useGame.getState().game.upgrades.foreman || now - lastForeman < 1500) return;
        lastForeman = now;
        const slot = BUILDING_SLOT[fx.building];
        const to = { x: slot.cx + 40, y: slot.floor };
        if (Math.abs(to.x - NEST.x) < 30 && to.y === NEST.y) to.x -= 100;
        setGuests((g) => (g.length >= 5 ? g : [...g, { id: ++seq, job: "idle", from: { ...NEST }, to, foreman: true }]));
      } else if (fx.k === "birth") {
        const now = performance.now();
        if (now - lastBirth < 600) return;
        lastBirth = now;
        popHeart();
        const r = cfg.current.routes?.[fx.job];
        const to = r ? { x: r.work.x, y: r.work.y } : { x: NEST.x + 140, y: NEST.y };
        if (Math.abs(to.x - NEST.x) < 30 && to.y === NEST.y) to.x += 120;
        setGuests((g) => (g.length >= 4 ? g : [...g, { id: ++seq, job: fx.job, from: { ...NEST }, to }]));
      } else if (fx.k === "vagrants") {
        const y = NEST.y;
        setGuests((g) => [...g, { id: ++seq, job: "forager", from: { x: -60, y }, to: { x: NEST.x - 30, y } }, { id: ++seq, job: "forager", from: { x: -110, y }, to: { x: NEST.x + 20, y } }]);
      }
    });
  }, []);

  // the animation loop
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      // under a scene / in a hidden tab the colony is not drawn: the rats wait where they are
      if (colonyPaused()) {
        last = now;
        return;
      }
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = now / 1000;
      const routesNow = cfg.current.routes;
      const hungryNow = cfg.current.hungry;
      const sp = sprites.current;
      const v = camView();
      const hy = v.ch / 2 / v.s + 50;
      const vy0 = v.cy - hy;
      const vy1 = v.cy + hy;
      for (let i = 0; i < sp.length; i++) {
        const s = sp[i];
        const el = els.current[i];
        if (!el || !routesNow) continue;
        let walking = false;
        if (s.stunned) {
          s.climb = 0;
        } else if (s.wait > 0) {
          s.wait -= dt;
        } else if (s.path.length === 0) {
          nextLeg(s, routesNow[s.job]);
        } else {
          walking = true;
          s.climb = walk(s, s.speed, dt);
          if (s.path.length === 0) {
            s.climb = 0;
            s.wait = s.job === "idle" ? 1.5 + Math.random() * 3 : s.atWork ? 2.5 + Math.random() * 3.5 : 0.6 + Math.random() * 1;
            // home with the cargo: drop it, the chamber gives a little squash
            if (s.carry && !s.atWork) {
              s.carry = false;
              const home = homeBuilding(routesNow[s.job]);
              if (home) pokeChamber(home, 0.15);
            }
          }
        }
        let tx = s.x;
        let ty = s.y;
        if (walking && s.climb === 0) ty -= Math.abs(Math.sin(t * 15 + s.phase)) * 1.8;
        if (hungryNow && !s.stunned) tx += Math.sin(t * 52 + s.phase) * 0.6;
        // off-screen sprites keep walking but are not rewritten (one last write moves them out of sight)
        const inView = ty > vy0 && ty < vy1;
        if (!inView && !s.shown) continue;
        s.shown = inView;
        el.setAttribute("transform", `translate(${tx.toFixed(1)} ${ty.toFixed(1)})`);
        const cargo = cargoEls.current[i];
        if (cargo) {
          const want = s.carry && walking && !s.stunned ? "1" : "0";
          if (cargo.getAttribute("opacity") !== want) cargo.setAttribute("opacity", want);
        }
        const tr = s.stunned ? "translate(0 -20) rotate(180)" : s.climb !== 0 ? `rotate(${s.climb < 0 ? -90 : 90})` : s.dir < 0 ? "scale(-1 1)" : "scale(1 1)";
        if (tr !== s.tr) {
          s.tr = tr;
          el.firstElementChild?.setAttribute("transform", tr);
        }
      }

      // residents: pace ±28 units, pause 1.5–4 s, face the machine, now and then a little hop
      const rs = residents.current;
      for (let i = 0; i < rs.length; i++) {
        const r = rs[i];
        const el = residentEls.current[i];
        if (!el) continue;
        if (r.wait > 0) {
          r.wait -= dt;
          if (r.wait <= 0) {
            r.target = r.home + (Math.random() * 2 - 1) * 28;
            if (Math.random() < 0.25) r.hop = 0.3;
          }
        } else {
          const dx = r.target - r.x;
          const step = 22 * dt;
          if (Math.abs(dx) <= step) {
            r.x = r.target;
            r.wait = 1.5 + Math.random() * 2.5;
            r.dir = r.home >= r.x ? 1 : -1;
          } else {
            r.x += Math.sign(dx) * step;
            r.dir = dx > 0 ? 1 : -1;
          }
        }
        if (r.hop > 0) r.hop = Math.max(0, r.hop - dt);
        const ry = r.y - (r.hop > 0 ? Math.sin((r.hop / 0.3) * Math.PI) * 3 : 0);
        const inView = ry > vy0 && ry < vy1;
        if (!inView && !r.shown) continue;
        r.shown = inView;
        el.setAttribute("transform", `translate(${r.x.toFixed(1)} ${ry.toFixed(1)})`);
        el.firstElementChild?.setAttribute("transform", r.dir < 0 ? "scale(-1 1)" : "scale(1 1)");
      }

      // guests: newborns running out of the nest, the first vagrants
      for (const [id, el] of guestEls.current) {
        let g = guestState.current.get(id);
        if (!g) {
          const def = guestsRef.current.find((x) => x.id === id);
          if (!def) continue;
          g = { x: def.from.x, y: def.from.y, path: routeBetween(def.from, def.to), fade: 1, dir: 1, done: false };
          guestState.current.set(id, g);
        }
        if (g.done) continue;
        let climb = 0;
        if (g.path.length) climb = walk(g, 95, dt);
        else {
          g.fade -= dt * 2.2;
          if (g.fade <= 0) {
            g.done = true;
            setGuests((gs) => gs.filter((x) => x.id !== id));
            continue;
          }
        }
        const bob = g.path.length && climb === 0 ? -Math.abs(Math.sin(t * 18 + id)) * 2 : 0;
        el.setAttribute("transform", `translate(${g.x.toFixed(1)} ${(g.y + bob).toFixed(1)})`);
        el.setAttribute("opacity", Math.max(0, Math.min(1, g.fade)).toFixed(2));
        el.firstElementChild?.setAttribute("transform", climb !== 0 ? `rotate(${climb < 0 ? -90 : 90})` : g.dir < 0 ? "scale(-1 1)" : "scale(1 1)");
      }
      // forget finished guests once React has unmounted them
      if (guestState.current.size > guestEls.current.size + 8) {
        for (const id of [...guestState.current.keys()]) if (!guestEls.current.has(id)) guestState.current.delete(id);
      }
    };
    raf = requestAnimationFrame(frame);
    const gs = guestState.current;
    return () => {
      cancelAnimationFrame(raf);
      gs.clear();
    };
  }, []);

  return (
    <g pointerEvents="none">
      {list.map((job, i) => (
        <g
          key={i}
          transform="translate(-600 -600)"
          ref={(el) => {
            els.current[i] = el;
          }}
        >
          <g>
            <RatBody job={job} fur={FURS[i % FURS.length]} looks={looks} />
          </g>
          {job !== "idle" && (
            <text
              ref={(el) => {
                cargoEls.current[i] = el;
              }}
              x="-9"
              y="-17"
              fontSize="8"
              textAnchor="middle"
              opacity="0"
            >
              {cargoIcon(job)}
            </text>
          )}
          {i >= list.length - stunnedN ? (
            <text y="-26" fontSize="12" textAnchor="middle" className="cv-sparkle">
              ✨
            </text>
          ) : hungry && i % 3 === 0 ? (
            <text y="-30" fontSize="12" textAnchor="middle">
              😟
            </text>
          ) : job === "idle" && i % 2 === 0 ? (
            <text x="10" y="-24" fontSize="9" className="cv-zzz" style={{ animationDelay: `${(i * 0.37) % 2.4}s` }}>
              💤
            </text>
          ) : null}
        </g>
      ))}
      {residentList.map((b, i) => (
        <g
          key={`r${b}`}
          transform={`translate(${BUILDING_SLOT[b].cx} ${BUILDING_SLOT[b].floor})`}
          ref={(el) => {
            residentEls.current[i] = el;
          }}
        >
          <g>
            <RatBody job="idle" fur={FURS[(i + 2) % FURS.length]} looks={looks} zoneLook={BUILDING_SLOT[b].zone as ZoneId} />
          </g>
        </g>
      ))}
      {guests.map((g) => (
        <g
          key={`g${g.id}`}
          transform={`translate(${g.from.x} ${g.from.y})`}
          ref={(el) => {
            if (el) guestEls.current.set(g.id, el);
            else guestEls.current.delete(g.id);
          }}
        >
          <g>
            <RatBody job={g.job} fur={FURS[g.id % FURS.length]} foreman={g.foreman} />
          </g>
        </g>
      ))}
      <g transform={`translate(${NEST.x} ${NEST.y - 60})`}>
        {Array.from({ length: HEART_POOL }, (_, i) => (
          <text
            key={i}
            ref={(el) => {
              heartEls.current[i] = el;
            }}
            className="cv-fb"
            opacity="0"
            fontSize="17"
            textAnchor="middle"
            fill="#ff7a9a"
            stroke="#2a1a0c"
            strokeWidth=".8"
          >
            ♥
          </text>
        ))}
      </g>
    </g>
  );
});

/** 😋 over the burrow while the cheese diet (Сытость) is active. */
export const SatietyBadge = memo(function SatietyBadge() {
  const on = useGame((s) => derivedOf(s.game).satietyActive);
  if (!on) return null;
  return (
    <g transform={`translate(${NEST.x + 92} ${bandTop("burrow") + 26})`} pointerEvents="none">
      <g className="cv-bob">
        <circle r="15" fill="#1b1613" opacity=".55" />
        <text y="7" fontSize="20" textAnchor="middle">
          😋
        </text>
      </g>
    </g>
  );
});
