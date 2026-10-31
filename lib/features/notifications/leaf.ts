// Leaf-component contract for the notification centre and bell (amendment A1). No import from
// components/app/*. Null answers from the client are stale-chain signals: nothing changes.
import type {
  Notification,
  NotificationListParams,
  NotificationMarkCommand,
  NotificationMarkResult,
  NotificationPage,
  NotificationSummary,
  PreferencesCommand,
  PreferencesView,
} from "./types";
export type { ContractState, LeafRole, LeafScope } from "../planning/leaf";
export { scopeKey } from "../planning/leaf";
export type PreferencesSaveResult = { ok: true; view: PreferencesView } | { ok: false; conflict: boolean; message: string };
export type MarkResult = { ok: true; result: NotificationMarkResult } | { ok: false; conflict: boolean; message: string };
export interface NotificationsClient {
  list(params: NotificationListParams): Promise<NotificationPage | null>;
  summary(): Promise<NotificationSummary | null>;
  mark(body: NotificationMarkCommand): Promise<MarkResult | null>;
  loadPreferences(): Promise<PreferencesView | null>;
  savePreferences(body: PreferencesCommand): Promise<PreferencesSaveResult | null>;
}
export type ListState =
  | { status: "loading"; items: Notification[] }
  | { status: "ready"; items: Notification[]; page: NotificationPage["page"]; unread: number }
  | { status: "error"; message: string; items: Notification[] };
/** Appends a page (cursor follow-up) or replaces (first page). Null leaves everything untouched. */
export function reducePage(previous: ListState, answer: NotificationPage | null, append: boolean): ListState {
  if (answer === null) return previous;
  const seen = new Set(append ? previous.items.map((n) => n.id) : []);
  const items = [...(append ? previous.items : []), ...answer.notifications.filter((n) => !seen.has(n.id))];
  return { status: "ready", items, page: answer.page, unread: answer.unread_count };
}
/** Applies a mark result locally only when the server confirmed it; null or refusal change nothing. */
export function applyMark(items: Notification[], command: NotificationMarkCommand, answer: MarkResult | null, now: string): { items: Notification[]; unread: number | null; message: string | null } {
  if (answer === null) return { items, unread: null, message: null };
  if (!answer.ok) return { items, unread: null, message: answer.message };
  const ids = new Set("ids" in command ? command.ids : []);
  const next = items.map((n) => {
    if (command.action === "mark_all_read") return n.read_at || (command.before && n.created_at > command.before) ? n : { ...n, read_at: now };
    if (!ids.has(n.id)) return n;
    return command.action === "mark_read" ? { ...n, read_at: n.read_at ?? now } : { ...n, read_at: null };
  });
  return { items: next, unread: answer.result.unread_count, message: null };
}
/** Accessible label of the bell; never states a number the server did not give. */
export function bellLabel(unreadCount: number | null, state: string): string {
  if (state !== "available") return "Notifications (indisponibles)";
  if (unreadCount === null) return "Notifications";
  if (unreadCount === 0) return "Notifications, aucune non lue";
  return `Notifications, ${unreadCount} non lue${unreadCount > 1 ? "s" : ""}`;
}
export const NOTIFICATION_COPY = {
  empty: "Aucune notification pour le moment.",
  emptyUnread: "Aucune notification non lue.",
  loadError: "Les notifications n’ont pas pu être chargées.",
  demo: "Démonstration : notifications fictives, aucune action enregistrée.",
  channelsUnavailable: "Indisponible : aucun fournisseur configuré",
};
