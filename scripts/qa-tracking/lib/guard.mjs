// Mutation barrier (A5.4 + root review of 8aa5a78):
//  * every mutating request — harness-issued API POSTs AND browser-triggered POSTs — is announced
//    by a durable intent and REGISTERED in the stop gate, so the lifecycle drain waits for it;
//  * the stop gate is checked IMMEDIATELY before emission (no await between check and send);
//  * once the gate is raised, browser mutations are aborted at the route level before leaving
//    the browser (never announced, never sent), harness calls throw StopRequestedError;
//  * outcome classification: 2xx fully read ⇒ done; 400/401/403/404/409/422/429 fully read ⇒
//    refused; transport error, timeout, 5xx, any other status or a response not fully read ⇒
//    UNKNOWN: the intent stays open with a readback; the run ends INCOMPLETE unless proven.
import { api } from "../../qa/lib/browser.mjs";
import { DEFINITIVE_REFUSALS } from "./intents.mjs";
import { describeMutation } from "./reconcile.mjs";
import { summarizeTrackingRequest } from "./requests.mjs";

export const MUTATING_METHODS = Object.freeze(["POST", "PUT", "PATCH", "DELETE"]);
/** Header set by pageTransport: such a request is already intended+drained by createTrackingApi. */
export const HARNESS_HEADER = "x-qa-harness";

export function classifyMutation({ status = null, complete = false, transportError = false } = {}) {
  if (transportError || !complete || !Number.isInteger(status)) return "unknown";
  if (status >= 200 && status < 300) return "done";
  if (DEFINITIVE_REFUSALS.includes(status)) return "refused";
  return "unknown";
}

/**
 * In-page transport (user cookies). The body is read COMPLETELY as text before parsing: a body
 * that cannot be read (connection dropped mid-response) is `complete:false`.
 */
export function pageTransport(page, timeoutMs = 90000) {
  return (path, body) =>
    page.evaluate(
      async ({ path, body, timeoutMs }) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let response;
        try {
          response = await fetch(path, { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json", "x-qa-harness": "1" }, body: JSON.stringify(body), signal: controller.signal });
        } catch (error) {
          clearTimeout(timer);
          return { status: null, complete: false, transportError: true, error: String(error?.name || "error") };
        }
        let text = null;
        try {
          text = await response.text();
        } catch {
          clearTimeout(timer);
          return { status: response.status, cache: response.headers.get("cache-control"), complete: false, transportError: false, body: null };
        }
        clearTimeout(timer);
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {}
        return { status: response.status, cache: response.headers.get("cache-control"), complete: true, transportError: false, body: json };
      },
      { path, body, timeoutMs },
    );
}

async function settleOrReconcile(intents, id, outcome, answer, reconcile, meta) {
  if (outcome !== "unknown") {
    intents.settle(id, outcome, { status: answer?.status ?? null });
    return;
  }
  if (!reconcile) return;
  const proveLater = () => reconcile(meta);
  intents.attach(id, proveLater);
  try {
    const proof = await proveLater();
    if (proof?.proven) intents.settle(id, "reconciled", { note: proof.note });
  } catch {}
}

/** Harness-issued tracking/intervention API calls. Reads are plain; POSTs are gated, intended, drained. */
export function createTrackingApi({ gate, intents, reconcile = null, transportFor = (page) => pageTransport(page) }) {
  return {
    async get(page, path) {
      gate.check();
      return api(page, path);
    },
    post(page, path, body, options = {}) {
      const opts = typeof options === "string" ? { key: options } : options || {};
      gate.check(); // nothing is awaited between this check and the emission below
      const meta = describeMutation(path, body, { before: opts.before });
      const send = transportFor(page);
      const id = intents.begin(`api:${meta.action || meta.operation || meta.kind}`, path, opts.key ?? null, meta.kind);
      const run = (async () => {
        let answer;
        try {
          answer = await send(path, body);
        } catch (error) {
          answer = { status: null, complete: false, transportError: true, error: String(error?.message || error).slice(0, 160) };
        }
        const outcome = classifyMutation(answer);
        await settleOrReconcile(intents, id, outcome, answer, reconcile, meta);
        return { ...answer, outcome };
      })();
      gate.register(run);
      return run;
    },
  };
}

/**
 * Browser-triggered mutations of the page (watchPosition points, button clicks…): every same-
 * origin mutating /api/ request is intercepted, refused before emission once the gate is raised,
 * otherwise announced, registered in the drain and classified when it completes or fails.
 * Returns {pending(), detach()}.
 */
export async function trackBrowserMutations(page, { gate, intents, reconcile = null, origin, onEvent = () => {}, bodyTimeoutMs = 15000 }) {
  const live = new Map();
  const blocked = new WeakSet();
  const isMutation = (request) => {
    try {
      const u = new URL(request.url());
      return u.origin === origin && u.pathname.startsWith("/api/") && MUTATING_METHODS.includes(request.method());
    } catch {
      return false;
    }
  };
  const handler = async (route) => {
    const request = route.request();
    if (!isMutation(request) || request.headers()[HARNESS_HEADER] === "1") return route.continue().catch(() => {});
    if (gate.stopping) {
      blocked.add(request);
      onEvent({ type: "browser-mutation-blocked", path: new URL(request.url()).pathname, at: Date.now() });
      return route.abort("blockedbyclient").catch(() => {});
    }
    const path = new URL(request.url()).pathname;
    let body = null;
    try {
      body = JSON.parse(request.postData() || "null");
    } catch {}
    const meta = describeMutation(path, body);
    const summary = summarizeTrackingRequest(request.method(), request.url(), request.postData());
    const id = intents.begin(`browser:${meta.action || meta.operation || request.method()}`, path, summary?.session_id ? `${summary.action}:${summary.session_id}:${summary.seq ?? ""}` : null, meta.kind);
    let done;
    const settled = new Promise((resolve) => (done = resolve));
    gate.register(settled);
    live.set(request, { id, meta, status: null, done });
    onEvent({ type: "browser-mutation-sent", path, at: Date.now() });
    try {
      await route.continue();
    } catch {
      const entry = live.get(request);
      if (entry) {
        live.delete(request);
        await settleOrReconcile(intents, entry.id, "unknown", null, reconcile, entry.meta);
        entry.done();
      }
    }
  };
  const finish = async (request, complete) => {
    if (blocked.has(request)) return;
    const entry = live.get(request);
    if (!entry) return;
    live.delete(request);
    const outcome = classifyMutation({ status: entry.status, complete, transportError: !complete && entry.status === null });
    await settleOrReconcile(intents, entry.id, outcome, { status: entry.status }, reconcile, entry.meta);
    onEvent({ type: "browser-mutation-settled", kind: entry.meta.kind, outcome, at: Date.now() });
    entry.done();
  };
  const onResponse = (response) => {
    const request = response.request();
    const entry = live.get(request);
    if (!entry) return;
    entry.status = response.status();
    // Complete only once the body is fully received (null) — `requestfinished` alone is not
    // reliable when the page never reads the body; an error here means "not fully read".
    // A body never completed within the bound is "not fully read" ⇒ unknown (then readback).
    let timer;
    const bounded = new Promise((resolve) => {
      timer = setTimeout(() => resolve(new Error("body not completed")), bodyTimeoutMs);
      if (typeof timer.unref === "function") timer.unref();
    });
    Promise.race([response.finished().catch((e) => e || new Error("finished failed")), bounded]).then((error) => {
      clearTimeout(timer);
      return finish(request, error === null);
    });
  };
  const onFinished = (request) => void finish(request, true);
  const onFailed = (request) => void finish(request, false);
  await page.route("**/api/**", handler);
  page.on("response", onResponse);
  page.on("requestfinished", onFinished);
  page.on("requestfailed", onFailed);
  return {
    pending: () => live.size,
    async detach() {
      page.off("response", onResponse);
      page.off("requestfinished", onFinished);
      page.off("requestfailed", onFailed);
      await page.unroute("**/api/**", handler).catch(() => {});
    },
  };
}

/** Browser action that may emit a mutation (click, reload). The route barrier covers the emission. */
export async function act(gate, fn) {
  gate.check();
  const value = await fn();
  gate.check();
  return value;
}

/** Waits `ms` while staying responsive to the stop gate (no scenario continues after a signal). */
export async function gatedWait(gate, ms, step = 250) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    gate.check();
    await new Promise((r) => setTimeout(r, Math.min(step, until - Date.now())));
  }
  gate.check();
}

/**
 * Same pattern as the reviewed business harness (copied, not imported, to keep ownership):
 * `mutation(fn)` checks the gate SYNCHRONOUSLY right before calling `fn` (every await that
 * precedes the emission must sit OUTSIDE `fn`) and registers the promise in the drain;
 * `mutatingClick(locator, responsePromise)` does the same for a click that triggers a POST.
 */
export function createMutationGuard(gate) {
  const mutation = (fn) => {
    gate.check();
    return gate.register(fn());
  };
  const mutatingClick = (locator, responsePromise) =>
    mutation(async () => {
      await locator.click();
      return responsePromise;
    });
  return { mutation, mutatingClick };
}
