// ADV-DOCUMENTS-001 — types of the quote documents lot. Leaf components receive everything
// through props (contract WEB-SHARED-001); nothing here imports the shared app files.

export type ContractState = "unknown" | "available" | "missing" | "unavailable";
export type ValidityState = "unspecified" | "valid" | "expired";
export type AmendmentStatus = "proposed" | "accepted" | "rejected" | "withdrawn";
export type DocumentKind = "quote" | "amendment";

export interface QuoteLine {
  label: string;
  quantity: number;
  unit_price_cents: number;
}
export interface QuoteTerms {
  valid_until: string | null;
  validity: ValidityState;
  updated_at?: string;
}
export interface QuoteDocumentSummary {
  id: string;
  kind: DocumentKind;
  reference: string;
  revision: number;
  quote_id: string;
  amendment_id: string | null;
  generated_at: string;
  generated_by?: string;
  snapshot_sha256: string;
}
export interface QuoteAmendment {
  id: string;
  intervention_id: string;
  base_quote_id: string;
  artisan_id: string;
  version: number;
  reference: string;
  status: AmendmentStatus;
  reason: string;
  lines: QuoteLine[];
  subtotal_cents: number;
  tax_rate: number;
  tax_cents: number;
  total_cents: number;
  terms: QuoteTerms;
  decision_note: string;
  decided_by: string | null;
  created_at: string;
  decided_at: string | null;
}
export interface AmendmentPermissions {
  can_decide: boolean;
  can_withdraw: boolean;
  can_generate: boolean;
}
export interface OverviewAmendment extends QuoteAmendment {
  permissions: AmendmentPermissions;
  documents: QuoteDocumentSummary[];
}
export interface QuotePermissions {
  can_set_terms: boolean;
  can_generate: boolean;
  can_propose: boolean;
}
export interface OverviewQuote {
  id: string;
  reference: string;
  status: "sent" | "accepted" | "rejected" | string;
  created_at: string;
  accepted_at: string | null;
  lines: QuoteLine[];
  subtotal_cents: number;
  tax_rate: number;
  tax_cents: number;
  total_cents: number;
  terms: QuoteTerms | null;
  permissions: QuotePermissions;
  documents: QuoteDocumentSummary[];
  amendments: OverviewAmendment[];
}
export interface QuoteDocumentEvent {
  id: number;
  intervention_id: string;
  quote_id: string;
  amendment_id: string | null;
  document_id: string | null;
  actor_id: string;
  action:
    | "terms_set"
    | "document_generated"
    | "document_downloaded"
    | "amendment_proposed"
    | "amendment_accepted"
    | "amendment_rejected"
    | "amendment_withdrawn";
  details: Record<string, unknown>;
  created_at: string;
}
export interface QuoteDocumentsOverview {
  intervention: { id: string; status: string; artisan_id: string | null; site_id: string | null };
  viewer: { role: string; is_artisan: boolean; can_manage: boolean; is_admin: boolean };
  issuer: { ready: boolean; missing: string[] };
  quotes: OverviewQuote[];
  history: QuoteDocumentEvent[];
  settlement: "not_connected";
}

/** Target of a load: a whole dossier, or the single quote of the `quote-documents` view. */
export type QuoteDocumentsTarget = { interventionId: string } | { quoteId: string };

export type QuoteDocumentsCommand =
  | { action: "set_terms"; quote_id: string; valid_until: string | null }
  | { action: "generate"; quote_id: string; amendment_id: string | null }
  | {
      action: "propose";
      base_quote_id: string;
      lines: QuoteLine[];
      tax_rate: 0 | 5.5 | 10 | 20;
      reason: string;
      valid_until: string | null;
    }
  | { action: "withdraw"; amendment_id: string }
  | { action: "accept"; amendment_id: string }
  | { action: "reject"; amendment_id: string; note: string };

export type QuoteDocumentsCommandResult =
  | { action: "set_terms"; terms: QuoteTerms & { quote_id: string } }
  | { action: "generate"; document: QuoteDocumentSummary; created: boolean }
  | { action: "propose" | "withdraw" | "accept" | "reject"; amendment: QuoteAmendment };

/** Error shape rendered as-is by the leaf components (server message, never an internal name). */
export interface QuoteDocumentsFailure {
  status: number;
  message: string;
  code?: "issuer_incomplete" | string;
  missing?: string[];
}

/** Injected by the lead (built on the shared api() helper and its identity guard).
 *  A `null` result means the chain is stale: no message, no state update. */
export interface QuoteDocumentsClient {
  load(target: QuoteDocumentsTarget): Promise<QuoteDocumentsOverview | null>;
  command(body: QuoteDocumentsCommand): Promise<QuoteDocumentsCommandResult | null>;
  /** URL of the private download route; used only as a link target, never fetched by the leaf. */
  documentHref(documentId: string, inline?: boolean): string;
}

export interface QuoteDocumentsScope {
  userId: string;
  role: "client" | "artisan" | "manager" | "admin";
  organizationId?: string;
  siteId?: string;
  authority: { canWrite: boolean; reason?: string };
}

export interface QuoteDocumentsDemo {
  overview: QuoteDocumentsOverview;
}

export function isQuoteDocumentsFailure(error: unknown): error is QuoteDocumentsFailure {
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as QuoteDocumentsFailure).status === "number" &&
    typeof (error as QuoteDocumentsFailure).message === "string"
  );
}
