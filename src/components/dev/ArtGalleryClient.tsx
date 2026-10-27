"use client";

import dynamic from "next/dynamic";

/** The art gallery runs in the browser only (the colony's art reads the store, window and rAF), like the game. */
const ArtGallery = dynamic(() => import("./ArtGallery"), {
  ssr: false,
  loading: () => (
    <div className="flex h-dvh items-center justify-center">
      <p className="animate-pulse font-display text-2xl text-brass-light">Художник смешивает краски…</p>
    </div>
  ),
});

export default function ArtGalleryClient() {
  return <ArtGallery />;
}
