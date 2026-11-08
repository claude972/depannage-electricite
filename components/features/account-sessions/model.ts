// SYS-09 / Q-PDF-36 — close the account's other sessions. Consumer of the phase-1 contract:
//   POST /api/profile/sessions (same origin, strict JSON) { action: "revoke_others", user_id }
//   → 200 { revoked_other_sessions: true }; private, uncached replies.
// `user_id` is the authenticated account (mutationContext.userId()). No session id or token is
// ever read or displayed. Pure (no React).

export type Context = { generation(): number; userId(): string | null };
export type RevokeOutcome = { kind: "ok" } | { kind: "error"; message: string };
export const SESSIONS_TIMEOUT_MS = 15_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const COPY = {
  title: "Sessions de connexion",
  intro: "Fermez les sessions ouvertes sur vos autres appareils ou navigateurs. Cette session-ci reste ouverte.",
  action: "Fermer mes autres sessions",
  confirm: "Confirmer la fermeture des autres sessions",
  cancel: "Annuler",
  explain:
    "Toutes vos autres sessions seront fermées ; celle-ci reste ouverte. Les accès déjà délivrés à ces appareils peuvent rester valables jusqu’à leur expiration, en général peu de temps.",
  sending: "Fermeture en cours…",
  done: "Vos autres sessions sont fermées. Cette session reste ouverte ; un accès déjà délivré peut rester valable jusqu’à son expiration.",
  retry: "Réessayer",
  failed: "Les autres sessions n’ont pas pu être fermées. Réessayez.",
  session: "Votre session a expiré : reconnectez-vous puis réessayez.",
  refused: "Le serveur refuse cette action pour ce compte.",
  limited: "Trop de demandes en peu de temps : réessayez dans un instant.",
  unavailable: "Le service est momentanément indisponible : réessayez plus tard.",
  noAccount: "Aucun compte connecté : reconnectez-vous.",
} as const;

export function revokeBody(userId: string): { action: "revoke_others"; user_id: string } | null {
  return UUID.test(userId) ? { action: "revoke_others", user_id: userId } : null;
}

/** Only `{ revoked_other_sessions: true }` (and nothing else) is a success. */
export function isRevoked(body: unknown): boolean {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const keys = Object.keys(body);
  return keys.length === 1 && keys[0] === "revoked_other_sessions" && (body as Record<string, unknown>).revoked_other_sessions === true;
}

export function messageFor(status: number): string {
  if (status === 401) return COPY.session;
  if (status === 403) return COPY.refused;
  if (status === 429) return COPY.limited;
  if (status === 503) return COPY.unavailable;
  return COPY.failed;
}

export async function revokeOthers(fetcher: typeof fetch, userId: string, timeoutMs = SESSIONS_TIMEOUT_MS): Promise<RevokeOutcome> {
  const body = revokeBody(userId);
  if (!body) return { kind: "error", message: COPY.noAccount };
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = setTimeout(() => controller?.abort(), timeoutMs);
  try {
    const r = await fetcher("/api/profile/sessions", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(body),
      ...(controller ? { signal: controller.signal } : {}),
    });
    const json = await r.json().catch(() => null);
    if (r.status === 200 && isRevoked(json)) return { kind: "ok" };
    return { kind: "error", message: r.status === 200 ? COPY.failed : messageFor(r.status) };
  } catch {
    return { kind: "error", message: COPY.failed };
  } finally {
    clearTimeout(timer);
  }
}
