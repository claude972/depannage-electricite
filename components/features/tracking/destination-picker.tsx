"use client";
// Destination (contrat UI §4 + amendement 3) : recherche explicite IGN, choix d’un candidat sans sélection automatique,
// ou point manuel (carte / coordonnées) ; rien n’est envoyé avant « Confirmer cette destination ». Lecture seule : rien
// d’éditable, même au clic carte (le parent ne passe pas `onPick`).
import { useState, type FormEvent } from "react";
import { ConfirmAction, Field } from "../../app/ui";
import { Icon } from "../../app/icons";
import type { TrackingClient, TrackingSnapshot } from "../../../lib/features/tracking/types";
import { DESTINATION_STOP_WARNING, destinationCommand, destinationStopsSharing, failureOf, geocodeQueryValid, validateManualDestination, type GeocodeCandidate, type ManualDestinationErrors } from "./model";
import type { MapPoint } from "./tracking-map";
import styles from "./tracking.module.css";

export type DestinationPickerProps = {
  snapshot: TrackingSnapshot;
  client: TrackingClient;
  editable: boolean;
  readOnlyReason?: string;
  demo: boolean;
  /** Brouillon local (point choisi sur la carte) : affiché « non confirmé » par le parent. */
  draft: MapPoint | null;
  onDraft: (point: MapPoint | null) => void;
  onSnapshot: (s: TrackingSnapshot) => void;
};

export function DestinationPicker({ snapshot, client, editable, readOnlyReason, demo, draft, onDraft, onSnapshot }: DestinationPickerProps) {
  const dest = snapshot.tracking.destination;
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<GeocodeCandidate[] | null>(null);
  const [attribution, setAttribution] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "ok"; text: string } | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manual, setManual] = useState({ latitude: "", longitude: "", label: "" });
  const [errors, setErrors] = useState<ManualDestinationErrors>({});

  const send = async (choice: Parameters<typeof destinationCommand>[1], done: string) => {
    if (demo) {
      setMessage({ tone: "error", text: "Démonstration : la destination n’est pas enregistrée." });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const next = await client.command(destinationCommand(snapshot, choice));
      if (next === null) return; // chaîne périmée : aucun succès
      onSnapshot(next);
      onDraft(null);
      setCandidates(null);
      setManualOpen(false);
      setMessage({ tone: "ok", text: done });
    } catch (error) {
      setMessage({ tone: "error", text: failureOf(error).message });
    } finally {
      setBusy(false);
    }
  };

  const search = async (e: FormEvent) => {
    e.preventDefault();
    if (!geocodeQueryValid(query) || demo) {
      if (demo) setMessage({ tone: "error", text: "Démonstration : aucune recherche n’est envoyée." });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await client.geocode(query.trim());
      if (res === null) return;
      setCandidates(res.candidates);
      setAttribution(res.attribution);
    } catch (error) {
      setMessage({ tone: "error", text: failureOf(error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles.dest} aria-labelledby="tracking-dest-title">
      <h3 id="tracking-dest-title">Destination</h3>
      {dest ? (
        <p className={styles.destCurrent}>
          <Icon name="location" size={16} />
          <span>
            <strong>{dest.label}</strong>
            <small>Confirmée ({dest.source === "ign" ? "adresse IGN" : "point manuel"})</small>
          </span>
        </p>
      ) : (
        <p className={styles.muted}>Aucune destination confirmée : l’arrivée ne peut pas être estimée.</p>
      )}

      {editable && destinationStopsSharing(snapshot) && (
        <p className={styles.warn} role="note">
          {DESTINATION_STOP_WARNING}
        </p>
      )}
      {!editable ? (
        <p className={styles.muted}>{readOnlyReason || "Seule la personne habilitée du dossier peut confirmer la destination."}</p>
      ) : (
        <>
          <form className={styles.searchRow} onSubmit={search} role="search" aria-label="Rechercher une adresse">
            <Field label="Rechercher une adresse" hint="2 à 200 caractères ; aucune adresse n’est choisie automatiquement.">
              <input value={query} maxLength={200} onChange={(e) => setQuery(e.target.value)} placeholder="Ex. rue, commune" />
            </Field>
            <button type="submit" className="button outline" disabled={busy || !geocodeQueryValid(query)}>
              <Icon name="search" size={17} />
              Rechercher
            </button>
          </form>
          {candidates && (
            <div aria-live="polite">
              {candidates.length === 0 ? (
                <p className={styles.muted}>Aucun résultat : saisissez un point manuel.</p>
              ) : (
                <ul className={styles.candidates}>
                  {candidates.map((c, i) => (
                    <li key={`${c.label}-${i}`}>
                      <span>
                        <strong>{c.label}</strong>
                        <small>
                          Type : {c.type} · correspondance {Math.round(c.score * 100)} % (indicatif)
                        </small>
                      </span>
                      <button type="button" className="button outline" disabled={busy} onClick={() => void send({ kind: "candidate", candidate: c }, "Destination confirmée.")}>
                        Confirmer cette destination
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {attribution && <p className={styles.small}>Géocodage : {attribution}</p>}
            </div>
          )}

          {draft && (
            <div className={styles.draft} role="status">
              <span>
                Point choisi sur la carte (non confirmé) : {draft.latitude.toFixed(5)}, {draft.longitude.toFixed(5)}
              </span>
              <Field label="Libellé du point">
                <input value={manual.label} maxLength={200} onChange={(e) => setManual((m) => ({ ...m, label: e.target.value }))} placeholder="Ex. portail côté parking" />
              </Field>
              <div className={styles.actions}>
                <button
                  type="button"
                  className="button primary"
                  disabled={busy || !manual.label.trim()}
                  onClick={() => void send({ kind: "manual", latitude: draft.latitude, longitude: draft.longitude, label: manual.label.trim() }, "Destination confirmée.")}
                >
                  Confirmer cette destination
                </button>
                <button type="button" className="button outline" onClick={() => onDraft(null)}>
                  Annuler le point
                </button>
              </div>
            </div>
          )}

          <details className={styles.manual} open={manualOpen} onToggle={(e) => setManualOpen((e.target as HTMLDetailsElement).open)}>
            <summary>Saisir des coordonnées (adresse introuvable ou ambiguë)</summary>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const r = validateManualDestination(manual);
                if (!r.ok) {
                  setErrors(r.errors);
                  return;
                }
                setErrors({});
                void send({ kind: "manual", ...r.value }, "Destination confirmée.");
              }}
              noValidate
            >
              <div className={styles.coordRow}>
                <Field label="Latitude" error={errors.latitude}>
                  <input inputMode="decimal" value={manual.latitude} onChange={(e) => setManual((m) => ({ ...m, latitude: e.target.value }))} />
                </Field>
                <Field label="Longitude" error={errors.longitude}>
                  <input inputMode="decimal" value={manual.longitude} onChange={(e) => setManual((m) => ({ ...m, longitude: e.target.value }))} />
                </Field>
              </div>
              <Field label="Libellé" error={errors.label}>
                <input value={manual.label} maxLength={200} onChange={(e) => setManual((m) => ({ ...m, label: e.target.value }))} />
              </Field>
              <button type="submit" className="button primary" disabled={busy}>
                Confirmer cette destination
              </button>
            </form>
          </details>

          {dest && (
            <ConfirmAction
              label="Retirer la destination"
              message={`La destination sera retirée.${destinationStopsSharing(snapshot) ? ` ${DESTINATION_STOP_WARNING}` : ""} Continuer ?`}
              confirmLabel="Retirer"
              className="button outline"
              busy={busy}
              onConfirm={() => send({ kind: "clear" }, "Destination retirée.")}
            />
          )}
        </>
      )}
      {message && (
        <p className={message.tone === "error" ? styles.error : styles.ok} role={message.tone === "error" ? "alert" : "status"}>
          {message.text}
        </p>
      )}
    </section>
  );
}
