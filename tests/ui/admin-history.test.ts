// Admin links / action history / menu (lot « Fable »): every row opens its exact target; an
// unresolvable quote link is an honest state (never a dossier opened with a quote id); actors and
// message authors are labelled from data already loaded (another admin ⇒ « Exploitant » only when
// the server's participant role says so); menu entries scoped, current one marked, 44 px.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadModule } from "../documents/harness";
import { withApp, skip } from "./real-app-harness";
import type * as Admin from "../../components/role/admin-space";

const a = loadModule("components/role/admin-space.tsx") as unknown as typeof Admin;

test("auteur d’un message : rôle serveur du participant si connu, sinon « Participant » (jamais deviné)", () => {
  const job = { artisan_id: "art-1", client_id: "cli-1" };
  assert.equal(a.authorLabel({ author_id: "me" }, job, "me"), "Exploitant");
  assert.equal(a.authorLabel({ author_id: "art-1" }, job, "me"), "Artisan");
  assert.equal(a.authorLabel({ author_id: "cli-1" }, job, "me"), "Client");
  assert.equal(a.authorLabel({ author_id: "other-admin" }, job, "me"), "Participant", "no role source ⇒ Participant");
  assert.equal(a.authorLabel({ author_id: "other-admin" }, job, "me", [{ id: "other-admin", role: "admin" }]), "Exploitant");
  assert.equal(a.authorLabel({ author_id: "x" }, job, "me", [{ id: "x", role: "support" }]), "Participant", "unknown role never mapped");
});

test("acteur d’un événement : nom + rôle depuis les données chargées, sinon l’identifiant court", () => {
  const overview = { artisans: [{ id: "art-1", full_name: "Alex Martin" }], clients: [{ id: "cli-1", full_name: "Camille Dupont", role: "client" }] } as never;
  assert.equal(a.actorLabel("me", { selfId: "me" }), "Vous (administrateur)");
  assert.equal(a.actorLabel("p-1", { selfId: "me", participants: [{ id: "p-1", full_name: "Sam Laurent", role: "artisan" }] }), "Sam Laurent (Artisan)");
  assert.equal(a.actorLabel("art-1", { selfId: "me", overview }), "Alex Martin (Artisan)");
  assert.match(a.actorLabel("cli-1", { selfId: "me", overview }), /^Camille Dupont \(/);
  assert.equal(a.actorLabel("10000000-0000-4000-8000-000000000009", { selfId: "me" }), "10000000…");
  assert.equal(a.actorLabel(null, { selfId: "me" }), "Acteur non renseigné");
});

test("câblage : journal d’audit (acteur libellé + lien dossier), historique du dossier, règlements → dossier", () => {
  const src = readFileSync("components/role/admin-space.tsx", "utf8");
  assert.match(src, /key: "actor", label: "Acteur", render: \(e\) => actorLabel\(e\.actor_id, \{ selfId: session\.profileId, overview: o \}\)/);
  assert.match(src, /onClick=\{\(\) => openDossier\(e\.intervention_id!\)\} data-audit-open=/);
  assert.match(src, /\{event\.kind === "appointment" \? "Rendez-vous" : "Compte rendu"\} · \{actorLabel\(event\.actor_id,/);
  assert.doesNotMatch(src, /· \{shortUser\(event\.actor_id\)\}/);
  assert.match(src, /authorLabel\(m, intervention, session\.profileId, operations\?\.participants \?\? \[\]\)/);
});

test("app réelle (démo admin) : liens exacts dossier → client / artisan, règlement → dossier, devis inconnu honnête, menu", { skip }, async () => {
  await withApp(async (open) => {
    // Unknown quote id: honest state, never a dossier opened with a quote id.
    let { page, errors, api } = await open("admin-quote.quote-inconnu");
    await page.locator("[data-admin-quote-unresolved]").waitFor();
    assert.match(await page.locator("main").innerText(), /Devis non chargé/);
    // Dossier → exact client record / artisan dossier.
    ({ page, errors, api } = await open("admin-detail.demo-001"));
    await page.locator("[data-dossier-open-client]").waitFor();
    await page.locator("[data-dossier-open-client]").click();
    await page.waitForTimeout(700);
    assert.equal(await page.evaluate(() => location.hash), "#admin-clients/demo-client");
    await page.locator('[data-client-record="demo-client"]').waitFor();
    await page.evaluate(() => history.back());
    await page.waitForTimeout(700);
    await page.locator("[data-dossier-open-artisan]").click();
    await page.waitForTimeout(700);
    assert.equal(await page.evaluate(() => location.hash), "#admin-artisan/demo-artisan");
    // Payment row → the dossier of that exact quote.
    await page.evaluate(() => { location.hash = "#admin-quotes"; });
    await page.locator('[data-payment-open="demo-003"]').waitFor();
    await page.locator('[data-payment-open="demo-003"]').click();
    await page.waitForTimeout(700);
    assert.equal(await page.evaluate(() => location.hash), "#detail/demo-003");
    // Menu: current entry marked, 44 px targets, no overflow at 390 px.
    ({ page, errors, api } = await open("admin-admin-interventions", 390));
    const nav = await page.evaluate(`(() => [...document.querySelectorAll('nav[aria-label="Sections de l’administration"] button')].map((b) => ({ t: b.textContent.trim(), cur: b.getAttribute("aria-current"), h: b.getBoundingClientRect().height })))()`) as { t: string; cur: string | null; h: number }[];
    assert.ok(nav.length > 0);
    assert.deepEqual(nav.filter((n) => n.cur === "page").map((n) => n.t), ["Interventions"]);
    assert.ok(nav.every((n) => n.h >= 44 || n.h === 0), JSON.stringify(nav.filter((n) => n.h > 0 && n.h < 44)));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
    assert.deepEqual(api, []);
    assert.deepEqual(errors, []);
  });
});
