// Demonstration seeds for the notification leaf (explicit demo mode only).
import { CHANNELS_NOTE, detectChannels } from "./channels";
import { KIND_LABELS } from "./kinds";
import { NOTIFICATION_KINDS, type Notification, type NotificationPage, type PreferencesView } from "./types";
const stamp = (hoursAgo: number) => new Date(Date.UTC(2026, 10, 2, 12 - hoursAgo)).toISOString().replace(".000Z", "+00:00");
export const DEMO_NOTIFICATIONS: Notification[] = [
  { id: "demo-n1", kind: "appointment_saved", title: "Rendez-vous enregistré", body: "Un créneau a été enregistré pour le dossier INT-DEMOA1 : le 04/11/2026 de 08:00 à 10:00 (heure de Martinique).", intervention_id: "demo-a1", organization_id: null, site_id: null, payload: { reference: "INT-DEMOA1" }, read_at: null, created_at: stamp(1) },
  { id: "demo-n2", kind: "message_received", title: "Nouveau message", body: "Un nouveau message concerne le dossier INT-DEMOA1.", intervention_id: "demo-a1", organization_id: null, site_id: null, payload: { reference: "INT-DEMOA1" }, read_at: null, created_at: stamp(5) },
  { id: "demo-n3", kind: "quote_accepted", title: "Devis accepté", body: "Le devis du dossier INT-DEMOA1 a été accepté.", intervention_id: "demo-a1", organization_id: null, site_id: null, payload: { reference: "INT-DEMOA1" }, read_at: stamp(20), created_at: stamp(26) },
];
export function demoNotificationPage(params: { unread?: boolean; limit?: number }): NotificationPage {
  const rows = DEMO_NOTIFICATIONS.filter((n) => !params.unread || !n.read_at);
  const limit = params.limit ?? 25;
  return { notifications: rows.slice(0, limit), page: { limit, total: rows.length, has_more: rows.length > limit, next_cursor: null }, unread_count: DEMO_NOTIFICATIONS.filter((n) => !n.read_at).length, filters: { unread: Boolean(params.unread) } };
}
export function demoPreferences(): PreferencesView {
  return {
    preferences: { muted_kinds: [], email_enabled: false, sms_enabled: false, push_enabled: false, version: 0 },
    kinds: NOTIFICATION_KINDS.map((kind) => ({ kind, label: KIND_LABELS[kind] })),
    channels: detectChannels({}),
    channels_note: CHANNELS_NOTE,
  };
}
