import { useRef, useState, type PropsWithChildren } from 'react';
import { Alert, Linking, View } from 'react-native';
import { useRouter } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { openBrowserAsync } from 'expo-web-browser';
import { z, type ZodType } from 'zod';
import { Action, Card, Copy, Field, ReadState } from './ui';
import { LabeledSwitch } from './labeled-switch';
import { api, ApiFailure, useResource } from '@/lib/api';
import { supabaseOrigin } from '@/lib/config';
import { categories, link, phoneHref, statuses, timestamp } from '@/lib/contracts';
import {
  areaKinds, areaPage, areaSaved, areaValues, complianceKinds, complianceStatuses, contactPage, contactSaved, contactValues,
  criticalities, documentKinds, equipmentCategories, equipmentStatuses, isoDay, operationSaved, planStatuses, siteCompliance,
  siteDocumentPage, siteJobs, siteOperations, type SiteArea, type SiteContact, type SiteOperations,
} from '@/lib/site-contracts';

const chips = { flexDirection: 'row', flexWrap: 'wrap', gap: 8 } as const;

/** Message d’un refus : un conflit de version est expliqué, les autres refus gardent les mots du serveur. */
export function refusal(issue: unknown, fallback = 'Action indisponible.') {
  if (issue instanceof ApiFailure && issue.status === 409 && /Actualisez la page/.test(issue.message))
    return 'Ces informations ont été modifiées entre-temps ou cette action n’est plus disponible. La version à jour est rechargée : vérifiez-la avant de réessayer.';
  return issue instanceof Error ? issue.message : fallback;
}

/** Verrou anti double envoi et commande idempotente : le même contenu repart avec le même identifiant. */
export function useSiteCommand(token: string, onDone: () => void) {
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const lock = useRef(false), command = useRef<{ body: string; id: string } | null>(null);
  function commandId(body: object) {
    const text = JSON.stringify(body);
    if (command.current?.body !== text) command.current = { body: text, id: randomUUID() };
    return command.current.id;
  }
  async function run<T>(path: string, schema: ZodType<T>, body: object, done: string, after?: () => void) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(null); setNotice(null);
    try {
      await api(path, schema, { token, method: 'POST', body });
      command.current = null; setNotice(done); after?.(); onDone();
    } catch (issue) {
      setError(refusal(issue));
      if (issue instanceof ApiFailure && issue.status === 409) { command.current = null; onDone(); }
    } finally { lock.current = false; setBusy(false); }
  }
  return { busy, error, notice, setError, setNotice, commandId, run };
}

export function SiteSection({ title, open, onToggle, children }: PropsWithChildren<{ title: string; open: boolean; onToggle: () => void }>) {
  return <Card>
    <Copy kind="subtitle">{title}</Copy>
    {open && children}
    <Action secondary label={`${open ? 'Masquer' : 'Afficher'} · ${title}`} onPress={onToggle} />
  </Card>;
}

// ------------------------------------------------------------------ contacts et consignes
type ContactDraft = { id: string; version: number | null; first_name: string; last_name: string; role_label: string; phone: string; email: string; note: string; is_primary: boolean };
export function SiteContacts({ siteId, token, writable }: { siteId: string; token: string; writable: boolean }) {
  const path = `/api/sites/${siteId}/contacts`, state = useResource(path, contactPage, token);
  const [draft, setDraft] = useState<ContactDraft | null>(null);
  const work = useSiteCommand(token, state.reload);
  const canWrite = writable && Boolean(state.data?.permissions.can_write);
  const edit = (contact?: SiteContact) => {
    work.setError(null); work.setNotice(null);
    setDraft(contact ? { id: contact.id, version: contact.version, first_name: contact.first_name, last_name: contact.last_name, role_label: contact.role_label, phone: contact.phone ?? '', email: contact.email ?? '', note: contact.note, is_primary: contact.is_primary }
      : { id: randomUUID(), version: null, first_name: '', last_name: '', role_label: '', phone: '', email: '', note: '', is_primary: false });
  };
  function save() {
    if (!draft) return;
    const parsed = contactValues(draft);
    if (!parsed.success) { work.setError(parsed.error.issues[0].message); return; }
    const values = { ...parsed.data, phone: parsed.data.phone || null, email: parsed.data.email || null };
    const body = { action: 'save', id: draft.id, expected_version: draft.version, values };
    void work.run(path, contactSaved, { ...body, command_id: work.commandId(body) }, 'Le contact a été enregistré.', () => setDraft(null));
  }
  function archive(contact: SiteContact) {
    Alert.alert('Archiver ce contact ?', `${contact.first_name} ${contact.last_name} ne sera plus proposé pour ce site.`, [{ text: 'Revenir', style: 'cancel' }, { text: 'Archiver', onPress: () => {
      const body = { action: 'archive', id: contact.id, expected_version: contact.version };
      void work.run(path, contactSaved, { ...body, command_id: work.commandId(body) }, 'Le contact a été archivé.');
    } }]);
  }
  return <>
    <ReadState loading={state.loading} error={state.error} onRetry={state.reload} />
    {work.notice && <Copy>{work.notice}</Copy>}
    {work.error && !draft && <Copy kind="error">{work.error}</Copy>}
    {state.data && !draft && <>
      {state.data.records.length === 0 && <Copy>Aucun contact enregistré pour ce site.</Copy>}
      {state.data.records.map(contact => <View key={contact.id} style={{ gap: 6 }}>
        <Copy kind="label">{contact.role_label}{contact.is_primary ? ' · Contact principal' : ''}</Copy>
        <Copy selectable>{contact.first_name} {contact.last_name}</Copy>
        {contact.email && <Copy kind="muted" selectable>{contact.email}</Copy>}
        {contact.note ? <Copy selectable>Consigne · {contact.note}</Copy> : null}
        {contact.phone && <Action secondary label={`Appeler ${contact.first_name} ${contact.last_name} · ${contact.phone}`} onPress={() => void Linking.openURL(phoneHref(contact.phone!)).catch(() => work.setError('Aucune application de cet appareil n’a pu composer le ' + contact.phone + '.'))} />}
        {canWrite && <>
          <Action secondary label={`Modifier le contact ${contact.first_name} ${contact.last_name}`} disabled={work.busy} onPress={() => edit(contact)} />
          <Action secondary label={`Archiver le contact ${contact.first_name} ${contact.last_name}`} disabled={work.busy} onPress={() => archive(contact)} />
        </>}
      </View>)}
      {state.data.page.has_more && <Copy kind="muted">Les 100 premiers contacts sont affichés.</Copy>}
      {canWrite ? <Action label="Ajouter un contact" disabled={work.busy} onPress={() => edit()} /> : <Copy kind="muted">Les contacts de ce site sont en lecture seule pour votre compte.</Copy>}
    </>}
    {draft && <>
      <Copy kind="label">{draft.version ? 'Modifier le contact' : 'Nouveau contact'}</Copy>
      <Field label="Prénom du contact" value={draft.first_name} maxLength={100} editable={!work.busy} onChangeText={first_name => setDraft({ ...draft, first_name })} />
      <Field label="Nom du contact" value={draft.last_name} maxLength={100} editable={!work.busy} onChangeText={last_name => setDraft({ ...draft, last_name })} />
      <Field label="Fonction" value={draft.role_label} maxLength={160} editable={!work.busy} onChangeText={role_label => setDraft({ ...draft, role_label })} />
      <Field label="Téléphone du contact" value={draft.phone} maxLength={31} keyboardType="phone-pad" editable={!work.busy} onChangeText={phone => setDraft({ ...draft, phone })} />
      <Field label="E-mail du contact" value={draft.email} maxLength={254} keyboardType="email-address" autoCapitalize="none" editable={!work.busy} onChangeText={email => setDraft({ ...draft, email })} />
      <Field label="Consigne pour l’intervenant" value={draft.note} maxLength={2000} multiline editable={!work.busy} onChangeText={note => setDraft({ ...draft, note })} />
      <LabeledSwitch label="Contact principal du site" value={draft.is_primary} disabled={work.busy} onValueChange={is_primary => setDraft({ ...draft, is_primary })} />
      {work.error && <Copy kind="error">{work.error}</Copy>}
      <Action label={work.busy ? 'Enregistrement…' : 'Enregistrer le contact'} disabled={work.busy} onPress={save} />
      <Action secondary label="Annuler la saisie du contact" disabled={work.busy} onPress={() => { setDraft(null); work.setError(null); }} />
    </>}
  </>;
}

// ------------------------------------------------------------------ zones
type AreaDraft = { id: string; version: number | null; label: string; kind: SiteArea['kind']; reference: string; note: string; parent_id: string | null };
export function SiteAreas({ siteId, token, writable }: { siteId: string; token: string; writable: boolean }) {
  const path = `/api/sites/${siteId}/areas`, state = useResource(path, areaPage, token);
  const [draft, setDraft] = useState<AreaDraft | null>(null);
  const work = useSiteCommand(token, state.reload);
  const canWrite = writable && Boolean(state.data?.permissions.can_write);
  const records = state.data?.records ?? [];
  // Affichage hiérarchique : chaque zone suit son parent.
  const ordered = (() => {
    const out: SiteArea[] = [], seen = new Set<string>();
    const walk = (parent: string | null) => records.filter(area => area.parent_id === parent).sort((a, b) => a.label.localeCompare(b.label, 'fr')).forEach(area => { if (seen.has(area.id)) return; seen.add(area.id); out.push(area); walk(area.id); });
    walk(null);
    return [...out, ...records.filter(area => !seen.has(area.id))];
  })();
  const edit = (area?: SiteArea, parent: string | null = null) => {
    work.setError(null); work.setNotice(null);
    setDraft(area ? { id: area.id, version: area.version, label: area.label, kind: area.kind, reference: area.reference, note: area.note, parent_id: area.parent_id }
      : { id: randomUUID(), version: null, label: '', kind: parent ? 'zone' : 'floor', reference: '', note: '', parent_id: parent });
  };
  function save() {
    if (!draft) return;
    const parsed = areaValues(draft);
    if (!parsed.success) { work.setError(parsed.error.issues[0].message); return; }
    const body = { action: 'save', id: draft.id, expected_version: draft.version, values: { ...parsed.data, kind: draft.kind, parent_id: draft.parent_id } };
    void work.run(path, areaSaved, { ...body, command_id: work.commandId(body) }, 'La zone a été enregistrée.', () => setDraft(null));
  }
  function archive(area: SiteArea) {
    Alert.alert('Archiver cette zone ?', `« ${area.label} » ne sera plus proposée pour ce site.`, [{ text: 'Revenir', style: 'cancel' }, { text: 'Archiver', onPress: () => {
      const body = { action: 'archive', id: area.id, expected_version: area.version };
      void work.run(path, areaSaved, { ...body, command_id: work.commandId(body) }, 'La zone a été archivée.');
    } }]);
  }
  const parents = records.filter(area => area.depth < 4 && area.id !== draft?.id);
  return <>
    <Copy kind="muted">Étages, zones et parties communes du site, pour situer les équipements et les interventions. Classement descriptif uniquement.</Copy>
    <ReadState loading={state.loading} error={state.error} onRetry={state.reload} />
    {work.notice && <Copy>{work.notice}</Copy>}
    {work.error && !draft && <Copy kind="error">{work.error}</Copy>}
    {state.data && !draft && <>
      {records.length === 0 && <Copy>Aucune zone enregistrée pour ce site.</Copy>}
      {ordered.map(area => <View key={area.id} style={{ gap: 6, paddingLeft: (area.depth - 1) * 12 }}>
        <Copy kind="label">{areaKinds[area.kind]}{area.reference ? ' · ' + area.reference : ''}</Copy>
        <Copy selectable>{area.label}</Copy>
        {area.note ? <Copy kind="muted">{area.note}</Copy> : null}
        {canWrite && <>
          <Action secondary label={`Modifier la zone ${area.label}`} disabled={work.busy} onPress={() => edit(area)} />
          {area.depth < 4 && <Action secondary label={`Ajouter une zone dans ${area.label}`} disabled={work.busy} onPress={() => edit(undefined, area.id)} />}
          <Action secondary label={`Archiver la zone ${area.label}`} disabled={work.busy} onPress={() => archive(area)} />
        </>}
      </View>)}
      {state.data.page.has_more && <Copy kind="muted">Les 100 premières zones sont affichées sur {state.data.page.total}.</Copy>}
      {canWrite ? <Action label="Ajouter une zone" disabled={work.busy} onPress={() => edit()} /> : <Copy kind="muted">Les zones de ce site sont en lecture seule pour votre compte.</Copy>}
    </>}
    {draft && <>
      <Copy kind="label">{draft.version ? 'Modifier la zone' : 'Nouvelle zone'}</Copy>
      <Field label="Nom de la zone" value={draft.label} maxLength={160} editable={!work.busy} onChangeText={label => setDraft({ ...draft, label })} />
      <Copy>Type de zone</Copy>
      <View style={chips}>{Object.entries(areaKinds).map(([value, label]) => <Action key={value} label={label} selected={draft.kind === value} secondary={draft.kind !== value} disabled={work.busy} onPress={() => setDraft({ ...draft, kind: value as SiteArea['kind'] })} />)}</View>
      <Copy>Rattachement</Copy>
      <View style={chips}>
        <Action label="Aucun rattachement" selected={draft.parent_id === null} secondary={draft.parent_id !== null} disabled={work.busy} onPress={() => setDraft({ ...draft, parent_id: null })} />
        {parents.map(area => <Action key={area.id} label={`Dans ${area.label}`} selected={draft.parent_id === area.id} secondary={draft.parent_id !== area.id} disabled={work.busy} onPress={() => setDraft({ ...draft, parent_id: area.id })} />)}
      </View>
      <Field label="Repère (facultatif)" value={draft.reference} maxLength={80} editable={!work.busy} onChangeText={reference => setDraft({ ...draft, reference })} />
      <Field label="Note sur la zone (facultatif)" value={draft.note} maxLength={2000} multiline editable={!work.busy} onChangeText={note => setDraft({ ...draft, note })} />
      {work.error && <Copy kind="error">{work.error}</Copy>}
      <Action label={work.busy ? 'Enregistrement…' : 'Enregistrer la zone'} disabled={work.busy} onPress={save} />
      <Action secondary label="Annuler la saisie de la zone" disabled={work.busy} onPress={() => { setDraft(null); work.setError(null); }} />
    </>}
  </>;
}

// ------------------------------------------------------------------ documents du site
export function SiteDocuments({ siteId, token }: { siteId: string; token: string }) {
  const [history, setHistory] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const path = `/api/sites/${siteId}/documents`, state = useResource(`${path}?state=${history ? 'history' : 'current'}`, siteDocumentPage, token);
  const lock = useRef(false);
  async function open(id: string) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(null);
    try {
      const result = await api(`${path}?id=${encodeURIComponent(id)}`, link, { token });
      const target = new URL(result.url);
      if (target.origin !== supabaseOrigin || !target.pathname.startsWith('/storage/v1/object/sign/')) throw Error('Le lien du document est invalide.');
      await openBrowserAsync(target.toString());
    } catch (issue) { setError(issue instanceof Error ? issue.message : 'Le document n’a pas pu être ouvert.'); }
    finally { lock.current = false; setBusy(false); }
  }
  return <>
    <Copy kind="muted">{history ? 'Versions remplacées et documents archivés du site.' : 'Documents en vigueur du site. Chaque ouverture demande un lien temporaire au serveur.'}</Copy>
    <ReadState loading={state.loading} error={state.error} onRetry={state.reload} />
    {error && <Copy kind="error">{error}</Copy>}
    {state.data?.documents.length === 0 && <Copy>{history ? 'Aucune version remplacée ni document archivé.' : 'Aucun document en vigueur pour ce site.'}</Copy>}
    {state.data?.documents.map(item => <View key={item.id} style={{ gap: 6 }}>
      <Copy kind="label">{documentKinds[item.kind]} · version {item.version}{item.archived_at ? ' · archivé' : item.replaced_at ? ' · remplacé' : ''}</Copy>
      <Copy kind="muted">Déposé le {timestamp(item.created_at)}</Copy>
      <Action secondary label={`Ouvrir ${item.name}`} disabled={busy} onPress={() => void open(item.id)} />
    </View>)}
    {state.data?.page.has_more && <Copy kind="muted">Les documents les plus récents sont affichés ; la liste complète reste disponible sur le portail Web.</Copy>}
    <Action secondary label={history ? 'Afficher les documents en vigueur' : 'Afficher les versions remplacées et les archives'} onPress={() => setHistory(!history)} />
    <Copy kind="muted">Le dépôt, le remplacement et l’archivage d’un document se font depuis le portail Web.</Copy>
  </>;
}

// ------------------------------------------------------------------ interventions et échéances du site
export function SiteInterventions({ siteId, token }: { siteId: string; token: string }) {
  const router = useRouter(), [past, setPast] = useState(false);
  const state = useResource(`/api/sites/${siteId}/records?kind=${past ? 'past' : 'open'}`, siteJobs, token);
  return <>
    <Copy kind="muted">{past ? 'Interventions terminées, réglées ou annulées de ce site.' : 'Interventions en cours de ce site.'}</Copy>
    <ReadState loading={state.loading} error={state.error} onRetry={state.reload} />
    {state.data?.items.length === 0 && <Copy>{past ? 'Aucune intervention passée pour ce site.' : 'Aucune intervention en cours pour ce site.'}</Copy>}
    {state.data?.items.map(item => <View key={item.id} style={{ gap: 6 }}>
      <Copy kind="label">{statuses[item.status]} · {item.urgency === 'urgent' ? 'Urgent' : 'Planifié'}</Copy>
      <Copy>{categories[item.category]} · {timestamp(item.created_at)}</Copy>
      <Action secondary label={`Ouvrir le dossier INT-${item.id.slice(0, 6).toUpperCase()}`} onPress={() => router.push({ pathname: '/dossier/[id]', params: { id: item.id } })} />
    </View>)}
    {state.data?.page.has_more && <Copy kind="muted">Les 50 interventions les plus récentes sont affichées.</Copy>}
    <Action secondary label={past ? 'Afficher les interventions en cours' : 'Afficher les interventions passées'} onPress={() => setPast(!past)} />
  </>;
}
export function SiteDeadlines({ siteId, token }: { siteId: string; token: string }) {
  const [done, setDone] = useState(false);
  const state = useResource(`/api/sites/${siteId}/records?kind=${done ? 'completed' : 'upcoming'}`, siteCompliance, token);
  return <>
    <Copy kind="muted">Échéances déclarées par votre organisation ; elles ne valent ni contrôle réglementaire ni certification.</Copy>
    <ReadState loading={state.loading} error={state.error} onRetry={state.reload} />
    {state.data?.items.length === 0 && <Copy>{done ? 'Aucune échéance réalisée.' : 'Aucune échéance à venir.'}</Copy>}
    {state.data?.items.map(item => <View key={item.id} style={{ gap: 4 }}>
      <Copy kind="label">{complianceKinds[item.kind]} · {complianceStatuses[item.status]}</Copy>
      <Copy>{item.title} · {isoDay(item.due_on)}</Copy>
      {item.notes ? <Copy kind="muted">{item.notes}</Copy> : null}
    </View>)}
    <Action secondary label={done ? 'Afficher les échéances à venir' : 'Afficher les échéances réalisées'} onPress={() => setDone(!done)} />
  </>;
}

// ------------------------------------------------------------------ équipements et maintenance
type Equipment = SiteOperations['snapshot']['equipment'][number];
type EquipmentDraft = { id: string | null; version: number | null; name: string; category: Equipment['category']; criticality: Equipment['criticality']; location: string; reference: string; installed_on: string | null; status: Equipment['status']; notes: string };
export function SiteEquipment({ siteId, token, writable }: { siteId: string; token: string; writable: boolean }) {
  const ops = useResource(`/api/site-operations?site_id=${siteId}`, siteOperations, token);
  const router = useRouter(), [draft, setDraft] = useState<EquipmentDraft | null>(null), [linked, setLinked] = useState<string | null>(null);
  const work = useSiteCommand(token, ops.reload);
  const snapshot = ops.data?.snapshot, canWrite = writable && Boolean(snapshot?.limits.can_write_site);
  const edit = (item?: Equipment) => {
    work.setError(null); work.setNotice(null);
    setDraft(item ? { id: item.id, version: item.version, name: item.name, category: item.category, criticality: item.criticality, location: item.location, reference: item.reference, installed_on: item.installed_on, status: item.status, notes: item.notes }
      : { id: null, version: null, name: '', category: 'panel', criticality: 'medium', location: '', reference: '', installed_on: null, status: 'in_service', notes: '' });
  };
  function save() {
    if (!draft) return;
    if (!draft.name.trim()) { work.setError('Renseignez le nom de l’équipement.'); return; }
    if (draft.id && !draft.version) { work.setError('La version de cet équipement n’a pas pu être lue. Rechargez la fiche.'); return; }
    const payload = { name: draft.name.trim(), category: draft.category, criticality: draft.criticality, location: draft.location.trim(), reference: draft.reference.trim(), installed_on: draft.installed_on, status: draft.status, notes: draft.notes.trim() };
    const body = draft.id ? { action: 'save_equipment', site_id: siteId, payload, id: draft.id, expected_version: draft.version } : { action: 'save_equipment', site_id: siteId, payload };
    void work.run('/api/site-operations', operationSaved, body, 'L’équipement a été enregistré.', () => setDraft(null));
  }
  return <>
    <ReadState loading={ops.loading} error={ops.error} onRetry={ops.reload} />
    {work.notice && <Copy>{work.notice}</Copy>}
    {work.error && !draft && <Copy kind="error">{work.error}</Copy>}
    {snapshot && !draft && <>
      {snapshot.equipment.length === 0 && <Copy>Aucun équipement enregistré pour ce site.</Copy>}
      {snapshot.equipment.map(item => <View key={item.id} style={{ gap: 6 }}>
        <Copy kind="label">{equipmentCategories[item.category]} · {equipmentStatuses[item.status]}</Copy>
        <Copy selectable>{item.name}</Copy>
        <Copy kind="muted">Criticité {criticalities[item.criticality].toLocaleLowerCase('fr')}{item.location ? ' · ' + item.location : ''}{item.reference ? ' · réf. ' + item.reference : ''}{item.installed_on ? ' · installé le ' + isoDay(item.installed_on) : ''}</Copy>
        {item.notes ? <Copy kind="muted">{item.notes}</Copy> : null}
        <Action secondary label={`${linked === item.id ? 'Masquer' : 'Afficher'} les interventions liées à ${item.name}`} onPress={() => setLinked(linked === item.id ? null : item.id)} />
        {linked === item.id && <EquipmentLinks siteId={siteId} assetId={item.id} token={token} open={id => router.push({ pathname: '/dossier/[id]', params: { id } })} />}
        {canWrite && <Action secondary label={`Modifier l’équipement ${item.name}`} disabled={work.busy} onPress={() => edit(item)} />}
      </View>)}
      {snapshot.limits.equipment_limited && <Copy kind="muted">La liste des équipements est partielle.</Copy>}
      {canWrite ? <Action label="Ajouter un équipement" disabled={work.busy} onPress={() => edit()} /> : <Copy kind="muted">Les équipements de ce site sont en lecture seule pour votre compte.</Copy>}
      <Copy kind="label">Plans de maintenance</Copy>
      {snapshot.maintenance_plans.length === 0 && <Copy>Aucun plan de maintenance enregistré.</Copy>}
      {snapshot.maintenance_plans.map(plan => <View key={plan.id} style={{ gap: 4 }}>
        <Copy>{plan.title} · {planStatuses[plan.status]}</Copy>
        <Copy kind="muted">{plan.frequency_kind === 'none' ? 'Sans périodicité' : `Tous les ${plan.frequency_value} ${{ days: 'jours', weeks: 'semaines', months: 'mois' }[plan.frequency_kind]}`} · prochaine échéance {isoDay(plan.next_due_on)} · dernière visite {isoDay(plan.last_done_on)} · {plan.visits_total} visite(s) enregistrée(s)</Copy>
      </View>)}
      {snapshot.limits.maintenance_plans_limited && <Copy kind="muted">La liste des plans est partielle.</Copy>}
      <Copy kind="muted">Les plans de maintenance et leurs visites se saisissent depuis le portail Web.</Copy>
    </>}
    {draft && <>
      <Copy kind="label">{draft.id ? 'Modifier l’équipement' : 'Nouvel équipement'}</Copy>
      <Field label="Nom de l’équipement" value={draft.name} maxLength={160} editable={!work.busy} onChangeText={name => setDraft({ ...draft, name })} />
      <Copy>Catégorie</Copy>
      <View style={chips}>{Object.entries(equipmentCategories).map(([value, label]) => <Action key={value} label={label} selected={draft.category === value} secondary={draft.category !== value} disabled={work.busy} onPress={() => setDraft({ ...draft, category: value as Equipment['category'] })} />)}</View>
      <Copy>Criticité</Copy>
      <View style={chips}>{Object.entries(criticalities).map(([value, label]) => <Action key={value} label={`Criticité ${label.toLocaleLowerCase('fr')}`} selected={draft.criticality === value} secondary={draft.criticality !== value} disabled={work.busy} onPress={() => setDraft({ ...draft, criticality: value as Equipment['criticality'] })} />)}</View>
      <Copy>État</Copy>
      <View style={chips}>{Object.entries(equipmentStatuses).map(([value, label]) => <Action key={value} label={label} selected={draft.status === value} secondary={draft.status !== value} disabled={work.busy} onPress={() => setDraft({ ...draft, status: value as Equipment['status'] })} />)}</View>
      <Field label="Emplacement (facultatif)" value={draft.location} maxLength={160} editable={!work.busy} onChangeText={location => setDraft({ ...draft, location })} />
      <Field label="Référence (facultatif)" value={draft.reference} maxLength={160} editable={!work.busy} onChangeText={reference => setDraft({ ...draft, reference })} />
      <Field label="Notes sur l’équipement (facultatif)" value={draft.notes} maxLength={4000} multiline editable={!work.busy} onChangeText={notes => setDraft({ ...draft, notes })} />
      {work.error && <Copy kind="error">{work.error}</Copy>}
      <Action label={work.busy ? 'Enregistrement…' : 'Enregistrer l’équipement'} disabled={work.busy} onPress={save} />
      <Action secondary label="Annuler la saisie de l’équipement" disabled={work.busy} onPress={() => { setDraft(null); work.setError(null); }} />
    </>}
  </>;
}
const assetLinks = z.object({
  records: z.array(z.object({ id: z.uuid(), intervention_id: z.uuid(), active: z.boolean(), intervention: z.object({ id: z.uuid(), category: z.string(), status: z.string(), created_at: z.string() }) })),
  page: z.object({ has_more: z.boolean() }),
});
function EquipmentLinks({ siteId, assetId, token, open }: { siteId: string; assetId: string; token: string; open: (id: string) => void }) {
  const state = useResource(`/api/sites/${siteId}/asset-links?kind=equipment&asset_id=${assetId}`, assetLinks, token);
  return <>
    <ReadState loading={state.loading} error={state.error} onRetry={state.reload} />
    {state.data?.records.length === 0 && <Copy kind="muted">Aucune intervention liée à cet équipement.</Copy>}
    {state.data?.records.map(row => <Action key={row.id} secondary
      label={`Dossier INT-${row.intervention.id.slice(0, 6).toUpperCase()} · ${categories[row.intervention.category as keyof typeof categories] ?? row.intervention.category} · ${statuses[row.intervention.status as keyof typeof statuses] ?? row.intervention.status}${row.active ? '' : ' · lien retiré'}`}
      onPress={() => open(row.intervention.id)} />)}
    {state.data?.page.has_more && <Copy kind="muted">Les 50 premiers liens sont affichés.</Copy>}
  </>;
}
