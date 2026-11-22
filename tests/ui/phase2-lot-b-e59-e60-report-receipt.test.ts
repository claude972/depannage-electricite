// E59/E60 (registre phase 2) — accusé de réception et signature du compte rendu par le demandeur
// authentifié (contrat A : GET operations → report.report_revision, report_receipt,
// report_evidence_required ; POST sign_report {report_revision, acknowledged: true, signature_name}).
// Vraie fiche client montée (live, StrictMode, Chromium 390) ; session.operate / loadOperations simulés.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { serveLiveClient } from "./client-live-space-harness";
import { canSignReport, closureMissing, currentReceipt, dossierPhotos } from "../../components/app/report-evidence";
import type { Operations } from "../../components/app/types";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { ReportEvidenceSummary } from "../../components/app/report-evidence";

const PW = process.env.QA_PLAYWRIGHT_PATH || path.join(homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const CHROMIUM = process.env.QA_CHROMIUM_PATH || path.join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell");
const skip = existsSync(path.join(PW, "index.mjs")) && existsSync(CHROMIUM) ? false : "local Playwright/Chromium not found (SKIPPED, never PASS)";

const R1 = "f1000000-0000-4000-8000-000000000001", R2 = "f1000000-0000-4000-8000-000000000002";
const P1 = "b1000000-0000-4000-8000-000000000001", P2 = "b1000000-0000-4000-8000-000000000002";
const SETUP = (opts: { status?: string; revision?: string | null; receipt?: string | null; photos?: boolean; flag?: boolean }) => `
const J = "d0000000-0000-4000-8000-000000000001", A = "a0000000-0000-4000-8000-000000000001";
window.uid = "c0000000-0000-4000-8000-000000000001";
window.view = "detail"; window.param = J;
const job = { id: J, client_id: window.uid, artisan_id: A, site_id: null, category: "panel", description: "Tableau", address: "3 rue", postal_code: "97200", city: "Fort-de-France", urgency: "scheduled", status: ${JSON.stringify(opts.status ?? "completed")}, estimate_min_cents: 1, estimate_max_cents: 2, created_at: "2026-11-01T10:00:00Z", updated_at: "2026-11-01T10:00:00Z", travel_stage: "on_site" };
const lim = { limited: false, limit: 100 };
window.st = { revision: ${JSON.stringify(opts.revision === undefined ? R1 : opts.revision)}, receipt: ${JSON.stringify(opts.receipt ?? null)} };
window.ops = []; window.loads = 0; window.opened = [];
window.open = (u) => { window.opened.push(u); return null; };
window.signResult = true;
const docs = [{ id: "${P1}", intervention_id: J, owner_id: A, name: "avant-tableau.jpg", mime_type: "image/jpeg", created_at: "2026-11-04T10:00:00Z" }, { id: "${P2}", intervention_id: J, owner_id: A, name: "apres-tableau.png", mime_type: "image/png", created_at: "2026-11-04T11:00:00Z" }];
window.seed = { data: { interventions: [job], quotes: [], payments: [], documents: docs, limits: { interventions: lim, quotes: { limited: false, limit: 200 }, sites: lim, organizations: { limited: false, limit: 50 } } }, session: {
  uploads: [],
  // Feature clients (tracking…) answer 503: unrelated panels stay inert.
  features: new Proxy({}, { get: (_t, k) => (k === "demo" ? false : () => new Proxy({}, { get: (_x, m) => (m === "then" ? undefined : async () => ({ status: 503, body: null })) })) }),
  // Server rule mirrored: a revision that is no longer current is refused (409 report_revision_changed).
  operate: async (id, body) => { window.ops.push([id, body]); if (body.action !== "sign_report" || !window.signResult || body.report_revision !== window.st.revision) return false; window.st.receipt = body.report_revision; return true; },
  loadOperations: async () => { window.loads++; const s = window.st; return { participants: [], appointment: null,
    report: { intervention_id: J, summary: "Remplacement du disjoncteur différentiel.", checks: [], signature_name: "Jean Artisan", updated_at: "2026-11-05T10:00:00Z", ...(s.revision ? { report_revision: s.revision } : {}), ${opts.photos ? `before_photo_id: "${P1}", after_photo_id: "${P2}",` : ""} },
    ${opts.flag === false ? "" : "report_evidence_required: true,"}
    report_receipt: s.receipt ? { report_revision: s.receipt, acknowledged_at: "2026-11-06T09:00:00Z", signed_at: "2026-11-06T09:00:00Z", signature_name: "Marie Durand" } : null,
    history: [], history_limit: 50, travel_stage: "on_site" }; },
} };
`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function withPage(setup: string, body: (page: any, errors: string[]) => Promise<void>) {
  const { server, url } = await serveLiveClient(setup);
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 1000 } })).newPage();
    const errors: string[] = [];
    page.on("pageerror", (e: Error) => errors.push(String(e)));
    await page.goto(url);
    await page.getByText("Remplacement du disjoncteur différentiel.").first().waitFor();
    await page.waitForTimeout(150);
    await body(page, errors);
  } finally {
    await browser.close();
    server.close();
  }
}
const evaluate = <T>(page: { evaluate: (s: string) => Promise<unknown> }, s: string) => page.evaluate(s) as Promise<T>;
const app = (page: { evaluate: (s: string) => Promise<unknown> }) => evaluate<string>(page, "document.getElementById('app').innerText.replace(/\\s+/g, ' ')");

test("E60 · demandeur, dossier terminé : case + nom ⇒ un seul sign_report exact, accusé affiché, formulaire retiré", { skip }, async () => {
  await withPage(SETUP({}), async (page, errors) => {
    assert.match(await app(page), /Accusé de réception du demandeur en attente\. Il ne bloque ni la fin de l’intervention ni le paiement\./);
    await page.locator("[data-report-receipt-name]").fill("Marie Durand");
    await page.getByRole("button", { name: "Signer l’accusé de réception" }).click();
    assert.match(await page.locator("[data-report-receipt-error]").innerText(), /Cochez la case/);
    assert.equal(await evaluate<number>(page, "window.ops.length"), 0, "aucun POST sans la case cochée");
    await page.locator("[data-report-receipt-ack]").check();
    const loadsBefore = await evaluate<number>(page, "window.loads");
    await page.getByRole("button", { name: "Signer l’accusé de réception" }).click();
    await page.locator("[data-report-receipt=signed]").waitFor();
    const ops = await evaluate<[string, Record<string, unknown>][]>(page, "window.ops");
    assert.equal(ops.length, 1);
    assert.deepEqual(ops[0][1], { action: "sign_report", report_revision: R1, acknowledged: true, signature_name: "Marie Durand" });
    assert.ok((await evaluate<number>(page, "window.loads")) > loadsBefore, "dossier relu après l’accusé");
    assert.match(await app(page), /Accusé de réception signé par Marie Durand/);
    assert.equal(await page.locator("[data-report-receipt-form]").count(), 0);
    assert.doesNotMatch(await app(page), /Signé par Jean Artisan/, "le nom déclaré par l’artisan n’est jamais la signature du client");
    assert.deepEqual(errors, []);
  });
});

test("E60 · refus : saisie conservée, reprise explicite sans prétendre une relecture ; nouvelle version ⇒ formulaire remis à zéro", { skip }, async () => {
  await withPage(SETUP({}), async (page, errors) => {
    await page.evaluate("window.signResult = false");
    await page.locator("[data-report-receipt-ack]").check();
    await page.locator("[data-report-receipt-name]").fill("Marie Durand");
    await page.getByRole("button", { name: "Signer l’accusé de réception" }).click();
    await page.locator("[data-report-receipt-error]").waitFor();
    const message = await page.locator("[data-report-receipt-error]").innerText();
    assert.match(message, /n’a pas été enregistré.*réessayez/);
    assert.doesNotMatch(message, /relu/);
    assert.equal(await page.locator("[data-report-receipt-name]").inputValue(), "Marie Durand", "saisie conservée");
    assert.equal(await page.locator("[data-report-receipt-ack]").isChecked(), true);
    // 409 report_revision_changed : la version a changé côté serveur ; la relecture apporte R2 ⇒ nouvel accusé vierge.
    await page.evaluate(`window.st.revision = "${R2}"; window.signResult = true`);
    await page.getByRole("button", { name: "Signer l’accusé de réception" }).click();
    await page.waitForTimeout(300);
    assert.equal(await page.locator("[data-report-receipt-name]").inputValue(), "", "nouvelle version : rien ne survit");
    assert.equal(await page.locator("[data-report-receipt-error]").count(), 0);
    assert.equal(await page.locator("[data-report-receipt-ack]").isChecked(), false);
    const sent = await evaluate<[string, { report_revision: string }][]>(page, "window.ops");
    assert.deepEqual(sent.map(([, b]) => b.report_revision), [R1, R1], "la version affichée est celle envoyée ; aucun accusé R2 implicite");
    assert.doesNotMatch(await app(page), /Accusé de réception signé/);
    assert.deepEqual(errors, []);
  });
});

test("E60 · changement d’identité ou de génération ⇒ saisie de l’accusé effacée", { skip }, async () => {
  await withPage(SETUP({}), async (page, errors) => {
    await page.locator("[data-report-receipt-name]").fill("Marie Durand");
    await page.evaluate("window.gen = 2; window.rerender()");
    await page.waitForTimeout(150);
    assert.equal(await page.locator("[data-report-receipt-name]").inputValue(), "");
    assert.deepEqual(errors, []);
  });
});

test("E60 · accusé d’une ancienne version non repris ; historique sans révision ⇒ aucun formulaire", { skip }, async () => {
  await withPage(SETUP({ receipt: R2 }), async (page) => {
    assert.equal(await page.locator("[data-report-receipt-form]").count(), 1, "accusé d’une autre version : à signer");
    assert.doesNotMatch(await app(page), /Accusé de réception signé/);
  });
  await withPage(SETUP({ revision: null, flag: false }), async (page, errors) => {
    assert.equal(await page.locator("[data-report-receipt-form]").count(), 0, "compte rendu historique : inchangé");
    const t = await app(page);
    assert.doesNotMatch(t, /Accusé de réception|Photo avant/);
    assert.match(t, /Déclaré par l’artisan : Jean Artisan/);
    assert.deepEqual(errors, []);
  });
});

test("E59 · photos avant/après visibles côté client et ouvertes par le lien privé existant ; échec ⇒ reprise", { skip }, async () => {
  await withPage(SETUP({ photos: true, receipt: R1 }), async (page, errors) => {
    const t = await app(page);
    assert.match(t, /Photo avant : avant-tableau\.jpg/);
    assert.match(t, /Photo après : apres-tableau\.png/);
    assert.match(t, /Accusé de réception signé par Marie Durand/);
    await page.evaluate(`window.respond = (u) => u.includes("${P2}") ? new Response(JSON.stringify({ error: "Indisponible" }), { status: 503 }) : new Response(JSON.stringify({ url: "https://files.example.test/signed" }), { status: 200, headers: { "content-type": "application/json" } })`);
    await page.locator(`[data-report-photo-open="${P1}"]`).click();
    await page.waitForTimeout(200);
    assert.deepEqual(await evaluate<string[]>(page, "window.opened"), ["https://files.example.test/signed"]);
    await page.locator(`[data-report-photo-open="${P2}"]`).click();
    await page.locator("[data-report-photo-error]").waitFor();
    assert.match(await page.locator(`[data-report-photo-open="${P2}"]`).innerText(), /Réessayer/);
    const fetches = await evaluate<string[]>(page, "window.fetches.filter((u) => u.startsWith('/api/documents?id='))");
    assert.deepEqual(fetches, [`/api/documents?id=${P1}`, `/api/documents?id=${P2}`]);
    assert.deepEqual(errors, []);
  });
});

test("E59/E60 · règles partagées : statut, demandeur, version courante, photos candidates, éléments manquants", () => {
  const base = { participants: [], appointment: null, history: [], history_limit: 50, travel_stage: "on_site" } as const;
  const report = { intervention_id: "j", summary: "Résumé assez long", checks: [], signature_name: "Jean", report_revision: R1 };
  const ops = { ...base, report, report_evidence_required: true, report_receipt: null } as unknown as Operations;
  assert.equal(canSignReport(ops, "completed", true), true);
  assert.equal(canSignReport(ops, "paid", true), true);
  for (const status of ["requested", "assigned", "accepted", "in_progress", "cancelled"]) assert.equal(canSignReport(ops, status, true), false, status);
  assert.equal(canSignReport(ops, "completed", false), false, "seul le demandeur authentifié");
  const signed = { ...ops, report_receipt: { report_revision: R1, acknowledged_at: null, signed_at: null, signature_name: "M" } } as Operations;
  assert.equal(canSignReport(signed, "completed", true), false);
  assert.equal(currentReceipt({ ...signed, report: { ...report, report_revision: R2 } } as Operations), null, "accusé d’une autre version : non courant");
  assert.deepEqual(closureMissing(ops), ["la photo avant l’intervention", "la photo après l’intervention"]);
  assert.deepEqual(closureMissing({ ...ops, report: null } as Operations), ["le compte rendu enregistré", "la photo avant l’intervention", "la photo après l’intervention"]);
  assert.deepEqual(closureMissing({ ...ops, report: { ...report, before_photo_id: P1, after_photo_id: P2 } } as Operations), []);
  assert.deepEqual(closureMissing({ ...ops, report: null, report_evidence_required: undefined } as Operations), [], "historique / démo : jamais bloqué ici");
  const J = "j", A = "a";
  const docs = [
    { id: "1", intervention_id: J, owner_id: A, name: "a.jpg", mime_type: "image/jpeg", created_at: "" },
    { id: "2", intervention_id: J, owner_id: A, name: "b.PNG", mime_type: "IMAGE/PNG", created_at: "" },
    { id: "3", intervention_id: J, owner_id: A, name: "c.webp", mime_type: "image/webp", created_at: "" },
    { id: "4", intervention_id: J, owner_id: A, name: "d.heic", mime_type: "image/heic", created_at: "" },
    { id: "5", intervention_id: J, owner_id: A, name: "e.pdf", mime_type: "application/pdf", created_at: "" },
    { id: "6", intervention_id: J, owner_id: "client", name: "client.jpg", mime_type: "image/jpeg", created_at: "" },
    { id: "7", intervention_id: "autre", owner_id: A, name: "autre.jpg", mime_type: "image/jpeg", created_at: "" },
    { id: "8", intervention_id: J, name: "sans-proprietaire.jpg", mime_type: "image/jpeg", created_at: "" },
  ];
  assert.deepEqual(dossierPhotos(docs, J, A).map((p) => p.id), ["1", "2", "3", "8"], "JPEG/PNG/WebP du dossier et de l’artisan affecté (owner_id projeté)");
  assert.deepEqual(dossierPhotos(docs, J, null).map((p) => p.id), ["8"], "sans artisan affecté : aucune photo d’un propriétaire connu");
});

test("E60 · lecteur hors accusé (super admin, membre non demandeur) : report_receipt null ⇒ aucun statut, jamais « en attente »", () => {
  const report = { intervention_id: "j", summary: "Résumé assez long", checks: [], signature_name: "Jean", report_revision: R1, before_photo_id: P1, after_photo_id: P2 };
  const ops = { participants: [], appointment: null, history: [], history_limit: 50, travel_stage: "on_site", report, report_evidence_required: true, report_receipt: null } as unknown as Operations;
  const hidden = renderToStaticMarkup(createElement(ReportEvidenceSummary, { ops, report, receiptVisible: false }));
  assert.doesNotMatch(hidden, /Accusé|en attente/, "statut masqué");
  assert.match(hidden, /data-report-evidence="hidden"/);
  assert.match(hidden, /Photo avant[\s\S]*Photo après/, "compte rendu et photos restent lisibles");
  const requester = renderToStaticMarkup(createElement(ReportEvidenceSummary, { ops, report, receiptVisible: true }));
  assert.match(requester, /Accusé de réception du demandeur en attente/);
  const admin = readFileSync("components/role/admin-space.tsx", "utf8");
  assert.match(admin, /<ReportEvidenceSummary[^>]*receiptVisible=\{false\}/, "administration : jamais de statut d’accusé");
  assert.match(readFileSync("components/role/enterprise-space.tsx", "utf8"), /<ReportEvidenceSummary[^>]*receiptVisible=\{intervention\.client_id === session\.profileId\}/, "entreprise : demandeur seulement");
});
