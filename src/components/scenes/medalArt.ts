/**
 * The rating medals (v3 SCN-3) in one place: metal colours shared by the haul card's struck medal (HaulMedal) and the
 * live gauge's notches on the catch canvas (small Path2D discs instead of emoji).
 */

export type MedalTier = "bronze" | "silver" | "gold" | "royal";

export const MEDAL_TIERS: readonly MedalTier[] = ["bronze", "silver", "gold", "royal"];

export function isMedalTier(id: string): id is MedalTier {
  return (MEDAL_TIERS as readonly string[]).includes(id);
}

/** Metal: highlight, base (bronze #b0703a, silver #c9cfd3, gold #d4af37), shadow and the rim's ink. */
export const MEDAL_METAL: Record<MedalTier, { hi: string; base: string; lo: string; rim: string }> = {
  bronze: { hi: "#e6b182", base: "#b0703a", lo: "#6b3c16", rim: "#4e2a0e" },
  silver: { hi: "#fbfdfe", base: "#c9cfd3", lo: "#7f888e", rim: "#4f575c" },
  gold: { hi: "#fff1a6", base: "#d4af37", lo: "#8c6a0e", rim: "#5e4506" },
  royal: { hi: "#fff1a6", base: "#d4af37", lo: "#8c6a0e", rim: "#5e4506" },
};

/** Ribbon stripes (edge, middle): royal is red velvet. */
export const MEDAL_RIBBON: Record<MedalTier, { edge: string; mid: string; ink: string }> = {
  bronze: { edge: "#5a3a1e", mid: "#3d6b4a", ink: "#f1e6cf" },
  silver: { edge: "#24324a", mid: "#e9e4d6", ink: "#1d2230" },
  gold: { edge: "#7a1f1a", mid: "#e2c25a", ink: "#3a1606" },
  royal: { edge: "#4a0b10", mid: "#9e1b24", ink: "#ffe9a8" },
};

/* ------------------------------------------------------------ canvas notches */

let disc: Path2D | null = null;
let crown: Path2D | null = null;

/** Unit paths (lazy: Path2D does not exist outside a browser). */
function paths(): { disc: Path2D; crown: Path2D } | null {
  if (typeof Path2D === "undefined") return null;
  disc ??= new Path2D("M1 0A1 1 0 1 1 -1 0A1 1 0 1 1 1 0Z");
  // a three-point crown sitting on y = 0, 2 wide (unit = the disc radius)
  crown ??= new Path2D("M-1 0L-1.05 -1.1L-0.5 -0.5L0 -1.35L0.5 -0.5L1.05 -1.1L1 0Z");
  return { disc, crown };
}

/**
 * A small medal disc at (x, y), radius r: the metal with a highlight and a rim; royal gets a crown on top.
 * `alpha` dims a tier not reached yet (or out of reach).
 */
export function drawMedalDisc(g: CanvasRenderingContext2D, x: number, y: number, r: number, tier: MedalTier, alpha = 1): void {
  const p = paths();
  if (!p || !(r > 0)) return;
  const m = MEDAL_METAL[tier];
  g.save();
  g.globalAlpha *= alpha;
  g.translate(x, y);
  if (tier === "royal") {
    g.save();
    g.translate(0, -r * 0.82);
    g.scale(r * 0.62, r * 0.62);
    g.fillStyle = m.base;
    g.fill(p.crown);
    g.lineWidth = 1 / (r * 0.62);
    g.strokeStyle = m.rim;
    g.stroke(p.crown);
    g.restore();
  }
  g.scale(r, r);
  g.fillStyle = m.base;
  g.fill(p.disc);
  // highlight: a lighter crescent to the upper left
  g.save();
  g.clip(p.disc);
  const a0 = g.globalAlpha;
  g.fillStyle = m.hi;
  g.globalAlpha = a0 * 0.75;
  g.beginPath();
  g.arc(-0.35, -0.4, 0.62, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = m.lo;
  g.globalAlpha = a0 * 0.55;
  g.beginPath();
  g.arc(0.45, 0.55, 0.7, 0, Math.PI * 2);
  g.fill();
  g.restore();
  g.lineWidth = 1.3 / r;
  g.strokeStyle = m.rim;
  g.stroke(p.disc);
  g.restore();
}
