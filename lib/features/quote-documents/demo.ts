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

// ---- Demo overview of the dossier ACTUALLY shown --------------------------------------------------
// Built only from the demo workspace the page displays (never a constant dossier). The reference is
// supplied by the caller (the app's quoteRef) so this module stays free of app imports. Stored
// amounts and the stored rate are copied as stored, never recomputed.
export type DemoQuoteSource = {
  id: string;
  reference: string;
  status: string;
  created_at: string;
  accepted_at: string | null;
  lines: { label: string; quantity: number; unit_price_cents: number }[];
  subtotal_cents: number;
  tax_rate: number;
  tax_cents: number;
  total_cents: number;
};
export type DemoDossierSource = {
  intervention: { id: string; status: string; artisan_id: string | null; site_id: string | null };
  quotes: DemoQuoteSource[];
};

const DEMO_AMENDMENT_LINE = { label: "Départ supplémentaire 16 A (démonstration)", quantity: 1, unit_price_cents: 8000 };

/** null when the shown dossier cannot be resolved (the caller then states it, never substitutes). */
export function quoteDocumentsDemoFor(role: QuoteDocumentsScope["role"], source: DemoDossierSource | null): QuoteDocumentsOverview | null {
  if (!source || !source.intervention.id || source.quotes.length === 0) return null;
  const { intervention } = source;
  const isArtisan = role === "artisan";
  const canManage = role === "client" || role === "manager";
  const actor = intervention.artisan_id ?? "demo-artisan";
  const history: QuoteDocumentsOverview["history"] = [];
  let eventId = 0;
  const quotes = [...source.quotes]
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
    .map((q) => {
      const documentId = `demo-document-${q.id}`;
      const generatedAt = q.accepted_at ?? q.created_at;
      history.push({ id: ++eventId, intervention_id: intervention.id, quote_id: q.id, amendment_id: null, document_id: documentId, actor_id: actor, action: "document_generated", details: { revision: 1 }, created_at: generatedAt });
      // An amendment exists ONLY on an accepted quote; its totals are consistent with its own lines
      // and the base quote's stored rate.
      const amendments: QuoteDocumentsOverview["quotes"][number]["amendments"] = [];
      if (q.status === "accepted" && q.accepted_at) {
        const subtotal = DEMO_AMENDMENT_LINE.quantity * DEMO_AMENDMENT_LINE.unit_price_cents;
        const tax = Math.round((subtotal * q.tax_rate) / 100);
        const amendmentId = `demo-amendment-${q.id}`;
        const createdAt = new Date(Date.parse(q.accepted_at) + 60 * 60 * 1000).toISOString();
        amendments.push({
          id: amendmentId, intervention_id: intervention.id, base_quote_id: q.id, artisan_id: actor, version: 1, reference: `AV-1-${q.reference}`, status: "proposed",
          reason: "Un second départ est nécessaire pour alimenter la cuisine en sécurité (démonstration).",
          lines: [{ ...DEMO_AMENDMENT_LINE }], subtotal_cents: subtotal, tax_rate: q.tax_rate, tax_cents: tax, total_cents: subtotal + tax,
          terms: { valid_until: null, validity: "unspecified" }, decision_note: "", decided_by: null, created_at: createdAt, decided_at: null,
          permissions: { can_decide: canManage, can_withdraw: isArtisan, can_generate: isArtisan || canManage }, documents: [],
        });
        history.push({ id: ++eventId, intervention_id: intervention.id, quote_id: q.id, amendment_id: amendmentId, document_id: null, actor_id: actor, action: "amendment_proposed", details: { version: 1, total_cents: subtotal + tax }, created_at: createdAt });
      }
      return {
        id: q.id, reference: q.reference, status: q.status, created_at: q.created_at, accepted_at: q.accepted_at,
        lines: q.lines.map((l) => ({ ...l })), subtotal_cents: q.subtotal_cents, tax_rate: q.tax_rate, tax_cents: q.tax_cents, total_cents: q.total_cents,
        terms: { valid_until: null, validity: "unspecified" as const },
        permissions: { can_set_terms: false, can_generate: isArtisan || canManage, can_propose: false },
        documents: [{ id: documentId, kind: "quote" as const, reference: q.reference, revision: 1, quote_id: q.id, amendment_id: null, generated_at: generatedAt, snapshot_sha256: "d".repeat(64) }],
        amendments,
      };
    });
  return {
    intervention: { ...intervention },
    viewer: { role, is_artisan: isArtisan, can_manage: canManage, is_admin: role === "admin" },
    issuer: { ready: true, missing: [] },
    settlement: "not_connected",
    quotes,
    history: history.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id),
  };
}
