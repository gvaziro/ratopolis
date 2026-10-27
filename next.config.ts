import type { NextConfig } from "next";

/**
 * One config, two targets (REP-1, REP-3):
 * - `next dev` / `npm run build` / `npm start`: the server build (Vercel), unchanged.
 * - Static export for GitHub Pages or any static file host: `npm run build:static` (or `STATIC_EXPORT=1 next build`)
 *   writes `out/`. `BASE_PATH=/ratopolis` serves the game from a sub-path (a Pages project site); the same value reaches
 *   the client as `NEXT_PUBLIC_BASE_PATH` for hand-written asset paths (metadata icons, the service worker).
 * cacheComponents and partialPrefetching are gone: the game is a single client-only page, so they did nothing for it,
 * and they block `output: "export"` (route segment `dynamic` is incompatible with cacheComponents).
 */
const on = (v: string | undefined) => !!v && v !== "0" && v !== "false";

/** `npm run build:static` sets npm_lifecycle_event, so the script needs no cross-env on Windows. */
const STATIC_EXPORT = on(process.env.STATIC_EXPORT) || process.env.npm_lifecycle_event === "build:static";

/** "/ratopolis" (leading slash, no trailing one) or "" for the domain root. */
const BASE_PATH = ((raw) => (raw && !raw.startsWith("/") ? `/${raw}` : raw))((process.env.BASE_PATH ?? "").trim().replace(/\/+$/, ""));
if (/[:\\]/.test(BASE_PATH)) {
  // Git Bash on Windows rewrites BASE_PATH=/ratopolis into "C:/Program Files/Git/ratopolis" before node sees it
  throw new Error(`BASE_PATH must be a URL path such as /ratopolis, got "${process.env.BASE_PATH}". In Git Bash prefix the command with MSYS_NO_PATHCONV=1.`);
}

const nextConfig: NextConfig = {
  output: STATIC_EXPORT ? "export" : undefined,
  basePath: BASE_PATH || undefined,
  env: { NEXT_PUBLIC_BASE_PATH: BASE_PATH },
  // no next/image today; a static host has no optimizer, so any future <Image> must not depend on one
  images: { unoptimized: true },
  // the «N» bubble covered the first building card and the piles footer at 375 px (mobile-13); errors still surface
  devIndicators: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
