// Playwright helpers: injected module path, contexts with a network summary (method/path/status
// only — never headers, cookies or bodies), form login with project-cookie check, hash routing,
// evidence captures, `expectVisible` which turns a missing REQUIRED control into an app defect
// (AssertionError) instead of a harness anomaly, and `safeRoute` / `routeFetch` so that no
// route-handler error can ever escape as an unhandled rejection.
import path from "node:path";
import { pathToFileURL } from "node:url";
import { access } from "node:fs/promises";
import assert from "node:assert/strict";
import { AppDefect } from "./report.mjs";

// Runtime settings shared by every helper (set once by run.mjs from --timeout-ms).
const runtime = { timeoutMs: 90000 };
export function configureBrowser({ timeoutMs } = {}) {
  if (Number.isInteger(timeoutMs) && timeoutMs >= 1000) runtime.timeoutMs = timeoutMs;
  return { ...runtime };
}
/** The configured timeout, for waits the suites write themselves. */
export const T = () => runtime.timeoutMs;

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
  // Playwright would otherwise kill the browser and call process.exit(130) itself on SIGINT,
  // before the harness lifecycle (stop gate → drain → cleanup). Signals are handled in run.mjs.
  const options = { headless, timeout: runtime.timeoutMs, handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false };
  if (chromiumPath) options.executablePath = chromiumPath;
  return pw.chromium.launch(options);
}

/** New isolated context + page. Service workers are blocked so no cache leaks between runs. */
export async function newPage(browser, { baseUrl, width = 1280, height = 900, redactor }) {
  const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: "block", locale: "fr-FR" });
  context.setDefaultTimeout(runtime.timeoutMs);
  context.setDefaultNavigationTimeout(runtime.timeoutMs);
  const page = await context.newPage();
  const network = [];
  const pageErrors = [];
  const origin = new URL(baseUrl).origin;
  // Summary only: never store URLs with queries, headers, cookies or bodies.
  page.on("response", (response) => {
    try {
      const u = new URL(response.url());
      if (u.origin === origin && u.pathname.startsWith("/api/"))
        network.push({ method: response.request().method(), path: u.pathname, status: response.status() });
    } catch {}
  });
  page.on("requestfailed", (request) => {
    try {
      const u = new URL(request.url());
      if (u.origin === origin && u.pathname.startsWith("/api/")) network.push({ method: request.method(), path: u.pathname, status: 0 });
    } catch {}
  });
  page.on("pageerror", (error) => pageErrors.push(redactor ? redactor.redactString(error.message) : "[error]"));
  // Drain before closing: no route callback may fire after the scenario (and never during cleanup).
  const close = async () => {
    try {
      await page.unrouteAll({ behavior: "ignoreErrors" });
    } catch {}
    try {
      await context.unrouteAll({ behavior: "ignoreErrors" });
    } catch {}
    await context.close().catch(() => {});
  };
  return { context, page, network, pageErrors, close };
}

/** Stops the browser entirely: every context is drained and closed, then the process ends. */
export async function stopBrowser(browser) {
  if (!browser) return;
  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      try {
        await page.unrouteAll({ behavior: "ignoreErrors" });
      } catch {}
    }
    try {
      await context.unrouteAll({ behavior: "ignoreErrors" });
    } catch {}
    await context.close().catch(() => {});
  }
  await browser.close().catch(() => {});
}

/**
 * Registers a route handler that can never produce an unhandled rejection: any throw inside
 * `handler` is recorded on the scenario (`s.routeError`) as an ANOMALY and the request is
 * aborted so the page does not hang. The handler receives the Playwright `route`.
 */
export async function safeRoute(handle, s, pattern, handler, where = "route") {
  await handle.page.route(pattern, async (route) => {
    try {
      await handler(route);
    } catch (error) {
      try {
        s.routeError(error, where);
      } catch {}
      try {
        await route.abort("failed");
      } catch {}
    }
  });
}

/** `route.fetch` with the configured timeout; errors are plain and carry no headers. */
export async function routeFetch(route, options = {}) {
  try {
    return await route.fetch({ timeout: runtime.timeoutMs, ...options });
  } catch (error) {
    const u = new URL(route.request().url());
    const e = new Error(`route.fetch ${route.request().method()} ${u.pathname} failed: ${String(error?.message || error).split("\n")[0].slice(0, 200)}`);
    e.name = /Timeout/i.test(String(error?.message)) ? "TimeoutError" : error?.name || "Error";
    throw e;
  }
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
  await page.goto(`${baseUrl}/#${hash.replace(/^#/, "")}`, { waitUntil: "domcontentloaded", timeout: runtime.timeoutMs });
}

/** Fetch an application API from inside the page (cookies of the current browser identity). */
export async function api(page, route, body, method) {
  return page.evaluate(
    async ({ route, body, method, timeoutMs }) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(route, {
          method: method || (body === undefined ? "GET" : "POST"),
          cache: "no-store",
          headers: body === undefined ? undefined : { "Content-Type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        });
        let json = null;
        try {
          json = await response.json();
        } catch {}
        return { status: response.status, cache: response.headers.get("cache-control"), body: json };
      } finally {
        clearTimeout(timer);
      }
    },
    { route, body, method, timeoutMs: runtime.timeoutMs },
  );
}

async function hasProjectCookie(context, projectRef) {
  const cookies = await context.cookies();
  return cookies.some((c) => c.name.startsWith(`sb-${projectRef}-auth-token`));
}

/**
 * The current user's own access token, read from the (possibly chunked, base64-prefixed)
 * Supabase SSR auth cookie of the browser context. Used only for direct RPC probes made as
 * that user; never logged (the redactor masks JWTs).
 */
export async function sessionAccessToken(context, projectRef) {
  const name = `sb-${projectRef}-auth-token`;
  const chunks = (await context.cookies())
    .filter((c) => c.name === name || c.name.startsWith(`${name}.`))
    .sort((a, b) => Number(a.name.split(".")[1] || 0) - Number(b.name.split(".")[1] || 0));
  if (!chunks.length) return null;
  let raw = chunks.map((c) => c.value).join("");
  try {
    raw = decodeURIComponent(raw);
  } catch {}
  let json = raw;
  if (raw.startsWith("base64-")) json = Buffer.from(raw.slice("base64-".length), "base64url").toString("utf8");
  try {
    const session = JSON.parse(json);
    return typeof session?.access_token === "string" ? session.access_token : null;
  } catch {
    return null;
  }
}

/**
 * Logs a cohort user in through the real form. Verifies (1) the auth cookie of the EXPECTED
 * project appears — the served app is wired to --project — and (2) /api/workspace reports the
 * created user's id. `sameDocument` keeps the SPA document (hash change) instead of a goto.
 */
export async function login(handle, baseUrl, user, projectRef, { sameDocument = false, timeout = runtime.timeoutMs } = {}) {
  const { page, context } = handle;
  if (sameDocument) await goHash(page, "auth");
  else await openHash(page, baseUrl, "auth");
  const form = page.locator("form").filter({ has: page.locator('input[type="email"]') }).first();
  await form.getByRole("textbox", { name: "Adresse email", exact: true }).fill(user.email);
  // A password input has no ARIA role: the <label for> association is its only accessible name.
  await form.getByLabel("Mot de passe", { exact: true }).fill(user.password);
  await form.getByRole("button", { name: "Se connecter", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('input[type="password"]'), null, { timeout });
  const deadline = Date.now() + Math.min(timeout, 30000);
  let cookie = false;
  while (Date.now() < deadline && !(cookie = await hasProjectCookie(context, projectRef))) await sleep(200);
  if (!cookie) {
    const names = (await context.cookies()).map((c) => c.name.replace(/-auth-token.*$/, "")).filter((n) => n.startsWith("sb-"));
    throw new AppDefect(`after login no cookie sb-${projectRef}-auth-token: the served application is not wired to project ${projectRef} (seen: ${[...new Set(names)].join(", ") || "none"})`);
  }
  return waitForWorkspace(page, user.id, timeout);
}

export async function waitForWorkspace(page, userId, timeout = runtime.timeoutMs) {
  const deadline = Date.now() + timeout;
  let last = null;
  while (Date.now() < deadline) {
    last = await api(page, "/api/workspace").catch(() => ({ status: -1, body: null }));
    if (last.status === 200 && last.body?.profile?.id === userId) return last.body;
    if (last.status === 200 && last.body?.profile?.id && last.body.profile.id !== userId)
      throw new AppDefect(`workspace identity ${last.body.profile.id} differs from the logged-in cohort user ${userId}`);
    await sleep(300);
  }
  throw new AppDefect(`workspace never reported the logged-in user (last status ${last?.status})`);
}

/** Clicks the first visible real logout control; opens the menu if necessary. */
export async function logout(page, { timeout = runtime.timeoutMs } = {}) {
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
    const r = await api(page, "/api/workspace").catch(() => ({ status: -1 }));
    if (r.status === 401) return;
    await sleep(250);
  }
  throw new AppDefect("workspace still authenticated after logout");
}

/**
 * Waits for a control the application MUST show. A timeout here is an application defect
 * (the absence is the behaviour under test), not a harness anomaly.
 */
export async function expectVisible(locator, what, { timeout = runtime.timeoutMs } = {}) {
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

/** Waits for a response whose pathname matches; never records headers. */
export function waitForApi(page, pathname, { method = "GET", query = null } = {}) {
  return page.waitForResponse(
    (r) => {
      try {
        const u = new URL(r.url());
        return u.pathname === pathname && r.request().method() === method && (query === null || u.search.includes(query));
      } catch {
        return false;
      }
    },
    { timeout: runtime.timeoutMs },
  );
}

export async function capture(handle, out, name, s) {
  const file = path.join(out, `${name}.png`);
  await handle.page.screenshot({ path: file, fullPage: true, timeout: runtime.timeoutMs });
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

/** Polls until `predicate()` is truthy or the configured timeout elapses (returns the value or null). */
export async function pollUntil(predicate, { timeout = runtime.timeoutMs, interval = 150 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await sleep(interval);
  }
  return null;
}

/** Tiny valid PNG (1x1) used as a photo fixture. */
export const PNG_1x1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+lmRsAAAAASUVORK5CYII=", "base64");
