// ADM-09 — one French label per journal action, shared by the platform journal view and the
// administration settings. The stored technical code stays available as secondary text: it is what
// the database holds and what an auditor quotes. Two sources feed the journal:
//   · `platform_audit`  — finance, rights, moderation, support triage (action + target + details) ;
//   · `audit_log`       — dossier and account events, where arguments are appended to the code
//                          (« artisan_approval:<uuid>:false », « site_settings:archive:<uuid>:2 »).
// A code unknown here is never hidden: it is shown as « Action enregistrée » with its code.

const LABELS: Record<string, string> = {
  // --- platform_audit: rights
  operator_scope_granted: "Habilitation d’opérateur accordée",
  operator_scope_revoked: "Habilitation d’opérateur retirée",
  super_admin_granted: "Droit de super-administrateur accordé",
  super_admin_revoked: "Droit de super-administrateur retiré",
  setting_updated: "Réglage de la plateforme modifié",
  // --- platform_audit: finance
  reconciliation_run: "Rapprochement financier exécuté",
  commission_withheld: "Commission prélevée",
  settlement_entry_failed: "Écriture de règlement non enregistrée (à rapprocher)",
  settlement_entry_conflict: "Règlement non inscrit : session déjà liée à une autre écriture",
  checkout_provider_linked: "Paiement rattaché au prestataire de paiement",
  stripe_observation_reviewed: "Observation du prestataire de paiement examinée",
  invoice_issued: "Facture émise",
  credit_note_issued: "Avoir émis",
  billing_contact_updated: "Coordonnées de facturation modifiées",
  refund_requested: "Remboursement demandé",
  refund_approved: "Remboursement approuvé",
  refund_rejected: "Remboursement refusé",
  refund_cancelled: "Demande de remboursement annulée",
  refund_settled: "Remboursement réglé",
  refund_execution_prepared: "Exécution du remboursement préparée",
  refund_execution_qualified: "Exécution du remboursement qualifiée",
  refund_execution_reassigned: "Exécution du remboursement reprise par un autre opérateur",
  refund_terminal_conflict: "Remboursement : conflit avec l’état final du prestataire",
  dispute_opened: "Litige ouvert",
  dispute_open: "Litige rouvert",
  dispute_under_review: "Litige en cours d’examen",
  dispute_resolved: "Litige résolu",
  dispute_closed: "Litige clos",
  // --- platform_audit: moderation, support, callbacks
  review_hidden: "Avis masqué",
  review_restored: "Avis rétabli",
  review_contested: "Avis contesté",
  contestation_decided: "Contestation d’avis tranchée",
  support_triage_changed: "Tri d’un ticket d’assistance modifié",
  callback_closed: "Demande de rappel clôturée",
  // --- platform_audit: accounts and personal data (written by the application server)
  account_erasure_executed: "Effacement des données d’un compte exécuté",
  // --- audit_log: dossier
  create: "Demande créée",
  created: "Demande créée",
  appointment_saved: "Rendez-vous enregistré",
  request_photo_deleted: "Photo de la demande supprimée",
  accept_mission: "Mission acceptée",
  admin_reassigned: "Artisan réaffecté par l’administration",
  admin_message: "Message de l’administration envoyé",
  send_quote: "Devis envoyé",
  accept_quote: "Devis accepté",
  quote_rejected: "Devis refusé",
  quote_grid_authorized: "Grille tarifaire autorisée pour le devis",
  amendment_proposed: "Avenant proposé",
  amendment_withdrawn: "Avenant retiré",
  amendment_accepted: "Avenant accepté",
  amendment_rejected: "Avenant refusé",
  travel_en_route: "Artisan en route",
  travel_on_site: "Artisan arrivé sur place",
  start: "Intervention démarrée",
  report_saved: "Compte rendu enregistré",
  report_receipt_signed: "Compte rendu signé par le client",
  on_site_receipt_declared: "Encaissement sur place déclaré",
  complete: "Intervention clôturée",
  cancel: "Demande annulée",
  payment_confirmed: "Paiement confirmé",
  warranty_requested: "Garantie demandée",
  warranty_reviewing: "Demande de garantie en cours d’examen",
  warranty_accepted: "Demande de garantie acceptée",
  warranty_rejected: "Demande de garantie refusée",
  warranty_resolved: "Demande de garantie résolue",
  warranty_closed: "Demande de garantie clôturée",
  warranty_corrective_linked: "Intervention corrective reliée à la garantie",
  // --- audit_log: accounts, settings
  artisan_profile_saved: "Dossier artisan enregistré",
  artisan_application_submitted: "Candidature artisan soumise",
  artisan_credential_review: "Décision sur un justificatif d’artisan",
  site_settings: "Réglages d’un site modifiés",
  public_operator_profile: "Profil public de l’exploitant modifié",
  warranty_policy: "Politique de garantie modifiée",
  platform_postal_coverage: "Zone de couverture modifiée",
};

const CREDENTIAL_DECISIONS: Record<string, string> = { accepted: "acceptée", changes_requested: "modifications demandées", rejected: "refusée" };
const VERBS: Record<string, string> = { save: "enregistrement", publish: "publication", archive: "archivage", restore: "restauration", activate: "activation", unpublish: "dépublication" };

export type AuditLabel = {
  /** Clear French label, with the readable argument when the code carries one. */
  label: string;
  /** Technical code without its arguments, shown as secondary text. */
  code: string;
  /** False when the code is not known here: the label is then generic and the code is the reference. */
  known: boolean;
};

/** Label of one journal action. Never throws; never hides an unknown code. */
export function auditActionLabel(action: string): AuditLabel {
  const raw = typeof action === "string" ? action : "";
  const [code = "", ...args] = raw.split(":");
  if (code === "artisan_approval") {
    const approved = args.at(-1) === "true";
    return { label: approved ? "Artisan approuvé ou réactivé" : "Artisan non approuvé (corrections demandées, refus ou suspension)", code, known: true };
  }
  if (code === "artisan_credential_review") {
    const decision = CREDENTIAL_DECISIONS[args.at(-1) ?? ""];
    return { label: decision ? `${LABELS[code]} : ${decision}` : LABELS[code], code, known: true };
  }
  if (Object.hasOwn(LABELS, code)) {
    const verb = args.map((arg) => VERBS[arg]).find(Boolean);
    return { label: verb ? `${LABELS[code]} (${verb})` : LABELS[code], code, known: true };
  }
  return { label: "Action enregistrée", code: code || "inconnue", known: false };
}

const TARGET_LABELS: Record<string, string> = {
  operator: "Compte",
  super_admin: "Compte",
  setting: "Réglage",
  reconciliation: "Rapprochement",
  ledger: "Paiement",
  invoice: "Facture",
  refund_request: "Remboursement",
  dispute: "Litige",
  review: "Avis",
  public_callback: "Demande de rappel",
  support_ticket: "Ticket d’assistance",
  intervention: "Dossier",
};
export function auditTargetLabel(kind: string): string {
  return TARGET_LABELS[kind] ?? "Objet";
}

/** Sensitive = changes rights, money, moderation or a person's access; used to filter the journal. */
const SENSITIVE = new Set([
  "operator_scope_granted", "operator_scope_revoked", "super_admin_granted", "super_admin_revoked", "setting_updated",
  "reconciliation_run", "commission_withheld", "settlement_entry_failed", "settlement_entry_conflict", "invoice_issued", "credit_note_issued", "billing_contact_updated",
  "refund_requested", "refund_approved", "refund_rejected", "refund_cancelled", "refund_settled", "refund_execution_prepared", "refund_execution_qualified", "refund_execution_reassigned",
  "dispute_opened", "dispute_under_review", "dispute_resolved", "dispute_closed",
  "review_hidden", "review_restored", "contestation_decided", "support_triage_changed", "account_erasure_executed",
  "admin_reassigned", "admin_message", "artisan_approval", "artisan_credential_review",
  "warranty_reviewing", "warranty_accepted", "warranty_rejected", "warranty_resolved", "warranty_closed", "warranty_corrective_linked",
  "public_operator_profile", "warranty_policy", "platform_postal_coverage",
]);
export function isSensitiveAction(action: string): boolean {
  return SENSITIVE.has((action ?? "").split(":")[0]);
}
/** Codes of the dossier journal (`audit_log`) that are sensitive, for a server-side filter. Codes
 *  with arguments are matched by prefix. */
export const SENSITIVE_DOSSIER_CODES: readonly string[] = [
  "admin_reassigned", "admin_message", "artisan_approval", "artisan_credential_review",
  "warranty_reviewing", "warranty_accepted", "warranty_rejected", "warranty_resolved", "warranty_closed", "warranty_corrective_linked",
  "public_operator_profile", "warranty_policy", "platform_postal_coverage",
];
