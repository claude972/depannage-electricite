// ENT-04 — documents of ONE site (read-only), pure model. Contract (backend 8dfd979,
// lib/features/documents/history.ts + app/api/documents/history/route.ts):
//   GET /api/documents/history?site_id=<exact>&limit=25[&cursor=<opaque>]  (never with intervention_id)
//     → { documents: [{ id, intervention_id, owner_id, name, mime_type, created_at }],
//         page: { limit, has_more, next_cursor } }   (created_at DESC, id DESC)
//   The cursor is bound to the account and the site (sent back unchanged, same site only); the site
//   is proven under RLS (404 otherwise). 401 session; 422 params / cursor; 503 + Retry-After.
// Site documents always belong to a dossier: a row without intervention_id refuses the page.
import { parseDocumentPage, type DocumentPage } from "../../app/document-history";

export const SITE_DOCUMENT_PAGE_SIZE = 25;
export type Context = { generation(): number; userId(): string | null };

export function siteDocumentsUrl(siteId: string, cursor: string | null, limit = SITE_DOCUMENT_PAGE_SIZE): string {
  const q = new URLSearchParams({ site_id: siteId, limit: String(limit) });
  if (cursor) q.set("cursor", cursor);
  return `/api/documents/history?${q.toString()}`;
}
export function parseSiteDocumentPage(raw: unknown): DocumentPage | null {
  const p = parseDocumentPage(raw, "");
  if (!p) return null;
  if (p.documents.some((d) => !d.intervention_id)) return null;
  if (new Set(p.documents.map((d) => d.id)).size !== p.documents.length) return null;
  return p;
}

export type SiteDocOutcome =
  | ({ kind: "loaded" } & DocumentPage)
  | { kind: "refused"; status: 401 | 403 | 404 }
  | { kind: "cursor" }
  | { kind: "failed"; retryAfterS: number };

export async function fetchSiteDocuments(fetcher: typeof fetch, siteId: string, cursor: string | null): Promise<SiteDocOutcome> {
  let res: Response;
  try {
    res = await fetcher(siteDocumentsUrl(siteId, cursor), { method: "GET", credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" } });
  } catch {
    return { kind: "failed", retryAfterS: 2 };
  }
  if (res.status === 401 || res.status === 403 || res.status === 404) return { kind: "refused", status: res.status };
  if (res.status === 422 && cursor) return { kind: "cursor" };
  if (!res.ok) {
    const n = Number(res.headers.get("retry-after"));
    return { kind: "failed", retryAfterS: Number.isFinite(n) && n > 0 ? Math.min(Math.ceil(n), 120) : 2 };
  }
  const raw = await res.json().catch(() => undefined);
  const page = parseSiteDocumentPage(raw);
  return page ? { kind: "loaded", ...page } : { kind: "failed", retryAfterS: 2 };
}

export const SITE_DOCS_COPY = {
  loading: "Chargement des documents du site…",
  empty: "Aucun document rattaché aux interventions de ce site.",
  failed: "Les documents du site n’ont pas pu être chargés.",
  cursor: "La liste a changé : elle repart de la première page.",
  refused401: "Votre session a expiré. Reconnectez-vous pour voir les documents du site.",
  refused: "Les documents de ce site ne sont pas accessibles avec vos droits.",
  more: "Afficher plus",
  moreFailed: "La suite n’a pas pu être chargée.",
  openFailed: "Le lien de téléchargement est indisponible.",
  note: "Seuls les documents liés à une intervention du site sont listés ; les justificatifs personnels restent dans « Documents ».",
} as const;
