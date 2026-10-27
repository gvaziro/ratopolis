/*
 * Ratropolis Underground — the service worker (v3 SHL-6): the colony plays without a network.
 * The game is one client-only page (saves in localStorage, sound synthesised), so offline play needs only the page
 * and its /_next/static/ files:
 * - /_next/static/* is immutable (hashed names): cache-first, cached on the way through;
 * - navigations are network-first (a redeploy shows up on the next online visit), the cached page when offline;
 * - the page hands over what it loaded before this worker ran ({type: "warm", urls});
 * - {type: "skipWaiting"} lets a waiting new version take over (the page's «Обновить» toast).
 * The cache name carries VERSION: bump it when this file changes; activate drops every older rr-* cache.
 * Registered by src/components/ui/swClient.ts in production builds only, scoped to the app's base path.
 */
const VERSION = "2";
const CACHE = `rr-v${VERSION}`;
/** The app's root (e.g. https://host/ratopolis/): the one page, and the key it is cached under. */
const ROOT = self.registration.scope;
/** Hashed chunks pile up across deploys: keep the most recently used this many (a hit or a warm puts a file back on top). */
const MAX_STATIC = 300;

const isStatic = (url) => url.origin === self.location.origin && url.pathname.includes("/_next/static/");
const isRoot = (url) => url.origin === self.location.origin && (url.href.split(/[?#]/)[0] === ROOT || url.pathname === new URL("index.html", ROOT).pathname);

async function put(cache, key, res) {
  if (!res || !res.ok || res.type !== "basic") return;
  await cache.put(key, res);
}

/** Drop the static files no recent page has used: cache.keys() is in insertion order, the oldest go first. */
async function trim(cache) {
  const keys = (await cache.keys()).filter((r) => isStatic(new URL(r.url)));
  for (const r of keys.slice(0, Math.max(0, keys.length - MAX_STATIC))) await cache.delete(r);
}

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => fetch(new Request(ROOT, { cache: "reload" })).then((res) => put(c, ROOT, res)))
      .catch(() => undefined),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith("rr-") && k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (e) => {
  const d = e.data || {};
  if (d.type === "skipWaiting") self.skipWaiting();
  else if (d.type === "warm" && Array.isArray(d.urls)) {
    e.waitUntil(
      (async () => {
        const c = await caches.open(CACHE);
        for (const u of d.urls.slice(0, MAX_STATIC)) {
          const url = new URL(u, ROOT);
          if (!isStatic(url)) continue;
          // already cached: put back on top, so what this page uses is the newest and trim() leaves it be
          const hit = await c.match(url.href);
          if (hit) {
            await c.put(url.href, hit).catch(() => undefined);
            continue;
          }
          await fetch(url.href)
            .then((res) => put(c, url.href, res))
            .catch(() => undefined);
        }
        await trim(c).catch(() => undefined);
      })(),
    );
  }
});

async function page(req) {
  const c = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (isRoot(new URL(req.url))) await put(c, ROOT, res.clone());
    return res;
  } catch {
    // offline: the one page of the game, whatever the query (?slot=…)
    const hit = (await c.match(ROOT)) || (await c.match(req, { ignoreSearch: true }));
    return hit || new Response("<!doctype html><meta charset=utf-8><title>Ratropolis</title><p>Нет связи с поверхностью. Колония откроется, когда вернётся сеть.", { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
  }
}

async function immutable(req) {
  const c = await caches.open(CACHE);
  const hit = await c.match(req, { ignoreVary: true });
  if (hit) {
    // put back on top (the cache keeps insertion order): trim() drops what no recent page has used, never this
    c.put(req, hit.clone()).catch(() => undefined);
    return hit;
  }
  const res = await fetch(req);
  if (res.ok && res.type === "basic") {
    await c.put(req, res.clone());
    trim(c).catch(() => undefined);
  }
  return res;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (req.mode === "navigate" && url.origin === self.location.origin) e.respondWith(page(req));
  else if (isStatic(url)) e.respondWith(immutable(req));
});
