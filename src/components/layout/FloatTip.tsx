"use client";

/**
 * Tooltip rendered into a fixed-position portal so scroll/overflow containers (the resource bar,
 * the header) never clip it. Mouse: hover. Touch/pen: tap toggles, auto-hides after 4 s.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cx } from "@/components/ui/kit";

interface Pos {
  x: number;
  y: number;
  below: boolean;
  touch: boolean;
  maxW: number;
}

export default function FloatTip({
  tip,
  children,
  className,
  prefer = "below",
  width = 240,
}: {
  tip: ReactNode;
  children: ReactNode;
  className?: string;
  /** Which side to try first. */
  prefer?: "below" | "above";
  width?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<Pos | null>(null);

  const open = (touch: boolean) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const roomBelow = window.innerHeight - r.bottom;
    const below = prefer === "below" ? roomBelow > 140 || r.top < 140 : r.top < 140;
    const maxW = Math.min(width, window.innerWidth - 16);
    const x = Math.min(Math.max(r.left + r.width / 2, maxW / 2 + 8), window.innerWidth - maxW / 2 - 8);
    setPos({ x, y: below ? r.bottom + 6 : r.top - 6, below, touch, maxW });
  };

  useEffect(() => {
    if (!pos) return;
    const off = () => setPos(null);
    window.addEventListener("scroll", off, true);
    window.addEventListener("resize", off);
    const t = pos.touch ? window.setTimeout(off, 4000) : 0;
    return () => {
      window.removeEventListener("scroll", off, true);
      window.removeEventListener("resize", off);
      window.clearTimeout(t);
    };
  }, [pos]);

  return (
    <span
      ref={ref}
      className={cx("inline-flex", className)}
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse") open(false);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse") setPos(null);
      }}
      onPointerUp={(e) => {
        if (e.pointerType === "mouse") return;
        if (pos) setPos(null);
        else open(true);
      }}
    >
      {children}
      {pos &&
        createPortal(
          <span
            role="tooltip"
            className="hud-tip pointer-events-none fixed z-[300] rounded-md border border-brass-dark bg-soot-2/95 px-2.5 py-1.5 text-left text-xs font-normal normal-case leading-snug tracking-normal text-parchment shadow-[0_6px_18px_rgba(0,0,0,.6)]"
            style={{
              left: pos.x,
              top: pos.y,
              width: "max-content",
              maxWidth: pos.maxW,
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
