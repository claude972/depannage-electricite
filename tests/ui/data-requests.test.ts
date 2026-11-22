// SYS-07 data erasure requests (mirror of Astra c0df158): strict parsers (version 1..100,
// execution not_started, cursor rules), wording that never says « effacé »/« supprimé », and the
// operator decision fenced under courant-private-data-requests:<uid>:<gen>:<id> (can_decide, terminal
// states, required reason, lost reply ⇒ same command_id, 409 ⇒ no replay, 403 ⇒ refusal, identity
// change ⇒ reply ignored); wiring: opt-in client prop, operator mount in the support queue.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadModule } from "../documents/harness";
import type * as Contract from "../../components/features/data-requests/contract";
import type * as Model from "../../components/features/data-requests/model";

const c = loadModule("components/features/data-requests/contract.ts") as unknown as typeof Contract;
const m = loadModule("components/features/data-requests/model.ts") as unknown as typeof Model;
const UID = "10000000-0000-4000-8000-0000000000cd";
const U = (n: number) => `90000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const T = "2026-11-07T21:00:00Z";
export const req = (n: number, o: Partial<Record<string, unknown>> = {}) => ({ id: U(n), ticket_id: U(500 + n), state: "requested", execution_state: "not_started", version: 1, created_at: T, updated_at: T, ...o });

test("demande stricte : version 1..100, exécution « not_started » uniquement, pas d’account_id", () => {
  assert.ok(c.parseRequest(req(1)));
  assert.ok(c.parseRequest(req(1, { version: 100, state: "approved" })));
  for (const bad of [{ version: 0 }, { version: 101 }, { version: 1.5 }, { execution_state: "started" }, { execution_state: "done" }, { state: "erased" }, { account_id: UID }, { created_at: "hier" }])
    assert.equal(c.parseRequest(req(1, bad)), null, JSON.stringify(bad));
});

test("pages : ordre UUID croissant, next_cursor = dernier id, jamais de curseur sur page vide", () => {
  const page = (rows: unknown[], next: string | null) => ({ section: "erasure_requests", rows, next_cursor: next });
  assert.ok(c.parsePersonalPage(page([req(1), req(2)], U(2)), null));
  assert.ok(c.parsePersonalPage(page([req(3)], null), U(2)));
  assert.equal(c.parsePersonalPage(page([req(2), req(1)], null), null), null, "ascending");
  assert.equal(c.parsePersonalPage(page([req(1)], null), U(1)), null, "after the cursor");
  assert.equal(c.parsePersonalPage(page([req(1), req(2)], U(1)), null), null, "cursor = last id");
  assert.equal(c.parsePersonalPage(page([], U(1)), null), null, "cursor on an empty page");
  assert.equal(c.parsePersonalPage({ ...page([], null), section: "support" }, null), null);
  assert.ok(c.parseAdminPage({ rows: [req(1)], next_cursor: null }, null, 25));
  assert.equal(c.parseAdminPage({ rows: [req(1)], next_cursor: null, section: "x" }, null, 25), null, "strict");
  assert.equal(m.personalUrl(U(2)), `/api/profile/data?section=erasure_requests&after=${U(2)}`);
  assert.equal(m.adminListUrl(null), "/api/admin/data-requests?limit=25");
  assert.equal(m.adminListUrl(U(3)), `/api/admin/data-requests?limit=25&after=${U(3)}`);
});

test("libellés : état de la demande ≠ statut du ticket ≠ exécution ; jamais « effacé » / « supprimé »", () => {
  assert.equal(c.EXECUTION_LABEL.not_started, "Effacement non commencé");
  assert.equal(c.STATE_LABEL.approved, "Approuvée");
  const all = [...Object.values(c.STATE_LABEL), ...Object.values(c.EXECUTION_LABEL), ...Object.values(c.TICKET_LABEL), ...Object.values(c.DATA_REQUESTS_COPY)].join(" | ");
  assert.doesNotMatch(all.replace(/ne signifie pas que des données ont été effacées/g, ""), /\beffacée?s?\b|supprimée?s?\b/i);
  assert.match(c.DATA_REQUESTS_COPY.mineNote, /« Approuvée » ne signifie pas que des données ont été effacées/);
});

function memStore() {
  const map = new Map<string, string>();
  return { map, store: { get: (k: string) => map.get(k) ?? null, set: (k: string, v: string) => void map.set(k, v), remove: (k: string) => void map.delete(k) } as Model.Store };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const detail = (o: Partial<Record<string, unknown>> = {}, can = true) => ({ request: req(7, { state: "in_review", version: 3, ...o }), history: [{ id: U(900), actor_id: UID, from_state: "requested", to_state: "in_review", reason: "Examen", version: 3, created_at: T }], can_decide: can });
function ctrl(reply: (method: string, body: unknown, n: number) => Response | Promise<Response>, o: { store?: Model.Store | null; ids?: string[]; ctx?: { uid: string | null; gen: number } } = {}) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const ctx = o.ctx ?? { uid: UID, gen: 1 };
  const ids = o.ids ?? [U(101), U(102)];
  const mem = memStore();
  const store = o.store === undefined ? mem.store : o.store;
  let view: Model.DetailView = m.DETAIL_INITIAL;
  const d = m.createDetail({
    id: U(7),
    fetcher: () => (async (url: string, init: RequestInit) => {
      const body = init.body ? JSON.parse(String(init.body)) : null;
      calls.push({ method: String(init.method), url, body });
      return reply(String(init.method), body, calls.length);
    }) as unknown as typeof fetch,
    store: () => store,
    newId: () => ids.shift() ?? null,
    context: { generation: () => ctx.gen, userId: () => ctx.uid },
    get: () => view,
    set: (v) => (view = v),
  });
  return { d, calls, mem, ctx, view: () => view };
}
const decided = (b: { expected_version: number; state: string }, replayed = false) => json({ request: req(7, { state: b.state, version: b.expected_version + 1 }), replayed });

test("décision : commande stockée et relue avant le POST (préfixe courant-private-), version affichée, motif requis", async () => {
  assert.equal(m.pendingKey(UID, 1, U(7)), `courant-private-data-requests:${UID}:1:${U(7)}`);
  let stored: string | undefined;
  const h = ctrl((method, body) => {
    if (method === "GET") return json(detail());
    stored = h.mem.map.get(m.pendingKey(UID, 1, U(7)));
    return decided(body as never);
  });
  await h.d.load();
  assert.equal(await h.d.decide("needs_information", "   "), false);
  assert.equal(h.view().error, c.DATA_REQUESTS_COPY.opReasonRequired);
  assert.equal(await h.d.decide("needs_information", "x".repeat(1001)), false);
  assert.equal(h.calls.filter((x) => x.method === "POST").length, 0);
  assert.equal(await h.d.decide("needs_information", "Pièce d’identité manquante"), true);
  const post = h.calls.find((x) => x.method === "POST")!;
  assert.equal(post.url, `/api/admin/data-requests/${U(7)}`);
  assert.equal(JSON.stringify(post.body), JSON.stringify({ command_id: U(101), expected_version: 3, state: "needs_information", reason: "Pièce d’identité manquante" }));
  assert.equal(JSON.parse(stored!).command.command_id, U(101));
  assert.equal(h.mem.map.size, 0);
  assert.equal(h.view().notice, c.DATA_REQUESTS_COPY.opSaved);
});

test("can_decide=false ou état terminal ⇒ aucune décision possible", async () => {
  for (const [o, can] of [[{}, false], [{ state: "approved" }, true], [{ state: "rejected" }, true]] as const) {
    const h = ctrl((method) => (method === "GET" ? json(detail(o, can)) : json({}, 500)));
    await h.d.load();
    assert.equal(await h.d.decide("in_review", "motif"), false);
    assert.equal(h.calls.filter((x) => x.method === "POST").length, 0, JSON.stringify(o));
  }
  const src = readFileSync("components/features/data-requests/operator-data-requests.tsx", "utf8");
  assert.match(src, /const canForm = Boolean\(d && d\.can_decide && !TERMINAL\.has\(d\.request\.state\)\);/);
});

test("réponse perdue / 5xx ⇒ même command_id ; 409 ⇒ honnête + relecture, sans rejeu ; 403 ⇒ refus de portée", async () => {
  const h = ctrl((method, body, n) => (method === "GET" ? json(detail()) : n === 2 ? Promise.reject(new TypeError("lost")) : n === 3 ? json({}, 503) : decided(body as never)));
  await h.d.load();
  await h.d.decide("approved", "Conditions vérifiées");
  assert.equal(h.view().error, c.DATA_REQUESTS_COPY.opRetry);
  await h.d.retry();
  await h.d.retry();
  const ids = h.calls.filter((x) => x.method === "POST").map((x) => (x.body as { command_id: string }).command_id);
  assert.deepEqual(ids, [U(101), U(101), U(101)]);
  const k = ctrl((method) => (method === "GET" ? json(detail()) : json({}, 409)));
  await k.d.load();
  await k.d.decide("approved", "motif");
  assert.equal(k.view().error, c.DATA_REQUESTS_COPY.opConflict);
  assert.deepEqual(k.calls.map((x) => x.method), ["GET", "POST", "GET"]);
  assert.equal(await k.d.retry(), false, "no replay");
  assert.equal(k.mem.map.size, 0);
  for (const s of [401, 403]) {
    const f = ctrl((method) => (method === "GET" ? json(detail()) : json({}, s)));
    await f.d.load();
    await f.d.decide("approved", "motif");
    assert.equal(f.view().phase, "forbidden");
    assert.equal(f.view().data, null);
    assert.equal(f.view().error, c.DATA_REQUESTS_COPY.opForbidden);
    assert.equal(f.mem.map.size, 0);
  }
});

test("changement d’identité pendant le POST ⇒ réponse ignorée ; restauration stricte (même identité, même demande)", async () => {
  const shared = memStore();
  const h = ctrl((method) => {
    if (method === "GET") return json(detail());
    h.ctx.gen = 2;
    return json({}, 503);
  }, { store: shared.store });
  await h.d.load();
  await h.d.decide("approved", "motif");
  assert.equal(h.view().pending, null);
  assert.equal(await h.d.retry(), false);
  const g2 = ctrl(() => json(detail()), { store: shared.store, ctx: { uid: UID, gen: 2 } });
  g2.d.restorePending();
  assert.equal(g2.view().pending, null);
  const g1 = ctrl((method, body) => (method === "GET" ? json(detail()) : decided(body as never)), { store: shared.store });
  g1.d.restorePending();
  assert.equal(g1.view().pending!.command_id, U(101));
});

test("montages : prop opt-in côté client uniquement ; composant opérateur sous SupportCenter (file d’assistance)", () => {
  assert.match(readFileSync("components/features/account-data/account-data-panel.tsx", "utf8"), /erasureRequests = false/);
  assert.match(readFileSync("components/role/client-space.tsx", "utf8"), /onOpenTicket=\{\(id\) => session\.go\("support", id\)\}\s+erasureRequests\s+\/>/);
  const anchor = readFileSync("components/role/platform-anchor.tsx", "utf8");
  assert.match(anchor, /<SupportCenter session=\{session\} interventions=\{\[\]\} backView="support-queue" queue="all" \/>\s+\{session\.mode !== "demo" && <OperatorDataRequests context=\{session\.mutationContext\} \/>\}/);
  const op = readFileSync("components/features/data-requests/operator-data-requests.tsx", "utf8").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert.doesNotMatch(op, /subject|message/i, "no ticket title or messages");
});
