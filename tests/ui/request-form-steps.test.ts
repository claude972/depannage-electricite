// RequestForm steps in a real browser (root finding on 6df): after « Continuer » the new step title
// takes focus and is scrolled into view (mobile 390 px). Skipped — never passed — without local Chromium.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
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

const APP = `
import { createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { RequestForm } from "./components/app/forms";
createRoot(document.getElementById("app")).render(
  h("div", null, h("div", { style: { height: "1400px" } }, "haut de page"),
    h(RequestForm, { initialCategory: "panel", initialValues: null, sites: [], mode: "public", busy: false, onBack() {}, onSubmit: async () => {}, onDemo() {} }),
    h("div", { style: { height: "1400px" } })));
`;

test("RequestForm: « Continuer » focuses and reveals the next step title (390 px)", { skip: available ? false : "local Playwright/Chromium not found (SKIPPED, never PASS)" }, async () => {
  const out = await build({ absWorkingDir: ROOT, stdin: { contents: APP, resolveDir: ROOT, loader: "tsx" }, bundle: true, write: false, outdir: "out", platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "local-css" }, define: { "process.env.NODE_ENV": '"development"' } });
  const js = out.outputFiles.find((f) => f.path.endsWith(".js"))!.text;
  const server = createServer((_rq, rs) => {
    rs.setHeader("content-type", "text/html");
    rs.end('<!doctype html><meta name="viewport" content="width=device-width"><div id="app"></div><script>' + js + "</script>");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 780 }, reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", (e: Error) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}/`);
    await page.getByText("Que se passe-t-il ?").waitFor();
    const firstFocus = await page.evaluate(() => document.activeElement?.tagName);
    assert.notEqual(firstFocus, "H2", "no focus move on first render");
    await page.locator("textarea").first().fill("Le disjoncteur saute dès que le four est allumé.");
    // Hold the browser's byte read to exercise the real asynchronous selection window.
    await page.evaluate(() => {
      const original = Blob.prototype.arrayBuffer;
      (window as any).releasePhoto = null;
      Blob.prototype.arrayBuffer = function () {
        const blob = this;
        return new Promise<ArrayBuffer>(resolve => {
          (window as any).releasePhoto = async () => resolve(await original.call(blob));
        });
      };
    });
    const input = page.locator('input[type="file"]');
    await input.setInputFiles({ name: "recette.jpg", mimeType: "image/jpeg", buffer: Buffer.from([255,216,255,224,0,16,74,70,73,70,0,1]) });
    await page.getByText("Vérification des photos…").waitFor();
    assert.equal(await input.isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: "Continuer" }).isDisabled(), true);
    await page.evaluate(() => (window as any).releasePhoto());
    await page.getByRole("button", { name: "Retirer recette.jpg" }).waitFor();
    assert.equal(await input.isDisabled(), false);
    await input.setInputFiles({ name: "faux.png", mimeType: "image/png", buffer: Buffer.from("not-a-valid-image") });
    await page.getByText("Vérification des photos…").waitFor();
    assert.equal(await page.getByRole("button", { name: "Retirer recette.jpg" }).isDisabled(), true);
    await page.evaluate(() => (window as any).releasePhoto());
    await page.getByText(/faux.png : le contenu ne correspond/).waitFor();
    assert.equal(await page.getByRole("button", { name: "Retirer faux.png" }).count(), 0);
    assert.equal(await page.getByRole("button", { name: "Retirer recette.jpg" }).isDisabled(), false);
    await page.getByRole("button", { name: "Continuer" }).click();
    await page.getByText("Où faut-il intervenir ?").waitFor();
    await page.waitForTimeout(100);
    const s = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      const r = el.getBoundingClientRect();
      return { text: el.textContent, tag: el.tagName, top: r.top, vh: innerHeight };
    });
    assert.equal(s.tag, "H2");
    assert.equal(s.text, "Où faut-il intervenir ?");
    assert.ok(s.top >= 0 && s.top < s.vh / 2, `title in the upper viewport (top=${s.top})`);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    server.close();
  }
});
