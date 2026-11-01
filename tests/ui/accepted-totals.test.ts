// FASTSPLIT-ACCEPTED-TOTALS-001: commitment = base + accepted amendments (server accepted_total_cents).
// Base fallback ONLY when the field is absent; a present malformed value is rejected upstream.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateWorkspace } from "../../components/app/workspace-reader";
import { acceptedCommittedCents, dashboardFigures, siteBudgetBars } from "../../components/role/enterprise-lists";

// Every required collection (COLLECTIONS in workspace-reader.ts) so the quotes check is really reached.
const ws = (quotes: unknown[]) => ({ profile: { id: "u1", role: "manager" }, interventions: [], sites: [], organizations: [], messages: [], documents: [], reviews: [], payments: [], organization_members: [], appointments: [], quotes, artisan_profile: null });
const q = (over: Record<string, unknown> = {}) => ({ id: "q1", intervention_id: "i1", status: "accepted", total_cents: 12000, lines: [], ...over });

test("validateWorkspace: accepted_total_cents absent OK (legacy/demo); present must be a safe non-negative integer", () => {
  assert.deepEqual(validateWorkspace(ws([q()])).ok, true, "absent field: accepted (legacy/demo)");
  const okRes = validateWorkspace(ws([q({ accepted_total_cents: 15000 })]));
  assert.equal(okRes.ok, true, "15000 over a 12000 base: accepted");
  if (okRes.ok) {
    const quote = okRes.workspace.quotes[0];
    assert.equal(quote.total_cents, 12000, "base unchanged");
    assert.equal(quote.accepted_total_cents, 15000);
  }
  assert.equal(validateWorkspace(ws([q({ accepted_total_cents: 12000 })])).ok, true, "no amendment: equal to the base");
  for (const bad of [0, 100, 11999, null, "15000", -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN])
    assert.deepEqual(validateWorkspace(ws([q({ accepted_total_cents: bad })])), { ok: false, reason: "quotes" }, `accepted ${String(bad)}`);
  for (const badBase of [0, -5, 1.5, "12000"])
    assert.deepEqual(validateWorkspace(ws([q({ total_cents: badBase, accepted_total_cents: 15000 })])), { ok: false, reason: "quotes" }, `base ${String(badBase)}`);
});

test("helper: server total when present (incl. 0 amendments = base), base only when absent; never a max/clamp", () => {
  assert.equal(acceptedCommittedCents({ total_cents: 12000, accepted_total_cents: 15000 }), 15000);
  assert.equal(acceptedCommittedCents({ total_cents: 12000, accepted_total_cents: 12000 }), 12000);
  assert.equal(acceptedCommittedCents({ total_cents: 12000 }), 12000);
  const src = readFileSync("components/role/enterprise-lists.ts", "utf8");
  const fn = src.slice(src.indexOf("export function acceptedCommittedCents"), src.indexOf("export type InterventionFilters"));
  assert.doesNotMatch(fn, /Math\.max|Math\.min/);
});

test("12000 + 3000 accepted amendment, paid 15000 ⇒ commitment 15000, « engagé non réglé » 0 (not −3000)", () => {
  const quotes = [{ intervention_id: "i1", status: "accepted" as const, total_cents: 12000, accepted_total_cents: 15000 }];
  const bars = siteBudgetBars([{ id: "s1", name: "Site", budget_cents: 20000 } as never], [{ id: "i1", site_id: "s1" } as never], quotes as never);
  assert.equal(JSON.stringify(bars).includes("15000"), true, "site bar uses the accepted total");
  const fig = dashboardFigures("available", { interventions: [], compliance: [], approvals: [], quotes }, "2026-11-01", () => true);
  assert.equal(fig.committedCents, 15000);
});

test("enterprise-space: siteFigures and « Montant à régler » use the accepted total; « payé » stays the real payment", () => {
  const src = readFileSync("components/role/enterprise-space.tsx", "utf8");
  assert.match(src, /const committed = sum\(accepted\.map\(\(q\) => acceptedCommittedCents\(q\)\)\);/);
  assert.match(src, /<span>Montant à régler<\/span>\s*<strong>\{money\(acceptedCommittedCents\(acceptedQuote\)\)\}<\/strong>/);
  assert.match(src, /const paid = sum\(paidRows\.map\(\(p\) => p\.total_cents\)\);/);
  assert.match(src, /remaining: budget - committed/);
});
