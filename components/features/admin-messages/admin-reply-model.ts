// ADM-07: operator reply in a dossier thread. Contract (ROOT 70a9c5d + f47ba7f):
// POST /api/admin/messages {id, intervention_id, body} → 200 {message:{id,intervention_id,body,author_id,created_at}}.
// The client id stays the same for every retry of the same text until a 200; a new id only after a
// success or once the text is edited. 409 (id reused differently, or conversation unavailable) is
// never retried automatically; 429/503/timeout are retried with the exact same command.
import type { Message } from "../../app/types";

export const ADMIN_REPLY_TIMEOUT_MS = 15_000;
export const ADMIN_REPLY_MAX = 4000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export type ReplyCommand = { id: string; intervention_id: string; body: string };
export type ReplyResult = { status: number; body: unknown; retryAfter: number | null };
export type ReplyApi = { send(command: ReplyCommand): Promise<ReplyResult> };
export type ReplyOutcome =
  | { kind: "sent"; message: Message }
  | { kind: "conflict"; text: string }
  | { kind: "retry"; text: string }
  | { kind: "invalid"; text: string }
  | { kind: "denied"; text: string };

export const REPLY_COPY = {
  conflict: "Ce message n’a pas pu être ajouté : le dossier a changé ou la conversation n’est plus disponible. Votre texte est conservé ; actualisez le dossier avant de renvoyer.",
  retry: "L’envoi n’a pas pu être confirmé. Réessayez sans modifier votre message : il ne sera pas envoyé deux fois.",
  invalid: "Vérifiez votre message (1 à 4 000 caractères).",
  denied: "Vous n’avez pas accès à cette action.",
  signedOut: "Votre session a expiré. Reconnectez-vous pour répondre.",
  notFound: "Ce dossier est introuvable.",
  noUuid: "Ce navigateur ne permet pas de créer un identifiant sécurisé : l’envoi est impossible ici. Mettez à jour le navigateur ou utilisez-en un autre.",
  unavailable: "Pas de conversation active sur ce dossier : aucun artisan n’est affecté ou le dossier est annulé. La réponse sera possible dès qu’un artisan sera affecté.",
  demo: "En démonstration, aucun message n’est envoyé.",
  sent: "Message envoyé dans le fil du dossier. Le client et l’artisan le voient signé « Exploitant ».",
} as const;

/** Thread open for an operator reply: same rule as the server (artisan assigned, not cancelled). */
export function conversationOpen(i: { artisan_id?: string | null; status?: string } | undefined): boolean {
  return Boolean(i?.artisan_id) && i?.status !== "cancelled";
}

export function replyUuid(): string | null {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : null;
}

/** Strict: the reply must be exactly the command that was sent (id, dossier, body). */
export function parseReply(body: unknown, command: ReplyCommand, authorId: string | null): Message | null {
  if (!body || typeof body !== "object") return null;
  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== "message") return null;
  const m = (body as { message: unknown }).message;
  if (!m || typeof m !== "object") return null;
  const r = m as Record<string, unknown>;
  if (Object.keys(r).sort().join(",") !== "author_id,body,created_at,id,intervention_id") return null;
  if (r.id !== command.id || r.intervention_id !== command.intervention_id || r.body !== command.body) return null;
  // The author must be the identity that sent it (the route checks it too: aligned guard).
  if (!authorId || r.author_id !== authorId) return null;
  if (typeof r.author_id !== "string" || !UUID.test(r.author_id) || typeof r.created_at !== "string" || !ISO.test(r.created_at)) return null;
  return { id: command.id, intervention_id: command.intervention_id, body: command.body, author_id: r.author_id, created_at: r.created_at };
}

export function replyOutcome(r: ReplyResult, command: ReplyCommand, authorId: string | null): ReplyOutcome {
  if (r.status === 200) {
    const message = parseReply(r.body, command, authorId);
    return message ? { kind: "sent", message } : { kind: "retry", text: REPLY_COPY.retry };
  }
  if (r.status === 409) return { kind: "conflict", text: REPLY_COPY.conflict };
  if (r.status === 422 || r.status === 400) return { kind: "invalid", text: REPLY_COPY.invalid };
  if (r.status === 401) return { kind: "denied", text: REPLY_COPY.signedOut };
  if (r.status === 403) return { kind: "denied", text: REPLY_COPY.denied };
  if (r.status === 404) return { kind: "denied", text: REPLY_COPY.notFound };
  return { kind: "retry", text: REPLY_COPY.retry }; // 429, 503, network, timeout
}

/** Normalised text sent to the server (same trim as the route); null when empty or too long. */
export function replyText(draft: string): string | null {
  const t = draft.trim();
  return t.length >= 1 && t.length <= ADMIN_REPLY_MAX ? t : null;
}

/** Keeps the pending command (id + body) across retries; a new id only when the text changed. */
export function nextCommand(pending: ReplyCommand | null, interventionId: string, text: string, newId: () => string | null): ReplyCommand | null {
  if (pending && pending.intervention_id === interventionId && pending.body === text) return pending;
  const id = newId();
  return id ? { id, intervention_id: interventionId, body: text } : null;
}

export function createReplyApi(fetcher: typeof fetch = (...a) => fetch(...a), timeoutMs = ADMIN_REPLY_TIMEOUT_MS): ReplyApi {
  return {
    async send(command) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetcher("/api/admin/messages", {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(command),
          signal: controller.signal,
        });
        let body: unknown = null;
        try {
          body = await res.json();
        } catch {
          body = null;
        }
        const ra = Number(res.headers.get("Retry-After"));
        return { status: res.status, body, retryAfter: Number.isFinite(ra) && ra > 0 ? ra : null };
      } catch {
        return { status: 0, body: null, retryAfter: null };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** Thread rows: workspace messages + locally confirmed replies, unique by id, oldest first. */
export function mergeThread(messages: Message[], sent: Message[], interventionId: string): Message[] {
  const byId = new Map<string, Message>();
  for (const m of [...messages, ...sent]) if (m.intervention_id === interventionId && !byId.has(m.id)) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || (a.id < b.id ? -1 : 1));
}
