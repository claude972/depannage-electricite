// ENT-09 wiring: the site sheet mounts the real SiteEnergyPanel (live), keeps an honest note in demo,
// and the consolidated report never shows an invented multi-site energy total.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadModule } from "../documents/harness";

const src = readFileSync("components/role/enterprise-space.tsx", "utf8");

function siteSheet(): string {
  const start = src.indexOf("function SiteSheet(");
  const end = src.indexOf("\nfunction ", start + 10);
  assert.ok(start > 0 && end > start, "SiteSheet found");
  return src.slice(start, end);
}

test("site sheet mounts SiteEnergyPanel for every site type with the session mutation context", () => {
  assert.match(src, /import \{ SiteEnergyPanel \} from "\.\.\/features\/energy\/site-energy-panel";/);
  const sheet = siteSheet();
  // Keyed by site + identity + generation: no list, cursor or form survives a site or identity change.
  assert.match(sheet, /<SiteEnergyPanel\s+key=\{`\$\{site\.id\}:\$\{session\.mutationContext\.userId\(\) \?\? "anon"\}:\$\{session\.mutationContext\.generation\(\)\}`\}\s+siteId=\{site\.id\}\s+context=\{session\.mutationContext\}\s+\/>/);
  // Not nested in a vertical-only branch: no `vertical === "…" && (` block contains it.
  for (const m of sheet.matchAll(/vertical === "[a-z]+" && \(/g)) {
    const block = sheet.slice(m.index!, sheet.indexOf("\n        )}", m.index!));
    assert.doesNotMatch(block, /SiteEnergyPanel|ENT-09/);
  }
});

test("demo never calls the energy route and says so", () => {
  const sheet = siteSheet();
  assert.match(sheet, /session\.mode === "demo" \? \(\s*<Unavailable\s+title="Consommation électrique"[\s\S]{0,300}?blocker="ENT-09"[\s\S]{0,40}?\) : \(\s*<SiteEnergyPanel/);
  assert.doesNotMatch(src, /Aucune source (de consommation|énergétique) n’est raccordée/);
});

test("reports point to per-site energy and compute no consolidated total", () => {
  const start = src.indexOf("function ReportsView(");
  const reports = src.slice(start, src.indexOf("\nfunction ", start + 10));
  assert.match(reports, /title="Consommation d’énergie \(consolidé\)"[\s\S]{0,300}?site par site[\s\S]{0,200}?Aucun total multi-sites n’est calculé ici\./);
  assert.doesNotMatch(reports, /SiteEnergyPanel|consumption_wh/);
});

test("the real leaf export exists with the props used by the wiring", async () => {
  const mod = loadModule("components/features/energy/site-energy-panel.tsx") as Record<string, any>;
  assert.equal(typeof mod.SiteEnergyPanel, "function");
});

test("no constant UUID fallback: creation refuses explicitly when crypto.randomUUID is missing", async () => {
  const leaf = readFileSync("components/features/energy/site-energy-panel.tsx", "utf8");
  assert.doesNotMatch(leaf, /00000000-0000-4000-8000-000000000000/);
  // The vm sandbox exposes no `crypto`: the real function must answer null, never a constant id.
  const mod = loadModule("components/features/energy/site-energy-panel.tsx") as Record<string, any>;
  assert.equal(mod.energyUuid(), null);
  assert.match(leaf, /crypto\.randomUUID === "function" \? crypto\.randomUUID\(\) : null/);
  assert.match(leaf, /if \(!id\) \{ setNoId\(true\); return; \}/);
  assert.match(mod.ENERGY_NO_UUID, /impossible/);
});

test("ENT-04: site sheet mounts SiteContactsPanel keyed by site + identity + generation; demo never calls the route", () => {
  const sheet = siteSheet();
  assert.match(src, /import \{ SiteContactsPanel \} from "\.\.\/features\/site-contacts\/site-contacts-panel";/);
  assert.match(sheet, /session\.mode === "demo" \? \(\s*<Unavailable\s+title="Contacts du site"[\s\S]{0,300}?blocker="ENT-04"[\s\S]{0,40}?\) : \(\s*<SiteContactsPanel\s+key=\{`\$\{site\.id\}:\$\{session\.mutationContext\.userId\(\) \?\? "anon"\}:\$\{session\.mutationContext\.generation\(\)\}`\}\s+siteId=\{site\.id\}\s+context=\{session\.mutationContext\}/);
  assert.doesNotMatch(src, /Aucun contact de site n’est modélisé/);
});

test("FIN-05/ENT-16: enterprise billing mounts the customer invoices panel scoped to org (+ site), service basis, never operator routes", () => {
  const start = src.indexOf("function InvoicesView(");
  const view = src.slice(start, src.indexOf("\nfunction ", start + 10));
  assert.match(src, /import \{ CustomerInvoicesPanel \} from "\.\.\/features\/customer-invoices\/customer-invoices-panel";/);
  assert.match(view, /<CustomerInvoicesPanel[\s\S]{0,80}?filters=\{\{ organization_id: c\.organization\.id, \.\.\.\(c\.activeSite \? \{ site_id: c\.activeSite\.id \} : \{\}\), basis: "service" \}\}\s+context=\{session\.mutationContext\}\s+demo=\{c\.demo\}/);
  assert.doesNotMatch(view, /La facturation n’existe pas encore côté serveur/);
  assert.doesNotMatch(view, /platform-operations\/invoices|\/api\/platform/);
});

test("ENT-08/ENT-05: site areas panel for every site type; co-ownership panel on syndic sites only, demo honest", () => {
  const sheet = siteSheet();
  assert.match(src, /import \{ SiteAreasPanel \} from "\.\.\/features\/site-areas\/site-areas-panel";/);
  assert.match(sheet, /session\.mode === "demo" \? \(\s*<Unavailable\s+title="Étages, zones et parties communes"[\s\S]{0,300}?blocker="ENT-08"[\s\S]{0,40}?\) : \(\s*<SiteAreasPanel siteId=\{site\.id\} context=\{session\.mutationContext\} demo=\{false\} \/>/);
  assert.doesNotMatch(sheet, /vertical === "office" && \(/);
  assert.doesNotMatch(src, /Le découpage des bâtiments en étages et zones n’est pas modélisé/);
  assert.match(sheet, /vertical === "syndic" &&\s+\(session\.mode === "demo" \? \(\s*<Unavailable\s+title="Assemblées générales & appels de fonds"[\s\S]{0,300}?blocker="ENT-05"[\s\S]{0,40}?\) : \(\s*<CoOwnershipPanel siteId=\{site\.id\} context=\{session\.mutationContext\} demo=\{false\} \/>/);
});

test("ENT-05 reports: no consolidated AG/fund total, no quorum or collection claim", () => {
  const start = src.indexOf("function ReportsView(");
  const reports = src.slice(start, src.indexOf("\nfunction ", start + 10));
  assert.match(reports, /Assemblées générales & appels de fonds \(consolidé\)[\s\S]{0,400}?l’application ne calcule aucun quorum et n’encaisse rien/);
  assert.doesNotMatch(reports, /CoOwnershipPanel/);
});
