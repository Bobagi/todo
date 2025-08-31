// Estratégia: network-first para HTML/JS (pega versão nova), stale-while-revalidate p/ assets.
// Força ativação imediata + auto reload do app (cooperando com app.js).

const VERSION = "v5"; // bumpa quando quiser forçar update
const CACHE_NAME = "todo-cache-" + VERSION;

const CORE_URLS = [
  "/", // HTML SPA
  "/index.html",
  "/app.js",
  "/manifest.json",
  "/icon.png",
  "/favicon.ico",
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
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

function isHtml(request) {
  return (
    request.mode === "navigate" ||
    (request.headers.get("accept") || "").includes("text/html")
  );
}
function isCoreJs(request) {
  const url = new URL(request.url);
  return url.pathname === "/app.js";
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 🚫 Não intercepta API (evita cache indevido e 401/HTML entrando no app)
  if (url.pathname.startsWith("/api/")) return;

  // Network-first para HTML e app.js
  if (isHtml(req) || isCoreJs(req)) {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req, { cache: "no-store" });
          if (fresh.ok) {
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

  // Stale-While-Revalidate para o resto
  event.respondWith(
    (async () => {
      const cached = await caches.match(req);
      const fetchPromise = fetch(req)
        .then((resp) => {
          if (resp.ok) {
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
