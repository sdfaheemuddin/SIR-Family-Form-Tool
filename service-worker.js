const CACHE_NAME = "sir-family-forms-v26-07-07-11";
const BASE_URL = new URL("./", self.location);
const INDEX_URL = new URL("./index.html", self.location).href;

const ASSET_PATHS = [
  "./",
  "./index.html",
  "./styles.css",
  "./core.js",
  "./storage.js",
  "./ui.js",
  "./family-tree.html",
  "./family-tree.js",
  "./pdf.js",
  "./importExport.js",
  "./app.js",
  "./manifest.json",
  "./service-worker.js",
  "./icon.png",
  "./popups/person-popup.html",
  "./popups/person-popup.js",
  "./popups/person-popup.css",
  "./popups/applicant-popup.html",
  "./popups/applicant-popup.js",
  "./popups/photo-popup.html",
  "./popups/photo-popup.js",
  "./popups/file-actions/file-actions.js"
];

const ASSETS = ASSET_PATHS.map(path => new URL(path, BASE_URL).href);

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;
  event.respondWith(
    caches.match(event.request).then(cached =>
      cached || fetch(event.request).then(response => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        return response;
      }).catch(() => {
        if (event.request.mode === "navigate") return caches.match(INDEX_URL);
        return caches.match(event.request);
      })
    )
  );
});
