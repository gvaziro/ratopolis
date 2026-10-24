"use client";

/**
 * Event close-up host: an overlay over the colony window (whole screen on phones) that shows the running
 * `game.scene`. Attaches the UI to the engine while mounted (the engine then waits for our results).
 * Scene bodies are separate chunks (next/dynamic, client only): every scene opens with seconds of warning or
 * rumble, and the chunks are fetched ahead anyway — trains on «К путям!» and when the Sewers / Metro open, the cat
 * when the Cellars open, the carriage and the piper (which come unannounced) once the game has settled in.
 * A body chunk that will not load (offline, a deploy swapped the chunk names) is retried, and if it still fails the
 * scene shows «Сцена не загрузилась» and the engine resolves it on its own clock — instead of the whole-game crash
 * screen; the body gets a fresh loader, because React.lazy (under next/dynamic) remembers a failed import for good.
 */
import dynamic from "next/dynamic";
import { Component, useEffect, type ComponentType, type ErrorInfo, type ReactNode } from "react";
import { BrassButton } from "@/components/ui/kit";
import { onFx } from "@/game/fx";
import { useGame } from "@/game/store";
import type { Scene, SceneEventId } from "@/game/types";
import { MarketChip } from "./MarketPopup";
import SceneFrame from "./SceneFrame";
import { act, actQuiet } from "./sceneUtils";

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

/** A body import, tried up to `tries` times a second apart (a dropped connection gets a moment to come back). */
function retry<T>(load: () => Promise<T>, tries = 3): Promise<T> {
  return load().catch((e: unknown) => {
    if (tries <= 1) throw e;
    return new Promise<T>((ok) => window.setTimeout(() => ok(retry(load, tries - 1)), 1000));
  });
}

// the import() calls must stay literal (one chunk per body); the loaders below fetch the very same chunks early
const loadTrain = () => import("./TrainScene");
const loadCarriage = () => import("./CarriageScene");
const loadCat = () => import("./CatScene");
const loadRatcatcher = () => import("./RatcatcherScene");
const loadDownpour = () => import("./DownpourScene");

type Chunk = "train" | "carriage" | "cat" | "ratcatcher" | "downpour";

/** Builds a body component; called again for a chunk whose load failed (a rejected lazy would fail forever). */
const MAKE_BODY: Record<Chunk, () => SceneBody> = {
  train: () => dynamic(() => retry(() => import("./TrainScene")), { ssr: false, loading }),
  carriage: () => dynamic(() => retry(() => import("./CarriageScene")), { ssr: false, loading }),
  cat: () => dynamic(() => retry(() => import("./CatScene")), { ssr: false, loading }),
  ratcatcher: () => dynamic(() => retry(() => import("./RatcatcherScene")), { ssr: false, loading }),
  downpour: () => dynamic(() => retry(() => import("./DownpourScene")), { ssr: false, loading }),
};

const bodies: Record<Chunk, SceneBody> = {
  train: MAKE_BODY.train(),
  carriage: MAKE_BODY.carriage(),
  cat: MAKE_BODY.cat(),
  ratcatcher: MAKE_BODY.ratcatcher(),
  downpour: MAKE_BODY.downpour(),
};

const CHUNK: Record<SceneEventId, Chunk> = {
  carriage: "carriage",
  capsule: "train",
  metro_train: "train",
  royal_express: "train",
  downpour: "downpour",
  cat: "cat",
  ratcatcher: "ratcatcher",
};

/** A failed chunk fetch (Turbopack / webpack ChunkLoadError, or the browser's own dynamic-import errors), not a bug. */
function isChunkError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  return e.name === "ChunkLoadError" || /Loading chunk|Failed to load chunk|dynamically imported module|Importing a module script failed/i.test(e.message);
}

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
      <BodyGuard chunk={CHUNK[id]} seq={seq}>
        <SceneBody />
      </BodyGuard>
    </SceneFrame>
  );
}

/**
 * Error boundary around one scene's body (SceneInstance is keyed by the scene seq, so each scene gets a fresh one).
 * Only a chunk that failed to load is handled here; any other error goes on up to CrashGuard as before.
 */
class BodyGuard extends Component<{ chunk: Chunk; seq: number; children: ReactNode }, { error: unknown }> {
  state: { error: unknown } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error: error ?? new Error("unknown") };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    if (!isChunkError(error)) return;
    console.warn("[ratropolis] scene chunk failed to load", error, info.componentStack);
    // the next try (or the next scene of this kind) gets a fresh lazy loader
    bodies[this.props.chunk] = MAKE_BODY[this.props.chunk]();
    // nobody is playing this scene now: let the engine resolve it on its own clock (no grace waits)
    if (useGame.getState().game.scene?.seq === this.props.seq) actQuiet({ a: "detach" });
  }

  private retry = () => {
    if (useGame.getState().game.scene?.seq === this.props.seq) actQuiet({ a: "attach" });
    this.setState({ error: null });
  };

  private skip = () => {
    // auto-collect resolves what is left; the haul card lives in the missing chunk, so close it right away
    act({ a: "skip" });
    act({ a: "dismiss" });
  };

  render() {
    const { error } = this.state;
    if (error === null) return this.props.children;
    // not ours: rethrow, CrashGuard freezes the loop and the saves as usual
    if (!isChunkError(error)) throw error;
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-[radial-gradient(ellipse_at_50%_40%,#2a211a,#14110f_70%)] p-4" role="alert">
        <div className="flex max-w-sm flex-col items-center gap-2 rounded-lg border border-brass-dark bg-soot/85 px-4 py-3 text-center shadow-[0_6px_20px_rgba(0,0,0,.7)]">
          <p className="font-display text-lg font-bold text-brass-light">Сцена не загрузилась</p>
          <p className="text-xs leading-snug text-parchment-dim">Связь с машинным отделением оборвалась. Колония справится сама, без лап, — или попробуйте ещё раз.</p>
          <div className="flex flex-wrap justify-center gap-2">
            <BrassButton className="min-h-11" onClick={this.retry}>
              Ещё раз
            </BrassButton>
            <BrassButton tone="ghost" className="min-h-11" onClick={this.skip}>
              Пропустить
            </BrassButton>
          </div>
        </div>
      </div>
    );
  }
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
  const Body = bodies[CHUNK[scene.id]];
  return <Body scene={scene} />;
}
