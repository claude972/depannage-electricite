import { useEffect, useRef, useState, type ComponentRef, type RefObject } from 'react';
import { Alert, TextInput } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { Action, Card, Copy, Field, ReadState, Screen } from './ui';
import { LabeledSwitch } from './labeled-switch';
import { api, ApiFailure, useResource } from '@/lib/api';
import {
  ADDRESS_LIMIT, ADDRESS_PATH, addressFormOf, addressList, addressSaved, addressValues, emptyAddressForm, orderedAddresses, preferredValues,
  type AddressField, type AddressForm, type ClientAddress,
} from '@/lib/client-addresses';

type Command = { action: 'save' | 'archive'; id: string; expected_version: number | null; values?: object };
type Editing = { id: string; current: ClientAddress | null; form: AddressForm };

/** Carnet d’adresses natif du client : liste, ajout, modification, préférence, suppression (archivage). */
export function AddressBook({ token, actor, firstName, lastName }: { token: string; actor: string; firstName: string; lastName: string }) {
  const state = useResource(ADDRESS_PATH, addressList, token, actor);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const request = useRef<AbortController | null>(null), replay = useRef<{ body: string; id: string } | null>(null);
  type Input = ComponentRef<typeof TextInput>;
  const refs: Record<AddressField, RefObject<Input | null>> = {
    label: useRef<Input>(null), first_name: useRef<Input>(null), last_name: useRef<Input>(null), address: useRef<Input>(null), postal_code: useRef<Input>(null), city: useRef<Input>(null),
  };
  useEffect(() => { setBusy(false); return () => { request.current?.abort(); request.current = null; }; }, [token]);
  const records = state.data ? orderedAddresses(state.data.records) : [], canWrite = Boolean(state.data?.permissions.can_write);
  const preferred = records.find(record => record.is_preferred);

  /** Une seule écriture à la fois ; une même commande rejouée garde son identifiant (rejeu exact côté serveur). */
  async function send(command: Command, done: string) {
    if (request.current || !canWrite) return false;
    const body = JSON.stringify(command);
    if (replay.current?.body !== body) replay.current = { body, id: randomUUID() };
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError(null); setNotice(null); setConflict(false);
    try {
      const result = await api(ADDRESS_PATH, addressSaved, { token, method: 'POST', signal: controller.signal, body: { ...command, command_id: replay.current.id } });
      if (controller.signal.aborted) return false;
      if (result.record.id !== command.id) throw new ApiFailure('L’enregistrement doit être vérifié. Rechargez les adresses avant de réessayer.', 503);
      replay.current = null; setNotice(done); state.reload();
      return true;
    } catch (issue) {
      if (controller.signal.aborted) return false;
      const status = issue instanceof ApiFailure ? issue.status : 0;
      // 409 : version dépassée ou autre adresse déjà préférée. La saisie est conservée, la liste doit être relue.
      if (status === 409) { setConflict(true); replay.current = null; }
      if (status === 422 || status === 400) replay.current = null;
      // Le serveur parle de « page » : dans l’application, le geste utile est le rechargement des adresses.
      setError(status === 409 ? 'Cette adresse a été modifiée depuis son affichage, ou une autre adresse est déjà préférée. Votre saisie est conservée : rechargez vos adresses, puis reprenez la modification.' : issue instanceof Error ? issue.message : 'Enregistrement indisponible.');
      return false;
    } finally { if (request.current === controller) { request.current = null; setBusy(false); } }
  }
  function begin(record: ClientAddress | null) {
    if (busy || !canWrite) return;
    setError(null); setNotice(null); setConflict(false); replay.current = null;
    setEditing(record ? { id: record.id, current: record, form: addressFormOf(record) } : { id: randomUUID(), current: null, form: emptyAddressForm(firstName, lastName) });
  }
  function cancel() { if (busy) return; setEditing(null); setError(null); setConflict(false); replay.current = null; }
  async function save() {
    if (!editing || busy) return;
    const result = addressValues(editing.form, editing.current);
    if ('field' in result) { setError(result.message); setConflict(false); refs[result.field].current?.focus(); return; }
    if (result.values.is_preferred && preferred && preferred.id !== editing.id) {
      setError(`« ${preferred.label} » est votre adresse préférée : retirez d’abord sa préférence pour en choisir une autre.`); setConflict(false); return;
    }
    const created = editing.current === null;
    if (await send({ action: 'save', id: editing.id, expected_version: editing.current?.version ?? null, values: result.values }, created ? 'Adresse enregistrée.' : 'Adresse mise à jour.'))
      setEditing(null);
  }
  /** Après un conflit : relit la liste et reprend la saisie sur la version actuelle de l’adresse. */
  function reloadAfterConflict() {
    if (busy) return;
    setError(null); setConflict(false); replay.current = null; setEditing(null); state.reload();
  }
  function prefer(record: ClientAddress, value: boolean) {
    if (value && preferred && preferred.id !== record.id) {
      setNotice(null); setError(`« ${preferred.label} » est votre adresse préférée : retirez d’abord sa préférence pour en choisir une autre.`); return;
    }
    void send({ action: 'save', id: record.id, expected_version: record.version, values: preferredValues(record, value) }, value ? 'Adresse préférée enregistrée.' : 'Préférence retirée.');
  }
  function remove(record: ClientAddress) {
    Alert.alert('Supprimer cette adresse ?', `« ${record.label} » sera retirée de votre carnet. Vos demandes déjà déposées ne sont pas modifiées.`, [
      { text: 'Conserver', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: () => void send({ action: 'archive', id: record.id, expected_version: record.version }, 'Adresse supprimée.') },
    ]);
  }
  const set = (patch: Partial<AddressForm>) => setEditing(value => value && { ...value, form: { ...value.form, ...patch } });

  if (editing) return <Screen>
    <Copy kind="title">{editing.current ? 'Modifier l’adresse' : 'Nouvelle adresse'}</Copy>
    <Card>
      <Field inputRef={refs.label} label="Nom de l’adresse" placeholder="Domicile, bureau…" value={editing.form.label} maxLength={100} editable={!busy} returnKeyType="next"
        submitBehavior="submit" onSubmitEditing={() => refs.first_name.current?.focus()} onChangeText={label => set({ label })} />
      <Field inputRef={refs.first_name} label="Prénom du contact" value={editing.form.first_name} maxLength={100} editable={!busy} returnKeyType="next"
        submitBehavior="submit" onSubmitEditing={() => refs.last_name.current?.focus()} onChangeText={first_name => set({ first_name })} />
      <Field inputRef={refs.last_name} label="Nom du contact" value={editing.form.last_name} maxLength={100} editable={!busy} returnKeyType="next"
        submitBehavior="submit" onSubmitEditing={() => refs.address.current?.focus()} onChangeText={last_name => set({ last_name })} />
      <Field inputRef={refs.address} label="Adresse (numéro et voie)" value={editing.form.address} maxLength={500} editable={!busy} returnKeyType="next"
        submitBehavior="submit" onSubmitEditing={() => refs.postal_code.current?.focus()} onChangeText={address => set({ address })} />
      <Field inputRef={refs.postal_code} label="Code postal" value={editing.form.postal_code} keyboardType="number-pad" inputMode="numeric" maxLength={5} editable={!busy}
        onChangeText={value => set({ postal_code: value.replace(/\D/g, '').slice(0, 5) })} />
      <Field inputRef={refs.city} label="Ville" value={editing.form.city} maxLength={160} editable={!busy} returnKeyType="done" onChangeText={city => set({ city })} />
      <LabeledSwitch label="Adresse préférée" value={editing.form.is_preferred} disabled={busy} onValueChange={is_preferred => set({ is_preferred })} />
      {editing.current?.geo_source && <Copy kind="muted">La position déclarée de cette adresse est conservée tant que la voie, le code postal et la ville ne changent pas.</Copy>}
      {error && <Copy kind="error">{error}</Copy>}
      <Action label={busy ? 'Enregistrement…' : 'Enregistrer l’adresse'} disabled={busy} onPress={() => void save()} />
      {conflict && <Action secondary label="Recharger mes adresses" disabled={busy} onPress={reloadAfterConflict} />}
      <Action secondary label="Annuler" disabled={busy} onPress={cancel} />
    </Card>
  </Screen>;

  return <Screen onRefresh={state.reload}>
    <Copy kind="title">Adresses enregistrées</Copy>
    <Copy kind="muted">Vos lieux d’intervention habituels. Ils sont visibles de vous seul tant qu’aucune demande ne les utilise.</Copy>
    <ReadState loading={state.loading} error={state.error} onRetry={state.reload} />
    {notice && <Copy>{notice}</Copy>}
    {error && <Card><Copy kind="error">{error}</Copy><Action secondary label="Recharger mes adresses" disabled={busy} onPress={reloadAfterConflict} /></Card>}
    {state.data && <>
      <Copy kind="label">{records.length} adresse(s) enregistrée(s) sur {ADDRESS_LIMIT} possibles</Copy>
      {!canWrite && <Copy kind="muted">Lecture seule : vos adresses sont affichées, sans modification possible pour le moment.</Copy>}
      {records.length === 0 && <Card><Copy>Aucune adresse enregistrée. Ajoutez celle de votre logement ou d’un autre lieu d’intervention.</Copy></Card>}
      {canWrite && records.length < ADDRESS_LIMIT && <Action label="Ajouter une adresse" disabled={busy} onPress={() => begin(null)} />}
      {records.map(record => <Card key={record.id}>
        {record.is_preferred && <Copy kind="label">Adresse préférée</Copy>}
        <Copy kind="subtitle">{record.label}</Copy>
        <Copy>{record.first_name} {record.last_name}</Copy>
        <Copy selectable>{record.address}, {record.postal_code} {record.city}</Copy>
        {record.geo_source && <Copy kind="muted">Position déclarée par vous, non vérifiée.</Copy>}
        {canWrite && <>
          <Action secondary label={`Modifier ${record.label}`} disabled={busy} onPress={() => begin(record)} />
          <Action secondary label={record.is_preferred ? `Retirer la préférence de ${record.label}` : `Définir ${record.label} comme adresse préférée`} disabled={busy}
            onPress={() => prefer(record, !record.is_preferred)} />
          <Action secondary label={`Supprimer ${record.label}`} disabled={busy} onPress={() => remove(record)} />
        </>}
      </Card>)}
    </>}
  </Screen>;
}
