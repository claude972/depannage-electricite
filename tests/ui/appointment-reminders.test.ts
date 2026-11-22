// Appointment reminder leaf: real server states (only promised for the current slot), explicit
// local instant before the appointment, identity-fenced commands (key uid + generation, read-back
// or 0 POST, strict restore, no replay after identity change, 401/403 clear), 409 honest, 503 same
// command, no external channel / exact-minute promise, demo zero calls.
import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { loadModule } from "../documents/harness";
import type * as Model from "../../components/features/appointment-reminders/model";
import type * as Panel from "../../components/features/appointment-reminders/appointment-reminder-panel";

const m = loadModule("components/features/appointment-reminders/model.ts") as unknown as typeof Model;
const p = loadModule("components/features/appointment-reminders/appointment-reminder-panel.tsx") as unknown as typeof Panel;
const json = (v: unknown) => JSON.parse(JSON.stringify(v));
const html = (el: unknown) => renderToString(el as never).replace(/<!-- -->/g, "");
const JOB = "20000000-0000-4000-8000-000000000001";
const REC = "30000000-0000-4000-8000-000000000001";
const C1 = "40000000-0000-4000-8000-000000000001", C2 = "40000000-0000-4000-8000-000000000002";
const APPT = { version: 2, starts_at: "2026-11-10T14:00:00Z", ends_at: "2026-11-10T16:00:00Z" };
const record = (o: Record<string, unknown> = {}) => ({ id: REC, intervention_id: JOB, appointment_version: 2, starts_at: APPT.starts_at, ends_at: APPT.ends_at, remind_at: "2026-11-10T12:00:00Z", version: 1, status: "scheduled", notification_id: null, processed_at: null, updated_at: "2026-11-07T10:00:00Z", ...o });
const stateOf = (o: Record<string, unknown> = {}) => ({ intervention_id: JOB, appointment: APPT, record: null, can_schedule: true, eligibility: "available", scheduled_for_current_slot: false, ...o });

function harness(opts: { replies?: Model.Result[]; store?: Model.Store | null; ctx?: { uid: string | null; gen: number }; data?: unknown; onCommand?: () => void } = {}) {
  const ctx = opts.ctx ?? { uid: "client-1", gen: 1 };
  const mem = new Map<string, string>();
  const store: Model.Store = { get: (k) => mem.get(k) ?? null, set: (k, v) => void mem.set(k, v), remove: (k) => void mem.delete(k) };
  const posts: unknown[] = [];
  let current: unknown = opts.data ?? stateOf();
  let v: Model.View = { ...m.VIEW_INITIAL };
  const ids = [C1, C2];
  const c = m.createReminderController({
    interventionId: JOB,
    api: () => ({ load: async (): Promise<Model.Result> => ({ status: 200, body: current }), command: async (b) => { posts.push(json(b)); opts.onCommand?.(); return (opts.replies ?? []).shift() ?? { status: 503, body: null }; } }),
    store: () => (opts.store === undefined ? store : opts.store),
    newId: () => ids.shift() ?? null,
    context: { userId: () => ctx.uid, generation: () => ctx.gen },
    get: () => v,
    set: (n) => { v = n; },
  });
  return { c, posts, mem, ctx, get: () => v, setData: (d: unknown) => { current = d; } };
}

test("états réels : programmé (seulement pour le créneau actuel), envoyé, coupé, invalidé, expiré, annulé ; éligibilité", () => {
  const render = (data: unknown) => html(createElement(p.AppointmentReminderPanel as never, { interventionId: JOB, role: "client", context: { userId: () => "c", generation: () => 1 }, initial: { ...m.VIEW_INITIAL, phase: "ready", data: m.parseState(data, JOB) } } as never));
  const current = render(stateOf({ record: record(), scheduled_for_current_slot: true }));
  assert.match(current, /data-reminder-status="scheduled"[^>]*data-reminder-current="true"/);
  assert.match(current, /Rappel prévu vers \d{2}:\d{2}, sans garantie à la minute\./);
  assert.match(current, /aucun SMS, e-mail ni notification externe/);
  const stale = render(stateOf({ record: record({ appointment_version: 1 }), scheduled_for_current_slot: false }));
  assert.match(stale, /ancien créneau : le rendez-vous a changé et ce rappel ne sera pas envoyé/);
  assert.doesNotMatch(stale, /Rappel prévu vers/, "no promise from the stored state alone");
  for (const [status, text] of [["sent", /centre de notifications \(ce n’est pas une preuve de lecture\)/], ["muted", /préférences de notification/], ["invalidated", /annulé automatiquement/], ["expired", /aucun envoi tardif/], ["cancelled", /annulé par vous/]] as const) {
    const out = render(stateOf({ record: record({ status, processed_at: "2026-11-10T12:00:30Z", notification_id: status === "sent" ? "50000000-0000-4000-8000-000000000001" : null }) }));
    assert.match(out, text, status);
    assert.doesNotMatch(out, /data-reminder-cancel/, `${status}: nothing to cancel`);
  }
  assert.match(render(stateOf({ appointment: null, can_schedule: false, eligibility: "no_appointment" })), /Aucun rendez-vous enregistré/);
  assert.match(render(stateOf({ can_schedule: false, eligibility: "elapsed" })), /Le créneau a déjà commencé/);
  assert.doesNotMatch(render(stateOf({ can_schedule: false, eligibility: "closed" })), /data-reminder-form/);
  assert.equal(m.parseState(stateOf({ intervention_id: "20000000-0000-4000-8000-000000000999" }), JOB), null, "another dossier ⇒ error");
});

test("horaire local explicite (fuseau affiché), futur et avant le début du rendez-vous", () => {
  const inst = m.localToInstant("2026-11-10", "09:30");
  assert.match(String(inst), /^2026-11-10T09:30:00[+-]\d{2}:\d{2}$/);
  assert.equal(m.localToInstant("2026-11-10", "9h"), null);
  const now = Date.parse("2026-11-07T10:00:00Z");
  assert.equal(m.remindAtAllowed("2026-11-10T13:59:00Z", APPT.starts_at, now), true);
  assert.equal(m.remindAtAllowed("2026-11-10T14:00:00Z", APPT.starts_at, now), false, "not at / after the start");
  assert.equal(m.remindAtAllowed("2026-11-07T09:00:00Z", APPT.starts_at, now), false, "not in the past");
  const form = html(createElement(p.AppointmentReminderPanel as never, { interventionId: JOB, role: "artisan", context: { userId: () => "a", generation: () => 1 }, initial: { ...m.VIEW_INITIAL, phase: "ready", data: m.parseState(stateOf(), JOB) } } as never));
  assert.match(form, /heure locale \([^)]+\), avant le début du rendez-vous/);
});

test("programmer : commande stricte, clé uid+génération écrite et relue AVANT le POST ; 503 ⇒ même commande", async () => {
  const h = harness({ replies: [{ status: 503, body: null }, { status: 200, body: { record: record(), replayed: false } }] });
  await h.c.load();
  await h.c.schedule("2026-11-10T12:00:00Z");
  assert.deepEqual(h.posts[0], { command_id: C1, action: "schedule", expected_version: null, appointment_version: 2, remind_at: "2026-11-10T12:00:00Z" });
  assert.ok(h.mem.has(m.pendingKey(JOB, "client-1", 1)));
  assert.equal(h.get().error, m.COPY.retry);
  await h.c.retry();
  assert.deepEqual(h.posts[1], h.posts[0], "identical replay");
  assert.equal(h.mem.size, 0, "cleared after the verified receipt");
  // Storage refused / throws / read-back differs ⇒ nothing sent.
  for (const store of [null, { get: () => { throw new Error("x"); }, set: () => { throw new Error("x"); }, remove: () => {} }, { get: () => "autre", set: () => {}, remove: () => {} }] as Model.Store[]) {
    const g = harness({ store });
    await g.c.load();
    assert.equal(await g.c.schedule("2026-11-10T12:00:00Z"), false);
    assert.equal(g.posts.length, 0);
    assert.equal(g.get().error, m.COPY.storage);
  }
});

test("annuler puis reprendre : versions attendues exactes ; 409 honnête sans relance", async () => {
  const h = harness({ data: stateOf({ record: record({ version: 3 }), scheduled_for_current_slot: true }), replies: [{ status: 200, body: { record: record({ version: 4, status: "cancelled", processed_at: "2026-11-07T10:05:00Z" }), replayed: false } }] });
  await h.c.load();
  await h.c.cancel();
  assert.deepEqual(h.posts[0], { command_id: C1, action: "cancel", expected_version: 3 });
  h.setData(stateOf({ record: record({ version: 4, status: "cancelled", processed_at: "2026-11-07T10:05:00Z" }) }));
  await h.c.load();
  const k = harness({ data: stateOf({ record: record({ version: 4, status: "cancelled", processed_at: "2026-11-07T10:05:00Z" }) }), replies: [{ status: 409, body: { error: "x" } }] });
  await k.c.load();
  await k.c.schedule("2026-11-10T12:30:00Z");
  assert.equal((k.posts[0] as { expected_version: number }).expected_version, 4, "resume = new intent on the current version");
  assert.equal(k.get().error, m.COPY.conflict);
  assert.equal(await k.c.retry(), false);
  assert.equal(k.posts.length, 1, "never replayed after 409");
});

test("identité : restauration stricte, jamais de relance sous une autre identité, réponse tardive ignorée, 401/403 effacent", async () => {
  const valid = JSON.stringify({ uid: "client-1", gen: 1, intervention_id: JOB, command: { command_id: C1, action: "cancel", expected_version: 2 } });
  for (const [raw, restored] of [[valid, true], ["{", false], [JSON.stringify({ uid: "client-1", gen: 1, intervention_id: JOB, command: { action: "cancel" } }), false], [JSON.stringify({ uid: "other", gen: 1, intervention_id: JOB, command: { command_id: C1, action: "cancel", expected_version: 2 } }), false]] as const) {
    const h = harness();
    h.mem.set(m.pendingKey(JOB, "client-1", 1), raw);
    h.c.restorePending();
    assert.equal(Boolean(h.get().pending), restored, raw);
    assert.equal(h.posts.length, 0, "never sent automatically");
  }
  const g = harness({ replies: [{ status: 0, body: null }] });
  await g.c.load();
  await g.c.schedule("2026-11-10T12:00:00Z");
  g.ctx.gen = 2;
  assert.equal(await g.c.retry(), false);
  assert.equal(g.posts.length, 1);
  const late = harness({ replies: [{ status: 200, body: { record: record(), replayed: false } }], onCommand: () => { late.ctx.uid = "client-2"; } });
  await late.c.load();
  assert.equal(await late.c.schedule("2026-11-10T12:00:00Z"), false);
  assert.notEqual(late.get().notice, "Rappel enregistré.");
  for (const status of [401, 403]) {
    const f = harness({ replies: [{ status, body: null }] });
    await f.c.load();
    await f.c.schedule("2026-11-10T12:00:00Z");
    assert.equal(f.get().phase, "forbidden");
    assert.equal(f.get().data, null);
    assert.equal(f.mem.size, 0);
  }
  assert.equal(m.verifyReceipt({ record: record({ version: 2 }), replayed: false }, { command_id: C1, action: "schedule", expected_version: null, appointment_version: 2, remind_at: "2026-11-10T12:00:00Z" } as never, JOB), false, "unexpected version ⇒ not a success");
});

test("démo : aucun appel, message honnête", () => {
  let calls = 0;
  const out = html(createElement(p.AppointmentReminderPanel as never, { interventionId: JOB, role: "client", demo: true, context: { userId: () => "c", generation: () => 1 }, api: { load: async () => (calls++, { status: 200, body: null }), command: async () => (calls++, { status: 200, body: null }) } } as never));
  assert.match(out, /data-appointment-reminder="demo"/);
  assert.match(out, /aucun rappel n’est programmé ni envoyé/);
  assert.equal(calls, 0);
});
