// Platform payment CTA. The server charges the accepted quote PLUS every accepted amendment and the
// client cache may be truncated, so this button takes NO amount: it never presents a single quote
// total as the amount due. The exact amount is detailed by the secure payment page before any
// validation. (The guest on-site slot shows the complete RPC amount through PaymentLinkPanel.)
import { useEffect, useState } from "react";
import { Icon } from "./icons";
import { PaymentReminderControl } from "../features/payment-reminders/payment-reminder-control";

export const PAY_CTA = "Régler le devis et les avenants acceptés";
export const PAY_EXPLAIN =
  "Le montant à régler comprend le devis accepté et tous les avenants acceptés. Il est calculé par la plateforme et détaillé sur la page de paiement sécurisée avant toute validation.";

export const PAY_UNAVAILABLE =
  "Le paiement en ligne n’est pas encore disponible sur la plateforme (configuration en cours). Aucun règlement ne peut être lancé pour le moment ; aucun montant n’a été débité.";

export function PlatformPayAction({ demo, busy, busyLabel, onPay, className = "button primary", reminder }: { demo: boolean; busy: boolean; busyLabel: string; onPay: () => void; className?: string; /** SYS-04 / ENT-16: optional personal reminder for this exact quote (live only, read on open). */ reminder?: { quoteId: string; context: { generation(): number; userId(): string | null } } }) {
  // Announced before the click: only an explicit server « not configured » disables the button; an
  // unknown or failed check leaves it active (the server still answers honestly on the click).
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    if (demo) return;
    let active = true;
    fetch("/api/payments/checkout", { cache: "no-store", headers: { accept: "application/json" } })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { available?: unknown } | null) => {
        if (active && body?.available === false) setUnavailable(true);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [demo]);
  return (
    <>
      <p className="muted" data-pay-explain="">{PAY_EXPLAIN}</p>
      {unavailable && <p className="muted" role="status" data-pay-unavailable="">{PAY_UNAVAILABLE}</p>}
      <button type="button" className={className} disabled={busy || unavailable} onClick={onPay} data-pay-cta="">
        <Icon name="lock" />
        {busy ? busyLabel : demo ? "Simuler le règlement" : PAY_CTA}
      </button>
      {reminder && !demo && <PaymentReminderControl quoteId={reminder.quoteId} context={reminder.context} demo={demo} />}
    </>
  );
}
