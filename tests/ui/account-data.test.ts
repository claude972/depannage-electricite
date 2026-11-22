// Account data (SYS-09 / PUB-10), contract of ROOT e541656 copied strictly. Download: every section,
// paged with `after` until next_cursor null, strict projections, identity guard after each await,
// resume at the failed section / cursor without duplicates, honest errors. Erasure: explicit
// confirmation, request_id fenced (read-back or 0 POST), strict restore, no replay after identity
// change, 401/403 clear, 409 honest, 503 same command, replayed ⇒ « déjà déposée ». Demo: zero calls.
// Realigned (phase 2 lot B) on the 8-section export contract of 6625a97 (erasure_requests and
// payment_reminders, served by app/api/profile/data); no assertion removed.
import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { loadModule } from "../documents/harness";
import type * as Model from "../../components/features/account-data/model";
import type * as Panel from "../../components/features/account-data/account-data-panel";

const m = loadModule("components/features/account-data/model.ts") as unknown as typeof Model;
const p = loadModule("components/features/account-data/account-data-panel.tsx") as unknown as typeof Panel;
const UID = "10000000-0000-4000-8000-0000000000aa";
const id = (n: number) => `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const T = "2026-11-01T10:00:00+00:00";
const ACCOUNT = { section: "account", data: { email: "c@example.test", verified_phone: null, profile: { id: UID, full_name: "Camille", phone: "", role: "client", created_at: T }, notification_preferences: { user_id: UID, muted_kinds: [], email_enabled: true, sms_enabled: false, push_enabled: false, updated_at: T } }, next_cursor: null };
const row = {
  addresses: (n: number) => ({ id: id(n), user_id: UID, label: "Maison", first_name: "C", last_name: "D", address: "1 rue", postal_code: "97200", city: "FdF", country_code: "MQ", latitude: null, longitude: null, geo_source: null, is_preferred: false, created_at: T, updated_at: T, archived_at: null }),
  requests: (n: number) => ({ id: id(n), client_id: UID, site_id: null, category: "panne", description: "x", address: "1 rue", postal_code: "97200", city: "FdF", urgency: "normal", status: "new", created_at: T, updated_at: T }),
  booking_locations: (n: number) => ({ id: id(n), intervention_id: id(9000), location: { latitude: 14.605, longitude: -61.07, access_details: "Portail bleu" } }),
  messages: (n: number) => ({ id: id(n), author_id: UID, intervention_id: id(9000), body: "bonjour", created_at: T }),
  documents: (n: number) => ({ id: id(n), owner_id: UID, intervention_id: null, name: "devis.pdf", mime_type: "application/pdf", created_at: T }),
  support: (n: number) => ({ id: id(n), creator_id: UID, intervention_id: null, subject: "Aide", status: "open", created_at: T, updated_at: T }),
  // Contract 6625a97 (SYS-09/PUB-10): two identity-less sections (the server checks the owner).
  erasure_requests: (n: number) => ({ id: id(n), ticket_id: id(5000 + n), state: "requested", execution_state: "not_started", version: 1, created_at: T, updated_at: T }),
  payment_reminders: (n: number) => ({ id: id(n), version: 1, remind_at: T, status: "scheduled", processed_at: null }),
};
type Sec = keyof typeof row;
const page = (section: Sec, from: number, count: number, more: boolean) => {
  const rows = Array.from({ length: count }, (_, i) => row[section](from + i));
  return { section, rows, next_cursor: more ? rows[rows.length - 1].id : null };
};
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

test("URLs exactes : section explicite, after seulement pour les sections paginées", () => {
  assert.equal(m.dataUrl("account", null), "/api/profile/data?section=account");
  assert.equal(m.dataUrl("messages", id(100)), `/api/profile/data?section=messages&after=${id(100)}`);
  assert.deepEqual([...m.SECTIONS], ["account", "addresses", "requests", "booking_locations", "messages", "documents", "support", "erasure_requests", "payment_reminders"]);
});

test("projections strictes : clé en plus/en moins, propriétaire étranger, ordre, curseur, site d’organisation ⇒ refus", () => {
  assert.ok(m.parseAccount(ACCOUNT));
  assert.equal(m.parseAccount({ ...ACCOUNT, data: { ...ACCOUNT.data, profile: { ...ACCOUNT.data.profile, extra: 1 } } }), null);
  assert.equal(m.parseAccount({ ...ACCOUNT, next_cursor: id(1) }), null);
  assert.equal(m.parseAccount({ ...ACCOUNT, data: { ...ACCOUNT.data, notification_preferences: { ...ACCOUNT.data.notification_preferences, user_id: id(5) } } }), null);
  assert.ok(m.parsePage(page("messages", 1, 3, false), "messages", null, UID));
  assert.equal(m.parsePage(page("messages", 1, 3, false), "documents", null, UID), null, "wrong section");
  assert.equal(m.parsePage({ ...page("messages", 1, 1, false), rows: [{ ...row.messages(1), author_id: id(7) }] }, "messages", null, UID), null, "third-party row");
  assert.equal(m.parsePage({ ...page("messages", 1, 1, false), rows: [{ ...row.messages(1), extra: 1 }] }, "messages", null, UID), null);
  assert.equal(m.parsePage({ section: "messages", rows: [row.messages(2), row.messages(1)], next_cursor: null }, "messages", null, UID), null, "not ascending");
  assert.equal(m.parsePage(page("messages", 5, 2, false), "messages", id(10), UID), null, "rows not after the cursor");
  assert.equal(m.parsePage({ ...page("messages", 1, 3, false), next_cursor: id(3) }, "messages", null, UID), null, "cursor on a short page");
  assert.equal(m.parsePage({ ...page("requests", 1, 1, false), rows: [{ ...row.requests(1), site_id: id(77) }] }, "requests", null, UID), null, "organisation dossier");
  assert.ok(m.parsePage(page("support", 1, 100, true), "support", null, UID));
});

test("l’export accepte les lieux personnels en attente et vérifie la paire de coordonnées", () => {
  const place = row.booking_locations(1);
  assert.ok(m.parsePage(page("booking_locations", 1, 1, false), "booking_locations", null, UID));
  const parse = (r: unknown) => m.parsePage({ section: "booking_locations", rows: [r], next_cursor: null }, "booking_locations", null, UID);
  assert.ok(parse({ ...place, intervention_id: null, location: { latitude: null, longitude: null, access_details: "Portail bleu" } }));
  assert.equal(parse({ ...place, actor_id: UID }), null);
  assert.equal(parse({ ...place, location: { ...place.location, longitude: null } }), null);
});

function collector(reply: (url: string, n: number) => Response | Promise<Response>, ctx = { gen: 1, uid: UID as string | null }) {
  const urls: string[] = [];
  const saved: { json: string; filename: string }[] = [];
  const states: Model.CollectState[] = [];
  const c = m.createCollector({
    fetcher: (async (url: string) => {
      urls.push(url);
      return reply(url, urls.length);
    }) as unknown as typeof fetch,
    context: { generation: () => ctx.gen, userId: () => ctx.uid },
    save: (j, f) => saved.push({ json: j, filename: f }),
    now: () => new Date("2026-11-07T12:00:00Z"),
    set: (s) => states.push(s),
  });
  return { c, urls, saved, states, ctx };
}
const happy = (url: string) => {
  if (url.endsWith("section=account")) return json(ACCOUNT);
  if (url.endsWith("section=messages")) return json(page("messages", 1, 100, true));
  if (url.includes(`section=messages&after=${id(100)}`)) return json(page("messages", 101, 2, false));
  const s = /section=(\w+)/.exec(url)![1] as Sec;
  return json(page(s, 1, 1, false));
};

test("téléchargement : toutes les sections, pagination jusqu’à next_cursor null, un seul fichier JSON", async () => {
  const { c, urls, saved, states } = collector(happy);
  await c.run();
  assert.deepEqual(urls, ["account", "addresses", "requests", "booking_locations", "messages", `messages&after=${id(100)}`, "documents", "support", "erasure_requests", "payment_reminders"].map((s) => `/api/profile/data?section=${s}`));
  assert.equal(saved.length, 1);
  assert.equal(saved[0].filename, "mes-donnees-2026-11-07.json");
  const doc = JSON.parse(saved[0].json);
  assert.equal(doc.messages.length, 102);
  assert.deepEqual(doc.booking_locations, [row.booking_locations(1)]);
  assert.equal(doc.account.profile.id, UID);
  assert.deepEqual(Object.keys(doc), ["exported_at", "source", "note", "account", "addresses", "requests", "booking_locations", "messages", "documents", "support", "erasure_requests", "payment_reminders"]);
  const last = states[states.length - 1];
  assert.equal(last.phase, "done");
  assert.equal(last.progress.messages.rows, 102);
});

test("changement d’identité pendant la collecte ⇒ interrompu, rien d’enregistré, reprise repart de zéro", async () => {
  const h = collector((url) => {
    if (url.endsWith("section=messages")) h.ctx.gen = 2; // account switch while messages page 1 is in flight
    return happy(url);
  });
  await h.c.run();
  assert.equal(h.saved.length, 0);
  assert.equal(h.c.get().phase, "aborted");
  h.urls.length = 0;
  await h.c.run();
  assert.equal(h.urls[0], "/api/profile/data?section=account", "a new identity never continues the old partial file");
  assert.equal(h.saved.length, 1);
});

test("erreur 503 + Retry-After sur une page ⇒ « Réessayer » reprend à la même section / au même curseur, sans doublon", async () => {
  let fail = true;
  const h = collector((url) => {
    if (fail && url.includes(`after=${id(100)}`)) {
      fail = false;
      return json({ error: "x" }, 503, { "Retry-After": "20" });
    }
    return happy(url);
  });
  await h.c.run();
  assert.equal(h.c.get().phase, "error");
  assert.match(h.c.get().error, /réessayez dans 20 s/);
  assert.equal(h.c.get().waitS, 20);
  assert.equal(h.c.get().progress.messages.rows, 100);
  assert.equal(h.saved.length, 0);
  const before = h.urls.length;
  await h.c.run();
  assert.equal(h.urls[before], `/api/profile/data?section=messages&after=${id(100)}`, "resumes at the failed cursor");
  assert.equal(JSON.parse(h.saved[0].json).messages.length, 102, "no duplicated rows");
});

test("erreurs honnêtes 401/403/404/429/503 ; réponse hors contrat ⇒ aucun fichier", async () => {
  for (const [status, re] of [[401, /Session expirée/], [403, /Accès refusé/], [404, /introuvable/], [429, /Trop de demandes/], [503, /indisponible/]] as const) {
    const h = collector((url) => (url.endsWith("section=addresses") ? json({ error: "x" }, status) : happy(url)));
    await h.c.run();
    assert.equal(h.c.get().phase, "error");
    assert.match(h.c.get().error, re);
    assert.equal(h.saved.length, 0);
  }
  const bad = collector((url) => (url.endsWith("section=documents") ? json({ section: "documents", rows: [{ ...row.documents(1), owner_id: id(5) }], next_cursor: null }) : happy(url)));
  await bad.c.run();
  assert.equal(bad.c.get().error, m.COPY.offContract);
  assert.equal(bad.saved.length, 0);
});

// ---- Erasure ----------------------------------------------------------------------------------------
function memStore() {
  const map = new Map<string, string>();
  return { map, store: { get: (k: string) => map.get(k) ?? null, set: (k: string, v: string) => void map.set(k, v), remove: (k: string) => void map.delete(k) } };
}
function eraser(reply: (body: unknown, n: number) => Response | Promise<Response>, opts: { store?: Model.Store | null; ids?: string[]; ctx?: { gen: number; uid: string | null } } = {}) {
  const posts: { url: string; body: unknown; init: RequestInit }[] = [];
  const ctx = opts.ctx ?? { gen: 1, uid: UID };
  const ids = opts.ids ?? [id(501), id(502), id(503)];
  const mem = memStore();
  const store = opts.store === undefined ? mem.store : opts.store;
  const e = m.createErasure({
    fetcher: (async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      posts.push({ url, body, init });
      return reply(body, posts.length);
    }) as unknown as typeof fetch,
    store: () => store,
    newId: () => ids.shift() ?? null,
    context: { generation: () => ctx.gen, userId: () => ctx.uid },
    set: () => {},
  });
  return { e, posts, mem, ctx };
}
const ticket = (replayed = false) => json({ ticket_id: id(900), status: "open", replayed });

test("effacement : confirmation explicite, request_id stocké puis relu avant le POST, succès ⇒ ticket ; rien n’est effacé", async () => {
  const h = eraser(() => ticket());
  await h.e.send();
  assert.equal(h.posts.length, 0, "no POST without the explicit confirmation step");
  h.e.ask();
  assert.equal(h.e.get().phase, "confirming");
  await h.e.send();
  assert.equal(h.posts.length, 1);
  assert.equal(h.posts[0].url, "/api/profile/data");
  assert.equal(h.posts[0].init.method, "POST");
  assert.equal(JSON.stringify(h.posts[0].body), JSON.stringify({ action: "request_erasure", request_id: id(501), confirmed: true }));
  assert.equal(h.e.get().phase, "done");
  assert.equal(h.e.get().receipt!.ticket_id, id(900));
  assert.equal(h.mem.map.size, 0, "pending cleared after success");
  assert.match(m.COPY.erasureExplain, /ticket[\s\S]*Aucune donnée n’est effacée à ce stade/);
  assert.match(m.COPY.erasureDone, /Aucune donnée n’a été effacée/);
});

test("rejoué ⇒ « Demande déjà déposée »", async () => {
  const h = eraser(() => ticket(true));
  h.e.ask();
  await h.e.send();
  assert.equal(h.e.get().receipt!.replayed, true);
  assert.match(m.COPY.erasureReplayed, /^Demande déjà déposée/);
});

test("stockage indisponible ou relecture différente ⇒ 0 POST ; pas d’UUID ⇒ 0 POST", async () => {
  const none = eraser(() => ticket(), { store: null });
  none.e.ask();
  await none.e.send();
  assert.equal(none.posts.length, 0);
  assert.equal(none.e.get().error, m.COPY.storage);
  const lying = eraser(() => ticket(), { store: { get: () => null, set: () => {}, remove: () => {} } });
  lying.e.ask();
  await lying.e.send();
  assert.equal(lying.posts.length, 0);
  const noId = eraser(() => ticket(), { ids: [] });
  noId.e.ask();
  await noId.e.send();
  assert.equal(noId.posts.length, 0);
  assert.equal(noId.e.get().error, m.COPY.noUuid);
});

test("503 / réponse perdue ⇒ même commande ; 401/403 ⇒ effacée ; 409 honnête, pas de rejeu", async () => {
  const h = eraser((_b, n) => (n === 1 ? json({ error: "x" }, 503, { "Retry-After": "5" }) : n === 2 ? Promise.reject(new TypeError("lost")) : ticket()));
  h.e.ask();
  await h.e.send();
  assert.equal(h.e.get().retry, true);
  assert.equal(h.e.get().waitS, 5);
  await h.e.send();
  await h.e.send();
  assert.deepEqual(h.posts.map((x) => (x.body as { request_id: string }).request_id), [id(501), id(501), id(501)], "same command every time");
  assert.equal(h.e.get().phase, "done");
  for (const status of [401, 403, 409]) {
    const g = eraser(() => json({ error: "x" }, status));
    g.e.ask();
    await g.e.send();
    assert.equal(g.e.get().retry, false, String(status));
    assert.equal(g.mem.map.size, 0, `${status}: pending cleared`);
    if (status === 409) assert.equal(g.e.get().error, m.COPY.erasureConflict);
    g.e.ask();
    await g.e.send();
    assert.notEqual((g.posts[1].body as { request_id: string }).request_id, id(501), `${status}: never replayed`);
  }
});

test("changement d’identité pendant le POST ⇒ réponse ignorée ; restauration stricte par identité ; aucun rejeu pour un autre compte", async () => {
  const shared = memStore();
  const h = eraser(() => {
    h.ctx.gen = 2;
    return json({ error: "x" }, 503);
  }, { store: shared.store });
  h.e.ask();
  await h.e.send();
  assert.equal(h.e.get().phase, "idle", "reply dropped");
  assert.equal(h.e.get().receipt, null);
  // Same tab, new generation: the old pending command is not restored nor replayed.
  const other = eraser(() => ticket(), { store: shared.store, ctx: { gen: 2, uid: UID } });
  other.e.restore();
  assert.equal(other.e.get().phase, "idle");
  // Back on the original identity: strict restore, same request_id.
  const back = eraser(() => ticket(), { store: shared.store, ctx: { gen: 1, uid: UID } });
  back.e.restore();
  assert.equal(back.e.get().pending, id(501));
  await back.e.send();
  assert.equal((back.posts[0].body as { request_id: string }).request_id, id(501));
  // Tampered entry (another uid inside the key's value) ⇒ ignored.
  const t = memStore();
  t.store.set(m.pendingKey(UID, 1), JSON.stringify({ uid: id(4), gen: 1, request_id: id(77) }));
  const tampered = eraser(() => ticket(), { store: t.store });
  tampered.e.restore();
  assert.equal(tampered.e.get().phase, "idle");
});

test("démo : note honnête, aucun bouton (aucun appel possible)", () => {
  const html = renderToString(createElement(p.AccountDataPanel as never, { demo: true, context: { generation: () => 1, userId: () => null } } as never));
  assert.match(html, /aucune donnée n’est lue ni téléchargée/);
  assert.doesNotMatch(html, /<button/);
  const live = renderToString(createElement(p.AccountDataPanel as never, { demo: false, context: { generation: () => 1, userId: () => UID } } as never));
  assert.match(live, /Télécharger mes données/);
  assert.match(live, /Demander l’effacement/);
});
