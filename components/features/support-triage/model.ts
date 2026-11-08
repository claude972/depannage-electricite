// ADM-07 — support triage (assignment + internal escalation), operator side only. Pure, no React.
// Contract (phase 1, /api/support/triage):
//   GET ?kind=ticket&ticket_id=UUID[&after_version=N] → { triage, events, next_after_version, can_manage }
//   GET ?kind=operators[&after=UUID]                  → { rows: [{ id, name }], next_cursor }
//   GET ?kind=queue&queue=mine|escalated[&after=UUID] → { rows: [{ id, subject, status, assigned_to, escalated }], next_cursor }
//   POST { ticket_id, command_id, expected_version, action: "assign", reason, assigned_to: UUID|null }
//      | { ticket_id, command_id, expected_version, action: "set_escalated", reason, escalated: boolean }
//      → { triage, replayed }. Exact replay; 409 conflict; rights and eligibility re-checked server side.
// The command is written to this tab's storage (courant-private-, bound to uid / generation /
// ticket) and read back BEFORE the POST; an uncertain reply resends the SAME command; 409 re-reads.

export type Context = { generation(): number; userId(): string | null };
export type Triage = { ticket_id: string; assigned_to: string | null; assignee_name: string | null; assignee_active: boolean; escalated: boolean; version: number };
export type TriageEvent = { id: string; actor_id: string; version: number; action: "assign" | "set_escalated"; reason: string; assigned_to: string | null; escalated: boolean; created_at: string };
export type TicketTriage = { triage: Triage; events: TriageEvent[]; next_after_version: number | null; can_manage: boolean };
export type Operator = { id: string; name: string };
export type QueueRow = { id: string; subject: string; status: string; assigned_to: string | null; escalated: boolean };
export type Page<T> = { rows: T[]; next_cursor: string | null };
export type TriageCommand =
  | { ticket_id: string; command_id: string; expected_version: number; action: "assign"; reason: string; assigned_to: string | null }
  | { ticket_id: string; command_id: string; expected_version: number; action: "set_escalated"; reason: string; escalated: boolean };
export type Store = { get(key: string): string | null; set(key: string, value: string): void; remove(key: string): void };
export type Reply = { status: number; body: unknown };

export const TRIAGE_PATH = "/api/support/triage";
export const TRIAGE_TIMEOUT_MS = 15_000;
export const REASON_MAX = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isInt = (v: unknown, min = 0): v is number => typeof v === "number" && Number.isInteger(v) && v >= min;
const lower = (s: string) => s.toLowerCase();
export const newCommandId = (): string | null => (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID().toLowerCase() : null);

export const TRIAGE_COPY = {
  title: "Triage interne",
  internal: "Information interne à l’équipe : jamais visible par le demandeur. L’escalade ne change ni l’état de la demande ni un délai annoncé.",
  loading: "Lecture du triage…",
  loadFailed: "Le triage n’a pas pu être lu. Réessayez.",
  refused: "Le serveur refuse l’accès au triage de cette demande.",
  session: "Votre session a expiré : reconnectez-vous.",
  unassigned: "Non attribuée",
  inactive: "compte inactif",
  escalated: "Escaladée",
  notEscalated: "Non escaladée",
  noEvents: "Aucun triage n’a encore été enregistré.",
  more: "Charger la suite",
  moreFailed: "La suite de l’historique n’a pas pu être lue. Ce qui est affiché reste valable.",
  readOnly: "Demande résolue : le triage est en lecture seule.",
  noManage: "Vos habilitations permettent la lecture du triage, pas sa modification.",
  reason: "Motif (obligatoire, 500 caractères au plus)",
  reasonError: "Indiquez un motif de 1 à 500 caractères.",
  pickOperator: "Choisir l’opérateur",
  operatorsLoading: "Lecture des opérateurs…",
  operatorsEmpty: "Aucun opérateur éligible.",
  operatorsFailed: "La liste des opérateurs n’a pas pu être lue.",
  assign: "Attribuer",
  unassign: "Retirer l’attribution",
  escalate: "Escalader",
  restore: "Lever l’escalade",
  sending: "Enregistrement…",
  done: "Triage enregistré.",
  conflict: "Le triage a changé entre-temps : il a été relu, rien n’a été renvoyé. Vérifiez puis recommencez si besoin.",
  invalid: "Le serveur refuse cette commande : vérifiez le choix et le motif.",
  limited: "Trop de commandes en peu de temps : réessayez dans un instant.",
  pending: "La commande n’est pas confirmée. « Réessayer » renvoie exactement la même commande.",
  retry: "Réessayer",
  storage: "Le stockage de cet onglet est indisponible : rien n’a été envoyé.",
  noUuid: "Ce navigateur ne permet pas de créer un identifiant de commande sécurisé.",
  queuesTitle: "Triage des demandes",
  mine: "Mes attributions",
  escalatedQueue: "Escaladées",
  queueEmpty: { mine: "Aucune demande active ne vous est attribuée.", escalated: "Aucune demande active escaladée." },
  queueFailed: "La file n’a pas pu être lue. Réessayez.",
} as const;

// ---- Parsers (strict) ------------------------------------------------------------------------
export function parseTriage(v: unknown, ticketId: string): Triage | null {
  if (!isObj(v) || !isUuid(v.ticket_id) || lower(v.ticket_id) !== lower(ticketId)) return null;
  if (!(v.assigned_to === null || isUuid(v.assigned_to)) || !(v.assignee_name === null || typeof v.assignee_name === "string")) return null;
  if (typeof v.assignee_active !== "boolean" || typeof v.escalated !== "boolean" || !isInt(v.version)) return null;
  if (v.version === 0 && (v.assigned_to !== null || v.assignee_name !== null)) return null; // no triage yet
  return { ticket_id: lower(v.ticket_id), assigned_to: v.assigned_to === null ? null : lower(v.assigned_to), assignee_name: v.assignee_name as string | null, assignee_active: v.assignee_active, escalated: v.escalated, version: v.version };
}
function parseEvent(v: unknown): TriageEvent | null {
  if (!isObj(v) || !isUuid(v.id) || !isUuid(v.actor_id) || !isInt(v.version, 1) || (v.action !== "assign" && v.action !== "set_escalated")) return null;
  if (typeof v.reason !== "string" || !(v.assigned_to === null || isUuid(v.assigned_to)) || typeof v.escalated !== "boolean" || typeof v.created_at !== "string") return null;
  return { id: v.id, actor_id: v.actor_id, version: v.version, action: v.action, reason: v.reason, assigned_to: v.assigned_to as string | null, escalated: v.escalated, created_at: v.created_at };
}
export function parseTicketTriage(v: unknown, ticketId: string, afterVersion: number | null): TicketTriage | null {
  if (!isObj(v) || !Array.isArray(v.events) || v.events.length > 50 || typeof v.can_manage !== "boolean") return null;
  const triage = parseTriage(v.triage, ticketId);
  if (!triage || !(v.next_after_version === null || isInt(v.next_after_version))) return null;
  const events: TriageEvent[] = [];
  for (const e of v.events) {
    const p = parseEvent(e);
    if (!p || (afterVersion !== null && p.version <= afterVersion) || (events.length && p.version <= events[events.length - 1].version) || p.version > triage.version) return null;
    events.push(p);
  }
  return { triage, events, next_after_version: v.next_after_version as number | null, can_manage: v.can_manage };
}
function parsePage<T>(v: unknown, row: (r: unknown) => T | null, after: string | null): Page<T> | null {
  if (!isObj(v) || !Array.isArray(v.rows) || v.rows.length > 50 || !(v.next_cursor === null || isUuid(v.next_cursor))) return null;
  const rows: T[] = [];
  let last = after ? lower(after) : null;
  for (const r of v.rows) {
    const p = row(r);
    const id = p ? lower((p as unknown as { id: string }).id) : null;
    if (!p || !id || (last !== null && id <= last)) return null; // UUID order, strictly after the cursor
    last = id;
    rows.push(p);
  }
  return { rows, next_cursor: v.next_cursor as string | null };
}
export const parseOperators = (v: unknown, after: string | null) =>
  parsePage<Operator>(v, (r) => (isObj(r) && isUuid(r.id) && typeof r.name === "string" ? { id: lower(r.id), name: r.name } : null), after);
export const parseQueue = (v: unknown, after: string | null) =>
  parsePage<QueueRow>(
    v,
    (r) =>
      isObj(r) && isUuid(r.id) && typeof r.subject === "string" && typeof r.status === "string" && (r.assigned_to === null || isUuid(r.assigned_to)) && typeof r.escalated === "boolean"
        ? { id: lower(r.id), subject: r.subject, status: r.status, assigned_to: r.assigned_to as string | null, escalated: r.escalated }
        : null,
    after,
  );
/** The receipt must answer this command: same ticket, the next version, the requested change. */
export function parseReceipt(v: unknown, cmd: TriageCommand): Triage | null {
  if (!isObj(v) || typeof v.replayed !== "boolean") return null;
  const t = parseTriage(v.triage, cmd.ticket_id);
  if (!t || t.version !== cmd.expected_version + 1) return null;
  if (cmd.action === "assign" ? t.assigned_to !== (cmd.assigned_to ? lower(cmd.assigned_to) : null) : t.escalated !== cmd.escalated) return null;
  return t;
}

// ---- Commands --------------------------------------------------------------------------------
export function buildCommand(input: { ticketId: string; commandId: string; expectedVersion: number; reason: string } & ({ action: "assign"; assignedTo: string | null } | { action: "set_escalated"; escalated: boolean })): TriageCommand | null {
  const reason = input.reason.trim();
  if (!reason || reason.length > REASON_MAX || !isUuid(input.ticketId) || !isUuid(input.commandId) || !isInt(input.expectedVersion)) return null;
  const base = { ticket_id: lower(input.ticketId), command_id: lower(input.commandId), expected_version: input.expectedVersion, reason };
  if (input.action === "assign") {
    if (input.assignedTo !== null && !isUuid(input.assignedTo)) return null;
    return { ...base, action: "assign", assigned_to: input.assignedTo === null ? null : lower(input.assignedTo) };
  }
  return { ...base, action: "set_escalated", escalated: input.escalated };
}
export const pendingKey = (uid: string, gen: number, ticketId: string) => `courant-private-support-triage:${uid}:${gen}:${lower(ticketId)}`;
export function tabStore(): Store | null {
  try {
    const s = window.sessionStorage;
    return { get: (k) => s.getItem(k), set: (k, v) => s.setItem(k, v), remove: (k) => s.removeItem(k) };
  } catch {
    return null;
  }
}
/** Writes the command and reads it back; false ⇒ nothing may be sent. */
export function persistCommand(store: Store | null, key: string, cmd: TriageCommand): boolean {
  if (!store) return false;
  const value = JSON.stringify(cmd);
  try {
    store.set(key, value);
    return store.get(key) === value;
  } catch {
    return false;
  }
}
export function readCommand(store: Store | null, key: string, ticketId: string): TriageCommand | null {
  try {
    const raw = store?.get(key);
    if (!raw) return null;
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (!isObj(v) || typeof v.ticket_id !== "string" || lower(v.ticket_id) !== lower(ticketId)) return null;
    const cmd =
      v.action === "assign"
        ? buildCommand({ ticketId: v.ticket_id, commandId: String(v.command_id), expectedVersion: Number(v.expected_version), reason: String(v.reason), action: "assign", assignedTo: (v.assigned_to as string | null) ?? null })
        : v.action === "set_escalated" && typeof v.escalated === "boolean"
          ? buildCommand({ ticketId: v.ticket_id, commandId: String(v.command_id), expectedVersion: Number(v.expected_version), reason: String(v.reason), action: "set_escalated", escalated: v.escalated })
          : null;
    return cmd && JSON.stringify(cmd) === raw ? cmd : null;
  } catch {
    return null;
  }
}
export function clearCommand(store: Store | null, key: string) {
  try {
    store?.remove(key);
  } catch {
    /* nothing to clear */
  }
}

// ---- HTTP ------------------------------------------------------------------------------------
async function timed(fetcher: typeof fetch, url: string, init: RequestInit): Promise<Reply> {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = setTimeout(() => controller?.abort(), TRIAGE_TIMEOUT_MS);
  try {
    const r = await fetcher(url, { ...init, credentials: "same-origin", cache: "no-store", ...(controller ? { signal: controller.signal } : {}) });
    return { status: r.status, body: await r.json().catch(() => null) };
  } catch {
    return { status: 0, body: null };
  } finally {
    clearTimeout(timer);
  }
}
const get = (fetcher: typeof fetch, q: URLSearchParams) => timed(fetcher, `${TRIAGE_PATH}?${q.toString()}`, { method: "GET", headers: { accept: "application/json" } });
export const fetchTicket = (fetcher: typeof fetch, ticketId: string, afterVersion: number | null) =>
  get(fetcher, new URLSearchParams({ kind: "ticket", ticket_id: ticketId, ...(afterVersion !== null ? { after_version: String(afterVersion) } : {}) }));
export const fetchOperators = (fetcher: typeof fetch, after: string | null) => get(fetcher, new URLSearchParams({ kind: "operators", ...(after ? { after } : {}) }));
export const fetchQueue = (fetcher: typeof fetch, queue: "mine" | "escalated", after: string | null) => get(fetcher, new URLSearchParams({ kind: "queue", queue, ...(after ? { after } : {}) }));
export const postCommand = (fetcher: typeof fetch, cmd: TriageCommand) =>
  timed(fetcher, TRIAGE_PATH, { method: "POST", headers: { accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify(cmd) });

export const readMessage = (status: number) =>
  status === 401 ? TRIAGE_COPY.session : status === 403 || status === 404 ? TRIAGE_COPY.refused : TRIAGE_COPY.loadFailed;
