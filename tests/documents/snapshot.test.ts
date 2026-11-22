import test from "node:test";
import assert from "node:assert/strict";
import { SnapshotError, parseSnapshot } from "../../lib/features/quote-documents/snapshot";
import { documentFileName, formatDate, formatDateTimeUtc, formatEuro, formatTaxRate, issuerFieldLabels, validityLabel } from "../../lib/features/quote-documents/format";
import { validateValidUntil, validityState } from "../../lib/features/quote-documents/validity";
import { sampleSnapshot } from "./harness";

const NBSP = " ";

test("a consistent stored snapshot parses; its arithmetic is re-checked before any rendering", () => {
  const snapshot = parseSnapshot(sampleSnapshot({ lineCount: 2 }));
  assert.equal(snapshot.kind, "quote");
  assert.equal(snapshot.quote.total_cents, snapshot.quote.subtotal_cents + snapshot.quote.tax_cents);
  assert.throws(() => parseSnapshot(sampleSnapshot({ quote: { subtotal_cents: 1 } })), SnapshotError, "tampered subtotal");
  assert.throws(() => parseSnapshot(sampleSnapshot({ quote: { tax_cents: 0 } })), SnapshotError, "tax not derived from rate");
  assert.throws(() => parseSnapshot(sampleSnapshot({ quote: { tax_rate: 7 } })), SnapshotError, "unsupported rate");
  assert.throws(() => parseSnapshot({ ...sampleSnapshot(), issuer: { ...sampleSnapshot().issuer, siret: "123" } }), SnapshotError, "issuer siret must be 14 digits");
  assert.throws(() => parseSnapshot({ ...sampleSnapshot(), issuer: { ...sampleSnapshot().issuer, company_name: "" } }), SnapshotError, "issuer name required");
  assert.throws(() => parseSnapshot({ ...sampleSnapshot(), settlement: "connected" }), SnapshotError, "settlement claim");
  assert.throws(() => parseSnapshot({ ...sampleSnapshot(), quote: { ...sampleSnapshot().quote, lines: [] } }), SnapshotError, "no lines");
});
test("amendment snapshots must carry a coherent cumulative total and matching references", () => {
  assert.equal(parseSnapshot(sampleSnapshot({ kind: "amendment" })).amendment?.version, 3);
  assert.throws(() => parseSnapshot(sampleSnapshot({ kind: "amendment", amendment: { cumulative_total_cents: 100 } })), SnapshotError);
  assert.throws(() => parseSnapshot(sampleSnapshot({ kind: "amendment", amendment: { reference: "AV-9-DEV-100000" } })), SnapshotError);
  assert.throws(() => parseSnapshot(sampleSnapshot({ kind: "amendment", amendment: { total_cents: 14401 } })), SnapshotError);
  assert.throws(() => parseSnapshot({ ...sampleSnapshot({ kind: "amendment" }), amendment: null }), SnapshotError);
  assert.throws(() => parseSnapshot({ ...sampleSnapshot(), amendment: sampleSnapshot({ kind: "amendment" }).amendment }), SnapshotError, "quote kind with an amendment");
});
test("money, rate and dates format deterministically in French without ICU", () => {
  assert.equal(formatEuro(123456), `1${NBSP}234,56${NBSP}€`);
  assert.equal(formatEuro(5), `0,05${NBSP}€`);
  assert.equal(formatEuro(100000000), `1${NBSP}000${NBSP}000,00${NBSP}€`);
  assert.equal(formatTaxRate(5.5), `5,5${NBSP}%`);
  assert.equal(formatTaxRate(20), `20${NBSP}%`);
  assert.equal(formatDate("2026-11-05"), "05/11/2026");
  assert.equal(formatDate(null), "");
  assert.equal(formatDateTimeUtc("2026-10-31T23:59:00-04:00"), `01/11/2026 03:59${NBSP}UTC`);
  assert.equal(formatDateTimeUtc("not a date"), "not a date");
});
test("validity wording never turns an unset validity into an expiry", () => {
  assert.equal(validityLabel(null), "Validité non renseignée par l’émetteur");
  assert.equal(validityLabel({ valid_until: null, validity: "unspecified" }), "Validité non renseignée par l’émetteur");
  assert.equal(validityLabel({ valid_until: "2026-11-15", validity: "valid" }), "Valable jusqu’au 15/11/2026 inclus");
  assert.equal(validityLabel({ valid_until: "2026-10-01", validity: "expired" }), "Validité dépassée depuis le 01/10/2026");
  const now = new Date("2026-10-31T12:00:00Z");
  assert.equal(validityState(null, now), "unspecified");
  assert.equal(validityState("2026-10-31", now), "valid", "inclusive of today");
  assert.equal(validityState("2026-10-30", now), "expired");
  assert.equal(validityState("garbage", now), "unspecified");
  assert.deepEqual(validateValidUntil("", now), { ok: true, value: null });
  assert.deepEqual(validateValidUntil("2026-11-01", now), { ok: true, value: "2026-11-01" });
  assert.equal(validateValidUntil("2026-10-30", now).ok, false);
  assert.equal(validateValidUntil("2026-02-30", now).ok, false);
  assert.equal(validateValidUntil("31/10/2026", now).ok, false);
});
test("attachment names are ASCII-safe and issuer fields are described in user words", () => {
  assert.equal(documentFileName({ kind: "quote", reference: "DEV-ABC123", revision: 2 }), "devis-DEV-ABC123-r2.pdf");
  assert.equal(documentFileName({ kind: "amendment", reference: "AV-1-DEV-ABC123", revision: 1 }), "avenant-AV-1-DEV-ABC123-r1.pdf");
  assert.equal(documentFileName({ kind: "quote", reference: '../"x"/é', revision: 0 }), "devis-x-r1.pdf");
  assert.equal(issuerFieldLabels(["company_name", "siret", "unknown_field"]), "raison sociale, SIRET, unknown_field");
});
