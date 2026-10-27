"use client";

/** Small cute SVG rats (facing right, feet at y = 0) with tiny Victorian accessories by job. */
import { memo, type ReactNode } from "react";
import type { JobId, UpgradeId, ZoneId } from "@/game/types";

const INK = "#1a120c";
export const FURS = ["#8a7f78", "#6f6560", "#9b8c80", "#5f5752", "#a39a92"];

const ACCESSORY: Partial<Record<JobId, ReactNode>> = {
  pickpocket: (
    <g>
      <rect x="5.5" y="-29" width="10" height="9" rx="1" fill="#1d1a1f" />
      <rect x="5.5" y="-22.5" width="10" height="2" fill="#7a2a24" />
      <rect x="3" y="-21" width="15" height="2" rx="1" fill="#1d1a1f" />
    </g>
  ),
  forager: (
    <g>
      <path d="M-13 -24h13l-2 9h-9z" fill="#c08a4a" stroke={INK} strokeWidth=".6" />
      <path d="M-12 -20.5h11" stroke="#8a5a2a" strokeWidth=".8" />
      <circle cx="-8" cy="-25.5" r="2.2" fill="#e6c27a" />
      <circle cx="-4" cy="-25" r="1.8" fill="#d9a95a" />
    </g>
  ),
  scavenger: (
    <g>
      <line x1="2" y1="-11" x2="-12" y2="-29" stroke="#a8743f" strokeWidth="1.4" />
      <circle cx="-13" cy="-30" r="5" fill="#c4453a" stroke={INK} strokeWidth=".6" />
      <circle cx="-15" cy="-31" r=".9" fill="#fff" />
      <circle cx="-11" cy="-29" r=".9" fill="#fff" />
    </g>
  ),
  mechanic: (
    <g>
      <path d="M4 -17.5h14" stroke="#3a2a1a" strokeWidth="1.2" />
      <circle cx="11" cy="-18" r="2.4" fill="#9cc7cf" stroke="#c9a25a" strokeWidth="1.1" />
      <circle cx="16" cy="-17" r="2.2" fill="#9cc7cf" stroke="#c9a25a" strokeWidth="1.1" />
    </g>
  ),
  cheese_thief: <path d="M19 -9l9 -6v5z" fill="#ffd34d" stroke={INK} strokeWidth=".6" />,
  scholar: (
    <g>
      <circle cx="14" cy="-12.5" r="2.4" fill="none" stroke="#2a1a0c" strokeWidth=".8" />
      <path d="M6 -24l8 -3 8 3 -8 3z" fill="#1d1a1f" />
      <rect x="-8" y="-13" width="9" height="6" fill="#7a2a24" stroke={INK} strokeWidth=".5" />
    </g>
  ),
  coal_miner: (
    <g>
      <path d="M5 -18a6.5 6.5 0 0 1 13 0z" fill="#d9a92c" stroke={INK} strokeWidth=".6" />
      <circle cx="17" cy="-20" r="1.8" fill="#fff6dc" />
      <circle cx="17" cy="-20" r="5" fill="#fff6dc" opacity=".25" />
      <path d="M-12 -18l4 -4 5 2 -1 4z" fill="#26232a" />
    </g>
  ),
  stoker: (
    <g>
      <path d="M4 -10l6 -1 -2 6z" fill="#c4453a" />
      <line x1="-10" y1="-4" x2="-2" y2="-24" stroke="#a8743f" strokeWidth="1.3" />
      <path d="M-4 -24l4 -4 3 4z" fill="#8d949a" />
    </g>
  ),
  smelter: (
    <g>
      <path d="M-6 -15q6 -2 10 0v10h-10z" fill="#6e4523" opacity=".9" />
      <circle cx="21" cy="-6" r="2.5" fill="#ffb03a" />
    </g>
  ),
  smith: (
    <g>
      <line x1="8" y1="-9" x2="14" y2="-26" stroke="#a8743f" strokeWidth="1.5" />
      <rect x="10" y="-30" width="9" height="5" rx="1" fill="#5d554d" transform="rotate(20 14 -27)" />
    </g>
  ),
  appraiser: (
    <g>
      <circle cx="14" cy="-12.5" r="2.6" fill="rgba(255,255,255,.2)" stroke="#d4af37" strokeWidth=".9" />
      <path d="M14 -10q-2 6 -8 6" stroke="#d4af37" strokeWidth=".5" fill="none" />
    </g>
  ),
};

/** Foreman (upgrade «Прораб»): hard hat and a rolled-up blueprint. */
const FOREMAN = (
  <g>
    <path d="M4 -18a7 7 0 0 1 14 0z" fill="#f2b84b" stroke={INK} strokeWidth=".6" />
    <rect x="2.5" y="-18.5" width="17" height="2" rx="1" fill="#d9952a" />
    <rect x="-14" y="-22" width="16" height="5" rx="2.5" fill="#8fb8ff" stroke="#2a4a6a" strokeWidth=".6" transform="rotate(-20 -6 -19)" />
  </g>
);

/**
 * CO-6: upgrades change the look — every rat (no job) or the rats of one job. Drawn under the job accessory.
 */
export const UPGRADE_LOOKS: Partial<Record<UpgradeId, { job?: JobId; accessory: ReactNode }>> = {
  sharp_teeth: { accessory: <path d="M20.3 -9.6v2.2M21.4 -9.8v2" stroke="#fff" strokeWidth="1" /> },
  long_whiskers: { accessory: <path d="M20 -11l11 -4M20 -10.4l11 0M20 -9.8l10 3.5" stroke="#efe8e0" strokeWidth=".5" /> },
  forager_sacks: {
    job: "forager",
    accessory: (
      <g>
        <path d="M-15 -14q-3 -10 4 -12l6 1q2 7 -3 11z" fill="#c4453a" stroke={INK} strokeWidth=".6" />
        <path d="M-14.5 -21h8M-14 -18h8" stroke="#f4efe4" strokeWidth="1.2" />
      </g>
    ),
  },
  nimble_tails: { job: "pickpocket", accessory: <path d="M-31 -8.5l-3 -2.5m3 2.5l-4 1" stroke="#7a2a24" strokeWidth="1.6" strokeLinecap="round" /> },
  candle_stubs: {
    job: "scavenger",
    accessory: (
      <g>
        <rect x="-3" y="-25" width="3" height="6" fill="#f4efe4" stroke={INK} strokeWidth=".4" />
        <path d="M-1.5 -25q-1.5 -2 0 -4q1.5 2 0 4z" fill="#ffb03a" />
      </g>
    ),
  },
  gear_trains: {
    job: "mechanic",
    accessory: <circle cx="-6" cy="-17" r="3.6" fill="none" stroke="#c9a25a" strokeWidth="2" strokeDasharray="1.4 1.1" />,
  },
};

/** CO-6: the zone accessory of a resident rat (sewers: a tiny lantern; metro: a stoker's cap; terminal: a porter's cap). */
export const ZONE_LOOK: Partial<Record<ZoneId, ReactNode>> = {
  sewers: (
    <g>
      <line x1="16" y1="-6" x2="16" y2="-1" stroke="#3a2a1a" strokeWidth=".8" />
      <rect x="14" y="-1" width="4" height="5" rx="1" fill="#ffd98a" stroke={INK} strokeWidth=".5" />
    </g>
  ),
  metro: <path d="M4 -19q7 -6 14 0v2h-14z" fill="#26232a" stroke={INK} strokeWidth=".5" />,
  terminal: (
    <g>
      <rect x="4" y="-23" width="13" height="5" rx="1" fill="#7a2a24" stroke={INK} strokeWidth=".5" />
      <rect x="3" y="-19" width="16" height="1.6" fill="#d4af37" />
    </g>
  ),
};

/** Rat body + job accessory (+ upgrade looks, CO-6). */
export const RatBody = memo(function RatBody({
  job,
  fur,
  foreman = false,
  looks,
  zoneLook,
}: {
  job: JobId;
  fur: string;
  foreman?: boolean;
  /** Owned upgrades that change the look (UPGRADE_LOOKS keys). */
  looks?: readonly UpgradeId[];
  /** A resident's zone accessory instead of the job one. */
  zoneLook?: ZoneId;
}) {
  // COL-3: the tail and the feet carry the walk cycle (colonyCss .cv-rat / .cv-walk); data-decor: reduced motion pauses it
  return (
    <g>
      <path className="cv-tail" data-decor="" d="M-12 -6Q-24 -1 -31 -8Q-35 -13 -29 -16" stroke="#c98b8b" strokeWidth="1.8" fill="none" strokeLinecap="round" />
      <ellipse cx="-2" cy="-9" rx="13" ry="8" fill={fur} stroke={INK} strokeWidth=".8" />
      <ellipse cx="-3" cy="-5.5" rx="8" ry="3" fill="#fff" opacity=".14" />
      <path d="M5 -15Q14 -19 21.5 -11Q16 -6 6 -5.5z" fill={fur} stroke={INK} strokeWidth=".8" />
      <circle cx="8" cy="-16.5" r="4.3" fill={fur} stroke={INK} strokeWidth=".7" />
      <circle cx="8.2" cy="-16.3" r="2.5" fill="#e9a0a6" />
      <circle cx="14" cy="-12.5" r="1.35" fill="#111" />
      <circle cx="14.5" cy="-13" r=".45" fill="#fff" />
      <circle cx="21.5" cy="-11" r="1.4" fill="#e98a96" />
      <path d="M19 -10.5l6 -1.5M19 -9.8l6 1" stroke="#e8e0d8" strokeWidth=".4" />
      <rect className="cv-foot-a" data-decor="" x="-9" y="-2" width="3.4" height="2" rx="1" fill={INK} />
      <rect className="cv-foot-b" data-decor="" x="4" y="-2" width="3.4" height="2" rx="1" fill={INK} />
      {looks?.map((u) => {
        const l = UPGRADE_LOOKS[u];
        return l && (!l.job || l.job === job) ? <g key={u}>{l.accessory}</g> : null;
      })}
      {foreman ? FOREMAN : zoneLook ? ZONE_LOOK[zoneLook] : ACCESSORY[job]}
    </g>
  );
});
