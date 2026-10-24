"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef } from "react";
import { onUiFx } from "@/game/fx";
import { useGame } from "@/game/store";
import { useGameLoop } from "@/game/useGameLoop";
import { setSciNotation } from "@/lib/format";
import AudioDirector from "./AudioDirector";
import CrashGuard from "./CrashScreen";
import ColonyView from "./colony/ColonyView";
import DevPanel from "./dev/DevPanel";
import FxLayer from "./fx/FxLayer";
import Header from "./layout/Header";
import NewsTicker from "./layout/NewsTicker";
import ResourceBar from "./layout/ResourceBar";
import SkyStrip from "./layout/SkyStrip";
import Toasts from "./layout/Toasts";
import CeremonyLoading from "./modals/CeremonyLoading";
import CoronationOverlay from "./modals/CoronationOverlay";
import MigrationOverlay from "./modals/MigrationOverlay";
import SidePanel from "./panels/SidePanel";
import MarketPopup from "./scenes/MarketPopup";
import SceneHost from "./scenes/SceneHost";
import { cx } from "./ui/kit";
import { useHotkeys } from "./useHotkeys";

// SH-5: dialogs most sessions never open load on demand; their shells (or the store flags below) decide when
const OfflineModal = dynamic(() => import("./modals/OfflineModal"), {
  ssr: false,
  loading: () => <CeremonyLoading label="Пока вас не было" z="z-[80]" tint="bg-black/70" />,
});
const SaveIssueModal = dynamic(() => import("./modals/SaveIssueModal"), {
  ssr: false,
  loading: () => <CeremonyLoading label="Летопись колонии" z="z-[90]" tint="bg-black/80" />,
});

/**
 * Top-level game layout.
 * Desktop: header / sky strip / resource bar / [colony | side panel] / news ticker.
 * Mobile (< 768 px): the side panel is a bottom sheet — «half» (colony 55%) or «full» (colony 15%, no sky strip),
 * toggled by the panel (store.sheet). Benedict's market docks inside the colony window.
 * CrashGuard wraps the layout (the loop stays outside it); SaveIssueModal covers it while a save problem is open.
 * The overlays are direct children of the layout root: Toasts watches that list to hold its banners under a modal.
 */
export default function GameRoot() {
  useGameLoop();
  useHotkeys();
  const ready = useGame((s) => s.ready);
  const shakeRef = useScreenShake();
  const sci = useGame((s) => s.game.settings.sciNotation);
  useEffect(() => setSciNotation(sci), [sci]);
  // init() keeps the fx of the absence (medals, zone banners, coronation) until there is someone to hear them:
  // in the commit that mounts the layout, every child's onFx subscription runs before this effect
  useEffect(() => {
    if (ready) useGame.getState().flushInitFx();
  }, [ready]);
  // a new run remounts the HUD and the colony, so their first-mount snapshots (built chambers, open zones,
  // shown resources) are taken afresh and the build/reveal animations play in every run; runSeq does the same when
  // the game is replaced wholesale (an import, a rollback, «Начать заново», a crash reload, a tab take-over)
  const runKey = useGame((s) => `${s.game.meta.migrations}:${s.runSeq}`);
  const sheet = useGame((s) => s.sheet);
  const offline = useGame((s) => s.offlineReport !== null);
  const saveIssue = useGame((s) => s.saveIssue !== null);
  const calm = useGame((s) => s.game.settings.reducedMotion);
  const fromOS = useGame((s) => s.game.settings.reducedMotionFromOS);
  // SH-4: the panel, header, resource bar and ticker grow with «Размер текста» (CSS zoom); the colony does not
  const zoom = useGame((s) => s.game.settings.textScale);
  const zoomStyle = zoom === 1 ? undefined : { zoom };
  // OS «reduce motion» stops the decorative CSS loops unless the player switched motion back on by hand
  useEffect(() => {
    document.documentElement.dataset.motion = calm ? "off" : fromOS ? "os" : "on";
  }, [calm, fromOS]);

  if (!ready) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <p className="animate-pulse font-display text-2xl text-brass-light">Крысы разгребают сохранение…</p>
      </div>
    );
  }

  return (
    <CrashGuard>
      <div ref={shakeRef} className="flex h-dvh flex-col overflow-hidden">
        <div style={zoomStyle} className="shrink-0">
          <Header />
        </div>
        <SkyStrip />
        <div style={zoomStyle} className="shrink-0">
          <ResourceBar key={runKey} />
        </div>
        <main
          className={cx(
            "relative grid min-h-0 flex-1 md:grid-cols-[minmax(0,1fr)_400px] md:grid-rows-1 xl:grid-cols-[minmax(0,1fr)_460px]",
            sheet === "full" ? "grid-rows-[15fr_85fr]" : "grid-rows-[55fr_45fr]",
            !calm && "max-md:transition-[grid-template-rows] max-md:duration-200 max-md:ease-out",
          )}
        >
          <section className="relative min-h-0 min-w-0 overflow-hidden">
            <ColonyView key={runKey} />
            <SceneHost />
            <MarketPopup />
          </section>
          <aside className="relative min-h-0 min-w-0 border-t border-line md:border-l md:border-t-0" style={zoomStyle}>
            <SidePanel />
          </aside>
        </main>
        <div style={zoomStyle} className="shrink-0">
          <NewsTicker />
        </div>
        <Toasts />
        {offline && <OfflineModal />}
        <CoronationOverlay />
        <MigrationOverlay />
        {saveIssue && <SaveIssueModal />}
        <FxLayer />
        <AudioDirector />
        <DevPanel />
      </div>
    </CrashGuard>
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
