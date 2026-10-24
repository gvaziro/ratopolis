import type { MetadataRoute } from "next";

/** Install manifest (SH-6): a standalone soot-black app with the Rat King icons. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Ratropolis Underground — Крысиный мегаполис",
    short_name: "Ratropolis",
    description: "Инкрементальная игра: крысиная стимпанк-цивилизация под викторианским Лондоном.",
    start_url: "/",
    display: "standalone",
    background_color: "#14110f",
    theme_color: "#14110f",
    lang: "ru",
    icons: [
      { src: "/icon1/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon1/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
  };
}
