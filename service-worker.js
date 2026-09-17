/**
 * service-worker.js — offline-first cache-then-network for the app shell.
 * Everything the app needs to run is static and local (no CDN, no API),
 * so a full precache + cache-first strategy is enough for true offline use.
 */

const CACHE_VERSION = "v3";
const CACHE_NAME = `adhd-timeline-${CACHE_VERSION}`;

const PRECACHE_URLS = [
  "./",
  "index.html",
  "manifest.json",
  "css/tokens.css",
  "css/base.css",
  "css/fonts.css",
  "css/components.css",
  "css/date-picker.css",
  "css/timeline-vertical.css",
  "css/timeline-horizontal.css",
  "js/app.js",
  "js/storage.js",
  "js/theming.js",
  "js/recurrence.js",
  "js/chunking.js",
  "js/chunkingRules.js",
  "js/ripening.js",
  "js/notifications.js",
  "js/capture.js",
  "js/ics-import.js",
  "js/backup.js",
  "js/categories.js",
  "js/date-picker.js",
  "js/quickAddRules.js",
  "js/gcal-sync.js",
  "js/timeline-vertical.js",
  "js/timeline-horizontal.js",
  "js/vendor/rrule.js",
  "fonts/atkinson-hyperlegible/atkinson-hyperlegible-latin-400-normal.woff2",
  "fonts/atkinson-hyperlegible/atkinson-hyperlegible-latin-700-normal.woff2",
  "fonts/atkinson-hyperlegible/atkinson-hyperlegible-latin-400-italic.woff2",
  "fonts/opendyslexic/opendyslexic-latin-400-normal.woff2",
  "fonts/opendyslexic/opendyslexic-latin-700-normal.woff2",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-192.png",
  "icons/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  // Google Identity Services / Calendar API calls (opt-in, see gcal-sync.js)
  // go straight to the network — this cache is for the local app shell only.
  if (new URL(event.request.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
