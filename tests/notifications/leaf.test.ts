import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { harness } from "../planning/harness";
import { applyMark, bellLabel, reducePage, scopeKey, type LeafScope, type ListState, type NotificationsClient } from "../../lib/features/notifications/leaf";
import { DEMO_NOTIFICATIONS, demoNotificationPage, demoPreferences } from "../../lib/features/notifications/demo";

const scope = (over: Partial<LeafScope> = {}): LeafScope => ({ userId: "client-a", role: "client", authority: { canWrite: true }, ...over });
function trackingClient(): NotificationsClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    list: async () => { calls.push("list"); return null; },
    summary: async () => { calls.push("summary"); return null; },
    mark: async () => { calls.push("mark"); return null; },
    loadPreferences: async () => { calls.push("loadPreferences"); return null; },
    savePreferences: async () => { calls.push("savePreferences"); return null; },
  };
}
function render(file: string, name: string, props: Record<string, unknown>) {
  const h = harness();
  const module = h.load(file) as Record<string, (p: unknown) => unknown>;
  return renderToString(createElement(module[name] as never, props as never)).replaceAll("<!-- -->", "");
}
const demo = { page: demoNotificationPage({}), preferences: demoPreferences() };

test("page and mark reducers ignore stale answers and refusals, apply only confirmed results", () => {
  const loading: ListState = { status: "loading", items: [] };
  assert.equal(reducePage(loading, null, false), loading);
  const first = reducePage(loading, demo.page, false);
  assert.equal(first.status, "ready"); assert.equal(first.items.length, 3);
  const appended = reducePage(first, { ...demo.page, notifications: [DEMO_NOTIFICATIONS[0], { ...DEMO_NOTIFICATIONS[0], id: "demo-n9" }] }, true);
  assert.deepEqual(appended.items.map((n) => n.id), ["demo-n1", "demo-n2", "demo-n3", "demo-n9"]);
  const items = first.items;
  const stale = applyMark(items, { action: "mark_read", ids: ["demo-n1"] }, null, "2026-11-02T13:00:00Z");
  assert.equal(stale.items, items); assert.equal(stale.unread, null); assert.equal(stale.message, null);
  const refused = applyMark(items, { action: "mark_read", ids: ["demo-n1"] }, { ok: false, conflict: false, message: "Accès refusé" }, "2026-11-02T13:00:00Z");
  assert.equal(refused.items, items); assert.equal(refused.message, "Accès refusé");
  const read = applyMark(items, { action: "mark_read", ids: ["demo-n1"] }, { ok: true, result: { updated: 1, unread_count: 1 } }, "2026-11-02T13:00:00Z");
  assert.equal(read.items[0].read_at, "2026-11-02T13:00:00Z"); assert.equal(read.items[1].read_at, null); assert.equal(read.unread, 1);
  const unread = applyMark(read.items, { action: "mark_unread", ids: ["demo-n1"] }, { ok: true, result: { updated: 1, unread_count: 2 } }, "2026-11-02T13:00:00Z");
  assert.equal(unread.items[0].read_at, null);
  const all = applyMark(items, { action: "mark_all_read", before: items[0].created_at }, { ok: true, result: { updated: 2, unread_count: 0 } }, "2026-11-02T13:00:00Z");
  assert.ok(all.items.every((n) => n.read_at)); assert.equal(all.items[2].read_at, DEMO_NOTIFICATIONS[2].read_at, "already read keeps its timestamp");
});
test("bell label and count never state a number the server did not give", () => {
  assert.equal(bellLabel(null, "available"), "Notifications");
  assert.equal(bellLabel(0, "available"), "Notifications, aucune non lue");
  assert.equal(bellLabel(1, "available"), "Notifications, 1 non lue");
  assert.equal(bellLabel(3, "available"), "Notifications, 3 non lues");
  assert.equal(bellLabel(3, "missing"), "Notifications (indisponibles)");
  const live = render("components/features/notifications/notification-bell.tsx", "NotificationBell", { state: "available", unreadCount: 120, onOpen: () => {} });
  assert.match(live, /aria-label="Notifications, 120 non lues"/); assert.match(live, />99\+</); assert.doesNotMatch(live, /disabled/);
  const off = render("components/features/notifications/notification-bell.tsx", "NotificationBell", { state: "unavailable", unreadCount: 5, onOpen: () => {} });
  assert.match(off, /disabled/); assert.match(off, /indisponibles/); assert.doesNotMatch(off, />5</);
  const none = render("components/features/notifications/notification-bell.tsx", "NotificationBell", { state: "available", unreadCount: null, onOpen: () => {} });
  assert.doesNotMatch(none, /bellCount/);
});
test("centre renders unavailable, read-only and demo states without touching the client", () => {
  const client = trackingClient();
  const missing = render("components/features/notifications/notification-center.tsx", "NotificationCenter", { state: "missing", unavailableMessage: "Fonction non activée.", scope: scope(), client });
  assert.match(missing, /Fonction non activée\./); assert.doesNotMatch(missing, /Toutes|Préférences/);
  const readOnly = render("components/features/notifications/notification-center.tsx", "NotificationCenter", { state: "available", unavailableMessage: "", scope: scope({ authority: { canWrite: false, reason: "Accès en consultation." } }), client, demo });
  assert.match(readOnly, /Lecture seule/); assert.match(readOnly, /Accès en consultation\./);
  assert.doesNotMatch(readOnly, /Marquer comme lue|Tout marquer lu/);
  assert.match(readOnly, /Rendez-vous enregistré/); assert.match(readOnly, /Non lue/);
  const live = render("components/features/notifications/notification-center.tsx", "NotificationCenter", { state: "available", unavailableMessage: "", scope: scope(), client, demo });
  assert.match(live, /Démonstration/); assert.doesNotMatch(live, /Marquer comme lue/, "demo data is never marked");
  assert.match(live, /3 notifications/); assert.doesNotMatch(live, /n’est envoyé/, "no global claim about external sends");
  assert.deepEqual(client.calls, []);
  assert.equal(scopeKey(scope()), "client-a||");
});
test("demo preferences report every external channel unavailable", () => {
  const prefs = demoPreferences();
  assert.equal(prefs.channels.email, "unavailable"); assert.equal(prefs.channels.sms, "unavailable"); assert.equal(prefs.channels.push, "unavailable"); assert.equal(prefs.channels.in_app, "available");
  assert.ok(prefs.kinds.length >= 20);
});
