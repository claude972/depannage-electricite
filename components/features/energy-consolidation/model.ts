// Energy consolidation (ENT-09/15) — pure model (no React). Read-only:
//   GET /api/organizations/{id}/energy?site_ids=a,b&from=YYYY-MM-DD&to=YYYY-MM-DD[&previous_from&previous_to]
// Contract: lib/features/energy-consolidation/report.ts (ROOT 6defb01, read-only; its `selection`
// schema is reused). One snapshot per request: no cursor; limits 1–50 sites, 366 days per range,
// 500 declared meters (422 beyond). Sums are exact integer strings; null = nothing declared (never
// 0); totals only with complete recorded coverage; never the real exhaustive site consumption.
import { z } from "zod";
import { selection, type Selection } from "../../../lib/features/energy-consolidation/report";

export type { Selection };
export type Result = { status: number; body: unknown };
export const ENERGY_TIMEOUT_MS = 15_000;
export const ENERGY_TIMEOUT = -1;

const integer = z.string().regex(/^(0|[1-9][0-9]*)$/).max(40);
const signed = z.string().regex(/^-?(0|[1-9][0-9]*)$/).max(41);
const period = z
  .object({
    record_count: z.number().int().nonnegative(),
    crossing_count: z.number().int().nonnegative(),
    missing_cost_count: z.number().int().nonnegative(),
    consumption_wh: integer.nullable(),
    cost_cents: integer.nullable(),
    coverage_complete: z.boolean(),
  })
  .strict()
  .refine((v) => (v.record_count === 0) === (v.consumption_wh === null) && !(v.coverage_complete && (v.record_count === 0 || v.crossing_count > 0)));
const total = z
  .object({
    recorded_consumption_wh: integer.nullable(),
    recorded_cost_cents: integer.nullable(),
    recorded_coverage_complete: z.boolean(),
    cost_complete: z.boolean(),
    actual_site_consumption_wh: z.null(),
    physical_scope_complete: z.literal(false),
  })
  .strict()
  .refine((v) => !v.cost_complete || v.recorded_coverage_complete);
const meter = z.object({ site_id: z.string().min(1), meter_label: z.string().min(1).max(160), current: period, previous: period.nullable() }).strict();
const reportSchema = z
  .object({
    basis: z.literal("declared_meter_periods_fully_inside_range"),
    scope: z.unknown(),
    meters: z.array(meter).max(500),
    sites: z.array(z.object({ site_id: z.string().min(1), known_meters: z.number().int().nonnegative(), current: total, previous: total.nullable() }).strict()).max(50),
    current: total,
    previous: total.nullable(),
    comparison: z
      .object({
        comparable: z.boolean(),
        reason: z.enum(["not_requested", "different_duration", "overlapping_ranges", "incomplete_recorded_coverage", "comparable_declared_readings"]),
        consumption_delta_wh: signed.nullable(),
        cost_delta_cents: signed.nullable(),
      })
      .strict()
      .refine((c) => c.comparable === (c.reason === "comparable_declared_readings") && (c.comparable || (c.consumption_delta_wh === null && c.cost_delta_cents === null))),
    limits: z.object({ sites: z.number(), known_meters: z.number(), days_per_range: z.number() }).strict(),
    physical_scope_complete: z.literal(false),
  })
  .strict();
export type EnergyReport = z.infer<typeof reportSchema>;
type Total = z.infer<typeof total>;

/** The reply must answer exactly the request (same organisation, same sites, same ranges). */
export function parseReport(body: unknown, sel: Selection): EnergyReport | null {
  const r = reportSchema.safeParse(body);
  if (!r.success) return null;
  const scope = selection.safeParse(r.data.scope);
  if (!scope.success) return null;
  const s = scope.data;
  const same = (a: string[], b: string[]) => [...a].sort().join() === [...b].sort().join();
  if (s.organization_id !== sel.organization_id || !same(s.site_ids, sel.site_ids) || s.from !== sel.from || s.to !== sel.to || s.previous_from !== sel.previous_from || s.previous_to !== sel.previous_to) return null;
  if (!same(r.data.sites.map((x) => x.site_id), sel.site_ids)) return null;
  if (r.data.meters.some((m) => !sel.site_ids.includes(m.site_id) || (m.previous !== null) !== (sel.previous_from !== null))) return null;
  if ((r.data.previous !== null) !== (sel.previous_from !== null)) return null;
  // A total shown as complete must be backed by complete coverage of every known meter.
  for (const site of r.data.sites) {
    const meters = r.data.meters.filter((m) => m.site_id === site.site_id);
    if (site.known_meters !== meters.length) return null;
    if (site.current.recorded_coverage_complete && (meters.length === 0 || meters.some((m) => !m.current.coverage_complete))) return null;
  }
  return r.data;
}

// ---- Selection (explicit sites + explicit range; no implicit « all ») -----------------------------
export type Form = { site_ids: string[]; from: string; to: string; compare: boolean; previous_from: string; previous_to: string };
export const EMPTY_FORM: Form = { site_ids: [], from: "", to: "", compare: false, previous_from: "", previous_to: "" };
export const FORM_ERRORS = {
  sites: "Choisissez au moins un site (50 au plus).",
  range: "Choisissez une période : date de début et date de fin (366 jours au plus).",
  previous: "Période de comparaison : les deux dates, 366 jours au plus.",
} as const;
export function formToSelection(organizationId: string, f: Form): { selection: Selection } | { error: string } {
  if (!f.site_ids.length || f.site_ids.length > 50) return { error: FORM_ERRORS.sites };
  if (!f.from || !f.to) return { error: FORM_ERRORS.range };
  const parsed = selection.safeParse({
    organization_id: organizationId,
    site_ids: f.site_ids,
    from: f.from,
    to: f.to,
    previous_from: f.compare ? f.previous_from || null : null,
    previous_to: f.compare ? f.previous_to || null : null,
  });
  if (!parsed.success) return { error: f.compare ? `${FORM_ERRORS.range} ${FORM_ERRORS.previous}` : FORM_ERRORS.range };
  if (f.compare && (parsed.data.previous_from === null || parsed.data.previous_to === null)) return { error: FORM_ERRORS.previous };
  return { selection: parsed.data };
}
/** Exact query: sites in the order chosen, dates as typed; previous range only when asked. */
export function energyUrl(sel: Selection): string {
  const parts: [string, string][] = [["site_ids", sel.site_ids.join(",")], ["from", sel.from], ["to", sel.to]];
  if (sel.previous_from && sel.previous_to) parts.push(["previous_from", sel.previous_from], ["previous_to", sel.previous_to]);
  return `/api/organizations/${encodeURIComponent(sel.organization_id)}/energy?${parts.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")}`;
}
export async function fetchReport(fetcher: typeof fetch, sel: Selection, timeoutMs = ENERGY_TIMEOUT_MS): Promise<Result> {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<Result>((resolve) => {
    timer = setTimeout(() => {
      controller?.abort();
      resolve({ status: ENERGY_TIMEOUT, body: null });
    }, timeoutMs);
  });
  const request = (async (): Promise<Result> => {
    try {
      const r = await fetcher(energyUrl(sel), { method: "GET", credentials: "same-origin", cache: "no-store", ...(controller ? { signal: controller.signal } : {}) });
      return { status: r.status, body: await r.json().catch(() => null) };
    } catch {
      return { status: controller?.signal.aborted ? ENERGY_TIMEOUT : 0, body: null };
    }
  })();
  try {
    return await Promise.race([request, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

// ---- Exact formatting (integer strings, never floats) -----------------------------------------------
const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
/** "1234567" Wh ⇒ « 1 234,567 kWh » exactly (trailing zeros trimmed). */
export function whToKwh(wh: string): string {
  const neg = wh.startsWith("-");
  const d = (neg ? wh.slice(1) : wh).padStart(4, "0");
  const whole = d.slice(0, -3).replace(/^0+(?=\d)/, "");
  const dec = d.slice(-3).replace(/0+$/, "");
  return `${neg ? "−" : ""}${group(whole)}${dec ? `,${dec}` : ""} kWh`;
}
export function centsToEuros(cents: string): string {
  const neg = cents.startsWith("-");
  const d = (neg ? cents.slice(1) : cents).padStart(3, "0");
  return `${neg ? "−" : ""}${group(d.slice(0, -2).replace(/^0+(?=\d)/, ""))},${d.slice(-2)} €`;
}
export const COPY = {
  declaredOnly: "Somme des relevés déclarés (factures, relevés de compteur, saisies), entièrement compris dans la période ; ce n’est pas la consommation réelle exhaustive du site (aucun registre de compteurs ni hiérarchie compteur / sous-compteur).",
  missing: "non déclaré / manquant",
  noTotal: "Total non calculable : couverture incomplète.",
  loadFailed: "La consolidation n’a pas pu être vérifiée. Réessayez.",
  forbidden: "Ce périmètre n’est pas accessible avec vos droits actuels (un site non autorisé fait échouer toute la sélection).",
  invalid: "Sélection refusée par le serveur : 1 à 50 sites, 366 jours au plus par période, 500 compteurs déclarés au plus.",
  demo: "En démonstration, aucune consolidation n’est calculée : connectez-vous à votre espace pour consolider les relevés déclarés de vos sites.",
  noSites: "Aucun site dans ce périmètre : la consolidation porte sur des sites explicitement choisis.",
} as const;
export const COMPARISON_REASON: Record<EnergyReport["comparison"]["reason"], string> = {
  not_requested: "Aucune période de comparaison demandée.",
  different_duration: "Comparaison impossible : les deux périodes n’ont pas la même durée.",
  overlapping_ranges: "Comparaison impossible : les deux périodes se chevauchent.",
  incomplete_recorded_coverage: "Comparaison impossible : couverture des relevés incomplète sur au moins une période.",
  comparable_declared_readings: "Périodes comparables (mêmes durées, disjointes, relevés complets sur les deux).",
};
/** Why a total cannot be computed, from the server's per-site / per-meter coverage. */
export function incompleteReasons(report: EnergyReport, siteName: (id: string) => string, which: "current" | "previous" = "current"): string[] {
  const out: string[] = [];
  for (const s of report.sites) {
    const meters = report.meters.filter((m) => m.site_id === s.site_id);
    if (!meters.length) {
      out.push(`${siteName(s.site_id)} : aucun compteur déclaré.`);
      continue;
    }
    for (const m of meters) {
      const p = which === "current" ? m.current : m.previous;
      if (!p || p.coverage_complete) continue;
      out.push(`${siteName(s.site_id)} · ${m.meter_label} : ${p.record_count === 0 ? "aucun relevé sur la période" : p.crossing_count > 0 ? `${p.crossing_count} relevé(s) débordant la période, exclus` : "jours non couverts ou relevés superposés"}.`);
    }
  }
  return out;
}
export const totalConsumption = (t: Total): string | null => (t.recorded_coverage_complete && t.recorded_consumption_wh !== null ? whToKwh(t.recorded_consumption_wh) : null);
export const totalCost = (t: Total): string | null => (t.cost_complete && t.recorded_cost_cents !== null ? centsToEuros(t.recorded_cost_cents) : null);

// ---- Private CSV export (ROOT b404b4f, read-only contract copied, not cherry-picked) ---------------
//   GET /api/organizations/{id}/energy?<exactly the displayed filters>&format=csv
// Success: 200, `text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="rapport-energie.csv"`,
// `Cache-Control: private, no-store`. Errors stay private JSON with the usual status (401/403/404/422/503),
// never an empty « successful » download. Same caps as the JSON report.
export const EXPORT_FALLBACK_NAME = "rapport-energie.csv";
/** The CSV query is the displayed consolidation's query plus `format=csv` — nothing else changes. */
export const energyCsvUrl = (sel: Selection): string => `${energyUrl(sel)}&format=csv`;

/** Server filename from Content-Disposition, reduced to a safe local name ending in .csv. */
export function exportFilename(disposition: string | null): string {
  if (!disposition) return EXPORT_FALLBACK_NAME;
  let raw: string | null = null;
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(disposition);
  if (star) {
    try {
      raw = decodeURIComponent(star[1].trim());
    } catch {
      raw = null;
    }
  }
  if (raw === null) {
    const plain = /filename\s*=\s*(?:"([^"]*)"|([^;]+))/.exec(disposition);
    raw = plain ? (plain[1] ?? plain[2] ?? "").trim() : null;
  }
  if (!raw) return EXPORT_FALLBACK_NAME;
  const base = raw.split(/[\\/]/).pop() ?? "";
  const safe = base.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[.-]+/, "").slice(0, 100);
  return /^[A-Za-z0-9][A-Za-z0-9._-]*\.csv$/i.test(safe) ? safe : EXPORT_FALLBACK_NAME;
}

export type ExportOutcome =
  | { kind: "file"; blob: Blob; filename: string }
  | { kind: "error"; status: number; retryAfterS: number | null }
  | { kind: "off-contract" };
const retryAfter = (v: string | null): number | null => {
  if (!v || !/^\d{1,5}$/.test(v.trim())) return null;
  return Math.min(Number(v.trim()), 3600);
};
/** One private GET; a file only for a 200 text/csv non-empty body. Nothing is cached or persisted. */
export async function fetchCsv(fetcher: typeof fetch, sel: Selection, timeoutMs = ENERGY_TIMEOUT_MS): Promise<ExportOutcome> {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<ExportOutcome>((resolve) => {
    timer = setTimeout(() => {
      controller?.abort();
      resolve({ kind: "error", status: ENERGY_TIMEOUT, retryAfterS: null });
    }, timeoutMs);
  });
  const request = (async (): Promise<ExportOutcome> => {
    try {
      const r = await fetcher(energyCsvUrl(sel), { method: "GET", credentials: "same-origin", cache: "no-store", headers: { Accept: "text/csv" }, ...(controller ? { signal: controller.signal } : {}) });
      if (r.status !== 200) return { kind: "error", status: r.status, retryAfterS: r.status === 503 ? retryAfter(r.headers.get("retry-after")) : null };
      const type = (r.headers.get("content-type") ?? "").toLowerCase();
      if (!/^text\/csv\s*(;|$)/.test(type)) return { kind: "off-contract" };
      const blob = await r.blob();
      if (!blob.size) return { kind: "off-contract" };
      return { kind: "file", blob, filename: exportFilename(r.headers.get("content-disposition")) };
    } catch {
      return { kind: "error", status: controller?.signal.aborted ? ENERGY_TIMEOUT : 0, retryAfterS: null };
    }
  })();
  try {
    return await Promise.race([request, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
/** Full portfolio read (GET /api/organizations/:id/sites, 50 per page, active | archived). */
export const PORTFOLIO_COPY = {
  legend: "Portefeuille complet de l’organisation",
  open: "Parcourir tout le portefeuille",
  filter: "Sites affichés",
  loading: "Lecture du portefeuille…",
  empty: (archived: boolean) => (archived ? "Aucun site archivé." : "Aucun site actif."),
  failed: "Le portefeuille n’a pas pu être lu. Ce qui est déjà affiché et vos choix restent valables.",
  more: "Afficher plus",
  refused: { 401: "Session expirée : reconnectez-vous pour lire le portefeuille.", 403: "Le serveur refuse l’accès au portefeuille de cette organisation : la sélection et le rapport ont été effacés.", 404: "Cette organisation est introuvable ou n’est plus accessible : la sélection et le rapport ont été effacés." } as Record<401 | 403 | 404, string>,
  chosen: (n: number) => `Sites choisis : ${n} / 50`,
  limit: "50 sites au plus : retirez un site pour en choisir un autre.",
} as const;
export const EXPORT_COPY = {
  button: "Exporter en CSV",
  busy: "Export en cours…",
  needSelection: "L’export CSV devient disponible une fois une sélection valide consolidée et affichée.",
  scope: "Le fichier reprend exactement la consolidation affichée (mêmes sites, mêmes périodes). Il est privé : téléchargé depuis votre session, jamais via un lien public.",
  demo: "En démonstration, aucun export CSV n’est produit : connectez-vous pour exporter la consolidation de vos sites.",
  done: (name: string) => `Fichier « ${name} » généré pour la consolidation affichée.`,
  offContract: "Réponse inattendue du serveur : aucun fichier n’a été enregistré. Réessayez.",
} as const;
/** Honest message per status; `retryAfterS` only for 503. */
export function exportError(status: number, retryAfterS: number | null): string {
  if (status === 401) return "Session expirée : reconnectez-vous pour exporter. Aucun fichier n’a été enregistré.";
  if (status === 403) return "Export refusé : ce périmètre n’est pas accessible avec vos droits actuels (un site non autorisé fait échouer tout l’export). Aucun fichier n’a été enregistré.";
  if (status === 404) return "Organisation ou site introuvable dans votre périmètre : aucun fichier n’a été enregistré.";
  if (status === 422) return "Export refusé par le serveur : 1 à 50 sites, 366 jours au plus par période, 500 compteurs déclarés au plus. Aucun fichier n’a été enregistré : ajustez la sélection puis consolidez-la à nouveau.";
  if (status === 503) return retryAfterS ? `Service momentanément indisponible : réessayez dans ${retryAfterS} s. Aucun fichier n’a été enregistré.` : "Service momentanément indisponible : réessayez plus tard. Aucun fichier n’a été enregistré.";
  if (status === ENERGY_TIMEOUT) return "Délai dépassé : l’export n’a pas abouti, aucun fichier n’a été enregistré. Réessayez.";
  return "L’export n’a pas abouti : aucun fichier n’a été enregistré. Réessayez.";
}
