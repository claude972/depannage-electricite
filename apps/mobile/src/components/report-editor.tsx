import { createJpegUpload } from '@/lib/photo-upload';
import { useEffect, useRef, useState } from 'react';
import { Alert, Platform } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { photoRepresentation, prepareJpeg } from '@/lib/photo-preparation';
import { Action, Card, Copy, Field, ReadState } from './ui';
import { api } from '@/lib/api';
import { fileSaved, signature, success } from '@/lib/contracts';
import { discardTemporaryPhoto, openReportPhoto, releaseReportPhoto, stageReportPhoto } from '@/lib/draft-photos';
import { reportDraft, type PendingPhoto } from '@/lib/intervention-drafts';
import { launchWithTicket, takeInterruptedPick } from '@/lib/report-picker-ticket';
import { useDeviceDraft } from '@/lib/use-device-draft';

type Existing = { summary: string; signature_name: string; before_photo_id?: string | null; after_photo_id?: string | null };
type Side = 'before' | 'after';
const pendingField = { before: 'pendingBefore', after: 'pendingAfter' } as const;
const lostPick = 'La photo choisie avant l’interruption n’a pas pu être récupérée. Sélectionnez-la de nouveau.';

export function ReportEditor({ draftKey, token, id, report, required, onSaved }: {
  draftKey: string; token: string; id: string; report: Existing | null; required: boolean; onSaved: () => void;
}) {
  const draft = useDeviceDraft(draftKey, reportDraft, {
    summary: report?.summary ?? '', name: report?.signature_name ?? '',
    before: report?.before_photo_id ?? null, after: report?.after_photo_id ?? null,
    pendingBefore: null, pendingAfter: null, command: null,
  }, true);
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const lock = useRef(false);
  const currentToken = useRef(token);
  currentToken.current = token;
  const active = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    active.current = controller;
    return () => { controller.abort(); active.current = null; };
  }, [draftKey]);

  async function perform(work: (signal: AbortSignal) => Promise<void>) {
    const signal = active.current?.signal;
    if (lock.current || !signal || signal.aborted) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
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
    await draft.flush();
    if (signal.aborted) return;
    const temporary = await openReportPhoto(photo);
    try {
      if (signal.aborted) return;
      const data = await createJpegUpload(id, temporary, side === 'before' ? 'avant.jpg' : 'apres.jpg');
      const result = await api('/api/documents', fileSaved, { token: currentToken.current, method: 'POST', body: data, signal });
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
      // The marker (account + dossier + side) is persisted before the native picker opens.
      const launch = () => source === 'camera'
        ? ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 })
        : ImagePicker.launchImageLibraryAsync({ preferredAssetRepresentationMode: photoRepresentation, mediaTypes: ['images'], quality: 1, allowsMultipleSelection: false });
      const picked = await (Platform.OS === 'android' ? launchWithTicket(draftKey, side, signal, launch) : launch());
      if (!picked || picked.canceled) return;
      if (signal.aborted) return;
      const photo = await keep(side, picked.assets[0], signal);
      if (photo) await sendPhoto(side, photo, signal);
    });
  }

  async function keep(side: Side, asset: ImagePicker.ImagePickerAsset, signal: AbortSignal) {
    const actions = asset.width > 1600 ? [{ resize: { width: 1600 } }] : [];
    const image = await prepareJpeg(asset.uri, actions);
    let photo: PendingPhoto;
    try { photo = await stageReportPhoto(new File(image.uri)); }
    finally { if (image.uri !== asset.uri) discardTemporaryPhoto(new File(image.uri)); }
    if (signal.aborted) { releaseReportPhoto(photo); return null; }
    const previous = draft.value?.[pendingField[side]];
    await draft.update(current => ({ ...current, [pendingField[side]]: photo, command: null }));
    if (previous) releaseReportPhoto(previous);
    return photo;
  }

  // Android may destroy the activity while the picker is open. Once this editor is
  // mounted again (access confirmed) and its draft restored, take back the selection
  // only if the marker names this draftKey. It stays a manual upload: network and
  // access are not re-proven here.
  const restored = draft.value !== null;
  useEffect(() => {
    if (!restored || Platform.OS !== 'android') return;
    void perform(async signal => {
      const pick = await takeInterruptedPick(draftKey, signal).catch(() => { throw new Error(lostPick); });
      if (!pick?.result || signal.aborted) return;
      const { side, result } = pick;
      if ('code' in result) throw new Error(lostPick);
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset) return;
      if (await keep(side, asset, signal))
        setNotice(`Photo ${side === 'before' ? 'avant' : 'après'} récupérée après l’interruption. Vérifiez votre connexion puis reprenez son dépôt.`);
    });
  }, [draftKey, restored]);

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
        token: currentToken.current, method: 'POST', signal,
        body: { action: 'save_report', summary: summary.trim(), checks: [], signature_name: signer.data, before_photo_id: before, after_photo_id: after, command_id: command },
      });
      try { await draft.clear(); }
      finally { onSaved(); }
    });
  }

  if (!draft.value) return <Card>
    <ReadState loading={!draft.error} error={draft.error} onRetry={draft.retry} />
    {draft.canRecover && <Action secondary disabled={draft.pending} label="Préparer un nouveau brouillon" onPress={() => void draft.recover()} />}
  </Card>;
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
    {notice && <Copy kind="muted">{notice}</Copy>}
    {error && <Copy kind="error">{error}</Copy>}
    <Action disabled={busy} label={busy ? 'En cours…' : 'Enregistrer le compte rendu'} onPress={save} />
  </Card>;
}
