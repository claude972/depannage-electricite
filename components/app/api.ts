import type { ContractState } from "./types";

export class ApiRequestError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
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
    throw new ApiRequestError(status, message);
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
