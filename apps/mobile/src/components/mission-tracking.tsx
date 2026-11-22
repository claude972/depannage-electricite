import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform, StyleSheet, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import * as Location from 'expo-location';
import { z } from 'zod';
import { Action, Card, Copy, Field, ReadState, usePalette } from './ui';
import TrackingMap from './tracking-map-dom';
import { timestamp } from '@/lib/contracts';
import { ApiFailure, api, useResource } from '@/lib/api';

const coordinates = { latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) };
const tracking = z.object({
  server_time: z.iso.datetime({ offset:true }).optional(),
  permissions: z.object({ can_share: z.boolean(), can_confirm_destination: z.boolean() }),
  tracking: z.object({
    intervention_id: z.uuid(), artisan_id: z.uuid().nullable(), session_id: z.uuid().nullable(),
    travel_stage: z.enum(['planned','en_route','on_site']), shared: z.boolean(),
    control_version: z.number().int().nonnegative(), last_seq: z.number().int().nonnegative(),
    destination_version: z.number().int().nonnegative(), position_state: z.enum(['no_position','fresh','stale','stopped']),
    consent_at: z.string().nullish(),
    position: z.object({ ...coordinates, accuracy_m: z.number().positive().optional(), sampled_at: z.iso.datetime({ offset:true }) }).nullable(),
    destination: z.object({ ...coordinates, label: z.string(), source: z.enum(['manual','ign']).optional() }).nullable(),
  }),
});
const route = z.object({
  state: z.literal('available'), source: z.literal('IGN Géoplateforme / BD TOPO'),
  duration_s: z.number().nonnegative(), session_id: z.uuid(), control_version: z.number().int(),
  destination_version: z.number().int(), point_seq: z.number().int(),
  distance_m: z.number().nonnegative().optional(),
  geometry: z.object({ coordinates: z.array(z.tuple([z.number(), z.number()])).max(20000) }).optional().catch(undefined),
});
/** Au-delà d’une minute (règle du Web), une position n’est plus affichée : seule son heure reste indiquée. */
const FRESH_SECONDS = 60;
const MAP_READY_DELAY = 8000;
const MAP_HEIGHT = 300;
const age = (seconds: number) => seconds < 60 ? `il y a ${seconds} s` : seconds < 3600 ? `il y a ${Math.round(seconds / 60)} min` : `il y a ${Math.round(seconds / 3600)} h`;
const distance = (meters: number) => meters < 1000 ? `${Math.round(meters / 10) * 10} m` : `${(meters / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} km`;
// Même repli que la carte d’adresse : sur iOS dans Expo Go, l’objet injecté n’atteint pas toujours la page.
const hostFallback = `(function(){try{var w=window,b=w.ReactNativeWebView=w.ReactNativeWebView||{};if(typeof b.injectedObjectJson!=='function'){b.injectedObjectJson=function(){return ${JSON.stringify(JSON.stringify({ EXPO_DOM_HOST_OS: Platform.OS, initialProps: { names: ['ready'], props: { position: null, accuracy: null, destination: null, line: null } } }))};};}}catch(e){}})();true;`;
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
  // Incident du dernier relevé seulement : effacé dès qu’un relevé suivant aboutit.
  const [sampleIssue, setSampleIssue] = useState<string | null>(null);
  const [query, setQuery] = useState(address), [places, setPlaces] = useState<z.infer<typeof geocodes>['candidates']>([]);
  const [owned, setOwned] = useState<string | null>(null);
  const current = useRef<Snapshot['tracking'] | null>(null);
  const lock = useRef(false), foreground = useRef(false);
  const [estimate, setEstimate] = useState<{ key: string; minutes: number; meters?: number; line: [number, number][] | null } | null>(null);
  const [routeIssue, setRouteIssue] = useState<{ key: string; message: string } | null>(null);
  const palette = usePalette();
  // 'failed' : erreur de chargement ou aucun signal de la carte dans le délai. Un signal tardif la rétablit.
  const [map, setMap] = useState<'loading' | 'ready' | 'failed'>('loading');
  // Âge de la position : horloge du serveur à la lecture, puis temps écoulé sur l’appareil.
  const [now, setNow] = useState(Date.now());
  const clock = useRef({ snapshot: null as Snapshot | null, offset: 0 });
  const reload = read.reload;
  const view = read.data?.tracking.intervention_id === id ? read.data : null;
  const point = view?.tracking;
  if (view && clock.current.snapshot !== view) {
    const server = view.server_time ? Date.parse(view.server_time) : NaN;
    clock.current = { snapshot: view, offset: Number.isFinite(server) ? server - Date.now() : 0 };
  }
  const seconds = point?.position ? Math.max(0, Math.round((now + clock.current.offset - Date.parse(point.position.sampled_at)) / 1000)) : null;
  const fresh = Boolean(point?.shared && point.position_state === 'fresh' && point.position && seconds !== null && seconds <= FRESH_SECONDS);
  const shown = fresh ? point!.position! : null;
  const mapped = Boolean(shown || point?.destination);
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
  useEffect(() => {
    if (!focused || !active) return;
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, [focused, active]);
  useEffect(() => {
    if (!mapped) return;
    const timer = setTimeout(() => setMap(state => state === 'loading' ? 'failed' : state), MAP_READY_DELAY);
    return () => clearTimeout(timer);
  }, [mapped]);

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
      let location: Location.LocationObject;
      try {
        location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High, mayShowUserSettingsDialog: false });
      } catch {
        // Le message du système (CoreLocation, Play Services) est technique : rien n’a été envoyé, le prochain relevé réessaie.
        if (controller.signal.aborted) return;
        setSampleIssue('Position momentanément indisponible. Nouvelle tentative…');
        timer = setTimeout(sample, 8500);
        return;
      }
      try {
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
        if (!controller.signal.aborted) setSampleIssue(null);
      } catch (issue) {
        if (controller.signal.aborted) return;
        const message = issue instanceof ApiFailure ? issue.message : 'Position momentanément indisponible. Nouvelle tentative…';
        // Le partage s’arrête : ce message reste affiché, contrairement à un incident de relevé.
        const ended = () => { setError(issue instanceof ApiFailure ? issue.message : 'Le partage de position s’est interrompu. Relancez-le si nécessaire.'); setOwned(null); current.current = null; reload(); };
        if (issue instanceof ApiFailure && [401,403,404,409].includes(issue.status)) { ended(); return; }
        setSampleIssue(message);
        if (issue instanceof ApiFailure && issue.status === 429) {
          timer = setTimeout(sample, 60000); return;
        }
        // Recover the authoritative sequence after an ambiguous network failure.
        try {
          const fresh = await api(path, tracking, { token: latestToken.current, signal: controller.signal });
          if (fresh.tracking.intervention_id !== id || fresh.tracking.session_id !== owned || !fresh.permissions.can_share) { ended(); return; }
          if (!controller.signal.aborted && foreground.current && current.current?.session_id === owned) current.current = fresh.tracking;
        } catch { if (!controller.signal.aborted) ended(); return; }
      }
      if (!controller.signal.aborted) timer = setTimeout(sample, 8500);
    }
    void sample();
    return () => { controller.abort(); clearTimeout(timer); setSampleIssue(null); };
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
      if (!controller.signal.aborted && key === routeKey) {
        // GeoJSON [longitude, latitude] → repères de carte [latitude, longitude] ; rien n’est conservé au-delà de ce tracé.
        const line = result.geometry?.coordinates.map(([longitude, latitude]) => [latitude, longitude] as [number, number]) ?? null;
        setEstimate({ key, minutes: Math.max(1, Math.ceil(result.duration_s / 60)), meters: result.distance_m, line });
        setRouteIssue(null);
      }
    }, issue => {
      if (controller.signal.aborted) return;
      setEstimate(null);
      setRouteIssue({ key: routeKey, message: issue instanceof ApiFailure && issue.status ? issue.message : 'Le calcul d’itinéraire n’a pas répondu.' });
    });
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
    {(error ?? sampleIssue) && <Copy kind="error">{error ?? sampleIssue}</Copy>}
    {point && <>
      {!artisan && <Copy>{point.travel_stage === 'on_site' ? 'L’artisan a signalé son arrivée.' : estimate?.key === routeKey && routeKey && fresh
        ? `Arrivée estimée dans environ ${estimate.minutes} min${estimate.meters !== undefined ? ` (${distance(estimate.meters)})` : ''}`
        : 'Arrivée estimée : non disponible pour le moment.'}</Copy>}
      {!artisan && point.travel_stage !== 'on_site' && <Copy kind="muted">{estimate?.key === routeKey && routeKey && fresh
        ? 'Source : itinéraire IGN Géoplateforme / BD TOPO, sans trafic en temps réel. Estimation indicative, pas un horaire garanti.'
        : !point.destination ? (view?.permissions.can_confirm_destination ? 'La destination n’est pas encore confirmée : vérifiez l’adresse ci-dessous pour qu’un itinéraire puisse être calculé.' : 'La destination n’a pas encore été confirmée : aucun itinéraire ne peut être calculé.')
        : !fresh ? 'Aucune position récente : l’arrivée ne peut pas être estimée.'
        : routeIssue?.key === routeKey ? `Itinéraire indisponible : ${routeIssue.message}` : 'Calcul de l’itinéraire en cours…'}</Copy>}
      <Copy kind="label">{point.travel_stage === 'on_site' ? 'Sur place' : fresh ? 'Position partagée'
        : point.position_state === 'fresh' || point.position_state === 'stale' ? 'Position périmée'
        : point.position_state === 'stopped' ? (point.consent_at ? 'Partage de position arrêté' : 'Aucun partage de position en cours')
        : point.shared ? 'En attente d’une première position' : 'Aucune position partagée'}</Copy>
      {fresh && shown && seconds !== null && <Copy kind="muted">Relevée {age(seconds)}{shown.accuracy_m ? ` · précision ± ${Math.round(shown.accuracy_m)} m` : ''} · déclarée par l’appareil de l’artisan (non certifiée).</Copy>}
      {!fresh && point.position && <Copy kind="muted">Dernière position reçue le {timestamp(point.position.sampled_at)} : trop ancienne, elle n’est plus affichée.</Copy>}
      {!artisan && !point.shared && point.travel_stage !== 'on_site' && <Copy kind="muted">Le partage est décidé par l’artisan pour ce trajet uniquement ; il peut ne pas l’activer ou l’arrêter à tout moment.</Copy>}
      {mapped && <>
        {map === 'failed' && <View accessibilityRole="alert" style={[styles.mapUnavailable, { borderColor: palette.border, backgroundColor: palette.subtle }]}>
          <Copy kind="muted">Carte indisponible sur cet appareil pour le moment — les informations de suivi ci-dessus restent à jour.</Copy>
        </View>}
        <View accessible accessibilityRole="image" accessibilityLabel={'Carte du suivi. ' + (shown ? 'Dernière position partagée de l’artisan affichée. ' : 'Aucune position de l’artisan affichée. ') + (point.destination ? 'Destination : ' + point.destination.label + '.' : 'Destination non confirmée.')}>
          <TrackingMap position={shown ? { latitude: shown.latitude, longitude: shown.longitude } : null} accuracy={shown?.accuracy_m ?? null}
            destination={point.destination ? { latitude: point.destination.latitude, longitude: point.destination.longitude } : null}
            line={!artisan && fresh && estimate?.key === routeKey ? estimate.line : null}
            ready={async () => { setMap('ready'); }} dom={{
              useExpoDOMWebView: false, style: styles.map, matchContents: true, scrollEnabled: false,
              containerStyle: map === 'failed' ? styles.mapHidden : styles.mapContainer,
              injectedJavaScriptBeforeContentLoaded: hostFallback,
              onError: () => setMap('failed'), onHttpError: () => setMap('failed'),
              userAgent: 'DomDepannage/0.1',
              onOpenWindow: ({ nativeEvent }) => {
                if (nativeEvent.targetUrl === 'https://www.openstreetmap.org/copyright') void Linking.openURL(nativeEvent.targetUrl).catch(() => {});
              },
            }} />
        </View>
        <Copy kind="muted">Fond de carte © contributeurs OpenStreetMap. Seule la dernière position partagée est affichée ; aucun historique de trajet n’est conservé dans l’application.</Copy>
      </>}
      {point.destination && <Copy kind="muted" selectable>Destination confirmée · {point.destination.label}{point.destination.source === 'ign' ? ' (adresse IGN / BAN)' : ''}</Copy>}
      {artisan && view?.permissions.can_share && <>
        <Copy kind="muted">Le partage est volontaire, limité à ce trajet et cesse quand cet écran n’est plus actif.</Copy>
        {point.shared ? <>
          <Action secondary label="Arrêter le partage" disabled={busy} onPress={() => stop(false)} />
          <Action secondary label="Signaler mon arrivée" disabled={busy} onPress={() => stop(true)} />
        </> : <Action label="Partager ma position pendant le trajet" disabled={busy} onPress={start} />}
      </>}
      {view?.permissions.can_confirm_destination && !point.destination && <>
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
const styles = StyleSheet.create({
  map: { width: '100%', minHeight: MAP_HEIGHT, backgroundColor: 'transparent' },
  mapContainer: { width: '100%', minHeight: MAP_HEIGHT },
  mapHidden: { width: '100%', height: 0, minHeight: 0, opacity: 0, overflow: 'hidden' },
  mapUnavailable: { padding: 16, borderWidth: 1, borderRadius: 12 },
});
