// E46 (registre phase 2) — FIN-03 : retour réussi d’une réservation par carte ouvert sans session.
// Attendu : redirection vers la connexion AVEC l’avis « Connectez-vous avec le même compte pour
// vérifier votre réservation », aucun POST de finalisation.
// Vrai CourantApp monté (Chromium), sans configuration Supabase (aucune session possible), URL de
// retour exacte posée avant le montage ; tout appel /api enregistré.
import test from "node:test";
import assert from "node:assert/strict";
import { PRELUDE, skip, withScenarios } from "./phase2-lot-b-harness";

const ENTRY = `
import { createElement as h } from "react";
import { createRoot } from "react-dom/client";
import App from "./components/courant-app";
import { ThemeProvider } from "./components/app/theme-provider";
${PRELUDE}
window.posts = [];
const realFetch = window.fetch;
window.fetch = async (url, init) => { if (init && init.method === "POST") window.posts.push(String(url)); return new Response("{}", { status: 500 }); };
window.scenarios = {
  async e46() {
    window.history.replaceState(null, "", "/?booking_return=success&booking_request_id=4a000000-0000-4000-8000-000000000001");
    const div = mountPoint();
    createRoot(div).render(h(ThemeProvider, null, h(App)));
    await tick(800);
    return { text: txt(div), posts: window.posts, search: location.search };
  },
};
`;

test("E46 · retour réussi sans session ⇒ connexion avec l’avis de vérification, zéro POST", { skip }, async () => {
  await withScenarios(ENTRY, async (run, { errors }) => {
    const r = await run("e46");
    assert.match(r.text, /Connectez-vous avec le même compte pour vérifier votre réservation/, "avis affiché sur la page de connexion");
    assert.deepEqual(r.posts, []);
    assert.deepEqual(errors, []);
  }, 1280);
});
