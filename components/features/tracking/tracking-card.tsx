"use client";
// Suivi côté client / entreprise / admin en lecture (M7, V8-C07 ; contrat UI §4 + amendements). Coordonnées et route
// effacées dès que le serveur ne donne plus de position fraîche ; arrivée seulement depuis une route IGN valide.
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader, Tag, Unavailable } from "../../app/ui";
import { Icon } from "../../app/icons";
import type { TrackingRoute, TrackingSnapshot } from "../../../lib/features/tracking/types";
import { RouteScheduler, arrivalEstimate, failureOf, haversineM, isTrackingChanged, relativeAge, routeContextKey, routeFailureMessage, routeMatches, trackingDisplay } from "./model";
import { trackingKey, type TrackingLeafProps } from "./props";
import { TrackingMap, type MapPoint } from "./tracking-map";
import { DestinationPicker } from "./destination-picker";
import styles from "./tracking.module.css";

const hm = (iso: string) => new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const STAGES: { id: "planned" | "en_route" | "on_site"; label: string }[] = [
  { id: "planned", label: "Planifiée" },
  { id: "en_route", label: "En route" },
  { id: "on_site", label: "Sur place" },
];

export function TrackingCard(props: TrackingLeafProps) {
  return <CardBody key={trackingKey(props)} {...props} />;
}

function CardBody({ state, unavailableMessage, scope, client, demo, onNavigate, now = Date.now }: TrackingLeafProps) {
  const [snapshot, setSnapshot] = useState<TrackingSnapshot | null>(demo?.snapshot ?? null);
  const [route, setRoute] = useState<TrackingRoute | null>(demo?.route ?? null);
  const [routeError, setRouteError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [routing, setRouting] = useState(false);
  const [draft, setDraft] = useState<MapPoint | null>(null);
  /** Ordonnanceur d’itinéraire (une seule demande en vol, ≥ 30 s, Retry-After, 409 par état) ; `gateVersion` réarme la minuterie. */
  const scheduler = useRef(new RouteScheduler());
  const [gateVersion, setGateVersion] = useState(0);
  const [, setTick] = useState(0);
  const available = state === "available";

  /** E17: only the reply of the LATEST read applies; an older reply arriving late is dropped. */
  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    if (demo) return;
    const my = ++loadSeq.current;
    try {
      const next = await client.load();
      if (my !== loadSeq.current) return;
      if (next) setSnapshot(next);
      setLoadError("");
    } catch (error) {
      if (my !== loadSeq.current) return;
      const f = failureOf(error);
      // Droit perdu ou dossier invisible : tout est effacé de l’affichage.
      if (f.status === 403 || f.status === 404) {
        setSnapshot(null);
        setRoute(null);
      }
      setLoadError(f.message);
    }
  }, [client, demo]);

  useEffect(() => {
    if (available) void load();
  }, [available, load]);

  const display = trackingDisplay(snapshot, now());
  const shownRoute = routeMatches(route, snapshot, display) ? route : null;

  // Efface toute route qui ne correspond plus à une position fraîche du même état serveur.
  useEffect(() => {
    if (route && !shownRoute) setRoute(null);
  }, [route, shownRoute]);

  // Clé de contexte stable : l’effet ne dépend jamais de l’identité d’un snapshot re-sondé.
  const contextKey = routeContextKey(snapshot, display?.kind);
  const canRoute = contextKey !== "";
  const live = useRef({ client, load, contextKey });
  live.current = { client, load, contextKey };

  const recompute = useCallback(async () => {
    const { client: routeClient, load: reload, contextKey: key } = live.current;
    if (demo) return;
    // Exclusion synchrone : aucune autre demande tant que celle-ci est en vol (minuterie, sondage ou clic).
    const pending = scheduler.current.request(Date.now(), key, () => routeClient.route(), () => live.current.contextKey, () => Date.now());
    if (!pending) return;
    setRouting(true);
    setRouteError("");
    const outcome = await pending;
    if (outcome.kind === "result") setRoute(outcome.route);
    else if (outcome.kind === "failure") {
      setRoute(null);
      if (isTrackingChanged(outcome.failure)) void reload(); // une relecture ; suivi seulement pour un nouvel état
      else setRouteError(routeFailureMessage(outcome.failure));
    }
    setRouting(false);
    setGateVersion((n) => n + 1); // réarme la minuterie une fois le jeton libéré
  }, [demo]);
  // Démontage : résultat en vol ignoré (invalidate, pas dispose : compatible avec le double montage du mode strict).
  useEffect(() => () => scheduler.current.invalidate(), []);

  // Snapshot relu toutes les 15 s (pas d’itinéraire) ; itinéraire : une seule minuterie armée sur le temps restant de la porte.
  useEffect(() => {
    if (!available || demo) return;
    const id = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(id);
  }, [available, demo, load]);
  useEffect(() => {
    if (!available || demo || !canRoute) return;
    const wait = scheduler.current.waitMs(Date.now(), contextKey);
    if (!Number.isFinite(wait)) return;
    const id = window.setTimeout(() => void recompute(), wait);
    return () => window.clearTimeout(id);
  }, [available, demo, canRoute, contextKey, gateVersion, recompute]);
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 10_000);
    return () => window.clearInterval(id);
  }, []);

  if (!available) return <Unavailable title="Suivi de l’artisan" reason={unavailableMessage} state={state} blocker="capability:tracking" />;
  if (!snapshot || !display)
    return loadError ? (
      <section className={`panel ${styles.panel}`}>
        <h2>Suivi de l’artisan</h2>
        <p className={styles.error} role="alert">
          {loadError}
        </p>
      </section>
    ) : (
      <Loader label="Lecture du suivi…" />
    );

  const t = snapshot.tracking;
  const eta = shownRoute ? arrivalEstimate(shownRoute) : null;
  const dest = t.destination;
  const editable = snapshot.permissions.can_confirm_destination && scope.authority.canWrite;
  const snapGap = shownRoute && dest ? Math.round(haversineM(shownRoute.snapped_end, [dest.longitude, dest.latitude])) : 0;
  const stageIndex = STAGES.findIndex((s) => s.id === t.travel_stage);
  const description =
    display.kind === "fresh"
      ? `Carte : position de l’artisan (précision ${Math.round(display.position!.accuracyM)} m, ${relativeAge(display.position!.ageS)})${dest ? `, destination ${dest.label}` : ""}${eta ? `, itinéraire routier de ${eta.distanceKm} km` : ""}.`
      : `Carte : ${display.reason.toLowerCase()}${dest ? `, destination ${dest.label}` : ""}.`;

  return (
    <section className={`panel ${styles.panel} ${styles.card}`} aria-labelledby="tracking-card-title">
      <div className={styles.head}>
        <h2 id="tracking-card-title">Suivi de l’artisan</h2>
        {display.kind === "fresh" && t.shared ? <Tag tone="green">Suivi actif</Tag> : <Tag tone="neutral">{display.reason}</Tag>}
      </div>
      {demo && <p className={styles.demo}>Démonstration : position, destination et itinéraire fictifs.</p>}

      <ol className={styles.stages} aria-label="Déplacement">
        {STAGES.map((s, i) => (
          <li key={s.id} className={i < stageIndex ? styles.stageDone : i === stageIndex ? styles.stageCurrent : undefined} aria-current={i === stageIndex ? "step" : undefined}>
            <span aria-hidden="true">{i < stageIndex ? <Icon name="check" size={13} /> : i + 1}</span>
            {s.label}
          </li>
        ))}
      </ol>

      <div className={styles.eta} aria-live="polite">
        <Icon name="clock" size={20} />
        {eta ? (
          <div>
            <span>Arrivée estimée</span>
            <strong>vers {hm(eta.arrivalAt)}</strong>
            <small>
              Durée {eta.durationMin} min · {eta.distanceKm} km par la route · calculée à {hm(eta.calculatedAt)} · hors trafic temps réel, sans
              garantie
            </small>
            <small>Source : {shownRoute!.source}</small>
          </div>
        ) : (
          <div>
            <span>Arrivée estimée</span>
            <strong>Non disponible</strong>
            <small>
              {routeError ||
                (display.kind !== "fresh"
                  ? "Aucune position récente : l’arrivée ne peut pas être estimée."
                  : !dest
                    ? "Destination non confirmée."
                    : routing
                      ? "Calcul de l’itinéraire…"
                      : "Itinéraire non calculé.")}
            </small>
          </div>
        )}
      </div>

      <div className={styles.layout}>
        {/* The map comes first in the DOM, as drawn on narrow screens (Tab order = visual order). */}
        <TrackingMap
          position={display.position ? { latitude: display.position.latitude, longitude: display.position.longitude, accuracyM: display.position.accuracyM } : null}
          destination={dest ? { latitude: dest.latitude, longitude: dest.longitude } : null}
          draft={editable ? draft : null}
          snappedEnd={shownRoute?.snapped_end ?? null}
          route={shownRoute?.geometry.coordinates ?? null}
          routeAttribution={shownRoute?.attribution ?? null}
          description={description}
          onPick={editable ? setDraft : undefined}
        />
        <div className={styles.status}>
          <dl className={styles.facts}>
            <div>
              <dt>Position</dt>
              <dd>
                {display.kind === "fresh"
                  ? `± ${Math.round(display.position!.accuracyM)} m · ${relativeAge(display.position!.ageS)} (à ${hm(display.position!.sampledAt)})`
                  : `${display.reason}${display.knownTime ? ` — dernière à ${hm(display.knownTime)}` : ""}`}
              </dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd>Position déclarée par le navigateur de l’artisan (non certifiée)</dd>
            </div>
            {dest && (
              <div>
                <dt>Destination</dt>
                <dd>
                  {dest.label} ({dest.latitude.toFixed(5)}, {dest.longitude.toFixed(5)})
                </dd>
              </div>
            )}
            {shownRoute && dest && snapGap > 0 && (
              <div>
                <dt>Fin de l’itinéraire</dt>
                <dd>Point routier à {snapGap} m de la destination confirmée</dd>
              </div>
            )}
          </dl>

          <div className={styles.actions}>
            {canRoute && !demo && (() => {
              const wait = scheduler.current.waitMs(Date.now(), contextKey);
              const blocked = routing || wait > 0;
              return (
                <button type="button" className="button outline" onClick={() => void recompute()} disabled={blocked}>
                  <Icon name="refresh" size={17} />
                  {routing ? "Calcul…" : wait > 0 && Number.isFinite(wait) ? `Recalculer (dans ${Math.ceil(wait / 1000)} s)` : wait === Infinity ? "Recalculer (en attente d’une nouvelle position)" : "Recalculer"}
                </button>
              );
            })()}
            {dest && (
              <a
                className="button outline"
                href={`https://www.google.com/maps/dir/?api=1&destination=${dest.latitude},${dest.longitude}`}
                target="_blank"
                rel="noreferrer"
              >
                <Icon name="navigate" size={17} />
                Ouvrir dans mon application de navigation
              </a>
            )}
            {onNavigate && (
              <button type="button" className="button outline" onClick={() => onNavigate("intervention", t.intervention_id)}>
                Ouvrir le dossier
              </button>
            )}
          </div>

          <DestinationPicker
            snapshot={snapshot}
            client={client}
            editable={editable}
            readOnlyReason={scope.authority.canWrite ? undefined : scope.authority.reason}
            demo={Boolean(demo)}
            draft={editable ? draft : null}
            onDraft={setDraft}
            onSnapshot={(s) => {
              setSnapshot(s);
              setRoute(null);
            }}
          />
        </div>

      </div>
    </section>
  );
}
