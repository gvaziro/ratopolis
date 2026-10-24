"use client";

/**
 * Canvas painter for the pass phase: dark riveted car undersides scrolling right→left, giant spoked wheels
 * (only their top arc rises above the rail head), flickering light in the gaps, flange sparks, steam puffs
 * and the engine's main rod. For capsules: brass cylinders rushing through the glass tube.
 * Drawn by CatchCanvas (drawBack) so it shares the exact clock of the items.
 */
import { TRAIN_CARS } from "@/game/data/events";
import type { TrainCarKind } from "@/game/types";
import { carLeft, clamp, EMOJI_FONT, flicker, fonts, trainGeom, type TrainGeom } from "./sceneUtils";

export interface TrainPainterOpts {
  kinds: TrainCarKind[];
  perCar: number;
  capsule: boolean;
  royal: boolean;
  /** Car index the grappling hook aims at (-1 none). */
  hookCar: number;
  reduced: boolean;
  /** SC-4: the variant's body tint (mixed in at 35%), null for the plain train. */
  tint?: string | null;
  /** SC-4: special cars by index ('cheese' = the Cheddar dining car). */
  specials?: (string | undefined)[];
  /** SC-5: called once when the engine's front crosses the middle of the screen (the doppler). */
  onCentre?: () => void;
}

export interface TrainPainter {
  draw: (g: CanvasRenderingContext2D, w: number, h: number, t: number, dt: number) => void;
}

interface Fx {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  kind: 0 | 1 | 2; // flange spark, steam puff, ember
}

const ACCENT: Record<TrainCarKind, string> = {
  engine: "#b8693d",
  tender: "#4a3a2a",
  third: "#55704c",
  dining: "#8a4422",
  mail: "#9a2a22",
  first: "#2f5078",
  baggage: "#6a5532",
  royal: "#d4af37",
  capsule: "#c9a25a",
  carriage: "#6a5532",
  flotsam: "#4f9d8a",
};

const TAU = Math.PI * 2;

/** Mix two #rrggbb colours: k = share of b. */
function mix(a: string, b: string, k: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(((pa >> s) & 255) * (1 - k) + ((pb >> s) & 255) * k);
  return `#${((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1)}`;
}

function rrect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + rr, y);
  g.lineTo(x + w - rr, y);
  g.arcTo(x + w, y, x + w, y + rr, rr);
  g.lineTo(x + w, y + h - rr);
  g.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  g.lineTo(x + rr, y + h);
  g.arcTo(x, y + h, x, y + h - rr, rr);
  g.lineTo(x, y + rr);
  g.arcTo(x, y, x + rr, y, rr);
  g.closePath();
}

export function createTrainPainter(o: TrainPainterOpts): TrainPainter {
  const fx: Fx[] = [];
  const cap = o.reduced ? 18 : 60;
  const rate = o.reduced ? 0.3 : 1;
  const n = o.kinds.length;
  const passDur = Math.max(1, n) * o.perCar;
  let chuffPhase = 0;
  let centred = false;
  const F = fonts();
  const streaks = Array.from({ length: 8 + Math.floor(Math.random() * 7) }, () => ({ x: Math.random(), y: 0.1 + Math.random() * 0.85, len: 0.08 + Math.random() * 0.18, a: 0.05 + Math.random() * 0.07 }));

  const add = (p: Fx) => {
    if (fx.length < cap) fx.push(p);
  };

  /* ------------------------------------------------------------ cars */

  function body(g: CanvasRenderingContext2D, G: TrainGeom, i: number, xa: number, xb: number, t: number, dt: number) {
    const kind = o.kinds[i];
    const h = G.h;
    const bot = G.underY;
    const x0 = Math.max(xa, -10);
    const x1 = Math.min(xb, G.w + 10);
    if (x1 <= x0) return;
    const span = xb - xa;
    const gr = g.createLinearGradient(0, 0, 0, bot);
    gr.addColorStop(0, "#0b0907");
    gr.addColorStop(0.65, kind === "royal" ? "#241a0c" : "#1d1712");
    gr.addColorStop(1, kind === "royal" ? "#3a2a10" : "#2e251d");
    g.fillStyle = gr;
    g.fillRect(x0, 0, x1 - x0, bot);
    // floor planks
    g.fillStyle = "rgba(255,255,255,.03)";
    const pl = Math.max(10, h * 0.032);
    for (let y = pl; y < bot - h * 0.05; y += pl) g.fillRect(x0, y, x1 - x0, 1);
    // plate seams + rivet columns
    for (let k = 1; k < 6; k++) {
      const sx = xa + (span * k) / 6;
      if (sx < -6 || sx > G.w + 6) continue;
      g.fillStyle = "rgba(0,0,0,.6)";
      g.fillRect(sx - 1, 0, 2, bot - h * 0.03);
      g.fillStyle = "rgba(125,100,72,.5)";
      for (let y = 10; y < bot - h * 0.045; y += 15) {
        g.beginPath();
        g.arc(sx + 5, y, 1.6, 0, TAU);
        g.fill();
      }
    }
    const cheese = o.specials?.[i] === "cheese";
    // SC-4: the variant tint washes over the body; the Cheddar car glows cheese-yellow
    if (cheese || o.tint) {
      g.globalAlpha = cheese ? 0.3 : 0.2;
      g.fillStyle = cheese ? "#e8b43a" : (o.tint as string);
      g.fillRect(x0, 0, x1 - x0, bot);
      g.globalAlpha = 1;
    }
    // accent band (which car is this)
    g.globalAlpha = 0.75;
    g.fillStyle = cheese ? "#f2c54b" : o.tint ? mix(ACCENT[kind], o.tint, 0.35) : ACCENT[kind];
    g.fillRect(x0, bot - h * 0.05, x1 - x0, Math.max(2, h * 0.01));
    g.globalAlpha = 1;
    // sill
    const sh = Math.max(6, h * 0.03);
    const sg = g.createLinearGradient(0, bot - sh, 0, bot);
    sg.addColorStop(0, kind === "royal" ? "#6a5420" : "#4a3b2e");
    sg.addColorStop(1, "#231b14");
    g.fillStyle = sg;
    g.fillRect(x0, bot - sh, x1 - x0, sh);
    g.fillStyle = kind === "royal" ? "rgba(255,215,90,.85)" : "rgba(232,201,131,.3)";
    g.fillRect(x0, bot - sh, x1 - x0, 1.5);
    g.fillStyle = kind === "royal" ? "#d4af37" : "#7a6248";
    const step = 18;
    let x = xa + 9 + Math.max(0, Math.ceil((x0 - xa - 9) / step)) * step;
    for (; x < x1 - 4; x += step) {
      g.beginPath();
      g.arc(x, bot - sh / 2, 2, 0, TAU);
      g.fill();
    }
    // hanging boxes near the ends (battery box, brake cylinder)
    g.fillStyle = "#18120e";
    g.fillRect(xa + 0.06 * span, bot, 0.1 * span, h * 0.035);
    g.fillRect(xb - 0.16 * span, bot, 0.1 * span, h * 0.035);
    g.fillStyle = "rgba(232,201,131,.15)";
    g.fillRect(xa + 0.06 * span, bot, 0.1 * span, 1);
    g.fillRect(xb - 0.16 * span, bot, 0.1 * span, 1);

    if (kind === "engine") {
      // firebox glow + falling embers
      const fxX = xa + 0.55 * span;
      g.save();
      g.globalCompositeOperation = "lighter";
      const fl = 0.7 + 0.3 * flicker(t, 99);
      const rg = g.createRadialGradient(fxX, bot, 0, fxX, bot, h * 0.32);
      rg.addColorStop(0, `rgba(255,140,40,${0.55 * fl})`);
      rg.addColorStop(0.4, `rgba(220,80,20,${0.22 * fl})`);
      rg.addColorStop(1, "rgba(180,40,10,0)");
      g.fillStyle = rg;
      g.fillRect(fxX - h * 0.34, bot - h * 0.3, h * 0.68, h * 0.62);
      g.restore();
      if (fxX > -40 && fxX < G.w + 40 && Math.random() < 14 * rate * dt) {
        add({ x: fxX + (Math.random() - 0.5) * h * 0.2, y: bot + 2, vx: (Math.random() - 0.5) * 30, vy: 40 + Math.random() * 80, age: 0, life: 0.6 + Math.random() * 0.5, size: 1.5 + Math.random() * 1.5, kind: 2 });
      }
    }
    if (cheese) {
      const cx = (xa + xb) / 2;
      if (cx > -80 && cx < G.w + 80) {
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.font = `${Math.round(h * 0.08)}px ${EMOJI_FONT}`;
        g.fillText("🧀", cx, bot * 0.42);
        g.font = `700 ${Math.max(11, Math.round(h * 0.03))}px ${F.display}`;
        g.fillStyle = "#f2c54b";
        g.fillText("Чеддер", cx, bot * 0.42 + h * 0.07);
      }
    }
    if (kind === "royal") {
      const cx = (xa + xb) / 2;
      if (cx > -60 && cx < G.w + 60) {
        g.font = `${Math.round(h * 0.07)}px ${EMOJI_FONT}`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.globalAlpha = 0.85;
        g.fillText("👑", cx, bot * 0.5);
        g.globalAlpha = 1;
      }
    }
  }

  function coupler(g: CanvasRenderingContext2D, G: TrainGeom, xj: number) {
    const y = G.underY - G.h * 0.06;
    const r = Math.max(4, G.h * 0.022);
    const off = G.gap * 0.5 + r * 0.4;
    g.strokeStyle = "#3a3028";
    g.lineWidth = Math.max(3, r * 0.5);
    g.beginPath();
    g.moveTo(xj - off, y + r * 0.9);
    g.quadraticCurveTo(xj, y + r * 2.2, xj + off, y + r * 0.9);
    g.stroke();
    for (const bx of [xj - off, xj + off]) {
      const bg = g.createRadialGradient(bx - r * 0.3, y - r * 0.3, 1, bx, y, r);
      bg.addColorStop(0, "#8a8073");
      bg.addColorStop(1, "#2a241f");
      g.fillStyle = bg;
      g.beginPath();
      g.arc(bx, y, r, 0, TAU);
      g.fill();
    }
  }

  function wheel(g: CanvasRenderingContext2D, G: TrainGeom, cx: number, th: number, kind: TrainCarKind) {
    const R = G.wheelR;
    const cy = G.wheelCy;
    g.save();
    g.beginPath();
    g.rect(cx - R - 8, 0, 2 * R + 16, G.railY);
    g.clip();
    g.fillStyle = "rgba(8,6,5,.38)";
    g.beginPath();
    g.arc(cx, cy, R * 0.86, 0, TAU);
    g.fill();
    // spokes
    const N = 16;
    g.lineCap = "butt";
    g.strokeStyle = "#2b231d";
    g.lineWidth = Math.max(4, R * 0.034);
    g.beginPath();
    for (let k = 0; k < N; k++) {
      const a = th + (k * TAU) / N;
      const c = Math.cos(a);
      const s = Math.sin(a);
      g.moveTo(cx + c * R * 0.14, cy + s * R * 0.14);
      g.lineTo(cx + c * R * 0.86, cy + s * R * 0.86);
    }
    g.stroke();
    g.strokeStyle = "rgba(175,145,105,.28)";
    g.lineWidth = Math.max(1, R * 0.007);
    g.beginPath();
    for (let k = 0; k < N; k++) {
      const a = th + (k * TAU) / N;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const ox = -s * R * 0.014;
      const oy = c * R * 0.014;
      g.moveTo(cx + c * R * 0.16 + ox, cy + s * R * 0.16 + oy);
      g.lineTo(cx + c * R * 0.85 + ox, cy + s * R * 0.85 + oy);
    }
    g.stroke();
    // hub (usually hidden behind the rail head)
    g.fillStyle = "#2b231d";
    g.beginPath();
    g.arc(cx, cy, R * 0.16, 0, TAU);
    g.fill();
    g.fillStyle = "#4a3f35";
    g.beginPath();
    g.arc(cx, cy, R * 0.07, 0, TAU);
    g.fill();
    // counterweight (engine & tender)
    if (kind === "engine" || kind === "tender") {
      g.fillStyle = "#1b1511";
      const a0 = th + Math.PI - 0.55;
      const a1 = th + Math.PI + 0.55;
      g.beginPath();
      g.arc(cx, cy, R * 0.85, a0, a1);
      g.arc(cx, cy, R * 0.52, a1, a0, true);
      g.closePath();
      g.fill();
    }
    // rim, tyre, polished tread
    g.lineWidth = R * 0.07;
    g.strokeStyle = "#241d17";
    g.beginPath();
    g.arc(cx, cy, R * 0.885, 0, TAU);
    g.stroke();
    g.lineWidth = R * 0.075;
    g.strokeStyle = kind === "royal" ? "#5a4b2c" : "#48423b";
    g.beginPath();
    g.arc(cx, cy, R * 0.96, 0, TAU);
    g.stroke();
    g.lineWidth = 1.5;
    g.strokeStyle = "rgba(201,162,90,.28)";
    g.beginPath();
    g.arc(cx, cy, R * 0.922, 0, TAU);
    g.stroke();
    g.lineWidth = Math.max(2, R * 0.012);
    g.strokeStyle = "rgba(240,225,195,.6)";
    g.beginPath();
    g.arc(cx, cy, R * 0.995, -Math.PI * 0.93, -Math.PI * 0.07);
    g.stroke();

    if (kind === "engine") {
      // main rod from the crank pin to a crosshead sliding on its guide bar
      const yc = G.underY + G.h * 0.075;
      const px = cx + Math.cos(th) * R * 0.62;
      const py = cy + Math.sin(th) * R * 0.62;
      const hx = cx - R * 0.62 + Math.cos(th) * R * 0.22;
      g.strokeStyle = "#3a332c";
      g.lineWidth = Math.max(3, G.h * 0.012);
      g.beginPath();
      g.moveTo(cx - R * 0.95, yc);
      g.lineTo(cx - R * 0.3, yc);
      g.stroke();
      g.fillStyle = "#2a231d";
      g.fillRect(cx - R * 1.05, yc - G.h * 0.035, R * 0.16, G.h * 0.07);
      g.fillStyle = "rgba(232,201,131,.25)";
      g.fillRect(cx - R * 1.05, yc - G.h * 0.035, R * 0.16, 1.5);
      g.lineCap = "round";
      g.strokeStyle = "#6d655b";
      g.lineWidth = Math.max(6, R * 0.045);
      g.beginPath();
      g.moveTo(hx, yc);
      g.lineTo(px, py);
      g.stroke();
      g.strokeStyle = "rgba(240,230,210,.35)";
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(hx, yc - 2);
      g.lineTo(px, py - 2);
      g.stroke();
      g.fillStyle = "#8a8073";
      g.fillRect(hx - G.h * 0.025, yc - G.h * 0.02, G.h * 0.05, G.h * 0.04);
      g.beginPath();
      g.arc(px, py, Math.max(4, R * 0.04), 0, TAU);
      g.fill();
    }
    g.restore();
  }

  function contactSparks(g: CanvasRenderingContext2D, G: TrainGeom, cx: number, t: number, dt: number) {
    const dy = G.wheelCy - G.railY;
    if (dy >= G.wheelR) return;
    const half = Math.sqrt(G.wheelR * G.wheelR - dy * dy);
    const pts = [cx + half, cx - half];
    for (let k = 0; k < 2; k++) {
      const x = pts[k];
      if (x < -20 || x > G.w + 20) continue;
      // hot glow where the flange bites the rail
      const fl = 0.5 + 0.5 * flicker(t, cx * 0.01 + k);
      g.save();
      g.globalCompositeOperation = "lighter";
      const rg = g.createRadialGradient(x, G.railY, 0, x, G.railY, 18);
      rg.addColorStop(0, `rgba(255,210,120,${0.5 * fl})`);
      rg.addColorStop(1, "rgba(255,140,40,0)");
      g.fillStyle = rg;
      g.fillRect(x - 18, G.railY - 18, 36, 36);
      g.restore();
      const perSec = (k === 0 ? 34 : 12) * rate;
      if (Math.random() < perSec * dt) {
        add({ x, y: G.railY - 2, vx: (0.25 + Math.random() * 0.55) * G.speed * (k === 0 ? 1 : 0.5), vy: -(120 + Math.random() * 240), age: 0, life: 0.25 + Math.random() * 0.3, size: 1.2 + Math.random() * 1.4, kind: 0 });
      }
    }
  }

  function tag(g: CanvasRenderingContext2D, G: TrainGeom, i: number, x: number, t: number) {
    const def = TRAIN_CARS[o.kinds[i]];
    const isHook = i === o.hookCar;
    const small = G.w < 520;
    const text = `${def.icon} ${def.name}${isHook ? " · 🪝" : ""}`;
    g.font = `700 ${small ? 11 : 12}px ${F.display}`;
    const tw = g.measureText(text).width + 14;
    const y = G.underY + 6;
    const hgt = small ? 18 : 20;
    if (x + tw < 0 || x > G.w) return;
    g.strokeStyle = "#3a2e22";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x + 6, G.underY);
    g.lineTo(x + 6, y);
    g.moveTo(x + tw - 6, G.underY);
    g.lineTo(x + tw - 6, y);
    g.stroke();
    const bg = g.createLinearGradient(0, y, 0, y + hgt);
    bg.addColorStop(0, "#e8c983");
    bg.addColorStop(1, "#9c7a3c");
    g.fillStyle = bg;
    rrect(g, x, y, tw, hgt, 3);
    g.fill();
    if (isHook) {
      const pulse = 0.5 + 0.5 * Math.sin(t * 8);
      g.strokeStyle = `rgba(255,230,120,${0.5 + 0.5 * pulse})`;
      g.lineWidth = 2 + pulse * 2;
      g.stroke();
    }
    g.fillStyle = "#231b12";
    g.textAlign = "left";
    g.textBaseline = "middle";
    g.fillText(text, x + 7, y + hgt / 2 + 1);
  }

  function drawTrain(g: CanvasRenderingContext2D, G: TrainGeom, t: number, dt: number) {
    const L = G.carLen;
    const w = G.w;
    const h = G.h;
    const front = carLeft(G, 0, t, o.perCar);
    const rear = carLeft(G, n, t, o.perCar);
    const th = -(t * G.speed) / G.wheelR;
    if (!centred && front <= w / 2) {
      centred = true;
      o.onCentre?.();
    }

    // shade under the train
    const sa = Math.max(0, front);
    const sb = Math.min(w, rear);
    if (sb > sa) {
      g.fillStyle = "rgba(6,4,3,.5)";
      g.fillRect(sa, 0, sb - sa, G.railY);
    }
    // tunnel light flickering through the gaps between cars
    g.save();
    g.globalCompositeOperation = "lighter";
    for (let j = 1; j < n; j++) {
      const xj = carLeft(G, j, t, o.perCar);
      if (xj < -L * 0.15 || xj > w + L * 0.15) continue;
      const f = 0.3 + 0.7 * flicker(t, j);
      const gr = g.createLinearGradient(0, 0, 0, G.railY);
      gr.addColorStop(0, `rgba(255,214,140,${0.62 * f})`);
      gr.addColorStop(0.35, `rgba(255,190,110,${0.24 * f})`);
      gr.addColorStop(1, "rgba(255,170,90,0)");
      g.fillStyle = gr;
      const gw = G.gap;
      g.beginPath();
      g.moveTo(xj - gw * 0.5, 0);
      g.lineTo(xj + gw * 0.5, 0);
      g.lineTo(xj + gw * 2, G.railY);
      g.lineTo(xj - gw * 2, G.railY);
      g.closePath();
      g.fill();
    }
    g.restore();

    for (let i = 0; i < n; i++) {
      const left = carLeft(G, i, t, o.perCar);
      if (left > w || left + L < 0) continue;
      body(g, G, i, left + G.gap / 2, left + L - G.gap / 2, t, dt);
    }
    // SC-5: speed streaks over the underside and the gap light, 1.5× the train's speed
    if (!o.reduced && sb > sa) {
      g.save();
      g.beginPath();
      g.rect(sa, 0, sb - sa, G.railY);
      g.clip();
      for (const s of streaks) {
        const len = s.len * w;
        const x = w - ((s.x * (w + len) + t * G.speed * 1.5) % (w + len));
        g.fillStyle = `rgba(255,240,210,${s.a})`;
        g.fillRect(x, s.y * G.railY, len, 1.5);
      }
      g.restore();
    }
    for (let j = 1; j < n; j++) {
      const xj = carLeft(G, j, t, o.perCar);
      if (xj > -40 && xj < w + 40) coupler(g, G, xj);
    }
    for (let i = 0; i < n; i++) {
      const cx = carLeft(G, i, t, o.perCar) + L / 2;
      if (cx + G.wheelR < -10 || cx - G.wheelR > w + 10) continue;
      wheel(g, G, cx, th + i * 0.71, o.kinds[i]);
      contactSparks(g, G, cx, t, dt);
    }
    for (let i = 0; i < n; i++) tag(g, G, i, carLeft(G, i, t, o.perCar) + G.gap + L * 0.05, t);

    // engine headlamp + beam ahead, red tail lamp behind
    if (front > -60 && front < w + 60) {
      g.save();
      g.globalCompositeOperation = "lighter";
      const ly = G.underY * 0.55;
      const beam = g.createLinearGradient(front, 0, front - w * 0.6, 0);
      beam.addColorStop(0, "rgba(255,236,190,.22)");
      beam.addColorStop(1, "rgba(255,236,190,0)");
      g.fillStyle = beam;
      g.beginPath();
      g.moveTo(front, ly - h * 0.05);
      g.lineTo(front - w * 0.6, ly - h * 0.25);
      g.lineTo(front - w * 0.6, G.railY);
      g.lineTo(front, ly + h * 0.05);
      g.closePath();
      g.fill();
      const lg = g.createRadialGradient(front + 8, ly, 0, front + 8, ly, h * 0.3);
      lg.addColorStop(0, "rgba(255,245,215,.9)");
      lg.addColorStop(0.15, "rgba(255,225,160,.5)");
      lg.addColorStop(1, "rgba(255,200,120,0)");
      g.fillStyle = lg;
      g.fillRect(front + 8 - h * 0.3, ly - h * 0.3, h * 0.6, h * 0.6);
      g.restore();
    }
    if (rear > -40 && rear < w + 60) {
      g.save();
      g.globalCompositeOperation = "lighter";
      const ly = G.underY * 0.6;
      const rg = g.createRadialGradient(rear - G.gap, ly, 0, rear - G.gap, ly, h * 0.13);
      rg.addColorStop(0, "rgba(255,90,60,.9)");
      rg.addColorStop(0.3, "rgba(220,40,30,.35)");
      rg.addColorStop(1, "rgba(200,30,20,0)");
      g.fillStyle = rg;
      g.fillRect(rear - G.gap - h * 0.13, ly - h * 0.13, h * 0.26, h * 0.26);
      g.restore();
    }

    // steam puffs in time with the chuffing (2 → 8 Hz)
    const chuffRate = 2 + 6 * clamp(t / passDur);
    const before = Math.floor(chuffPhase);
    chuffPhase += chuffRate * dt;
    if (Math.floor(chuffPhase) !== before) {
      const ex = carLeft(G, 0, t, o.perCar) + L / 2 - G.wheelR * 1.0;
      if (ex > -80 && ex < w + 80) {
        for (let k = 0; k < 3; k++) {
          add({ x: ex + (Math.random() - 0.5) * 20, y: G.underY + h * 0.07, vx: 20 + Math.random() * 50, vy: -(10 + Math.random() * 40), age: 0, life: 0.8 + Math.random() * 0.5, size: 8 + Math.random() * 8, kind: 1 });
        }
      }
    }
  }

  /* ------------------------------------------------------------ capsules */

  function flange(g: CanvasRenderingContext2D, G: TrainGeom, x: number) {
    const top = G.tubeTop - G.h * 0.012;
    const hh = G.tubeBot - G.tubeTop + G.h * 0.024;
    const fw = Math.max(8, G.w * 0.012);
    const gr = g.createLinearGradient(x - fw / 2, 0, x + fw / 2, 0);
    gr.addColorStop(0, "#7d5f2c");
    gr.addColorStop(0.4, "#f0d590");
    gr.addColorStop(1, "#6b5024");
    g.fillStyle = gr;
    rrect(g, x - fw / 2, top, fw, hh, 3);
    g.fill();
    g.fillStyle = "#4a3818";
    for (let k = 0; k < 3; k++) {
      g.beginPath();
      g.arc(x, top + hh * (0.18 + 0.32 * k), 1.6, 0, TAU);
      g.fill();
    }
  }

  function drawCapsules(g: CanvasRenderingContext2D, G: TrainGeom, t: number) {
    const L = G.carLen;
    const top = G.tubeTop + G.h * 0.03;
    const bot = G.tubeBot - G.h * 0.03;
    const ch = Math.max(8, bot - top);
    g.save();
    g.beginPath();
    g.rect(0, G.tubeTop + 3, G.w, G.tubeBot - G.tubeTop - 6);
    g.clip();
    for (let i = 0; i < n; i++) {
      const slot = carLeft(G, i, t, o.perCar);
      const xa = slot + 0.2 * L;
      const xb = slot + 0.8 * L;
      if (xb < -40 || xa > G.w + 40) continue;
      g.fillStyle = "rgba(255,236,190,.08)";
      for (let k = 0; k < 4; k++) g.fillRect(xb, top + ch * (0.2 + 0.2 * k), L * 0.35 * (1 - 0.2 * k), 2);
      const gr = g.createLinearGradient(0, top, 0, top + ch);
      gr.addColorStop(0, "#6b5024");
      gr.addColorStop(0.22, "#f0d590");
      gr.addColorStop(0.5, "#c9a25a");
      gr.addColorStop(1, "#5d4520");
      g.fillStyle = gr;
      rrect(g, xa, top, xb - xa, ch, ch * 0.5);
      g.fill();
      g.fillStyle = "#8a4a26";
      rrect(g, xa, top, ch * 0.45, ch, ch * 0.5);
      g.fill();
      rrect(g, xb - ch * 0.45, top, ch * 0.45, ch, ch * 0.5);
      g.fill();
      g.fillStyle = "rgba(60,40,20,.55)";
      g.fillRect(xa + (xb - xa) * 0.33, top, 4, ch);
      g.fillRect(xa + (xb - xa) * 0.67, top, 4, ch);
      g.fillStyle = "rgba(40,28,12,.8)";
      g.font = `700 ${Math.round(ch * 0.4)}px ${F.display}`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(`№${i + 1}`, (xa + xb) / 2, top + ch / 2 + 1);
    }
    g.restore();
    g.fillStyle = "rgba(225,245,250,.16)";
    g.fillRect(0, G.tubeTop + G.h * 0.018, G.w, Math.max(2, G.h * 0.012));
    g.fillStyle = "rgba(225,245,250,.07)";
    g.fillRect(0, G.tubeBot - G.h * 0.03, G.w, Math.max(2, G.h * 0.008));
    for (let k = 0; k < 5; k++) flange(g, G, G.w * (0.11 + 0.22 * k));
  }

  /* ------------------------------------------------------------ particles */

  function stepFx(g: CanvasRenderingContext2D, dt: number) {
    g.save();
    for (let i = fx.length - 1; i >= 0; i--) {
      const p = fx[i];
      p.age += dt;
      if (p.age >= p.life) {
        fx.splice(i, 1);
        continue;
      }
      const k = p.age / p.life;
      if (p.kind === 0) {
        p.vy += 900 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        g.globalCompositeOperation = "lighter";
        g.strokeStyle = `rgba(255,${Math.round(220 - 120 * k)},${Math.round(120 - 90 * k)},${1 - k})`;
        g.lineWidth = p.size;
        g.beginPath();
        g.moveTo(p.x, p.y);
        g.lineTo(p.x - p.vx * 0.025, p.y - p.vy * 0.025);
        g.stroke();
      } else if (p.kind === 1) {
        p.vx *= Math.exp(-1.2 * dt);
        p.vy *= Math.exp(-0.8 * dt);
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.size += 34 * dt;
        g.globalCompositeOperation = "source-over";
        g.fillStyle = `rgba(222,228,228,${0.32 * (1 - k)})`;
        g.beginPath();
        g.arc(p.x, p.y, p.size, 0, TAU);
        g.fill();
      } else {
        p.vy += 160 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        g.globalCompositeOperation = "lighter";
        g.fillStyle = `rgba(255,${Math.round(150 - 80 * k)},40,${1 - k})`;
        g.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
    }
    g.restore();
  }

  return {
    draw(g, w, h, t, dt) {
      const G = trainGeom(w, h, o.perCar, o.capsule);
      if (o.capsule) drawCapsules(g, G, t);
      else drawTrain(g, G, t, dt);
      stepFx(g, dt);
    },
  };
}
