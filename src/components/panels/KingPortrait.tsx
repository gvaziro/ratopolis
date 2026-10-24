"use client";

/** Official portrait of the Rat King: one more tail per migration, gilded frame for "Ещё до обеда". */
import { memo, useId } from "react";

/** drawNew: the newest tail draws itself in (the Great Migration overlay, SH-5). */
function KingPortrait({ tails, gilded, crowned, drawNew = false }: { tails: number; gilded: boolean; crowned: boolean; drawNew?: boolean }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const ids = { bg: `${uid}bg`, gold: `${uid}au`, clip: `${uid}cl`, robe: `${uid}rb` };
  const n = Math.max(1, Math.min(tails, 12));

  const tailPaths = Array.from({ length: n }, (_, i) => {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const ex = 16 + t * 108;
    const ey = 176 + Math.sin(t * Math.PI) * 9;
    const side = t < 0.5 ? -1 : 1;
    const c1x = 70 + (ex - 70) * 0.25;
    const c2x = ex - side * 16;
    // a little curl at the tip
    const tipX = ex + side * 7;
    return `M70 150 C${c1x} 170 ${c2x} ${ey - 24} ${ex} ${ey} Q${tipX} ${ey + 6} ${ex + side * 4} ${ey - 4}`;
  });

  const frame = gilded ? `url(#${ids.gold})` : "#7d5f2c";

  return (
    <svg viewBox="0 0 140 192" className="block h-auto w-full" role="img" aria-label={`Портрет Крысиного Короля, хвостов: ${tails}`}>
      <defs>
        <radialGradient id={ids.bg} cx="50%" cy="38%" r="70%">
          <stop offset="0" stopColor="#5a1c17" />
          <stop offset="1" stopColor="#14110f" />
        </radialGradient>
        <linearGradient id={ids.gold} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fbe6a0" />
          <stop offset=".5" stopColor="#d4af37" />
          <stop offset="1" stopColor="#8a6a1c" />
        </linearGradient>
        <linearGradient id={ids.robe} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#b02a24" />
          <stop offset="1" stopColor="#5a1410" />
        </linearGradient>
        <clipPath id={ids.clip}>
          <ellipse cx={70} cy={80} rx={57} ry={69} />
        </clipPath>
      </defs>

      {drawNew && <style>{"@keyframes kp-draw{to{stroke-dashoffset:0}}"}</style>}
      {/* tails spill out under the frame */}
      {tailPaths.map((d, i) => (
        <path
          key={i}
          d={d}
          fill="none"
          stroke="#d9a0a0"
          strokeWidth={2.8}
          strokeLinecap="round"
          opacity={0.95}
          {...(drawNew && i === tailPaths.length - 1 ? { pathLength: 1, strokeDasharray: 1, style: { strokeDashoffset: 1, animation: "kp-draw 1.4s ease-out .3s forwards" } } : {})}
        />
      ))}

      <g clipPath={`url(#${ids.clip})`}>
        <rect x={0} y={0} width={140} height={160} fill={`url(#${ids.bg})`} />
        {/* robe & ermine */}
        <path d="M14 162 Q28 112 70 110 Q112 112 126 162 Z" fill={`url(#${ids.robe})`} />
        <path d="M32 126 Q70 144 108 126 L104 116 Q70 130 36 116 Z" fill="#f4efe4" />
        {[44, 56, 70, 84, 96].map((x, i) => (
          <rect key={x} x={x} y={121 + (i % 2) * 3 + (i === 2 ? 4 : 0)} width={2} height={4} rx={0.8} fill="#14110f" />
        ))}
        <circle cx={70} cy={144} r={5} fill={`url(#${ids.gold})`} stroke="#7d5f2c" strokeWidth={0.6} />
        {/* ears */}
        <circle cx={45} cy={63} r={12} fill="#8f8a84" />
        <circle cx={45} cy={63} r={7.5} fill="#d9a0a0" />
        <circle cx={95} cy={63} r={12} fill="#8f8a84" />
        <circle cx={95} cy={63} r={7.5} fill="#d9a0a0" />
        {/* head */}
        <ellipse cx={70} cy={85} rx={25} ry={24} fill="#8f8a84" />
        <path d="M46 92 L40 98 L48 97 Z M94 92 L100 98 L92 97 Z" fill="#7a756f" />
        <ellipse cx={70} cy={97} rx={12} ry={10} fill="#b5aea6" />
        <ellipse cx={70} cy={104} rx={3.4} ry={2.6} fill="#d76f7f" />
        <rect x={67.6} y={107} width={2.2} height={3.2} rx={0.5} fill="#f4efe4" />
        <rect x={70.2} y={107} width={2.2} height={3.2} rx={0.5} fill="#f4efe4" />
        <circle cx={60} cy={83} r={3.2} fill="#14110f" />
        <circle cx={61} cy={82} r={1} fill="#fff" />
        <circle cx={80} cy={83} r={3.2} fill="#14110f" />
        <circle cx={81} cy={82} r={1} fill="#fff" />
        {/* monocle */}
        <circle cx={80} cy={83} r={6.5} fill="#ffffff" fillOpacity={0.12} stroke={`url(#${ids.gold})`} strokeWidth={1.6} />
        <path d="M86 86 Q97 104 92 120" fill="none" stroke="#d4af37" strokeWidth={0.8} />
        {/* whiskers */}
        <g stroke="#e9dcc0" strokeWidth={0.8} opacity={0.75} strokeLinecap="round">
          <line x1={62} y1={99} x2={36} y2={93} />
          <line x1={62} y1={101} x2={34} y2={103} />
          <line x1={78} y1={99} x2={104} y2={93} />
          <line x1={78} y1={101} x2={106} y2={103} />
        </g>
        {/* crown */}
        <path d="M50 62 L52 41 L60 52 L70 35 L80 52 L88 41 L90 62 Z" fill={`url(#${ids.gold})`} stroke="#7d5f2c" strokeWidth={0.8} />
        <rect x={49} y={57} width={42} height={6} rx={1.5} fill="#b8902a" stroke="#7d5f2c" strokeWidth={0.6} />
        <circle cx={59} cy={60} r={1.8} fill="#c4453a" />
        <circle cx={70} cy={60} r={2} fill="#4f7fc4" />
        <circle cx={81} cy={60} r={1.8} fill="#4f9d8a" />
        {[
          [52, 41],
          [70, 35],
          [88, 41],
        ].map(([x, y]) => (
          <circle key={x} cx={x} cy={y} r={2.1} fill="#fbe6a0" />
        ))}
      </g>

      {/* frame */}
      <ellipse cx={70} cy={80} rx={60} ry={72} fill="none" stroke={frame} strokeWidth={gilded ? 8 : 6} />
      <ellipse cx={70} cy={80} rx={56} ry={68} fill="none" stroke="#14110f" strokeWidth={1.2} opacity={0.6} />
      {gilded &&
        Array.from({ length: 14 }, (_, i) => {
          const a = (i / 14) * Math.PI * 2;
          return <circle key={i} cx={70 + Math.cos(a) * 60} cy={80 + Math.sin(a) * 72} r={2.4} fill="#fbe6a0" stroke="#8a6a1c" strokeWidth={0.5} />;
        })}
      {crowned && (
        <path d="M60 10 L62 2 L66 7 L70 0 L74 7 L78 2 L80 10 Z" fill={`url(#${ids.gold})`} stroke="#7d5f2c" strokeWidth={0.6} />
      )}
    </svg>
  );
}

export default memo(KingPortrait);
