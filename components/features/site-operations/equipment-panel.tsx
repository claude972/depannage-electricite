"use client";
import { useState } from "react";
import { equipmentPayload } from "../../../lib/features/site-operations/schemas";
import { CRITICALITY, EQUIPMENT_CATEGORY, EQUIPMENT_STATUS, date } from "../../../lib/features/site-operations/labels";
import type { Criticality, Equipment, EquipmentCategory, EquipmentPayload, EquipmentStatus } from "../../../lib/features/site-operations/types";
import { EmptyState, Field, Notice, ReadOnly, Tag, Truncated, orNull, useSubmit, type PanelContext, type Tone } from "./shared";
import styles from "./site-operations.module.css";

const CRITICALITY_TONE: Record<Criticality, Tone> = { low: "neutral", medium: "blue", high: "amber", critical: "red" };
const STATUS_TONE: Record<EquipmentStatus, Tone> = { in_service: "green", degraded: "amber", out_of_service: "red", retired: "neutral" };
type Draft = { name: string; category: EquipmentCategory; criticality: Criticality; location: string; reference: string; installed_on: string; status: EquipmentStatus; notes: string };
const empty = (): Draft => ({ name: "", category: "panel", criticality: "medium", location: "", reference: "", installed_on: "", status: "in_service", notes: "" });
const fromRow = (e: Equipment): Draft => ({ name: e.name, category: e.category, criticality: e.criticality, location: e.location, reference: e.reference, installed_on: e.installed_on ?? "", status: e.status, notes: e.notes });
const toPayload = (d: Draft): EquipmentPayload => ({ name: d.name.trim(), category: d.category, criticality: d.criticality, location: d.location.trim(), reference: d.reference.trim(), installed_on: orNull(d.installed_on), status: d.status, notes: d.notes.trim() });

export function EquipmentPanel({ context }: { context: PanelContext }) {
  const { report, canWrite } = context;
  const rows = report.snapshot.equipment;
  const [editing, setEditing] = useState<{ id: string | null; version: number | null } | null>(null);
  const [draft, setDraft] = useState<Draft>(empty);
  const form = useSubmit(context);
  const open = (row: Equipment | null) => {
    setEditing(row ? { id: row.id, version: row.version } : { id: null, version: null });
    setDraft(row ? fromRow(row) : empty());
    form.setMessage(null);
  };
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  return (
    <section aria-labelledby="so-equipment-title">
      <header className={styles.sectionHead}>
        <div>
          <h3 id="so-equipment-title">Équipements du site</h3>
          <p>{rows.length ? `${rows.length} équipement${rows.length > 1 ? "s" : ""} enregistré${rows.length > 1 ? "s" : ""}.` : "Aucun équipement enregistré pour ce site."}</p>
        </div>
        {canWrite && !editing && (
          <button type="button" className="button primary" onClick={() => open(null)}>
            Ajouter un équipement
          </button>
        )}
      </header>
      {!canWrite && <ReadOnly reason={context.readOnlyReason} />}
      {form.message && !editing && <Notice tone={form.message.tone} onClose={() => form.setMessage(null)}>{form.message.text}</Notice>}
      {editing && (
        <form
          className={styles.form}
          noValidate
          onSubmit={(event) =>
            form.submit(
              event,
              equipmentPayload,
              toPayload(draft),
              editing.id ? { action: "save_equipment", site_id: report.site_id, payload: toPayload(draft), id: editing.id, expected_version: editing.version ?? 0 } : { action: "save_equipment", site_id: report.site_id, payload: toPayload(draft) },
              () => setEditing(null),
              editing.id ? "Équipement mis à jour." : "Équipement ajouté.",
            )
          }
        >
          <h4>{editing.id ? "Modifier l’équipement" : "Nouvel équipement"}</h4>
          {form.message && <Notice tone={form.message.tone}>{form.message.text}</Notice>}
          <div className={styles.grid2}>
            <Field label="Désignation" error={form.errors.name}>
              {(a) => <input {...a} value={draft.name} maxLength={160} onChange={(e) => set("name", e.target.value)} />}
            </Field>
            <Field label="Catégorie" error={form.errors.category}>
              {(a) => (
                <select {...a} value={draft.category} onChange={(e) => set("category", e.target.value as EquipmentCategory)}>
                  {Object.entries(EQUIPMENT_CATEGORY).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Criticité" hint="Appréciation de votre organisation, sans valeur réglementaire." error={form.errors.criticality}>
              {(a) => (
                <select {...a} value={draft.criticality} onChange={(e) => set("criticality", e.target.value as Criticality)}>
                  {Object.entries(CRITICALITY).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="État" error={form.errors.status}>
              {(a) => (
                <select {...a} value={draft.status} onChange={(e) => set("status", e.target.value as EquipmentStatus)}>
                  {Object.entries(EQUIPMENT_STATUS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Emplacement (facultatif)" error={form.errors.location}>
              {(a) => <input {...a} value={draft.location} maxLength={160} onChange={(e) => set("location", e.target.value)} />}
            </Field>
            <Field label="Référence ou numéro de série (facultatif)" error={form.errors.reference}>
              {(a) => <input {...a} value={draft.reference} maxLength={160} onChange={(e) => set("reference", e.target.value)} />}
            </Field>
            <Field label="Date d’installation (facultatif)" error={form.errors.installed_on}>
              {(a) => <input {...a} type="date" value={draft.installed_on} onChange={(e) => set("installed_on", e.target.value)} />}
            </Field>
          </div>
          <Field label="Notes (facultatif)" error={form.errors.notes}>
            {(a) => <textarea {...a} value={draft.notes} maxLength={4000} onChange={(e) => set("notes", e.target.value)} />}
          </Field>
          <div className={styles.actions}>
            <button type="submit" className="button primary" disabled={form.submitting || context.busy}>
              {form.submitting ? "Enregistrement…" : "Enregistrer"}
            </button>
            <button type="button" className="button outline" onClick={() => setEditing(null)} disabled={form.submitting}>
              Annuler
            </button>
          </div>
        </form>
      )}
      {rows.length === 0 && !editing ? (
        <EmptyState title="Aucun équipement">
          {canWrite ? "Commencez par enregistrer les équipements électriques de ce site et leur criticité." : "Les équipements de ce site n’ont pas encore été renseignés."}
        </EmptyState>
      ) : (
        <ul className={styles.cards} aria-label="Équipements">
          {rows.map((row) => (
            <li key={row.id} className={styles.card}>
              <div className={styles.cardHead}>
                <strong>{row.name}</strong>
                <span className={styles.tags}>
                  <Tag tone={CRITICALITY_TONE[row.criticality]}>Criticité {CRITICALITY[row.criticality].toLowerCase()}</Tag>
                  <Tag tone={STATUS_TONE[row.status]}>{EQUIPMENT_STATUS[row.status]}</Tag>
                </span>
              </div>
              <dl className={styles.meta}>
                <div><dt>Catégorie</dt><dd>{EQUIPMENT_CATEGORY[row.category]}</dd></div>
                <div><dt>Emplacement</dt><dd>{row.location || "—"}</dd></div>
                <div><dt>Référence</dt><dd>{row.reference || "—"}</dd></div>
                <div><dt>Installé le</dt><dd>{date(row.installed_on)}</dd></div>
              </dl>
              {row.notes && <p className={styles.notes}>{row.notes}</p>}
              {canWrite && (
                <div className={styles.cardActions}>
                  <button type="button" className="button outline" onClick={() => open(row)} disabled={!!editing}>
                    Modifier
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <Truncated name="équipements" limited={report.snapshot.limits.equipment_limited} />
    </section>
  );
}
