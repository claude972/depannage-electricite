import { z } from "zod";
import {
  authenticatedClient,
  ApiError,
  apiError,
  assertOrigin,
  dbError,
} from "@/lib/supabase/server";
import { uuid, validated } from "@/lib/supabase/validation";

export const dynamic = "force-dynamic";

const headers = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
};
const job = z.object({
  id: uuid,
  category: z.enum(["outage", "panel", "socket", "lighting", "diagnostic"]),
  status: z.enum([
    "requested", "assigned", "quoted", "accepted", "in_progress",
    "completed", "paid", "cancelled",
  ]),
  created_at: z.iso.datetime({ offset: true }),
}).strict();
const state = z.object({
  link: job.nullable(),
  candidates: z.array(job).max(30),
  has_more: z.boolean(),
}).strict();
const receipt = z.object({ link: job, replayed: z.boolean() }).strict();
const command = z.object({ intervention_id: uuid }).strict();
type Context = { params: Promise<{ id: string }> };

async function target(request: Request, { params }: Context) {
  const id = uuid.safeParse((await params).id);
  if (!id.success || new URL(request.url).searchParams.size)
    throw new ApiError(422, "Référence ou paramètres invalides.");
  return id.data;
}

function failure(error: unknown) {
  const response = apiError(error);
  for (const [key, value] of Object.entries(headers))
    response.headers.set(key, value);
  if (response.status === 503) response.headers.set("Retry-After", "2");
  return response;
}

export async function GET(request: Request, context: Context) {
  try {
    const { db } = await authenticatedClient();
    const id = await target(request, context);
    const result = await db.rpc("read_warranty_corrective_intervention", {
      p_case_id: id,
    });
    dbError(result.error);
    const parsed = state.safeParse(result.data);
    if (!parsed.success)
      throw new ApiError(503, "Le dossier correctif doit être vérifié.");
    return Response.json(parsed.data, { headers });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request, context: Context) {
  try {
    assertOrigin(request);
    const { db } = await authenticatedClient();
    const id = await target(request, context);
    const input = await validated(request, command);
    const result = await db.rpc("link_warranty_corrective_intervention", {
      p_case_id: id,
      p_intervention_id: input.intervention_id,
    });
    dbError(result.error);
    const parsed = receipt.safeParse(result.data);
    if (!parsed.success || parsed.data.link.id !== input.intervention_id.toLowerCase())
      throw new ApiError(503, "Vérifiez le rattachement avant de réessayer.");
    return Response.json(parsed.data, { headers });
  } catch (error) {
    return failure(error);
  }
}
