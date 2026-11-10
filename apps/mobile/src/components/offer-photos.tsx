import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Platform } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { File } from 'expo-file-system';
import { z } from 'zod';
import { Action, Card, Copy, ReadState } from './ui';
import { api, useResource } from '@/lib/api';
import { apiOrigin } from '@/lib/config';
import { fileSaved } from '@/lib/contracts';
import { discardTemporaryPhoto } from '@/lib/draft-photos';

const list = z.object({ items: z.array(z.object({ id: z.uuid() })).max(6) });
const receipt = z.object({ shared: z.boolean() });

function usePhotos(id: string, token: string) {
  const path = `/api/interventions/${id}/offer-photos`;
  const state = useResource(path, list, token);
  const reload = state.reload;
  useFocusEffect(useCallback(() => { reload(); }, [reload]));
  return { path, ...state };
}

function OfferPhoto({ uri, token, index }: { uri: string; token: string; index: number }) {
  const [error, setError] = useState(false), [retry, setRetry] = useState(0);
  return error ? <>
    <Copy kind="muted">Cette photo est momentanément indisponible.</Copy>
    <Action secondary label="Recharger la photo" onPress={() => { setError(false); setRetry(value => value + 1); }} />
  </> : <Image key={retry} cachePolicy="none" source={{ uri, headers: { Authorization: 'Bearer ' + token } }}
    style={{ width:'100%', height:190, borderRadius:12 }} contentFit="contain"
    accessible accessibilityLabel={'Photo partagée par le client ' + index} onError={() => setError(true)} />;
}

export function OfferPhotoGallery({ id, token }: { id: string; token: string }) {
  const state = usePhotos(id, token);
  const [focused, setFocused] = useState(false);
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));
  return <Card>
    <Copy kind="subtitle">Photos choisies par le client</Copy>
    <ReadState loading={state.loading} error={state.error} onRetry={state.reload} />
    {state.data?.items.length === 0 && <Copy kind="muted">Aucune photo partagée pour cette offre.</Copy>}
    {apiOrigin && focused && state.data?.items.map(({ id: photo }, index) => <OfferPhoto key={photo}
      uri={apiOrigin + state.path + '?photo=' + photo} token={token} index={index + 1} />)}
  </Card>;
}

export function OfferPhotoConsent({ id, token, documents, onUploaded }: {
  id: string; token: string; documents: { id: string; name: string; mime_type: string }[]; onUploaded: () => void;
}) {
  const state = usePhotos(id, token);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const work = useRef<AbortController | null>(null);
  useEffect(() => () => work.current?.abort(), [id, token]);
  const photos = documents.filter(doc => ['image/jpeg','image/png','image/webp'].includes(doc.mime_type));

  async function run(action: (signal: AbortSignal) => Promise<void>) {
    if (work.current) return;
    const controller = new AbortController();
    work.current = controller; setBusy(true); setError(null);
    try { await action(controller.signal); }
    catch (issue) {
      if (!controller.signal.aborted) {
        setError(issue instanceof Error ? issue.message : 'Les photos doivent être vérifiées.');
        state.reload();
      }
    } finally { work.current = null; setBusy(false); }
  }
  function upload() {
    void run(async signal => {
      const selected = await ImagePicker.launchImageLibraryAsync({ mediaTypes:['images'], quality:1, allowsMultipleSelection:false });
      const asset = selected.assets?.[0];
      if (!asset || signal.aborted) return;
      const image = await ImageManipulator.manipulateAsync(asset.uri, asset.width > 1600 ? [{resize:{width:1600}}] : [],
        { compress:.74, format:ImageManipulator.SaveFormat.JPEG });
      try {
        if (signal.aborted) return;
        const body = new FormData();
        body.append('intervention_id', id);
        if (Platform.OS === 'web') body.append('file', await (await fetch(image.uri, { signal })).blob(), 'photo-demande.jpg');
        else body.append('file', { uri:image.uri, name:'photo-demande.jpg', type:'image/jpeg' } as unknown as Blob);
        await api('/api/documents', fileSaved, { token, method:'POST', body, signal });
        onUploaded();
      } finally {
        if (Platform.OS !== 'web' && image.uri !== asset.uri) discardTemporaryPhoto(new File(image.uri));
      }
    });
  }
  function setShare(document: string, shared: boolean) {
    const execute = () => void run(async signal => {
      const result = await api(state.path, receipt, { token, method:'POST', body:{ document_id:document, shared }, signal });
      if (result.shared !== shared) throw new Error('Le choix n’a pas pu être vérifié.');
      state.reload();
    });
    if (!shared) { execute(); return; }
    Alert.alert('Partager cette photo ?', 'Les artisans éligibles à l’offre verront la photo avant attribution. Choisissez uniquement une image sans personne, adresse ou document identifiable.',
      [{ text:'Annuler', style:'cancel' }, { text:'Partager', onPress:execute }]);
  }
  return <Card>
    <Copy kind="subtitle">Photos de la demande</Copy>
    <Copy kind="muted">Vous choisissez les photos visibles par les artisans qui peuvent accepter l’offre.</Copy>
    <Action secondary disabled={busy} label="Ajouter une photo privée" onPress={upload} />
    <ReadState loading={state.loading} error={state.error} onRetry={state.reload} />
    {error && <Copy kind="error">{error}</Copy>}
    {state.data && photos.map(doc => {
      const shared = state.data!.items.some(item => item.id === doc.id);
      return <Action key={doc.id} disabled={busy} secondary
        label={(shared ? 'Retirer de l’offre · ' : 'Partager avec les artisans · ') + doc.name}
        onPress={() => setShare(doc.id, !shared)} />;
    })}
  </Card>;
}
