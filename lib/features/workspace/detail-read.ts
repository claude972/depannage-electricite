import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

export const DETAIL_PROJECTIONS = {
  intervention: "id,client_id,artisan_id,site_id,category,description,address,postal_code,city,urgency,estimate_min_cents,estimate_max_cents,status,created_at,updated_at,completed_at,paid_at,travel_stage",
  quotes: "id,intervention_id,artisan_id,lines,subtotal_cents,tax_rate,tax_cents,total_cents,status,created_at,accepted_at",
  payments: "id,quote_id,total_cents,currency,status,created_at,paid_at",
  messages: "id,intervention_id,author_id,body,created_at",
  documents: "id,intervention_id,owner_id,name,mime_type,created_at",
  appointments: "intervention_id,starts_at,ends_at,note,updated_by,updated_at",
  site: "id,organization_id,name,type,address,budget_cents,created_at",
  organization: "id,name,owner_id,created_at",
} as const;
export const detailIdSchema = z.uuid();
const date = z.iso.datetime({ offset: true });
const cents = z.number().int().nonnegative();
const rowSchemas = {
  intervention: z.object({ id: detailIdSchema, client_id: detailIdSchema, artisan_id: detailIdSchema.nullable(), site_id: detailIdSchema.nullable(),
    category: z.enum(["outage", "panel", "socket", "lighting", "diagnostic"]), description: z.string(), address: z.string(), postal_code: z.string().regex(/^[0-9]{5}$/), city: z.string(), urgency: z.enum(["urgent", "scheduled"]),
    estimate_min_cents: cents, estimate_max_cents: cents, status: z.enum(["requested", "assigned", "quoted", "accepted", "in_progress", "completed", "paid", "cancelled"]),
    created_at: date, updated_at: date, completed_at: date.nullable(), paid_at: date.nullable(), travel_stage: z.enum(["planned", "en_route", "on_site"]) }).strict(),
  quotes: z.object({ id: detailIdSchema, intervention_id: detailIdSchema, artisan_id: detailIdSchema, lines: z.array(z.object({ label: z.string(), quantity: z.number().int().positive(), unit_price_cents: cents }).strict()), subtotal_cents: cents, tax_rate: z.union([z.literal(0), z.literal(5.5), z.literal(10), z.literal(20)]), tax_cents: cents, total_cents: cents, status: z.enum(["sent", "accepted", "rejected"]), created_at: date, accepted_at: date.nullable() }).strict(),
  payments: z.object({ id: detailIdSchema, quote_id: detailIdSchema, total_cents: cents, currency: z.literal("eur"), status: z.enum(["pending", "paid", "failed"]), created_at: date, paid_at: date.nullable() }).strict(),
  messages: z.object({ id: detailIdSchema, intervention_id: detailIdSchema, author_id: detailIdSchema, body: z.string(), created_at: date }).strict(),
  documents: z.object({ id: detailIdSchema, intervention_id: detailIdSchema, owner_id: detailIdSchema, name: z.string(), mime_type: z.string(), created_at: date }).strict(),
  appointments: z.object({ intervention_id: detailIdSchema, starts_at: date, ends_at: date, note: z.string(), updated_by: detailIdSchema, updated_at: date }).strict(),
  site: z.object({ id: detailIdSchema, organization_id: detailIdSchema, name: z.string(), type: z.enum(["syndic", "restaurant", "office", "erp"]), address: z.string(), budget_cents: cents, created_at: date }).strict(),
  organization: z.object({ id: detailIdSchema, name: z.string(), owner_id: detailIdSchema, created_at: date }).strict(),
};
const unavailable = z.object({ status: z.literal("error") }).strict();
const absent = z.union([z.object({ status: z.literal("none") }).strict(), z.object({ status: z.literal("hidden") }).strict(), unavailable]);
const entity = <S extends z.ZodType>(schema: S) => z.union([z.object({ status: z.literal("ok"), value: schema }).strict(), absent]);
const list = <S extends z.ZodType>(schema: S, limit: number) => z.union([z.object({ status: z.literal("ok"), items: z.array(schema).max(limit), limited: z.boolean() }).strict(), unavailable]);
export const detailReadSchema = z.object({
  intervention: rowSchemas.intervention, site: entity(rowSchemas.site), organization: entity(rowSchemas.organization),
  quotes: list(rowSchemas.quotes, 20), messages: list(rowSchemas.messages, 200), documents: list(rowSchemas.documents, 50), appointments: list(rowSchemas.appointments, 50),
  payments: z.union([z.object({ status: z.literal("ok"), items: z.array(rowSchemas.payments).max(20), limited: z.boolean(), incomplete: z.boolean() }).strict(), unavailable]),
  generated_at: date,
}).strict();
export type DetailRead = z.infer<typeof detailReadSchema>;
const limitMetadata = <N extends number>(limit: N) => z.object({ limit: z.literal(limit), limited: z.boolean() }).strict();
export const workspaceLimitsSchema = z.object({ interventions: limitMetadata(100), quotes: limitMetadata(200), sites: limitMetadata(100), organizations: limitMetadata(50) }).strict();
export type WorkspaceLimits = z.infer<typeof workspaceLimitsSchema>;
export class DetailReadUnavailable extends Error {
  constructor() { super("Les données sont momentanément indisponibles. Réessayez."); }
}
type Row = Record<string, unknown>;
/** L+1 must actually be read; no guessed total and no extra row exposed. */
export function workspaceWindow(data: unknown, limit: number): { rows: (Row & { id: string })[]; limit: number; limited: boolean } {
  if (!Array.isArray(data) || data.length > limit + 1 || !data.every(r => r && typeof r === "object" && detailIdSchema.safeParse(r.id).success)) throw new DetailReadUnavailable();
  return { rows: data.slice(0, limit), limit, limited: data.length > limit };
}

/** User-scoped client only: caller passes authenticatedClient().db, never an admin client. */
export async function readInterventionDetail(db: SupabaseClient, id: string): Promise<DetailRead | null> {
  const parent = async () => {
    try {
      const r = await db.from("interventions").select(DETAIL_PROJECTIONS.intervention).eq("id", id).limit(2);
      if (r.error || !Array.isArray(r.data) || r.data.length > 1) throw new DetailReadUnavailable();
      if (r.data.length === 0) return null;
      const parsed = rowSchemas.intervention.parse(r.data[0]);
      if (parsed.id !== id) throw new DetailReadUnavailable();
      return parsed;
    } catch { throw new DetailReadUnavailable(); }
  };
  const intervention = await parent();
  if (!intervention) return null;
  const relatedList = async <K extends "quotes" | "messages" | "documents" | "appointments">(kind: K, table: string, limit: number) => {
    try {
      const query = db.from(table).select(DETAIL_PROJECTIONS[kind]).eq("intervention_id", id);
      const r = await query.order(kind === "appointments" ? "starts_at" : "created_at", { ascending: false }).order(kind === "appointments" ? "intervention_id" : "id").limit(limit + 1);
      if (r.error || !Array.isArray(r.data) || r.data.length > limit + 1) return { status: "error" as const };
      const rows = z.array(rowSchemas[kind]).parse(r.data);
      if (rows.some(row => row.intervention_id !== id)) return { status: "error" as const };
      return { status: "ok" as const, items: rows.slice(0, limit), limited: rows.length > limit };
    } catch { return { status: "error" as const }; }
  };
  const relatedEntities = async () => {
    const none = { status: "none" as const }, hidden = { status: "hidden" as const }, error = { status: "error" as const };
    if (intervention.site_id === null) return { site: none, organization: none };
    let site;
    try {
      const r = await db.from("sites").select(DETAIL_PROJECTIONS.site).eq("id", intervention.site_id).limit(2);
      if (r.error || !Array.isArray(r.data) || r.data.length > 1) return { site: error, organization: error };
      if (r.data.length === 0) return { site: hidden, organization: hidden };
      site = rowSchemas.site.parse(r.data[0]);
      if (site.id !== intervention.site_id) return { site: error, organization: error };
    } catch { return { site: error, organization: error }; }
    const siteResult = { status: "ok" as const, value: site };
    try {
      const r = await db.from("organizations").select(DETAIL_PROJECTIONS.organization).eq("id", site.organization_id).limit(2);
      if (r.error || !Array.isArray(r.data) || r.data.length > 1) return { site: siteResult, organization: error };
      if (r.data.length === 0) return { site: siteResult, organization: hidden };
      const org = rowSchemas.organization.parse(r.data[0]);
      return { site: siteResult, organization: org.id === site.organization_id ? { status: "ok" as const, value: org } : error };
    } catch { return { site: siteResult, organization: error }; }
  };
  const relatedPayments = async () => {
    try {
      const scope = await db.from("quotes").select("id", { count: "exact" }).eq("intervention_id", id).order("created_at", { ascending: false }).order("id").limit(200);
      if (scope.error || !Number.isSafeInteger(scope.count) || scope.count! < 0 || !Array.isArray(scope.data) || scope.data.length !== Math.min(scope.count!, 200)) return { status: "error" as const };
      const ids = z.array(z.object({ id: detailIdSchema }).strict()).parse(scope.data).map(r => r.id);
      if (new Set(ids).size !== ids.length) return { status: "error" as const };
      const incomplete = scope.count! > 200;
      if (!ids.length) return { status: "ok" as const, items: [], limited: false, incomplete };
      const r = await db.from("payments").select(DETAIL_PROJECTIONS.payments).in("quote_id", ids).order("created_at", { ascending: false }).order("id").limit(21);
      if (r.error || !Array.isArray(r.data) || r.data.length > 21) return { status: "error" as const };
      const rows = z.array(rowSchemas.payments).parse(r.data);
      if (rows.some(row => !ids.includes(row.quote_id))) return { status: "error" as const };
      return { status: "ok" as const, items: rows.slice(0, 20), limited: rows.length > 20, incomplete };
    } catch { return { status: "error" as const }; }
  };
  const [entities, quotes, messages, documents, appointments, payments] = await Promise.all([
    relatedEntities(), relatedList("quotes", "quotes", 20), relatedList("messages", "messages", 200), relatedList("documents", "documents", 50), relatedList("appointments", "intervention_appointments", 50), relatedPayments(),
  ]);
  // Rights/assignment may have changed while reading dependencies. Discard rather than mix epochs.
  const current = await parent();
  if (!current) return null;
  if (["updated_at", "client_id", "artisan_id", "site_id", "status"].some(key => current[key as keyof typeof current] !== intervention[key as keyof typeof intervention])) throw new DetailReadUnavailable();
  return detailReadSchema.parse({ intervention, ...entities, quotes, messages, documents, appointments, payments, generated_at: new Date().toISOString() });
}
