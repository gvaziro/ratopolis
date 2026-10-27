import type { MetadataRoute } from "next";

/** A static export (REP-3) prerenders this route into out/manifest.webmanifest. */
export const dynamic = "force-static";

/**
 * Install manifest (SH-6): a standalone soot-black app with the Rat King icons.
 * v3 (SHL-6): every URL is relative to the manifest itself, so the same file works at the domain root (Vercel) and
 * under a static export's base path (/ratopolis/ on GitHub Pages); the icons are static PNGs in public/icons.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Ratropolis Underground — Крысиный мегаполис",
    short_name: "Ratropolis",
    description: "Инкрементальная игра: крысиная стимпанк-цивилизация под викторианским Лондоном.",
    start_url: "./",
    scope: "./",
    display: "standalone",
    background_color: "#14110f",
    theme_color: "#14110f",
    lang: "ru",
    icons: [
      { src: "icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "icons/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
  };
}
