const CACHE_NAME = "todo-cache-" + new Date().getTime();
const URLS_TO_CACHE = [
  "/",
  "/index.html",
  "/app.js",
  "/manifest.json",
  "/icon.png",
  "/favicon.ico",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(URLS_TO_CACHE))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter(
              (name) => name.startsWith("todo-cache-") && name !== CACHE_NAME
            )
            .map((name) => caches.delete(name))
        )
      )
  );
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches
      .match(event.request)
      .then((response) => response || fetch(event.request))
  );
});
