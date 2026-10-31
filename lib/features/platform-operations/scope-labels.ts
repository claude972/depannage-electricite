// French labels/descriptions for every platform scope (A5). Exhaustive over PlatformScopeKey: adding a scope
// without its label is a typecheck error here, never a silent fallback in the UI.
import type { OperatorGrant, PlatformScopeKey } from "./types";
export const SCOPE_LABELS: Record<PlatformScopeKey, string> = {
  finance_read: "Finance — lecture",
  finance_write: "Finance — écriture",
  reviews_moderate: "Modération des avis",
  audit_read: "Journal plateforme",
  support_read: "Assistance — lecture de la file",
  support_reply: "Assistance — réponse",
  support_status: "Assistance — changement de statut",
};
export const SCOPE_DESCRIPTIONS: Record<PlatformScopeKey, string> = {
  finance_read: "Lit le ledger, le rapprochement, les factures, demandes de remboursement et litiges. Aucune écriture.",
  finance_write: "Rapprochement, émission de documents, demandes et décisions de remboursement, litiges. Aucune action auprès du fournisseur de paiement.",
  reviews_moderate: "Lit les avis avec leur état de modération, masque ou rétablit, tranche les contestations. Aucun avis supprimé.",
  audit_read: "Lit le journal plateforme horodaté. Aucune écriture.",
  support_read: "Lit toutes les demandes d’assistance, messages et événements ; aucun droit sur dossiers, finance, audit ou modération.",
  support_reply: "Répond dans la file seulement combiné à la lecture de la file ; seul, ne donne rien.",
  support_status: "Change le statut d’une demande seulement combiné à la lecture de la file ; seul, ne donne rien.",
};
export const SCOPE_FAMILIES: Record<PlatformScopeKey, "finance" | "moderation" | "audit" | "support"> = {
  finance_read: "finance", finance_write: "finance", reviews_moderate: "moderation", audit_read: "audit", support_read: "support", support_reply: "support", support_status: "support",
};
export const WRITE_SCOPES_REQUIRING_READ: Partial<Record<PlatformScopeKey, PlatformScopeKey>> = { support_reply: "support_read", support_status: "support_read" };
export const WRITE_WITHOUT_READ_WARNING = "Un scope d’écriture sans la lecture n’accorde rien : ce compte n’a pas de lecture de la file active parmi les grants chargés.";
/** Derived only from the server-listed grants already loaded; it informs, it never grants or refuses. */
export function writeScopeWithoutRead(grants: readonly Pick<OperatorGrant, "user_id" | "scope" | "status">[], userId: string, scope: PlatformScopeKey): boolean {
  const required = WRITE_SCOPES_REQUIRING_READ[scope];
  if (!required) return false;
  const target = userId.trim().toLowerCase();
  return !grants.some((g) => g.status === "active" && g.scope === required && g.user_id.toLowerCase() === target);
}
