// ENT-10 (P2): the REAL createSiteOperationsClient (bound / observe of components/app/features.ts)
// composed with the REAL SiteOperationsView / Content / ErpPanel in Chromium; only `request` is
// injected. A COMMAND answering 503 or a network failure (status 0) leaves the module state as it is,
// so the ERP form stays mounted with its draft, shows the inline error and the manual retry sends an
// identical body. A READ 503 still makes the module unavailable; 401/403 keep their classification;
// a write right lost on re-evaluation removes the form.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const PW = process.env.QA_PLAYWRIGHT_PATH || "/Users/claudebrafa/rea/node_modules/playwright-core";
const CHROMIUM = process.env.QA_CHROMIUM_PATH || path.join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell");
const available = existsSync(path.join(PW, "index.mjs")) && existsSync(CHROMIUM);
const same = (a: unknown, b: unknown, msg = "") => assert.equal(JSON.stringify(a), JSON.stringify(b), msg);

const ENTRY = `
import { createElement as h, StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { SiteOperationsView } from "./components/features/site-operations/site-operations-view";
import { createSiteOperationsClient } from "./components/app/features";
import { ApiRequestError } from "./components/app/api";
import { demoReport, DEMO_SITE_ID, DEMO_ORGANIZATION_ID } from "./lib/features/site-operations/demo";
const w = window;
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
function setup() {
  const log = { get: 0, posts: [], states: [] };
  const gets = [], posts = [];
  const report = (over) => { const r = demoReport(); if (over) Object.assign(r.snapshot.limits, over); return r; };
  const answer = (next, fallback) => {
    if (next && next.error !== undefined) return Promise.reject(new ApiRequestError(next.error, next.message ?? "Service momentanément indisponible.", { json: next.error !== 0 }));
    return Promise.resolve(next ?? fallback());
  };
  const request = (p, body) => {
    if (body === undefined) { log.get++; return answer(gets.shift(), () => report()); }
    log.posts.push(JSON.parse(JSON.stringify(body)));
    return answer(posts.shift(), () => ({ action: body.action, result: null }));
  };
  let setModule = null;
  const deps = { generation: () => 0, setState: (key, state) => { log.states.push(key + ":" + state); if (key === "siteOperations") setModule?.(state); }, request };
  const client = createSiteOperationsClient(deps);
  const scope = { userId: "u1", role: "manager", organizationId: DEMO_ORGANIZATION_ID, siteId: DEMO_SITE_ID, authority: { canWrite: true } };
  function App() {
    const [state, set] = useState("available");
    setModule = set;
    return h(SiteOperationsView, { state, scope, client, unavailableMessage: "Opérations du site indisponibles." });
  }
  const div = document.createElement("div"); document.body.appendChild(div);
  createRoot(div).render(h(StrictMode, null, h(App)));
  const button = (text) => [...div.querySelectorAll("button")].find((b) => b.textContent.trim() === text);
  const click = async (text, ms = 200) => { const b = button(text); if (b && !b.disabled) b.click(); await tick(ms); return !!b; };
  const form = () => div.querySelector("form");
  const note = () => { const l = [...(form()?.querySelectorAll("label") ?? [])].filter((x) => x.textContent.trim() === "Note")[1]; return l ? document.getElementById(l.htmlFor) : null; };
  const type = (el, value) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); };
  const view = () => ({ form: !!form(), unavailable: !!div.querySelector('[data-blocker="site-operations"]'), alert: form()?.querySelector("[role=alert]")?.textContent ?? null, note: note()?.value ?? null, save: !!button("Enregistrer") });
  return { div, log, gets, posts, click, form, note, type, view };
}
async function openForm(t) {
  await tick(300);
  await t.click("Contrôles ERP");
  await t.click("Modifier");
  t.type(t.note(), "Relevé du 25/09");
  await tick(100);
}
w.scenarios = {
  async transient(status) {
    const t = setup();
    await openForm(t);
    const statesBefore = t.log.states.length;
    t.posts.push({ error: Number(status) });
    t.form().requestSubmit();
    await tick(300);
    const failed = { ...t.view(), states: t.log.states.slice(statesBefore) };
    t.form().requestSubmit(); // manual retry, same draft
    await tick(400);
    return { failed, bodies: t.log.posts, after: t.view(), gets: t.log.get };
  },
  async read503() {
    const t = setup();
    await tick(300);
    t.gets.push({ error: 503 });
    await t.click("Actualiser", 300);
    return { ...t.view(), states: t.log.states };
  },
  async refusal(status) {
    const t = setup();
    await openForm(t);
    const statesBefore = t.log.states.length;
    t.posts.push({ error: Number(status), message: "Accès refusé." });
    t.form().requestSubmit();
    await tick(300);
    return { ...t.view(), states: t.log.states.slice(statesBefore), posts: t.log.posts.length };
  },
  async rightLost() {
    const t = setup();
    await openForm(t);
    t.gets.push(Object.assign(demoReportLimited()));
    await t.click("Actualiser", 300);
    return { ...t.view(), readOnly: t.div.textContent.includes("autorise pas de modification sur ce site"), posts: t.log.posts.length };
  },
};
function demoReportLimited() { const r = demoReport(); r.snapshot.limits.can_write_site = false; return r; }
`;

test("ENT-10 P2 : client réel + vue montée — 503/0 sur une commande gardent le formulaire, une lecture 503 reste indisponible", { skip: available ? false : "local Playwright/Chromium not found (SKIPPED, never PASS)" }, async () => {
  const out = await build({ absWorkingDir: ROOT, stdin: { contents: ENTRY, resolveDir: ROOT, loader: "tsx" }, bundle: true, write: false, outdir: "out", platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "local-css" }, define: { "process.env.NODE_ENV": '"development"' }, logLevel: "error" });
  const js = out.outputFiles.find((f) => f.path.endsWith(".js"))!.text;
  const css = readFileSync(path.join(ROOT, "app/globals.css"), "utf8") + "\n" + out.outputFiles.filter((f) => f.path.endsWith(".css")).map((f) => f.text).join("\n");
  const requests: string[] = [];
  const server: Server = createServer((rq, rs) => {
    if (rq.url !== "/") requests.push(String(rq.url));
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
    const run = (name: string, arg?: string) => page.evaluate(([n, a]: [string, string | undefined]) => (window as unknown as { scenarios: Record<string, (x?: string) => Promise<unknown>> }).scenarios[n](a), [name, arg]);
    type V = { form: boolean; unavailable: boolean; alert: string | null; note: string | null; save: boolean };

    for (const status of ["503", "0"]) {
      const r = (await run("transient", status)) as { failed: V & { states: string[] }; bodies: { id: string; expected_version: number }[]; after: V; gets: number };
      same([r.failed.form, r.failed.unavailable, r.failed.note, r.failed.save, r.failed.states], [true, false, "Relevé du 25/09", true, []], `command ${status}: module state untouched, form mounted, draft kept`);
      assert.ok(r.failed.alert && r.failed.alert.length > 0, `command ${status}: inline error`);
      same(r.bodies.length, 2, `command ${status}: one POST, then one manual retry (no automatic retry)`);
      same(r.bodies[1], r.bodies[0], `command ${status}: the retry body is identical (checklist id, expected version, payload)`);
      assert.equal(typeof r.bodies[0].expected_version, "number");
      same([r.after.form, r.after.unavailable], [false, false], `command ${status}: the retry's success closes the form`);
    }

    const read = (await run("read503")) as V & { states: string[] };
    same([read.unavailable, read.states.at(-1)], [true, "siteOperations:unavailable"], "a READ 503 still makes the module unavailable");

    for (const status of ["401", "403"]) {
      const r = (await run("refusal", status)) as V & { states: string[]; posts: number };
      // P1 (phase 2 lot B, E26/E27): a refused command re-reads the report exactly once before any
      // new command; the classification stays « available », the form stays while the re-read grants.
      same([r.states, r.form, r.unavailable, r.posts], [["siteOperations:available", "siteOperations:available"], true, false, 1], `command ${status}: classification unchanged, one rights re-read`);
      assert.match(r.alert ?? "", /Accès refusé/);
    }

    const lost = (await run("rightLost")) as V & { readOnly: boolean; posts: number };
    same([lost.form, lost.save, lost.readOnly, lost.posts], [false, false, true, 0], "right lost on re-evaluation ⇒ no write offered");
    same(errors, []);
    same(requests.filter((u) => u.startsWith("/api/")), []);
  } finally {
    await browser.close();
    server.close();
  }
});
