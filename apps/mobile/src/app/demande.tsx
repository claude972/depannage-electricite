import { useEffect, useRef, useState } from 'react';
import { Alert, Keyboard } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import type { z } from 'zod';
import { Action, BookingProgress, Card, Copy, Field, ReadState, Screen } from '@/components/ui';
import { BookingPhotoPicker, BookingPhotoReceipt } from '@/components/booking-photo';
import type { PendingPhoto } from '@/lib/intervention-drafts';
import { BookingLocationField } from '@/components/booking-location-field';
import type { BookingLocation } from '../../../../shared/booking-location';
import { ApiFailure, api, useResource } from '@/lib/api';
import { hasPrivateLocation, locationCapability } from '@/lib/booking-location';
import { categories, category as categorySchema, creation, euros, prices, requestFields, workspace, type Category } from '@/lib/contracts';
import { requestDraftKey } from '@/lib/draft-store';
import { requestContact, requestDraft, type RequestIntent } from '@/lib/request-draft';
import { bookingReceipt } from '@/lib/phone-booking-draft';
import { useDeviceDraft } from '@/lib/use-device-draft';
import { useSession } from '@/lib/session';
import { useWorkspace } from '@/lib/use-workspace';
import { REQUEST_DESCRIPTION_LABEL, requestDescription } from '../../../../shared/request-details';
import { orderReference } from '../../../../shared/order-reference';
import { normalizeBookingPhone } from '../../../../shared/booking-contact';

export default function RequestForm() {
  const session = useSession().session;
  const account = useWorkspace(true);
  if (!session) return <Screen><Copy>Connectez-vous pour retrouver une demande en cours.</Copy></Screen>;
  if (!account.data) return <Screen><ReadState loading={account.loading} error={account.error} onRetry={account.reload} /></Screen>;
  if (account.data.profile.role !== 'client' || account.data.profile.id !== session.user.id)
    return <Screen><Copy>Ce formulaire est réservé à l’espace client.</Copy></Screen>;
  return <ClientRequest key={session.user.id} actor={session.user.id} token={session.access_token} profile={account.data.profile} />;
}

function ClientRequest({ actor, token, profile }: { actor: string; token: string; profile: z.infer<typeof workspace>['profile'] }) {
  const router = useRouter();
  const catalogue = useResource('/api/public/indicative-prices', prices);
  const bookingOptions = useResource('/api/bookings/options', locationCapability);
  const draft = useDeviceDraft(requestDraftKey(actor), requestDraft, { intent: null, confirmedId: null });
  const { type, commune, service, urgence } = useLocalSearchParams<{ type?: string; commune?: string; service?: string; urgence?: string }>();
  const [phone, setPhone] = useState(profile.phone ?? '');
  const [firstName, setFirstName] = useState(profile.first_name?.trim() ?? '');
  const [lastName, setLastName] = useState(profile.last_name?.trim() ?? '');
  const [category, setCategory] = useState<Category>(() => categorySchema.safeParse(type).data ?? 'outage');
  const [description, setDescription] = useState('');
  const [step, setStep] = useState(0);
  const [address, setAddress] = useState(''), [postal, setPostal] = useState(''), [city, setCity] = useState(typeof commune === 'string' ? commune.trim().slice(0, 120) : '');
  const [location, setLocation] = useState<BookingLocation>();
  const [photo, setPhoto] = useState<PendingPhoto>();
  const [picking, setPicking] = useState(false);
  const [urgency, setUrgency] = useState<'urgent' | 'scheduled' | null>(() => urgence === 'urgent' || urgence === 'scheduled' ? urgence : null);
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const currentToken = useRef(token);
  currentToken.current = token;
  const active = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    active.current = controller;
    return () => { controller.abort(); active.current = null; };
  }, [actor]);
  const intent = draft.value?.intent;
  const locationBlocked = !intent && hasPrivateLocation(location) && bookingOptions.data?.accepts_location !== true;
  const chosen = intent?.payload.category ?? category;
  const range = intent && !intent.reviewRequired ? intent.estimate : catalogue.data?.ranges[chosen];
  const fields = { category, description: requestDescription(description, categories[category]), address, postal_code: postal, city, urgency };
  const contact = { first_name: firstName, last_name: lastName, phone: normalizeBookingPhone(phone) ?? '' };
  const contactPhone = intent ? intent.booking?.contact.phone : contact.phone;
  const progress = intent ? 2 : step;

  function nextStep() {
    setError(null);
    if (progress === 0 && !urgency) { setError('Indiquez si l’intervention est urgente.'); return; }
    const schema = progress === 0
      ? requestFields.pick({ category: true, description: true, urgency: true })
      : requestFields.pick({ address: true, postal_code: true, city: true });
    const input = schema.safeParse(fields);
    if (!input.success) { setError(input.error.issues[0].message); return; }
    if (progress === 1) {
      const checked = requestContact.safeParse(contact);
      if (!checked.success) { setError(checked.error.issues[0].message); return; }
    }
    Keyboard.dismiss();
    setStep(step + 1);
  }


  async function submit() {
    const signal = active.current?.signal;
    if (!draft.value || draft.value.confirmedId || lock.current || !signal || signal.aborted || locationBlocked) return;
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
        const input = requestFields.safeParse(fields);
        if (!input.success) { setError(input.error.issues[0].message); return; }
        const checked = requestContact.safeParse(contact);
        if (!checked.success) { setError(checked.error.issues[0].message); return; }
        current = {
          id: randomUUID(),
          payload: { ...input.data, ...(location && bookingOptions.data?.accepts_location === true ? { location } : {}), reviewed_estimate_version: version },
          booking: { service_slug: service && type === input.data.category ? service : `demande-${input.data.category}`, contact: checked.data },
          estimate: range,
          reviewRequired: false,
          ...(photo ? { photo } : {}),
        };
      }
    }
    if (!current) return;
    const sending: RequestIntent = current;
    lock.current = true;
    setBusy(true);
    try {
      // A key is usable only once its exact payload survives a process restart.
      await draft.update(() => ({ intent: sending, confirmedId: null }));
      if (signal.aborted) return;
      const body = { ...sending.payload, request_id: sending.id };
      const options = { token: currentToken.current, method: 'POST' as const, signal };
      // A pending intent saved by an earlier app version must replay against its original endpoint.
      const result = sending.booking
        ? await api('/api/bookings', bookingReceipt, {
          ...options, body: { ...body, service_slug: sending.booking.service_slug, contact: { ...sending.booking.contact, email: '' }, payment_choice: 'on_site' },
        })
        : await api('/api/interventions', creation, { ...options, body });
      await draft.update(() => ({ intent: null, confirmedId: result.intervention.id, ...(sending.photo ? { confirmedPhoto: sending.photo } : {}) }));
      if (!signal.aborted) {
        setPhoto(undefined);
        if (!sending.photo) openConfirmed(result.intervention.id);
      }
    } catch (issue) {
      if (signal.aborted) return;
      if (issue instanceof ApiFailure && issue.status === 409 && issue.code === 'estimate_review_required') {
        try { await draft.update(() => ({ intent: { ...sending, reviewRequired: true }, confirmedId: null })); }
        catch { /* The request is still frozen and the storage error is shown. */ }
        catalogue.reload();
      }
      setError(issue instanceof Error ? issue.message : 'Envoi indisponible.');
    } finally { lock.current = false; setBusy(false); }
  }

  function openConfirmed(id: string) {
    router.replace({ pathname: '/dossier/[id]', params: { id } });
  }

  if (draft.value?.confirmedId) {
    const id = draft.value.confirmedId;
    return <Screen>
      <Copy kind="title">Votre demande est transmise</Copy>
      <Copy>Numéro de commande</Copy>
      <Copy kind="label" selectable>{orderReference(id)}</Copy>
      {draft.error && <ReadState loading={false} error={draft.error} onRetry={draft.retry} />}
      {draft.value.confirmedPhoto && <BookingPhotoReceipt id={id} token={token} photo={draft.value.confirmedPhoto} onSent={() => draft.update(() => ({ intent: null, confirmedId: id }))} />}
      <Action label="Ouvrir mon intervention" onPress={() => openConfirmed(id)} />
      <Action secondary label="Commencer une autre demande" disabled={draft.pending || Boolean(draft.value.confirmedPhoto)} onPress={() => draft.edit(() => ({ intent: null, confirmedId: null }))} />
    </Screen>;
  }
  if (!draft.value) return <Screen><ReadState loading={!draft.error} error={draft.error} onRetry={draft.retry} /></Screen>;
  const disabled = busy || Boolean(intent);
  const shownUrgency = intent?.payload.urgency ?? urgency;
  return <Screen key={progress}>
    <Copy kind="title">Votre demande de dépannage</Copy>
    <BookingProgress labels={['Votre besoin', 'Adresse d’intervention', 'Récapitulatif']} index={progress} />
    {progress === 0 && <Card>
      <Copy kind="subtitle">Type de panne</Copy>
      {Object.entries(categories).map(([key, label]) => <Action key={key} disabled={disabled} secondary={chosen !== key} label={label} onPress={() => setCategory(key as Category)} />)}
      <Field label={REQUEST_DESCRIPTION_LABEL} value={intent?.payload.description ?? description} onChangeText={setDescription} maxLength={4000} multiline editable={!disabled}
        returnKeyType="done" submitBehavior="blurAndSubmit" />
      <BookingPhotoPicker photo={photo} onChange={setPhoto} onPicking={setPicking} />
      <Copy kind="subtitle">Est-ce urgent ?</Copy>
      <Action label="Oui, c’est urgent" secondary={shownUrgency !== 'urgent'} disabled={disabled} onPress={() => setUrgency('urgent')} />
      <Action label="Non, je peux planifier" secondary={shownUrgency !== 'scheduled'} disabled={disabled} onPress={() => setUrgency('scheduled')} />
    </Card>}
    {progress === 1 && <Card>
      <BookingLocationField value={{ address, postal_code: postal, city }} location={location} disabled={disabled} onChange={(value, nextLocation) => {
        setAddress(value.address); setPostal(value.postal_code); setCity(value.city); setLocation(nextLocation);
      }} />
      {!profile.first_name?.trim() && <Field label="Prénom" value={firstName} onChangeText={setFirstName} autoComplete="given-name" maxLength={60} />}
      {!profile.last_name?.trim() && <Field label="Nom" value={lastName} onChangeText={setLastName} autoComplete="family-name" maxLength={60} />}
      <Field label="Téléphone de contact (obligatoire)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" maxLength={30} placeholder="+596 ou +590…" />
      <Copy kind="muted">Ce numéro sert à vous joindre au sujet de l’intervention.</Copy>
    </Card>}
    {progress === 2 && <Card>
      <Copy kind="subtitle">Vérifiez votre demande</Copy>
      <Copy>{categories[chosen]} · {shownUrgency === 'urgent' ? 'Urgent' : 'À planifier'}</Copy>
      <Copy>{intent?.payload.description ?? description}</Copy>
      <Copy>{intent?.payload.address ?? address}, {intent?.payload.postal_code ?? postal} {intent?.payload.city ?? city}</Copy>
      {contactPhone && <Copy>Téléphone de contact · {contactPhone}</Copy>}
      {locationBlocked && !bookingOptions.loading && <Copy kind="error">Le repère ou le complément d’accès est conservé dans votre formulaire. Le service ne permet pas encore son envoi.</Copy>}
      {locationBlocked && <ReadState loading={bookingOptions.loading} error={bookingOptions.error} onRetry={bookingOptions.reload} />}
      {locationBlocked && !bookingOptions.loading && !bookingOptions.error && <Action secondary label="Actualiser les options" onPress={bookingOptions.reload} />}
      {(!intent || intent.reviewRequired) && <ReadState loading={catalogue.loading} error={catalogue.error} onRetry={catalogue.reload} />}
      {range && <Copy>{euros(range.min_cents)} à {euros(range.max_cents)}. Le devis fixe le prix final.</Copy>}
      {draft.error && <ReadState loading={false} error={draft.error} onRetry={draft.retry} />}
      {intent && !intent.reviewRequired && <Copy kind="muted">L’envoi reste à confirmer. Le prochain essai réutilise la même référence.</Copy>}
      {intent?.reviewRequired && <>
        <Action secondary label="Actualiser le tarif" disabled={busy} onPress={catalogue.reload} />
        <Action secondary label="Modifier ma demande" disabled={busy || draft.pending} onPress={() => {
          setCategory(intent.payload.category);
          setDescription(intent.payload.description);
          setAddress(intent.payload.address);
          setPostal(intent.payload.postal_code);
          setCity(intent.payload.city);
          setLocation(intent.payload.location);
          setPhoto(intent.photo);
          setUrgency(intent.payload.urgency);
          if (intent.booking) {
            setPhone(intent.booking.contact.phone);
            setFirstName(intent.booking.contact.first_name);
            setLastName(intent.booking.contact.last_name);
          }
          setError(null);
          setStep(0);
          draft.edit(() => ({ intent: null, confirmedId: null }));
        }} />
      </>}
      <Action label={busy ? 'Envoi…' : intent?.reviewRequired ? 'Confirmer le nouveau tarif' : intent ? 'Vérifier ou réessayer la même demande' : 'Confirmer la demande'}
        disabled={busy || draft.pending || locationBlocked || !range || Boolean(intent?.reviewRequired && catalogue.data?.version === intent.payload.reviewed_estimate_version)}
        onPress={() => {
          if (intent && !intent.reviewRequired) { void submit(); return; }
          Alert.alert('Confirmer la demande ?', 'Le montant affiché est une estimation. Vous pourrez examiner le devis avant les travaux.', [
            { text: 'Revenir', style: 'cancel' }, { text: 'Confirmer', onPress: () => void submit() },
          ]);
        }} />
    </Card>}
    {error && <Copy kind="error">{error}</Copy>}
    {progress < 2 && <Action label="Continuer" disabled={picking} onPress={nextStep} />}
    {progress > 0 && !intent && <Action secondary label="Étape précédente" onPress={() => {
      setError(null);
      setStep(step - 1);
    }} />}
  </Screen>;
}
