// Operational reminders (Astra eb138d6 contract copied strictly), separate from appointment reminders.
// Exact paths; state/eligibility/status shown exactly as returned; explicit Martinique date + time
// strictly before the due day; schedule/cancel fenced under courant-private-op-reminders:<uid>:<gen>:<kind>:<id>
// (read-back or 0 POST, strict restore, identity change ⇒ dropped, 401/403/404 clear, 409 honest +
// reload, 503/429/lost ⇒ same command, replayed ⇒ reload); no external-channel / delivery wording;
// demo zero calls; artisan wiring (minimal) + compliance entry point exported.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { loadModule } from "../documents/harness";
import type * as Model from "../../components/features/operational-reminders/model";
import type * as Panel from "../../components/features/operational-reminders/operational-reminder-panel";

const m = loadModule("components/features/operational-reminders/model.ts") as unknown as typeof Model;
const p = loadModule("components/features/operational-reminders/operational-reminder-panel.tsx") as unknown as typeof Panel;
const UID = "10000000-0000-4000-8000-0000000000ab";
const CRED = "60000000-0000-4000-8000-000000000001";
const U = (n: number) => `70000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const NOW = Date.parse("2026-11-07T12:00:00Z");
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const record = (o: Partial<Record<string, unknown>> = {}) => ({ id: U(900), kind: "credential", record_id: CRED, source_version: 2, due_on: "2026-12-31", remind_at: "2026-12-20T09:00:00-04:00", version: 1, status: "scheduled", notification_id: null, processed_at: null, updated_at: "2026-11-07T10:00:00Z", ...o });
const stateOf = (o: Partial<Record<string, unknown>> = {}) => ({ kind: "credential", record_id: CRED, source: { version: 2, due_on: "2026-12-31" }, record: null, eligibility: "available", can_schedule: true, scheduled_for_current_source: false, ...o });

test("contrat partagé avec le serveur et chemins exacts", () => {
  assert.match(readFileSync("components/features/operational-reminders/model.ts", "utf8"), /lib\/features\/operational-reminders\/contract/);
  assert.equal(m.reminderPath("credential", CRED), `/api/artisan/credentials/${CRED}/reminder`);
  assert.equal(m.reminderPath("compliance", CRED), `/api/compliance/${CRED}/reminder`);
});

test("état strict (même type, même dossier) ; reçu = exactement la commande", () => {
  assert.ok(m.parseState(stateOf(), "credential", CRED));
  assert.equal(m.parseState(stateOf(), "compliance", CRED), null);
  assert.equal(m.parseState(stateOf({ record_id: U(1) }), "credential", CRED), null);
  assert.equal(m.parseState(stateOf({ can_schedule: true, eligibility: "no_date" }), "credential", CRED), null);
  assert.equal(m.parseState(stateOf({ record: record({ status: "sent", processed_at: null }) }), "credential", CRED), null, "processed_at iff not scheduled");
  const cmd = { action: "schedule" as const, command_id: U(1), expected_version: null, source_version: 2, due_on: "2026-12-31", remind_at: "2026-12-20T09:00:00-04:00" };
  assert.ok(m.parseReceipt({ record: record({ remind_at: "2026-12-20T13:00:00Z" }), replayed: false }, "credential", CRED, cmd), "same instant");
  assert.equal(m.parseReceipt({ record: record({ remind_at: "2026-12-20T10:00:00-04:00" }), replayed: false }, "credential", CRED, cmd), null);
  assert.equal(m.parseReceipt({ record: record({ version: 2 }), replayed: false }, "credential", CRED, cmd), null);
});

test("moment explicite en heure de Martinique, futur, strictement avant le jour de l’échéance", () => {
  assert.equal(m.martiniqueInstant("2026-12-30", "23:30"), "2026-12-30T23:30:00-04:00");
  assert.equal(m.martiniqueDay("2026-12-31T03:30:00Z"), "2026-12-30");
  assert.equal(JSON.stringify(m.validateRemindAt("2026-12-30", "23:30", "2026-12-31", NOW)), JSON.stringify({ remind_at: "2026-12-30T23:30:00-04:00" }));
  assert.ok("error" in m.validateRemindAt("2026-12-31", "08:00", "2026-12-31", NOW), "due day refused");
  assert.ok("error" in m.validateRemindAt("2026-11-01", "08:00", "2026-12-31", NOW), "past refused");
  assert.equal((m.validateRemindAt("", "", "2026-12-31", NOW) as { error: string }).error, m.COPY.pickBoth, "nothing proposed");
});

test("libellés : état exact, aucune promesse d’envoi, aucun canal externe", () => {
  const all = [m.COPY.intro, ...Object.values(m.COPY).filter((v) => typeof v === "string"), ...Object.values(m.STATUS).map((f) => f(record({ status: "sent", processed_at: "2026-12-20T13:00:05Z" }) as never)), ...Object.values(m.ELIGIBILITY).map((f) => f("2026-12-31"))].join(" | ");
  assert.doesNotMatch(all, /e-?mail|sms|push|courriel|texto|WhatsApp/i, "no external channel");
  assert.doesNotMatch(all, /vous serez (prévenu|averti|notifié)|sera (envoyé|émis)|garanti(e)? (d’|de )?(envoi|réception)/i, "never promises delivery");
  assert.match(m.COPY.intro, /ne garantit pas son émission/);
  assert.match(m.STATUS.sent(record({ status: "sent", processed_at: "2026-12-20T13:00:05Z" }) as never), /Notification interne créée[\s\S]*ne signifie pas qu’elle a été lue/);
  assert.match(m.ELIGIBILITY.no_date(null), /aucune date n’est proposée automatiquement/);
  for (const s of ["scheduled", "cancelled", "sent", "invalidated", "expired", "muted"] as const) assert.ok(m.STATUS[s], s);
});

function memStore() {
  const map = new Map<string, string>();
  return { map, store: { get: (k: string) => map.get(k) ?? null, set: (k: string, v: string) => void map.set(k, v), remove: (k: string) => void map.delete(k) } as Model.Store };
}
function ctrl(reply: (method: string, body: unknown, n: number) => Response | Promise<Response>, o: { store?: Model.Store | null; ids?: string[]; ctx?: { uid: string | null; gen: number } } = {}) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const ctx = o.ctx ?? { uid: UID, gen: 1 };
  const ids = o.ids ?? [U(1), U(2), U(3)];
  const mem = memStore();
  const store = o.store === undefined ? mem.store : o.store;
  let view: Model.View = m.VIEW_INITIAL;
  const c = m.createReminder({
    kind: "credential",
    id: CRED,
    fetcher: () => (async (url: string, init: RequestInit) => {
      const body = init.body ? JSON.parse(String(init.body)) : null;
      calls.push({ method: String(init.method), url, body });
      return reply(String(init.method), body, calls.length);
    }) as unknown as typeof fetch,
    store: () => store,
    newId: () => ids.shift() ?? null,
    context: { generation: () => ctx.gen, userId: () => ctx.uid },
    now: () => NOW,
    get: () => view,
    set: (v) => (view = v),
  });
  return { c, calls, mem, ctx, view: () => view };
}
const KEY = () => m.pendingKey(UID, 1, "credential", CRED);
const scheduledReceipt = (body: { remind_at: string }, version = 1, replayed = false) => json({ record: record({ remind_at: body.remind_at, version }), replayed });

test("programmer : version null la 1re fois, source/date du GET, commande stockée et relue avant le POST, relecture", async () => {
  assert.equal(m.PENDING_PREFIX, "courant-private-op-reminders:");
  assert.equal(KEY(), `courant-private-op-reminders:${UID}:1:credential:${CRED}`);
  let stored: string | undefined;
  const h = ctrl((method, body) => {
    if (method === "GET") return json(stateOf());
    stored = h.mem.map.get(KEY());
    return scheduledReceipt(body as { remind_at: string });
  });
  await h.c.load();
  assert.equal(await h.c.schedule("2026-12-31", "08:00"), false, "due day refused locally");
  assert.equal(h.calls.length, 1, "no POST");
  assert.equal(await h.c.schedule("2026-12-20", "09:00"), true);
  const post = h.calls.find((x) => x.method === "POST")!;
  assert.equal(post.url, `/api/artisan/credentials/${CRED}/reminder`);
  assert.equal(JSON.stringify(post.body), JSON.stringify({ action: "schedule", command_id: U(1), expected_version: null, source_version: 2, due_on: "2026-12-31", remind_at: "2026-12-20T09:00:00-04:00" }));
  assert.equal(JSON.parse(stored!).command.command_id, U(1));
  assert.equal(h.mem.map.size, 0);
  assert.equal(h.view().notice, m.COPY.scheduled);
  assert.equal(h.calls[h.calls.length - 1].method, "GET");
});

test("annuler : version du rappel courant ; reprogrammer : version courante ; non éligible ⇒ 0 POST", async () => {
  const h = ctrl((method, body) => (method === "GET" ? json(stateOf({ record: record({ version: 3 }), scheduled_for_current_source: true })) : (body as { action: string }).action === "cancel" ? json({ record: record({ version: 4, status: "cancelled", processed_at: "2026-11-07T12:00:01Z" }), replayed: false }) : scheduledReceipt(body as { remind_at: string }, 4)));
  await h.c.load();
  await h.c.cancel();
  assert.equal(JSON.stringify(h.calls[1].body), JSON.stringify({ action: "cancel", command_id: U(1), expected_version: 3 }));
  assert.equal(h.view().notice, m.COPY.cancelled);
  await h.c.schedule("2026-12-21", "10:15");
  assert.equal((h.calls.filter((x) => x.method === "POST")[1].body as { expected_version: number }).expected_version, 3);
  for (const s of [stateOf({ eligibility: "no_date", can_schedule: false, source: { version: 1, due_on: null } }), stateOf({ eligibility: "elapsed", can_schedule: false }), stateOf({ eligibility: "closed", can_schedule: false })]) {
    const n = ctrl((method) => (method === "GET" ? json(s) : json({}, 500)));
    await n.c.load();
    await n.c.schedule("2026-12-20", "09:00");
    await n.c.cancel();
    assert.equal(n.calls.filter((x) => x.method === "POST").length, 0, "permissions as returned");
  }
});

test("rejoué ⇒ relecture ; stockage absent / relecture fausse / pas d’UUID ⇒ 0 POST", async () => {
  const r = ctrl((method, body) => (method === "GET" ? json(stateOf()) : scheduledReceipt(body as { remind_at: string }, 1, true)));
  await r.c.load();
  await r.c.schedule("2026-12-20", "09:00");
  assert.equal(r.view().notice, m.COPY.replayed);
  for (const store of [null, { get: () => null, set: () => {}, remove: () => {} } as Model.Store]) {
    const h = ctrl((method) => (method === "GET" ? json(stateOf()) : json({}, 500)), { store });
    await h.c.load();
    await h.c.schedule("2026-12-20", "09:00");
    assert.equal(h.calls.filter((x) => x.method === "POST").length, 0);
    assert.equal(h.view().error, m.COPY.storage);
  }
  const n = ctrl((method) => (method === "GET" ? json(stateOf()) : json({}, 500)), { ids: [] });
  await n.c.load();
  await n.c.schedule("2026-12-20", "09:00");
  assert.equal(n.calls.filter((x) => x.method === "POST").length, 0);
  assert.equal(n.view().error, m.COPY.noUuid);
});

test("503 + Retry-After / perdu ⇒ même commande ; 401/403/404 ⇒ effacé ; 409 ⇒ honnête + relecture, sans rejeu", async () => {
  const h = ctrl((method, body, n) => (method === "GET" ? json(stateOf()) : n === 2 ? json({}, 503, { "Retry-After": "2" }) : n === 3 ? Promise.reject(new TypeError("lost")) : scheduledReceipt(body as { remind_at: string })));
  await h.c.load();
  await h.c.schedule("2026-12-20", "09:00");
  assert.equal(h.view().waitS, 2);
  assert.ok(h.mem.map.has(KEY()));
  await h.c.retry();
  await h.c.retry();
  const posts = h.calls.filter((x) => x.method === "POST").map((x) => JSON.stringify(x.body));
  assert.equal(posts.length, 3);
  assert.equal(new Set(posts).size, 1);
  for (const status of [401, 403, 404]) {
    const f = ctrl((method) => (method === "GET" ? json(stateOf()) : json({}, status)));
    await f.c.load();
    await f.c.schedule("2026-12-20", "09:00");
    assert.equal(f.view().phase, "forbidden", String(status));
    assert.equal(f.view().data, null);
    assert.equal(f.mem.map.size, 0);
  }
  const k = ctrl((method) => (method === "GET" ? json(stateOf()) : json({}, 409)));
  await k.c.load();
  await k.c.schedule("2026-12-20", "09:00");
  assert.equal(k.view().error, m.COPY.conflict);
  assert.deepEqual(k.calls.map((x) => x.method), ["GET", "POST", "GET"]);
  assert.equal(await k.c.retry(), false);
});

test("changement d’identité pendant le POST ⇒ ignoré ; restauration stricte (uid, génération, type, dossier)", async () => {
  const shared = memStore();
  const h = ctrl((method) => {
    if (method === "GET") return json(stateOf());
    h.ctx.gen = 2;
    return json({}, 503);
  }, { store: shared.store });
  await h.c.load();
  await h.c.schedule("2026-12-20", "09:00");
  assert.equal(h.view().pending, null);
  assert.equal(await h.c.retry(), false);
  const g2 = ctrl(() => json(stateOf()), { store: shared.store, ctx: { uid: UID, gen: 2 } });
  g2.c.restorePending();
  assert.equal(g2.view().pending, null);
  const g1 = ctrl((method, body) => (method === "GET" ? json(stateOf()) : scheduledReceipt(body as { remind_at: string })), { store: shared.store });
  g1.c.restorePending();
  assert.equal(g1.view().pending!.command_id, U(1));
  await g1.c.retry();
  assert.equal((g1.calls[0].body as { command_id: string }).command_id, U(1));
  const t = memStore();
  t.store.set(KEY(), JSON.stringify({ uid: UID, gen: 1, kind: "compliance", record_id: CRED, command: { action: "cancel", command_id: U(9), expected_version: 1 } }));
  const tampered = ctrl(() => json(stateOf()), { store: t.store });
  tampered.c.restorePending();
  assert.equal(tampered.view().pending, null);
  assert.equal(t.map.size, 0);
});

test("démo : note honnête, aucun bouton ; montage artisan minimal ; point d’entrée conformité exporté", () => {
  const ctx = { generation: () => 1, userId: () => null };
  for (const el of [createElement(p.CredentialReminderPanel as never, { credentialId: CRED, context: ctx, demo: true } as never), createElement(p.ComplianceReminderPanel as never, { complianceId: CRED, context: ctx, demo: true } as never)]) {
    const html = renderToString(el);
    assert.match(html, /aucun rappel n’est lu ni programmé : aucun appel n’est fait/);
    assert.doesNotMatch(html, /<button|<input/);
  }
  const artisan = readFileSync("components/role/artisan-space.tsx", "utf8");
  assert.match(artisan, /import \{ CredentialReminderPanel \} from "\.\.\/features\/operational-reminders\/operational-reminder-panel";/);
  assert.match(artisan, /<CredentialReviewPanel credentialId=\{s\.state\.credential\.id\} mode="artisan" context=\{session\.mutationContext\} demo=\{session\.mode === "demo"\} onCurrentDecision=\{noteDecision\} \/>\s*<CredentialReminderPanel credentialId=\{s\.state\.credential\.id\} context=\{session\.mutationContext\} demo=\{session\.mode === "demo"\} \/>/);
  // Enterprise mount done by the enterprise-space owner: one panel per OPEN due date of the site.
  assert.match(readFileSync("components/role/enterprise-space.tsx", "utf8"), /\{r\.status !== "completed" && \(\s*<ComplianceReminderPanel complianceId=\{r\.id\} context=\{session\.mutationContext\} demo=\{session\.mode === "demo"\} \/>/);
  assert.ok(readFileSync("components/features/appointment-reminders/appointment-reminder-panel.tsx", "utf8").length > 0, "appointment reminders kept");
});
