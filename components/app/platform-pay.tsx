// Platform payment CTA. The server charges the accepted quote PLUS every accepted amendment and the
// client cache may be truncated, so this button takes NO amount: it never presents a single quote
// total as the amount due. The exact amount is detailed by the secure payment page before any
// validation. (The guest on-site slot shows the complete RPC amount through PaymentLinkPanel.)
import { Icon } from "./icons";
import { PaymentReminderControl } from "../features/payment-reminders/payment-reminder-control";

export const PAY_CTA = "Régler le devis et les avenants acceptés";
export const PAY_EXPLAIN =
  "Le montant à régler comprend le devis accepté et tous les avenants acceptés. Il est calculé par la plateforme et détaillé sur la page de paiement sécurisée avant toute validation.";

export function PlatformPayAction({ demo, busy, busyLabel, onPay, className = "button primary", reminder }: { demo: boolean; busy: boolean; busyLabel: string; onPay: () => void; className?: string; /** SYS-04 / ENT-16: optional personal reminder for this exact quote (live only, read on open). */ reminder?: { quoteId: string; context: { generation(): number; userId(): string | null } } }) {
  return (
    <>
      <p className="muted" data-pay-explain="">{PAY_EXPLAIN}</p>
      <button type="button" className={className} disabled={busy} onClick={onPay} data-pay-cta="">
        <Icon name="lock" />
        {busy ? busyLabel : demo ? "Simuler le règlement" : PAY_CTA}
      </button>
      {reminder && !demo && <PaymentReminderControl quoteId={reminder.quoteId} context={reminder.context} demo={demo} />}
    </>
  );
}
