"use client";

/**
 * Tooltip rendered into a fixed-position portal so scroll/overflow containers (the resource bar,
 * the header) never clip it. Mouse: hover. Touch/pen: tap toggles, auto-hides after 4 s.
 * Keyboard (v3 SHL-4): the trigger is a Tab stop; keyboard focus opens the tip, Enter toggles it, blur and Esc
 * (the shell's "rr-escape") close it, and the open tip describes the trigger (aria-describedby).
 * «Размер текста» (v3 SHL-3): the portal lives outside the zoomed layout columns, so the tip zooms itself (.ui-zoom,
 * --ui-zoom on <html>); CSS zoom also scales its own left/top/max-width, so those are written divided by the factor.
 */
import { useEffect, useId, useRef, useState, type AriaRole, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cx } from "@/components/ui/kit";

/** The window event the shell's Esc dispatches (useHotkeys ESCAPE_EVENT; not imported: useHotkeys pulls the panels in). */
const ESCAPE_EVENT = "rr-escape";

interface Pos {
  x: number;
  y: number;
  below: boolean;
  touch: boolean;
  maxW: number;
  /** --ui-zoom when it opened */
  z: number;
}

/** The text-scale factor the shell writes on <html> (GameRoot), 1 when unset. */
function uiZoom(): number {
  const z = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ui-zoom"));
  return Number.isFinite(z) && z > 0 ? z : 1;
}

export default function FloatTip({
  tip,
  children,
  className,
  prefer = "below",
  width = 240,
  label,
  role,
}: {
  tip: ReactNode;
  children: ReactNode;
  className?: string;
  /** Which side to try first. */
  prefer?: "below" | "above";
  width?: number;
  /** Accessible name of the trigger (a resource pill reads «Крошки: 10,1 тыс. из 11,8 тыс., …»). */
  label?: string;
  /** Role of the trigger (a pill is a listitem of the resource list). */
  role?: AriaRole;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<Pos | null>(null);
  const id = useId();

  const open = (touch: boolean) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const z = uiZoom();
    const roomBelow = window.innerHeight - r.bottom;
    const below = prefer === "below" ? roomBelow > 140 * z || r.top < 140 * z : r.top < 140 * z;
    // screen pixels: the tip grows with the text, but never past the viewport's 8-px margins
    const maxW = Math.min(width * z, window.innerWidth - 16);
    const x = Math.min(Math.max(r.left + r.width / 2, maxW / 2 + 8), window.innerWidth - maxW / 2 - 8);
    const y = below ? r.bottom + 6 : r.top - 6;
    // (a re-measure that finds the trigger where it was keeps the same state: no re-render)
    setPos((p) => (p && p.x === x && p.y === y && p.below === below && p.touch === touch && p.maxW === maxW && p.z === z ? p : { x, y, below, touch, maxW, z }));
  };
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  });

  useEffect(() => {
    if (!pos) return;
    const off = () => setPos(null);
    // a keyboard-focused trigger keeps its tip through a scroll (Tab into the overflowing resource row scrolls it):
    // the tip follows the trigger; any other scroll closes it
    const onScroll = () => {
      if (!pos.touch && ref.current?.matches(":focus-visible")) openRef.current(false);
      else off();
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", off);
    window.addEventListener(ESCAPE_EVENT, off);
    const t = pos.touch ? window.setTimeout(off, 4000) : 0;
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", off);
      window.removeEventListener(ESCAPE_EVENT, off);
      window.clearTimeout(t);
    };
  }, [pos]);

  return (
    <span
      ref={ref}
      tabIndex={0}
      role={role}
      aria-label={label}
      aria-describedby={pos ? id : undefined}
      className={cx("inline-flex", className)}
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse") open(false);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse" && !e.currentTarget.matches(":focus-visible")) setPos(null);
      }}
      onPointerUp={(e) => {
        if (e.pointerType === "mouse") return;
        if (pos) setPos(null);
        else open(true);
      }}
      onFocus={(e) => {
        // keyboard focus only: a tap focuses the trigger too, and its pointerup already toggles the tip
        if (e.currentTarget !== e.target || !e.currentTarget.matches(":focus-visible")) return;
        // a pill out of the row's view: scroll it in first, so the tip is measured where the trigger ends up
        e.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" });
        open(false);
      }}
      onBlur={(e) => {
        if (e.currentTarget === e.target) setPos(null);
      }}
      onKeyDown={(e) => {
        if (e.key !== "Enter" || e.currentTarget !== e.target) return;
        e.preventDefault();
        if (pos) setPos(null);
        else open(false);
      }}
    >
      {children}
      {pos &&
        createPortal(
          <span
            id={id}
            role="tooltip"
            className="hud-tip ui-zoom pointer-events-none fixed z-[300] rounded-md border border-brass-dark bg-soot-2/95 px-2.5 py-1.5 text-left text-xs font-normal normal-case leading-snug tracking-normal text-parchment shadow-[0_6px_18px_rgba(0,0,0,.6)]"
            style={{
              left: pos.x / pos.z,
              top: pos.y / pos.z,
              width: "max-content",
              maxWidth: pos.maxW / pos.z,
              transform: pos.below ? "translateX(-50%)" : "translate(-50%, -100%)",
            }}
          >
            {tip}
          </span>,
          document.body,
        )}
    </span>
  );
}
