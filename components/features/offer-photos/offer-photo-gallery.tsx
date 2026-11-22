"use client";
// CLI-02 (web, artisan side): the photos the client chose to show to the artisans eligible to an
// open offer, BEFORE assignment. Web counterpart of the mobile OfferPhotoGallery, same contract:
//   GET /api/interventions/<id>/offer-photos          → { items: [{ id }] } (six at most)
//   GET /api/interventions/<id>/offer-photos?photo=<id> → re-encoded JPEG (session cookie)
// The server decides who is eligible (approved, covering artisan of a still-open offer); anyone
// else gets an empty list / 404. Nothing is cached, and nothing but the image is exposed (no
// file name, no address, no contact).
import { useEffect, useRef, useState } from "react";
import { api } from "../../app/api";
import { OFFER_GALLERY_COPY as COPY, offerPhotoSrc, offerPhotosPath, parseSharedIds } from "./model";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type OfferPhotoGalleryProps = {
  interventionId: string;
  /** Identity fence (uid + session generation): a late answer of another session is dropped. */
  context: { generation(): number; userId(): string | null };
  /** Tests only. */
  fetcher?: Fetcher;
  initial?: string[];
};

export function OfferPhotoGallery(props: OfferPhotoGalleryProps) {
  return <Body key={`${props.context.userId() ?? "-"}|${props.context.generation()}|${props.interventionId}`} {...props} />;
}

function Body({ interventionId, context, fetcher, initial }: OfferPhotoGalleryProps) {
  const [items, setItems] = useState<string[] | null | "error">(initial ?? null);
  const [reload, setReload] = useState(0);
  const who = useRef({ uid: context.userId(), gen: context.generation() });
  const latest = useRef({ fetcher });
  latest.current = { fetcher };
  const path = offerPhotosPath(interventionId);
  useEffect(() => {
    if (initial && reload === 0) return;
    let active = true;
    const same = () => context.userId() === who.current.uid && context.generation() === who.current.gen;
    void api<unknown>(path, undefined, "GET", latest.current.fetcher)
      .then((body) => {
        if (active && same()) setItems(parseSharedIds(body) ?? "error");
      })
      .catch(() => {
        if (active && same()) setItems("error");
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, reload]);
  return (
    <section data-offer-gallery={items === null ? "loading" : items === "error" ? "error" : "ready"} aria-label={COPY.title} style={{ display: "grid", gap: 10 }}>
      <h3 style={{ margin: 0 }}>{COPY.title}</h3>
      {items === null && <p className="form-note" role="status">{COPY.loading}</p>}
      {items === "error" && (
        <p className="alert error" role="alert">
          {COPY.loadFailed}{" "}
          <button type="button" className="button outline" onClick={() => { setItems(null); setReload((n) => n + 1); }}>Réessayer</button>
        </p>
      )}
      {Array.isArray(items) && !items.length && <p className="form-note" data-offer-gallery-empty="">{COPY.empty}</p>}
      {Array.isArray(items) && items.length > 0 && (
        <>
          <p className="form-note">{COPY.intro}</p>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 220px), 1fr))" }}>
            {items.map((id, index) => (
              <li key={id} data-offer-gallery-photo={id}>
                <Photo src={offerPhotoSrc(interventionId, id)} index={index + 1} />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function Photo({ src, index }: { src: string; index: number }) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  if (failed)
    return (
      <p className="form-note" role="status" data-offer-gallery-photo-error="">
        {COPY.photoFailed}{" "}
        <button type="button" className="button outline" onClick={() => { setFailed(false); setAttempt((n) => n + 1); }}>{COPY.reloadPhoto}</button>
      </p>
    );
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={attempt}
      src={attempt ? `${src}#${attempt}` : src}
      alt={`Photo partagée par le client ${index}`}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      style={{ width: "100%", maxHeight: 260, objectFit: "contain", borderRadius: 12, background: "var(--surface-2, #f3f4f6)" }}
    />
  );
}
