import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

assert.ok(process.env.QA_PLAYWRIGHT_PATH, "Set QA_PLAYWRIGHT_PATH to the installed Playwright package");
const { firefox, webkit } = await import(pathToFileURL(resolve(process.env.QA_PLAYWRIGHT_PATH, "index.mjs")).href);
const assets = new Map([
  ["/sw.js", { "Content-Type": "application/javascript", "Service-Worker-Allowed": "/" }],
  ["/offline.html", { "Content-Type": "text/html", "X-Courant-Public-Offline": "1" }],
  ["/offline-request.html", { "Content-Type": "text/html", "X-Courant-Public-Request": "1" }],
  ["/offline-request.js", { "Content-Type": "application/javascript", "X-Courant-Public-Draft-Script": "1" }],
]);
const key = "courant-request-draft";

for (const [name, engine] of Object.entries({ firefox, webkit })) {
  test(`E68 — ${name} clears an expired draft from the real offline form and sessionStorage`, async () => {
    let offline = false, dropped = 0, writes = 0;
    const server = createServer(async (request, response) => {
      if (request.method !== "GET") { writes++; return response.writeHead(405).end(); }
      if (offline) { dropped++; return response.destroy(); }
      if (request.url === "/") return response.writeHead(200, { "Content-Type": "text/html" }).end(
        "<!doctype html><script>navigator.serviceWorker.register('/sw.js')</script>",
      );
      const headers = assets.get(request.url);
      if (!headers) return response.writeHead(404).end();
      const body = await readFile(new URL(`../public${request.url}`, import.meta.url));
      response.writeHead(200, { ...headers, "Cache-Control": "no-store" }).end(body);
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const origin = `http://127.0.0.1:${server.address().port}`;
    let browser;
    try {
      browser = await engine.launch();
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await context.newPage();
      await page.goto(origin + "/");
      await page.waitForFunction(() => navigator.serviceWorker.controller?.state === "activated", null, { timeout: 15_000 });
      offline = true;
      await page.goto(origin + "/offline-request.html");
      await page.locator("#offline-save:enabled").waitFor();
      await page.locator("input[name=category][value=socket]").check();
      await page.locator("#offline-description").fill("Description de recette");
      await page.locator("#offline-address").fill("12 rue de la Recette");
      await page.locator("#offline-save").click();
      await page.reload();
      await page.getByRole("status").filter({ hasText: "Brouillon local retrouvé" }).waitFor();
      assert.equal(await page.locator("#offline-address").inputValue(), "12 rue de la Recette");
      await page.evaluate(key => {
        const value = JSON.parse(sessionStorage.getItem(key));
        value.savedAt = Date.now() - 31 * 60 * 1000;
        sessionStorage.setItem(key, JSON.stringify(value));
      }, key);
      await page.reload();
      await page.getByRole("status").filter({ hasText: "Aucun brouillon local valide" }).waitFor();
      assert.deepEqual([
        await page.locator("#offline-description").inputValue(),
        await page.locator("#offline-address").inputValue(),
        await page.evaluate(key => sessionStorage.getItem(key) === null, key),
      ], ["", "", true]);
      assert.ok(dropped > 0);
      assert.equal(writes, 0);
    } finally {
      await browser?.close();
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  });
}
