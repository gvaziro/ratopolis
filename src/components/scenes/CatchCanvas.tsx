"use client";

/**
 * The `catch` primitive: a canvas of falling / flying / floating items (scene.items) that the player
 * taps or swipes. Combo, sparks, conductor's lantern, wire nets and the clockwork legion live here,
 * plus (metro / express) the live rating gauge with its medal notches and the «Вагон чист!» beats.
 * Keyboard: ←/→ walk a paw along the catch line, holding Space is a pointer held down at the paw.
 * Everything per-frame stays in closures and refs — no React state updates while it runs.
 */
import { useEffect, useRef, type RefObject } from "react";
import { sfx } from "@/audio/sfx";
import { LANTERN_MULT, POSITION_FEEL, RATING_TABLE, TRAIN_VARIANTS } from "@/game/data/events";
import { RESOURCES } from "@/game/data/resources";
import { catchProgress } from "@/game/engine/events";
import { sfxCue } from "@/game/fx";
import { derivedOf, useGame } from "@/game/store";
import type { CatchItem, CatchResult, ResId, Scene } from "@/game/types";
import { fmt, fmtPct } from "@/lib/format";
import {
  buzz,
  carLeft,
  carriageShadowX,
  clamp,
  EMOJI_FONT,
  fallGeom,
  flicker,
  floatGeom,
  fonts,
  hash01,
  hexA,
  lerp,
  noteKeyboard,
  keyboardUsed,
  shake,
  trainGeom,
  type FallGeom,
  type TrainGeom,
} from "./sceneUtils";

/**
 * Props of the `catch` primitive.
 * Renders scene.items on a canvas and lets the player click/swipe them; calls onDone(result) exactly once
 * when every item has expired or been caught (≈ phaseStart + max(item.t) + itemLife).
 * Geometry: train — items bounce on the 70% line; fall — grate at 11%, floor at 86%; float — water line at 62%.
 */
export interface CatchCanvasProps {
  scene: Scene;
  /** train: items drop from car undersides moving right→left; fall: through the grate from the top; float: drift right→left on water. */
  mode: "train" | "fall" | "float";
  onDone: (result: CatchResult) => void;
  /** Called with the combo step on every catch (scenes may add their own juice). */
  onCatch?: (combo: number) => void;
  className?: string;
}

/** Imperative channel between a scene and its canvas (hook outcome, slow-mo, particle bursts). */
export interface CatchControl {
  hook: CatchResult["hook"];
  /** performance.now() until which the canvas runs at half speed. */
  slowUntil: number;
  /** Set by the canvas while mounted. `norm` = coordinates are fractions of the canvas size. */
  burst: ((x: number, y: number, color: string, n: number, norm?: boolean) => void) | null;
  /** While the hook's timing bar is up, Space throws the hook instead of closing the keyboard paw. */
  hookOpen: boolean;
}

export function newCatchControl(): CatchControl {
  return { hook: "none", slowUntil: 0, burst: null, hookOpen: false };
}

/** Extra hooks for scenes that build on the primitive (trains, carriage). */
export interface CatchCanvasExtra {
  control?: RefObject<CatchControl>;
  /** Draw scenery that must stay in sync with the items (train cars, wheel shadow…), before the items. */
  drawBack?: (g: CanvasRenderingContext2D, w: number, h: number, t: number, dt: number) => void;
  /** Draw over the items but under the HUD. */
  drawFront?: (g: CanvasRenderingContext2D, w: number, h: number, t: number, dt: number) => void;
  /** Called every frame with the canvas clock (seconds since phase start, slow-mo aware). */
  onFrame?: (t: number, dt: number) => void;
  /** Called when an item appears (canvas px). */
  onSpawn?: (item: CatchItem, x: number, y: number) => void;
}

/* ------------------------------------------------------------ internals */

const MAX_PARTICLES = 140;
const MAX_FLOATS = 40;
const TAP_LIMIT = 15;
const FADE = 0.35;
/** Live rating gauge (css px, drawn under the 🐾 counter). */
const GAUGE_W = 160;
const GAUGE_H = 8;
/** Keyboard paw: top speed (px/s), ease-in time to reach it, catch radius and how far up the paw reaches. */
const PAW_SPEED = 900;
const PAW_EASE = 0.15;
const PAW_R = 40;
const PAW_REACH = 46;
/** Synthetic pointer id of the keyboard paw. */
const KEY_ID = -7;
/** Medal tiers of the gauge, lowest first (bronze 40%, silver 65%, gold 85%, royal 95%). */
const TIERS = RATING_TABLE.filter((r) => r.min > 0)
  .slice()
  .sort((a, b) => a.min - b.min);
const ROYAL = TIERS.findIndex((r) => r.id === "royal");

interface Body {
  it: CatchItem;
  st: 0 | 1 | 2; // waiting, live, gone
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  age: number;
  bounces: number;
  landed: boolean;
  inCone: boolean;
  r: number;
  /** First ground contact happened (sparks: 'ties' grab check runs once, on that frame). */
  touched: boolean;
  justLanded: boolean;
}

interface Part {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  color: string;
  kind: 0 | 1 | 2; // dot, star, puff
}

interface FloatText {
  text: string;
  x: number;
  y: number;
  color: string;
  age: number;
  life: number;
  size: number;
  /** How far it drifts up over its life (px). */
  rise: number;
}

interface Ghost {
  img: HTMLCanvasElement;
  x: number;
  y: number;
  rot: number;
  age: number;
  full: number;
  net: boolean;
}

interface Banner {
  text: string;
  sub: string;
  color: string;
  age: number;
  life: number;
}

interface Track {
  x: number;
  y: number;
  type: string;
  armed: boolean;
  downX: number;
  downY: number;
  trail: { x: number; y: number; at: number }[];
  /** The keyboard paw also sweeps this many px straight up from its point. */
  reach: number;
}

export default function CatchCanvas(props: CatchCanvasProps) {
  return <CatchCanvasCore {...props} />;
}

export function CatchCanvasCore(props: CatchCanvasProps & CatchCanvasExtra) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef(props);
  useEffect(() => {
    propsRef.current = props;
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !wrap || !ctx) return;

    const p0 = propsRef.current;
    const sc = p0.scene;
    const mode = p0.mode;
    const game0 = useGame.getState().game;
    const reduced = game0.settings.reducedMotion;
    const mitts = !!game0.upgrades.asbestos_mitts;
    const capsule = sc.id === "capsule";
    const legion = mode === "train" && !!game0.upgrades.clockwork_legion;
    const lanternOn = mode === "train" && sc.lantern;
    const nets = mode === "train" ? [...sc.nets] : [];
    const perCar = sc.perCar > 0 ? sc.perCar : 2;
    const life = sc.itemLife > 0 ? sc.itemLife : 2;
    const passDur = Math.max(1, sc.cars.length) * perCar;
    const lanternT0 = passDur / 3;
    const lanternT1 = lanternT0 + 6;
    const phaseStart = sc.phaseStart;
    const F = fonts();
    const partK = reduced ? 0.3 : 1;
    // crew position feel (metro / express): hit radius, and at 'ties' sparks stick to a held paw on landing
    const feel: { hitR: number; sparkGrabPx?: number } = mode === "train" && !capsule ? (POSITION_FEEL[sc.position] ?? POSITION_FEEL.rails) : POSITION_FEEL.rails;
    const hitK = feel.hitR;
    const grabPx = feel.sparkGrabPx ?? 0;
    // the live rating only exists where the engine rates the haul (metro, express)
    const gauge = mode === "train" && !capsule;
    const lanternSusp = game0.zones.cellars ? 5 * (derivedOf(game0).suspicionMult ?? 1) : 0;
    // SC-4: the train variant's physics — rail bounce, bobbing on the flood water, fluttering letters
    const physics = mode === "train" && sc.variant ? TRAIN_VARIANTS[sc.variant].physics : "bounce";

    let W = 0;
    let H = 0;
    let dpr = 1;
    let tg: TrainGeom = trainGeom(1, 1, perCar, capsule);
    let fg: FallGeom = fallGeom(1, 1);
    let t = Math.max(0, game0.time - phaseStart);

    const bodies: Body[] = sc.items.map((it) => ({ it, st: 0, x: 0, y: 0, vx: 0, vy: 0, rot: 0, vr: 0, age: 0, bounces: 0, landed: false, inCone: false, r: 16, touched: false, justLanded: false }));
    let remaining = bodies.length;
    const caughtIds = new Set<number>();
    const lostIds = new Set<number>();
    // sparks the engine left out of this pass (item.skip, 'wall') never appear; items that already ended before we
    // mounted (reload mid-phase) vanish silently and count as lost
    for (const b of bodies) {
      if (b.it.skip || b.it.t + life <= t) {
        b.st = 2;
        remaining--;
        if (!b.it.skip && !b.it.spark) lostIds.add(b.it.id);
      }
    }
    const totalCount = sc.items.filter((i) => !i.spark && !i.skip).length;

    // live rating (SC-2): exactly the engine's weights, recomputed once per frame when something changed
    let prog = catchProgress(sc, caughtIds, lostIds);
    let progDirty = false;
    let fill = 0;
    const tierAt = TIERS.map(() => -1);
    // tiers already out of reach at mount (reload mid-phase) start greyed, without a sound
    const tierLostAt = TIERS.map((r): number => (prog.maxReachable < r.min - 1e-9 ? 0 : -1));
    let crownCrossedAt = -1;
    // per car: its real (non-spark) items, and whether «Вагон чист!» was already shown
    const carItems = sc.cars.map((c) => {
      const ids = new Set(c.itemIds);
      return sc.items.filter((it) => ids.has(it.id) && !it.spark && !it.skip).map((it) => it.id);
    });
    const carClean = sc.cars.map(() => false);
    let lanternTotal = 0;

    const caught: CatchResult["caught"] = [];
    const netted: number[] = [];
    let sparksHit = 0;
    let combo = 0;
    let maxCombo = 0;
    let comboAt = -9;
    let brokenAt = -9;
    let brokenCombo = 0;
    let gotCount = 0;
    const netUsed: Set<number>[] = [new Set(), new Set(), new Set()];
    const netKick = [0, 0, 0];
    let legionAcc = 0;
    let legionCount = 0;
    const parts: Part[] = [];
    const floats: FloatText[] = [];
    const ghosts: Ghost[] = [];
    const legionFx: { x: number; y: number; age: number }[] = [];
    const banners: Banner[] = [];
    let lanternAnnounced = false;
    let finished = false;
    let doneAt = -1;
    let bumpCd = 0;
    let popCd = 0;
    const pointers = new Map<number, Track>();
    const taps: number[] = [];
    let hover: { x: number; y: number } | null = null;
    // keyboard paw: x along the catch line (set on the first layout), direction keys held, time on the current heading
    const paw = { x: -1, dirL: false, dirR: false, heldFor: 0, dir: 0 };
    let kbd = keyboardUsed();

    /* ---------------- sprites */
    const sprites = new Map<string, HTMLCanvasElement>();
    const itemSize = () => (W < 520 ? 30 : 34);

    function resSprite(res: ResId, size: number, gold: boolean): HTMLCanvasElement {
      const key = `${res}|${size}|${dpr}|${gold ? 1 : 0}`;
      const hit = sprites.get(key);
      if (hit) return hit;
      const pad = Math.round(size * 0.5);
      const full = size + pad * 2;
      const c = document.createElement("canvas");
      c.width = c.height = Math.ceil(full * dpr);
      const g = c.getContext("2d");
      if (g) {
        g.scale(dpr, dpr);
        const m = full / 2;
        const col = gold ? "#ffd56b" : RESOURCES[res].color;
        const gr = g.createRadialGradient(m, m, size * 0.08, m, m, m);
        gr.addColorStop(0, hexA(col, gold ? 0.8 : 0.5));
        gr.addColorStop(0.5, hexA(col, gold ? 0.32 : 0.15));
        gr.addColorStop(1, hexA(col, 0));
        g.fillStyle = gr;
        g.fillRect(0, 0, full, full);
        // the gold variant is a pure lantern halo drawn under the regular sprite
        if (!gold) {
          g.font = `${size}px ${EMOJI_FONT}`;
          g.textAlign = "center";
          g.textBaseline = "middle";
          g.shadowColor = "rgba(0,0,0,.6)";
          g.shadowBlur = 3;
          g.shadowOffsetY = 2;
          g.fillText(RESOURCES[res].icon, m, m + size * 0.06);
        }
      }
      sprites.set(key, c);
      return c;
    }

    function sparkSprite(size: number): HTMLCanvasElement {
      const key = `spark|${size}|${dpr}`;
      const hit = sprites.get(key);
      if (hit) return hit;
      const full = size * 2;
      const c = document.createElement("canvas");
      c.width = c.height = Math.ceil(full * dpr);
      const g = c.getContext("2d");
      if (g) {
        g.scale(dpr, dpr);
        const m = full / 2;
        const gr = g.createRadialGradient(m, m, 0, m, m, m);
        gr.addColorStop(0, "rgba(255,252,230,1)");
        gr.addColorStop(0.18, "rgba(255,214,120,1)");
        gr.addColorStop(0.42, "rgba(255,110,40,.85)");
        gr.addColorStop(0.7, "rgba(200,40,10,.35)");
        gr.addColorStop(1, "rgba(160,20,0,0)");
        g.fillStyle = gr;
        g.fillRect(0, 0, full, full);
      }
      sprites.set(key, c);
      return c;
    }

    function emojiSprite(icon: string, size: number): HTMLCanvasElement {
      const key = `e|${icon}|${size}|${dpr}`;
      const hit = sprites.get(key);
      if (hit) return hit;
      const full = size * 1.4;
      const c = document.createElement("canvas");
      c.width = c.height = Math.ceil(full * dpr);
      const g = c.getContext("2d");
      if (g) {
        g.scale(dpr, dpr);
        g.font = `${size}px ${EMOJI_FONT}`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(icon, full / 2, full / 2 + size * 0.06);
      }
      sprites.set(key, c);
      return c;
    }

    /* ---------------- fx helpers */
    function addPart(p: Part) {
      if (parts.length < MAX_PARTICLES) parts.push(p);
    }

    function burst(x: number, y: number, color: string, n: number, norm = false) {
      if (norm) {
        x *= W;
        y *= H;
      }
      const count = Math.max(1, Math.round(n * partK));
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 60 + Math.random() * 190;
        addPart({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60, age: 0, life: 0.35 + Math.random() * 0.35, size: 1.6 + Math.random() * 2.4, color, kind: i % 4 === 0 ? 1 : 0 });
      }
    }

    function puff(x: number, y: number, n: number, color = "rgba(190,175,150,.5)") {
      const count = Math.max(1, Math.round(n * partK));
      for (let i = 0; i < count; i++) {
        addPart({ x: x + (Math.random() - 0.5) * 10, y, vx: (Math.random() - 0.5) * 70, vy: -20 - Math.random() * 40, age: 0, life: 0.45 + Math.random() * 0.3, size: 4 + Math.random() * 5, color, kind: 2 });
      }
    }

    function addFloat(text: string, x: number, y: number, color: string, size: number, lifeS = 0.75, rise = 42) {
      if (floats.length >= MAX_FLOATS) floats.shift();
      floats.push({ text, x: clamp(x, 24, Math.max(24, W - 24)), y, color, age: 0, life: lifeS, size, rise });
    }

    function banner(text: string, sub: string, color: string, lifeS = 1.6) {
      banners.length = 0;
      banners.push({ text, sub, color, age: 0, life: lifeS });
    }

    function ghostOf(b: Body, net: boolean) {
      if (b.it.spark) return;
      const size = itemSize();
      const img = resSprite(b.it.res, size, false);
      ghosts.push({ img, x: b.x, y: b.y, rot: b.rot, age: 0, full: size * 2, net });
    }

    const ctl = () => propsRef.current.control?.current ?? null;
    {
      const c = ctl();
      if (c) c.burst = burst;
    }

    /* ---------------- geometry & spawn */
    function relayout() {
      tg = trainGeom(W, H, perCar, capsule);
      fg = fallGeom(W, H);
    }

    function spawn(b: Body) {
      const it = b.it;
      const r1 = hash01(it.id, 11);
      const r2 = hash01(it.id, 23);
      const r3 = hash01(it.id, 37);
      b.r = itemSize() / 2;
      if (mode === "train") {
        const left = carLeft(tg, it.car, it.t, perCar);
        // capsules only drop from the cylinder itself (middle 50% of its slot)
        const inset = capsule ? tg.carLen * 0.25 : tg.gap + 12;
        const lo = Math.max(left + inset, W * 0.1);
        const hi = Math.min(left + tg.carLen - inset, W * 0.92);
        b.x = hi > lo ? lo + (hi - lo) * r1 : clamp(left + tg.carLen / 2, W * 0.1, W * 0.9);
        b.y = tg.dropY;
        const vs = clamp(W / 900, 0.55, 1);
        b.vx = -0.3 * tg.speed * vs * (0.8 + 0.4 * r2) * (it.spark ? 1.25 : 1);
        b.vy = -(2 + 3 * r3) * H * 0.06 * (it.spark ? 1.3 : 1);
        b.vr = (r2 - 0.5) * 7;
      } else if (mode === "fall") {
        const sx = carriageShadowX(it.t, W) + (r1 - 0.5) * W * 0.32;
        const k = clamp(Math.floor((sx - fg.x0) / fg.slotW), 0, fg.slots - 1);
        b.x = fg.x0 + (k + 0.5) * fg.slotW;
        b.y = fg.grateY - b.r * 0.4;
        b.vx = (r2 - 0.5) * W * 0.07;
        b.vy = H * (0.04 + 0.08 * r3);
        b.vr = (r2 - 0.5) * 4;
      } else {
        b.x = W * (0.5 + 0.42 * r1);
        b.y = floatGeom(W, H).waterY + 26;
        b.vx = -W * (0.15 + 0.1 * r2) * (2.4 / life);
        b.vy = 0;
        b.vr = 0;
      }
      b.st = 1;
      b.age = 0;
      propsRef.current.onSpawn?.(it, b.x, b.y);
    }

    function stepBody(b: Body, dt: number) {
      b.age += dt;
      if (mode === "float") {
        const wy = floatGeom(W, H).waterY;
        const emerge = clamp(b.age / 0.3);
        const sink = clamp((b.age - (life - FADE)) / FADE);
        b.x += b.vx * dt;
        b.y = wy - b.r * 0.35 + Math.sin(b.age * 3.2 + b.it.id) * 5 + (1 - emerge) * 26 + sink * 22;
        b.rot = Math.sin(b.age * 2.1 + b.it.id) * 0.28;
        if (b.x < b.r) {
          b.x = b.r;
          b.vx = Math.abs(b.vx) * 0.4;
        }
        return;
      }
      const floor = mode === "train" ? tg.railY : fg.floorY;
      const gk = (mode === "train" ? 2.4 : 1.5) * H * Math.pow(2 / life, 2) * (b.it.spark ? 0.45 : 1) * (physics === "flutter" && !b.it.spark ? 0.6 : 1);
      if ((mode === "fall" || (physics === "flutter" && !b.it.spark)) && !b.landed) b.vx += Math.sin(b.age * 4 + b.it.id) * W * 0.03 * dt;
      if (physics === "float" && b.landed && !b.it.spark) {
        // flooded tracks: the item bobs on the water at the rail (6 px, 1.4 s) and drifts with the current
        b.y = floor - b.r * 0.82 - 4 + Math.sin(((b.age + b.it.id * 0.37) * Math.PI * 2) / 1.4) * (reduced ? 0 : 6);
        b.x += b.vx * dt;
        b.vx *= Math.exp(-0.8 * dt);
        b.rot = Math.sin(b.age * 2.1 + b.it.id) * 0.25;
        if (b.x < b.r) {
          b.x = b.r;
          b.vx = Math.abs(b.vx) * 0.4;
        }
        return;
      }
      b.vy += gk * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (!b.landed) b.rot += b.vr * dt;
      const ground = floor - b.r * 0.82;
      if (b.y >= ground) {
        b.y = ground;
        if (!b.touched) {
          b.touched = true;
          b.justLanded = true;
        }
        if (b.bounces < 1 && b.vy > H * 0.15) {
          b.vy = -b.vy * (mode === "train" ? 0.42 : 0.34);
          b.vx *= 0.85;
          b.vr *= -0.6;
          b.bounces++;
          if (!b.it.spark) puff(b.x, floor, 2);
        } else {
          b.vy = 0;
          b.landed = true;
        }
      }
      if (b.landed) {
        b.vx *= Math.exp(-2.4 * dt);
        b.rot += (b.vx / b.r) * dt;
      }
      if (b.x < b.r) {
        b.x = b.r;
        b.vx = Math.abs(b.vx) * 0.5;
      } else if (b.x > W - b.r) {
        b.x = W - b.r;
        b.vx = -Math.abs(b.vx) * 0.5;
      }
    }

    /* ---------------- lantern */
    function cone(): { ax: number; bx: number; hw: number; a: number; top: number; bot: number } | null {
      if (!lanternOn || t < lanternT0 || t > lanternT1) return null;
      const k = (t - lanternT0) / (lanternT1 - lanternT0);
      const a = Math.min(1, (t - lanternT0) / 0.4, (lanternT1 - t) / 0.4);
      const bx = W * (1.08 - 1.16 * k) + Math.sin(t * 2.4) * W * 0.05;
      return { ax: bx + W * 0.07, bx, hw: Math.max(72, W * 0.12), a, top: -H * 0.12, bot: tg.railY + 6 };
    }
    function insideCone(c: NonNullable<ReturnType<typeof cone>>, x: number, y: number): boolean {
      const f = clamp((y - c.top) / (c.bot - c.top));
      return Math.abs(x - lerp(c.ax, c.bx, f)) <= lerp(6, c.hw, f);
    }

    /* ---------------- catching */
    function breakCombo() {
      if (combo > 0) {
        brokenCombo = combo;
        brokenAt = t;
      }
      combo = 0;
    }

    const GAUGE_Y = 27;
    /** A short note under the gauge's medal row (right-aligned to it, barely drifting, so it never covers the gauge). */
    let noteUntil = -1;
    function gaugeNote(text: string, color: string, lifeS: number) {
      const half = Math.min(W / 2 - 12, text.length * 3.7);
      addFloat(text, W - 12 - half, GAUGE_Y + 38, color, 12, lifeS, 6);
      noteUntil = t + lifeS;
    }

    function collect(b: Body) {
      b.st = 2;
      remaining--;
      if (b.it.spark) {
        sparksHit++;
        buzz(40);
        if (mitts) {
          addFloat("🪨", b.x, b.y - 12, "#c9c9c9", 22);
          burst(b.x, b.y, "#b0b0b0", 7);
          sfx.coin();
        } else {
          addFloat("Ай!", b.x, b.y - 14, "#ff6a4a", 22);
          burst(b.x, b.y, "#ff7a3a", 12);
          sfx.ouch();
          breakCombo();
          shake(3, 300);
          // the engine never rates a pass royal after a bare-pawed spark: say so on the gauge right away
          if (gauge && crownCrossedAt < 0) {
            crownCrossedAt = t;
            if (tierLostAt[ROYAL] < 0) gaugeNote("искра — короны не будет", "#ff8a6a", 1.8);
          }
        }
        return;
      }
      combo++;
      maxCombo = Math.max(maxCombo, combo);
      comboAt = t;
      gotCount++;
      caughtIds.add(b.it.id);
      progDirty = true;
      const lantern = lanternOn && b.inCone;
      caught.push({ id: b.it.id, combo, lantern });
      const v = b.it.value * (1 + 0.02 * Math.min(combo, 25)) * (lantern ? LANTERN_MULT : 1);
      const col = RESOURCES[b.it.res].color;
      addFloat(`+${fmt(v)}${lantern ? " 🏮" : ""}`, b.x, b.y - 16, col, combo >= 10 ? 20 : 17);
      if (lantern && lanternSusp > 0) {
        lanternTotal += lanternSusp;
        addFloat(`+${fmt(lanternSusp)} 👁`, b.x + 22, b.y - 40, "#c39bff", 14, 0.95);
      }
      burst(b.x, b.y, col, 9);
      ghostOf(b, false);
      sfx.blip(combo);
      buzz(8);
      propsRef.current.onCatch?.(combo);
      if (combo === 10 || combo === 25 || (combo > 25 && combo % 25 === 0)) {
        banner(`КОМБО ×${combo}!`, combo >= 25 ? "добыча +50% — предел!" : `добыча +${2 * combo}%`, combo >= 25 ? "#ff9a4a" : "#f5d76e", 1.3);
        shake(combo >= 25 ? 5 : 3, 380);
      }
    }

    function lost(b: Body) {
      b.st = 2;
      remaining--;
      if (b.it.spark) return;
      lostIds.add(b.it.id);
      progDirty = true;
      if (combo >= 3) addFloat(`×${combo} — сорвано`, b.x, b.y - 10, "#b9ab94", 13, 0.9);
      breakCombo();
      puff(b.x, b.y + b.r * 0.5, 2, "rgba(120,110,95,.5)");
      if (bumpCd <= 0) {
        sfx.bump();
        bumpCd = 0.15;
      }
    }

    function catchByHelper(b: Body, how: "net" | "legion") {
      b.st = 2;
      remaining--;
      gotCount++;
      netted.push(b.it.id);
      caughtIds.add(b.it.id);
      progDirty = true;
      const col = RESOURCES[b.it.res].color;
      addFloat(`+${fmt(b.it.value)} ${how === "net" ? "🕸" : "⚙"}`, b.x, b.y - 12, hexA(col, 0.9), 14);
      ghostOf(b, true);
      if (popCd <= 0) {
        if (how === "net") sfx.pop();
        else sfx.click();
        popCd = 0.08;
      }
    }

    /** Medal tiers reached or gone for good (once each): banners and cues for the gauge. */
    function rateBeats() {
      let reached = -1;
      let gone = false;
      for (let k = 0; k < TIERS.length; k++) {
        if (tierAt[k] < 0 && prog.share >= TIERS[k].min - 1e-9) {
          tierAt[k] = t;
          if (!(k === ROYAL && crownCrossedAt >= 0)) reached = k;
        } else if (tierAt[k] < 0 && tierLostAt[k] < 0 && prog.maxReachable < TIERS[k].min - 1e-9) {
          tierLostAt[k] = t;
          gone = true;
        }
      }
      if (reached >= 0) {
        const row = TIERS[reached];
        if (row.bonus > 0) {
          banner(`${row.icon} ${row.name}!`, `добыча +${fmtPct(row.bonus)}`, row.id === "royal" ? "#ffd86b" : "#f5d76e", 1.5);
          sfxCue("medalTier");
        } else {
          // bronze adds no bonus: a quiet note by the gauge instead of a banner
          gaugeNote(`${row.icon} ${row.name} — рейтинг есть`, "#e0b07a", 1.3);
          sfxCue("medalTier", { intensity: 0.5 });
        }
      }
      if (gone) sfxCue("tierLost");
    }

    /** «Вагон чист!» once per car whose every real item has been caught (by paw, net or clockwork). */
    function carBeats() {
      for (let k = 0; k < carItems.length; k++) {
        if (carClean[k] || carItems[k].length === 0 || !carItems[k].every((id) => caughtIds.has(id))) continue;
        carClean[k] = true;
        const x = clamp(carLeft(tg, k, t, perCar) + tg.carLen / 2, 70, Math.max(70, W - 70));
        const y = capsule ? (tg.tubeTop + tg.tubeBot) / 2 : tg.underY * 0.62;
        addFloat(capsule ? "Капсула пуста!" : "Вагон чист!", x, y, "#a5e88f", W < 520 ? 18 : 22, 1.4);
        if (!reduced) burst(x, y, "#c9f2a0", 14);
        sfxCue("carClear");
      }
    }

    function tryCollect(x0: number, y0: number, x1: number, y1: number, R: number) {
      const dx = x1 - x0;
      const dy = y1 - y0;
      const L2 = dx * dx + dy * dy;
      const hits: { b: Body; u: number }[] = [];
      for (const b of bodies) {
        if (b.st !== 1) continue;
        const u = L2 > 0 ? clamp(((b.x - x0) * dx + (b.y - y0) * dy) / L2) : 0;
        const ex = b.x - (x0 + dx * u);
        const ey = b.y - (y0 + dy * u);
        if (ex * ex + ey * ey <= R * R) hits.push({ b, u });
      }
      if (hits.length > 1) hits.sort((a, c) => a.u - c.u);
      for (const h of hits) collect(h.b);
    }

    // the crew position scales every paw (POSITION_FEEL.hitR: 'ties' 1.3×, 'wall' 0.85×)
    const hitR = (type: string) => (type === "touch" ? 40 : type === "key" ? PAW_R : 28) * hitK;

    /** Sweep a paw from one point to the next (the keyboard paw also reaches straight up). */
    function sweep(tr: Track, x0: number, y0: number, x1: number, y1: number) {
      const R = hitR(tr.type);
      tryCollect(x0, y0, x1, y1, R);
      if (tr.reach > 0) tryCollect(x1, y1 - tr.reach, x1, y1, R);
    }

    /* ---------------- pointer input (real pointers and the keyboard paw share these) */
    const toLocal = (r: DOMRect, cx: number, cy: number) => ({
      x: (cx - r.left) * (r.width > 0 ? W / r.width : 1),
      y: (cy - r.top) * (r.height > 0 ? H / r.height : 1),
    });

    function pointerDown(id: number, type: string, x: number, y: number) {
      if (finished) return;
      const now = performance.now();
      while (taps.length && now - taps[0] > 1000) taps.shift();
      const allowed = taps.length < TAP_LIMIT;
      if (allowed) taps.push(now);
      const tr: Track = { x, y, type, armed: allowed, downX: x, downY: y, trail: [{ x, y, at: now }], reach: type === "key" ? PAW_REACH : 0 };
      pointers.set(id, tr);
      if (allowed) sweep(tr, x, y, x, y);
    }

    function pointerMove(id: number, pts: { x: number; y: number }[]) {
      const tr = pointers.get(id);
      if (!tr) return;
      const now = performance.now();
      for (const p of pts) {
        if (!tr.armed && Math.hypot(p.x - tr.downX, p.y - tr.downY) > 6) tr.armed = true;
        if (tr.armed && !finished) sweep(tr, tr.x, tr.y, p.x, p.y);
        tr.x = p.x;
        tr.y = p.y;
        tr.trail.push({ x: p.x, y: p.y, at: now });
      }
      if (tr.trail.length > 28) tr.trail.splice(0, tr.trail.length - 28);
    }

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      e.preventDefault();
      kbd = false;
      noteKeyboard(false);
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* not capturable */
      }
      const p = toLocal(canvas.getBoundingClientRect(), e.clientX, e.clientY);
      pointerDown(e.pointerId, e.pointerType, p.x, p.y);
    };

    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      if (!pointers.has(e.pointerId)) {
        if (e.pointerType === "mouse") hover = toLocal(r, e.clientX, e.clientY);
        return;
      }
      const evs = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
      pointerMove(
        e.pointerId,
        (evs.length ? evs : [e]).map((ev) => toLocal(r, ev.clientX, ev.clientY)),
      );
    };

    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
    };
    const onLeave = (e: PointerEvent) => {
      if (e.pointerType === "mouse") hover = null;
    };
    const onCtx = (e: Event) => e.preventDefault();
    const onBlur = () => {
      pointers.clear();
      paw.dirL = paw.dirR = false;
    };

    /** The paw sits on the line where the loot comes to rest. */
    const pawY = () => (mode === "train" ? tg.railY - itemSize() * 0.45 : mode === "fall" ? fg.floorY - itemSize() * 0.45 : floatGeom(W, H).waterY);

    const typing = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (finished || typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      const space = e.code === "Space" || e.key === " ";
      // while the hook's timing bar is up, Space is the throw (TimingBar listens on window, after us)
      if (space && ctl()?.hookOpen) return;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        if (e.key === "ArrowLeft") paw.dirL = true;
        else paw.dirR = true;
      } else if (space) {
        e.preventDefault();
        if (!e.repeat && !pointers.has(KEY_ID)) pointerDown(KEY_ID, "key", paw.x, pawY());
      } else return;
      kbd = true;
      noteKeyboard(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") paw.dirL = false;
      else if (e.key === "ArrowRight") paw.dirR = false;
      else if (e.code === "Space" || e.key === " ") {
        if (!pointers.has(KEY_ID)) return;
        pointers.delete(KEY_ID);
      } else return;
      e.preventDefault();
    };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("lostpointercapture", onUp);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("contextmenu", onCtx);
    window.addEventListener("blur", onBlur);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);

    /* ---------------- sizing */
    function resize() {
      const w = Math.max(1, wrap!.clientWidth);
      const h = Math.max(1, wrap!.clientHeight);
      const nd = Math.min(2, window.devicePixelRatio || 1);
      if (W > 0 && (w !== W || h !== H)) {
        const kx = w / W;
        const ky = h / H;
        for (const b of bodies) {
          b.x *= kx;
          b.y *= ky;
        }
        paw.x *= kx;
      }
      if (paw.x < 0) paw.x = w / 2;
      if (nd !== dpr) sprites.clear();
      W = w;
      H = h;
      dpr = nd;
      canvas!.width = Math.round(w * dpr);
      canvas!.height = Math.round(h * dpr);
      relayout();
    }
    resize();
    const ro = new ResizeObserver(() => resize());
    ro.observe(wrap);

    /* ---------------- update */
    function update(dt: number) {
      bumpCd -= dt;
      popCd -= dt;
      for (let i = 0; i < 3; i++) netKick[i] = Math.max(0, netKick[i] - dt * 3);

      for (const b of bodies) {
        if (b.st === 0 && b.it.t <= t) {
          spawn(b);
          // catch up after a late mount / long frame (the regular step below adds this frame's dt)
          const age = Math.max(0, t - b.it.t - dt);
          for (let a = 0; a < age; a += 1 / 60) stepBody(b, Math.min(1 / 60, age - a));
          if (mode === "train" && !b.it.spark && age < 0.05) puff(b.x, b.y, 1, "rgba(120,105,90,.45)");
        }
      }

      // keyboard paw: ease into PAW_SPEED over PAW_EASE s, then glide (a held Space sweeps along the way)
      const dir = (paw.dirR ? 1 : 0) - (paw.dirL ? 1 : 0);
      if (dir !== paw.dir) {
        paw.dir = dir;
        paw.heldFor = 0;
      }
      if (dir !== 0) {
        paw.heldFor += dt;
        const k = clamp(paw.heldFor / PAW_EASE);
        const nx = clamp(paw.x + dir * PAW_SPEED * k * k * dt, 16, Math.max(16, W - 16));
        if (pointers.has(KEY_ID)) pointerMove(KEY_ID, [{ x: nx, y: pawY() }]);
        paw.x = nx;
      }

      const steps = dt > 1 / 45 ? Math.ceil(dt / (1 / 60)) : 1;
      const sdt = dt / steps;
      const c = cone();
      const netY = tg.railY - H * 0.075;
      for (const b of bodies) {
        if (b.st !== 1) continue;
        for (let k = 0; k < steps; k++) stepBody(b, sdt);
        b.inCone = !!c && !b.it.spark && insideCone(c, b.x, b.y);
        // 'ties': a spark that lands next to a held paw sticks to it
        if (b.justLanded) {
          b.justLanded = false;
          if (grabPx > 0 && b.it.spark) {
            let grabbed = false;
            for (const tr of pointers.values()) if (tr.armed && Math.hypot(tr.x - b.x, tr.y - b.y) <= grabPx) grabbed = true;
            if (grabbed) {
              collect(b);
              continue;
            }
          }
        }
        // nets catch at most one item per car in their third
        if (nets.length && !b.it.spark && b.vy > 0 && b.y >= netY) {
          const sec = clamp(Math.floor(b.x / (W / 3)), 0, 2);
          if (nets.includes(sec) && !netUsed[sec].has(b.it.car)) {
            netUsed[sec].add(b.it.car);
            netKick[sec] = 1;
            catchByHelper(b, "net");
            continue;
          }
        }
        if (b.age >= life) lost(b);
      }

      // held pointers keep catching what falls into them
      for (const tr of pointers.values()) if (tr.armed) sweep(tr, tr.x, tr.y, tr.x, tr.y);

      // clockwork legion: one item every 0.5 s (the most endangered one)
      if (legion) {
        legionAcc += dt;
        if (legionAcc >= 0.5) {
          let best: Body | null = null;
          for (const b of bodies) if (b.st === 1 && !b.it.spark && b.age >= 0.35 && (!best || b.age > best.age)) best = b;
          if (best) {
            legionAcc -= 0.5;
            legionCount++;
            legionFx.push({ x: best.x, y: best.y, age: 0 });
            catchByHelper(best, "legion");
          } else legionAcc = 0.5;
        }
      }

      if (c && !lanternAnnounced) {
        lanternAnnounced = true;
        banner("🏮 Фонарь кондуктора!", lanternSusp > 0 ? `в луче ×${fmt(LANTERN_MULT)}, но каждая находка +${fmt(lanternSusp)} 👁` : `в луче ×${fmt(LANTERN_MULT)}`, "#ffd56b", 2.2);
      }

      if (progDirty) {
        progDirty = false;
        prog = catchProgress(sc, caughtIds, lostIds);
        if (gauge) rateBeats();
        if (mode === "train") carBeats();
      }
      // the gauge fill chases the real share (instantly for reduced motion)
      fill = reduced ? prog.share : fill + (prog.share - fill) * Math.min(1, dt * 10);

      // particles & texts
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.age += dt;
        if (p.age >= p.life) {
          parts.splice(i, 1);
          continue;
        }
        if (p.kind === 2) {
          p.vx *= Math.exp(-2 * dt);
          p.vy *= Math.exp(-1.5 * dt);
          p.size += dt * 14;
        } else {
          p.vy += 520 * dt;
          p.vx *= Math.exp(-1.2 * dt);
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
      for (let i = floats.length - 1; i >= 0; i--) {
        floats[i].age += dt;
        if (floats[i].age >= floats[i].life) floats.splice(i, 1);
      }
      for (let i = ghosts.length - 1; i >= 0; i--) {
        ghosts[i].age += dt;
        if (ghosts[i].age >= 0.22) ghosts.splice(i, 1);
      }
      for (let i = legionFx.length - 1; i >= 0; i--) {
        legionFx[i].age += dt;
        if (legionFx[i].age >= 0.6) legionFx.splice(i, 1);
      }
      for (let i = banners.length - 1; i >= 0; i--) {
        banners[i].age += dt;
        if (banners[i].age >= banners[i].life) banners.splice(i, 1);
      }

      if (!finished && doneAt < 0 && remaining <= 0) doneAt = t + 0.45;
      if (!finished && doneAt >= 0 && t >= doneAt) {
        finished = true;
        pointers.clear();
        const result: CatchResult = { caught, netted, sparksHit, hook: ctl()?.hook ?? "none", maxCombo };
        if (gauge) result.cleanCars = carClean.filter(Boolean).length;
        propsRef.current.onDone(result);
        if (gauge && process.env.NODE_ENV !== "production") {
          // the engine resolves the catch synchronously: its share is in the store by now
          console.debug("[catch] gauge share", prog.share.toFixed(4), "fill", fill.toFixed(4), "engine share", useGame.getState().game.scene?.share?.toFixed(4));
        }
      }
    }

    /* ---------------- draw */
    function drawCone(g: CanvasRenderingContext2D, c: NonNullable<ReturnType<typeof cone>>) {
      g.save();
      g.globalCompositeOperation = "lighter";
      const gr = g.createLinearGradient(0, c.top, 0, c.bot);
      gr.addColorStop(0, `rgba(255,232,160,${0.34 * c.a})`);
      gr.addColorStop(1, `rgba(255,200,90,${0.15 * c.a})`);
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(c.ax - 6, c.top);
      g.lineTo(c.ax + 6, c.top);
      g.lineTo(c.bx + c.hw, c.bot);
      g.lineTo(c.bx - c.hw, c.bot);
      g.closePath();
      g.fill();
      const pr = g.createRadialGradient(c.bx, c.bot, 0, c.bx, c.bot, c.hw * 1.25);
      pr.addColorStop(0, `rgba(255,222,140,${0.38 * c.a})`);
      pr.addColorStop(1, "rgba(255,200,90,0)");
      g.fillStyle = pr;
      g.fillRect(c.bx - c.hw * 1.3, c.bot - c.hw * 0.6, c.hw * 2.6, c.hw * 1.2);
      g.restore();
      const ly = 14;
      const lx = lerp(c.ax, c.bx, clamp((ly - c.top) / (c.bot - c.top)));
      const swing = Math.sin(t * 5) * 2;
      g.globalAlpha = c.a;
      // SC-5: the lantern hangs from a conductor's navy sleeve reaching down from the top edge
      g.save();
      g.lineCap = "round";
      g.strokeStyle = "#1f2a44";
      g.lineWidth = 16;
      g.beginPath();
      g.moveTo(lx + 26, -10);
      g.quadraticCurveTo(lx + 14, ly - 18, lx + 3, ly - 6 + swing);
      g.stroke();
      g.strokeStyle = "rgba(120,140,190,.35)";
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(lx + 31, -8);
      g.quadraticCurveTo(lx + 19, ly - 18, lx + 8, ly - 7 + swing);
      g.stroke();
      g.fillStyle = "#d4af37";
      for (const k of [0.25, 0.55]) {
        g.beginPath();
        g.arc(lx + 26 - 20 * k, -10 + (ly + 4) * k + swing * k, 2.2, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = "#f4efe4";
      g.beginPath();
      g.ellipse(lx + 1, ly - 7 + swing, 7, 5.5, -0.5, 0, Math.PI * 2);
      g.fill();
      g.restore();
      g.drawImage(emojiSprite("🏮", 22), lx - 15, ly - 15 + 8 + swing, 30.8, 30.8);
      // what the light has cost so far this pass
      if (lanternSusp > 0) {
        const txt = `👁 +${fmt(lanternTotal)}`;
        g.font = `700 ${W < 520 ? 11 : 12}px ${F.mono}`;
        g.textBaseline = "middle";
        const right = lx + 18 + g.measureText(txt).width > W - GAUGE_W - 24;
        g.textAlign = right ? "right" : "left";
        const tx = right ? lx - 18 : lx + 18;
        g.lineWidth = 3;
        g.lineJoin = "round";
        g.strokeStyle = "rgba(12,9,6,.85)";
        g.strokeText(txt, tx, ly + 2);
        g.fillStyle = "#c39bff";
        g.fillText(txt, tx, ly + 2);
      }
      g.globalAlpha = 1;
    }

    function drawNets(g: CanvasRenderingContext2D) {
      const y0 = tg.railY - H * 0.075;
      const y1 = tg.railY - 3;
      for (const sec of nets) {
        const x0 = (W / 3) * sec + 10;
        const x1 = (W / 3) * (sec + 1) - 10;
        const sag = 6 + netKick[sec] * 10 * Math.abs(Math.sin(t * 28));
        const mid = (x0 + x1) / 2;
        g.save();
        g.beginPath();
        g.moveTo(x0, y0);
        g.quadraticCurveTo(mid, y0 + sag * 0.6, x1, y0);
        g.lineTo(x1, y1);
        g.quadraticCurveTo(mid, y1 + sag, x0, y1);
        g.closePath();
        g.fillStyle = "rgba(156,199,207,.06)";
        g.fill();
        g.clip();
        g.strokeStyle = netUsed[sec].size > 0 ? "rgba(190,225,232,.6)" : "rgba(156,199,207,.45)";
        g.lineWidth = 1;
        g.beginPath();
        const span = y1 - y0 + sag;
        for (let x = x0 - span; x < x1 + span; x += 11) {
          g.moveTo(x, y0);
          g.lineTo(x + span, y1 + sag);
          g.moveTo(x + span, y0);
          g.lineTo(x, y1 + sag);
        }
        g.stroke();
        g.restore();
        g.strokeStyle = "#7d5f2c";
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(x0, y0 - 6);
        g.lineTo(x0, y1 + 2);
        g.moveTo(x1, y0 - 6);
        g.lineTo(x1, y1 + 2);
        g.stroke();
      }
    }

    function drawItems(g: CanvasRenderingContext2D) {
      const size = itemSize();
      for (const b of bodies) {
        if (b.st !== 1) continue;
        const left = life - b.age;
        let alpha = 1;
        let scale = 0.6 + 0.4 * clamp(b.age / 0.12);
        let dy = 0;
        if (left < FADE) {
          const k = 1 - left / FADE;
          alpha = 1 - k;
          scale *= 1 - 0.35 * k;
          dy = k * 10;
        }
        if (b.it.spark) {
          const fl = flicker(t, b.it.id);
          const s = size * (0.75 + 0.45 * fl);
          g.save();
          g.globalCompositeOperation = "lighter";
          g.globalAlpha = alpha * (0.7 + 0.3 * fl);
          g.strokeStyle = "rgba(255,120,40,.55)";
          g.lineWidth = 3;
          g.beginPath();
          g.moveTo(b.x, b.y + dy);
          g.lineTo(b.x - b.vx * 0.05, b.y + dy - b.vy * 0.05);
          g.stroke();
          g.drawImage(sparkSprite(size), b.x - s, b.y + dy - s, s * 2, s * 2);
          g.restore();
          continue;
        }
        const img = resSprite(b.it.res, size, false);
        const full = size * 2;
        g.save();
        g.translate(b.x, b.y + dy);
        if (b.inCone) {
          const halo = resSprite(b.it.res, size, true);
          const hs = full * scale * (1.15 + 0.1 * Math.sin(t * 12 + b.it.id));
          g.globalAlpha = alpha;
          g.drawImage(halo, -hs / 2, -hs / 2, hs, hs);
        }
        g.rotate(b.rot);
        g.globalAlpha = alpha;
        const s = full * scale;
        g.drawImage(img, -s / 2, -s / 2, s, s);
        g.restore();
      }
    }

    function drawParts(g: CanvasRenderingContext2D) {
      for (const p of parts) {
        const k = p.age / p.life;
        if (p.kind === 2) {
          g.globalAlpha = (1 - k) * 0.8;
          g.fillStyle = p.color;
          g.beginPath();
          g.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          g.fill();
        } else if (p.kind === 1) {
          g.globalAlpha = 1 - k;
          g.strokeStyle = p.color;
          g.lineWidth = 1.5;
          const s = p.size * 2.2 * (1 - k * 0.5);
          g.beginPath();
          g.moveTo(p.x - s, p.y);
          g.lineTo(p.x + s, p.y);
          g.moveTo(p.x, p.y - s);
          g.lineTo(p.x, p.y + s);
          g.stroke();
        } else {
          g.globalAlpha = 1 - k * k;
          g.fillStyle = p.color;
          g.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
        }
      }
      g.globalAlpha = 1;
      for (const gh of ghosts) {
        const k = gh.age / 0.22;
        const s = gh.full * (1 + (gh.net ? 0.2 : 0.7) * k);
        g.save();
        g.globalAlpha = 1 - k;
        g.translate(gh.x, gh.y - (gh.net ? -6 : 14) * k);
        g.rotate(gh.rot);
        g.drawImage(gh.img, -s / 2, -s / 2, s, s);
        g.restore();
      }
      for (const lf of legionFx) {
        const k = lf.age / 0.6;
        const hop = Math.sin(k * Math.PI) * 18;
        g.globalAlpha = 1 - k * k;
        const sx = lf.x - 12;
        const sy = lf.y - 12 - hop;
        g.drawImage(emojiSprite("🐀", 18), sx, sy, 25.2, 25.2);
        // wind-up key on its back
        const a = lf.age * 18;
        g.strokeStyle = "#e8c983";
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(sx + 12, sy + 2);
        g.lineTo(sx + 12 + Math.cos(a) * 6, sy - 3 + Math.sin(a) * 2);
        g.stroke();
      }
      g.globalAlpha = 1;
    }

    function drawTrails(g: CanvasRenderingContext2D) {
      const now = performance.now();
      g.save();
      g.globalCompositeOperation = "lighter";
      g.lineCap = "round";
      for (const tr of pointers.values()) {
        const maxAge = reduced ? 70 : 150;
        while (tr.trail.length > 1 && now - tr.trail[0].at > maxAge) tr.trail.shift();
        const pts = tr.trail;
        for (let i = 1; i < pts.length; i++) {
          const k = i / pts.length;
          g.strokeStyle = `rgba(255,226,150,${0.12 + 0.5 * k})`;
          g.lineWidth = 2 + 9 * k;
          g.beginPath();
          g.moveTo(pts[i - 1].x, pts[i - 1].y);
          g.lineTo(pts[i].x, pts[i].y);
          g.stroke();
        }
        const R = hitR(tr.type);
        const gr = g.createRadialGradient(tr.x, tr.y, 0, tr.x, tr.y, R);
        gr.addColorStop(0, "rgba(255,230,160,.28)");
        gr.addColorStop(1, "rgba(255,230,160,0)");
        g.fillStyle = gr;
        g.beginPath();
        g.arc(tr.x, tr.y, R, 0, Math.PI * 2);
        g.fill();
      }
      g.restore();
      if (hover && pointers.size === 0 && !kbd) {
        g.strokeStyle = "rgba(232,201,131,.35)";
        g.lineWidth = 1.5;
        g.setLineDash([4, 5]);
        g.beginPath();
        g.arc(hover.x, hover.y, hitR("mouse"), 0, Math.PI * 2);
        g.stroke();
        g.setLineDash([]);
      }
    }

    /** The keyboard paw: a highlighted spot on the catch line, a column of light while Space is held. */
    function drawPaw(g: CanvasRenderingContext2D) {
      if (!kbd || finished) return;
      const held = pointers.has(KEY_ID);
      const y = pawY();
      const R = hitR("key");
      g.save();
      g.globalCompositeOperation = "lighter";
      if (held) {
        const col = g.createLinearGradient(0, y - PAW_REACH - R, 0, y);
        col.addColorStop(0, "rgba(255,226,150,0)");
        col.addColorStop(1, "rgba(255,226,150,.26)");
        g.fillStyle = col;
        g.fillRect(paw.x - R * 0.8, y - PAW_REACH - R, R * 1.6, PAW_REACH + R);
      }
      const gr = g.createRadialGradient(paw.x, y, 0, paw.x, y, R);
      gr.addColorStop(0, `rgba(255,230,160,${held ? 0.42 : 0.2})`);
      gr.addColorStop(1, "rgba(255,230,160,0)");
      g.fillStyle = gr;
      g.beginPath();
      g.arc(paw.x, y, R, 0, Math.PI * 2);
      g.fill();
      g.restore();
      g.strokeStyle = held ? "rgba(255,236,170,.9)" : "rgba(232,201,131,.55)";
      g.lineWidth = held ? 2.5 : 1.5;
      g.beginPath();
      g.arc(paw.x, y, R * (held ? 0.92 : 1), 0, Math.PI * 2);
      g.stroke();
      const s = held ? 30 : 26;
      g.drawImage(emojiSprite("🐾", 22), paw.x - s / 2, y - s / 2 - (held ? 3 : 0), s, s);
    }

    function drawFloats(g: CanvasRenderingContext2D) {
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.lineJoin = "round";
      for (const f of floats) {
        const k = f.age / f.life;
        const pop = 1 + 0.35 * Math.exp(-14 * f.age);
        g.globalAlpha = 1 - k * k;
        g.font = `700 ${Math.round(f.size * pop)}px ${F.mono}`;
        const y = f.y - f.rise * (1 - Math.pow(1 - k, 3));
        g.lineWidth = 3.5;
        g.strokeStyle = "rgba(12,9,6,.85)";
        g.strokeText(f.text, f.x, y);
        g.fillStyle = f.color;
        g.fillText(f.text, f.x, y);
      }
      g.globalAlpha = 1;
    }

    function drawHud(g: CanvasRenderingContext2D) {
      const small = W < 520;
      g.textBaseline = "middle";
      g.lineJoin = "round";
      // caught counter
      g.textAlign = "right";
      g.font = `700 ${small ? 11 : 12}px ${F.mono}`;
      const cnt = `🐾 ${gotCount}/${totalCount}`;
      g.lineWidth = 3;
      g.strokeStyle = "rgba(12,9,6,.8)";
      g.strokeText(cnt, W - 12, 16);
      g.fillStyle = "#eadcc0";
      g.fillText(cnt, W - 12, 16);
      if (gauge) drawGauge(g);

      // combo counter (below the gauge when there is one)
      const showBroken = combo < 2 && brokenCombo >= 3 && t - brokenAt < 0.7;
      if (combo >= 2 || showBroken) {
        const val = combo >= 2 ? combo : brokenCombo;
        const tau = t - (combo >= 2 ? comboAt : brokenAt);
        const base = (small ? 28 : 34) + Math.min(val, 25) * (small ? 0.6 : 0.9);
        const sc2 = reduced ? 1 : combo >= 2 ? 1 + 0.45 * Math.exp(-9 * tau) * Math.cos(tau * 24) : 1 - 0.3 * clamp(tau / 0.7);
        const x = W - 14;
        const y = (small ? 30 : 34) + (gauge ? (t < noteUntil ? 44 : 26) : 0) + base * 0.55;
        g.save();
        g.translate(x, y);
        g.rotate(-0.06);
        g.scale(sc2, sc2);
        g.font = `700 ${Math.round(base)}px ${F.display}`;
        g.textAlign = "right";
        const txt = `×${val}!`;
        g.lineWidth = 6;
        g.strokeStyle = "rgba(12,9,6,.9)";
        g.strokeText(txt, 0, 0);
        if (combo >= 2) {
          const gr = g.createLinearGradient(0, -base / 2, 0, base / 2);
          gr.addColorStop(0, "#fff4c8");
          gr.addColorStop(0.5, val >= 25 ? "#ffb347" : "#f2c14e");
          gr.addColorStop(1, val >= 25 ? "#ff5a2a" : "#c98a2a");
          g.fillStyle = gr;
          if (val >= 25 && !reduced) {
            g.shadowColor = "rgba(255,120,40,.8)";
            g.shadowBlur = 14;
          }
        } else {
          g.globalAlpha = 1 - clamp(tau / 0.7);
          g.fillStyle = "#9a8f80";
        }
        g.fillText(txt, 0, 0);
        g.restore();
        g.textAlign = "right";
        g.font = `600 ${small ? 10 : 11}px ${F.body}`;
        const sub = combo >= 2 ? `комбо · добыча +${2 * Math.min(combo, 25)}%` : "комбо сорвано";
        g.lineWidth = 3;
        g.strokeStyle = "rgba(12,9,6,.85)";
        g.strokeText(sub, W - 12, y + base * 0.62);
        g.fillStyle = combo >= 2 ? "#e8c983" : "#9a8f80";
        g.fillText(sub, W - 12, y + base * 0.62);
        g.globalAlpha = 1;
      }

      // banners
      for (const bn of banners) {
        const k = bn.age / bn.life;
        const sIn = reduced ? 1 : 1 + 0.5 * Math.exp(-10 * bn.age);
        g.save();
        g.globalAlpha = k > 0.75 ? (1 - k) / 0.25 : 1;
        g.translate(W / 2, H * 0.17);
        g.scale(sIn, sIn);
        g.textAlign = "center";
        g.font = `700 ${small ? 24 : 32}px ${F.display}`;
        g.lineWidth = 6;
        g.strokeStyle = "rgba(12,9,6,.9)";
        g.strokeText(bn.text, 0, 0);
        g.fillStyle = bn.color;
        g.fillText(bn.text, 0, 0);
        g.font = `600 ${small ? 11 : 13}px ${F.body}`;
        g.lineWidth = 3;
        g.strokeText(bn.sub, 0, small ? 22 : 26);
        g.fillStyle = "#eadcc0";
        g.fillText(bn.sub, 0, small ? 22 : 26);
        g.restore();
      }

      if (legion) {
        g.textAlign = "left";
        g.font = `600 ${small ? 10 : 11}px ${F.body}`;
        const txt = `⚙🐀 Заводной легион · ${legionCount}`;
        g.lineWidth = 3;
        g.strokeStyle = "rgba(12,9,6,.8)";
        g.strokeText(txt, 10, H - 12);
        g.fillStyle = "#c9a25a";
        g.fillText(txt, 10, H - 12);
      }

      // keyboard hint while the keyboard is the last thing the player touched
      if (kbd && !finished) {
        g.textAlign = "right";
        g.font = `600 ${small ? 10 : 11}px ${F.mono}`;
        const txt = "⌨ ←→ и пробел";
        g.lineWidth = 3;
        g.strokeStyle = "rgba(12,9,6,.8)";
        g.strokeText(txt, W - 12, H - 12);
        g.fillStyle = "#e8c983";
        g.fillText(txt, W - 12, H - 12);
      }
    }

    /**
     * Live rating gauge under the 🐾 counter: the fill is the caught share, the red tail from the right is what can
     * no longer be caught, notches at the medal thresholds (lit when reached, greyed when out of reach, 👑 crossed
     * out after a bare-pawed spark).
     */
    function drawGauge(g: CanvasRenderingContext2D) {
      const x1 = W - 12;
      const x0 = x1 - GAUGE_W;
      const y = GAUGE_Y;
      g.save();
      // case
      g.fillStyle = "rgba(12,9,6,.78)";
      g.beginPath();
      g.roundRect(x0 - 2, y - 2, GAUGE_W + 4, GAUGE_H + 4, 5);
      g.fill();
      g.strokeStyle = "#7d5f2c";
      g.lineWidth = 1.5;
      g.stroke();
      g.beginPath();
      g.roundRect(x0, y, GAUGE_W, GAUGE_H, 3);
      g.clip();
      g.fillStyle = "#211a14";
      g.fillRect(x0, y, GAUGE_W, GAUGE_H);
      // fill = caught share
      const fw = GAUGE_W * clamp(fill);
      if (fw > 0) {
        const gr = g.createLinearGradient(x0, 0, x0 + GAUGE_W, 0);
        gr.addColorStop(0, "#8a5a1e");
        gr.addColorStop(0.6, "#e0a93e");
        gr.addColorStop(1, "#fff0b0");
        g.fillStyle = gr;
        g.fillRect(x0, y, fw, GAUGE_H);
        g.fillStyle = "rgba(255,255,255,.25)";
        g.fillRect(x0, y, fw, 2);
      }
      // red tail = out of reach
      const lw = GAUGE_W * clamp(1 - prog.maxReachable);
      if (lw > 0) {
        g.fillStyle = "rgba(196,58,40,.9)";
        g.fillRect(x1 - lw, y, lw, GAUGE_H);
        g.strokeStyle = "rgba(0,0,0,.28)";
        g.lineWidth = 1;
        g.beginPath();
        for (let hx = x1 - lw - GAUGE_H; hx < x1; hx += 4) {
          g.moveTo(hx, y + GAUGE_H);
          g.lineTo(hx + GAUGE_H, y);
        }
        g.stroke();
      }
      g.restore();

      // notches and medals
      g.textAlign = "center";
      g.textBaseline = "middle";
      for (let k = 0; k < TIERS.length; k++) {
        const nx = x0 + GAUGE_W * TIERS[k].min;
        const crossed = k === ROYAL && crownCrossedAt >= 0;
        const lostT = tierLostAt[k] >= 0 || crossed;
        const got = tierAt[k] >= 0 && !crossed;
        g.strokeStyle = got ? "#fff2c0" : lostT ? "rgba(120,110,100,.8)" : "rgba(234,220,192,.75)";
        g.lineWidth = got ? 2 : 1.5;
        g.beginPath();
        g.moveTo(nx, y - 3);
        g.lineTo(nx, y + GAUGE_H + 3);
        g.stroke();
        const pop = got && !reduced ? 1 + 0.7 * Math.exp(-7 * (t - tierAt[k])) : 1;
        const s = 14 * pop;
        const iy = y + GAUGE_H + 11;
        g.globalAlpha = got ? 1 : lostT ? 0.32 : 0.62;
        g.drawImage(emojiSprite(TIERS[k].icon, 12), nx - s / 2, iy - s / 2, s, s);
        g.globalAlpha = 1;
        if (crossed) {
          g.strokeStyle = "#ff5a3a";
          g.lineWidth = 2;
          g.beginPath();
          g.moveTo(nx - 7, iy - 7);
          g.lineTo(nx + 7, iy + 7);
          g.moveTo(nx + 7, iy - 7);
          g.lineTo(nx - 7, iy + 7);
          g.stroke();
        }
      }
    }

    function draw(dt: number) {
      const g = ctx!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      const extra = propsRef.current;
      if (extra.drawBack) {
        g.save();
        extra.drawBack(g, W, H, t, dt);
        g.restore();
      }
      if (physics === "float") {
        // a translucent band of flood water over the rail
        const wy = tg.railY - itemSize() * 0.55;
        const wg = g.createLinearGradient(0, wy, 0, tg.railY + 14);
        wg.addColorStop(0, "rgba(120,190,205,.28)");
        wg.addColorStop(1, "rgba(40,90,105,.42)");
        g.fillStyle = wg;
        g.fillRect(0, wy, W, tg.railY + 14 - wy);
        g.fillStyle = "rgba(220,245,250,.35)";
        for (let x = (t * -40) % 36; x < W; x += 36) g.fillRect(x, wy + Math.sin(x * 0.05 + t * 3) * 1.5, 18, 1.5);
      }
      const c = cone();
      if (c) drawCone(g, c);
      if (nets.length) drawNets(g);
      drawItems(g);
      if (extra.drawFront) {
        g.save();
        extra.drawFront(g, W, H, t, dt);
        g.restore();
      }
      drawParts(g);
      drawTrails(g);
      drawPaw(g);
      drawFloats(g);
      drawHud(g);
    }

    /* ---------------- loop */
    let last = performance.now();
    let raf = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      let dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      const c = ctl();
      if (c && now < c.slowUntil) dt *= 0.5;
      // after a stall (hidden tab) jump forward to the engine clock
      const gt = useGame.getState().game.time - phaseStart;
      if (gt - t > 1.5) t = gt - 0.25;
      t += dt;
      update(dt);
      propsRef.current.onFrame?.(t, dt);
      draw(dt);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("lostpointercapture", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("contextmenu", onCtx);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      const cc = ctl();
      if (cc && cc.burst === burst) cc.burst = null;
    };
  }, []);

  return (
    <div ref={wrapRef} className={props.className ?? "absolute inset-0"}>
      <canvas ref={canvasRef} className="block h-full w-full cursor-crosshair touch-none select-none" aria-label="Лови добычу: жми или веди, зажав кнопку; с клавиатуры — стрелки и пробел" />
    </div>
  );
}
