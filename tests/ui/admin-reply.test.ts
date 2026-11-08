// ADM-07 composer: real model functions + server render of the real component, and the wiring in
// the admin dossier thread. Contract: POST /api/admin/messages (ROOT 70a9c5d + f47ba7f).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { loadModule } from "../documents/harness";

const m = loadModule("components/features/admin-messages/admin-reply-model.ts") as Record<string, any>;
const ui = loadModule("components/features/admin-messages/admin-reply.tsx") as Record<string, any>;
const J = (v: unknown) => JSON.stringify(v);
const ID = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";
const DOSSIER = "33333333-3333-4333-8333-333333333333";
const ADMIN = "44444444-4444-4444-8444-444444444444";
const cmd = { id: ID, intervention_id: DOSSIER, body: "Bonjour, nous relançons l’artisan." };
const reply = { message: { ...cmd, author_id: ADMIN, created_at: "2026-11-06T22:00:00.000Z" } };

test("200 with exactly the sent command is a confirmed message; anything else is never a success", () => {
  assert.equal(J(m.replyOutcome({ status: 200, body: reply, retryAfter: null }, cmd, ADMIN)), J({ kind: "sent", message: reply.message }));
  for (const bad of [
    { message: { ...reply.message, body: "autre" } },
    { message: { ...reply.message, id: ID2 } },
    { message: { ...reply.message, intervention_id: ID2 } },
    { message: { ...reply.message, author_id: "x" } },
    { message: { ...reply.message, extra: 1 } },
    { ...reply, more: 1 },
    null,
  ]) assert.equal(m.replyOutcome({ status: 200, body: bad, retryAfter: null }, cmd, ADMIN).kind, "retry");
});

test("status mapping: 409 conflict (refresh, no auto-retry), 429/503/network retry, 4xx honest", () => {
  const k = (status: number) => m.replyOutcome({ status, body: { error: "x" }, retryAfter: null }, cmd, ADMIN).kind;
  assert.equal(k(409), "conflict");
  for (const s of [0, 429, 500, 503]) assert.equal(k(s), "retry");
  for (const s of [400, 422]) assert.equal(k(s), "invalid");
  for (const s of [401, 403, 404]) assert.equal(k(s), "denied");
});

test("retry keeps the same id and text; an edit or another dossier gets a new id; no UUID → refused", () => {
  let n = 0;
  const ids = [ID, ID2];
  const newId = () => ids[n++];
  const first = m.nextCommand(null, DOSSIER, cmd.body, newId);
  assert.equal(J(first), J(cmd));
  assert.equal(m.nextCommand(first, DOSSIER, cmd.body, newId), first, "same command object on retry");
  assert.equal(m.nextCommand(first, DOSSIER, cmd.body + " !", newId).id, ID2);
  assert.equal(m.nextCommand(null, DOSSIER, "x", () => null), null);
  // vm sandbox has no crypto: the real generator answers null, never a constant id.
  assert.equal(m.replyUuid(), null);
});

test("text bounds follow the route (trim, 1–4000)", () => {
  assert.equal(m.replyText("  ok \n"), "ok");
  assert.equal(m.replyText(" \t\n "), null);
  assert.equal(m.replyText("x".repeat(4000))?.length, 4000);
  assert.equal(m.replyText("x".repeat(4001)), null);
});

test("conversation rule mirrors the server guard: artisan assigned and not cancelled", () => {
  assert.equal(m.conversationOpen({ artisan_id: ADMIN, status: "assigned" }), true);
  assert.equal(m.conversationOpen({ artisan_id: null, status: "requested" }), false);
  assert.equal(m.conversationOpen({ artisan_id: ADMIN, status: "cancelled" }), false);
  assert.equal(m.conversationOpen(undefined), false);
});

test("API client: same-origin no-store POST of the exact command; network failure is status 0", async () => {
  // Real Node realm (the vm harness exposes no AbortController).
  const real = await import("../../components/features/admin-messages/admin-reply-model");
  const calls: { url: string; init: RequestInit }[] = [];
  const api = real.createReplyApi((async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(reply), { status: 200, headers: { "Retry-After": "2" } });
  }) as typeof fetch);
  const r = await api.send(cmd);
  assert.equal(r.status, 200);
  assert.equal(calls[0].url, "/api/admin/messages");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(r.retryAfter, 2);
  assert.equal(calls[0].init.cache, "no-store");
  assert.equal(calls[0].init.credentials, "same-origin");
  assert.equal(calls[0].init.body, J(cmd));
  const down = real.createReplyApi((async () => {
    throw new Error("offline");
  }) as typeof fetch);
  assert.equal((await down.send(cmd)).status, 0);
});

test("thread merge: confirmed replies appear once, other dossiers excluded, oldest first", () => {
  const a = { id: "a", intervention_id: DOSSIER, author_id: ADMIN, body: "1", created_at: "2026-11-06T10:00:00Z" };
  const other = { ...a, id: "o", intervention_id: ID2 };
  const sent = reply.message;
  assert.equal(J(m.mergeThread([sent, a, other], [sent], DOSSIER).map((x: { id: string }) => x.id)), J(["a", ID]));
});

test("component: demo and closed conversations never offer a send; open shows the composer", () => {
  const ctx = { generation: () => 1, userId: () => ADMIN };
  const base = { context: ctx, onSent: () => {}, onRefresh: () => {}, api: { send: async () => ({ status: 500, body: null, retryAfter: null }) } };
  const demo = renderToString(createElement(ui.AdminReplyComposer, { ...base, demo: true, intervention: { id: DOSSIER, artisan_id: ADMIN, status: "assigned" } }));
  assert.match(demo, /data-admin-reply="demo"/);
  assert.doesNotMatch(demo, /<textarea|type="submit"/);
  const closed = renderToString(createElement(ui.AdminReplyComposer, { ...base, demo: false, intervention: { id: DOSSIER, artisan_id: null, status: "requested" } }));
  assert.match(closed, /data-admin-reply="closed"/);
  assert.doesNotMatch(closed, /<textarea/);
  const open = renderToString(createElement(ui.AdminReplyComposer, { ...base, demo: false, intervention: { id: DOSSIER, artisan_id: ADMIN, status: "assigned" } }));
  assert.match(open, /data-admin-reply="open"/);
  assert.match(open, /<textarea/);
  assert.match(open, /Envoyer/);
});

test("admin dossier thread mounts the composer (ADM-07 block removed) and merges confirmed replies", () => {
  const src = readFileSync("components/role/admin-space.tsx", "utf8");
  assert.doesNotMatch(src, /blocker="ADM-07"/);
  assert.match(src, /<AdminReplyComposer\s+key=\{`\$\{id\}:\$\{session\.mutationContext\.userId\(\) \?\? "anon"\}:\$\{session\.mutationContext\.generation\(\)\}`\}\s+intervention=\{intervention\}\s+demo=\{demo\}\s+context=\{session\.mutationContext\}/);
  // ADM-07 thread source (claude/admin-reassign-thread-ui): demo keeps the workspace merge, live reads
  // the paginated /api/messages (useAdminThread) and merges the confirmed replies there.
  assert.match(src, /const messages = demo\s*\? mergeThread\(session\.data\.messages, sentReplies, id\)/);
  assert.match(src, /useAdminThread\(session\.mutationContext, id, sentReplies, !demo\)/);
  assert.match(src, /setSentReplies\(\(list\) => \[\.\.\.list, message\]\);\s+void sessionRef\.current\.ensureFresh\(\);/);
});

test("negative: a well-formed reply authored by another identity is never a success", () => {
  const OTHER = "55555555-5555-4555-8555-555555555555";
  const foreign = { message: { ...reply.message, author_id: OTHER } };
  assert.equal(m.replyOutcome({ status: 200, body: foreign, retryAfter: null }, cmd, ADMIN).kind, "retry");
  assert.equal(m.parseReply(foreign, cmd, ADMIN), null);
});

test("negative: no captured identity (signed out mid-flight) → reply not accepted", () => {
  assert.equal(m.parseReply(reply, cmd, null), null);
  assert.equal(m.replyOutcome({ status: 200, body: reply, retryAfter: null }, cmd, null).kind, "retry");
  const ui = readFileSync("components/features/admin-messages/admin-reply.tsx", "utf8");
  assert.match(ui, /const outcome = replyOutcome\(result, command, uid\);/);
});
