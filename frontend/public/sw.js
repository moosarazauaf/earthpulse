// EarthPulse service worker.
//
// It caches only files that never change under the same name:
//  - /assets/*  the application's build files, whose names carry a content hash;
//  - /cesium/*  the globe library's files, cached per Cesium version (the
//               version is passed in this script's URL, ?cesium=1.146.0).
// Everything else (the page itself, news, imagery, hazard feeds, weather) goes
// to the network, so nothing a visitor reads is ever stale. When the network is
// down, the last copy of the page is served so the app still opens offline.
const params = new URL(self.location.href).searchParams;
const CESIUM_CACHE = `cesium-${params.get("cesium") || "unknown"}`;
const ASSETS_CACHE = "assets-v1";
const PAGE_CACHE = "page-v1";
const KEEP = new Set([CESIUM_CACHE, ASSETS_CACHE, PAGE_CACHE]);
/** Build files from old releases are dropped once there are more than this many. */
const MAX_ASSETS = 40;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (!KEEP.has(name)) await caches.delete(name);
    await self.clients.claim();
  })());
});

async function cacheFirst(cacheName, request) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok && response.type === "basic") {
    await cache.put(request, response.clone());
    if (cacheName === ASSETS_CACHE) {
      const keys = await cache.keys();
      for (const old of keys.slice(0, Math.max(0, keys.length - MAX_ASSETS))) await cache.delete(old);
    }
  }
  return response;
}

async function networkFirstPage(request) {
  const cache = await caches.open(PAGE_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put("page", response.clone());
    return response;
  } catch (error) {
    const copy = await cache.match("page");
    if (copy) return copy;
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // imagery, feeds and APIs: always the network
  const scope = new URL(self.registration.scope).pathname;
  const path = url.pathname.slice(scope.length);
  if (path.startsWith("assets/")) event.respondWith(cacheFirst(ASSETS_CACHE, request));
  else if (path.startsWith("cesium/")) event.respondWith(cacheFirst(CESIUM_CACHE, request));
  else if (request.mode === "navigate") event.respondWith(networkFirstPage(request));
  // anything else (news.json, stored analyses) falls through to the network
});
