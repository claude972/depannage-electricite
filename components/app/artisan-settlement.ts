// ART-11 — wording of a settled job for the artisan: amount settled, platform commission, net share
// and the transfer state. Pure: everything comes from the server report (GET /api/payments/status,
// `artisan_settlement`); nothing is recomputed from a rate, nothing states a payout to a bank account.
import type { ArtisanSettlementReport } from "./types";

export type ArtisanSettlementView = {
  amountCents: number;
  feeCents: number;
  netCents: number;
  /** « Commission plateforme (10 %) » — the rate frozen on this settlement, not a constant. */
  commissionLabel: string;
  payout: string;
};

const BANK_NOTE = "Le virement vers votre compte bancaire suit ensuite le calendrier de versement de Stripe ; la plateforme ne le confirme pas ici.";

/** Rate in French notation from basis points: 1000 → « 10 % », 1250 → « 12,5 % ». */
export function commissionRateLabel(bps: number): string {
  return `${String(bps / 100).replace(".", ",")} %`;
}

export function artisanSettlementView(report: unknown): ArtisanSettlementView | null {
  if (!report || typeof report !== "object") return null;
  const r = report as Partial<ArtisanSettlementReport>;
  const int = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
  if (!int(r.amount_cents) || !int(r.fee_cents) || !int(r.net_cents) || !int(r.fee_bps) || r.fee_bps > 9999) return null;
  // An incoherent report shows nothing rather than an approximate commission.
  if (r.amount_cents <= 0 || r.fee_cents + r.net_cents !== r.amount_cents) return null;
  if (r.transfer !== "with_payment" && r.transfer !== "confirmed") return null;
  const payout =
    r.transfer === "confirmed"
      ? `Le transfert de votre part nette vers votre compte de règlement Stripe est confirmé par la plateforme. ${BANK_NOTE}`
      : `Votre part nette est transférée par Stripe sur votre compte de règlement dans le cadre de ce paiement (transfert automatique). ${BANK_NOTE}`;
  return {
    amountCents: r.amount_cents,
    feeCents: r.fee_cents,
    netCents: r.net_cents,
    commissionLabel: `Commission plateforme (${commissionRateLabel(r.fee_bps)})`,
    payout,
  };
}
