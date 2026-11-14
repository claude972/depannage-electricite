import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { Action, Card, Copy, ReadState } from './ui';
import { api, useResource } from '@/lib/api';
import { categories, euros } from '@/lib/contracts';
import { offers } from '@/lib/mission-offers';
import { useSession } from '@/lib/session';
import type { z } from 'zod';

export function ArtisanOffers() {
  const session = useSession().session;
  return session ? <Offers key={session.user.id} token={session.access_token} /> : null;
}

function Offers({ token }: { token: string }) {
  const router = useRouter();
  const first = useResource('/api/artisan/missions', offers, token);
  const refresh = first.reload;
  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));
  const [page, setPage] = useState<{ base: z.infer<typeof offers>; items: z.infer<typeof offers>['items']; next: string | null }>();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), [token]);
  const next = page?.base === first.data ? page?.next : first.data?.page.next_cursor;
  const items = page?.base === first.data ? page.items : first.data?.items ?? [];

  async function loadMore() {
    const base = first.data;
    if (!next || !base || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true); setError(null);
    try {
      const result = await api('/api/artisan/missions?cursor=' + encodeURIComponent(next), offers, { token, signal: controller.signal });
      if (!controller.signal.aborted)
        setPage({ base, items: [...new Map([...items, ...result.items].map(item => [item.id, item])).values()], next: result.page.next_cursor });
    } catch (issue) {
      if (!controller.signal.aborted) {
        setPage(undefined);
        setError(issue instanceof Error ? issue.message : 'Offres indisponibles.');
        first.reload();
      }
    } finally { request.current = null; setBusy(false); }
  }

  return <Card>
    <Copy kind="subtitle">Offres disponibles</Copy>
    <ReadState loading={first.loading} error={first.error ?? error} onRetry={() => { setError(null); first.reload(); }} />
    {first.data && !items.length && <Copy kind="muted">{first.data.eligible ? 'Aucune offre pour le moment.' : 'Votre profil doit être approuvé et disponible. Utilisez la disponibilité en haut de cet écran, ou consultez votre profil.'}</Copy>}
    {items.map(item => <Card key={item.id}>
      <Copy kind="subtitle">{categories[item.category]}</Copy>
      <Copy>{item.city} · {item.urgency === 'urgent' ? 'Urgent' : 'Planifiée'}</Copy>
      <Copy kind="muted">Estimation client</Copy>
      <Copy selectable>{euros(item.estimate_min_cents)} à {euros(item.estimate_max_cents)}</Copy>
      <Action secondary label="Voir l’offre" onPress={() => router.push({ pathname: '/offre/[id]', params: { id: item.id } })} />
    </Card>)}
    {next && <Action secondary disabled={busy} label="Afficher plus" onPress={() => void loadMore()} />}
  </Card>;
}
