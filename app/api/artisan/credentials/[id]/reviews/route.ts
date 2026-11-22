import { z } from "zod";
import { ApiError, apiError, assertOrigin, authenticatedClient, dbError } from "@/lib/supabase/server";
import { uuid, validated } from "@/lib/supabase/validation";

const pageSize = 50;
const headers = { "Cache-Control": "private, no-store" };
const decision = z.enum(["accepted", "changes_requested", "rejected"]);
const review = z.object({
  version: z.number().int().positive(),
  decision,
  reason: z.string().min(1).max(1000),
  reviewed_at: z.iso.datetime({ offset: true }),
}).strict();
const history = z.object({
  credential_id: uuid,
  kind: z.enum(["registration", "liability", "qualification", "other"]),
  expires_on: z.iso.date().nullable(),
  can_review: z.boolean(),
  current_version: z.number().int().nonnegative(),
  reviews: z.array(review).max(pageSize + 1),
}).strict();
const command = z.object({
  command_id: uuid,
  expected_version: z.number().int().min(0).max(2147483646),
  decision,
  reason: z.string().trim().min(1).max(1000),
}).strict();
const created = review.extend({ credential_id: uuid }).strict();
type Context = { params: Promise<{ id: string }> };

function unavailable() {
  return new ApiError(503, "L’historique de la pièce est momentanément indisponible. Réessayez.");
}

function fail(error: unknown) {
  const response = apiError(error);
  response.headers.set("Cache-Control", headers["Cache-Control"]);
  if (response.status === 503) response.headers.set("Retry-After", "2");
  return response;
}

async function credentialId(context: Context) {
  const parsed = uuid.safeParse((await context.params).id);
  if (!parsed.success) throw new ApiError(422, "Identifiant de pièce invalide.");
  return parsed.data.toLowerCase();
}

function beforeVersion(request: Request) {
  const query = new URL(request.url).searchParams;
  if (!query.size) return null;
  const raw = query.get("before");
  if (query.size !== 1 || !raw || !/^[1-9][0-9]{0,9}$/.test(raw) || Number(raw) <= 1 || Number(raw) > 2147483647) {
    throw new ApiError(422, "La page demandée est invalide.");
  }
  return Number(raw);
}

export async function GET(request: Request, context: Context) {
  try {
    const { db } = await authenticatedClient(request);
    const id = await credentialId(context);
    const before = beforeVersion(request);
    const result = await db.rpc("read_artisan_credential_reviews", { p_credential_id: id, p_before_version: before });
    dbError(result.error);

    const parsed = history.safeParse(result.data);
    if (!parsed.success || parsed.data.credential_id !== id) throw unavailable();
    const { reviews, current_version, ...credential } = parsed.data;
    const head = Math.min(current_version, before === null ? current_version : before - 1);
    if (reviews.length !== Math.min(head, pageSize + 1) || reviews.some((item, i) => item.version !== head - i)) {
      throw unavailable();
    }
    const items = reviews.slice(0, pageSize);
    const next = reviews.length > pageSize ? items.at(-1)?.version ?? null : null;

    return Response.json({ ...credential, current_version, reviews: items, next_before: next }, { headers });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request, context: Context) {
  try {
    assertOrigin(request);
    const { db } = await authenticatedClient(request);
    const id = await credentialId(context);
    if (new URL(request.url).searchParams.size) throw new ApiError(422, "Paramètres inattendus.");
    const data = await validated(request, command);
    const result = await db.rpc("review_artisan_credential", {
      p_credential_id: id,
      p_command_id: data.command_id,
      p_expected_version: data.expected_version,
      p_decision: data.decision,
      p_reason: data.reason,
    });
    dbError(result.error);

    const parsed = created.safeParse(result.data);
    if (!parsed.success || parsed.data.credential_id !== id || parsed.data.version !== data.expected_version + 1
      || parsed.data.decision !== data.decision || parsed.data.reason !== data.reason) throw unavailable();
    return Response.json({ review: parsed.data }, { headers });
  } catch (error) {
    return fail(error);
  }
}
