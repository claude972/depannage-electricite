"use client";
// FIN-04 — confirmed refunds of a settled dossier, shown to the client, the organisation and the
// assigned artisan. One read of GET /api/payments/status (`refunds`, optional). Only refunds the
// payment provider confirmed are stated; a request under review is never announced as a refund.
import { useEffect, useRef, useState } from "react";
import type { PaymentStatusReport } from "../../app/types";

export type RefundSummary = { count: number; cents: number; lastSettledAt: string | null };

/** Pure: strict reading of the optional server field; anything incoherent shows nothing. */
export function refundSummary(report: PaymentStatusReport | null | undefined): RefundSummary | null {
  const r = report?.refunds, total = report?.payment?.total_cents;
  if (!r || report?.payment?.status !== "paid" || typeof total !== "number") return null;
  if (!Number.isSafeInteger(r.count) || !Number.isSafeInteger(r.cents) || r.count < 1 || r.cents < 1 || r.cents > total) return null;
  const last = typeof r.last_settled_at === "string" && Number.isFinite(Date.parse(r.last_settled_at)) ? r.last_settled_at : null;
  return { count: r.count, cents: r.cents, lastSettledAt: last };
}

const euros = (cents: number) => (cents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
const day = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });

export function refundSentence(summary: RefundSummary, viewer: "payer" | "artisan"): string {
  const what = summary.count > 1 ? `${summary.count} remboursements confirmés pour un total de ${euros(summary.cents)}` : `Remboursement de ${euros(summary.cents)} confirmé`;
  const when = summary.lastSettledAt ? ` (${summary.count > 1 ? "dernier " : ""}le ${day(summary.lastSettledAt)})` : "";
  return viewer === "payer"
    ? `${what}${when} par le prestataire de paiement, sur le moyen de paiement utilisé pour ce règlement. Le délai d’apparition sur le relevé dépend de la banque.`
    : `${what}${when} au client sur ce règlement. Votre part nette et la commission sont ajustées par le prestataire de paiement selon les règles de remboursement de la plateforme ; le détail figure sur votre compte de règlement Stripe.`;
}

export function RefundNotice({ quoteId, viewer, identity, refreshedAt, load, className }: {
  quoteId: string | null;
  viewer: "payer" | "artisan";
  /** Account + session generation: a previous account's answer is never shown. */
  identity: string;
  refreshedAt?: unknown;
  load: (quoteId: string) => Promise<PaymentStatusReport | null>;
  className?: string;
}) {
  const [state, setState] = useState<{ key: string; value: RefundSummary | null } | null>(null);
  const key = quoteId ? `${identity}|${quoteId}` : "";
  const loader = useRef(load);
  loader.current = load;
  useEffect(() => {
    setState(null);
    if (!key || !quoteId) return;
    let active = true;
    void loader.current(quoteId).then((report) => { if (active) setState({ key, value: refundSummary(report) }); }).catch(() => undefined);
    return () => { active = false; };
  }, [key, quoteId, refreshedAt]);
  const summary = state && state.key === key ? state.value : null;
  if (!summary) return null;
  return (
    <p className={className} role="status" data-confirmed-refund={summary.cents}>
      {refundSentence(summary, viewer)}
    </p>
  );
}
