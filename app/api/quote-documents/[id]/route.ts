// ADV-DOCUMENTS-001 — private PDF download. The SQL command authorises under RLS, records the
// download event and returns the stored snapshot; the PDF is rendered from that snapshot only.
import { authenticatedClient, ApiError, dbError } from "@/lib/supabase/server";
import { uuid } from "@/lib/supabase/validation";
import { checkedObject, failed } from "@/lib/features/quote-documents/server";
import { parseSnapshot, SnapshotError } from "@/lib/features/quote-documents/snapshot";
import { renderQuoteDocumentPdf } from "@/lib/features/quote-documents/pdf";
import { renderedPdfLink } from "@/lib/features/documents/rendered-link";
import { documentFileName } from "@/lib/features/quote-documents/format";
import type { QuoteDocumentSummary } from "@/lib/features/quote-documents/types";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { db, user } = await authenticatedClient(request);
    const { id } = await context.params;
    if (!uuid.safeParse(id).success) throw new ApiError(422, "Identifiant de document invalide.");
    const params = new URL(request.url).searchParams;
    // `link=1` (native application): same authorisation and download event, answered with a 60-second signed link.
    for (const key of params.keys()) if ((key !== "inline" && key !== "link") || params.getAll(key).length !== 1 || params.get(key) !== "1" || params.size !== 1) throw new ApiError(422, "Ce téléchargement n’accepte pas de paramètre supplémentaire.");
    const result = await db.rpc("record_quote_document_download", { p_document_id: id });
    dbError(result.error);
    const payload = checkedObject<{ document: QuoteDocumentSummary; snapshot: unknown }>(result.data, "Le document n’a pas pu être lu.");
    const document = payload.document;
    if (!document || typeof document !== "object" || typeof document.revision !== "number" || typeof document.reference !== "string" || typeof document.snapshot_sha256 !== "string")
      throw new ApiError(503, "Le document n’a pas pu être lu.");
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      bytes = renderQuoteDocumentPdf(parseSnapshot(payload.snapshot), { revision: document.revision, generated_at: document.generated_at, snapshot_sha256: document.snapshot_sha256 });
    } catch (error) {
      if (error instanceof SnapshotError) throw new ApiError(503, "Le contenu enregistré de ce document est incohérent : il ne peut pas être rendu. Contactez l’assistance.");
      throw error;
    }
    if (params.get("link") === "1")
      return Response.json({ url: await renderedPdfLink(user.id, `quote-${id.toLowerCase()}-r${document.revision}`, bytes) }, { headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
    const disposition = params.get("inline") === "1" ? "inline" : "attachment";
    return new Response(bytes, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(bytes.byteLength),
        "Content-Disposition": `${disposition}; filename="${documentFileName(document)}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        ETag: `"${document.snapshot_sha256.slice(0, 32)}-r${document.revision}"`,
      },
    });
  } catch (error) {
    return failed(error);
  }
}
