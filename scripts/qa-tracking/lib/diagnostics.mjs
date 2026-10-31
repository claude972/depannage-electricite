// Bounded failure diagnostics (amendment A8 §1). Captured at the FIRST failure of a scenario, on the
// pages that scenario used, UNDER THE SAME IDENTITY and real state: no login, no reload, no goto, no
// click and no API call of its own. The tracking network summary is a PASSIVE observer attached when
// the page is created; it never issues a request (the server `reason` is read from the response the
// page already received). Kept: method, path with ids, status, ISO time, allowlisted action, source,
// bounded `reason`. Never headers, tokens, bodies or form values. Files: --out/diagnostics/<scenario>/
// (dir 0700, files 0600), run redactor applied. A diagnostics error never changes the verdict.
import { mkdirSync, chmodSync } from "node:fs";
import path from "node:path";
import { atomicWriteJsonSync } from "./durable.mjs";
import { parseTrackingUrl } from "./requests.mjs";
import { UI } from "./constants.mjs";

export const DIAG_LIMITS = Object.freeze({ pages: 3, opMs: 5000, totalMs: 20000, panelChars: 4000, blockers: 20, blockerChars: 200, headings: 20, headingChars: 120, statuses: 20, statusChars: 400, requests: 50, reasonBytes: 4096 });
/** The only POST actions recorded by name (tracking_command, lib/features/tracking/state.ts). */
export const TRACKING_ACTIONS = Object.freeze(["start", "point", "stop", "arrived", "destination"]);
const REASON_RE = /^[a-z_]{1,64}$/;

/** POST body → allowlisted action name, "other" for anything else, never the body text itself. */
export function allowlistedAction(method, kind, postData) {
  if (String(method).toUpperCase() !== "POST" || kind !== "tracking") return null;
  try {
    const action = JSON.parse(postData)?.action;
    return TRACKING_ACTIONS.includes(action) ? action : "other";
  } catch {
    return "other";
  }
}

/** Server `reason` of an error answer: a short snake_case string only, else null. */
export function boundedReason(text) {
  if (typeof text !== "string" || !text.length || Buffer.byteLength(text) > DIAG_LIMITS.reasonBytes) return null;
  try {
    const reason = JSON.parse(text)?.reason;
    return typeof reason === "string" && REASON_RE.test(reason) ? reason : null;
  } catch {
    return null;
  }
}

/** Passive per-page observer of tracking requests (ring buffer of the last DIAG_LIMITS.requests). */
export function observeTrackingNetwork(page, { now = Date.now, limit = DIAG_LIMITS.requests } = {}) {
  const list = [];
  const byRequest = new WeakMap();
  if (typeof page?.on !== "function") return { summary: () => [] };
  page.on("request", (request) => {
    try {
      const parsed = parseTrackingUrl(request.url());
      if (!parsed) return;
      const entry = { method: request.method().toUpperCase(), path: parsed.path, status: null, at: new Date(now()).toISOString(), action: allowlistedAction(request.method(), parsed.kind, request.postData()), source: request.headers()["x-qa-harness"] === "1" ? "harness" : "ui", reason: null };
      list.push(entry);
      byRequest.set(request, entry);
      while (list.length > limit) list.shift();
    } catch {}
  });
  page.on("response", (response) => {
    try {
      const entry = byRequest.get(response.request());
      if (!entry) return;
      entry.status = response.status();
      if (entry.status >= 400) {
        // Already-received body, read from the browser: no new request is made.
        response.text().then((text) => (entry.reason = boundedReason(text)), () => {});
      }
    } catch {}
  });
  page.on("requestfailed", (request) => {
    const entry = byRequest.get(request);
    if (entry) entry.status = 0;
  });
  return { summary: () => list.map((e) => ({ ...e })) };
}

const safeName = (name) => String(name).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64) || "scenario";

class DiagTimeout extends Error {}
function bounded(promise, ms) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => (timer = setTimeout(() => reject(new DiagTimeout("timeout")), ms)))]).finally(() => clearTimeout(timer));
}
const codeOf = (error, step) => (error instanceof DiagTimeout ? `${step}:TIMEOUT` : /closed|Target page/i.test(String(error?.message)) ? `${step}:PAGE_CLOSED` : `${step}:ERROR`);

/**
 * Visible-state reader run INSIDE the page: read-only DOM access, no fetch, no navigation. Kept as
 * SOURCE TEXT so no transpiler helper can be injected into the browser-side function.
 */
const READ_DOM_SOURCE = String.raw`(args) => {
  const clip = (text, n) => {
    const t = String(text ?? "").replace(/\s+/g, " ").trim();
    return t.length > n ? t.slice(0, n) + "…" : t;
  };
  const visible = (el) => !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
  const section = (title) => {
    for (const s of document.querySelectorAll("section")) {
      const h = s.querySelector("h1,h2,h3");
      if (h && h.textContent.trim() === title) return s;
    }
    return null;
  };
  const area = (title) => {
    const s = section(title);
    return s ? { present: true, visible: visible(s), text: clip(s.innerText, args.panelChars) } : { present: false };
  };
  return {
    blockers: [...document.querySelectorAll("[data-blocker]")].slice(0, args.blockers).map((el) => ({ blocker: clip(el.getAttribute("data-blocker"), 120), visible: visible(el), text: clip(el.innerText, args.blockerChars) })),
    artisan_panel: area(args.panelTitle),
    client_card: area(args.cardTitle),
    headings: [...document.querySelectorAll("h1,h2,h3")].filter(visible).slice(0, args.headings).map((h) => clip(h.innerText, args.headingChars)),
    statuses: [...document.querySelectorAll('[role="status"],[role="alert"]')].filter(visible).slice(0, args.statuses).map((el) => ({ role: el.getAttribute("role"), text: clip(el.innerText, args.statusChars) })),
  };
}`;
export const readDomExpression = (args) => `(${READ_DOM_SOURCE})(${JSON.stringify(args)})`;

/** URL path + hash only (never the query). */
export function urlWithoutQuery(raw) {
  try {
    const u = new URL(raw);
    return `${u.pathname}${u.hash}`;
  } catch {
    return null;
  }
}

/**
 * Captures diagnostics for `handles` ([{label, page, network}]) and never throws. Returns
 * {skipped} | {dir, files, truncated, errors}.
 */
export async function captureDiagnostics({ scenario, handles, out, redactor, gate = null, now = Date.now, limits = DIAG_LIMITS }) {
  if (gate?.stopping) return { skipped: "stopping" };
  if (!out) return { skipped: "no output directory" };
  const errors = [];
  const files = [];
  let truncated = false;
  const deadline = now() + limits.totalMs;
  const left = () => Math.max(0, Math.min(limits.opMs, deadline - now()));
  let dir;
  try {
    const root = path.join(out, "diagnostics");
    dir = path.join(root, safeName(scenario));
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(root, 0o700);
    chmodSync(dir, 0o700);
  } catch {
    return { skipped: "output directory unavailable", errors: ["DIR:ERROR"] };
  }
  const selected = (handles || []).filter((h) => h?.page && !(h.page.isClosed?.() ?? false));
  if (selected.length > limits.pages) truncated = true;
  for (const handle of selected.slice(0, limits.pages)) {
    if (gate?.stopping) {
      truncated = true;
      break;
    }
    if (left() === 0) {
      truncated = true;
      break;
    }
    const label = safeName(handle.label);
    const record = { scenario: String(scenario), page: String(handle.label), captured_at: new Date(now()).toISOString(), identity: "same session, no relogin/reload/navigation", url: urlWithoutQuery(handle.page.url()), screenshot: null, dom: null, requests: handle.network ? handle.network.summary() : [], errors: [] };
    try {
      const png = path.join(dir, `${label}.png`);
      await bounded(handle.page.screenshot({ path: png, fullPage: false, timeout: left() || 1 }), left() || 1);
      chmodSync(png, 0o600);
      record.screenshot = path.basename(png);
      files.push(png);
    } catch (error) {
      record.errors.push(codeOf(error, "SCREENSHOT"));
    }
    if (left() === 0) {
      truncated = true;
      record.errors.push("DOM:SKIPPED_TIME_CAP");
    } else {
      try {
        record.dom = await bounded(handle.page.evaluate(readDomExpression({ ...limits, panelTitle: UI.artisanPanelTitle, cardTitle: UI.clientCardTitle })), left() || 1);
      } catch (error) {
        record.errors.push(codeOf(error, "DOM"));
      }
    }
    try {
      const json = path.join(dir, `${label}.json`);
      atomicWriteJsonSync(json, redactor ? redactor.redact(record) : record);
      files.push(json);
    } catch {
      errors.push("WRITE:ERROR");
    }
    errors.push(...record.errors.map((c) => `${label}:${c}`));
  }
  return { dir, files, truncated, errors };
}
