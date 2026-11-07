// PUB-02 live review (9ff9009 + 8a2f9b6): reviewed_estimate_version is the version the user saw,
// re-read right before a NEW request; V1 may omit; V>1 exact or blocked; an unverified read never
// fabricates a version nor shows the static amount as current; a request-key replay keeps its frozen
// version; a 409 after a version change settles the key (re-confirmation = new key); demo unchanged.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadModule } from "../documents/harness";
import type * as Model from "../../components/features/indicative-prices/model";
import type * as Keys from "../../components/app/request-key";

const m = loadModule("components/features/indicative-prices/model.ts") as unknown as typeof Model;
const k = loadModule("components/app/request-key.ts") as unknown as typeof Keys;
const R = { outage: { min_cents: 15000, max_cents: 25000 }, panel: { min_cents: 15000, max_cents: 35000 }, socket: { min_cents: 8000, max_cents: 18000 }, lighting: { min_cents: 8000, max_cents: 20000 }, diagnostic: { min_cents: 12000, max_cents: 28000 } };
const ready = (version: number) => ({ phase: "ready" as const, data: m.parsePrices({ version, currency: "eur", ranges: R, indicative: true, publication_available: false, source: version === 1 ? "existing_baseline" : "operator_version" }) });
const loading = { phase: "loading" as const, data: null };
const error = { phase: "error" as const, data: null };

test("décision de revue : version affichée envoyée ; V1 tolérée ; V>1 jamais non vue ; lecture invérifiable ⇒ aucune version fabriquée", () => {
  assert.equal(JSON.stringify(m.reviewDecision(ready(3), ready(3))), JSON.stringify({ kind: "send", version: 3 }), "V>1: exact version");
  assert.equal(JSON.stringify(m.reviewDecision(ready(1), ready(1))), JSON.stringify({ kind: "send", version: 1 }));
  assert.equal(JSON.stringify(m.reviewDecision(loading, ready(1))), JSON.stringify({ kind: "send", version: 1 }), "V1 may proceed");
  assert.equal(m.reviewDecision(ready(2), ready(3)).kind, "block", "the user saw another version");
  assert.equal(m.reviewDecision(error, ready(3)).kind, "block", "never a version the user did not see");
  assert.equal(JSON.stringify(m.reviewDecision(error, error)), JSON.stringify({ kind: "omit" }), "unverified at V1 ⇒ omit (doc)");
  assert.equal(JSON.stringify(m.reviewDecision(ready(1), error)), JSON.stringify({ kind: "omit" }));
  assert.equal(m.reviewDecision(ready(3), error).kind, "block", "unverified while last seen > 1 ⇒ blocked");
  assert.equal((m.reviewDecision(ready(3), error) as { message: string }).message, m.REVIEW_COPY.blocked);
});

test("rejeu de clé de demande : la charge figée (avec sa version) est renvoyée telle quelle, jamais repatchée", () => {
  const store = new Map<string, string>();
  const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, v: string) => void store.set(key, v), removeItem: (key: string) => void store.delete(key) };
  const base = { category: "panel", description: "Disjoncteur qui saute souvent", address: "3 rue des Ateliers", postal_code: "97200", city: "Fort-de-France", urgency: "scheduled" };
  const first = k.prepareRequestKey(storage, { ...base, reviewed_estimate_version: 2 } as never, () => "f0000000-0000-4000-8000-000000000001")!;
  assert.equal((first.payload as { reviewed_estimate_version?: number }).reviewed_estimate_version, 2);
  const replay = k.prepareRequestKey(storage, { ...base, reviewed_estimate_version: 3 } as never, () => "f0000000-0000-4000-8000-000000000002")!;
  assert.equal(replay.request_id, "f0000000-0000-4000-8000-000000000001", "same key");
  assert.equal((replay.payload as { reviewed_estimate_version?: number }).reviewed_estimate_version, 2, "frozen version kept");
  assert.equal(replay.replayed, true);
});

test("câblage : création = relecture forcée + décision, rejeu sans revue ; 409 + version changée ⇒ clé réglée ; réservations ; démo inchangée", () => {
  const app = readFileSync("components/courant-app.tsx", "utf8");
  const create = app.slice(app.indexOf("async function createIntervention"), app.indexOf("settleRequestKey(getDraftStorage(), prepared.request_id);\n      const replayNote"));
  assert.match(create, /if \(modeRef\.current === "demo"\) \{\s*demoCreate/, "demo unchanged (returns before any read)");
  assert.match(create, /pendingReplay = Boolean\(storage && readRequestKey\(storage\.getItem\(REQUEST_KEY_STORAGE\)\)\);/);
  assert.match(create, /if \(!pendingReplay\) \{\s*const shown = getPricesState\(\);\s*await loadPrices\(undefined, true\);\s*const decision = reviewDecision\(shown, getPricesState\(\)\);/);
  assert.match(create, /if \(decision\.kind === "send"\) reviewed = \{ \.\.\.values, reviewed_estimate_version: decision\.version \} as RequestValues;/);
  assert.match(create, /const prepared = prepareRequestKey\(getDraftStorage\(\), reviewed\);/);
  assert.match(create, /if \(now\.phase === "ready" && now\.data && now\.data\.version !== sent\) \{\s*settleRequestKey\(getDraftStorage\(\), prepared\.request_id\);\s*throw new Error\(REVIEW_COPY\.conflict\);/);
  const booking = app.slice(app.indexOf("async function confirmBooking"), app.indexOf('result = await api<BookingReceipt'));
  assert.match(booking, /if \(demo\) \{[\s\S]*?return;\s*\}\s*\/\/ PUB-02/, "demo booking unchanged");
  assert.match(booking, /if \(!current\.request_id\) \{\s*const shown = getPricesState\(\);\s*await loadPrices\(undefined, true\);/, "only a NEW booking is reviewed");
  assert.match(booking, /return v !== undefined \? \{ reviewed_estimate_version: v \} : \{\};/);
  const forms = readFileSync("components/app/forms.tsx", "utf8");
  assert.match(forms, /\{mode === "demo" \? \(\s*<strong>\s*\{money\(c\.min\)\} – \{money\(c\.max\)\}\s*<\/strong>\s*\) : \(\s*<ReviewEstimate category=\{values\.category\} \/>\s*\)\}/);
  assert.equal(m.REVIEW_COPY.unverified, "estimation non vérifiée");
});
