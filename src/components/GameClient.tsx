"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";
import { registerServiceWorker } from "./ui/swClient";

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
  // v3 SHL-6: offline play — the service worker registers in production builds once the page has loaded
  // (development: none, and a leftover from `npm start` is removed)
  useEffect(() => {
    if (document.readyState === "complete") {
      registerServiceWorker();
      return;
    }
    window.addEventListener("load", registerServiceWorker, { once: true });
    return () => window.removeEventListener("load", registerServiceWorker);
  }, []);
  return <GameRoot />;
}
