// Card-hold return / pending attempt: dedicated state independent of the draft, cleared only on
// « confirmed » / « cancelled », identity-bound, never a financial success from the URL.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { ApiRequestError } from "../../components/app/api";
import { CARD_RETURN_COPY, cancelCardReturn, parsePending, sameReturn, verifyCardReturn } from "../../components/app/card-return";

const ID = "11111111-1111-4111-8111-111111111111";
const fail = (status: number) => async () => { throw new ApiRequestError(status, "x"); };

test("verify: only « confirmed » + id is success; 503/409/malformed keep the return with an honest message", async () => {
  assert.deepEqual(await verifyCardReturn((async () => ({ status: "confirmed", intervention: { id: "job-1" } })) as never, ID), { ok: true, interventionId: "job-1" });
  assert.deepEqual(await verifyCardReturn(fail(503) as never, ID), { ok: false, message: CARD_RETURN_COPY.failed });
  assert.deepEqual(await verifyCardReturn(fail(409) as never, ID), { ok: false, message: CARD_RETURN_COPY.conflict });
  assert.deepEqual(await verifyCardReturn((async () => ({ status: "authorized" })) as never, ID), { ok: false, message: CARD_RETURN_COPY.failed });
});

test("cancel: only « cancelled » ends it; pending lookup: error is never « nothing pending »", async () => {
  assert.deepEqual(await cancelCardReturn((async () => ({ status: "cancelled" })) as never, ID), { ok: true });
  assert.equal((await cancelCardReturn((async () => ({ status: "cancelling" })) as never, ID)).ok, false);
  assert.equal((await cancelCardReturn(fail(503) as never, ID)).ok, false);
  assert.deepEqual(parsePending({ pending: null }), { ok: true, pending: null });
  assert.equal(parsePending({}).ok, false);
  assert.equal(parsePending({ pending: { request_id: ID, method: "card_hold", status: "paid", expected_max_cents: 1, created_at: "x" } }).ok, false);
  const ok = parsePending({ pending: { request_id: ID, method: "card_hold", status: "checkout_open", expected_max_cents: 25000, created_at: "2026-11-01T12:00:00Z", stripe_session_id: "cs_x" } });
  assert.ok(ok.ok && ok.pending && !("stripe_session_id" in ok.pending), "no provider id kept");
});

test("identity binding: a reply applies only to the same request AND the same UID", () => {
  const r = { requestId: ID, userId: "u1", phase: "checking" as const, message: "" };
  assert.equal(sameReturn(r, ID, "u1"), true);
  assert.equal(sameReturn(r, ID, "u2"), false);
  assert.equal(sameReturn(r, ID, null), false);
  assert.equal(sameReturn(null, ID, "u1"), false);
});

test("controller: URL cancel claims nothing financial; return kept without draft; cleared only on confirmed/cancelled; UID reset clears", () => {
  const src = readFileSync("components/courant-app.tsx", "utf8");
  const effect = src.slice(src.indexOf('if (returnContext.kind === "booking")'), src.indexOf('if (returnContext.kind === "auth")'));
  assert.doesNotMatch(effect, /débit|aucune empreinte|rien n’a été débité|confirm(é|ée)/i, "no financial claim from the URL");
  assert.match(effect, /message: back\.state === "success" \? CARD_RETURN_COPY\.checking : CARD_RETURN_COPY\.interrupted/);
  assert.doesNotMatch(effect, /pendingDraft/, "the return does not depend on a draft");
  const verify = src.slice(src.indexOf("async function verifyCardHoldReturn("), src.indexOf("async function checkPendingCardHold("));
  assert.ok(verify.indexOf("if (!result.ok)") < verify.indexOf("setCardReturn((c) => (c?.requestId === requestId ? null : c));"), "cleared only after success");
  assert.match(verify, /if \(!still\(\)\) return false;/);
  const cancel = src.slice(src.indexOf("async function cancelBooking("), src.indexOf("async function createIntervention("));
  assert.ok(cancel.indexOf("if (!result.ok)") < cancel.indexOf("setCardReturn((c) => (c?.requestId === requestId ? null : c));"));
  assert.match(src, /setCardReturn\(null\);\s*setPendingLookup\("idle"\);\s*pendingCheckedFor\.current = null;/, "identity reset clears");
  const pending = src.slice(src.indexOf("async function checkPendingCardHold("), src.indexOf("async function finalizeBooking("));
  assert.match(pending, /if \(userId\.current !== me\) return;/);
  assert.match(pending, /if \(!r\.ok\) \{\s*setPendingLookup\("error"\);/);
});

// ---- One real mount (single-process Chromium, fake API, no network) ----------------------------
const PW = process.env.QA_PLAYWRIGHT_PATH || "/Users/claudebrafa/rea/node_modules/playwright-core";
const CHROMIUM = process.env.QA_CHROMIUM_PATH || path.join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell");
const available = existsSync(path.join(PW, "index.mjs")) && existsSync(CHROMIUM);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const APP = `
import { createElement as h, useState } from "react";
import { createRoot } from "react-dom/client";
import { CardReturnPanel } from "./components/role/card-return-panel";
import { CARD_RETURN_COPY, verifyCardReturn } from "./components/app/card-return";
import { ApiRequestError } from "./components/app/api";
const ID = "${ID}";
window.calls = 0;
const api = async () => { window.calls += 1; if (window.calls === 1) throw new ApiRequestError(503, "busy"); return { status: "confirmed", intervention: { id: "job-1" } }; };
function Harness() {
  // Return read from ?booking_return=success WITHOUT any booking draft in this tab.
  const [ret, setRet] = useState({ requestId: ID, userId: "u1", phase: "needs_action", message: CARD_RETURN_COPY.interrupted });
  const [done, setDone] = useState("");
  const verify = async (id) => {
    setRet((r) => ({ ...r, phase: "checking", message: CARD_RETURN_COPY.checking }));
    const res = await verifyCardReturn(api, id);
    if (res.ok) { setRet(null); setDone(res.interventionId); } else setRet((r) => ({ ...r, phase: "needs_action", message: res.message }));
  };
  return h("div", null, h(CardReturnPanel, { cardReturn: ret, pendingLookupFailed: false, busy: false, onVerify: verify, onCancel() {}, onRetryLookup() {} }), done && h("p", { id: "done" }, done));
}
createRoot(document.getElementById("app")).render(h(Harness));
`;
test("mounted: return without draft → verify 503 (kept, honest) → retry 201 (cleared); URL cancel text has no financial success", { skip: available ? false : "local Playwright/Chromium not found (SKIPPED, never PASS)" }, async () => {
  const out = await build({ absWorkingDir: ROOT, stdin: { contents: APP, resolveDir: ROOT, loader: "tsx" }, bundle: true, write: false, outdir: "out", platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' }, logLevel: "error" });
  const js = out.outputFiles.find((f) => f.path.endsWith(".js"))!.text;
  const server = createServer((_q, r) => { r.setHeader("content-type", "text/html"); r.end(`<!doctype html><div id="app"></div><script>${js}</script>`); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    const page = await browser.newPage();
    const requests: string[] = [];
    page.on("request", (rq: { url(): string }) => requests.push(rq.url()));
    await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}/`);
    await page.locator("[data-card-return]").waitFor();
    const before = await page.locator("[data-card-return]").innerText();
    assert.doesNotMatch(before, /confirmée|aucun débit|empreinte enregistrée/i, "URL return: no financial success shown");
    await page.click("[data-card-verify]");
    await page.waitForFunction(() => (window as unknown as { calls: number }).calls === 1);
    await page.locator('[data-card-return="needs_action"]').waitFor();
    assert.match(await page.locator("[data-card-return]").innerText(), /n’a pas abouti/);
    await page.click("[data-card-verify]");
    await page.locator("#done").waitFor();
    assert.equal(await page.locator("#done").innerText(), "job-1");
    assert.equal(await page.locator("[data-card-return]").count(), 0, "cleared only after 201 confirmed");
    assert.deepEqual(requests.filter((u) => !u.startsWith("http://127.0.0.1")), [], "no network beyond the local page");
  } finally {
    await browser.close();
    server.close();
  }
});
