// E71 (registre phase 2) — SYS-04.2 : retirer un navigateur push. Le serveur efface le navigateur et
// conserve le consentement général : réponse opted_in = true avec browser = none. Attendu (P7) :
// c’est un retrait réussi — message de retrait, unsubscribe() de ce navigateur, aucun échec affiché.
// Vrai WebPushPanel monté (StrictMode, Chromium), environnement push et API simulés.
import test from "node:test";
import assert from "node:assert/strict";
import { PRELUDE, skip, withScenarios } from "./phase2-lot-b-harness";

const ENTRY = `
import { createElement as h, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { WebPushPanel } from "./components/features/web-push/web-push-panel";
${PRELUDE}
const keyBytes = new Uint8Array(65).map((_, i) => (i === 0 ? 4 : (i * 7) % 256));
const KEY = btoa(String.fromCharCode(...keyBytes)).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");
const S = window.S = { posts: [], unsubscribes: 0, view: { available: true, public_key: KEY, enrollment: { version: 1, opted_in: true, browser: "current" } } };
const makeSub = () => ({ options: { applicationServerKey: keyBytes.buffer.slice(0) }, toJSON: () => ({ endpoint: "https://push.example.invalid/e", expirationTime: null, keys: { p256dh: "B" + "x".repeat(86), auth: "a".repeat(22) } }), unsubscribe: async () => { S.unsubscribes++; S.existing = null; return true; } });
S.existing = makeSub();
const reg = { active: { postMessage: (msg, [port]) => { if (msg && msg.type === "CHECK_PRIVATE_PUSH") port.postMessage({ type: "PRIVATE_PUSH_READY" }); } }, pushManager: { getSubscription: async () => S.existing, subscribe: async () => { S.existing = makeSub(); return S.existing; } } };
const env = { supported: () => true, permission: () => "granted", registration: async () => reg };
const api = {
  load: async () => ({ status: 200, body: S.view }),
  command: async (body) => {
    S.posts.push(body);
    // Real server behaviour: the browser is cleared, the general consent is kept.
    S.view = { ...S.view, enrollment: { version: S.view.enrollment.version + 1, opted_in: true, browser: "none" } };
    return { status: 200, body: S.view };
  },
};
window.scenarios = {
  async e71() {
    const div = mountPoint();
    createRoot(div).render(h(StrictMode, null, h(WebPushPanel, { demo: false, pushSaved: true, readyTimeoutMs: 300, api, env, context: { userId: () => "10000000-0000-4000-8000-0000000000ee", generation: () => 1 } })));
    await until(() => btn(div, "Désactiver"));
    btn(div, "Désactiver").click();
    await tick(500);
    return { posts: S.posts.map((p) => p.action), unsubscribes: S.unsubscribes, alert: txt(div.querySelector("[role=alert]")), text: txt(div) };
  },
};
`;

test("E71 · opted_in=true + browser=none ⇒ retrait réussi, unsubscribe, aucun échec", { skip }, async () => {
  await withScenarios(ENTRY, async (run, { errors }) => {
    const r = await run("e71");
    assert.deepEqual(r.posts, ["remove"]);
    assert.equal(r.unsubscribes, 1, "abonnement de ce navigateur retiré");
    assert.equal(r.alert, "", `aucun échec affiché (alerte : ${r.alert})`);
    assert.deepEqual(errors, []);
  });
});
