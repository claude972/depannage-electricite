"use client";
// Photos still being sent (or failed) for the dossier currently open. Retrying only re-sends
// the files that are not yet stored; the dossier itself is never recreated.
import type { Session } from "./session-types";
import { Icon } from "./icons";

export function UploadQueuePanel({ session, interventionId }: { session: Session; interventionId: string }) {
  const queue = session.uploads;
  if (!queue || queue.interventionId !== interventionId) return null;
  const failed = queue.items.filter((i) => i.status === "failed").length;
  const uploading = queue.items.some((i) => i.status === "uploading" || i.status === "pending");
  return (
    <section className="panel upload-queue" aria-labelledby="upload-queue-title" aria-live="polite">
      <h2 id="upload-queue-title">Photos de la demande</h2>
      <p>
        {uploading
          ? "Envoi des photos en cours. Vous pouvez rester sur cette page."
          : failed
            ? "Certaines photos n’ont pas été enregistrées. La demande, elle, est bien créée."
            : "Toutes les photos sont enregistrées."}
      </p>
      <ul>
        {queue.items.map((item) => (
          <li key={item.key} data-status={item.status}>
            <Icon
              name={item.status === "done" ? "check" : item.status === "failed" ? "warning" : "upload"}
              size={16}
            />
            <div>
              <span>{item.file.name}</span>
              <small>
                {item.status === "done"
                  ? "Enregistrée dans le dossier"
                  : item.status === "failed"
                    ? item.error || "Envoi refusé"
                    : item.status === "uploading"
                      ? "Envoi…"
                      : "En attente"}
              </small>
            </div>
          </li>
        ))}
      </ul>
      {!uploading && (
        <div className="upload-queue-actions">
          {failed > 0 && (
            <button type="button" className="button primary" disabled={session.busy} onClick={() => void session.retryUploads()}>
              <Icon name="refresh" size={16} />
              Réessayer les {failed} photo{failed > 1 ? "s" : ""} en échec
            </button>
          )}
          <button type="button" className="button outline" disabled={session.busy} onClick={session.dismissUploads}>
            {failed ? "Abandonner ces photos" : "Fermer"}
          </button>
        </div>
      )}
    </section>
  );
}
