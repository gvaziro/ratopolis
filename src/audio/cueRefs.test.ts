/**
 * No dead cues (AUD-2): every SfxCue member is used somewhere outside its own voice map (src/audio/cues.ts) — by a
 * scene, the shell or the AudioDirector — so a cue nobody plays shows up here instead of rotting unheard.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { CUE_NAMES } from "./cues";

const SRC = join(__dirname, "..");

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (/\.(tsx?|mts)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe("SfxCue references", () => {
  it("the cue list matches the SfxCue union in fx.ts", () => {
    const fx = readFileSync(join(SRC, "game", "fx.ts"), "utf8");
    const union = /export type SfxCue =([^;]+);/.exec(fx)?.[1] ?? "";
    const members = [...union.matchAll(/"([A-Za-z]+)"/g)].map((m) => m[1]).sort();
    expect(members.length).toBeGreaterThan(0);
    expect([...CUE_NAMES].sort()).toEqual(members);
  });

  it("every SfxCue member is played somewhere outside src/audio/cues.ts", () => {
    const skip = new Set([join(SRC, "audio", "cues.ts"), join(SRC, "game", "fx.ts")]);
    const text = sources(SRC)
      .filter((p) => !skip.has(p) && !p.includes(join("audio", "testing")))
      .map((p) => readFileSync(p, "utf8"))
      .join("\n");
    // sfxCue("x"…) from scenes and the shell, sfx.cue("x"…) from the AudioDirector
    const unused = CUE_NAMES.filter((c) => !new RegExp(`\\b(?:sfxCue|cue)\\(\\s*"${c}"`).test(text));
    expect(unused, `unused cues (searched ${relative(process.cwd(), SRC)})`).toEqual([]);
  });
});
