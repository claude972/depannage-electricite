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
  async mfa(enrolled) {
    window.mfa = { id: SELF, enrolled, verified: false, enrolls: 0, attempts: 0 };
    const writes = [];
    const client = {
      load: {
        me: async () => access(true),
        operators: async () => ({ grants: [grant], page: { limit: 25, total: 1, has_more: false, next_cursor: null } }),
      },
      command: {
        revoke: async (command) => {
          writes.push(command);
          if (!window.mfa.verified) throw new ApiRequestError(403, "Vérification requise.", { code: "platform_mfa_required" });
          return { ok: true };
        },
      },
    };
    const div = mountPoint();
    const root = createRoot(div);
    root.render(h(StrictMode, null, h(PlatformOperatorsView, { state: "available", unavailableMessage: "", scope, client })));
    const click = async (name) => {
      if (!(await until(() => btn(div, name) && !btn(div, name).disabled))) throw new Error("Action indisponible : " + name);
      btn(div, name).click();
    };
    await click("Révoquer");
    await click("Confirmer la révocation");
    if (!(await until(() => div.querySelector("[data-platform-mfa]")))) throw new Error("Vérification absente");
    const focused = document.activeElement.textContent;
    await click("Commencer la vérification");
    if (!enrolled) await click("Configurer mon application");
    if (!(await until(() => div.querySelector("[autocomplete=one-time-code]")))) throw new Error("Champ code absent");
    const hasQr = Boolean(div.querySelector("img[alt*=configuration]"));
    const code = div.querySelector("[autocomplete=one-time-code]");
    setInput(code, "000000");
    await click("Vérifier le code");
    const invalid = await until(() => txt(div).includes("Code non vérifié ou expiré"));
    const writesAfterFailure = writes.length;
    setInput(code, "123456");
    await click("Vérifier le code");
    const success = await until(() => txt(div).includes("Identité vérifiée"));
    const writesAfterVerification = writes.length;
    await click("Révoquer");
    await click("Confirmer la révocation");
    await until(() => txt(div).includes("Scope révoqué"));
    root.unmount();
    div.remove();
    return { ...window.mfa, focused, hasQr, invalid, success, writesAfterFailure, writesAfterVerification, writes };
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

const AUTH_STUB = `
export function createClient() {
  return { auth: {
    getUser: async () => ({ data: { user: { id: window.mfa.id,
      factors: window.mfa.enrolled ? [{ id: "existing", status: "verified", factor_type: "totp" }] : [] } }, error: null }),
    getClaims: async () => ({ data: { claims: { sub: window.mfa.id, aal: window.mfa.verified ? "aal2" : "aal1" } }, error: null }),
    mfa: {
      enroll: async () => { window.mfa.enrolls++; return { data: { id: "new", totp: {
        qr_code: "data:image/svg+xml;utf-8,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27/%3E",
        secret: "CLERECETTESYNTHETIQUE",
      } }, error: null }; },
      challengeAndVerify: async ({ factorId, code }) => {
        window.mfa.attempts++;
        if (factorId !== (window.mfa.enrolled ? "existing" : "new") || code !== "123456") return { error: true };
        window.mfa.verified = true;
        return { error: null };
      },
    },
  } };
}
`;

test("Chromium : le panneau MFA vérifie ou configure le TOTP et n’envoie jamais l’action automatiquement", { skip }, async () => {
  await withScenarios(ENTRY, async (run, { errors, requests }) => {
    for (const enrolled of [true, false]) {
      const result = await run("mfa", enrolled);
      assert.equal(result.focused, "Vérification à deux étapes");
      assert.equal(result.enrolls, enrolled ? 0 : 1);
      assert.equal(result.hasQr, !enrolled);
      assert.equal(result.attempts, 2);
      assert.equal(result.invalid, true);
      assert.equal(result.success, true);
      assert.equal(result.writesAfterFailure, 1);
      assert.equal(result.writesAfterVerification, 1);
      assert.equal(result.writes.length, 2);
      assert.deepEqual(result.writes[0], result.writes[1]);
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(requests.filter((u) => u.startsWith("/api/")), []);
  }, 390, [{ filter: /lib\/supabase\/client$/, contents: AUTH_STUB }]);
});
