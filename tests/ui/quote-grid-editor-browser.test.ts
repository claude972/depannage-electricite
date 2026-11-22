import { fileURLToPath as localSourcePath } from "node:url";
// ENT-13 artisan draft editor with the contract grid, MOUNTED in Chromium (real React root,
// <StrictMode>, real CSS, fake session + stubbed fetch): applying the attached grid sets the draft
// from the exact apply envelope; « Enregistrer » is disabled while that draft is unmodified; send()
// does NOT re-save it; any manual edit drops the grid link (said) and send saves first.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { withApp, skip } from "./real-app-harness";

const ROOT = path.resolve(path.dirname(localSourcePath(import.meta.url)), "..", "..");
const PW = process.env.QA_PLAYWRIGHT_PATH || "/Users/claudebrafa/rea/node_modules/playwright-core";
const CHROMIUM = process.env.QA_CHROMIUM_PATH || path.join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell");
const available = existsSync(path.join(PW, "index.mjs")) && existsSync(CHROMIUM);
const same = (a: unknown, b: unknown, msg = "") => assert.equal(JSON.stringify(a), JSON.stringify(b), msg);

const ENTRY = `
import { createElement as h, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QuoteDraftEditor } from "./components/role/artisan-quote-draft";
const w = window;
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
const U = (p, n) => p + "0000000-0000-4000-8000-" + String(n).padStart(12, "0");
const JOB = U("2", 1), ME = U("1", 1), GRID = U("6", 1);
const TOKEN = "a".repeat(64), AT = "2026-11-07T10:00:00.000Z";
const draft = (version, lines, tax_rate = 8.5) => ({ intervention_id: JOB, artisan_id: ME, version, assignment_token: TOKEN, base_quote_id: null, lines, tax_rate, updated_at: AT });
function setup(expired = false) {
  const fetched = [];
  const commands = [];
  let current = null; // the server's statement of the grid the CURRENT draft comes from
  let env = { version: 4, assignment_token: TOKEN, current_quote_id: null, draft: draft(4, [{ label: "Libre", quantity: 1, unit_price_cents: 1000 }]) };
  w.fetch = async (url, init) => {
    fetched.push({ url: String(url), method: init?.method ?? "GET", body: init?.body ? JSON.parse(init.body) : null });
    const ok = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    if (String(url).endsWith("/quote-grid") && (init?.method ?? "GET") === "GET")
      return ok({ current, grids: [{ id: GRID, label: "Contrat 2026", version: 3, lines: [{ index: 0, label: "Déplacement", unit: "visit", unit_price_cents: 4500 }, { index: 1, label: "Main-d’œuvre", unit: "hour", unit_price_cents: 6000 }] }], next_cursor: null });
    if (String(url).endsWith("/quote-grid") && init?.method === "POST") {
      if (expired) return new Response("{}", { status: 401 });
      const b = JSON.parse(init.body);
      env = { version: b.expected_version + 1, assignment_token: TOKEN, current_quote_id: null, draft: draft(b.expected_version + 1, [{ label: "Déplacement", quantity: 2, unit_price_cents: 4500 }], b.tax_rate) };
      current = { grid_id: GRID, grid_version: 3, grid_label: "Contrat 2026" };
      return ok(env);
    }
    return new Response("{}", { status: 404 });
  };
  const session = {
    data: { quotes: [] }, busy: false, mode: "live", profileId: ME, capabilities: { quoteDrafts: "available" },
    loadQuoteDraft: async () => env,
    quoteDraftCommand: async (_id, body) => {
      commands.push(body.action);
      if (body.action === "save") { env = { ...env, version: env.version + 1, draft: draft(env.version + 1, body.lines, body.tax_rate) }; current = null; }
      if (body.action === "send") return { ok: true, envelope: { ...env, version: env.version + 1, draft: null, quote_id: U("3", 1) } };
      return { ok: true, envelope: env };
    },
  };
  const div = document.createElement("div"); document.body.appendChild(div);
  createRoot(div).render(h(StrictMode, null, h(QuoteDraftEditor, { session, interventionId: JOB, onPublished() {} })));
  return { div, fetched, commands };
}
const setValue = (el, v) => { const proto = Object.getPrototypeOf(el); Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); };
const saveBtn = (div) => div.querySelector("[data-quote-draft-save]");
const sendBtn = (div) => [...div.querySelectorAll("button")].find((b) => /Envoyer le devis au client/.test(b.textContent));
const labels = (div) => [...div.querySelectorAll('input[type="text"]')].map((i) => i.value).filter((v) => v !== "");
async function applied(div) {
  await tick(400);
  setValue(div.querySelector("[data-quote-grid-line='0'] input"), "2");
  await tick(50);
  div.querySelector("[data-quote-grid-apply]").click();
  await tick(400);
}
w.scenarios = {
  async untouched() {
    const { div, fetched, commands } = setup();
    await applied(div);
    const post = fetched.find((f) => f.method === "POST");
    const state = { post: post?.body, labels: labels(div), saveDisabled: saveBtn(div).disabled, linked: !!div.querySelector("[data-quote-grid-linked]"), dropped: !!div.querySelector("[data-quote-grid-dropped]") };
    sendBtn(div).click();
    await tick(300);
    return { ...state, commands, fetchedUrls: fetched.map((f) => f.method + " " + f.url) };
  },
  async edited() {
    const { div, commands } = setup();
    await applied(div);
    setValue(div.querySelector('input[type="text"]'), "Déplacement urgent");
    await tick(100);
    const state = { saveDisabled: saveBtn(div).disabled, linked: !!div.querySelector("[data-quote-grid-linked]"), dropped: !!div.querySelector("[data-quote-grid-dropped]") };
    sendBtn(div).click();
    await tick(300);
    return { ...state, commands };
  },
  async expired() {
    const { div, fetched } = setup(true);
    await applied(div);
    const button = div.querySelector("[data-quote-grid-apply]");
    button.click();
    return { error: div.querySelector("[data-quote-grid-apply-error]")?.textContent, disabled: button.disabled, labels: labels(div), posts: fetched.filter((f) => f.method === "POST").length };
  },
};
`;

test("éditeur de brouillon avec grille (Chromium, StrictMode) : enveloppe exacte, Enregistrer désactivé tant que non modifié, lien retiré par une modification", { skip: available ? false : "local Playwright/Chromium not found (SKIPPED, never PASS)" }, async () => {
  const out = await build({ absWorkingDir: ROOT, stdin: { contents: ENTRY, resolveDir: ROOT, loader: "tsx" }, bundle: true, write: false, outdir: "out", platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "local-css", ".svg": "dataurl", ".png": "dataurl" }, define: { "process.env.NODE_ENV": '"development"', "process.env.NEXT_PUBLIC_SUPABASE_URL": "undefined", "process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY": "undefined" }, logLevel: "error" });
  const js = out.outputFiles.find((f) => f.path.endsWith(".js"))!.text;
  const css = readFileSync(path.join(ROOT, "app/globals.css"), "utf8") + "\n" + out.outputFiles.filter((f) => f.path.endsWith(".css")).map((f) => f.text).join("\n");
  const server: Server = createServer((_rq, rs) => {
    rs.setHeader("content-type", "text/html");
    rs.end(`<!doctype html><meta name="viewport" content="width=device-width"><style>${css}</style><div class="ui-v2" id="app"></div><script>${js}</script>`);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true, args: ["--single-process"] });
  try {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 900 } })).newPage();
    const errors: string[] = [];
    page.on("pageerror", (e: Error) => errors.push(String(e)));
    await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}/`);
    const run = (n: string) => page.evaluate((x: string) => (window as unknown as { scenarios: Record<string, () => Promise<unknown>> }).scenarios[x](), n);
    const a = (await run("untouched")) as { post: Record<string, unknown>; labels: string[]; saveDisabled: boolean; linked: boolean; dropped: boolean; commands: string[]; fetchedUrls: string[] };
    same(a.post, { grid_id: "60000000-0000-4000-8000-000000000001", grid_version: 3, selection: [{ index: 0, quantity: 2 }], expected_version: 4, assignment_token: "a".repeat(64), base_quote_id: null, tax_rate: 8.5 }, "apply body: explicit tax rate, draft idempotency");
    same([a.labels, a.saveDisabled, a.linked, a.dropped], [["Déplacement"], true, true, false], "draft = exact envelope; Enregistrer disabled; link shown");
    same(a.commands, ["send"], "an unmodified grid draft is never re-saved before sending");
    const b = (await run("edited")) as { saveDisabled: boolean; linked: boolean; dropped: boolean; commands: string[] };
    same([b.saveDisabled, b.linked, b.dropped], [false, false, true], "manual edit: Enregistrer enabled, link dropped and said");
    same(b.commands, ["save", "send"], "dirty ⇒ saved (new version, no grid link) then sent");
    same(await run("expired"), { error: "Votre session a expiré. Reconnectez-vous pour appliquer la grille.", disabled: true, labels: ["Libre"], posts: 1 });
    same(errors, []);
  } finally {
    await browser.close();
    server.close();
  }
});

test("app réelle (démo) : aucun appel /api ni erreur, pas de débordement à 390 (artisan, client, gestionnaire)", { skip }, async () => {
  await withApp(async (open) => {
    for (const route of ["artisan-detail.demo-001", "client-quote.quote-demo-1", "manager-detail.demo-001"]) {
      const { page, errors, api } = await open(route, 390);
      const r = await page.evaluate(() => ({ source: !!document.querySelector("[data-quote-grid-source]"), overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
      same([r.source, r.overflow <= 0, api, errors], [false, true, [], []], route);
      await page.context().close();
    }
  });
});
