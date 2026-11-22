import type { ContractState } from "./types";

export class ApiRequestError extends Error {
  /** Optional machine code and field list carried by the server body (e.g. issuer_incomplete). */
  code?: string;
  missing?: string[];
  /** Machine reason of a refusal or unavailability (e.g. provider_quota), as sent by the server. */
  reason?: string;
  /** Server-suggested wait before a new attempt, in seconds (bounded 0..3600). */
  retry_after_s?: number;
  /** True when the error body was a JSON object: the route exists (a framework 404 page is not JSON). */
  json?: boolean;
  constructor(
    public status: number,
    message: string,
    details?: { code?: string; missing?: string[]; reason?: string; retry_after_s?: number; json?: boolean },
  ) {
    super(message);
    if (details?.code) this.code = details.code;
    if (details?.missing) this.missing = details.missing;
    if (details?.reason) this.reason = details.reason;
    if (details?.retry_after_s !== undefined) this.retry_after_s = details.retry_after_s;
    if (details?.json) this.json = true;
  }
}
type Fetcher = (input: string, init: RequestInit) => Promise<Response>;
// Interprets a server response. A 2xx with a body that is not a JSON object is NOT a success
// (proxy pages, HTML errors, truncated bodies): the caller must re-read before assuming anything.
export function parseApiBody(
  status: number,
  ok: boolean,
  text: string,
): { data: unknown } {
  let parsed: unknown = undefined;
  let valid = false;
  if (text.trim()) {
    try {
      parsed = JSON.parse(text);
      valid = parsed !== null && typeof parsed === "object";
    } catch {
      valid = false;
    }
  }
  if (!ok) {
    const message =
      valid && typeof (parsed as { error?: unknown }).error === "string"
        ? (parsed as { error: string }).error
        : status === 404 || status === 405
          ? "Cette fonction n’est pas encore activée sur ce service."
          : status === 401
            ? "Connectez-vous pour accéder à cet espace."
            : "L’action n’a pas pu être réalisée. Réessayez.";
    const body = valid ? (parsed as { code?: unknown; missing?: unknown; reason?: unknown; retry_after_s?: unknown }) : {};
    const retry = typeof body.retry_after_s === "number" && Number.isFinite(body.retry_after_s) ? Math.max(0, Math.min(3600, body.retry_after_s)) : undefined;
    throw new ApiRequestError(status, message, {
      json: valid,
      reason: typeof body.reason === "string" && body.reason ? body.reason : undefined,
      retry_after_s: retry,
      code: typeof body.code === "string" ? body.code : undefined,
      missing: Array.isArray(body.missing) && body.missing.every((m) => typeof m === "string") ? (body.missing as string[]) : undefined,
    });
  }
  if (!valid)
    throw new ApiRequestError(
      502,
      "Le service a répondu sans résultat exploitable. L’action a pu être enregistrée : rechargez les données pour vérifier son état avant de réessayer.",
    );
  return { data: parsed };
}
export async function api<T>(
  path: string,
  body?: unknown,
  method?: string,
  fetcher: Fetcher = (input, init) => fetch(input, init),
): Promise<T> {
  const verb = method || (body === undefined ? "GET" : "POST");
  let response: Response;
  try {
    response = await fetcher(path, {
      method: verb,
      headers:
        body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    // The request may have reached the server before the connection dropped: the outcome
    // is unknown, so the user is told to re-read before retrying a mutation.
    throw new ApiRequestError(
      0,
      verb === "GET"
        ? "Connexion indisponible. Vérifiez votre réseau puis rechargez les données."
        : "La connexion a été interrompue avant la réponse du serveur. L’action a pu être enregistrée : rechargez le dossier pour vérifier son état avant de réessayer.",
    );
  }
  const text = await response.text().catch(() => "");
  return parseApiBody(response.status, response.ok, text).data as T;
}
// Translate a failure of a *new* contract into an honest availability state.
export function contractStateFromError(error: unknown): ContractState {
  if (error instanceof ApiRequestError) {
    if (error.status === 404 || error.status === 405) return "missing";
    if (error.status === 503 || error.status === 0) return "unavailable";
  }
  return "unavailable";
}
export const CONTRACT_MESSAGES: Record<Exclude<ContractState, "available">, string> = {
  unknown: "Disponibilité du service en cours de vérification.",
  missing:
    "Cette fonction n’est pas encore activée sur ce service. Rien n’est simulé : vous pourrez l’utiliser dès sa mise en service.",
  unavailable:
    "Le service est momentanément indisponible. Réessayez dans quelques instants ; si le problème persiste, contactez l’assistance.",
};

export const UPLOAD_MAX_BYTES = 4194304;
export const UPLOAD_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
// Client-side pre-check mirrors the server limits so a doomed upload never starts.
export function validateUpload(file: { size: number; type: string }, types = UPLOAD_TYPES): string | null {
  if (file.size < 1) return "Le fichier est vide.";
  if (file.size > UPLOAD_MAX_BYTES) return "Choisissez un fichier de moins de 4 Mo.";
  if (!types.includes(file.type))
    return types === PHOTO_TYPES ? "Formats de photo autorisés : JPEG, PNG et WebP." : "Formats autorisés : PDF, JPEG, PNG et WebP.";
  return null;
}
// Uploads one private document (optionally bound to a dossier). Authentication is the
// server's: there is no anonymous upload path.
export async function uploadDocument(
  file: File,
  interventionId: string | null,
  fetcher: Fetcher = (input, init) => fetch(input, init),
): Promise<{ id: string; name: string; mime_type: string; created_at: string }> {
  const invalid = validateUpload(file);
  if (invalid) throw new ApiRequestError(422, invalid);
  const form = new FormData();
  form.append("file", file);
  if (interventionId) form.append("intervention_id", interventionId);
  let response: Response;
  try {
    response = await fetcher("/api/documents", { method: "POST", body: form, cache: "no-store" });
  } catch {
    throw new ApiRequestError(
      0,
      "La connexion a été interrompue pendant l’envoi. Le fichier a pu être enregistré : rechargez les documents avant de réessayer.",
    );
  }
  const text = await response.text().catch(() => "");
  const { data } = parseApiBody(response.status, response.ok, text);
  const doc = (data as { document?: { id: string; name: string; mime_type: string; created_at: string } }).document;
  if (!doc?.id) throw new ApiRequestError(502, "Le service n’a pas confirmé l’enregistrement du fichier. Rechargez les documents avant de réessayer.");
  return doc;
}
