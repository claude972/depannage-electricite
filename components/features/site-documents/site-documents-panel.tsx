"use client";
// ENT-04 — read-only documents of the exact site, paged from GET /api/documents/history?site_id=…
// Bound at render to identity (uid + generation) + organisation + site; a reply for another key or
// sequence is dropped. 401/403/404 clear everything. Opening a document uses the existing signed
// route (GET /api/documents?id=…); opening its dossier uses the host's exact navigation.
import { useEffect, useRef, useState } from "react";
import type { StoredDocument } from "../../app/types";
import { api } from "../../app/api";
import { SITE_DOCS_COPY as COPY, fetchSiteDocuments, type Context } from "./model";

type State = {
  key: string;
  phase: "loading" | "ready" | "error" | "refused";
  docs: StoredDocument[];
  next: string | null;
  loadingMore: boolean;
  moreError: boolean;
  notice: string;
  error: string;
  retryAt: number;
};
const initial = (key: string): State => ({ key, phase: "loading", docs: [], next: null, loadingMore: false, moreError: false, notice: "", error: "", retryAt: 0 });
const day = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
const ref6 = (id: string) => `INT-${id.slice(0, 6).toUpperCase()}`;

export function SiteDocumentsPanel({ siteId, organizationId, context, onOpenDossier, fetcher, headingId = "site-docs" }: { siteId: string; organizationId: string | null | undefined; context: Context; onOpenDossier?: (interventionId: string) => void; fetcher?: typeof fetch; headingId?: string }) {
  const uid = context.userId();
  const base = uid && organizationId ? `${uid}|${context.generation()}|${organizationId}|${siteId}` : null;
  const [nonce, setNonce] = useState(0);
  const key = base ? `${base}|${nonce}` : null;
  const [state, setRaw] = useState<State>(() => initial(""));
  const ref = useRef(state);
  const set = (s: State) => {
    ref.current = s;
    setRaw(s);
  };
  const latest = useRef({ context, fetcher, organizationId });
  useEffect(() => {
    latest.current = { context, fetcher, organizationId };
  });
  const seq = useRef(0);
  const currentBase = () => {
    const c = latest.current.context, u = c.userId();
    return u && latest.current.organizationId ? `${u}|${c.generation()}|${latest.current.organizationId}|${siteId}` : null;
  };
  const f = () => latest.current.fetcher ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const first = (k: string, notice = "") => {
    const my = ++seq.current;
    set({ ...initial(k), notice });
    void fetchSiteDocuments(f(), siteId, null).then((o) => {
      if (my !== seq.current || currentBase() !== base) return; // late: dropped
      if (o.kind === "refused") return set({ ...initial(k), phase: "refused", error: o.status === 401 ? COPY.refused401 : COPY.refused });
      if (o.kind !== "loaded") return set({ ...initial(k), phase: "error", error: COPY.failed, notice, retryAt: Date.now() + (o.kind === "failed" ? o.retryAfterS : 2) * 1000 });
      set({ ...initial(k), phase: "ready", docs: o.documents, next: o.nextCursor, notice });
    });
  };
  useEffect(() => {
    if (!key) return;
    first(key);
    return () => {
      seq.current++;
    };
    // key = identity + organisation + site + retry nonce
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const more = () => {
    const s = ref.current;
    if (!key || s.key !== key || s.phase !== "ready" || !s.next || s.loadingMore) return;
    const my = seq.current, cursor = s.next;
    set({ ...s, loadingMore: true, moreError: false });
    void fetchSiteDocuments(f(), siteId, cursor).then((o) => {
      if (my !== seq.current || currentBase() !== base || ref.current.key !== key) return;
      if (o.kind === "cursor") return first(key, COPY.cursor);
      if (o.kind === "refused") return set({ ...initial(key), phase: "refused", error: o.status === 401 ? COPY.refused401 : COPY.refused });
      if (o.kind !== "loaded") return set({ ...ref.current, loadingMore: false, moreError: true });
      const seen = new Set(ref.current.docs.map((d) => d.id));
      set({ ...ref.current, docs: [...ref.current.docs, ...o.documents.filter((d) => !seen.has(d.id) && (seen.add(d.id), true))], next: o.nextCursor, loadingMore: false, moreError: false });
    });
  };
  // Opening one document: the existing signed route, fenced on the same key.
  const [opening, setOpening] = useState<string | null>(null);
  const [openError, setOpenError] = useState("");
  const open = async (id: string) => {
    if (opening) return;
    const at = currentBase();
    setOpening(id);
    setOpenError("");
    try {
      const r = await api<{ url: string }>(`/api/documents?id=${encodeURIComponent(id)}`, undefined, "GET", latest.current.fetcher ? (p, init) => latest.current.fetcher!(p, init) : undefined);
      if (currentBase() !== at) return;
      if (typeof r?.url !== "string" || !r.url.startsWith("https://")) throw new Error(COPY.openFailed);
      window.open(r.url, "_blank", "noopener,noreferrer");
    } catch (e) {
      if (currentBase() === at) setOpenError((e as Error).message || COPY.openFailed);
    } finally {
      if (currentBase() === at) setOpening(null);
    }
  };
  const s = key && state.key === key ? state : initial(key ?? "");
  const waiting = s.phase === "error" && s.retryAt > Date.now();
  return (
    <section className="panel" aria-labelledby={headingId} data-site-documents={key ? s.phase : "refused"} aria-busy={s.phase === "loading" || s.loadingMore || undefined}>
      <h2 id={headingId}>Documents</h2>
      {s.notice && <p className="form-note" role="status">{s.notice}</p>}
      {openError && <p className="field-error" role="alert">{openError}</p>}
      {!key && <p className="document-empty" role="alert">{COPY.refused}</p>}
      {key && s.phase === "loading" && <p className="document-empty" role="status">{COPY.loading}</p>}
      {s.phase === "refused" && <p className="document-empty" role="alert" data-site-documents-refused="">{s.error}</p>}
      {s.phase === "error" && (
        <div role="alert">
          <p className="document-empty">{s.error}</p>
          <button type="button" className="button outline" disabled={waiting} onClick={() => setNonce((n) => n + 1)} data-site-documents-retry="">
            Réessayer
          </button>
        </div>
      )}
      {s.phase === "ready" &&
        (s.docs.length ? (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
            {s.docs.map((d) => (
              <li key={d.id} data-site-document={d.id} style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", justifyContent: "space-between", minWidth: 0 }}>
                <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>
                  <strong>{d.name}</strong>
                  <small style={{ display: "block" }}>
                    {d.intervention_id ? `${ref6(d.intervention_id)} · ` : ""}
                    {day(d.created_at)}
                  </small>
                </span>
                <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button type="button" className="button outline" disabled={opening !== null} onClick={() => void open(d.id)} data-site-document-open={d.id}>
                    {opening === d.id ? "Ouverture…" : "Ouvrir"}
                  </button>
                  {d.intervention_id && onOpenDossier && (
                    <button type="button" className="button outline" onClick={() => onOpenDossier(d.intervention_id!)} data-site-document-dossier={d.intervention_id}>
                      Voir le dossier
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="document-empty" data-site-documents-empty="">{COPY.empty}</p>
        ))}
      {s.moreError && <p className="field-error" role="alert">{COPY.moreFailed}</p>}
      {s.phase === "ready" && s.next && (
        <button type="button" className="button outline" disabled={s.loadingMore} onClick={more} data-site-documents-more="">
          {s.loadingMore ? "Chargement…" : COPY.more}
        </button>
      )}
      <p className="form-note">{COPY.note}</p>
    </section>
  );
}
