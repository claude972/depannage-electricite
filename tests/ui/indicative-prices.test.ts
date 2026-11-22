// PUB-02 / ADM-08 indicative prices (mirror of 8a2f9b6 handler): strict public view (version / source
// coherence), display rule (fallback, never a number, never « garanti »), admin staging view + receipt,
// euro inputs → cents, staging command fenced under courant-private-indicative-prices:<uid>:<gen>
// (read-back or 0 POST, re-read after success / uncertain / 409, same command on retry), mounts.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadModule } from "../documents/harness";
import type * as Model from "../../components/features/indicative-prices/model";
import type * as Admin from "../../components/features/indicative-prices/admin-model";

const m = loadModule("components/features/indicative-prices/model.ts") as unknown as typeof Model;
const a = loadModule("components/features/indicative-prices/admin-model.ts") as unknown as typeof Admin;
const R = { outage: { min_cents: 15000, max_cents: 25000 }, panel: { min_cents: 15000, max_cents: 35000 }, socket: { min_cents: 8000, max_cents: 18000 }, lighting: { min_cents: 8000, max_cents: 20000 }, diagnostic: { min_cents: 12000, max_cents: 28000 } };
export const V1 = { version: 1, currency: "eur", ranges: R, indicative: true, publication_available: false, source: "existing_baseline" };

test("lecture publique stricte : version ⇔ source, cinq fourchettes exactes, toujours indicative", () => {
  assert.ok(m.parsePrices(V1));
  assert.ok(m.parsePrices({ ...V1, version: 3, source: "operator_version" }));
  assert.equal(m.parsePrices({ ...V1, version: 2 }), null, "v2 must be operator_version");
  assert.equal(m.parsePrices({ ...V1, source: "operator_version" }), null);
  assert.equal(m.parsePrices({ ...V1, indicative: false }), null);
  assert.equal(m.parsePrices({ ...V1, publication_available: true }), null);
  assert.equal(m.parsePrices({ ...V1, ranges: { ...R, socket: { min_cents: 9000, max_cents: 8000 } } }), null);
  assert.equal(m.parsePrices({ ...V1, ranges: { ...R, extra: R.socket } }), null);
  assert.equal(m.parsePrices({ ...V1, extra: 1 }), null);
});

test("affichage : fourchette du serveur une fois lue ; sinon libellé honnête, jamais un nombre ; jamais « garanti »", () => {
  assert.equal(m.displayFor({ phase: "ready", data: m.parsePrices(V1) }, "socket").replace(/\s/g, " "), "80 € – 180 €");
  assert.equal(m.displayFor({ phase: "loading", data: null }, "socket"), m.COPY.loading);
  assert.equal(m.displayFor({ phase: "error", data: null }, "socket"), m.COPY.failed);
  for (const t of [m.COPY.loading, m.COPY.failed]) assert.doesNotMatch(t, /\d/);
  assert.doesNotMatch(Object.values(m.COPY).join(" "), /\bgaranti(e|s)?\b(?! )/i);
  assert.match(m.COPY.label, /indicative/);
});

const STAGE = (o: Record<string, unknown> = {}) => ({ active: V1, latest_version: 1, staged: null, publication_available: false, ...o });
test("vue admin stricte et reçu de préparation (version = attendue + 1)", () => {
  assert.ok(a.parseStageView(STAGE()));
  assert.ok(a.parseStageView(STAGE({ latest_version: 2, staged: { version: 2, ranges: R, reason: "Révision annuelle", created_at: "2026-11-07T20:00:00Z" } })));
  assert.equal(a.parseStageView(STAGE({ latest_version: 2 })), null, "staged required when latest > active");
  assert.equal(a.parseStageView(STAGE({ staged: { version: 1, ranges: R, reason: "Révision annuelle", created_at: "2026-11-07T20:00:00Z" } })), null);
  const cmd = { action: "stage" as const, command_id: "e0000000-0000-4000-8000-000000000001", expected_version: 1, ranges: R, reason: "Révision annuelle" };
  assert.ok(a.parseStageReceipt({ version: 2, replayed: false, publication_available: false, active_version: 1 }, cmd));
  assert.equal(a.parseStageReceipt({ version: 3, replayed: false, publication_available: false, active_version: 1 }, cmd), null);
  assert.equal(a.parseStageReceipt({ version: 2, replayed: false, publication_available: true, active_version: 1 }, cmd), null);
});

test("saisie en euros → centimes ; maximum ≥ minimum ; cinq catégories obligatoires", () => {
  assert.equal(a.toCents("150"), 15000);
  assert.equal(a.toCents("150,5"), 15050);
  assert.equal(a.toCents(" 1 200,99 "), 120099);
  for (const bad of ["", "0", "-5", "abc", "1,234"]) assert.equal(a.toCents(bad), null, bad);
  const full = Object.fromEntries(Object.entries(R).map(([k, v]) => [k, { min: String(v.min_cents / 100), max: String(v.max_cents / 100) }])) as Admin.RangeInputs;
  assert.equal(JSON.stringify((a.inputsToRanges(full) as { ranges: unknown }).ranges), JSON.stringify(R));
  assert.ok("error" in a.inputsToRanges({ ...full, socket: { min: "200", max: "100" } }));
  assert.ok("error" in a.inputsToRanges({ ...full, panel: { min: "", max: "100" } }));
});

function memStore() {
  const map = new Map<string, string>();
  return { map, store: { get: (k: string) => map.get(k) ?? null, set: (k: string, v: string) => void map.set(k, v), remove: (k: string) => void map.delete(k) } as Admin.Store };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
function staging(reply: (method: string, body: unknown, n: number) => Response | Promise<Response>, o: { store?: Admin.Store | null; ids?: string[]; ctx?: { uid: string | null; gen: number } } = {}) {
  const calls: { method: string; body: unknown }[] = [];
  const ctx = o.ctx ?? { uid: "admin-1", gen: 1 };
  const ids = o.ids ?? ["e0000000-0000-4000-8000-000000000001", "e0000000-0000-4000-8000-000000000002"];
  const mem = memStore();
  const store = o.store === undefined ? mem.store : o.store;
  let view: Admin.AdminView = a.ADMIN_INITIAL;
  const c = a.createStaging({
    fetcher: () => (async (_u: string, init: RequestInit) => { const body = init.body ? JSON.parse(String(init.body)) : null; calls.push({ method: String(init.method), body }); return reply(String(init.method), body, calls.length); }) as unknown as typeof fetch,
    store: () => store,
    newId: () => ids.shift() ?? null,
    context: { generation: () => ctx.gen, userId: () => ctx.uid },
    get: () => view,
    set: (v) => (view = v),
  });
  return { c, calls, mem, ctx, view: () => view };
}
const FULL = () => Object.fromEntries(Object.entries(R).map(([k, v]) => [k, { min: String(v.min_cents / 100), max: String(v.max_cents / 100 + 10) }])) as Admin.RangeInputs;

test("« Préparer une version » : commande stockée/relue avant le POST, motif requis, relecture après succès / incertain / 409", async () => {
  assert.equal(a.pendingKey("admin-1", 1), "courant-private-indicative-prices:admin-1:1");
  let stored: string | undefined;
  const h = staging((method, body) => {
    if (method === "GET") return json(STAGE());
    stored = h.mem.map.get(a.pendingKey("admin-1", 1));
    return json({ version: (body as { expected_version: number }).expected_version + 1, replayed: false, publication_available: false, active_version: 1 });
  });
  await h.c.load();
  assert.equal(await h.c.stage(FULL(), "court"), false);
  assert.equal(h.view().error, a.ADMIN_COPY.reasonRequired);
  assert.equal(await h.c.stage(FULL(), "Révision annuelle des fourchettes"), true);
  const post = h.calls.find((x) => x.method === "POST")!;
  assert.equal((post.body as { action: string }).action, "stage");
  assert.equal((post.body as { expected_version: number }).expected_version, 1);
  assert.equal(JSON.parse(stored!).command.command_id, "e0000000-0000-4000-8000-000000000001");
  assert.equal(h.mem.map.size, 0);
  assert.deepEqual(h.calls.map((x) => x.method), ["GET", "POST", "GET"], "re-read after success");
  const u = staging((method, _b, n) => (method === "GET" ? json(STAGE()) : n === 2 ? json({}, 503) : json({ version: 2, replayed: true, publication_available: false, active_version: 1 })));
  await u.c.load();
  await u.c.stage(FULL(), "Révision annuelle des fourchettes");
  assert.equal(u.view().error, a.ADMIN_COPY.retry);
  assert.equal(u.calls[2].method, "GET", "uncertain ⇒ re-read");
  await u.c.retry();
  const ids = u.calls.filter((x) => x.method === "POST").map((x) => (x.body as { command_id: string }).command_id);
  assert.equal(new Set(ids).size, 1, "same UUID on retry");
  assert.equal(u.view().notice, a.ADMIN_COPY.replayed);
  const k = staging((method) => (method === "GET" ? json(STAGE()) : json({}, 409)));
  await k.c.load();
  await k.c.stage(FULL(), "Révision annuelle des fourchettes");
  assert.equal(k.view().error, a.ADMIN_COPY.conflict);
  assert.deepEqual(k.calls.map((x) => x.method), ["GET", "POST", "GET"]);
  const none = staging((method) => (method === "GET" ? json(STAGE()) : json({}, 500)), { store: null });
  await none.c.load();
  await none.c.stage(FULL(), "Révision annuelle des fourchettes");
  assert.equal(none.calls.filter((x) => x.method === "POST").length, 0, "no storage ⇒ 0 POST");
  const f = staging((method) => (method === "GET" ? json(STAGE()) : json({}, 403)));
  await f.c.load();
  await f.c.stage(FULL(), "Révision annuelle des fourchettes");
  assert.equal(f.view().phase, "forbidden");
});

test("montages : affichages publics lus depuis le GET, réservation inchangée, barème admin sans « Publier »", () => {
  const home = readFileSync("components/role/public-home.tsx", "utf8");
  assert.match(home, /<PublicServiceList services=\{SERVICES\} \/>/);
  const list = readFileSync("components/role/public-service-list.tsx", "utf8");
  assert.match(list, /<IndicativeRange category=\{service\.category\} \/>/);
  assert.match(list, /<PublicServiceList services=\{SERVICES\} \/>/);
  assert.doesNotMatch(home + list, /Estimation indicative : \{money\((?:card|service)\.min\)\}/);
  const page = readFileSync("components/role/public-service-page.tsx", "utf8");
  assert.match(page, /<BookingWizard service=\{service\} range=\{range\}/, "booking wizard keeps its existing estimate");
  assert.match(page, /<BookingBar title=\{service\.title\} range=\{shownRange\} compact>/);
  assert.match(page, /<strong data-indicative-range=\{service\.category\}>\{shownRange\}<\/strong>/);
  assert.match(readFileSync("components/role/public-site.tsx", "utf8"), /<td><IndicativeRange category=\{row\.id as Category\} bare \/><\/td>/);
  const admin = readFileSync("components/features/indicative-prices/indicative-prices-admin.tsx", "utf8").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert.match(admin, /\{d\.publication_available && d\.staged && !pub\.pending && \(/, "« Publier » only when the server allows it");
  assert.match(readFileSync("components/role/admin-space.tsx", "utf8"), /<IndicativePricesAdmin key=\{`prices\|\$\{session\.mutationContext\.userId\(\) \?\? "-"\}\|\$\{session\.mutationContext\.generation\(\)\}`\} demo=\{demo\} context=\{session\.mutationContext\} \/>/);
});

test("publication : seulement si autorisée par le serveur, versions attendues exactes, confirmation explicite, relecture après chaque issue", async () => {
  const cmd = { command_id: "e0000000-0000-4000-8000-000000000009", expected_active_version: 1, expected_latest_version: 2, reason: "Publication validée" };
  assert.ok(a.parsePublishReceipt({ published_version: 2, active_version: 2, replayed: false }, cmd));
  assert.ok(a.parsePublishReceipt({ published_version: 2, active_version: 3, replayed: true }, cmd), "old replay: a newer active is possible");
  assert.equal(a.parsePublishReceipt({ published_version: 2, active_version: 3, replayed: false }, cmd), null);
  assert.equal(a.parsePublishReceipt({ published_version: 3, active_version: 3, replayed: false }, cmd), null);
  const staged = a.parseStageView(STAGE({ latest_version: 2, staged: { version: 2, ranges: R, reason: "Révision annuelle", created_at: "2026-11-07T20:00:00Z" }, publication_available: true }))!;
  const closed = a.parseStageView(STAGE({ latest_version: 2, staged: { version: 2, ranges: R, reason: "Révision annuelle", created_at: "2026-11-07T20:00:00Z" }, publication_available: false }))!;
  const mem = memStore();
  const calls: { body: unknown }[] = [];
  let reloads = 0;
  let pv: Admin.PublishView = a.PUBLISH_INITIAL;
  let reply: () => Response = () => new Response(JSON.stringify({ published_version: 2, active_version: 2, replayed: false }), { status: 200 });
  const p = a.createPublication({
    fetcher: () => (async (_u: string, init: RequestInit) => { calls.push({ body: JSON.parse(String(init.body)) }); return reply(); }) as unknown as typeof fetch,
    store: () => mem.store,
    newId: () => "e0000000-0000-4000-8000-000000000009",
    context: { generation: () => 1, userId: () => "admin-1" },
    get: () => pv,
    set: (v) => (pv = v),
    reload: async () => void reloads++,
  });
  assert.equal(await p.publish(closed, "Publication validée"), false, "closed ⇒ never sent");
  assert.equal(await p.publish(staged, "court"), false);
  assert.equal(calls.length, 0);
  assert.equal(await p.publish(staged, "Publication validée"), true);
  assert.equal(JSON.stringify(calls[0].body), JSON.stringify(cmd));
  assert.equal(reloads, 1, "re-read after success");
  assert.equal(mem.map.size, 0);
  reply = () => new Response(JSON.stringify({ error: "La publication des fourchettes est désactivée." }), { status: 503 });
  await p.publish(staged, "Publication validée");
  assert.equal(pv.error, a.PUBLISH_COPY.closed);
  assert.equal(pv.pending, null);
  reply = () => new Response("{}", { status: 409 });
  await p.publish(staged, "Publication validée");
  assert.equal(pv.error, a.PUBLISH_COPY.conflict);
  reply = () => new Response("{}", { status: 502 });
  await p.publish(staged, "Publication validée");
  assert.equal(pv.error, a.PUBLISH_COPY.retry);
  assert.ok(pv.pending);
  reply = () => new Response(JSON.stringify({ published_version: 2, active_version: 2, replayed: true }), { status: 200 });
  await p.retry();
  assert.equal(pv.notice, a.PUBLISH_COPY.replayed);
  assert.equal(reloads, 5, "re-read after every outcome");
});

test("magasin partagé : une réponse V1 tardive après une lecture V2 forcée est ignorée ; TTL ; métadonnées sans montant", async () => {
  const store = loadModule("components/features/indicative-prices/model.ts") as unknown as typeof Model;
  const V2 = { ...V1, version: 2, source: "operator_version", ranges: { ...R, outage: { min_cents: 17000, max_cents: 27000 } } };
  let releaseOld!: () => void;
  let n = 0;
  const fetcher = (async () => {
    n++;
    if (n === 1) {
      await new Promise<void>((r) => (releaseOld = r));
      return new Response(JSON.stringify(V1), { status: 200 });
    }
    return new Response(JSON.stringify(V2), { status: 200 });
  }) as unknown as typeof fetch;
  const old = store.loadPrices(fetcher);
  await store.loadPrices(fetcher, true); // newer read (e.g. after a confirmed publication)
  assert.equal(store.getPricesState().data!.version, 2);
  releaseOld();
  await old;
  assert.equal(store.getPricesState().data!.version, 2, "the late V1 reply never overwrites V2");
  await store.loadPrices(fetcher);
  assert.equal(n, 2, "fresh ready state reused (TTL)");
  await store.loadPrices(fetcher, false, Date.now() + store.PRICES_TTL_MS + 1);
  assert.equal(n, 3, "re-read after the TTL");
  const meta = readFileSync("app/prestations/[slug]/page.tsx", "utf8");
  assert.doesNotMatch(meta, /serviceEstimate|money\(/);
});

test("lecture qui lève une exception synchrone ⇒ la lecture suivante (non forcée) réessaie vraiment", async () => {
  const store = loadModule("components/features/indicative-prices/model.ts") as unknown as typeof Model;
  let n = 0;
  const fetcher = ((..._a: unknown[]) => {
    n++;
    if (n === 1) throw new TypeError("sync failure");
    return Promise.resolve(new Response(JSON.stringify(V1), { status: 200 }));
  }) as unknown as typeof fetch;
  await store.loadPrices(fetcher);
  assert.equal(store.getPricesState().phase, "error");
  await store.loadPrices(fetcher);
  assert.equal(n, 2, "retried");
  assert.equal(store.getPricesState().phase, "ready");
});

test("publication confirmée après « Renvoyer » ⇒ même chemin : rafraîchissement du magasin public", async () => {
  const staged = a.parseStageView(STAGE({ latest_version: 2, staged: { version: 2, ranges: R, reason: "Révision annuelle", created_at: "2026-11-07T20:00:00Z" }, publication_available: true }))!;
  const mem = memStore();
  let pv: Admin.PublishView = a.PUBLISH_INITIAL;
  let published = 0;
  let mode = "lost";
  const p = a.createPublication({
    fetcher: () => (async () => (mode === "lost" ? Promise.reject(new TypeError("lost")) : new Response(JSON.stringify({ published_version: 2, active_version: 2, replayed: true }), { status: 200 }))) as unknown as typeof fetch,
    store: () => mem.store,
    newId: () => "e0000000-0000-4000-8000-00000000000a",
    context: { generation: () => 1, userId: () => "admin-1" },
    get: () => pv,
    set: (v) => (pv = v),
    reload: async () => {},
    onPublished: () => void published++,
  });
  await p.publish(staged, "Publication validée");
  assert.equal(published, 0, "uncertain: not confirmed");
  assert.ok(pv.pending);
  mode = "ok";
  await p.retry();
  assert.equal(published, 1, "confirmed after « Renvoyer » ⇒ the public store is re-read");
  const src = readFileSync("components/features/indicative-prices/indicative-prices-admin.tsx", "utf8");
  assert.match(src, /onPublished: \(\) => void loadPrices\(latest\.current\.fetcher, true\),/);
});
