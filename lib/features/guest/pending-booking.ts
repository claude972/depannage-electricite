import {estimateSnapshot,estimateMatchesCap} from './estimate-snapshot';
import { z } from "zod";
import { ApiError, authenticatedClient, assertOrigin, dbError } from "@/lib/supabase/server";
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
const pending = z.object({
  request_id: z.string().uuid(), method: z.literal("card_hold"),
  status: z.enum(["prepared", "checkout_open", "authorized", "cancelling"]),
  expected_max_cents: z.number().int().positive().max(2147483647),
  estimate: estimateSnapshot.optional(),
  created_at: z.string().max(64).refine(v => /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v))),
}).strict().refine(value => !value.estimate || estimateMatchesCap(value.estimate,value.expected_max_cents));
const result = z.object({ pending: pending.nullable() }).strict();
const unavailable = () => new ApiError(503, "La tentative en cours n’a pas pu être vérifiée. Réessayez.");
export async function pendingBooking(request: Request) {
  try {
    assertOrigin(request);
    if ([...new URL(request.url).searchParams].length) throw new ApiError(422, "Cette lecture ne prend aucun paramètre.");
    const { db, user } = await authenticatedClient();
    const profile = await db.from("profiles").select("id,role").eq("id", user.id).maybeSingle();
    dbError(profile.error);
    if (!profile.data || profile.data.id !== user.id) throw unavailable();
    if (profile.data.role !== "client") throw new ApiError(409, "Utilisez votre espace professionnel pour cette action.");
    // Website only (cookie session): the account is an e-mail address confirmed by its link.
    if (!user.email_confirmed_at) throw new ApiError(403, "Confirmez l’adresse e-mail de votre compte pour retrouver votre tentative.");
    const response = await db.rpc("guest_booking_pending"); dbError(response.error);
    const parsed = result.safeParse(response.data);
    if (!parsed.success) throw unavailable();
    return Response.json(parsed.data, { headers });
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 503;
    return Response.json({ error: error instanceof ApiError ? error.message : "La tentative en cours n’a pas pu être vérifiée. Réessayez." }, { status, headers: { ...headers, ...(status === 503 ? { "Retry-After": "2" } : {}) } });
  }
}
