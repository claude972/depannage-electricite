// Point read of ONE dossier outside the workspace window (FASTSPLIT-DETAIL-CONSUMER-001,
// contract docs/DETAIL_READ_CONTRACT.md). Calls Codex's GET /api/interventions/:id (read-only for
// the lead), validates the reply at runtime with the route's own schema, and maps the HTTP result
// to an explicit outcome. A failure (503, transport, invalid reply) is never « introuvable ».
import { ApiRequestError } from "./api";
import { detailIdSchema, detailReadSchema, type DetailRead } from "../../lib/features/workspace/detail-read";

export type DetailOutcome =
  | { kind: "loaded"; detail: DetailRead }
  /** 404 from the route: absent, not visible or non-UUID — identical by design (non-disclosure). */
  | { kind: "not_found" }
  | { kind: "failed"; status: number; retryAfterS: number }
  | { kind: "signed_out" };

export type DetailFetch = (path: string) => Promise<unknown>;

/** Default wait before a retry when the server did not say (the route sends Retry-After: 2). */
export const DEFAULT_RETRY_AFTER_S = 2;

export async function readDetail(fetchJson: DetailFetch, id: string): Promise<DetailOutcome> {
  // A non-UUID can never be a dossier: the route would answer 404; skip the request.
  if (!detailIdSchema.safeParse(id).success) return { kind: "not_found" };
  let raw: unknown;
  try {
    raw = await fetchJson(`/api/interventions/${encodeURIComponent(id)}`);
  } catch (e) {
    if (e instanceof ApiRequestError) {
      if (e.status === 404) return { kind: "not_found" };
      if (e.status === 401) return { kind: "signed_out" };
      return { kind: "failed", status: e.status, retryAfterS: retryAfter(e.retry_after_s) };
    }
    return { kind: "failed", status: 0, retryAfterS: DEFAULT_RETRY_AFTER_S };
  }
  const parsed = detailReadSchema.safeParse(raw);
  if (!parsed.success || parsed.data.intervention.id !== id) return { kind: "failed", status: 502, retryAfterS: DEFAULT_RETRY_AFTER_S };
  return { kind: "loaded", detail: parsed.data };
}

const retryAfter = (value: number | undefined) =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(60, Math.max(0, Math.ceil(value))) : DEFAULT_RETRY_AFTER_S;

/** Messages come back newest first from the route; the dossier view reads them oldest first. */
export function chronologicalMessages(detail: DetailRead) {
  return detail.messages.status === "ok" ? [...detail.messages.items].sort((a, b) => a.created_at.localeCompare(b.created_at)) : [];
}
