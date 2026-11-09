"use client";
import { useRef, useState, type FormEvent } from "react";
import { erpChecklistPayload, uuid } from "../../../lib/features/site-operations/schemas";
import { CHECKLIST_STATUS, DECLARATIVE_NOTICE, ITEM_STATE, date } from "../../../lib/features/site-operations/labels";
import type { ChecklistItem, ChecklistStatus, ErpChecklist, ErpChecklistPayload, ItemState } from "../../../lib/features/site-operations/types";
import { OpenSiteDocument, ReserveDocumentPicker, useSiteDocumentOptions, type SiteDocumentOption } from "./erp-reserve-document";
import { EmptyState, Field, Notice, ReadOnly, Tag, Truncated, orNull, useSubmit, type PanelContext, type Tone } from "./shared";
import styles from "./site-operations.module.css";

const ITEM_TONE: Record<ItemState, Tone> = { not_checked: "neutral", ok: "green", reserve: "amber", not_applicable: "neutral" };
/** E67: optional private document of the same site linked to a lifted reserve. The lift itself never
 *  requires it. `doc_origin` is the link read from the server (to send an explicit null on removal). */
type ItemDraft = { key: string; label: string; state: ItemState; note: string; reserve_resolved_on: string; doc: { id: string; name: string | null; site: string } | null; doc_origin: string | null };
type Draft = { title: string; description: string; performed_on: string; performed_by_label: string; status: ChecklistStatus; items: ItemDraft[] };
const linkedDocument = (i: ChecklistItem): string | null => {
  const result = uuid.safeParse(i.reserve_document_id);
  return result.success ? result.data : null;
};
let counter = 0;
const newKey = () => `item-${Date.now().toString(36)}-${(counter++).toString(36)}`;
const emptyItem = (): ItemDraft => ({ key: newKey(), label: "", state: "not_checked", note: "", reserve_resolved_on: "", doc: null, doc_origin: null });
const empty = (): Draft => ({ title: "", description: "", performed_on: "", performed_by_label: "", status: "draft", items: [emptyItem()] });
const fromRow = (c: ErpChecklist, site: string): Draft => ({
  title: c.title, description: c.description, performed_on: c.performed_on ?? "", performed_by_label: c.performed_by_label, status: c.status,
  items: c.items.map((i) => {
    const linked = linkedDocument(i);
    return { key: i.key, label: i.label, state: i.state, note: i.note, reserve_resolved_on: i.reserve_resolved_on ?? "", doc: linked ? { id: linked, name: null, site } : null, doc_origin: linked };
  }),
});
const canLink = (i: ItemDraft) => i.state === "reserve" && i.reserve_resolved_on !== "";
/** reserve_document_id is sent only when a document is chosen (same site, lifted reserve) or to
 *  clear a link that exists on the server; otherwise the key is absent. */
const toPayload = (d: Draft, site: string): ErpChecklistPayload => ({
  title: d.title.trim(),
  description: d.description.trim(),
  performed_on: orNull(d.performed_on),
  performed_by_label: d.performed_by_label.trim(),
  status: d.status,
  items: d.items.map((i) => {
    const doc = canLink(i) && i.doc && i.doc.site === site ? i.doc.id : null;
    const base: ChecklistItem = { key: i.key, label: i.label.trim(), state: i.state, note: i.note.trim(), reserve_resolved_on: orNull(i.reserve_resolved_on) };
    return doc ? { ...base, reserve_document_id: doc } : i.doc_origin ? { ...base, reserve_document_id: null } : base;
  }),
});
export function ErpPanel({ context }: { context: PanelContext }) {
  const { report, canWrite } = context;
  const checklists = report.snapshot.erp_checklists;
  const [editing, setEditing] = useState<{ id: string | null; version: number | null } | null>(null);
  const [draft, setDraft] = useState<Draft>(empty);
  const form = useSubmit(context);
  // One save at a time (synchronous guard, before any re-render), and a token per editor so that
  // only the editor that sent the save is closed by its success.
  const inFlight = useRef(false);
  const editor = useRef(0);
  const close = () => {
    editor.current++;
    setEditing(null);
  };
  const open = (row: ErpChecklist | null) => {
    editor.current++;
    setEditing(row ? { id: row.id, version: row.version } : { id: null, version: null });
    setDraft(row ? fromRow(row, report.site_id) : empty());
    form.setMessage(null);
  };
  /** The body is built once from the locked draft, the exact checklist and its expected version:
   *  after a failure the fields stay as sent, so a retry sends the identical body. The reserve
   *  lift date is sent as entered (the validator accepts a date for any finding). */
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing || !canWrite || inFlight.current || form.submitting || context.busy) return;
    inFlight.current = true;
    const token = editor.current, site = report.site_id;
    const payload = toPayload(draft, site);
    const command = editing.id
      ? { action: "save_erp_checklist" as const, site_id: site, payload, id: editing.id, expected_version: editing.version ?? 0 }
      : { action: "save_erp_checklist" as const, site_id: site, payload };
    try {
      await form.submit(event, erpChecklistPayload, payload, command, () => {
        if (editor.current === token && site === siteRef.current) close(); // late reply for another editor or site: ignored
      }, editing.id ? "Contrôle mis à jour." : "Contrôle enregistré.");
    } finally {
      inFlight.current = false;
    }
  };
  const siteRef = useRef(report.site_id);
  siteRef.current = report.site_id;
  const locked = form.submitting;
  // E67: a changed finding or lift date clears the chosen document (re-choose explicitly); an
  // existing server link is then cleared by an explicit null at save.
  const setItem = (index: number, patch: Partial<ItemDraft>) => setDraft((d) => ({ ...d, items: d.items.map((i, j) => {
    if (j !== index) return i;
    const changed = (patch.state !== undefined && patch.state !== i.state) || (patch.reserve_resolved_on !== undefined && patch.reserve_resolved_on !== i.reserve_resolved_on);
    return { ...i, ...patch, ...(changed ? { doc: null } : {}) };
  }) }));
  const setDoc = (index: number, doc: SiteDocumentOption | null) => setDraft((d) => ({ ...d, items: d.items.map((i, j) => (j === index ? { ...i, doc: doc ? { id: doc.id, name: doc.name, site: report.site_id } : null } : i)) }));
  const documents = useSiteDocumentOptions(report.site_id, context.interventionSearch?.context);
  const openReserves = report.completeness.erp.open_reserves;
  return (
    <section aria-labelledby="so-erp-title">
      <header className={styles.sectionHead}>
        <div>
          <h3 id="so-erp-title">Contrôles ERP — déclaratif</h3>
          <p>{DECLARATIVE_NOTICE}</p>
        </div>
        {canWrite && !editing && <button type="button" className="button primary" onClick={() => open(null)}>Nouveau contrôle</button>}
      </header>
      <div className={styles.statRow} aria-label="Synthèse des contrôles">
        <div><span>Contrôles</span><strong>{report.completeness.erp.checklists}</strong><small>hors archivés</small></div>
        <div><span>Réserves ouvertes</span><strong>{openReserves}</strong><small>{report.snapshot.limits.erp_checklists_limited ? "parmi les contrôles affichés (liste tronquée)" : "déclarées, non levées"}</small></div>
      </div>
      {!canWrite && <ReadOnly reason={context.readOnlyReason} />}
      {form.message && !editing && <Notice tone={form.message.tone} onClose={() => form.setMessage(null)}>{form.message.text}</Notice>}
      {/* Right lost after re-evaluation (canWrite false): no write is offered; the draft is not sent. */}
      {editing && canWrite && (
        <form className={styles.form} noValidate onSubmit={(event) => void save(event)}>
          <h4>{editing.id ? "Modifier le contrôle" : "Nouveau contrôle déclaratif"}</h4>
          {/* Every input, select and button below is locked while the save is in flight. */}
          <fieldset disabled={locked} aria-busy={locked || undefined} style={{ display: "contents" }} data-erp-lock="">
          <p className={styles.hint}>Les intitulés sont libres et relèvent de votre organisation ; ils ne constituent pas une liste réglementaire fournie par le service.</p>
          {form.message && <Notice tone={form.message.tone}>{form.message.text}</Notice>}
          <div className={styles.grid2}>
            <Field label="Intitulé" error={form.errors.title}>{(a) => <input {...a} value={draft.title} maxLength={160} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} />}</Field>
            <Field label="Statut" error={form.errors.status}>{(a) => <select {...a} value={draft.status} onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value as ChecklistStatus }))}>{Object.entries(CHECKLIST_STATUS).map(([k, v]) => (<option key={k} value={k}>{v}</option>))}</select>}</Field>
            <Field label="Réalisé le (facultatif)" error={form.errors.performed_on}>{(a) => <input {...a} type="date" value={draft.performed_on} onChange={(e) => setDraft((d) => ({ ...d, performed_on: e.target.value }))} />}</Field>
            <Field label="Réalisé par (texte libre, facultatif)" hint="Mention déclarative, sans vérification d’habilitation par le service." error={form.errors.performed_by_label}>{(a) => <input {...a} value={draft.performed_by_label} maxLength={160} onChange={(e) => setDraft((d) => ({ ...d, performed_by_label: e.target.value }))} />}</Field>
          </div>
          <Field label="Description (facultatif)" error={form.errors.description}>{(a) => <textarea {...a} value={draft.description} maxLength={4000} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} />}</Field>
          <fieldset className={styles.fieldset}>
            <legend>Points de contrôle {form.errors.items && <span className="field-error" role="alert">{form.errors.items}</span>}</legend>
            {draft.items.map((item, i) => (
              <div key={item.key} className={styles.lineRow}>
                <Field label={`Point ${i + 1}`}>{(a) => <input {...a} value={item.label} maxLength={240} onChange={(e) => setItem(i, { label: e.target.value })} />}</Field>
                <Field label="Constat">{(a) => <select {...a} value={item.state} onChange={(e) => setItem(i, { state: e.target.value as ItemState })}>{Object.entries(ITEM_STATE).map(([k, v]) => (<option key={k} value={k}>{v}</option>))}</select>}</Field>
                <Field label="Note">{(a) => <input {...a} value={item.note} maxLength={1000} onChange={(e) => setItem(i, { note: e.target.value })} />}</Field>
                <Field label="Réserve levée le">{(a) => <input {...a} type="date" value={item.reserve_resolved_on} disabled={item.state !== "reserve"} onChange={(e) => setItem(i, { reserve_resolved_on: e.target.value })} />}</Field>
                <button type="button" className="button outline" onClick={() => setDraft((d) => ({ ...d, items: d.items.filter((_, j) => j !== i) }))} aria-label={`Retirer le point ${i + 1}`}>Retirer</button>
                {(item.state === "reserve" || item.doc) && (
                  <ReserveDocumentPicker index={i} siteId={report.site_id} enabled={canLink(item)} value={item.doc && item.doc.site === report.site_id ? item.doc : null} options={documents} onChange={(doc) => setDoc(i, doc)} />
                )}
              </div>
            ))}
            <button type="button" className="button outline" onClick={() => setDraft((d) => ({ ...d, items: [...d.items, emptyItem()] }))} disabled={draft.items.length >= 200}>Ajouter un point</button>
          </fieldset>
          <div className={styles.actions}>
            <button type="submit" className="button primary" disabled={form.submitting || context.busy}>{form.submitting ? "Enregistrement…" : "Enregistrer"}</button>
            <button type="button" className="button outline" onClick={close} disabled={form.submitting}>Annuler</button>
          </div>
          </fieldset>
        </form>
      )}
      {checklists.length === 0 && !editing ? (
        <EmptyState title="Aucun contrôle déclaré">{canWrite ? "Consignez les vérifications décidées par votre organisation et leurs réserves." : "Aucun contrôle n’a été consigné pour ce site."}</EmptyState>
      ) : (
        <ul className={styles.cards} aria-label="Contrôles déclaratifs">
          {checklists.map((c) => {
            const reserves = c.items.filter((i) => i.state === "reserve" && i.reserve_resolved_on === null).length;
            return (
              <li key={c.id} className={styles.card}>
                <div className={styles.cardHead}>
                  <strong>{c.title}</strong>
                  <span className={styles.tags}>
                    <Tag tone="neutral">Déclaratif</Tag>
                    <Tag tone={c.status === "completed" ? "green" : c.status === "draft" ? "blue" : "neutral"}>{CHECKLIST_STATUS[c.status]}</Tag>
                    {reserves > 0 && <Tag tone="amber">{reserves} réserve{reserves > 1 ? "s" : ""} ouverte{reserves > 1 ? "s" : ""}</Tag>}
                  </span>
                </div>
                <dl className={styles.meta}>
                  <div><dt>Réalisé le</dt><dd>{date(c.performed_on)}</dd></div>
                  <div><dt>Réalisé par</dt><dd>{c.performed_by_label || "—"}</dd></div>
                  <div><dt>Points</dt><dd>{c.items.length}</dd></div>
                </dl>
                {c.description && <p className={styles.notes}>{c.description}</p>}
                {c.items.length > 0 && (
                  <ul className={styles.plain} aria-label={`Points de ${c.title}`}>
                    {c.items.map((i) => {
                      const linked = linkedDocument(i);
                      return (
                        <li key={i.key}>
                          <span>{i.label}</span>
                          <span className={styles.tags}><Tag tone={ITEM_TONE[i.state]}>{ITEM_STATE[i.state]}</Tag>{i.state === "reserve" && i.reserve_resolved_on && <Tag tone="green">Levée le {date(i.reserve_resolved_on)}</Tag>}</span>
                          {i.note && <span className={styles.muted}>{i.note}</span>}
                          {linked && (
                            <span className={styles.muted}>
                              Document de levée lié (réf. {linked.slice(0, 8)}) <OpenSiteDocument siteId={report.site_id} id={linked} options={documents} />
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
                {canWrite && <div className={styles.cardActions}><button type="button" className="button outline" onClick={() => open(c)} disabled={!!editing}>Modifier</button></div>}
              </li>
            );
          })}
        </ul>
      )}
      <Truncated name="contrôles" limited={report.snapshot.limits.erp_checklists_limited} />
    </section>
  );
}
