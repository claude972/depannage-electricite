import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
export class AcceptedTotalsUnavailable extends Error {
  constructor() { super("Les montants acceptés sont momentanément indisponibles. Réessayez."); }
}
const id = z.uuid();
const row = z.object({ quote_id: id, accepted_total_cents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict();
/** User JWT only. Missing/extra/duplicate/provider-capped rows are unknown, never base-total fallback. */
export async function enrichAcceptedTotals<T>(db: SupabaseClient, quotes: T[]): Promise<(T & { accepted_total_cents?: number })[]> {
  try {
    const sources = z.array(z.object({ id, status: z.enum(["sent", "accepted", "rejected"]), total_cents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).passthrough()).parse(quotes);
    const accepted = sources.filter(q => q.status === "accepted");
    const ids = accepted.map(q => id.parse(q.id));
    if (ids.length > 200 || new Set(ids).size !== ids.length) throw new AcceptedTotalsUnavailable();
    if (!ids.length) return sources.map(q => { const { accepted_total_cents: _, ...rest } = q as T & { accepted_total_cents?: unknown }; return rest as T & { accepted_total_cents?: number }; });
    const r = await db.rpc("accepted_quote_totals", { p_quote_ids: ids });
    if (r.error) throw new AcceptedTotalsUnavailable();
    const totals = z.array(row).max(200).parse(r.data);
    const byId = new Map(totals.map(t => [t.quote_id, t.accepted_total_cents]));
    if (totals.length !== ids.length || byId.size !== ids.length || totals.some(t => !ids.includes(t.quote_id))) throw new AcceptedTotalsUnavailable();
    return sources.map(q => {
      const { accepted_total_cents: _, ...rest } = q as T & { accepted_total_cents?: unknown };
      if (q.status !== "accepted") return rest as T & { accepted_total_cents?: number };
      const total = byId.get(q.id)!;
      if (!Number.isSafeInteger(q.total_cents) || total < (q.total_cents as number)) throw new AcceptedTotalsUnavailable();
      return { ...rest, accepted_total_cents: total } as T & { accepted_total_cents: number };
    });
  } catch { throw new AcceptedTotalsUnavailable(); }
}
