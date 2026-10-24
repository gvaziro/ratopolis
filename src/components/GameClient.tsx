"use client";

import dynamic from "next/dynamic";

/** The game only runs in the browser (localStorage, rAF, WebAudio), so skip SSR. */
const GameRoot = dynamic(() => import("./GameRoot"), {
  ssr: false,
  loading: () => (
    <div className="flex h-dvh items-center justify-center">
      <p className="animate-pulse font-display text-2xl text-brass-light">Ratropolis Underground…</p>
    </div>
  ),
});

export default function GameClient() {
  return <GameRoot />;
}
