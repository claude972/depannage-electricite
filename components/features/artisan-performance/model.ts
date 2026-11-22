// ART-10 — artisan performance read from the server (GET /api/artisan/performance via
// session.loadArtisanPerformance). Strict mirror of ArtisanPerformanceReport and of the
// artisan_performance RPC payload: anything off-contract is rejected, never repaired.
import type { ArtisanPerformanceReport } from "../../app/types";

type Bucket = ArtisanPerformanceReport["current"];

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isCount = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const isInstant = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && Number.isFinite(Date.parse(v));

function bucket(v: unknown): Bucket | null {
  if (!isObj(v)) return null;
  const { paid_service_cents, paid_count, completed_missions_count } = v;
  if (!isCount(paid_service_cents) || !isCount(paid_count) || !isCount(completed_missions_count)) {
    return null;
  }
  // A paid amount without any confirmed payment is not a coherent report.
  if (paid_service_cents > 0 && paid_count === 0) return null;
  return { paid_service_cents, paid_count, completed_missions_count };
}

/** Returns a fresh, validated copy of the server report, or null when it is off-contract. */
export function parseArtisanPerformance(raw: unknown): ArtisanPerformanceReport | null {
  if (!isObj(raw)) return null;
  const p = raw.period;
  if (!isObj(p)) return null;
  const { current_start, current_end, previous_start, previous_end, boundary } = p;
  if (
    !isInstant(current_start) ||
    !isInstant(current_end) ||
    !isInstant(previous_start) ||
    !isInstant(previous_end) ||
    typeof boundary !== "string" ||
    !boundary
  ) {
    return null;
  }
  // The route and the RPC refuse non-contiguous or reversed intervals: so does the client.
  if (
    Date.parse(current_end) <= Date.parse(current_start) ||
    Date.parse(previous_end) <= Date.parse(previous_start) ||
    Date.parse(previous_end) !== Date.parse(current_start)
  ) {
    return null;
  }
  const current = bucket(raw.current);
  const previous = bucket(raw.previous);
  if (!current || !previous) return null;
  const r = raw.rating;
  if (!isObj(r) || !isCount(r.count) || typeof r.period !== "string") return null;
  const average = r.average;
  if (average === null) {
    if (r.count !== 0) return null;
  } else if (
    typeof average !== "number" ||
    !Number.isFinite(average) ||
    average < 1 ||
    average > 5 ||
    r.count === 0
  ) {
    return null;
  }
  const growth = raw.growth_percent;
  if (growth !== null && (typeof growth !== "number" || !Number.isFinite(growth))) return null;
  if (growth === null && previous.paid_service_cents > 0) return null;
  if (growth !== null && previous.paid_service_cents === 0) return null;
  if (raw.punctuality_rate !== null) return null;
  // money() formats euros: another currency would be mislabelled, so it is refused.
  if (raw.currency !== "eur") return null;
  if (typeof raw.scope !== "string" || !raw.scope) return null;
  if (typeof raw.limited !== "boolean") return null;
  if (!isObj(raw.basis)) return null;
  const basis: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw.basis)) {
    if (typeof v !== "string") return null;
    basis[k] = v;
  }
  return {
    period: { current_start, current_end, previous_start, previous_end, boundary },
    current,
    previous,
    rating: { average: average as number | null, count: r.count, period: r.period },
    growth_percent: growth as number | null,
    punctuality_rate: null,
    currency: "eur",
    scope: raw.scope,
    limited: raw.limited,
    basis,
  };
}

/** Nothing paid, nothing completed on both periods and no review at all. */
export function isEmptyReport(r: ArtisanPerformanceReport): boolean {
  const zero = (b: Bucket) => !b.paid_service_cents && !b.paid_count && !b.completed_missions_count;
  return zero(r.current) && zero(r.previous) && r.rating.count === 0;
}

/** Month label of a server period start, in the browser calendar used to build the request. */
export function periodLabel(startIso: string): string {
  return new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" }).format(
    new Date(startIso),
  );
}

/** « +12,5 % », « −3 % », « 0 % ». */
export function growthLabel(growth: number): string {
  const n = Math.abs(growth).toLocaleString("fr-FR", { maximumFractionDigits: 1 });
  return growth > 0 ? `+${n} %` : growth < 0 ? `−${n} %` : `${n} %`;
}

export const ratingLabel = (value: number) =>
  value.toLocaleString("fr-FR", { maximumFractionDigits: 1 });

/** Identity key of the live session: no key, no read. */
export function identityKey(ctx: { userId(): string | null; generation(): number }): string | null {
  const uid = ctx.userId();
  return uid ? `${uid}|${ctx.generation()}` : null;
}
