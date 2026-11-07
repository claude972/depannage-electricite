/* Public offline notice and explicit local note form only. Never cache an account, API,
 * Auth, RSC, photos or mutation; no runtime writes, background sync or submission queue. */
const PUBLIC_CACHE_PREFIX = "courant-pwa-public-";
// A generation is immutable and may be created only once. Bump it whenever this worker
// or any of the three public assets changes; a reused generation fails closed.
const PUBLIC_CACHE = `${PUBLIC_CACHE_PREFIX}v5`;
const OFFLINE_URL = "/offline.html";
const FORM_URL = "/offline-request.html";
const SCRIPT_URL = "/offline-request.js";
const ASSETS = [
  { path: OFFLINE_URL, marker: "X-Courant-Public-Offline", type: "text/html" },
  { path: FORM_URL, marker: "X-Courant-Public-Request", type: "text/html" },
  { path: SCRIPT_URL, marker: "X-Courant-Public-Draft-Script", type: "application/javascript" },
];
function validAsset(response, asset) {
  return response && response.status === 200 && !response.redirected && response.url === new URL(asset.path, self.location.origin).href && response.headers.get(asset.marker) === "1" && response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() === asset.type;
}
async function cachedAsset(path) {
  const asset = ASSETS.find(asset => asset.path === path);
  // CacheStorage.match never creates a missing cache while an installer is preparing assets.
  const response = await caches.match(path, { cacheName: PUBLIC_CACHE });
  return validAsset(response, asset) ? response : null;
}
self.addEventListener("install", event => {
  event.waitUntil((async () => {
    // Never overwrite an active generation or a partial orphan of an earlier failed install.
    if ((await caches.keys()).includes(PUBLIC_CACHE)) throw new Error("Public offline cache generation already exists; version bump required");
    // Fetch and validate ALL responses before opening or writing the new cache.
    const responses = await Promise.all(ASSETS.map(async asset => {
      const response = await fetch(new Request(asset.path, { cache: "reload", credentials: "same-origin", redirect: "error" }));
      if (!validAsset(response, asset)) throw new Error("Public offline asset unavailable");
      return response;
    }));
    // Re-check after network awaits. Reads of the active worker cannot create this cache.
    if ((await caches.keys()).includes(PUBLIC_CACHE)) throw new Error("Public offline cache generation already exists; version bump required");
    let created = false;
    try {
      const cache = await caches.open(PUBLIC_CACHE);
      created = true;
      for (let i = 0; i < ASSETS.length; i++) await cache.put(ASSETS[i].path, responses[i]);
    } catch (error) {
      // Only this newly-created, not-yet-installed generation may be rolled back.
      if (created) try { await caches.delete(PUBLIC_CACHE); } catch {}
      throw error;
    }
  })());
  // The installed update waits for explicit acceptance or old tabs closing.
});
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    // A cache write may have failed, or storage may have been evicted after install.
    // Never claim clients or delete the old working cache for a partial installation.
    for (const asset of ASSETS) if (!(await cachedAsset(asset.path))) throw new Error("Public offline cache incomplete");
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(PUBLIC_CACHE_PREFIX) && key !== PUBLIC_CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener("message", event => {
  if (event.data?.type === "ACTIVATE_UPDATE") event.waitUntil(self.skipWaiting());
});
function unavailable() {
  return new Response("Connexion indisponible. Reconnectez-vous pour retrouver vos dossiers.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
self.addEventListener("fetch", event => {
  const { request } = event, url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname === "/api" || url.pathname.startsWith("/api/") || url.pathname === "/auth" || url.pathname.startsWith("/auth/") || url.searchParams.has("_rsc") || request.headers?.get("RSC") === "1" || request.headers?.has("Next-Router-State-Tree")) return;
  const script = url.pathname === SCRIPT_URL && !url.search && request.destination === "script";
  if (request.mode !== "navigate" && !script) return;
  event.respondWith((async () => {
    try {
      // Network responses are NEVER stored. Only install writes the three static assets.
      const response = await fetch(request, { cache: "no-store" });
      if (script && !validAsset(response, ASSETS[2])) throw new Error("Public script unavailable");
      return response;
    } catch {
      try { return (await cachedAsset(script ? SCRIPT_URL : url.pathname === FORM_URL && !url.search ? FORM_URL : OFFLINE_URL)) || unavailable(); }
      catch { return unavailable(); }
    }
  })());
});
