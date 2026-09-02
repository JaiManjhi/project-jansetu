/**
 * Hand-rolled service worker.
 *
 * ARCHITECTURE.md §3 allows next-pwa or a hand-rolled worker. Hand-rolled won:
 * next-pwa wraps Workbox and expects a webpack build, and this project runs on
 * Turbopack — a build-tool disagreement is not a good thing to discover on
 * day 9. This file is small enough to read in full, which matters more.
 *
 * Scope is deliberately narrow. It makes the app shell available offline so a
 * citizen can still OPEN the form with no signal; the actual offline
 * submission is handled by the IndexedDB queue in lib/offline-queue.ts, on the
 * main thread where it can be observed and tested. Background Sync would be
 * tidier but is Chromium-only and effectively untestable by hand, and PRD §6
 * asks for a visible "queued, will send" state — which needs the page anyway.
 */

const VERSION = "jansetu-v1";
const SHELL = [
  "/",
  "/feed",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      // Individually, so one 404 cannot fail the whole install.
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only GET is cacheable. A POST must never be served from cache — replaying
  // a stale submission would be worse than failing.
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // API responses are live data; never serve a stale one.
  if (url.pathname.startsWith("/api/")) return;

  // Navigations: network first, cache as the fallback. Fresh when online,
  // still openable when not.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then((hit) => hit ?? caches.match("/"))),
    );
    return;
  }

  // Static assets: cache first, refresh in the background.
  event.respondWith(
    caches.match(request).then((hit) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => hit);
      return hit ?? network;
    }),
  );
});
