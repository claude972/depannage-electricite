import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { z } from 'zod';
import { Action, Card, Copy, ReadState } from './ui';
import { LabeledSwitch } from './labeled-switch';
import { api, useResource } from '@/lib/api';
import { useSession } from '@/lib/session';

const artisan = z.object({ artisan_profile: z.object({ available: z.boolean(), capacity_limit: z.union([z.literal(3), z.literal(4)]).nullable(), capacity_version: z.number().int().nonnegative() }).nullable() });
export function ArtisanAvailability({ approved, capacity = false, onChanged }: { approved: boolean; capacity?: boolean; onChanged?: () => void }) {
  const session = useSession().session;
  return session ? <Availability key={session.user.id} token={session.access_token} actor={session.user.id} approved={approved} capacity={capacity} onChanged={onChanged} /> : null;
}
function Availability({ token, actor, approved, capacity, onChanged }: { token: string; actor: string; approved: boolean; capacity: boolean; onChanged?: () => void }) {
  const dossier = useResource('/api/artisan', artisan, token, actor);
  const request = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const reload = dossier.reload;
  useFocusEffect(useCallback(() => { reload(); }, [reload]));
  useEffect(() => { setBusy(false); setError(null); return () => { request.current?.abort(); request.current = null; }; }, [token, actor]);
  async function change(body: { action: string; available?: boolean; capacity_limit?: number; expected_version?: number }) {
    if (request.current || (body.action === 'set_availability' && !approved)) return;
    const controller = new AbortController(); request.current = controller; setBusy(true); setError(null);
    try {
      await api('/api/artisan', artisan, { token, method: 'POST', body, signal: controller.signal });
      if (!controller.signal.aborted) { reload(); onChanged?.(); }
    } catch (issue) {
      if (!controller.signal.aborted) { setError(issue instanceof Error ? issue.message : 'La disponibilité n’a pas pu être mise à jour. Réessayez.'); reload(); }
    } finally { if (request.current === controller) { request.current = null; setBusy(false); } }
  }
  const current = dossier.data?.artisan_profile;
  return <Card>
    <Copy kind="subtitle">Disponibilité</Copy>
    <ReadState loading={dossier.loading} error={dossier.error ?? error} onRetry={() => { setError(null); reload(); }} />
    {dossier.data && current === null && <Copy kind="muted">Complétez votre candidature sur le portail Web pour gérer votre disponibilité.</Copy>}
    {current && <>
      <LabeledSwitch iosHeight={72} label="Disponible pour de nouvelles missions" value={current.available} disabled={busy || !approved} onValueChange={available => void change({ action: 'set_availability', available })} />
      <Copy kind="muted">{busy ? 'Mise à jour…' : !approved ? 'Votre candidature doit être approuvée pour recevoir des offres.' : current.available ? 'Vous recevez des offres.' : 'Vous êtes indisponible. Activez votre disponibilité pour recevoir des offres.'}</Copy>
      {capacity && <>
        <Copy>Maximum actuel de missions actives : {current.capacity_limit ?? 3}</Copy>
        {([3,4] as const).map(limit => <Action key={limit} selected={(current.capacity_limit ?? 3) === limit} secondary={(current.capacity_limit ?? 3) !== limit} disabled={busy || (current.capacity_limit ?? 3) === limit} label={`Limiter à ${limit} missions`} onPress={() => void change({ action: 'set_capacity_limit', capacity_limit: limit, expected_version: current.capacity_version })} />)}
      </>}
    </>}
  </Card>;
}
