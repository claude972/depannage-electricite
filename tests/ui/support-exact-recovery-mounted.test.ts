// SUP exact recovery — real SupportCenter « Nouvelle demande » (React root, StrictMode, Chromium 390
// and 1280 px) on an injected session. Editable draft vs IMMUTABLE submitted snapshot: an edit after
// a lost reply never changes what is resent (same request_id + content); a remount resumes exactly;
// the server's replay yields the same ticket (no duplicate); tampered / unavailable storage ⇒ 0 POST;
// double click ⇒ 1 POST; identity change ⇒ late reply ignored, no resend; legacy record never sent.
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
import { SupportCenter } from "./components/role/support-tickets";
const D1 = "d0000000-0000-4000-8000-000000000001";
window.posts = []; window.server = {}; window.mode = "ok"; window.hold = false; window.gates = []; window.gone = []; window.notices = [];
const UID = "c0000000-0000-4000-8000-000000000001";
if (location.hash === "#legacy") sessionStorage.setItem("courant-support-pending-" + UID, JSON.stringify({ request_id: "11111111-1111-4111-8111-111111111111", subject: "Ancien sujet", body: "Ancien message conservé", intervention_id: D1 }));
if (location.hash === "#legacy-bad") sessionStorage.setItem("courant-support-pending-" + UID, JSON.stringify({ request_id: "not-a-uuid", subject: "Ancien", body: 3 }));
let n = 0;
const T = () => "70000000-0000-4000-8000-" + String(++n).padStart(12, "0");
const createSupportTicket = async (v) => {
  window.posts.push(JSON.parse(JSON.stringify(v)));
  if (window.hold) await new Promise((r) => window.gates.push(r));
  if (window.mode === "lost") return null;
  const prev = window.server[v.request_id];
  if (prev && (prev.subject !== v.subject || prev.body !== v.body || prev.intervention_id !== v.intervention_id)) return null; // permanent conflict
  const replayed = Boolean(prev);
  if (!prev) window.server[v.request_id] = { ...v, ticket: T() };
  const id = window.server[v.request_id].ticket;
  const receipt = { ticket: { id, creator_id: UID, intervention_id: v.intervention_id, subject: v.subject, status: "open", version: 1, created_at: "2026-11-07T10:00:00Z", updated_at: "2026-11-07T10:00:00Z", last_message_at: "2026-11-07T10:00:00Z" },
    initial_message: { id: T(), ticket_id: id, author_id: UID, author_kind: "user", version: 1, body: v.body, created_at: "2026-11-07T10:00:00Z" }, replayed };
  if (window.mode === "badSubject") receipt.ticket.subject = "Autre";
  if (window.mode === "badBody") receipt.initial_message.body = "Autre corps";
  if (window.mode === "badTicket") receipt.ticket.id = "t1";
  if (window.mode === "noReplayed") delete receipt.replayed;
  if (window.mode === "junk") return { ok: true };
  if (window.mode === "lostAfterSave") return null; // recorded on the server, reply lost
  return receipt;
};
function Host() {
  const [ident, setIdent] = useState({ uid: UID, gen: Number(new URLSearchParams(location.search).get("gen") || 1) });
  const [mounted, setMounted] = useState(true);
  window.cur = ident; // live identity, as the real session guard (refs, not render closures)
  window.setIdent = (v) => { window.cur = v; setIdent(v); }; window.setMounted = setMounted;
  const session = { mode: "live", param: "new", busy: false, profileId: ident.uid, mutationContext: { userId: () => window.cur.uid, generation: () => window.cur.gen }, createSupportTicket,
    go: (v, p) => window.gone.push([v, p || ""]), setNotice: (m) => window.notices.push(m), capabilities: { support: "available" }, platformAccess: null };
  return mounted ? h(SupportCenter, { session, interventions: [{ id: D1, category: "panel", created_at: "2026-11-01T10:00:00Z" }], backView: "overview" }) : h("p", null, "démonté");
}
const div = document.createElement("div"); document.body.appendChild(div);
createRoot(div).render(h(StrictMode, null, h(Host)));
`;

async function serve() {
  const b = await build({ absWorkingDir: ROOT, stdin: { contents: ENTRY, resolveDir: ROOT, loader: "tsx" }, bundle: true, write: false, outdir: "out", platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "local-css", ".svg": "dataurl", ".png": "dataurl" }, define: { "process.env.NODE_ENV": '"development"' }, logLevel: "error" });
  const js = b.outputFiles.find((f) => f.path.endsWith(".js"))!.text;
  const css = readFileSync(path.join(ROOT, "app/globals.css"), "utf8") + b.outputFiles.filter((f) => f.path.endsWith(".css")).map((f) => f.text).join("\n");
  const server: Server = createServer((_q, r) => { r.setHeader("content-type", "text/html"); r.end(`<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>${css}</style><body class="ui-v2"><script>${js}</script></body></html>`); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { server, url: `http://127.0.0.1:${(server.address() as { port: number }).port}/` };
}
type Post = { request_id: string; subject: string; body: string; intervention_id: string | null };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const posts = (page: Any) => page.evaluate("window.posts") as Promise<Post[]>;
async function fill(page: Any, subject: string, body: string) {
  await page.getByLabel("Sujet").fill(subject);
  await page.getByLabel("Message").fill(body);
}

test("Chromium 390/1280 : édition après perte ⇒ même request_id + contenu ; remontage ⇒ reprise exacte ; rejeu serveur ⇒ même ticket", { skip }, async () => {
  const { server, url } = await serve();
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    for (const width of [390, 1280]) {
      const page = await (await browser.newContext({ viewport: { width, height: 1000 } })).newPage();
      const errors: string[] = [];
      page.on("pageerror", (e: Error) => errors.push(String(e)));
      await page.goto(url);
      await fill(page, "Panne de tableau", "Le disjoncteur saute toutes les heures.");
      await page.getByLabel("Dossier concerné (facultatif)").selectOption({ index: 1 });
      await page.evaluate("window.mode = 'lost'");
      await page.locator("[data-support-send]").click();
      await page.locator("[data-support-pending]").waitFor();
      const first = (await posts(page))[0];
      assert.equal(first.subject, "Panne de tableau");
      assert.equal(first.intervention_id, "d0000000-0000-4000-8000-000000000001");
      // Edit the draft after the loss: the snapshot never changes, « Envoyer » stays blocked.
      await fill(page, "Autre sujet modifié", "Un tout autre message après la perte.");
      await page.getByLabel("Dossier concerné (facultatif)").selectOption("");
      assert.equal(await page.locator("[data-support-send]").isDisabled(), true, "no new request while the old outcome is unknown");
      assert.match(await page.locator("[data-support-pending]").innerText(), /Panne de tableau/);
      await page.locator("[data-support-resend]").click();
      await page.waitForFunction("window.posts.length === 2");
      assert.deepEqual((await posts(page))[1], first, "same request_id, same content");
      // Remount ⇒ exact resume from the stored snapshot.
      await page.evaluate("window.setMounted(false)");
    await page.getByText("démonté").waitFor();
      await page.evaluate("window.setMounted(true)");
      await page.locator("[data-support-pending]").waitFor();
      assert.equal(await page.locator("[data-support-pending]").getAttribute("data-support-pending"), first.request_id);
      assert.equal(await page.getByLabel("Sujet").inputValue(), "Autre sujet modifié", "draft kept separately");
      // The server recognises the request ⇒ same ticket, no duplicate.
      await page.evaluate("window.mode = 'ok'");
      await page.locator("[data-support-resend]").click();
      await page.waitForFunction("window.gone.length === 1");
      await page.evaluate("window.mode = 'ok'; window.server[" + JSON.stringify(first.request_id) + "] && 0");
      const all = await posts(page);
      assert.deepEqual(all[2], first);
      assert.equal(Object.keys((await page.evaluate("window.server")) as object).length, 1, "one ticket on the server");
      assert.deepEqual(await page.evaluate("window.gone[0]"), ["support", "70000000-0000-4000-8000-000000000001"]);
      // The distinct draft typed in between survives the resume, persisted for the next opening.
      await page.evaluate("window.setMounted(false)");
    await page.getByText("démonté").waitFor();
      await page.evaluate("window.setMounted(true)");
      await page.getByLabel("Sujet").waitFor();
      assert.equal(await page.locator("[data-support-pending]").count(), 0);
      assert.equal(await page.getByLabel("Sujet").inputValue(), "Autre sujet modifié", "distinct draft kept after the resume");
      assert.equal(await page.getByLabel("Message").inputValue(), "Un tout autre message après la perte.");
      // Replay of an already recorded request (new mount, same snapshot written by hand is NOT used):
      assert.equal(await page.evaluate("sessionStorage.getItem('courant-private-support-snapshot:live:c0000000-0000-4000-8000-000000000001')"), null, "snapshot cleared after success");
      const small = await page.evaluate("[...document.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().height > 0 && b.getBoundingClientRect().height < 43.5 && !b.classList.contains('text-button')).length");
      assert.equal(small, 0);
      assert.ok(((await page.evaluate("document.documentElement.scrollWidth")) as number) <= width);
      assert.deepEqual(errors, []);
      await page.evaluate("sessionStorage.clear()");
    }
  } finally {
    await browser.close();
    server.close();
  }
});

test("Chromium 390 : stockage falsifié ou indisponible ⇒ 0 POST ; double clic ⇒ 1 POST ; changement d’identité ⇒ réponse tardive ignorée, aucun renvoi ; ancien stockage jamais envoyé", { skip }, async () => {
  const { server, url } = await serve();
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 1000 } });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e: Error) => errors.push(String(e)));
    await page.goto(url);
    // Storage unavailable ⇒ 0 POST.
    await page.evaluate("window.__set = Storage.prototype.setItem; Storage.prototype.setItem = function () { throw new Error('quota'); }");
    await fill(page, "Panne de tableau", "Le disjoncteur saute toutes les heures.");
    await page.locator("[data-support-send]").click();
    await page.locator("[data-support-problem]").waitFor();
    assert.match(await page.locator("[data-support-problem]").innerText(), /rien n’a été envoyé/);
    assert.equal((await posts(page)).length, 0);
    await page.evaluate("Storage.prototype.setItem = window.__set");
    // Double click ⇒ 1 POST.
    await page.evaluate("window.mode = 'lost'; window.hold = true");
    await page.locator("[data-support-send]").dblclick();
    await page.waitForTimeout(200);
    assert.equal((await posts(page)).length, 1, "double click ⇒ 1 POST");
    await page.evaluate("window.hold = false; while (window.gates.length) window.gates.shift()()");
    await page.locator("[data-support-pending]").waitFor();
    // Tampered storage (content changed behind the page) ⇒ resend refused, 0 POST.
    await page.evaluate(`(() => { const k = 'courant-private-support-snapshot:live:c0000000-0000-4000-8000-000000000001'; const v = JSON.parse(sessionStorage.getItem(k)); v.body = 'Contenu falsifié dans le stockage'; sessionStorage.setItem(k, JSON.stringify(v)); })()`);
    await page.locator("[data-support-resend]").click();
    await page.locator("[data-support-problem]").waitFor();
    assert.equal((await posts(page)).length, 1, "tampered ⇒ 0 POST");
    // Lying storage: another identity's record under this key is never restored.
    await page.evaluate(`(() => { const k = 'courant-private-support-snapshot:live:c0000000-0000-4000-8000-000000000001'; const v = JSON.parse(sessionStorage.getItem(k)); v.body = 'Le disjoncteur saute toutes les heures.'; v.uid = 'c0000000-0000-4000-8000-000000000002'; sessionStorage.setItem(k, JSON.stringify(v)); })()`);
    await page.evaluate("window.setMounted(false)");
    await page.getByText("démonté").waitFor();
    await page.evaluate("window.setMounted(true)");
    await page.getByLabel("Sujet").waitFor();
    assert.equal(await page.locator("[data-support-pending]").count(), 0, "foreign record ignored");
    assert.equal((await posts(page)).length, 1);
    // Identity change while a send is in flight ⇒ late reply ignored; the new identity resends nothing.
    await page.evaluate("sessionStorage.clear(); window.setMounted(false)");
    await page.getByText("démonté").waitFor();
    await page.evaluate("window.setMounted(true)");
    await fill(page, "Panne de tableau", "Le disjoncteur saute toutes les heures.");
    await page.evaluate("window.mode = 'ok'; window.hold = true");
    await page.locator("[data-support-send]").click();
    await page.waitForFunction("window.posts.length === 2");
    await page.evaluate("window.setIdent({ uid: 'c0000000-0000-4000-8000-000000000002', gen: 2 })");
    await page.evaluate("window.hold = false; while (window.gates.length) window.gates.shift()()");
    await page.waitForTimeout(200);
    assert.deepEqual(await page.evaluate("window.gone"), [], "late reply ignored (no navigation)");
    assert.equal(await page.locator("[data-support-pending]").count(), 0, "no snapshot for the new identity");
    assert.equal(await page.getByLabel("Sujet").inputValue(), "", "no draft of the other identity");
    assert.equal((await posts(page)).length, 2, "no resend");
    assert.deepEqual(errors, []);
    // Legacy tuple after a lost POST ⇒ exact-tuple resend on demand only (same old id + content).
    const p2 = await ctx.newPage();
    await p2.goto(url + "#legacy");
    await p2.locator("[data-support-pending]").waitFor();
    assert.equal(await p2.locator("[data-support-pending]").getAttribute("data-support-pending"), "11111111-1111-4111-8111-111111111111");
    await p2.waitForTimeout(200);
    assert.equal(((await p2.evaluate("window.posts")) as Post[]).length, 0, "legacy ⇒ never auto-sent");
    assert.equal(await p2.locator("[data-support-send]").isDisabled(), true, "no new ticket while pending");
    await fill(p2, "Brouillon distinct", "Un brouillon différent saisi entre-temps.");
    await p2.locator("[data-support-resend]").click();
    await p2.waitForFunction("window.posts.length === 1 && window.gone.length === 1");
    assert.deepEqual(((await p2.evaluate("window.posts")) as Post[])[0], { request_id: "11111111-1111-4111-8111-111111111111", subject: "Ancien sujet", body: "Ancien message conservé", intervention_id: "d0000000-0000-4000-8000-000000000001" }, "exact old tuple, never a new UUID");
    // StrictMode: after success + remount, the legacy request never comes back; the distinct draft stays.
    await p2.evaluate("window.setMounted(false)");
    await p2.getByText("démonté").waitFor();
    await p2.evaluate("window.setMounted(true)");
    await p2.getByLabel("Sujet").waitFor();
    assert.equal(await p2.locator("[data-support-pending]").count(), 0, "no resurrection of the legacy request");
    assert.equal(await p2.evaluate("sessionStorage.getItem('courant-support-pending-c0000000-0000-4000-8000-000000000001')"), null, "legacy record dropped");
    assert.equal(await p2.getByLabel("Sujet").inputValue(), "Brouillon distinct", "distinct draft kept");
    await p2.goto(url); // reload of the same tab (no fixture re-seeding)
    await p2.getByLabel("Sujet").waitFor();
    assert.equal(await p2.locator("[data-support-pending]").count(), 0, "not after a reload either");
    assert.equal(((await p2.evaluate("window.posts")) as Post[]).length, 0);
    // Unprovable legacy ⇒ review / abandon only, no POST.
    const p3 = await ctx.newPage();
    await p3.evaluate("sessionStorage.clear()").catch(() => {});
    await p3.goto(url + "#legacy-bad");
    await p3.locator("[data-support-unproven]").waitFor();
    assert.equal(await p3.locator("[data-support-send]").isDisabled(), true);
    await p3.waitForTimeout(200);
    assert.equal(((await p3.evaluate("window.posts")) as Post[]).length, 0, "unprovable ⇒ 0 POST");
    await p3.locator("[data-support-abandon-unproven]").click();
    assert.equal(await p3.locator("[data-support-unproven]").count(), 0);
    assert.equal(((await p3.evaluate("window.posts")) as Post[]).length, 0, "abandon sends nothing");
  } finally {
    await browser.close();
    server.close();
  }
});

test("Chromium 390 : génération nouvelle, même compte ⇒ instantané retrouvé ; reçu 200 invalide ⇒ incertain ; rejeu valide ⇒ même ticket ; envoi bloqué si instantané en attente", { skip }, async () => {
  const { server, url } = await serve();
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 1000 } });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e: Error) => errors.push(String(e)));
    await page.goto(url + "?gen=1");
    await fill(page, "Panne de tableau", "Le disjoncteur saute toutes les heures.");
    await page.evaluate("window.mode = 'lost'");
    await page.locator("[data-support-send]").click();
    await page.locator("[data-support-pending]").waitFor();
    const first = (await posts(page))[0];
    // Reload of the SAME account with a fresh runtime generation (browser-side interruption).
    await page.goto(url + "?gen=7");
    await page.locator("[data-support-pending]").waitFor();
    assert.equal(await page.locator("[data-support-pending]").getAttribute("data-support-pending"), first.request_id, "found again after reload");
    assert.equal(((await page.evaluate("window.posts")) as Post[]).length, 0, "never auto-resent");
    // Pending snapshot + a new submit ⇒ storage unchanged, 0 POST for new content.
    const before = await page.evaluate("sessionStorage.getItem('courant-private-support-snapshot:live:c0000000-0000-4000-8000-000000000001')");
    await fill(page, "Nouveau sujet", "Un nouveau message à ne pas envoyer.");
    await page.getByLabel("Sujet").press("Enter");
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate("sessionStorage.getItem('courant-private-support-snapshot:live:c0000000-0000-4000-8000-000000000001')"), before, "snapshot never replaced");
    assert.equal(((await page.evaluate("window.posts")) as Post[]).length, 0);
    // Malformed / inconsistent 200 receipts ⇒ uncertain: snapshot kept, no success, no navigation.
    for (const mode of ["junk", "badSubject", "badBody", "badTicket", "noReplayed"]) {
      await page.evaluate(`window.mode = '${mode}'`);
      await page.locator("[data-support-resend]").click();
      await page.locator("[data-support-problem]").waitFor();
      await page.waitForFunction("!document.querySelector('[data-support-resend]')?.disabled");
      assert.deepEqual(await page.evaluate("window.gone"), [], mode + ": no navigation");
      assert.deepEqual(await page.evaluate("window.notices"), [], mode + ": no success notice");
      assert.equal(await page.evaluate("sessionStorage.getItem('courant-private-support-snapshot:live:c0000000-0000-4000-8000-000000000001')"), before, mode + ": snapshot kept");
    }
    const sent = (await page.evaluate("window.posts")) as Post[];
    assert.ok(sent.every((p) => JSON.stringify(p) === JSON.stringify(first)), "every resend is the exact snapshot");
    // Recorded on the server but the reply is lost; the exact resend gets replayed:true ⇒ same ticket.
    await fill(page, first.subject, first.body);
    await page.evaluate("window.mode = 'lostAfterSave'");
    await page.locator("[data-support-resend]").click();
    await page.waitForFunction("Object.keys(window.server).length === 1 && !document.querySelector('[data-support-resend]')?.disabled");
    const ticket = await page.evaluate("Object.values(window.server)[0].ticket");
    await page.evaluate("window.mode = 'ok'");
    await page.locator("[data-support-resend]").click();
    await page.waitForFunction("window.gone.length === 1");
    assert.equal(Object.keys((await page.evaluate("window.server")) as object).length, 1, "one ticket, no duplicate");
    assert.deepEqual(await page.evaluate("window.gone[0]"), ["support", ticket], "same ticket");
    assert.match(String(await page.evaluate("window.notices[0]")), /déjà été enregistrée ; aucun doublon/);
    assert.equal(await page.evaluate("sessionStorage.getItem('courant-private-support-snapshot:live:c0000000-0000-4000-8000-000000000001')"), null, "snapshot cleared on a valid receipt");
    await page.goto(url + "?gen=8");
    await page.getByLabel("Sujet").waitFor();
    assert.equal(await page.getByLabel("Sujet").inputValue(), "", "matching draft cleared (persisted)");
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    server.close();
  }
});

test("Chromium 390 : saisie pendant le POST ⇒ conservée (UI + stockage) après un reçu valide", { skip }, async () => {
  const { server, url } = await serve();
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 1000 } })).newPage();
    const errors: string[] = [];
    page.on("pageerror", (e: Error) => errors.push(String(e)));
    await page.goto(url);
    await fill(page, "Panne de tableau", "Le disjoncteur saute toutes les heures.");
    await page.evaluate("window.mode = 'ok'; window.hold = true");
    await page.locator("[data-support-send]").click();
    await page.waitForFunction("window.posts.length === 1");
    // B typed while the receipt is held.
    await fill(page, "Deuxième question", "Une autre question saisie pendant l’envoi.");
    await page.evaluate("window.hold = false; while (window.gates.length) window.gates.shift()()");
    await page.waitForFunction("window.gone.length === 1");
    assert.equal(await page.getByLabel("Sujet").inputValue(), "Deuxième question", "B kept in the UI");
    await page.evaluate("window.setMounted(false)");
    await page.getByText("démonté").waitFor();
    await page.evaluate("window.setMounted(true)");
    await page.getByLabel("Sujet").waitFor();
    assert.equal(await page.getByLabel("Sujet").inputValue(), "Deuxième question", "B kept in storage");
    assert.equal(await page.getByLabel("Message").inputValue(), "Une autre question saisie pendant l’envoi.");
    assert.equal(await page.locator("[data-support-pending]").count(), 0);
    assert.equal(((await page.evaluate("window.posts")) as Post[]).length, 1, "B never sent");
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    server.close();
  }
});
