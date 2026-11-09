// E54 / E55 / E56 (registre phase 2) — SYS-04 / CLI-09 : centre de notifications.
// E56 : 401 sur « Afficher les suivantes » ⇒ les 25 lignes et leur contenu sont purgés (P1).
// E55 : une lecture confirmée relit le résumé de la cloche (aucune valeur périmée).
// E54 : un 503 à la sauvegarde des préférences ne masque pas le centre ; la saisie est conservée.
// Vraie NotificationsPage (ancre) + vrai NotificationCenter + vrai client createNotificationsClient
// (bound/boundResult) montés en Chromium ; seul le transport `request` est simulé.
import test from "node:test";
import assert from "node:assert/strict";
import { PRELUDE, skip, withScenarios } from "./phase2-lot-b-harness";

const ENTRY = `
import { createElement as h, StrictMode, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { NotificationsPage } from "./components/role/notifications-anchor";
import { createNotificationsClient } from "./components/app/features";
import { ApiRequestError } from "./components/app/api";
${PRELUDE}
window.fetch = async () => new Response("{}", { status: 503 }); // nothing else may reach the network
const AT = "2026-11-07T10:00:00.000Z";
const row = (i) => ({ id: "n" + String(i).padStart(2, "0"), kind: "message_received", title: "Message " + i, body: "Contenu protégé " + i, intervention_id: null, organization_id: null, site_id: null, payload: {}, read_at: i <= 3 ? null : AT, created_at: new Date(Date.parse(AT) - i * 60000).toISOString() });
const prefs = { preferences: { muted_kinds: [], email_enabled: false, sms_enabled: false, push_enabled: false, version: 1 }, kinds: [{ kind: "message_received", label: "Nouveau message" }, { kind: "quote_received", label: "Devis reçu" }], channels: { in_app: "available", email: "unavailable", sms: "unavailable", push: "unavailable", reasons: { email: "x", sms: "x", push: "x" } }, channels_note: "Aucun envoi externe." };
function mount(server) {
  const div = mountPoint();
  const calls = { summary: 0 };
  function Host() {
    const [caps, setCaps] = useState({ notifications: "available" });
    const client = useMemo(() => createNotificationsClient({ generation: () => 1, setState: (k, s) => setCaps((c) => (c[k] === s ? c : { ...c, [k]: s })), request: server }), []);
    const session = new Proxy({
      mode: "live", role: "client", profileId: "c0000000-0000-4000-8000-000000000001", capabilities: caps,
      features: { notifications: client }, mutationContext: { generation: () => 1, userId: () => "c0000000-0000-4000-8000-000000000001" },
      reprobeFeature: async (key) => { if (key === "notifications") { calls.summary++; await client.summary(); } },
      openIntervention: () => {},
    }, { get: (t, k) => (k in t ? t[k] : typeof k === "string" ? () => null : undefined) });
    return h(NotificationsPage, { session });
  }
  createRoot(div).render(h(StrictMode, null, h(Host)));
  return { div, calls };
}
window.scenarios = {
  async e56() {
    let expired = false;
    const server = async (path) => {
      if (path.startsWith("/api/notifications?") || path === "/api/notifications") {
        if (path.includes("cursor=")) { if (expired) throw new ApiRequestError(401, "Connectez-vous pour accéder à cet espace."); }
        return { notifications: Array.from({ length: 25 }, (_, i) => row(i + 1)), page: { limit: 25, total: 30, has_more: true, next_cursor: "c1" }, unread_count: 3, filters: { unread: false } };
      }
      if (path === "/api/notifications/summary") return { unread_count: 3, latest_created_at: AT };
      throw new ApiRequestError(404, "x");
    };
    const { div } = mount(server);
    await until(() => /Message 25/.test(txt(div)));
    expired = true;
    btn(div, "Afficher les suivantes")?.click() ?? [...div.querySelectorAll("button")].find((b) => /suivantes|plus/i.test(b.textContent || ""))?.click();
    await tick(300);
    return { rows: (txt(div).match(/Contenu protégé/g) || []).length, more: !![...div.querySelectorAll("button")].find((b) => /suivantes|plus/i.test(b.textContent || "")) };
  },
  async e55() {
    let unread = 3;
    const server = async (path, body) => {
      if (path === "/api/notifications" && body) { unread = 2; return { updated: 1, unread_count: 2 }; }
      if (path.startsWith("/api/notifications?")) return { notifications: [row(1), row(2), row(3)], page: { limit: 25, total: 3, has_more: false, next_cursor: null }, unread_count: unread, filters: { unread: false } };
      if (path === "/api/notifications/summary") { window.summaryReads = (window.summaryReads || 0) + 1; return { unread_count: unread, latest_created_at: AT }; }
      throw new ApiRequestError(404, "x");
    };
    const { div, calls } = mount(server);
    await until(() => /Message 1/.test(txt(div)));
    const before = calls.summary;
    const markBtn = [...div.querySelectorAll("button")].find((b) => /Marquer comme lu/i.test(b.textContent || "") || /Marquer comme lu/i.test(b.getAttribute("aria-label") || ""));
    markBtn.click();
    await tick(300);
    return { summaryRereads: calls.summary - before };
  },
  async e54() {
    const server = async (path, body) => {
      if (path === "/api/notifications/preferences" && body) throw new ApiRequestError(503, "Service momentanément indisponible. Réessayez.");
      if (path === "/api/notifications/preferences") return prefs;
      if (path.startsWith("/api/notifications?")) return { notifications: [row(4)], page: { limit: 25, total: 1, has_more: false, next_cursor: null }, unread_count: 0, filters: { unread: false } };
      if (path === "/api/notifications/summary") return { unread_count: 0, latest_created_at: AT };
      throw new ApiRequestError(404, "x");
    };
    const { div } = mount(server);
    await until(() => btn(div, "Préférences"));
    btn(div, "Préférences").click();
    const prefLabel = () => [...div.querySelectorAll("form label")].find((l) => /Nouveau message/.test(l.textContent || "") && l.querySelector("input[type=checkbox]"));
    await until(() => prefLabel());
    const box = prefLabel().querySelector("input");
    box.click();
    await tick(20);
    btn(div, "Enregistrer").click();
    await tick(300);
    const again = prefLabel()?.querySelector("input");
    return { center: /Message 4/.test(txt(div)), form: !!again, unchecked: again ? again.checked === false : null, alert: txt(div.querySelector("[role=alert]")) };
  },
};
`;

test("E56 · 401 en pagination ⇒ lignes purgées, plus de bouton « suivantes »", { skip }, async () => {
  await withScenarios(ENTRY, async (run, { errors }) => {
    const r = await run("e56");
    assert.equal(r.rows, 0, `contenu purgé (lignes : ${r.rows})`);
    assert.equal(r.more, false);
    assert.deepEqual(errors, []);
  });
});

test("E55 · lecture confirmée ⇒ résumé de la cloche relu", { skip }, async () => {
  await withScenarios(ENTRY, async (run, { errors }) => {
    const r = await run("e55");
    assert.ok(r.summaryRereads >= 1, `résumé relu après la lecture confirmée (relectures : ${r.summaryRereads})`);
    assert.deepEqual(errors, []);
  });
});

test("E54 · 503 à la sauvegarde ⇒ centre et formulaire conservés, saisie gardée, erreur affichée", { skip }, async () => {
  await withScenarios(ENTRY, async (run, { errors }) => {
    const r = await run("e54");
    assert.equal(r.center, true, "le centre reste affiché");
    assert.equal(r.form, true, "le formulaire reste affiché");
    assert.equal(r.unchecked, true, "la modification saisie est conservée");
    assert.match(r.alert, /indisponible|Réessayez/i);
    assert.deepEqual(errors, []);
  });
});
