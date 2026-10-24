import type { ZoneId } from "@/game/types";
import { BAND_H, bandTop, STREET_H, W, ZOOMS, type Pt } from "./geometry";

/**
 * Imperative camera for the colony SVG: sets the viewBox directly (no React renders),
 * handles drag / wheel / pinch, eases zoom between zone counts and auto-centres on new zones.
 */

export interface CamView {
  cx: number; // world centre
  cy: number;
  s: number; // px per world unit
  cw: number; // container size (px)
  ch: number;
  left: number; // container client rect
  top: number;
}

type Mode = { k: "home" } | { k: "zone"; zone: ZoneId } | { k: "free" } | { k: "overview" };

const MAX_ZOOM = 1.8;

const view: CamView = { cx: W / 2, cy: 300, s: 1, cw: 1, ch: 1, left: 0, top: 0 };
const listeners = new Set<(v: CamView) => void>();
let dragGuardUntil = 0;

export function onCamera(fn: (v: CamView) => void): () => void {
  listeners.add(fn);
  fn(view);
  return () => {
    listeners.delete(fn);
  };
}

export function camView(): Readonly<CamView> {
  return view;
}

/** World → client coordinates. */
export function toScreen(wx: number, wy: number): Pt {
  return { x: view.left + view.cw / 2 + (wx - view.cx) * view.s, y: view.top + view.ch / 2 + (wy - view.cy) * view.s };
}

/** True right after a drag ended — click handlers use it to ignore the release of a pan. */
export function wasDrag(): boolean {
  return performance.now() < dragGuardUntil;
}

export interface CamInputs {
  open: number; // open zone count 1..5
  hasLocked: boolean;
  reducedMotion: boolean;
}

export class CameraController {
  private mode: Mode = { k: "home" };
  private userZoom = 1;
  private raf = 0;
  private last = 0;
  private inputs: CamInputs = { open: 1, hasLocked: true, reducedMotion: false };
  private pointers = new Map<number, Pt>();
  private drag: { id: number; x: number; y: number; moved: boolean } | null = null;
  private pinch: { d0: number; z0: number } | null = null;
  private homeTimer = 0;
  private ro: ResizeObserver | null = null;
  private first = true;
  /** Called when the player starts panning (to close tooltips), when "away from home" flips and when the 🔭 overview toggles. */
  onDragStart: () => void = () => {};
  onAwayChange: (away: boolean) => void = () => {};
  onOverviewChange: (on: boolean) => void = () => {};
  private away = false;
  private overviewOn = false;

  constructor(
    private container: HTMLDivElement,
    private svg: SVGSVGElement,
  ) {}

  attach(): void {
    const c = this.container;
    c.addEventListener("pointerdown", this.down);
    c.addEventListener("pointermove", this.move);
    c.addEventListener("pointerup", this.up);
    c.addEventListener("pointercancel", this.up);
    c.addEventListener("lostpointercapture", this.lost);
    c.addEventListener("wheel", this.wheel, { passive: false });
    window.addEventListener("resize", this.measure);
    window.addEventListener("scroll", this.measure, { passive: true });
    this.ro = new ResizeObserver(() => {
      this.measure();
    });
    this.ro.observe(c);
    this.measure();
  }

  detach(): void {
    const c = this.container;
    c.removeEventListener("pointerdown", this.down);
    c.removeEventListener("pointermove", this.move);
    c.removeEventListener("pointerup", this.up);
    c.removeEventListener("pointercancel", this.up);
    c.removeEventListener("lostpointercapture", this.lost);
    c.removeEventListener("wheel", this.wheel);
    window.removeEventListener("resize", this.measure);
    window.removeEventListener("scroll", this.measure);
    this.ro?.disconnect();
    cancelAnimationFrame(this.raf);
    window.clearTimeout(this.homeTimer);
    this.raf = 0;
  }

  setInputs(i: CamInputs): void {
    this.inputs = i;
    this.kick();
  }

  /** Pan to a zone band; optionally return home after `homeAfterMs`. */
  focusZone(zone: ZoneId, homeAfterMs: number | null): void {
    if (this.mode.k === "overview") this.userZoom = 1; // from the overview a pip dives back in
    this.mode = { k: "zone", zone };
    window.clearTimeout(this.homeTimer);
    if (homeAfterMs !== null) {
      this.homeTimer = window.setTimeout(() => {
        if (this.mode.k === "zone") this.home();
      }, homeAfterMs);
    }
    this.kick();
  }

  home(): void {
    this.mode = { k: "home" };
    this.userZoom = 1;
    window.clearTimeout(this.homeTimer);
    this.kick();
  }

  /** 🔭: zoom out until the whole colony (and the next locked band) fits. */
  overview(): void {
    this.mode = { k: "overview" };
    this.userZoom = this.fitAllScale() / this.scaleFor(1);
    window.clearTimeout(this.homeTimer);
    this.kick();
  }

  toggleOverview(): void {
    if (this.mode.k === "overview") this.home();
    else this.overview();
  }

  /* ------------------------------------------------------------ geometry */

  private measure = (): void => {
    const r = this.container.getBoundingClientRect();
    const cw = Math.max(1, r.width);
    const ch = Math.max(1, r.height);
    // (the view is module state: a remounted camera — a new run — must still apply its first frame)
    if (!this.first && cw === view.cw && ch === view.ch && r.left === view.left && r.top === view.top) return;
    view.cw = cw;
    view.ch = ch;
    view.left = r.left;
    view.top = r.top;
    this.kick(true);
  };

  /**
   * Scale for a given user zoom. The home view always fills the width (the world never shrinks below
   * ~92% of the view as zones open — on phones the full width); deeper zones are reached by drag, wheel or the pips.
   */
  private scaleFor(userZoom: number): number {
    const base = Math.max(0.22, Math.min(MAX_ZOOM, Math.min(view.cw / W, view.ch / (STREET_H + BAND_H + 24))));
    const z = ZOOMS[Math.min(ZOOMS.length, Math.max(1, this.inputs.open)) - 1];
    const fitW = (view.cw / (W + 40)) * (view.cw < 640 ? 1 : 0.92);
    return Math.max(base * z, fitW) * userZoom;
  }

  /** Scale at which the whole colony fits the view. */
  private fitAllScale(): number {
    return Math.max(0.05, Math.min(view.cw / (W + 40), view.ch / (this.contentBottom() + 24)));
  }

  /** Smallest user zoom: the old 0.6, or less when that is what it takes to see the whole colony. */
  private minZoom(): number {
    return Math.min(0.6, this.fitAllScale() / this.scaleFor(1));
  }

  private targetScale(): number {
    if (this.mode.k === "overview") {
      // keep fitting while the view resizes or a zone opens
      const fit = this.fitAllScale();
      this.userZoom = fit / this.scaleFor(1);
      return fit;
    }
    return this.scaleFor(this.userZoom);
  }

  private contentBottom(): number {
    return STREET_H + (this.inputs.open + (this.inputs.hasLocked ? 1 : 0)) * BAND_H + 30;
  }

  private clampX(cx: number, s: number): number {
    const vw = view.cw / s;
    if (vw >= W + 40) return W / 2;
    return Math.max(vw / 2 - 20, Math.min(W + 20 - vw / 2, cx));
  }

  private clampY(cy: number, s: number): number {
    const vh = view.ch / s;
    const min = vh / 2 - 8;
    const max = Math.max(min, this.contentBottom() - vh / 2);
    return Math.max(min, Math.min(max, cy));
  }

  private targetY(s: number): number {
    const vh = view.ch / s;
    if (this.mode.k === "home") return vh / 2 - 8;
    if (this.mode.k === "zone") return bandTop(this.mode.zone) + BAND_H / 2;
    if (this.mode.k === "overview") return (this.contentBottom() - 8) / 2;
    return view.cy;
  }

  /* ------------------------------------------------------------ loop */

  /** Schedule an easing frame; `measured` = only the container changed (a rAF also covers paused frames). */
  private kick(measured = false): void {
    // the first measurement reaches the listeners at once, even where frames are paused (background tab)
    if (measured && this.first) {
      this.last = performance.now();
      this.frame(this.last);
      return;
    }
    if (this.raf) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (now: number): void => {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const instant = this.first || this.inputs.reducedMotion;
    this.first = false;
    const ts = this.targetScale();
    const k = instant ? 1 : 1 - Math.exp(-dt * 5);
    view.s += (ts - view.s) * k;
    if (Math.abs(ts - view.s) < 1e-4) view.s = ts;
    const ty = this.clampY(this.targetY(view.s), view.s);
    const tx = this.mode.k === "free" ? this.clampX(view.cx, view.s) : this.clampX(W / 2, view.s);
    // pips and zone events glide quickly (a band is centred in well under 0.7 s); drags settle gently
    const kp = instant ? 1 : 1 - Math.exp(-dt * (this.mode.k === "free" ? 3.6 : 6.5));
    view.cy += (ty - view.cy) * kp;
    view.cx += (tx - view.cx) * kp;
    if (Math.abs(ty - view.cy) < 0.3) view.cy = ty;
    if (Math.abs(tx - view.cx) < 0.3) view.cx = tx;
    this.apply();
    const settled = view.s === ts && view.cy === ty && view.cx === tx;
    if (!settled) {
      this.last = now;
      this.raf = requestAnimationFrame(this.frame);
    }
  };

  private apply(): void {
    const vw = view.cw / view.s;
    const vh = view.ch / view.s;
    this.svg.setAttribute("viewBox", `${(view.cx - vw / 2).toFixed(2)} ${(view.cy - vh / 2).toFixed(2)} ${vw.toFixed(2)} ${vh.toFixed(2)}`);
    for (const fn of listeners) fn(view);
    const away = this.mode.k !== "home" && (view.cy - (vh / 2 - 8) > vh * 0.35 || Math.abs(this.userZoom - 1) > 0.05);
    if (away !== this.away) {
      this.away = away;
      this.onAwayChange(away);
    }
    const ov = this.mode.k === "overview";
    if (ov !== this.overviewOn) {
      this.overviewOn = ov;
      this.onOverviewChange(ov);
    }
  }

  /* ------------------------------------------------------------ input */

  private down = (e: PointerEvent): void => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    // grate, purse, shinies and widgets handle their own presses
    if (e.target instanceof Element && e.target.closest("[data-nodrag]")) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const r = this.container.getBoundingClientRect();
    view.left = r.left;
    view.top = r.top;
    if (this.pointers.size === 1) {
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = { d0: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), z0: this.userZoom };
      this.drag = null;
    }
  };

  private move = (e: PointerEvent): void => {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pinch && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      this.userZoom = Math.max(this.minZoom(), Math.min(MAX_ZOOM, (this.pinch.z0 * d) / this.pinch.d0));
      this.mode = { k: "free" };
      this.kick();
      return;
    }
    const dr = this.drag;
    if (!dr || dr.id !== e.pointerId) return;
    const dx = e.clientX - dr.x;
    const dy = e.clientY - dr.y;
    if (!dr.moved) {
      if (Math.abs(dx) + Math.abs(dy) < 7) return;
      dr.moved = true;
      this.mode = { k: "free" };
      window.clearTimeout(this.homeTimer);
      try {
        this.container.setPointerCapture(e.pointerId);
      } catch {
        /* pointer already gone */
      }
      this.onDragStart();
    }
    dr.x = e.clientX;
    dr.y = e.clientY;
    view.cx = this.clampX(view.cx - dx / view.s, view.s);
    view.cy = this.clampY(view.cy - dy / view.s, view.s);
    this.apply();
  };

  private up = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (this.drag && this.drag.id === e.pointerId) {
      if (this.drag.moved) dragGuardUntil = performance.now() + 250;
      this.drag = null;
    }
  };

  private lost = (e: PointerEvent): void => {
    if (this.pointers.has(e.pointerId)) this.up(e);
  };

  private wheel = (e: WheelEvent): void => {
    // overlays marked data-wheel-scroll (the goal list, the tips) take the wheel: they scroll, the colony stays put
    const sc = !e.ctrlKey && e.target instanceof Element ? e.target.closest("[data-wheel-scroll]") : null;
    if (sc) {
      const room = e.deltaY < 0 ? sc.scrollTop : e.deltaY > 0 ? sc.scrollHeight - sc.clientHeight - sc.scrollTop : 0;
      if (room < 1) e.preventDefault();
      return;
    }
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 18 : e.deltaMode === 2 ? view.ch : 1;
    if (e.ctrlKey) {
      this.userZoom = Math.max(this.minZoom(), Math.min(MAX_ZOOM, this.userZoom * Math.exp(-e.deltaY * unit * 0.002)));
      this.mode = { k: "free" };
      this.kick();
      return;
    }
    this.mode = { k: "free" };
    window.clearTimeout(this.homeTimer);
    view.cy = this.clampY(view.cy + (e.deltaY * unit) / view.s, view.s);
    view.cx = this.clampX(view.cx + (e.deltaX * unit) / view.s, view.s);
    this.apply();
  };
}
