import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ArtGalleryClient from "@/components/dev/ArtGalleryClient";

export const metadata: Metadata = {
  title: "Мастерская художника | Ratropolis",
  robots: { index: false, follow: false },
};

/**
 * Dev-only art gallery (v3 SHL-6, visuals-11): every chamber × tier with moods, the zone bands, the rats and the
 * resource glyphs. Production builds (the server build and the static export alike) render the 404 page here.
 */
export default function ArtPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <ArtGalleryClient />;
}
