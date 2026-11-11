// CLI-05 — BookingConfirm contact editor, REAL mount in Chromium at 390 px (StrictMode): the phone
// error never changes the field's accessible name (label stable, error via aria-describedby,
// aria-invalid on the input); fixing the value clears both; keyboard order and typing work; an
// invalid contact sends nothing (0 POST).
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
import { createElement as h, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BookingConfirm } from "./components/role/booking-confirm";
window.posts = 0; window.saved = [];
window.fetch = async (url, init) => { if (init && init.method === "POST") window.posts++; return new Response("{}", { status: 404 }); };
const draft = { category: "panel", description: "Le disjoncteur saute dès que j’allume le four", address: "3 rue des Ateliers", postal_code: "97200", city: "Fort-de-France", urgency: "urgent" };
const booking = { slug: "panne-tableau-electrique", urgent: true, slot: null, notes: "", contact: { civility: "", first_name: "Camille", last_name: "Dupont", email: "", phone: "", company: false }, payment: "on_site" };
const confirmBooking = async () => { window.posts++; return true; };
const div = document.createElement("div"); document.body.appendChild(div);
createRoot(div).render(h(StrictMode, null, h(BookingConfirm, { draft, booking, busy: false, profileId: "u1", demo: true, confirmBooking, onEdit() {}, onContactChange(c) { window.saved.push(c); }, onPaymentChange() {} })));
`;

test("Chromium 390 : erreur Téléphone hors du libellé (aria-describedby + aria-invalid), correction, clavier, 0 POST si invalide", { skip }, async () => {
  const b = await build({ absWorkingDir: ROOT, stdin: { contents: ENTRY, resolveDir: ROOT, loader: "tsx" }, bundle: true, write: false, outdir: "out", platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "local-css", ".svg": "dataurl", ".png": "dataurl", ".jpg": "dataurl", ".webp": "dataurl" }, define: { "process.env.NODE_ENV": '"development"', "process.env.NEXT_PUBLIC_SUPABASE_URL": "undefined", "process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY": "undefined" }, logLevel: "error" });
  const js = b.outputFiles.find((f) => f.path.endsWith(".js"))!.text;
  const css = readFileSync(path.join(ROOT, "app/globals.css"), "utf8") + b.outputFiles.filter((f) => f.path.endsWith(".css")).map((f) => f.text).join("\n");
  const server: Server = createServer((_q, r) => { r.setHeader("content-type", "text/html"); r.end(`<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>${css}</style><body><script>${js}</script></body></html>`); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 1000 } })).newPage();
    const errors: string[] = [];
    page.on("pageerror", (e: Error) => errors.push(String(e)));
    await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}/`);
    // Invalid contact (empty phone) ⇒ « Envoyer ma demande » sends nothing and opens the editor.
    await page.getByRole("button", { name: "Envoyer ma demande" }).click();
    await page.locator("[data-booking-contact-edit]").waitFor();
    assert.equal(await page.evaluate("window.posts"), 0, "0 POST while the contact is invalid");
    assert.equal(await page.getByRole("alert").filter({ hasText: "rien n’a été envoyé" }).count(), 1);
    // Accessible name = label only; the error is a description, not part of the name.
    const phone = page.getByRole("textbox", { name: "Téléphone", exact: true });
    assert.equal(await phone.count(), 1, "accessible name is exactly « Téléphone »");
    assert.equal(await phone.getAttribute("aria-invalid"), "true");
    const describedBy = await phone.getAttribute("aria-describedby");
    assert.ok(describedBy, "error linked by aria-describedby");
    const errorText = await page.evaluate(`document.getElementById(${JSON.stringify(describedBy)})?.textContent`);
    assert.equal(errorText, "Indiquez un numéro de téléphone en +596, +590 ou +33 (ex. 0696 12 34 56 ou +590 690 12 34 56).");
    assert.equal(await page.locator("[data-booking-contact-edit] label").filter({ hasText: "Indiquez" }).count(), 0, "no error inside any label");
    assert.equal(await page.locator("[data-booking-contact-edit] label").count(), 3);
    assert.equal(await page.getByRole("textbox", { name: "Prénom", exact: true }).count(), 1);
    assert.equal(await page.getByRole("textbox", { name: "Nom", exact: true }).count(), 1);
    assert.equal(await page.getByRole("button", { name: "Enregistrer mes coordonnées" }).isDisabled(), true);
    // Keyboard: Prénom → Nom → Téléphone, typing fixes the error.
    await page.getByRole("textbox", { name: "Prénom", exact: true }).focus();
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate("document.activeElement.getAttribute('autocomplete')"), "family-name");
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate("document.activeElement.getAttribute('autocomplete')"), "tel");
    await page.keyboard.type("0696 12 34 56");
    assert.equal(await phone.inputValue(), "0696 12 34 56");
    assert.equal(await phone.getAttribute("aria-invalid"), null, "aria-invalid cleared");
    assert.equal(await phone.getAttribute("aria-describedby"), null, "no stale description");
    assert.equal(await page.locator("[data-booking-contact-edit] .field-error").count(), 0, "error gone");
    assert.equal(await page.getByRole("textbox", { name: "Téléphone", exact: true }).count(), 1, "name unchanged after correction");
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate("document.activeElement.textContent"), "Enregistrer mes coordonnées");
    await page.keyboard.press("Enter");
    const saved = (await page.evaluate("window.saved")) as Array<{ phone: string }>;
    assert.equal(saved.length, 1);
    assert.equal(saved[0].phone, "0696 12 34 56", "value saved as typed");
    assert.equal(await page.evaluate("window.posts"), 0, "saving sends nothing");
    const small = await page.evaluate("[...document.querySelectorAll('input, button')].filter((e) => e.getBoundingClientRect().height > 0 && e.getBoundingClientRect().height < 43.5 && !e.classList.contains('text-button')).length");
    assert.equal(small, 0);
    assert.ok(((await page.evaluate("document.documentElement.scrollWidth")) as number) <= 390);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    server.close();
  }
});
