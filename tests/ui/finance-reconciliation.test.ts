// FIN-06 provider observations (contract ROOT dca415c copied strictly): exact list/detail URLs, the
// route's page/detail/receipt checks, wording that never presents an observation as a payment, payout
// or refund, and the review command fenced under courant-private-reconciliation:<uid>:<gen>:<evt>
// (read-back or 0 POST, strict restore, identity change ⇒ dropped, 401/403 clear, 409 honest + reload,
// 503/429/lost ⇒ same command, replayed ⇒ reload). Access by server scopes; demo zero calls.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { loadModule } from "../documents/harness";
import type * as Model from "../../components/features/finance-reconciliation/model";
import type * as Panel from "../../components/features/finance-reconciliation/reconciliation-panel";

const m = loadModule("components/features/finance-reconciliation/model.ts") as unknown as typeof Model;
const p = loadModule("components/features/finance-reconciliation/reconciliation-panel.tsx") as unknown as typeof Panel;
const UID = "10000000-0000-4000-8000-0000000000fa";
const U = (n: number) => `50000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const T = "2026-11-07T10:00:00.000Z";
const evt = (n: number) => `evt_${String(n).padStart(6, "0")}`;
export function rec(n: number, o: { state?: "matched" | "needs_review"; reason?: string; version?: number; family?: string; type?: string } = {}) {
  const matched = (o.state ?? "matched") === "matched";
  return {
    event: { id: evt(n), type: o.type ?? "transfer.created", family: o.family ?? "transfer", livemode: false, source_account: null, created: T, object: { id: `tr_${n}`, amount: 12345, currency: "eur", source_charge: "ch_1", destination: "acct_1", amount_reversed: 0, reversed: false, status: null } },
    result: { state: o.state ?? "matched", reason: o.reason ?? (matched ? "linked_transfer_observation" : "unlinked_transfer"), settlement_id: matched ? U(1) : null, intervention_id: matched ? U(2) : null, quote_id: matched ? U(3) : null },
    version: o.version ?? 1,
    received_at: T,
  };
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

test("contrat copié à l’identique de dca415c", () => {
  const copy = readFileSync("components/features/finance-reconciliation/contract.ts", "utf8").split("\n").slice(3).join("\n");
  assert.ok(copy.startsWith('import { z } from "zod";\nexport const eventId = z.string().regex(/^evt_[A-Za-z0-9_]{1,240}$/),'));
  assert.match(copy, /export const reviewCommand = z\s*\.object\(\{\s*command_id: uuid,\s*expected_version: version\.max\(2147483646\),\s*note: z\.string\(\)\.trim\(\)\.min\(1\)\.max\(2000\),/);
});

test("URLs exactes (after / state seulement si fournis) ; contrôles de page comme la route", () => {
  assert.equal(m.listUrl(null, ""), "/api/platform-operations/stripe-observations");
  assert.equal(m.listUrl(evt(50), "needs_review"), `/api/platform-operations/stripe-observations?after=${evt(50)}&state=needs_review`);
  assert.equal(m.detailUrl(evt(7)), `/api/platform-operations/stripe-observations/${evt(7)}`);
  const full = Array.from({ length: 50 }, (_, i) => rec(i + 1));
  assert.ok(m.parsePage({ records: full, next_after: evt(50) }, null, ""));
  assert.equal(m.parsePage({ records: full.slice(0, 3), next_after: evt(3) }, null, ""), null, "cursor on a short page");
  assert.equal(m.parsePage({ records: [rec(2), rec(1)], next_after: null }, null, ""), null, "not ascending");
  assert.equal(m.parsePage({ records: [rec(5)], next_after: null }, evt(9), ""), null, "not after the cursor");
  assert.equal(m.parsePage({ records: [rec(5)], next_after: null }, null, "needs_review"), null, "filter not honoured");
  assert.equal(m.parsePage({ records: [{ ...rec(1), result: { ...rec(1).result, state: "matched", reason: "unlinked_transfer" } }], next_after: null }, null, ""), null, "matched needs proof");
  assert.equal(m.parsePage({ records: [], next_after: null, total: 3 }, null, ""), null, "strict");
  const d = { record: rec(4, { version: 3 }), history: [{ actor_id: UID, note: "b", created_at: T, version: 3, outcome: rec(4).result }, { actor_id: UID, note: "a", created_at: T, version: 2, outcome: rec(4).result }], history_limited: false };
  assert.ok(m.parseDetail(d, evt(4)));
  assert.equal(m.parseDetail(d, evt(5)), null, "other event");
  assert.equal(m.parseDetail({ ...d, history: [...d.history].reverse() }, evt(4)), null, "history newest first");
  assert.ok(m.parseReceipt({ event_id: evt(4), version: 4, result: rec(4).result, replayed: false }, evt(4), 3));
  assert.equal(m.parseReceipt({ event_id: evt(4), version: 5, result: rec(4).result, replayed: false }, evt(4), 3), null);
});

test("libellés : une observation n’est jamais un paiement, un versement ou un remboursement effectué", () => {
  assert.equal(m.OBSERVATION_LABEL, "Observation du fournisseur (lecture)");
  const all = [...Object.values(m.REASON_LABEL), ...Object.values(m.STATE_LABEL), ...Object.values(m.TYPE_LABEL), ...Object.values(m.FAMILY_LABEL)].join(" | ");
  assert.doesNotMatch(all, /\b(paiement|versement|remboursement) (effectué|reçu|encaissé)|fonds (versés|reçus)\b/i);
  assert.match(m.REASON_LABEL.linked_transfer_observation, /n’est pas la preuve d’un versement bancaire/);
  assert.match(m.REASON_LABEL.aggregate_payout_unallocated, /jamais réparti entre dossiers/);
  assert.match(m.COPY.intro, /ni un paiement, ni un versement, ni un remboursement[\s\S]*Aucune requête n’est envoyée au fournisseur/);
  assert.match(m.COPY.paging, /50 au plus[\s\S]*ni un solde/);
  assert.equal(m.amountText(12345, "eur"), "123,45 €");
  assert.equal(m.amountText(5, "eur"), "0,05 €");
  assert.equal(m.amountText(500, "jpy"), "500 (plus petite unité) JPY");
  for (const r of Object.keys(m.REASON_LABEL)) assert.ok(m.REASON_LABEL[r as keyof typeof m.REASON_LABEL].length > 20, r);
});

function memStore() {
  const map = new Map<string, string>();
  return { map, store: { get: (k: string) => map.get(k) ?? null, set: (k: string, v: string) => void map.set(k, v), remove: (k: string) => void map.delete(k) } as Model.Store };
}
const ID = evt(4);
const DETAIL = (version = 3) => ({ record: rec(4, { state: "needs_review", version }), history: [], history_limited: false });
function detail(reply: (method: string, body: unknown, n: number) => Response | Promise<Response>, o: { store?: Model.Store | null; ids?: string[]; ctx?: { uid: string | null; gen: number } } = {}) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const ctx = o.ctx ?? { uid: UID, gen: 0 };
  const ids = o.ids ?? [U(101), U(102), U(103)];
  const mem = memStore();
  const store = o.store === undefined ? mem.store : o.store;
  let view: Model.DetailView = m.DETAIL_INITIAL;
  const c = m.createDetail({
    id: ID,
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
  return { c, calls, mem, ctx, view: () => view };
}
const okReceipt = (replayed = false) => json({ event_id: ID, version: 4, result: { state: "needs_review", reason: "unlinked_transfer", settlement_id: null, intervention_id: null, quote_id: null }, replayed });

test("revue : note obligatoire, commande stockée puis relue avant le POST, version affichée, résultat exact + relecture", async () => {
  assert.equal(m.PENDING_PREFIX, "courant-private-reconciliation:");
  let stored: string | undefined;
  const h = detail((method) => {
    if (method === "GET") return json(DETAIL());
    stored = h.mem.map.get(m.pendingKey(UID, 0, ID));
    return okReceipt();
  });
  await h.c.load();
  assert.equal(await h.c.review("   "), false);
  assert.equal(h.view().error, m.COPY.noteRequired);
  assert.equal(h.calls.length, 1);
  assert.equal(await h.c.review("  Vérifié avec le relevé interne. "), true);
  const post = h.calls.find((x) => x.method === "POST")!;
  assert.equal(post.url, `/api/platform-operations/stripe-observations/${ID}`);
  assert.equal(JSON.stringify(post.body), JSON.stringify({ command_id: U(101), expected_version: 3, note: "Vérifié avec le relevé interne." }));
  assert.equal(JSON.parse(stored!).command.command_id, U(101));
  assert.equal(JSON.parse(stored!).event_id, ID);
  assert.equal(h.mem.map.size, 0);
  assert.equal(h.view().receipt!.result.reason, "unlinked_transfer", "result shown exactly as returned");
  assert.equal(h.view().notice, m.COPY.saved);
  assert.equal(h.calls[h.calls.length - 1].method, "GET", "detail reloaded");
});

test("rejoué ⇒ message + relecture ; stockage absent / relecture fausse / pas d’UUID ⇒ 0 POST", async () => {
  const r = detail((method) => (method === "GET" ? json(DETAIL()) : okReceipt(true)));
  await r.c.load();
  await r.c.review("note");
  assert.equal(r.view().notice, m.COPY.replayed);
  for (const store of [null, { get: () => null, set: () => {}, remove: () => {} } as Model.Store]) {
    const h = detail((method) => (method === "GET" ? json(DETAIL()) : okReceipt()), { store });
    await h.c.load();
    await h.c.review("note");
    assert.equal(h.calls.filter((x) => x.method === "POST").length, 0);
    assert.equal(h.view().error, m.COPY.storage);
  }
  const n = detail((method) => (method === "GET" ? json(DETAIL()) : okReceipt()), { ids: [] });
  await n.c.load();
  await n.c.review("note");
  assert.equal(n.calls.filter((x) => x.method === "POST").length, 0);
});

test("503 + Retry-After / réponse perdue ⇒ même commande ; 401/403 ⇒ effacé ; 409 ⇒ honnête + relecture, sans rejeu", async () => {
  const h = detail((method, _b, n) => (method === "GET" ? json(DETAIL()) : n === 2 ? json({}, 503, { "Retry-After": "2" }) : n === 3 ? Promise.reject(new TypeError("lost")) : okReceipt()));
  await h.c.load();
  await h.c.review("note");
  assert.equal(h.view().waitS, 2);
  assert.ok(h.mem.map.has(m.pendingKey(UID, 0, ID)));
  await h.c.retry();
  await h.c.retry();
  const posts = h.calls.filter((x) => x.method === "POST").map((x) => JSON.stringify(x.body));
  assert.equal(posts.length, 3);
  assert.equal(new Set(posts).size, 1);
  assert.equal(h.view().pending, null);
  for (const status of [401, 403]) {
    const f = detail((method) => (method === "GET" ? json(DETAIL()) : json({}, status)));
    await f.c.load();
    await f.c.review("note");
    assert.equal(f.view().phase, "forbidden");
    assert.equal(f.view().data, null);
    assert.equal(f.mem.map.size, 0);
  }
  const k = detail((method) => (method === "GET" ? json(DETAIL()) : json({}, 409)));
  await k.c.load();
  await k.c.review("note");
  assert.equal(k.view().error, m.COPY.conflict);
  assert.deepEqual(k.calls.map((x) => x.method), ["GET", "POST", "GET"]);
  assert.equal(await k.c.retry(), false);
  assert.equal(k.mem.map.size, 0);
});

test("changement d’identité pendant le POST ⇒ ignoré ; restauration stricte (même uid, génération, événement)", async () => {
  const shared = memStore();
  const h = detail((method) => {
    if (method === "GET") return json(DETAIL());
    h.ctx.uid = "someone-else";
    return json({}, 503);
  }, { store: shared.store });
  await h.c.load();
  await h.c.review("note");
  assert.equal(h.view().pending, null);
  assert.equal(await h.c.retry(), false);
  const other = detail(() => json(DETAIL()), { store: shared.store, ctx: { uid: "someone-else", gen: 0 } });
  other.c.restorePending();
  assert.equal(other.view().pending, null);
  const back = detail((method) => (method === "GET" ? json(DETAIL()) : okReceipt()), { store: shared.store });
  back.c.restorePending();
  assert.equal(back.view().pending!.command_id, U(101));
  await back.c.retry();
  assert.equal((back.calls[0].body as { command_id: string }).command_id, U(101));
  const t = memStore();
  t.store.set(m.pendingKey(UID, 0, ID), JSON.stringify({ uid: UID, gen: 0, event_id: evt(9), command: { command_id: U(9), expected_version: 1, note: "x" } }));
  const tampered = detail(() => json(DETAIL()), { store: t.store });
  tampered.c.restorePending();
  assert.equal(tampered.view().pending, null);
  assert.equal(t.map.size, 0);
});

test("accès : masqué sans finance_read ; démo ⇒ note, aucun bouton ; onglet monté dans la finance plateforme", () => {
  const ctx = { generation: () => 0, userId: () => UID };
  assert.equal(renderToString(createElement(p.ReconciliationPanel as never, { demo: false, canRead: false, canWrite: false, context: ctx } as never)), "");
  const demo = renderToString(createElement(p.ReconciliationPanel as never, { demo: true, canRead: true, canWrite: false, context: ctx } as never));
  assert.match(demo, /aucune observation n’est lue et aucune revue n’est enregistrée/);
  assert.doesNotMatch(demo, /<button|<select|<textarea/);
  const view = readFileSync("components/features/platform-operations/platform-finance-view.tsx", "utf8");
  assert.match(view, /\{ id: "observations", label: "Observations fournisseur" \}/);
  assert.match(view, /t\.id !== "observations" \|\| demo \|\| me\.data\?\.super_admin \|\| me\.data\?\.scopes\.includes\("finance_read"\)/);
  assert.match(view, /canWrite=\{scope\.authority\.canWrite && !demo && \(me\.data\.super_admin \|\| \(me\.data\.scopes\.includes\("finance_read"\) && me\.data\.scopes\.includes\("finance_write"\)\)\)\}/);
  const panel = readFileSync("components/features/finance-reconciliation/reconciliation-panel.tsx", "utf8");
  assert.doesNotMatch(panel, /stripe\.com|api\.stripe|js\.stripe/i, "no provider call from the browser");
});
