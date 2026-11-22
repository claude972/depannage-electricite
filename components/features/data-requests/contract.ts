// SYS-07 data erasure requests — STRICT MIRROR of Astra c0df158 (lib/features/data-requests/contracts.ts
// + the three routes), not merged nor cherry-picked. Public projection (no account_id):
//   request = { id, ticket_id, state, execution_state: "not_started", version 1..100, created_at, updated_at }
//   GET  /api/profile/data?section=erasure_requests[&after=uuid] → { section, rows ≤ 100, next_cursor }
//   GET  /api/admin/data-requests?limit=25[&after=uuid]          → { rows, next_cursor }
//   GET  /api/admin/data-requests/<id> → { request, history, can_decide }
//   POST /api/admin/data-requests/<id> { command_id, expected_version, state, reason 1–1000 } → { request, replayed }
// Rows in ascending UUID order; next_cursor = last row id; a cursor on an empty page is invalid.
// Nothing here erases or executes anything: execution_state is always "not_started".
import { z } from "zod";

const date = z.string().refine((x) => Number.isFinite(Date.parse(x)));
export const STATES = ["requested", "in_review", "needs_information", "approved", "rejected"] as const;
export const DECISIONS = ["in_review", "needs_information", "approved", "rejected"] as const;
export const requestSchema = z
  .object({
    id: z.uuid(),
    ticket_id: z.uuid(),
    state: z.enum(STATES),
    execution_state: z.literal("not_started"),
    version: z.number().int().min(1).max(100),
    created_at: date,
    updated_at: date,
  })
  .strict();
export type ErasureRequest = z.infer<typeof requestSchema>;
export const parseRequest = (v: unknown): ErasureRequest | null => {
  const r = requestSchema.safeParse(v);
  return r.success ? r.data : null;
};

/** `executions` (operator list only, SYS-09): request id → date of the executed erasure. Absent when the
 *  server could not read the journal: the execution state is then unknown, not « non commencé ». */
type Page = { rows: ErasureRequest[]; next_cursor: string | null; executions?: Record<string, string> };
/** Ascending ids after the cursor; next_cursor equals the last row id; never a cursor on an empty page. */
function checkedPage(rows: ErasureRequest[], next: string | null, after: string | null): Page | null {
  let previous = after?.toLowerCase() ?? "";
  for (const row of rows) {
    if (row.id.toLowerCase() <= previous) return null;
    previous = row.id.toLowerCase();
  }
  if (next !== null && (rows.length === 0 || next.toLowerCase() !== previous)) return null;
  return { rows, next_cursor: next };
}
const personalPage = z.object({ section: z.literal("erasure_requests"), rows: z.array(requestSchema).max(100), next_cursor: z.uuid().nullable() }).strict();
const adminPage = z.object({ rows: z.array(requestSchema).max(100), next_cursor: z.uuid().nullable(), executions: z.record(z.uuid(), date).optional() }).strict();
export function parsePersonalPage(body: unknown, after: string | null): Page | null {
  const p = personalPage.safeParse(body);
  return p.success ? checkedPage(p.data.rows, p.data.next_cursor, after) : null;
}
export function parseAdminPage(body: unknown, after: string | null, limit: number): Page | null {
  const p = adminPage.safeParse(body);
  const page = p.success && p.data.rows.length <= limit ? checkedPage(p.data.rows, p.data.next_cursor, after) : null;
  return page && p.success && p.data.executions ? { ...page, executions: p.data.executions } : page;
}

const historyEntry = z
  .object({
    id: z.uuid(),
    actor_id: z.uuid(),
    from_state: z.enum(STATES).nullable(),
    to_state: z.enum(STATES),
    reason: z.string().nullable(),
    version: z.number().int().positive(),
    created_at: z.string(),
  })
  .strict();
export const detailSchema = z.object({ request: requestSchema, history: z.array(historyEntry).max(100), can_decide: z.boolean() }).strict();
export type ErasureDetail = z.infer<typeof detailSchema>;
export function parseDetail(body: unknown, id: string): ErasureDetail | null {
  const d = detailSchema.safeParse(body);
  return d.success && d.data.request.id.toLowerCase() === id.toLowerCase() ? d.data : null;
}
export const commandSchema = z
  .object({ command_id: z.uuid(), expected_version: z.number().int().min(1).max(100), state: z.enum(DECISIONS), reason: z.string().trim().min(1).max(1000) })
  .strict();
export type DecisionCommand = z.infer<typeof commandSchema>;
/** A fresh decision lands on version + 1 with the chosen state; an exact replay returns the current request. */
export function parseDecision(body: unknown, id: string, cmd: DecisionCommand): { request: ErasureRequest; replayed: boolean } | null {
  const r = z.object({ request: requestSchema, replayed: z.boolean() }).strict().safeParse(body);
  if (!r.success || r.data.request.id.toLowerCase() !== id.toLowerCase()) return null;
  const q = r.data.request;
  if (!r.data.replayed && (q.version !== cmd.expected_version + 1 || q.state !== cmd.state)) return null;
  if (r.data.replayed && q.version < cmd.expected_version + 1) return null;
  return r.data;
}

// ---- Wording: request state ≠ ticket status ≠ execution (never « effacé ») --------------------------
export const STATE_LABEL: Record<ErasureRequest["state"], string> = {
  requested: "Demande reçue",
  in_review: "En cours d’examen",
  needs_information: "Informations demandées",
  approved: "Approuvée",
  rejected: "Refusée",
};
export const EXECUTION_LABEL: Record<ErasureRequest["execution_state"], string> = { not_started: "Effacement non commencé" };
export const TICKET_LABEL: Record<"open" | "in_progress" | "awaiting_user" | "resolved", string> = {
  open: "ouvert",
  in_progress: "en cours de traitement",
  awaiting_user: "en attente de votre réponse",
  resolved: "résolu",
};
export const TERMINAL: ReadonlySet<ErasureRequest["state"]> = new Set(["approved", "rejected"]);
export const DATA_REQUESTS_COPY = {
  mineTitle: "Mes demandes d’effacement",
  mineNote: "L’état de la demande et le statut du ticket d’assistance sont distincts. « Approuvée » ne signifie pas que des données ont été effacées : l’effacement n’a pas commencé.",
  empty: "Aucune demande d’effacement.",
  loading: "Lecture de vos demandes…",
  loadFailed: "Vos demandes n’ont pas pu être vérifiées. Réessayez.",
  more: "Afficher plus",
  moreFailed: "La suite n’a pas pu être chargée. Réessayez.",
  openTicket: "Voir le ticket",
  session: "Session expirée : reconnectez-vous.",
  opTitle: "Demandes d’effacement",
  opNote: "Examen des demandes : la décision seule ne déclenche aucun effacement. Une demande approuvée est ensuite exécutée par un administrateur, après une confirmation explicite. Le titre et les messages des tickets ne sont pas affichés ici.",
  opExecuted: "Effacement exécuté",
  opExecutionUnknown: "État de l’effacement non vérifié",
  opEmpty: "Aucune demande d’effacement.",
  opForbidden: "Vos habilitations d’assistance, vérifiées par le serveur, ne couvrent pas les demandes d’effacement.",
  opDecideNo: "Décision non disponible : vos habilitations (lecture et statut de l’assistance) ne permettent pas de décider, ou la demande est close.",
  opReasonRequired: "Indiquez un motif (1 à 1000 caractères).",
  opConflict: "La demande a changé entre-temps : rien n’est renvoyé automatiquement. Le détail a été relu.",
  opInvalid: "Le serveur refuse cette décision : vérifiez l’état choisi et le motif.",
  opRetry: "La décision n’est pas confirmée. Réessayez : la même commande sera renvoyée, sans doublon.",
  opRestored: "Une décision envoyée depuis cet onglet n’a pas été confirmée : renvoyez-la (même commande) ou relisez la demande.",
  opStorage: "Le stockage de cet onglet est indisponible : rien n’a été envoyé. Sans lui, une réponse perdue ne pourrait pas être renvoyée à l’identique.",
  opNoUuid: "Ce navigateur ne permet pas de créer un identifiant sécurisé : aucune décision n’est possible ici.",
  opSaved: "Décision enregistrée. Aucun effacement n’est déclenché par cette décision : une demande approuvée reste à exécuter par un administrateur.",
  opReplayed: "Décision déjà enregistrée (même commande) : état relu.",
} as const;
