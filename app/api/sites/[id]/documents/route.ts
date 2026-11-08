import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { adminClient, ApiError, apiError, assertOrigin, authenticatedClient, dbError } from "@/lib/supabase/server";
import { DOCUMENT_BUCKET, documentNameFor, MAX_DOCUMENT_BYTES, MAX_REQUEST_BYTES, validateDocumentUpload } from "@/lib/shared/document-policy";
import { validated } from "@/lib/supabase/validation";
import { signPrivateDocument } from "@/lib/features/documents/signed-url";
import { persistPrivateWebDocument, WebUploadError } from "@/lib/features/documents/web-upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
const size = 25;
const uuid = z.uuid().transform(id => id.toLowerCase());
const instant = z.iso.datetime({ offset: true }).max(40);
const kindSchema = z.enum(["plan", "maintenance", "compliance", "other"]);
const stateSchema = z.enum(["current", "history"]);
const revision = z.number().int().min(1).max(2147483647);
const documentSchema = z.object({
  id: uuid, site_id: uuid, name: z.string().min(1).max(160),
  mime_type: z.enum(["application/pdf", "image/jpeg", "image/png", "image/webp"]),
  kind: kindSchema, created_at: instant,
  version: revision, revision, replaces_id: uuid.nullable(),
  replaced_at: instant.nullable(), archived_at: instant.nullable(),
}).strict();
const finalizedSchema = documentSchema.extend({ owner_id: uuid, path: z.string() }).strict();
const cursorSchema = z.object({ v: z.literal(2), actor: uuid, site: uuid, id: uuid, at: instant, state: stateSchema }).strict();
const archiveCommand = z.object({
  id: uuid, action: z.enum(["archive", "restore"]), expected_revision: revision.max(2147483646),
}).strict();
const fields = "id,site_id,name,mime_type,kind,created_at,version,revision,replaces_id,replaced_at,archived_at";

type Context = { params: Promise<{ id: string }> };

async function readSite(db: SupabaseClient, siteId: string) {
  const r = await db.from("sites").select("id,archived_at").eq("id", siteId).maybeSingle();
  dbError(r.error);
  if (r.data === null) throw new ApiError(404, "Site introuvable.");
  const site = z.object({ id: uuid, archived_at: instant.nullable() }).strict().parse(r.data);
  if (site.id !== siteId) throw new ApiError(503, "Le site doit être vérifié.");
  return site;
}

async function requireWritableSite(db: SupabaseClient, siteId: string) {
  const site = await readSite(db, siteId);
  const permission = await db.rpc("can_manage_site", { p_site_id: siteId });
  dbError(permission.error);
  if (permission.data !== true) throw new ApiError(403, "Votre accès à ce site est en lecture seule.");
  if (site.archived_at) throw new ApiError(409, "Ce site est archivé.");
}

function publicDocument(value: unknown) {
  const row = finalizedSchema.safeParse(value);
  if (!row.success) return null;
  const { owner_id: ownerId, path, ...document } = row.data;
  return { ownerId, path, document };
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
    const state = stateSchema.safeParse(query.get("state") ?? "current");
    if (!state.success || request.url.length > 2048
      || [...query.keys()].some(key => !["id", "cursor", "state"].includes(key) || query.getAll(key).length !== 1)
      || (query.has("id") && query.size !== 1)) throw new ApiError(422, "Paramètres de document invalides.");

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
    list = state.data === "current" ? list.is("replaced_at", null).is("archived_at", null)
      : list.or("replaced_at.not.is.null,archived_at.not.is.null");
    const rawCursor = query.get("cursor");
    if (rawCursor !== null) {
      try {
        if (!/^[A-Za-z0-9_-]{1,600}$/.test(rawCursor)) throw Error();
        const bytes = Buffer.from(rawCursor, "base64url");
        if (bytes.toString("base64url") !== rawCursor) throw Error();
        const cursor = cursorSchema.parse(JSON.parse(bytes.toString("utf8")));
        if (cursor.actor !== user.id.toLowerCase() || cursor.site !== siteId || cursor.state !== state.data) throw Error();
        list = list.or(`created_at.lt."${cursor.at}",and(created_at.eq."${cursor.at}",id.lt.${cursor.id})`);
      } catch {
        throw new ApiError(422, "Curseur invalide. Rechargez les documents du site.");
      }
    }

    const result = await list.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(size + 1);
    dbError(result.error);
    const rows = z.array(documentSchema).max(size + 1).parse(result.data);
    const historical = state.data === "history";
    if (rows.some(row => row.site_id !== siteId || Boolean(row.replaced_at || row.archived_at) !== historical)
      || new Set(rows.map(row => row.id)).size !== rows.length)
      throw new ApiError(503, "Le périmètre des documents doit être vérifié.");
    await readSite(db, siteId);
    const documents = rows.slice(0, size);
    const last = documents.at(-1);
    const next = rows.length > size && last
      ? Buffer.from(JSON.stringify({ v: 2, actor: user.id, site: siteId, id: last.id, at: last.created_at, state: state.data })).toString("base64url")
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
    await requireWritableSite(db, siteId);

    if (Number(request.headers.get("content-length") || 0) > MAX_REQUEST_BYTES)
      throw new ApiError(413, "Le fichier doit faire moins de 4 Mo.");
    let form: FormData;
    try { form = await request.formData(); }
    catch { throw new ApiError(422, "Le formulaire de dépôt est invalide."); }
    if ([...form.keys()].some(key => !["file", "kind", "replaces_id", "command_id"].includes(key) || form.getAll(key).length !== 1))
      throw new ApiError(422, "Le formulaire de dépôt est invalide.");
    const file = form.get("file");
    const kind = kindSchema.safeParse(form.get("kind"));
    const replaces = uuid.nullable().safeParse(form.get("replaces_id"));
    const command = uuid.safeParse(form.get("command_id"));
    if (!command.success) throw new ApiError(422, "Référence de dépôt invalide.");
    if (!(file instanceof File) || file.size < 1 || file.size > MAX_DOCUMENT_BYTES || !kind.success || !replaces.success)
      throw new ApiError(422, "Choisissez un type et un fichier PDF, JPEG, PNG ou WebP de moins de 4 Mo.");

    const bytes = new Uint8Array(await file.arrayBuffer());
    const verdict = validateDocumentUpload({ size: file.size, declaredType: file.type, bytes });
    if (!verdict.ok) throw new ApiError(422, "Le contenu du fichier ne correspond pas à un format autorisé.");
    const id = command.data, owner = user.id.toLowerCase();
    const path = `sites/${siteId}/${owner}/${id}`, name = documentNameFor(file.name);
    const args = {
      p_site: siteId, p_command_id: id, p_name: name, p_mime: verdict.mime, p_kind: kind.data,
      p_replaces: replaces.data, p_content_sha256: createHash("sha256").update(bytes).digest("hex"),
    };
    const readback = () => db.rpc("site_document_upload_command", { ...args, p_finalize: false });
    const project = (value: unknown) => {
      const projected = publicDocument(value);
      if (!projected) return null;
      const { document: item, path: storedPath, ownerId } = projected;
      return item.id === id && item.site_id === siteId && ownerId === owner && storedPath === path
        && item.name === name && item.mime_type === verdict.mime && item.kind === kind.data
        && item.replaces_id === replaces.data && (replaces.data ? item.version > 1 : item.version === 1) ? item : null;
    };
    const prior = await readback();
    dbError(prior.error);
    if (prior.data !== null) {
      const document = project(prior.data);
      if (!document) throw new ApiError(503, "Le dépôt précédent doit être vérifié.");
      return Response.json({ document }, { status: 201, headers });
    }

    let expectedVersion = 1;
    if (replaces.data) {
      const source = await db.from("site_documents").select(fields).eq("site_id", siteId).eq("id", replaces.data).maybeSingle();
      dbError(source.error);
      if (!source.data) throw new ApiError(404, "Document introuvable.");
      const old = documentSchema.parse(source.data);
      if (old.site_id !== siteId || old.id !== replaces.data) throw new ApiError(503, "Le document doit être vérifié.");
      if (old.archived_at || old.replaced_at || old.kind !== kind.data || old.version >= 2147483647)
        throw new ApiError(409, "Cette pièce a changé. Rechargez la liste avant de la remplacer.");
      expectedVersion = old.version + 1;
    }

    const throttle = await db.rpc("check_upload_limit");
    dbError(throttle.error);
    const admin = adminClient();
    const document = await persistPrivateWebDocument(admin, {
      path, bytes, mime: verdict.mime, scope: "du site", readback,
      finalize: () => db.rpc("site_document_upload_command", { ...args, p_finalize: true }),
      project(value) {
        const item = project(value);
        return item?.version === expectedVersion ? item : null;
      },
      async resumeUploadedObject() {
        const stored = await admin.storage.from(DOCUMENT_BUCKET).download(path);
        dbError(stored.error);
        return stored.data !== null && stored.data.size === bytes.byteLength
          && Buffer.from(await stored.data.arrayBuffer()).equals(bytes);
      },
    });
    return Response.json({ document }, { status: 201, headers });
  } catch (error) {
    return failure(error);
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    assertOrigin(request);
    const { db } = await authenticatedClient();
    const siteId = await siteIdFrom(context);
    if (new URL(request.url).searchParams.size) throw new ApiError(422, "Paramètres inattendus.");
    const command = await validated(request, archiveCommand);
    await requireWritableSite(db, siteId);
    const archive = command.action === "archive";
    const result = await db.rpc("set_site_document_archive", {
      p_site: siteId, p_id: command.id, p_archive: archive, p_expected_revision: command.expected_revision,
    });
    dbError(result.error);
    const row = publicDocument(result.data);
    if (!row || row.document.site_id !== siteId || row.document.id !== command.id || row.document.replaced_at !== null
      || Boolean(row.document.archived_at) !== archive || row.document.revision < command.expected_revision
      || row.document.revision > command.expected_revision + 1) {
      throw new ApiError(503, "Le nouvel état de la pièce doit être vérifié. Rechargez la liste.");
    }
    return Response.json({ document: row.document }, { headers });
  } catch (error) {
    return failure(error);
  }
}
