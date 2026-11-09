import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import manifest from "../app/manifest";
import { observePwaInstallation, requestPwaUpdate } from "../components/pwa-registration";

const workerSource = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
const origin = "https://courant.example";

type RequestLike = { url: string; method: string; mode: string; destination?: string; headers?: Headers };
type WorkerEvent = {
  request?: RequestLike;
  data?: unknown;
  notification?: { tag: string; close(): void };
  ports?: { postMessage(value: unknown): void }[];
  waitUntil: (value: Promise<unknown>) => void;
  respondWith: (value: Promise<Response>) => void;
};

function workerHarness() {
  const listeners = new Map<string, (event: WorkerEvent) => void>();
  const stores = new Map<string, Map<string, Response>>();
  const fetched: { url: string; cache?: string; credentials?: string; redirect?: string }[] = [];
  type AssetResponse = { url?: string; redirected?: boolean; marker?: string | null; contentType?: string; status?: number };
  const assetResponses: Record<string, AssetResponse> = {};
  let putFailure: number | undefined, puts = 0, deleteFailure = false;
  let disconnected = false;
  let fetchGate: Promise<void> | undefined;
  let cacheReadFailure: "storage" | "match" | undefined;
  let claims = 0;
  let activations = 0;
  const notices: { title: string; body: string; tag: string }[] = [];
  const opened: string[] = [];
  const windows: { url: string; focus(): Promise<void> }[] = [];
  let html = "<main>public notice</main>";
  class BrowserRequest extends Request {
    constructor(input: string | URL | Request, init?: RequestInit) {
      super(typeof input === "string" ? new URL(input, origin) : input, init);
    }
  }
  runInNewContext(workerSource, {
    URL,
    Request: BrowserRequest,
    Response,
    self: {
      location: { origin },
      addEventListener: (name: string, listener: (event: WorkerEvent) => void) => listeners.set(name, listener),
      clients: {
        claim: async () => { claims += 1; },
        matchAll: async () => windows,
        openWindow: async (url: string) => { opened.push(url); },
      },
      registration: { showNotification: async (title: string, { body, tag }: { body: string; tag: string }) => { notices.push({ title, body, tag }); } },
      skipWaiting: async () => { activations += 1; },
    },
    caches: {
      keys: async () => [...stores.keys()],
      match: async (url: string, options: { cacheName: string }) => {
        if (cacheReadFailure) throw Error("CacheStorage read failed");
        return stores.get(options.cacheName)?.get(url)?.clone();
      },
      delete: async (key: string) => { if (deleteFailure) throw Error("Cache deletion unavailable"); return stores.delete(key); },
      open: async (key: string) => {
        if (cacheReadFailure === "storage") throw new Error("Storage unavailable");
        if (!stores.has(key)) stores.set(key, new Map());
        return {
          put: async (url: string, response: Response) => { puts++; stores.get(key)!.set(url, response.clone()); if (puts === putFailure) throw Error("Cache write failed"); },
          match: async (url: string) => {
            if (cacheReadFailure === "match") throw new Error("Cache read failed");
            return stores.get(key)!.get(url)?.clone();
          },
        };
      },
    },
    fetch: async (input: RequestLike, init?: RequestInit) => {
      fetched.push({ url: input.url, cache: init?.cache ?? (input as Request).cache, credentials: (input as Request).credentials, redirect: (input as Request).redirect });
      if (fetchGate) await fetchGate;
      if (disconnected) throw new TypeError("Network unavailable");
      const pathname = new URL(input.url).pathname;
      const assets: Record<string, { marker: string; type: string; body: string }> = {
        "/offline.html": { marker: "X-Courant-Public-Offline", type: "text/html; charset=utf-8", body: "<main>public notice</main>" },
        "/offline-request.html": { marker: "X-Courant-Public-Request", type: "text/html; charset=utf-8", body: "<main>public draft form</main>" },
        "/offline-request.js": { marker: "X-Courant-Public-Draft-Script", type: "application/javascript; charset=utf-8", body: "/* public draft script */" },
      };
      const asset = assets[pathname], override = assetResponses[pathname] ?? {};
      const headers = new Headers({ "Content-Type": override.contentType ?? asset?.type ?? "text/html; charset=utf-8" });
      if (asset && override.marker !== null) headers.set(asset.marker, override.marker ?? "1");
      const preserve = (response: Response): Response => {
        Object.defineProperty(response, "url", { value: override.url ?? input.url });
        Object.defineProperty(response, "redirected", { value: override.redirected ?? false });
        Object.defineProperty(response, "clone", { value: () => preserve(Response.prototype.clone.call(response)) });
        return response;
      };
      const response = preserve(new Response(asset?.body ?? html, { status: override.status ?? 200, headers }));
      return response;
    },
  });
  function emit(name: string, extra: Partial<WorkerEvent> = {}) {
    const waits: Promise<unknown>[] = [];
    let response: Promise<Response> | undefined;
    listeners.get(name)?.({
      ...extra,
      waitUntil: (value) => waits.push(value),
      respondWith: (value) => { response = value; },
    });
    return { waits, response };
  }
  function navigate(path: string, overrides: Partial<RequestLike> = {}) {
    return emit("fetch", {
      request: { url: new URL(path, origin).href, method: "GET", mode: "navigate", ...overrides },
    });
  }
  return {
    emit, navigate, stores, fetched, notices, opened, windows,
    setOffline: () => { disconnected = true; },
    failCacheReadAt: (point: typeof cacheReadFailure) => { cacheReadFailure = point; },
    setHtml: (value: string) => { html = value; },
    setNoticeResponse: (value: AssetResponse) => { assetResponses["/offline.html"] = value; },
    setAssetResponse: (asset: string, value: AssetResponse) => { assetResponses[asset] = value; },
    failPut: (at: number, failDelete = false) => { putFailure = at; deleteFailure = failDelete; },
    holdFetch: () => { let release!: () => void; fetchGate = new Promise<void>(resolve => { release = resolve; }); return release; },
    claims: () => claims,
    activations: () => activations,
  };
}

test("PWA manifest uses local installable icons with real declared PNG dimensions", async () => {
  const data = manifest();
  assert.equal(data.display, "standalone");
  assert.equal(data.start_url, "/");
  assert.equal(data.scope, "/");
  assert.equal(data.lang, "fr");
  assert.ok(data.icons?.some((icon) => icon.purpose === "maskable"));
  for (const icon of data.icons ?? []) {
    assert.ok(icon.src.startsWith("/icons/"));
    const bytes = await readFile(new URL(`../public${icon.src}`, import.meta.url));
    assert.deepEqual(bytes.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    assert.equal(`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`, icon.sizes);
  }
  const apple = await readFile(new URL("../public/icons/apple-touch-icon.png", import.meta.url));
  assert.equal(apple.readUInt32BE(16), 180);
  assert.equal(apple.readUInt32BE(20), 180);
});

test("worker installs exactly three validated public assets using same-origin access without immediate update", async () => {
  const h = workerHarness();
  await Promise.all(h.emit("install").waits);
  assert.equal(h.fetched.length, 3);
  assert.equal(h.fetched[0].url, `${origin}/offline.html`);
  assert.equal(h.fetched[0].credentials, "same-origin");
  assert.equal(h.fetched[0].redirect, "error");
  assert.equal(h.activations(), 0);
  assert.deepEqual([...h.stores.values()].flatMap((store) => [...store.keys()]), ["/offline.html", "/offline-request.html", "/offline-request.js"]);
});

test("online private navigation goes to the network no-store and never writes its response into caches", async () => {
  const h = workerHarness();
  await Promise.all(h.emit("install").waits);
  h.setHtml("<main>private dossier client A</main>");
  const event = h.navigate("/?intervention=secret");
  assert.equal(await (await event.response!).text(), "<main>private dossier client A</main>");
  assert.equal(h.fetched.at(-1)?.cache, "no-store");
  assert.deepEqual([...h.stores.values()].flatMap((store) => [...store.keys()]), ["/offline.html", "/offline-request.html", "/offline-request.js"]);
  h.setOffline();
  const offline = await h.navigate("/?intervention=secret").response!;
  assert.equal(await offline.text(), "<main>public notice</main>");
});

test("worker never intercepts API, auth, RSC, external or mutation requests", () => {
  const h = workerHarness();
  for (const path of ["/api", "/api/workspace", "/api/payments/checkout", "/auth", "/auth/confirm"]) {
    assert.equal(h.navigate(path).response, undefined, path);
  }
  assert.equal(h.navigate("/?_rsc=state", { mode: "cors" }).response, undefined);
  assert.equal(h.navigate("/api/messages", { method: "POST" }).response, undefined);
  assert.equal(h.navigate("https://checkout.stripe.com/c/pay/test").response, undefined);
  assert.equal(h.fetched.length, 0);
  assert.equal(h.stores.size, 0);
});

test("missing offline cache returns a generic 503 with no private account content", async () => {
  const h = workerHarness();
  h.setOffline();
  const response = await h.navigate("/private").response!;
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.match(await response.text(), /Connexion indisponible/);
});

for (const point of ["storage", "match"] as const) {
  test(`offline navigation still returns a neutral no-store 503 when cache ${point} fails`, async () => {
    const h = workerHarness();
    await Promise.all(h.emit("install").waits);
    h.setHtml("<main>private dossier client A</main>");
    h.setOffline();
    h.failCacheReadAt(point);
    const response = await h.navigate("/private?intervention=secret").response!;
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("Content-Type"), "text/plain; charset=utf-8");
    assert.equal(await response.text(), "Connexion indisponible. Reconnectez-vous pour retrouver vos dossiers.");
    assert.deepEqual([...h.stores.values()].flatMap((store) => [...store.keys()]), ["/offline.html", "/offline-request.html", "/offline-request.js"]);
  });
}

test("activation only removes obsolete Courant public caches and claims clients", async () => {
  const h = workerHarness();
  await Promise.all(h.emit("install").waits);
  h.stores.set("courant-pwa-public-v0", new Map());
  h.stores.set("another-application", new Map());
  await Promise.all(h.emit("activate").waits);
  assert.equal(h.stores.has("courant-pwa-public-v0"), false);
  assert.equal(h.stores.has("another-application"), true);
  assert.equal(h.stores.has("courant-pwa-public-v7"), true);
  assert.equal(h.claims(), 1);
});

test("a worker update activates only on the explicit update message", async () => {
  const h = workerHarness();
  await Promise.all(h.emit("message", { data: { type: "UNRELATED" } }).waits);
  assert.equal(h.activations(), 0);
  await Promise.all(h.emit("message", { data: { type: "ACTIVATE_UPDATE" } }).waits);
  assert.equal(h.activations(), 1);
});

test("the push-capable worker acknowledges readiness and displays only a fixed private notice", async () => {
  const h = workerHarness();
  let answer: unknown;
  h.emit("message", { data: { type: "CHECK_PRIVATE_PUSH" }, ports: [{ postMessage: value => { answer = value; } }] });
  assert.equal(JSON.stringify(answer), '{"type":"PRIVATE_PUSH_READY"}');
  assert.equal(h.emit("push", { data: { json: () => { throw Error("Invalid payload"); } } }).waits.length, 0);
  assert.equal(h.emit("push", { data: { json: () => ({ type: "other" }) } }).waits.length, 0);
  await Promise.all(h.emit("push", { data: { json: () => ({ type: "private-notice-v1", body: "private address", url: "https://other.example" }) } }).waits);
  assert.deepEqual(h.notices, [{ title: "Une notification est disponible", body: "Connectez-vous à votre espace pour la consulter.", tag: "private-notice-v1" }]);
  assert.equal(h.fetched.length, 0);
});

test("notification click opens or focuses only the authenticated notifications entry point", async () => {
  const h = workerHarness();
  let closed = 0, focused = 0;
  const notification = { tag: "private-notice-v1", close: () => { closed++; } };
  await Promise.all(h.emit("notificationclick", { notification }).waits);
  assert.deepEqual(h.opened, [`${origin}/#notifications`]);
  h.windows.push({ url: `${origin}/#notifications`, focus: async () => { focused++; } });
  await Promise.all(h.emit("notificationclick", { notification }).waits);
  assert.equal(h.opened.length, 1);
  assert.equal(focused, 1);
  assert.equal(closed, 2);
});

test("a failed public notice download rejects installation instead of caching an application page", async () => {
  const h = workerHarness();
  h.setOffline();
  await assert.rejects(Promise.all(h.emit("install").waits), /Network unavailable/);
  assert.equal(h.stores.size, 0);
  assert.equal(h.activations(), 0);
});


test("explicit reload still works after a different tab activated or superseded the waiting worker", () => {
  let reloads = 0;
  const messages: unknown[] = [];
  const worker = {
    state: "installed" as ServiceWorkerState,
    postMessage: (message: unknown) => { messages.push(message); },
  };
  requestPwaUpdate(worker, null, () => { reloads += 1; });
  assert.deepEqual(messages, [{ type: "ACTIVATE_UPDATE" }]);
  assert.equal(reloads, 0);
  // Another tab accepts the update first. This tab keeps its form until its user clicks.
  worker.state = "activated";
  requestPwaUpdate(worker, worker as ServiceWorker, () => { reloads += 1; });
  assert.equal(reloads, 1);
  assert.equal(messages.length, 1, "no message sent to an already-active worker");
  worker.state = "redundant";
  requestPwaUpdate(worker, null, () => { reloads += 1; });
  assert.equal(reloads, 2);
  assert.equal(messages.length, 1, "no stuck activation request to a superseded worker");
});


test("worker refuses an SSO/login redirect instead of caching protected-preview login HTML", async () => {
  const h = workerHarness();
  h.setNoticeResponse({ redirected: true, url: `${origin}/offline.html` });
  await assert.rejects(Promise.all(h.emit("install").waits), /Public offline asset unavailable/);
  assert.equal(h.stores.size, 0);
});

test("worker refuses wrong origin/path/query notice URLs even when an HTML marker is present", async () => {
  for (const url of ["https://login.example/offline.html", `${origin}/login`, `${origin}/offline.html?token=private`, ""]) {
    const h = workerHarness();
    h.setNoticeResponse({ url });
    await assert.rejects(Promise.all(h.emit("install").waits), /Public offline asset unavailable/, url);
    assert.equal(h.stores.size, 0);
  }
});

test("worker refuses unmarked, unsuccessful or non-HTML responses before opening cache", async () => {
  for (const response of [{ marker: null }, { marker: "0" }, { status: 403 }, { contentType: "application/json" }]) {
    const h = workerHarness();
    h.setNoticeResponse(response);
    await assert.rejects(Promise.all(h.emit("install").waits), /Public offline asset unavailable/);
    assert.equal(h.stores.size, 0);
  }
});

class InstallingWorker extends EventTarget {
  state: ServiceWorkerState = "installing";
  change(state: ServiceWorkerState) {
    this.state = state;
    this.dispatchEvent(new Event("statechange"));
  }
}

test("redundant initial installation surfaces failure even though register already resolved", () => {
  const worker = new InstallingWorker();
  let installed = 0, failed = 0;
  const stop = observePwaInstallation(worker as unknown as ServiceWorker, () => { installed += 1; }, () => { failed += 1; });
  assert.equal(installed, 0);
  assert.equal(failed, 0);
  worker.change("redundant");
  assert.equal(failed, 1);
  assert.equal(installed, 0);
  stop();
  worker.change("installed");
  assert.equal(installed, 0, "unmounted observer removes its listener");
  const alreadyFailed = new InstallingWorker();
  alreadyFailed.state = "redundant";
  observePwaInstallation(alreadyFailed as unknown as ServiceWorker, () => {}, () => { failed += 1; })();
  assert.equal(failed, 2, "fast failure preceding observer attachment is still surfaced");
});

test("a successfully installed worker becoming obsolete is not misreported as an install failure", () => {
  const worker = new InstallingWorker();
  let installed = 0, failed = 0;
  const stop = observePwaInstallation(worker as unknown as ServiceWorker, () => { installed += 1; }, () => { failed += 1; });
  worker.change("installed");
  assert.equal(installed, 1);
  worker.change("activated");
  worker.change("redundant");
  assert.equal(failed, 0);
  stop();
});

test("all three install responses are validated before ANY cache write; malformed or missing form/script keeps the old cache", async () => {
  for (const asset of ["/offline.html", "/offline-request.html", "/offline-request.js"]) for (const response of [{ marker: null }, { redirected: true }, { url: `${origin}${asset}?private=1` }, { contentType: "application/json" }, { status: 404 }, { status: 206 }]) {
    const h = workerHarness(); h.stores.set("courant-pwa-public-v5", new Map()); h.setAssetResponse(asset, response);
    await assert.rejects(Promise.all(h.emit("install").waits), /Public offline asset unavailable/);
    assert.deepEqual([...h.stores.keys()], ["courant-pwa-public-v5"]); assert.equal(h.claims(), 0); assert.equal(h.activations(), 0);
  }
});
test("a put failure rolls back the partial new cache; even failed rollback never activates or claims partial assets", async () => {
  for (const failedRollback of [false, true]) {
    const h = workerHarness(); h.stores.set("courant-pwa-public-v5", new Map()); h.failPut(2, failedRollback);
    await assert.rejects(Promise.all(h.emit("install").waits), /Cache write failed/);
    assert.equal(h.stores.has("courant-pwa-public-v5"), true); if (!failedRollback) assert.equal(h.stores.has("courant-pwa-public-v7"), false);
    await assert.rejects(Promise.all(h.emit("activate").waits), /Public offline cache incomplete/);
    assert.equal(h.claims(), 0); assert.equal(h.activations(), 0); assert.equal(h.stores.has("courant-pwa-public-v5"), true);
  }
});
test("activation revalidates every asset after eviction, preserving the previous worker cache", async () => {
  const h = workerHarness(); await Promise.all(h.emit("install").waits); h.stores.set("courant-pwa-public-v5", new Map()); h.stores.get("courant-pwa-public-v7")!.delete("/offline-request.js");
  await assert.rejects(Promise.all(h.emit("activate").waits), /Public offline cache incomplete/); assert.equal(h.claims(), 0); assert.equal(h.stores.has("courant-pwa-public-v5"), true);
});
test("offline form navigation and exact public module script are served from cache; private and RSC requests remain bypassed", async () => {
  const h = workerHarness(); await Promise.all(h.emit("install").waits); h.setOffline();
  assert.equal(await (await h.navigate("/offline-request.html").response!).text(), "<main>public draft form</main>");
  assert.equal(await (await h.navigate("/offline-request.js", { mode: "cors", destination: "script" }).response!).text(), "/* public draft script */");
  for (const [url, overrides] of [
    ["/offline-request.js?token=private", { mode: "cors", destination: "script" }],
    ["/other.js", { mode: "cors", destination: "script" }],
    ["/offline-request.js", { mode: "cors", destination: "image" }],
    ["/offline-request.html?_rsc=private", {}],
    ["/offline-request.html", { headers: new Headers({ RSC: "1" }) }],
    ["/offline-request.html", { headers: new Headers({ "Next-Router-State-Tree": "private" }) }],
    ["/offline-request.html", { method: "POST" }],
  ] as [string, Partial<RequestLike>][]) assert.equal(h.navigate(url, overrides).response, undefined, url);
  assert.equal(await (await h.navigate("/offline-request.html?dossier=private").response!).text(), "<main>public notice</main>");
  assert.deepEqual([...h.stores.values()].flatMap(s => [...s.keys()]), ["/offline.html", "/offline-request.html", "/offline-request.js"]);
});
test("new public routes receive isolated markers, no-store and restrictive offline form CSP", async () => {
  const { default: config } = await import("../next.config"); const routes = await config.headers!();
  const form = routes.find(route => route.source === "/offline-request.html")!, script = routes.find(route => route.source === "/offline-request.js")!;
  assert.ok(form && script); const headers = Object.fromEntries(form.headers.map(h => [h.key, h.value]));
  assert.equal(headers["X-Courant-Public-Request"], "1"); assert.equal(headers["Cache-Control"], "no-store");
  for (const rule of ["default-src 'none'", "script-src 'self'", "connect-src 'none'", "form-action 'none'", "base-uri 'none'"]) assert.ok(headers["Content-Security-Policy"].includes(rule));
  assert.ok(script.headers.some(h => h.key === "X-Courant-Public-Draft-Script" && h.value === "1"));
});

async function cacheBits(store: Map<string, Response> | undefined) {
  if (!store) return null;
  return Promise.all([...store.entries()].map(async ([key, response]) => ({ key, status: response.status, url: response.url, headers: [...response.headers.entries()], body: await response.clone().text() })));
}
test("a reused active v5 generation is immutable even when a new install would fail its first put", async () => {
  const h = workerHarness(); await Promise.all(h.emit("install").waits); await Promise.all(h.emit("activate").waits);
  const before = await cacheBits(h.stores.get("courant-pwa-public-v7")); const requests = h.fetched.length;
  h.failPut(4); // Old implementation wrote into the active v5 and then deleted it on failure.
  await assert.rejects(Promise.all(h.emit("install").waits), /generation already exists; version bump required/);
  assert.deepEqual(await cacheBits(h.stores.get("courant-pwa-public-v7")), before);
  assert.equal(h.fetched.length, requests, "a reused generation is refused before even fetching replacement assets"); assert.equal(h.claims(), 1); assert.equal(h.activations(), 0);
});
test("a partial orphan generation is preserved and refused, never repaired in place or claimed", async () => {
  const h = workerHarness(); await Promise.all(h.emit("install").waits); h.stores.get("courant-pwa-public-v7")!.delete("/offline-request.js");
  h.stores.set("courant-pwa-public-v5", new Map()); const before = await cacheBits(h.stores.get("courant-pwa-public-v7"));
  await assert.rejects(Promise.all(h.emit("install").waits), /generation already exists/);
  assert.deepEqual(await cacheBits(h.stores.get("courant-pwa-public-v7")), before);
  await assert.rejects(Promise.all(h.emit("activate").waits), /Public offline cache incomplete/); assert.equal(h.claims(), 0); assert.equal(h.stores.has("courant-pwa-public-v5"), true);
});
test("the old active generation stays byte-identical while every new public asset is in flight and after install", async () => {
  const h = workerHarness(); const old = new Map([
    ["/offline.html", new Response("old public notice", { headers: { "X-Courant-Public-Offline": "1" } })],
    ["/offline-request.html", new Response("old public form")], ["/offline-request.js", new Response("old public script")],
  ]); h.stores.set("courant-pwa-public-v5", old); const before = await cacheBits(old); const release = h.holdFetch();
  const install = Promise.all(h.emit("install").waits); await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(h.fetched.length, 3); assert.equal(h.stores.has("courant-pwa-public-v7"), false); assert.deepEqual(await cacheBits(old), before);
  release(); await install; assert.deepEqual(await cacheBits(old), before); assert.equal(h.stores.get("courant-pwa-public-v7")!.size, 3);
  await Promise.all(h.emit("activate").waits); assert.equal(h.claims(), 1); assert.equal(h.stores.has("courant-pwa-public-v5"), false);
});
test("missing-cache offline reads never create an orphan cache that could collide with an installer", async () => {
  const h = workerHarness(); h.setOffline(); assert.equal((await h.navigate("/private").response!).status, 503); assert.equal(h.stores.size, 0);
});
