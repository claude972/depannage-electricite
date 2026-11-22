import { useEffect, useRef, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { Alert, Keyboard } from 'react-native';
import { z } from 'zod';
import { Action, BookingProgress, Card, Copy, Field, ReadState, Screen } from '@/components/ui';
import { BookingPhotoPicker, BookingPhotoReceipt } from '@/components/booking-photo';
import { releaseReportPhoto } from '@/lib/draft-photos';
import type { PendingPhoto } from '@/lib/intervention-drafts';
import { BookingLocationField } from '@/components/booking-location-field';
import type { BookingLocation } from '../../../../shared/booking-location';
import { OptionalEmailAccount } from '@/components/optional-email-account';
import { ApiFailure, api, useResource } from '@/lib/api';
import { hasPrivateLocation, locationCapability } from '@/lib/booking-location';
import { categories, euros, prices } from '@/lib/contracts';
import { usePublicServices } from '@/lib/public-services';
import { deviceDrafts } from '@/lib/device-drafts';
import { bookingInput, bookingReceipt, emptyPhoneBooking, phoneBookingDraft, phoneBookingKey, stagedPhoneBooking, stagePhoneBookingKey, type StagedPhoneBooking } from '@/lib/phone-booking-draft';
import { normalizeInternationalPhone, phoneContact, verifiedPhone } from '@/lib/phone-client';
import { useDeviceDraft } from '@/lib/use-device-draft';
import { useSession } from '@/lib/session';
import { accountContact, confirmedAccountEmail, type AccountContact } from '@/lib/email-account';
import { claimEmailBooking, clearEmailBooking, discardUnclaimedEmailBooking, emailBookingKey, PendingEmailBooking, saveEmailBooking, stageEmailBookingKey } from '@/lib/email-booking-draft';
import { useWorkspace } from '@/lib/use-workspace';
import { REQUEST_DESCRIPTION_LABEL, requestDescription } from '../../../../shared/request-details';
import { orderReference } from '../../../../shared/order-reference';

const options = locationCapability.extend({ payment_methods: z.array(z.object({ id: z.string(), available: z.boolean() })) });
type BookingIdentity = { email: string; phone?: never } | { email?: never; phone: string };

export default function ClientBooking() {
  const auth = useSession();
  const { service, field, urgency, commune, reprise } = useLocalSearchParams<{ service?: string; field?: string; urgency?: string; commune?: string; reprise?: string }>();
  const initialCity = typeof commune === 'string' ? commune.trim().slice(0, 120) : '';
  const addressFirst = field === 'address';
  const initialUrgency = urgency === 'urgent' || urgency === 'scheduled' ? urgency : undefined;
  const phone = verifiedPhone(auth.session?.user);
  const email = confirmedAccountEmail(auth.session?.user);
  useEffect(() => {
    if (auth.phoneResume === 'booking') auth.consumePhoneResume();
  }, [auth.phoneResume]);
  if (!auth.session) return <BookingFields service={service} addressFirst={addressFirst} initialUrgency={initialUrgency} initialCity={initialCity} />;
  const identity = email && (reprise === 'email' || !phone) ? { email } : phone ? { phone } : null;
  if (!identity) return <SignedInFallback service={service} initialCity={initialCity} initialUrgency={initialUrgency} />;
  return <VerifiedBooking key={auth.session.user.id + (identity.email ?? identity.phone)} actor={auth.session.user.id}
    identity={identity} token={auth.session.access_token} service={service} addressFirst={addressFirst} initialUrgency={initialUrgency} initialCity={initialCity} />;
}

function SignedInFallback({ service, initialCity, initialUrgency }: { service?: string; initialCity: string; initialUrgency?: InitialUrgency }) {
  const router = useRouter();
  const catalogue = usePublicServices();
  const selected = catalogue.data?.items.find(item => item.slug === service);
  return <Screen>
    <Copy kind="title">Nouvelle demande</Copy>
    <Copy>Continuez depuis votre espace connecté.</Copy>
    <Action label="Ouvrir le formulaire" disabled={Boolean(service && catalogue.loading)} onPress={() => router.replace({ pathname: '/demande', params: {
      ...(selected ? { type: selected.category, service: selected.slug } : {}),
      ...(initialCity ? { commune: initialCity } : {}),
      ...(initialUrgency ? { urgence: initialUrgency } : {}),
    } })} />
  </Screen>;
}

type BookingStep = 'urgency' | 'contact' | 'address' | 'review';
const stepNames: Record<BookingStep, string> = {
  urgency: 'Urgence', contact: 'Vos coordonnées', address: 'Adresse d’intervention', review: 'Récapitulatif',
};
const defaultSteps: BookingStep[] = ['urgency', 'contact', 'address', 'review'];
const addressSteps: BookingStep[] = ['address', 'urgency', 'contact', 'review'];
type InitialUrgency = 'urgent' | 'scheduled';

function BookingFields({ service, addressFirst, initialUrgency, initialCity, owner, initialRequest, onCancelEdit }: {
  service?: string;
  addressFirst?: boolean;
  initialUrgency?: InitialUrgency;
  initialCity?: string;
  initialRequest?: StagedPhoneBooking;
  onCancelEdit?: () => void;
  owner?: { phone: string; first: string; last: string; email?: string; onReady: (request: StagedPhoneBooking) => Promise<void> };
}) {
  const router = useRouter();
  const { setBookingContact } = useSession();
  const catalogue = usePublicServices();
  const price = useResource('/api/public/indicative-prices', prices);
  const [slug, setSlug] = useState(initialRequest?.input.service_slug ?? service ?? '');
  const [description, setDescription] = useState(initialRequest?.input.description ?? '');
  const [address, setAddress] = useState(initialRequest?.input.address ?? '');
  const [postal, setPostal] = useState(initialRequest?.input.postal_code ?? '');
  const [city, setCity] = useState(initialRequest?.input.city ?? initialCity ?? '');
  const [location, setLocation] = useState<BookingLocation | undefined>(initialRequest?.input.location);
  const [locationReset, setLocationReset] = useState(0);
  const [photo, setPhoto] = useState<PendingPhoto | undefined>(initialRequest?.photo);
  const [picking, setPicking] = useState(false);
  const [urgency, setUrgency] = useState<InitialUrgency | null>(initialRequest?.input.urgency ?? initialUrgency ?? null);
  const steps = addressFirst ? addressSteps : defaultSteps;
  const [stepIndex, setStepIndex] = useState(0);
  const step = steps[stepIndex];
  const [first, setFirst] = useState(initialRequest?.contact.first_name ?? owner?.first ?? '');
  const [last, setLast] = useState(initialRequest?.contact.last_name ?? owner?.last ?? '');
  const [phone, setPhone] = useState(initialRequest?.contact.phone ?? owner?.phone ?? '');
  const [email, setEmail] = useState(owner?.email ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ contact: AccountContact; existing: boolean } | null>(null);
  const [guestStage, setGuestStage] = useState<{ key: string; email: string; request: StagedPhoneBooking } | null>(null);
  const savedPhoto = initialRequest?.photo ?? guestStage?.request.photo;
  const savingLock = useRef(false);
  const chosen = catalogue.data?.items.find(item => item.slug === slug);
  const range = chosen && price.data?.ranges[chosen.category];
  const values = { service_slug: chosen?.slug, category: chosen?.category, description: requestDescription(description, chosen?.title ?? ""), address, postal_code: postal, city, urgency, ...(location ? { location } : {}) };
  const addressSchema = bookingInput.pick({ address: true, postal_code: true, city: true });
  const situationSchema = bookingInput.pick({ service_slug: true, category: true, urgency: true, description: true });
  const contactValues = { first_name: first, last_name: last, phone, email };
  const parseContact = () => !owner || owner.email ? accountContact.safeParse(contactValues)
    : phoneContact.safeParse({ ...contactValues, phone: normalizeInternationalPhone(phone) });

  function nextStep() {
    setError(null);
    if (step === 'urgency' && !chosen) { setError('Sélectionnez votre dépannage.'); return; }
    if (step === 'urgency' && !urgency) { setError('Indiquez si l’intervention est urgente.'); return; }
    const result = step === 'address' ? addressSchema.safeParse(values)
      : step === 'contact' ? parseContact()
        : situationSchema.safeParse(values);
    if (!result.success) {
      const phoneIssue = step === 'contact' && !owner?.email && Boolean(owner) && result.error.issues[0].path[0] === 'phone';
      setError(phoneIssue ? 'Renseignez un numéro au format international.' : result.error.issues[0].message);
      return;
    }
    Keyboard.dismiss();
    setStepIndex(stepIndex + 1);
  }

  async function continueRequest() {
    if (!chosen || !range || savingLock.current) return;
    if (!urgency) { setError('Indiquez si l’intervention est urgente.'); return; }
    const input = bookingInput.safeParse(values);
    if (!input.success) { setError(input.error.issues[0].message); return; }
    const contact = parseContact();
    if (!contact.success) { setError(contact.error.issues[0].message); return; }
    const { first_name, last_name, phone } = contact.data;
    const request = {
      id: initialRequest?.id ?? guestStage?.request.id ?? randomUUID(),
      input: input.data,
      contact: { first_name, last_name, phone },
      ...(photo ? { photo } : {}),
    };
    savingLock.current = true;
    setError(null); setSaving(true);
    try {
      if (owner) await owner.onReady(request);
      else {
        const account = accountContact.parse(contactValues);
        const key = await stageEmailBookingKey(account.email);
        await saveEmailBooking(key, account.email, request, null, Boolean(guestStage));
        setGuestStage({ key, email: account.email, request });
        setPending({ contact: account, existing: false });
      }
      if (savedPhoto && savedPhoto.fileId !== request.photo?.fileId) releaseReportPhoto(savedPhoto);
    } catch (issue) {
      if (issue instanceof PendingEmailBooking && !owner) {
        setPending({ contact: accountContact.parse(contactValues), existing: true });
      } else {
        setError(issue instanceof PendingEmailBooking
          ? 'Ce brouillon a changé. Revenez au récapitulatif et rouvrez-le.'
          : 'Le brouillon n’a pas pu être enregistré sur cet appareil. Réessayez.');
      }
    }
    finally { savingLock.current = false; setSaving(false); }
  }

  async function changeGuestEmail() {
    if (!guestStage || savingLock.current) return;
    savingLock.current = true;
    setError(null); setSaving(true);
    try {
      if (!await discardUnclaimedEmailBooking(guestStage.key, guestStage.email, guestStage.request.id)) {
        setError('Connectez-vous avec l’adresse du brouillon pour le modifier.');
        return;
      }
      if (savedPhoto && savedPhoto.fileId !== photo?.fileId) releaseReportPhoto(savedPhoto);
      setGuestStage(null);
      setPending(null);
      setBookingContact(null);
      setStepIndex(steps.indexOf('contact'));
    } catch { setError('L’adresse du brouillon n’a pas pu être modifiée. Réessayez.'); }
    finally { savingLock.current = false; setSaving(false); }
  }

  if (pending) {
    function openAccount(pathname: '/connexion' | '/inscription') {
      if (!pending) return;
      setBookingContact(pending.contact);
      router.push({ pathname, params: { retour: 'demande' } });
    }
    return <Screen>
      <Copy kind="title">Reprendre ma demande</Copy>
      <Copy>{pending.existing
        ? 'Une demande attend déjà pour cette adresse e-mail. Connectez-vous pour la reprendre.'
        : 'Votre brouillon est conservé sur cet appareil. Connectez-vous avec l’adresse e-mail renseignée pour le reprendre.'}</Copy>
      <Action label="Créer un compte" disabled={saving} onPress={() => openAccount('/inscription')} />
      <Action secondary label="J’ai déjà un compte" disabled={saving} onPress={() => openAccount('/connexion')} />
      <Action secondary label="Revenir au formulaire" disabled={saving} onPress={() => {
        setBookingContact(null);
        setPending(null);
        setError(null);
      }} />
      {guestStage && !pending.existing && <Action secondary label="Modifier mon adresse e-mail" disabled={saving}
        onPress={() => Alert.alert('Modifier l’adresse e-mail ?', 'Le brouillon enregistré sera retiré de cet appareil. Vos réponses restent dans le formulaire tant qu’il est ouvert. Enregistrez-le de nouveau avec la bonne adresse.', [
          { text: 'Annuler', style: 'cancel' },
          { text: 'Modifier', onPress: () => { void changeGuestEmail(); } },
        ])} />}
      {error && <Copy kind="error">{error}</Copy>}
    </Screen>;
  }

  return <Screen key={step}>
    <Copy kind="title">Votre demande de dépannage</Copy>
    <BookingProgress labels={steps.map(item => stepNames[item])} index={stepIndex} />
    {chosen && <Card>
      <Copy kind="subtitle">{chosen.title}</Copy>
      {range && <Copy kind="muted">Estimation indicative : {euros(range.min_cents)} à {euros(range.max_cents)}</Copy>}
    </Card>}

    {step === 'urgency' && <>
      <ReadState loading={catalogue.loading} error={catalogue.error} onRetry={catalogue.reload} />
      {chosen ? <Card>
        <Copy kind="subtitle">Est-ce urgent ?</Copy>
        <Action label="Oui, c’est urgent" secondary={urgency !== 'urgent'} onPress={() => setUrgency('urgent')} />
        <Action label="Non, je peux planifier" secondary={urgency !== 'scheduled'} onPress={() => setUrgency('scheduled')} />
        <Field label={REQUEST_DESCRIPTION_LABEL} value={description} onChangeText={setDescription} multiline maxLength={4000}
          returnKeyType="done" submitBehavior="blurAndSubmit" />
        <BookingPhotoPicker photo={photo} preservedPhotoId={savedPhoto?.fileId} onChange={setPhoto} onPicking={setPicking} />
        <Action secondary disabled={picking} label="Changer de dépannage" onPress={() => setSlug('')} />
      </Card> : catalogue.data && <Card>
        <Copy kind="subtitle">Sélectionnez votre dépannage</Copy>
        {catalogue.data.items.length === 0 && <Copy kind="muted">Aucune intervention n’est proposée pour le moment.</Copy>}
        {catalogue.data.items.map(item => <Action key={item.slug} secondary label={item.title} onPress={() => setSlug(item.slug)} />)}
      </Card>}
    </>}
    {step === 'contact' && <Card>
      <Copy kind="subtitle">Vos coordonnées</Copy>
      <Field label="Prénom" value={first} onChangeText={setFirst} autoComplete="given-name" maxLength={60} />
      <Field label="Nom" value={last} onChangeText={setLast} autoComplete="family-name" maxLength={60} />
      {!owner && <Field label="Adresse e-mail" value={email} onChangeText={setEmail} editable={!guestStage} keyboardType="email-address"
        autoComplete="email" autoCapitalize="none" autoCorrect={false} maxLength={254} />}
      <Field label="Téléphone de contact (obligatoire)" value={phone} onChangeText={setPhone} placeholder="+596 ou +590…" keyboardType="phone-pad" autoComplete="tel" maxLength={40} editable={!owner || Boolean(owner.email)} />
      <Copy kind="muted">Ce numéro sert à vous joindre au sujet de l’intervention.</Copy>
    </Card>}
    {step === 'address' && <Card>
      <BookingLocationField key={locationReset} value={{ address, postal_code: postal, city }} location={location} onChange={(value, nextLocation) => {
        setAddress(value.address); setPostal(value.postal_code); setCity(value.city); setLocation(nextLocation);
      }} />
      {hasPrivateLocation(location) && <Action secondary label="Retirer le repère et le complément" onPress={() => {
        setLocation(undefined);
        setLocationReset(value => value + 1);
      }} />}
    </Card>}
    {step === 'review' && <Card>
      <Copy kind="subtitle">Vérifiez votre demande</Copy>
      {description.trim() && <Copy>{description}</Copy>}
      <Copy>{address}, {postal} {city}</Copy>
      <Copy>{first} {last} · {phone}</Copy>
      {email && <Copy>{email}</Copy>}
      <ReadState loading={price.loading} error={price.error} onRetry={price.reload} />
      <Copy kind="muted">Le devis fixe le prix final.</Copy>
    </Card>}

    {error && <Copy kind="error">{error}</Copy>}
    {step === 'review'
      ? <Action label={saving ? 'Enregistrement…' : owner ? 'Continuer vers le règlement' : 'Enregistrer et continuer'} disabled={!range || saving}
          onPress={() => void continueRequest()} />
      : <Action label="Continuer" disabled={picking || (step === 'urgency' && !catalogue.data)} onPress={nextStep} />}
    {stepIndex > 0 && <Action secondary label="Étape précédente" disabled={saving || picking}
      onPress={() => { setError(null); setStepIndex(stepIndex - 1); }} />}
    {onCancelEdit && <Action secondary label="Annuler les modifications" disabled={saving || picking} onPress={() => {
      if (photo && photo.fileId !== savedPhoto?.fileId) releaseReportPhoto(photo);
      onCancelEdit();
    }} />}
  </Screen>;
}

function VerifiedBooking({ actor, identity, token, service, addressFirst, initialUrgency, initialCity }: {
  actor: string; identity: BookingIdentity; token: string; service?: string; addressFirst?: boolean; initialUrgency?: InitialUrgency; initialCity?: string;
}) {
  const router = useRouter();
  const account = useWorkspace(true);
  const { email, phone } = identity;
  const [key, setKey] = useState<string | null>(null), [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    void (email ? stageEmailBookingKey(email) : stagePhoneBookingKey(phone!)).then(value => { if (current) { setKey(value); setError(null); } }, () => {
      if (current) setError('Le brouillon de cet appareil est indisponible.');
    });
    return () => { current = false; };
  }, [email, phone, attempt]);
  if (account.data?.profile.id !== actor || !key) return <Screen>
    <ReadState loading={!error && (account.loading || !key)} error={error ?? account.error} onRetry={() => {
      account.reload(); setAttempt(value => value + 1);
    }} />
  </Screen>;
  if (account.data.profile.role !== 'client') return <Screen>
    <Copy>Ce formulaire est réservé à l’espace client.</Copy>
    <Action label="Ouvrir mon espace" onPress={() => router.replace('/(espace)/accueil')} />
  </Screen>;
  return <ConfirmBooking actor={actor} identity={identity} token={token} service={service} addressFirst={addressFirst} initialUrgency={initialUrgency} initialCity={initialCity} stageKey={key} profile={account.data.profile} />;
}

function ConfirmBooking({ actor, identity, token, service, addressFirst, initialUrgency, initialCity, stageKey, profile }: {
  actor: string; identity: BookingIdentity; token: string; service?: string; addressFirst?: boolean; initialUrgency?: InitialUrgency; initialCity?: string; stageKey: string;
  profile: { first_name?: string | null; last_name?: string | null; phone?: string | null };
}) {
  const router = useRouter();
  const { loginResume, consumeLoginResume } = useSession();
  const { email, phone } = identity;
  const draftKey = email ? emailBookingKey(actor, stageKey) : phoneBookingKey(actor, stageKey);
  const draft = useDeviceDraft(draftKey, phoneBookingDraft, emptyPhoneBooking);
  const price = useResource('/api/public/indicative-prices', prices);
  const bookingOptions = useResource('/api/bookings/options', options);
  const [stage, setStage] = useState<{ request: StagedPhoneBooking | null } | null>(null);
  const [stageError, setStageError] = useState<string | null>(null), [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const [onSite, setOnSite] = useState(false), [newRequest, setNewRequest] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [editing, setEditing] = useState<StagedPhoneBooking | null>(null);
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
    const read = email ? claimEmailBooking(stageKey, email, actor)
      : deviceDrafts.read(stageKey, stagedPhoneBooking).then(request => request?.contact.phone === phone ? request : null);
    void read.then(request => {
      if (current) {
        setStage({ request });
        setStageError(null);
      }
    }, () => { if (current) setStageError('Le brouillon de cet appareil est indisponible.'); });
    return () => { current = false; };
  }, [actor, email, phone, stageKey, attempt]);
  useEffect(() => {
    if (loginResume === 'booking') consumeLoginResume();
  }, [loginResume, consumeLoginResume]);

  const intent = draft.value?.intent;
  const receipt = draft.value?.receipt;
  const request = intent ?? (stage?.request?.id !== receipt?.requestId ? stage?.request : null);
  const range = intent && !intent.reviewRequired ? intent.range : request && price.data?.ranges[request.input.category];
  const version = intent && !intent.reviewRequired ? intent.version : price.data?.version;
  const eligible = bookingOptions.data?.payment_methods.some(method => method.id === 'on_site' && method.available) === true;
  const alreadySending = Boolean(intent && !intent.reviewRequired);
  const locationBlocked = !intent && hasPrivateLocation(request?.input.location) && bookingOptions.data?.accepts_location !== true;

  async function submit() {
    const signal = active.current?.signal;
    if (!request || !range || !version || lock.current || !signal || signal.aborted || (!alreadySending && (!onSite || !eligible))) return;
    if (locationBlocked || (intent?.reviewRequired && version === intent.version)) return;
    // A replay keeps the exact saved payload, even if capabilities changed after the first send.
    const { location, ...details } = request.input;
    const input = intent?.input ?? { ...details, ...(location && bookingOptions.data?.accepts_location === true ? { location } : {}) };
    const sending = { ...request, input, version, range, reviewRequired: false };
    lock.current = true;
    setBusy(true); setError(null);
    try {
      await draft.update(() => ({ intent: sending, receipt: null }));
      if (signal.aborted) return;
      const response = await api('/api/bookings', bookingReceipt, {
        method: 'POST', token: latestToken.current, signal, body: {
          ...sending.input,
          request_id: sending.id,
          contact: { ...sending.contact, email: email ?? '' },
          payment_choice: 'on_site',
          reviewed_estimate_version: sending.version,
        },
      });
      await draft.update(() => ({ intent: null, receipt: { requestId: sending.id, interventionId: response.intervention.id, ...(sending.photo ? { photo: sending.photo } : {}) } }));
      if (email) {
        await clearEmailBooking(stageKey, email, actor, sending.id);
        if (!signal.aborted) setStage({ request: null });
      }
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
    <Copy>Numéro de commande</Copy>
    <Copy kind="label" selectable>{orderReference(receipt.interventionId)}</Copy>
    {draft.error && <ReadState loading={false} error={draft.error} onRetry={draft.retry} />}
    {receipt.photo && !draft.error && <BookingPhotoReceipt id={receipt.interventionId} token={token} photo={receipt.photo} onSent={() => draft.update(value => ({ ...value, receipt: { requestId: receipt.requestId, interventionId: receipt.interventionId } }))} />}
    <Action label="Ouvrir mon intervention" onPress={() => router.replace({ pathname: '/dossier/[id]', params: { id: receipt.interventionId } })} />
    <Action secondary label="Commencer une autre demande" disabled={draft.pending || Boolean(receipt.photo)} onPress={() => {
      if (!email) { setNewRequest(true); return; }
      void clearEmailBooking(stageKey, email, actor, receipt.requestId).then(() => {
        setStage({ request: null });
        setError(null);
        setNewRequest(true);
      }).catch(() => setError('Le brouillon précédent n’a pas pu être clôturé sur cet appareil. Réessayez.'));
    }} />
    {error && <Copy kind="error">{error}</Copy>}
    <OptionalEmailAccount />
  </Screen>;
  if (!request || editing) return <BookingFields service={service} addressFirst={addressFirst} initialUrgency={initialUrgency} initialCity={initialCity}
    initialRequest={editing ?? undefined} onCancelEdit={editing ? () => setEditing(null) : undefined} owner={{
      phone: phone ?? profile.phone ?? '', first: profile.first_name ?? '', last: profile.last_name ?? '', email,
      onReady: async next => {
        if (email) await saveEmailBooking(stageKey, email, next, actor, Boolean(editing));
        else await deviceDrafts.write(stageKey, next);
        setStage({ request: next });
        setEditing(null);
        setReviewing(false);
      },
    }} />;

  const review = reviewing || alreadySending;
  return <Screen key={review ? 'review' : 'payment'}>
    <Copy kind="title">{review ? 'Confirmer ma demande' : 'Mode de règlement'}</Copy>
    <BookingProgress labels={['Règlement', 'Récapitulatif']} index={review ? 1 : 0} />
    <Card>
      <Copy kind="subtitle">{categories[request.input.category]}</Copy>
      <Copy>{request.input.description}</Copy>
      <Copy>{request.input.address}, {request.input.postal_code} {request.input.city}</Copy>
      <Copy>{request.contact.first_name} {request.contact.last_name}</Copy>
      {request.input.location?.access_details && <Copy>{request.input.location.access_details}</Copy>}
      {(!intent || intent.reviewRequired) && <ReadState loading={price.loading} error={price.error} onRetry={price.reload} />}
      {range && <Copy>Estimation indicative : {euros(range.min_cents)} à {euros(range.max_cents)}.</Copy>}
    </Card>
    <Card>
      <Copy kind="subtitle">{review ? "Récapitulatif" : "Choisir le règlement"}</Copy>
      {!alreadySending && <ReadState loading={bookingOptions.loading} error={bookingOptions.error} onRetry={bookingOptions.reload} />}
      {locationBlocked && !bookingOptions.loading && <Copy kind="error">Le repère ou le complément d’accès est conservé dans votre brouillon. Le service ne permet pas encore son envoi. Actualisez les options pour réessayer.</Copy>}
      {locationBlocked && !bookingOptions.loading && !bookingOptions.error && <Action secondary label="Actualiser les options" onPress={bookingOptions.reload} />}
      {eligible && !review && <Action secondary={!onSite} label="Régler après l’intervention" onPress={() => setOnSite(true)} />}
      {review && (onSite || alreadySending) && <Copy>Règlement après l’intervention via DomDépannage.</Copy>}
      {alreadySending && <Copy>Le prochain essai réutilise la même référence de demande.</Copy>}
      {!alreadySending && !eligible && !bookingOptions.loading && !bookingOptions.error && <Copy kind="muted">Ce mode de règlement est indisponible pour le moment.</Copy>}
      {draft.error && <ReadState loading={false} error={draft.error} onRetry={draft.retry} />}
      {error && <Copy kind="error">{error}</Copy>}
      {intent?.reviewRequired && <Action secondary label="Actualiser le tarif" disabled={busy} onPress={price.reload} />}
      {review ? <>
        <Action label={busy ? 'Envoi…' : alreadySending ? 'Réessayer la même demande' : intent?.reviewRequired ? 'Confirmer avec la nouvelle estimation' : 'Confirmer ma demande'}
          disabled={busy || draft.pending || locationBlocked || !range || !version || (!alreadySending && (!onSite || !eligible)) || Boolean(intent?.reviewRequired && version === intent.version)}
          onPress={() => void submit()} />
        {!alreadySending && <Action secondary label="Revenir au règlement" disabled={busy} onPress={() => setReviewing(false)} />}
      </> : <Action label="Continuer vers le récapitulatif" disabled={!onSite || !eligible || locationBlocked} onPress={() => setReviewing(true)} />}
      {email && !intent && <Action secondary label="Modifier ma demande" disabled={busy || draft.pending} onPress={() => {
        if (!lock.current) setEditing(request);
      }} />}
    </Card>
  </Screen>;
}
