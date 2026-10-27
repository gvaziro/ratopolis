"use client";

/**
 * SC-5: below md, a 168×60 «Наверху» inset: a tiny side-view human train crossing right→left over the whole pass
 * (static with reduced motion); `cab` draws a hansom cab instead (CarriageScene). `className` places it: TrainPass
 * stacks it in its tag column under the car tag ("relative"), the carriage parks it on the floor, clear of the grate.
 * v3 SCN-1: the ride is paused while the game is held (it is timed to the pass).
 */
import { cx } from "@/components/ui/kit";

export function UpstairsInset({
  n,
  perCar,
  clock,
  reduced,
  cab,
  className = "absolute left-2 top-11",
}: {
  n: number;
  perCar: number;
  clock: string;
  reduced: boolean;
  cab: boolean;
  className?: string;
}) {
  const dur = Math.max(1, n * perCar);
  return (
    <div
      className={cx("pointer-events-none z-10 w-[168px] overflow-hidden rounded border border-brass-dark/70 bg-gradient-to-b from-[#9fb7c9] to-[#d9c9a3] shadow md:hidden", className)}
      style={{ height: 60 }}
    >
      <svg viewBox="0 0 168 60" className="absolute inset-0 h-full w-full" aria-hidden>
        <rect x="0" y="44" width="168" height="16" fill="#4a4038" />
        <rect x="0" y="43" width="168" height="2" fill="#2a2420" />
        <rect x="12" y="20" width="18" height="24" fill="#6b5a45" />
        <rect x="128" y="14" width="26" height="30" fill="#5a4a3a" />
        {/* SCN-1: the ride pauses with the scene (SceneFrame: [data-scene-dialog][data-held] [data-hold-pause]) */}
        <g data-hold-pause="" style={reduced ? { transform: "translateX(-40px)" } : { animation: `rr-inset-ride ${dur}s linear forwards` }}>
          {cab ? (
            <g>
              <rect x="150" y="24" width="20" height="14" rx="3" fill="#2a2420" />
              <circle cx="156" cy="40" r="5" fill="none" stroke="#2a2420" strokeWidth="2" />
              <circle cx="186" cy="40" r="4" fill="none" stroke="#2a2420" strokeWidth="2" />
              <path d="M172 30 h14 l4 -6" stroke="#5a3a20" strokeWidth="3" fill="none" />
            </g>
          ) : (
            <g>
              <rect x="150" y="28" width="22" height="12" rx="2" fill="#3a3028" />
              <rect x="146" y="24" width="6" height="8" fill="#3a3028" />
              {Array.from({ length: Math.min(6, Math.max(1, n - 1)) }, (_, i) => (
                <rect key={i} x={174 + i * 20} y="27" width="18" height="13" rx="2" fill={i % 2 ? "#55704c" : "#8a4422"} />
              ))}
              <circle cx="146" cy="22" r="3" fill="#cfd6d6" opacity=".8" />
            </g>
          )}
        </g>
      </svg>
      <span className="absolute bottom-0.5 left-1 font-display text-[10px] font-bold text-[#f3e6c4] [text-shadow:0_1px_0_#000]">
        Наверху: {cab ? "экипаж" : "поезд"} {clock}
      </span>
      <style>{"@keyframes rr-inset-ride{from{transform:translateX(30px)}to{transform:translateX(-300px)}}"}</style>
    </div>
  );
}
