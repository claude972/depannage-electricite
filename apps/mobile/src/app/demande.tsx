import { useEffect, useRef, useState } from 'react';
import { Alert, View } from 'react-native';
import { useRouter } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import * as Location from 'expo-location';
import { Action, Card, Copy, Field, ReadState, Screen } from '@/components/ui';
import { ApiFailure, api, useResource } from '@/lib/api';
import { categories, creation, euros, prices, requestFields, type Category } from '@/lib/contracts';
import { requestDraftKey } from '@/lib/draft-store';
import { requestDraft, type RequestIntent } from '@/lib/request-draft';
import { useDeviceDraft } from '@/lib/use-device-draft';
import { useSession } from '@/lib/session';
import { useWorkspace } from '@/lib/use-workspace';

export default function RequestForm() {
  const session = useSession().session;
  const account = useWorkspace(true);
  if (!session) return <Screen><Copy>Connectez-vous pour retrouver une demande en cours.</Copy></Screen>;
  if (!account.data) return <Screen><ReadState loading={account.loading} error={account.error} onRetry={account.reload} /></Screen>;
  if (account.data.profile.role !== 'client' || account.data.profile.id !== session.user.id)
    return <Screen><Copy>Ce formulaire est réservé à l’espace client.</Copy></Screen>;
  return <ClientRequest key={session.user.id} actor={session.user.id} token={session.access_token} />;
}

function ClientRequest({ actor, token }: { actor: string; token: string }) {
  const router = useRouter();
  const catalogue = useResource('/api/public/indicative-prices', prices);
  const draft = useDeviceDraft(requestDraftKey(actor), requestDraft, { intent: null });
  const [category, setCategory] = useState<Category>('outage'), [description, setDescription] = useState('');
  const [address, setAddress] = useState(''), [postal, setPostal] = useState(''), [city, setCity] = useState('');
  const [urgency, setUrgency] = useState<'urgent' | 'scheduled' | null>(null);
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false), [locating, setLocating] = useState(false);
  const [suggestion, setSuggestion] = useState<{ address: string; postal: string; city: string } | null>(null);
  const lock = useRef(false);
  const completed = useRef(false);
  const active = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    active.current = controller;
    return () => { controller.abort(); active.current = null; };
  }, [token]);
  const intent = draft.value?.intent;
  const chosen = intent?.payload.category ?? category;
  const range = intent && !intent.reviewRequired ? intent.estimate : catalogue.data?.ranges[chosen];

  async function locate() {
    setLocating(true); setError(null); setSuggestion(null);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) throw Error('Localisation refusée. Vous pouvez saisir votre adresse.');
      const { coords } = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const [place] = await Location.reverseGeocodeAsync(coords);
      const street = place?.street || place?.name;
      if (!street || !place?.postalCode || !(place.city || place.subregion))
        throw Error('Adresse introuvable à cette position. Saisissez-la manuellement.');
      setSuggestion({ address: [place.streetNumber, street].filter(Boolean).join(' '), postal: place.postalCode, city: place.city || place.subregion || '' });
    } catch (issue) { setError(issue instanceof Error ? issue.message : 'Localisation indisponible.'); }
    finally { setLocating(false); }
  }

  async function submit() {
    const signal = active.current?.signal;
    if (!draft.value || lock.current || completed.current || !signal || signal.aborted) return;
    setError(null);
    let current = intent;
    if (!current || current.reviewRequired) {
      if (!catalogue.data || !range) return;
      const version = catalogue.data.version;
      if (current?.reviewRequired) {
        if (version === current.payload.reviewed_estimate_version) {
          setError('La nouvelle estimation n’a pas encore été chargée. Actualisez le tarif.');
          return;
        }
        current = { ...current, payload: { ...current.payload, reviewed_estimate_version: version }, estimate: range, reviewRequired: false };
      } else {
        if (!urgency) { setError('Indiquez si l’intervention est urgente.'); return; }
        const input = requestFields.safeParse({ category, description, address, postal_code: postal, city, urgency });
        if (!input.success) { setError(input.error.issues[0].message); return; }
        current = { id: randomUUID(), payload: { ...input.data, reviewed_estimate_version: version }, estimate: range, reviewRequired: false };
      }
    }
    if (!current) return;
    const sending: RequestIntent = current;
    lock.current = true;
    setBusy(true);
    try {
      // A key is usable only once its exact payload survives a process restart.
      await draft.update(() => ({ intent: sending }));
      if (signal.aborted) return;
      const result = await api('/api/interventions', creation, { token, method: 'POST', body: { ...sending.payload, request_id: sending.id }, signal });
      completed.current = true;
      try { await draft.clear(); }
      finally { if (!signal.aborted) router.replace({ pathname: '/dossier/[id]', params: { id: result.intervention.id } }); }
    } catch (issue) {
      if (signal.aborted) return;
      if (issue instanceof ApiFailure && issue.status === 409 && issue.code === 'estimate_review_required') {
        try { await draft.update(() => ({ intent: { ...sending, reviewRequired: true } })); }
        catch { /* The request is still frozen and the storage error is shown. */ }
        catalogue.reload();
      }
      setError(issue instanceof Error ? issue.message : 'Envoi indisponible.');
    } finally { lock.current = false; setBusy(false); }
  }

  if (!draft.value) return <Screen><ReadState loading={!draft.error} error={draft.error} onRetry={draft.retry} /></Screen>;
  const disabled = busy || Boolean(intent);
  const shownUrgency = intent?.payload.urgency ?? urgency;
  return <Screen>
    <Copy kind="title">Décrivez votre panne</Copy>
    <Card>
      <Copy kind="subtitle">Type de panne</Copy>
      {Object.entries(categories).map(([key, label]) => <Action key={key} disabled={disabled} secondary={chosen !== key} label={label} onPress={() => setCategory(key as Category)} />)}
      <Field label="Description" value={intent?.payload.description ?? description} onChangeText={setDescription} maxLength={4000} multiline editable={!disabled} />
      <Copy kind="subtitle">Est-ce urgent ?</Copy>
      <Action label="Oui, c’est urgent" secondary={shownUrgency !== 'urgent'} disabled={disabled} onPress={() => setUrgency('urgent')} />
      <Action label="Non, je peux planifier" secondary={shownUrgency !== 'scheduled'} disabled={disabled} onPress={() => setUrgency('scheduled')} />
    </Card>
    <Card>
      <Copy kind="subtitle">Adresse d’intervention</Copy>
      <Action secondary label={locating ? 'Recherche…' : 'Utiliser ma position'} disabled={locating || disabled} onPress={() => void locate()} />
      {suggestion && !intent && <View><Copy>{suggestion.address}, {suggestion.postal} {suggestion.city}</Copy>
        <Action secondary label="Utiliser l’adresse proposée" disabled={disabled} onPress={() => { setAddress(suggestion.address); setPostal(suggestion.postal); setCity(suggestion.city); setSuggestion(null); }} />
      </View>}
      <Field label="Adresse" value={intent?.payload.address ?? address} onChangeText={setAddress} maxLength={500} editable={!disabled} />
      <Field label="Code postal" value={intent?.payload.postal_code ?? postal} onChangeText={setPostal} keyboardType="numeric" maxLength={5} editable={!disabled} />
      <Field label="Commune" value={intent?.payload.city ?? city} onChangeText={setCity} maxLength={120} editable={!disabled} />
    </Card>
    <Card>
      <Copy kind="subtitle">Estimation indicative</Copy>
      {(!intent || intent.reviewRequired) && <ReadState loading={catalogue.loading} error={catalogue.error} onRetry={catalogue.reload} />}
      {range && <Copy>{euros(range.min_cents)} à {euros(range.max_cents)}. Le devis fixe le prix final.</Copy>}
      {draft.error && <ReadState loading={false} error={draft.error} onRetry={draft.retry} />}
      {error && <Copy kind="error">{error}</Copy>}
      {intent && !intent.reviewRequired && <Copy kind="muted">L’envoi reste à confirmer. Le prochain essai réutilise la même référence.</Copy>}
      {intent?.reviewRequired && <Action secondary label="Actualiser le tarif" disabled={busy} onPress={catalogue.reload} />}
      <Action label={busy ? 'Envoi…' : intent?.reviewRequired ? 'Confirmer le nouveau tarif' : intent ? 'Vérifier ou réessayer la même demande' : 'Confirmer la demande'}
        disabled={busy || !range || Boolean(intent?.reviewRequired && catalogue.data?.version === intent.payload.reviewed_estimate_version)}
        onPress={() => {
          if (intent && !intent.reviewRequired) { void submit(); return; }
          Alert.alert('Confirmer la demande ?', 'Le montant affiché est une estimation. Vous pourrez examiner le devis avant les travaux.', [
            { text: 'Revenir', style: 'cancel' }, { text: 'Confirmer', onPress: () => void submit() },
          ]);
        }} />
    </Card>
  </Screen>;
}
