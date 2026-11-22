// Refund execution leaf (docs/REFUND_EXECUTION_CONTRACT.md, last §). Real model functions + SSR of
// the real panel, fake API / store only. A 202 is never a refund; « confirmé » needs the GET to read
// execution_status "succeeded" AND request_status "settled".
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { loadModule } from "../documents/harness";
import type * as Model from "../../components/features/refund-execution/refund-execution-model";

const m = loadModule("components/features/refund-execution/refund-execution-model.ts") as unknown as typeof Model;
const panel = loadModule("components/features/refund-execution/refund-execution-panel.tsx") as Record<string, any>;
const same = (a: unknown, b: unknown, msg = "") => assert.equal(JSON.stringify(a), JSON.stringify(b), msg);
const text = (html: string) => html.replaceAll("<!-- -->", "").replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const REQ = "70000000-0000-4000-8000-000000000001";
const PAY = "40000000-0000-4000-8000-000000000001";
const USER = "10000000-0000-4000-8000-000000000001";
const EXEC = "e0000000-0000-4000-8000-000000000001";
const NEW = (n: number) => `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const request = (over: Partial<Model.RefundRequestView> = {}): Model.RefundRequestView => ({ id: REQ, payment_id: PAY, amount_cents: 12345, currency: "eur", status: "approved", version: 3, ...over });
const read = (over: Record<string, unknown> = {}) => ({ request_status: "approved", execution_status: null, execution_id: null, eligible: true, available: true, reason: "approval_required", ...over });
const res = (status: number, body: unknown = null) => ({ status, body, retryAfter: null });
const ready = (over: Record<string, unknown> = {}) => m.applyRead(m.RX_INITIAL, res(200, read(over)));
const ctx = (uid: string | null = USER) => { let g = 0, u = uid; return { context: { generation: () => g, userId: () => u }, bump: () => g++, switchUser: (x: string | null) => (u = x) }; };
function memStore() { const map = new Map<string, string>(); return { map, store: { get: (k: string) => map.get(k) ?? null, set: (k: string, v: string) => (map.set(k, v), true) } }; }
function harness({ reads = [] as Model.RxResult[], posts = [] as (Model.RxResult | Promise<Model.RxResult>)[], store = memStore().store, ids = [NEW(1), NEW(2), NEW(3)], context = ctx().context, capability = true as boolean | (() => boolean), req = request(), demo = false } = {}) {
  const calls: { kind: string; body?: Model.RxCommand }[] = [];
  let s: Model.RxState = { ...m.RX_INITIAL };
  const issued: string[] = [];
  const c = m.createRxController({
    api: () => ({ read: async () => (calls.push({ kind: "GET" }), reads.shift() ?? res(200, read())), execute: async (_id, body) => (calls.push({ kind: "POST", body }), posts.shift() ?? res(503)) }),
    request: req, capability, context, store: () => store, newId: () => { const id = ids.shift() ?? null; if (id) issued.push(id); return id; }, get: () => s, set: (n) => (s = n), demo,
  });
  return { c, calls, issued, get: () => s, set: (n: Model.RxState) => (s = n) };
}
const render = (props: Record<string, unknown>) => text(renderToString(createElement(panel.RefundExecutionPanel, { request: request(), capability: true, ...props })));

test("GET strict : champs exacts du contrat, invariants ; bank_confirmation n’existe pas dans le GET", () => {
  assert.ok(m.parseExecutionRead(read()));
  assert.ok(m.parseExecutionRead(read({ execution_status: "submitted", execution_id: EXEC, available: true })));
  for (const bad of [null, {}, { ...read(), bank_confirmation: true }, { ...read(), amount_cents: 1 }, read({ execution_status: "submitted" }), read({ execution_id: EXEC }),
    read({ eligible: false, available: true }), read({ reason: "configuration_required", available: true }), read({ execution_status: "paid", execution_id: EXEC }), read({ request_status: "refunded" }), read({ reason: "other" })])
    assert.equal(m.parseExecutionRead(bad), null, JSON.stringify(bad));
  assert.equal(m.parseExecutionReply({ request_status: "approved", execution_status: "submitted", execution_id: NEW(9), bank_confirmation: false }, NEW(1)), null, "reply must name our command");
});

test("états : chargement, erreur, introuvable/session, démo, aucune émission, périmé", () => {
  assert.match(render({ initial: m.RX_INITIAL }), /Lecture de l’état d’exécution/);
  assert.match(render({ initial: m.applyRead(m.RX_INITIAL, res(503)) }), /n’a pas pu être lu.*Réessayer la lecture/);
  assert.match(render({ initial: m.applyRead(m.RX_INITIAL, res(200, { ...read(), extra: 1 })) }), /n’a pas pu être lu/);
  assert.match(render({ initial: m.applyRead(m.RX_INITIAL, res(404)) }), /introuvable/);
  assert.match(render({ initial: m.applyRead(m.RX_INITIAL, res(403)) }), /Accès refusé ou session expirée/);
  assert.match(render({ demo: true }), /Démonstration : aucune exécution/);
  const empty = render({ initial: ready() });
  assert.match(empty, /Montant approuvé 123,45 €/);
  assert.match(empty, /Aucune émission enregistrée/);
  assert.match(empty, /ne contacte ni la banque ni le prestataire/);
  assert.match(empty, /Émettre le remboursement…/);
  const stale = render({ initial: ready({ request_status: "settled", available: false, reason: "terminal_execution" }) });
  assert.match(stale, /a changé depuis sa lecture/);
  assert.doesNotMatch(stale, /Émettre|Vérifier \/ reprendre/);
});

test("refus explicites : chaque raison du contrat, capacité globale absente, lecture seule ⇒ aucune action", () => {
  for (const reason of m.RX_REASONS.filter((r) => r !== "revision_changed")) {
    const html = render({ initial: ready({ available: false, eligible: reason !== "configuration_required" ? false : true, reason }) });
    assert.ok(html.includes(m.REASON_COPY[reason]), reason);
    assert.doesNotMatch(html, /Émettre|Vérifier \/ reprendre/, reason);
  }
  assert.match(render({ initial: ready({ available: false, eligible: false, reason: "revision_changed" }) }), /a changé depuis sa lecture/);
  const off = render({ initial: ready(), capability: false });
  assert.match(off, /n’est pas activée pour votre compte/);
  assert.doesNotMatch(off, /Émettre/);
  for (const r of ["legacy_binding_missing", "operator_mismatch"]) assert.ok(m.REASON_COPY[r as Model.RxReason].length > 20);
});

test("montage / GET : jamais de POST ; démo : aucun appel", async () => {
  const h = harness({ reads: [res(200, read({ execution_status: "unknown", execution_id: EXEC }))] });
  await h.c.load();
  same(h.calls.map((c) => c.kind), ["GET"]);
  assert.match(render({ initial: h.get() }), /Vérifier \/ reprendre/);
  const d = harness({ demo: true });
  await d.c.load();
  assert.equal(d.c.confirm(), false);
  same([d.calls.length, d.get().phase], [0, "demo"]);
  const src = readFileSync("components/features/refund-execution/refund-execution-panel.tsx", "utf8");
  assert.match(src, /if \(!initial\) void c\.load\(\); \/\/ GET only/);
});

test("confirmation obligatoire, double clic ⇒ un seul POST, corps sans montant", async () => {
  let release!: (r: Model.RxResult) => void;
  const h = harness({ posts: [new Promise((r) => (release = r))], reads: [res(200, read()), res(200, read({ execution_status: "submitted", execution_id: NEW(1) }))] });
  await h.c.load();
  assert.equal(await h.c.execute(), false, "no POST without the confirmation step");
  assert.ok(h.c.confirm());
  assert.match(render({ initial: h.get() }), /Confirmer l’émission du remboursement.*Montant approuvé : 123,45 €.*moyen de paiement d’origine du paiement 40000000.*ne peut pas être annulée/);
  const a = h.c.execute(), b = h.c.execute();
  release(res(202, { request_status: "approved", execution_status: "submitted", execution_id: NEW(1), bank_confirmation: false }));
  same([await a, await b], [true, false]);
  same(h.calls.filter((c) => c.kind === "POST").map((c) => c.body), [{ command_id: NEW(1), expected_version: 3 }]);
  // The real API serializes exactly { command_id, expected_version }.
  const sent: { url: string; init: RequestInit }[] = [];
  const api = m.createRxApi((async (url: string, init: RequestInit) => (sent.push({ url, init }), new Response("{}", { status: 202 }))) as unknown as typeof fetch);
  await api.execute(REQ, { command_id: NEW(1), expected_version: 3, amount_cents: 999 } as Model.RxCommand);
  await api.read(REQ);
  same(Object.keys(JSON.parse(String(sent[0].init.body))), ["command_id", "expected_version"]);
  same([sent[0].init.method, sent[0].url, sent[1].init.method, sent[1].init.body], ["POST", `/api/platform-operations/finance/refund-requests/${REQ}/execution`, "GET", undefined]);
});

test("réponse perdue ⇒ rechargement ⇒ même command_id persisté avant le POST, reprise par GET, aucune nouvelle clé", async () => {
  const mem = memStore();
  const first = harness({ store: mem.store, posts: [res(m.REFUND_EXEC_TIMEOUT)] });
  await first.c.load();
  first.c.confirm();
  await first.c.execute();
  same([mem.map.get(m.commandKey(USER, REQ, 3)), first.get().pending], [NEW(1), { command_id: NEW(1), expected_version: 3 }]);
  assert.match(render({ initial: first.get() }), /Réessayer \(même commande\)/);
  await first.c.retry(); // 503 again: exactly the same body
  same(first.calls.filter((c) => c.kind === "POST").map((c) => c.body), [{ command_id: NEW(1), expected_version: 3 }, { command_id: NEW(1), expected_version: 3 }]);
  // Page reload: a new controller re-reads by GET and resumes with the stored key, never a new one.
  const second = harness({ store: mem.store, ids: [NEW(7)], reads: [res(200, read())], posts: [res(202, { request_status: "approved", execution_status: "pending", execution_id: NEW(1), bank_confirmation: false })] });
  await second.c.load();
  second.c.confirm();
  await second.c.execute();
  same([second.issued, second.calls.map((c) => c.kind), second.calls[1].body], [[], ["GET", "POST", "GET"], { command_id: NEW(1), expected_version: 3 }]);
  // The server's execution id wins when the GET exposes one.
  const third = harness({ store: memStore().store, reads: [res(200, read({ execution_status: "unknown", execution_id: EXEC }))], posts: [res(202, { request_status: "approved", execution_status: "submitted", execution_id: EXEC, bank_confirmation: false })] });
  await third.c.load();
  third.c.confirm();
  await third.c.execute();
  same([third.issued, third.calls[1].body], [[], { command_id: EXEC, expected_version: 3 }]);
  // Storage or id generation unavailable ⇒ no POST at all.
  const noStore = harness({ store: { get: () => null, set: () => false } });
  await noStore.c.load(); noStore.c.confirm(); await noStore.c.execute();
  same([noStore.calls.map((c) => c.kind), noStore.get().writeError], [["GET"], m.RX_COPY.noStorage]);
  const noId = harness({ ids: [] });
  await noId.c.load(); noId.c.confirm(); await noId.c.execute();
  same([noId.calls.map((c) => c.kind), noId.get().writeError], [["GET"], m.RX_COPY.noId]);
});

test("202 (même avec bank_confirmation) n’est jamais « remboursé » ; succeeded sans settled n’est pas confirmé ; succeeded + settled seul confirme", async () => {
  const h = harness({ posts: [res(202, { request_status: "approved", execution_status: "succeeded", execution_id: NEW(1), bank_confirmation: true })], reads: [res(200, read()), res(200, read({ execution_status: "submitted", execution_id: NEW(1) }))] });
  await h.c.load(); h.c.confirm(); await h.c.execute();
  const after = render({ initial: h.get() });
  assert.match(after, /Émission transmise\. Ce n’est pas une confirmation/);
  assert.doesNotMatch(after, /Remboursement confirmé|\bremboursée?\b/);
  const unsettled = render({ initial: ready({ execution_status: "succeeded", execution_id: NEW(1), available: false, eligible: false, reason: "terminal_execution" }) });
  assert.match(unsettled, /confirmation bancaire non enregistrée : non confirmé/);
  assert.doesNotMatch(unsettled, /Remboursement confirmé/);
  same(m.executionLabel({ execution_status: "succeeded", request_status: "settled" }).confirmed, true);
  for (const s of m.EXEC_STATUSES) {
    const l = m.executionLabel({ execution_status: s, request_status: "approved" });
    assert.equal(l.confirmed, false, s);
    assert.doesNotMatch(l.text, /Remboursement confirmé|\bremboursée?\b/, s);
  }
  const done = render({ request: request({ status: "settled" }), initial: ready({ request_status: "settled", execution_status: "succeeded", execution_id: NEW(1), available: false, eligible: false, reason: "terminal_execution" }) });
  assert.match(done, /Remboursement confirmé \(confirmation bancaire enregistrée\)/);
  assert.doesNotMatch(done, /Émettre|Vérifier/);
});

test("409 ⇒ message honnête + Actualiser, aucun rejeu ; 401/404/422 ; garde d’identité après chaque await", async () => {
  const h = harness({ posts: [res(409)] });
  await h.c.load(); h.c.confirm(); await h.c.execute();
  same([h.get().conflict, h.get().pending], [m.RX_COPY.conflict, null]);
  assert.equal(await h.c.retry(), false);
  same(h.calls.map((c) => c.kind), ["GET", "POST"]);
  assert.match(render({ initial: h.get() }), /Rien n’est renvoyé automatiquement.*Actualiser/);
  for (const [status, copy] of [[401, m.RX_COPY.session], [404, m.RX_COPY.notFound], [422, m.RX_COPY.invalid]] as const) {
    const x = harness({ posts: [res(status)] });
    await x.c.load(); x.c.confirm(); await x.c.execute();
    same([x.get().writeError, x.get().pending], [copy, null], String(status));
  }
  const id = ctx();
  let release!: (r: Model.RxResult) => void;
  const g = harness({ context: id.context, posts: [new Promise((r) => (release = r))] });
  await g.c.load(); g.c.confirm();
  const p = g.c.execute();
  id.switchUser("10000000-0000-4000-8000-000000000002");
  release(res(202, { request_status: "approved", execution_status: "submitted", execution_id: NEW(1), bank_confirmation: false }));
  assert.equal(await p, false);
  assert.equal(g.get().notice, "", "reply of another identity is never applied");
  same(g.calls.map((c) => c.kind), ["GET", "POST"], "no reload for a stale identity");
});

test("clé du panneau, pas d’UUID constant, jetons CSS uniquement, vocabulaire honnête", () => {
  const view = readFileSync("components/features/refund-execution/refund-execution-panel.tsx", "utf8");
  const model = readFileSync("components/features/refund-execution/refund-execution-model.ts", "utf8");
  assert.match(view, /key=\{`\$\{ctx\.userId\(\) \?\? "-"\}\|\$\{ctx\.generation\(\)\}\|\$\{props\.request\.id\}\|\$\{props\.request\.version\}`\}/);
  assert.match(model, /crypto\.randomUUID\(\) : null\)/);
  assert.doesNotMatch(view + model, /00000000-0000-4000-8000-000000000000|setInterval|amount_cents: (request|props)/);
  assert.doesNotMatch(readFileSync("components/features/refund-execution/refund-execution.module.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, ""), /#[0-9a-f]{3,8}\b|rgb|hsl/i);
});

test("capacité révoquée sans changement d’identité (lue au moment de l’action) ⇒ aucun POST, ni après confirmation ni en reprise", async () => {
  let cap = true;
  const a = harness({ capability: () => cap });
  await a.c.load();
  assert.ok(a.c.confirm());
  cap = false;
  assert.equal(await a.c.execute(), false);
  same(a.calls.map((c) => c.kind), ["GET"]);
  cap = true;
  const b = harness({ capability: () => cap, posts: [res(503)] });
  await b.c.load(); b.c.confirm(); await b.c.execute();
  assert.ok(b.get().pending);
  cap = false;
  assert.equal(await b.c.retry(), false);
  same(b.calls.map((c) => c.kind), ["GET", "POST"]);
  assert.match(readFileSync("components/features/refund-execution/refund-execution.module.css", "utf8"), /\.button \{[^}]*min-height: 44px;/);
});

test("wiring: finance Refunds mounts the panel on approved/settled rows with the strict /me capability; demo never executes", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync("components/features/platform-operations/platform-finance-view.tsx", "utf8");
  assert.match(src, /refundExecution: canWrite && me\.data\.capabilities\.refund_execution === true, userId: scope\.userId/);
  assert.match(src, /\(r\.status === "approved" \|\| r\.status === "settled"\) && \(\s*<RefundExecutionPanel\s+request=\{\{ id: r\.id, payment_id: r\.payment_id, amount_cents: r\.amount_cents, currency: r\.currency, status: r\.status, version: r\.version \}\}\s+capability=\{ctx\.refundExecution\}/);
  assert.match(src, /demo=\{Boolean\(ctx\.demo\)\}/);
  assert.match(src, /ctx\.refundExecution\s+\? "Une demande approuvée n’est pas un remboursement effectué/);
});

test("un refus MFA conserve la commande et exige un clic explicite après vérification", async () => {
  const h = harness({ posts: [res(403, { code: "platform_mfa_required" }), res(503)] });
  await h.c.load();
  h.c.confirm();
  await h.c.execute();
  assert.equal(h.get().mfaRequired, true);
  assert.match(render({ initial: h.get() }), /Vérification à deux étapes/);
  assert.equal(await h.c.retry(), false);
  h.c.finishMfa();
  assert.equal(h.calls.filter((call) => call.kind === "POST").length, 1);
  await h.c.retry();
  const commands = h.calls.filter((call) => call.kind === "POST").map((call) => call.body);
  assert.equal(commands.length, 2);
  assert.deepEqual(commands[0], commands[1]);
});
