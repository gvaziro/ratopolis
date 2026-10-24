"use client";

/**
 * The brass-and-glass pneumatic tube across the top of the capsule scene (12%–30% of the height,
 * matching trainGeom). Shakes with `amp` px while capsules are on their way; a pressure gauge twitches.
 */
import type { CSSProperties } from "react";

export default function CapsuleTube({ amp = 0, pressure = 0.2 }: { amp?: number; pressure?: number }) {
  const style = { "--amp": `${amp.toFixed(2)}px`, animation: amp > 0.05 ? "rr-jitter .09s linear infinite" : undefined } as CSSProperties;
  const needle = -120 + 240 * Math.max(0, Math.min(1, pressure));
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[12%] h-[18%]" style={style} aria-hidden>
      <div className="absolute inset-0 border-y-[3px] border-brass-dark bg-[linear-gradient(180deg,rgba(210,235,240,.24),rgba(20,30,32,.55)_26%,rgba(8,12,13,.75)_70%,rgba(210,235,240,.16))] shadow-[0_10px_24px_rgba(0,0,0,.6)]" />
      <div className="absolute inset-x-0 top-[12%] h-[7%] bg-[linear-gradient(90deg,transparent,rgba(235,250,252,.35)_20%,rgba(235,250,252,.1)_50%,rgba(235,250,252,.3)_80%,transparent)]" />
      {[11, 33, 55, 77, 99].map((x) => (
        <div
          key={x}
          className="absolute -bottom-[6%] -top-[6%] w-2.5 -translate-x-1/2 rounded-sm bg-[linear-gradient(90deg,#7d5f2c,#f0d590_40%,#6b5024)] shadow-[0_2px_6px_rgba(0,0,0,.6)]"
          style={{ left: `${x}%` }}
        />
      ))}
      {/* pressure gauge on the left end */}
      <div className="absolute -bottom-9 left-[3%] h-9 w-9 rounded-full border-2 border-brass bg-[radial-gradient(circle,#eadcc0,#a8977a)] shadow-[0_2px_6px_rgba(0,0,0,.7)]">
        <div className="absolute left-1/2 top-1/2 h-[42%] w-0.5 origin-bottom bg-danger transition-transform duration-150" style={{ transform: `translateX(-50%) translateY(-100%) rotate(${needle}deg)` }} />
        <div className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-soot" />
      </div>
    </div>
  );
}
