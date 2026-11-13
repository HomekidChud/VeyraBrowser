const CACHE = "veyra-browser-shell-v8.28.29-handoff-auto-return";
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./styles/style.css?v=8.28.29-handoff-auto-return", "./src/bootstrap.js?v=8.28.29-handoff-auto-return"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.includes("/api/")) return;
  const staticAsset = request.destination === "script" || request.destination === "style" || request.destination === "image" || request.destination === "font" || url.pathname.endsWith("manifest.webmanifest");
  if (!staticAsset && request.mode !== "navigate") return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (staticAsset) {
      const cached = await cache.match(request);
      const network = fetch(request).then(response => {
        // A failed cache write (quota, etc.) must never surface as an
        // unhandled rejection; the fetched response is still returned.
        if (response.ok) cache.put(request, response.clone()).catch(() => {});
        return response;
      }).catch(() => {
        // If the network fails and nothing is cached, respondWith(undefined)
        // throws a TypeError. Answer with a network-error response instead.
        return cached || Response.error();
      });
      return cached || network;
    }
    try {
      return await fetch(request);
    } catch {
      return cache.match("./index.html") || Response.error();
    }
  })());
});
