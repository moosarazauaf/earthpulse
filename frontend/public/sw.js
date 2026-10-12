// EarthPulse service worker.
// Its only job is to make the site installable as an app. It caches nothing:
// imagery and hazard feeds must always be fetched fresh, and a stale copy of
// the application would be worse than a slow load.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {
  // Fall through to the network.
});
