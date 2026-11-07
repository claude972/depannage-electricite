// PUB-04 public callback requests — pure model, no React. STRICT MIRROR of 07d718f
// (lib/features/public-callback/contract.ts + handlers.ts; not merged here):
//   GET  /api/public/callback → { available }
//   POST /api/public/callback { request_id, phone, reason, consent: true } → exactly { received: true }
//        same UUID to retry exactly the same content; other content ⇒ new UUID; 429 + Retry-After.
//   GET  /api/support/callbacks?status=open|closed&page=N → { items, total, can_close, page: { number, limit: 25, pages } }
//   POST /api/support/callbacks { id, expected_version: 1 } → exactly { closed: true }
// No SMS, no automatic call, no promised delay. The phone lives in memory only.
import { z } from "zod";

export const PUBLIC_PATH = "/api/public/callback";
export const SUPPORT_PATH = "/api/support/callbacks";
export const PAGE_SIZE = 25;
export const REASONS = ["new_request", "existing_request", "other"] as const;
export type Reason = (typeof REASONS)[number];
export type Result = { status: number; body: unknown; retryAfterS: number | null };
export type Context = { generation(): number; userId(): string | null };

const reason = z.enum(REASONS);
const phone = z.string().regex(/^\+[1-9]\d{7,14}$/);
const timestamp = z.iso.datetime({ offset: true });
export const availableSchema = z.object({ available: z.boolean() }).strict();
export const receiptSchema = z.object({ received: z.literal(true) }).strict();
export const closureSchema = z.object({ closed: z.literal(true) }).strict();
const item = z
  .object({ id: z.uuid(), phone, reason, version: z.union([z.literal(1), z.literal(2)]), created_at: timestamp, closed_at: timestamp.nullable() })
  .strict()
  .refine((r) => (r.version === 2) === (r.closed_at !== null));
const queue = z
  .object({
    total: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    items: z.array(item).max(PAGE_SIZE),
    can_close: z.boolean(),
    page: z.object({ number: z.number().int().min(1), limit: z.literal(PAGE_SIZE), pages: z.number().int().min(1) }).strict(),
  })
  .strict();
export type CallbackItem = z.infer<typeof item>;
export type CallbackQueue = z.infer<typeof queue>;
export type Status = "open" | "closed";

export const parseAvailable = (b: unknown) => {
  const r = availableSchema.safeParse(b);
  return r.success ? r.data.available : null;
};
export const isReceipt = (b: unknown) => receiptSchema.safeParse(b).success;
export const isClosure = (b: unknown) => closureSchema.safeParse(b).success;
/** Same checks as the handler: requested page, page count, exact item count, status ⇔ version, newest first. */
export function parseQueue(body: unknown, status: Status, pageNumber: number): CallbackQueue | null {
  const r = queue.safeParse(body);
  if (!r.success) return null;
  const q = r.data;
  const expected = Math.max(0, Math.min(PAGE_SIZE, q.total - (pageNumber - 1) * PAGE_SIZE));
  if (q.page.number !== pageNumber || q.page.pages !== Math.max(1, Math.ceil(q.total / PAGE_SIZE))) return null;
  if (q.items.length !== expected || new Set(q.items.map((i) => i.id)).size !== expected) return null;
  if (q.items.some((i) => i.version !== (status === "closed" ? 2 : 1))) return null;
  if (q.items.some((i, k) => k > 0 && Date.parse(i.created_at) > Date.parse(q.items[k - 1].created_at))) return null;
  return q;
}
export const queueUrl = (status: Status, page: number) => `${SUPPORT_PATH}?status=${status}&page=${page}`;

const retryAfter = (v: string | null): number | null => (v && /^\d{1,5}$/.test(v.trim()) ? Math.min(Number(v.trim()), 3600) : null);
export async function timed(fetcher: typeof fetch, url: string, init: RequestInit, timeoutMs = 15_000): Promise<Result> {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<Result>((resolve) => {
    timer = setTimeout(() => {
      controller?.abort();
      resolve({ status: -1, body: null, retryAfterS: null });
    }, timeoutMs);
  });
  const request = (async (): Promise<Result> => {
    try {
      const r = await fetcher(url, { ...init, credentials: "same-origin", cache: "no-store", referrerPolicy: "no-referrer", ...(controller ? { signal: controller.signal } : {}) });
      return { status: r.status, body: await r.json().catch(() => null), retryAfterS: retryAfter(r.headers.get("retry-after")) };
    } catch {
      return { status: controller?.signal.aborted ? -1 : 0, body: null, retryAfterS: null };
    }
  })();
  try {
    return await Promise.race([request, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** Light local check only (the server normalizes and decides): digits, spaces, dots, dashes, optional +. */
export function phoneLooksValid(v: string): boolean {
  const t = v.trim();
  return t.length <= 40 && /^\+?[\d\s.()-]+$/.test(t) && t.replace(/\D/g, "").length >= 8;
}
/** The request_id is kept only for exactly the same content; any edit ⇒ a new UUID at the next submit. */
export type Attempt = { request_id: string; phone: string; reason: Reason };
export function attemptFor(prev: Attempt | null, phoneValue: string, reasonValue: Reason, newId: () => string | null): Attempt | null {
  const p = phoneValue.trim();
  if (prev && prev.phone === p && prev.reason === reasonValue) return prev;
  const id = newId();
  return id ? { request_id: id, phone: p, reason: reasonValue } : null;
}

export const CONSENT_TEXT = "J’accepte d’être rappelé à ce numéro au sujet de cette demande.";
export const REASON_LABEL: Record<Reason, string> = {
  new_request: "Une nouvelle demande de dépannage",
  existing_request: "Une demande déjà déposée",
  other: "Autre sujet",
};
export const COPY = {
  title: "Être rappelé",
  intro: "Laissez un numéro : l’équipe d’assistance pourra vous rappeler au sujet de votre demande. Aucun SMS ni appel automatique, et aucun délai n’est promis.",
  phone: "Numéro de téléphone",
  reason: "Objet",
  submit: "Demander à être rappelé",
  sending: "Envoi…",
  received: "Votre demande de rappel a bien été reçue. Elle sera traitée par l’équipe d’assistance, sans délai garanti. Aucun SMS ni appel automatique n’est envoyé.",
  consentRequired: "Cochez la case de consentement pour envoyer la demande.",
  phoneInvalid: "Saisissez un numéro de téléphone valide (avec son indicatif si nécessaire).",
  reasonRequired: "Choisissez l’objet de la demande.",
  invalid: "Le numéro ou la demande n’a pas été accepté : vérifiez la saisie.",
  closed: "Les demandes de rappel sont actuellement fermées.",
  closedState: "Les demandes de rappel ne sont pas ouvertes actuellement : aucune demande ne peut être enregistrée depuis ce site.",
  failedState: "La disponibilité des demandes de rappel n’a pas pu être vérifiée : aucune demande ne peut être envoyée pour le moment.",
  retry: "La demande n’a pas été confirmée. Réessayez : la même demande sera renvoyée, sans doublon.",
  limited: (s: number) => `Trop de demandes pour le moment. Vous pourrez réessayer dans ${s} s.`,
  limitedDone: "Vous pouvez réessayer.",
  noUuid: "Ce navigateur ne permet pas de créer un identifiant sécurisé : la demande ne peut pas être envoyée d’ici.",
  // Operator
  opTitle: "Demandes de rappel",
  opNote: "Numéros laissés par le public, tels que saisis (normalisés par le serveur). « Classé » signifie seulement qu’un opérateur a classé la demande : le résultat d’un éventuel appel n’est pas connu.",
  open: "À traiter",
  closedTab: "Classées",
  close: "Classer",
  closedLabel: "Classé (action opérateur)",
  empty: "Aucune demande de rappel.",
  loading: "Lecture des demandes de rappel…",
  loadFailed: "Les demandes de rappel n’ont pas pu être vérifiées. Réessayez.",
  forbidden: "Vos habilitations d’assistance, vérifiées par le serveur, ne couvrent pas les demandes de rappel.",
  closedOk: "Demande classée. La liste a été relue.",
  conflict: "La demande a déjà été classée ou a changé : la liste a été relue.",
  uncertain: "Le classement n’a pas été confirmé : la liste a été relue.",
} as const;
