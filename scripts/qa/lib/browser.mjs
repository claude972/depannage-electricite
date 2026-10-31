// Playwright helpers: injected module path, contexts with a network summary (method/path/status
// only — never headers, cookies or bodies), form login with project-cookie check, hash routing,
// evidence captures, and `expectVisible` which turns a missing REQUIRED control into an app
// defect (AssertionError) instead of a harness anomaly.
import path from "node:path";
import { pathToFileURL } from "node:url";
import { access } from "node:fs/promises";
import assert from "node:assert/strict";
import { AppDefect } from "./report.mjs";

export async function loadPlaywright(modulePath) {
  if (!modulePath) throw new Error("Playwright path missing: pass --playwright-path or QA_PLAYWRIGHT_PATH (an installed `playwright` module directory)");
  const entry = path.join(path.resolve(modulePath), "index.mjs");
  try {
    await access(entry);
  } catch {
    throw new Error(`Playwright module not found at ${entry}`);
  }
  const mod = await import(pathToFileURL(entry).href);
  if (!mod.chromium) throw new Error("Playwright module does not expose chromium");
  return mod;
}

export async function launchBrowser(pw, { headless = true, chromiumPath = "" } = {}) {
  const options = { headless };
  if (chromiumPath) options.executablePath = chromiumPath;
  return pw.chromium.launch(options);
}

/** New isolated context + page. Service workers are blocked so no cache leaks between runs. */
export async function newPage(browser, { baseUrl, width = 1280, height = 900, redactor }) {
  const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: "block", locale: "fr-FR" });
  const page = await context.newPage();
  const network = [];
  const pageErrors = [];
  const origin = new URL(baseUrl).origin;
  page.on("response", (response) => {
    try {
      const u = new URL(response.url());
      if (u.origin === origin && u.pathname.startsWith("/api/"))
        network.push({ method: response.request().method(), path: u.pathname, status: response.status(), at: Date.now() });
    } catch {}
  });
  page.on("requestfailed", (request) => {
    try {
      const u = new URL(request.url());
      if (u.origin === origin && u.pathname.startsWith("/api/")) network.push({ method: request.method(), path: u.pathname, status: 0, at: Date.now() });
    } catch {}
  });
  page.on("pageerror", (error) => pageErrors.push(redactor ? redactor.redactString(error.message) : "[error]"));
  return { context, page, network, pageErrors, close: () => context.close().catch(() => {}) };
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Hash navigation inside the single-page app (no document reload). */
export async function goHash(page, hash) {
  await page.evaluate((h) => {
    window.location.hash = h;
  }, hash.replace(/^#/, ""));
  await sleep(150);
}

/** Full document load at base + '#hash'. */
export async function openHash(page, baseUrl, hash) {
  await page.goto(`${baseUrl}/#${hash.replace(/^#/, "")}`, { waitUntil: "domcontentloaded" });
}

/** Fetch an application API from inside the page (cookies of the current browser identity). */
export async function api(page, route, body, method) {
  return page.evaluate(
    async ({ route, body, method }) => {
      const response = await fetch(route, {
        method: method || (body === undefined ? "GET" : "POST"),
        cache: "no-store",
        headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      let json = null;
      try {
        json = await response.json();
      } catch {}
      return { status: response.status, cache: response.headers.get("cache-control"), body: json };
    },
    { route, body, method },
  );
}

async function hasProjectCookie(context, projectRef) {
  const cookies = await context.cookies();
  return cookies.some((c) => c.name.startsWith(`sb-${projectRef}-auth-token`));
}

/**
 * Logs a cohort user in through the real form. Verifies (1) the auth cookie of the EXPECTED
 * project appears — the served app is wired to --project — and (2) /api/workspace reports the
 * created user's id. `sameDocument` keeps the SPA document (hash change) instead of a goto.
 */
export async function login(handle, baseUrl, user, projectRef, { sameDocument = false, timeout = 45000 } = {}) {
  const { page, context } = handle;
  if (sameDocument) await goHash(page, "auth");
  else await openHash(page, baseUrl, "auth");
  const form = page.locator("form").filter({ has: page.locator('input[type="email"]') }).first();
  await form.getByLabel("Adresse email", { exact: true }).fill(user.email);
  await form.getByLabel("Mot de passe", { exact: true }).fill(user.password);
  await form.getByRole("button", { name: "Se connecter", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('input[type="password"]'), null, { timeout });
  const deadline = Date.now() + 15000;
  let cookie = false;
  while (Date.now() < deadline && !(cookie = await hasProjectCookie(context, projectRef))) await sleep(200);
  if (!cookie) {
    const names = (await context.cookies()).map((c) => c.name.replace(/-auth-token.*$/, "")).filter((n) => n.startsWith("sb-"));
    throw new AppDefect(`after login no cookie sb-${projectRef}-auth-token: the served application is not wired to project ${projectRef} (seen: ${[...new Set(names)].join(", ") || "none"})`);
  }
  const workspace = await waitForWorkspace(page, user.id, timeout);
  return workspace;
}

export async function waitForWorkspace(page, userId, timeout = 30000) {
  const deadline = Date.now() + timeout;
  let last = null;
  while (Date.now() < deadline) {
    last = await api(page, "/api/workspace");
    if (last.status === 200 && last.body?.profile?.id === userId) return last.body;
    if (last.status === 200 && last.body?.profile?.id && last.body.profile.id !== userId)
      throw new AppDefect(`workspace identity ${last.body.profile.id} differs from the logged-in cohort user ${userId}`);
    await sleep(300);
  }
  throw new AppDefect(`workspace never reported the logged-in user (last status ${last?.status})`);
}

/** Clicks the first visible real logout control; opens the menu if necessary. */
export async function logout(page, { timeout = 20000 } = {}) {
  const pattern = /^(Se déconnecter|Déconnexion)$/;
  const tryClick = async () => {
    const buttons = page.getByRole("button", { name: pattern });
    const n = await buttons.count();
    for (let i = 0; i < n; i++)
      if (await buttons.nth(i).isVisible()) {
        await buttons.nth(i).click();
        return true;
      }
    return false;
  };
  let clicked = await tryClick();
  if (!clicked) {
    const menu = page.getByRole("button", { name: /Ouvrir le menu|^Menu$/ }).first();
    if (await menu.count()) {
      await menu.click();
      await sleep(200);
      clicked = await tryClick();
    }
  }
  if (!clicked) throw new AppDefect("no visible logout control for the logged-in user");
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const r = await api(page, "/api/workspace");
    if (r.status === 401) return;
    await sleep(250);
  }
  throw new AppDefect("workspace still authenticated after logout");
}

/**
 * Waits for a control the application MUST show. A timeout here is an application defect
 * (the absence is the behaviour under test), not a harness anomaly.
 */
export async function expectVisible(locator, what, { timeout = 20000 } = {}) {
  try {
    await locator.first().waitFor({ state: "visible", timeout });
  } catch (error) {
    if (/Timeout/i.test(String(error?.message))) throw new AppDefect(`expected visible: ${what} (not shown within ${timeout} ms)`);
    throw error;
  }
}

/** Asserts a control the role must NOT get is absent or disabled (after the view settled). */
export async function expectAbsentOrDisabled(locator, what) {
  const n = await locator.count();
  for (let i = 0; i < n; i++) {
    const item = locator.nth(i);
    if ((await item.isVisible()) && (await item.isEnabled())) throw new AppDefect(`forbidden control available: ${what}`);
  }
}

export async function capture(handle, out, name, s) {
  const file = path.join(out, `${name}.png`);
  await handle.page.screenshot({ path: file, fullPage: true });
  if (s) s.evidence(file, "browser");
  return file;
}

export async function bodyText(page) {
  return page.locator("body").innerText();
}

export function postsTo(network, pathPrefix = "/api/") {
  return network.filter((n) => n.method !== "GET" && n.method !== "HEAD" && n.path.startsWith(pathPrefix));
}

export async function noHorizontalOverflow(page, width) {
  const measure = await page.evaluate(() => ({ viewport: window.innerWidth, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight }));
  assert.ok(measure.scrollWidth <= width + 1, `horizontal overflow at ${width}px: ${JSON.stringify(measure)}`);
  return measure;
}

/** Tiny valid PNG (1x1) used as a photo fixture. */
export const PNG_1x1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+lmRsAAAAASUVORK5CYII=", "base64");
