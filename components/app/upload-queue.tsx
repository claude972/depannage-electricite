"use client";
// Photos still being sent (or failed) for the dossier currently open. Retrying only re-sends
// the files that are not yet stored; the dossier itself is never recreated.
import { useState } from "react";
import type { Session } from "./session-types";
import { Icon } from "./icons";
import { api } from "./api";
import { dateTime } from "./format";

// Opens a stored document in a new tab through its short-lived signed link, so the user can
// recognise the photo before confirming.
function OpenDocument({ id }: { id: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <span className="upload-open">
      <button
        type="button"
        className="text-button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const result = await api<{ url: string }>(`/api/documents?id=${encodeURIComponent(id)}`);
            if (!result.url?.startsWith("https://")) throw new Error("Le lien d’ouverture est indisponible.");
            window.open(result.url, "_blank", "noopener,noreferrer");
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Icon name="eye" size={14} />
        {busy ? "Ouverture…" : "Ouvrir"}
      </button>
      {error && <small role="alert">{error}</small>}
    </span>
  );
}
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
            ? "L’envoi de certaines photos a été interrompu : elles ont pu être enregistrées. L’application ne peut pas le vérifier seule : ouvrez les documents proposés pour reconnaître votre photo, puis confirmez ou renvoyez. La demande, elle, est bien créée."
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
              {item.status === "uncertain" && item.candidates && (
                <div className="upload-candidates">
                  {item.candidates.length ? (
                    <>
                      <small>Documents du dossier portant le même nom :</small>
                      <ul>
                        {item.candidates.map((c) => (
                          <li key={c.id}>
                            <span>
                              {c.name} · {dateTime(c.created_at)}
                            </span>
                            <OpenDocument id={c.id} />
                            <button
                              type="button"
                              className="button outline"
                              disabled={session.busy}
                              onClick={() => session.acknowledgeUpload(interventionId, item.key, c.id)}
                            >
                              C’est bien cette photo
                            </button>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <small>
                      Aucun document de ce nom parmi les documents chargés (liste limitée). Vérifiez le dossier
                      avant de renvoyer : la photo reste incertaine.
                    </small>
                  )}
                </div>
              )}
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
                ? "Vérifier le dossier" + (failed ? " et renvoyer les photos refusées" : "")
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
              Renvoyer les photos incertaines (doublon possible si elles étaient enregistrées)
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
