"use client";

/**
 * The struck medal of the haul card (v3 SCN-3): a bronze / silver / gold disc (r 34) with an embossed rat's head in
 * profile and «1887», hanging from a ribbon that carries the bonus («+20%»); the royal one is gold with a crown, a red
 * velvet ribbon and six rays. Stamped in with rh-stamp (HazardKit) 350 ms after the card, then one shine sweeps it.
 * Below 40% an empty dashed outline: «нужно 40%». Reduced motion: no stamp, no shine.
 */
import { memo, useId } from "react";
import { fmtPct } from "@/lib/format";
import { MEDAL_METAL, MEDAL_RIBBON, type MedalTier } from "./medalArt";

/** When the medal lands on the card (ms after the card shows) and how long the stamp takes. */
export const MEDAL_DELAY_MS = 350;
const STAMP_MS = 400;

const SHINE_CSS = "@keyframes rr-medal-shine{from{transform:translateX(-70px) rotate(18deg)}to{transform:translateX(120px) rotate(18deg)}}";

/** The rat's head in profile (facing right), around (0, 0); the ear is drawn over it. */
const HEAD =
  "M-14 9C-16.5 0-12.5-9.5-4-11.5C2-12.8 8-9.6 12.6-4.6L19.4-1.2C20.2-.6 19.8.8 18.8 1.2C15.6 2.6 12.4 3.4 9.6 3.8C7 6.6 2.6 8.6-2 9.4Z";
const EAR = "M-7.5-9.6C-11.5-19.5-1.8-21.6-.2-12.4C-2.4-11.2-5.2-10.4-7.5-9.6Z";
const WHISKERS = "M14.6 0.2L24 -2.6M14.8 1.2L24.4 1.6M14.2 2.2L22.6 5.2";

function Head({ fill, dx = 0, dy = 0, opacity = 1 }: { fill: string; dx?: number; dy?: number; opacity?: number }) {
  return (
    <g transform={`translate(${40 + dx} ${73 + dy})`} opacity={opacity}>
      <path d={HEAD} fill={fill} />
      <path d={EAR} fill={fill} />
    </g>
  );
}

function HaulMedalImpl({ tier, bonus, reduced }: { tier: MedalTier | null; bonus: number; reduced: boolean }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const enter = reduced ? undefined : `rh-stamp ${STAMP_MS / 1000}s ease-out ${MEDAL_DELAY_MS / 1000}s both`;

  if (!tier) {
    return (
      <div className="pointer-events-none" style={reduced ? undefined : { animation: `rr-fadein .4s ease-out ${MEDAL_DELAY_MS / 1000}s both` }} role="img" aria-label="Медали нет: нужно поймать 40%">
        <svg viewBox="0 8 80 104" className="block h-auto w-full overflow-visible">
          <circle cx="40" cy="74" r="31" fill="rgba(90,74,53,.06)" stroke="#5a4a35" strokeWidth="1.6" strokeDasharray="5 4" opacity=".75" />
          <text x="40" y="70" textAnchor="middle" fontSize="10" fontStyle="italic" fill="#5a4a35" fontFamily="Georgia, serif">
            нужно
          </text>
          <text x="40" y="84" textAnchor="middle" fontSize="13" fontWeight="700" fill="#5a4a35" fontFamily="Georgia, serif">
            40%
          </text>
        </svg>
      </div>
    );
  }

  const m = MEDAL_METAL[tier];
  const rb = MEDAL_RIBBON[tier];
  const royal = tier === "royal";
  const id = { metal: `${uid}m`, face: `${uid}f`, clip: `${uid}c`, shine: `${uid}s`, ribbon: `${uid}r` };
  const label = royal ? "Королевская медаль" : tier === "gold" ? "Золотая медаль" : tier === "silver" ? "Серебряная медаль" : "Бронзовая медаль";
  return (
    <div className="pointer-events-none" style={{ animation: enter }} role="img" aria-label={`${label}${bonus > 0 ? `, добыча +${fmtPct(bonus)}` : ""}`}>
      {!reduced && <style>{SHINE_CSS}</style>}
      <svg viewBox="0 8 80 104" className="block h-auto w-full overflow-visible drop-shadow-[0_3px_3px_rgba(0,0,0,.45)]">
        <defs>
          <radialGradient id={id.metal} cx="35%" cy="30%" r="80%">
            <stop offset="0" stopColor={m.hi} />
            <stop offset=".45" stopColor={m.base} />
            <stop offset="1" stopColor={m.lo} />
          </radialGradient>
          <linearGradient id={id.face} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={m.base} />
            <stop offset="1" stopColor={m.lo} />
          </linearGradient>
          <linearGradient id={id.shine} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#fff" stopOpacity="0" />
            <stop offset=".5" stopColor="#fff" stopOpacity=".75" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={id.ribbon} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor={rb.edge} />
            <stop offset=".22" stopColor={rb.edge} />
            <stop offset=".22" stopColor={rb.mid} />
            <stop offset=".78" stopColor={rb.mid} />
            <stop offset=".78" stopColor={rb.edge} />
            <stop offset="1" stopColor={rb.edge} />
          </linearGradient>
          <clipPath id={id.clip}>
            <circle cx="40" cy="74" r="34" />
          </clipPath>
        </defs>

        {/* six rays behind the royal medal */}
        {royal && (
          <g opacity=".85">
            {[0, 1, 2, 3, 4, 5].map((k) => (
              <path key={k} d="M40 74L36 30L44 30Z" fill="#e8c34a" stroke="#9a7410" strokeWidth=".6" transform={`rotate(${30 + k * 60} 40 74)`} />
            ))}
          </g>
        )}

        {/* the ribbon with the bonus, pinned at the top */}
        <path d="M23 10H57V52L40 46L23 52Z" fill={`url(#${id.ribbon})`} stroke="rgba(0,0,0,.35)" strokeWidth=".8" />
        <path d="M23 16H57" stroke="rgba(0,0,0,.18)" strokeWidth="1" />
        <text x="40" y="32" textAnchor="middle" fontSize={bonus > 0 ? 11 : 10} fontWeight="800" fill={rb.ink} fontFamily="ui-monospace, monospace" stroke={rb.edge} strokeWidth=".35">
          {`+${fmtPct(bonus)}`}
        </text>
        <rect x="35" y="8" width="10" height="5" rx="1.5" fill="#c9a25a" stroke="#6e520a" strokeWidth=".6" />

        {/* the disc */}
        <circle cx="40" cy="74" r="34" fill={`url(#${id.metal})`} stroke={m.rim} strokeWidth="1.6" />
        <circle cx="40" cy="74" r="29" fill="none" stroke={m.lo} strokeWidth="1" opacity=".8" />
        <g fill={m.hi} opacity=".55">
          {Array.from({ length: 28 }, (_, k) => {
            const a = (k / 28) * Math.PI * 2;
            return <circle key={k} cx={(40 + Math.cos(a) * 31.6).toFixed(2)} cy={(74 + Math.sin(a) * 31.6).toFixed(2)} r=".75" />;
          })}
        </g>
        {/* the embossed head: shadow below-right, light above-left, then the relief */}
        <Head fill={m.lo} dx={0.9} dy={0.9} opacity={0.85} />
        <Head fill={m.hi} dx={-0.7} dy={-0.7} opacity={0.8} />
        <Head fill={`url(#${id.face})`} />
        <g transform="translate(40 73)">
          <circle cx="6.4" cy="-4.6" r="1.4" fill={m.rim} />
          <path d={WHISKERS} stroke={m.rim} strokeWidth=".6" strokeLinecap="round" opacity=".8" />
        </g>
        <text x="40.6" y="97.6" textAnchor="middle" fontSize="8.5" fontWeight="700" fill={m.hi} opacity=".8" fontFamily="Georgia, serif" letterSpacing="1">
          1887
        </text>
        <text x="40" y="97" textAnchor="middle" fontSize="8.5" fontWeight="700" fill={m.lo} fontFamily="Georgia, serif" letterSpacing="1">
          1887
        </text>

        {/* the royal crown on the rim */}
        {royal && (
          <g transform="translate(40 41)">
            <path d="M-13 4L-14.5-9L-7-2.5L0-12L7-2.5L14.5-9L13 4Z" fill="#e2c25a" stroke="#6e520a" strokeWidth=".8" />
            <path d="M-13 4H13V7H-13Z" fill="#9e1b24" stroke="#4a0b10" strokeWidth=".6" />
            <circle cx="0" cy="-12" r="1.8" fill="#9e1b24" />
            <circle cx="-14.5" cy="-9" r="1.4" fill="#fff6dc" />
            <circle cx="14.5" cy="-9" r="1.4" fill="#fff6dc" />
          </g>
        )}

        {/* one shine sweep after the stamp */}
        {!reduced && (
          <g clipPath={`url(#${id.clip})`}>
            <rect
              x="0"
              y="20"
              width="16"
              height="110"
              fill={`url(#${id.shine})`}
              style={{ animation: `rr-medal-shine .7s ease-in-out ${(MEDAL_DELAY_MS + STAMP_MS + 80) / 1000}s both`, transformBox: "view-box", transformOrigin: "0 0" }}
            />
          </g>
        )}
      </svg>
    </div>
  );
}

const HaulMedal = memo(HaulMedalImpl);
export default HaulMedal;
