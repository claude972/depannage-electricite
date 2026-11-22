import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import * as Location from 'expo-location';
import { z } from 'zod';
import { Action, Card, Copy, Field, ReadState } from './ui';
import { ApiFailure, api, useResource } from '@/lib/api';

const tracking = z.object({
  permissions: z.object({ can_share: z.boolean(), can_confirm_destination: z.boolean() }),
  tracking: z.object({
    intervention_id: z.uuid(), artisan_id: z.uuid().nullable(), session_id: z.uuid().nullable(),
    travel_stage: z.enum(['planned','en_route','on_site']), shared: z.boolean(),
    control_version: z.number().int().nonnegative(), last_seq: z.number().int().nonnegative(),
    destination_version: z.number().int().nonnegative(), position_state: z.enum(['no_position','fresh','stale','stopped']),
    position: z.object({ sampled_at: z.iso.datetime({ offset:true }) }).nullable(),
    destination: z.object({ label: z.string() }).nullable(),
  }),
});
const route = z.object({
  state: z.literal('available'), source: z.literal('IGN Géoplateforme / BD TOPO'),
  duration_s: z.number().nonnegative(), session_id: z.uuid(), control_version: z.number().int(),
  destination_version: z.number().int(), point_seq: z.number().int(),
});
const geocodes = z.object({ candidates: z.array(z.object({
  latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), label: z.string().max(200),
})).max(20) });

type Snapshot = z.infer<typeof tracking>;
/** La boîte de permission met brièvement l’application en retrait : attendre son retour au premier plan. */
function appActive(timeout = 5000) {
  if (AppState.currentState === 'active') return Promise.resolve(true);
  return new Promise<boolean>(resolve => {
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') return;
      clearTimeout(timer); subscription.remove(); resolve(true);
    });
    const timer = setTimeout(() => { subscription.remove(); resolve(AppState.currentState === 'active'); }, timeout);
  });
}

export function MissionTracking({ id, actor, token, artisan, address }: {
  id: string; actor: string; token: string; artisan: boolean; address: string;
}) {
  const path = `/api/interventions/${id}/tracking`;
  const read = useResource(path, tracking, token, actor);
  const latestToken = useRef(token); latestToken.current = token;
  const [focused, setFocused] = useState(false);
  const focus = useRef(false);
  const [active, setActive] = useState(AppState.currentState === 'active');
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState(address), [places, setPlaces] = useState<z.infer<typeof geocodes>['candidates']>([]);
  const [owned, setOwned] = useState<string | null>(null);
  const current = useRef<Snapshot['tracking'] | null>(null);
  const lock = useRef(false), foreground = useRef(false);
  const [estimate, setEstimate] = useState<{ key: string; minutes: number } | null>(null);
  const reload = read.reload;
  const view = read.data?.tracking.intervention_id === id ? read.data : null;
  const point = view?.tracking;
  const routeKey = !artisan && point?.shared && point.position_state === 'fresh' && point.destination
    ? `${point.session_id}/${point.control_version}/${point.destination_version}/${point.last_seq}` : null;

  useFocusEffect(useCallback(() => { focus.current = true; foreground.current = AppState.currentState === 'active'; setFocused(true); reload(); return () => { focus.current = false; foreground.current = false; setFocused(false); }; }, [reload]));
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      // Permission dialogs briefly deactivate the app. Restore the guard immediately,
      // before the permission promise continues and before React effects are flushed.
      foreground.current = state === 'active' && focus.current;
      setActive(state === 'active');
    });
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    foreground.current = active && focused;
    return () => { foreground.current = false; };
  }, [active, focused]);
  useEffect(() => {
    if (!focused || !active) return;
    const timer = setInterval(reload, 15000);
    return () => clearInterval(timer);
  }, [focused, active, reload]);

  async function command(action: string, version: number, payload: object, signal?: AbortSignal) {
    const result = await api(path, tracking, { token: latestToken.current, method: 'POST', body: { action, expected_version: version, payload }, signal });
    if (result.tracking.intervention_id !== id) throw new Error('La réponse ne correspond pas à ce dossier.');
    return result.tracking;
  }
  function run(work: () => Promise<void>) {
    if (lock.current || !foreground.current) return;
    lock.current = true; setBusy(true); setError(null);
    void work().catch(issue => {
      setError(issue instanceof Error ? issue.message : 'Le suivi est indisponible.');
      reload();
    }).finally(() => { lock.current = false; setBusy(false); });
  }

  useEffect(() => {
    if (!owned || !focused || !active) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function sample() {
      const latest = current.current;
      if (!latest || latest.session_id !== owned || !foreground.current || controller.signal.aborted) return;
      try {
        const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High, mayShowUserSettingsDialog: false });
        const accuracy = location.coords.accuracy;
        if (!foreground.current || controller.signal.aborted || current.current?.session_id !== owned) return;
        if (accuracy != null && accuracy <= 250) {
          const updated = await command('point', latest.control_version, {
            session_id: owned, seq: latest.last_seq + 1, latitude: location.coords.latitude,
            longitude: location.coords.longitude, accuracy_m: Math.max(1, accuracy),
            sampled_at: new Date(location.timestamp).toISOString(),
          }, controller.signal);
          if (!controller.signal.aborted && foreground.current && current.current?.session_id === owned) current.current = updated;
        }
      } catch (issue) {
        if (controller.signal.aborted) return;
        setError(issue instanceof Error ? issue.message : 'Position indisponible.');
        if (issue instanceof ApiFailure && [401,403,404,409].includes(issue.status)) {
          setOwned(null); current.current = null; reload(); return;
        }
        if (issue instanceof ApiFailure && issue.status === 429) {
          timer = setTimeout(sample, 60000); return;
        }
        // Recover the authoritative sequence after an ambiguous network failure.
        try {
          const fresh = await api(path, tracking, { token: latestToken.current, signal: controller.signal });
          if (fresh.tracking.intervention_id !== id || fresh.tracking.session_id !== owned || !fresh.permissions.can_share) {
            setOwned(null); current.current = null; reload(); return;
          }
          if (!controller.signal.aborted && foreground.current && current.current?.session_id === owned) current.current = fresh.tracking;
        } catch { setOwned(null); current.current = null; reload(); return; }
      }
      if (!controller.signal.aborted) timer = setTimeout(sample, 8500);
    }
    void sample();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [owned, active, focused, path, reload]);

  useEffect(() => {
    if (focused && active) return;
    const latest = current.current;
    setOwned(null); current.current = null;
    if (latest?.session_id) void command('stop', latest.control_version, { session_id: latest.session_id }).catch(() => {});
  }, [focused, active]);
  useEffect(() => () => {
    const latest = current.current;
    current.current = null;
    if (latest?.session_id) void command('stop', latest.control_version, { session_id: latest.session_id }).catch(() => {});
  }, [id]);
  useEffect(() => {
    if (!routeKey || !focused || !active) return;
    const controller = new AbortController();
    void api(path + '/route', route, { token, method: 'POST', body: {}, signal: controller.signal }).then(result => {
      const key = `${result.session_id}/${result.control_version}/${result.destination_version}/${result.point_seq}`;
      if (!controller.signal.aborted && key === routeKey)
        setEstimate({ key, minutes: Math.max(1, Math.ceil(result.duration_s / 60)) });
    }, () => { if (!controller.signal.aborted) setEstimate(null); });
    return () => controller.abort();
  }, [routeKey, token, focused, active, path]);

  function start() {
    if (!point || !view?.permissions.can_share) return;
    run(async () => {
      if (!(await Location.requestForegroundPermissionsAsync()).granted)
        throw new Error('La permission de localisation est nécessaire pour partager le trajet.');
      if (!(await appActive()) || !focus.current) throw new Error('Revenez sur cet écran pour démarrer le partage.');
      foreground.current = true;
      const session = randomUUID();
      const started = await command('start', point.control_version, { session_id: session, consent: true, consent_policy: 'tracking-v1' });
      if (!foreground.current) {
        void command('stop', started.control_version, { session_id: session }).catch(() => {});
        return;
      }
      current.current = started; setOwned(session); reload();
    });
  }
  function stop(arrived: boolean) {
    if (!point?.session_id) return;
    const latest = current.current ?? point;
    setOwned(null); current.current = null;
    run(async () => { await command(arrived ? 'arrived' : 'stop', latest.control_version, { session_id: latest.session_id }); reload(); });
  }

  return <Card>
    <Copy kind="subtitle">{artisan ? 'Partage du trajet' : 'Arrivée de l’artisan'}</Copy>
    <ReadState loading={read.loading} error={read.error} onRetry={reload} />
    {error && <Copy kind="error">{error}</Copy>}
    {point && <>
      {!artisan && <Copy>{point.travel_stage === 'on_site' ? 'L’artisan est arrivé.' : estimate?.key === routeKey && routeKey
        ? `Environ ${estimate.minutes} min · itinéraire IGN, sans trafic en temps réel` : 'Estimation d’arrivée indisponible pour le moment.'}</Copy>}
      {point.destination && <Copy kind="muted">Destination confirmée · {point.destination.label}</Copy>}
      {artisan && view?.permissions.can_share && <>
        <Copy kind="muted">Le partage est volontaire, limité à ce trajet et cesse quand cet écran n’est plus actif.</Copy>
        {point.shared ? <>
          <Action secondary label="Arrêter le partage" disabled={busy} onPress={() => stop(false)} />
          <Action secondary label="Signaler mon arrivée" disabled={busy} onPress={() => stop(true)} />
        </> : <Action label="Partager ma position pendant le trajet" disabled={busy} onPress={start} />}
      </>}
      {view?.permissions.can_confirm_destination && !point.destination && !point.shared && <>
        <Field label="Adresse de destination à vérifier" value={query} onChangeText={value => { setQuery(value); setPlaces([]); }} maxLength={200} editable={!busy} />
        <Action secondary label="Rechercher cette adresse" disabled={busy || query.trim().length < 2} onPress={() => run(async () => {
          const result = await api(path + '/geocode', geocodes, { token: latestToken.current, method: 'POST', body: { query: query.trim() } });
          setPlaces(result.candidates);
          if (!result.candidates.length) setError('Aucune adresse trouvée.');
        })} />
        {places.map((place, index) => <Action key={index} secondary label={'Confirmer ' + place.label} disabled={busy} onPress={() => run(async () => {
          await command('destination', point.control_version, { ...place, source:'ign', candidate_label:place.label });
          setPlaces([]); reload();
        })} />)}
      </>}
    </>}
  </Card>;
}
