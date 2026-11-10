import { useEffect, useRef, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import * as Location from 'expo-location';
import { z } from 'zod';
import { Action, Card, Copy, Field, ReadState, Screen } from '@/components/ui';
import { PhoneChallenge } from '@/components/phone-challenge';
import { OptionalEmailAccount } from '@/components/optional-email-account';
import { ApiFailure, api, useResource } from '@/lib/api';
import { categories, euros, prices } from '@/lib/contracts';
import { usePublicServices } from '@/lib/public-services';
import { deviceDrafts } from '@/lib/device-drafts';
import { bookingInput, bookingReceipt, emptyPhoneBooking, phoneBookingDraft, phoneBookingKey, stagedPhoneBooking, stagePhoneBookingKey, type StagedPhoneBooking } from '@/lib/phone-booking-draft';
import { normalizeInternationalPhone, phoneContact, verifiedPhone } from '@/lib/phone-client';
import { useDeviceDraft } from '@/lib/use-device-draft';
import { useSession } from '@/lib/session';
import { useWorkspace } from '@/lib/use-workspace';

const options = z.object({ payment_methods: z.array(z.object({ id: z.string(), available: z.boolean() })) });

export default function ClientBooking() {
  const auth = useSession();
  const { service, field } = useLocalSearchParams<{ service?: string; field?: string }>();
  const addressFirst = field === 'address';
  const phone = verifiedPhone(auth.session?.user);
  useEffect(() => {
    if (auth.phoneResume === 'booking') auth.consumePhoneResume();
  }, [auth.phoneResume]);
  if (!auth.session) return <BookingFields service={service} addressFirst={addressFirst} />;
  if (!phone) return <SignedInFallback />;
  return <VerifiedBooking key={auth.session.user.id + phone} actor={auth.session.user.id} phone={phone} token={auth.session.access_token} service={service} addressFirst={addressFirst} />;
}

function SignedInFallback() {
  const router = useRouter();
  return <Screen>
    <Copy kind="title">Nouvelle demande</Copy>
    <Copy>Continuez depuis votre espace connecté.</Copy>
    <Action label="Ouvrir le formulaire" onPress={() => router.replace('/demande')} />
  </Screen>;
}

function BookingFields({ service, addressFirst, owner }: {
  service?: string;
  addressFirst?: boolean;
  owner?: { phone: string; first: string; last: string; onReady: (request: StagedPhoneBooking) => Promise<void> };
}) {
  const router = useRouter();
  const catalogue = usePublicServices();
  const price = useResource('/api/public/indicative-prices', prices);
  const [slug, setSlug] = useState(service ?? ''), [description, setDescription] = useState('');
  const [address, setAddress] = useState(''), [postal, setPostal] = useState(''), [city, setCity] = useState('');
  const [urgency, setUrgency] = useState<'urgent' | 'scheduled' | null>(null);
  const [first, setFirst] = useState(owner?.first ?? ''), [last, setLast] = useState(owner?.last ?? '');
  const [phone, setPhone] = useState(owner?.phone ?? '');
  const [locating, setLocating] = useState(false), [saving, setSaving] = useState(false);
  const [suggestion, setSuggestion] = useState<{ address: string; postal: string; city: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<StagedPhoneBooking | null>(null);
  const savingLock = useRef(false);
  const chosen = catalogue.data?.items.find(item => item.slug === slug);
  const range = chosen && price.data?.ranges[chosen.category];

  async function locate() {
    setLocating(true); setError(null); setSuggestion(null);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) throw new Error('Localisation refusée. Vous pouvez saisir votre adresse.');
      const { coords } = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const [place] = await Location.reverseGeocodeAsync(coords);
      const street = place?.street || place?.name;
      const commune = place?.city || place?.subregion;
      if (!street || !place?.postalCode || !commune) throw new Error('Adresse introuvable à cette position. Saisissez-la manuellement.');
      setSuggestion({ address: [place.streetNumber, street].filter(Boolean).join(' '), postal: place.postalCode, city: commune });
    } catch (issue) { setError(issue instanceof Error ? issue.message : 'Localisation indisponible.'); }
    finally { setLocating(false); }
  }

  async function continueRequest() {
    if (!chosen || !range || savingLock.current) return;
    if (!urgency) { setError('Indiquez si l’intervention est urgente.'); return; }
    const input = bookingInput.safeParse({ service_slug: chosen.slug, category: chosen.category, description, address, postal_code: postal, city, urgency });
    if (!input.success) { setError(input.error.issues[0].message); return; }
    const contact = phoneContact.safeParse({ first_name: first, last_name: last, phone: normalizeInternationalPhone(phone) });
    if (!contact.success) { setError('Renseignez vos prénom, nom et numéro au format international.'); return; }
    const request = { id: randomUUID(), input: input.data, contact: contact.data };
    savingLock.current = true;
    setError(null); setSaving(true);
    try {
      if (owner) await owner.onReady(request);
      else setPending(request);
    } catch { setError('Le brouillon n’a pas pu être enregistré sur cet appareil. Réessayez.'); }
    finally { savingLock.current = false; setSaving(false); }
  }

  if (pending) return <Screen>
    <Copy kind="title">Vérifier mon numéro</Copy>
    <Copy>Ce numéro vous permettra aussi de retrouver vos interventions.</Copy>
    <PhoneChallenge purpose="booking" contact={pending.contact} beforeRequest={async contact => {
      await deviceDrafts.write(await stagePhoneBookingKey(contact.phone), pending);
    }} />
    <Action secondary label="Revenir à ma demande" onPress={() => setPending(null)} />
  </Screen>;

  const addressFields = <Card>
        <Copy kind="subtitle">Adresse d’intervention</Copy>
        <Action secondary label={locating ? 'Recherche…' : 'Utiliser ma position'} disabled={locating} onPress={() => void locate()} />
        {suggestion && <>
          <Copy>{suggestion.address}, {suggestion.postal} {suggestion.city}</Copy>
          <Action secondary label="Utiliser cette adresse" onPress={() => {
            setAddress(suggestion.address); setPostal(suggestion.postal); setCity(suggestion.city); setSuggestion(null);
          }} />
        </>}
        <Field label="Adresse" value={address} onChangeText={setAddress} maxLength={500} />
        <Field label="Code postal" value={postal} onChangeText={setPostal} keyboardType="numeric" maxLength={5} />
        <Field label="Commune" value={city} onChangeText={setCity} maxLength={120} />
      </Card>;

  return <Screen>
    <Copy kind="title">Votre demande de dépannage</Copy>
    {addressFirst && addressFields}
    <ReadState loading={catalogue.loading} error={catalogue.error} onRetry={catalogue.reload} />
    {chosen ? <Card>
      <Copy kind="subtitle">{chosen.title}</Copy>
      <Action secondary label="Changer de dépannage" onPress={() => router.push('/catalogue')} />
      <Copy kind="subtitle">Est-ce urgent ?</Copy>
      <Action label="Oui, c’est urgent" secondary={urgency !== 'urgent'} onPress={() => setUrgency('urgent')} />
      <Action label="Non, je peux planifier" secondary={urgency !== 'scheduled'} onPress={() => setUrgency('scheduled')} />
      <Field label="Décrivez la panne" value={description} onChangeText={setDescription} multiline maxLength={4000} />
    </Card> : catalogue.data && <Card>
      <Copy kind="subtitle">Sélectionnez votre dépannage</Copy>
      {catalogue.data.items.map(item => <Action key={item.slug} secondary label={item.title} onPress={() => setSlug(item.slug)} />)}
    </Card>}
    {chosen && <>
      <Card>
        <Copy kind="subtitle">Vos coordonnées</Copy>
        <Field label="Prénom" value={first} onChangeText={setFirst} autoComplete="given-name" maxLength={60} />
        <Field label="Nom" value={last} onChangeText={setLast} autoComplete="family-name" maxLength={60} />
        <Field label="Téléphone" value={phone} onChangeText={setPhone} placeholder="+596 ou +590…" keyboardType="phone-pad" autoComplete="tel" maxLength={40} editable={!owner} />
      </Card>
      {!addressFirst && addressFields}
      <Card>
        <Copy kind="subtitle">Estimation indicative</Copy>
        <ReadState loading={price.loading} error={price.error} onRetry={price.reload} />
        {range && <Copy>{euros(range.min_cents)} à {euros(range.max_cents)}. Le devis fixe le prix final.</Copy>}
        {error && <Copy kind="error">{error}</Copy>}
        <Action label={saving ? 'Enregistrement…' : 'Continuer'} disabled={!range || saving} onPress={() => void continueRequest()} />
      </Card>
    </>}
  </Screen>;
}

function VerifiedBooking({ actor, phone, token, service, addressFirst }: { actor: string; phone: string; token: string; service?: string; addressFirst?: boolean }) {
  const account = useWorkspace(true);
  const [key, setKey] = useState<string | null>(null), [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    void stagePhoneBookingKey(phone).then(value => { if (current) { setKey(value); setError(null); } }, () => {
      if (current) setError('Le brouillon de cet appareil est indisponible.');
    });
    return () => { current = false; };
  }, [phone, attempt]);
  if (account.data?.profile.id !== actor || !key) return <Screen>
    <ReadState loading={!error && (account.loading || !key)} error={error ?? account.error} onRetry={() => {
      account.reload(); setAttempt(value => value + 1);
    }} />
  </Screen>;
  if (account.data.profile.role !== 'client') return <Screen><Copy>Ce formulaire est réservé à l’espace client.</Copy></Screen>;
  return <ConfirmBooking actor={actor} phone={phone} token={token} service={service} addressFirst={addressFirst} stageKey={key} profile={account.data.profile} />;
}

function ConfirmBooking({ actor, phone, token, service, addressFirst, stageKey, profile }: {
  actor: string; phone: string; token: string; service?: string; addressFirst?: boolean; stageKey: string;
  profile: { first_name?: string | null; last_name?: string | null };
}) {
  const router = useRouter();
  const draft = useDeviceDraft(phoneBookingKey(actor, stageKey), phoneBookingDraft, emptyPhoneBooking);
  const price = useResource('/api/public/indicative-prices', prices);
  const bookingOptions = useResource('/api/bookings/options', options);
  const [stage, setStage] = useState<{ request: StagedPhoneBooking | null } | null>(null);
  const [stageError, setStageError] = useState<string | null>(null), [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const [onSite, setOnSite] = useState(false), [newRequest, setNewRequest] = useState(false);
  const lock = useRef(false);
  const latestToken = useRef(token);
  latestToken.current = token;
  const active = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    active.current = controller;
    return () => controller.abort();
  }, [actor]);
  useEffect(() => {
    let current = true;
    void deviceDrafts.read(stageKey, stagedPhoneBooking).then(request => {
      if (current) {
        setStage({ request: request?.contact.phone === phone ? request : null });
        setStageError(null);
      }
    }, () => { if (current) setStageError('Le brouillon de cet appareil est indisponible.'); });
    return () => { current = false; };
  }, [phone, stageKey, attempt]);

  const intent = draft.value?.intent;
  const receipt = draft.value?.receipt;
  const request = intent ?? (stage?.request?.id !== receipt?.requestId ? stage?.request : null);
  const range = intent && !intent.reviewRequired ? intent.range : request && price.data?.ranges[request.input.category];
  const version = intent && !intent.reviewRequired ? intent.version : price.data?.version;
  const eligible = bookingOptions.data?.payment_methods.some(method => method.id === 'on_site' && method.available) === true;
  const alreadySending = Boolean(intent && !intent.reviewRequired);

  async function submit() {
    const signal = active.current?.signal;
    if (!request || !range || !version || lock.current || !signal || signal.aborted || (!alreadySending && (!onSite || !eligible))) return;
    if (intent?.reviewRequired && version === intent.version) return;
    const sending = { ...request, version, range, reviewRequired: false };
    lock.current = true;
    setBusy(true); setError(null);
    try {
      await draft.update(() => ({ intent: sending, receipt: null }));
      if (signal.aborted) return;
      const response = await api('/api/bookings', bookingReceipt, {
        method: 'POST', token: latestToken.current, signal, body: {
          ...sending.input,
          request_id: sending.id,
          contact: { ...sending.contact, email: '' },
          payment_choice: 'on_site',
          reviewed_estimate_version: sending.version,
        },
      });
      await draft.update(() => ({ intent: null, receipt: { requestId: sending.id, interventionId: response.intervention.id } }));
    } catch (issue) {
      if (signal.aborted) return;
      if (issue instanceof ApiFailure && issue.status === 409 && issue.code === 'estimate_review_required') {
        try { await draft.update(() => ({ intent: { ...sending, reviewRequired: true }, receipt: null })); }
        catch { /* Show the storage error alongside the estimate refusal. */ }
        price.reload();
      }
      setError(issue instanceof Error ? issue.message : 'Envoi indisponible.');
    } finally { lock.current = false; setBusy(false); }
  }

  if (!draft.value || !stage) return <Screen><ReadState loading={!draft.error && !stageError} error={draft.error ?? stageError} onRetry={() => {
    draft.retry(); setAttempt(value => value + 1);
  }} /></Screen>;
  if (!request && receipt && !newRequest) return <Screen>
    <Copy kind="title">Votre demande est transmise</Copy>
    {draft.error && <ReadState loading={false} error={draft.error} onRetry={draft.retry} />}
    <Action label="Ouvrir mon intervention" onPress={() => router.replace({ pathname: '/dossier/[id]', params: { id: receipt.interventionId } })} />
    <Action secondary label="Commencer une autre demande" disabled={draft.pending} onPress={() => setNewRequest(true)} />
    <OptionalEmailAccount />
  </Screen>;
  if (!request) return <BookingFields service={service} addressFirst={addressFirst} owner={{
    phone, first: profile.first_name ?? '', last: profile.last_name ?? '',
    onReady: async next => { await deviceDrafts.write(stageKey, next); setStage({ request: next }); },
  }} />;

  return <Screen>
    <Copy kind="title">Confirmer ma demande</Copy>
    <Card>
      <Copy kind="subtitle">{categories[request.input.category]}</Copy>
      <Copy>{request.input.description}</Copy>
      <Copy>{request.input.address}, {request.input.postal_code} {request.input.city}</Copy>
      <Copy>{request.contact.first_name} {request.contact.last_name}</Copy>
      {(!intent || intent.reviewRequired) && <ReadState loading={price.loading} error={price.error} onRetry={price.reload} />}
      {range && <Copy>Estimation indicative : {euros(range.min_cents)} à {euros(range.max_cents)}.</Copy>}
    </Card>
    <Card>
      <Copy kind="subtitle">Mode de règlement</Copy>
      {!alreadySending && <ReadState loading={bookingOptions.loading} error={bookingOptions.error} onRetry={bookingOptions.reload} />}
      {eligible && <Action secondary={!onSite && !alreadySending} label="Régler après l’intervention" disabled={busy || alreadySending} onPress={() => setOnSite(true)} />}
      {alreadySending && <Copy>Le prochain essai réutilise la même référence de demande.</Copy>}
      {!alreadySending && !eligible && !bookingOptions.loading && !bookingOptions.error && <Copy kind="muted">Ce mode de règlement est indisponible pour le moment.</Copy>}
      {draft.error && <ReadState loading={false} error={draft.error} onRetry={draft.retry} />}
      {error && <Copy kind="error">{error}</Copy>}
      {intent?.reviewRequired && <Action secondary label="Actualiser le tarif" disabled={busy} onPress={price.reload} />}
      <Action label={busy ? 'Envoi…' : alreadySending ? 'Réessayer la même demande' : intent?.reviewRequired ? 'Confirmer avec la nouvelle estimation' : 'Confirmer ma demande'}
        disabled={busy || draft.pending || !range || !version || (!alreadySending && (!onSite || !eligible)) || Boolean(intent?.reviewRequired && version === intent.version)}
        onPress={() => void submit()} />
    </Card>
  </Screen>;
}
