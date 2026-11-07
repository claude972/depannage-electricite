// PUB-02 ROOT final contract, REAL mounts in Chromium at 390 px: BookingConfirm (+ the shared
// sendReviewedBooking used by the app, real api(), real booking draft in sessionStorage) and the public
// BookingWizard recap. Demonstration: click with V2 → 409 estimate_review_required (server now V3) → V3
// displayed → voluntary click → POST with the SAME UUID and V3. Plus: generic 409 / 5xx ⇒ same UUID and
// version; unseen V2 never approved; read failure ⇒ « non vérifiée »; reload ⇒ version restored from the
// draft; identity change during the re-read ⇒ no POST; sent request ⇒ its stored version, never the
// current price; demo ⇒ zero fetch.
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
import { BookingConfirm } from "./components/role/booking-confirm";
import { BookingWizard, EMPTY_BOOKING } from "./components/role/public-booking";
import { serviceBySlug } from "./components/role/public-service-catalog";
import { readBooking, BOOKING_DRAFT_KEY } from "./components/app/booking-draft";
import { api } from "./components/app/api";
import { sendReviewedBooking } from "./components/features/indicative-prices/review-submit";
const cfg = JSON.parse(decodeURIComponent(location.hash.slice(1) || "{}"));
const R = (k) => ({ outage: { min_cents: 15000 + k, max_cents: 25000 + k }, panel: { min_cents: 15000 + k, max_cents: 35000 + k }, socket: { min_cents: 8000, max_cents: 18000 }, lighting: { min_cents: 8000, max_cents: 20000 }, diagnostic: { min_cents: 12000, max_cents: 28000 } });
const S = window.S = { version: cfg.version || 2, fail: false, hold: false, gets: 0, posts: [], replies: cfg.replies || [], gen: 1 };
window.fetch = async (url, init) => {
  const method = (init && init.method) || "GET";
  if (url === "/api/public/indicative-prices") {
    S.gets++;
    if (S.hold) await new Promise((r) => (S.release = r));
    if (S.fail) return new Response("{}", { status: 503 });
    const v = S.version;
    return new Response(JSON.stringify({ version: v, currency: "eur", ranges: R(v * 1000), indicative: true, publication_available: false, source: v === 1 ? "existing_baseline" : "operator_version" }), { status: 200 });
  }
  if (url === "/api/bookings" && method === "POST") {
    S.posts.push(JSON.parse(init.body));
    const reply = S.replies.shift() || "ok";
    if (reply === "review") { S.version = 3; return new Response(JSON.stringify({ code: "estimate_review_required", error: "L’estimation indicative a changé. Vérifiez la nouvelle fourchette puis confirmez à nouveau." }), { status: 409 }); }
    if (reply === "conflict") return new Response(JSON.stringify({ error: "Reserved estimate conflict" }), { status: 409 });
    if (reply === "5xx") return new Response(JSON.stringify({ error: "x" }), { status: 503 });
    if (reply === "lost") throw new TypeError("lost");
    return new Response(JSON.stringify({ status: "confirmed", intervention: { id: "c0000000-0000-4000-8000-000000000001", status: "requested" }, payment: { method: "on_site" } }), { status: 201 });
  }
  return new Response("{}", { status: 404 });
};
const draft = { category: "panel", description: "Le disjoncteur saute dès que j’allume le four", address: "3 rue des Ateliers", postal_code: "97200", city: "Fort-de-France", urgency: "urgent" };
const initialBooking = { slug: "panne-tableau-electrique", urgent: true, slot: null, notes: "", contact: { civility: "", first_name: "Camille", last_name: "Dupont", email: "c@example.test", phone: "+596696000001", company: false }, payment: "on_site" };
function Host() {
  const [booking, setBooking] = useState(() => readBooking(sessionStorage.getItem(BOOKING_DRAFT_KEY))?.booking ?? initialBooking);
  const [message, setMessage] = useState("");
  const [, setGen] = useState(1);
  window.switchIdentity = () => { S.gen++; setGen(S.gen); };
  const confirmBooking = async () => {
    const gen = S.gen;
    setMessage("");
    try {
      const r = await sendReviewedBooking({
        current: booking, category: "panel", storage: sessionStorage, alive: () => S.gen === gen,
        onKeyed: (b) => setBooking(b),
        buildBody: (request_id) => ({ request_id, service_slug: booking.slug, category: draft.category, description: draft.description, address: draft.address, postal_code: draft.postal_code, city: draft.city, urgency: draft.urgency, contact: booking.contact, payment_choice: booking.payment }),
        post: (body) => api("/api/bookings", body),
      });
      if (r === undefined) setMessage("identité changée : rien envoyé");
      else setMessage("envoyée");
      return true;
    } catch (e) {
      setMessage(e.message);
      setBooking(readBooking(sessionStorage.getItem(BOOKING_DRAFT_KEY))?.booking ?? booking);
      return false;
    }
  };
  return h("div", null,
    cfg.wizard ? h(BookingWizard, { service: serviceBySlug("panne-tableau-electrique"), range: "STATIC", onClose() {}, initial: { ...EMPTY_BOOKING, step: 5, urgent: true, contact: { ...EMPTY_BOOKING.contact, first_name: "Camille", last_name: "Dupont", email: "c@example.test", phone: "+596696000001" }, address: { address: "3 rue des Ateliers", postal_code: "97200", city: "Fort-de-France" }, payment: "on_site" }, initialOptions: { status: "ready", options: { methods: { on_site: { available: true }, card_hold: { available: false } }, phone_auth: { available: false } } } })
      : h(BookingConfirm, { draft, booking, busy: false, profileId: "u1", demo: Boolean(cfg.demo), confirmBooking, onEdit() {}, onContactChange() {}, onPaymentChange() {} }),
    h("p", { "data-host-message": "" }, message));
}
const div = document.createElement("div"); document.body.appendChild(div);
createRoot(div).render(h(StrictMode, null, h(Host)));
`;
type S = { version: number; fail: boolean; hold: boolean; gets: number; posts: { request_id: string; reviewed_estimate_version?: number }[]; replies: string[]; release: () => void };

async function serve() {
  const b = await build({ absWorkingDir: ROOT, stdin: { contents: ENTRY, resolveDir: ROOT, loader: "tsx" }, bundle: true, write: false, outdir: "out", platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "local-css", ".svg": "dataurl", ".png": "dataurl", ".jpg": "dataurl", ".webp": "dataurl" }, define: { "process.env.NODE_ENV": '"development"', "process.env.NEXT_PUBLIC_SUPABASE_URL": "undefined", "process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY": "undefined" }, logLevel: "error" });
  const js = b.outputFiles.find((f) => f.path.endsWith(".js"))!.text;
  const css = readFileSync(path.join(ROOT, "app/globals.css"), "utf8") + b.outputFiles.filter((f) => f.path.endsWith(".css")).map((f) => f.text).join("\n");
  const server: Server = createServer((_q, r) => { r.setHeader("content-type", "text/html"); r.end(`<!doctype html><meta name="viewport" content="width=device-width"><style>${css}</style><body><script>${js}</script></body>`); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { server, base: `http://127.0.0.1:${(server.address() as { port: number }).port}/` };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const st = (page: Any) => page.evaluate(() => (window as unknown as { S: S }).S) as Promise<S>;
const send = (page: Any) => page.getByRole("button", { name: "Envoyer ma demande" }).click();
async function openPage(browser: Any, base: string, cfg: Record<string, unknown>, ctx?: Any) {
  const context = ctx ?? (await browser.newContext({ viewport: { width: 390, height: 1000 } }));
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e: Error) => errors.push(String(e)));
  await page.goto(`${base}#${encodeURIComponent(JSON.stringify(cfg))}`);
  return { page, errors, context };
}

test("Chromium : démonstration ROOT — V2 → 409 estimate_review_required (serveur V3) → V3 affichée → clic volontaire → POST même UUID avec V3", { skip }, async () => {
  const { server, base } = await serve();
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    const { page, errors } = await openPage(browser, base, { version: 2, replies: ["review", "ok"] });
    await page.locator('[data-review-estimate="ready"][data-review-version="2"]').waitFor();
    assert.match(await page.locator("[data-review-estimate]").innerText(), /^170\s€\s–\s370\s€$/, "live renders the server range (V2)");
    await send(page);
    await page.waitForFunction(() => /a changé/.test(document.querySelector("[data-host-message]")?.textContent ?? ""));
    let s = await st(page);
    assert.equal(s.posts.length, 1);
    assert.equal(s.posts[0].reviewed_estimate_version, 2, "sent exactly the rendered version");
    const uuid = s.posts[0].request_id;
    // V3 displayed (re-read for display only), no POST until a voluntary click.
    await page.locator('[data-review-estimate="ready"][data-review-version="3"]').waitFor();
    assert.equal((await st(page)).posts.length, 1, "never an automatic resend");
    const stored = await page.evaluate(() => JSON.parse(sessionStorage.getItem("courant-booking-draft")!).booking);
    assert.equal(stored.reviewed_estimate_version, 2, "version unchanged until the explicit click");
    assert.equal(stored.estimate_review_required, true, "the qualified refusal is persisted in the draft");
    assert.equal(stored.request_id, uuid);
    // Tab reload (server still at V3): the refusal is recovered — honest message + V3 range, same UUID.
    await page.goto(`${base}#${encodeURIComponent(JSON.stringify({ version: 3, replies: ["ok"] }))}`);
    await page.reload();
    await page.locator("[data-estimate-review-required]").waitFor();
    assert.match(await page.locator("[data-estimate-review-required]").innerText(), /a changé/);
    await page.locator('[data-review-estimate="ready"][data-review-version="3"]').waitFor();
    assert.equal((await st(page)).posts.length, 0, "nothing re-sent by the reload");
    await send(page);
    await page.waitForFunction(() => document.querySelector("[data-host-message]")?.textContent === "envoyée");
    s = await st(page);
    assert.equal(s.posts.length, 1, "one POST after the reload");
    assert.equal(s.posts[0].request_id, uuid, "SAME UUID");
    assert.equal(s.posts[0].reviewed_estimate_version, 3, "V3 after the voluntary click");
    const after = await page.evaluate(() => JSON.parse(sessionStorage.getItem("courant-booking-draft")!).booking);
    assert.equal(after.estimate_review_required, undefined, "flag cleared by the re-confirmation");
    assert.equal(await page.evaluate("document.documentElement.scrollWidth"), 390);
    assert.deepEqual(errors, []);
    await page.context().close();
  } finally {
    await browser.close();
    server.close();
  }
});

test("Chromium : 409 générique / « Reserved estimate conflict » / 5xx / réponse perdue ⇒ même UUID et même version ; rechargement ⇒ version relue du brouillon ; requête envoyée ⇒ sa version, jamais le prix courant", { skip }, async () => {
  const { server, base } = await serve();
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    const first = await openPage(browser, base, { version: 2, replies: ["conflict", "5xx", "lost"] });
    const page = first.page;
    await page.locator('[data-review-version="2"]').waitFor();
    for (let i = 0; i < 3; i++) {
      await send(page);
      await page.waitForFunction((n: number) => (window as unknown as { S: S }).S.posts.length === n, i + 1);
      await page.waitForTimeout(150);
    }
    const s = await st(page);
    assert.equal(new Set(s.posts.map((p) => p.request_id)).size, 1, "same UUID");
    assert.deepEqual(s.posts.map((p) => p.reviewed_estimate_version), [2, 2, 2], "same version (no change on a generic 409 / 5xx / lost reply)");
    // The server is now at V3, but this request keeps its stored version: never the current price.
    await page.evaluate(() => { (window as unknown as { S: S }).S.version = 3; });
    // Reload (same tab storage): the version comes back from the booking draft.
    await page.reload();
    await page.locator("[data-reserved-estimate]").waitFor();
    assert.equal(await page.locator("[data-reserved-estimate]").getAttribute("data-reserved-estimate"), "2");
    assert.match(await page.locator("[data-reserved-estimate]").innerText(), /^170,00\s€\s–\s370,00\s€$/, "the amounts confirmed with this request (V2), from the draft");
    await page.evaluate(() => { (window as unknown as { S: S }).S.replies = ["ok"]; });
    await send(page);
    await page.waitForFunction(() => document.querySelector("[data-host-message]")?.textContent === "envoyée");
    const after = await st(page);
    assert.equal(after.posts[after.posts.length - 1].request_id, s.posts[0].request_id);
    assert.equal(after.posts[after.posts.length - 1].reviewed_estimate_version, 2, "reload ⇒ same stored version");
    await first.context.close();
  } finally {
    await browser.close();
    server.close();
  }
});

test("Chromium : V2 non vue jamais approuvée ; lecture en échec ⇒ « non vérifiée » ; identité changée pendant la relecture ⇒ aucun POST ; démo ⇒ zéro appel", { skip }, async () => {
  const { server, base } = await serve();
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    // Rendered V2, but the server moved to V3 before the click: blocked, no POST.
    let { page, context } = await openPage(browser, base, { version: 2 });
    await page.locator('[data-review-version="2"]').waitFor();
    await page.evaluate(() => { (window as unknown as { S: S }).S.version = 3; });
    await send(page);
    await page.waitForFunction(() => /mise à jour/.test(document.querySelector("[data-host-message]")?.textContent ?? ""));
    assert.equal((await st(page)).posts.length, 0, "an unseen version is never approved");
    await context.close();
    // Read failure ⇒ « estimation non vérifiée ».
    ({ page, context } = await openPage(browser, base, { version: 2 }));
    await page.evaluate(() => { (window as unknown as { S: S }).S.fail = true; });
    await page.reload();
    await page.evaluate(() => { (window as unknown as { S: S }).S.fail = true; });
    await context.close();
    ({ page, context } = await openPage(browser, base, { version: 2 }));
    await page.locator('[data-review-version="2"]').waitFor();
    await page.evaluate(() => { const w = window as unknown as { S: S }; w.S.hold = true; });
    await send(page);
    await page.waitForFunction(() => (window as unknown as { S: S }).S.gets >= 2);
    await page.evaluate(() => { const w = window as unknown as { S: S; switchIdentity: () => void }; w.switchIdentity(); w.S.hold = false; w.S.release(); });
    await page.waitForFunction(() => /identité changée/.test(document.querySelector("[data-host-message]")?.textContent ?? ""));
    assert.equal((await st(page)).posts.length, 0, "identity changed during the re-read ⇒ no POST");
    assert.equal(await page.evaluate(() => sessionStorage.getItem("courant-booking-draft")), null, "nothing persisted");
    await context.close();
    // Demo ⇒ static values, zero fetch.
    ({ page, context } = await openPage(browser, base, { demo: true }));
    await page.waitForTimeout(400);
    assert.equal((await st(page)).gets, 0);
    assert.match(await page.locator("[data-booking-confirm]").innerText(), /150,00\s€\s–\s350,00\s€/);
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
});

test("Chromium : lecture en échec ⇒ « estimation non vérifiée » dans BookingConfirm", { skip }, async () => {
  const { server, base } = await serve();
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 1000 } });
    await context.addInitScript(() => { (window as unknown as { __failPrices: boolean }).__failPrices = true; });
    const page = await context.newPage();
    await page.route("**/*", (r: Any) => r.continue());
    await page.goto(`${base}#${encodeURIComponent(JSON.stringify({ version: 2 }))}`);
    await page.evaluate(() => { (window as unknown as { S: S }).S.fail = true; });
    // Force a fresh read: the shared store re-reads on demand (e.g. after the TTL / a click).
    await send(page);
    await page.locator('[data-review-estimate="error"]').waitFor();
    assert.equal(await page.locator('[data-review-estimate="error"]').innerText(), "estimation non vérifiée");
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
});
