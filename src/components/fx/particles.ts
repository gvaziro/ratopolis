import type { BurstKind, FloatSpec, FxImpl } from "./fxBus";

/**
 * Canvas particle + floating-text system for FxLayer.
 * Runs its own requestAnimationFrame loop only while something is alive (or an emitter is active),
 * and clears only the bounding box of what the previous frame painted.
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
  x: number;
  y: number;
  born: number; // ms
  dur: number; // ms
  alpha: number;
  rise: number;
  rot: number;
  /** The text rasterised once at spawn (outline, stamp frame and all); frames only blit it. */
  img: HTMLCanvasElement;
  /** Sprite size in CSS px. */
  iw: number;
  ih: number;
}

/** Union bounding box (CSS px) of everything drawn in a frame. */
interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
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
  /** The context's current font: assigning ctx.font resolves it against the canvas style (can force a style
   *  recalc), so it is only assigned when it really changes. */
  private ctxFont = "";
  private emitters: EdgeEmitter[] = [];
  private emitAcc = 0;
  /** What the last frame painted: only this area is cleared next frame. */
  private dirty: Box | null = null;
  /** Sprite canvases of expired texts, reused by the next ones. */
  private spare: HTMLCanvasElement[] = [];
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
    this.dirty = null; // resizing the canvas cleared it…
    this.ctxFont = ""; // …and reset the context state
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.parts = [];
    this.texts = [];
    this.spare = [];
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
    const { img, iw, ih } = this.sprite(spec.text, size, spec.color, !!spec.stamp, big || !!spec.stamp);
    // keep the whole flight on screen
    const halfW = iw / 2;
    this.texts.push({
      x: Math.max(halfW + 6, Math.min(this.w - halfW - 6, spec.x)),
      y: Math.max(rise + size, Math.min(this.h - size, spec.y)),
      born: performance.now(),
      dur: spec.dur ?? (big ? 1100 : 700),
      alpha: spec.alpha ?? 1,
      rise,
      rot: spec.stamp ? -0.14 : 0,
      img,
      iw,
      ih,
    });
    if (this.texts.length > MAX_TEXTS) for (const t of this.texts.splice(0, this.texts.length - MAX_TEXTS)) this.recycle(t.img);
    this.wake();
  }

  /**
   * Rasterise a floating text once (stroke + fill, the stamp frame) into a small canvas of its own:
   * strokeText on the big canvas every frame was the loop's main cost.
   */
  private sprite(text: string, size: number, color: string, stamp: boolean, outline: boolean): { img: HTMLCanvasElement; iw: number; ih: number } {
    const img = this.spare.pop() ?? document.createElement("canvas");
    const cx = img.getContext("2d");
    const font = `700 ${size}px ${this.fontDisplay}, serif`;
    const line = outline ? Math.max(3, size / 7) : 3;
    if (!cx) return { img, iw: 1, ih: 1 };
    cx.font = font;
    const tw = cx.measureText(text).width;
    const padX = Math.ceil(line / 2 + (stamp ? 9 : 0) + 2);
    const padY = Math.ceil(line / 2 + (stamp ? 5 : 0) + 2);
    const iw = Math.ceil(tw) + padX * 2;
    const ih = Math.ceil(size * 1.3) + padY * 2;
    const dpr = this.dpr;
    img.width = Math.ceil(iw * dpr); // also clears it and resets the context state
    img.height = Math.ceil(ih * dpr);
    cx.setTransform(dpr, 0, 0, dpr, (iw / 2) * dpr, (ih / 2) * dpr);
    cx.font = font;
    cx.textAlign = "center";
    cx.textBaseline = "middle";
    cx.lineJoin = "round";
    if (stamp) {
      const w = tw + 12;
      const h = size + 6;
      cx.strokeStyle = color;
      cx.lineWidth = 2.5;
      cx.strokeRect(-w / 2, -h / 2, w, h);
    }
    cx.strokeStyle = outline ? "rgba(20,12,6,.85)" : "rgba(20,12,6,.6)";
    cx.lineWidth = line;
    cx.strokeText(text, 0, 0);
    cx.fillStyle = color;
    cx.fillText(text, 0, 0);
    return { img, iw, ih };
  }

  private recycle(img: HTMLCanvasElement): void {
    if (this.spare.length < 24) this.spare.push(img);
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
      case "gear": {
        // CO-7: brass cogs flung out by a new patent
        const v = rnd(90, 260) * spread;
        p.vx = Math.cos(a) * v;
        p.vy = Math.sin(a) * v - 80;
        p.g = 160;
        p.drag = 1.2;
        p.life = p.max = rnd(1, 1.6);
        p.size = rnd(4.5, 8);
        p.color = pick(GOLD);
        p.vr = rnd(-4, 4);
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

  private setFont(f: string): void {
    if (f === this.ctxFont) return;
    this.ctxFont = f;
    this.ctx.font = f;
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
    if (!alive) this.clearDirty();
  };

  /** Clear only what the previous frame painted (falls back to nothing when nothing was drawn). */
  private clearDirty(): void {
    const b = this.dirty;
    this.dirty = null;
    if (!b) return;
    const c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const x0 = Math.max(0, Math.floor(b.x0) - 2);
    const y0 = Math.max(0, Math.floor(b.y0) - 2);
    const x1 = Math.min(this.w, Math.ceil(b.x1) + 2);
    const y1 = Math.min(this.h, Math.ceil(b.y1) + 2);
    if (x1 > x0 && y1 > y0) c.clearRect(x0, y0, x1 - x0, y1 - y0);
  }

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
    this.clearDirty();
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const box: Box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    const grow = (x: number, y: number, rx: number, ry: number) => {
      if (x - rx < box.x0) box.x0 = x - rx;
      if (x + rx > box.x1) box.x1 = x + rx;
      if (y - ry < box.y0) box.y0 = y - ry;
      if (y + ry > box.y1) box.y1 = y + ry;
    };

    for (const p of this.parts) {
      const f = p.life / p.max; // 1 → 0
      // generous extent: the biggest shape (dust ×1.6, hearts as text) plus a spark's motion streak
      const ext = p.size * 2 + 3;
      grow(p.x, p.y, ext + Math.abs(p.vx) * 0.03, ext + Math.abs(p.vy) * 0.03);
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
        case "gear": {
          c.globalAlpha = Math.min(1, f * 2);
          c.save();
          c.translate(p.x, p.y);
          c.rotate(p.rot);
          c.fillStyle = p.color;
          for (let k = 0; k < 6; k++) {
            c.rotate(Math.PI / 3);
            c.fillRect(-p.size * 0.18, -p.size * 1.15, p.size * 0.36, p.size * 0.5);
          }
          c.beginPath();
          c.arc(0, 0, p.size * 0.8, 0, Math.PI * 2);
          c.fill();
          c.fillStyle = "rgba(20,17,15,.7)";
          c.beginPath();
          c.arc(0, 0, p.size * 0.3, 0, Math.PI * 2);
          c.fill();
          c.restore();
          break;
        }
        case "heart":
          c.globalAlpha = Math.min(1, f * 2);
          c.fillStyle = p.color;
          this.setFont(`${Math.round(p.size)}px sans-serif`);
          c.textAlign = "center";
          c.textBaseline = "middle";
          c.fillText("♥", p.x, p.y);
          break;
      }
    }
    c.globalAlpha = 1;

    // floating texts: blit their sprites
    const keep: FloatText[] = [];
    for (const t of this.texts) {
      const age = now - t.born;
      if (age >= t.dur) {
        this.recycle(t.img);
        continue;
      }
      keep.push(t);
      const k = age / t.dur;
      const ease = 1 - (1 - k) * (1 - k);
      const y = t.y - t.rise * ease;
      const pop = age < 90 ? 1.3 - 0.3 * (age / 90) : 1;
      // half extents, plus the stamp's tilt
      const tilt = Math.abs(Math.sin(t.rot));
      grow(t.x, y, (t.iw / 2 + t.ih * tilt) * pop + 1, (t.ih / 2 + t.iw * tilt) * pop + 1);
      c.globalAlpha = t.alpha * (k < 0.55 ? 1 : 1 - (k - 0.55) / 0.45);
      // translate · rotate · scale in one matrix
      const sc = this.dpr * pop;
      const cos = Math.cos(t.rot) * sc;
      const sin = Math.sin(t.rot) * sc;
      c.setTransform(cos, sin, -sin, cos, t.x * this.dpr, y * this.dpr);
      c.drawImage(t.img, -t.iw / 2, -t.ih / 2, t.iw, t.ih);
    }
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.texts = keep;
    c.globalAlpha = 1;
    this.dirty = box.x1 > box.x0 ? box : null;
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
