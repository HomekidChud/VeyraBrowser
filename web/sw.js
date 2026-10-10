const CACHE = "veyra-browser-shell-v8.28.18";
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./styles/style.css?v=8.28.18", "./src/bootstrap.js?v=8.28.18"];

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
        if (response.ok) cache.put(request, response.clone());
        return response;
      }).catch(() => cached);
      return cached || network;
    }
    try {
      return await fetch(request);
    } catch {
      return cache.match("./index.html") || Response.error();
    }
  })());
});
