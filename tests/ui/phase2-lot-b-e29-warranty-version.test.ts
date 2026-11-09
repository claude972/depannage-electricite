// E29 (registre phase 2) — ADM-10 : une décision de garantie prise depuis un écran ancien écrase la
// résolution d’un autre administrateur. Contrat A vérifié (phase3-bloquants-livres.md) : `resolve`
// exige `expected_version` = `case.updated_at` exacte telle que lue (chaîne ISO, microsecondes) ;
// écart ⇒ 409 ; relire et laisser le brouillon en conflit.
// Vrai WarrantyPanel monté (StrictMode, Chromium) avec un fetch simulé appliquant ce contrat.
import test from "node:test";
import assert from "node:assert/strict";
import { PRELUDE, skip, withScenarios } from "./phase2-lot-b-harness";

const ENTRY = `
import { createElement as h, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { WarrantyPanel } from "./components/app/forms";
${PRELUDE}
const J = "d0000000-0000-4000-8000-000000000001";
const CASE = "e0000000-0000-4000-8000-000000000001";
const V1 = "2026-11-08T10:00:00.123456+00:00";
let row = { id: CASE, intervention_id: J, client_id: "c0000000-0000-4000-8000-000000000001", description: "Disjoncteur qui saute de nouveau", status: "reviewing", resolution: "", created_at: "2026-11-07T10:00:00.000000+00:00", updated_at: V1, terms_version: null };
window.posts = [];
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const fetcher = async (url, init) => {
  if (init && init.method === "POST") {
    const body = JSON.parse(init.body);
    window.posts.push(body);
    if (body.expected_version !== row.updated_at) return json(409, { error: "La demande a changé." });
    row = { ...row, status: body.status, resolution: body.resolution, updated_at: "2026-11-08T12:00:00.000001+00:00" };
    return json(200, { case: row });
  }
  return json(200, { cases: [row], enabled: true, next_cursor: null, has_active: row.status === "submitted" || row.status === "reviewing" });
};
window.globalFetch = window.fetch;
window.fetch = fetcher; // api() helper path
const context = { generation: () => 1, userId: () => "a0000000-0000-4000-8000-0000000000aa" };
window.scenarios = {
  async e29() {
    const div = mountPoint();
    createRoot(div).render(h(StrictMode, null, h(WarrantyPanel, { interventionId: J, demo: false, role: "admin", context, fetcher })));
    await until(() => div.querySelector(".warranty-resolution textarea"));
    // Administrator A resolves meanwhile, from another screen.
    row = { ...row, status: "resolved", resolution: "Remplacement du disjoncteur effectué par A.", updated_at: "2026-11-08T11:00:00.654321+00:00" };
    const form = div.querySelector(".warranty-resolution");
    setInput(form.querySelector("select"), "reviewing");
    setInput(form.querySelector("textarea"), "Brouillon de B : vérification en cours.");
    await tick(30);
    form.querySelector("button[type=submit]").click();
    await until(() => window.posts.length === 1);
    await tick(400);
    const ta = div.querySelector(".warranty-resolution textarea");
    return { first: window.posts[0], draft: ta ? ta.value : null, text: txt(div), status: row.status, posts: window.posts.length };
  },
};
`;

test("E29 · version exacte envoyée ; 409 ⇒ relecture, résolution de A affichée, brouillon de B conservé en conflit", { skip }, async () => {
  await withScenarios(ENTRY, async (run, { errors }) => {
    const r = await run("e29");
    assert.equal(r.first.expected_version, "2026-11-08T10:00:00.123456+00:00", `version lue envoyée telle quelle (reçu ${JSON.stringify(r.first.expected_version)})`);
    assert.equal(r.posts, 1);
    assert.equal(r.status, "resolved", "la résolution de A n’est pas écrasée");
    assert.match(r.text, /Remplacement du disjoncteur effectué par A/, "relecture : décision courante affichée");
    assert.equal(r.draft, "Brouillon de B : vérification en cours.", "brouillon conservé");
    assert.match(r.text, /modifiée entre-temps|a changé/i, "conflit signalé");
    assert.deepEqual(errors, []);
  });
});
