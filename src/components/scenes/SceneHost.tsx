"use client";

/**
 * Event close-up host: an overlay over the colony window (whole screen on phones) that shows the running
 * `game.scene`. Attaches the UI to the engine while mounted (the engine then waits for our results).
 * Scene bodies are separate chunks (next/dynamic, client only): every scene opens with seconds of warning or
 * rumble, and the chunks are fetched ahead anyway — trains on «К путям!» and when the Sewers / Metro open, the cat
 * when the Cellars open, the carriage and the piper (which come unannounced) once the game has settled in.
 */
import dynamic from "next/dynamic";
import { useEffect, type ComponentType } from "react";
import { onFx } from "@/game/fx";
import { useGame } from "@/game/store";
import type { Scene, SceneEventId } from "@/game/types";
import { MarketChip } from "./MarketPopup";
import SceneFrame from "./SceneFrame";
import { actQuiet } from "./sceneUtils";

const PHASE_LABEL: Record<string, string> = {
  warn: "Тревога",
  rumble: "Гул",
  catch: "Лови!",
  piles: "Разбор завалов",
  taps: "В бой",
  haul: "Улов",
  done: "",
};

type SceneBody = ComponentType<{ scene: Scene }>;

/** What the body area shows while a scene's chunk is still on its way (the frame's header is already up). */
function BodySkeleton() {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-[radial-gradient(ellipse_at_50%_40%,#2a211a,#14110f_70%)]" aria-busy="true">
      <span className="font-display text-sm uppercase tracking-[0.3em] text-parchment-dim" style={{ animation: "rr-blink 1.1s steps(1) infinite" }}>
        Крысы занимают места…
      </span>
    </div>
  );
}
const loading = () => <BodySkeleton />;

// the import() calls must stay literal (one chunk per body); the loaders below fetch the very same chunks early
const loadTrain = () => import("./TrainScene");
const loadCarriage = () => import("./CarriageScene");
const loadCat = () => import("./CatScene");
const loadRatcatcher = () => import("./RatcatcherScene");
const loadDownpour = () => import("./DownpourScene");

const TrainScene = dynamic(() => import("./TrainScene"), { ssr: false, loading });
const CarriageScene = dynamic(() => import("./CarriageScene"), { ssr: false, loading });
const CatScene = dynamic(() => import("./CatScene"), { ssr: false, loading });
const RatcatcherScene = dynamic(() => import("./RatcatcherScene"), { ssr: false, loading });
const DownpourScene = dynamic(() => import("./DownpourScene"), { ssr: false, loading });

const BODIES: Record<SceneEventId, SceneBody> = {
  carriage: CarriageScene,
  capsule: TrainScene,
  metro_train: TrainScene,
  royal_express: TrainScene,
  downpour: DownpourScene,
  cat: CatScene,
  ratcatcher: RatcatcherScene,
};

const prefetched = new Set<() => Promise<unknown>>();
/** Fetch a scene chunk ahead of time (once; a failed fetch may be retried later). */
function prefetch(load: () => Promise<unknown>): void {
  if (prefetched.has(load)) return;
  prefetched.add(load);
  load().catch(() => prefetched.delete(load));
}

/** Prefetch triggers: «К путям!», zones opening, and an idle moment for the unannounced scenes. */
function usePrefetchScenes(): void {
  const sewers = useGame((s) => !!s.game.zones.sewers);
  const cellars = useGame((s) => !!s.game.zones.cellars);
  const metro = useGame((s) => !!s.game.zones.metro);
  useEffect(
    () =>
      onFx((fx) => {
        if (fx.k === "trainSoon") prefetch(loadTrain);
      }),
    [],
  );
  useEffect(() => {
    // capsules (sewers) and metro trains share the train chunk; the downpour floods the sewers
    if (sewers || metro) prefetch(loadTrain);
    if (sewers) prefetch(loadDownpour);
  }, [sewers, metro]);
  useEffect(() => {
    if (cellars) prefetch(loadCat);
  }, [cellars]);
  useEffect(() => {
    // the cab and the piper arrive without a warning: fetch them as soon as the page has settled
    const warm = () => {
      prefetch(loadCarriage);
      prefetch(loadRatcatcher);
    };
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    let idle = 0;
    const t = window.setTimeout(() => {
      if (w.requestIdleCallback) idle = w.requestIdleCallback(warm, { timeout: 4000 });
      else warm();
    }, 2500);
    return () => {
      window.clearTimeout(t);
      if (idle) w.cancelIdleCallback?.(idle);
    };
  }, []);
}

export default function SceneHost() {
  usePrefetchScenes();
  const id = useGame((s) => s.game.scene?.id ?? null);
  const seq = useGame((s) => s.game.scene?.seq ?? 0);
  if (!id) return null;
  return (
    <div className="fixed inset-0 z-40 md:absolute md:inset-0 md:z-20" role="dialog" aria-modal="false" aria-label="Событие крупным планом">
      <SceneInstance key={seq} id={id} seq={seq} />
    </div>
  );
}

function SceneInstance({ id, seq }: { id: SceneEventId; seq: number }) {
  useEffect(() => {
    if (useGame.getState().game.scene?.seq === seq) actQuiet({ a: "attach" });
    return () => {
      if (useGame.getState().game.scene?.seq === seq) actQuiet({ a: "detach" });
    };
  }, [seq]);
  return (
    <SceneFrame
      id={id}
      right={
        <>
          <PhaseBadge />
          <MarketChip />
        </>
      }
    >
      <SceneBody />
    </SceneFrame>
  );
}

function PhaseBadge() {
  const phase = useGame((s) => s.game.scene?.phase ?? "done");
  const label = PHASE_LABEL[phase];
  if (!label) return null;
  return <span className="rounded border border-brass-dark/70 bg-black/30 px-1.5 py-0.5 font-display text-[11px] font-bold uppercase tracking-widest text-brass">{label}</span>;
}

/** Routes the running scene to its body component (re-renders with the scene, ~10 Hz). */
function SceneBody() {
  const scene = useGame((s) => s.game.scene);
  if (!scene) return null;
  const Body = BODIES[scene.id];
  return <Body scene={scene} />;
}
