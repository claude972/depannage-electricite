import { PublicTabs } from '@/components/mobile-chrome';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { z } from 'zod';
import { Action, Card, Copy, ReadState, Screen } from '@/components/ui';
import { PhoneChallenge } from '@/components/phone-challenge';
import { OptionalEmailAccount } from '@/components/optional-email-account';
import { ApiFailure, api, useResource } from '@/lib/api';
import { categories, job, statuses } from '@/lib/contracts';
import { verifiedPhone } from '@/lib/phone-client';
import { useSession } from '@/lib/session';
import { orderReference } from '../../../../shared/order-reference';

const route = '/api/auth/phone/history';
const row = job.pick({ id: true, category: true, status: true, city: true, created_at: true, estimate_min_cents: true, estimate_max_cents: true });
const history = z.object({
  interventions: z.array(row),
  page: z.object({ next_cursor: z.string().nullable() }),
});
type History = z.infer<typeof history>;

export default function FindRequests() {
  const auth = useSession(), router = useRouter();
  useEffect(() => {
    if (auth.phoneResume === 'lookup') auth.consumePhoneResume();
  }, [auth.phoneResume]);
  const session = auth.session;
  if (session && verifiedPhone(session.user))
    return <PhoneHistory key={session.user.id} token={session.access_token} />;
  return <Screen top footer={<PublicTabs />}>
    <Copy kind="title">Activité</Copy>
    {session ? <>
      <Copy>Retrouvez vos interventions depuis votre espace connecté.</Copy>
      <Action label="Voir mes interventions" onPress={() => router.push('/interventions')} />
    </> : <>
      <Copy>Connectez-vous par e-mail pour rechercher une intervention avec votre numéro de commande.</Copy>
      <Action label="Me connecter par e-mail" onPress={() => router.push({ pathname: '/connexion', params: { retour: 'interventions' } })} />
      <Copy kind="muted">Vous pouvez aussi utiliser le téléphone associé à une demande existante.</Copy>
      <PhoneChallenge purpose="lookup" />
    </>}
  </Screen>;
}

function PhoneHistory({ token }: { token: string }) {
  const router = useRouter();
  const first = useResource(route, history, token);
  const [extra, setExtra] = useState<{ base: History; page: History } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  useEffect(() => () => inFlight.current?.abort(), [token]);
  const current = extra?.base === first.data ? extra?.page : null;
  const cursor = current ? current.page.next_cursor : first.data?.page.next_cursor;
  const rows = [...new Map([...(first.data?.interventions ?? []), ...(current?.interventions ?? [])].map(item => [item.id, item])).values()];

  async function more() {
    const base = first.data;
    if (!cursor || !base || inFlight.current) return;
    const controller = new AbortController();
    inFlight.current = controller;
    setBusy(true);
    setError(null);
    try {
      const next = await api(route + '?cursor=' + encodeURIComponent(cursor), history, { token, signal: controller.signal });
      if (!controller.signal.aborted) setExtra({ base, page: { ...next, interventions: [...(current?.interventions ?? []), ...next.interventions] } });
    } catch (issue) {
      if (controller.signal.aborted) return;
      if (issue instanceof ApiFailure && [401, 403, 404, 409].includes(issue.status)) {
        setExtra(null);
        first.reload();
      }
      setError(issue instanceof Error ? issue.message : 'Lecture indisponible.');
    } finally {
      if (inFlight.current === controller) inFlight.current = null;
      setBusy(false);
    }
  }

  return <Screen top footer={<PublicTabs />}>
    <Copy kind="title">Activité</Copy>
    <ReadState loading={first.loading} error={first.error} onRetry={first.reload} />
    {first.data && rows.length === 0 && <Copy kind="muted">Aucune intervention pour le moment.</Copy>}
    {rows.map(item => <Card key={item.id}>
      <Copy kind="subtitle">{categories[item.category]}</Copy>
      <Copy kind="label" selectable>{orderReference(item.id)}</Copy>
      <Copy>{item.city} · {statuses[item.status]}</Copy>
      <Action label="Ouvrir l’intervention" onPress={() => router.push({ pathname: '/dossier/[id]', params: { id: item.id } })} />
    </Card>)}
    {error && <Copy kind="error">{error}</Copy>}
    {cursor && <Action secondary disabled={busy} label={busy ? 'Lecture…' : 'Afficher plus'} onPress={() => void more()} />}
    {rows.length > 0 && <OptionalEmailAccount />}
  </Screen>;
}
