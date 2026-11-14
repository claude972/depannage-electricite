import { useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Action, Card, Copy, ReadState, Screen, usePalette } from '@/components/ui';
import { api, ApiFailure } from '@/lib/api';
import { useSession } from '@/lib/session';
import { mergeNotificationPage, notificationDestination, notificationMarkSchema, notificationPageSchema, type NativeNotification, type NativeNotificationPage } from '@/lib/notification-contract';

export default function Notifications() {
  const { session } = useSession();
  if (!session) return <Screen><Copy>Connectez-vous pour consulter vos notifications.</Copy></Screen>;
  // A changed credential remounts the reader and fences every prior response.
  return <NotificationList key={session.access_token} token={session.access_token} />;
}
function NotificationList({ token }: { token: string }) {
  const router = useRouter(), palette = usePalette();
  const [unread, setUnread] = useState(false);
  const [rows, setRows] = useState<NativeNotification[]>([]);
  const [page, setPage] = useState<NativeNotificationPage | null>(null);
  const [readBoundary, setReadBoundary] = useState<string | null>(null);
  const [loading, setLoading] = useState(true), [more, setMore] = useState(false);
  const [pending, setPending] = useState(false), [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const generation = useRef(0), alive = useRef(true), lock = useRef(false), reading = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const currentFilter = useRef(false);

  async function read(append = false, cursor?: string | null) {
    if (append && (reading.current || !cursor)) return;
    abort.current?.abort();
    const controller = new AbortController(); abort.current = controller;
    const version = ++generation.current, filter = currentFilter.current;
    reading.current = true; setError(null);
    if (append) setMore(true); else { setLoading(true); setMore(false); }
    try {
      const query = new URLSearchParams({ limit: '25', unread: filter ? '1' : '0' });
      if (append && cursor) query.set('cursor', cursor);
      const result = await api('/api/notifications?' + query, notificationPageSchema, { token, signal: controller.signal });
      if (!alive.current || generation.current !== version) return;
      // Validate before the state updater so malformed responses follow the error path.
      mergeNotificationPage([], result, filter);
      if (!append) setReadBoundary(result.notifications[0]?.created_at ?? null);
      setRows(old => mergeNotificationPage(append ? old : [], result, filter)); setPage(result);
    } catch (issue) {
      if (!alive.current || generation.current !== version) return;
      if (!append || (issue instanceof ApiFailure && [401, 403].includes(issue.status))) { setRows([]); setPage(null); }
      setError(issue instanceof Error ? issue.message : 'Les notifications sont indisponibles.');
    } finally {
      if (alive.current && generation.current === version) { reading.current = false; setLoading(false); setMore(false); }
    }
  }
  useEffect(() => {
    alive.current = true; void read();
    const sub = AppState.addEventListener('change', state => { if (state === 'active' && !lock.current) void read(); });
    return () => { alive.current = false; generation.current++; abort.current?.abort(); sub.remove(); };
  }, []);
  function changeFilter(value: boolean) {
    if (lock.current || value === currentFilter.current) return;
    currentFilter.current = value; setUnread(value); setRows([]); setPage(null); setNotice(''); void read();
  }
  async function mark(item?: NativeNotification) {
    if (lock.current || reading.current) return;
    if (!item && !readBoundary) return;
    lock.current = true; setPending(true); setError(null); setNotice('');
    try {
      const body = item ? { action: item.read_at ? 'mark_unread' : 'mark_read', ids: [item.id] }
        : { action: 'mark_all_read', before: readBoundary };
      await api('/api/notifications', notificationMarkSchema, { token, method: 'POST', body });
      if (!alive.current) return;
      setNotice(item ? 'Notification mise à jour.' : 'Notifications marquées comme lues.');
      await read();
    } catch (issue) {
      if (!alive.current) return;
      if (issue instanceof ApiFailure && [401, 403].includes(issue.status)) { setRows([]); setPage(null); }
      setError(issue instanceof Error ? issue.message : 'Le marquage n’a pas été confirmé.');
    } finally { if (alive.current) { lock.current = false; setPending(false); } }
  }
  return <Screen refreshing={loading && Boolean(page)} onRefresh={() => { if (!lock.current) void read(); }}>
    <Copy kind="title">Notifications</Copy>
    <Action secondary label="Préférences" onPress={() => router.push("/notification-preferences")} />
    {page && <Copy kind="muted">{page.page.total} notification{page.page.total === 1 ? '' : 's'} dans cette liste · {page.unread_count} non lue{page.unread_count === 1 ? '' : 's'}</Copy>}
    <View style={styles.filters}>
      <View style={styles.filter}><Action label="Toutes" secondary selected={!unread} disabled={pending} onPress={() => changeFilter(false)} /></View>
      <View style={styles.filter}><Action label="Non lues" secondary selected={unread} disabled={pending} onPress={() => changeFilter(true)} /></View>
    </View>
    {page && <Action label={pending ? 'Mise à jour…' : 'Tout marquer comme lu'} secondary disabled={pending || loading || more || !readBoundary || page.unread_count === 0} onPress={() => void mark()} />}
    {notice ? <Text accessibilityLiveRegion="polite" style={[styles.notice, { color: palette.text }]}>{notice}</Text> : null}
    <ReadState loading={loading && !page} error={error} onRetry={() => { if (!lock.current) void read(); }} />
    {!loading && !error && rows.length === 0 && <Card><Copy kind="subtitle">{unread ? 'Tout est à jour' : 'Aucune notification'}</Copy><Copy kind="muted">{unread ? 'Vous n’avez aucune notification non lue.' : 'Les nouvelles informations de votre espace apparaîtront ici.'}</Copy></Card>}
    {rows.map(item => {
      const destination = notificationDestination(item);
      return <Card key={item.id}>
        <Text style={[styles.itemTitle, { color: palette.text }]}>{item.title}{!item.read_at ? ' · Non lue' : ''}</Text>
        <Copy>{item.body}</Copy>
        <Copy kind="muted">{new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.created_at))}</Copy>
        {destination ? <Action secondary label={item.kind === 'message_received' ? 'Voir la conversation' : 'Voir le dossier'} onPress={() => router.push(destination)} />
          : <Copy kind="muted">Consultez votre espace Web pour les détails de cette notification.</Copy>}
        <Action secondary label={item.read_at ? 'Marquer comme non lue' : 'Marquer comme lue'} disabled={pending || loading || more} onPress={() => void mark(item)} />
      </Card>;
    })}
    {page?.page.has_more && <Action secondary label={more ? 'Chargement…' : 'Afficher la suite'} disabled={more || loading || pending} onPress={() => void read(true, page.page.next_cursor)} />}
  </Screen>;
}
const styles = StyleSheet.create({ filters: { flexDirection: 'row', gap: 8 }, filter: { flex: 1 }, itemTitle: { fontFamily: 'JakartaMedium', fontSize: 16, lineHeight: 24 }, notice: { fontFamily: 'JakartaRegular', fontSize: 14, lineHeight: 22 } });
