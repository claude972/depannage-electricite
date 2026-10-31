import type { ContractState } from "./types";

export class ApiRequestError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  body?: unknown,
  method?: string,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: method || (body === undefined ? "GET" : "POST"),
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
      method === "GET" || (body === undefined && !method)
        ? "Connexion indisponible. Vérifiez votre réseau puis rechargez les données."
        : "La connexion a été interrompue avant la réponse du serveur. L’action a pu être enregistrée : rechargez le dossier pour vérifier son état avant de réessayer.",
    );
  }
  const data = await response.json().catch(() => ({
    error: "Le service n’a pas renvoyé de réponse exploitable.",
  }));
  if (!response.ok)
    throw new ApiRequestError(
      response.status,
      data.error ||
        (response.status === 404
          ? "Cette fonction n’est pas encore activée sur ce service."
          : "L’action n’a pas pu être réalisée. Réessayez."),
    );
  return data as T;
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
