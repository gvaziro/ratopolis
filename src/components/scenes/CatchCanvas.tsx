"use client";

/**
 * The `catch` primitive: a canvas of falling / flying / floating items (scene.items) that the player
 * taps or swipes. Combo, sparks, conductor's lantern, wire nets and the clockwork legion live here.
 * Everything per-frame stays in closures and refs — no React state updates while it runs.
 */
import { useEffect, useRef, type RefObject } from "react";
import { sfx } from "@/audio/sfx";
import { RESOURCES } from "@/game/data/resources";
import { useGame } from "@/game/store";
import type { CatchItem, CatchResult, ResId, Scene } from "@/game/types";
import { fmt } from "@/lib/format";
import {
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
}

export function newCatchControl(): CatchControl {
  return { hook: "none", slowUntil: 0, burst: null };
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

    let W = 0;
    let H = 0;
    let dpr = 1;
    let tg: TrainGeom = trainGeom(1, 1, perCar, capsule);
    let fg: FallGeom = fallGeom(1, 1);
    let t = Math.max(0, game0.time - phaseStart);

    const bodies: Body[] = sc.items.map((it) => ({ it, st: 0, x: 0, y: 0, vx: 0, vy: 0, rot: 0, vr: 0, age: 0, bounces: 0, landed: false, inCone: false, r: 16 }));
    let remaining = bodies.length;
    // items that already ended before we mounted (reload mid-phase) vanish silently
    for (const b of bodies) {
      if (b.it.t + life <= t) {
        b.st = 2;
        remaining--;
      }
    }
    const totalCount = sc.items.filter((i) => !i.spark).length;

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

    function addFloat(text: string, x: number, y: number, color: string, size: number, lifeS = 0.75) {
      if (floats.length >= MAX_FLOATS) floats.shift();
      floats.push({ text, x: clamp(x, 24, Math.max(24, W - 24)), y, color, age: 0, life: lifeS, size });
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
      const gk = (mode === "train" ? 2.4 : 1.5) * H * Math.pow(2 / life, 2) * (b.it.spark ? 0.45 : 1);
      if (mode === "fall" && !b.landed) b.vx += Math.sin(b.age * 4 + b.it.id) * W * 0.03 * dt;
      b.vy += gk * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (!b.landed) b.rot += b.vr * dt;
      const ground = floor - b.r * 0.82;
      if (b.y >= ground) {
        b.y = ground;
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

    function collect(b: Body) {
      b.st = 2;
      remaining--;
      if (b.it.spark) {
        sparksHit++;
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
        }
        return;
      }
      combo++;
      maxCombo = Math.max(maxCombo, combo);
      comboAt = t;
      gotCount++;
      const lantern = lanternOn && b.inCone;
      caught.push({ id: b.it.id, combo, lantern });
      const v = b.it.value * (1 + 0.02 * Math.min(combo, 25)) * (lantern ? 1.5 : 1);
      const col = RESOURCES[b.it.res].color;
      addFloat(`+${fmt(v)}${lantern ? " 👁" : ""}`, b.x, b.y - 16, col, combo >= 10 ? 20 : 17);
      burst(b.x, b.y, col, 9);
      ghostOf(b, false);
      sfx.blip(combo);
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
      const col = RESOURCES[b.it.res].color;
      addFloat(`+${fmt(b.it.value)} ${how === "net" ? "🕸" : "⚙"}`, b.x, b.y - 12, hexA(col, 0.9), 14);
      ghostOf(b, true);
      if (popCd <= 0) {
        if (how === "net") sfx.pop();
        else sfx.click();
        popCd = 0.08;
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

    const hitR = (type: string) => (type === "touch" ? 40 : 28);

    /* ---------------- pointer input */
    const toLocal = (r: DOMRect, cx: number, cy: number) => ({
      x: (cx - r.left) * (r.width > 0 ? W / r.width : 1),
      y: (cy - r.top) * (r.height > 0 ? H / r.height : 1),
    });

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      e.preventDefault();
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* not capturable */
      }
      const r = canvas.getBoundingClientRect();
      const p = toLocal(r, e.clientX, e.clientY);
      const now = performance.now();
      while (taps.length && now - taps[0] > 1000) taps.shift();
      const allowed = taps.length < TAP_LIMIT;
      if (allowed) taps.push(now);
      pointers.set(e.pointerId, { x: p.x, y: p.y, type: e.pointerType, armed: allowed, downX: p.x, downY: p.y, trail: [{ x: p.x, y: p.y, at: now }] });
      if (allowed) tryCollect(p.x, p.y, p.x, p.y, hitR(e.pointerType));
    };

    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      const tr = pointers.get(e.pointerId);
      if (!tr) {
        if (e.pointerType === "mouse") hover = toLocal(r, e.clientX, e.clientY);
        return;
      }
      const evs = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
      const list = evs.length ? evs : [e];
      const now = performance.now();
      for (const ev of list) {
        const p = toLocal(r, ev.clientX, ev.clientY);
        if (!tr.armed && Math.hypot(p.x - tr.downX, p.y - tr.downY) > 6) tr.armed = true;
        if (tr.armed) tryCollect(tr.x, tr.y, p.x, p.y, hitR(tr.type));
        tr.x = p.x;
        tr.y = p.y;
        tr.trail.push({ x: p.x, y: p.y, at: now });
      }
      if (tr.trail.length > 28) tr.trail.splice(0, tr.trail.length - 28);
    };

    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
    };
    const onLeave = (e: PointerEvent) => {
      if (e.pointerType === "mouse") hover = null;
    };
    const onCtx = (e: Event) => e.preventDefault();
    const onBlur = () => pointers.clear();

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("lostpointercapture", onUp);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("contextmenu", onCtx);
    window.addEventListener("blur", onBlur);

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
      }
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

      const steps = dt > 1 / 45 ? Math.ceil(dt / (1 / 60)) : 1;
      const sdt = dt / steps;
      const c = cone();
      const netY = tg.railY - H * 0.075;
      for (const b of bodies) {
        if (b.st !== 1) continue;
        for (let k = 0; k < steps; k++) stepBody(b, sdt);
        b.inCone = !!c && !b.it.spark && insideCone(c, b.x, b.y);
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
      for (const tr of pointers.values()) if (tr.armed) tryCollect(tr.x, tr.y, tr.x, tr.y, hitR(tr.type));

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
        banner("🏮 Фонарь кондуктора!", "в луче ×1.5, но люди заметят 👁", "#ffd56b", 2.2);
      }

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
        propsRef.current.onDone({ caught, netted, sparksHit, hook: ctl()?.hook ?? "none", maxCombo });
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
      g.globalAlpha = c.a;
      g.drawImage(emojiSprite("🏮", 22), lx - 15, ly - 15 + Math.sin(t * 5) * 2, 30.8, 30.8);
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
      if (hover && pointers.size === 0) {
        g.strokeStyle = "rgba(232,201,131,.35)";
        g.lineWidth = 1.5;
        g.setLineDash([4, 5]);
        g.beginPath();
        g.arc(hover.x, hover.y, 28, 0, Math.PI * 2);
        g.stroke();
        g.setLineDash([]);
      }
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
        const y = f.y - 42 * (1 - Math.pow(1 - k, 3));
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

      // combo counter
      const showBroken = combo < 2 && brokenCombo >= 3 && t - brokenAt < 0.7;
      if (combo >= 2 || showBroken) {
        const val = combo >= 2 ? combo : brokenCombo;
        const tau = t - (combo >= 2 ? comboAt : brokenAt);
        const base = (small ? 28 : 34) + Math.min(val, 25) * (small ? 0.6 : 0.9);
        const sc2 = reduced ? 1 : combo >= 2 ? 1 + 0.45 * Math.exp(-9 * tau) * Math.cos(tau * 24) : 1 - 0.3 * clamp(tau / 0.7);
        const x = W - 14;
        const y = (small ? 30 : 34) + base * 0.55;
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
      const cc = ctl();
      if (cc && cc.burst === burst) cc.burst = null;
    };
  }, []);

  return (
    <div ref={wrapRef} className={props.className ?? "absolute inset-0"}>
      <canvas ref={canvasRef} className="block h-full w-full cursor-crosshair touch-none select-none" aria-label="Лови добычу: жми или веди, зажав кнопку" />
    </div>
  );
}
