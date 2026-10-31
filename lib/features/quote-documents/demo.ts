// Demonstration seeds of the lot. Provided by the lead only in the explicit demo mode; every
// identifier is prefixed "demo-" and the data is labelled as such by the component. Never mixed
// with real data.
import type { QuoteDocumentsOverview, QuoteDocumentsScope } from "./types";

const DEMO_QUOTE = "demo-quote-1";
const DEMO_INTERVENTION = "demo-intervention-1";
const DEMO_ARTISAN = "demo-artisan";
const DEMO_CLIENT = "demo-client";

export function quoteDocumentsDemo(role: QuoteDocumentsScope["role"]): QuoteDocumentsOverview {
  const isArtisan = role === "artisan";
  const canManage = role === "client" || role === "manager";
  return {
    intervention: { id: DEMO_INTERVENTION, status: "in_progress", artisan_id: DEMO_ARTISAN, site_id: null },
    viewer: { role, is_artisan: isArtisan, can_manage: canManage, is_admin: role === "admin" },
    issuer: { ready: true, missing: [] },
    settlement: "not_connected",
    quotes: [
      {
        id: DEMO_QUOTE,
        reference: "DEV-DEMO01",
        status: "accepted",
        created_at: "2026-10-20T09:15:00Z",
        accepted_at: "2026-10-20T16:40:00Z",
        lines: [
          { label: "Déplacement", quantity: 1, unit_price_cents: 4500 },
          { label: "Main-d’œuvre (démonstration)", quantity: 2, unit_price_cents: 5500 },
          { label: "Disjoncteur différentiel 30 mA", quantity: 1, unit_price_cents: 6900 },
        ],
        subtotal_cents: 22400,
        tax_rate: 20,
        tax_cents: 4480,
        total_cents: 26880,
        terms: { valid_until: "2026-11-05", validity: "valid", updated_at: "2026-10-20T09:20:00Z" },
        permissions: { can_set_terms: false, can_generate: isArtisan || canManage, can_propose: false },
        documents: [
          { id: "demo-document-1", kind: "quote", reference: "DEV-DEMO01", revision: 2, quote_id: DEMO_QUOTE, amendment_id: null, generated_at: "2026-10-20T16:41:00Z", snapshot_sha256: "d".repeat(64) },
          { id: "demo-document-0", kind: "quote", reference: "DEV-DEMO01", revision: 1, quote_id: DEMO_QUOTE, amendment_id: null, generated_at: "2026-10-20T09:21:00Z", snapshot_sha256: "c".repeat(64) },
        ],
        amendments: [
          {
            id: "demo-amendment-1",
            intervention_id: DEMO_INTERVENTION,
            base_quote_id: DEMO_QUOTE,
            artisan_id: DEMO_ARTISAN,
            version: 1,
            reference: "AV-1-DEV-DEMO01",
            status: "proposed",
            reason: "Un second départ est nécessaire pour alimenter la cuisine en sécurité (démonstration).",
            lines: [{ label: "Départ supplémentaire 16 A", quantity: 1, unit_price_cents: 8000 }],
            subtotal_cents: 8000,
            tax_rate: 20,
            tax_cents: 1600,
            total_cents: 9600,
            terms: { valid_until: null, validity: "unspecified" },
            decision_note: "",
            decided_by: null,
            created_at: "2026-10-22T10:05:00Z",
            decided_at: null,
            permissions: { can_decide: canManage, can_withdraw: isArtisan, can_generate: isArtisan || canManage },
            documents: [],
          },
        ],
      },
    ],
    history: [
      { id: 4, intervention_id: DEMO_INTERVENTION, quote_id: DEMO_QUOTE, amendment_id: "demo-amendment-1", document_id: null, actor_id: DEMO_ARTISAN, action: "amendment_proposed", details: { version: 1, total_cents: 9600 }, created_at: "2026-10-22T10:05:00Z" },
      { id: 3, intervention_id: DEMO_INTERVENTION, quote_id: DEMO_QUOTE, amendment_id: null, document_id: "demo-document-1", actor_id: DEMO_CLIENT, action: "document_generated", details: { revision: 2 }, created_at: "2026-10-20T16:41:00Z" },
      { id: 2, intervention_id: DEMO_INTERVENTION, quote_id: DEMO_QUOTE, amendment_id: null, document_id: "demo-document-0", actor_id: DEMO_ARTISAN, action: "document_generated", details: { revision: 1 }, created_at: "2026-10-20T09:21:00Z" },
      { id: 1, intervention_id: DEMO_INTERVENTION, quote_id: DEMO_QUOTE, amendment_id: null, document_id: null, actor_id: DEMO_ARTISAN, action: "terms_set", details: { valid_until: "2026-11-05" }, created_at: "2026-10-20T09:20:00Z" },
    ],
  };
}
