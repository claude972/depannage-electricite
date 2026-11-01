// Optional email access (AccountUpgrade): hidden unless the server says « eligible client »;
// honest outcomes; single flight; never a sign-up or a client-side Supabase auth call. Pure tests
// + ONE single-process Chromium mount with a fake API (no network, no SMTP, no real account).
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { build } from "esbuild";
import { ROOT, loadModule } from "../documents/harness";
import type * as Upgrade from "../../components/role/account-upgrade";

const up = loadModule("components/role/account-upgrade.tsx") as unknown as typeof Upgrade;
const same = (a: unknown, b: unknown, msg = "") => assert.equal(JSON.stringify(a), JSON.stringify(b), msg);
const res = (status: number, body: unknown, retryAfter: number | null = null) => ({ status, body, retryAfter });
const ELIGIBLE = { authenticated: true, verified_phone: true, phone_suffix: "3456", role: "client", email_account: false };

test("visibilité : seule une session client vérifiée sans compte email affiche la carte", () => {
  assert.equal(up.isEligible(res(200, ELIGIBLE)), true);
  for (const [name, r] of [
    ["non authentifié", res(200, { ...ELIGIBLE, authenticated: false })],
    ["téléphone non vérifié", res(200, { ...ELIGIBLE, verified_phone: false })],
    ["rôle artisan", res(200, { ...ELIGIBLE, role: "artisan" })],
    ["compte email existant", res(200, { ...ELIGIBLE, email_account: true })],
    ["champ manquant", res(200, { authenticated: true, verified_phone: true, role: "client" })],
    ["erreur session", res(503, null)],
    ["délai", res(up.UPGRADE_TIMEOUT, null)],
    ["absent", null],
  ] as const) assert.equal(up.isEligible(r as never), false, name);
  // SSR : rien n’est rendu tant que l’éligibilité n’est pas prouvée.
  assert.equal(renderToString(createElement(up.AccountUpgrade as never, {} as never)), "");
  const html = renderToString(createElement(up.AccountUpgrade as never, { initialEligible: true } as never));
  assert.match(html, /aria-expanded="false"[^>]*>.*Créer un accès par email \(facultatif\)/s);
  assert.doesNotMatch(html, /type="password"/); // repliée par défaut
});

test("validation locale et issues honnêtes (200, 409, 422, 429, 503, délai, réseau)", () => {
  same(Object.keys(up.upgradeErrors({ email: "x", password: "court", confirm: "autre" })).sort(), ["confirm", "email", "password"]);
  same(up.upgradeErrors({ email: "a@b.fr", password: "0123456789", confirm: "0123456789" }), {});
  assert.ok(up.upgradeErrors({ email: "a@b.fr", password: "x".repeat(129), confirm: "x".repeat(129) }).password);
  same(up.applyUpgrade(res(200, { confirmation_required: true })), { done: true, message: up.UPGRADE_COPY.sent, fieldErrors: {} });
  assert.match(up.UPGRADE_COPY.sent, /si l’adresse est valide/);
  assert.doesNotMatch(up.UPGRADE_COPY.sent, /reçu|a été envoyé à/);
  assert.equal(up.applyUpgrade(res(200, {})).done, false); // jamais de succès non affirmé par le serveur
  same(up.applyUpgrade(res(409, null)), { done: false, message: up.UPGRADE_COPY.used, fieldErrors: {} });
  same(up.applyUpgrade(res(422, { field: "password" })).fieldErrors, { password: up.UPGRADE_COPY.invalid });
  same(up.applyUpgrade(res(422, null)).fieldErrors, { email: up.UPGRADE_COPY.invalid });
  assert.equal(up.applyUpgrade(res(429, null, 30)).message, "Trop de tentatives. Réessayez dans 30 s.");
  assert.equal(up.applyUpgrade(res(503, null)).message, up.UPGRADE_COPY.unavailable);
  assert.equal(up.applyUpgrade(res(up.UPGRADE_TIMEOUT, null)).message, up.UPGRADE_COPY.timeout);
  assert.equal(up.applyUpgrade(res(0, null)).message, up.UPGRADE_COPY.failed);
});

test("contrôleur : double envoi ⇒ 1 appel ; réponse après démontage ignorée", async () => {
  let calls = 0;
  let resolve!: (r: Upgrade.UpgradeResult) => void;
  const api: Upgrade.AccountApi = { session: async () => res(200, ELIGIBLE), upgrade: () => (calls++, new Promise((r) => (resolve = r))) };
  const results: Upgrade.UpgradeOutcome[] = [];
  const ctrl = up.createUpgradeController({ api: () => api, onResult: (o) => results.push(o) });
  const fields = { email: "a@b.fr", password: "0123456789", confirm: "0123456789" };
  const first = ctrl.submit(fields);
  assert.equal(ctrl.submit(fields), false);
  assert.equal(calls, 1);
  ctrl.detach();
  resolve(res(200, { confirmation_required: true }));
  await first;
  same(results, []);
});

test("requêtes exactes et source : GET session / POST upgrade same-origin no-store ; aucun signUp ni appel Supabase Auth", async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  const api = up.createAccountApi((async (url: string, init: RequestInit) => (seen.push({ url, init }), new Response("{}", { status: 200 }))) as unknown as typeof fetch);
  await api.session();
  await api.upgrade({ email: "a@b.fr", password: "0123456789" });
  same(seen.map((c) => [c.url, c.init.method, c.init.credentials, c.init.cache]), [["/api/auth/phone/session", "GET", "same-origin", "no-store"], ["/api/auth/phone/upgrade", "POST", "same-origin", "no-store"]]);
  same(Object.keys(JSON.parse(String(seen[1].init.body))), ["email", "password"]);
  const never = (() => new Promise<Response>(() => {})) as unknown as typeof fetch;
  assert.equal((await up.createAccountApi(never, { timeoutMs: 20 }).session()).status, up.UPGRADE_TIMEOUT);
  const src = readFileSync(path.join(ROOT, "components/role/account-upgrade.tsx"), "utf8");
  assert.doesNotMatch(src, /signUp|supabase|createClient|auth\.\w+\(|localStorage|sessionStorage|console\./);
});

// ---- Montage réel (Chromium, un seul processus) ------------------------------------------------
const PW = process.env.QA_PLAYWRIGHT_PATH || "/Users/claudebrafa/rea/node_modules/playwright-core";
const CHROMIUM = process.env.QA_CHROMIUM_PATH || path.join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell");
const available = existsSync(path.join(PW, "index.mjs")) && existsSync(CHROMIUM);
const ENTRY = `
import { createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { AccountUpgrade } from "./components/role/account-upgrade";
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
const ELIGIBLE = ${JSON.stringify(ELIGIBLE)};
const mount = (api) => { const div = document.createElement("div"); document.body.appendChild(div); const root = createRoot(div); root.render(h(AccountUpgrade, { api })); return { div, root }; };
const type = (input, value) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); };
window.scenarios = {
  async hidden() {
    const out = [];
    for (const body of [{ ...ELIGIBLE, authenticated: false }, { ...ELIGIBLE, verified_phone: false }, { ...ELIGIBLE, role: "manager" }, { ...ELIGIBLE, email_account: true }, null]) {
      const { div } = mount({ session: async () => ({ status: body ? 200 : 503, body, retryAfter: null }), upgrade: async () => ({ status: 500, body: null, retryAfter: null }) });
      await tick(30);
      out.push(div.innerHTML);
    }
    return out;
  },
  async flow(status) {
    let calls = 0; let resolve;
    const { div } = mount({ session: async () => ({ status: 200, body: ELIGIBLE, retryAfter: null }), upgrade: () => (calls++, new Promise((r) => (resolve = r))) });
    await tick(30);
    div.querySelector("button[aria-expanded]").click();
    await tick(30);
    const [email, pass, confirm] = div.querySelectorAll("input");
    type(email, "camille@example.test"); type(pass, "0123456789"); type(confirm, "0123456789");
    await tick(30);
    const form = div.querySelector("form");
    form.requestSubmit(); form.requestSubmit();
    await tick(30);
    resolve({ status, body: status === 200 ? { confirmation_required: true } : { field: "email" }, retryAfter: null });
    await tick(50);
    return { calls, text: div.textContent, passwords: [...div.querySelectorAll("input[type=password]")].map((i) => i.value) };
  },
};
`;

test("monté (Chromium) : masqué hors éligibilité ; 200/409/422/503 ; double envoi ⇒ 1 appel ; mot de passe effacé après succès", { skip: available ? false : "local Playwright/Chromium not found (SKIPPED, never PASS)" }, async () => {
  const out = await build({ absWorkingDir: ROOT, stdin: { contents: ENTRY, resolveDir: ROOT, loader: "tsx" }, bundle: true, write: false, outdir: "out", platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "local-css" }, define: { "process.env.NODE_ENV": '"development"' }, logLevel: "error" });
  const js = out.outputFiles.find((f) => f.path.endsWith(".js"))!.text;
  const requests: string[] = [];
  const server: Server = createServer((rq, rs) => { if (rq.url !== "/") requests.push(String(rq.url)); rs.setHeader("content-type", "text/html"); rs.end(`<!doctype html><script>${js}</script>`); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true, args: ["--single-process"] });
  try {
    const page = await (await browser.newContext()).newPage();
    const errors: string[] = [];
    page.on("pageerror", (e: Error) => errors.push(String(e)));
    await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}/`);
    const run = (name: string, arg?: unknown) => page.evaluate(([n, a]: [string, unknown]) => (window as unknown as { scenarios: Record<string, (x: unknown) => Promise<unknown>> }).scenarios[n](a), [name, arg]);
    same(await run("hidden"), ["", "", "", "", ""]);
    const ok200 = (await run("flow", 200)) as { calls: number; text: string; passwords: string[] };
    same([ok200.calls, ok200.passwords], [1, []]);
    assert.ok(ok200.text.includes("Un email de confirmation vous est envoyé si l’adresse est valide"));
    const used = (await run("flow", 409)) as { calls: number; text: string };
    assert.equal(used.calls, 1);
    assert.ok(used.text.includes("Cette adresse est déjà utilisée par un compte"));
    const bad = (await run("flow", 422)) as { text: string };
    assert.ok(bad.text.includes("Vérifiez l’adresse email et le mot de passe"));
    const down = (await run("flow", 503)) as { text: string };
    assert.ok(down.text.includes("Service momentanément indisponible"));
    same(errors, []);
    same(requests.filter((u) => u.startsWith("/api/")), []);
  } finally {
    await browser.close();
    server.close();
  }
});
