// ENT-04 / SYS-06 — « Pièces du site » (documents attached to the SITE itself), pure model.
// STRICT MIRROR of app/api/sites/[id]/documents/route.ts (34aa005):
//   GET  /api/sites/<id>/documents[?cursor=…] → { documents: [{ id, site_id, name, mime_type, kind,
//        created_at }], page: { limit: 25, has_more, next_cursor } }   (created_at DESC, id DESC)
//   GET  /api/sites/<id>/documents?id=<exact> → { url }   (signed, private)
//   POST multipart { file, kind ∈ plan|maintenance|compliance|other } → 201 { document }
//   The server proves RLS, can_manage_site and an ACTIVE site; 401/403/404/409/413/422; 503 +
//   Retry-After. The POST has no idempotency key: after an uncertain outcome the list is re-read and
//   nothing is resent automatically.
import { z } from "zod";

export const SITE_ATTACHMENT_KINDS = ["plan", "maintenance", "compliance", "other"] as const;
export type AttachmentKind = (typeof SITE_ATTACHMENT_KINDS)[number];
export const KIND_LABEL: Record<AttachmentKind, string> = { plan: "Plan", maintenance: "Maintenance", compliance: "Conformité", other: "Autre" };
export type Context = { generation(): number; userId(): string | null };

const instant = z.iso.datetime({ offset: true }).max(40);
const documentSchema = z
  .object({
    id: z.uuid(),
    site_id: z.uuid(),
    name: z.string().min(1).max(160),
    mime_type: z.enum(["application/pdf", "image/jpeg", "image/png", "image/webp"]),
    kind: z.enum(SITE_ATTACHMENT_KINDS),
    created_at: instant,
  })
  .strict();
export type SiteAttachment = z.infer<typeof documentSchema>;
const pageSchema = z
  .object({
    documents: z.array(documentSchema).max(25),
    page: z.object({ limit: z.literal(25), has_more: z.boolean(), next_cursor: z.string().regex(/^[A-Za-z0-9_-]{1,600}$/).nullable() }).strict(),
  })
  .strict();
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function parseAttachmentPage(body: unknown, siteId: string) {
  const r = pageSchema.safeParse(body);
  if (!r.success) return null;
  const p = r.data;
  if (p.page.has_more !== (p.page.next_cursor !== null)) return null;
  if (p.documents.some((d) => !same(d.site_id, siteId))) return null;
  if (new Set(p.documents.map((d) => d.id.toLowerCase())).size !== p.documents.length) return null;
  return p;
}
/** 201 receipt for exactly this site and kind; null otherwise (outcome uncertain). */
export function parseUploadReceipt(body: unknown, siteId: string, kind: AttachmentKind): SiteAttachment | null {
  const r = z.object({ document: documentSchema }).strict().safeParse(body);
  return r.success && same(r.data.document.site_id, siteId) && r.data.document.kind === kind ? r.data.document : null;
}

const path = (siteId: string) => `/api/sites/${encodeURIComponent(siteId)}/documents`;
export const listUrl = (siteId: string, cursor: string | null) => `${path(siteId)}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`;
export const signUrl = (siteId: string, id: string) => `${path(siteId)}?id=${encodeURIComponent(id)}`;
export const uploadUrl = path;

export type Result = { status: number; body: unknown; retryAfter: number | null };
export async function request(fetcher: typeof fetch, url: string, init: RequestInit = { method: "GET" }, timeoutMs = 30_000): Promise<Result> {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<Result>((resolve) => {
    timer = setTimeout(() => {
      controller?.abort();
      resolve({ status: -1, body: null, retryAfter: null });
    }, timeoutMs);
  });
  const run = (async (): Promise<Result> => {
    try {
      const r = await fetcher(url, { ...init, credentials: "same-origin", cache: "no-store", ...(controller ? { signal: controller.signal } : {}) });
      const ra = Number(r.headers?.get?.("Retry-After"));
      return { status: r.status, body: await r.json().catch(() => null), retryAfter: Number.isFinite(ra) && ra > 0 ? Math.min(ra, 120) : null };
    } catch {
      return { status: 0, body: null, retryAfter: null };
    }
  })();
  try {
    return await Promise.race([run, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** Outcome of a POST: only 201 + exact receipt is a success; 4xx are proven refusals; the rest is uncertain. */
export function uploadOutcome(r: Result, siteId: string, kind: AttachmentKind): { kind: "done"; document: SiteAttachment } | { kind: "refused"; message: string } | { kind: "uncertain" } {
  if (r.status === 201) {
    const d = parseUploadReceipt(r.body, siteId, kind);
    return d ? { kind: "done", document: d } : { kind: "uncertain" };
  }
  const msg = r.body && typeof r.body === "object" && typeof (r.body as { error?: unknown }).error === "string" ? (r.body as { error: string }).error : "";
  if (r.status === 401) return { kind: "refused", message: "Votre session a expiré. Reconnectez-vous." };
  if (r.status === 403) return { kind: "refused", message: msg || "Votre accès à ce site est en lecture seule." };
  if (r.status === 409) return { kind: "refused", message: msg || "Ce site est archivé." };
  if (r.status === 413 || r.status === 422 || r.status === 429) return { kind: "refused", message: msg || "Le fichier n’a pas été accepté." };
  return { kind: "uncertain" }; // 502 / 503 / network / timeout / unverifiable receipt
}

export const ATTACH_COPY = {
  title: "Pièces du site",
  hint: "Plans, documents de maintenance et de conformité propres au site (PDF, JPEG, PNG ou WebP, 4 Mo au plus).",
  loading: "Chargement des pièces du site…",
  empty: "Aucune pièce n’est rattachée à ce site.",
  failed: "Les pièces du site n’ont pas pu être chargées.",
  refused401: "Votre session a expiré. Reconnectez-vous pour voir les pièces du site.",
  refused: "Les pièces de ce site ne sont pas accessibles avec vos droits.",
  cursor: "La liste a changé : elle repart de la première page.",
  more: "Afficher plus",
  moreFailed: "La suite n’a pas pu être chargée.",
  openFailed: "Le lien de téléchargement est indisponible.",
  readOnly: "Ajout de pièces réservé aux gestionnaires du site actif.",
  uncertain:
    "L’envoi n’a pas pu être confirmé. La liste a été relue : vérifiez si la pièce y figure avant de la renvoyer. Rien n’est renvoyé automatiquement.",
  sent: "Pièce ajoutée au site.",
} as const;
