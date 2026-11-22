"use client";
// CLI-02 (web): the requester chooses which of their request photos the eligible artisans may see
// before assignment, and can withdraw one, each after an explicit confirmation. Same server
// contract as the mobile app; the shared list is re-read after every choice (never assumed).
import { useEffect, useRef, useState } from "react";
import { api, ApiRequestError } from "../../app/api";
import { ConfirmAction } from "../../app/ui";
import { confirmsChoice, offerPhotoError, offerPhotosPath, OFFER_PHOTOS_COPY as COPY, parseSharedIds } from "./model";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type OfferPhotosPanelProps = {
  interventionId: string;
  photos: { id: string; name: string }[];
  /** Identity fence (uid + session generation): a late answer of another session is dropped. */
  context: { generation(): number; userId(): string | null };
  /** Tests only. */
  fetcher?: Fetcher;
};

export function OfferPhotosPanel(props: OfferPhotosPanelProps) {
  return <Body key={`${props.context.userId() ?? "-"}|${props.context.generation()}|${props.interventionId}`} {...props} />;
}

function Body({ interventionId, photos, context, fetcher }: OfferPhotosPanelProps) {
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
  if (!photos.length) return null;
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
              </li>
            );
          })}
        </ul>
      )}
      <p className="form-note">{COPY.keptNote}</p>
    </div>
  );
}
