// E30 / E31 (registre phase 2) — ADM-09 : panneau des opérateurs.
// E30 : le rôle super administrateur est retiré ailleurs ; deux confirmations de révocation
//       répondaient 403 sans relecture. Attendu (P1) : le premier 403 relit /me et la liste ; /me
//       super_admin:false ⇒ nom, note et boutons purgés ; un seul POST.
// E31 : la vraie réponse porte `account_role` ; le nom doit ouvrir la fiche du compte.
// Vrai PlatformOperatorsView monté (StrictMode, Chromium), client simulé.
import test from "node:test";
import assert from "node:assert/strict";
import { PRELUDE, skip, withScenarios } from "./phase2-lot-b-harness";

const ENTRY = `
import { createElement as h, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PlatformOperatorsView } from "./components/features/platform-operations/platform-operators-view";
import { ApiRequestError } from "./components/app/api";
${PRELUDE}
const SELF = "f0000000-0000-4000-8000-000000000001";
const grant = { id: "g0000000-0000-4000-8000-000000000001".replace("g", "a"), user_id: "10000000-0000-4000-8000-000000000001", full_name: "Opératrice Recette", account_role: "client", scope: "finance_read", status: "active", note: "Habilitation note interne", granted_by: SELF, granted_at: "2026-11-07T10:00:00+00:00", revoked_by: null, revoked_at: null, revoke_note: "" };
const caps = (on) => ({ support: on, support_reply: on, support_status: on, operators: on, audit: on, finance: on, reviews_moderation: on, refund_execution: on, invoice_rendering: on });
const access = (sa) => ({ super_admin: sa, scopes: [], super_admin_count: 2, capabilities: caps(sa), config: { commission: { setting_bps: null, setting_version: null, checkout_bps: null, aligned: null }, payment_provider: { configured: false, mode: null, live_enabled: false }, invoice_issuer: { configured: false } } });
const scope = { userId: SELF, role: "admin", authority: { canWrite: true } };
window.scenarios = {
  async e30() {
    let revoked = false;
    const calls = { me: 0, list: 0, revoke: 0 };
    const client = {
      load: {
        me: async () => { calls.me++; return access(!revoked); },
        operators: async () => { calls.list++; if (revoked) throw new ApiRequestError(403, "Accès refusé."); return { grants: [grant], page: { limit: 25, total: 1, has_more: false, next_cursor: null } }; },
      },
      command: { revoke: async () => { calls.revoke++; throw new ApiRequestError(403, "Accès refusé."); } },
    };
    const div = mountPoint();
    const nav = [];
    createRoot(div).render(h(StrictMode, null, h(PlatformOperatorsView, { state: "available", unavailableMessage: "", scope, client, onNavigate: (v, p) => nav.push([v, p]) })));
    await until(() => btn(div, "Révoquer"));
    const link = div.querySelector("[data-grant-open-account]");
    const linkTarget = link ? link.getAttribute("data-grant-target") : null;
    revoked = true;
    const meBefore = calls.me;
    btn(div, "Révoquer").click(); await tick(20);
    btn(div, "Confirmer la révocation").click();
    await tick(300);
    const again = btn(div, "Révoquer");
    if (again && !again.disabled) { again.click(); await tick(20); btn(div, "Confirmer la révocation")?.click(); await tick(300); }
    return { linkTarget, meReread: calls.me - meBefore, revokes: calls.revoke, name: /Opératrice Recette/.test(txt(div)), note: /Habilitation note interne/.test(txt(div)), revokeButtons: !!btn(div, "Révoquer") };
  },
};
`;

test("E31 · account_role ⇒ lien vers la fiche client ; E30 · 403 ⇒ relecture /me, données et actions purgées, un seul POST", { skip }, async () => {
  await withScenarios(ENTRY, async (run, { errors, requests }) => {
    const r = await run("e30");
    assert.equal(r.linkTarget, "client", "E31 : le nom ouvre la fiche du compte d’après account_role");
    assert.ok(r.meReread >= 1, `E30 : relecture des droits après le 403 (GET /me : ${r.meReread})`);
    assert.equal(r.name, false, "nom purgé");
    assert.equal(r.note, false, "note d’habilitation purgée");
    assert.equal(r.revokeButtons, false, "plus de bouton de révocation");
    assert.equal(r.revokes, 1, "aucun second POST refusé");
    assert.deepEqual(errors, []);
    assert.deepEqual(requests.filter((u) => u.startsWith("/api/")), []);
  });
});
