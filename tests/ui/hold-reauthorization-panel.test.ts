// CLI-07 / FIN-01 card-hold replacement leaf (backend cdf5f57). Real model functions + SSR of the
// real panel; fake API / store / navigation only. A bank return is never proof; the server read is.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { loadModule } from "../documents/harness";
import type * as Model from "../../components/features/hold-reauthorization/hold-reauth-model";

const m = loadModule("components/features/hold-reauthorization/hold-reauth-model.ts") as unknown as typeof Model;
const panel = loadModule("components/features/hold-reauthorization/hold-reauth-panel.tsx") as Record<string, any>;
const same = (a: unknown, b: unknown, msg = "") => assert.equal(JSON.stringify(a), JSON.stringify(b), msg);
const text = (html: string) => html.replaceAll("<!-- -->", "").replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const JOB = "20000000-0000-4000-8000-000000000001";
const USER = "10000000-0000-4000-8000-000000000001";
const ATT = "e0000000-0000-4000-8000-000000000001";
const NEW = (n: number) => `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SNAP = "a".repeat(64), SNAP2 = "b".repeat(64);
const URL_OK = "https://checkout.stripe.com/c/pay/cs_test_123";
const read = (over: Record<string, unknown> = {}) => ({ status: "eligible", reason: null, attempt_id: null, snapshot_id: SNAP, accepted_total_cents: 24000, original_authorized_cents: 18000, replacement_authorized_cents: 24000, currency: "eur", available: true, consent_required: true, ...over });
const res = (status: number, body: unknown = null) => ({ status, body, retryAfter: null });
const reply = (attempt: string, status = "awaiting_authorization", url?: string) => res(url ? 200 : 202, { status, attempt_id: attempt, intervention_id: JOB, currency: "eur", accepted_total_cents: 24000, ...(url ? { url } : {}) });
function memStore() { const map = new Map<string, string>(); return { map, store: { get: (k: string) => map.get(k) ?? null, set: (k: string, v: string) => (map.set(k, v), true), remove: (k: string) => void map.delete(k) } }; }
function harness({ reads = [] as Model.HrResult[], posts = [] as ((b: Model.HrBody) => Model.HrResult | Promise<Model.HrResult>)[], store = memStore().store, ids = [NEW(1), NEW(2)], demo = false, context = { generation: () => 0, userId: () => USER as string | null } } = {}) {
  const calls: { kind: string; body?: Model.HrBody; stored?: string | null }[] = [];
  const navigated: string[] = [];
  let s: Model.HrState = { ...m.HR_INITIAL };
  const issued: string[] = [];
  const c = m.createHrController({
    api: () => ({
      read: async () => (calls.push({ kind: "GET" }), reads.shift() ?? res(200, read())),
      command: async (body) => (calls.push({ kind: "POST", body, stored: body.action === "begin" ? store.get(m.commandKey(USER, JOB, body.snapshot_id)) : null }), (posts.shift() ?? (() => res(503)))(body)),
    }),
    interventionId: JOB, context, demo, store: () => store, newId: () => { const id = ids.shift() ?? null; if (id) issued.push(id); return id; }, navigate: (u) => navigated.push(u), get: () => s, set: (n) => (s = n),
  });
  return { c, calls, issued, navigated, get: () => s };
}
const ready = (over: Record<string, unknown> = {}) => m.applyRead(m.HR_INITIAL, res(200, read(over)));
const render = (props: Record<string, unknown>) => renderToString(createElement(panel.HoldReauthorizationPanel, { interventionId: JOB, search: "", ...props }));

test("lecture stricte : champs exacts, available ⇔ reason null, tentative ⇔ statut", () => {
  assert.ok(m.parseHrRead(read()));
  assert.ok(m.parseHrRead(read({ status: "awaiting_authorization", attempt_id: ATT })));
  for (const bad of [null, {}, { ...read(), extra: 1 }, read({ available: true, reason: "manual_review" }), read({ available: false }), read({ attempt_id: ATT }), read({ status: "opening" }),
    read({ replacement_authorized_cents: 1 }), read({ consent_required: false }), read({ status: "paid" }), read({ snapshot_id: "x" }), read({ currency: "usd" })])
    assert.equal(m.parseHrRead(bad), null, JSON.stringify(bad).slice(0, 90));
  for (const u of ["http://checkout.stripe.com/x", "https://evil.test/x", "https://u:p@checkout.stripe.com/x", "https://checkout.stripe.com/x#frag"]) assert.equal(m.safeCheckoutUrl(u), null, u);
});

test("CTA : seulement si available ET consentement explicite ; jamais au montage ; raisons explicites", async () => {
  const html = text(render({ initial: ready() }));
  assert.match(html, /Empreinte actuelle 180,00\s€ Total du devis accepté 240,00\s€/);
  assert.match(html, /J’autorise une nouvelle empreinte bancaire de 240,00\s€/);
  assert.doesNotMatch(render({ initial: ready() }), /data-hr-begin/, "no CTA before consent");
  assert.match(render({ initial: { ...ready(), consentedSnapshot: SNAP } }), /data-hr-begin=""/);
  for (const reason of m.HR_REASONS) {
    const out = render({ initial: ready({ available: false, reason }) });
    assert.ok(text(out).includes(m.REASON_COPY[reason]), reason);
    assert.doesNotMatch(out, /data-hr-consent|data-hr-begin|data-hr-resume|data-hr-abort/, reason);
  }
  const h = harness();
  await h.c.load();
  assert.equal(await h.c.begin(), false, "no consent ⇒ no POST");
  h.c.consent("f".repeat(64));
  assert.equal(h.get().consentedSnapshot, null, "consent only for the displayed snapshot");
  same(h.calls.map((c) => c.kind), ["GET"]);
});

test("begin : clé persistée AVANT le POST, page bancaire seulement après réponse validée et clic", async () => {
  const mem = memStore();
  const h = harness({ store: mem.store, posts: [(b) => reply((b as Model.BeginBody).command_id, "awaiting_authorization", URL_OK)] });
  await h.c.load();
  h.c.consent(SNAP);
  assert.equal(await h.c.begin(), true);
  const post = h.calls.find((c) => c.kind === "POST")!;
  same(post.body, { action: "begin", intervention_id: JOB, command_id: NEW(1), snapshot_id: SNAP, consent: true });
  same(post.stored, NEW(1), "persisted before the POST");
  same([h.calls.map((c) => c.kind), h.navigated], [["GET", "GET", "POST"], [URL_OK]]);
  // A reply naming another attempt or a non-bank URL is never followed.
  const bad = harness({ posts: [() => reply(NEW(9), "awaiting_authorization", URL_OK)] });
  await bad.c.load(); bad.c.consent(SNAP); await bad.c.begin();
  same([bad.navigated, bad.get().writeError], [[], m.HR_COPY.replyUnreadable]);
  const evil = harness({ posts: [(b) => reply((b as Model.BeginBody).command_id, "awaiting_authorization", "https://evil.test/pay")] });
  await evil.c.load(); evil.c.consent(SNAP); await evil.c.begin();
  same(evil.navigated, []);
});

test("réponse perdue / 503 / rechargement ⇒ même command_id ; aucune nouvelle clé", async () => {
  const mem = memStore();
  const a = harness({ store: mem.store, posts: [() => res(m.HR_TIMEOUT), () => res(503)] });
  await a.c.load(); a.c.consent(SNAP); await a.c.begin();
  await a.c.retry();
  const bodies = a.calls.filter((c) => c.kind === "POST").map((c) => JSON.stringify(c.body));
  same([bodies.length, bodies[0] === bodies[1]], [2, true]);
  assert.equal(await a.c.begin(), false, "no new begin while the outcome is unknown");
  // Reload with the same tab storage: still eligible (server never got it) ⇒ same command id.
  const b = harness({ store: mem.store, ids: [NEW(7)], posts: [(x) => reply((x as Model.BeginBody).command_id)] });
  await b.c.load(); b.c.consent(SNAP); await b.c.begin();
  same([b.issued, (b.calls.find((c) => c.kind === "POST")!.body as Model.BeginBody).command_id], [[], NEW(1)]);
  // Storage / id unavailable ⇒ no POST.
  const noStore = harness({ store: { get: () => null, set: () => false, remove: () => {} } });
  await noStore.c.load(); noStore.c.consent(SNAP); await noStore.c.begin();
  same([noStore.calls.map((c) => c.kind), noStore.get().writeError], [["GET", "GET"], m.HR_COPY.noStorage]);
  const noId = harness({ ids: [] });
  await noId.c.load(); noId.c.consent(SNAP); await noId.c.begin();
  same([noId.calls.map((c) => c.kind), noId.get().writeError], [["GET", "GET"], m.HR_COPY.noId]);
});

test("instantané changé ⇒ relecture, consentement remis à zéro, aucun POST", async () => {
  const h = harness({ reads: [res(200, read()), res(200, read({ snapshot_id: SNAP2 }))] });
  await h.c.load(); h.c.consent(SNAP);
  assert.equal(await h.c.begin(), false);
  same([h.calls.map((c) => c.kind), h.get().stale, h.get().consentedSnapshot, h.get().read!.snapshot_id], [["GET", "GET"], true, null, SNAP2]);
  assert.match(text(render({ initial: h.get() })), /Le dossier a changé depuis l’affichage/);
});

test("retour bancaire sans preuve serveur ⇒ jamais « autorisé » ; reprise / annulation n’envoient que attempt_id", async () => {
  same(m.providerReturn(`?hold_reauthorization=${ATT}&hold_return=success`), { attempt_id: ATT, outcome: "success" });
  assert.equal(m.providerReturn("?hold_return=success"), null);
  const back = text(render({ search: `?hold_reauthorization=${ATT}&hold_return=success`, initial: ready({ status: "awaiting_authorization", attempt_id: ATT }) }));
  assert.match(back, /ce retour ne prouve ni une autorisation ni un paiement/);
  assert.match(back, /En attente de votre accord sur la page bancaire : aucune nouvelle empreinte n’est en place/);
  assert.doesNotMatch(back, /Nouvelle empreinte en place|a confirmé la nouvelle empreinte|payé|réglé/i);
  const done = text(render({ initial: ready({ status: "ready_for_capture", attempt_id: ATT }) }));
  assert.match(done, /Nouvelle empreinte en place, vérifiée par le serveur\. Aucun débit n’a eu lieu/);
  const h = harness({ reads: [res(200, read({ status: "new_authorized", attempt_id: ATT })), res(200, read({ status: "ready_for_capture", attempt_id: ATT }))], posts: [() => reply(ATT, "ready_for_capture"), () => reply(ATT, "aborted")] });
  await h.c.load();
  await h.c.resume();
  same(h.calls[1].body, { action: "resume", intervention_id: JOB, attempt_id: ATT });
  same(h.get().read!.status, "ready_for_capture");
  const ab = harness({ reads: [res(200, read({ status: "awaiting_authorization", attempt_id: ATT }))], posts: [() => reply(ATT, "aborted")] });
  await ab.c.load();
  await ab.c.abort();
  same(ab.calls[1].body, { action: "abort", intervention_id: JOB, attempt_id: ATT });
});

test("409 ⇒ relecture sans POST ; 401/403/404/422 explicites ; changement d’identité ⇒ réponse ignorée", async () => {
  const h = harness({ reads: [res(200, read()), res(200, read()), res(200, read())], posts: [() => res(409)] });
  await h.c.load(); h.c.consent(SNAP); await h.c.begin();
  same([h.get().conflict, h.get().pending, h.get().consentedSnapshot, h.calls.map((c) => c.kind)], [m.HR_COPY.conflict, null, null, ["GET", "GET", "POST", "GET"]]);
  assert.equal(await h.c.retry(), false);
  for (const [status, copy] of [[401, m.HR_COPY.session], [403, m.HR_COPY.session], [404, m.HR_COPY.notFound], [422, m.HR_COPY.invalid]] as const) {
    const x = harness({ posts: [() => res(status)] });
    await x.c.load(); x.c.consent(SNAP); await x.c.begin();
    same([x.get().writeError, x.get().pending], [copy, null], String(status));
  }
  for (const [status, phase] of [[404, "unavailable"], [403, "unavailable"], [503, "error"]] as const) {
    const x = harness({ reads: [res(status)] });
    await x.c.load();
    same(x.get().phase, phase, String(status));
  }
  let user: string | null = USER;
  let release!: (r: Model.HrResult) => void;
  const g = harness({ context: { generation: () => 0, userId: () => user }, posts: [() => new Promise((r) => (release = r))] });
  await g.c.load(); g.c.consent(SNAP);
  const p = g.c.begin();
  await new Promise((r) => setTimeout(r, 0));
  user = "10000000-0000-4000-8000-000000000002";
  release(reply(NEW(1), "awaiting_authorization", URL_OK));
  assert.equal(await p, false);
  same(g.navigated, [], "a reply for another identity is never followed");
});

test("démo : zéro appel ; câblage dans le règlement par empreinte ; clé, jetons, pas d’UUID constant", async () => {
  const d = harness({ demo: true });
  await d.c.load();
  d.c.consent(SNAP);
  same([await d.c.begin(), await d.c.resume(), d.calls.length, d.get().phase], [false, false, 0, "demo"]);
  assert.match(text(render({ demo: true })), /aucune banque n’est contactée/);
  const src = readFileSync("components/role/booking-settlement.tsx", "utf8");
  assert.match(src, /HOLD_REPLACEMENT_REASONS\.includes\(dto\.reason \?\? ""\) && \(\s*<HoldReauthorizationPanel interventionId=\{interventionId\} context=\{context\} \/>/);
  const view = readFileSync("components/features/hold-reauthorization/hold-reauth-panel.tsx", "utf8");
  const model = readFileSync("components/features/hold-reauthorization/hold-reauth-model.ts", "utf8");
  assert.match(view, /if \(!initial\) void c\.load\(\);/);
  assert.match(view, /key=\{`\$\{ctx\.userId\(\) \?\? "-"\}\|\$\{ctx\.generation\(\)\}\|\$\{props\.demo \? "demo" : "live"\}\|\$\{props\.interventionId\}`\}/);
  assert.match(model, /crypto\.randomUUID\(\) : null\)/);
  assert.doesNotMatch(view + model, /00000000-0000-4000-8000-000000000000|amount_cents"?:\s*[a-z]/);
  const css = readFileSync("components/features/hold-reauthorization/hold-reauth.module.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|rgb|hsl/i);
  assert.match(css, /\.button \{[^}]*min-height: 44px;/);
});
