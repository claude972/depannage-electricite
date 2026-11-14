import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeNotificationPage, notificationDestination, notificationPageSchema, notificationSchema } from '../apps/mobile/src/lib/notification-contract';

const id = '00000000-0000-4000-8000-000000000001';
const intervention = '00000000-0000-4000-8000-000000000002';
const item = notificationSchema.parse({ id, kind: 'message_received', title: 'Message', body: 'Un message vous attend.', intervention_id: intervention, organization_id: null, site_id: null, payload: {}, read_at: null, created_at: '2026-11-14T12:00:00Z' });
const page = { notifications: [item], page: { limit: 25, total: 1, has_more: false, next_cursor: null }, unread_count: 1, filters: { unread: false } };

test('native notifications only navigate to an explicit supported destination', () => {
  assert.deepEqual(notificationDestination(item), { pathname: '/dossier/messages', params: { id: intervention } });
  assert.deepEqual(notificationDestination({ ...item, kind: 'quote_received' }), { pathname: '/dossier/[id]', params: { id: intervention } });
  assert.equal(notificationDestination({ ...item, kind: 'unknown', payload: { url: 'https://example.org' } }), null);
  assert.equal(notificationDestination({ ...item, kind: 'support_replied', support_ticket_id: id }), null);
  assert.equal(notificationDestination({ ...item, intervention_id: null }), null);
});
test('pagination rejects a response from the previous filter', () => {
  assert.throws(() => mergeNotificationPage([item], page, true), /filtre/);
});
test('pagination replaces repeated records without duplicate cards', () => {
  const updated = { ...item, read_at: '2026-11-14T13:00:00Z' };
  assert.deepEqual(mergeNotificationPage([item], { ...page, notifications: [updated] }, false), [updated]);
});
test('pagination requires a cursor when the server advertises another page', () => {
  assert.equal(notificationPageSchema.safeParse({ ...page, page: { ...page.page, has_more: true } }).success, false);
  assert.equal(notificationPageSchema.safeParse({ ...page, page: { ...page.page, has_more: true, next_cursor: 'next' } }).success, true);
});
test('malformed identifiers, dates and negative counts are rejected', () => {
  assert.equal(notificationSchema.safeParse({ ...item, intervention_id: '../../profile' }).success, false);
  assert.equal(notificationSchema.safeParse({ ...item, created_at: 'not-a-date' }).success, false);
  assert.equal(notificationPageSchema.safeParse({ ...page, unread_count: -1 }).success, false);
});
