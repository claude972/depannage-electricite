"use client";
// Photos still being sent (or failed) for the dossier currently open. Retrying only re-sends
// the files that are not yet stored; the dossier itself is never recreated.
import type { Session } from "./session-types";
import { Icon } from "./icons";

export function UploadQueuePanel({ session, interventionId }: { session: Session; interventionId: string }) {
  const queue = session.uploads.find((q) => q.interventionId === interventionId);
  if (!queue) return null;
  const failed = queue.items.filter((i) => i.status === "failed").length;
  const uncertain = queue.items.filter((i) => i.status === "uncertain").length;
  const uploading = queue.items.some((i) => i.status === "uploading" || i.status === "pending");
  return (
    <section className="panel upload-queue" aria-labelledby="upload-queue-title" aria-live="polite">
      <h2 id="upload-queue-title">Photos de la demande</h2>
      <p>
        {uploading
          ? "Envoi des photos en cours. Vous pouvez rester sur cette page."
          : uncertain
            ? "L’envoi de certaines photos a été interrompu : elles ont pu être enregistrées. Vérifiez les photos du dossier avant tout renvoi. La demande, elle, est bien créée."
            : failed
              ? "Certaines photos ont été refusées. La demande, elle, est bien créée."
              : "Toutes les photos sont enregistrées."}
      </p>
      <ul>
        {queue.items.map((item) => (
          <li key={item.key} data-status={item.status}>
            <Icon
              name={
                item.status === "done"
                  ? "check"
                  : item.status === "failed"
                    ? "warning"
                    : item.status === "uncertain"
                      ? "help"
                      : "upload"
              }
              size={16}
            />
            <div>
              <span>{item.file.name}</span>
              <small>
                {item.status === "done"
                  ? "Enregistrée dans le dossier"
                  : item.status === "failed"
                    ? item.error || "Envoi refusé"
                    : item.status === "uncertain"
                      ? "Résultat incertain : a pu être enregistrée"
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
          {(failed > 0 || uncertain > 0) && (
            <button
              type="button"
              className="button primary"
              disabled={session.busy}
              onClick={() => void session.retryUploads(interventionId)}
            >
              <Icon name="refresh" size={16} />
              {uncertain > 0
                ? "Vérifier le dossier et renvoyer les photos refusées"
                : `Réessayer les ${failed} photo${failed > 1 ? "s" : ""} refusée${failed > 1 ? "s" : ""}`}
            </button>
          )}
          {uncertain > 0 && (
            <button
              type="button"
              className="button outline"
              disabled={session.busy}
              onClick={() => void session.retryUploads(interventionId, { resendUncertain: true })}
            >
              Renvoyer aussi les photos incertaines (risque de doublon)
            </button>
          )}
          <button
            type="button"
            className="button outline"
            disabled={session.busy}
            onClick={() => session.dismissUploads(interventionId)}
          >
            {failed || uncertain ? "Abandonner ces photos" : "Fermer"}
          </button>
        </div>
      )}
    </section>
  );
}
