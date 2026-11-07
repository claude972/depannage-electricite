// Energy consolidation UI (ENT-09/15): explicit selection sent exactly; missing ≠ zero; incomplete
// coverage ⇒ no total (with reasons); comparison only when the server says comparable; off-contract
// reply ⇒ error; identity guard; demo zero calls; wiring replaces the « consolidé » pointer.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { loadModule } from "../documents/harness";
import type * as Model from "../../components/features/energy-consolidation/model";
import type * as Panel from "../../components/features/energy-consolidation/energy-consolidation-panel";

const m = loadModule("components/features/energy-consolidation/model.ts") as unknown as typeof Model;
const p = loadModule("components/features/energy-consolidation/energy-consolidation-panel.tsx") as unknown as typeof Panel;
const html = (el: unknown) => renderToString(el as never).replace(/<!-- -->/g, "");
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const ORG = "10000000-0000-4000-8000-000000000001";
const S1 = "20000000-0000-4000-8000-000000000001", S2 = "20000000-0000-4000-8000-000000000002";
const SEL = { organization_id: ORG, site_ids: [S1, S2], from: "2026-01-01", to: "2026-01-31", previous_from: null, previous_to: null };
const period = (o: Partial<Record<string, unknown>> = {}) => ({ record_count: 1, crossing_count: 0, missing_cost_count: 0, consumption_wh: "1500", cost_cents: "300", coverage_complete: true, ...o });
const total = (o: Partial<Record<string, unknown>> = {}) => ({ recorded_consumption_wh: "1500", recorded_cost_cents: "300", recorded_coverage_complete: true, cost_complete: true, actual_site_consumption_wh: null, physical_scope_complete: false, ...o });
function report(over: Record<string, unknown> = {}, sel = SEL) {
  return {
    basis: "declared_meter_periods_fully_inside_range",
    scope: sel,
    meters: [{ site_id: S1, meter_label: "compteur général", current: period(), previous: null }, { site_id: S2, meter_label: "cuisine", current: period({ consumption_wh: "0", cost_cents: "0" }), previous: null }],
    sites: [{ site_id: S1, known_meters: 1, current: total(), previous: null }, { site_id: S2, known_meters: 1, current: total({ recorded_consumption_wh: "0", recorded_cost_cents: "0" }), previous: null }],
    current: total(),
    previous: null,
    comparison: { comparable: false, reason: "not_requested", consumption_delta_wh: null, cost_delta_cents: null },
    limits: { sites: 50, known_meters: 500, days_per_range: 366 },
    physical_scope_complete: false,
    ...over,
  };
}
const sites = [{ id: S1, name: "Résidence QA" }, { id: S2, name: "Restaurant QA" }];
const ctx = { generation: () => 1, userId: () => "manager-1" };
const view = (rep: unknown, sel = SEL) => html(createElement(p.EnergyConsolidationPanel as never, { organizationId: ORG, sites, demo: false, context: ctx, initial: { form: m.EMPTY_FORM, report: m.parseReport(rep, sel as never), selection: sel } } as never));

test("sélection explicite envoyée exactement (sites choisis, dates saisies, comparaison seulement si demandée)", () => {
  assert.equal(m.energyUrl(SEL as never), `/api/organizations/${ORG}/energy?site_ids=${S1}%2C${S2}&from=2026-01-01&to=2026-01-31`);
  const withPrev = { ...SEL, previous_from: "2025-12-01", previous_to: "2025-12-31" };
  assert.match(m.energyUrl(withPrev as never), /&previous_from=2025-12-01&previous_to=2025-12-31$/);
  assert.match(String((m.formToSelection(ORG, { ...m.EMPTY_FORM, from: "2026-01-01", to: "2026-01-31" }) as { error?: string }).error), /au moins un site/);
  assert.match(String((m.formToSelection(ORG, { ...m.EMPTY_FORM, site_ids: [S1] }) as { error?: string }).error), /Choisissez une période/, "no implicit default range");
  assert.match(String((m.formToSelection(ORG, { ...m.EMPTY_FORM, site_ids: [S1], from: "2026-01-01", to: "2027-06-01" }) as { error?: string }).error), /366 jours/);
  const ok = m.formToSelection(ORG, { ...m.EMPTY_FORM, site_ids: [S1, S2], from: "2026-01-01", to: "2026-01-31" });
  assert.ok("selection" in ok);
  assert.equal("selection" in ok && ok.selection.previous_from, null);
});

test("manquant ≠ zéro : un relevé absent est « non déclaré / manquant », un 0 déclaré est 0 kWh", () => {
  const rep = report({
    meters: [{ site_id: S1, meter_label: "compteur général", current: period({ record_count: 0, consumption_wh: null, cost_cents: null, coverage_complete: false }), previous: null }, { site_id: S2, meter_label: "cuisine", current: period({ consumption_wh: "0", cost_cents: "0" }), previous: null }],
    sites: [{ site_id: S1, known_meters: 1, current: total({ recorded_consumption_wh: null, recorded_cost_cents: null, recorded_coverage_complete: false, cost_complete: false }), previous: null }, { site_id: S2, known_meters: 1, current: total({ recorded_consumption_wh: "0", recorded_cost_cents: "0" }), previous: null }],
    current: total({ recorded_consumption_wh: "0", recorded_coverage_complete: false, cost_complete: false, recorded_cost_cents: null }),
  });
  const out = view(rep);
  assert.match(out, /data-energy-meter="compteur général"[\s\S]*?data-energy-missing="">non déclaré \/ manquant/);
  assert.match(out, /data-energy-meter="cuisine"[\s\S]*?data-energy-value="">0 kWh/);
  assert.equal(m.whToKwh("1234567"), "1 234,567 kWh");
  assert.equal(m.whToKwh("0"), "0 kWh");
  assert.equal(m.whToKwh("1500"), "1,5 kWh");
  assert.equal(m.centsToEuros("300"), "3,00 €");
});

test("couverture incomplète ⇒ aucun total, avec les raisons ; complète ⇒ total exact", () => {
  const incomplete = report({
    meters: [{ site_id: S1, meter_label: "compteur général", current: period({ coverage_complete: false, crossing_count: 1 }), previous: null }],
    sites: [{ site_id: S1, known_meters: 1, current: total({ recorded_coverage_complete: false, cost_complete: false }), previous: null }, { site_id: S2, known_meters: 0, current: total({ recorded_consumption_wh: null, recorded_cost_cents: null, recorded_coverage_complete: false, cost_complete: false }), previous: null }],
    current: total({ recorded_coverage_complete: false, cost_complete: false }),
  });
  const out = text(view(incomplete));
  assert.match(out, /Total non calculable : couverture incomplète\./);
  assert.doesNotMatch(out, /Total des relevés déclarés 1,5 kWh/);
  assert.match(out, /Résidence QA · compteur général : 1 relevé\(s\) débordant la période, exclus\./);
  assert.match(out, /Restaurant QA : aucun compteur déclaré\./);
  const complete = text(view(report()));
  assert.match(complete, /Total des relevés déclarés 1,5 kWh · 3,00 €/);
  assert.match(complete, /ce n’est pas la consommation réelle exhaustive du site/);
});

test("comparaison seulement si le serveur la dit comparable (sinon la raison, aucun écart)", () => {
  const prevSel = { ...SEL, previous_from: "2025-12-01", previous_to: "2025-12-31" };
  const withPrev = (comparison: Record<string, unknown>) => report({
    scope: prevSel,
    meters: report().meters.map((x: Record<string, unknown>) => ({ ...x, previous: period() })),
    sites: report().sites.map((x: Record<string, unknown>) => ({ ...x, previous: total() })),
    previous: total(),
    comparison,
  }, prevSel as never);
  const comparable = text(view(withPrev({ comparable: true, reason: "comparable_declared_readings", consumption_delta_wh: "-500", cost_delta_cents: "100" }), prevSel as never));
  assert.match(comparable, /Écart : −0,5 kWh · 1,00 €/);
  const not = text(view(withPrev({ comparable: false, reason: "different_duration", consumption_delta_wh: null, cost_delta_cents: null }), prevSel as never));
  assert.match(not, /les deux périodes n’ont pas la même durée/);
  assert.doesNotMatch(not, /Écart :/);
  // A « comparable » reply carrying no comparable reason, or deltas while not comparable, is off-contract.
  assert.equal(m.parseReport(withPrev({ comparable: false, reason: "different_duration", consumption_delta_wh: "1", cost_delta_cents: null }), prevSel as never), null);
});

test("réponse hors contrat ⇒ erreur (périmètre différent, total complet sans couverture, champ inventé)", () => {
  assert.ok(m.parseReport(report(), SEL as never));
  assert.equal(m.parseReport(report({ scope: { ...SEL, site_ids: [S1] } }), SEL as never), null, "other site selection");
  assert.equal(m.parseReport(report({ scope: { ...SEL, from: "2026-01-02" } }), SEL as never), null, "other range");
  assert.equal(m.parseReport(report({ physical_scope_complete: true }), SEL as never), null);
  assert.equal(m.parseReport(report({ current: total({ actual_site_consumption_wh: "1" }) }), SEL as never), null);
  assert.equal(m.parseReport({ ...report(), extra: 1 }, SEL as never), null);
  const lying = report({ meters: [{ site_id: S1, meter_label: "x", current: period({ coverage_complete: false }), previous: null }, { site_id: S2, meter_label: "y", current: period(), previous: null }] });
  assert.equal(m.parseReport(lying, SEL as never), null, "site total complete while a meter is not");
  assert.equal(m.parseReport(report({ meters: [{ site_id: S1, meter_label: "x", current: period({ consumption_wh: "1.5" }), previous: null }] }), SEL as never), null, "floats refused");
});

test("garde d’identité : une réponse après changement d’identité ou une requête plus récente n’est pas appliquée", async () => {
  // Pure check on the panel's run() logic through its source (React state is client-only here).
  const src = readFileSync("components/features/energy-consolidation/energy-consolidation-panel.tsx", "utf8");
  assert.match(src, /if \(my !== seq\.current\) return;\s*if \(context\.generation\(\) !== gen \|\| context\.userId\(\) !== uid\) \{\s*\/\/[^\n]*\n\s*setReport\(null\);/);
  assert.match(readFileSync("components/features/energy-consolidation/model.ts", "utf8"), /method: "GET"/);
  assert.doesNotMatch(readFileSync("components/features/energy-consolidation/model.ts", "utf8"), /method: "(POST|PUT|PATCH|DELETE)"/, "read-only");
  let calls = 0;
  const r = await m.fetchReport((async () => { calls++; return new Response(JSON.stringify(report()), { status: 200 }); }) as never, SEL as never);
  assert.equal(calls, 1);
  assert.equal(r.status, 200);
});

test("démo : note honnête, aucun appel ; câblage remplace le pointeur « consolidé »", () => {
  let calls = 0;
  const out = html(createElement(p.EnergyConsolidationPanel as never, { organizationId: ORG, sites, demo: true, context: ctx, fetcher: (async () => { calls++; return new Response("{}"); }) as never } as never));
  assert.match(out, /data-energy-consolidation="demo"/);
  assert.match(out, /En démonstration, aucune consolidation n’est calculée/);
  assert.equal(calls, 0);
  const space = readFileSync("components/role/enterprise-space.tsx", "utf8");
  assert.doesNotMatch(space, /Les périodes de consommation \(factures, relevés de compteur, saisies\) se déclarent et se consultent site par site, dans la fiche de chaque site\./);
  assert.doesNotMatch(space, /title="Consommation d’énergie \(consolidé\)"/);
  assert.match(space, /<EnergyConsolidationPanel[\s\S]*?organizationId=\{c\.organization\?\.id \?\? null\}[\s\S]*?context=\{session\.mutationContext\}/);
});
