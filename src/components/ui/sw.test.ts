/**
 * public/sw.js (v3 SHL-6) run against a fake service-worker global: the cache rules that make the colony playable
 * offline. The worker is plain JS served as-is, so the test evaluates its source with mocked self / caches / fetch.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const SRC = readFileSync(resolve(__dirname, "../../../public/sw.js"), "utf8");
const ORIGIN = "https://rats.test";
const ROOT = `${ORIGIN}/ratopolis/`;

interface FakeRes {
  ok: boolean;
  status: number;
  type: string;
  body: string;
  clone(): FakeRes;
}

function res(body: string, status = 200): FakeRes {
  const r: FakeRes = { ok: status >= 200 && status < 300, status, type: "basic", body, clone: () => res(body, status) };
  return r;
}

const urlOf = (k: unknown) => (typeof k === "string" ? k : (k as { url: string }).url);

class FakeCache {
  store = new Map<string, FakeRes>();
  async put(k: unknown, r: FakeRes) {
    // like the Cache API: a put replaces the old entry and goes to the end of keys()
    this.store.delete(urlOf(k));
    this.store.set(urlOf(k), r);
  }
  async match(k: unknown, o?: { ignoreSearch?: boolean }) {
    const u = urlOf(k);
    if (this.store.has(u)) return this.store.get(u);
    if (o?.ignoreSearch) {
      const bare = u.split("?")[0];
      for (const [key, v] of this.store) if (key.split("?")[0] === bare) return v;
    }
    return undefined;
  }
  async keys() {
    return [...this.store.keys()].map((url) => ({ url }));
  }
  async delete(k: unknown) {
    return this.store.delete(urlOf(k));
  }
}

function setup() {
  const listeners: Record<string, ((e: unknown) => void)[]> = {};
  const caches = new Map<string, FakeCache>();
  const cacheStorage = {
    open: async (n: string) => {
      if (!caches.has(n)) caches.set(n, new FakeCache());
      return caches.get(n)!;
    },
    keys: async () => [...caches.keys()],
    delete: async (n: string) => caches.delete(n),
  };
  const net = { online: true, pages: new Map<string, string>(), calls: [] as string[] };
  const fetchMock = vi.fn(async (input: unknown) => {
    const u = urlOf(input);
    net.calls.push(u);
    if (!net.online) throw new TypeError("Failed to fetch");
    return res(net.pages.get(u.split("?")[0]) ?? `body of ${u}`);
  });
  const self = {
    registration: { scope: ROOT },
    location: { origin: ORIGIN },
    addEventListener: (t: string, fn: (e: unknown) => void) => {
      (listeners[t] ??= []).push(fn);
    },
    clients: { claim: vi.fn(async () => undefined) },
    skipWaiting: vi.fn(),
  };
  new Function("self", "caches", "fetch", SRC)(self, cacheStorage, fetchMock);

  /** Fire an extendable event and wait for everything it asked to wait for. */
  const fire = async (type: string, extra: Record<string, unknown> = {}) => {
    const waits: Promise<unknown>[] = [];
    let response: Promise<FakeRes> | undefined;
    const e = { ...extra, waitUntil: (p: Promise<unknown>) => waits.push(p), respondWith: (p: Promise<FakeRes>) => (response = p) };
    for (const fn of listeners[type] ?? []) fn(e);
    await Promise.all(waits);
    return response ? await response : undefined;
  };
  const get = (url: string, mode: "navigate" | "no-cors" = "no-cors") => fire("fetch", { request: { url, method: "GET", mode } });
  return { self, caches, net, fetchMock, fire, get };
}

describe("public/sw.js", () => {
  let w: ReturnType<typeof setup>;
  beforeEach(() => {
    w = setup();
    w.net.pages.set(ROOT, "<html>colony v1</html>");
  });

  it("caches the one page on install and serves it offline, whatever the query", async () => {
    await w.fire("install");
    w.net.online = false;
    const page = await w.get(`${ROOT}?slot=b`, "navigate");
    expect(page?.body).toBe("<html>colony v1</html>");
  });

  it("goes to the network first for the page, so a redeploy shows up on the next online visit", async () => {
    await w.fire("install");
    w.net.pages.set(ROOT, "<html>colony v2</html>");
    expect((await w.get(ROOT, "navigate"))?.body).toBe("<html>colony v2</html>");
    w.net.online = false;
    expect((await w.get(ROOT, "navigate"))?.body).toBe("<html>colony v2</html>");
  });

  it("answers offline with a short note when the page was never cached", async () => {
    w.net.online = false;
    const page = await w.get(ROOT, "navigate");
    expect(page?.status).toBe(503);
  });

  it("serves /_next/static/ cache-first: fetched once, then from the cache even offline", async () => {
    const js = `${ROOT}_next/static/chunks/app-123.js`;
    expect((await w.get(js))?.body).toBe(`body of ${js}`);
    w.net.online = false;
    expect((await w.get(js))?.body).toBe(`body of ${js}`);
    expect(w.net.calls.filter((u) => u === js)).toHaveLength(1);
  });

  it("leaves other requests and other origins to the browser", async () => {
    expect(await w.get(`${ROOT}manifest.webmanifest`)).toBeUndefined();
    expect(await w.get("https://fonts.example/_next/static/x.js")).toBeUndefined();
  });

  it("warms the cache with what the page loaded before the worker ran (statics only)", async () => {
    const css = `${ROOT}_next/static/css/a.css`;
    await w.fire("message", { data: { type: "warm", urls: [css, `${ROOT}icons/og.png`] } });
    w.net.online = false;
    expect((await w.get(css))?.body).toBe(`body of ${css}`);
    expect(w.net.calls).not.toContain(`${ROOT}icons/og.png`);
  });

  it("keeps the static files a page still uses when old chunks are trimmed (least recently used go first)", async () => {
    const js = (i: number) => `${ROOT}_next/static/chunks/c${i}.js`;
    const font = `${ROOT}_next/static/media/font.woff2`;
    await w.get(font); // cached on the first visit, unchanged across deploys
    for (let i = 0; i < 299; i++) await w.get(js(i));
    await w.get(font); // the current page uses it again (a hit)
    await w.fire("message", { data: { type: "warm", urls: [js(0)] } }); // and the page hands over chunk 0
    await w.get(js(299)); // a new deploy's chunk: 301 files, one must go
    await new Promise((r) => setTimeout(r, 0));
    const c = w.caches.get("rr-v2")!;
    const keys = (await c.keys()).map((k) => k.url);
    expect(keys).toHaveLength(300);
    expect(keys).toContain(font);
    expect(keys).toContain(js(0));
    expect(keys).not.toContain(js(1));
  });

  it("drops older rr-* caches on activate (and nobody else's), then takes the open pages", async () => {
    w.caches.set("rr-v0", new FakeCache());
    w.caches.set("someone-else", new FakeCache());
    await w.fire("install");
    await w.fire("activate");
    expect([...w.caches.keys()].sort()).toEqual(["rr-v2", "someone-else"]);
    expect(w.self.clients.claim).toHaveBeenCalled();
  });

  it("lets a waiting version take over when the page asks («Обновить»)", async () => {
    await w.fire("message", { data: { type: "skipWaiting" } });
    expect(w.self.skipWaiting).toHaveBeenCalled();
  });
});
