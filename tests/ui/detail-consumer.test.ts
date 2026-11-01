import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { ApiRequestError } from "../../components/app/api";
import { chronologicalMessages, readDetail } from "../../components/app/detail-read-client";
import { DetailCache } from "../../components/app/detail-cache";
import { validateWorkspace } from "../../components/app/workspace-reader";
import { detailReadSchema, type DetailRead } from "../../lib/features/workspace/detail-read";
import { JOB, ORG, SITE, USER, id, job, org, quote, site, stamp } from "../detail-read-fixtures";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");

function envelope(patch: Partial<Record<keyof DetailRead, unknown>> = {}): DetailRead {
  const raw = {
    intervention: job({ site_id: SITE }),
    site: { status: "ok", value: site },
    organization: { status: "ok", value: org },
    quotes: { status: "ok", items: [quote(1, { status: "sent" })], limited: false },
    messages: {
      status: "ok",
      items: [
        { id: id(301), intervention_id: JOB, author_id: USER, body: "Deuxième", created_at: "2026-10-31T12:00:00.000Z" },
        { id: id(300), intervention_id: JOB, author_id: USER, body: "Premier", created_at: "2026-10-31T11:00:00.000Z" },
      ],
      limited: false,
    },
    documents: { status: "ok", items: [], limited: false },
    appointments: { status: "ok", items: [], limited: false },
    payments: { status: "ok", items: [], limited: false, incomplete: false },
    generated_at: stamp,
    ...patch,
  };
  return detailReadSchema.parse(raw);
}

// ---------- client ----------
test("readDetail: non-UUID ⇒ not_found WITHOUT any request", async () => {
  let calls = 0;
  const out = await readDetail(async () => {
    calls += 1;
    return {};
  }, "not-a-uuid");
  assert.deepEqual(out, { kind: "not_found" });
  assert.equal(calls, 0);
});

test("readDetail: 200 valid ⇒ loaded (validated by the route schema); exact path", async () => {
  let seen = "";
  const out = await readDetail(async (p) => {
    seen = p;
    return envelope();
  }, JOB);
  assert.equal(seen, `/api/interventions/${JOB}`);
  assert.equal(out.kind, "loaded");
});

test("readDetail: malformed 200 or another dossier's id ⇒ failed 502, never not_found", async () => {
  assert.deepEqual(await readDetail(async () => ({ intervention: {} }), JOB), { kind: "failed", status: 502, retryAfterS: 2 });
  const other = envelope({ intervention: job({ id: id(9), site_id: SITE }) });
  assert.deepEqual(await readDetail(async () => other, JOB), { kind: "failed", status: 502, retryAfterS: 2 });
});

test("readDetail: 404 ⇒ not_found; 401 ⇒ signed_out; 503 honours retry_after_s; transport ⇒ failed 0", async () => {
  const fail = (e: unknown) => async () => {
    throw e;
  };
  assert.deepEqual(await readDetail(fail(new ApiRequestError(404, "x", { json: true })), JOB), { kind: "not_found" });
  assert.deepEqual(await readDetail(fail(new ApiRequestError(401, "x")), JOB), { kind: "signed_out" });
  assert.deepEqual(await readDetail(fail(new ApiRequestError(503, "x", { retry_after_s: 7 })), JOB), { kind: "failed", status: 503, retryAfterS: 7 });
  assert.deepEqual(await readDetail(fail(new ApiRequestError(503, "x")), JOB), { kind: "failed", status: 503, retryAfterS: 2 });
  assert.deepEqual(await readDetail(fail(new ApiRequestError(0, "réseau")), JOB), { kind: "failed", status: 0, retryAfterS: 2 });
  assert.deepEqual(await readDetail(fail(new TypeError("boom")), JOB), { kind: "failed", status: 0, retryAfterS: 2 });
});

test("messages are shown oldest first (the route returns newest first)", () => {
  assert.deepEqual(chronologicalMessages(envelope()).map((m) => m.body), ["Premier", "Deuxième"]);
  assert.deepEqual(chronologicalMessages(envelope({ messages: { status: "error" } })), []);
});

// ---------- cache ----------
test("cache: bounded 20, true LRU (read promotes), TTL 60 s, cleared on context change", () => {
  let now = 0;
  const c = new DetailCache(20, 60_000, () => now);
  c.useContext("g1|client||");
  const d = envelope();
  for (let n = 0; n < 20; n++) c.set(id(1000 + n), d);
  assert.ok(c.get(id(1000)), "read promotes the oldest");
  c.set(id(2000), d);
  assert.equal(c.size, 20);
  assert.equal(c.get(id(1001)), undefined, "least recently used evicted");
  assert.ok(c.get(id(1000)));
  now = 60_001;
  assert.equal(c.get(id(1000)), undefined, "expired after the TTL");
  c.set(id(3000), d);
  c.useContext("g1|manager|org|site");
  assert.equal(c.size, 0, "another identity/role/org/site never sees cached dossiers");
});

// ---------- workspace limits ----------
test("workspace reader: optional limits accepted when exact, malformed limits invalidate the reply", () => {
  const base = {
    profile: { id: USER, role: "client" },
    interventions: [{ id: JOB, status: "assigned" }],
    quotes: [],
    sites: [],
    organizations: [],
    messages: [],
    documents: [],
    reviews: [],
    payments: [],
    organization_members: [],
    artisan_profile: null,
    appointments: [],
  };
  const limits = {
    interventions: { limit: 100, limited: true },
    quotes: { limit: 200, limited: false },
    sites: { limit: 100, limited: false },
    organizations: { limit: 50, limited: false },
  };
  assert.equal(validateWorkspace(base).ok, true, "older backend without limits");
  assert.equal(validateWorkspace({ ...base, limits }).ok, true);
  assert.equal(validateWorkspace({ ...base, limits: { ...limits, interventions: { limit: 100 } } }).ok, false);
  assert.equal(validateWorkspace({ ...base, limits: { ...limits, interventions: { limit: 99, limited: true } } }).ok, false);
});

// ---------- read-only view (SSR of the real component) ----------
async function compileView() {
  const result = await build({
    absWorkingDir: ROOT,
    stdin: { contents: 'export { DetailReadView, PointReadState } from "./components/role/detail-read-view";', resolveDir: ROOT, loader: "ts" },
    bundle: true,
    write: false,
    format: "cjs",
    platform: "node",
    jsx: "automatic",
    external: ["react", "react/jsx-runtime", "react-dom", "zod"],
    loader: { ".css": "empty" },
  });
  const mod = { exports: {} as Record<string, unknown> };
  vm.runInThisContext(`(function(module, exports, require){${result.outputFiles[0].text}\n})`)(mod, mod.exports, require);
  return mod.exports as { DetailReadView: (p: unknown) => unknown; PointReadState: (p: unknown) => unknown };
}

test("read-only view: honest linked-item states, partial lists, perimeter note, no « introuvable »", async () => {
  const { DetailReadView } = await compileView();
  const React = require("react");
  const { renderToString } = require("react-dom/server");
  const detail = envelope({
    site: { status: "hidden" },
    organization: { status: "hidden" },
    quotes: { status: "ok", items: [quote(1, { status: "sent" })], limited: true },
    payments: { status: "ok", items: [], limited: false, incomplete: true },
    documents: { status: "error" },
  });
  const html: string = renderToString(React.createElement(DetailReadView, { detail, backLabel: "Mes demandes", onBack: () => {}, outsideActivePerimeter: true }));
  assert.match(html, /lecture seule/);
  assert.match(html, /Non accessible avec vos droits/);
  assert.match(html, /Liste partielle/);
  assert.match(html, /Indisponible pour le moment/);
  assert.match(html, /autre site que le site actif/);
  assert.doesNotMatch(html, /introuvable/i);
  assert.doesNotMatch(html, new RegExp(ORG), "no raw ids shown");
});

test("point-read error: retry disabled while Retry-After runs, enabled after; never « introuvable »", async () => {
  const { PointReadState } = await compileView();
  const React = require("react");
  const { renderToString } = require("react-dom/server");
  const waiting: string = renderToString(React.createElement(PointReadState, { presence: { decision: "detail_error", retry: () => {}, retryInS: 2 }, backLabel: "x", onBack: () => {} }));
  assert.match(waiting, /Nouvel essai possible dans 2 s/);
  assert.doesNotMatch(waiting, /Réessayer/);
  const ready: string = renderToString(React.createElement(PointReadState, { presence: { decision: "detail_error", retry: () => {}, retryInS: 0 }, backLabel: "x", onBack: () => {} }));
  assert.match(ready, /Réessayer/);
  assert.doesNotMatch(ready + waiting, /introuvable/i);
  const none: unknown = renderToString(React.createElement(PointReadState, { presence: { decision: "not_found", retry: () => {} }, backLabel: "x", onBack: () => {} }));
  assert.equal(none, "");
});
