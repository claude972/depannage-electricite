// ART-10 — period selection and strict read of GET /api/artisan/performance/period.
// The bounds are built from the device calendar (start included, end excluded), like the monthly
// report; every figure comes from the server reply, validated here and never recomputed.
import { z } from "zod";

export const PERIOD_PATH = "/api/artisan/performance/period";
export const PERIOD_PRESETS = ["month", "previous_month", "quarter", "year", "custom"] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];
export const PRESET_LABEL: Record<PeriodPreset, string> = {
  month: "Mois en cours",
  previous_month: "Mois précédent",
  quarter: "Trimestre en cours",
  year: "Année en cours",
  custom: "Période personnalisée",
};
export type Bounds = { start: string; end: string };
export const MAX_CUSTOM_DAYS = 1095;

/** Calendar bounds of a preset in the device time zone. `custom` has no preset bounds. */
export function presetBounds(preset: Exclude<PeriodPreset, "custom">, now: Date = new Date()): Bounds {
  const y = now.getFullYear(), m = now.getMonth();
  const at = (year: number, month: number) => new Date(year, month, 1).toISOString();
  if (preset === "month") return { start: at(y, m), end: at(y, m + 1) };
  if (preset === "previous_month") return { start: at(y, m - 1), end: at(y, m) };
  if (preset === "quarter") {
    const q = Math.floor(m / 3) * 3;
    return { start: at(y, q), end: at(y, q + 3) };
  }
  return { start: at(y, 0), end: at(y + 1, 0) };
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
function localDay(value: string): Date | null {
  const m = DAY.exec(value);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]) ? d : null;
}
/** Custom period: both days required, « au » inclusive (the bound sent is the next day, excluded). */
export function customBounds(from: string, to: string): { ok: true; bounds: Bounds } | { ok: false; message: string } {
  const a = localDay(from), b = localDay(to);
  if (!a || !b) return { ok: false, message: "Indiquez la date de début et la date de fin." };
  if (b < a) return { ok: false, message: "La date de fin ne peut pas précéder la date de début." };
  const end = new Date(b.getFullYear(), b.getMonth(), b.getDate() + 1);
  if (end.getTime() - a.getTime() > MAX_CUSTOM_DAYS * 86400000) return { ok: false, message: "La période ne peut pas dépasser trois ans." };
  return { ok: true, bounds: { start: a.toISOString(), end: end.toISOString() } };
}

export const periodUrl = (b: Bounds) => `${PERIOD_PATH}?start=${encodeURIComponent(b.start)}&end=${encodeURIComponent(b.end)}`;

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const instant = z.iso.datetime({ offset: true });
const reportSchema = z
  .object({
    period: z.object({ start: instant, end: instant, boundary: z.literal("inclusive_start_exclusive_end") }).strict(),
    revenue: z
      .object({
        paid_cents: count,
        paid_count: count,
        by_source: z.array(z.object({ source: z.enum(["stripe", "on_site_declared", "other"]), paid_cents: count, paid_count: count.min(1) }).strict()).max(3),
      })
      .strict(),
    completed_missions_count: count,
    punctuality: z
      .object({ rate_percent: z.number().int().min(0).max(100).nullable(), measured_count: count, on_time_count: count, late_count: count, without_slot_count: count, from_start_count: count })
      .strict(),
    currency: z.literal("eur"),
    scope: z.literal("all_current_artisan_records"),
    basis: z.object({ revenue: z.string().min(1), completed: z.string().min(1), punctuality: z.string().min(1) }).strict(),
  })
  .strict();
export type PeriodReportView = z.infer<typeof reportSchema>;

/** The reply for EXACTLY the requested bounds, internally coherent; otherwise null (nothing shown). */
export function parsePeriodReport(body: unknown, asked: Bounds): PeriodReportView | null {
  const r = reportSchema.safeParse(body);
  if (!r.success) return null;
  const d = r.data;
  if (Date.parse(d.period.start) !== Date.parse(asked.start) || Date.parse(d.period.end) !== Date.parse(asked.end)) return null;
  const sources = d.revenue.by_source;
  if (new Set(sources.map((s) => s.source)).size !== sources.length) return null;
  if (sources.reduce((n, s) => n + s.paid_cents, 0) !== d.revenue.paid_cents || sources.reduce((n, s) => n + s.paid_count, 0) !== d.revenue.paid_count) return null;
  const p = d.punctuality;
  if (p.on_time_count + p.late_count !== p.measured_count || p.from_start_count > p.measured_count) return null;
  if ((p.measured_count === 0) !== (p.rate_percent === null)) return null;
  if (p.rate_percent !== null && p.rate_percent !== Math.round((p.on_time_count * 100) / p.measured_count)) return null;
  return d;
}

export const SOURCE_LABEL: Record<PeriodReportView["revenue"]["by_source"][number]["source"], string> = {
  stripe: "Paiement par carte sur la plateforme",
  on_site_declared: "Règlement déclaré reçu sur place (sans confirmation bancaire)",
  other: "Autre source enregistrée",
};

const dayFormat = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" });
/** « du 1 novembre 2026 au 30 novembre 2026 » — the end shown is the last day INCLUDED. */
export function boundsLabel(b: Bounds): string {
  const last = new Date(Date.parse(b.end) - 1);
  return `du ${dayFormat.format(new Date(b.start))} au ${dayFormat.format(last)}`;
}

/** Punctuality sentence: never a rate without its sample, « non calculable » without data. */
export function punctualityText(p: PeriodReportView["punctuality"]): { value: string; note: string } {
  const excluded = p.without_slot_count
    ? ` ${p.without_slot_count} ${p.without_slot_count > 1 ? "interventions non mesurées" : "intervention non mesurée"} : aucun créneau enregistré avant l’arrivée.`
    : "";
  if (p.rate_percent === null || p.measured_count === 0)
    return { value: "Non calculable", note: `Aucune intervention de la période n’a à la fois un créneau de rendez-vous et une arrivée enregistrés.${excluded}` };
  return {
    value: `${p.rate_percent} %`,
    note: `${p.on_time_count} sur ${p.measured_count} ${p.measured_count > 1 ? "interventions mesurées" : "intervention mesurée"} à l’heure${p.late_count ? `, ${p.late_count} en retard` : ""}.${excluded}`,
  };
}
