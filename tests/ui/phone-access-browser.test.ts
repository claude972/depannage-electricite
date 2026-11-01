// PhoneAccess / PhoneHistory MOUNTED in Chromium (one single-process run, fake APIs, fake clock,
// no network, never a real SMS): bounded renders over a 60 s cooldown, double submit in the same
// tick ⇒ one call, deadline ⇒ honest state with inputs kept, late reply after unmount ignored,
// history cleared on an identity change. Skipped — never passed — without local Chromium.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const PW = process.env.QA_PLAYWRIGHT_PATH || "/Users/claudebrafa/rea/node_modules/playwright-core";
const CHROMIUM =
  process.env.QA_CHROMIUM_PATH ||
  path.join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell");
const available = existsSync(path.join(PW, "index.mjs")) && existsSync(CHROMIUM);

const ENTRY = `
import { createElement as h, Profiler } from "react";
import { createRoot } from "react-dom/client";
import { PhoneAccess, PhoneHistory, createPhoneApi, initialPhoneState } from "./components/role/phone-access";
const w = window;
const mount = (el) => { const div = document.createElement("div"); document.body.appendChild(div); const root = createRoot(div); root.render(el); return { div, root }; };
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
w.scenarios = {
  async cooldown() {
    w.__now = 1000000;
    let commits = 0;
    const initial = { ...initialPhoneState({ phone: "0696123456", first_name: "A", last_name: "B" }), stage: "code", kind: "sms", suffix: "3456", resendAt: w.__now + 60000 };
    const { div } = mount(h(Profiler, { id: "p", onRender: () => commits++ }, h(PhoneAccess, { purpose: "booking", initial, clock: () => w.__now, onVerified() {}, api: { start: () => new Promise(() => {}), verify: () => new Promise(() => {}) } })));
    for (let i = 0; i < 60; i++) { w.__now += 1000; await tick(25); } // 60 s of fake time
    await tick(1100);
    const during = commits;
    const label = div.querySelector("button.link, button[class*=link]")?.textContent;
    await tick(2100);
    return { during, after: commits, label };
  },
  async doubleSubmit() {
    let starts = 0;
    const { div } = mount(h(PhoneAccess, { purpose: "booking", prefill: { phone: "0696123456", first_name: "A", last_name: "B" }, onVerified() {}, api: { start: () => (starts++, new Promise(() => {})), verify: () => new Promise(() => {}) } }));
    await tick(50);
    const form = div.querySelector("form");
    form.requestSubmit(); form.requestSubmit();
    await tick(50);
    form.requestSubmit();
    await tick(50);
    return { starts };
  },
  async deadline() {
    const never = () => new Promise(() => {});
    const { div } = mount(h(PhoneAccess, { purpose: "booking", prefill: { phone: "0696123456", first_name: "A", last_name: "B" }, onVerified() {}, api: createPhoneApi(never, { timeoutMs: 150 }) }));
    await tick(50);
    div.querySelector("form").requestSubmit();
    await tick(400);
    return { alert: div.querySelector("[role=alert]")?.textContent, phone: div.querySelector("input[type=tel]")?.value, stage: div.querySelector("[data-phone-stage]")?.getAttribute("data-phone-stage") };
  },
  async lateAfterUnmount() {
    let resolve; let verified = 0;
    const pending = new Promise((r) => (resolve = r));
    const { div, root } = mount(h(PhoneAccess, { purpose: "booking", prefill: { phone: "0696123456", first_name: "A", last_name: "B" }, onVerified: () => verified++, api: { start: () => pending, verify: () => pending } }));
    await tick(50);
    div.querySelector("form").requestSubmit();
    await tick(20);
    root.unmount();
    resolve({ status: 200, body: { status: "verified" }, retryAfter: null });
    await tick(100);
    return { verified };
  },
  async identity() {
    let emit = () => {};
    const watch = (cb) => { emit = cb; return () => {}; };
    let expired = 0;
    const api = async () => ({ status: 200, body: { interventions: [{ id: "00000000-0000-4000-8000-000000000001", category: "socket", status: "requested", city: "Fort-de-France", created_at: "2026-10-30T10:00:00Z", estimate_min_cents: 8000, estimate_max_cents: 18000 }], page: { limit: 20, has_more: false, next_cursor: null } }, retryAfter: null });
    const { div } = mount(h(PhoneHistory, { api, watchIdentity: watch, onExpired: () => expired++ }));
    await tick(50);
    emit("user-a");
    await tick(50);
    const before = div.querySelectorAll("[data-history-id]").length;
    emit(null);
    await tick(10);
    return { before, after: div.querySelectorAll("[data-history-id]").length, expired, text: div.textContent };
  },
};
`;

test("PhoneAccess / PhoneHistory montés (Chromium, faux API, horloge factice)", { skip: available ? false : "local Playwright/Chromium not found (SKIPPED, never PASS)" }, async () => {
  const out = await build({
    absWorkingDir: ROOT, stdin: { contents: ENTRY, resolveDir: ROOT, loader: "tsx" }, bundle: true, write: false, outdir: "out",
    platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "local-css", ".svg": "dataurl", ".png": "dataurl" },
    define: { "process.env.NODE_ENV": '"development"', "process.env.NEXT_PUBLIC_SUPABASE_URL": "undefined", "process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY": "undefined" },
    logLevel: "error",
  });
  const js = out.outputFiles.find((f) => f.path.endsWith(".js"))!.text;
  const requests: string[] = [];
  const server: Server = createServer((rq, rs) => {
    if (rq.url !== "/") requests.push(String(rq.url));
    rs.setHeader("content-type", "text/html");
    rs.end(`<!doctype html><div id="app"></div><script>${js}</script>`);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true, args: ["--single-process"] });
  try {
    const page = await (await browser.newContext()).newPage();
    const errors: string[] = [];
    page.on("pageerror", (e: Error) => errors.push(String(e)));
    await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}/`);
    const run = (name: string) => page.evaluate((n: string) => (window as unknown as { scenarios: Record<string, () => Promise<unknown>> }).scenarios[n](), name);

    const cooldown = (await run("cooldown")) as { during: number; after: number; label: string };
    assert.ok(cooldown.during < 90, `bounded renders over the cooldown (${cooldown.during})`);
    assert.equal(cooldown.after, cooldown.during, "no render once the cooldown is over (interval stopped)");
    assert.equal(cooldown.label, "Renvoyer le code");
    same(await run("doubleSubmit"), { starts: 1 });
    const deadline = (await run("deadline")) as { alert: string; phone: string; stage: string };
    assert.equal(deadline.alert, "Délai dépassé, réessayez. Rien n’a été confirmé.");
    assert.equal(deadline.phone, "0696123456");
    assert.equal(deadline.stage, "form");
    same(await run("lateAfterUnmount"), { verified: 0 });
    const identity = (await run("identity")) as { before: number; after: number; expired: number; text: string };
    same([identity.before, identity.after, identity.expired], [1, 0, 1]);
    assert.match(identity.text, /Votre vérification a expiré, recommencez\./);
    same(errors, []);
    same(requests.filter((u) => u.startsWith("/api/")), []); // aucune requête réseau réelle
  } finally {
    await browser.close();
    server.close();
  }
});
const same = (a: unknown, b: unknown) => assert.equal(JSON.stringify(a), JSON.stringify(b));
