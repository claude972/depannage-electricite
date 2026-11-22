"use client";
// Client dossier map / follow-up (CLI-05). Logic in ./dossier-map-model. Reuses the tracking leaf's
// TrackingMap (the one authorized map flow, OSM tiles with visible attribution) — only with a fresh
// consented position and/or a confirmed destination from the server. When the « Suivi de
// l’artisan » card already shows the map on the page (`trackingCardShown`), no second map and no
// duplicate tracking read: the declared address + a pointer to the card. No ETA here (the card
// alone shows one, through routeMatches). The declared address is never geocoded or sent.
import { useCallback, useEffect, useRef, useState } from "react";
import type { TrackingClient, TrackingSnapshot } from "../../../lib/features/tracking/types";
import { MAP_COPY, externalMapsHref, mapView, nextTransitionMs, type DeclaredAddress } from "./dossier-map-model";
import { TrackingMap } from "../tracking/tracking-map";
import styles from "./dossier-map.module.css";

export type DossierMapProps = {
  address: DeclaredAddress;
  /** Null when the dossier is not at a tracking stage yet. */
  tracking: TrackingClient | null;
  /** Contract state of the tracking capability as observed by the session. */
  trackingState?: "unknown" | "available" | "missing" | "unavailable";
  /** True when the page already renders the tracking card (with its map) for this dossier. */
  trackingCardShown?: boolean;
  /** Demo: the demo snapshot, never a request. */
  demoSnapshot?: TrackingSnapshot | null;
  now?: () => number;
};
type Load = { phase: "idle" | "loading" | "ready" | "error" | "offline"; snapshot: TrackingSnapshot | null };

export function DossierMapPanel(props: DossierMapProps) {
  if (props.trackingCardShown) return <InCard address={props.address} />;
  return <StandalonePanel {...props} />;
}

/** The tracking card shows the map on this page: declared address + pointer, nothing duplicated. */
function InCard({ address }: { address: DeclaredAddress }) {
  return (
    <div className={styles.panel} data-dossier-map="in-card">
      <p className={styles.declared}>{MAP_COPY.declared}</p>
      <p className={styles.hint} data-map-in-card="">
        {MAP_COPY.inCard}{" "}
        <button
          type="button"
          className={styles.link}
          onClick={() => {
            const target = document.getElementById("client-dossier-tracking");
            target?.focus({ preventScroll: true });
            target?.scrollIntoView({ block: "start" });
          }}
          data-map-go-card=""
        >
          Voir le suivi de l’artisan
        </button>
      </p>
      <ExternalMapsLink address={address} />
    </div>
  );
}

function StandalonePanel({ address, tracking, trackingState = "available", demoSnapshot, now = Date.now }: DossierMapProps) {
  const demo = demoSnapshot !== undefined;
  const [load, setLoad] = useState<Load>(() => (demo ? { phase: "ready", snapshot: demoSnapshot ?? null } : { phase: tracking ? "loading" : "idle", snapshot: null }));
  const seq = useRef(0);
  // The shell may build a new TrackingClient on each render: read through a ref (the panel is
  // keyed by dossier + identity), so a re-render never triggers another request.
  const trackingRef = useRef(tracking);
  trackingRef.current = tracking;
  const hasTracking = tracking !== null;
  const read = useCallback(async () => {
    const client = trackingRef.current;
    if (demo || !client || trackingState !== "available") return;
    const my = ++seq.current;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return setLoad({ phase: "offline", snapshot: null });
    setLoad((l) => ({ phase: "loading", snapshot: l.snapshot }));
    try {
      const snapshot = await client.load();
      if (my !== seq.current) return;
      setLoad(snapshot ? { phase: "ready", snapshot } : { phase: "error", snapshot: null });
    } catch {
      if (my !== seq.current) return;
      setLoad({ phase: typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "error", snapshot: null });
    }
  }, [demo, hasTracking, trackingState]);
  useEffect(() => {
    void read();
    return () => {
      seq.current++;
    };
  }, [read]);
  // Local clock: re-render exactly when a shown position/snapshot crosses its freshness threshold,
  // even if nothing else re-renders the page (a stale position is then removed, never left shown).
  const [, setTick] = useState(0);
  const snapshot = load.snapshot;
  const wait = snapshot ? nextTransitionMs(snapshot, now()) : null;
  useEffect(() => {
    if (wait === null) return;
    const id = setTimeout(() => setTick((n) => n + 1), wait);
    return () => clearTimeout(id);
  });
  const view = snapshot ? mapView(snapshot, now()) : null;
  // Same conditions as the tracking card's map: a fresh consented position and/or a confirmed
  // destination, both from the server. Nothing else (never the declared address) is mapped.
  const destination = snapshot?.tracking.destination ?? null;
  const mapPoints =
    view && (view.position || destination)
      ? {
          position: view.position ? { latitude: view.position.latitude, longitude: view.position.longitude, accuracyM: view.position.accuracyM } : null,
          destination: destination ? { latitude: destination.latitude, longitude: destination.longitude } : null,
          description: `Carte : ${view.position ? "position partagée par l’artisan" : "aucune position récente"}${destination ? `, destination confirmée ${destination.label}` : ""}.`,
        }
      : null;

  return (
    <div className={styles.panel} data-dossier-map={mapPoints ? "map" : "none"}>
      <p className={styles.declared}>
        <span>{MAP_COPY.declared}</span>
      </p>

      {mapPoints ? (
        <figure className={styles.map} data-map-reused="tracking-map">
          <TrackingMap
            position={mapPoints.position}
            destination={mapPoints.destination}
            description={mapPoints.description}
          />
          <figcaption className={styles.attribution} data-map-tiles-notice="">{MAP_COPY.tiles}</figcaption>
        </figure>
      ) : (
        <p className={styles.hint} data-map-none="">{MAP_COPY.noMap}</p>
      )}

      <section className={styles.follow} aria-label="Suivi du déplacement" data-map-follow={load.phase}>
        {demo && load.snapshot && <p className={styles.hint}>{MAP_COPY.demo}</p>}
        {!tracking && <p className={styles.hint} data-map-not-yet="">{MAP_COPY.notYet}</p>}
        {tracking && !demo && trackingState !== "available" && trackingState !== "unknown" && <p className={styles.hint} data-map-unavailable="">{MAP_COPY.unavailable}</p>}
        {load.phase === "loading" && <p className={styles.hint} role="status">{MAP_COPY.loading}</p>}
        {load.phase === "offline" && <p className={styles.hint} role="status" data-map-offline="">{MAP_COPY.offline}</p>}
        {load.phase === "error" && (
          <p className={styles.error} role="alert" data-map-error="">
            {MAP_COPY.loadFailed}{" "}
            <button type="button" className={styles.secondary} onClick={() => void read()}>Réessayer</button>
          </p>
        )}
        {view && (
          <dl className={styles.kv}>
            <div><dt>Déplacement</dt><dd data-map-stage="">{view.stage}</dd></div>
            <div><dt>Partage de position</dt><dd data-map-sharing={view.sharing.kind}>{view.sharing.text}</dd></div>
            {view.position && <div><dt>Position</dt><dd data-map-position="">{view.position.text}</dd></div>}
            <div><dt>Arrivée</dt><dd data-map-eta="none">{MAP_COPY.noEta}</dd></div>
            <div><dt>Fraîcheur</dt><dd data-map-freshness={view.freshness.stale ? "stale" : "fresh"}>{view.freshness.text}</dd></div>
          </dl>
        )}
        {view && !demo && (
          <button type="button" className={styles.secondary} onClick={() => void read()} data-map-refresh="">Actualiser le suivi</button>
        )}
      </section>

      <ExternalMapsLink address={address} />
    </div>
  );
}

/** User-initiated only: the address goes to the device map app after an explicit consent click. */
function ExternalMapsLink({ address }: { address: DeclaredAddress }) {
  const [consent, setConsent] = useState<"closed" | "asking" | "granted">("closed");
  return (
    <div className={styles.external}>
        {consent === "closed" && (
          <button type="button" className={styles.secondary} onClick={() => setConsent("asking")} data-map-external-ask="">
            Ouvrir dans mon application de cartes
          </button>
        )}
        {consent === "asking" && (
          <div className={styles.consent} role="alertdialog" aria-label="Transmettre l’adresse à votre application de cartes" data-map-external-consent="">
            <p>{MAP_COPY.externalNotice}</p>
            <div className={styles.actions}>
              <button type="button" className={styles.primary} onClick={() => setConsent("granted")} data-map-external-accept="">J’ai compris, continuer</button>
              <button type="button" className={styles.secondary} onClick={() => setConsent("closed")}>Annuler</button>
            </div>
          </div>
        )}
        {consent === "granted" && (
          <a className={styles.primary} href={externalMapsHref(address)} rel="noreferrer noopener" data-map-external-link="">
            Ouvrir l’adresse dans mon application de cartes
          </a>
        )}
      </div>
  );
}
