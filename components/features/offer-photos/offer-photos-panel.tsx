"use client";
// CLI-02 (web): the requester chooses which of their request photos the eligible artisans may see
// before assignment, and can withdraw one, each after an explicit confirmation. Same server
// contract as the mobile app; the shared list is re-read after every choice (never assumed).
import { useEffect, useRef, useState } from "react";
import { api, ApiRequestError } from "../../app/api";
import { ConfirmAction } from "../../app/ui";
import { confirmsChoice, confirmsDeletion, deletePhotoError, deletePhotoPath, offerPhotoError, offerPhotosPath, OFFER_PHOTOS_COPY as COPY, parseSharedIds } from "./model";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type OfferPhotosPanelProps = {
  interventionId: string;
  photos: { id: string; name: string }[];
  /** Identity fence (uid + session generation): a late answer of another session is dropped. */
  context: { generation(): number; userId(): string | null };
  /** Called after the server confirmed a deletion (the host re-reads its documents). */
  onDeleted?: (documentId: string) => void;
  /** Tests only. */
  fetcher?: Fetcher;
};

export function OfferPhotosPanel(props: OfferPhotosPanelProps) {
  return <Body key={`${props.context.userId() ?? "-"}|${props.context.generation()}|${props.interventionId}`} {...props} />;
}

function Body({ interventionId, photos: allPhotos, context, fetcher, onDeleted }: OfferPhotosPanelProps) {
  // Deleted here and confirmed by the server: hidden at once, before the host list is re-read.
  const [deleted, setDeleted] = useState<string[]>([]);
  const photos = allPhotos.filter((photo) => !deleted.includes(photo.id));
  const [shared, setShared] = useState<string[] | null | "error">(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);
  const lock = useRef(false);
  const latest = useRef({ fetcher });
  latest.current = { fetcher };
  const path = offerPhotosPath(interventionId);
  const who = useRef({ uid: context.userId(), gen: context.generation() });
  const same = () => context.userId() === who.current.uid && context.generation() === who.current.gen;
  useEffect(() => {
    let active = true;
    void api<unknown>(path, undefined, "GET", latest.current.fetcher)
      .then((body) => {
        if (active && same()) setShared(parseSharedIds(body) ?? "error");
      })
      .catch(() => {
        if (active && same()) setShared("error");
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, reload]);
  async function choose(documentId: string, next: boolean) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const body = await api<unknown>(path, { document_id: documentId, shared: next }, "POST", latest.current.fetcher);
      if (!same()) return;
      if (!confirmsChoice(body, next)) setError(offerPhotoError(503, next));
      else setNotice(next ? COPY.sharedDone : COPY.withdrawnDone);
    } catch (e) {
      if (same()) setError(offerPhotoError(e instanceof ApiRequestError ? e.status : 0, next));
    } finally {
      lock.current = false;
      if (same()) {
        setBusy(false);
        setReload((n) => n + 1); // the displayed state is always the server's
      }
    }
  }
  async function remove(documentId: string) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const body = await api<unknown>(deletePhotoPath(documentId), undefined, "DELETE", latest.current.fetcher);
      if (!same()) return;
      if (!confirmsDeletion(body, documentId)) setError(deletePhotoError(503));
      else {
        setDeleted((ids) => [...ids, documentId]);
        setNotice(COPY.removedDone);
        onDeleted?.(documentId);
      }
    } catch (e) {
      if (same()) setError(deletePhotoError(e instanceof ApiRequestError ? e.status : 0));
    } finally {
      lock.current = false;
      if (same()) {
        setBusy(false);
        setReload((n) => n + 1);
      }
    }
  }
  if (!photos.length)
    return notice ? (
      <div data-offer-photos="">
        <p className="alert success" role="status" data-offer-photos-notice="">{notice}</p>
      </div>
    ) : null;
  return (
    <div data-offer-photos="">
      <h3>{COPY.title}</h3>
      <p className="form-note">{COPY.intro}</p>
      {error && (
        <p className="alert error" role="alert" data-offer-photos-error="">
          {error}
        </p>
      )}
      {notice && (
        <p className="alert success" role="status" data-offer-photos-notice="">
          {notice}
        </p>
      )}
      {shared === null && <p className="form-note" role="status">{COPY.loading}</p>}
      {shared === "error" && (
        <p className="alert error" role="alert">
          {COPY.loadFailed}{" "}
          <button type="button" className="button outline" onClick={() => { setShared(null); setReload((n) => n + 1); }}>
            Réessayer
          </button>
        </p>
      )}
      {Array.isArray(shared) && (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
          {photos.map((photo) => {
            const isShared = shared.includes(photo.id.toLowerCase());
            return (
              <li key={photo.id} data-offer-photo={photo.id} data-offer-photo-shared={isShared ? "true" : "false"}>
                <span>
                  {photo.name} <span className="subtle">— {isShared ? COPY.shared : COPY.private}</span>
                </span>
                <ConfirmAction
                  label={isShared ? COPY.withdraw : COPY.share}
                  message={isShared ? COPY.withdrawConfirm : COPY.shareConfirm}
                  confirmLabel={isShared ? COPY.withdrawDo : COPY.shareDo}
                  busy={busy}
                  onConfirm={() => choose(photo.id, !isShared)}
                />
                <ConfirmAction label={COPY.remove} message={COPY.removeConfirm} confirmLabel={COPY.removeDo} danger busy={busy} onConfirm={() => remove(photo.id)} />
              </li>
            );
          })}
        </ul>
      )}
      <p className="form-note">{COPY.keptNote}</p>
    </div>
  );
}
