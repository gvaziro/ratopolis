import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * PAN-2 (mobile-8): no panel text under 10 px. A phone shows the panel at 1:1, so a Tailwind text-[9px] is a 9 px
 * caption nobody reads. Rubber stamps (<Stamp>, display caps) and aria-hidden decoration may stay smaller; anything
 * else needs an entry in ALLOW with a reason.
 */
const DIR = path.resolve(__dirname);

/** Arbitrary Tailwind font sizes: text-[9px], text-[8.5px], text-[.55rem], text-[0.5rem]. */
const SIZE = /text-\[(\d*\.?\d+)(px|rem)\]/g;

/** Allowed tiny text beyond stamps and aria-hidden decoration: the file, a snippet of the line, why. */
const ALLOW: { file: string; match: string; why: string }[] = [];

/** Lines that are a rubber stamp or decoration (not read, not information). */
function decorative(line: string): boolean {
  return /<Stamp\b/.test(line) || /\baria-hidden\b/.test(line);
}

interface TinyHit {
  file: string;
  line: number;
  size: string;
  text: string;
}

/** Every font size under 10 px in `src` that is neither decoration nor allow-listed. */
function tinyText(src: string, file: string, allow = ALLOW): TinyHit[] {
  const out: TinyHit[] = [];
  src.split(/\r?\n/).forEach((text, i) => {
    for (const m of text.matchAll(SIZE)) {
      const px = Number(m[1]) * (m[2] === "rem" ? 16 : 1);
      if (px >= 10) continue;
      if (decorative(text) || allow.some((a) => a.file === file && text.includes(a.match))) continue;
      out.push({ file, line: i + 1, size: m[0], text: text.trim() });
    }
  });
  return out;
}

function panelFiles(dir = DIR): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...panelFiles(p));
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

const rel = (p: string) => path.relative(DIR, p).split(path.sep).join("/");

describe("no tiny text in the panels (PAN-2)", () => {
  it("finds the panel sources", () => {
    const files = panelFiles().map(rel);
    expect(files).toContain("MedalsTab.tsx");
    expect(files).toContain("SidePanel.tsx");
    expect(files.length).toBeGreaterThan(10);
  });

  it("no panel file sets a font size under 10 px outside stamps and decoration", () => {
    const hits = panelFiles().flatMap((p) => tinyText(readFileSync(p, "utf8"), rel(p)));
    expect(hits.map((h) => `${h.file}:${h.line} ${h.size}  ${h.text.slice(0, 90)}`)).toEqual([]);
  });

  it("catches a text-[9px] added to a file that is not allow-listed", () => {
    expect(tinyText(`<p className="text-[9px] text-parchment">новинка</p>`, "Anything.tsx")).toHaveLength(1);
    expect(tinyText(`<span className="block text-[8.5px]">x</span>`, "Anything.tsx")).toHaveLength(1);
    expect(tinyText(`<span className="text-[.55rem]">x</span>`, "Anything.tsx")).toHaveLength(1);
    expect(tinyText(`<span className="text-[10px] md:text-[10.5px]">x</span>`, "Anything.tsx")).toHaveLength(0);
    expect(tinyText(`<Stamp className="px-0.5 text-[8px]">Полно</Stamp>`, "Anything.tsx")).toHaveLength(0);
    expect(tinyText(`<span aria-hidden className="text-[7px]">✦</span>`, "Anything.tsx")).toHaveLength(0);
    const allow = [{ file: "Board.tsx", match: "board-rivet", why: "test" }];
    expect(tinyText(`<i className="board-rivet text-[6px]">•</i>`, "Board.tsx", allow)).toHaveLength(0);
    expect(tinyText(`<i className="board-rivet text-[6px]">•</i>`, "Other.tsx", allow)).toHaveLength(1);
  });

  it("every allow-list entry still matches a line (no stale exceptions)", () => {
    const size = new RegExp(SIZE.source);
    for (const a of ALLOW) {
      const src = readFileSync(path.join(DIR, a.file), "utf8");
      expect(src.split(/\r?\n/).some((l) => l.includes(a.match) && size.test(l)), `${a.file}: ${a.match}`).toBe(true);
    }
  });
});
