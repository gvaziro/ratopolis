/** Deterministic Math.random for the audio bench: the noise buffers, jitter and pitch scatter render the same every run. */

/** mulberry32: a tiny seeded PRNG in [0, 1). */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Replace Math.random with a seeded generator; returns the function that puts the original back. */
export function seedRandom(seed: number): () => void {
  const orig = Math.random;
  Math.random = prng(seed);
  return () => {
    Math.random = orig;
  };
}
