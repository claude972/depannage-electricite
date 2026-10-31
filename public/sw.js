/* Courant PWA: a public offline notice, never an offline copy of a user account.
 * Registration/worker conventions: https://nextjs.org/docs/app/guides/progressive-web-apps
 * Deliberately no runtime cache, background sync, push handler or request queue.
 */
const PUBLIC_CACHE_PREFIX = "courant-pwa-public-";
const PUBLIC_CACHE = `${PUBLIC_CACHE_PREFIX}v2`;
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const response = await fetch(
        new Request(OFFLINE_URL, { cache: "reload", credentials: "same-origin", redirect: "error" }),
      );
      // A preview protection cookie may be needed to reach this static asset.
      // Never cache an SSO/login redirect, authenticated page or URL with query data.
      const expectedUrl = new URL(OFFLINE_URL, self.location.origin).href;
      if (
        !response.ok ||
        response.redirected ||
        response.url !== expectedUrl ||
        response.headers.get("X-Courant-Public-Offline") !== "1" ||
        !response.headers.get("content-type")?.includes("text/html")
      ) {
        throw new Error("Public offline notice unavailable");
      }
      const cache = await caches.open(PUBLIC_CACHE);
      await cache.put(OFFLINE_URL, response);
    })(),
  );
  // A new worker waits until the user accepts its update or closes old tabs.
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith(PUBLIC_CACHE_PREFIX) && key !== PUBLIC_CACHE)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "ACTIVATE_UPDATE") {
    event.waitUntil(self.skipWaiting());
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  // Do not intercept APIs, auth, RSC/data requests, mutations or other origins.
  if (
    request.method !== "GET" ||
    request.mode !== "navigate" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/") ||
    url.pathname === "/api" ||
    url.pathname.startsWith("/auth/") ||
    url.pathname === "/auth"
  ) {
    return;
  }

  event.respondWith(
    (async () => {
      try {
        // The network response is returned directly and never put in CacheStorage.
        return await fetch(request, { cache: "no-store" });
      } catch {
        const cache = await caches.open(PUBLIC_CACHE);
        const offline = await cache.match(OFFLINE_URL);
        if (offline) return offline;
        return new Response("Connexion indisponible. Reconnectez-vous pour retrouver vos dossiers.", {
          status: 503,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-store",
          },
        });
      }
    })(),
  );
});
