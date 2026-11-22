import { NOTIFICATION_KINDS, type NotificationKind } from "./types";
// User-facing French labels of each notification kind (preferences panel, filters). No internal names.
export const KIND_LABELS: Record<NotificationKind, string> = {
  mission_assigned: "Électricien attribué à ma demande",
  mission_received: "Mission qui m’est attribuée",
  mission_reassigned: "Mission retirée",
  quote_received: "Devis reçu",
  quote_rejected: "Devis refusé",
  quote_accepted: "Devis accepté",
  work_started: "Intervention commencée",
  work_completed: "Intervention terminée",
  payment_confirmed: "Règlement confirmé",
  payment_reminder: "Rappel personnel de règlement",
  mission_cancelled: "Demande annulée",
  appointment_saved: "Rendez-vous enregistré",
  appointment_reminder: "Rappel de rendez-vous",
  credential_reminder: "Échéance de justificatif",
  compliance_reminder: "Échéance de conformité",
  message_received: "Nouveau message",
  account_approved: "Compte professionnel approuvé",
  account_suspended: "Compte professionnel suspendu",
  approval_requested: "Approbation interne requise",
  approval_decided: "Décision d’approbation interne",
  support_replied: "Réponse de l’assistance",
  support_status_changed: "Suivi d’une demande d’assistance",
  member_joined: "Nouveau membre dans l’organisation",
  membership_removed: "Accès à une organisation retiré",
};
/** CLI-07 — quote amendments reuse the closest stored kind (the `notifications.kind` list has no
 *  amendment kind); `payload.subject = "quote_amendment"` and its event give the label shown, so an
 *  amendment is never presented as « Devis reçu ». Unknown payloads fall back to the kind label. */
const AMENDMENT_EVENT_LABELS: Record<string, string> = {
  proposed: "Avenant proposé",
  withdrawn: "Avenant retiré",
  accepted: "Avenant accepté",
  rejected: "Avenant refusé",
};
export function notificationLabel(n: { kind: NotificationKind; payload?: Record<string, unknown> | null }): string {
  const payload = n.payload;
  if (payload && payload.subject === "quote_amendment" && typeof payload.event === "string" && Object.hasOwn(AMENDMENT_EVENT_LABELS, payload.event)) return AMENDMENT_EVENT_LABELS[payload.event];
  // ENT-12 — the artisan is told that the client organisation did not approve the quote: stored under
  // approval_decided, labelled for what it means to its recipient.
  if (payload && payload.subject === "quote_not_approved" && n.kind === "approval_decided") return "Devis non approuvé par le client";
  return KIND_LABELS[n.kind] ?? "Notification";
}
/** Label of a kind in the PREFERENCES list: muting a quote kind also mutes the amendment events
 *  stored under it, so the option says so. */
const PREFERENCE_OVERRIDES: Partial<Record<NotificationKind, string>> = {
  quote_received: "Devis reçu, avenant proposé ou retiré",
  quote_rejected: "Devis ou avenant refusé",
  quote_accepted: "Devis ou avenant accepté",
  approval_decided: "Décision d’approbation interne, ou devis non approuvé par le client",
};
export function preferenceLabel(kind: NotificationKind): string {
  return PREFERENCE_OVERRIDES[kind] ?? KIND_LABELS[kind];
}
export const KIND_ICONS: Record<NotificationKind, string> = {
  mission_assigned: "wrench",
  mission_received: "briefcase",
  mission_reassigned: "briefcase",
  quote_received: "receipt",
  quote_rejected: "receipt",
  quote_accepted: "receipt",
  work_started: "truck",
  work_completed: "check",
  payment_confirmed: "euro",
  payment_reminder: "calendar",
  mission_cancelled: "close",
  appointment_saved: "calendar",
  appointment_reminder: "calendar",
  credential_reminder: "calendar",
  compliance_reminder: "calendar",
  message_received: "message",
  account_approved: "badge",
  account_suspended: "lock",
  approval_requested: "shield",
  approval_decided: "shield",
  support_replied: "help",
  support_status_changed: "help",
  member_joined: "users",
  membership_removed: "users",
};

// Kinds a role can actually receive (recipients of public.notify in the migrations). Display filter of
// the preferences list only: stored muted kinds are never rewritten by it. An unknown role (or an
// admin, who may hold any history) sees every kind.
const REQUESTER: NotificationKind[] = ["mission_assigned", "quote_received", "work_started", "work_completed", "payment_confirmed", "payment_reminder", "appointment_saved", "appointment_reminder", "message_received", "support_replied", "support_status_changed"];
const ROLE_KINDS: Record<string, NotificationKind[]> = {
  client: REQUESTER,
  manager: [...REQUESTER, "compliance_reminder", "approval_requested", "approval_decided", "member_joined", "membership_removed"],
  artisan: ["mission_received", "mission_reassigned", "quote_rejected", "quote_accepted", "approval_decided", "payment_confirmed", "mission_cancelled", "appointment_saved", "appointment_reminder", "credential_reminder", "message_received", "account_approved", "account_suspended", "support_replied", "support_status_changed"],
};
export function kindsForRole(role: unknown): NotificationKind[] {
  const allowed = typeof role === "string" && Object.hasOwn(ROLE_KINDS, role) ? new Set(ROLE_KINDS[role]) : null;
  return allowed ? NOTIFICATION_KINDS.filter((kind) => allowed.has(kind)) : [...NOTIFICATION_KINDS];
}
