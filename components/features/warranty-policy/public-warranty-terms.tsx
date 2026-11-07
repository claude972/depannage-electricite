"use client";
// Public warranty conditions: ONLY the published text, rendered as plain text (React text node,
// line breaks preserved by CSS; never interpreted as HTML). None published ⇒ the honest pending
// sentence; nothing is invented.
import { useEffect, useState } from "react";
import { PUBLIC_COPY, loadPublicTerms, type PublicTermsState } from "./model";
import styles from "./warranty-policy.module.css";

export function usePublishedWarrantyTerms(enabled: boolean, fetcher?: typeof fetch): PublicTermsState {
  const [state, setState] = useState<PublicTermsState>({ phase: "loading", published: null });
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void loadPublicTerms(fetcher).then((s) => alive && setState(s));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
  return state;
}

export function PublicWarrantyTerms({ state, headingId = "warranty-terms-title" }: { /** Tests only. */ state?: PublicTermsState; headingId?: string }) {
  const fetched = usePublishedWarrantyTerms(state === undefined);
  const s = state ?? fetched;
  return (
    <section className={`panel ${styles.publicPanel}`} aria-labelledby={headingId} data-warranty-terms={s.phase === "ready" ? (s.published ? "published" : "pending") : s.phase}>
      <h2 id={headingId}>{PUBLIC_COPY.title}</h2>
      {s.phase === "loading" && <p className={styles.muted} role="status">{PUBLIC_COPY.loading}</p>}
      {s.phase === "error" && <p className={styles.muted} role="status">{PUBLIC_COPY.error}</p>}
      {s.phase === "ready" && !s.published && <p className={styles.note} data-warranty-pending="">{PUBLIC_COPY.pending}</p>}
      {s.phase === "ready" && s.published && (
        <>
          <h3 className={styles.subtitle}>{s.published.title}</h3>
          <p className={styles.plain} data-warranty-body="">{s.published.body}</p>
          <p className={styles.muted} data-warranty-stamp="">{PUBLIC_COPY.stamp(s.published)}</p>
        </>
      )}
    </section>
  );
}
