import { z } from "zod";
import { ApiError, assertOrigin, authenticatedClient, dbError } from "@/lib/supabase/server";
import { validated } from "@/lib/supabase/validation";
import { signPrivateDocument } from "@/lib/features/documents/signed-url";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
const uuid = z.uuid().transform(id => id.toLowerCase());
const input = z.object({
  id: uuid,
  intervention_id: uuid,
  document_id: uuid,
  body: z.string().trim().max(2000),
}).strict();
const receipt = input.omit({ document_id: true }).extend({
  author_id: uuid,
  attachment_id: uuid,
  created_at: z.iso.datetime({ offset: true }),
}).strict();
const reference = receipt.pick({ id: true, intervention_id: true, author_id: true, attachment_id: true })
  .extend({ attachment_id: uuid.nullable() });
const documentReference = z.object({
  path: z.string().min(1).max(1024),
  mime_type: z.enum(["image/jpeg", "image/png", "image/webp"]),
}).strict();

function failure(error: unknown) {
  const status = error instanceof ApiError ? error.status : error instanceof SyntaxError ? 400 : 503;
  return Response.json(
    { error: error instanceof ApiError ? error.message : "La photo du message est momentanément indisponible. Réessayez." },
    { status, headers: { ...headers, ...(status === 503 || status === 429 ? { "Retry-After": "2" } : {}) } },
  );
}

export async function POST(request: Request) {
  try {
    assertOrigin(request);
    if (new URL(request.url).search) throw new ApiError(422, "Paramètres inattendus.");
    const { db, user } = await authenticatedClient();
    const command = await validated(request, input);
    const result = await db.rpc("send_message_with_photo", {
      p_id: command.id,
      p_intervention_id: command.intervention_id,
      p_document_id: command.document_id,
      p_body: command.body,
    });
    dbError(result.error);
    const message = receipt.parse(result.data);
    if (message.id !== command.id || message.intervention_id !== command.intervention_id
      || message.author_id !== user.id || message.attachment_id !== command.document_id || message.body !== command.body) {
      throw new Error("Conversation photo receipt mismatch");
    }
    return Response.json({ message }, { status: 201, headers });
  } catch (error) {
    return failure(error);
  }
}

export async function GET(request: Request) {
  try {
    const { db } = await authenticatedClient();
    const query = new URL(request.url).searchParams;
    const id = uuid.safeParse(query.get("message_id"));
    if (query.size !== 1 || !id.success) throw new ApiError(422, "Message invalide.");

    const result = await db.from("messages").select("id,intervention_id,author_id,attachment_id")
      .eq("id", id.data).maybeSingle();
    dbError(result.error);
    if (result.data === null) throw new ApiError(404, "Cette photo est introuvable.");
    const message = reference.parse(result.data);
    if (message.id !== id.data) throw new Error("Conversation photo scope mismatch");
    if (!message.attachment_id) throw new ApiError(404, "Cette photo est introuvable.");

    const file = await db.from("documents").select("path,mime_type")
      .eq("id", message.attachment_id)
      .eq("intervention_id", message.intervention_id)
      .eq("owner_id", message.author_id)
      .maybeSingle();
    dbError(file.error);
    if (file.data === null) throw new ApiError(404, "Cette photo est introuvable.");
    const document = documentReference.parse(file.data);
    return Response.json({ url: await signPrivateDocument(db, document.path) }, { headers });
  } catch (error) {
    return failure(error);
  }
}
