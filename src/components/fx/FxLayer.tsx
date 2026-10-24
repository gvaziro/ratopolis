"use client";

/**
 * Global floating-number / particle layer (fixed, above everything, never catches pointer events).
 * Listens to engine fx (onFx) and UI fx (onUiFx); draws on one canvas with its own rAF loop.
 */
import { useEffect, useRef } from "react";
import { RESOURCES } from "@/game/data/resources";
import { UPGRADES } from "@/game/data/upgrades";
import { onFx, onUiFx } from "@/game/fx";
import { useGame } from "@/game/store";
import type { Fx } from "@/game/types";
import { fmt } from "@/lib/format";
import { uiX, uiY } from "@/components/colony/geometry";
import {
  clampToColony,
  flightStart,
  getColonyRect,
  getFxAnchor,
  recentFxPoint,
  registerFxImpl,
  resolveAnchor,
  type Pt,
} from "./fxBus";
import { FxSystem } from "./particles";

export { setFxAnchor, fxBurst, fxText, markFxPoint } from "./fxBus";

const FULL_RED = "#e8705f";
const GOLD = "#ffd34d";
/** Wind-up rat floats stop this long after the player's last input. */
const AUTO_IDLE_MS = 8000;

export default function FxLayer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const sys = new FxSystem(canvas, ctx);
    const settings = () => useGame.getState().game.settings;
    const syncDensity = () => {
      sys.density = settings().reducedMotion ? 0.3 : 1;
    };
    syncDensity();
    registerFxImpl(sys);

    const center = (): Pt => {
      const r = getColonyRect();
      return r ? { x: r.left + r.width / 2, y: r.top + r.height * 0.35 } : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    };
    const grate = (): Pt => getFxAnchor() ?? center();
    /** Engine positions: client px, or 0..1 fractions of the colony view (`frac`, shinies: drawn through the CO-8 remap). */
    const at = (x: number | undefined, y: number | undefined, frac = false): Pt | null => {
      if (x === undefined || y === undefined) return null;
      if (frac) {
        const r = getColonyRect();
        if (r) return { x: r.left + uiX(x) * r.width, y: r.top + uiY(y) * r.height };
      }
      return { x, y };
    };
    const jitter = (p: Pt, dx: number, dy: number): Pt => ({ x: p.x + (Math.random() * 2 - 1) * dx, y: p.y + (Math.random() * 2 - 1) * dy });

    let lastAuto = 0;
    let lastManual = -Infinity;
    // the finds of a hidden wind-up click are hidden with it (they follow its click fx in the same dispatch)
    let autoHidden = false;
    const handle = (fx: Fx) => {
      switch (fx.k) {
        case "click": {
          const now = performance.now();
          autoHidden = false;
          if (fx.auto) {
            // wind-up rats: at most 2 floats a second, none over the player's own clicks, none for an idle
            // player (nobody watches — and the particle loop may sleep) and none with reduced motion
            const st = useGame.getState();
            const hide = st.game.settings.reducedMotion || now - lastManual < 2000 || now - lastAuto < 500 || Date.now() - st.lastInputAt > AUTO_IDLE_MS;
            if (hide) {
              autoHidden = true;
              queueMicrotask(() => {
                autoHidden = false;
              });
              break;
            }
            lastAuto = now;
          } else lastManual = now;
          const p0 = at(fx.x, fx.y) ?? jitter(grate(), 26, 8);
          const p = fx.auto ? jitter(p0, 18, 6) : { x: p0.x, y: p0.y - 14 };
          if (fx.full) {
            sys.text({ text: "ПОЛНО", x: p.x, y: p.y, color: FULL_RED, stamp: true, alpha: fx.auto ? 0.7 : 1, size: fx.auto ? 14 : 18 });
          } else {
            sys.text({
              text: `+${fmt(fx.amount)}`,
              x: p.x,
              y: p.y,
              color: RESOURCES.crumbs.color,
              size: fx.auto ? 15 : 24,
              alpha: fx.auto ? 0.75 : 1,
            });
          }
          if (!fx.auto) sys.burst(p0.x, p0.y, "crumb", 3);
          break;
        }
        case "drop": {
          if (autoHidden && !fx.big) break;
          const p = at(fx.x, fx.y, fx.frac) ?? recentFxPoint() ?? jitter(grate(), 30, 10);
          const q = { x: p.x + (Math.random() * 2 - 1) * 22, y: p.y - 40 };
          const def = RESOURCES[fx.res];
          sys.text({ text: `+${fmt(fx.amount)} ${def.icon}`, x: q.x, y: q.y, color: def.color, big: fx.big, size: fx.big ? 28 : 21 });
          sys.burst(q.x, q.y + 6, "glint", fx.big ? 12 : 4);
          break;
        }
        case "find": {
          const p = recentFxPoint() ?? grate();
          const def = RESOURCES[fx.res];
          sys.text({ text: `Находка! +${fmt(fx.amount)} ${def.icon}`, x: p.x, y: p.y - 56, color: GOLD, big: true, size: 32, dur: 1500 });
          sys.burst(p.x, p.y - 40, "gold", 26, 1.2);
          break;
        }
        case "medal":
          sys.burst(window.innerWidth / 2, 64, "confetti", 46);
          break;
        case "milestone": {
          // an off-screen chamber (a buy from the panel) bursts at the colony edge, not over the panel
          const a = resolveAnchor(`building:${fx.building}`);
          const p = a ? clampToColony(a) : center();
          sys.burst(p.x, p.y, "gold", 30, 1.1);
          break;
        }
        case "zoneOpen": {
          const r = getColonyRect();
          if (r) sys.scatter(r, "gold", 48);
          else sys.burst(window.innerWidth / 2, window.innerHeight / 2, "gold", 40, 2);
          break;
        }
        case "frenzy": {
          const until = performance.now() + 10_000;
          sys.edgeSparks({ until, rect: getColonyRect });
          break;
        }
        case "purse": {
          const p = recentFxPoint(2500) ?? center();
          sys.burst(p.x, p.y, "gold", 22, 1.2);
          break;
        }
        case "upgrade": {
          // CO-7: a patent stamp over the colony and a spray of brass cogs
          const p = center();
          sys.text({ text: `${UPGRADES[fx.upgrade]?.icon ?? "🔬"} ПАТЕНТ!`, x: p.x, y: p.y, color: "#f2d896", stamp: true, size: 26, dur: 1300 });
          sys.burst(p.x, p.y + 10, "gear", 18, 1);
          break;
        }
        default:
          break;
      }
    };

    const offFx = onFx(handle);
    const offUi = onUiFx((fx) => {
      if (fx.k === "float") {
        sys.text({ text: fx.text, x: fx.x, y: fx.y, color: fx.color, big: fx.big });
      } else if (fx.k === "fly") {
        // CO-7: a card buy flies its icon to the chamber (or to the colony edge when it is off-screen);
        // the chamber bounces when it lands (flightStart/onLand)
        if (settings().reducedMotion) return;
        const to = clampToColony(resolveAnchor(fx.target) ?? center(), 24, 36);
        const from = fx.from;
        const ctrl = { x: (from.x + to.x) / 2, y: Math.min(from.y, to.y) - 120 };
        const el = document.createElement("span");
        el.textContent = fx.icon;
        el.setAttribute("aria-hidden", "true");
        el.style.cssText = "position:fixed;left:0;top:0;z-index:60;pointer-events:none;font-size:26px;line-height:1;will-change:transform";
        document.body.appendChild(el);
        const frames: Keyframe[] = [];
        for (let i = 0; i <= 8; i++) {
          const k = i / 8;
          const x = (1 - k) * (1 - k) * from.x + 2 * (1 - k) * k * ctrl.x + k * k * to.x;
          const y = (1 - k) * (1 - k) * from.y + 2 * (1 - k) * k * ctrl.y + k * k * to.y;
          frames.push({ transform: `translate(${x - 13}px,${y - 13}px) scale(${1 - 0.4 * k})`, offset: k });
        }
        const land = flightStart(fx.target);
        let landed = false;
        let fallback = 0;
        const finish = () => {
          if (landed) return;
          landed = true;
          window.clearTimeout(fallback);
          el.remove();
          sys.burst(to.x, to.y, "glint", 10);
          land();
        };
        const anim = el.animate(frames, { duration: 450, easing: "cubic-bezier(.4,0,.6,1)" });
        anim.onfinish = finish;
        anim.oncancel = finish;
        // a throttled timeline (hidden tab) must not leave the chamber waiting for its bounce
        fallback = window.setTimeout(finish, 700);
      } else if (fx.k === "flash") {
        const el = flashRef.current;
        if (!el || settings().reducedMotion) return;
        el.style.background = fx.color;
        el.animate([{ opacity: 0.55 }, { opacity: 0 }], { duration: Math.max(120, fx.ms), easing: "ease-out" });
      }
    });

    // Particle trail behind the cursor while the colony bustles (> 50%) or during frenzy.
    let lastTrail = 0;
    const onMove = (e: PointerEvent) => {
      const now = performance.now();
      if (now - lastTrail < 34) return;
      const g = useGame.getState().game;
      const frenzy = g.buffs.frenzyUntil > g.time;
      if (!frenzy && (!g.revealed.bustle || g.bustle.value <= 50)) return;
      const r = getColonyRect();
      if (!r || e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
      lastTrail = now;
      sys.burst(e.clientX, e.clientY, frenzy ? "spark" : "ember", 1, 0.3);
    };

    const onResize = () => sys.resize();
    const unsubSettings = useGame.subscribe((s, prev) => {
      if (s.game.settings.reducedMotion !== prev.game.settings.reducedMotion) syncDensity();
    });

    window.addEventListener("resize", onResize);
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      offFx();
      offUi();
      unsubSettings();
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onMove);
      registerFxImpl(null);
      sys.destroy();
    };
  }, []);

  return (
    <>
      <canvas ref={canvasRef} aria-hidden className="pointer-events-none fixed inset-0 z-50" />
      <div ref={flashRef} aria-hidden className="pointer-events-none fixed inset-0 z-50 opacity-0" />
    </>
  );
}
