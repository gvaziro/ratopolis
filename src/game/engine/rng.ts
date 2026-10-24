/** Seeded mulberry32 RNG whose state lives in GameState.rng, so runs are reproducible. */
export function rand(s: { rng: number }): number {
  let t = (s.rng = (s.rng + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randRange(s: { rng: number }, min: number, max: number): number {
  return min + (max - min) * rand(s);
}

export function randInt(s: { rng: number }, min: number, maxInclusive: number): number {
  return min + Math.floor(rand(s) * (maxInclusive - min + 1));
}

export function chance(s: { rng: number }, p: number): boolean {
  return rand(s) < p;
}

/** Pick a key from a weight map. */
export function pickWeighted<K extends string>(s: { rng: number }, weights: Partial<Record<K, number>>): K {
  const entries = Object.entries(weights) as [K, number][];
  const total = entries.reduce((a, [, w]) => a + (w || 0), 0);
  let r = rand(s) * total;
  for (const [k, w] of entries) {
    r -= w || 0;
    if (r <= 0) return k;
  }
  return entries[entries.length - 1][0];
}

export function pick<T>(s: { rng: number }, arr: readonly T[]): T {
  return arr[Math.floor(rand(s) * arr.length)];
}
