import type { BurstKind, FloatSpec, FxImpl } from "./fxBus";

/**
 * Canvas particle + floating-text system for FxLayer.
 * Runs its own requestAnimationFrame loop only while something is alive (or an emitter is active).
 */

const MAX_PARTICLES = 200;
const MAX_TEXTS = 60;

interface Particle {
  kind: BurstKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  g: number; // gravity px/s²
  drag: number; // per second
  life: number; // seconds left
  max: number;
  size: number;
  color: string;
  rot: number;
  vr: number;
}

interface FloatText {
  text: string;
  x: number;
  y: number;
  color: string;
  size: number;
  stamp: boolean;
  outline: boolean;
  born: number; // ms
  dur: number; // ms
  alpha: number;
  rise: number;
  rot: number;
}

const GOLD = ["#f2d27a", "#e8c983", "#ffd34d", "#fff1b8", "#d4af37"];
const SPARK = ["#ff5a3c", "#ffb03a", "#ffd34d", "#e8705f"];
const BUTTONS = ["#e39ab0", "#8fb8ff", "#f5d76e", "#7cc4b0", "#e8705f", "#eadcc0", "#b8693d"];
const DUST = ["#8a7a66", "#6f604f", "#a8977a"];
const CRUMB = ["#e6c27a", "#d9a95a", "#f0d49a"];

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];

export interface EdgeEmitter {
  until: number; // performance.now() ms
  rect: () => DOMRect | null;
}

export class FxSystem implements FxImpl {
  private parts: Particle[] = [];
  private texts: FloatText[] = [];
  private raf = 0;
  private last = 0;
  private dpr = 1;
  private w = 0;
  private h = 0;
  private fontDisplay = "serif";
  private emitters: EdgeEmitter[] = [];
  private emitAcc = 0;
  /** 1 normally, 0.3 with reduced motion. */
  density = 1;

  constructor(
    private canvas: HTMLCanvasElement,
    private ctx: CanvasRenderingContext2D,
  ) {
    this.resize();
    const fam = getComputedStyle(document.documentElement).getPropertyValue("--font-display").trim();
    if (fam) this.fontDisplay = fam;
  }

  resize(): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.parts = [];
    this.texts = [];
  }

  /* ------------------------------------------------------------ spawning */

  burst(x: number, y: number, kind: BurstKind, n: number, spread = 1): void {
    const count = Math.max(n > 0 ? 1 : 0, Math.round(n * this.density));
    for (let i = 0; i < count; i++) this.parts.push(this.make(kind, x, y, spread));
    if (this.parts.length > MAX_PARTICLES) this.parts.splice(0, this.parts.length - MAX_PARTICLES);
    this.wake();
  }

  /** Particles scattered over a rectangle (zone opened, etc.). */
  scatter(rect: { left: number; top: number; width: number; height: number }, kind: BurstKind, n: number): void {
    const count = Math.max(1, Math.round(n * this.density));
    for (let i = 0; i < count; i++) {
      this.parts.push(this.make(kind, rect.left + Math.random() * rect.width, rect.top + Math.random() * rect.height, 0.6));
    }
    if (this.parts.length > MAX_PARTICLES) this.parts.splice(0, this.parts.length - MAX_PARTICLES);
    this.wake();
  }

  text(spec: FloatSpec): void {
    const big = !!spec.big;
    const size = spec.size ?? (big ? 30 : spec.stamp ? 18 : 22);
    const rise = big ? 56 : 40;
    // keep the whole flight on screen
    const halfW = (spec.text.length * size) / 3.4;
    this.texts.push({
      text: spec.text,
      x: Math.max(halfW + 6, Math.min(this.w - halfW - 6, spec.x)),
      y: Math.max(rise + size, Math.min(this.h - size, spec.y)),
      color: spec.color,
      size,
      stamp: !!spec.stamp,
      outline: big || !!spec.stamp,
      born: performance.now(),
      dur: spec.dur ?? (big ? 1100 : 700),
      alpha: spec.alpha ?? 1,
      rise,
      rot: spec.stamp ? -0.14 : 0,
    });
    if (this.texts.length > MAX_TEXTS) this.texts.splice(0, this.texts.length - MAX_TEXTS);
    this.wake();
  }

  /** Red-gold sparks along the edges of a rect until `until` (frenzy). */
  edgeSparks(e: EdgeEmitter): void {
    this.emitters = this.emitters.filter((x) => x.until > performance.now());
    this.emitters.push(e);
    this.wake();
  }

  private make(kind: BurstKind, x: number, y: number, spread: number): Particle {
    const a = Math.random() * Math.PI * 2;
    const p: Particle = { kind, x, y, vx: 0, vy: 0, g: 0, drag: 1.5, life: 1, max: 1, size: 3, color: "#fff", rot: Math.random() * 6.28, vr: 0 };
    switch (kind) {
      case "dust": {
        const v = rnd(10, 40) * spread;
        p.vx = Math.cos(a) * v;
        p.vy = Math.sin(a) * v * 0.5 - 8;
        p.g = 14;
        p.life = p.max = rnd(0.7, 1.3);
        p.size = rnd(3, 7);
        p.color = pick(DUST);
        break;
      }
      case "crumb": {
        const v = rnd(40, 110) * spread;
        p.vx = Math.cos(a) * v;
        p.vy = -Math.abs(Math.sin(a)) * v - 30;
        p.g = 420;
        p.drag = 0.6;
        p.life = p.max = rnd(0.5, 0.8);
        p.size = rnd(2, 3.5);
        p.color = pick(CRUMB);
        p.vr = rnd(-8, 8);
        break;
      }
      case "gold":
      case "glint": {
        const v = (kind === "glint" ? rnd(20, 70) : rnd(60, 220)) * spread;
        p.vx = Math.cos(a) * v;
        p.vy = Math.sin(a) * v - 20;
        p.g = kind === "glint" ? 0 : 60;
        p.drag = 2.2;
        p.life = p.max = rnd(0.7, 1.3);
        p.size = kind === "glint" ? rnd(4, 7) : rnd(3, 6);
        p.color = pick(GOLD);
        p.vr = rnd(-3, 3);
        break;
      }
      case "spark":
      case "ember": {
        const v = rnd(50, 180) * spread;
        p.vx = Math.cos(a) * v;
        p.vy = Math.sin(a) * v - (kind === "ember" ? 40 : 0);
        p.g = kind === "ember" ? -30 : 120;
        p.drag = 2;
        p.life = p.max = rnd(0.35, 0.8);
        p.size = rnd(1.5, 3);
        p.color = pick(SPARK);
        break;
      }
      case "confetti": {
        const v = rnd(120, 380) * spread;
        const ang = -Math.PI / 2 + rnd(-1.1, 1.1);
        p.vx = Math.cos(ang) * v;
        p.vy = Math.sin(ang) * v;
        p.g = 380;
        p.drag = 1.4;
        p.life = p.max = rnd(1.4, 2.3);
        p.size = rnd(4.5, 7);
        p.color = pick(BUTTONS);
        p.vr = rnd(-9, 9);
        break;
      }
      case "heart": {
        p.vx = rnd(-15, 15);
        p.vy = rnd(-70, -45);
        p.g = 0;
        p.drag = 0.4;
        p.life = p.max = rnd(0.9, 1.2);
        p.size = rnd(14, 18);
        p.color = "#ff7a9a";
        break;
      }
    }
    return p;
  }

  /* ------------------------------------------------------------ loop */

  private wake(): void {
    if (this.raf) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (now: number): void => {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.emit(now, dt);
    this.step(dt);
    this.draw(now);
    const alive = this.parts.length > 0 || this.texts.length > 0 || this.emitters.length > 0;
    this.raf = alive ? requestAnimationFrame(this.frame) : 0;
    if (!alive) this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  };

  private emit(now: number, dt: number): void {
    if (!this.emitters.length) return;
    this.emitters = this.emitters.filter((e) => e.until > now);
    const e = this.emitters[this.emitters.length - 1];
    if (!e) return;
    const r = e.rect() ?? new DOMRect(0, 0, this.w, this.h);
    this.emitAcc += dt * 28 * this.density;
    while (this.emitAcc >= 1 && this.parts.length < MAX_PARTICLES) {
      this.emitAcc -= 1;
      const side = Math.floor(Math.random() * 4);
      const t = Math.random();
      const x = side === 0 || side === 2 ? r.left + t * r.width : side === 1 ? r.right - 2 : r.left + 2;
      const y = side === 1 || side === 3 ? r.top + t * r.height : side === 0 ? r.top + 2 : r.bottom - 2;
      const p = this.make("spark", x, y, 0.6);
      // push inward
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      p.vx += (cx - x) * 0.15;
      p.vy += (cy - y) * 0.15;
      this.parts.push(p);
    }
    if (this.emitAcc > 1) this.emitAcc = 0;
  }

  private step(dt: number): void {
    const ps = this.parts;
    let j = 0;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      const k = Math.exp(-p.drag * dt);
      p.vx *= k;
      p.vy = p.vy * k + p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      ps[j++] = p;
    }
    ps.length = j;
  }

  private draw(now: number): void {
    const c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.w, this.h);

    for (const p of this.parts) {
      const f = p.life / p.max; // 1 → 0
      switch (p.kind) {
        case "dust":
          c.globalAlpha = 0.55 * f;
          c.fillStyle = p.color;
          c.beginPath();
          c.arc(p.x, p.y, p.size * (1.6 - f * 0.6), 0, Math.PI * 2);
          c.fill();
          break;
        case "crumb":
          c.globalAlpha = Math.min(1, f * 2);
          c.fillStyle = p.color;
          c.save();
          c.translate(p.x, p.y);
          c.rotate(p.rot);
          c.fillRect(-p.size, -p.size * 0.7, p.size * 2, p.size * 1.4);
          c.restore();
          break;
        case "gold":
        case "glint": {
          c.globalAlpha = Math.min(1, f * 1.8) * (0.75 + 0.25 * Math.sin(now / 60 + p.rot * 5));
          c.fillStyle = p.color;
          star(c, p.x, p.y, p.size * (0.6 + f * 0.6), p.rot);
          break;
        }
        case "spark":
        case "ember": {
          c.globalAlpha = Math.min(1, f * 1.6);
          c.globalCompositeOperation = "lighter";
          c.strokeStyle = p.color;
          c.lineWidth = p.size;
          c.lineCap = "round";
          c.beginPath();
          c.moveTo(p.x, p.y);
          c.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03);
          c.stroke();
          c.globalCompositeOperation = "source-over";
          break;
        }
        case "confetti": {
          // a sewing button flipping in the air
          c.globalAlpha = Math.min(1, f * 2.5);
          c.save();
          c.translate(p.x, p.y);
          c.rotate(p.rot * 0.3);
          c.scale(1, Math.abs(Math.cos(p.rot)) * 0.85 + 0.15);
          c.fillStyle = p.color;
          c.beginPath();
          c.arc(0, 0, p.size, 0, Math.PI * 2);
          c.fill();
          c.fillStyle = "rgba(20,17,15,.55)";
          c.beginPath();
          c.arc(-p.size * 0.32, 0, p.size * 0.18, 0, Math.PI * 2);
          c.arc(p.size * 0.32, 0, p.size * 0.18, 0, Math.PI * 2);
          c.fill();
          c.restore();
          break;
        }
        case "heart":
          c.globalAlpha = Math.min(1, f * 2);
          c.fillStyle = p.color;
          c.font = `${p.size}px sans-serif`;
          c.textAlign = "center";
          c.textBaseline = "middle";
          c.fillText("♥", p.x, p.y);
          break;
      }
    }
    c.globalAlpha = 1;

    // floating texts
    const keep: FloatText[] = [];
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.lineJoin = "round";
    for (const t of this.texts) {
      const age = now - t.born;
      if (age >= t.dur) continue;
      keep.push(t);
      const k = age / t.dur;
      const ease = 1 - (1 - k) * (1 - k);
      const y = t.y - t.rise * ease;
      const pop = age < 90 ? 1.3 - 0.3 * (age / 90) : 1;
      c.globalAlpha = t.alpha * (k < 0.55 ? 1 : 1 - (k - 0.55) / 0.45);
      c.save();
      c.translate(t.x, y);
      c.rotate(t.rot);
      c.scale(pop, pop);
      c.font = `700 ${t.size}px ${this.fontDisplay}, serif`;
      if (t.stamp) {
        const w = c.measureText(t.text).width + 12;
        const h = t.size + 6;
        c.strokeStyle = t.color;
        c.lineWidth = 2.5;
        c.strokeRect(-w / 2, -h / 2, w, h);
      }
      if (t.outline) {
        c.strokeStyle = "rgba(20,12,6,.85)";
        c.lineWidth = Math.max(3, t.size / 7);
        c.strokeText(t.text, 0, 0);
      } else {
        c.strokeStyle = "rgba(20,12,6,.6)";
        c.lineWidth = 3;
        c.strokeText(t.text, 0, 0);
      }
      c.fillStyle = t.color;
      c.fillText(t.text, 0, 0);
      c.restore();
    }
    this.texts = keep;
    c.globalAlpha = 1;
  }
}

function star(c: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number): void {
  c.save();
  c.translate(x, y);
  c.rotate(rot);
  c.beginPath();
  for (let i = 0; i < 8; i++) {
    const rr = i % 2 === 0 ? r : r * 0.32;
    const a = (i * Math.PI) / 4;
    c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  c.closePath();
  c.fill();
  c.restore();
}
