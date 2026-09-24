const CACHE_NAME = "silvanos-cache-v4";
const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./js/dates.js",
  "./js/firebase.js",
  "./js/store.js",
  "./js/legacy.js",
  "./js/fitness/model.js",
  "./js/fitness/analytics.js",
  "./js/fitness/charts.js",
  "./js/fitness/commands.js",
  "./js/fitness/ui.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME && k !== CDN_CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first for the app shell (so a deploy is visible immediately while
// online, e.g. no CSS/JS staying stale behind an old cached copy), falling
// back to the cache when offline. Cross-origin requests (Chart.js CDN,
// api.github.com) are left to the network as before.
// Versionierte CDN-Dateien (Firebase-SDK, Chart.js) ändern sich nie ->
// cache-first, damit die App auch offline startet. Firestore-/Auth-
// Netzwerkaufrufe laufen NICHT durch den Service Worker.
const CDN_CACHE = "silvanos-cdn-v1";
const CDN_HOSTS = ["www.gstatic.com", "cdn.jsdelivr.net", "fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("fetch", event => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method === "GET" && CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.open(CDN_CACHE).then(cache =>
        cache.match(req).then(hit => hit || fetch(req).then(res => {
          if (res && (res.status === 200 || res.type === "opaque")) cache.put(req, res.clone());
          return res;
        }))
      )
    );
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(req)
        .then(res => {
          if (res && res.status === 200) {
            const resClone = res.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(req, resClone));
          }
          return res;
        })
        .catch(() => caches.match(req))
    );
  }
});
