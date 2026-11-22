// ART-10 — performance of ONE artisan over a chosen period, recomputed by the server from rows
// that already exist (no new table, no stored indicator):
//   - revenue: payments with status = paid whose paid_at falls in [start, end), on quotes written by
//     the artisan for dossiers still attributed to the artisan, split by payment source (method);
//   - completed interventions: completed_at in [start, end), status completed or paid;
//   - punctuality: first recorded presence on site (journal action « travel_on_site », otherwise
//     « start ») compared with the END of the appointment slot in force at that moment (journal of
//     appointment saves). A dossier without a slot saved before the arrival is excluded and counted
//     as such; with no measurable dossier the rate is null (« non calculable »), never invented.
// Pure functions here; the route (app/api/artisan/performance/period) reads the rows.

export const MAX_PERIOD_DAYS = 1100;
export const PAYMENT_METHODS = ["stripe", "on_site_declared"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export type PaidRow = { total_cents: number; method: string };
export type ArrivalEvent = { intervention_id: string; action: string; created_at: string };
export type SlotEvent = { intervention_id: string; created_at: string; starts_at: string; ends_at: string };

export type RevenueReport = {
  paid_cents: number;
  paid_count: number;
  by_source: { source: PaymentMethod | "other"; paid_cents: number; paid_count: number }[];
};
export type PunctualityReport = {
  /** Whole percent of on-time dossiers among the measured ones; null when nothing is measurable. */
  rate_percent: number | null;
  measured_count: number;
  on_time_count: number;
  late_count: number;
  /** Dossiers with a recorded presence in the period but no slot saved before it: not measured. */
  without_slot_count: number;
  /** Among the measured dossiers, those whose presence is the start of work (no « sur place » declared). */
  from_start_count: number;
};
export type PeriodReport = {
  period: { start: string; end: string; boundary: "inclusive_start_exclusive_end" };
  revenue: RevenueReport;
  completed_missions_count: number;
  punctuality: PunctualityReport;
  currency: "eur";
  scope: "all_current_artisan_records";
  basis: { revenue: string; completed: string; punctuality: string };
};

export const PERIOD_BASIS = {
  revenue:
    "Somme TTC des règlements confirmés (statut payé) dont la date de confirmation tombe dans la période, sur vos devis et vos dossiers attribués, répartie par source du règlement. Ce montant n’est ni votre net après commission ni un virement bancaire.",
  completed: "Interventions terminées ou réglées dont la date de fin tombe dans la période.",
  punctuality:
    "Pour chaque dossier dont votre première présence enregistrée tombe dans la période (déclaration « sur place » ou, à défaut, démarrage de l’intervention), comparaison avec la fin du créneau de rendez-vous en vigueur à ce moment-là : à l’heure si la présence est enregistrée au plus tard à la fin du créneau, en retard sinon. Les dossiers sans créneau enregistré avant l’arrivée ne sont pas mesurés.",
} as const;

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

/** Validates the two bounds: ISO instants with offset, start < end, span capped. */
export function parsePeriod(start: string | null, end: string | null): { ok: true; start: string; end: string } | { ok: false; message: string } {
  if (!start || !end || !ISO_INSTANT.test(start) || !ISO_INSTANT.test(end)) return { ok: false, message: "Indiquez le début et la fin de la période sous forme de dates ISO avec fuseau horaire." };
  const s = Date.parse(start), e = Date.parse(end);
  if (!Number.isFinite(s) || !Number.isFinite(e)) return { ok: false, message: "Indiquez le début et la fin de la période sous forme de dates ISO avec fuseau horaire." };
  if (e <= s) return { ok: false, message: "La fin de la période doit être postérieure à son début." };
  if (e - s > MAX_PERIOD_DAYS * 86400000) return { ok: false, message: "La période ne peut pas dépasser trois ans." };
  return { ok: true, start: new Date(s).toISOString(), end: new Date(e).toISOString() };
}

export function revenueReport(rows: PaidRow[]): RevenueReport {
  const by = new Map<PaymentMethod | "other", { paid_cents: number; paid_count: number }>();
  let paid_cents = 0;
  for (const row of rows) {
    if (!Number.isSafeInteger(row.total_cents) || row.total_cents < 0) throw new Error("payment amount off-contract");
    const source = (PAYMENT_METHODS as readonly string[]).includes(row.method) ? (row.method as PaymentMethod) : "other";
    const slot = by.get(source) ?? { paid_cents: 0, paid_count: 0 };
    slot.paid_cents += row.total_cents;
    slot.paid_count += 1;
    by.set(source, slot);
    paid_cents += row.total_cents;
  }
  if (!Number.isSafeInteger(paid_cents)) throw new Error("payment total exceeds safe range");
  const order: (PaymentMethod | "other")[] = [...PAYMENT_METHODS, "other"];
  return { paid_cents, paid_count: rows.length, by_source: order.filter((s) => by.has(s)).map((source) => ({ source, ...by.get(source)! })) };
}

/** First recorded presence per dossier: the earliest « travel_on_site », else the earliest « start ». */
export function firstArrivals(events: ArrivalEvent[]): Map<string, { at: number; from: "on_site" | "start" }> {
  const onSite = new Map<string, number>(), started = new Map<string, number>();
  for (const e of events) {
    const at = Date.parse(e.created_at);
    if (!Number.isFinite(at)) continue;
    const target = e.action === "travel_on_site" ? onSite : e.action === "start" ? started : null;
    if (!target) continue;
    const known = target.get(e.intervention_id);
    if (known === undefined || at < known) target.set(e.intervention_id, at);
  }
  const result = new Map<string, { at: number; from: "on_site" | "start" }>();
  for (const id of new Set([...onSite.keys(), ...started.keys()])) {
    const a = onSite.get(id), s = started.get(id);
    // A « sur place » declared AFTER the start of work is not an arrival: the start is the first presence.
    if (a !== undefined && (s === undefined || a <= s)) result.set(id, { at: a, from: "on_site" });
    else if (s !== undefined) result.set(id, { at: s, from: "start" });
  }
  return result;
}

/** `arrivals`: every presence event of the candidate dossiers (all time); `slots`: every appointment
 *  save of the same dossiers. Only dossiers whose FIRST presence falls in [start, end) are counted. */
export function punctualityReport(arrivals: ArrivalEvent[], slots: SlotEvent[], start: string, end: string): PunctualityReport {
  const from = Date.parse(start), to = Date.parse(end);
  const bySlot = new Map<string, { saved: number; ends: number }[]>();
  for (const s of slots) {
    const saved = Date.parse(s.created_at), ends = Date.parse(s.ends_at);
    if (!Number.isFinite(saved) || !Number.isFinite(ends)) continue;
    const list = bySlot.get(s.intervention_id) ?? [];
    list.push({ saved, ends });
    bySlot.set(s.intervention_id, list);
  }
  let on_time_count = 0, late_count = 0, without_slot_count = 0, from_start_count = 0;
  for (const [id, arrival] of firstArrivals(arrivals)) {
    if (arrival.at < from || arrival.at >= to) continue;
    // Slot in force at the arrival: the latest save made at or before it (a later change is ignored).
    const inForce = (bySlot.get(id) ?? []).filter((s) => s.saved <= arrival.at).sort((a, b) => b.saved - a.saved)[0];
    if (!inForce) {
      without_slot_count += 1;
      continue;
    }
    if (arrival.from === "start") from_start_count += 1;
    if (arrival.at <= inForce.ends) on_time_count += 1;
    else late_count += 1;
  }
  const measured_count = on_time_count + late_count;
  return { rate_percent: measured_count ? Math.round((on_time_count * 100) / measured_count) : null, measured_count, on_time_count, late_count, without_slot_count, from_start_count };
}

export function buildPeriodReport(input: { start: string; end: string; paid: PaidRow[]; completed: number; arrivals: ArrivalEvent[]; slots: SlotEvent[] }): PeriodReport {
  if (!Number.isSafeInteger(input.completed) || input.completed < 0) throw new Error("completed count off-contract");
  return {
    period: { start: input.start, end: input.end, boundary: "inclusive_start_exclusive_end" },
    revenue: revenueReport(input.paid),
    completed_missions_count: input.completed,
    punctuality: punctualityReport(input.arrivals, input.slots, input.start, input.end),
    currency: "eur",
    scope: "all_current_artisan_records",
    basis: { ...PERIOD_BASIS },
  };
}
