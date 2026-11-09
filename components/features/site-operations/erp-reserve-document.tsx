"use client";
// E67 — optional private document of the SAME site attached to a lifted ERP reserve (UI only).
// Reads the current pieces through GET /api/sites/<id>/documents (paged, cursor) and opens one
// through the same route (?id=, signed private URL, server rights). Every read is fenced on
// uid + generation + site: a reply for another identity or site, or after a newer read, is dropped;
// changing the key purges the list. Without an identity (demo) nothing is read.
import { useEffect, useRef, useState } from "react";
import { readRefused } from "../../app/refusal";
import { listUrl, parseAttachmentPage, request, signUrl } from "../site-attachments/model";
import styles from "./site-operations.module.css";

export type DocumentIdentity = { generation(): number; userId(): string | null };
export type SiteDocumentOption = { id: string; name: string };
type Phase = "idle" | "loading" | "ready" | "error" | "refused";
type ListState = { key: string; phase: Phase; docs: SiteDocumentOption[]; next: string | null; loadingMore: boolean; moreError: boolean; notice: string; error: string };
const initial = (key: string): ListState => ({ key, phase: "idle", docs: [], next: null, loadingMore: false, moreError: false, notice: "", error: "" });

export const RESERVE_DOC_COPY = {
  label: "Document de levée (facultatif)",
  choose: "Choisir un document du site",
  hide: "Masquer la liste",
  loading: "Chargement des documents du site…",
  empty: "Aucun document actuel sur ce site. La levée reste possible sans document.",
  failed: "Les documents du site n’ont pas pu être chargés.",
  refused401: "Votre session a expiré. Reconnectez-vous pour choisir un document.",
  refused: "Les documents de ce site ne sont pas accessibles avec vos droits.",
  retry: "Réessayer",
  more: "Afficher plus",
  moreFailed: "La suite n’a pas pu être chargée.",
  cursor: "La liste a changé : elle repart de la première page.",
  needsDate: "Saisissez la date de levée pour pouvoir joindre un document.",
  open: "Ouvrir",
  opening: "Ouverture…",
  openFailed: "Le document n’a pas pu être ouvert avec vos droits actuels.",
  remove: "Retirer le document",
  linked: "Document lié",
  unnamed: "Document privé du site",
} as const;

const keyOf = (identity: DocumentIdentity | undefined, siteId: string) => {
  const uid = identity?.userId();
  return identity && uid ? `${uid}|${identity.generation()}|${siteId}` : null;
};
const fetcher = () => (...a: Parameters<typeof fetch>) => fetch(...a);

/** Lazily loaded list of the site's current documents (name + id only), shared by the form items. */
export function useSiteDocumentOptions(siteId: string, identity: DocumentIdentity | undefined) {
  const key = keyOf(identity, siteId);
  const [state, setRaw] = useState<ListState>(() => initial(""));
  const ref = useRef(state);
  const set = (s: ListState) => {
    ref.current = s;
    setRaw(s);
  };
  const seq = useRef(0);
  const live = useRef({ identity, siteId, mounted: true });
  live.current = { identity, siteId, mounted: live.current.mounted };
  useEffect(() => {
    live.current.mounted = true;
    return () => {
      live.current.mounted = false;
      seq.current++;
    };
  }, []);
  const current = () => (live.current.mounted ? keyOf(live.current.identity, live.current.siteId) : null);
  // Identity or site changed: every pending reply is dropped and the shown names are purged.
  useEffect(() => {
    if (ref.current.key === (key ?? "")) return; // already started for this key (child effect first)
    seq.current++;
    set(initial(key ?? ""));
  }, [key]);
  const pick = (body: unknown) => {
    const p = parseAttachmentPage(body, siteId, "current");
    return p ? { docs: p.documents.map((d) => ({ id: d.id, name: d.name })), next: p.page.next_cursor } : null;
  };
  const first = (notice = "") => {
    if (!key) return;
    const my = ++seq.current, at = key;
    set({ ...initial(at), phase: "loading", notice });
    void request(fetcher(), listUrl(siteId, null, "current")).then((r) => {
      if (my !== seq.current || current() !== at) return; // late or for another identity/site
      if (readRefused(r.status)) return set({ ...initial(at), phase: "refused", error: r.status === 401 ? RESERVE_DOC_COPY.refused401 : RESERVE_DOC_COPY.refused });
      const p = r.status === 200 ? pick(r.body) : null;
      if (!p) return set({ ...initial(at), phase: "error", error: RESERVE_DOC_COPY.failed, notice });
      set({ ...initial(at), phase: "ready", docs: p.docs, next: p.next, notice });
    });
  };
  const more = () => {
    const s = ref.current;
    if (!key || s.key !== key || s.phase !== "ready" || !s.next || s.loadingMore) return;
    const my = seq.current, at = key, cursor = s.next;
    set({ ...s, loadingMore: true, moreError: false });
    void request(fetcher(), listUrl(siteId, cursor, "current")).then((r) => {
      if (my !== seq.current || current() !== at || ref.current.key !== at) return;
      if (r.status === 422) return first(RESERVE_DOC_COPY.cursor);
      if (readRefused(r.status)) return set({ ...initial(at), phase: "refused", error: r.status === 401 ? RESERVE_DOC_COPY.refused401 : RESERVE_DOC_COPY.refused });
      const p = r.status === 200 ? pick(r.body) : null;
      if (!p) return set({ ...ref.current, loadingMore: false, moreError: true });
      const seen = new Set(ref.current.docs.map((d) => d.id));
      set({ ...ref.current, docs: [...ref.current.docs, ...p.docs.filter((d) => !seen.has(d.id) && (seen.add(d.id), true))], next: p.next, loadingMore: false, moreError: false });
    });
  };
  const s = key && state.key === key ? state : initial(key ?? "");
  return {
    available: key !== null,
    state: s,
    /** First read on demand only (opening a picker); a loaded list is not re-read. */
    ensure: () => {
      if (key && (ref.current.key !== key || ref.current.phase === "idle")) first();
    },
    retry: () => first(),
    more,
    /** A refused opening re-reads the list (rights may have changed). */
    invalidate: () => {
      if (key && ref.current.key === key && ref.current.phase !== "idle") first();
    },
    current,
    key,
  };
}
export type SiteDocumentOptions = ReturnType<typeof useSiteDocumentOptions>;

/** Opens one private document of this site through GET …/documents?id= (server rights). */
export function OpenSiteDocument({ siteId, id, options }: { siteId: string; id: string; options: SiteDocumentOptions }) {
  const [state, setState] = useState<"idle" | "opening" | "error">("idle");
  const busy = useRef(false);
  if (!options.available) return null;
  const open = async () => {
    const at = options.key;
    if (busy.current || !at) return;
    busy.current = true;
    setState("opening");
    try {
      const r = await request(fetcher(), signUrl(siteId, id));
      if (options.current() !== at) return; // identity or site changed meanwhile: nothing shown
      const url = r.status === 200 && r.body && typeof r.body === "object" ? (r.body as { url?: unknown }).url : null;
      if (typeof url !== "string" || !url.startsWith("https://")) {
        setState("error");
        if (readRefused(r.status)) options.invalidate();
        return;
      }
      window.open(url, "_blank", "noopener,noreferrer");
      setState("idle");
    } finally {
      busy.current = false;
    }
  };
  return (
    <>
      <button type="button" className="text-button" style={{ minHeight: 44 }} disabled={state === "opening"} onClick={() => void open()} data-reserve-doc-open={id}>
        {state === "opening" ? RESERVE_DOC_COPY.opening : RESERVE_DOC_COPY.open}
      </button>
      {state === "error" && <span className="field-error" role="alert">{RESERVE_DOC_COPY.openFailed}</span>}
    </>
  );
}

/** Per lifted reserve: optional choice of one current document of the same site. */
export function ReserveDocumentPicker({
  index,
  siteId,
  enabled,
  value,
  options,
  onChange,
}: {
  index: number;
  siteId: string;
  /** Finding « reserve » with a lift date: only then can a document be linked. */
  enabled: boolean;
  value: { id: string; name: string | null } | null;
  options: SiteDocumentOptions;
  onChange(next: SiteDocumentOption | null): void;
}) {
  const [open, setOpen] = useState(false);
  const s = options.state;
  // An open list whose identity/site key changed (purged to idle) is read again for the new key.
  const { ensure } = options;
  useEffect(() => {
    if (open && enabled && s.phase === "idle") ensure();
  }, [open, enabled, s.phase, s.key, ensure]);
  const name = value ? (value.name ?? s.docs.find((d) => d.id === value.id)?.name ?? null) : null;
  const listId = `reserve-doc-list-${index}`;
  return (
    <div className={styles.reserveDoc} data-reserve-doc={index}>
      <span className={styles.muted}>{RESERVE_DOC_COPY.label} — point {index + 1}</span>
      {value && (
        <p className={styles.reserveDocLine}>
          <span>
            {RESERVE_DOC_COPY.linked} : <strong>{name ?? RESERVE_DOC_COPY.unnamed}</strong> <span className={styles.muted}>(réf. {value.id.slice(0, 8)})</span>
          </span>
          <OpenSiteDocument siteId={siteId} id={value.id} options={options} />
          <button type="button" className="text-button" style={{ minHeight: 44 }} onClick={() => onChange(null)}>{RESERVE_DOC_COPY.remove}</button>
        </p>
      )}
      {!enabled ? (
        <span className={styles.hint}>{RESERVE_DOC_COPY.needsDate}</span>
      ) : options.available ? (
        <>
          <button
            type="button"
            className="button outline"
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => {
              if (!open) options.ensure();
              setOpen(!open);
            }}
          >
            {open ? RESERVE_DOC_COPY.hide : RESERVE_DOC_COPY.choose}
          </button>
          {open && (
            <div id={listId} className={styles.reserveDocList}>
              {s.notice && <p className={styles.hint} role="status">{s.notice}</p>}
              {(s.phase === "loading" || s.phase === "idle") && <p role="status">{RESERVE_DOC_COPY.loading}</p>}
              {(s.phase === "error" || s.phase === "refused") && (
                <p className="field-error" role="alert">
                  {s.error}{" "}
                  <button type="button" className="text-button" style={{ minHeight: 44 }} onClick={options.retry}>{RESERVE_DOC_COPY.retry}</button>
                </p>
              )}
              {s.phase === "ready" && s.docs.length === 0 && <p>{RESERVE_DOC_COPY.empty}</p>}
              {s.phase === "ready" && s.docs.length > 0 && (
                <ul className={styles.plain} aria-label={`Documents du site pour le point ${index + 1}`}>
                  {s.docs.map((d) => (
                    <li key={d.id}>
                      <button
                        type="button"
                        className="text-button"
                        style={{ minHeight: 44, textAlign: "left" }}
                        aria-pressed={value?.id === d.id}
                        data-reserve-doc-choice={d.id}
                        onClick={() => {
                          onChange(d);
                          setOpen(false);
                        }}
                      >
                        {d.name}
                      </button>
                      <span className={styles.muted}>réf. {d.id.slice(0, 8)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {s.phase === "ready" && s.next && (
                <button type="button" className="button outline" disabled={s.loadingMore} onClick={options.more}>{s.loadingMore ? RESERVE_DOC_COPY.loading : RESERVE_DOC_COPY.more}</button>
              )}
              {s.moreError && <p className="field-error" role="alert">{RESERVE_DOC_COPY.moreFailed}</p>}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
