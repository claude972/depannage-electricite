// Available missions (artisan): GET /api/artisan/missions paged by the opaque cursor beyond 100,
// dedup, no total count, eligible:false honest, 422 restart, 503 never empty, identity change drops
// the cursor, ?id point read + 404 local removal, accept single flight through the existing action,
// never a private route, no private field rendered. Real model + panel (SSR), fake API.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { loadModule } from "../documents/harness";
import type * as Model from "../../components/features/available-missions/available-missions-model";
import type * as Panel from "../../components/features/available-missions/available-missions-panel";

const m = loadModule("components/features/available-missions/available-missions-model.ts") as unknown as typeof Model;
const p = loadModule("components/features/available-missions/available-missions-panel.tsx") as unknown as typeof Panel;
const json = (v: unknown) => JSON.parse(JSON.stringify(v));
const html = (el: unknown) => renderToString(el as never).replace(/<!-- -->/g, "");
const id = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const offer = (n: number) => ({ id: id(n), category: "socket", city: "Fort-de-France", postal_code: "972**", urgency: n % 2 ? "urgent" : "scheduled", status: "requested", estimate_min_cents: 8000, estimate_max_cents: 18000, created_at: "2026-11-06T12:00:00+00:00" });
const pageBody = (items: unknown[], next: string | null, eligible = true, captured = "2026-11-06T12:30:00+00:00") => ({ items, eligible, captured_at: captured, page: { limit: 50, has_more: next !== null, next_cursor: next }, projection: "anonymized", order: "oldest_first", distance: "not_calculated" });
const ok = (body: unknown) => ({ status: 200, body, retryAfter: null });
function harness(lists: Model.MissionsResult[], points: Record<string, Model.MissionsResult> = {}, ctx = { gen: 1, uid: "artisan-1" as string | null }) {
  const calls: string[] = [];
  let state: Model.MissionsState = { ...m.MISSIONS_INITIAL };
  const api: Model.MissionsApi = {
    list: async (cursor) => { calls.push(cursor === null ? "list" : `list?cursor=${cursor}`); return lists.shift() ?? { status: 503, body: null, retryAfter: 2 }; },
    point: async (x) => { calls.push(`point?id=${x}`); return points[x] ?? { status: 404, body: { error: "x" }, retryAfter: null }; },
  };
  const ctrl = m.createMissionsController({ api: () => api, context: { generation: () => ctx.gen, userId: () => ctx.uid }, get: () => state, set: (s) => { state = s; } });
  return { ctrl, calls, get: () => state, ctx };
}

test("pagination au-delà de 100 : 3 pages, 135 offres, curseur opaque renvoyé tel quel, dédoublonnage, aucun total", async () => {
  const all = Array.from({ length: 135 }, (_, i) => offer(i + 1));
  const C1 = "eyJhIjoxfQ", C2 = "eyJhIjoyfQ-_";
  const h = harness([ok(pageBody(all.slice(0, 50), C1, true, "2026-11-06T12:30:00+00:00")), ok(pageBody(all.slice(49, 99), C2, true, "2026-11-06T12:31:00+00:00")), ok(pageBody(all.slice(99), null, true, "2026-11-06T12:32:00+00:00"))]);
  await h.ctrl.load();
  assert.equal(h.get().items.length, 50);
  await h.ctrl.more();
  await h.ctrl.more();
  assert.deepEqual(h.calls, ["list", `list?cursor=${C1}`, `list?cursor=${C2}`], "cursor sent unchanged");
  const s = h.get();
  assert.equal(s.items.length, 135, "offer 50 sent twice is shown once");
  assert.equal(new Set(s.items.map((o) => o.id)).size, 135);
  assert.equal(s.page?.has_more, false);
  assert.equal(s.captured.length, 3);
  assert.equal(m.shownCount(135, false), "135 offres affichées");
  assert.equal(m.shownCount(50, true), "50 offres affichées · il y en a d’autres");
  const out = html(createElement(p.AvailableMissionsPanel as never, { initial: s, onAccept: async () => true, onOpenAccepted() {} } as never));
  assert.match(out, /135 offres affichées/);
  assert.doesNotMatch(out, /sur \d+|au total|total/i, "no exhaustive count claimed");
  assert.match(out, /Pages lues : /);
  assert.doesNotMatch(out, /data-available-more=/);
  // The real fetch client: exact URLs, GET only, cursor percent-safe and unchanged.
  const urls: string[] = [];
  const api = m.createMissionsApi(async (u, init) => { urls.push(`${init?.method} ${u} ${init?.credentials} ${init?.cache}`); return new Response("{}", { status: 503 }); });
  await api.list(null); await api.list(C2); await api.point(id(7));
  assert.deepEqual(urls, ["GET /api/artisan/missions same-origin no-store", `GET /api/artisan/missions?cursor=${C2} same-origin no-store`, `GET /api/artisan/missions?id=${id(7)} same-origin no-store`]);
});

test("changement d’identité ou de génération : page et curseur abandonnés", async () => {
  const h = harness([ok(pageBody([offer(1)], "CUR")), ok(pageBody([offer(9)], null))]);
  await h.ctrl.load();
  h.ctx.uid = "artisan-2";
  await h.ctrl.more();
  assert.deepEqual(h.calls, ["list", "list"], "the previous identity's cursor is never sent: restart at page 1");
  assert.deepEqual(h.get().items.map((o) => o.id), [id(9)], "previous pages dropped");
  const g = harness([ok(pageBody([offer(1)], null))]);
  const pending = g.ctrl.load();
  g.ctx.gen = 2;
  await pending;
  assert.equal(g.get().phase, "loading", "a reply under another generation never applies");
  const src = readFileSync("components/features/available-missions/available-missions-panel.tsx", "utf8");
  assert.match(src, /Mount keyed by uid\|generation\|demo/);
});

test("eligible:false ⇒ raison honnête, aucune offre ; 503 ⇒ erreur + Réessayer, jamais une liste vide", async () => {
  const h = harness([ok(pageBody([], null, false))]);
  await h.ctrl.load();
  assert.equal(h.get().eligible, false);
  const out = html(createElement(p.AvailableMissionsPanel as never, { initial: h.get(), onAccept: async () => true, onOpenAccepted() {} } as never));
  assert.match(out, /data-available-ineligible=""/);
  assert.match(out, /disponibilité en pause, compte suspendu ou candidature non approuvée/);
  assert.doesNotMatch(out, /data-available-offer=|data-available-empty/);
  assert.equal(m.parseMissionsPage(pageBody([offer(1)], null, false)), null, "eligible:false with offers is not a feed");
  const e = harness([{ status: 503, body: { error: "x" }, retryAfter: 2 }]);
  await e.ctrl.load();
  assert.equal(e.get().phase, "error");
  const err = html(createElement(p.AvailableMissionsPanel as never, { initial: e.get(), onAccept: async () => true, onOpenAccepted() {} } as never));
  assert.match(err, /Les offres n’ont pas pu être vérifiées\. Réessayez\./);
  assert.match(err, />Réessayer</);
  assert.doesNotMatch(err, /data-available-empty|Aucune offre ne correspond/);
  // Off-contract shapes are errors too.
  for (const bad of [{ ...pageBody([offer(1)], null), distance: "3 km" }, { ...pageBody([{ ...offer(1), address: "12 rue" }], null) }, { ...pageBody([offer(1), offer(1)], null) }, pageBody([offer(1)], null).page, null])
    assert.equal(m.parseMissionsPage(bad), null);
});

test("curseur refusé (422) ⇒ redémarrage en page 1 ; échec de la suite ⇒ message, offres conservées", async () => {
  const h = harness([ok(pageBody([offer(1)], "OLD")), { status: 422, body: { error: "Curseur invalide." }, retryAfter: null }, ok(pageBody([offer(1), offer(2)], null))]);
  await h.ctrl.load();
  await h.ctrl.more();
  assert.deepEqual(h.calls, ["list", "list?cursor=OLD", "list"]);
  assert.equal(h.get().items.length, 2);
  const f = harness([ok(pageBody([offer(1)], "C")), { status: 503, body: null, retryAfter: 2 }]);
  await f.ctrl.load();
  await f.ctrl.more();
  assert.equal(f.get().items.length, 1);
  assert.equal(f.get().moreError, m.MISSIONS_COPY.moreFailed);
  assert.equal(f.get().page?.has_more, true, "« Afficher plus » stays available as the explicit retry");
});

test("lecture ponctuelle ?id : résumé anonymisé ; 404 ⇒ « plus disponible » et retrait local ; jamais la route privée", async () => {
  const h = harness([ok(pageBody([offer(1), offer(2)], null))], { [id(1)]: ok({ ...pageBody([offer(1)], null), net_estimate: null }) });
  await h.ctrl.load();
  await h.ctrl.open(id(1));
  assert.equal(h.get().point?.phase, "ready");
  const out = html(createElement(p.AvailableMissionsPanel as never, { initial: h.get(), onAccept: async () => true, onOpenAccepted() {} } as never));
  assert.match(out, /<dt>Code postal<\/dt><dd>972\*\*<\/dd>/);
  assert.match(out, /<dt>Distance<\/dt><dd>non calculée<\/dd>/);
  assert.match(out, /<dt>Estimation indicative<\/dt><dd>80,00\s€ – 180,00\s€<\/dd>/);
  assert.doesNotMatch(out, /<dt>(Adresse|Contact|Téléphone|Description|Client)<\/dt>/);
  assert.doesNotMatch(out, /12 rue|@|client_id/);
  await h.ctrl.open(id(2));
  assert.equal(h.get().point?.phase, "gone");
  assert.deepEqual(h.get().items.map((o) => o.id), [id(1)], "404 removes the offer locally");
  assert.match(html(createElement(p.AvailableMissionsPanel as never, { initial: h.get(), onAccept: async () => true, onOpenAccepted() {} } as never)), /Cette offre n’est plus disponible avec vos droits actuels\./);
  assert.ok(h.calls.every((c) => c === "list" || c.startsWith("list?cursor=") || c.startsWith("point?id=")), "only /api/artisan/missions is requested");
  const src = readFileSync("components/features/available-missions/available-missions-model.ts", "utf8") + readFileSync("components/features/available-missions/available-missions-panel.tsx", "utf8");
  assert.doesNotMatch(src, /\/api\/interventions|\/api\/workspace|openIntervention|session\./, "no private dossier route from the leaf");
  // A point reply for another offer is an error, never shown.
  assert.equal(m.parsePoint(pageBody([offer(3)], null), id(1)), null);
});

test("la lecture ponctuelle accepte l’estimation nette du serveur avec des bornes sûres", async () => {
  const page = pageBody([offer(1)], null);
  const net = { min_cents: 6800, max_cents: 15300 };
  assert.equal(m.parseMissionsPage({ ...page, net_estimate: net }), null);
  assert.equal(m.parsePoint({ ...page, net_estimate: { ...net, max_cents: 20000 } }, id(1)), null);
  assert.equal(m.parsePoint({ ...page, net_estimate: { ...net, address: "adresse privée" } }, id(1)), null);
  const h = harness([ok(page)], { [id(1)]: ok({ ...page, net_estimate: net }) });
  await h.ctrl.load();
  await h.ctrl.open(id(1));
  assert.deepEqual(h.get().point?.offer?.net_estimate, net);
  const out = html(createElement(p.AvailableMissionsPanel as never, { initial: h.get(), onAccept: async () => true, onOpenAccepted() {} } as never));
  assert.match(out, /<dt>Estimation après commission<\/dt><dd>68,00\s€ – 153,00\s€<\/dd>/);
});

test("acceptation : un seul appel à l’action existante, puis ouverture du dossier privé ; échec ⇒ message, pas de retrait", async () => {
  const h = harness([ok(pageBody([offer(1), offer(2)], null))], { [id(1)]: ok(pageBody([offer(1)], null)) });
  await h.ctrl.load();
  await h.ctrl.open(id(1));
  let resolve: (v: boolean) => void = () => {};
  const accepted: string[] = [];
  const opened: string[] = [];
  const onAccept = (x: string) => { accepted.push(x); return new Promise<boolean>((r) => (resolve = r)); };
  const first = h.ctrl.accept(id(1), onAccept, (x) => opened.push(x));
  assert.equal(await h.ctrl.accept(id(1), onAccept, (x) => opened.push(x)), false, "double click refused");
  assert.equal(h.get().accepting, id(1));
  resolve(true);
  await first;
  assert.deepEqual(accepted, [id(1)]);
  assert.deepEqual(opened, [id(1)]);
  assert.deepEqual(h.get().items.map((o) => o.id), [id(2)]);
  const f = harness([ok(pageBody([offer(1)], null))], { [id(1)]: ok(pageBody([offer(1)], null)) });
  await f.ctrl.load();
  await f.ctrl.open(id(1));
  const openedF: string[] = [];
  await f.ctrl.accept(id(1), async () => false, (x) => openedF.push(x));
  assert.deepEqual(openedF, []);
  assert.equal(f.get().acceptError, m.MISSIONS_COPY.acceptFailed);
  assert.equal(f.get().items.length, 1, "no optimistic removal");
});

test("démo : offres locales, aucun appel réseau, résumé depuis les offres de démo", async () => {
  const fetched: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (u: unknown) => { fetched.push(String(u)); return new Response("{}"); }) as typeof fetch;
  try {
    const out = html(createElement(p.AvailableMissionsPanel as never, { demo: true, demoItems: [offer(5)], onAccept: async () => true, onOpenAccepted() {} } as never));
    assert.match(out, new RegExp(`data-available-offer="${id(5)}"`));
    assert.match(out, /1 offre affichée/);
    assert.deepEqual(fetched, []);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("wiring: the « available » segment mounts the paged leaf (live: no exhaustive count; demo: anonymized local offers)", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync("components/role/artisan-space.tsx", "utf8");
  assert.match(src, /<AvailableMissionsPanel\s+key=\{`\$\{session\.mutationContext\.userId\(\) \?\? "-"\}\|\$\{session\.mutationContext\.generation\(\)\}\|\$\{demo \? "demo" : "live"\}\|\$\{confirmed\?\.rev \?\? 0\}\|\$\{shownOrder\}\|\$\{demo \? "-" : String\(available\)\}`\}/, "keyed by identity + confirmed radius revision + order + server-confirmed availability (any change restarts at page 1)");
  assert.match(src, /onAccept=\{\(id\) => session\.action\(id, "accept_mission"\)\}/);
  assert.match(src, /onOpenAccepted=\{\(id\) => session\.openIntervention\(id\)\}/);
  assert.match(src, /demoItems=\{demo \? offers\.map\(toDemoOffer\) : undefined\}/);
  assert.match(src, /postal_code: `\$\{i\.postal_code\.slice\(0, 3\)\}\*\*`/);
  assert.match(src, /missionSegmentOptions\(\{ offers: demo \? offers\.length : null,/);
  const lists = await import("../../components/role/artisan-lists");
  assert.equal(lists.missionSegmentOptions({ offers: null, active: 2, done: 0 })[0][1], "Disponibles");
  assert.equal(lists.missionSegmentOptions({ offers: 3, active: 2, done: 0 })[0][1], "Disponibles (3)");
});

test("demo-only openDemo: local summary for demo-* ids, no API call; live open() still refuses non-UUID ids", async () => {
  let calls = 0;
  let s: Model.MissionsState = { ...m.MISSIONS_INITIAL };
  const ctrl = m.createMissionsController({ api: () => ({ list: async () => (calls++, { status: 503, body: null, retryAfter: null }), point: async () => (calls++, { status: 503, body: null, retryAfter: null }) }), get: () => s, set: (n) => (s = n) });
  const demoOffer = { id: "demo-001", category: "outage", city: "Fort-de-France", postal_code: "972**", urgency: "urgent", status: "requested", estimate_min_cents: 9000, estimate_max_cents: 18000, created_at: "2026-11-01T10:00:00Z" } as Model.MissionOffer;
  assert.equal(await ctrl.open("demo-001"), false, "live path stays strict UUID");
  assert.equal(ctrl.openDemo("demo-001", [demoOffer]), true);
  assert.equal(s.point?.phase, "ready");
  assert.equal(s.point?.offer?.id, "demo-001");
  assert.equal(ctrl.openDemo("demo-404", [demoOffer]), false);
  assert.equal(s.point?.phase, "gone");
  assert.equal(calls, 0, "no request at all");
});
