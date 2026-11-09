// E13 (registre phase 2) — CLI-07 : devis expiré et action d’acceptation. Le devis est « envoyé »
// mais sa validité est dépassée (terms.validity = expired dans la lecture des documents du devis).
// Attendu : aucun bouton « Accepter le devis » actif, explication affichée, aucun POST.
// Vrai ClientSpace (vue devis) monté en Chromium ; GET /api/quotes/<id> et la lecture des documents
// du devis sont simulés (aucun réseau).
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { serveLiveClient } from "./client-live-space-harness";

const PW = process.env.QA_PLAYWRIGHT_PATH || path.join(homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const CHROMIUM = process.env.QA_CHROMIUM_PATH || path.join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell");
const skip = existsSync(path.join(PW, "index.mjs")) && existsSync(CHROMIUM) ? false : "local Playwright/Chromium not found (SKIPPED, never PASS)";

const SETUP = (validity: string) => `
const J = "d0000000-0000-4000-8000-000000000001", Q = "e1000000-0000-4000-8000-000000000001", ART = "a0000000-0000-4000-8000-000000000001";
window.uid = "c0000000-0000-4000-8000-000000000001";
window.view = "quote"; window.param = Q;
const quote = { id: Q, intervention_id: J, artisan_id: ART, lines: [{ label: "Diagnostic", quantity: 1, unit_price_cents: 10000 }], subtotal_cents: 10000, tax_rate: 20, tax_cents: 2000, total_cents: 12000, status: "sent", created_at: "2026-10-01T10:00:00.000Z", accepted_at: null };
const detail = { quote, intervention: { id: J, category: "panel", status: "quoted", site_id: null }, version: { current_quote_id: Q, is_current: true } };
window.respond = (url) => url.startsWith("/api/quotes/") ? new Response(JSON.stringify(detail), { status: 200, headers: { "content-type": "application/json" } }) : new Response(JSON.stringify({ error: "x" }), { status: 503 });
window.actions = [];
window.docLoads = 0;
const overview = { intervention: { id: J, status: "quoted", artisan_id: ART, site_id: null }, viewer: { role: "client", is_artisan: false, can_manage: false, is_admin: false }, issuer: { ready: true, missing: [] }, quotes: [{ id: Q, reference: "D-1", status: "sent", created_at: quote.created_at, accepted_at: null, lines: quote.lines, subtotal_cents: 10000, tax_rate: 20, tax_cents: 2000, total_cents: 12000, terms: { valid_until: "2026-10-15", validity: ${JSON.stringify(validity)} }, permissions: { can_set_terms: false, can_generate: false, can_propose: false }, documents: [], amendments: [] }], history: [], settlement: "not_connected" };
window.seed = { data: { interventions: [], quotes: [], payments: [] }, session: {
  uploads: [], loadOperations: async () => null,
  features: new Proxy({ quoteDocuments: { load: async () => { window.docLoads++; return overview; }, command: async () => null, documentHref: () => "#" } }, { get: (t, k) => (k in t ? t[k] : k === "demo" ? false : new Proxy({}, { get: (_x, m) => (m === "then" ? undefined : async () => null) })) }),
  action: async (...a) => { window.actions.push(a); return false; },
} };
`;

async function view(validity: string) {
  const { server, url } = await serveLiveClient(SETUP(validity));
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 1000 } })).newPage();
    const errors: string[] = [];
    page.on("pageerror", (e: Error) => errors.push(String(e)));
    await page.goto(url);
    await page.getByText("Retour au dossier").first().waitFor();
    await page.waitForTimeout(400);
    const accept = page.getByRole("button", { name: "Accepter le devis" });
    const visible = (await accept.count()) > 0 && (await accept.first().isEnabled());
    if (visible) await accept.first().click();
    await page.waitForTimeout(200);
    const text = (await page.evaluate("document.getElementById('app').innerText")) as string;
    return { visible, actions: (await page.evaluate("window.actions.length")) as number, text, errors };
  } finally {
    await browser.close();
    server.close();
  }
}

test("E13 · devis expiré ⇒ pas d’acceptation proposée, explication, zéro POST", { skip }, async () => {
  const r = await view("expired");
  assert.equal(r.visible, false, "aucun bouton « Accepter le devis » actif");
  assert.equal(r.actions, 0);
  assert.match(r.text, /validité est dépassée/);
  assert.deepEqual(r.errors, []);
});

test("E13 · devis valide ⇒ acceptation toujours proposée", { skip }, async () => {
  const r = await view("valid");
  assert.equal(r.visible, true);
  assert.deepEqual(r.errors, []);
});
