"use client";
// Partage de position de l’artisan (contrat UI §3 + amendements). watchPosition seulement après consentement et
// démarrage serveur réussi ; clearWatch à toute sortie ; aucune reprise cachée ; aucune promesse de suivi continu.
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader, Tag, Unavailable } from "../../app/ui";
import { Icon } from "../../app/icons";
import type { TrackingSnapshot } from "../../../lib/features/tracking/types";
import { ShareController, failureOf, needsExplicitRestart, relativeAge, type ShareStatus } from "./model";
import { trackingKey, type TrackingLeafProps } from "./props";
import styles from "./tracking.module.css";

const time = (iso: string) => new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(iso));

export function ArtisanTrackingPanel(props: TrackingLeafProps) {
  return <PanelBody key={trackingKey(props)} {...props} />;
}

function PanelBody({ state, unavailableMessage, scope, client, demo, geolocation, now = Date.now }: TrackingLeafProps) {
  const [snapshot, setSnapshot] = useState<TrackingSnapshot | null>(demo?.snapshot ?? null);
  const [loadError, setLoadError] = useState("");
  const [status, setStatus] = useState<ShareStatus>({ kind: "idle" });
  const [, setTick] = useState(0);
  const controller = useRef<ShareController | null>(null);
  const available = state === "available";

  const reload = useCallback(async () => {
    if (demo) return demo.snapshot;
    try {
      const next = await client.load();
      if (next) setSnapshot(next);
      setLoadError("");
      return next;
    } catch (error) {
      setLoadError(failureOf(error).message);
      return null;
    }
  }, [client, demo]);

  useEffect(() => {
    if (!available) return;
    const ctrl = new ShareController({
      geolocation: geolocation === undefined ? (typeof navigator !== "undefined" ? navigator.geolocation : null) : geolocation,
      now,
      uuid: () => crypto.randomUUID(),
      command: (input) => (demo ? Promise.reject(Object.assign(new Error("Démonstration : aucun partage n’est envoyé."), { status: 403 })) : client.command(input)),
      onSnapshot: setSnapshot,
      onStatus: setStatus,
      online: () => (typeof navigator === "undefined" ? true : navigator.onLine),
      reload: () => (demo ? Promise.resolve(demo.snapshot) : client.load()),
    });
    controller.current = ctrl;
    void reload();
    // Page masquée ou en veille : arrêt local immédiat, arrêt serveur tenté au mieux, aucune reprise automatique.
    const onVisibility = () => {
      if (document.visibilityState === "hidden") ctrl.interrupt("Page masquée ou mise en veille : le partage a été interrompu.");
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      ctrl.dispose(); // démontage, déconnexion, changement d’identité ou de dossier
      controller.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available, client, demo]);

  // CLI-05: a refused command means the shown snapshot may be outdated (e.g. the client confirmed a
  // destination, which ended the session): re-read it so the panel shows the server state instead of
  // a « reload » interruption that never happened.
  const failed = status.kind === "error";
  useEffect(() => {
    if (failed) void reload();
  }, [failed, reload]);

  // Âge de la dernière position envoyée (affichage seulement).
  useEffect(() => {
    if (status.kind !== "sharing") return;
    const id = window.setInterval(() => setTick((n) => n + 1), 5000);
    return () => window.clearInterval(id);
  }, [status.kind]);

  if (!available) return <Unavailable title="Partage de position" reason={unavailableMessage} state={state} blocker="capability:tracking" />;
  if (!snapshot) return loadError ? <p className={styles.error} role="alert">{loadError}</p> : <Loader label="Lecture du suivi…" />;

  const canShare = snapshot.permissions.can_share && scope.authority.canWrite;
  const ctrl = controller.current;
  const watching = Boolean(ctrl?.watching);
  const stale = needsExplicitRestart(snapshot, watching);
  const lastSent = status.kind === "sharing" ? status.lastSent : null;

  return (
    <section className={`panel ${styles.panel}`} aria-labelledby="tracking-share-title">
      <div className={styles.head}>
        <h2 id="tracking-share-title">Partage de ma position</h2>
        <Tag tone={watching ? "green" : "neutral"}>{watching ? "Partage en cours" : "Non partagé"}</Tag>
      </div>
      {demo && <p className={styles.demo}>Démonstration : aucune position n’est lue ni envoyée.</p>}
      <p className={styles.note}>
        Sur le web, le partage peut être interrompu si la page est fermée, mise en arrière-plan ou en veille ; aucune
        continuité n’est garantie.
      </p>

      {!canShare ? (
        <p className={styles.muted}>{scope.authority.reason || "Le partage n’est pas ouvert pour ce dossier."}</p>
      ) : status.kind === "consent" ? (
        <div className={styles.consent} role="group" aria-labelledby="tracking-consent-title">
          <h3 id="tracking-consent-title">Avant de partager votre position</h3>
          <ul>
            <li>Les participants autorisés de ce dossier voient votre dernière position, sa précision et son heure.</li>
            <li>Seule la dernière position est conservée ; aucun historique de trajet.</li>
            <li>Votre position et la destination sont envoyées au service public d’itinéraire de l’IGN pour estimer l’arrivée.</li>
            <li>Vous pouvez arrêter à tout moment ; l’arrêt, l’arrivée ou la fin du dossier effacent la position.</li>
          </ul>
          <div className={styles.actions}>
            <button type="button" className="button primary" onClick={() => void ctrl?.start(snapshot)}>
              <Icon name="location" size={18} />
              Autoriser et démarrer
            </button>
            <button type="button" className="button outline" onClick={() => ctrl?.cancelConsent()}>
              Annuler
            </button>
          </div>
        </div>
      ) : watching ? (
        <>
          <dl className={styles.facts}>
            <div>
              <dt>Dernière position envoyée</dt>
              <dd>{lastSent ? `± ${Math.round(lastSent.accuracyM)} m · ${relativeAge(Math.max(0, Math.round((now() - Date.parse(lastSent.sampledAt)) / 1000)))}` : "En attente d’une position du navigateur"}</dd>
            </div>
            {lastSent && (
              <div>
                <dt>Échantillonnée à</dt>
                <dd>{time(lastSent.sampledAt)}</dd>
              </div>
            )}
            <div>
              <dt>Source</dt>
              <dd>Position déclarée par le navigateur (non certifiée)</dd>
            </div>
          </dl>
          {status.kind === "sharing" && status.note && <p className={styles.warn} role="status">{status.note}</p>}
          <div className={styles.actions}>
            <button type="button" className="button primary" onClick={() => void ctrl?.finish("arrived")}>
              <Icon name="check" size={18} />
              Je suis arrivé
            </button>
            <button type="button" className="button outline" onClick={() => void ctrl?.finish("stop")}>
              <Icon name="pause" size={18} />
              Arrêter le partage
            </button>
          </div>
        </>
      ) : stale ? (
        <>
          <p className={styles.warn} role="status">
            {status.kind === "interrupted" ? status.reason : status.kind === "error" ? "Le partage n’est plus actif sur cette page." : "Partage interrompu par le rechargement de la page."} L’arrêt
            côté service est tenté ; s’il n’aboutit pas, la position cesse d’être affichée après 60 s.
          </p>
          <div className={styles.actions}>
            <button type="button" className="button primary" onClick={() => void ctrl?.closeStaleSession(snapshot, reload)} disabled={status.kind === "starting"}>
              <Icon name="refresh" size={18} />
              Reprendre le partage
            </button>
          </div>
        </>
      ) : (
        <div className={styles.actions}>
          <button type="button" className="button primary" onClick={() => ctrl?.askConsent()} disabled={status.kind === "starting"}>
            <Icon name="location" size={18} />
            {status.kind === "starting" ? "Démarrage…" : "Partager ma position"}
          </button>
        </div>
      )}

      {status.kind === "interrupted" && !stale && <p className={styles.warn} role="status">{status.reason}</p>}
      {status.kind === "error" && (
        <p className={styles.error} role="alert">
          {status.message}
          {status.retryable ? " Relancez le partage avec un nouveau consentement." : ""}
        </p>
      )}
    </section>
  );
}
