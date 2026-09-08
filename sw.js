/* markhere service worker — makes the installed app load & run fully offline.
 *
 * Strategy: precache the app shell on install; serve stale-while-revalidate for
 * same-origin GETs (instant + offline, refreshes the cache in the background).
 * Bump CACHE when shell assets change so old caches are purged on activate.
 *
 * All paths are relative so this works at a domain root OR a sub-path
 * (e.g. GitHub Pages' /markhere/), matching how the app is served.
 */
const CACHE = "markhere-v1";

const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./vendor/marked.min.js",
  "./vendor/prism.min.js",
  "./vendor/fonts/opendyslexic-400.woff2",
  "./vendor/fonts/opendyslexic-700.woff2",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => cached); // offline & uncached → undefined (browser shows network error)
      return cached || network;
    })
  );
});
