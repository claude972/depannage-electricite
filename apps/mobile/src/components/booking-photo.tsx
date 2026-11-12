import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { File } from 'expo-file-system';
import { REQUEST_PHOTO_LABEL } from '../../../../shared/request-details';
import { Action, Card, Copy } from './ui';
import { api } from '@/lib/api';
import { detail, fileSaved } from '@/lib/contracts';
import { discardTemporaryPhoto, openReportPhoto, releaseReportPhoto, stageReportPhoto } from '@/lib/draft-photos';
import type { PendingPhoto } from '@/lib/intervention-drafts';

export function BookingPhotoPicker({ photo, onChange, onPicking }: {
  photo?: PendingPhoto;
  onChange(photo: PendingPhoto | undefined): void;
  onPicking(picking: boolean): void;
}) {
  const picking = useRef(false);
  const alive = useRef(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  async function choose() {
    if (picking.current) return;
    picking.current = true;
    setBusy(true); setError(''); onPicking(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: false, quality: 1 });
      const asset = result.assets?.[0];
      if (!asset || !alive.current) return;
      const size = Math.max(asset.width, asset.height);
      const resize = size > 1600 ? [{ resize: asset.width >= asset.height ? { width: 1600 } : { height: 1600 } }] : [];
      const image = await ImageManipulator.manipulateAsync(asset.uri, resize, { compress: .74, format: ImageManipulator.SaveFormat.JPEG });
      const file = new File(image.uri);
      try {
        const staged = await stageReportPhoto(file);
        if (!alive.current) { releaseReportPhoto(staged); return; }
        onChange(staged);
        if (photo) releaseReportPhoto(photo);
      } finally { if (image.uri !== asset.uri) discardTemporaryPhoto(file); }
    } catch { if (alive.current) setError('Cette photo n’a pas pu être ajoutée. Réessayez ou continuez sans photo.'); }
    finally {
      picking.current = false;
      onPicking(false);
      if (alive.current) setBusy(false);
    }
  }

  return <>
    <Action secondary label={busy ? 'Préparation de la photo…' : photo ? 'Remplacer la photo (facultatif)' : REQUEST_PHOTO_LABEL} disabled={busy} onPress={() => void choose()} />
    {photo && <>
      <Copy kind="muted">Photo sélectionnée. Elle sera ajoutée au dossier après confirmation.</Copy>
      <Action secondary label="Retirer la photo" disabled={busy} onPress={() => { onChange(undefined); releaseReportPhoto(photo); setError(''); }} />
    </>}
    {error ? <Copy kind="error">{error}</Copy> : null}
  </>;
}

export function BookingPhotoReceipt({ id, token, photo, onSent }: {
  id: string;
  token: string;
  photo: PendingPhoto;
  onSent(): Promise<void>;
}) {
  const latest = useRef({ token, onSent });
  latest.current = { token, onSent };
  const upload = useRef<AbortController | null>(null);
  const [state, setState] = useState<'sending' | 'error'>('sending');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    upload.current = controller;
    async function send() {
      const name = `photo-demande-${photo.fileId}.jpg`;
      const options = { token: latest.current.token, signal };
      // A previous process may have sent the photo before clearing the receipt.
      const { documents } = await api(`/api/interventions/${id}`, detail, options);
      if (documents.status !== 'ok') throw new Error('Photo à vérifier dans le dossier.');
      if (documents.items.some(file => file.name === name)) {
        if (!signal.aborted) { await latest.current.onSent(); releaseReportPhoto(photo); }
        return;
      }
      if (documents.limited) throw new Error('Photo à vérifier dans le dossier.');
      if (signal.aborted) return;
      const file = await openReportPhoto(photo);
      try {
        if (signal.aborted) return;
        const body = new FormData();
        body.append('intervention_id', id);
        if (Platform.OS === 'web') body.append('file', await (await fetch(file.uri, { signal })).blob(), name);
        else body.append('file', { uri: file.uri, name, type: 'image/jpeg' } as unknown as Blob);
        await api('/api/documents', fileSaved, { ...options, method: 'POST', body });
        if (!signal.aborted) { await latest.current.onSent(); releaseReportPhoto(photo); }
      } finally { discardTemporaryPhoto(file); }
    }
    void send().catch(() => { if (!signal.aborted) setState('error'); });
    return () => controller.abort();
  }, [id, photo, attempt]);

  return <Card>
    {state === 'sending' ? <Copy kind="muted">Ajout de la photo à votre dossier…</Copy> : <>
      <Copy kind="error">Votre demande est transmise. L’ajout de la photo reste à vérifier.</Copy>
      <Action secondary label="Réessayer l’ajout de la photo" onPress={() => {
        if (state !== 'error') return;
        upload.current?.abort(); setState('sending'); setAttempt(value => value + 1);
      }} />
      <Action secondary label="Continuer sans la photo" onPress={() => {
        void latest.current.onSent().then(() => releaseReportPhoto(photo)).catch(() => {});
      }} />
    </>}
  </Card>;
}
