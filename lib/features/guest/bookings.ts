import {estimateSnapshot,estimateMatchesCap} from './estimate-snapshot';
import { TextDecoder } from "node:util";
import { z } from "zod";
import { ApiError, authenticatedClient, assertOrigin, dbError } from "@/lib/supabase/server";
import { estimateReviewRefusal } from "@/lib/features/indicative-prices/review-refusal";
import { normalizePhone } from "./phone-auth";
import { cardHoldContext, openCardHold, authorizeCardHold, releaseCardHold } from "./card-hold";

const uuid = z.string().uuid();
const contact = z.object({ first_name: z.string().trim().min(1).max(60), last_name: z.string().trim().min(1).max(60), email: z.string().trim().max(254).refine(v => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)), phone: z.string().max(64).transform(normalizePhone).refine(v => v !== null) }).strict().refine(v => `${v.first_name} ${v.last_name}`.length <= 120);
const schema = z.object({ request_id: uuid, service_slug: z.string().max(80), category: z.enum(["outage", "panel", "socket", "lighting", "diagnostic"]), description: z.string().trim().min(10).max(4000), address: z.string().trim().min(5).max(500), postal_code: z.string().regex(/^\d{5}$/), city: z.string().trim().min(2).max(120), urgency: z.enum(["urgent", "scheduled"]), contact, payment_choice: z.enum(["on_site", "card_hold"]), reviewed_estimate_version:z.number().int().min(1).max(2147483647).optional() }).strict();
const keySchema = z.object({ request_id: uuid }).strict();
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
const unavailable = () => new ApiError(503, "La réservation est momentanément indisponible. Réessayez.");
async function body(request: Request) {
  if (!request.body) throw new ApiError(422, "Vérifiez les informations saisies.");
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > 32768) { await reader.cancel(); throw new ApiError(413, "Le contenu envoyé est trop volumineux."); } chunks.push(value); } } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let at = 0; for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { throw new ApiError(422, "Vérifiez les informations saisies."); }
}
async function identity() {
  const result = await authenticatedClient();
  const profile = await result.db.from("profiles").select("id,role").eq("id", result.user.id).maybeSingle();
  dbError(profile.error);
  if (!profile.data || profile.data.id !== result.user.id) throw unavailable();
  if (profile.data.role !== "client") throw new ApiError(409, "Utilisez votre espace professionnel pour cette action.");
  const phone = result.user.phone ? normalizePhone(`+${result.user.phone.replace(/^\+/, "")}`) : null;
  if (!(result.user.phone_confirmed_at && phone) && !result.user.email_confirmed_at) throw new ApiError(403, "Confirmez votre identité avant de réserver.");
  return result;
}

function validResult(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw unavailable();
  const v = value as Record<string, any>;
  const estimate=v.estimate===undefined?undefined:estimateSnapshot.safeParse(v.estimate);
  if(estimate&&!estimate.success)throw unavailable();
  const extra=estimate?.success?{estimate:estimate.data}:{};
  if(estimate?.success&&(v.status==='confirmed'?(estimate.data.min_cents!==v.intervention?.estimate_min_cents||!estimateMatchesCap(estimate.data,v.intervention?.estimate_max_cents)):!estimateMatchesCap(estimate.data,v.expected_max_cents)))throw unavailable();
  if (!v.payment || !["on_site", "card_hold"].includes(v.payment.method)) throw unavailable();
  if (v.status === "confirmed") {
    if (v.payment.method === "on_site" ? v.payment.status !== "due_on_site" : (!["authorized", "authorization_recorded"].includes(v.payment.status) || typeof v.payment.checked_at !== "string" || !Number.isFinite(Date.parse(v.payment.checked_at)) || Date.parse(v.payment.checked_at) > Date.now() + 30000)) throw unavailable();
    if (!uuid.safeParse(v.intervention?.id).success || typeof v.intervention.status !== "string" || !Number.isSafeInteger(v.intervention.estimate_min_cents) || !Number.isSafeInteger(v.intervention.estimate_max_cents) || !["due_on_site", "authorization_recorded", "authorized"].includes(v.payment.status)) throw unavailable();
    return { ...extra, status: "confirmed", intervention: { id: v.intervention.id, status: v.intervention.status, estimate_min_cents: v.intervention.estimate_min_cents, estimate_max_cents: v.intervention.estimate_max_cents }, payment: { method: v.payment.method, status: v.payment.status, ...(v.payment.method === "card_hold" ? { checked_at: typeof v.payment.checked_at === "string" ? v.payment.checked_at : null } : {}) } };
  }
  if (!uuid.safeParse(v.request_id).success || !["prepared", "checkout_open", "authorized", "cancelling", "cancelled"].includes(v.status) || !Number.isSafeInteger(v.expected_max_cents) || !["pending", "cancelled"].includes(v.payment.status)) throw unavailable();
  return { ...extra, request_id: v.request_id, status: v.status, expected_max_cents: v.expected_max_cents, payment: { method: v.payment.method, status: v.payment.status } };
}
export async function bookingRoute(request: Request, operation: "create" | "status" | "cancel" | "finalize") {
  try {
    assertOrigin(request);
    const { db, user } = await identity();
    if (operation === "status") {
      const query = new URL(request.url).searchParams;
      if ([...query.keys()].some(k => !["request_id", "intervention_id"].includes(k)) || [...query].length !== 1) throw new ApiError(422, "Vérifiez la référence.");
      const key = query.has("request_id") ? "request_id" : "intervention_id";
      const parsed = uuid.safeParse(query.get(key)); if (!parsed.success) throw new ApiError(422, "Vérifiez la référence.");
      const r = await db.rpc("phone_booking_status", { p_request_id: key === "request_id" ? parsed.data : null, p_intervention_id: key === "intervention_id" ? parsed.data : null }); dbError(r.error);
      return Response.json(validResult(r.data), { headers });
    }
    const parsed = (operation === "create" ? schema : keySchema).safeParse(await body(request));
    if (!parsed.success) throw new ApiError(422, "Vérifiez les informations saisies.");
    if (operation === "finalize") {
      const { request_id } = keySchema.parse(parsed.data);
      const context = cardHoldContext();
      // Fresh JWT ownership/role check precedes any privileged provider read.
      const current = await db.rpc("phone_booking_status", { p_request_id: request_id, p_intervention_id: null }); dbError(current.error);
      if (validResult(current.data).payment.method !== "card_hold") throw new ApiError(409, "Cette demande ne comporte pas d’empreinte bancaire.");
      await authorizeCardHold(user.id, request_id, context);
      const submitted = await db.rpc("submit_phone_booking", { p_request_id: request_id }); dbError(submitted.error);
      const result = validResult(submitted.data); if (result.status !== "confirmed") throw unavailable();
      return Response.json({ ...result, payment: { ...result.payment, status: "authorized" } }, { status: 201, headers });
    }
    if (operation === "create") {
      const data = schema.parse(parsed.data);
      const card = data.payment_choice === "card_hold" ? cardHoldContext() : null; // Before prepare/quota/provider mutation.
      const { request_id, contact, payment_choice, reviewed_estimate_version, ...payload } = data;
      if (!card) {
        const submitted = await db.rpc("create_on_site_booking_reviewed", { p_reviewed_estimate_version:reviewed_estimate_version??null, p_request_id: request_id, p_payload: payload, p_contact: { ...contact, email: contact.email.toLowerCase() } });
        const refusal = estimateReviewRefusal(submitted.error);
        if (refusal) return refusal;
        dbError(submitted.error);
        const result = validResult(submitted.data); if (result.status !== "confirmed" || result.payment.method !== "on_site") throw unavailable();
        return Response.json(result, { status: 201, headers });
      }
      const prepared = await db.rpc("prepare_phone_booking_reviewed", { p_reviewed_estimate_version:reviewed_estimate_version??null, p_request_id: request_id, p_payload: payload, p_contact: { ...contact, email: contact.email.toLowerCase() }, p_method: payment_choice });
      const refusal = estimateReviewRefusal(prepared.error);
      if (refusal) return refusal;
      dbError(prepared.error);
      const ready = validResult(prepared.data); if (ready.payment.method !== payment_choice) throw unavailable();
      if (ready.status === "confirmed") return Response.json(ready, { status: 201, headers });
      return Response.json(await openCardHold(user.id, request_id, card), { headers });
    }
    const { request_id } = keySchema.parse(parsed.data);
    const current = await db.rpc("phone_booking_status", { p_request_id: request_id, p_intervention_id: null }); dbError(current.error);
    const state = validResult(current.data);
    if (state.status === "confirmed") throw new ApiError(409, "Cette demande est déjà créée.");
    if (state.status === "cancelled") return Response.json(state, { headers });
    const card = state.payment.method === "card_hold" ? cardHoldContext() : null;
    const begin = await db.rpc("begin_phone_booking_cancel", { p_request_id: request_id }); dbError(begin.error); const begun = validResult(begin.data);
    if (card && begun.status !== "cancelled") await releaseCardHold(user.id, request_id, card);
    const cancelled = await db.rpc("cancel_phone_booking", { p_request_id: request_id }); dbError(cancelled.error);
    const result = validResult(cancelled.data); if (result.status !== "cancelled") throw unavailable();
    return Response.json(result, { headers });
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 503;
    return Response.json({ error: error instanceof ApiError ? error.message : "La réservation est momentanément indisponible. Réessayez." }, { status, headers: { ...headers, ...(status === 503 ? { "Retry-After": "2" } : {}) } });
  }
}
