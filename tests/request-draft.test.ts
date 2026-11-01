import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { PUBLIC_DRAFT_KEY, PUBLIC_DRAFT_TTL_MS, parsePublicDraftValues, readPublicDraft, savePublicDraft, clearPublicDraft } from "../lib/shared/request-draft";
const now = 2_000_000_000_000;
const input = { category: "panel", description: "Notes encore incomplètes", address: "", postal_code: "97", city: "", urgency: "scheduled" };
const envelope = (values: unknown = input, savedAt = now) => JSON.stringify({ savedAt, values });
function storage(initial: string | null = null) {
  let value = initial, fail = false, writes = 0, removes = 0;
  return { getItem: (key: string) => { assert.equal(key, PUBLIC_DRAFT_KEY); return value; }, setItem: (key: string, next: string) => { assert.equal(key, PUBLIC_DRAFT_KEY); writes++; if (fail) throw Error("QuotaExceededError"); value = next; }, removeItem: (key: string) => { assert.equal(key, PUBLIC_DRAFT_KEY); removes++; if (fail) throw Error("SecurityError"); value = null; }, fail: () => { fail = true; }, current: () => value, writes: () => writes, removes: () => removes };
}
test("canonical draft accepts incomplete text and normalizes omitted text without relaxing category/urgency", () => {
  assert.equal(PUBLIC_DRAFT_KEY, "courant-request-draft"); assert.equal(PUBLIC_DRAFT_TTL_MS, 1800000);
  assert.deepEqual(readPublicDraft(envelope(), now), { savedAt: now, values: input });
  assert.deepEqual(parsePublicDraftValues({ category: "diagnostic" }), { category: "diagnostic", description: "", address: "", postal_code: "", city: "", urgency: "scheduled" });
  for (const category of ["outage", "panel", "socket", "lighting", "diagnostic"]) assert.ok(parsePublicDraftValues({ category }));
  assert.ok(readPublicDraft(envelope({ ...input, description: "", site_id: "" }), now));
  assert.ok(readPublicDraft(envelope({ ...input, site_id: "10000000-0000-4000-8000-000000000001" }), now));
});
test("strict envelope and field bounds refuse malformed, unknown, oversized and dangerous structures", () => {
  for (const values of [null, [], {}, { ...input, category: "plumbing" }, { ...input, urgency: "later" }, { ...input, site_id: "foreign-id" }, { ...input, site_id: null }, { ...input, description: 12 }, { ...input, description: "x".repeat(4001) }, { ...input, address: "x".repeat(501) }, { ...input, postal_code: "x".repeat(21) }, { ...input, city: "x".repeat(121) }, { ...input, photos: ["private"] }, { ...input, client_id: "other" }]) assert.equal(readPublicDraft(envelope(values), now), null);
  for (const raw of [null, {}, "", "{broken", "[]", "null", JSON.stringify({ savedAt: now, values: input, user: "private" }), JSON.stringify({ savedAt: String(now), values: input }), JSON.stringify({ savedAt: now }), '{"savedAt":2000000000000,"values":{"category":"panel","__proto__":{"admin":true}}}', " ".repeat(32769)]) assert.equal(readPublicDraft(raw, now), null);
  assert.equal(readPublicDraft(envelope(), Infinity), null);
});
test("TTL is30minutes in this tab, with at most30seconds clock skew into the future", () => {
  assert.ok(readPublicDraft(envelope(input, now - PUBLIC_DRAFT_TTL_MS + 1), now));
  assert.equal(readPublicDraft(envelope(input, now - PUBLIC_DRAFT_TTL_MS), now), null);
  assert.ok(readPublicDraft(envelope(input, now + 30000), now));
  assert.equal(readPublicDraft(envelope(input, now + 30001), now), null);
  assert.equal(readPublicDraft(envelope(input, -1), now), null);
});
test("save is explicit, bounded and preserves the old draft on quota/refusal; clear requires success", () => {
  const old = envelope({ ...input, description: "Précédent" }), s = storage(old);
  s.fail(); assert.deepEqual(savePublicDraft(s, input, now), { ok: false, reason: "unavailable" }); assert.equal(s.current(), old); assert.equal(s.removes(), 0);
  assert.equal(clearPublicDraft(s), false); assert.equal(s.current(), old);
  const fresh = storage(); assert.equal(savePublicDraft(fresh, input, now).ok, true); assert.deepEqual(readPublicDraft(fresh.current(), now)?.values, input); assert.equal(fresh.writes(), 1); assert.equal(clearPublicDraft(fresh), true); assert.equal(fresh.current(), null);
  assert.equal(savePublicDraft(null, input, now).ok, false); assert.equal(clearPublicDraft(undefined), false);
  const bad = storage(old); assert.deepEqual(savePublicDraft(bad, { ...input, photos: [] }, now), { ok: false, reason: "invalid" }); assert.equal(bad.writes(), 0); assert.equal(bad.current(), old);
  const escaped = storage(); assert.equal(savePublicDraft(escaped, { ...input, description: "\n".repeat(4000) }, now).ok, true); assert.ok(readPublicDraft(escaped.current(), now));
});

const script = readFileSync(new URL("../public/offline-request.js", import.meta.url), "utf8").replace(/^export /gm, "");
function offlineDom(options: { initial?: string | null; quota?: boolean; storageDenied?: boolean; online?: boolean; pathname?: string; loading?: boolean } = {}) {
  const s = storage(options.initial ?? null); if (options.quota) s.fail();
  type Listener = (event: { preventDefault(): void }) => void;
  const listeners = new Map<string, Listener>(), windowEvents = new Map<string, () => void>(), docEvents = new Map<string, () => void>();
  const controls = Object.fromEntries(Object.entries(input).map(([key, value]) => [key, { value }]));
  let reset = 0, requests = 0, submits = 0;
  class Form {
    elements = { namedItem: (name: string) => controls[name] };
    addEventListener(name: string, cb: Listener) { listeners.set(`form:${name}`, cb); }
    reset() { reset++; }
  }
  class Data {
    has(name: string) { return Object.hasOwn(controls, name); }
    get(name: string) { return controls[name]?.value; }
  }
  const form = new Form(), status = { textContent: "not initialized" }, attributes: Record<string, string> = {};
  const clear = { addEventListener: (name: string, cb: Listener) => listeners.set(`clear:${name}`, cb) };
  const resume = { addEventListener: (name: string, cb: Listener) => listeners.set(`resume:${name}`, cb), setAttribute: (name: string, value: string) => { attributes[name] = value; } };
  const win = { location: { pathname: options.pathname ?? "/offline-request.html" }, addEventListener: (name: string, cb: () => void) => windowEvents.set(name, cb) };
  Object.defineProperty(win, "sessionStorage", { get: () => { if (options.storageDenied) throw Error("Storage refused"); return s; } });
  runInNewContext(script, { window: win, document: { readyState: options.loading ? "loading" : "complete", getElementById: (id: string) => ({ "offline-request-form": form, "offline-status": status, "offline-clear": clear, "offline-resume": resume })[id], addEventListener: (name: string, cb: () => void) => docEvents.set(name, cb) }, navigator: { onLine: options.online ?? false }, HTMLFormElement: Form, FormData: Data, Date: { now: () => now }, fetch: () => { requests++; throw Error("No network allowed"); } });
  const emit = (key: string) => { let prevented = 0; if (key === "form:submit") submits++; listeners.get(key)?.({ preventDefault: () => { prevented++; } }); return prevented; };
  return { s, status, controls, attributes, windowEvents, docEvents, emit, requests: () => requests, submits: () => submits, reset: () => reset, listenerCount: () => listeners.size };
}
test("offline page restores only fresh drafts, saves only on explicit submit and never auto-submits when network returns", () => {
  const h = offlineDom({ initial: envelope({ ...input, description: "Notes précédentes" }) });
  assert.equal(h.controls.description.value, "Notes précédentes"); assert.match(h.status.textContent, /retrouvé/); assert.equal(h.s.writes(), 0); assert.equal(h.attributes["aria-disabled"], "true");
  h.controls.description.value = "Nouvelles notes"; assert.equal(h.s.writes(), 0); assert.equal(h.emit("form:submit"), 1); assert.match(h.status.textContent, /Aucune demande envoyée/); assert.equal(readPublicDraft(h.s.current(), now)?.values.description, "Nouvelles notes");
  h.windowEvents.get("online")!(); assert.equal(h.s.writes(), 1); assert.equal(h.submits(), 1); assert.equal(h.requests(), 0);
  assert.equal(h.emit("resume:click"), 1); assert.equal(h.requests(), 0);
  h.emit("clear:click"); assert.equal(h.s.current(), null); assert.equal(h.reset(), 1);
});
test("quota or denied storage warns clearly, keeps old draft and new typed values, and refuses false clear success", () => {
  const old = envelope({ ...input, description: "Ancien" });
  const h = offlineDom({ initial: old, quota: true }); h.controls.description.value = "Nouveau"; h.emit("form:submit");
  assert.equal(h.s.current(), old); assert.equal(h.controls.description.value, "Nouveau"); assert.match(h.status.textContent, /précédent est conservé/); assert.equal(h.reset(), 0); h.emit("clear:click"); assert.match(h.status.textContent, /Effacement impossible/); assert.equal(h.reset(), 0);
  const denied = offlineDom({ storageDenied: true }); assert.match(denied.status.textContent, /indisponible/); denied.emit("form:submit"); assert.match(denied.status.textContent, /Enregistrement impossible/); assert.equal(denied.requests(), 0);
});
test("expired/malformed drafts never hydrate controls and online bundle import never attaches offline UI behaviour", () => {
  for (const initial of [envelope(input, now - PUBLIC_DRAFT_TTL_MS), "{broken", envelope({ ...input, private: "never" })]) {
    const h = offlineDom({ initial }); assert.match(h.status.textContent, /Aucun brouillon local valide/); assert.equal(h.s.writes(), 0);
  }
  const online = offlineDom({ pathname: "/" }); assert.equal(online.listenerCount(), 0); assert.equal(online.windowEvents.size, 0); assert.equal(online.status.textContent, "not initialized");
  const loading = offlineDom({ loading: true }); assert.equal(loading.listenerCount(), 0); loading.docEvents.get("DOMContentLoaded")!(); assert.ok(loading.listenerCount() > 0);
});
