// E58 / E79 (registre phase 2) — PUB-08/09/10, ADM-08 : profil public de l’exploitant.
// E58 : publication retirée ⇒ en naviguant À propos → Mentions légales, la page relit le profil
//       publié (aucun ancien exploitant affiché).
// E79 : panne (503) ⇒ un état d’erreur avec reprise, distinct de « À renseigner par l’exploitant ».
// Vrai PublicSite monté (StrictMode, Chromium), fetch simulé (aucun réseau).
import test from "node:test";
import assert from "node:assert/strict";
import { PRELUDE, skip, withScenarios } from "./phase2-lot-b-harness";

const ENTRY = `
import { createElement as h, StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { PublicSite } from "./components/role/public-site";
import { ThemeProvider } from "./components/app/theme-provider";
${PRELUDE}
const PROFILE = { legal_name: "Exploitant QA SAS", legal_form: "SAS", siren: "000000000", hq_address: "Adresse QA du siège", publication_director: "Directrice QA", public_email: "contact@exploitant-qa.invalid", privacy_email: "donnees@exploitant-qa.invalid", host_name: "Hébergeur QA", host_address: "Adresse QA hébergeur", host_contact: "support@hebergeur-qa.invalid", rights_holder: "Exploitant QA SAS", service_area: "Zone QA", public_phone: "+596000000000" };
window.mode = "published"; window.gets = 0;
window.fetch = async (url) => {
  if (String(url).startsWith("/api/public/operator-profile")) {
    window.gets++;
    if (window.mode === "down") return new Response(JSON.stringify({ error: "x" }), { status: 503 });
    const published = window.mode === "published" ? { version: 3, profile: PROFILE, published_at: "2026-11-07T10:00:00+00:00" } : null;
    return new Response(JSON.stringify({ published }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return new Response("{}", { status: 503 });
};
let setView;
function Host() {
  const [view, set] = useState("about"); setView = set;
  const session = new Proxy({ view, error: "", notice: "", categoryId: "outage", pendingDraft: null, busy: false, authMode: "login", go: (v) => set(v) }, { get: (t, k) => (typeof k === "string" && k in t ? t[k] : () => {}) });
  return h(ThemeProvider, null, h(PublicSite, { session }));
}
window.scenarios = {
  async e58() {
    const div = mountPoint();
    createRoot(div).render(h(StrictMode, null, h(Host)));
    await until(() => /Exploitant QA SAS/.test(txt(div)), 3000);
    const shownBefore = /Exploitant QA SAS/.test(txt(div));
    window.mode = "unpublished";
    const before = window.gets;
    setView("legal");
    await tick(400);
    return { shownBefore, reads: window.gets - before, stale: /Exploitant QA SAS/.test(txt(div)) };
  },
  async e79() {
    window.mode = "down";
    const div = mountPoint();
    createRoot(div).render(h(StrictMode, null, h(Host)));
    await until(() => typeof setView === "function");
    setView("privacy");
    await tick(500);
    const text = txt(div);
    const retry = [...div.querySelectorAll("button")].find((b) => /Réessayer/.test(b.textContent || ""));
    window.mode = "published";
    if (retry) { retry.click(); await tick(500); }
    return { errorShown: /n’ont pas pu être chargées|indisponible/i.test(text), retry: !!retry, recovered: !div.querySelector("[data-operator-profile-error]") && /donnees@exploitant-qa\.invalid|Exploitant QA SAS/.test(txt(div)) };
  },
};
`;

test("E58 · navigation interne ⇒ profil relu ; publication retirée ⇒ ancien exploitant non affiché", { skip }, async () => {
  await withScenarios(ENTRY, async (run, { errors }) => {
    const r = await run("e58");
    assert.equal(r.shownBefore, true);
    assert.ok(r.reads >= 1, `relecture en navigation (GET : ${r.reads})`);
    assert.equal(r.stale, false, "aucun ancien exploitant affiché");
    assert.deepEqual(errors, []);
  }, 1280);
});

test("E79 · panne ⇒ erreur et reprise distinctes de « À renseigner »", { skip }, async () => {
  await withScenarios(ENTRY, async (run, { errors }) => {
    const r = await run("e79");
    assert.equal(r.errorShown, true, "état d’erreur explicite");
    assert.equal(r.retry, true, "action de reprise");
    assert.equal(r.recovered, true, "la reprise affiche le profil publié");
    assert.deepEqual(errors, []);
  }, 1280);
});
