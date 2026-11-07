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
  // Not nested in a vertical-only branch.
  const officeStart = sheet.indexOf('vertical === "office"');
  const officeBlock = sheet.slice(officeStart, sheet.indexOf(")}", officeStart));
  assert.match(officeBlock, /ENT-08/);
  assert.doesNotMatch(officeBlock, /SiteEnergyPanel|ENT-09/);
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
