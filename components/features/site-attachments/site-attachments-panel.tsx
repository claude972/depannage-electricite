"use client";
// ENT-04 / SYS-06 — « Pièces du site »: paged list of the site's own documents, private opening by
// signed URL, and (managers of an active site only) upload. Every read and command is bound to
// identity (uid + generation) + organisation + site; replies of another key, after unmount or after a
// newer read are dropped. After an uncertain upload the list is re-read; the chosen file and kind
// stay in the form and are resent only by an explicit action.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { validateUpload } from "../../app/api";
import { ATTACH_COPY as COPY, KIND_LABEL, SITE_ATTACHMENT_KINDS, listUrl, parseAttachmentPage, request, signUrl, uploadOutcome, uploadUrl, type AttachmentKind, type Context, type SiteAttachment } from "./model";

type ListState = { key: string; phase: "loading" | "ready" | "error" | "refused"; docs: SiteAttachment[]; next: string | null; loadingMore: boolean; moreError: boolean; error: string; notice: string };
const initial = (key: string): ListState => ({ key, phase: "loading", docs: [], next: null, loadingMore: false, moreError: false, error: "", notice: "" });
const day = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });

export function SiteAttachmentsPanel({ siteId, organizationId, context, canUpload, archived, demo = false, fetcher, headingId = "site-attachments" }: { siteId: string; organizationId: string | null | undefined; context: Context; /** UI cap (server can_manage_site stays the authority). */ canUpload: boolean; archived: boolean; demo?: boolean; fetcher?: typeof fetch; headingId?: string }) {
  const uid = context.userId();
  const base = !demo && uid && organizationId ? `${uid}|${context.generation()}|${organizationId}|${siteId}` : null;
  const [nonce, setNonce] = useState(0);
  const key = base ? `${base}|${nonce}` : null;
  const [state, setRaw] = useState<ListState>(() => initial(""));
  const ref = useRef(state);
  const set = (s: ListState) => {
    ref.current = s;
    setRaw(s);
  };
  const latest = useRef({ context, fetcher, organizationId });
  useEffect(() => {
    latest.current = { context, fetcher, organizationId };
  });
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const currentBase = () => {
    const c = latest.current.context, u = c.userId();
    return mounted.current && !demo && u && latest.current.organizationId ? `${u}|${c.generation()}|${latest.current.organizationId}|${siteId}` : null;
  };
  const f = () => latest.current.fetcher ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const seq = useRef(0);
  const first = (k: string, notice = "") => {
    const my = ++seq.current, at = base;
    set({ ...initial(k), notice });
    void request(f(), listUrl(siteId, null)).then((r) => {
      if (my !== seq.current || !at || currentBase() !== at) return; // late: dropped
      if (r.status === 401 || r.status === 403 || r.status === 404) return set({ ...initial(k), phase: "refused", error: r.status === 401 ? COPY.refused401 : COPY.refused });
      const p = r.status === 200 ? parseAttachmentPage(r.body, siteId) : null;
      if (!p) return set({ ...initial(k), phase: "error", error: COPY.failed, notice });
      set({ ...initial(k), phase: "ready", docs: p.documents, next: p.page.next_cursor, notice });
    });
  };
  useEffect(() => {
    if (!key) return;
    first(key);
    return () => {
      seq.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const more = () => {
    const s = ref.current;
    if (!key || s.key !== key || s.phase !== "ready" || !s.next || s.loadingMore) return;
    const my = seq.current, at = base, cursor = s.next;
    set({ ...s, loadingMore: true, moreError: false });
    void request(f(), listUrl(siteId, cursor)).then((r) => {
      if (my !== seq.current || !at || currentBase() !== at || ref.current.key !== key) return;
      if (r.status === 422) return first(key, COPY.cursor);
      if (r.status === 401 || r.status === 403 || r.status === 404) return set({ ...initial(key), phase: "refused", error: r.status === 401 ? COPY.refused401 : COPY.refused });
      const p = r.status === 200 ? parseAttachmentPage(r.body, siteId) : null;
      if (!p) return set({ ...ref.current, loadingMore: false, moreError: true });
      const seen = new Set(ref.current.docs.map((d) => d.id));
      set({ ...ref.current, docs: [...ref.current.docs, ...p.documents.filter((d) => !seen.has(d.id) && (seen.add(d.id), true))], next: p.page.next_cursor, loadingMore: false, moreError: false });
    });
  };

  // Private opening (signed URL, https only), fenced on the same key.
  const [opening, setOpening] = useState<string | null>(null);
  const [openError, setOpenError] = useState("");
  const open = async (id: string) => {
    if (opening || !base) return;
    const at = base;
    setOpening(id);
    setOpenError("");
    const r = await request(f(), signUrl(siteId, id));
    if (currentBase() !== at) return;
    setOpening(null);
    const url = r.status === 200 && r.body && typeof r.body === "object" ? (r.body as { url?: unknown }).url : null;
    if (typeof url !== "string" || !url.startsWith("https://")) return setOpenError(COPY.openFailed);
    window.open(url, "_blank", "noopener,noreferrer");
  };

  // Upload (managers of an active site, live only). One send at a time; no automatic resend.
  const allowUpload = canUpload && !archived && !demo && Boolean(base);
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<AttachmentKind>("plan");
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [uploadMsg, setUploadMsg] = useState<{ tone: "error" | "ok" | "uncertain"; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const upload = async (e: FormEvent) => {
    e.preventDefault();
    if (!allowUpload || sendingRef.current || !file || !base) return;
    const invalid = validateUpload(file);
    if (invalid) return setUploadMsg({ tone: "error", text: invalid });
    const at = base, sentKind = kind;
    sendingRef.current = true;
    setSending(true);
    setUploadMsg(null);
    const body = new FormData();
    body.append("file", file);
    body.append("kind", sentKind);
    const r = await request(f(), uploadUrl(siteId), { method: "POST", body }, 60_000);
    sendingRef.current = false;
    if (currentBase() !== at) return; // closed / identity changed: nothing applied
    setSending(false);
    const o = uploadOutcome(r, siteId, sentKind);
    if (o.kind === "done") {
      const s = ref.current;
      if (s.phase === "ready" && !s.docs.some((d) => d.id === o.document.id)) set({ ...s, docs: [o.document, ...s.docs] });
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      setUploadMsg({ tone: "ok", text: COPY.sent });
      return;
    }
    if (o.kind === "refused") return setUploadMsg({ tone: "error", text: o.message });
    // Uncertain: re-read the list; the file and kind stay; resend only on explicit action.
    setUploadMsg({ tone: "uncertain", text: COPY.uncertain });
    if (key) first(key);
  };

  const s = key && state.key === key ? state : initial(key ?? "");
  return (
    <section className="panel" aria-labelledby={headingId} data-site-attachments={key ? s.phase : demo ? "demo" : "refused"} aria-busy={s.phase === "loading" || s.loadingMore || sending || undefined}>
      <h2 id={headingId}>{COPY.title}</h2>
      <p className="form-note">{COPY.hint}</p>
      {demo ? (
        <p className="document-empty">En démonstration, aucune pièce n’est enregistrée.</p>
      ) : (
        <>
          {s.notice && <p className="form-note" role="status">{s.notice}</p>}
          {openError && <p className="field-error" role="alert">{openError}</p>}
          {!key && <p className="document-empty" role="alert">{COPY.refused}</p>}
          {key && s.phase === "loading" && <p className="document-empty" role="status">{COPY.loading}</p>}
          {s.phase === "refused" && <p className="document-empty" role="alert" data-site-attachments-refused="">{s.error}</p>}
          {s.phase === "error" && (
            <div role="alert">
              <p className="document-empty">{s.error}</p>
              <button type="button" className="button outline" onClick={() => setNonce((n) => n + 1)} data-site-attachments-retry="">Réessayer</button>
            </div>
          )}
          {s.phase === "ready" &&
            (s.docs.length ? (
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
                {s.docs.map((d) => (
                  <li key={d.id} data-site-attachment={d.id} style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", justifyContent: "space-between", minWidth: 0 }}>
                    <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>
                      <strong>{d.name}</strong>
                      <small style={{ display: "block" }}>{KIND_LABEL[d.kind]} · {day(d.created_at)}</small>
                    </span>
                    <button type="button" className="button outline" disabled={opening !== null} onClick={() => void open(d.id)} data-site-attachment-open={d.id}>
                      {opening === d.id ? "Ouverture…" : "Ouvrir"}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="document-empty" data-site-attachments-empty="">{COPY.empty}</p>
            ))}
          {s.moreError && <p className="field-error" role="alert">{COPY.moreFailed}</p>}
          {s.phase === "ready" && s.next && (
            <button type="button" className="button outline" disabled={s.loadingMore} onClick={more} data-site-attachments-more="">
              {s.loadingMore ? "Chargement…" : COPY.more}
            </button>
          )}
          {allowUpload ? (
            <form onSubmit={(e) => void upload(e)} noValidate data-site-attachments-upload={sending ? "sending" : "idle"}>
              <fieldset disabled={sending} style={{ border: 0, padding: 0, margin: "12px 0 0", minWidth: 0, display: "grid", gap: 8 }}>
                <label className="field">
                  <span>Type de pièce</span>
                  <select value={kind} onChange={(e) => setKind(e.target.value as AttachmentKind)}>
                    {SITE_ATTACHMENT_KINDS.map((k) => (
                      <option key={k} value={k}>{KIND_LABEL[k]}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Fichier</span>
                  <input ref={fileInput} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setUploadMsg(null); }} />
                </label>
                {uploadMsg && (
                  <p className={uploadMsg.tone === "ok" ? "form-note" : "field-error"} role={uploadMsg.tone === "ok" ? "status" : "alert"} data-site-attachments-message={uploadMsg.tone}>
                    {uploadMsg.text}
                  </p>
                )}
                <button type="submit" className="button primary" disabled={!file || sending || (uploadMsg?.tone === "uncertain" && s.phase === "loading")} data-site-attachments-send="">
                  {sending ? "Envoi…" : uploadMsg?.tone === "uncertain" ? "Renvoyer ce fichier" : "Ajouter la pièce"}
                </button>
              </fieldset>
            </form>
          ) : (
            <p className="form-note" data-site-attachments-readonly="">{COPY.readOnly}</p>
          )}
        </>
      )}
    </section>
  );
}
