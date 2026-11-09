// E59 (registre phase 2) — photos avant/après du compte rendu et garde « Terminer » côté artisan.
// Contrat A : GET operations → report_evidence_required (nouvelles interventions) ; POST save_report
// + before_photo_id / after_photo_id (422 si manquantes) ; action complete 409 report_photos_required.
// Vrai ArtisanSpace monté (live, StrictMode, Chromium 390) ; session.operate / loadOperations simulés.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { serveLiveArtisan } from "./artisan-live-space-harness";

const PW = process.env.QA_PLAYWRIGHT_PATH || path.join(homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const CHROMIUM = process.env.QA_CHROMIUM_PATH || path.join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell");
const skip = existsSync(path.join(PW, "index.mjs")) && existsSync(CHROMIUM) ? false : "local Playwright/Chromium not found (SKIPPED, never PASS)";

const P1 = "b1000000-0000-4000-8000-000000000001", P2 = "b1000000-0000-4000-8000-000000000002";
const SETUP = (flag: boolean, withDocs = true) => `
const J = "d0000000-0000-4000-8000-000000000001";
window.uid = "a0000000-0000-4000-8000-000000000001";
window.view = "mission"; window.param = J;
const job = { id: J, client_id: "c0000000-0000-4000-8000-000000000001", artisan_id: window.uid, site_id: null, category: "panel", description: "Tableau", address: "3 rue", postal_code: "97200", city: "Fort-de-France", urgency: "scheduled", status: "in_progress", estimate_min_cents: 1, estimate_max_cents: 2, created_at: "2026-11-01T10:00:00Z", updated_at: "2026-11-01T10:00:00Z", travel_stage: "on_site" };
const all = [
  { id: "${P1}", intervention_id: J, owner_id: window.uid, name: "avant.jpg", mime_type: "image/jpeg", created_at: "2026-11-04T10:00:00Z" },
  { id: "${P2}", intervention_id: J, owner_id: window.uid, name: "apres.webp", mime_type: "image/webp", created_at: "2026-11-04T11:00:00Z" },
  { id: "b1000000-0000-4000-8000-000000000003", intervention_id: J, owner_id: "c0000000-0000-4000-8000-000000000001", name: "photo-client.jpg", mime_type: "image/jpeg", created_at: "2026-11-04T12:00:00Z" },
  { id: "b1000000-0000-4000-8000-000000000004", intervention_id: J, owner_id: window.uid, name: "facture.pdf", mime_type: "application/pdf", created_at: "2026-11-04T12:00:00Z" },
];
const docs = ${withDocs ? "all.slice()" : "[]"};
window.uploads = [];
// Existing private upload (POST /api/documents multipart): record file + intervention_id, answer the document.
window.uploadStatus = 201;
window.respond = async (url, init) => {
  if (url === "/api/documents" && init && init.method === "POST") {
    const f = init.body.get("file");
    window.uploads.push({ intervention_id: init.body.get("intervention_id"), name: f && f.name, type: f && f.type });
    if (window.uploadStatus !== 201) return new Response(JSON.stringify({ error: "x" }), { status: window.uploadStatus });
    const id = "b2000000-0000-4000-8000-00000000000" + window.uploads.length;
    window.lastDoc = { id, intervention_id: J, owner_id: window.uid, name: f.name, mime_type: f.type, created_at: "2026-11-05T10:00:00Z" };
    return new Response(JSON.stringify({ document: window.lastDoc }), { status: 201, headers: { "content-type": "application/json" } });
  }
  return new Response(JSON.stringify({ error: "x" }), { status: 503 });
};
const lim = { limited: false, limit: 100 };
window.report = null; window.ops = []; window.actions = [];
window.seed = { data: { interventions: [job], quotes: [], payments: [], documents: docs, limits: { interventions: lim, quotes: { limited: false, limit: 200 }, sites: lim, organizations: { limited: false, limit: 50 } } }, session: {
  capabilities: new Proxy({}, { get: (_t, k) => (k === "operations" ? "available" : "missing") }),
  uploads: [], refreshContext: "g1|artisan||", ensureFresh: async () => ({ kind: "loaded" }),
  features: new Proxy({}, { get: (_t, k) => (k === "demo" ? false : () => new Proxy({}, { get: (_x, m) => (m === "then" ? undefined : async () => ({ status: 503, body: null })) })) }),
  operate: async (id, body) => { window.ops.push(body); if (body.action === "save_report") window.report = { intervention_id: J, summary: body.summary, checks: body.checks, signature_name: body.signature_name, report_revision: "f1000000-0000-4000-8000-000000000001", before_photo_id: body.before_photo_id ?? null, after_photo_id: body.after_photo_id ?? null }; return true; },
  refresh: async () => { window.refreshes = (window.refreshes || 0) + 1; if (!window.refreshKeepsStale && window.lastDoc && !docs.some((d) => d.id === window.lastDoc.id)) docs.push(window.lastDoc); window.rerender(); },
  action: async (id, a) => { window.actions.push(a); return true; },
  loadOperations: async () => ({ participants: [], appointment: null, report: window.report, ${flag ? "report_evidence_required: true, report_receipt: null," : ""} history: [], history_limit: 50, travel_stage: "on_site" }),
} };
`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function withPage(setup: string, body: (page: any, errors: string[]) => Promise<void>) {
  const { server, url } = await serveLiveArtisan(setup);
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 1000 } })).newPage();
    const errors: string[] = [];
    page.on("pageerror", (e: Error) => errors.push(String(e)));
    await page.goto(url);
    try { await page.getByRole("button", { name: "Rédiger le compte rendu" }).waitFor({ timeout: 8000 }); } catch (e) { console.log("BODY:", ((await page.evaluate("document.body.innerText")) as string).slice(0, 600), errors); throw e; }
    await body(page, errors);
  } finally {
    await browser.close();
    server.close();
  }
}
const fill = async (page: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
  await page.getByRole("button", { name: "Rédiger le compte rendu" }).click();
  await page.locator("form[data-report-form] textarea").first().fill("Remplacement du disjoncteur différentiel.");
  await page.getByLabel("Nom déclaré").fill("Jean Artisan");
};

test("E59 · nouvelle intervention : « Terminer » dit ce qui manque ; deux photos exigées avant tout POST ; clôture ensuite possible", { skip }, async () => {
  await withPage(SETUP(true), async (page, errors) => {
    const next = () => page.locator("section[aria-labelledby='dossier-next']");
    assert.equal(await next().locator("[data-closure]").getAttribute("data-closure"), "blocked");
    assert.match((await next().innerText()).replace(/\s+/g, " "), /Pour terminer, il manque : le compte rendu enregistré la photo avant l’intervention la photo après l’intervention/);
    assert.equal(await next().getByRole("button", { name: "Terminer l’intervention" }).isDisabled(), true);
    await fill(page);
    const options = await page.locator("[data-report-photo-select=before] option").allInnerTexts();
    assert.deepEqual(options, ["— Aucune —", "avant.jpg", "apres.webp"], "JPEG/PNG/WebP de l’artisan affecté uniquement");
    assert.doesNotMatch(await page.locator("[data-report-photo-picker]").innerText(), /sans elles/);
    await page.locator("[data-report-photo-select=before]").selectOption(P1);
    await page.getByRole("button", { name: "Enregistrer le compte rendu" }).click();
    await page.waitForTimeout(150);
    assert.match(await page.locator("[data-report-photo-picker]").innerText(), /Choisissez la photo avant et la photo après l’intervention\./);
    assert.equal((await page.evaluate("window.ops.length")) as number, 0, "aucun POST incomplet");
    assert.equal(await page.locator("form[data-report-form] textarea").first().inputValue(), "Remplacement du disjoncteur différentiel.", "saisie conservée");
    assert.equal(await page.locator("[data-report-photo-select=before]").inputValue(), P1);
    assert.equal(await page.locator(`[data-report-photo-select=after] option[value="${P1}"]`).isDisabled(), true, "même photo non sélectionnable deux fois");
    await page.locator("[data-report-photo-select=after]").selectOption(P2);
    await page.getByRole("button", { name: "Enregistrer le compte rendu" }).click();
    await page.locator("[data-closure=ready]").waitFor();
    const ops = (await page.evaluate("window.ops")) as Record<string, unknown>[];
    assert.equal(ops.length, 1);
    assert.equal(ops[0].before_photo_id, P1);
    assert.equal(ops[0].after_photo_id, P2);
    assert.equal(await next().locator("[data-closure-missing]").count(), 0);
    assert.match(await page.locator("section[aria-labelledby='dossier-report']").innerText(), /Photo avant : avant\.jpg[\s\S]*Photo après : apres\.webp[\s\S]*Accusé de réception du demandeur en attente/);
    assert.equal(await next().getByRole("button", { name: "Terminer l’intervention" }).isDisabled(), false);
    assert.deepEqual(errors, []);
  });
});

test("E59 · dossier historique (sans indicateur) : ni sélecteur ni champs photo envoyés, « Terminer » inchangé", { skip }, async () => {
  await withPage(SETUP(false), async (page, errors) => {
    assert.equal(await page.locator("[data-closure]").getAttribute("data-closure"), "legacy");
    assert.equal(await page.locator("section[aria-labelledby='dossier-next']").getByRole("button", { name: "Terminer l’intervention" }).isDisabled(), false);
    await fill(page);
    assert.equal(await page.locator("[data-report-photo-picker]").count(), 0);
    await page.getByRole("button", { name: "Enregistrer le compte rendu" }).click();
    await page.waitForTimeout(300);
    const ops = (await page.evaluate("window.ops")) as Record<string, unknown>[];
    assert.equal(ops.length, 1);
    assert.equal("before_photo_id" in ops[0] || "after_photo_id" in ops[0], false, "corps historique inchangé");
    assert.deepEqual(errors, []);
  });
});

test("E59 · dépôt direct depuis le compte rendu : POST /api/documents avec l’id du dossier, photo sélectionnable après actualisation ; échec ⇒ aucune relance automatique", { skip }, async () => {
  await withPage(SETUP(true, false), async (page, errors) => {
    await fill(page);
    assert.match(await page.locator("[data-report-photo-hint]").innerText(), /Aucune photo JPEG, PNG ou WebP[\s\S]*ci-dessous/);
    const jpeg = { name: "avant-chantier.jpg", mimeType: "image/jpeg", buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) };
    // Échec serveur : erreur affichée, aucun second envoi tant que l’artisan ne relance pas.
    await page.evaluate("window.uploadStatus = 503");
    await page.locator("[data-report-photo-file]").setInputFiles(jpeg);
    await page.getByRole("button", { name: "Envoyer la photo" }).click();
    await page.locator("[data-report-photo-upload-error]").waitFor();
    await page.waitForTimeout(300);
    assert.equal((await page.evaluate("window.uploads.length")) as number, 1, "aucune relance automatique");
    // Reprise explicite.
    await page.evaluate("window.uploadStatus = 201");
    await page.getByRole("button", { name: /Renvoyer la photo|Envoyer la photo/ }).click();
    await page.locator("[data-report-photo-upload=done]").waitFor();
    const ups = (await page.evaluate("window.uploads")) as { intervention_id: string; type: string }[];
    assert.deepEqual(ups.map((u) => [u.intervention_id, u.type]), [["d0000000-0000-4000-8000-000000000001", "image/jpeg"], ["d0000000-0000-4000-8000-000000000001", "image/jpeg"]], "id exact du dossier");
    assert.ok(((await page.evaluate("window.refreshes")) as number) >= 1, "actualisation après dépôt");
    assert.equal(await page.locator("[data-report-photo-select=before]").inputValue(), "b2000000-0000-4000-8000-000000000002", "photo déposée sélectionnée");
    assert.deepEqual(await page.locator("[data-report-photo-select=after] option").allInnerTexts(), ["— Aucune —", "avant-chantier.jpg"]);
    assert.equal(await page.locator("form[data-report-form] textarea").first().inputValue(), "Remplacement du disjoncteur différentiel.", "saisie du compte rendu conservée");
    assert.equal((await page.evaluate("window.ops.length")) as number, 0, "aucun compte rendu envoyé par le dépôt");
    assert.deepEqual(errors, []);
  });
});

test("E59 · upload 201 confirmé mais actualisation sans le document : option id + nom conservée et sélectionnée", { skip }, async () => {
  await withPage(SETUP(true, false), async (page, errors) => {
    await fill(page);
    await page.evaluate("window.refreshKeepsStale = true");
    await page.locator("[data-report-photo-file]").setInputFiles({ name: "apres-chantier.png", mimeType: "image/png", buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]) });
    await page.getByRole("button", { name: "Envoyer la photo" }).click();
    await page.locator("[data-report-photo-upload=done]").waitFor();
    assert.ok(((await page.evaluate("window.refreshes")) as number) >= 1);
    assert.equal(((await page.evaluate("window.seed.data.documents.length")) as number), 0, "le workspace ne contient toujours pas la photo");
    const id = "b2000000-0000-4000-8000-000000000001";
    assert.equal(await page.locator("[data-report-photo-select=before]").inputValue(), id);
    assert.equal(await page.locator(`[data-report-photo-select=before] option[value="${id}"]`).innerText(), "apres-chantier.png");
    assert.deepEqual(await page.locator("[data-report-photo-select=after] option").allInnerTexts(), ["— Aucune —", "apres-chantier.png"]);
    assert.deepEqual(errors, []);
  });
});
