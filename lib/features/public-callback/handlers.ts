import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { env } from "node:process";
import { z } from "zod";
import { adminClient, ApiError, authenticatedClient, dbError } from "@/lib/supabase/server";
import { validated } from "@/lib/supabase/validation";
import { normalizeCallbackPhone } from "@/lib/features/guest/phone-auth";
import { comparePostgresTime } from "@/lib/shared/postgres-time-order";
import { callbackPageNumber, callbackPageSize, callbackQueue, callbackReason } from "./contract";

const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
const intakeSchema = z.object({
  request_id: z.uuid(), phone: z.string().max(40), reason: callbackReason, consent: z.literal(true),
}).strict();
const retrySecondsSchema = z.number().int().min(0).max(3600);
const closeSchema = z.object({ id: z.uuid(), expected_version: z.literal(1) }).strict();
const available = () => env.PUBLIC_CALLBACK_INTAKE_ENABLED === "true";

function postRequest(request: Request) {
  const url = new URL(request.url);
  if (request.headers.get("origin") !== url.origin) throw new ApiError(403, "Origine de la requête non autorisée.");
  if (url.search) throw new ApiError(422, "Vérifiez le contenu envoyé.");
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") throw new ApiError(415, "Format de requête non pris en charge.");
}

function sourceKey(request: Request) {
  const secret = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new ApiError(503, "Le service sécurisé est en cours de configuration.");
  // Use the platform-provided address only when running behind Vercel's trusted edge.
  const forwarded = env.VERCEL === "1" ? request.headers.get("x-vercel-forwarded-for") : null;
  const version = forwarded && !forwarded.includes("%") ? isIP(forwarded) : 0;
  const address = version === 4 ? forwarded : version === 6 ? new URL(`http://[${forwarded}]`).hostname : "unknown";
  return createHmac("sha256", secret)
    .update(JSON.stringify(["public-callback-source", new URL(request.url).origin, address]))
    .digest("hex");
}

function failed(error: unknown) {
  const status = error instanceof ApiError ? error.status : error instanceof SyntaxError ? 400 : 503;
  const message = error instanceof ApiError ? error.message : status === 400 ? "Le contenu envoyé est invalide."
    : "Le service de rappel est momentanément indisponible. Réessayez.";
  return Response.json({ error: message }, { status, headers: {
    ...headers, ...(status === 503 || status === 429 ? { "Retry-After": status === 429 ? "60" : "2" } : {}),
  } });
}

export function getPublicCallback() {
  return Response.json({ available: available() }, { headers });
}

export async function postPublicCallback(request: Request) {
  try {
    postRequest(request);
    if (!available()) throw new ApiError(503, "Les demandes de rappel sont actuellement fermées.");
    const input = await validated(request, intakeSchema);
    const phone = normalizeCallbackPhone(input.phone);
    if (!phone) throw new ApiError(422, "Saisissez un numéro de téléphone valide avec son indicatif si nécessaire.");
    const result = await adminClient().rpc("submit_public_callback", {
      p_request_id: input.request_id, p_phone: phone, p_reason: input.reason, p_consent: input.consent,
      p_source_key: sourceKey(request),
    });
    dbError(result.error);
    const retrySeconds = retrySecondsSchema.parse(result.data);
    if (retrySeconds > 0) return Response.json({ error: "Trop de demandes de rappel. Réessayez après le délai indiqué." }, {
      status: 429, headers: { ...headers, "Retry-After": String(retrySeconds) },
    });
    return Response.json({ received: true }, { headers });
  } catch (error) { return failed(error); }
}

export async function getSupportCallbacks(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const status = params.get("status") ?? "open";
    const text = params.get("page") ?? "1";
    const page = callbackPageNumber.safeParse(Number(text));
    if (Array.from(params.keys()).some(key => !["status", "page"].includes(key) || params.getAll(key).length !== 1)
      || !["open", "closed"].includes(status) || !/^[1-9][0-9]{0,6}$/.test(text) || !page.success) {
      throw new ApiError(422, "Vérifiez les filtres de rappel.");
    }
    const { db } = await authenticatedClient();
    const result = await db.rpc("support_callback_queue", { p_closed: status === "closed", p_page: page.data });
    dbError(result.error);
    const data = callbackQueue.parse(result.data);
    const expected = Math.max(0, Math.min(callbackPageSize, data.total - (page.data - 1) * callbackPageSize));
    if (data.items.length !== expected || new Set(data.items.map(row => row.id)).size !== expected) throw Error("Invalid callback page");
    let prior: (typeof data.items)[number] | undefined;
    for (const row of data.items) {
      if (row.version !== (status === "closed" ? 2 : 1)) throw Error("Invalid callback status");
      if (prior && (comparePostgresTime(prior.created_at, row.created_at) || (prior.id < row.id ? -1 : 1)) < 0) {
        throw Error("Unordered callback page");
      }
      prior = row;
    }
    return Response.json({ ...data, page: { number: page.data, limit: callbackPageSize,
      pages: Math.max(1, Math.ceil(data.total / callbackPageSize)) } }, { headers });
  } catch (error) { return failed(error); }
}

export async function postSupportCallback(request: Request) {
  try {
    postRequest(request);
    const { db } = await authenticatedClient();
    const input = await validated(request, closeSchema);
    const result = await db.rpc("close_support_callback", { p_id: input.id, p_expected_version: input.expected_version });
    dbError(result.error);
    if (result.data !== true) throw Error("Unconfirmed callback closure");
    return Response.json({ closed: true }, { headers });
  } catch (error) { return failed(error); }
}
