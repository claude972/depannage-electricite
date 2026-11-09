// E65 (registre phase 2) — PUB-07 : « Créer mon compte artisan » ouvre l’inscription avec le profil
// Artisan électricien présélectionné et l’explication sur l’approbation ; la connexion classique
// garde « Particulier ». Vrai PublicSite monté (StrictMode, Chromium), aucun compte créé.
import test from "node:test";
import assert from "node:assert/strict";
import { PRELUDE, skip, withScenarios } from "./phase2-lot-b-harness";

const ENTRY = `
import { createElement as h, StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { PublicSite } from "./components/role/public-site";
import { ThemeProvider } from "./components/app/theme-provider";
${PRELUDE}
window.fetch = async () => new Response(JSON.stringify({ published: null }), { status: 200, headers: { "content-type": "application/json" } });
window.signups = [];
function Host() {
  const [view, setView] = useState("join");
  const [authMode, setAuthMode] = useState("login");
  const session = new Proxy({ view, authMode, error: "", notice: "", categoryId: "outage", pendingDraft: null, busy: false, go: (v) => setView(v), setAuthMode: (m) => setAuthMode(m), signUp: async (v) => { window.signups.push(v); } }, { get: (t, k) => (typeof k === "string" && k in t ? t[k] : () => {}) });
  return h(ThemeProvider, null, h(PublicSite, { session }));
}
window.scenarios = {
  async e65() {
    const div = mountPoint();
    createRoot(div).render(h(StrictMode, null, h(Host)));
    await until(() => btn(div, "Créer mon compte artisan"));
    btn(div, "Créer mon compte artisan").click();
    await until(() => div.querySelector(".auth-form select"));
    await tick(50);
    return { role: div.querySelector(".auth-form select").value, text: txt(div.querySelector(".auth-form")), signups: window.signups.length };
  },
};
`;

test("E65 · « Créer mon compte artisan » ⇒ Artisan électricien présélectionné, explication affichée, aucun envoi", { skip }, async () => {
  await withScenarios(ENTRY, async (run, { errors }) => {
    const r = await run("e65");
    assert.equal(r.role, "artisan", `profil présélectionné (reçu ${r.role})`);
    assert.match(r.text, /devra être approuvée/, "explication sur l’approbation artisan");
    assert.equal(r.signups, 0);
    assert.deepEqual(errors, []);
  }, 1280);
});
