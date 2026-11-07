"use client";
// Client dossier map / follow-up (CLI-05). Logic in ./dossier-map-model. The map is an owner
// decision (`provider`, null by default): without it nothing is sent to a third party and the
// panel says « carte non activée », while still showing what is real (declared address, server
// tracking state with source and freshness, the artisan's position only when fresh and shared).
import { useCallback, useEffect, useRef, useState } from "react";
import type { TrackingClient, TrackingSnapshot } from "../../../lib/features/tracking/types";
import { MAP_COPY, externalMapsHref, mapView, type DeclaredAddress, type MapProvider } from "./dossier-map-model";
import styles from "./dossier-map.module.css";

export type DossierMapProps = {
  address: DeclaredAddress;
  /** Null when the dossier is not at a tracking stage yet. */
  tracking: TrackingClient | null;
  /** Contract state of the tracking capability as observed by the session. */
  trackingState?: "unknown" | "available" | "missing" | "unavailable";
  provider?: MapProvider | null;
  /** Demo: the demo snapshot, never a request. */
  demoSnapshot?: TrackingSnapshot | null;
  now?: () => number;
};
type Load = { phase: "idle" | "loading" | "ready" | "error" | "offline"; snapshot: TrackingSnapshot | null };

export function DossierMapPanel({ address, tracking, trackingState = "available", provider = null, demoSnapshot, now = Date.now }: DossierMapProps) {
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
  const [consent, setConsent] = useState<"closed" | "asking" | "granted">("closed");
  const view = load.snapshot ? mapView(load.snapshot, now()) : null;

  return (
    <div className={styles.panel} data-dossier-map={provider ? `provider:${provider.id}` : "none"}>
      <p className={styles.declared}>
        <span>{MAP_COPY.declared}</span>
      </p>

      {provider ? (
        <figure className={styles.map}>
          {provider.render({ address, position: view?.position ? { latitude: view.position.latitude, longitude: view.position.longitude, accuracyM: view.position.accuracyM } : null })}
          <figcaption className={styles.attribution} data-map-attribution="">{provider.attribution}</figcaption>
        </figure>
      ) : (
        <div className={styles.mock} role="note" data-map-provider="none">
          {/* Clean placeholder drawn locally: no tiles, no geocoding, no network. */}
          <svg viewBox="0 0 320 120" className={styles.mockArt} aria-hidden="true" focusable="false">
            <rect x="0.5" y="0.5" width="319" height="119" rx="12" className={styles.mockFrame} />
            <path d="M0 80 C 80 60, 140 100, 220 70 S 300 40, 320 50" className={styles.mockRoad} />
            <path d="M60 0 L 90 120" className={styles.mockRoad} />
            <circle cx="200" cy="62" r="7" className={styles.mockPin} />
          </svg>
          <p>{MAP_COPY.noProvider}</p>
        </div>
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
    </div>
  );
}
