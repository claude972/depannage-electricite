import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { z } from 'zod';
import { Action, Card, Copy, Field, ReadState, Screen } from '@/components/ui';
import { ApiFailure, api, useResource } from '@/lib/api';
import { categories, creation, euros, success } from '@/lib/contracts';
import { selectedOffer } from '@/lib/mission-offers';
import { useSession } from '@/lib/session';
import { OfferPhotoGallery } from '@/components/offer-photos';

export default function Offer() {
  const { id: param } = useLocalSearchParams<{ id: string }>();
  const id = z.uuid().safeParse(param).data;
  const token = useSession().session?.access_token;
  const router = useRouter();
  const state = useResource(id && token ? '/api/artisan/missions?id=' + id : null, selectedOffer, token);
  const [reason, setReason] = useState(''), [declining, setDeclining] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const lock = useRef(false);

  async function submit(decline: boolean) {
    if (!id || !token || !state.data || lock.current || (decline && !reason.trim())) return;
    lock.current = true; setBusy(true); setError(null);
    try {
      if (decline) {
        await api(`/api/interventions/${id}/operations`, success, { token, method: 'POST', body: { action: 'decline_offer', reason: reason.trim() } });
        router.back();
      } else {
        const assigned = await api(`/api/interventions/${id}/actions`, creation, { token, method: 'POST', body: { action: 'accept_mission' } });
        if (assigned.intervention.id !== id) throw new Error('Le serveur a renvoyé un autre dossier.');
        router.replace({ pathname: '/dossier/[id]', params: { id } });
      }
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Action indisponible.');
      if (issue instanceof ApiFailure && [401,403,404,409].includes(issue.status)) state.reload();
    } finally { lock.current = false; setBusy(false); }
  }

  const item = state.data?.items[0];
  const net = state.data?.net_estimate;
  return <Screen>
    {!id && <Copy kind="error">Offre introuvable.</Copy>}
    <ReadState loading={state.loading} error={state.error} onRetry={state.reload} />
    {error && <Copy kind="error">{error}</Copy>}
    {item && <>
      <Copy kind="title">{categories[item.category]}</Copy>
      <Card>
        <Copy kind="subtitle">{item.city} · {item.postal_code}</Copy>
        <Copy>{item.urgency === 'urgent' ? 'Demande urgente' : 'Créneau à convenir après attribution'}</Copy>
        <Copy>Estimation client · {euros(item.estimate_min_cents)} à {euros(item.estimate_max_cents)}</Copy>
        <Copy>{net ? `Estimation après commission · ${euros(net.min_cents)} à ${euros(net.max_cents)}` : 'Estimation après commission indisponible.'}</Copy>
        <Copy kind="muted">L’adresse précise reste dans le dossier attribué.</Copy>
      </Card>
      {id && token && <OfferPhotoGallery id={id} token={token} />}
      {declining ? <Card>
        <Field label="Motif du refus" value={reason} onChangeText={setReason} maxLength={1000} multiline editable={!busy} />
        <Action disabled={busy || !reason.trim()} label="Confirmer le refus" onPress={() => void submit(true)} />
        <Action disabled={busy} secondary label="Retour à l’offre" onPress={() => setDeclining(false)} />
      </Card> : <>
        <Action disabled={busy} label={busy ? 'Attribution…' : 'Accepter la mission'} onPress={() => void submit(false)} />
        <Action disabled={busy} secondary label="Refuser cette offre" onPress={() => setDeclining(true)} />
      </>}
    </>}
  </Screen>;
}
