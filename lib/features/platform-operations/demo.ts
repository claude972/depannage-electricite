// Explicit demonstration seeds (shared contract §2): never mixed with real data, never issue live requests.
import type { AuditEntry, Dispute, FinanceReport, Invoice, LedgerEntry, ModeratedReview, OperatorGrant, PlatformAccess, RefundRequest } from "./types";
const t = "2026-10-30T09:00:00+00:00";
const id = (n: number, prefix = "de000000") => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;
export type PlatformDemo = {
  access: PlatformAccess; grants: OperatorGrant[]; audit: AuditEntry[]; report: FinanceReport; ledger: LedgerEntry[];
  invoices: Invoice[]; refundRequests: RefundRequest[]; disputes: Dispute[]; reviews: ModeratedReview[];
};
export const PLATFORM_DEMO: PlatformDemo = {
  access: {
    super_admin: true, scopes: [], super_admin_count: 2,
    capabilities: { support: true, support_reply: true, support_status: true, operators: true, audit: true, finance: true, reviews_moderation: true, refund_execution: false, invoice_rendering: true },
    config: { commission: { setting_bps: null, setting_version: null, checkout_bps: null, aligned: null }, payment_provider: { configured: false, mode: null, live_enabled: false }, invoice_issuer: { configured: false } },
  },
  grants: [
    { id: id(1), user_id: id(11, "de0000aa"), full_name: "Opératrice finance (démo)", scope: "finance_read", status: "active", note: "Démonstration", granted_by: id(99), granted_at: t, revoked_by: null, revoked_at: null, revoke_note: "" },
    { id: id(2), user_id: id(12, "de0000aa"), full_name: "Modérateur (démo)", scope: "reviews_moderate", status: "revoked", note: "", granted_by: id(99), granted_at: t, revoked_by: id(99), revoked_at: t, revoke_note: "Fin de mission (démo)" },
  ],
  audit: [
    { id: 2, actor_id: id(99), action: "operator_scope_revoked", target_kind: "operator", target_id: id(12, "de0000aa"), details: { scope: "reviews_moderate" }, created_at: t },
    { id: 1, actor_id: id(99), action: "operator_scope_granted", target_kind: "operator", target_id: id(11, "de0000aa"), details: { scope: "finance_read" }, created_at: t },
  ],
  report: {
    payments: { paid_count: 1, paid_cents: 30000, pending_count: 0, failed_count: 0, failed_attempts: 0 },
    ledger: { settled_count: 1, settled_cents: 30000, missing_settlement: 0, amount_mismatches: 0, commission_estimated_count: 0, commission_estimated_cents: 0, commission_withheld_count: 0, commission_withheld_cents: 0, refund_settled_count: 0, refund_settled_cents: 0 },
    refund_requests: { requested: { count: 1, cents: 5000 } }, disputes: { open: 1 }, invoices: { invoice_count: 0, credit_note_count: 0 }, commission_setting: null, currency: "eur", generated_at: t,
  },
  ledger: [{ id: id(21), request_id: id(22), entry_kind: "payment_settled", direction: "credit", amount_cents: 30000, currency: "eur", payment_id: id(31), external_event_id: "cs_demo_1", basis: { source: "payments" }, recorded_by: id(99), created_at: t }],
  invoices: [{ id: id(81), request_id: id(82), kind: "invoice", basis: "service", number: "F2026-000001", issuer_key: `artisan:${id(15, "de0000aa")}`, issuer: { legal_name: "Électricité démo", siret: "00000000000000", address: "1 rue de la Démonstration", vat_number: null, legal_status: "EI" }, recipient: { name: "Client démo", address: "2 rue de la Démonstration" }, payment_id: id(31), quote_id: id(83), intervention_id: id(61), related_invoice_id: null, lines: [{ label: "Prestation de démonstration", quantity: 1, unit_price_cents: 25000 }], subtotal_cents: 25000, tax_rate: 20, tax_cents: 5000, total_cents: 30000, currency: "eur", reason: "", issued_by: id(99), issued_at: t }],
  refundRequests: [{ id: id(41), request_id: id(42), payment_id: id(31), amount_cents: 5000, currency: "eur", reason: "Prestation partiellement non réalisée (démo).", status: "requested", version: 1, requested_by: id(99), created_at: t, updated_at: t, decided_by: null, decided_at: null, decision_note: "", provider_reference: null, settled_event_id: null, settled_at: null }],
  disputes: [{ id: id(51), request_id: id(52), payment_id: id(31), intervention_id: id(61), origin: "client", subject: "Contestation (démo)", description: "Le client conteste une partie de la prestation (démonstration).", status: "open", outcome: "none", refund_request_id: null, version: 1, opened_by: id(99), created_at: t, updated_at: t, resolved_by: null, resolved_at: null, resolution_note: "" }],
  reviews: [{ id: id(71), intervention_id: id(61), author_id: id(13, "de0000aa"), rating: 2, body: "Avis de démonstration en attente de modération.", created_at: t, moderation: null, contestations: [{ id: id(72), request_id: id(73), review_id: id(71), contested_by: id(14, "de0000aa"), reason: "Contestation de démonstration.", status: "open", version: 1, created_at: t, decided_by: null, decided_at: null, decision_note: "" }] }],
};
