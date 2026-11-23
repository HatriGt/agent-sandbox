/*
 * The console's service worker. Scope: /dashboard/ only, so it sees the app shell, the hashed
 * bundles, the icons and the manifest, and never a data route (those live at the origin root:
 * /fleet.json, /watch.sse, /artifact, …) — nothing bearer-guarded is ever cached here.
 *
 * Strategy:
 *  - navigations (the HTML shell): network first, so a deploy is picked up on the next open; the
 *    cached shell answers only when the network is down, which is what makes the installed app
 *    open instead of showing the browser's offline page.
 *  - /dashboard/assets/*: cache first. The file names are content-hashed, so a hit is always the
 *    right bytes; a miss goes to the network and is kept for next time.
 *  - everything else under the scope (icons, favicon, manifest): stale-while-revalidate.
 *
 * __BUILD_ID__ is stamped by the Vite build (see web/vite.config.ts), so every deploy ships a new
 * worker, and the old shell cache is dropped on activate.
 */
const BUILD = "__BUILD_ID__";
const SHELL_CACHE = `asb-shell-${BUILD}`;
const ASSET_CACHE = "asb-assets";
const STATIC_CACHE = "asb-static";
const SHELL_URL = "/dashboard/";
const ASSET_LIMIT = 240;

self.addEventListener("install", (event) => {
  event.waitUntil(precache().catch(() => {}).then(() => self.skipWaiting()));
});

/**
 * The shell plus the bundles it names. The page that registers the worker fetched its own scripts
 * before the worker existed, so those would never pass through `fetch` and an offline open would
 * draw the skeleton and stop; naming them here makes the first offline open work. Lazy chunks
 * (pages, visualisers) are kept as they are visited.
 */
async function precache() {
  const shell = await caches.open(SHELL_CACHE);
  const res = await fetch(new Request(SHELL_URL, { cache: "reload" }));
  if (!res.ok) return;
  await shell.put(SHELL_URL, res.clone());
  const html = await res.text();
  const urls = new Set();
  for (const m of html.matchAll(/(?:src|href)="(\/dashboard\/assets\/[^"]+)"/g)) urls.add(m[1]);
  const assets = await caches.open(ASSET_CACHE);
  await Promise.all(
    [...urls].map(async (u) => {
      if (await assets.match(u)) return;
      const r = await fetch(u).catch(() => null);
      if (r && r.ok) await assets.put(u, r);
    })
  );
}

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.startsWith("asb-shell-") && n !== SHELL_CACHE).map((n) => caches.delete(n)));
      await trimAssets();
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    event.respondWith(shellFirstNetwork(req));
    return;
  }
  if (url.pathname.startsWith("/dashboard/assets/")) {
    event.respondWith(cacheFirst(req, ASSET_CACHE));
    return;
  }
  if (url.pathname.startsWith("/dashboard/")) {
    event.respondWith(staleWhileRevalidate(req, STATIC_CACHE));
  }
});

async function shellFirstNetwork(req) {
  try {
    const res = await fetch(req);
    if (res.ok) {
      const c = await caches.open(SHELL_CACHE);
      // One shell for every in-scope route: the SPA fallback returns the same document.
      c.put(SHELL_URL, res.clone()).catch(() => {});
    }
    return res;
  } catch {
    const cached = await caches.match(SHELL_URL, { cacheName: SHELL_CACHE });
    return cached || Response.error();
  }
}

async function cacheFirst(req, name) {
  const cached = await caches.match(req, { cacheName: name });
  if (cached) return cached;
  const res = await fetch(req);
  if (res.ok) {
    const c = await caches.open(name);
    c.put(req, res.clone()).catch(() => {});
  }
  return res;
}

async function staleWhileRevalidate(req, name) {
  const c = await caches.open(name);
  const cached = await c.match(req);
  const refresh = fetch(req)
    .then((res) => {
      if (res.ok) c.put(req, res.clone()).catch(() => {});
      return res;
    })
    .catch(() => cached || Response.error());
  return cached || refresh;
}

/** The asset cache grows one hashed bundle set per deploy; drop the oldest entries past the cap. */
async function trimAssets() {
  const c = await caches.open(ASSET_CACHE);
  const keys = await c.keys();
  if (keys.length <= ASSET_LIMIT) return;
  await Promise.all(keys.slice(0, keys.length - ASSET_LIMIT).map((k) => c.delete(k)));
}
