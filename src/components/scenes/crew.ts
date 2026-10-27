/**
 * The rat crew on the rail head (v3 SCN-2): four rats holding a sagging tarp under the giant wheels, so the scale of the
 * Thunder God reads at a glance. Purely cosmetic — hit tests and catches never look at it; the loot draws over it.
 * The rats are RatBody svgs (colony/ratArt) rendered hidden by CrewSprites and rasterized here into a sprite cache
 * (XMLSerializer → Image → canvas: no react-dom/server in the bundle). Until a sprite is ready its rat is skipped.
 * The model (pose by crew position, tarp springs, squash-hops, ducking under a wheel) is pure and unit-tested.
 */
import type { CrewPosition, JobId } from "@/game/types";

/* ------------------------------------------------------------ the crew */

export interface CrewLook {
  job: JobId;
  fur: string;
  foreman?: boolean;
  /** Faces left (towards the middle of the line). */
  mirror: boolean;
}

/** Coal-miner cap, stoker, mechanic's goggles, the foreman's hat — varied furs (colony/ratArt FURS). */
export const CREW: readonly CrewLook[] = [
  { job: "coal_miner", fur: "#8a7f78", mirror: false },
  { job: "stoker", fur: "#5f5752", mirror: false },
  { job: "mechanic", fur: "#a39a92", mirror: true },
  { job: "forager", fur: "#6f6560", foreman: true, mirror: true },
];

/** Where the crew stands along the rail head (share of the canvas width). */
export const CREW_X = [0.14, 0.38, 0.62, 0.86] as const;

/** The RatBody box (its units: feet at y = 0, facing right) that the sprites cover. */
export const RAT_BOX = { x: -36, y: -34, w: 70, h: 36 } as const;
/** Sprite resolution: canvas px per RatBody unit. */
export const SPRITE_K = 4;

/** The crew position changes the stance: by the wall a step back (higher, smaller), between the ties a step closer. */
export const CREW_POSE: Record<CrewPosition, { dy: number; scale: number }> = {
  wall: { dy: -10, scale: 0.85 },
  rails: { dy: 0, scale: 1 },
  ties: { dy: 6, scale: 1.1 },
};

/** A catch this close to a tarp span (px) makes it sag … */
export const SAG_NEAR_PX = 90;
/** … this much (px), springing back. */
export const SAG_DIP = 6;
/** The nearest rat squash-hops for this long (s). */
export const HOP_S = 0.2;
/** A rat ducks while a wheel's centre passes within this share of the wheel radius. */
export const DUCK_R = 0.4;

/** The crew's height on screen (px) for a viewport whose smaller side is `vmin` px — CrewLine's clamp(34px, 6vmin, 60px). */
export function crewHeight(vmin: number): number {
  return Math.max(34, Math.min(60, 0.06 * (vmin > 0 ? vmin : 600)));
}

/** RatBody units → canvas px (the same size in the rumble's DOM line and on the pass's canvas). */
export function crewUnit(vmin: number): number {
  return crewHeight(vmin) / RAT_BOX.h;
}

export interface CrewState {
  /** Extra sag per tarp span (px) and its speed. */
  sag: number[];
  sagV: number[];
  /** Seconds left of each rat's squash-hop. */
  hop: number[];
  /** Last laid-out rats (canvas px), for crewCatch. */
  rats: { x: number; y: number }[];
  /** Last laid-out tarp spans: the two paws holding it. */
  spans: { x0: number; y0: number; x1: number; y1: number }[];
}

export function newCrew(): CrewState {
  return { sag: [0, 0, 0], sagV: [0, 0, 0], hop: [0, 0, 0, 0], rats: [], spans: [] };
}

/** Distance from a point to a segment. */
export function distToSegment(px: number, py: number, x0: number, y0: number, x1: number, y1: number): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const L2 = dx * dx + dy * dy;
  const u = L2 > 0 ? Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / L2)) : 0;
  return Math.hypot(px - (x0 + dx * u), py - (y0 + dy * u));
}

/**
 * A paw caught something at (x, y): the nearest tarp span within SAG_NEAR_PX dips SAG_DIP px, and the rat nearest to
 * the catch squash-hops. Returns the span that sagged (-1 none). Reads the layout of the last drawn frame.
 */
export function crewCatch(st: CrewState, x: number, y: number): number {
  let best = -1;
  let bd = Infinity;
  st.spans.forEach((s, i) => {
    const d = distToSegment(x, y, s.x0, s.y0, s.x1, s.y1);
    if (d <= SAG_NEAR_PX && d < bd) {
      bd = d;
      best = i;
    }
  });
  if (best >= 0) {
    st.sag[best] = Math.max(st.sag[best], SAG_DIP);
    st.sagV[best] = Math.max(0, st.sagV[best]);
    let rat = -1;
    let rd = Infinity;
    st.rats.forEach((r, i) => {
      const d = Math.abs(r.x - x);
      if (d < rd) {
        rd = d;
        rat = i;
      }
    });
    if (rat >= 0) st.hop[rat] = HOP_S;
  }
  return best;
}

/** Spring constants of the tarp (underdamped: two small wobbles, settled in ≈ 0.4 s). */
const SAG_K = 260;
const SAG_C = 14;

/** Advance the springs and the hops by dt seconds. */
export function stepCrew(st: CrewState, dt: number): void {
  if (!(dt > 0)) return;
  const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
  const h = dt / steps;
  for (let i = 0; i < st.sag.length; i++) {
    let s = st.sag[i];
    let v = st.sagV[i];
    for (let k = 0; k < steps; k++) {
      v += (-SAG_K * s - SAG_C * v) * h;
      s += v * h;
    }
    st.sag[i] = Math.abs(s) < 0.01 && Math.abs(v) < 0.05 ? 0 : s;
    st.sagV[i] = st.sag[i] === 0 ? 0 : v;
  }
  for (let i = 0; i < st.hop.length; i++) st.hop[i] = Math.max(0, st.hop[i] - dt);
}

/** The squash-hop at `left` seconds remaining: a squash, then a little jump. */
export function hopPose(left: number): { sx: number; sy: number; dy: number } {
  if (!(left > 0)) return { sx: 1, sy: 1, dy: 0 };
  const k = 1 - Math.min(1, left / HOP_S);
  if (k < 0.35) {
    const q = Math.sin((k / 0.35) * Math.PI);
    return { sx: 1 + 0.12 * q, sy: 1 - 0.2 * q, dy: 0 };
  }
  return { sx: 1, sy: 1, dy: -8 * Math.sin(((k - 0.35) / 0.65) * Math.PI) };
}

/** A rat at `x` ducks while some wheel centre is within DUCK_R · R of it. */
export function ducking(x: number, wheelXs: readonly number[], R: number): boolean {
  for (const cx of wheelXs) if (Math.abs(cx - x) <= DUCK_R * R) return true;
  return false;
}

/* ------------------------------------------------------------ sprites */

const sprites: (HTMLCanvasElement | null)[] = CREW.map(() => null);
const pending = new Set<number>();
const stars = new Map<string, HTMLCanvasElement>();

/** Rasterize crew rat `i` from its hidden svg (once per page; the cache outlives the passes). */
export function rasterizeCrew(i: number, svg: SVGSVGElement): void {
  if (sprites[i] || pending.has(i) || typeof Image === "undefined") return;
  pending.add(i);
  let xml = "";
  try {
    xml = new XMLSerializer().serializeToString(svg);
  } catch {
    pending.delete(i);
    return;
  }
  if (!xml.includes("xmlns=")) xml = xml.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
  const img = new Image();
  img.onload = () => {
    const c = document.createElement("canvas");
    c.width = RAT_BOX.w * SPRITE_K;
    c.height = RAT_BOX.h * SPRITE_K;
    const g = c.getContext("2d");
    if (g) {
      g.drawImage(img, 0, 0, c.width, c.height);
      sprites[i] = c;
    }
    pending.delete(i);
  };
  img.onerror = () => pending.delete(i);
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
}

/** A 💫 sprite (canvas text is slow per frame). */
function starSprite(font: string, dpr: number): HTMLCanvasElement {
  const key = `${dpr}`;
  const hit = stars.get(key);
  if (hit) return hit;
  const size = 20;
  const c = document.createElement("canvas");
  c.width = c.height = Math.ceil(size * 1.4 * dpr);
  const g = c.getContext("2d");
  if (g) {
    g.scale(dpr, dpr);
    g.font = `${size}px ${font}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("💫", size * 0.7, size * 0.74);
  }
  stars.set(key, c);
  return c;
}

/* ------------------------------------------------------------ drawing */

export interface CrewFrame {
  w: number;
  h: number;
  /** The rail head's top line (the crew's feet). */
  railY: number;
  position: CrewPosition;
  /** Wheel centres this frame and the wheel radius (ducking). */
  wheelXs: readonly number[];
  wheelR: number;
  /** Pass time (s): the crash pose lasts CRASH_LOCK_S plus a moment to get up. */
  t: number;
  /** The crew crashed this pass (lying, 💫). */
  crash: boolean;
  /** Seconds the crash lockout lasts. */
  crashLock: number;
  reduced: boolean;
  emojiFont: string;
  dpr: number;
  /** The viewport's smaller side (px): the crew is as tall as in the rumble's DOM line. */
  vmin: number;
}

const TARP = "#d9c9a4";
const TARP_EDGE = "#8a7a5c";
const STITCH = "#7a5a32";

/**
 * Lay the crew out for this frame, step the model (dt) and draw it: the tarp spans first, the rats over their ends.
 * At most 4 rat + 4 star drawImage calls per frame (the stars only while the crew is down after a crash).
 */
export function drawCrew(g: CanvasRenderingContext2D, st: CrewState, f: CrewFrame, dt: number): void {
  const u = crewUnit(f.vmin);
  const pose = CREW_POSE[f.position] ?? CREW_POSE.rails;
  const s = u * pose.scale;
  const down = f.crash && f.t < f.crashLock + 0.35;
  // getting back up over the last 0.35 s
  const fall = !f.crash ? 0 : f.t < f.crashLock ? 1 : Math.max(0, 1 - (f.t - f.crashLock) / 0.35);
  if (!f.reduced) stepCrew(st, dt);

  const rats = CREW_X.map((k) => ({ x: k * f.w, y: f.railY + pose.dy }));
  st.rats = rats;
  // the tarp hangs from each rat's raised head end, on the side of its neighbour
  const paw = (i: number, side: 1 | -1) => ({ x: rats[i].x + side * 12 * s, y: rats[i].y - 20 * s * (1 - 0.45 * fall) });
  st.spans = [0, 1, 2].map((i) => {
    const a = paw(i, 1);
    const b = paw(i + 1, -1);
    return { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
  });

  // tarp spans: a cloth band along a quadratic sag, stitched down the middle
  g.save();
  g.lineJoin = "round";
  for (let i = 0; i < st.spans.length; i++) {
    const sp = st.spans[i];
    const len = Math.hypot(sp.x1 - sp.x0, sp.y1 - sp.y0);
    const sag = 7 * u + len * 0.05 + (f.reduced ? 0 : st.sag[i]) + 10 * u * fall;
    const mx = (sp.x0 + sp.x1) / 2;
    const my = (sp.y0 + sp.y1) / 2 + 2 * sag;
    const th = 5 * u;
    g.beginPath();
    g.moveTo(sp.x0, sp.y0);
    g.quadraticCurveTo(mx, my, sp.x1, sp.y1);
    g.lineTo(sp.x1, sp.y1 + th);
    g.quadraticCurveTo(mx, my + th * 1.6, sp.x0, sp.y0 + th);
    g.closePath();
    g.fillStyle = TARP;
    g.fill();
    g.strokeStyle = TARP_EDGE;
    g.lineWidth = 1.2;
    g.stroke();
    // a shadow fold under the belly of the sag
    g.strokeStyle = "rgba(60,40,20,.25)";
    g.lineWidth = 2 * u;
    g.beginPath();
    g.moveTo(sp.x0 + (mx - sp.x0) * 0.4, sp.y0 + th + (my - sp.y0) * 0.36);
    g.quadraticCurveTo(mx, my + th * 1.5, sp.x1 + (mx - sp.x1) * 0.4, sp.y1 + th + (my - sp.y1) * 0.36);
    g.stroke();
    g.setLineDash([4 * u, 3 * u]);
    g.strokeStyle = STITCH;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(sp.x0, sp.y0 + th / 2);
    g.quadraticCurveTo(mx, my + th * 0.8, sp.x1, sp.y1 + th / 2);
    g.stroke();
    g.setLineDash([]);
  }
  g.restore();

  // the rats (feet on the rail line); ducking under a wheel, hopping after a catch, lying after a crash
  const bw = RAT_BOX.w * s;
  const bh = RAT_BOX.h * s;
  for (let i = 0; i < rats.length; i++) {
    const img = sprites[i];
    if (!img) continue;
    const r = rats[i];
    const look = CREW[i];
    const hp = f.reduced ? { sx: 1, sy: 1, dy: 0 } : hopPose(st.hop[i]);
    const duck = !f.reduced && !down && ducking(r.x, f.wheelXs, f.wheelR) ? 0.6 : 1;
    g.save();
    g.translate(r.x, r.y + hp.dy);
    if (fall > 0) g.rotate((look.mirror ? 1 : -1) * 0.5 * fall);
    g.scale((look.mirror ? -1 : 1) * hp.sx, hp.sy * duck);
    g.drawImage(img, RAT_BOX.x * s, RAT_BOX.y * s, bw, bh);
    g.restore();
  }

  // dizzy stars over the rail while the crew is down
  if (down) {
    const star = starSprite(f.emojiFont, f.dpr);
    const sz = 18 * u;
    for (let i = 0; i < rats.length; i++) {
      const a = (f.reduced ? 0 : f.t * 5) + i * 1.7;
      const x = rats[i].x + Math.cos(a) * 10 * u;
      const y = rats[i].y - 30 * s + Math.sin(a) * 4 * u;
      g.globalAlpha = Math.min(1, 0.4 + fall);
      g.drawImage(star, x - sz / 2, y - sz / 2, sz, sz);
    }
    g.globalAlpha = 1;
  }
}
