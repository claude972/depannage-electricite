"use client";
// Suivi côté client / entreprise / admin en lecture (M7, V8-C07 ; contrat UI §4 + amendements). Coordonnées et route
// effacées dès que le serveur ne donne plus de position fraîche ; arrivée seulement depuis une route IGN valide.
import { useCallback, useEffect, useState } from "react";
import { Loader, Tag, Unavailable } from "../../app/ui";
import { Icon } from "../../app/icons";
import type { TrackingRoute, TrackingSnapshot } from "../../../lib/features/tracking/types";
import { ROUTE_REFRESH_MS, arrivalEstimate, failureOf, haversineM, isTrackingChanged, mayRequestRoute, relativeAge, routeFailureMessage, routeKey, routeMatches, trackingDisplay } from "./model";
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
  /** État serveur pour lequel la route a répondu 409 : aucune nouvelle demande tant qu’il n’a pas changé. */
  const [blockedKey, setBlockedKey] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const available = state === "available";

  const load = useCallback(async () => {
    if (demo) return;
    try {
      const next = await client.load();
      if (next) setSnapshot(next);
      setLoadError("");
    } catch (error) {
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

  const recompute = useCallback(async () => {
    if (demo || !mayRequestRoute(snapshot, blockedKey)) return;
    const asked = routeKey(snapshot);
    setRouting(true);
    setRouteError("");
    try {
      const r = await client.route();
      if (r === null) return;
      setRoute(r);
    } catch (error) {
      const f = failureOf(error);
      setRoute(null);
      if (isTrackingChanged(f)) {
        // Le suivi a changé pendant le calcul : relecture, nouvelle demande seulement pour un nouvel état (pas de boucle).
        setBlockedKey(asked);
        void load();
        return;
      }
      setRouteError(routeFailureMessage(f));
    } finally {
      setRouting(false);
    }
  }, [client, demo, snapshot, blockedKey, load]);

  // Rafraîchissement : snapshot toutes les 15 s ; itinéraire au plus toutes les 30 s, seulement avec position fraîche + destination.
  const canRoute = display?.kind === "fresh" && Boolean(snapshot?.tracking.destination);
  useEffect(() => {
    if (!available || demo) return;
    const id = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(id);
  }, [available, demo, load]);
  useEffect(() => {
    if (!available || demo || !canRoute) return;
    void recompute();
    const id = window.setInterval(() => void recompute(), ROUTE_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [available, demo, canRoute, snapshot?.tracking.last_seq, snapshot?.tracking.destination_version, recompute]);
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
            {shownRoute && dest && snapGap > 0 && (
              <div>
                <dt>Fin de l’itinéraire</dt>
                <dd>Point routier à {snapGap} m de la destination confirmée</dd>
              </div>
            )}
          </dl>

          <div className={styles.actions}>
            {canRoute && !demo && (
              <button type="button" className="button outline" onClick={() => void recompute()} disabled={routing}>
                <Icon name="refresh" size={17} />
                {routing ? "Calcul…" : "Recalculer"}
              </button>
            )}
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
      </div>
    </section>
  );
}
