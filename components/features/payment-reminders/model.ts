// SYS-04 / ENT-16 — personal reminder to settle an outstanding quote (internal, no transaction, no
// due date). Pure model. Contract (MISSIONS 64be5f4, ROOT backend in parallel):
//   GET  /api/payments/reminder?quote_id=UUID → { quote_id, can_schedule, reminder }
//        reminder = null | { id, quote_id, version, remind_at, status, notification_id, processed_at }
//        status ∈ scheduled | cancelled | sent | invalidated | muted
//   POST { quote_id, command_id, expected_version (null ⇒ create), action: "schedule"|"cancel",
//          remind_at? (ISO, schedule only, now + 5 min … now + 90 days) } → { reminder, replayed }
//   Uniform refusal for a quote outside the caller's rights. 409 ⇒ version conflict.
// Command fence: the command is written to tab storage under a courant-private- key bound to
// uid + generation + quote and read back BEFORE the POST (else 0 POST); an uncertain outcome keeps
// it and a retry resends the SAME command_id; a new id is never generated while uncertain.
import { z } from "zod";

export const REMINDER_PATH = "/api/payments/reminder";
export type Context = { generation(): number; userId(): string | null };
export type Result = { status: number; body: unknown };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id = z.string().regex(UUID);
const instant = z.iso.datetime({ offset: true });
export const REMINDER_STATUSES = ["scheduled", "cancelled", "sent", "invalidated", "muted"] as const;
const reminderSchema = z
  .object({
    id,
    quote_id: id,
    version: z.number().int().positive(),
    remind_at: instant,
    status: z.enum(REMINDER_STATUSES),
    notification_id: id.nullable(),
    processed_at: instant.nullable(),
  })
  .strict();
export type Reminder = z.infer<typeof reminderSchema>;
const readSchema = z.object({ quote_id: id, can_schedule: z.boolean(), reminder: reminderSchema.nullable() }).strict();
export type ReminderRead = z.infer<typeof readSchema>;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function parseReminderRead(body: unknown, quoteId: string): ReminderRead | null {
  const r = readSchema.safeParse(body);
  if (!r.success || !same(r.data.quote_id, quoteId)) return null;
  if (r.data.reminder && !same(r.data.reminder.quote_id, quoteId)) return null;
  return r.data;
}

const commandSchema = z
  .object({
    quote_id: id,
    command_id: id,
    expected_version: z.number().int().positive().nullable(),
    action: z.enum(["schedule", "cancel"]),
    remind_at: instant.optional(),
  })
  .strict()
  .refine((c) => (c.action === "schedule" ? Boolean(c.remind_at) : c.remind_at === undefined));
export type ReminderCommand = z.infer<typeof commandSchema>;

/** Receipt for exactly this command: same quote, requested status, a newer version. */
export function parseReceipt(body: unknown, cmd: ReminderCommand): { reminder: Reminder; replayed: boolean } | null {
  const r = z.object({ reminder: reminderSchema, replayed: z.boolean() }).strict().safeParse(body);
  if (!r.success) return null;
  const m = r.data.reminder;
  if (!same(m.quote_id, cmd.quote_id)) return null;
  if (cmd.expected_version !== null && m.version <= cmd.expected_version) return null;
  if (cmd.action === "schedule" && (m.status !== "scheduled" || !cmd.remind_at || Date.parse(m.remind_at) !== Date.parse(cmd.remind_at))) return null;
  if (cmd.action === "cancel" && m.status !== "cancelled") return null;
  return r.data;
}

export type Outcome = { kind: "done"; reminder: Reminder } | { kind: "conflict" } | { kind: "refused"; message: string } | { kind: "uncertain" };
export function commandOutcome(r: Result, cmd: ReminderCommand): Outcome {
  if (r.status === 200 || r.status === 201) {
    const p = parseReceipt(r.body, cmd);
    return p ? { kind: "done", reminder: p.reminder } : { kind: "uncertain" };
  }
  if (r.status === 409) return { kind: "conflict" };
  const msg = r.body && typeof r.body === "object" && typeof (r.body as { error?: unknown }).error === "string" ? (r.body as { error: string }).error : "";
  if (r.status === 401) return { kind: "refused", message: "Votre session a expiré. Reconnectez-vous." };
  if (r.status === 403 || r.status === 404) return { kind: "refused", message: REMINDER_COPY.refused };
  if (r.status === 422) return { kind: "refused", message: msg || REMINDER_COPY.invalidDate };
  return { kind: "uncertain" }; // 429 / 5xx / network / timeout / unverifiable receipt
}

// ---- Window (UI pre-check; the server decides) ----------------------------------------------
export const MIN_DELAY_MS = 5 * 60_000;
export const MAX_DELAY_MS = 90 * 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");
/** datetime-local value of a Date in the device's time zone. */
export const toLocalInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
/** datetime-local → ISO instant, or null when empty / invalid / outside the 5 min – 90 days window. */
export function reminderInstant(local: string, now = Date.now()): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  const t = new Date(local).getTime();
  if (!Number.isFinite(t) || t < now + MIN_DELAY_MS || t > now + MAX_DELAY_MS) return null;
  return new Date(t).toISOString();
}

// ---- Command storage (courant-private-, bound to uid + generation + quote) -------------------
export type Store = { get(k: string): string | null; set(k: string, v: string): void; remove(k: string): void };
export function tabStore(): Store | null {
  try {
    const s = window.sessionStorage;
    return { get: (k) => s.getItem(k), set: (k, v) => s.setItem(k, v), remove: (k) => s.removeItem(k) };
  } catch {
    return null;
  }
}
export const pendingKey = (uid: string, gen: number, quoteId: string) => `courant-private-payment-reminder:${uid}:${gen}:${quoteId.toLowerCase()}`;
const storedSchema = z.object({ uid: z.string().min(1), gen: z.number().int().nonnegative(), command: commandSchema }).strict();
export function readPending(store: Store | null, uid: string, gen: number, quoteId: string): ReminderCommand | null {
  try {
    const raw = store?.get(pendingKey(uid, gen, quoteId));
    if (!raw) return null;
    const r = storedSchema.safeParse(JSON.parse(raw));
    return r.success && r.data.uid === uid && r.data.gen === gen && same(r.data.command.quote_id, quoteId) ? r.data.command : null;
  } catch {
    return null;
  }
}
/** Write then read back; true only when the stored command is exactly this one. */
export function writePending(store: Store | null, uid: string, gen: number, cmd: ReminderCommand): boolean {
  try {
    if (!store) return false;
    store.set(pendingKey(uid, gen, cmd.quote_id), JSON.stringify({ uid, gen, command: cmd }));
    const back = readPending(store, uid, gen, cmd.quote_id);
    return back !== null && JSON.stringify(back) === JSON.stringify(cmd);
  } catch {
    return false;
  }
}
export function clearPending(store: Store | null, uid: string, gen: number, quoteId: string) {
  try {
    store?.remove(pendingKey(uid, gen, quoteId));
  } catch {}
}
export const newCommandId = (): string | null =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : null;

export async function request(fetcher: typeof fetch, url: string, init: RequestInit, timeoutMs = 15_000): Promise<Result> {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<Result>((resolve) => {
    timer = setTimeout(() => {
      controller?.abort();
      resolve({ status: -1, body: null });
    }, timeoutMs);
  });
  const run = (async (): Promise<Result> => {
    try {
      const r = await fetcher(url, { ...init, credentials: "same-origin", cache: "no-store", ...(controller ? { signal: controller.signal } : {}) });
      return { status: r.status, body: await r.json().catch(() => null) };
    } catch {
      return { status: 0, body: null };
    }
  })();
  try {
    return await Promise.race([run, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

export const STATUS_LABEL: Record<Reminder["status"], string> = {
  scheduled: "Rappel prévu",
  cancelled: "Rappel annulé",
  sent: "Rappel envoyé",
  invalidated: "Rappel devenu sans objet (règlement effectué ou dossier modifié)",
  muted: "Rappel désactivé par vos préférences",
};
export const REMINDER_COPY = {
  open: "Me rappeler de régler ce devis",
  intro: "Rappel personnel dans l’application. Ce n’est ni une échéance ni un paiement : vous restez libre de régler quand vous le souhaitez.",
  label: "Me rappeler de régler ce devis le",
  hint: "Entre 5 minutes et 90 jours à partir de maintenant, heure de votre appareil.",
  schedule: "Programmer le rappel",
  reschedule: "Modifier la date du rappel",
  cancel: "Annuler le rappel",
  loading: "Lecture du rappel…",
  failed: "Le rappel n’a pas pu être lu. Réessayez.",
  refused: "Aucun rappel ne peut être programmé pour ce devis depuis votre compte.",
  notAllowed: "Vous ne pouvez pas programmer de rappel pour ce devis.",
  invalidDate: "Choisissez une date entre 5 minutes et 90 jours à partir de maintenant.",
  storage: "Le stockage de cet onglet est indisponible : rien n’a été envoyé.",
  noId: "Votre navigateur ne permet pas de créer une commande sûre : rien n’a été envoyé.",
  uncertain: "La réponse n’a pas pu être vérifiée. Votre demande est conservée telle quelle : renvoyez-la à l’identique.",
  retry: "Renvoyer la demande",
  conflict: "Le rappel a changé entre-temps : il a été relu. Vérifiez puis recommencez si nécessaire.",
  scheduled: "Rappel programmé.",
  cancelled: "Rappel annulé.",
} as const;
