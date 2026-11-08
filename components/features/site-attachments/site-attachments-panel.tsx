"use client";
// ENT-04 / SYS-06 — « Pièces du site »: « Actuelles » and « Historique » (each its own paged read and
// cursor), private opening by signed URL, and — managers of an ACTIVE site only — upload, replacement
// (new version of a current piece, original kind kept) and archive / restore (with confirmation, only
// for a piece that was not replaced). Every read and command is bound to identity (uid + generation)
// + organisation + site; replies of another key, after unmount or after a newer read are dropped.
// Nothing is ever replayed automatically: an uncertain write re-reads the lists, keeps the form and
// waits for an explicit action; a PATCH 409 (revision) re-reads, never replays.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { validateUpload } from "../../app/api";
import {
  ATTACH_COPY as COPY,
  KIND_LABEL,
  SITE_ATTACHMENT_KINDS,
  listUrl,
  parseAttachmentPage,
  patchOutcome,
  request,
  signUrl,
  uploadOutcome,
  uploadUrl,
  type AttachmentKind,
  type AttachmentView,
  type Context,
  type SiteAttachment,
} from "./model";

type ListState = { key: string; phase: "loading" | "ready" | "error" | "refused"; docs: SiteAttachment[]; next: string | null; loadingMore: boolean; moreError: boolean; error: string; notice: string };
const initial = (key: string): ListState => ({ key, phase: "loading", docs: [], next: null, loadingMore: false, moreError: false, error: "", notice: "" });
const day = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });

type Fence = { base: string | null; current: () => string | null; fetch: () => typeof fetch };

/** One paged list (current or history) with its own cursor; re-read by bumping `epoch`. */
function useAttachmentList(view: AttachmentView, siteId: string, fence: Fence, enabled: boolean, epoch: number) {
  const [nonce, setNonce] = useState(0);
  const key = fence.base && enabled ? `${fence.base}|${view}|${epoch}|${nonce}` : null;
  const [state, setRaw] = useState<ListState>(() => initial(""));
  const ref = useRef(state);
  const set = (s: ListState) => {
    ref.current = s;
    setRaw(s);
  };
  const seq = useRef(0);
  const fenceRef = useRef(fence);
  fenceRef.current = fence;
  const first = (k: string, notice = "") => {
    const my = ++seq.current, at = fenceRef.current.base;
    set({ ...initial(k), notice });
    void request(fenceRef.current.fetch(), listUrl(siteId, null, view)).then((r) => {
      if (my !== seq.current || !at || fenceRef.current.current() !== at) return; // late: dropped
      if (r.status === 401 || r.status === 403 || r.status === 404) return set({ ...initial(k), phase: "refused", error: r.status === 401 ? COPY.refused401 : COPY.refused });
      const p = r.status === 200 ? parseAttachmentPage(r.body, siteId, view) : null;
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
    const my = seq.current, at = fenceRef.current.base, cursor = s.next;
    set({ ...s, loadingMore: true, moreError: false });
    void request(fenceRef.current.fetch(), listUrl(siteId, cursor, view)).then((r) => {
      if (my !== seq.current || !at || fenceRef.current.current() !== at || ref.current.key !== key) return;
      if (r.status === 422) return first(key, COPY.cursor);
      if (r.status === 401 || r.status === 403 || r.status === 404) return set({ ...initial(key), phase: "refused", error: r.status === 401 ? COPY.refused401 : COPY.refused });
      const p = r.status === 200 ? parseAttachmentPage(r.body, siteId, view) : null;
      if (!p) return set({ ...ref.current, loadingMore: false, moreError: true });
      const seen = new Set(ref.current.docs.map((d) => d.id));
      set({ ...ref.current, docs: [...ref.current.docs, ...p.documents.filter((d) => !seen.has(d.id) && (seen.add(d.id), true))], next: p.page.next_cursor, loadingMore: false, moreError: false });
    });
  };
  const s = key && state.key === key ? state : initial(key ?? "");
  return { state: s, more, retry: () => setNonce((n) => n + 1), key };
}

export function SiteAttachmentsPanel({ siteId, organizationId, context, canUpload, archived, demo = false, fetcher, headingId = "site-attachments" }: { siteId: string; organizationId: string | null | undefined; context: Context; /** UI cap (server can_manage_site stays the authority). */ canUpload: boolean; archived: boolean; demo?: boolean; fetcher?: typeof fetch; headingId?: string }) {
  const uid = context.userId();
  const base = !demo && uid && organizationId ? `${uid}|${context.generation()}|${organizationId}|${siteId}` : null;
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
  const fence: Fence = { base, current: currentBase, fetch: f };
  const [tab, setTab] = useState<AttachmentView>("current");
  const [historyOpened, setHistoryOpened] = useState(false);
  // Any confirmed or uncertain write invalidates both views (fresh page 1 of each).
  const [epoch, setEpoch] = useState(0);
  const reread = () => setEpoch((n) => n + 1);
  const current = useAttachmentList("current", siteId, fence, true, epoch);
  const history = useAttachmentList("history", siteId, fence, historyOpened, epoch);

  // Write rights: managers of an active site, live only; old versions are always read-only.
  const canWrite = canUpload && !archived && !demo && Boolean(base);

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

  // Upload / replacement. One write at a time; the form stays after an uncertain result.
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<AttachmentKind>("plan");
  const [replacing, setReplacing] = useState<SiteAttachment | null>(null);
  const [sending, setSending] = useState(false);
  const busyRef = useRef(false);
  const [message, setMessage] = useState<{ tone: "error" | "ok" | "uncertain"; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const resetForm = () => {
    setFile(null);
    setReplacing(null);
    if (fileInput.current) fileInput.current.value = "";
  };
  const upload = async (e: FormEvent) => {
    e.preventDefault();
    if (!canWrite || busyRef.current || !file || !base) return;
    const invalid = validateUpload(file);
    if (invalid) return setMessage({ tone: "error", text: invalid });
    const at = base, target = replacing, sentKind = target ? target.kind : kind; // replacement keeps the original kind
    busyRef.current = true;
    setSending(true);
    setMessage(null);
    const body = new FormData();
    body.append("file", file);
    body.append("kind", sentKind);
    if (target) body.append("replaces_id", target.id);
    const r = await request(f(), uploadUrl(siteId), { method: "POST", body }, 60_000);
    busyRef.current = false;
    if (currentBase() !== at) return; // closed / identity changed: nothing applied
    setSending(false);
    const o = uploadOutcome(r, siteId, sentKind, target);
    if (o.kind === "done") {
      resetForm();
      setMessage({ tone: "ok", text: target ? COPY.replaced : COPY.sent });
      reread();
      return;
    }
    if (o.kind === "refused") return setMessage({ tone: "error", text: o.message });
    setMessage({ tone: "uncertain", text: COPY.uncertain }); // file, kind and target kept
    reread();
  };

  // Archive / restore with confirmation (only for a piece that was not replaced).
  const [confirm, setConfirm] = useState<{ doc: SiteAttachment; action: "archive" | "restore" } | null>(null);
  const [patching, setPatching] = useState(false);
  const patch = async () => {
    if (!confirm || !canWrite || busyRef.current || !base || confirm.doc.replaced_at !== null) return;
    const at = base, { doc, action } = confirm;
    busyRef.current = true;
    setPatching(true);
    setMessage(null);
    const r = await request(f(), uploadUrl(siteId), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: doc.id, action, expected_revision: doc.revision }) });
    busyRef.current = false;
    if (currentBase() !== at) return;
    setPatching(false);
    setConfirm(null);
    const o = patchOutcome(r, siteId, doc.id, action, doc.revision);
    if (o.kind === "done") {
      setMessage({ tone: "ok", text: action === "archive" ? COPY.archived : COPY.restored });
      reread();
      return;
    }
    if (o.kind === "refused") return setMessage({ tone: "error", text: o.message });
    setMessage({ tone: "uncertain", text: o.kind === "conflict" ? COPY.conflict : COPY.patchUncertain });
    reread(); // never replayed
  };

  const list = tab === "current" ? current : history;
  const s = list.state;
  const locked = sending || patching;
  const row = (d: SiteAttachment) => {
    const isOld = d.replaced_at !== null;
    return (
      <li key={d.id} data-site-attachment={d.id} data-site-attachment-state={isOld ? "replaced" : d.archived_at ? "archived" : "current"} style={{ display: "grid", gap: 6, padding: "8px 0", borderBottom: "1px solid var(--ui-border)", minWidth: 0 }}>
        <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>
          <strong>{d.name}</strong>{" "}
          <span className="tag tag-neutral" data-site-attachment-version="">Version {d.version}</span>
          {isOld && <span className="tag tag-neutral"> Remplacée le {day(d.replaced_at!)}</span>}
          {!isOld && d.archived_at && <span className="tag tag-amber"> Archivée le {day(d.archived_at)}</span>}
          <small style={{ display: "block" }}>{KIND_LABEL[d.kind]} · déposée le {day(d.created_at)}</small>
        </span>
        <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="button outline" disabled={opening !== null} onClick={() => void open(d.id)} data-site-attachment-open={d.id}>
            {opening === d.id ? "Ouverture…" : "Ouvrir"}
          </button>
          {canWrite && !isOld && !d.archived_at && (
            <>
              <button type="button" className="button outline" disabled={locked} onClick={() => { setReplacing(d); setKind(d.kind); setFile(null); setMessage(null); if (fileInput.current) fileInput.current.value = ""; }} data-site-attachment-replace={d.id}>
                Remplacer
              </button>
              <button type="button" className="button outline" disabled={locked} onClick={() => setConfirm({ doc: d, action: "archive" })} data-site-attachment-archive={d.id}>
                Archiver
              </button>
            </>
          )}
          {canWrite && !isOld && d.archived_at && (
            <button type="button" className="button outline" disabled={locked} onClick={() => setConfirm({ doc: d, action: "restore" })} data-site-attachment-restore={d.id}>
              Rétablir
            </button>
          )}
        </span>
        {confirm && confirm.doc.id === d.id && (
          <div className="alert warning" role="alertdialog" aria-label={confirm.action === "archive" ? "Confirmer l’archivage" : "Confirmer le rétablissement"} data-site-attachment-confirm={confirm.action}>
            <span>{confirm.action === "archive" ? COPY.archiveConfirm : COPY.restoreConfirm}</span>
            <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="button primary" disabled={patching} onClick={() => void patch()} data-site-attachment-confirm-yes="">
                {patching ? "Enregistrement…" : confirm.action === "archive" ? "Confirmer l’archivage" : "Confirmer le rétablissement"}
              </button>
              <button type="button" className="button outline" disabled={patching} onClick={() => setConfirm(null)}>Annuler</button>
            </span>
          </div>
        )}
      </li>
    );
  };

  return (
    <section className="panel" aria-labelledby={headingId} data-site-attachments={base ? current.state.phase : demo ? "demo" : "refused"} aria-busy={s.phase === "loading" || s.loadingMore || locked || undefined}>
      <h2 id={headingId}>{COPY.title}</h2>
      <p className="form-note">{COPY.hint}</p>
      {demo ? (
        <p className="document-empty">En démonstration, aucune pièce n’est enregistrée.</p>
      ) : (
        <>
          {archived && <p className="form-note" data-site-attachments-archived-site="">{COPY.archivedSite}</p>}
          <div role="tablist" aria-label="Pièces du site" style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "8px 0" }}>
            {(["current", "history"] as const).map((v) => (
              <button key={v} type="button" role="tab" aria-selected={tab === v} className={tab === v ? "button primary" : "button outline"} onClick={() => { setTab(v); if (v === "history") setHistoryOpened(true); }} data-site-attachments-tab={v}>
                {v === "current" ? COPY.current : COPY.history}
              </button>
            ))}
          </div>
          {message && (
            <p className={message.tone === "ok" ? "form-note" : "field-error"} role={message.tone === "ok" ? "status" : "alert"} data-site-attachments-message={message.tone}>
              {message.text}
            </p>
          )}
          {s.notice && <p className="form-note" role="status">{s.notice}</p>}
          {openError && <p className="field-error" role="alert">{openError}</p>}
          {!base && <p className="document-empty" role="alert">{COPY.refused}</p>}
          {list.key && s.phase === "loading" && <p className="document-empty" role="status">{COPY.loading}</p>}
          {s.phase === "refused" && <p className="document-empty" role="alert" data-site-attachments-refused="">{s.error}</p>}
          {s.phase === "error" && (
            <div role="alert">
              <p className="document-empty">{s.error}</p>
              <button type="button" className="button outline" onClick={list.retry} data-site-attachments-retry={tab}>Réessayer</button>
            </div>
          )}
          {tab === "history" && s.phase === "ready" && <p className="form-note">{COPY.historyNote}</p>}
          {s.phase === "ready" &&
            (s.docs.length ? (
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }} data-site-attachments-list={tab}>
                {s.docs.map(row)}
              </ul>
            ) : (
              <p className="document-empty" data-site-attachments-empty={tab}>{tab === "current" ? COPY.empty : COPY.historyEmpty}</p>
            ))}
          {s.moreError && <p className="field-error" role="alert">{COPY.moreFailed}</p>}
          {s.phase === "ready" && s.next && (
            <button type="button" className="button outline" disabled={s.loadingMore} onClick={list.more} data-site-attachments-more={tab}>
              {s.loadingMore ? "Chargement…" : COPY.more}
            </button>
          )}
          {canWrite ? (
            <form onSubmit={(e) => void upload(e)} noValidate data-site-attachments-upload={sending ? "sending" : "idle"}>
              <fieldset disabled={locked} style={{ border: 0, padding: 0, margin: "12px 0 0", minWidth: 0, display: "grid", gap: 8 }}>
                {replacing ? (
                  <p className="form-note" data-site-attachments-replacing={replacing.id}>
                    Nouvelle version de « {replacing.name} » (version {replacing.version}, {KIND_LABEL[replacing.kind]}).{" "}
                    <button type="button" className="text-button" onClick={() => { resetForm(); setMessage(null); }}>Annuler le remplacement</button>
                  </p>
                ) : (
                  <label className="field">
                    <span>Type de pièce</span>
                    <select value={kind} onChange={(e) => setKind(e.target.value as AttachmentKind)}>
                      {SITE_ATTACHMENT_KINDS.map((k) => (
                        <option key={k} value={k}>{KIND_LABEL[k]}</option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="field">
                  <span>Fichier</span>
                  <input ref={fileInput} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setMessage(null); }} />
                </label>
                <button type="submit" className="button primary" disabled={!file || locked || (message?.tone === "uncertain" && current.state.phase === "loading")} data-site-attachments-send="">
                  {sending ? "Envoi…" : message?.tone === "uncertain" && file ? "Renvoyer ce fichier" : replacing ? "Enregistrer la nouvelle version" : "Ajouter la pièce"}
                </button>
              </fieldset>
            </form>
          ) : (
            <p className="form-note" data-site-attachments-readonly="">{archived ? COPY.archivedSite : COPY.readOnly}</p>
          )}
        </>
      )}
    </section>
  );
}
