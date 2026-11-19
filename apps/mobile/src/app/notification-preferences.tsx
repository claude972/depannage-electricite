import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Action, Copy, Screen, usePalette } from '@/components/ui';
import { api, ApiFailure } from '@/lib/api';
import { useSession } from '@/lib/session';
import { nativePreferencesViewSchema, preferenceCommand, preferenceDraft, togglePreference, type NativePreferencesView, type PreferenceDraft } from '@/lib/notification-preferences-contract';

export default function NotificationPreferences() {
  const { session } = useSession();
  return session ? <Editor key={session.access_token} token={session.access_token} /> : <Screen><Copy>Connectez-vous pour modifier vos préférences.</Copy></Screen>;
}
function Editor({ token }: { token: string }) {
  const p = usePalette();
  const [view, setView] = useState<NativePreferencesView | null>(null), [draft, setDraft] = useState<PreferenceDraft | null>(null);
  const [busy, setBusy] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState(''), [conflict, setConflict] = useState(false);
  const alive = useRef(true), lock = useRef(false), controller = useRef<AbortController | null>(null);
  async function request(save: boolean) {
    if (lock.current || (save && (!view || !draft || conflict))) return;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    const abort = new AbortController(); controller.current = abort;
    try {
      const result = await api('/api/notifications/preferences', nativePreferencesViewSchema, { token, signal: abort.signal,
        ...(save && view && draft ? { method: 'POST' as const, body: preferenceCommand(view, draft) } : {}) });
      if (!alive.current || abort.signal.aborted) return;
      setView(result); setDraft(preferenceDraft(result)); setConflict(false);
      if (save) setNotice('Préférences enregistrées.');
    } catch (issue) {
      if (!alive.current || abort.signal.aborted) return;
      if (issue instanceof ApiFailure && [401, 403].includes(issue.status)) { setView(null); setDraft(null); }
      const stale = issue instanceof ApiFailure && issue.status === 409;
      if (stale) setConflict(true);
      setError(stale ? 'Vos préférences ont changé ailleurs. Vos choix sont conservés ici. Rechargez la dernière version avant de les modifier à nouveau.' : issue instanceof Error ? issue.message : 'Enregistrement indisponible. Vos choix sont conservés.');
    } finally {
      if (alive.current && !abort.signal.aborted) { lock.current = false; setBusy(false); }
    }
  }
  useEffect(() => { alive.current = true; void request(false); return () => { alive.current = false; controller.current?.abort(); lock.current = false; }; }, []);
  function reload() {
    Alert.alert('Recharger les préférences ?', 'Vos modifications non enregistrées seront remplacées par la dernière version.', [
      { text: 'Conserver mes choix', style: 'cancel' }, { text: 'Recharger', onPress: () => void request(false) },
    ]);
  }
  function choice(label: string, checked: boolean, onPress: () => void, disabled = false) {
    return <Pressable key={label} accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked, disabled: busy || disabled }} disabled={busy || disabled} onPress={onPress} style={styles.row}>
      {checked ? <Image source={require('../../assets/preferences/checked.svg')} style={styles.check} contentFit="contain" accessibilityElementsHidden /> : <View style={[styles.check, styles.empty, { borderColor: p.border }]} />}
      <Text style={[styles.label, { color: disabled ? p.muted : p.text }]}>{label}</Text>
    </Pressable>;
  }
  return <Screen>
    <Copy kind="title">Préférences</Copy>
    <Copy kind="subtitle">Modifier les préférences</Copy>
    <Copy>Choisissez les événements que vous souhaitez voir dans votre espace.</Copy>
    {!view && error ? <Copy kind="error">{error}</Copy> : null}
    {!view || !draft ? <><Copy>{busy ? 'Chargement des préférences…' : 'Les préférences ne sont pas disponibles.'}</Copy><Action secondary label="Réessayer" disabled={busy} onPress={() => void request(false)} /></> : <>
      <Copy kind="subtitle">Événements affichés dans cet espace</Copy>
      <View>{view.kinds.map(item => choice(item.label, !draft.muted_kinds.includes(item.kind), () => setDraft(current => current ? togglePreference(view, current, item.kind) : current)))}</View>
      <Copy kind="subtitle">Canaux de réception</Copy>
      {choice('E-mail', draft.email_enabled, () => setDraft({ ...draft, email_enabled: !draft.email_enabled }), view.channels.email !== 'available')}
      <Copy kind="muted">{view.channels.reasons.email}</Copy>
      {choice('SMS', draft.sms_enabled, () => setDraft({ ...draft, sms_enabled: !draft.sms_enabled }), view.channels.sms !== 'available')}
      <Copy kind="muted">{view.channels.reasons.sms}</Copy>
      <Copy kind="subtitle">Notifications du navigateur</Copy>
      <Copy>Réglage actuel : {view.preferences.push_enabled ? 'activé' : 'désactivé'}. Choisissez le navigateur destinataire depuis le Web/PWA. Ce réglage ne configure pas les notifications natives du téléphone.</Copy>
      {error ? <Copy kind="error">{error}</Copy> : null}
      {notice ? <Text accessibilityLiveRegion="polite" style={[styles.feedback, { color: p.text }]}>{notice}</Text> : null}
      <Action label={busy ? 'Enregistrement…' : 'Enregistrer'} disabled={busy || conflict} onPress={() => void request(true)} />
      {conflict && <Action secondary label="Recharger la dernière version" disabled={busy} onPress={reload} />}
    </>}
  </Screen>;
}
const styles = StyleSheet.create({
  row: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  check: { width: 20, height: 20, flexShrink: 0 }, empty: { borderWidth: 1.25, borderRadius: 4 },
  feedback: { fontFamily: 'JakartaRegular', fontSize: 14, lineHeight: 22 },
  label: { flex: 1, fontFamily: 'JakartaRegular', fontSize: 14, lineHeight: 22 },
});
