"use client";
// SYS-06 — validity and version history of credentials, shown to the administrator (artisan file) and
// to the artisan (« Mes documents »). Read-only: built from the credentials already loaded. The
// current version of each kind carries its validity state; replaced versions are listed as such.
import { EXPIRING_SOON_DAYS, REQUIRED_CREDENTIAL_KINDS, credentialVersions, frenchDay, validitySummary, type CredentialRow } from "./credential-validity";
import styles from "./credential-reviews.module.css";

const KIND_LABEL: Record<string, string> = {
  registration: "Kbis ou inscription au registre",
  liability: "Assurance responsabilité civile professionnelle",
  qualification: "Diplôme ou qualification",
  other: "Autre justificatif",
};
const linked = (iso: string) => new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(new Date(iso));
const TONE_COLOR: Record<string, string> = { green: "var(--ui-success)", amber: "var(--ui-warning, #8a5a00)", red: "var(--ui-danger)", neutral: "var(--ui-text-muted)" };

export function CredentialValidityOverview({ credentials, today, audience, documentName }: { credentials: readonly CredentialRow[]; today: string; audience: "admin" | "artisan"; documentName?: (documentId: string | undefined) => string | null }) {
  const versions = credentialVersions(credentials, today);
  const summary = validitySummary(credentials, REQUIRED_CREDENTIAL_KINDS, today);
  const order = [...REQUIRED_CREDENTIAL_KINDS, "other"] as string[];
  const sorted = [...versions].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  return (
    <section className={styles.panel} aria-label="Validité et versions des justificatifs" data-credential-validity={summary.expired ? "expired" : summary.expiring ? "expiring" : summary.missing ? "missing" : "valid"}>
      <div className={styles.head}>
        <h3 className={styles.title}>Validité et versions des justificatifs</h3>
      </div>
      <p style={{ margin: 0 }} data-credential-validity-summary="" role="status">
        <strong>{summary.label}.</strong>
      </p>
      {summary.expired > 0 && (
        <p className={styles.meta} role="alert" data-credential-validity-alert="expired">
          {audience === "admin"
            ? "Une pièce expirée n’est pas comptée comme valide et ne peut pas être acceptée : demandez un document à jour avant toute approbation."
            : "Une pièce expirée n’est pas comptée comme valide : ajoutez un document à jour pour la remplacer."}
        </p>
      )}
      {sorted.length === 0 ? (
        <p className={styles.meta}>Aucun justificatif relié pour l’instant.</p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>
          {sorted.map((entry) => (
            <li key={entry.kind} data-credential-kind={entry.kind} data-credential-state={entry.validity.state}>
              <strong>{KIND_LABEL[entry.kind] ?? KIND_LABEL.other}</strong>
              <br />
              <span data-credential-current={entry.current.id}>
                Version en vigueur{documentName?.(entry.current.document_id) ? ` : ${documentName(entry.current.document_id)}` : ""} · reliée le {linked(entry.current.created_at)} ·{" "}
                <strong style={{ color: TONE_COLOR[entry.validity.tone] }}>{entry.validity.label}</strong>
              </span>
              {entry.superseded.length > 0 && (
                <ul style={{ margin: "4px 0 0", paddingLeft: 18 }} aria-label="Versions remplacées">
                  {entry.superseded.map((old) => (
                    <li key={old.id} className={styles.meta} data-credential-superseded={old.id}>
                      Version remplacée{documentName?.(old.document_id) ? ` : ${documentName(old.document_id)}` : ""} · reliée le {linked(old.created_at)}
                      {old.expires_on ? ` · validité déclarée jusqu’au ${frenchDay(old.expires_on)}` : " · sans date de validité"} · conservée dans l’historique, non prise en compte
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className={styles.meta}>
        « Expire bientôt » signale les {EXPIRING_SOON_DAYS} derniers jours de validité : c’est un avertissement d’affichage, rien n’est supprimé ni bloqué automatiquement.
      </p>
    </section>
  );
}
