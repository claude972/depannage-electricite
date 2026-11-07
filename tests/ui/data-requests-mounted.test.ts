// SYS-07 mounted for real (React root, StrictMode, local Chromium, 360 px light/dark):
// client « Mes demandes d’effacement » inside AccountDataPanel (opt-in): error ⇒ retry, pagination,
// distinct labels, never « effacé » on a request; the POST receipt's request shown and the list
// re-read. Operator: paged list, detail + history, form only when can_decide and not terminal, one
// POST per decision with the stored command, 409 ⇒ re-read without replay, 403 ⇒ refusal, identity
// change ⇒ reset.
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
import { AccountDataPanel } from "./components/features/account-data/account-data-panel";
import { OperatorDataRequests } from "./components/features/data-requests/operator-data-requests";
const cfg = JSON.parse(decodeURIComponent(location.hash.slice(1) || "{}"));
const U = (n) => "90000000-0000-4000-8000-" + String(n).padStart(12, "0");
const T = "2026-11-07T21:00:00Z";
const req = (n, o) => ({ id: U(n), ticket_id: U(500 + n), state: "requested", execution_state: "not_started", version: 1, created_at: T, updated_at: T, ...(o || {}) });
const S = window.S = { calls: [], listFail: cfg.listFail || 0, rows: cfg.rows || [], detail: cfg.detail, postMode: cfg.postMode || "ok", gen: 1, opened: [] };
const json = (b, s) => new Response(JSON.stringify(b), { status: s || 200, headers: { "Content-Type": "application/json" } });
const fetcher = async (url, init) => {
  const method = (init && init.method) || "GET";
  S.calls.push(method + " " + url + (init && init.body ? " " + init.body : ""));
  const u = new URL(url, location.href);
  if (u.pathname === "/api/profile/data" && method === "GET") {
    if (S.listFail > 0) { S.listFail--; return json({ error: "x" }, 503); }
    const after = u.searchParams.get("after");
    const all = S.rows;
    if (!after) return json({ section: "erasure_requests", rows: all.slice(0, 2), next_cursor: all.length > 2 ? all[1].id : null });
    return json({ section: "erasure_requests", rows: all.slice(2), next_cursor: null });
  }
  if (u.pathname === "/api/profile/data" && method === "POST") {
    const body = JSON.parse(init.body);
    const r = req(9);
    S.rows = [...S.rows, r];
    return json({ ticket_id: r.ticket_id, status: "open", replayed: false, request: r });
  }
  if (u.pathname === "/api/admin/data-requests") {
    if (cfg.opForbidden) return json({}, 403);
    const after = u.searchParams.get("after");
    return after ? json({ rows: [req(3, { state: "approved", version: 4 })], next_cursor: null }) : json({ rows: [req(1, { state: "in_review", version: 3 }), req(2)], next_cursor: U(2) });
  }
  if (u.pathname.startsWith("/api/admin/data-requests/")) {
    const id = u.pathname.split("/").pop();
    if (method === "POST") {
      S.stored = sessionStorage.getItem("courant-private-data-requests:10000000-0000-4000-8000-0000000000cd:" + S.gen + ":" + id);
      const b = JSON.parse(init.body);
      if (S.postMode === "409") return json({}, 409);
      if (S.postMode === "403") return json({}, 403);
      S.detail = { ...S.detail, request: { ...S.detail.request, state: b.state, version: b.expected_version + 1 }, history: [{ id: U(901), actor_id: U(77), from_state: S.detail.request.state, to_state: b.state, reason: b.reason, version: b.expected_version + 1, created_at: T }, ...S.detail.history] };
      return json({ request: S.detail.request, replayed: false });
    }
    return json(S.detail || { request: req(Number(id.slice(-3)), { state: "in_review", version: 3 }), history: [{ id: U(900), actor_id: U(77), from_state: "requested", to_state: "in_review", reason: "Examen", version: 3, created_at: T }], can_decide: cfg.canDecide !== false });
  }
  return json({}, 404);
};
document.documentElement.setAttribute("data-ui-theme", cfg.theme || "light");
let n = 0;
const ids = () => "70000000-0000-4000-8000-" + String(++n).padStart(12, "0");
function Host() {
  const [gen, setGen] = useState(1);
  window.switchIdentity = () => { S.gen++; setGen(S.gen); };
  const ctx = { userId: () => "10000000-0000-4000-8000-0000000000cd", generation: () => S.gen };
  return cfg.operator
    ? h(OperatorDataRequests, { context: ctx, fetcher, newId: ids })
    : h(AccountDataPanel, { demo: false, context: ctx, fetcher, erasureRequests: true, onOpenTicket: (t) => S.opened.push(t) });
}
const div = document.createElement("div"); document.body.appendChild(div);
createRoot(div).render(h(StrictMode, null, h(Host)));
`;
type S = { calls: string[]; rows: unknown[]; detail: unknown; stored?: string | null; opened: string[]; postMode: string };

async function serve() {
  const b = await build({ absWorkingDir: ROOT, stdin: { contents: ENTRY, resolveDir: ROOT, loader: "tsx" }, bundle: true, write: false, outdir: "out", platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "local-css" }, define: { "process.env.NODE_ENV": '"development"' }, logLevel: "error" });
  const js = b.outputFiles.find((f) => f.path.endsWith(".js"))!.text;
  const css = readFileSync(path.join(ROOT, "app/globals.css"), "utf8") + b.outputFiles.filter((f) => f.path.endsWith(".css")).map((f) => f.text).join("\n");
  const server: Server = createServer((_q, r) => { r.setHeader("content-type", "text/html"); r.end(`<!doctype html><meta name="viewport" content="width=device-width"><style>${css}</style><body class="ui-v2"><script>${js}</script></body>`); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { server, base: `http://127.0.0.1:${(server.address() as { port: number }).port}/` };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const U = (n: number) => `90000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const req = (n: number, o: Record<string, unknown> = {}) => ({ id: U(n), ticket_id: U(500 + n), state: "requested", execution_state: "not_started", version: 1, created_at: "2026-11-07T21:00:00Z", updated_at: "2026-11-07T21:00:00Z", ...o });
async function open(browser: Any, base: string, cfg: Record<string, unknown>) {
  const page = await (await browser.newContext({ viewport: { width: 360, height: 900 } })).newPage();
  const errors: string[] = [];
  page.on("pageerror", (e: Error) => errors.push(String(e)));
  await page.goto(`${base}#${encodeURIComponent(JSON.stringify(cfg))}`);
  return { page, errors };
}
const SMALL = `(() => ({ sw: document.documentElement.scrollWidth, small: [...document.querySelectorAll("button, select, textarea")].filter((e) => { const r = e.getBoundingClientRect(); return r.height > 0 && r.height < 43.5; }).map((e) => e.textContent.trim()) }))()`;

test("Chromium client : erreur ⇒ réessayer ; pagination ; libellés distincts ; jamais « effacé » ; reçu avec demande ⇒ liste relue", { skip }, async () => {
  const { server, base } = await serve();
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    for (const theme of ["light", "dark"]) {
      const { page, errors } = await open(browser, base, { theme, listFail: 2, rows: [req(1, { state: "approved", version: 3 }), req(2), req(3, { state: "rejected", version: 2 })] });
      await page.locator('[data-erasure-requests="error"]').waitFor();
      await page.locator('[data-erasure-requests="error"]').getByRole("button", { name: "Réessayer" }).click();
      await page.locator("[data-erasure-request]").first().waitFor();
      assert.equal(await page.locator("[data-erasure-request]").count(), 2);
      await page.locator("[data-erasure-more]").click();
      await page.locator(`[data-erasure-request="${U(3)}"]`).waitFor();
      const approved = await page.locator(`[data-erasure-request="${U(1)}"]`).innerText();
      assert.match(approved, /Demande : Approuvée/);
      assert.match(approved, /Effacement non commencé/);
      const items = await page.locator("[data-erasure-request]").allInnerTexts();
      for (const t of items) assert.doesNotMatch(t, /\beffacée?s?\b|supprimée?s?\b/i);
      await page.locator(`[data-erasure-ticket="${U(501)}"]`).click();
      assert.deepEqual((await page.evaluate(() => (window as unknown as { S: S }).S.opened)), [U(501)]);
      const layout = (await page.evaluate(SMALL)) as { sw: number; small: string[] };
      assert.equal(layout.sw, 360, theme);
      assert.deepEqual(layout.small, [], theme);
      // Existing confirmation unchanged, then the receipt shows the request and the list is re-read.
      await page.getByRole("button", { name: "Demander l’effacement" }).click();
      await page.getByRole("button", { name: "Confirmer la demande d’effacement" }).click();
      await page.locator('[data-account-erasure-request="requested"]').waitFor();
      assert.match(await page.locator('[data-account-erasure-request="requested"]').innerText(), /État de la demande : Demande reçue · Effacement non commencé/);
      assert.match(await page.locator("[data-account-erasure-ticket]").innerText(), /Statut du ticket : ouvert/);
      await page.locator(`[data-erasure-more]`).click();
      await page.locator(`[data-erasure-request="${U(9)}"]`).waitFor();
      assert.deepEqual(errors, []);
      await page.context().close();
    }
    const { page } = await open(browser, base, { rows: [] });
    await page.locator("[data-erasure-empty]").waitFor();
    await page.context().close();
  } finally {
    await browser.close();
    server.close();
  }
});

test("Chromium opérateur : liste paginée, détail + historique, formulaire seulement si can_decide et non terminal, POST unique, 409 sans rejeu, 403 refus, identité ⇒ remise à zéro", { skip }, async () => {
  const { server, base } = await serve();
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    const detail = { request: req(1, { state: "in_review", version: 3 }), history: [{ id: U(900), actor_id: U(77), from_state: "requested", to_state: "in_review", reason: "Examen", version: 3, created_at: "2026-11-07T21:00:00Z" }], can_decide: true };
    let { page, errors } = await open(browser, base, { operator: true, detail });
    await page.locator("[data-op-erasure-row]").first().waitFor();
    await page.locator("[data-op-erasure-more]").click();
    await page.locator(`[data-op-erasure-row="${U(3)}"]`).waitFor();
    await page.locator(`[data-op-erasure-row="${U(1)}"]`).getByRole("button", { name: "Examiner" }).click();
    await page.locator("[data-op-erasure-form]").waitFor();
    assert.match(await page.locator('[data-op-erasure-detail="ready"]').innerText(), /En cours d’examen \(version 3\)[\s\S]*Effacement non commencé[\s\S]*Demande reçue → En cours d’examen[\s\S]*Examen/);
    assert.equal(await page.getByLabel("Motif (obligatoire, 1000 caractères au plus)").inputValue(), "", "nothing pre-filled");
    await page.getByLabel("Nouvel état").selectOption("needs_information");
    await page.getByRole("button", { name: "Enregistrer la décision" }).click();
    assert.match(await page.locator("[data-op-erasure-error]").innerText(), /motif/);
    await page.getByLabel("Motif (obligatoire, 1000 caractères au plus)").fill("Justificatif d’identité demandé");
    await page.getByRole("button", { name: "Enregistrer la décision" }).click();
    await page.locator("[data-op-erasure-notice]").waitFor();
    let s = await page.evaluate(() => (window as unknown as { S: S }).S) as S;
    const posts = s.calls.filter((c) => c.startsWith("POST"));
    assert.equal(posts.length, 1);
    const cmd = JSON.parse(posts[0].slice(posts[0].indexOf("{")));
    assert.deepEqual({ ...cmd, command_id: undefined }, { command_id: undefined, expected_version: 3, state: "needs_information", reason: "Justificatif d’identité demandé" });
    assert.equal(JSON.parse(s.stored!).command.command_id, cmd.command_id);
    assert.match(await page.locator("[data-op-erasure-notice]").innerText(), /Aucun effacement n’est déclenché/);
    const layout = (await page.evaluate(SMALL)) as { sw: number; small: string[] };
    assert.deepEqual(layout.small, []);
    // Identity change ⇒ reset (selection closed, list reloaded).
    await page.evaluate(() => (window as unknown as { switchIdentity: () => void }).switchIdentity());
    await page.waitForTimeout(200);
    assert.equal(await page.locator("[data-op-erasure-detail]").count(), 0);
    assert.deepEqual(errors, []);
    await page.context().close();

    // Terminal state / can_decide=false ⇒ no form.
    for (const cfg of [{ detail: { ...detail, request: req(1, { state: "approved", version: 4 }) } }, { detail: { ...detail, can_decide: false } }]) {
      ({ page } = await open(browser, base, { operator: true, ...cfg }));
      await page.locator(`[data-op-erasure-row="${U(1)}"]`).getByRole("button", { name: "Examiner" }).click();
      await page.locator("[data-op-erasure-noform]").waitFor();
      assert.equal(await page.locator("[data-op-erasure-form]").count(), 0);
      await page.context().close();
    }

    // 409 ⇒ honest message + re-read, no replay.
    ({ page } = await open(browser, base, { operator: true, detail, postMode: "409" }));
    await page.locator(`[data-op-erasure-row="${U(1)}"]`).getByRole("button", { name: "Examiner" }).click();
    await page.getByLabel("Nouvel état").selectOption("approved");
    await page.getByLabel("Motif (obligatoire, 1000 caractères au plus)").fill("Vérifié");
    await page.getByRole("button", { name: "Enregistrer la décision" }).click();
    await page.locator("[data-op-erasure-error]").waitFor();
    assert.match(await page.locator("[data-op-erasure-error]").innerText(), /a changé entre-temps : rien n’est renvoyé automatiquement/);
    await page.waitForTimeout(200);
    s = await page.evaluate(() => (window as unknown as { S: S }).S) as S;
    assert.equal(s.calls.filter((c) => c.startsWith("POST")).length, 1);
    assert.equal(await page.getByRole("button", { name: "Réessayer" }).count(), 0, "no replay offered");
    await page.context().close();

    // 403 on the list ⇒ scope refusal.
    ({ page } = await open(browser, base, { operator: true, opForbidden: true }));
    await page.locator("[data-op-erasure-forbidden]").waitFor();
    assert.match(await page.locator("[data-op-erasure-forbidden]").innerText(), /habilitations d’assistance/);
    await page.context().close();
  } finally {
    await browser.close();
    server.close();
  }
});
