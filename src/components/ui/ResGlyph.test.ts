import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RES_IDS, ZONE_IDS } from "@/game/types";
import { GLYPH_IDS, ResGlyph, ResGlyphDefs } from "./ResGlyph";

describe("ResGlyph (v3 SHL-5)", () => {
  const sheet = renderToStaticMarkup(createElement(ResGlyphDefs));

  it("draws every resource, every zone and the fog", () => {
    for (const r of RES_IDS) expect(GLYPH_IDS).toContain(r);
    for (const z of ZONE_IDS) expect(GLYPH_IDS).toContain(`zone-${z}`);
    expect(GLYPH_IDS).toContain("fog");
    for (const id of GLYPH_IDS) expect(sheet).toContain(`id="rg-${id}"`);
  });

  it("paints only with gradients the sheet defines, and never with NaN or undefined", () => {
    const used = new Set([...sheet.matchAll(/url\(#([\w-]+)\)/g)].map((m) => m[1]));
    expect(used.size).toBeGreaterThan(0);
    for (const id of used) expect(sheet).toContain(`id="${id}"`);
    expect(sheet).not.toMatch(/NaN|undefined/);
  });

  it("uses the symbol at the text size, named only when labelled", () => {
    const plain = renderToStaticMarkup(createElement(ResGlyph, { id: "coal" }));
    expect(plain).toContain('href="#rg-coal"');
    expect(plain).toContain('aria-hidden="true"');
    expect(plain).toContain("width:1em");
    const named = renderToStaticMarkup(createElement(ResGlyph, { id: "coins", label: "Монетки", size: "1.15em" }));
    expect(named).toContain('role="img"');
    expect(named).toContain('aria-label="Монетки"');
    expect(named).toContain("width:1.15em");
  });
});
