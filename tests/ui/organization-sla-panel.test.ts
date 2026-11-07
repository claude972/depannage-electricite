// ENT-11 consolidated SLA UI. Replies are produced by ROOT's real server builder
// (lib/features/organization-sla/report.ts) from snapshot fixtures, then read by the real UI model
// and rendered by the real panel. Contract: /tmp/depannage-organization-sla-contract.json.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { buildOrganizationSla } from "../../lib/features/organization-sla/report";
import * as m from "../../components/features/organization-sla/organization-sla-model";
import { loadModule } from "../documents/harness";

const panel = loadModule("components/features/organization-sla/organization-sla-panel.tsx") as Record<string, any>;
const org = "10000000-0000-4000-8000-000000000001", site = "20000000-0000-4000-8000-000000000001", policy = "30000000-0000-4000-8000-000000000001", cal = "40000000-0000-4000-8000-000000000001", caseId = "50000000-0000-4000-8000-000000000001", now = "2026-11-06T10:00:00.000Z";
function seed() {
  return {
    organization_id: org, captured_at: now, organization_wide: true, visible_sites_total: 1, remaining_sites_total: 1, calendars_total: 1,
    calendars: [{ id: cal, organization_id: org, timezone: "UTC", windows: [{ weekday: 5, start: "00:00", end: "23:59" }], closed_dates: [] as string[] }],
    sites: [{ id: site, organization_id: org, name: "Site QA", cases_total: 1,
      policies: [{ id: policy, site_id: site, calendar_id: cal as string | null, response_target_minutes: 60, resolution_target_minutes: 240, status: "active" as const }],
      cases: [{ id: caseId, site_id: site, policy_id: policy, opened_at: "2026-11-06T09:00:00Z", responded_at: "2026-11-06T09:30:00Z", resolved_at: null, pauses_total: 0, pauses: [] }] }],
  };
}
const reply = (x = seed(), after: string | null = null) => JSON.parse(JSON.stringify(buildOrganizationSla(x, org, after)));
const ctx = { generation: () => 1, userId: () => "u" };
const render = (view: unknown) => renderToString(createElement(panel.OrganizationSlaPanel, { organizationId: org, context: ctx, initial: view, api: { get: async () => ({ status: 503, body: null }) } }));

test("real server reply parses; organisation-wide only when complete_for_organization", () => {
  const r = m.parseOrgSla(reply(), org)!;
  assert.ok(r);
  assert.equal(m.summaryScope(r), "Toute l’organisation");
  const html = render({ phase: "ready", report: r, cursor: null, pageIndex: 0 });
  assert.match(html, /data-org-sla-scope="organization"/);
  assert.match(html, /Site QA/);
  assert.match(html, /cas en cours/);
});

test("selected-site scope is labelled visible sites, never the whole organisation", () => {
  const x = seed();
  x.organization_wide = false;
  const r = m.parseOrgSla(reply(x), org)!;
  assert.match(m.summaryScope(r), /visibles avec vos droits \(pas toute l’organisation\)/);
  assert.match(render({ phase: "ready", report: r, cursor: null, pageIndex: 0 }), /data-org-sla-scope="visible"/);
});

test("paged report: page-only summary, next action, reasons listed, no cross-page total", () => {
  const x = seed();
  x.visible_sites_total = 21;
  x.remaining_sites_total = 21;
  x.sites = Array.from({ length: 20 }, (_, n) => ({ ...x.sites[0], id: `20000000-0000-4000-8000-${String(n + 1).padStart(12, "0")}`, name: `Site ${n + 1}`, cases: [], cases_total: 0, policies: [] }));
  const r = m.parseOrgSla(reply(x), org)!;
  assert.equal(r.page.has_more, true);
  assert.match(m.summaryScope(r), /^Cette page seulement : 20 sites sur 21 visibles — résumé partiel$/);
  const html = render({ phase: "ready", report: r, cursor: null, pageIndex: 0 });
  assert.match(html, /data-org-sla-scope="page"/);
  assert.match(html.replace(/<!-- -->/g, ""), /Sites suivants \(1 restants\)/);
  assert.match(html, /les chiffres de pages différentes ne s’additionnent pas/);
  assert.match(html, /plus de 20 sites/);
});

test("missing calendar dependency: partial with an honest reason, never a zero alert", () => {
  const x = seed();
  x.calendars = [];
  x.calendars_total = 0;
  const r = m.parseOrgSla(reply(x), org)!;
  assert.equal(r.state, "partial");
  const f = m.siteFigures(r.sites[0]);
  assert.equal(JSON.stringify(f), JSON.stringify({ evaluated: 0, breached: 0, pending: 0, met: 0, other: 0, unavailable: 1, notReturned: 0 }));
  assert.match(render({ phase: "ready", report: r, cursor: null, pageIndex: 0 }), /calendrier référencé non chargé/);
});

test("off-contract replies are errors, never an empty or whole report", () => {
  const ok = reply();
  const bad = [
    null,
    { ...ok, organization_id: site },
    { ...ok, complete_for_organization: true, scope: { ...ok.scope, organization_wide: false, kind: "visible_sites" } },
    { ...ok, page: { ...ok.page, has_more: true } },
    { ...ok, summary: { ...ok.summary, cases_returned: 7 } },
    { ...ok, summary: { ...ok.summary, met: -1 } },
    { ...ok, state: "complete", reasons: ["sites_limited"] },
  ];
  for (const b of bad) assert.equal(m.parseOrgSla(b, org), null);
  assert.equal(m.viewFromResult({ status: 200, body: bad[1] }, org, null, 0).phase, "error");
});

test("status mapping: 401/403/404 no retry, 422 restarts from page 1, 503/network retry", () => {
  const v = (status: number) => m.viewFromResult({ status, body: { error: "x" } }, org, "c", 1) as { phase: string; retry: boolean; restart?: boolean };
  assert.equal(v(401).retry, false);
  assert.equal(v(403).retry, false);
  assert.equal(v(404).retry, false);
  assert.equal(v(422).restart, true);
  assert.equal(v(503).retry, true);
  assert.equal(v(0).retry, true);
});

test("API client: no-store same-origin GET with the opaque cursor unchanged", async () => {
  const urls: string[] = [];
  const inits: RequestInit[] = [];
  const api = m.createOrgSlaApi((async (url: string, init: RequestInit) => {
    urls.push(url);
    inits.push(init);
    return new Response("{}", { status: 200 });
  }) as typeof fetch);
  await api.get(org, null);
  await api.get(org, "eyJhIjoxfQ");
  assert.equal(JSON.stringify(urls), JSON.stringify([`/api/organizations/${org}/sla`, `/api/organizations/${org}/sla?cursor=eyJhIjoxfQ`]));
  assert.equal(inits[0].cache, "no-store");
  assert.equal(inits[0].credentials, "same-origin");
});

test("loading and error states render; reports view mounts the panel live, honest note in demo", () => {
  assert.match(render({ phase: "loading" }), /Chargement du rapport SLA/);
  const err = render({ phase: "error", text: "Le rapport SLA n’a pas pu être chargé.", retry: true });
  assert.match(err, /role="alert"/);
  assert.match(err, /Réessayer/);
  const src = readFileSync("components/role/enterprise-space.tsx", "utf8");
  assert.match(src, /<OrganizationSlaPanel key=\{`\$\{c\.organization\.id\}:\$\{session\.refreshContext\}`\} organizationId=\{c\.organization\.id\} context=\{session\.mutationContext\} \/>/);
  assert.match(src, /demo \|\| !c\.organization \? \(\s*<Unavailable\s+title="Respect des SLA \(consolidé\)"/);
  assert.doesNotMatch(src, /Le consolidé multi-sites n’est pas livré/);
});
