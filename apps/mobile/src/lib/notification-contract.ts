import { z } from 'zod';

export const notificationSchema = z.object({
  id: z.uuid(), kind: z.string(), title: z.string(), body: z.string(),
  intervention_id: z.uuid().nullable(), organization_id: z.uuid().nullable(), site_id: z.uuid().nullable(),
  support_ticket_id: z.uuid().nullable().optional(), payload: z.record(z.string(), z.unknown()),
  read_at: z.iso.datetime({ offset: true }).nullable(), created_at: z.iso.datetime({ offset: true }),
});
export const notificationPageSchema = z.object({
  notifications: z.array(notificationSchema),
  page: z.object({ limit: z.number().int().positive(), total: z.number().int().nonnegative(), has_more: z.boolean(), next_cursor: z.string().nullable() }),
  unread_count: z.number().int().nonnegative(), filters: z.object({ unread: z.boolean() }),
}).refine(v => !v.page.has_more || Boolean(v.page.next_cursor), 'Missing continuation cursor');
export const notificationMarkSchema = z.object({ updated: z.number().int().nonnegative(), unread_count: z.number().int().nonnegative() });
export type NativeNotification = z.infer<typeof notificationSchema>;
export type NativeNotificationPage = z.infer<typeof notificationPageSchema>;
const dossierKinds = new Set(['mission_assigned', 'mission_received', 'mission_reassigned', 'quote_received', 'quote_rejected', 'quote_accepted', 'work_started', 'work_completed', 'payment_confirmed', 'payment_reminder', 'mission_cancelled', 'appointment_saved', 'appointment_reminder']);

/** Never interpret an arbitrary payload URL as a native route. */
export function notificationDestination(item: NativeNotification) {
  if (item.support_ticket_id || item.kind.startsWith('support_')) return null;
  if (!item.intervention_id) return null;
  if (item.kind === 'message_received') return { pathname: '/dossier/messages' as const, params: { id: item.intervention_id } };
  if (!dossierKinds.has(item.kind)) return null;
  return { pathname: '/dossier/[id]' as const, params: { id: item.intervention_id } };
}
export function mergeNotificationPage(previous: NativeNotification[], incoming: NativeNotificationPage, unread: boolean) {
  if (incoming.filters.unread !== unread) throw new Error('Le filtre reçu ne correspond pas à la liste. Actualisez les notifications.');
  const merged = new Map(previous.map(item => [item.id, item]));
  for (const item of incoming.notifications) merged.set(item.id, item);
  return [...merged.values()];
}
