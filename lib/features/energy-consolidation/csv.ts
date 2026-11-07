import { csvCell } from "@/lib/domain";
import type { energyReport } from "./report";
type Report = ReturnType<typeof energyReport>;
const yes = (value: boolean) => (value ? "oui" : "non");
const absent = "non disponible";
/** Serialize the SAME validated report: no second query, fallback totals or floating-point conversion. */
export function energyCsv(report: Report): string {
  const header = [
    "Niveau (ne pas additionner les niveaux)",
    "Organisation",
    "Sites sélectionnés",
    "Site",
    "Compteur déclaré",
    "Plage",
    "Début inclus",
    "Fin incluse",
    "Début comparaison inclus",
    "Fin comparaison incluse",
    "Nombre de relevés inclus",
    "Relevés traversant les bornes exclus",
    "Coûts manquants",
    "Somme des relevés Wh (pas consommation physique totale)",
    "Somme des coûts déclarés centimes",
    "Couverture temporelle des relevés complète",
    "Coûts complets",
    "Périmètre physique complet",
    "Comparaison des relevés possible",
    "Motif de comparaison",
    "Écart des relevés Wh",
    "Écart des coûts centimes",
    "Base",
  ];
  const rows: unknown[][] = [header];
  type Values = {
    consumption: string | null;
    cost: string | null;
    coverage: boolean;
    costComplete: boolean;
    count?: number;
    crossing?: number;
    missing?: number;
  };
  function row(
    level: string,
    site: string,
    meter: string,
    range: "current" | "previous" | "comparison",
    values: Values,
  ) {
    const previous = range === "previous";
    rows.push([
      level,
      report.scope.organization_id,
      report.scope.site_ids.join(","),
      site,
      meter,
      range,
      previous ? report.scope.previous_from : report.scope.from,
      previous ? report.scope.previous_to : report.scope.to,
      report.scope.previous_from ?? absent,
      report.scope.previous_to ?? absent,
      values.count ?? absent,
      values.crossing ?? absent,
      values.missing ?? absent,
      values.consumption ?? absent,
      values.cost ?? absent,
      yes(values.coverage),
      yes(values.costComplete),
      yes(report.physical_scope_complete),
      yes(report.comparison.comparable),
      report.comparison.reason,
      range === "comparison"
        ? (report.comparison.consumption_delta_wh ?? absent)
        : absent,
      range === "comparison"
        ? (report.comparison.cost_delta_cents ?? absent)
        : absent,
      report.basis,
    ]);
  }
  function total(
    level: string,
    site: string,
    range: "current" | "previous",
    value: Report["current"],
  ) {
    row(level, site, "", range, {
      consumption: value.recorded_consumption_wh,
      cost: value.recorded_cost_cents,
      coverage: value.recorded_coverage_complete,
      costComplete: value.cost_complete,
    });
  }
  for (const m of report.meters)
    for (const range of ["current", "previous"] as const) {
      const p = m[range];
      if (p)
        row("compteur", m.site_id, m.meter_label, range, {
          consumption: p.consumption_wh,
          cost: p.cost_cents,
          coverage: p.coverage_complete,
          costComplete: p.coverage_complete && p.missing_cost_count === 0,
          count: p.record_count,
          crossing: p.crossing_count,
          missing: p.missing_cost_count,
        });
    }
  for (const s of report.sites) {
    total("site", s.site_id, "current", s.current);
    if (s.previous) total("site", s.site_id, "previous", s.previous);
  }
  total("ensemble_des_releves", "", "current", report.current);
  if (report.previous) {
    total("ensemble_des_releves", "", "previous", report.previous);
    row("comparaison_des_releves", "", "", "comparison", {
      consumption: null,
      cost: null,
      coverage:
        report.current.recorded_coverage_complete &&
        report.previous.recorded_coverage_complete,
      costComplete:
        report.current.cost_complete && report.previous.cost_complete,
    });
  }
  return (
    "\uFEFF" + rows.map((cells) => cells.map(csvCell).join(";")).join("\r\n")
  );
}
