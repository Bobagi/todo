// public/service-worker.js
// Estratégia: network-first para HTML e qualquer JS em /js/.
// Stale-while-revalidate para demais assets.
// Força ativação imediata + coopera com pwa.js para SKIP_WAITING.

const VERSION = "v6"; // bump quando quiser forçar update
const CACHE_NAME = "todo-cache-" + VERSION;

const CORE_URLS = [
  "/", // SPA
  "/index.html",
  "/manifest.json",
  "/style.css",
  "/neon-checkbox.css",
  "/icon.png",
  "/icon_black.png",
  // (deixe os .js de fora: trataremos via network-first dinamicamente)
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_URLS))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n.startsWith("todo-cache-") && n !== CACHE_NAME)
          .map((n) => caches.delete(n))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

function isHtml(request) {
  return (
    request.mode === "navigate" ||
    (request.headers.get("accept") || "").includes("text/html")
  );
}
function isAppScript(request) {
  const url = new URL(request.url);
  // qualquer JS da app
  return request.destination === "script" || url.pathname.startsWith("/js/");
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Não intercepta API
  if (url.pathname.startsWith("/api/")) return;

  // Network-first para HTML e scripts da app
  if (isHtml(req) || isAppScript(req)) {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req, { cache: "no-store" });
          if (fresh && fresh.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(req, fresh.clone());
          }
          return fresh;
        } catch (err) {
          const cached = await caches.match(req);
          if (cached) return cached;
          throw err;
        }
      })()
    );
    return;
  }

  // Stale-While-Revalidate para restantes
  event.respondWith(
    (async () => {
      const cached = await caches.match(req);
      const fetchPromise = fetch(req)
        .then((resp) => {
          if (resp && resp.ok) {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return resp;
        })
        .catch(() => null);
      return cached || fetchPromise || fetch(req);
    })()
  );
});
