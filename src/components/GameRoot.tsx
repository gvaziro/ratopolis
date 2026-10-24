"use client";

import { useEffect, useRef } from "react";
import { onUiFx } from "@/game/fx";
import { useGame } from "@/game/store";
import { useGameLoop } from "@/game/useGameLoop";
import { setSciNotation } from "@/lib/format";
import AudioDirector from "./AudioDirector";
import ColonyView from "./colony/ColonyView";
import DevPanel from "./dev/DevPanel";
import FxLayer from "./fx/FxLayer";
import Header from "./layout/Header";
import NewsTicker from "./layout/NewsTicker";
import ResourceBar from "./layout/ResourceBar";
import SkyStrip from "./layout/SkyStrip";
import Toasts from "./layout/Toasts";
import CoronationOverlay from "./modals/CoronationOverlay";
import OfflineModal from "./modals/OfflineModal";
import SidePanel from "./panels/SidePanel";
import MarketPopup from "./scenes/MarketPopup";
import SceneHost from "./scenes/SceneHost";

/**
 * Top-level game layout.
 * Desktop: header / sky strip / resource bar / [colony | side panel] / news ticker.
 * Mobile (< 768 px): colony ~55% of the height, the side panel becomes a bottom sheet.
 */
export default function GameRoot() {
  useGameLoop();
  const ready = useGame((s) => s.ready);
  const shakeRef = useScreenShake();
  const sci = useGame((s) => s.game.settings.sciNotation);
  useEffect(() => setSciNotation(sci), [sci]);

  if (!ready) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <p className="animate-pulse font-display text-2xl text-brass-light">Крысы разгребают сохранение…</p>
      </div>
    );
  }

  return (
    <div ref={shakeRef} className="flex h-dvh flex-col overflow-hidden">
      <Header />
      <SkyStrip />
      <ResourceBar />
      <main className="relative grid min-h-0 flex-1 grid-rows-[55fr_45fr] md:grid-cols-[minmax(0,1fr)_400px] md:grid-rows-1 xl:grid-cols-[minmax(0,1fr)_460px]">
        <section className="relative min-h-0 min-w-0 overflow-hidden">
          <ColonyView />
          <SceneHost />
        </section>
        <aside className="relative min-h-0 min-w-0 border-t border-line md:border-l md:border-t-0">
          <SidePanel />
        </aside>
      </main>
      <NewsTicker />
      <MarketPopup />
      <Toasts />
      <OfflineModal />
      <CoronationOverlay />
      <FxLayer />
      <AudioDirector />
      <DevPanel />
    </div>
  );
}

/** Applies UiFx "shake" requests to the whole layout (respects reduced motion / no shake). */
function useScreenShake() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let until = 0;
    let px = 0;
    let raf = 0;
    const loop = () => {
      const el = ref.current;
      const now = performance.now();
      if (el) {
        if (now < until) {
          const k = (until - now) / 400;
          const a = px * Math.min(1, k);
          el.style.transform = `translate(${(Math.random() * 2 - 1) * a}px, ${(Math.random() * 2 - 1) * a}px)`;
          raf = requestAnimationFrame(loop);
          return;
        }
        el.style.transform = "";
      }
      raf = 0;
    };
    const off = onUiFx((fx) => {
      if (fx.k !== "shake") return;
      const st = useGame.getState().game.settings;
      if (st.reducedMotion || st.noShake) return;
      px = Math.max(px * (performance.now() < until ? 1 : 0), fx.px);
      until = Math.max(until, performance.now() + fx.ms);
      if (!raf) raf = requestAnimationFrame(loop);
    });
    return () => {
      off();
      cancelAnimationFrame(raf);
    };
  }, []);
  return ref;
}
