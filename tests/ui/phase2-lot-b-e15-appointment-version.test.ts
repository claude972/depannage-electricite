// E15 (registre phase 2) — CLI-04 / ART : un ancien formulaire de créneau écrase le créneau déplacé
// par l’autre partie. Contrat A vérifié (phase3-bloquants-livres.md) : `save_appointment` exige
// `expected_version` = `appointment.reminder_version` lu (0 sans créneau) ; écart ⇒ 409.
// Vrais ClientSpace et ArtisanSpace montés (Chromium), session simulée qui applique ce contrat :
//   1. le client ouvre v1 (09 h), l’artisan déplace à 13 h (v2) ailleurs ;
//   2. le client change seulement la précision et enregistre ⇒ POST avec expected_version 1 ⇒ refus ;
//   3. relecture : 13 h affiché, saisie de la précision conservée, conflit signalé ;
//   4. nouvel envoi explicite ⇒ expected_version 2.
// Même contrat côté artisan (création ⇒ 0).
import test from "node:test";
import assert from "node:assert/strict";
import { serveLiveClient } from "./client-live-space-harness";
import { serveLiveArtisan } from "./artisan-live-space-harness";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PW = process.env.QA_PLAYWRIGHT_PATH || path.join(homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const CHROMIUM = process.env.QA_CHROMIUM_PATH || path.join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell");
const skip = existsSync(path.join(PW, "index.mjs")) && existsSync(CHROMIUM) ? false : "local Playwright/Chromium not found (SKIPPED, never PASS)";

// In-page server truth shared by both setups: one appointment row with its reminder_version.
const SERVER = (role: "client" | "artisan", withSlot: boolean) => `
const J = "d0000000-0000-4000-8000-000000000001";
window.uid = ${role === "client" ? '"c0000000-0000-4000-8000-000000000001"' : '"a0000000-0000-4000-8000-000000000001"'};
window.view = ${role === "client" ? '"detail"' : '"mission"'}; window.param = J;
const future = (h) => { const d = new Date(); d.setDate(d.getDate() + 3); d.setHours(h, 0, 0, 0); return d.toISOString(); };
window.slot = ${withSlot ? '{ intervention_id: J, starts_at: future(9), ends_at: future(11), note: "", updated_at: "2026-11-08T10:00:00.000Z", reminder_version: 1 }' : "null"};
window.posts = [];
const job = { id: J, client_id: "c0000000-0000-4000-8000-000000000001", artisan_id: "a0000000-0000-4000-8000-000000000001", site_id: null, category: "panel", description: "Tableau électrique", address: "3 rue des Ateliers", postal_code: "97200", city: "Fort-de-France", urgency: "scheduled", status: "assigned", estimate_min_cents: 10000, estimate_max_cents: 20000, created_at: "2026-11-01T10:00:00Z", updated_at: "2026-11-01T10:00:00Z", travel_stage: "planned" };
const lim = { limited: false, limit: 100 };
window.seed = { data: { interventions: [job], quotes: [], payments: [], limits: { interventions: lim, quotes: { limited: false, limit: 200 }, sites: lim, organizations: { limited: false, limit: 50 } } }, session: {
  capabilities: new Proxy({}, { get: (_t, k) => (k === "operations" ? "available" : "missing") }),
  uploads: [], refreshContext: "g1|${role}||", ensureFresh: async () => ({ kind: "loaded" }),
  features: new Proxy({}, { get: (_t, k) => (k === "demo" ? false : () => new Proxy({}, { get: (_x, m) => (m === "then" ? undefined : async () => ({ status: 503, body: null })) })) }),
  loadOperations: async () => ({ participants: [], appointment: window.slot ? { ...window.slot } : null, report: null, history: [], history_limit: 50, travel_stage: "planned" }),
  operate: async (id, body) => {
    window.posts.push(JSON.parse(JSON.stringify(body)));
    if (body.action !== "save_appointment") return false;
    const current = window.slot ? window.slot.reminder_version : 0;
    if (body.expected_version !== current) return false; // 409 (or 422 for a missing field) ⇒ refused
    window.slot = { intervention_id: id, starts_at: body.starts_at, ends_at: body.ends_at, note: body.note, updated_at: new Date().toISOString(), reminder_version: current + 1 };
    return true;
  },
} };
window.moveElsewhere = () => { window.slot = { ...window.slot, starts_at: future(13), ends_at: future(15), updated_at: "2026-11-08T11:00:00.000Z", reminder_version: 2 }; };
`;

async function browser() {
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  return pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
}

test("E15 · client : version lue envoyée, refus ⇒ relecture 13 h, précision conservée, renvoi en v2", { skip }, async () => {
  const { server, url } = await serveLiveClient(SERVER("client", true));
  const b = await browser();
  try {
    const page = await (await b.newContext({ viewport: { width: 390, height: 1000 } })).newPage();
    const errors: string[] = [];
    page.on("pageerror", (e: Error) => errors.push(String(e)));
    await page.goto(url);
    const precision = page.getByLabel(/Précision/);
    try { await precision.waitFor({ timeout: 5000 }); } catch (e) { console.log("BODY:", JSON.stringify(((await page.evaluate("document.getElementById(\"app\").innerText")) as string).slice(0, 1500)), errors); throw e; }
    await page.evaluate("window.moveElsewhere()"); // the artisan moved the slot in another session
    await precision.fill("Interphone au nom de Test");
    await page.getByRole("button", { name: /Enregistrer|Modifier le créneau|Proposer/ }).last().click();
    await page.waitForFunction("window.posts.length === 1");
    const first = ((await page.evaluate("window.posts")) as Array<Record<string, unknown>>)[0];
    assert.equal(first.expected_version, 1, `version lue envoyée (reçu ${JSON.stringify(first.expected_version)})`);
    await page.waitForFunction("document.body.textContent.includes('13:00') || document.body.textContent.includes('13 h')");
    assert.equal(await page.getByLabel(/Précision/).inputValue(), "Interphone au nom de Test", "saisie conservée après le refus");
    assert.match((await page.textContent("body")) ?? "", /modifié entre-temps/i, "conflit signalé");
    await page.getByRole("button", { name: /Enregistrer|Modifier le créneau|Proposer/ }).last().click();
    await page.waitForFunction("window.posts.length === 2");
    const second = ((await page.evaluate("window.posts")) as Array<Record<string, unknown>>)[1];
    assert.equal(second.expected_version, 2, "renvoi explicite sur la version relue");
    assert.deepEqual(errors, []);
  } finally {
    await b.close();
    server.close();
  }
});

test("E15 · artisan : création envoie expected_version 0", { skip }, async () => {
  const { server, url } = await serveLiveArtisan(SERVER("artisan", false));
  const b = await browser();
  try {
    const page = await (await b.newContext({ viewport: { width: 390, height: 1000 } })).newPage();
    const errors: string[] = [];
    page.on("pageerror", (e: Error) => errors.push(String(e)));
    await page.goto(url);
    await page.getByRole("button", { name: "Proposer un créneau" }).click();
    const d = new Date(); d.setDate(d.getDate() + 4); d.setHours(10, 0, 0, 0);
    const pad = (n: number) => String(n).padStart(2, "0");
    await page.getByLabel("Début du créneau").fill(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T10:00`);
    await page.getByRole("button", { name: "Enregistrer le créneau" }).click();
    await page.waitForFunction("window.posts.length === 1");
    const first = ((await page.evaluate("window.posts")) as Array<Record<string, unknown>>)[0];
    assert.equal(first.expected_version, 0, `création en version 0 (reçu ${JSON.stringify(first.expected_version)})`);
    assert.deepEqual(errors, []);
  } finally {
    await b.close();
    server.close();
  }
});
