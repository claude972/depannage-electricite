// FIN-05 / ENT-16 customer invoices & credit notes — pure model (no React). Read-only consumer of
// the customer invoice routes (lib/features/customer-invoices/handlers.ts, read-only):
//   GET /api/invoices?organization_id&site_id&intervention_id&kind&basis&limit&cursor
//   GET /api/invoices/:id            PDF: /api/invoices/:id/pdf?inline=1 (view) | /pdf (download)
// Amounts are shown exactly as stored (integer cents), nothing is recomputed, and an invoice's
// document state never says anything about a payment.
import { readRefused } from "../../app/refusal";
import { z } from "zod";
import { taxRateSchema } from "../../../lib/tax-rates";

export type InvoiceKind = "invoice" | "credit_note";
export type InvoiceBasis = "service" | "platform_commission";
export type InvoiceFilters = { organization_id?: string | null; site_id?: string | null; intervention_id?: string | null; kind?: InvoiceKind | null; basis?: InvoiceBasis | null };
export type InvoicesResult = { status: number; body: unknown; retryAfter: number | null };
export type InvoicesApi = {
  list(filters: InvoiceFilters, limit: number, cursor: string | null): Promise<InvoicesResult>;
  detail(id: string): Promise<InvoicesResult>;
};
export type InvoicesContext = { generation(): number; userId(): string | null };
export const DEFAULT_INVOICES_CONTEXT: InvoicesContext = { generation: () => 0, userId: () => null };
export const INVOICES_LIMIT = 25;
export const INVOICES_TIMEOUT_MS = 15_000;
export const INVOICES_TIMEOUT = -1;
const FILTER_KEYS = ["organization_id", "site_id", "intervention_id", "kind", "basis"] as const;

/** Canonical filters: every key present, null when unset (same shape the server echoes). */
export function normalizeFilters(f: InvoiceFilters): Required<{ [K in keyof InvoiceFilters]: NonNullable<InvoiceFilters[K]> | null }> {
  return { organization_id: f.organization_id?.toLowerCase() ?? null, site_id: f.site_id?.toLowerCase() ?? null, intervention_id: f.intervention_id?.toLowerCase() ?? null, kind: f.kind ?? null, basis: f.basis ?? null };
}
export const filtersKey = (f: InvoiceFilters) => JSON.stringify(normalizeFilters(f));

async function timed(fetcher: typeof fetch, path: string, timeoutMs: number): Promise<InvoicesResult> {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut: InvoicesResult = { status: INVOICES_TIMEOUT, body: null, retryAfter: null };
  const deadline = new Promise<InvoicesResult>((resolve) => {
    timer = setTimeout(() => {
      controller?.abort();
      resolve(timedOut);
    }, timeoutMs);
  });
  const request = (async (): Promise<InvoicesResult> => {
    try {
      const response = await fetcher(path, { method: "GET", credentials: "same-origin", cache: "no-store", ...(controller ? { signal: controller.signal } : {}) });
      const retry = Number(response.headers.get("Retry-After"));
      return { status: response.status, body: await response.json().catch(() => null), retryAfter: Number.isFinite(retry) && retry > 0 ? Math.ceil(retry) : null };
    } catch (error) {
      if (controller?.signal.aborted) return timedOut;
      throw error;
    }
  })();
  try {
    return await Promise.race([request, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
export function createInvoicesApi(fetcher: typeof fetch = (...a) => fetch(...a), { timeoutMs = INVOICES_TIMEOUT_MS } = {}): InvoicesApi {
  return {
    list: (filters, limit, cursor) => {
      const f = normalizeFilters(filters);
      const parts = FILTER_KEYS.filter((k) => f[k] !== null).map((k) => `${k}=${encodeURIComponent(String(f[k]))}`);
      parts.push(`limit=${limit}`);
      if (cursor) parts.push(`cursor=${encodeURIComponent(cursor)}`); // opaque, unchanged
      return timed(fetcher, `/api/invoices?${parts.join("&")}`, timeoutMs);
    },
    detail: (id) => timed(fetcher, `/api/invoices/${encodeURIComponent(id)}`, timeoutMs),
  };
}

// ---- Strict parse --------------------------------------------------------------------------------
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const cents = z.number().int().min(0).max(2147483647);
const instant = z.string().refine((v) => !Number.isNaN(Date.parse(v)) && /T/.test(v));
const version = z.object({ basis: z.literal("immutable_register_snapshot"), sha256: z.string().regex(/^[0-9a-f]{64}$/) }).strict();
const links = z.object({ detail: z.string(), open: z.string(), download: z.string() }).strict();
const summarySchema = z
  .object({
    id: uuid, kind: z.enum(["invoice", "credit_note"]), basis: z.enum(["service", "platform_commission"]), number: z.string().min(1).max(40),
    issuer_name: z.string().max(160), recipient_name: z.string().max(160), intervention_id: uuid, quote_id: uuid, related_invoice_id: uuid.nullable(),
    total_cents: cents.min(1), tax_cents: cents, currency: z.literal("eur"), issued_at: instant, document_state: z.literal("issued"), version, links,
  })
  .strict();
export type InvoiceSummary = z.infer<typeof summarySchema>;
/** Links must be exactly the customer routes of THIS document (never operator URLs). */
export const invoiceLinks = (id: string) => ({ detail: `/api/invoices/${id}`, open: `/api/invoices/${id}/pdf?inline=1`, download: `/api/invoices/${id}/pdf` });
const linksOk = (s: { id: string; links: { detail: string; open: string; download: string } }) => JSON.stringify(s.links) === JSON.stringify(invoiceLinks(s.id));
const summaryOk = (s: InvoiceSummary) => linksOk(s) && (s.kind === "invoice") === (s.related_invoice_id === null) && s.tax_cents <= s.total_cents;

const filtersEcho = z.object({ organization_id: uuid.nullable(), site_id: uuid.nullable(), intervention_id: uuid.nullable(), kind: z.enum(["invoice", "credit_note"]).nullable(), basis: z.enum(["service", "platform_commission"]).nullable() }).strict();
const listSchema = z
  .object({
    invoices: z.array(summarySchema).max(50),
    page: z.object({ limit: z.number().int().min(1).max(50), total: z.number().int().min(0), remaining: z.number().int().min(0), has_more: z.boolean(), next_cursor: z.string().min(1).max(1024).nullable(), complete: z.boolean() }).strict(),
    filters: filtersEcho,
    captured_at: instant,
  })
  .strict();
export type InvoiceList = z.infer<typeof listSchema>;
/** Off-contract ⇒ null (an error, never an empty list). */
export function parseInvoiceList(body: unknown, filters: InvoiceFilters, limit: number, firstPage: boolean): InvoiceList | null {
  const parsed = listSchema.safeParse(body);
  if (!parsed.success) return null;
  const l = parsed.data, p = l.page, f = normalizeFilters(filters);
  if (JSON.stringify(l.filters) !== JSON.stringify(f) || p.limit !== limit) return null;
  if (p.remaining > p.total || (firstPage && p.remaining !== p.total)) return null;
  if (l.invoices.length !== Math.min(p.remaining, p.limit)) return null;
  if (p.has_more !== p.remaining > p.limit || p.has_more !== (p.next_cursor !== null) || p.complete !== (firstPage && !p.has_more)) return null;
  if (new Set(l.invoices.map((i) => i.id)).size !== l.invoices.length || !l.invoices.every(summaryOk)) return null;
  if (l.invoices.some((i) => (f.kind && i.kind !== f.kind) || (f.basis && i.basis !== f.basis) || (f.intervention_id && i.intervention_id !== f.intervention_id))) return null;
  return l;
}

const party = z.object({ legal_name: z.string().max(160).optional(), name: z.string().max(160).optional(), address: z.string().min(1).max(500), siret: z.string().max(14).nullable().optional(), vat_number: z.string().max(80).nullable().optional(), legal_status: z.string().max(80).nullable().optional(), organization: z.string().max(160).nullable().optional(), subject_kind: z.enum(["profile", "organization"]).optional(), subject_id: uuid.optional(), profile_id: uuid.optional(), billing_version: z.number().int().positive().optional() }).strict();
const invoiceSchema = z
  .object({
    id: uuid, kind: z.enum(["invoice", "credit_note"]), basis: z.enum(["service", "platform_commission"]), number: z.string().min(1).max(40), issuer_key: z.string().min(1).max(80),
    issuer: party, recipient: party, payment_id: uuid, quote_id: uuid, intervention_id: uuid, related_invoice_id: uuid.nullable(),
    lines: z.array(z.object({ label: z.string().min(1).max(160), quantity: z.number().int().min(1).max(1000), unit_price_cents: cents }).strict()).min(1).max(30),
    subtotal_cents: cents, tax_rate: taxRateSchema, tax_cents: cents, total_cents: cents.min(1), currency: z.literal("eur"), reason: z.string().max(1000), issued_at: instant,
  })
  .strict();
export type InvoiceDocument = z.infer<typeof invoiceSchema>;
const detailSchema = z
  .object({
    invoice: invoiceSchema, document: z.unknown(), version, links,
    related_invoice: summarySchema.nullable(), credit_notes: z.array(summarySchema).max(50),
    credit_notes_page: z.object({ total: z.number().int().min(0), complete: z.boolean() }).strict(),
  })
  .strict();
export type InvoiceDetail = z.infer<typeof detailSchema>;
export function parseInvoiceDetail(body: unknown, id: string): InvoiceDetail | null {
  const parsed = detailSchema.safeParse(body);
  if (!parsed.success) return null;
  const d = parsed.data, i = d.invoice;
  if (i.id !== id || JSON.stringify(d.links) !== JSON.stringify(invoiceLinks(id))) return null;
  // Stored snapshot consistency (displayed as is, never recomputed): reject an incoherent one.
  if (i.subtotal_cents + i.tax_cents !== i.total_cents || i.lines.reduce((n, l) => n + l.quantity * l.unit_price_cents, 0) !== i.subtotal_cents) return null;
  if ((i.kind === "invoice") !== (i.related_invoice_id === null)) return null;
  if (i.kind === "credit_note" ? !d.related_invoice || d.related_invoice.id !== i.related_invoice_id || d.related_invoice.kind !== "invoice" : d.related_invoice !== null) return null;
  if (i.kind === "credit_note" && d.credit_notes.length) return null;
  if (!d.credit_notes.every((n) => summaryOk(n) && n.kind === "credit_note" && n.related_invoice_id === i.id)) return null;
  if (d.credit_notes.length !== Math.min(d.credit_notes_page.total, 50) || d.credit_notes_page.complete !== d.credit_notes_page.total <= 50) return null;
  if (d.related_invoice && !summaryOk(d.related_invoice)) return null;
  return d;
}

// ---- Exact formatting ------------------------------------------------------------------------------
const GROUP = (n: number) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(n);
/** Integer cents → « 1 234,56 € » with integer arithmetic (never a float division shown). */
export function formatEuros(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) return "montant invalide";
  return `${GROUP(Math.floor(cents / 100))},${String(cents % 100).padStart(2, "0")} €`;
}
export const formatRate = (rate: number) => `${String(rate).replace(".", ",")} %`;
export const KIND_LABEL: Record<InvoiceKind, string> = { invoice: "Facture", credit_note: "Avoir" };
export const BASIS_LABEL: Record<InvoiceBasis, string> = { service: "Prestation", platform_commission: "Commission de la plateforme" };
export const INVOICES_COPY = {
  empty: "Aucune facture émise.",
  loadFailed: "Les factures n’ont pas pu être vérifiées. Réessayez.",
  session: "Votre session a expiré ou vous n’avez pas accès à ces documents. Reconnectez-vous.",
  notFound: "Ce document est introuvable ou n’est pas accessible depuis votre compte.",
  invalid: "Ces filtres ne sont pas acceptés. Rechargez la page.",
  demo: "En démonstration, aucune facture n’est émise : les factures réelles apparaissent ici une fois émises.",
  notPayment: "L’émission d’une facture ou d’un avoir n’indique pas l’état du paiement.",
  partial: (loaded: number, total: number) => `${loaded} document(s) affiché(s) sur ${total}.`,
  end: "Fin de la liste.",
  creditNotesPartial: (shown: number, total: number) => `${shown} avoir(s) affiché(s) sur ${total}.`,
  version: "Empreinte de l’instantané enregistré (identifiant de version, pas une signature).",
} as const;

// ---- State machine + controller ------------------------------------------------------------------
export type InvoicesState = {
  phase: "loading" | "ready" | "error" | "denied" | "demo";
  invoices: InvoiceSummary[];
  page: InvoiceList["page"] | null;
  /** Total from the FIRST page only (with no cursor); later pages never become a total. */
  total: number | null;
  loadingMore: boolean;
  error: string;
  detail: { id: string; phase: "loading" | "ready" | "error" | "denied"; data: InvoiceDetail | null; error: string } | null;
};
export const INVOICES_INITIAL: InvoicesState = { phase: "loading", invoices: [], page: null, total: null, loadingMore: false, error: "", detail: null };

const errorFor = (status: number) => (status === 401 || status === 403 ? INVOICES_COPY.session : status === 404 ? INVOICES_COPY.notFound : status === 422 ? INVOICES_COPY.invalid : INVOICES_COPY.loadFailed);
export function applyInvoiceList(s: InvoicesState, r: InvoicesResult, filters: InvoiceFilters, limit: number, append: boolean): InvoicesState {
  if (r.status === 200) {
    const l = parseInvoiceList(r.body, filters, limit, !append);
    if (!l) return { ...s, loadingMore: false, phase: append ? s.phase : "error", error: INVOICES_COPY.loadFailed };
    const seen = new Set(append ? s.invoices.map((x) => x.id) : []);
    const invoices = [...(append ? s.invoices : []), ...l.invoices.filter((x) => !seen.has(x.id) && (seen.add(x.id), true))];
    return { ...s, phase: "ready", invoices, page: l.page, total: append ? s.total : l.page.total, loadingMore: false, error: "" };
  }
  const denied = readRefused(r.status);
  // A refusal on ANY page (first or « Afficher plus ») purges every protected row already shown (E44);
  // a transient failure on a later page keeps the authorized rows and explains itself (E45).
  if (denied) return { ...INVOICES_INITIAL, phase: "denied", error: errorFor(r.status) };
  return { ...s, loadingMore: false, phase: append ? s.phase : "error", error: errorFor(r.status) };
}
export function applyInvoiceDetail(s: InvoicesState, id: string, r: InvoicesResult): InvoicesState {
  if (r.status === 200) {
    const data = parseInvoiceDetail(r.body, id);
    return { ...s, detail: data ? { id, phase: "ready", data, error: "" } : { id, phase: "error", data: null, error: INVOICES_COPY.loadFailed } };
  }
  const denied = r.status === 401 || r.status === 403 || r.status === 404;
  return { ...s, detail: { id, phase: denied ? "denied" : "error", data: null, error: errorFor(r.status) } };
}

/** Read-only controller: list sequence (any new load or filter voids older replies, the cursor
 *  always belongs to the applied filters), single-flight « Afficher plus », detail sequence; every
 *  reply applies only under the unchanged generation + uid of an attached view. Demo: no call. */
export function createInvoicesController({ api, context = DEFAULT_INVOICES_CONTEXT, get, set, demo = false, limit = INVOICES_LIMIT }: { api: () => InvoicesApi; context?: InvoicesContext; get: () => InvoicesState; set: (s: InvoicesState) => void; demo?: boolean; limit?: number }) {
  let listSeq = 0;
  let detailSeq = 0;
  let attached = true;
  let applied: InvoiceFilters = {};
  const same = (gen: number, uid: string | null) => attached && context.generation() === gen && context.userId() === uid;
  const fetchList = async (append: boolean) => {
    const my = append ? listSeq : ++listSeq;
    const gen = context.generation(), uid = context.userId();
    const filters = applied;
    const cursor = append ? get().page?.next_cursor ?? null : null;
    let r: InvoicesResult;
    try {
      r = await api().list(filters, limit, cursor);
    } catch {
      r = { status: 0, body: null, retryAfter: null };
    }
    if (!same(gen, uid) || my !== listSeq || filtersKey(filters) !== filtersKey(applied)) return false;
    set(applyInvoiceList(get(), r, filters, limit, append));
    return true;
  };
  return {
    /** New filters (or reload): cursor dropped, list restarts from page 1. */
    load(filters?: InvoiceFilters) {
      detailSeq++; // a detail opened before this load can never reappear after it (ROOT review)
      if (filters) applied = { ...filters };
      if (demo) {
        set({ ...INVOICES_INITIAL, phase: "demo" });
        return Promise.resolve(false);
      }
      set({ ...get(), phase: "loading", invoices: [], page: null, total: null, error: "", loadingMore: false, detail: null });
      return fetchList(false);
    },
    more() {
      const s = get();
      if (demo || s.loadingMore || !s.page?.has_more || !s.page.next_cursor) return Promise.resolve(false);
      set({ ...s, loadingMore: true });
      return fetchList(true);
    },
    async openDetail(id: string) {
      if (demo) return false;
      const my = ++detailSeq;
      const gen = context.generation(), uid = context.userId();
      set({ ...get(), detail: { id, phase: "loading", data: null, error: "" } });
      let r: InvoicesResult;
      try {
        r = await api().detail(id);
      } catch {
        r = { status: 0, body: null, retryAfter: null };
      }
      if (!same(gen, uid) || my !== detailSeq) return false;
      set(applyInvoiceDetail(get(), id, r));
      return true;
    },
    closeDetail() {
      detailSeq++;
      set({ ...get(), detail: null });
    },
    get filters() {
      return applied;
    },
    attach() {
      attached = true;
    },
    detach() {
      attached = false;
      listSeq++;
      detailSeq++;
    },
  };
}
