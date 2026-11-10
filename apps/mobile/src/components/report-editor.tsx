import { useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { Action, Card, Copy, Field, ReadState } from './ui';
import { api } from '@/lib/api';
import { fileSaved, signature, success } from '@/lib/contracts';
import { discardTemporaryPhoto, openReportPhoto, releaseReportPhoto, stageReportPhoto } from '@/lib/draft-photos';
import { reportDraft, type PendingPhoto } from '@/lib/intervention-drafts';
import { useDeviceDraft } from '@/lib/use-device-draft';

type Existing = { summary: string; signature_name: string; before_photo_id?: string | null; after_photo_id?: string | null };
type Side = 'before' | 'after';
const pendingField = { before: 'pendingBefore', after: 'pendingAfter' } as const;

export function ReportEditor({ draftKey, token, id, report, required, onSaved }: {
  draftKey: string; token: string; id: string; report: Existing | null; required: boolean; onSaved: () => void;
}) {
  const draft = useDeviceDraft(draftKey, reportDraft, {
    summary: report?.summary ?? '', name: report?.signature_name ?? '',
    before: report?.before_photo_id ?? null, after: report?.after_photo_id ?? null,
    pendingBefore: null, pendingAfter: null, command: null,
  });
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const active = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    active.current = controller;
    return () => { controller.abort(); active.current = null; };
  }, [token]);

  async function perform(work: (signal: AbortSignal) => Promise<void>) {
    const signal = active.current?.signal;
    if (lock.current || !signal || signal.aborted) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try { await work(signal); }
    catch (issue) {
      if (!signal.aborted) setError(issue instanceof Error ? issue.message : 'Enregistrement indisponible.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function sendPhoto(side: Side, photo: PendingPhoto, signal: AbortSignal) {
    if (signal.aborted) return;
    const temporary = await openReportPhoto(photo);
    try {
      if (signal.aborted) return;
      const data = new FormData();
      data.append('intervention_id', id);
      data.append('file', { uri: temporary.uri, name: side === 'before' ? 'avant.jpg' : 'apres.jpg', type: 'image/jpeg' } as unknown as Blob);
      const result = await api('/api/documents', fileSaved, { token, method: 'POST', body: data, signal });
      await draft.update(current => ({ ...current, [side]: result.document.id, [pendingField[side]]: null, command: null }));
      releaseReportPhoto(photo);
    } finally {
      discardTemporaryPhoto(temporary);
    }
  }

  function upload(side: Side, source: 'camera' | 'library') {
    void perform(async signal => {
      if (source === 'camera' && !(await ImagePicker.requestCameraPermissionsAsync()).granted)
        throw Error('Accès à l’appareil photo refusé.');
      if (signal.aborted) return;
      const picked = source === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1, allowsMultipleSelection: false });
      if (picked.canceled) return;
      const asset = picked.assets[0];
      const actions = asset.width > 1600 ? [{ resize: { width: 1600 } }] : [];
      const image = await ImageManipulator.manipulateAsync(asset.uri, actions, { compress: .74, format: ImageManipulator.SaveFormat.JPEG });
      let photo: PendingPhoto;
      try { photo = await stageReportPhoto(new File(image.uri)); }
      finally { if (image.uri !== asset.uri) discardTemporaryPhoto(new File(image.uri)); }
      const previous = draft.value?.[pendingField[side]];
      await draft.update(current => ({ ...current, [pendingField[side]]: photo, command: null }));
      if (previous) releaseReportPhoto(previous);
      await sendPhoto(side, photo, signal);
    });
  }

  function choose(side: Side) {
    Alert.alert(side === 'before' ? 'Photo avant intervention' : 'Photo après intervention', 'Choisissez une source.', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Photothèque', onPress: () => upload(side, 'library') },
      { text: 'Appareil photo', onPress: () => upload(side, 'camera') },
    ]);
  }

  function save() {
    const value = draft.value;
    if (!value || lock.current) return;
    const { summary, name, before, after, pendingBefore, pendingAfter } = value;
    const signer = signature.safeParse(name);
    if (summary.trim().length < 10 || !signer.success) { setError('Ajoutez un compte rendu détaillé et votre nom.'); return; }
    if (pendingBefore || pendingAfter) { setError('Terminez le dépôt des photos avant d’enregistrer.'); return; }
    if ((required || before || after) && (!before || !after || before === after)) { setError('Ajoutez deux photos distinctes avant et après l’intervention.'); return; }

    void perform(async signal => {
      const command = value.command ?? randomUUID();
      await draft.update(current => ({ ...current, command }));
      if (signal.aborted) return;
      await api(`/api/interventions/${id}/operations`, success, {
        token, method: 'POST', signal,
        body: { action: 'save_report', summary: summary.trim(), checks: [], signature_name: signer.data, before_photo_id: before, after_photo_id: after, command_id: command },
      });
      try { await draft.clear(); }
      finally { onSaved(); }
    });
  }

  if (!draft.value) return <ReadState loading={!draft.error} error={draft.error} onRetry={draft.retry} />;
  const { before, after, pendingBefore, pendingAfter, summary, name } = draft.value;
  const edit = (field: 'summary' | 'name', value: string) => draft.edit(current => ({ ...current, [field]: value, command: null }));
  return <Card>
    <Copy kind="subtitle">Compte rendu terrain</Copy>
    <Copy kind="muted">{required ? 'Les photos avant et après sont requises pour clôturer.' : 'Vous pouvez joindre des photos avant et après.'}</Copy>
    <Action secondary disabled={busy} label={before || pendingBefore ? 'Remplacer la photo avant' : 'Ajouter la photo avant'} onPress={() => choose('before')} />
    {pendingBefore && <Action secondary disabled={busy} label="Reprendre le dépôt de la photo avant" onPress={() => void perform(signal => sendPhoto('before', pendingBefore, signal))} />}
    <Action secondary disabled={busy} label={after || pendingAfter ? 'Remplacer la photo après' : 'Ajouter la photo après'} onPress={() => choose('after')} />
    {pendingAfter && <Action secondary disabled={busy} label="Reprendre le dépôt de la photo après" onPress={() => void perform(signal => sendPhoto('after', pendingAfter, signal))} />}
    <Field label="Travaux réalisés" multiline maxLength={8000} value={summary} onChangeText={value => edit('summary', value)} editable={!busy} />
    <Field label="Votre nom" value={name} onChangeText={value => edit('name', value)} maxLength={120} editable={!busy} />
    {draft.pending && <Copy kind="muted">Enregistrement du brouillon…</Copy>}
    {draft.error && <ReadState loading={false} error={draft.error} onRetry={draft.retry} />}
    {error && <Copy kind="error">{error}</Copy>}
    <Action disabled={busy} label={busy ? 'En cours…' : 'Enregistrer le compte rendu'} onPress={save} />
  </Card>;
}
