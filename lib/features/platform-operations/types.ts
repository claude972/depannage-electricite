// ADV-PLATFORM-FINANCE-001 — own types only; nothing imported from components/app/**.
export type ContractState = "unknown" | "available" | "missing" | "unavailable";
export type PlatformScopeKey = "finance_read" | "finance_write" | "reviews_moderate" | "audit_read" | "support_read" | "support_reply" | "support_status";
export const PLATFORM_SCOPES: readonly PlatformScopeKey[] = ["finance_read", "finance_write", "reviews_moderate", "audit_read", "support_read", "support_reply", "support_status"];

export type PlatformAccess = {
  super_admin: boolean;
  scopes: PlatformScopeKey[];
  super_admin_count: number | null;
  capabilities: { support: boolean; support_reply: boolean; support_status: boolean; operators: boolean; audit: boolean; finance: boolean; reviews_moderation: boolean; refund_execution: boolean; invoice_rendering: boolean };
  config: FinanceConfig;
};
export type FinanceConfig = {
  commission: { setting_bps: number | null; setting_version: number | null; checkout_bps: number | null; aligned: boolean | null };
  payment_provider: { configured: boolean; mode: "test" | "live" | null; live_enabled: boolean };
  invoice_issuer: { configured: boolean };
};

/** Scope handed down by the lead (shared contract §2); the component never derives rights from it. */
export type PlatformViewScope = {
  userId: string;
  role: string;
  organizationId?: string;
  siteId?: string;
  authority: { canWrite: boolean; reason?: string };
};

export type Page = { limit: number; total: number; has_more: boolean; next_cursor: string | null };
export type ListQuery = { limit?: number; cursor?: string | null } & Record<string, string | number | null | undefined>;

export type OperatorGrant = {
  id: string; user_id: string; full_name?: string | null; scope: PlatformScopeKey; status: "active" | "revoked"; note: string;
  account_role?: "client" | "manager" | "artisan" | "admin" | null;
  granted_by: string; granted_at: string; revoked_by: string | null; revoked_at: string | null; revoke_note: string;
};
export type AuditEntry = { id: number; actor_id: string | null; action: string; target_kind: string; target_id: string; details: Record<string, unknown>; created_at: string };
export type Setting<T> = { key: string; value: T; version: number; updated_by: string; updated_at: string };
export type InvoiceIssuer = { legal_name: string; siret: string; address: string; vat_number: string | null; commission_vat_rate: number | null };
export type CommissionSetting = { bps: number };
export type BillingContact = { subject_kind: "profile" | "organization"; subject_id: string; legal_name: string; address: string; siret: string | null; vat_number: string | null; version: number; updated_by: string; updated_at: string };

export type LedgerKind = "payment_settled" | "commission_estimated" | "commission_withheld" | "refund_settled";
export type LedgerEntry = {
  id: string; request_id: string; entry_kind: LedgerKind; direction: "credit" | "debit"; amount_cents: number; currency: "eur";
  payment_id: string; external_event_id: string | null; basis: Record<string, unknown>; recorded_by: string | null; created_at: string;
};
export type FinanceReport = {
  payments: { paid_count: number; paid_cents: number; pending_count: number; failed_count: number; failed_attempts: number };
  ledger: {
    settled_count: number; settled_cents: number; missing_settlement: number; amount_mismatches: number;
    commission_estimated_count: number; commission_estimated_cents: number; commission_withheld_count: number; commission_withheld_cents: number;
    refund_settled_count: number; refund_settled_cents: number;
  };
  refund_requests: Record<string, { count: number; cents: number }>;
  disputes: Record<string, number>;
  invoices: { invoice_count: number; credit_note_count: number };
  commission_setting: { bps: number; version: number; updated_at: string } | null;
  currency: "eur"; generated_at: string;
};
export type ReconcileResult = { settled_added: number; commission_added: number; commission_bps: number | null; setting_version: number | null; remaining_unsettled: number };

export type RefundStatus = "requested" | "approved" | "rejected" | "cancelled" | "settled";
export type RefundRequest = {
  id: string; request_id: string; payment_id: string; amount_cents: number; currency: "eur"; reason: string; status: RefundStatus; version: number;
  requested_by: string; created_at: string; updated_at: string; decided_by: string | null; decided_at: string | null; decision_note: string;
  provider_reference: string | null; settled_event_id: string | null; settled_at: string | null;
};
export type DisputeStatus = "open" | "under_review" | "resolved" | "closed";
export type DisputeOutcome = "none" | "refund_requested" | "no_refund" | "other";
export type Dispute = {
  id: string; request_id: string; payment_id: string; intervention_id: string; origin: "client" | "artisan" | "platform"; subject: string; description: string;
  status: DisputeStatus; outcome: DisputeOutcome; refund_request_id: string | null; version: number; opened_by: string; created_at: string; updated_at: string;
  resolved_by: string | null; resolved_at: string | null; resolution_note: string;
};
export type InvoiceLine = { label: string; quantity: number; unit_price_cents: number };
export type InvoiceParty = { legal_name?: string; name?: string; siret?: string | null; address: string; vat_number?: string | null; legal_status?: string | null; organization?: string | null; subject_kind?: string; subject_id?: string };
export type Invoice = {
  id: string; request_id: string; kind: "invoice" | "credit_note"; basis: "service" | "platform_commission"; number: string; issuer_key: string;
  issuer: InvoiceParty; recipient: InvoiceParty; payment_id: string; quote_id: string; intervention_id: string; related_invoice_id: string | null;
  lines: InvoiceLine[]; subtotal_cents: number; tax_rate: number; tax_cents: number; total_cents: number; currency: "eur"; reason: string; issued_by: string; issued_at: string;
};
export type InvoiceReadiness = { ready: boolean; missing: string[]; preview: Record<string, unknown> & { total_cents?: number | null; tax_cents?: number | null; subtotal_cents?: number | null; service_address?: string | null } };

export type ModerationState = "visible" | "hidden";
export type ReviewModeration = { review_id: string; state: ModerationState; version: number; note: string; updated_by: string; updated_at: string };
export type Contestation = { id: string; request_id: string; review_id: string; contested_by: string; reason: string; status: "open" | "upheld" | "dismissed"; version: number; created_at: string; decided_by: string | null; decided_at: string | null; decision_note: string };
export type ModeratedReview = { id: string; intervention_id: string; author_id: string; rating: number; body: string; created_at: string; moderation: ReviewModeration | null; contestations: Contestation[] };

/** Injected by the lead on top of api(); every call may resolve to null when the chain is stale (runForResult). */
export type PlatformClient = {
  load: {
    me(): Promise<PlatformAccess | null>;
    operators(query?: ListQuery): Promise<{ grants: OperatorGrant[]; page: Page } | null>;
    audit(query?: ListQuery): Promise<{ entries: AuditEntry[]; page: Page } | null>;
    settings(): Promise<{ invoice_issuer: Setting<InvoiceIssuer> | null; commission_bps: Setting<CommissionSetting> | null } | null>;
    billingContact(subject_kind: "profile" | "organization", subject_id: string): Promise<{ billing_contact: BillingContact | null } | null>;
    finance(): Promise<{ report: FinanceReport; config: FinanceConfig } | null>;
    ledger(query?: ListQuery): Promise<{ entries: LedgerEntry[]; page: Page } | null>;
    invoices(query?: ListQuery): Promise<{ invoices: Invoice[]; page: Page } | null>;
    invoice(id: string): Promise<{ invoice: Invoice; credit_notes: Invoice[]; document: unknown } | null>;
    refundRequests(query?: ListQuery): Promise<{ requests: RefundRequest[]; page: Page } | null>;
    disputes(query?: ListQuery): Promise<{ disputes: Dispute[]; page: Page } | null>;
    reviews(query?: ListQuery): Promise<{ reviews: ModeratedReview[]; page: Page } | null>;
  };
  command: {
    grant(input: { user_id: string; scope: PlatformScopeKey; note: string }): Promise<{ grant: OperatorGrant; replayed: boolean } | null>;
    revoke(input: { grant_id: string; note: string }): Promise<{ grant: OperatorGrant; replayed: boolean } | null>;
    setSuperAdmin(input: { user_id: string; enabled: boolean; restore_role?: "client" | "manager"; note: string }): Promise<{ profile_id: string; role: string; replayed: boolean } | null>;
    setSetting(input: { key: "invoice_issuer"; value: InvoiceIssuer; expected_version: number | null } | { key: "commission_bps"; value: CommissionSetting; expected_version: number | null }): Promise<{ setting: Setting<unknown> } | null>;
    setBillingContact(input: { subject_kind: "profile" | "organization"; subject_id: string; legal_name: string; address: string; siret: string | null; vat_number: string | null; expected_version: number | null }): Promise<{ billing_contact: BillingContact } | null>;
    reconcile(input: { limit?: number }): Promise<ReconcileResult | null>;
    invoiceReadiness(input: { basis: "service" | "platform_commission"; payment_id: string }): Promise<InvoiceReadiness | null>;
    issueInvoice(input: { request_id: string; basis: "service" | "platform_commission"; payment_id: string }): Promise<{ invoice: Invoice; replayed: boolean } | null>;
    issueCreditNote(input: { request_id: string; invoice_id: string; amount_cents: number; reason: string }): Promise<{ invoice: Invoice; replayed: boolean } | null>;
    requestRefund(input: { request_id: string; payment_id: string; amount_cents: number; reason: string }): Promise<{ request: RefundRequest; replayed: boolean } | null>;
    decideRefund(id: string, input: { action: "approve" | "reject" | "cancel"; expected_version: number; note: string }): Promise<{ request: RefundRequest } | null>;
    openDispute(input: { request_id: string; payment_id: string; origin: "client" | "artisan" | "platform"; subject: string; description: string }): Promise<{ dispute: Dispute; replayed: boolean } | null>;
    decideDispute(id: string, input: { action: "review" | "resolve" | "close"; expected_version: number; note: string; outcome?: DisputeOutcome; refund_request_id?: string | null }): Promise<{ dispute: Dispute } | null>;
    moderateReview(id: string, input: { action: "hide" | "restore"; expected_version: number | null; note: string }): Promise<{ moderation: ReviewModeration } | null>;
    contestReview(id: string, input: { request_id: string; reason: string }): Promise<{ contestation: Contestation; replayed: boolean } | null>;
    decideContestation(id: string, input: { contestation_id: string; decision: "upheld" | "dismissed"; expected_version: number; note: string }): Promise<{ contestation: Contestation; moderation: ReviewModeration | null } | null>;
  };
};
