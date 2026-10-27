/**
 * Offline play (v3 SHL-6, tech-10): the page side of public/sw.js. No React and no game imports, so GameClient (the
 * server-rendered shell) can call it without pulling the game in.
 * - Production builds register the worker under the app's base path (a static export may live at /ratopolis/).
 * - The first visit loads before the worker runs: once it is active, the page hands it the /_next/static/ files it has
 *   already fetched («warm»), so the very next offline reload finds them.
 * - A newer worker waiting behind the running one is announced (GameRoot turns it into the toast «Новая версия
 *   колонии — обновить»); applySwUpdate() saves, lets it take over and reloads this tab only.
 * - Development registers nothing and removes a worker left on this origin by a production run (`npm start`): its
 *   cache-first chunks would shadow the dev server's.
 */

/** The toast target that turns «Открыть» into «Обновить» (Toasts). */
export const SW_UPDATE_TARGET = "rr-sw-update";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
/** A tab left open for days asks for a new version when it comes back, at most this often. */
const UPDATE_EVERY_MS = 30 * 60_000;

let waiting: ServiceWorker | null = null;
const listeners = new Set<() => void>();

function announce(w: ServiceWorker): void {
  if (waiting === w) return;
  waiting = w;
  for (const fn of listeners) fn();
}

/** A newer worker is installed and waiting: `fn` runs at once if one already is, and whenever one turns up. */
export function onSwUpdate(fn: () => void): () => void {
  listeners.add(fn);
  if (waiting) fn();
  return () => {
    listeners.delete(fn);
  };
}

/** «Обновить»: the waiting worker takes over and this tab reloads into the new version (`beforeReload` saves). */
export function applySwUpdate(beforeReload?: () => void): void {
  try {
    beforeReload?.();
  } catch {
    /* a failed save must not block the update */
  }
  const w = waiting;
  if (!w || !("serviceWorker" in navigator)) {
    window.location.reload();
    return;
  }
  // only the tab that asked reloads; other open tabs keep playing under the new worker
  navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload(), { once: true });
  w.postMessage({ type: "skipWaiting" });
}

/** The /_next/static/ files this page has already loaded (scripts, styles, fonts, lazy chunks). */
function loadedStatic(): string[] {
  const urls = new Set<string>();
  for (const e of performance.getEntriesByType("resource")) if (e.name.includes("/_next/static/")) urls.add(e.name);
  for (const el of document.querySelectorAll<HTMLScriptElement>("script[src]")) if (el.src.includes("/_next/static/")) urls.add(el.src);
  for (const el of document.querySelectorAll<HTMLLinkElement>("link[href]")) if (el.href.includes("/_next/static/")) urls.add(el.href);
  return [...urls];
}

function watchInstall(sw: ServiceWorkerContainer, w: ServiceWorker | null): void {
  if (!w) return;
  // "installed" with a controller = a new version waiting behind the running one (a first install just activates)
  const check = () => {
    if (w.state === "installed" && sw.controller) announce(w);
  };
  check();
  w.addEventListener("statechange", check);
}

async function register(sw: ServiceWorkerContainer): Promise<void> {
  const reg = await sw.register(`${BASE}/sw.js`, { scope: `${BASE}/` });
  if (reg.waiting && sw.controller) announce(reg.waiting);
  watchInstall(sw, reg.installing);
  reg.addEventListener("updatefound", () => watchInstall(sw, reg.installing));
  const ready = await sw.ready;
  ready.active?.postMessage({ type: "warm", urls: loadedStatic() });
  let asked = Date.now();
  document.addEventListener("visibilitychange", () => {
    if (document.hidden || Date.now() - asked < UPDATE_EVERY_MS) return;
    asked = Date.now();
    reg.update().catch(() => undefined);
  });
}

/** Called once by GameClient after the page has loaded. */
export function registerServiceWorker(): void {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  const sw = navigator.serviceWorker;
  if (process.env.NODE_ENV !== "production") {
    sw.getRegistrations()
      .then((regs) => {
        for (const r of regs) {
          const url = r.active?.scriptURL ?? r.waiting?.scriptURL ?? r.installing?.scriptURL ?? "";
          if (url.endsWith("/sw.js")) void r.unregister();
        }
      })
      .catch(() => undefined);
    if ("caches" in window) {
      caches
        .keys()
        .then((keys) => Promise.all(keys.filter((k) => k.startsWith("rr-")).map((k) => caches.delete(k))))
        .catch(() => undefined);
    }
    return;
  }
  register(sw).catch(() => undefined);
}
