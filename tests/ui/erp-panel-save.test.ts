import { fileURLToPath as localSourcePath } from "node:url";
// ENT-10: the « Contrôles ERP » form MOUNTED in Chromium (real React root, <StrictMode>, real CSS,
// the REAL onSubmit / useSubmit; only `context.run` is injected and held). While the save is in
// flight every field and the submit are locked and a second submit sends nothing; a failure keeps
// the fields, the exact checklist and its expected version (identical retry); a success closes the
// current editor once; a lifted reserve whose finding changes keeps its declared date as the
// existing validator allows (no invented rule).
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { erpChecklistPayload, commandSchema } from "../../lib/features/site-operations/schemas";

const ROOT = path.resolve(path.dirname(localSourcePath(import.meta.url)), "..", "..");
const PW = process.env.QA_PLAYWRIGHT_PATH || "/Users/claudebrafa/rea/node_modules/playwright-core";
const CHROMIUM = process.env.QA_CHROMIUM_PATH || path.join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell");
const available = existsSync(path.join(PW, "index.mjs")) && existsSync(CHROMIUM);
const same = (a: unknown, b: unknown, msg = "") => assert.equal(JSON.stringify(a), JSON.stringify(b), msg);

const ENTRY = `
import { createElement as h, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ErpPanel } from "./components/features/site-operations/erp-panel";
import { demoReport } from "./lib/features/site-operations/demo";
const w = window;
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
function report() {
  const r = demoReport();
  const c = r.snapshot.erp_checklists[0];
  // demo-2: a reserve already lifted (declared lift date), the case of a finding change.
  c.items = [c.items[0], { ...c.items[1], reserve_resolved_on: "2026-09-25" }];
  return r;
}
function setup() {
  const calls = [];
  const queue = [];
  let held = null;
  const run = (cmd) => { calls.push(JSON.parse(JSON.stringify(cmd))); const next = queue.shift() ?? { status: "done", result: { action: cmd.action, result: null } }; if (next === "hold") return new Promise((r) => { held = r; }); return Promise.resolve(next); };
  const context = { report: report(), canWrite: true, canWriteOrganization: true, readOnlyReason: null, busy: false, run };
  const div = document.createElement("div"); document.body.appendChild(div);
  const root = createRoot(div);
  root.render(h(StrictMode, null, h(ErpPanel, { context })));
  const form = () => div.querySelector("form");
  const button = (text) => [...div.querySelectorAll("button")].find((b) => b.textContent.trim() === text);
  const setValue = (el, value) => {
    const proto = el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  };
  const field = (label) => { const l = [...form().querySelectorAll("label")].filter((x) => x.textContent.trim().replace(" (obligatoire)", "") === label); return l.map((x) => document.getElementById(x.htmlFor)); };
  const controls = () => [...form().querySelectorAll("input, select, textarea, button")];
  const release = async (outcome) => { const r = held; held = null; r?.(outcome); await tick(200); };
  return { div, root, calls, queue, form, button, setValue, field, controls, release };
}
w.scenarios = {
  async held() {
    const t = setup();
    await tick(150);
    t.button("Modifier").click();
    await tick(150);
    t.setValue(t.field("Intitulé")[0], "Contrôle annuel");
    await tick(50);
    t.queue.push("hold");
    t.form().requestSubmit();
    t.form().requestSubmit(); // same tick: the ref guard, before any re-render
    await tick(150);
    const locked = { all: t.controls().every((c) => c.matches(":disabled")), count: t.controls().length, label: t.div.querySelector("button[type=submit]").textContent };
    t.form().requestSubmit(); // after the re-render: still nothing
    const input = t.field("Intitulé")[0];
    input.focus(); // a locked field cannot take the focus, so no late keystroke reaches it
    await tick(150);
    const during = { posts: t.calls.length, focus: document.activeElement === input, title: input.value, sent: t.calls[0]?.payload.title };
    await t.release({ status: "done", result: { action: "save_erp_checklist", result: null } });
    return { locked, during, open: !!t.form(), notice: t.div.querySelector("[role=status] > span")?.textContent ?? null, posts: t.calls.length };
  },
  async failThenRetry() {
    const t = setup();
    await tick(150);
    t.button("Modifier").click();
    await tick(150);
    t.setValue(t.field("Note")[1], "Relevé du 25/09");
    await tick(50);
    t.queue.push({ status: "failed", message: "Le contrôle a été modifié entre-temps." });
    t.form().requestSubmit();
    await tick(250);
    const after = { open: !!t.form(), unlocked: t.controls().every((c) => !c.matches(":disabled") || c.getAttribute("type") === "date"), note: t.field("Note")[1].value, error: t.div.querySelector("[role=alert]")?.textContent ?? null };
    t.queue.push("hold");
    t.form().requestSubmit();
    await tick(150);
    await t.release({ status: "done", result: { action: "save_erp_checklist", result: null } });
    return { after, bodies: t.calls, open: !!t.form() };
  },
  async success() {
    const t = setup();
    await tick(150);
    t.button("Nouveau contrôle").click();
    await tick(150);
    t.setValue(t.field("Intitulé")[0], "Nouveau contrôle sécurité");
    t.setValue(t.field("Point 1")[0], "Éclairage de sécurité");
    await tick(50);
    t.form().requestSubmit();
    await tick(250);
    return { posts: t.calls.length, open: !!t.form(), notices: [...t.div.querySelectorAll("[role=status] > span")].map((n) => n.textContent), newButton: !!t.button("Nouveau contrôle"), body: t.calls[0] };
  },
  async liftedReserve() {
    const t = setup();
    await tick(150);
    t.button("Modifier").click();
    await tick(150);
    const dates = t.field("Réserve levée le");
    const before = { value: dates[1].value, disabled: dates[1].disabled };
    t.setValue(t.field("Constat")[1], "ok");
    await tick(100);
    const after = { value: t.field("Réserve levée le")[1].value, disabled: t.field("Réserve levée le")[1].disabled };
    t.form().requestSubmit();
    await tick(250);
    return { before, after, body: t.calls[0], open: !!t.form() };
  },
  async unmountMidFlight() {
    const t = setup();
    await tick(150);
    t.button("Modifier").click();
    await tick(150);
    t.queue.push("hold");
    t.form().requestSubmit();
    await tick(100);
    t.root.unmount();
    await t.release({ status: "done", result: { action: "save_erp_checklist", result: null } });
    return { posts: t.calls.length, html: t.div.innerHTML };
  },
};
`;

test("ENT-10 formulaire ERP monté (Chromium, StrictMode, vrai onSubmit, réseau retenu)", { skip: available ? false : "local Playwright/Chromium not found (SKIPPED, never PASS)" }, async () => {
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
    const run = (name: string) => page.evaluate((n: string) => (window as unknown as { scenarios: Record<string, () => Promise<unknown>> }).scenarios[n](), name);
    type Body = { action: string; site_id: string; id?: string; expected_version?: number; payload: { title: string; items: { key: string; state: string; note: string; reserve_resolved_on: string | null }[] } };

    const held = (await run("held")) as { locked: { all: boolean; count: number; label: string }; during: { posts: number; focus: boolean; title: string; sent: string }; open: boolean; notice: string | null; posts: number };
    assert.ok(held.locked.count > 8, "the form controls are present");
    same([held.locked.all, held.locked.label], [true, "Enregistrement…"], "held POST ⇒ every field and button locked");
    same(held.during, { posts: 1, focus: false, title: "Contrôle annuel", sent: "Contrôle annuel" }, "two submits in the same tick and one after ⇒ one POST; the locked field takes no input");
    same([held.open, held.notice, held.posts], [false, "Contrôle mis à jour.", 1], "success closes the editor once");

    const fr = (await run("failThenRetry")) as { after: { open: boolean; unlocked: boolean; note: string; error: string | null }; bodies: Body[]; open: boolean };
    same([fr.after.open, fr.after.unlocked, fr.after.note], [true, true, "Relevé du 25/09"], "failure ⇒ unlocked, fields kept");
    assert.match(fr.after.error ?? "", /modifié entre-temps/);
    same(fr.bodies.length, 2);
    same(fr.bodies[1], fr.bodies[0], "the retry sends the identical body (same checklist, same expected version)");
    same([fr.bodies[0].id, fr.bodies[0].expected_version], ["51000000-0000-4000-8000-000000000001", fr.bodies[0].expected_version]);
    assert.equal(typeof fr.bodies[0].expected_version, "number");
    same(fr.open, false, "the retry's success closes");

    const ok = (await run("success")) as { posts: number; open: boolean; notices: string[]; newButton: boolean; body: Body };
    same([ok.posts, ok.open, ok.notices, ok.newButton], [1, false, ["Contrôle enregistré."], true], "new checklist: one POST, closed once, one notice");
    assert.equal(ok.body.id, undefined, "creation sends no id / version");
    assert.ok(commandSchema.safeParse(ok.body).success, "creation body accepted by the existing command schema");

    const lr = (await run("liftedReserve")) as { before: { value: string; disabled: boolean }; after: { value: string; disabled: boolean }; body: Body; open: boolean };
    same(lr.before, { value: "2026-09-25", disabled: false }, "lifted reserve: declared date editable");
    same(lr.after, { value: "2026-09-25", disabled: true }, "finding changed: the declared date is kept, no longer editable");
    const item = lr.body.payload.items.find((i) => i.key === "demo-2")!;
    same([item.state, item.reserve_resolved_on], ["ok", "2026-09-25"], "the finding and the declared lift date stay distinct, sent as entered");
    // The existing contract (zod + SQL so_date) accepts a lift date with any finding: no invented rule.
    assert.ok(erpChecklistPayload.safeParse(lr.body.payload).success, "payload accepted by the existing validator");
    assert.ok(commandSchema.safeParse(lr.body).success, "command accepted by the existing command schema");
    same(lr.open, false);

    const um = (await run("unmountMidFlight")) as { posts: number; html: string };
    same([um.posts, um.html], [1, ""], "a late reply after the editor is gone touches nothing");
    same(errors, []);
    same(requests.filter((u) => u.startsWith("/api/")), []);
  } finally {
    await browser.close();
    server.close();
  }
});

test("ENT-10 : formulaire déclaratif, aucune attestation ni certification ajoutée", () => {
  const src = readFileSync(path.join(ROOT, "components/features/site-operations/erp-panel.tsx"), "utf8");
  assert.doesNotMatch(src, /attest|certifi/i);
  assert.match(src, /<fieldset disabled=\{locked\}/);
});
