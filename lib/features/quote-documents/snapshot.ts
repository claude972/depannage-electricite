import { taxRateSchema } from "@/lib/tax-rates";
// The stored snapshot (migration 015, quote_document_snapshot) is the document. Before rendering,
// it is parsed strictly and its arithmetic is re-checked: a PDF is never produced from a snapshot
// whose totals do not follow from its lines.
import { z } from "zod";

const money = z.number().int().min(0).max(10_000_000);
const line = z.object({
  label: z.string().min(1).max(160),
  quantity: z.number().int().min(1).max(1000),
  unit_price_cents: money,
});
const taxRate = taxRateSchema;
const terms = z.object({
  valid_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  validity: z.enum(["unspecified", "valid", "expired"]),
});
const timestamp = z.string().min(1).nullable();
const amounts = {
  lines: z.array(line).min(1).max(30),
  subtotal_cents: z.number().int().min(1).max(10_000_000),
  tax_rate: taxRate,
  tax_cents: money,
  total_cents: z.number().int().min(1).max(10_000_000),
};
export const snapshotSchema = z.object({
  kind: z.enum(["quote", "amendment"]),
  reference: z.string().min(1).max(40),
  currency: z.literal("EUR"),
  intervention: z.object({
    id: z.string().uuid(),
    reference: z.string().min(1).max(40),
    category: z.string().min(1).max(40),
    urgency: z.string().min(1).max(40),
    address: z.string().max(500),
    postal_code: z.string().max(10),
    city: z.string().max(120),
    description: z.string().max(600),
  }),
  issuer: z.object({
    company_name: z.string().min(1).max(160),
    legal_status: z.string().max(80),
    siret: z.string().regex(/^[0-9]{14}$/),
    address: z.string().min(1).max(500),
    contact_name: z.string().min(1).max(120),
    phone: z.string().max(30),
    missing_optional: z.array(z.string().max(40)).max(10),
  }),
  recipient: z.object({
    name: z.string().max(120),
    organization: z.object({ name: z.string().max(160) }).nullable(),
    site: z.object({ name: z.string().max(160), address: z.string().max(500) }).nullable(),
  }),
  quote: z.object({
    id: z.string().uuid(),
    reference: z.string().min(1).max(40),
    status: z.enum(["sent", "accepted", "rejected"]),
    created_at: z.string().min(1),
    accepted_at: timestamp,
    terms,
    ...amounts,
  }),
  amendment: z
    .object({
      id: z.string().uuid(),
      version: z.number().int().min(1).max(10000),
      reference: z.string().min(1).max(40),
      status: z.enum(["proposed", "accepted", "rejected", "withdrawn"]),
      reason: z.string().min(1).max(2000),
      created_at: z.string().min(1),
      decided_at: timestamp,
      decision_note: z.string().max(2000).optional(),
      terms,
      cumulative_total_cents: z.number().int().min(1).max(100_000_000),
      ...amounts,
    })
    .nullable(),
  settlement: z.literal("not_connected"),
  notices: z.array(z.string().max(300)).max(10),
});
export type QuoteDocumentSnapshot = z.infer<typeof snapshotSchema>;

export class SnapshotError extends Error {}

function checkAmounts(part: { lines: { quantity: number; unit_price_cents: number }[]; subtotal_cents: number; tax_rate: number; tax_cents: number; total_cents: number }, label: string) {
  const subtotal = part.lines.reduce((sum, l) => sum + l.quantity * l.unit_price_cents, 0);
  if (subtotal !== part.subtotal_cents) throw new SnapshotError(`${label}: sous-total incohérent`);
  if (Math.round((subtotal * part.tax_rate) / 100) !== part.tax_cents) throw new SnapshotError(`${label}: TVA incohérente`);
  if (subtotal + part.tax_cents !== part.total_cents) throw new SnapshotError(`${label}: total incohérent`);
}
/** Parses and re-checks the arithmetic. Throws SnapshotError on any inconsistency. */
export function parseSnapshot(value: unknown): QuoteDocumentSnapshot {
  const parsed = snapshotSchema.safeParse(value);
  if (!parsed.success) throw new SnapshotError("instantané invalide");
  const snapshot = parsed.data;
  checkAmounts(snapshot.quote, "devis");
  if (snapshot.kind === "amendment") {
    if (!snapshot.amendment) throw new SnapshotError("avenant absent");
    checkAmounts(snapshot.amendment, "avenant");
    if (snapshot.amendment.cumulative_total_cents < snapshot.quote.total_cents + snapshot.amendment.total_cents)
      throw new SnapshotError("avenant: cumul incohérent");
    if (snapshot.reference !== snapshot.amendment.reference) throw new SnapshotError("avenant: référence incohérente");
  } else {
    if (snapshot.amendment) throw new SnapshotError("devis: avenant inattendu");
    if (snapshot.reference !== snapshot.quote.reference) throw new SnapshotError("devis: référence incohérente");
  }
  return snapshot;
}
