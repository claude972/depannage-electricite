import test from 'node:test';
import assert from 'node:assert/strict';
import { nativePreferencesViewSchema, preferenceCommand, preferenceDraft, togglePreference } from '../apps/mobile/src/lib/notification-preferences-contract';
const fixture = () => nativePreferencesViewSchema.parse({
  preferences: { muted_kinds: ['future_event'], email_enabled: true, sms_enabled: true, push_enabled: true, version: 7 },
  kinds: [{ kind: 'message_received', label: 'Nouveau message' }],
  channels: { in_app: 'available', email: 'available', sms: 'unavailable', push: 'available', reasons: { email: '', sms: '', push: '' } }, channels_note: '',
});
test('native preference edits preserve unknown saved kinds and do not mutate the server snapshot', () => {
  const view = fixture(), draft = preferenceDraft(view);
  const muted = togglePreference(view, draft, 'message_received');
  assert.deepEqual(muted.muted_kinds, ['future_event', 'message_received']);
  assert.deepEqual(view.preferences.muted_kinds, ['future_event']);
  assert.deepEqual(togglePreference(view, muted, 'message_received'), draft);
  assert.equal(togglePreference(view, draft, 'unoffered_event'), draft);
});
test('saving uses the loaded version and preserves unavailable channels and browser push', () => {
  const view = fixture(), draft = { ...preferenceDraft(view), email_enabled: false, sms_enabled: false, push_enabled: false };
  assert.deepEqual(preferenceCommand(view, draft), { muted_kinds: ['future_event'], email_enabled: false, sms_enabled: true, push_enabled: true, expected_version: 7 });
  assert.equal(view.preferences.version, 7);
});
test('version zero is valid, malformed versions and duplicate events are rejected', () => {
  const view = fixture();
  assert.equal(nativePreferencesViewSchema.safeParse({ ...view, preferences: { ...view.preferences, version: 0 } }).success, true);
  for (const version of [-1, 0.5, 2147483648]) assert.equal(nativePreferencesViewSchema.safeParse({ ...view, preferences: { ...view.preferences, version } }).success, false);
  assert.equal(nativePreferencesViewSchema.safeParse({ ...view, kinds: [...view.kinds, ...view.kinds] }).success, false);
});
