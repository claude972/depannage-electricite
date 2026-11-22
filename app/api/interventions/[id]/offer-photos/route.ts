import sharp from "sharp";
import { z } from "zod";
import { adminClient, authenticatedClient, apiError, ApiError, assertOrigin, dbError } from "@/lib/supabase/server";
import { validated, uuid } from "@/lib/supabase/validation";
import { MAX_DOCUMENT_BYTES } from "@/lib/shared/document-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
type Context = { params: Promise<{ id: string }> };
const rows = z.array(z.object({ id: uuid, path: z.string().regex(/^[0-9a-f-]{36}\/[0-9a-f-]{36}$/i) }).strict()).max(6);
const share = z.object({ document_id: uuid, shared: z.boolean() }).strict();
const unavailable = () => new ApiError(404, "Cette photo d’offre n’est pas disponible.");

async function dossier(context: Context) {
  const { id } = await context.params;
  if (!uuid.safeParse(id).success) throw new ApiError(422, "Référence invalide.");
  return id;
}
function failure(error: unknown) {
  const response = apiError(error);
  for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
  return response;
}

export async function GET(request: Request, context: Context) {
  try {
    const { user } = await authenticatedClient(request);
    const id = await dossier(context);
    const params = new URL(request.url).searchParams;
    const photo = params.get("photo");
    if (params.size > 0 && (params.size !== 1 || !uuid.safeParse(photo).success)) throw new ApiError(422, "Référence invalide.");
    const admin = adminClient();
    async function allowed() {
      const r = await admin.rpc("read_mission_offer_photos", { p_id: id, p_actor: user.id });
      dbError(r.error);
      return rows.parse(r.data);
    }
    const entries = await allowed();
    if (!photo) return Response.json({ items: entries.map(row => ({ id: row.id })) }, { headers });
    const document = entries.find(row => row.id === photo);
    if (!document) throw unavailable();
    const stored = await admin.storage.from("intervention-documents").download(document.path);
    if (stored.error || !stored.data || stored.data.size < 1 || stored.data.size > MAX_DOCUMENT_BYTES) throw unavailable();
    let image: Buffer;
    try {
      image = await sharp(Buffer.from(await stored.data.arrayBuffer()), { limitInputPixels: 20000000, failOn: "error" })
        .rotate().resize({ width: 960, height: 960, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 78 }).timeout({ seconds: 3 }).toBuffer();
    } catch { throw unavailable(); }
    if (!(await allowed()).some(row => row.id === photo && row.path === document.path)) throw unavailable();
    return new Response(new Uint8Array(image), { headers: { ...headers, "Content-Type": "image/jpeg" } });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    assertOrigin(request);
    const { db } = await authenticatedClient(request);
    const id = await dossier(context);
    if (new URL(request.url).searchParams.size) throw new ApiError(422, "Paramètres inattendus.");
    const input = await validated(request, share);
    const result = await db.rpc("set_mission_offer_photo", { p_id: id, p_document_id: input.document_id, p_shared: input.shared });
    dbError(result.error);
    if (result.data !== input.shared) throw new ApiError(503, "Le partage de cette photo doit être vérifié.");
    return Response.json({ shared: result.data }, { headers });
  } catch (error) { return failure(error); }
}
