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
 * v3 SCN-1: drives the scene clock's hold (a ceremony, a crash, a save issue or a hidden tab — see sceneClock.ts).
 * v3 SCN-5: on the phone layout (narrow or short: a phone in landscape too) the dialog covers the whole screen and is
 * modal; the colony under it is inert on every layout, the bars and the side panel too on phones. A keyboard player's
 * focus moves into the scene on every phase ([data-autofocus], else the first enabled button) and goes back where it
 * was (or to the grate) when the scene ends.
 */
import dynamic from "next/dynamic";
import { Component, useEffect, useLayoutEffect, useRef, useState, type ComponentType, type ErrorInfo, type ReactNode, type RefObject } from "react";
import { BrassButton } from "@/components/ui/kit";
import { onFx } from "@/game/fx";
import { isHeld, useGame } from "@/game/store";
import type { Scene, SceneEventId } from "@/game/types";
import { usePhoneLayout } from "@/lib/layoutMode";
import { MarketChip } from "./MarketPopup";
import { onSceneHold, sceneHeld, setSceneHeld } from "./sceneClock";
import SceneFrame from "./SceneFrame";
import { act, actQuiet, keyboardUsed, trackInputModality } from "./sceneUtils";

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

/** SCN-1: the scene clock is held while the game is (isHeld: ceremony, crash, save issue) or the tab is hidden. */
function useSceneHold(): void {
  useEffect(() => {
    const sync = () => setSceneHeld(isHeld(useGame.getState()) || document.visibilityState === "hidden");
    sync();
    const off = useGame.subscribe(sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      off();
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);
}

export default function SceneHost() {
  usePrefetchScenes();
  useSceneHold();
  useEffect(() => trackInputModality(), []);
  const id = useGame((s) => s.game.scene?.id ?? null);
  const seq = useGame((s) => s.game.scene?.seq ?? 0);
  if (!id) return null;
  return <SceneDialog key={seq} id={id} seq={seq} />;
}

/** The dialog box: the colony window on desktop, the whole screen (and modal) on the phone layout. */
function SceneDialog({ id, seq }: { id: SceneEventId; seq: number }) {
  const phone = usePhoneLayout();
  const phase = useGame((s) => s.game.scene?.phase ?? "done");
  const ref = useRef<HTMLDivElement>(null);
  // the focus to give back when the scene ends, taken in the first render: the focus layout effect may move it into
  // the dialog before any passive effect runs
  const [before] = useState<Element | null>(() => (typeof document !== "undefined" ? document.activeElement : null));
  useInertBackground(ref, phone, phase);
  useSceneFocus(ref, seq, phase, before);
  // the hold marks the box (CSS pauses the time-bound loops under it: the «Наверху» inset)
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const mark = (held: boolean) => el.toggleAttribute("data-held", held);
    mark(sceneHeld());
    return onSceneHold(mark);
  }, []);
  return (
    // JS-driven, not a CSS variant: a landscape phone (812×375) is md by width but still gets the whole screen
    <div ref={ref} data-scene-dialog="" className={phone ? "fixed inset-0 z-40" : "absolute inset-0 z-20"} role="dialog" aria-modal={phone} aria-label="Событие крупным планом">
      <SceneInstance id={id} seq={seq} />
    </div>
  );
}

/* ------------------------------------------------------------ focus & inert background (SCN-5) */

const AUTOFOCUS = "[data-autofocus]:not([disabled])";
const ENABLED = "button:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])";

const shown = (el: Element) => el.getClientRects().length > 0;

/** The scene's body chunk is still on its way (BodySkeleton): its [data-autofocus] control is not there yet. */
const bodyLoading = (dlg: HTMLElement) => !!dlg.querySelector("[data-scene-body] [aria-busy='true']");

/** Where a keyboard player's focus goes in the dialog: [data-autofocus] in the body, then anywhere, then the first enabled button. */
function focusTarget(dlg: HTMLElement): HTMLElement | null {
  const body = dlg.querySelector("[data-scene-body]") ?? dlg;
  for (const root of [body, dlg]) {
    for (const sel of [AUTOFOCUS, ENABLED]) {
      for (const el of root.querySelectorAll<HTMLElement>(sel)) if (shown(el) && !el.closest("[inert]")) return el;
    }
  }
  return null;
}

/** The grate in the colony (the focus goes back there when nothing better was focused before the scene). */
function grate(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.cv-root [aria-label^="Решётка водостока"]') ?? document.querySelector<HTMLElement>('[aria-label^="Решётка водостока"]');
}

/**
 * Keyboard focus follows the scene: on mount and on every phase change (and whenever it falls to <body> mid-phase),
 * a keyboard player whose focus is on the page body or outside the dialog lands on the phase's [data-autofocus]
 * control; when the scene ends the focus returns to what had it before (`saved`, or the grate), unless it moved on meanwhile.
 */
function useSceneFocus(ref: RefObject<HTMLDivElement | null>, seq: number, phase: string, saved: Element | null): void {
  useEffect(() => {
    const dlg = ref.current;
    const lost = () => !document.activeElement || document.activeElement === document.body;
    // focus that falls to <body> mid-phase (a focused button unmounted: the hook's bar, a swept pile) comes back
    const iv = window.setInterval(() => {
      if (dlg && keyboardUsed() && !sceneHeld() && lost() && !bodyLoading(dlg)) focusTarget(dlg)?.focus({ preventScroll: true });
    }, 100);
    return () => {
      window.clearInterval(iv);
      // after the inert background is lifted (its cleanup runs first; the microtask makes sure)
      queueMicrotask(() => {
        const active = document.activeElement;
        if (active && active !== document.body && active.isConnected && !dlg?.contains(active)) return; // moved on
        const back = (saved instanceof HTMLElement || saved instanceof SVGElement) && !dlg?.contains(saved) ? saved : null;
        const target = back && back !== document.body && back.isConnected && !back.closest("[inert]") ? back : grate();
        target?.focus({ preventScroll: true });
      });
    };
  }, [ref, seq, saved]);

  // Tab from nowhere (the page body) goes into the scene; on the phone layout (modal) Tab also stays inside it
  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || e.ctrlKey || e.metaKey || e.altKey || sceneHeld()) return;
      const active = document.activeElement;
      const modal = dlg.getAttribute("aria-modal") === "true";
      if (!active || active === document.body || (modal && !dlg.contains(active))) {
        const target = focusTarget(dlg);
        if (!target) return;
        e.preventDefault();
        target.focus({ preventScroll: true });
        return;
      }
      if (!modal || !dlg.contains(active)) return;
      const all = [...dlg.querySelectorAll<HTMLElement>(ENABLED)].filter((el) => el.tabIndex >= 0 && shown(el));
      if (!all.length) return;
      const first = all[0];
      const last = all[all.length - 1];
      if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus({ preventScroll: true });
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus({ preventScroll: true });
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [ref, seq]);

  // a layout effect: the phase that just replaced the focused control never leaves the focus on <body> for a frame
  useLayoutEffect(() => {
    const dlg = ref.current;
    if (!dlg || !keyboardUsed()) return;
    let tries = 0;
    let t = 0;
    const place = () => {
      const active = document.activeElement;
      if (active && active !== document.body && dlg.contains(active) && shown(active)) return;
      // a ceremony over the scene keeps its own focus; while the body chunk is on its way the focus waits for the
      // phase's own control (not the header's market chip): look again for a moment
      if (sceneHeld() || bodyLoading(dlg)) {
        if (++tries < 100) t = window.setTimeout(place, 50);
        return;
      }
      const target = focusTarget(dlg);
      target?.focus({ preventScroll: true });
      if ((!target || document.activeElement !== target) && ++tries < 100) t = window.setTimeout(place, 50);
    };
    place();
    return () => window.clearTimeout(t);
  }, [ref, seq, phase]);
}

/** In-flow page bars (header, sky strip, resource bar, ticker): not the fixed overlays, toasts or the fx layer. */
function inFlow(el: Element): boolean {
  if (!(el instanceof HTMLElement) || el.getAttribute("role") === "dialog") return false;
  const cs = getComputedStyle(el);
  return cs.display !== "none" && cs.position !== "fixed" && cs.position !== "absolute";
}

/**
 * While a scene is up the colony under it is inert (nothing to Tab into under the close-up); on the phone layout the
 * whole screen is the scene, so the header, the sky strip, the resource bar, the side panel and the ticker are too.
 * Re-applied on every phase (a remounted colony gets it again); only what this hook made inert is released.
 */
function useInertBackground(ref: RefObject<HTMLDivElement | null>, phone: boolean, phase: string): void {
  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    const targets = new Set<HTMLElement>();
    const add = (el: Element | null | undefined) => {
      if (el instanceof HTMLElement && !el.contains(dlg) && !el.inert) targets.add(el);
    };
    document.querySelectorAll(".cv-root").forEach(add);
    if (phone) {
      const main = dlg.closest("main");
      const shell = main?.parentElement;
      if (main) for (const el of main.children) if (el.tagName === "ASIDE") add(el);
      if (main && shell) for (const el of shell.children) if (el !== main && inFlow(el)) add(el);
    }
    for (const el of targets) {
      el.inert = true;
      el.setAttribute("data-scene-inert", "");
    }
    return () => {
      for (const el of targets) {
        if (!el.hasAttribute("data-scene-inert")) continue;
        el.inert = false;
        el.removeAttribute("data-scene-inert");
      }
    };
  }, [ref, phone, phase]);
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
            <BrassButton className="min-h-11" data-autofocus="" onClick={this.retry}>
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

/** The phase name at the header's right edge; phones below sm drop it, so the scene title keeps the room. */
function PhaseBadge() {
  const phase = useGame((s) => s.game.scene?.phase ?? "done");
  const label = PHASE_LABEL[phase];
  if (!label) return null;
  return (
    <span className="rounded border border-brass-dark/70 bg-black/30 px-1.5 py-0.5 font-display text-[11px] font-bold uppercase tracking-widest text-brass max-sm:hidden">{label}</span>
  );
}

/** Routes the running scene to its body component (re-renders with the scene, ~10 Hz). */
function SceneBody() {
  const scene = useGame((s) => s.game.scene);
  if (!scene) return null;
  const Body = bodies[CHUNK[scene.id]];
  return <Body scene={scene} />;
}
