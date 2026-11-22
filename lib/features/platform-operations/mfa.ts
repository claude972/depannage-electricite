import { ApiError, dbError } from "@/lib/supabase/server";
import { PLATFORM_MFA_MESSAGE, PLATFORM_MFA_REQUIRED } from "@/shared/platform-mfa";

class PlatformMfaRequired extends ApiError {
  constructor() {
    super(403, PLATFORM_MFA_MESSAGE);
  }
}

export function platformWriteError(error: { code?: string; message?: string } | null) {
  if (error?.code === "PT403" && error.message === PLATFORM_MFA_REQUIRED)
    throw new PlatformMfaRequired();
  dbError(error);
}

/** Finance rules refused by the SQL RPCs, told as they are (never « the dossier changed, refresh »
 * for a rule that still applies): the operator knows what to correct. Nothing is written. */
export const FINANCE_REFUSALS: Record<string, string> = {
  "Credit notes exceed the invoice total": "Le montant de l’avoir dépasse le solde restant de la facture (total de la facture moins les avoirs déjà émis). Aucun avoir n’a été émis ; réduisez le montant.",
  "A credit note references an invoice": "Un avoir ne peut porter que sur une facture, pas sur un autre avoir. Aucun avoir n’a été émis.",
  "Refund requests exceed the settled amount": "Le montant demandé dépasse le montant réglé restant (règlement moins les demandes déjà enregistrées). Aucune demande n’a été créée ; réduisez le montant.",
  "Only a settled payment can be refunded": "Seul un paiement réglé peut faire l’objet d’une demande de remboursement. Aucune demande n’a été créée.",
};
/** Finance writes: known refusals first, then the MFA step-up and the generic mapping. */
export function financeWriteError(error: { code?: string; message?: string } | null) {
  if (error?.code === "P0001" && error.message && FINANCE_REFUSALS[error.message])
    throw new ApiError(409, FINANCE_REFUSALS[error.message]);
  platformWriteError(error);
}

export function platformMfaRefusal(error: unknown) {
  return error instanceof PlatformMfaRequired
    ? { error: PLATFORM_MFA_MESSAGE, code: PLATFORM_MFA_REQUIRED }
    : null;
}
