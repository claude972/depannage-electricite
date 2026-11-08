import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { adminClient, ApiError, apiError, assertOrigin, authenticatedClient, dbError } from "@/lib/supabase/server";
import { documentNameFor, MAX_DOCUMENT_BYTES, MAX_REQUEST_BYTES, validateDocumentUpload } from "@/lib/shared/document-policy";
import { signPrivateDocument } from "@/lib/features/documents/signed-url";
import { persistPrivateWebDocument, WebUploadError } from "@/lib/features/documents/web-upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
const size = 25;
const uuid = z.uuid().transform(id => id.toLowerCase());
const instant = z.iso.datetime({ offset: true }).max(40);
const kindSchema = z.enum(["plan", "maintenance", "compliance", "other"]);
const documentSchema = z.object({
  id: uuid, site_id: uuid, name: z.string().min(1).max(160),
  mime_type: z.enum(["application/pdf", "image/jpeg", "image/png", "image/webp"]),
  kind: kindSchema, created_at: instant,
}).strict();
const finalizedSchema = documentSchema.extend({ owner_id: uuid, path: z.string() }).strict();
const cursorSchema = z.object({ v: z.literal(1), actor: uuid, site: uuid, id: uuid, at: instant }).strict();
const fields = "id,site_id,name,mime_type,kind,created_at";
const finalizedFields = `${fields},owner_id,path`;

type Context = { params: Promise<{ id: string }> };

async function readSite(db: SupabaseClient, siteId: string) {
  const r = await db.from("sites").select("id,archived_at").eq("id", siteId).maybeSingle();
  dbError(r.error);
  if (r.data === null) throw new ApiError(404, "Site introuvable.");
  const site = z.object({ id: uuid, archived_at: instant.nullable() }).strict().parse(r.data);
  if (site.id !== siteId) throw new ApiError(503, "Le site doit être vérifié.");
  return site;
}

function failure(error: unknown) {
  const r = error instanceof WebUploadError
    ? Response.json({ error: error.message, ...error.details }, { status: error.status })
    : error instanceof z.ZodError
      ? Response.json({ error: "Les documents du site n’ont pas pu être vérifiés." }, { status: 503 })
      : apiError(error);
  for (const [name, value] of Object.entries(headers)) r.headers.set(name, value);
  if (r.status === 503) r.headers.set("Retry-After", "2");
  return r;
}

async function siteIdFrom(context: Context) {
  const result = uuid.safeParse((await context.params).id);
  if (!result.success) throw new ApiError(404, "Site introuvable.");
  return result.data;
}

export async function GET(request: Request, context: Context) {
  try {
    const { db, user } = await authenticatedClient();
    const siteId = await siteIdFrom(context);
    const query = new URL(request.url).searchParams;
    if (request.url.length > 2048 || [...query.keys()].some(key => !["id", "cursor"].includes(key) || query.getAll(key).length !== 1)
      || (query.has("id") && query.has("cursor"))) throw new ApiError(422, "Paramètres de document invalides.");

    await readSite(db, siteId);
    if (query.has("id")) {
      const id = uuid.safeParse(query.get("id"));
      if (!id.success) throw new ApiError(422, "Document invalide.");
      const row = await db.from("site_documents").select("id,site_id,owner_id,path").eq("site_id", siteId).eq("id", id.data).maybeSingle();
      dbError(row.error);
      if (row.data === null) throw new ApiError(404, "Document introuvable.");
      const item = z.object({ id: uuid, site_id: uuid, owner_id: uuid, path: z.string() }).strict().parse(row.data);
      if (item.id !== id.data || item.site_id !== siteId || item.path !== `sites/${siteId}/${item.owner_id}/${item.id}`)
        throw new ApiError(503, "Le document doit être vérifié.");
      return Response.json({ url: await signPrivateDocument(db, item.path) }, { headers });
    }

    let list = db.from("site_documents").select(fields).eq("site_id", siteId);
    const rawCursor = query.get("cursor");
    if (rawCursor !== null) {
      try {
        if (!/^[A-Za-z0-9_-]{1,600}$/.test(rawCursor)) throw Error();
        const bytes = Buffer.from(rawCursor, "base64url");
        if (bytes.toString("base64url") !== rawCursor) throw Error();
        const cursor = cursorSchema.parse(JSON.parse(bytes.toString("utf8")));
        if (cursor.actor !== user.id.toLowerCase() || cursor.site !== siteId) throw Error();
        list = list.or(`created_at.lt."${cursor.at}",and(created_at.eq."${cursor.at}",id.lt.${cursor.id})`);
      } catch {
        throw new ApiError(422, "Curseur invalide. Rechargez les documents du site.");
      }
    }

    const result = await list.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(size + 1);
    dbError(result.error);
    const rows = z.array(documentSchema).max(size + 1).parse(result.data);
    if (rows.some(row => row.site_id !== siteId) || new Set(rows.map(row => row.id)).size !== rows.length)
      throw new ApiError(503, "Le périmètre des documents doit être vérifié.");
    await readSite(db, siteId);
    const documents = rows.slice(0, size);
    const last = documents.at(-1);
    const next = rows.length > size && last
      ? Buffer.from(JSON.stringify({ v: 1, actor: user.id, site: siteId, id: last.id, at: last.created_at })).toString("base64url")
      : null;
    return Response.json({ documents, page: { limit: size, has_more: next !== null, next_cursor: next } }, { headers });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request, context: Context) {
  try {
    assertOrigin(request);
    const { db, user } = await authenticatedClient();
    const siteId = await siteIdFrom(context);
    if (new URL(request.url).searchParams.size) throw new ApiError(422, "Paramètres inattendus.");
    const site = await readSite(db, siteId);
    const permission = await db.rpc("can_manage_site", { p_site_id: siteId });
    dbError(permission.error);
    if (permission.data !== true) throw new ApiError(403, "Votre accès à ce site est en lecture seule.");
    if (site.archived_at) throw new ApiError(409, "Ce site est archivé.");

    if (Number(request.headers.get("content-length") || 0) > MAX_REQUEST_BYTES)
      throw new ApiError(413, "Le fichier doit faire moins de 4 Mo.");
    let form: FormData;
    try { form = await request.formData(); }
    catch { throw new ApiError(422, "Le formulaire de dépôt est invalide."); }
    if ([...form.keys()].some(key => !["file", "kind"].includes(key) || form.getAll(key).length !== 1))
      throw new ApiError(422, "Le formulaire de dépôt est invalide.");
    const file = form.get("file");
    const kind = kindSchema.safeParse(form.get("kind"));
    if (!(file instanceof File) || file.size < 1 || file.size > MAX_DOCUMENT_BYTES || !kind.success)
      throw new ApiError(422, "Choisissez un type et un fichier PDF, JPEG, PNG ou WebP de moins de 4 Mo.");

    const bytes = new Uint8Array(await file.arrayBuffer());
    const verdict = validateDocumentUpload({ size: file.size, declaredType: file.type, bytes });
    if (!verdict.ok) throw new ApiError(422, "Le contenu du fichier ne correspond pas à un format autorisé.");
    const throttle = await db.rpc("check_upload_limit");
    dbError(throttle.error);
    const id = randomUUID(), owner = user.id.toLowerCase();
    const path = `sites/${siteId}/${owner}/${id}`, name = documentNameFor(file.name);
    const admin = adminClient();
    const document = await persistPrivateWebDocument(admin, {
      path, bytes, mime: verdict.mime, scope: "du site",
      finalize: () => db.rpc("finalize_site_document_upload", {
        p_site: siteId, p_id: id, p_path: path, p_name: name, p_mime: verdict.mime, p_kind: kind.data,
      }),
      readback: () => admin.from("site_documents").select(finalizedFields).eq("id", id).maybeSingle(),
      project(value) {
        const parsed = finalizedSchema.safeParse(value);
        if (!parsed.success) return null;
        const { path: storedPath, owner_id, ...item } = parsed.data;
        return item.id === id && item.site_id === siteId && owner_id === owner && storedPath === path
          && item.name === name && item.mime_type === verdict.mime && item.kind === kind.data ? item : null;
      },
    });
    return Response.json({ document }, { status: 201, headers });
  } catch (error) {
    return failure(error);
  }
}
