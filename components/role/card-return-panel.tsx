"use client";
// Card-hold verification panel (lead leaf): shown from a provider return or a pending attempt,
// even WITHOUT a booking draft. Only the server decides: « Réessayer la vérification » (finalize)
// or « Annuler la réservation » (cancel). Never a financial success claimed from the URL.
import type { CardReturn } from "../app/card-return";
import { PENDING_COPY } from "../app/card-return";

export function CardReturnPanel({
  cardReturn,
  pendingLookupFailed,
  busy,
  onVerify,
  onCancel,
  onRetryLookup,
}: {
  cardReturn: CardReturn | null;
  pendingLookupFailed: boolean;
  busy: boolean;
  onVerify(requestId: string): void;
  onCancel(requestId: string): void;
  onRetryLookup(): void;
}) {
  if (!cardReturn && !pendingLookupFailed) return null;
  if (!cardReturn)
    return (
      <section className="panel" role="alert" data-card-pending-error="">
        <p>{PENDING_COPY.error}</p>
        <button type="button" className="button outline" disabled={busy} onClick={onRetryLookup}>
          Réessayer
        </button>
      </section>
    );
  const working = cardReturn.phase !== "needs_action";
  return (
    <section className="panel" aria-labelledby="card-return-title" aria-busy={working ? true : undefined} data-card-return={cardReturn.phase}>
      <h2 id="card-return-title">Réservation par carte à vérifier</h2>
      <p role="status">{cardReturn.phase === "cancelling" ? "Annulation en cours auprès du service de paiement…" : cardReturn.message}</p>
      <div className="form-actions">
        <button type="button" className="button primary" disabled={busy || working} onClick={() => onVerify(cardReturn.requestId)} data-card-verify="">
          Réessayer la vérification
        </button>
        <button type="button" className="button outline" disabled={busy || working} onClick={() => onCancel(cardReturn.requestId)} data-card-cancel="">
          Annuler la réservation
        </button>
      </div>
    </section>
  );
}
