// ART-03 / ADM-02 per-credential review leaf (backend b02f458). Real model functions + SSR of the
// real panel; fake API / store only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { loadModule } from "../documents/harness";
import type * as Model from "../../components/features/credential-reviews/credential-reviews-model";

const m = loadModule("components/features/credential-reviews/credential-reviews-model.ts") as unknown as typeof Model;
const panel = loadModule("components/features/credential-reviews/credential-review-panel.tsx") as Record<string, any>;
const same = (a: unknown, b: unknown, msg = "") => assert.equal(JSON.stringify(a), JSON.stringify(b), msg);
const text = (html: string) => html.replaceAll("<!-- -->", "").replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");
const CRED = "a0000000-0000-4000-8000-000000000001";
const USER = "10000000-0000-4000-8000-000000000001";
const NEW = (n: number) => `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const AT = "2026-11-07T10:00:00.000Z";
const rev = (version: number, decision = "changes_requested", reason = `Motif ${version}`) => ({ version, decision, reason, reviewed_at: AT });
const page = (current: number, over: Record<string, unknown> = {}, before: number | null = null) => {
  const head = Math.min(current, before === null ? current : before - 1);
  const reviews = Array.from({ length: Math.min(head, 50) }, (_, i) => rev(head - i));
  return { credential_id: CRED, kind: "liability", expires_on: "2027-06-30", can_review: true, current_version: current, reviews, next_before: head > 50 ? head - 49 : null, ...over };
};
const res = (status: number, body: unknown = null) => ({ status, body, retryAfter: null });
const reply = (cmd: Model.CrCommand) => res(200, { review: { credential_id: CRED, version: cmd.expected_version + 1, decision: cmd.decision, reason: cmd.reason, reviewed_at: AT } });
const ready = (current: number, over: Record<string, unknown> = {}) => m.applyFirstPage(m.CR_INITIAL, res(200, page(current, over)), CRED);
function memStore() { const map = new Map<string, string>(); return { map, store: { get: (k: string) => map.get(k) ?? null, set: (k: string, v: string) => (map.set(k, v), true), remove: (k: string) => void map.delete(k) } }; }
function harness({ reads = [] as Model.CrResult[], posts = [] as ((cmd: Model.CrCommand) => Model.CrResult | Promise<Model.CrResult>)[], store = memStore().store, ids = [NEW(1), NEW(2), NEW(3)], mode = "admin" as "admin" | "artisan", demo = false, context = { generation: () => 0, userId: () => USER as string | null } } = {}) {
  const calls: { kind: string; before?: number | null; body?: Model.CrCommand; stored?: string | null }[] = [];
  let s: Model.CrState = { ...m.CR_INITIAL };
  const issued: string[] = [];
  const c = m.createCrController({
    api: () => ({
      read: async (_id, before) => (calls.push({ kind: "GET", before }), reads.shift() ?? res(200, page(0))),
      review: async (_id, body) => (calls.push({ kind: "POST", body, stored: store.get(m.commandKey(USER, CRED, body.expected_version)) }), (posts.shift() ?? (() => res(503)))(body)),
    }),
    credentialId: CRED, mode, demo, context, store: () => store, newId: () => { const id = ids.shift() ?? null; if (id) issued.push(id); return id; }, get: () => s, set: (n) => (s = n),
  });
  return { c, calls, issued, get: () => s };
}
const render = (props: Record<string, unknown>) => text(renderToString(createElement(panel.CredentialReviewPanel, { credentialId: CRED, mode: "admin", ...props })));

test("lecture stricte : contrat exact, versions contiguës, pagination before/next_before", () => {
  assert.ok(m.parseReviewsPage(page(3), CRED, null));
  assert.ok(m.parseReviewsPage(page(120), CRED, null));
  assert.equal(m.parseReviewsPage(page(120), CRED, null)!.next_before, 71);
  assert.ok(m.parseReviewsPage(page(120, {}, 71), CRED, 71));
  for (const bad of [null, {}, { ...page(3), extra: 1 }, page(3, { credential_id: "a0000000-0000-4000-8000-000000000002" }), page(3, { reviews: [rev(3), rev(1)] }), page(3, { reviews: [rev(3), rev(2)] }), page(3, { next_before: 2 }),
    page(120, { next_before: null }), page(3, { kind: "diploma" }), page(3, { reviews: [rev(3, "approved"), rev(2), rev(1)] }), page(1, { reviews: [{ ...rev(1), reason: "" }] })])
    assert.equal(m.parseReviewsPage(bad, CRED, null), null, JSON.stringify(bad).slice(0, 100));
});

test("décision : commande persistée AVANT le POST, motif obligatoire, réponse vérifiée, relecture", async () => {
  const mem = memStore();
  const h = harness({ store: mem.store, reads: [res(200, page(2)), res(200, page(3))], posts: [reply] });
  await h.c.load();
  same(await h.c.decide("rejected", "   "), { errors: { reason: "Indiquez le motif (visible par l’artisan)." } });
  same(await h.c.decide("", "x"), { errors: { decision: "Choisissez une décision." } });
  assert.ok("errors" in (await h.c.decide("accepted", "x".repeat(1001)) as object));
  same(h.calls.map((c) => c.kind), ["GET"], "no POST for an invalid decision");
  assert.equal(await h.c.decide("changes_requested", "  Attestation illisible  "), true);
  const post = h.calls.find((c) => c.kind === "POST")!;
  same(post.body, { command_id: NEW(1), expected_version: 2, decision: "changes_requested", reason: "Attestation illisible" });
  same(JSON.parse(post.stored!), post.body, "persisted before the POST");
  same([h.calls.map((c) => c.kind), h.get().page!.current_version, mem.map.size], [["GET", "POST", "GET"], 3, 0]);
  assert.match(h.get().notice, /Décision enregistrée\. Modifications demandées \(version 3\)/);
  // A reply that does not match the command is an unknown outcome, never a success.
  const bad = harness({ reads: [res(200, page(2))], posts: [(cmd) => res(200, { review: { credential_id: CRED, version: 5, decision: cmd.decision, reason: cmd.reason, reviewed_at: AT } })] });
  await bad.c.load(); await bad.c.decide("accepted", "OK");
  same([bad.get().writeError, bad.get().pending?.command_id], [m.CR_COPY.replyUnreadable, NEW(1)]);
});

test("réponse perdue / 503 / rechargement ⇒ même commande renvoyée, aucune nouvelle clé", async () => {
  const mem = memStore();
  const a = harness({ store: mem.store, reads: [res(200, page(2))], posts: [() => res(m.CR_TIMEOUT), () => res(503)] });
  await a.c.load();
  await a.c.decide("rejected", "Assurance expirée");
  await a.c.retry();
  const bodies = a.calls.filter((c) => c.kind === "POST").map((c) => c.body);
  same(bodies, [bodies[0], bodies[0]]);
  same(bodies[0], { command_id: NEW(1), expected_version: 2, decision: "rejected", reason: "Assurance expirée" });
  assert.equal(await a.c.decide("accepted", "autre"), false, "no new decision while the outcome is unknown");
  // Reload: a new controller re-reads, offers the SAME stored command, never a new key.
  const b = harness({ store: mem.store, ids: [NEW(9)], reads: [res(200, page(2))], posts: [reply] });
  await b.c.load();
  same([b.get().pending, b.get().writeError], [bodies[0], m.CR_COPY.resume]);
  assert.match(render({ initial: b.get(), store: mem.store }), /Réessayer \(même décision\)/);
  assert.equal(await b.c.decide("accepted", "autre"), false);
  await b.c.retry();
  same([b.issued, b.calls[1].body, mem.map.size], [[], bodies[0], 0]);
  // Storage or id unavailable ⇒ no POST.
  const noStore = harness({ store: { get: () => null, set: () => false, remove: () => {} }, reads: [res(200, page(0))] });
  await noStore.c.load(); await noStore.c.decide("accepted", "OK");
  same([noStore.calls.map((c) => c.kind), noStore.get().writeError], [["GET"], m.CR_COPY.noStorage]);
  const noId = harness({ ids: [], reads: [res(200, page(0))] });
  await noId.c.load(); await noId.c.decide("accepted", "OK");
  same([noId.calls.map((c) => c.kind), noId.get().writeError], [["GET"], m.CR_COPY.noId]);
});

test("409 ⇒ message honnête, aucun rejeu ; nouvelle clé seulement après « Actualiser » explicite", async () => {
  const mem = memStore();
  const h = harness({ store: mem.store, reads: [res(200, page(2)), res(200, page(2))], posts: [() => res(409), reply] });
  await h.c.load();
  await h.c.decide("accepted", "Conforme");
  same([h.get().conflict, h.get().pending], [m.CR_COPY.conflict, null]);
  assert.equal(await h.c.retry(), false);
  assert.equal(await h.c.decide("accepted", "Conforme"), false, "no new command before refresh");
  assert.equal(mem.map.size, 1, "the conflicting command stays stored until the explicit refresh");
  assert.match(render({ initial: h.get() }), /rien n’est renvoyé automatiquement.*Actualiser/);
  await h.c.refresh();
  same([mem.map.size, h.get().conflict, h.get().pending], [0, "", null]);
  await h.c.decide("accepted", "Conforme");
  same(h.calls.filter((c) => c.kind === "POST").map((c) => c.body!.command_id), [NEW(1), NEW(2)]);
});

test("422 (pièce expirée), 403, 404 : messages exacts, rien en attente", async () => {
  for (const [status, decision, copy] of [[422, "accepted", m.CR_COPY.expired], [422, "rejected", m.CR_COPY.invalid], [403, "accepted", m.CR_COPY.forbidden], [404, "accepted", m.CR_COPY.notFound]] as const) {
    const mem = memStore();
    const h = harness({ store: mem.store, reads: [res(200, page(1))], posts: [() => res(status)] });
    await h.c.load();
    await h.c.decide(decision, "Motif");
    same([h.get().writeError, h.get().pending, mem.map.size], [copy, null, 0], `${status} ${decision}`);
  }
  for (const [status, copy] of [[403, m.CR_COPY.forbidden], [404, m.CR_COPY.notFound]] as const) {
    const h = harness({ reads: [res(status)] });
    await h.c.load();
    same([h.get().phase, h.get().error], ["unavailable", copy]);
    assert.match(render({ initial: h.get() }), new RegExp(copy.slice(0, 30)));
  }
});

test("artisan : lecture seule (aucun formulaire même si can_review) ; admin sans can_review : aucun formulaire", async () => {
  const art = render({ mode: "artisan", initial: ready(2, { can_review: true }) });
  assert.match(art, /Modifications demandées le .* — Motif 2/);
  assert.match(art, /n’approuve pas, à elle seule, la candidature complète/);
  assert.match(art, /un nouveau document doit être transmis : cette pièce n’est pas modifiable/);
  assert.doesNotMatch(renderToString(createElement(panel.CredentialReviewPanel, { credentialId: CRED, mode: "artisan", initial: ready(2) })), /data-cr-form|<textarea|type="radio"/);
  const h = harness({ mode: "artisan", reads: [res(200, page(2))] });
  await h.c.load();
  assert.equal(await h.c.decide("accepted", "x"), false);
  same(h.calls.map((c) => c.kind), ["GET"]);
  assert.doesNotMatch(renderToString(createElement(panel.CredentialReviewPanel, { credentialId: CRED, mode: "admin", initial: ready(2, { can_review: false }) })), /data-cr-form/);
  const admin = renderToString(createElement(panel.CredentialReviewPanel, { credentialId: CRED, mode: "admin", initial: ready(0) }));
  assert.match(admin, /data-cr-form=""/);
  assert.match(text(admin), /Aucune décision enregistrée pour cette pièce\. .*Nouvelle décision \(version 1\)/);
});

test("historique paginé : before/next_before, jamais présenté comme exhaustif, périmé si la tête change", async () => {
  const h = harness({ reads: [res(200, page(120)), res(200, page(120, {}, 71)), res(200, page(121, {}, 21))] });
  await h.c.load();
  same([h.get().reviews.length, h.get().nextBefore], [50, 71]);
  assert.match(render({ initial: h.get() }), /50 décision\(s\) affichée\(s\) sur 120\..*Afficher les décisions précédentes/);
  await h.c.more();
  same([h.get().reviews.length, h.get().nextBefore, h.calls.map((c) => c.before)], [100, 21, [null, 71]]);
  await h.c.more();
  same([h.get().reviews.length, h.get().stale], [100, true]);
  assert.match(render({ initial: h.get() }), /nouvelle décision depuis l’affichage.*Actualiser/);
  const urls: string[] = [];
  const api = m.createCrApi((async (u: string, init: RequestInit) => (urls.push(`${init.method} ${u}`), new Response("{}"))) as unknown as typeof fetch);
  await api.read(CRED, null); await api.read(CRED, 71);
  same(urls, [`GET /api/artisan/credentials/${CRED}/reviews`, `GET /api/artisan/credentials/${CRED}/reviews?before=71`]);
});

test("démo : aucun appel ; câblage admin et artisan ; clé, jetons, pas d’UUID constant", async () => {
  const d = harness({ demo: true });
  await d.c.load();
  assert.equal(await d.c.decide("accepted", "x"), false);
  same([d.calls.length, d.get().phase], [0, "demo"]);
  assert.match(render({ demo: true }), /Démonstration : aucune décision/);
  const admin = readFileSync("components/role/admin-space.tsx", "utf8");
  assert.match(admin, /<CredentialReviewPanel credentialId=\{c\.id\} mode="admin" context=\{session\.mutationContext\} demo=\{session\.mode === "demo"\} \/>/);
  const artisan = readFileSync("components/role/artisan-space.tsx", "utf8");
  assert.match(artisan, /<CredentialReviewPanel credentialId=\{s\.state\.credential\.id\} mode="artisan" context=\{session\.mutationContext\} demo=\{session\.mode === "demo"\} onCurrentDecision=\{noteDecision\} \/>/);
  // O1 : la pastille de la carte suit la décision courante signalée par le panneau, sinon reste « Transmis ».
  assert.match(artisan, /decision \? DECISION_LABEL\[decision\] : state\.label/);
  assert.match(artisan, /s\.state\.key === "pending" \? decisions\[s\.state\.credential\.id\] \?\? null : null/);
  assert.doesNotMatch(artisan, /aucune validation individuelle/);
  const view = readFileSync("components/features/credential-reviews/credential-review-panel.tsx", "utf8");
  const model = readFileSync("components/features/credential-reviews/credential-reviews-model.ts", "utf8");
  assert.match(view, /key=\{`\$\{ctx\.userId\(\) \?\? "-"\}\|\$\{ctx\.generation\(\)\}\|\$\{props\.demo \? "demo" : "live"\}\|\$\{props\.mode\}\|\$\{props\.credentialId\}`\}/);
  assert.match(model, /crypto\.randomUUID\(\) : null\)/);
  assert.doesNotMatch(view + model, /00000000-0000-4000-8000-000000000000/);
  const css = readFileSync("components/features/credential-reviews/credential-reviews.module.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|rgb|hsl/i);
  assert.match(css, /\.button \{[^}]*min-height: 44px;/);
  assert.match(css, /\.choice \{[^}]*min-height: 44px;/);
});
