// Route helpers of the lot: private no-store responses and the explicit issuer configuration
// error (SQLSTATE QD001 raised by migration 015 when the artisan's dossier lacks required fields).
import { ApiError, apiError } from "@/lib/supabase/server";

export const privateHeaders = { "Cache-Control": "private, no-store" } as const;

export class IssuerConfigurationError extends ApiError {
  constructor(public readonly missing: string[]) {
    super(
      409,
      "Le dossier professionnel de l’émetteur est incomplet : le document ne peut pas être généré tant que les informations requises ne sont pas renseignées.",
    );
  }
}
/** Recognises QD001 before the generic mapping; returns null for any other error. */
export function issuerError(error: { code?: string; message?: string } | null): IssuerConfigurationError | null {
  if (!error || error.code !== "QD001") return null;
  const match = /issuer_incomplete:([a-z_,]*)/.exec(error.message ?? "");
  const missing = (match?.[1] ?? "").split(",").filter(Boolean);
  return new IssuerConfigurationError(missing);
}
export function failed(error: unknown): Response {
  if (error instanceof IssuerConfigurationError)
    return Response.json({ error: error.message, code: "issuer_incomplete", missing: error.missing }, { status: 409, headers: privateHeaders });
  const response = apiError(error);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
export function checkedObject<T>(data: unknown, message: string): T {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new ApiError(503, message);
  return data as T;
}
