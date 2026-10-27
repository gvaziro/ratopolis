"use client";

/**
 * The rat crew on the rail head (v3 SCN-2), the React side of crew.ts: CrewSprites renders the four RatBody svgs
 * hidden and hands them to the rasterizer (the pass draws the sprites on its canvas); CrewLine is the same crew as
 * DOM over the rail head during the «Гул», stepping into the pose of the chosen crew position.
 */
import { memo, useEffect, useRef } from "react";
import { RatBody } from "@/components/colony/ratArt";
import { sfxCue3 } from "@/game/fx";
import type { CrewPosition } from "@/game/types";
import { CREW, CREW_POSE, CREW_X, RAT_BOX, SPRITE_K, rasterizeCrew } from "./crew";

const VIEW = `${RAT_BOX.x} ${RAT_BOX.y} ${RAT_BOX.w} ${RAT_BOX.h}`;

/** Four hidden RatBody svgs, rasterized into crew.ts's sprite cache on mount (once per page). */
export const CrewSprites = memo(function CrewSprites() {
  const refs = useRef<(SVGSVGElement | null)[]>([]);
  useEffect(() => {
    refs.current.forEach((el, i) => {
      if (el) rasterizeCrew(i, el);
    });
  }, []);
  return (
    <div className="pointer-events-none absolute h-0 w-0 overflow-hidden" style={{ visibility: "hidden" }} aria-hidden>
      {CREW.map((c, i) => (
        <svg
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          xmlns="http://www.w3.org/2000/svg"
          width={RAT_BOX.w * SPRITE_K}
          height={RAT_BOX.h * SPRITE_K}
          viewBox={VIEW}
        >
          <RatBody job={c.job} fur={c.fur} foreman={c.foreman} />
        </svg>
      ))}
    </div>
  );
});

/**
 * The crew and its tarp over the rail head in the rumble (DOM): by the wall a step back, between the ties a step
 * closer. A change of position shuffles them over (and they mutter about it); reduced motion: no transition.
 */
export const CrewLine = memo(function CrewLine({ position, reduced }: { position: CrewPosition; reduced: boolean }) {
  const pose = CREW_POSE[position] ?? CREW_POSE.rails;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    sfxCue3("ratChatter", { intensity: 0.6 });
  }, [position]);
  const move = reduced ? undefined : "transform .32s cubic-bezier(.3,1.5,.5,1)";
  // the rats' height (RatBody box 70 × 36): the tarp strip has the same height, its paws at 45% from the top
  const h = "clamp(34px, 6vmin, 60px)";
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-[30%]" style={{ height: h, transform: `translateY(${pose.dy}px)`, transition: move }} aria-hidden>
      <svg className="absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 1000 100" preserveAspectRatio="none">
        {[0, 1, 2].map((i) => {
          const x0 = CREW_X[i] * 1000 + 18;
          const x1 = CREW_X[i + 1] * 1000 - 18;
          const mx = (x0 + x1) / 2;
          return (
            <g key={i}>
              <path d={`M${x0} 42 Q${mx} 92 ${x1} 42 L${x1} 56 Q${mx} 112 ${x0} 56 Z`} fill="#d9c9a4" stroke="#8a7a5c" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
              <path d={`M${x0} 49 Q${mx} 101 ${x1} 49`} fill="none" stroke="#7a5a32" strokeWidth="1" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
            </g>
          );
        })}
      </svg>
      {CREW.map((c, i) => (
        <svg
          key={i}
          viewBox={VIEW}
          className="absolute bottom-0 overflow-visible"
          style={{
            left: `${CREW_X[i] * 100}%`,
            height: "100%",
            aspectRatio: `${RAT_BOX.w} / ${RAT_BOX.h}`,
            transformOrigin: "50% 100%",
            transform: `translateX(-50%) scale(${c.mirror ? -pose.scale : pose.scale}, ${pose.scale})`,
            transition: move,
          }}
        >
          <RatBody job={c.job} fur={c.fur} foreman={c.foreman} />
        </svg>
      ))}
    </div>
  );
});
