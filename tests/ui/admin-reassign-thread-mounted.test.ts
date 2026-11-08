// ADM-03 + ADM-07 mounted: real AdminSpace in live (injected fake Session, StrictMode, Chromium 390
// and 1280 px), dossier view. Reassign picker reads the server directory (150 approved artisans,
// beyond the 100 overview rows): search + « Afficher plus », the reassign command carries the exact
// id. Thread reads the paginated /api/messages (old dossier, 60 messages), refusals (401/404), error +
// Réessayer, dossier switch without old frame, sent reply merged once. No admin account is created.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { serveLiveAdmin } from "./admin-live-space-harness";
import { withApp, skip as appSkip } from "./real-app-harness";

const PW = process.env.QA_PLAYWRIGHT_PATH || "/Users/claudebrafa/rea/node_modules/playwright-core";
const CHROMIUM = process.env.QA_CHROMIUM_PATH || path.join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell");
const available = existsSync(path.join(PW, "index.mjs")) && existsSync(CHROMIUM);
const skip = available ? false : "local Playwright/Chromium not found (SKIPPED, never PASS)";

const SETUP = `
const U = (p, n) => p + "0000000-0000-4000-8000-" + String(n).padStart(12, "0");
window.U = U;
window.uid = U("e", 1);
window.view = "detail";
const D = (n) => U("d", n), A = (n) => U("a", n);
window.param = D(1);
const intervention = (id) => ({ id, client_id: U("c", 1), artisan_id: A(1), site_id: null, category: "panel", description: "Tableau", address: "3 rue des Ateliers", postal_code: "97200", city: "Fort-de-France", urgency: "scheduled", status: "assigned", estimate_min_cents: 10000, estimate_max_cents: 20000, created_at: "2024-02-01T10:00:00Z" });
const artisan = (n) => ({ id: A(n), full_name: n === 142 ? "Zéphyrin Lointain" : "Artisan " + n, phone: "", artisan_approved: true, created_at: new Date(Date.UTC(2026, 0, 1) - n * 3600000).toISOString(), company_name: n === 142 ? "Lointain Élec" : null, application_status: n === 77 ? "submitted" : "approved" });
const all = Array.from({ length: 150 }, (_, k) => artisan(k + 1));
window.dirCalls = []; window.dirFail = 0; window.operations = [];
const overview = { counts: { interventions: 1, active_interventions: 1, artisans: 150, pending_applications: 0, clients: 1, organizations: 0 }, financial: { paid_service_cents: 0, currency: "eur", platform_revenue_cents: null, note: "" },
  artisans: all.slice(0, 100).map((a) => ({ ...a, role: "artisan" })), clients: [], organizations: [], interventions: [], audit: [],
  capabilities: { dispatch_before_quote_acceptance: true, refunds: false, invoices: false, support_tickets: false, list_limit: 100 } };
// Thread store: D1 = old dossier with 60 messages; D2 = 404; D3 = 503 once; D4 = 401.
const msg = (d, n) => ({ id: U("f", d * 1000 + n), intervention_id: D(d), author_id: n % 2 ? U("c", 1) : A(1), body: "Message " + n + " du dossier " + d, created_at: new Date(Date.UTC(2024, 1, 1) + n * 60000).toISOString() });
window.thread = { 1: Array.from({ length: 60 }, (_, k) => msg(1, k + 1)), 3: [msg(3, 1)] };
for (const d of [5, 6, 7, 8]) window.thread[d] = Array.from({ length: 40 }, (_, k) => msg(d, k + 1));
window.failOlder = 0;
window.msgCalls = []; window.msgHold = null; window.msgGates = []; window.fail3 = 1;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
window.respond = async (url, init) => {
  if (url.startsWith("/api/messages")) {
    window.msgCalls.push(url);
    const u = new URL(url, location.href), id = u.searchParams.get("intervention_id"), c = u.searchParams.get("cursor"), limit = Number(u.searchParams.get("limit"));
    if (window.msgHold && window.msgHold(id)) await new Promise((r) => window.msgGates.push(r));
    const d = Number(id.slice(-12));
    if (d === 2) return json({ error: "Introuvable" }, 404);
    if (d === 4) return json({ error: "Session" }, 401);
    if (d === 3 && window.fail3) return json({ error: "x" }, 503);
    if (c && window.failOlder) return json({ error: "x" }, window.failOlder);
    const rows = [...(window.thread[d] || [])].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    const start = c ? Number(c.slice(1)) : 0;
    const page = rows.slice(start, start + limit), more = start + limit < rows.length;
    return json({ messages: page, page: { limit, has_more: more, next_cursor: more ? "c" + (start + limit) : null } });
  }
  if (url === "/api/admin/messages" && init && init.method === "POST") {
    const cmd = JSON.parse(init.body);
    const m = { id: cmd.id, intervention_id: cmd.intervention_id, author_id: window.uid, body: cmd.body, created_at: new Date().toISOString() };
    const d = Number(cmd.intervention_id.slice(-12));
    window.thread[d] = [...(window.thread[d] || []), m];
    window.sentId = cmd.id;
    return json({ message: m });
  }
  return json({ error: "x" }, 503);
};
window.seed = { data: { interventions: [], quotes: [], messages: [] }, session: {
  loadAdminOverview: async () => JSON.parse(JSON.stringify(overview)),
  loadAdminIntervention: async (id) => ({ intervention: intervention(id), quotes: [], quotes_limit: 20, quotes_limited: false }),
  loadOperations: async () => null,
  loadAdminDirectory: async (kind, params) => {
    window.dirCalls.push({ kind, ...params });
    if (window.dirFail > 0) { window.dirFail--; return null; }
    const rows = all.filter((a) => params.approved === undefined || a.artisan_approved === params.approved).filter((a) => !params.q || a.full_name.toLowerCase().includes(params.q.toLowerCase()));
    const start = params.cursor ? Number(params.cursor.slice(1)) : 0, limit = params.limit;
    const more = start + limit < rows.length;
    return { kind, items: rows.slice(start, start + limit), page: { limit, has_more: more, next_cursor: more ? "k" + (start + limit) : null, total: rows.length }, filters: { q: params.q ?? null, approved: params.approved ?? null, role: null, owner_id: null } };
  },
  operate: async (id, body) => { window.operations.push({ id, body }); return true; },
  ensureFresh: async () => true,
} };
`;

async function run(fn: (page: import("./real-app-harness").Page, width: number) => Promise<void>) {
  const { server, url } = await serveLiveAdmin(SETUP);
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    for (const width of [390, 1280]) {
      const page = await (await browser.newContext({ viewport: { width, height: 1000 } })).newPage();
      const errors: string[] = [];
      page.on("pageerror", (e: Error) => errors.push(String(e)));
      await page.goto(url);
      await fn(page, width);
      assert.ok(((await page.evaluate("document.documentElement.scrollWidth")) as number) <= width, "no horizontal overflow");
      assert.deepEqual(errors, []);
    }
  } finally {
    await browser.close();
    server.close();
  }
}
const A142 = "a0000000-0000-4000-8000-000000000142";

test("ADM-03 : artisan approuvé au-delà des 100 trouvé par recherche ⇒ la commande reassign porte son id ; Afficher plus ; erreur ⇒ Réessayer", { skip }, async () => {
  await run(async (page) => {
    await page.locator('[data-artisan-picker="ready"]').waitFor();
    assert.equal(await page.locator("[data-picker-option]").count(), 25, "25 per page");
    await page.locator("[data-picker-more]").click();
    await page.waitForFunction("document.querySelectorAll('[data-picker-option]').length === 50");
    assert.equal(await page.locator(`[data-picker-option="${A142}"]`).count(), 0, "not loaded yet");
    const calls = (await page.evaluate("window.dirCalls")) as Array<Record<string, unknown>>;
    assert.ok(calls.every((c) => c.kind === "artisans" && c.approved === true), "kind=artisans&approved=true");
    assert.ok(calls.some((c) => c.cursor === "k25"), "cursor followed");
    // Error ⇒ Réessayer.
    await page.evaluate("window.dirFail = 2");
    await page.getByLabel("Rechercher un artisan approuvé").fill("Zéph");
    await page.locator("[data-picker-search]").click();
    await page.locator("[data-picker-error]").waitFor();
    assert.equal(await page.locator("[data-picker-option]").count(), 0, "no stale options on error");
    await page.evaluate("window.dirFail = 0");
    await page.locator("[data-picker-error] button").click();
    await page.locator(`[data-picker-option="${A142}"]`).waitFor();
    assert.match(await page.locator(`[data-picker-option="${A142}"]`).innerText(), /Zéphyrin Lointain — Lointain Élec/);
    assert.equal(((await page.evaluate("window.dirCalls")) as Array<Record<string, unknown>>).at(-1)!.q, "Zéph");
    // Approved account whose artisan dossier is not approved ⇒ not offered.
    await page.getByLabel("Rechercher un artisan approuvé").fill("Artisan 77");
    await page.keyboard.press("Enter");
    await page.locator("[data-picker-empty]").waitFor();
    // Empty search result.
    await page.getByLabel("Rechercher un artisan approuvé").fill("Personne");
    await page.keyboard.press("Enter");
    await page.locator("[data-picker-empty]").waitFor();
    // Back to the beyond-100 artisan, select it, reassign.
    await page.getByLabel("Rechercher un artisan approuvé").fill("Zéphyrin");
    await page.locator("[data-picker-search]").click();
    await page.locator(`[data-picker-option="${A142}"] input`).check();
    await page.getByLabel("Motif (obligatoire)").fill("Artisan indisponible cette semaine");
    await page.getByRole("button", { name: "Réaffecter", exact: true }).click();
    await page.getByRole("button", { name: "Confirmer la réaffectation" }).click();
    await page.waitForFunction("window.operations.length === 1");
    const ops = (await page.evaluate("window.operations")) as Array<{ id: string; body: Record<string, unknown> }>;
    assert.equal(ops[0].id, "d0000000-0000-4000-8000-000000000001");
    assert.deepEqual(ops[0].body, { action: "reassign", artisan_id: A142, reason: "Artisan indisponible cette semaine" }, "same command, exact id");
    await page.evaluate("window.operations = []; window.dirCalls = []");
  });
});

test("ADM-07 : ancien fil paginé depuis /api/messages ; envoi fusionné sans doublon ; changement de dossier sans ancien fil ; 404 / 401 / erreur + Réessayer", { skip }, async () => {
  await run(async (page) => {
    await page.locator("[data-message-id]").first().waitFor();
    assert.equal(await page.locator("[data-message-id]").count(), 25, "newest page");
    await page.locator("[data-admin-thread-older]").click();
    await page.waitForFunction("document.querySelectorAll('[data-message-id]').length === 50");
    await page.locator("[data-admin-thread-older]").click();
    await page.waitForFunction("document.querySelectorAll('[data-message-id]').length === 60");
    assert.equal(await page.locator("[data-admin-thread-older]").count(), 0, "end of thread");
    assert.match(await page.locator("[data-message-id]").first().innerText(), /Message 1 du dossier 1/, "oldest first");
    const calls = (await page.evaluate("window.msgCalls")) as string[];
    assert.ok(calls.some((c) => c.includes("intervention_id=d0000000-0000-4000-8000-000000000001") && c.includes("cursor=c25")));
    // Send: merged once, then a fresh page 1 (identity generation bump) still shows it once.
    await page.getByLabel("Répondre dans le fil (signé « Exploitant »)").fill("Nous recontactons l’artisan.");
    await page.getByRole("button", { name: "Envoyer", exact: true }).click();
    await page.waitForFunction("window.sentId && document.querySelectorAll('[data-message-id=\"' + window.sentId + '\"]').length === 1");
    await page.evaluate("window.gen = 2; window.rerender()");
    await page.waitForFunction("document.querySelectorAll('[data-message-id]').length === 25");
    assert.equal(await page.evaluate("document.querySelectorAll('[data-message-id=\"' + window.sentId + '\"]').length"), 1, "server copy + local copy deduplicated");
    // Dossier switch while D1's read is pending ⇒ no old frame; D2 = 404 ⇒ honest refusal, no messages.
    await page.evaluate("window.msgHold = (id) => id.endsWith('000000000001'); window.gen = 3; window.rerender()");
    await page.waitForFunction("window.msgGates.length >= 1");
    await page.evaluate(`window.msgHold = null; window.param = window.U("d", 2); window.view = "detail"; window.rerender()`);
    await page.locator('[data-admin-thread="refused"]').waitFor();
    await page.evaluate("while (window.msgGates.length) window.msgGates.shift()()"); // late D1 replies
    await page.waitForTimeout(200);
    assert.equal(await page.locator("[data-message-id]").count(), 0, "no stale messages after switch");
    assert.match(await page.locator('[data-admin-thread="refused"]').innerText(), /introuvable ou hors de vos droits/);
    assert.equal(await page.locator("[data-admin-reply]").count(), 0, "404 page 1 ⇒ composer hidden");
    // D3: 503 ⇒ error + Réessayer ⇒ loaded.
    await page.evaluate(`window.param = window.U("d", 3); window.rerender()`);
    await page.locator('[data-admin-thread="error"]').waitFor();
    await page.evaluate("window.fail3 = 0");
    await page.locator('[data-admin-thread="error"]').getByRole("button", { name: "Réessayer" }).click();
    await page.locator("[data-message-id]").first().waitFor();
    assert.equal(await page.locator("[data-message-id]").count(), 1);
    // D4: 401 ⇒ session message, no messages.
    await page.evaluate(`window.param = window.U("d", 4); window.rerender()`);
    await page.locator('[data-admin-thread="refused"]').waitFor();
    assert.match(await page.locator('[data-admin-thread="refused"]').innerText(), /session a expiré/);
    assert.equal(await page.locator("[data-message-id]").count(), 0);
    assert.equal(await page.locator("[data-admin-reply]").count(), 0, "401 page 1 ⇒ composer hidden");
    // A refusal on a NEXT page (401 / 403 / 404) ⇒ the verified rows are cleared and the composer hidden.
    for (const [d, status, text] of [[5, 401, /session a expiré/], [6, 403, /droits ne permettent plus/], [7, 404, /introuvable ou hors de vos droits/]] as const) {
      await page.evaluate(`window.failOlder = 0; window.param = window.U("d", ${d}); window.rerender()`);
      await page.waitForFunction("document.querySelectorAll('[data-message-id]').length === 25");
      assert.equal(await page.locator('[data-admin-reply="open"]').count(), 1, "composer shown while authorized");
      await page.evaluate(`window.failOlder = ${status}`);
      await page.locator("[data-admin-thread-older]").click();
      await page.locator('[data-admin-thread="refused"]').waitFor();
      assert.match(await page.locator('[data-admin-thread="refused"]').innerText(), text);
      assert.equal(await page.locator("[data-message-id]").count(), 0, `${status} on page 2 ⇒ no private rows`);
      assert.equal(await page.locator("[data-admin-reply]").count(), 0, `${status} on page 2 ⇒ composer hidden`);
    }
    // 503 on a next page ⇒ the verified page stays, « Réessayer » resumes at the same cursor.
    await page.evaluate(`window.failOlder = 0; window.param = window.U("d", 8); window.rerender()`);
    await page.waitForFunction("document.querySelectorAll('[data-message-id]').length === 25");
    await page.evaluate("window.failOlder = 503");
    await page.locator("[data-admin-thread-older]").click();
    await page.locator("[data-admin-thread-older-error]").waitFor();
    assert.equal(await page.locator("[data-message-id]").count(), 25, "503 ⇒ page kept");
    assert.equal(await page.locator('[data-admin-reply="open"]').count(), 1, "503 ⇒ composer kept");
    assert.equal(await page.locator("[data-admin-thread-older]").innerText(), "Réessayer");
    await page.evaluate("window.failOlder = 0");
    await page.locator("[data-admin-thread-older]").click();
    await page.waitForFunction("document.querySelectorAll('[data-message-id]').length === 40");
    assert.ok(((await page.evaluate("window.msgCalls")) as string[]).filter((c) => c.includes("000000000008") && c.includes("cursor=c25")).length >= 2, "same cursor resumed");
    // Reset for the next viewport.
    await page.evaluate(`window.param = window.U("d", 1); window.gen = 1; window.fail3 = 1; window.thread[1] = window.thread[1].filter((m) => m.id !== window.sentId); window.sentId = null; window.rerender()`);
  });
});

test("app réelle (démo, 390 px) : dossier admin — sélecteur et fil locaux inchangés, aucun /api", { skip: appSkip }, async () => {
  await withApp(async (open) => {
    const { page, errors, api } = await open("admin-detail.demo-001", 390);
    await page.waitForTimeout(1200);
    assert.match(await page.locator("body").innerText(), /Messages du dossier/);
    assert.equal(await page.locator("[data-artisan-picker]").count(), 0, "demo keeps the overview select");
    assert.equal(await page.locator("[data-admin-thread]").count(), 0, "demo keeps the local thread");
    assert.deepEqual(api, []);
    assert.deepEqual(errors, []);
  });
});
