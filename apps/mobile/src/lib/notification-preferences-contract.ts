import { z } from 'zod';

const availability = z.enum(['available', 'unavailable']);
export const nativePreferencesViewSchema = z.object({
  preferences: z.object({
    muted_kinds: z.array(z.string().min(1)).max(30),
    email_enabled: z.boolean(), sms_enabled: z.boolean(), push_enabled: z.boolean(),
    version: z.number().int().min(0).max(2147483647),
  }),
  kinds: z.array(z.object({ kind: z.string().min(1), label: z.string().min(1) })),
  channels: z.object({ in_app: availability, email: availability, sms: availability, push: availability,
    reasons: z.object({ email: z.string(), sms: z.string(), push: z.string() }) }),
  channels_note: z.string(),
}).refine(view => new Set(view.kinds.map(item => item.kind)).size === view.kinds.length, 'Duplicate notification kinds');
export type NativePreferencesView = z.infer<typeof nativePreferencesViewSchema>;
export type PreferenceDraft = Omit<NativePreferencesView['preferences'], 'version'>;
export function preferenceDraft(view: NativePreferencesView): PreferenceDraft {
  const { version: _, ...values } = view.preferences;
  return { ...values, muted_kinds: [...values.muted_kinds] };
}
export function togglePreference(view: NativePreferencesView, draft: PreferenceDraft, kind: string): PreferenceDraft {
  if (!view.kinds.some(item => item.kind === kind)) return draft;
  return { ...draft, muted_kinds: draft.muted_kinds.includes(kind)
    ? draft.muted_kinds.filter(value => value !== kind)
    : [...draft.muted_kinds, kind] };
}
/** Preserve saved channels that this device cannot configure; never silently disable browser push. */
export function preferenceCommand(view: NativePreferencesView, draft: PreferenceDraft) {
  return {
    muted_kinds: [...new Set(draft.muted_kinds)],
    email_enabled: view.channels.email === 'available' ? draft.email_enabled : view.preferences.email_enabled,
    sms_enabled: view.channels.sms === 'available' ? draft.sms_enabled : view.preferences.sms_enabled,
    push_enabled: view.preferences.push_enabled,
    expected_version: view.preferences.version,
  };
}
