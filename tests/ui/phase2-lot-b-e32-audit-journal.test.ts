// E32 (registre phase 2) — ADM-09 : journal inaccessible depuis l’interface au rôle auditeur. Un compte
// qui a seulement la capacité `audit` (réponse /me) doit voir une entrée « Journal d’audit » et la vue
// doit lire le journal paginé (GET audit) ; sans la capacité, ni entrée ni lecture.
// Vraie PlatformPage montée (Chromium) avec la décision d’entrées réelle (platformEntries), client
// plateforme simulé.
import test from "node:test";
import assert from "node:assert/strict";
import { PRELUDE, skip, withScenarios } from "./phase2-lot-b-harness";

const ENTRY = `
import { createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { PlatformPage } from "./components/role/platform-anchor";
import { platformEntries } from "./components/role/anchors";
import { createPlatformClient } from "./components/app/features";
import { ApiRequestError } from "./components/app/api";
${PRELUDE}
const caps = (audit) => ({ support: false, support_reply: false, support_status: false, operators: false, audit, finance: false, reviews_moderation: false, refund_execution: false, invoice_rendering: false });
const access = (audit) => ({ super_admin: false, scopes: audit ? ["audit_read"] : [], super_admin_count: null, capabilities: caps(audit), config: { commission: { setting_bps: null, setting_version: null, checkout_bps: null, aligned: null }, payment_provider: { configured: false, mode: null, live_enabled: false }, invoice_issuer: { configured: false } } });
window.auditReads = [];
const entry = (n) => ({ id: n, actor_id: "f0000000-0000-4000-8000-000000000001", action: "operator_scope_granted", target_kind: "operator_scope", target_id: "e0000000-0000-4000-8000-00000000000" + n, details: {}, created_at: "2026-11-0" + n + "T10:00:00+00:00" });
const client = { load: { me: async () => access(true), audit: async (q) => { window.auditReads.push(q ?? null); return q && q.cursor ? { entries: [entry(3)], page: { limit: 25, total: 3, has_more: false, next_cursor: null } } : { entries: [entry(1), entry(2)], page: { limit: 25, total: 3, has_more: true, next_cursor: "c1" } }; } }, command: {} };
const session = (audit) => new Proxy({ mode: "live", role: "client", profileId: "c0000000-0000-4000-8000-000000000001", capabilities: { platformOperations: "available" }, platformAccess: access(audit), features: { platform: client }, mutationContext: { generation: () => 1, userId: () => "c0000000-0000-4000-8000-000000000001" } }, { get: (t, k) => (k in t ? t[k] : typeof k === "string" ? () => {} : undefined) });
window.scenarios = {
  async leafState() {
    const states = [];
    const c = createPlatformClient({ generation: () => 1, setState: (k, s) => states.push(k + ":" + s), request: async (path) => { if (path.includes("/audit")) throw new ApiRequestError(503, "Indisponible."); return {}; } });
    let error = "";
    try { await c.load.audit({ cursor: "c1", limit: 25 }); } catch (e) { error = String(e.status); }
    return { states, error };
  },
  async pageErrors() {
    let mode = "ok"; const reads = []; let meReads = 0;
    const cl = { load: {
      me: async () => { meReads++; return mode === "revoked" ? access(false) : access(true); },
      audit: async (q) => { reads.push(q && q.cursor); if (q && q.cursor && mode === "down") throw new ApiRequestError(503, "Journal momentanément indisponible."); if (q && q.cursor && mode === "revoked") throw new ApiRequestError(403, "Accès refusé."); return q && q.cursor ? { entries: [entry(3)], page: { limit: 25, total: 3, has_more: false, next_cursor: null } } : { entries: [entry(1), entry(2)], page: { limit: 25, total: 3, has_more: true, next_cursor: "c1" } }; },
    }, command: {} };
    const s2 = new Proxy({ mode: "live", role: "client", profileId: "c0000000-0000-4000-8000-000000000001", capabilities: { platformOperations: "available" }, platformAccess: access(true), features: { platform: cl }, mutationContext: { generation: () => 1, userId: () => "c0000000-0000-4000-8000-000000000001" } }, { get: (t, k) => (k in t ? t[k] : typeof k === "string" ? () => {} : undefined) });
    const div = mountPoint();
    createRoot(div).render(h(PlatformPage, { session: s2, view: "platform-audit" }));
    await until(() => div.querySelectorAll("[data-audit-entry]").length === 2);
    mode = "down"; btn(div, "Suivant").click();
    await until(() => /momentanément indisponible/.test(txt(div)));
    const down = { alert: /momentanément indisponible/.test(txt(div)), retry: !!btn(div, "Réessayer"), prev: !!(btn(div, "Précédent") && !btn(div, "Précédent").disabled), next: !!(btn(div, "Suivant") && !btn(div, "Suivant").disabled) };
    mode = "ok"; btn(div, "Réessayer").click();
    await until(() => div.querySelectorAll("[data-audit-entry]").length === 1);
    const retried = { rows: div.querySelectorAll("[data-audit-entry]").length, sameCursor: reads[reads.length - 1] === "c1" };
    const meBefore = meReads;
    mode = "revoked"; btn(div, "Précédent").click(); await until(() => div.querySelectorAll("[data-audit-entry]").length === 2);
    btn(div, "Suivant").click(); await tick(400);
    return { down, retried, meReread: meReads - meBefore, rows: div.querySelectorAll("[data-audit-entry]").length, forbidden: /nécessite l’habilitation/.test(txt(div)) };
  },
  async entries() {
    return { auditor: platformEntries(access(true), () => true).map((e) => e.view), none: platformEntries(access(false), () => true).map((e) => e.view) };
  },
  async view() {
    const div = mountPoint();
    createRoot(div).render(h(PlatformPage, { session: session(true), view: "platform-audit" }));
    await until(() => /operator_scope_granted|Habilitation accordée|e0000000/.test(txt(div)), 2000);
    const first = div.querySelectorAll("[data-audit-entry]").length;
    btn(div, "Suivant")?.click();
    await until(() => window.auditReads.length >= 2, 1000);
    await tick(100);
    return { first, reads: window.auditReads, text: txt(div).slice(0, 300) };
  },
};
`;

test("E32 · capacité audit seule ⇒ entrée « Journal d’audit » et lecture paginée du journal", { skip }, async () => {
  await withScenarios(ENTRY, async (run, { errors }) => {
    const e = await run("entries") as { auditor: string[]; none: string[] };
    assert.ok(e.auditor.includes("platform-audit"), `entrée proposée à l’auditeur (${e.auditor.join(",")})`);
    assert.ok(!e.none.includes("platform-audit"), "aucune entrée sans capacité");
    const v = await run("view") as { first: number; reads: unknown[]; text: string };
    assert.equal(v.first, 2, `entrées du journal affichées (${v.text})`);
    assert.ok(v.reads.length >= 2, "page suivante lue");
    assert.deepEqual(errors, []);
  }, 1280);
});

test("E32 · contre-revue : 503 de page visible (Réessayer, Précédent atteignable, Suivant neutralisé) ; reprise même curseur ; 403 ⇒ droits relus et purge ; lecture feuille sans impact global", { skip }, async () => {
  await withScenarios(ENTRY, async (run, { errors }) => {
    const leaf = await run("leafState") as { states: string[]; error: string };
    assert.equal(leaf.error, "503");
    assert.deepEqual(leaf.states, [], "aucun changement d’état global du module sur une erreur de page du journal");
    const r = await run("pageErrors") as { down: { alert: boolean; retry: boolean; prev: boolean; next: boolean }; retried: { rows: number; sameCursor: boolean }; meReread: number; rows: number; forbidden: boolean };
    assert.deepEqual(r.down, { alert: true, retry: true, prev: true, next: false });
    assert.deepEqual(r.retried, { rows: 1, sameCursor: true });
    assert.ok(r.meReread >= 1, "refus de page ⇒ /me relu");
    assert.equal(r.rows, 0, "lignes purgées");
    assert.equal(r.forbidden, true, "droits relus : plus d’accès au journal");
    assert.deepEqual(errors, []);
  }, 1280);
});
