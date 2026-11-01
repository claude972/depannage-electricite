import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import manifest from "../app/manifest";
import { observePwaInstallation, requestPwaUpdate } from "../components/pwa-registration";

const workerSource = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
const origin = "https://courant.example";

type RequestLike = { url: string; method: string; mode: string };
type WorkerEvent = {
  request?: RequestLike;
  data?: unknown;
  waitUntil: (value: Promise<unknown>) => void;
  respondWith: (value: Promise<Response>) => void;
};

function workerHarness() {
  const listeners = new Map<string, (event: WorkerEvent) => void>();
  const stores = new Map<string, Map<string, Response>>();
  const fetched: { url: string; cache?: string; credentials?: string; redirect?: string }[] = [];
  let noticeResponse: { url?: string; redirected?: boolean; marker?: string | null; contentType?: string; status?: number } = {};
  let disconnected = false;
  let cacheReadFailure: "open" | "match" | undefined;
  let claims = 0;
  let activations = 0;
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
      clients: { claim: async () => { claims += 1; } },
      skipWaiting: async () => { activations += 1; },
    },
    caches: {
      keys: async () => [...stores.keys()],
      delete: async (key: string) => stores.delete(key),
      open: async (key: string) => {
        if (cacheReadFailure === "open") throw new Error("Storage unavailable");
        if (!stores.has(key)) stores.set(key, new Map());
        return {
          put: async (url: string, response: Response) => stores.get(key)!.set(url, response.clone()),
          match: async (url: string) => {
            if (cacheReadFailure === "match") throw new Error("Cache read failed");
            return stores.get(key)!.get(url)?.clone();
          },
        };
      },
    },
    fetch: async (input: RequestLike, init?: RequestInit) => {
      fetched.push({ url: input.url, cache: init?.cache ?? (input as Request).cache, credentials: (input as Request).credentials, redirect: (input as Request).redirect });
      if (disconnected) throw new TypeError("Network unavailable");
      const notice = new URL(input.url).pathname === "/offline.html";
      const headers = new Headers({ "Content-Type": notice ? noticeResponse.contentType ?? "text/html; charset=utf-8" : "text/html; charset=utf-8" });
      if (notice && noticeResponse.marker !== null) headers.set("X-Courant-Public-Offline", noticeResponse.marker ?? "1");
      const response = new Response(html, { status: notice ? noticeResponse.status ?? 200 : 200, headers });
      Object.defineProperty(response, "url", { value: notice ? noticeResponse.url ?? input.url : input.url });
      Object.defineProperty(response, "redirected", { value: notice ? noticeResponse.redirected ?? false : false });
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
    emit, navigate, stores, fetched,
    setOffline: () => { disconnected = true; },
    failCacheReadAt: (point: typeof cacheReadFailure) => { cacheReadFailure = point; },
    setHtml: (value: string) => { html = value; },
    setNoticeResponse: (value: typeof noticeResponse) => { noticeResponse = value; },
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

test("worker installs only marked static notice using same-origin access without immediate update", async () => {
  const h = workerHarness();
  await Promise.all(h.emit("install").waits);
  assert.equal(h.fetched.length, 1);
  assert.equal(h.fetched[0].url, `${origin}/offline.html`);
  assert.equal(h.fetched[0].credentials, "same-origin");
  assert.equal(h.fetched[0].redirect, "error");
  assert.equal(h.activations(), 0);
  assert.deepEqual([...h.stores.values()].flatMap((store) => [...store.keys()]), ["/offline.html"]);
});

test("online private navigation goes to the network no-store and never writes its response into caches", async () => {
  const h = workerHarness();
  await Promise.all(h.emit("install").waits);
  h.setHtml("<main>private dossier client A</main>");
  const event = h.navigate("/?intervention=secret");
  assert.equal(await (await event.response!).text(), "<main>private dossier client A</main>");
  assert.equal(h.fetched.at(-1)?.cache, "no-store");
  assert.deepEqual([...h.stores.values()].flatMap((store) => [...store.keys()]), ["/offline.html"]);
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

for (const point of ["open", "match"] as const) {
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
    assert.deepEqual([...h.stores.values()].flatMap((store) => [...store.keys()]), ["/offline.html"]);
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
  assert.equal(h.stores.has("courant-pwa-public-v3"), true);
  assert.equal(h.claims(), 1);
});

test("a worker update activates only on the explicit update message", async () => {
  const h = workerHarness();
  await Promise.all(h.emit("message", { data: { type: "UNRELATED" } }).waits);
  assert.equal(h.activations(), 0);
  await Promise.all(h.emit("message", { data: { type: "ACTIVATE_UPDATE" } }).waits);
  assert.equal(h.activations(), 1);
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
  await assert.rejects(Promise.all(h.emit("install").waits), /Public offline notice unavailable/);
  assert.equal(h.stores.size, 0);
});

test("worker refuses wrong origin/path/query notice URLs even when an HTML marker is present", async () => {
  for (const url of ["https://login.example/offline.html", `${origin}/login`, `${origin}/offline.html?token=private`, ""]) {
    const h = workerHarness();
    h.setNoticeResponse({ url });
    await assert.rejects(Promise.all(h.emit("install").waits), /Public offline notice unavailable/, url);
    assert.equal(h.stores.size, 0);
  }
});

test("worker refuses unmarked, unsuccessful or non-HTML responses before opening cache", async () => {
  for (const response of [{ marker: null }, { marker: "0" }, { status: 403 }, { contentType: "application/json" }]) {
    const h = workerHarness();
    h.setNoticeResponse(response);
    await assert.rejects(Promise.all(h.emit("install").waits), /Public offline notice unavailable/);
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
