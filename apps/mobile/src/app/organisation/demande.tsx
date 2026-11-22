import { Keyboard, Text, View } from 'react-native';
import { useEffect, useRef, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { z } from 'zod';
import { ManagementAccess } from '@/components/management-access';
import { EnterpriseProblemPicker, EnterpriseUrgencyPicker } from '@/components/enterprise-problem-picker';
import { Action, BookingProgress, Card, Copy, Field, ReadState, Screen, usePalette } from '@/components/ui';
import { api, ApiFailure, useResource } from '@/lib/api';
import { categories, creation, euros, prices, requestFields, type Category } from '@/lib/contracts';
import { siteSettings } from '@/lib/management-contracts';
import { enterpriseDraftKey, enterpriseRequestCommand, enterpriseRequestDraft, enterpriseRequestForm, type EnterpriseRequestIntent } from '@/lib/enterprise-request-draft';
import { useDeviceDraft } from '@/lib/use-device-draft';
import { useSession } from '@/lib/session';
import { orderReference } from '../../../../../shared/order-reference';
import { requestDescription, REQUEST_DESCRIPTION_LABEL } from '../../../../../shared/request-details';

export default function EnterpriseRequest() {
  const { site_id } = useLocalSearchParams<{ site_id?: string }>(), session = useSession().session;
  return <ManagementAccess>{session && z.uuid().safeParse(site_id).success
    ? <SiteGate key={session.user.id + site_id} actor={session.user.id} token={session.access_token} siteId={site_id!} />
    : <Screen><Copy>Choisissez un site depuis votre espace entreprise.</Copy></Screen>}</ManagementAccess>;
}
function SiteGate({ actor, token, siteId }: { actor: string; token: string; siteId: string }) {
  const state = useResource(`/api/sites/${siteId}/settings`, siteSettings, token);
  if (!state.data) return <Screen><ReadState loading={state.loading} error={state.error} onRetry={state.reload} /></Screen>;
  if (state.data.site.id !== siteId || !state.data.can_write || state.data.site.archived_at)
    return <Screen><Copy kind="title">Demande indisponible</Copy><Copy>Ce site est archivé ou votre compte ne dispose pas des droits nécessaires.</Copy></Screen>;
  return <Editor key={actor + siteId + state.data.site.organization_id} actor={actor} token={token} site={state.data.site} />;
}
function Editor({ actor, token, site }: { actor: string; token: string; site: z.infer<typeof siteSettings>['site'] }) {
  const palette = usePalette();
  const router = useRouter(), catalogue = useResource('/api/public/indicative-prices', prices);
  const draft = useDeviceDraft(enterpriseDraftKey(actor, site.organization_id, site.id), enterpriseRequestDraft, { intent: null, confirmedId: null });
  const form = draft.value?.form ?? { category: null, description: '', address: site.address, postal: '', city: '', urgency: null, step: 0 };
  const { category, description, address, postal, city, urgency, step } = form;
  function editForm(patch: Partial<z.infer<typeof enterpriseRequestForm>>) {
    draft.edit(current => ({ ...current, form: { ...(current.form ?? form), ...patch } }));
  }
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const lock = useRef(false), controller = useRef<AbortController | null>(null), alive = useRef(true), credential = useRef(token);
  credential.current = token;
  useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort(); }; }, []);
  const intent = draft.value?.intent, progress = intent ? 2 : step;
  const chosen = intent?.payload.category ?? category;
  const range = intent && !intent.reviewRequired ? intent.estimate : chosen ? catalogue.data?.ranges[chosen] : undefined;
  const fields = { category, description: category ? requestDescription(description, categories[category]) : '', address, postal_code: postal, city, urgency };
  function next() {
    setError('');
    if (!category) { setError('Choisissez le problème rencontré.'); return; }
    if (step === 1) {
      if (!urgency) { setError('Choisissez une intervention à planifier ou une demande urgente.'); return; }
      const parsed = requestFields.safeParse(fields);
      if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    }
    Keyboard.dismiss();
    editForm({ step: step + 1 });
  }
  async function submit() {
    if (lock.current || !draft.value || draft.value.confirmedId || !range) return;
    let pending: EnterpriseRequestIntent | null = intent ?? null;
    setError('');
    if (!pending || pending.reviewRequired) {
      if (!catalogue.data) return;
      if (pending) {
        if (pending.payload.reviewed_estimate_version === catalogue.data.version) { setError('Actualisez l’estimation avant de confirmer.'); return; }
        pending = { ...pending, payload: { ...pending.payload, reviewed_estimate_version: catalogue.data.version }, estimate: range, reviewRequired: false };
      } else {
        const parsed = requestFields.safeParse(fields);
        if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
        pending = { id: randomUUID(), actor_id: actor, organization_id: site.organization_id,
          payload: { ...parsed.data, site_id: site.id, reviewed_estimate_version: catalogue.data.version }, estimate: range, reviewRequired: false };
      }
    }
    const sending = pending;
    lock.current = true; setBusy(true);
    const abort = new AbortController(); controller.current = abort;
    try {
      await draft.update(() => ({ intent: sending, confirmedId: null }));
      if (abort.signal.aborted) return;
      const body = enterpriseRequestCommand(sending, { actor, organization: site.organization_id, site: site.id });
      const result = await api('/api/interventions', creation, { token: credential.current, method: 'POST', signal: abort.signal, body });
      // Persist the receipt even if navigation happened while the response was arriving.
      await draft.update(() => ({ intent: null, confirmedId: result.intervention.id }));
    } catch (issue) {
      if (!alive.current) return;
      if (issue instanceof ApiFailure && issue.status === 409 && issue.code === 'estimate_review_required') {
        try { await draft.update(() => ({ intent: { ...sending, reviewRequired: true }, confirmedId: null })); } catch { /* Storage error is shown below. */ }
        catalogue.reload();
      }
      setError(issue instanceof Error ? issue.message : 'L’envoi n’a pas été confirmé.');
    } finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  if (!draft.value) return <Screen><ReadState loading={!draft.error} error={draft.error} onRetry={draft.retry} /></Screen>;
  if (draft.value.confirmedId) return <Screen><Copy kind="title">Demande transmise</Copy><Copy>{site.name}</Copy><Copy>Numéro de commande</Copy><Copy kind="label" selectable>{orderReference(draft.value.confirmedId)}</Copy>{draft.error && <ReadState loading={false} error={draft.error} onRetry={draft.retry} />}<Action label="Ouvrir le dossier" onPress={() => router.replace({ pathname: '/dossier/[id]', params: { id: draft.value!.confirmedId! } })} /><Action secondary label="Créer une autre demande pour ce site" disabled={draft.pending || Boolean(draft.error)} onPress={() => draft.edit(() => ({ intent: null, confirmedId: null }))} /></Screen>;
  return <Screen key={progress}>
    <Copy kind="muted">Site : {site.name}</Copy>
    <Copy kind="title">Créons votre demande.</Copy>
    <Copy kind="muted">Le bon point de départ pour résoudre votre problème électrique.</Copy>
    <BookingProgress columns labels={['Le problème', 'Le lieu et le besoin', 'Le récapitulatif']} index={progress} />
    {progress === 0 && <Card><Copy kind="subtitle">{category ? categories[category] : 'Choisir le problème'}</Copy><EnterpriseProblemPicker value={category} onChange={value => editForm({ category: value })} /><Field label={REQUEST_DESCRIPTION_LABEL} value={description} onChangeText={value => editForm({ description: value })} multiline maxLength={4000} /></Card>}
    {progress === 1 && <Card><Copy kind="subtitle">Où faut-il intervenir ?</Copy><Copy>{site.name}</Copy><Field label="Adresse d’intervention" value={address} onChangeText={value => editForm({ address: value })} maxLength={500} /><Field label="Code postal" value={postal} onChangeText={value => editForm({ postal: value })} keyboardType="number-pad" maxLength={5} /><Field label="Commune" value={city} onChangeText={value => editForm({ city: value })} maxLength={120} /><Copy kind="subtitle">Quel est votre besoin ?</Copy><EnterpriseUrgencyPicker value={urgency} onChange={value => editForm({ urgency: value })} /><Copy kind="muted">La disponibilité et les délais seront précisés après prise en charge.</Copy></Card>}
    {progress === 2 && <Card><Copy kind="subtitle">Votre demande, en clair.</Copy><Copy>{site.name} · {chosen && categories[chosen]}</Copy><Copy>{intent?.payload.description ?? fields.description}</Copy><Copy>{intent?.payload.address ?? address}, {intent?.payload.postal_code ?? postal} {intent?.payload.city ?? city}</Copy><Copy>{(intent?.payload.urgency ?? urgency) === 'urgent' ? 'Urgent' : 'À planifier'}</Copy>
      {(!intent || intent.reviewRequired) && <ReadState loading={catalogue.loading} error={catalogue.error} onRetry={catalogue.reload} />}
      {range && <View style={{ padding: 19, gap: 8, borderWidth: 1, borderColor: palette.border, borderRadius: 8, backgroundColor: palette.subtle }}><Copy kind="muted">Estimation indicative</Copy><Text style={{ fontFamily: 'JakartaMedium', fontSize: 24, lineHeight: 40, color: palette.text }}>{euros(range.min_cents)} – {euros(range.max_cents)}</Text><Copy kind="muted">Le prix final et les taxes applicables seront précisés dans un devis à accepter avant intervention.</Copy></View>}
      {intent?.reviewRequired && <><Copy>Le tarif a changé. Vérifiez la nouvelle estimation avant de confirmer.</Copy><Action secondary label="Actualiser l’estimation" disabled={busy || catalogue.loading} onPress={catalogue.reload} /></>}
      {intent && !intent.reviewRequired && <Copy>Une tentative est enregistrée. Réessayez pour retrouver son résultat sans créer une autre demande.</Copy>}
    </Card>}
    {draft.error && <ReadState loading={false} error={draft.error} onRetry={draft.retry} />}{error && <Copy kind="error">{error}</Copy>}
    {progress < 2 ? <Action label="Continuer" onPress={next} /> : <Action label={busy ? 'Envoi…' : intent ? 'Confirmer et reprendre l’envoi' : 'Envoyer la demande'} disabled={busy || draft.pending || !range || Boolean((!intent || intent.reviewRequired) && !catalogue.data)} onPress={() => void submit()} />}
    {progress > 0 && !intent && <Action secondary label="Retour" disabled={busy} onPress={() => editForm({ step: step - 1 })} />}
  </Screen>;
}
