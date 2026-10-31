// Contract ADV-PLANNING-NOTIFICATIONS-001: persistent, per-recipient internal notifications.
// Nothing here promises an external channel: see channels.ts for the honest availability report.
export const NOTIFICATION_KINDS = [
  "mission_assigned",
  "mission_received",
  "mission_reassigned",
  "quote_received",
  "quote_rejected",
  "quote_accepted",
  "work_started",
  "work_completed",
  "payment_confirmed",
  "mission_cancelled",
  "appointment_saved",
  "message_received",
  "account_approved",
  "account_suspended",
  "approval_requested",
  "approval_decided",
  "support_replied",
  "support_status_changed",
  "member_joined",
  "membership_removed",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];
export type Notification = {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  intervention_id: string | null;
  organization_id: string | null;
  site_id: string | null;
  support_ticket_id?: string | null;
  payload: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
};
export type NotificationPage = {
  notifications: Notification[];
  page: { limit: number; total: number; has_more: boolean; next_cursor: string | null };
  unread_count: number;
  filters: { unread: boolean };
};
export type NotificationSummary = { unread_count: number; latest_created_at: string | null };
export type NotificationPreferences = {
  user_id?: string;
  muted_kinds: NotificationKind[];
  email_enabled: boolean;
  sms_enabled: boolean;
  push_enabled: boolean;
  version: number;
  updated_at?: string;
};
export type ChannelState = "available" | "unavailable";
export type ChannelReport = {
  in_app: ChannelState;
  email: ChannelState;
  sms: ChannelState;
  push: ChannelState;
  reasons: { email: string; sms: string; push: string };
};
export type PreferencesView = {
  preferences: NotificationPreferences;
  kinds: { kind: NotificationKind; label: string }[];
  channels: ChannelReport;
  channels_note: string;
};
export type NotificationMarkCommand =
  | { action: "mark_read"; ids: string[] }
  | { action: "mark_unread"; ids: string[] }
  | { action: "mark_all_read"; before?: string };
export type NotificationMarkResult = { updated: number; unread_count: number };
export type PreferencesCommand = {
  muted_kinds: NotificationKind[];
  email_enabled: boolean;
  sms_enabled: boolean;
  push_enabled: boolean;
  expected_version: number;
};
export type NotificationListParams = { limit?: number; cursor?: string | null; unread?: boolean };
