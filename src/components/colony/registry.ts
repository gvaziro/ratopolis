import type { BuildingId } from "@/game/types";

/** Chambers register a "poke" (spring squash) so flying loot and rats can nudge them imperatively. */
const pokes = new Map<BuildingId, (strength: number) => void>();

export function registerPoke(id: BuildingId, fn: (strength: number) => void): () => void {
  pokes.set(id, fn);
  return () => {
    if (pokes.get(id) === fn) pokes.delete(id);
  };
}

export function pokeChamber(id: BuildingId, strength = 1): void {
  pokes.get(id)?.(strength);
}
