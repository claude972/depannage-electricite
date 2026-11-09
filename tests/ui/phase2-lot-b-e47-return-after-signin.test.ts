// E47 (registre phase 2) — FIN-03 : retour réussi d’une réservation par carte, puis connexion du même
// compte. Attendu : UNE vérification automatique (POST /api/bookings/finalize) de la référence, pour
// le compte qui la possède (sa tentative en attente porte la même référence) ; un tiers connecté avec
// une tentative à lui différente ne provoque aucun POST pour la référence héritée.
// Vrai CourantApp monté (Chromium) ; client Supabase navigateur remplacé par un stub émettant
// SIGNED_IN (pas de compte hébergé) ; routes simulées en page, aucun fournisseur externe.
import test from "node:test";
import assert from "node:assert/strict";
import { PRELUDE, skip, withScenarios } from "./phase2-lot-b-harness";

const REQ = "4a000000-0000-4000-8000-000000000001";
const OWNER = "10000000-0000-4000-8000-000000000001", OTHER = "10000000-0000-4000-8000-000000000002";
const STUB = `
export function createClient() {
  const f = window.qa;
  const channel = { on() { return this; }, subscribe() { return this; } };
  return { auth: {
    getUser: async () => ({ data: { user: f.uid ? { id: f.uid } : null }, error: null }),
    onAuthStateChange(cb) { f.listeners.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
    signInWithPassword: async ({ email }) => { f.uid = f.ids[email]; const session = { user: { id: f.uid } }; for (const l of [...f.listeners]) await l("SIGNED_IN", session); return { data: { user: session.user, session }, error: null }; },
    signOut: async () => ({ error: null }),
  }, channel: () => channel, removeChannel: async () => {} };
}`;
const ENTRY = (who: "owner" | "other", holdFirstLookup = false) => `
import { createElement as h } from "react";
import { createRoot } from "react-dom/client";
import App from "./components/courant-app";
import { ThemeProvider } from "./components/app/theme-provider";
${PRELUDE}
window.qa = { uid: null, listeners: [], ids: { "client@example.invalid": "${OWNER}", "tiers@example.invalid": "${OTHER}" } };
window.posts = []; window.lookups = 0; window.releaseLookup = null;
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
window.fetch = async (url, init) => {
  const u = String(url), uid = window.qa.uid;
  if (init && init.method === "POST") { window.posts.push({ url: u, body: init.body ? JSON.parse(init.body) : null, uid }); return json({ error: "Fournisseur indisponible." }, 503); }
  if (u.startsWith("/api/workspace")) return uid ? json({ profile: { id: uid, role: "client", full_name: "Compte Recette", phone: "", created_at: "2026-01-01T00:00:00Z", artisan_approved: false }, interventions: [], quotes: [], sites: [], organizations: [], messages: [], documents: [], reviews: [], payments: [], organization_members: [], appointments: [], artisan_profile: null }) : json({ error: "Session requise" }, 401);
  if (u.startsWith("/api/bookings/pending") && ${holdFirstLookup} && ++window.lookups === 1) { await new Promise((r) => { window.releaseLookup = r; }); }
  if (u.startsWith("/api/bookings/pending")) return json({ pending: { request_id: uid === "${OWNER}" ? "${REQ}" : "4a000000-0000-4000-8000-0000000000ff", status: "checkout_open", method: "card_hold", expected_max_cents: 18000, created_at: "2026-11-08T10:00:00.000Z" } });
  return json({ error: "x" }, 404);
};
window.scenarios = {
  async relogin() {
    window.history.replaceState(null, "", "/?booking_return=success&booking_request_id=${REQ}");
    const div = mountPoint();
    createRoot(div).render(h(ThemeProvider, null, h(App)));
    await tick(800);
    const email = [...div.querySelectorAll("input")].find((i) => i.type === "email");
    const pass = [...div.querySelectorAll("input")].find((i) => i.type === "password");
    setInput(email, "client@example.invalid"); setInput(pass, "secret-recette");
    email.form.requestSubmit();
    await until(() => window.releaseLookup, 3000); // first pending lookup held (old generation)
    for (const l of [...window.qa.listeners]) await l("SIGNED_OUT", null); // sign-out…
    window.qa.uid = "${OWNER}";
    for (const l of [...window.qa.listeners]) await l("SIGNED_IN", { user: { id: "${OWNER}" } }); // …same UID again
    await tick(800);
    window.releaseLookup(); // the OLD lookup answers now
    await tick(800);
    return { posts: window.posts };
  },
  async run() {
    window.history.replaceState(null, "", "/?booking_return=success&booking_request_id=${REQ}");
    const div = mountPoint();
    createRoot(div).render(h(ThemeProvider, null, h(App)));
    await tick(800);
    const email = [...div.querySelectorAll("input")].find((i) => i.type === "email");
    const pass = [...div.querySelectorAll("input")].find((i) => i.type === "password");
    setInput(email, "${who === "owner" ? "client@example.invalid" : "tiers@example.invalid"}");
    setInput(pass, "secret-recette");
    email.form.requestSubmit();
    await tick(1500);
    return { posts: window.posts, text: txt(div).slice(0, 400) };
  },
};
`;

test("E47 · propriétaire reconnecté ⇒ une seule vérification automatique de la référence", { skip }, async () => {
  await withScenarios(ENTRY("owner"), async (run, { errors }) => {
    const r = await run("run") as { posts: { url: string; body: { request_id?: string } | null; uid: string }[]; text: string };
    const finalize = r.posts.filter((p) => p.url.startsWith("/api/bookings/finalize"));
    assert.equal(finalize.length, 1, `une vérification automatique (POST : ${JSON.stringify(r.posts.map((p) => p.url))} ; ${r.text})`);
    assert.equal(finalize[0].body?.request_id, REQ);
    assert.equal(finalize[0].uid, OWNER);
    assert.deepEqual(errors, []);
  }, 1280, [{ filter: /supabase\/client$/, contents: STUB }]);
});

test("E47 · tiers connecté avec sa propre tentative ⇒ aucun POST pour la référence héritée", { skip }, async () => {
  await withScenarios(ENTRY("other"), async (run, { errors }) => {
    const r = await run("run") as { posts: { url: string; body: { request_id?: string } | null }[] };
    assert.equal(r.posts.filter((p) => p.body?.request_id === REQ).length, 0, `aucun POST pour la référence héritée (${JSON.stringify(r.posts)})`);
    assert.deepEqual(errors, []);
  }, 1280, [{ filter: /supabase\/client$/, contents: STUB }]);
});

test("E47 · même UID après déconnexion/reconnexion ⇒ l’ancienne lecture retenue n’applique rien", { skip }, async () => {
  await withScenarios(ENTRY("owner", true), async (run, { errors }) => {
    const r = await run("relogin") as { posts: { url: string; body: { request_id?: string } | null }[] };
    assert.equal(r.posts.filter((p) => p.url.startsWith("/api/bookings/finalize")).length, 0, `aucune vérification issue de l’ancienne génération (${JSON.stringify(r.posts)})`);
    assert.deepEqual(errors, []);
  }, 1280, [{ filter: /supabase\/client$/, contents: STUB }]);
});
