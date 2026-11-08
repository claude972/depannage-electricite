// ENT-13 mounted: real ProfessionalOperations (React root, StrictMode, Chromium 390 and 1280 px),
// « Contrats cadres » tab in live with the typed contracts context. 120 server contracts (beyond 50)
// paginated; detail read on open; 422 cursor ⇒ page 1; 503 ⇒ Réessayer; 401/403/404 (sites-only scope)
// ⇒ refusal; organisation / identity switch ⇒ no old frame, late reply dropped; write ⇒ causal re-read
// (page 1 + open detail). Demo ⇒ local listing, zero fetch.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const PW = process.env.QA_PLAYWRIGHT_PATH || "/Users/claudebrafa/rea/node_modules/playwright-core";
const CHROMIUM = process.env.QA_CHROMIUM_PATH || path.join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell");
const available = existsSync(path.join(PW, "index.mjs")) && existsSync(CHROMIUM);
const skip = available ? false : "local Playwright/Chromium not found (SKIPPED, never PASS)";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const ENTRY = `
import { createElement as h, StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { ProfessionalOperations } from "./components/app/forms";
const O = (n) => "0a000000-0000-4000-8000-" + String(n).padStart(12, "0");
const C = (n) => "c0000000-0000-4000-8000-" + String(n).padStart(12, "0");
window.O = O; window.C = C;
const demo = location.hash === "#demo";
const mk = (n, org) => ({ id: C(n), organization_id: org, title: "Contrat " + n, reference: "REF-" + n, starts_on: "2026-01-01", ends_on: null, status: "active", created_at: new Date(Date.UTC(2026, 0, 1) + n * 60000).toISOString(), terms: "Conditions du contrat " + n });
// O(1): 120 contracts; O(2): sites-only scope ⇒ 404; O(3): 403; O(4): 401; O(5): 503 then ok.
window.store = { [O(1)]: Array.from({ length: 120 }, (_, k) => mk(k + 1, O(1))), [O(5)]: [mk(500, O(5))] };
window.calls = []; window.saves = []; window.hold = null; window.gates = []; window.fail5 = true; window.bad = null; window.fetches = 0;
const json = (b, s = 200, hd = {}) => new Response(JSON.stringify(b), { status: s, headers: hd });
window.fetch = async (url) => {
  window.fetches++;
  window.calls.push(String(url));
  const u = new URL(url, location.href), org = u.searchParams.get("organization_id"), c = u.searchParams.get("cursor");
  if (window.hold && window.hold(String(url))) await new Promise((r) => window.gates.push(r));
  if (org === O(2)) return json({ error: "Périmètre introuvable." }, 404);
  if (org === O(3)) return json({ error: "Accès entreprise requis." }, 403);
  if (org === O(4)) return json({ error: "Session" }, 401);
  if (org === O(5) && window.fail5) return json({ error: "x" }, 503, { "Retry-After": "2" });
  if (c && window.bad === c) return json({ error: "Curseur invalide." }, 422);
  const rows = [...(window.store[org] || [])].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  const m = u.pathname.match(/contracts\\/([^/]+)$/);
  if (m) { const ct = rows.find((r) => r.id === m[1]); return ct ? json({ contract: ct }) : json({ error: "Contrat introuvable." }, 404); }
  const start = c ? Number(c.slice(1)) : 0;
  const items = rows.slice(start, start + 50).map(({ terms, ...rest }) => rest), more = start + 50 < rows.length;
  return json({ items, page: { limit: 50, has_more: more, next_cursor: more ? "k" + (start + 50) : null } });
};
const data = { approval_rules: [], approvals: [], compliance_records: [], audit: [], contracts: [{ id: "demo-c1", organization_id: "demo-org", title: "Contrat démo", reference: "DEMO-1", starts_on: "2026-01-01", ends_on: null, terms: "Conditions démo", status: "active" }] };
function Host() {
  const [org, setOrg] = useState(O(1));
  const [ident, setIdent] = useState({ uid: "u1", gen: 1 });
  window.setOrg = setOrg; window.setIdent = setIdent;
  const onSave = async (values) => {
    window.saves.push(values);
    const list = window.store[values.organization_id] || (window.store[values.organization_id] = []);
    if (values.id) { const ct = list.find((r) => r.id === values.id); ct.status = values.status; }
    else list.push({ ...mk(9000 + list.length, values.organization_id), title: values.title, reference: values.reference, terms: values.terms, status: values.status, created_at: new Date().toISOString() });
    return true;
  };
  return h(ProfessionalOperations, { data, sites: [], organizations: [{ id: O(1), name: "Org 1" }], quotes: [], demo, busy: false, onRefresh: async () => {}, onSave,
    contracts: { organizationId: org, context: { userId: () => ident.uid, generation: () => ident.gen } } });
}
const div = document.createElement("div"); document.body.appendChild(div);
createRoot(div).render(h(StrictMode, null, h(Host)));
`;

async function serve() {
  const b = await build({ absWorkingDir: ROOT, stdin: { contents: ENTRY, resolveDir: ROOT, loader: "tsx" }, bundle: true, write: false, outdir: "out", platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "local-css", ".svg": "dataurl", ".png": "dataurl", ".jpg": "dataurl", ".webp": "dataurl" }, define: { "process.env.NODE_ENV": '"development"', "process.env.NEXT_PUBLIC_SUPABASE_URL": "undefined", "process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY": "undefined" }, logLevel: "error" });
  const js = b.outputFiles.find((f) => f.path.endsWith(".js"))!.text;
  const css = readFileSync(path.join(ROOT, "app/globals.css"), "utf8") + b.outputFiles.filter((f) => f.path.endsWith(".css")).map((f) => f.text).join("\n");
  const server: Server = createServer((_q, r) => { r.setHeader("content-type", "text/html"); r.end(`<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>${css}</style><body class="ui-v2"><script>${js}</script></body></html>`); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { server, url: `http://127.0.0.1:${(server.address() as { port: number }).port}/` };
}
const rows = "document.querySelectorAll('[data-contract-row]').length";

test("Chromium 390/1280 : 120 contrats paginés, détail à l’ouverture, 422, 503, refus (sites seuls), changement d’org/identité, écriture ⇒ relecture causale", { skip }, async () => {
  const { server, url } = await serve();
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    for (const width of [390, 1280]) {
      const page = await (await browser.newContext({ viewport: { width, height: 1000 } })).newPage();
      const errors: string[] = [];
      page.on("pageerror", (e: Error) => errors.push(String(e)));
      await page.goto(url);
      await page.getByRole("button", { name: "Contrats cadres" }).click();
      await page.locator("[data-contract-row]").first().waitFor();
      assert.equal(await page.evaluate(rows), 50);
      assert.ok(!/Contrat démo/.test(await page.locator("body").innerText()), "no local listing in live");
      await page.locator("[data-contracts-more]").click();
      await page.waitForFunction(`${rows} === 100`);
      await page.locator("[data-contracts-more]").click();
      await page.waitForFunction(`${rows} === 120`);
      assert.equal(await page.locator("[data-contracts-more]").count(), 0);
      // Detail (terms) read on open only.
      const old = "c0000000-0000-4000-8000-000000000003";
      assert.equal(((await page.evaluate("window.calls")) as string[]).filter((c) => c.includes("/contracts/")).length, 0, "no detail before opening");
      await page.locator(`[data-contract-open="${old}"]`).click();
      await page.locator('[data-contract-detail="ready"]').waitFor();
      assert.match(await page.locator("[data-contract-terms]").innerText(), /Conditions du contrat 3$/);
      assert.ok(((await page.evaluate("window.calls")) as string[]).some((c) => c.startsWith(`/api/enterprise/contracts/${old}?organization_id=`)));
      // Write ⇒ causal re-read: page 1 + the open detail, fresh status.
      const before = ((await page.evaluate("window.calls")) as string[]).length;
      await page.locator("[data-contract-toggle-status]").click();
      await page.waitForFunction("window.saves.length === 1");
      const save = ((await page.evaluate("window.saves")) as Array<Record<string, unknown>>)[0];
      assert.deepEqual(JSON.parse(JSON.stringify(save)), { action: "save_contract", id: old, organization_id: "0a000000-0000-4000-8000-000000000001", title: "Contrat 3", reference: "REF-3", starts_on: "2026-01-01", terms: "Conditions du contrat 3", status: "archived" }, "existing command, same payload");
      await page.waitForFunction(`${rows} === 50`);
      const after = ((await page.evaluate("window.calls")) as string[]).slice(before);
      assert.ok(after.some((c) => c === "/api/enterprise/contracts?organization_id=0a000000-0000-4000-8000-000000000001"), "page 1 re-read");
      // The re-read page 1 does not hold contract 3 (older): open it again after paging → status fresh.
      await page.locator("[data-contracts-more]").click();
      await page.waitForFunction(`${rows} === 100`);
      await page.locator("[data-contracts-more]").click();
      await page.waitForFunction(`${rows} === 120`);
      await page.locator('[data-contract-detail="ready"]').waitFor();
      assert.match(await page.locator('[data-contract-detail="ready"]').innerText(), /Archivé/, "open detail re-read after the write");
      assert.ok(((await page.evaluate("window.calls")) as string[]).slice(before).some((c) => c.startsWith(`/api/enterprise/contracts/${old}?`)), "detail re-read after the write");
      // Create ⇒ the new contract is on the fresh page 1.
      await page.getByLabel("Intitulé").fill("Maintenance annuelle");
      await page.getByLabel("Référence").fill("MA-2026");
      await page.getByLabel("Début").fill("2026-11-01");
      await page.getByLabel("Conditions et grille tarifaire").fill("Visites trimestrielles.");
      await page.getByRole("button", { name: "Enregistrer le contrat" }).click();
      await page.waitForFunction("window.saves.length === 2");
      assert.equal(((await page.evaluate("window.saves")) as Array<Record<string, unknown>>)[1].organization_id, "0a000000-0000-4000-8000-000000000001");
      await page.locator("[data-contract-row]").first().waitFor();
      assert.match(await page.locator("[data-contract-row]").first().innerText(), /Maintenance annuelle/);
      // 422 on a cursor ⇒ restart at page 1 with a notice.
      await page.evaluate("window.bad = 'k50'");
      await page.locator("[data-contracts-more]").click();
      await page.locator("[data-contracts-notice]").waitFor();
      await page.waitForFunction(`${rows} === 50`);
      await page.evaluate("window.bad = null");
      // Organisation switch while a read is held ⇒ no old frame; sites-only scope ⇒ honest refusal.
      await page.evaluate("window.hold = (u) => u.includes('000000000001') ; window.setIdent({ uid: 'u1', gen: 2 })");
      await page.waitForFunction("window.gates.length >= 1");
      await page.evaluate("window.hold = null; window.setOrg(window.O(2))");
      await page.locator("[data-contracts-refused]").waitFor();
      await page.evaluate("while (window.gates.length) window.gates.shift()()");
      await page.waitForTimeout(200);
      assert.equal(await page.evaluate(rows), 0, "no old frame, late reply dropped");
      assert.match(await page.locator("[data-contracts-refused]").innerText(), /limité à certains sites/);
      for (const [org, re] of [[3, /comptes entreprise/], [4, /session a expiré/]] as const) {
        await page.evaluate(`window.setOrg(window.O(${org}))`);
        await page.waitForFunction(`document.querySelector('[data-contracts-refused]')?.textContent.match(${re})`);
        assert.equal(await page.evaluate(rows), 0);
      }
      // 503 ⇒ Réessayer (Retry-After honoured), then the list.
      await page.evaluate("window.setOrg(window.O(5))");
      await page.locator("[data-contracts-error]").waitFor();
      assert.equal(await page.locator("[data-contracts-retry]").isDisabled(), true);
      await page.evaluate("window.fail5 = false");
      await page.waitForFunction("!document.querySelector('[data-contracts-retry]')?.disabled", null, { timeout: 5000 });
      await page.locator("[data-contracts-retry]").click();
      await page.waitForFunction(`${rows} === 1`);
      // Identity switch ⇒ fresh read, no old frame.
      await page.evaluate("window.hold = () => true; window.setIdent({ uid: 'u2', gen: 3 })");
      await page.locator('[data-contracts="loading"]').waitFor();
      assert.equal(await page.evaluate(rows), 0);
      await page.evaluate("window.hold = null; while (window.gates.length) window.gates.shift()()");
      await page.waitForFunction(`${rows} === 1`);
      const small = await page.evaluate("[...document.querySelectorAll('[data-contracts] button')].filter((b) => b.getBoundingClientRect().height > 0 && b.getBoundingClientRect().height < 43.5).length");
      assert.equal(small, 0);
      assert.ok(((await page.evaluate("document.documentElement.scrollWidth")) as number) <= width);
      assert.deepEqual(errors, []);
    }
  } finally {
    await browser.close();
    server.close();
  }
});

test("Chromium : démo ⇒ liste locale inchangée, aucun fetch", { skip }, async () => {
  const { server, url } = await serve();
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 900 } })).newPage();
    await page.goto(url + "#demo");
    await page.getByRole("button", { name: "Contrats cadres" }).click();
    await page.getByText("Contrat démo").waitFor();
    assert.equal(await page.locator("[data-contracts]").count(), 0);
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate("window.fetches"), 0);
  } finally {
    await browser.close();
    server.close();
  }
});
