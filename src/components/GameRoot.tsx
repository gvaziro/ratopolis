"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef } from "react";
import { emitUiFx, onUiFx } from "@/game/fx";
import { isHeld, useGame } from "@/game/store";
import { useGameLoop } from "@/game/useGameLoop";
import { resolveEco, setEco } from "@/lib/eco";
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
import { ResGlyphDefs } from "./ui/ResGlyph";
import { onSwUpdate, SW_UPDATE_TARGET } from "./ui/swClient";
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
 * Short and wide (a phone in landscape, v3 SHL-3, the `short:` variant): the header spans the top, the sky strip, the
 * resource bar and the colony stack on the left, and the side panel takes the whole height on the right (`main`
 * becomes `display: contents`); the ticker folds away. Safe areas (viewport-fit=cover) pad the sides, the header's
 * top and the bottom row.
 * CrashGuard wraps the layout (the loop stays outside it); SaveIssueModal covers it while a save problem is open.
 * The overlays are direct children of the layout root: Toasts watches that list to hold its banners under a modal.
 * v3: the drawn resource glyphs' symbol sheet is mounted here once (SHL-5); html[data-motion] is the one motion
 * switch every decorative loop (data-decor) obeys (SHL-4); a newer offline version waiting behind the running
 * service worker becomes the toast «Новая версия колонии — обновить» (SHL-6).
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
  // SHL-6: a new version of the colony is installed (offline cache) and waits for a reload; Toasts mounts in the
  // same commit as this effect, so its listener is already there
  useEffect(() => {
    if (!ready) return;
    return onSwUpdate(() => emitUiFx({ k: "toast", text: "Новая версия колонии — обновить", icon: "✨", tab: "settings", target: SW_UPDATE_TARGET }));
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
  // SHL-3: the same factor for what lives outside those columns (toasts, tooltips in a body portal, dialog cards):
  // `.ui-zoom` reads --ui-zoom, set on <html> so the portals inherit it too
  useEffect(() => {
    document.documentElement.style.setProperty("--ui-zoom", String(zoom));
  }, [zoom]);
  // the ticker pads the bottom safe area while it shows; without it (not revealed yet, folded on short screens) the root does
  const news = useGame((s) => !!s.game.revealed.news);
  // the one motion switch (SHL-4): "off" pauses every [data-decor] loop, "os" leaves it to prefers-reduced-motion,
  // "on" (motion switched back on by hand) overrides the OS
  useEffect(() => {
    document.documentElement.dataset.motion = calm ? "off" : fromOS ? "os" : "on";
  }, [calm, fromOS]);
  // «Экономия батареи» (src/lib/eco.ts): html[data-eco] pauses the decorative CSS loops, setEco() thins the rAF ones;
  // "auto" follows the pointer, so a phone or tablet saves its battery and a desktop keeps full motion
  const saver = useGame((s) => s.game.settings.batterySaver);
  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse)");
    const apply = () => {
      const on = resolveEco(saver, mq.matches);
      setEco(on);
      if (on) document.documentElement.dataset.eco = "";
      else delete document.documentElement.dataset.eco;
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [saver]);

  if (!ready) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <p className="animate-pulse font-display text-2xl text-brass-light">Крысы разгребают сохранение…</p>
      </div>
    );
  }

  return (
    <CrashGuard>
      <div
        ref={shakeRef}
        className={cx(
          "flex h-dvh flex-col overflow-hidden pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] short:pb-[env(safe-area-inset-bottom)]",
          // landscape phones: [header × 2] / [sky | panel] / [resources | panel] / [colony | panel]
          "md:short:grid md:short:grid-cols-[minmax(0,1fr)_400px] md:short:grid-rows-[auto_auto_auto_minmax(0,1fr)] xl:short:grid-cols-[minmax(0,1fr)_460px]",
          !news && "pb-[env(safe-area-inset-bottom)]",
        )}
      >
        <div style={zoomStyle} className="shrink-0 md:short:col-span-2">
          <Header />
        </div>
        <SkyStrip />
        <div style={zoomStyle} className="shrink-0 md:short:col-start-1">
          <ResourceBar key={runKey} />
        </div>
        <main
          className={cx(
            "relative grid min-h-0 flex-1 md:grid-cols-[minmax(0,1fr)_400px] md:grid-rows-1 md:short:contents xl:grid-cols-[minmax(0,1fr)_460px]",
            sheet === "full" ? "grid-rows-[15fr_85fr]" : "grid-rows-[55fr_45fr]",
            !calm && "max-md:transition-[grid-template-rows] max-md:duration-200 max-md:ease-out",
          )}
        >
          <section className="relative min-h-0 min-w-0 overflow-hidden md:short:col-start-1 md:short:row-start-4">
            <ColonyView key={runKey} />
            <SceneHost />
            <MarketPopup />
          </section>
          <aside
            className="relative min-h-0 min-w-0 border-t border-line md:border-l md:border-t-0 md:short:col-start-2 md:short:row-span-3 md:short:row-start-2"
            style={zoomStyle}
          >
            <SidePanel />
          </aside>
        </main>
        {/* short screens (a phone in landscape): the ticker folds away and the colony gets its 30 px */}
        <div style={zoomStyle} className={cx("shrink-0 short:hidden", news && "pb-[env(safe-area-inset-bottom)]")}>
          <NewsTicker />
        </div>
        <ResGlyphDefs />
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

/**
 * Applies UiFx "shake" requests to the whole layout (respects reduced motion / no shake). While the game is held
 * (a ceremony, a crash, a save issue: isHeld) shakes are ignored and a running one stops at once, so the coronation
 * show and the dialogs never tremble under a frozen train (v3 SHL-2, K1).
 */
function useScreenShake() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let until = 0;
    let px = 0;
    let raf = 0;
    const loop = () => {
      const el = ref.current;
      const now = performance.now();
      if (isHeld(useGame.getState())) until = 0;
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
      const store = useGame.getState();
      const st = store.game.settings;
      if (st.reducedMotion || st.noShake || isHeld(store)) return;
      px = Math.max(px * (performance.now() < until ? 1 : 0), fx.px);
      until = Math.max(until, performance.now() + fx.ms);
      if (!raf) raf = requestAnimationFrame(loop);
    });
    // the hold begins mid-shake: settle the layout now, not on the next frame (which may be far off in a busy show)
    const offHold = useGame.subscribe((st, prev) => {
      if (!isHeld(st) || isHeld(prev)) return;
      until = 0;
      if (ref.current) ref.current.style.transform = "";
    });
    return () => {
      off();
      offHold();
      cancelAnimationFrame(raf);
    };
  }, []);
  return ref;
}
