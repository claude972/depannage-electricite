"use client";
import { useState } from "react";
import { contractGridPayload } from "../../../lib/features/site-operations/schemas";
import { GRID_STATUS, GRID_UNIT, date, dateTime, money } from "../../../lib/features/site-operations/labels";
import type { ContractGrid, ContractGridPayload, GridUnit } from "../../../lib/features/site-operations/types";
import { EmptyState, Field, Notice, ReadOnly, Tag, Truncated, fromCents, orNull, toCents, useSubmit, type PanelContext } from "./shared";
import styles from "./site-operations.module.css";

type LineDraft = { label: string; unit: GridUnit; amount: string; note: string };
type Draft = { label: string; effective_from: string; lines: LineDraft[]; from_grid_id: string | null };
const emptyLine = (): LineDraft => ({ label: "", unit: "hour", amount: "", note: "" });
const fromRow = (g: ContractGrid, asNewVersion: boolean): Draft => ({
  label: asNewVersion ? `${g.label} — nouvelle version` : g.label,
  effective_from: asNewVersion ? "" : g.effective_from ?? "",
  lines: g.lines.map((l) => ({ label: l.label, unit: l.unit, amount: fromCents(l.amount_cents), note: l.note })),
  from_grid_id: asNewVersion ? g.id : null,
});
const toPayload = (d: Draft): ContractGridPayload => ({
  label: d.label.trim(),
  contract_id: null,
  effective_from: orNull(d.effective_from),
  lines: d.lines.map((l) => ({ label: l.label.trim(), unit: l.unit, amount_cents: toCents(l.amount), note: l.note.trim() })),
  ...(d.from_grid_id ? { from_grid_id: d.from_grid_id } : {}),
});

export function GridsPanel({ context }: { context: PanelContext }) {
  const { report, canWriteOrganization } = context;
  const grids = report.snapshot.contract_grids;
  const [editing, setEditing] = useState<{ id: string | null; version: number | null } | null>(null);
  const [draft, setDraft] = useState<Draft>({ label: "", effective_from: "", lines: [emptyLine()], from_grid_id: null });
  const form = useSubmit(context);
  const publishForm = useSubmit(context);
  const open = (grid: ContractGrid | null, asNewVersion = false) => {
    setEditing(grid && !asNewVersion ? { id: grid.id, version: grid.version } : { id: null, version: null });
    setDraft(grid ? fromRow(grid, asNewVersion) : { label: "", effective_from: "", lines: [emptyLine()], from_grid_id: null });
    form.begin();
  };
  const setLine = (index: number, patch: Partial<LineDraft>) => setDraft((d) => ({ ...d, lines: d.lines.map((l, i) => (i === index ? { ...l, ...patch } : l)) }));
  if (grids === null)
    return (
      <section aria-labelledby="so-grids-title">
        <h3 id="so-grids-title">Grilles contractuelles</h3>
        <div className="unavailable" role="note" data-blocker="site-operations-grids">
          <div>
            <strong>Montants contractuels non accessibles</strong>
            <p>Votre accès est limité à certains sites ; les grilles de l’organisation sont réservées aux membres ayant un accès à l’ensemble de l’organisation.</p>
          </div>
        </div>
      </section>
    );
  const lineages = new Map<string, ContractGrid[]>();
  for (const g of grids) lineages.set(g.lineage_id, [...(lineages.get(g.lineage_id) ?? []), g]);
  return (
    <section aria-labelledby="so-grids-title">
      <header className={styles.sectionHead}>
        <div>
          <h3 id="so-grids-title">Grilles contractuelles</h3>
          <p>Montants tels que saisis par votre organisation (HT, en euros). Une grille publiée est figée ; une nouvelle version la remplace.</p>
        </div>
        {canWriteOrganization && !editing && (
          <button type="button" className="button primary" onClick={() => open(null)}>Nouvelle grille</button>
        )}
      </header>
      {!canWriteOrganization && <ReadOnly reason={context.readOnlyReason ?? "Les grilles sont modifiables uniquement par les membres disposant de droits sur l’ensemble de l’organisation."} />}
      {(form.message && !editing) && <Notice tone={form.message.tone} onClose={() => form.setMessage(null)}>{form.message.text}</Notice>}
      {publishForm.message && <Notice tone={publishForm.message.tone} onClose={() => publishForm.setMessage(null)}>{publishForm.message.text}</Notice>}
      {editing && (
        <form ref={form.formRef}
          className={styles.form}
          noValidate
          onSubmit={(event) =>
            form.submit(
              event,
              contractGridPayload,
              toPayload(draft),
              editing.id
                ? { action: "save_contract_grid", organization_id: report.snapshot.site.organization_id, payload: toPayload(draft), id: editing.id, expected_version: editing.version ?? 0 }
                : { action: "save_contract_grid", organization_id: report.snapshot.site.organization_id, payload: toPayload(draft) },
              () => setEditing(null),
              editing.id ? "Brouillon mis à jour." : "Brouillon de grille créé.",
            )
          }
        >
          <h4>{editing.id ? "Modifier le brouillon" : draft.from_grid_id ? "Nouvelle version de la grille" : "Nouvelle grille (brouillon)"}</h4>
          {form.demoNotice}
          {form.message && <Notice tone={form.message.tone}>{form.message.text}</Notice>}
          <div className={styles.grid2}>
            <Field required label="Intitulé" error={form.errors.label}>{(a) => <input {...a} value={draft.label} maxLength={160} onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))} />}</Field>
            <Field label="Applicable à partir du (facultatif)" error={form.errors.effective_from}>{(a) => <input {...a} type="date" value={draft.effective_from} onChange={(e) => setDraft((d) => ({ ...d, effective_from: e.target.value }))} />}</Field>
          </div>
          <fieldset className={styles.fieldset}>
            <legend>Lignes tarifaires {form.errors.lines && <span className="field-error" role="alert">{form.errors.lines}</span>}</legend>
            {draft.lines.map((line, index) => (
              <div key={index} className={styles.lineRow}>
                <Field required label={`Libellé ${index + 1}`} error={form.errors[`lines.${index}.label`]}>{(a) => <input {...a} value={line.label} maxLength={160} onChange={(e) => setLine(index, { label: e.target.value })} />}</Field>
                <Field label="Unité">
                  {(a) => (
                    <select {...a} value={line.unit} onChange={(e) => setLine(index, { unit: e.target.value as GridUnit })}>
                      {Object.entries(GRID_UNIT).map(([k, v]) => (<option key={k} value={k}>{v}</option>))}
                    </select>
                  )}
                </Field>
                <Field required label="Montant HT (€)" error={form.errors[`lines.${index}.amount_cents`]}>{(a) => <input {...a} inputMode="decimal" value={line.amount} onChange={(e) => setLine(index, { amount: e.target.value })} />}</Field>
                <Field label="Note" error={form.errors[`lines.${index}.note`]}>{(a) => <input {...a} value={line.note} maxLength={400} onChange={(e) => setLine(index, { note: e.target.value })} />}</Field>
                <button type="button" className="button outline" onClick={() => setDraft((d) => ({ ...d, lines: d.lines.filter((_, i) => i !== index) }))} aria-label={`Retirer la ligne ${index + 1}`}>Retirer</button>
              </div>
            ))}
            <button type="button" className="button outline" onClick={() => setDraft((d) => ({ ...d, lines: [...d.lines, emptyLine()] }))} disabled={draft.lines.length >= 100}>Ajouter une ligne</button>
          </fieldset>
          <div className={styles.actions}>
            <button type="submit" className="button primary" disabled={form.submitting || context.busy}>{form.submitting ? "Enregistrement…" : "Enregistrer le brouillon"}</button>
            <button type="button" className="button outline" onClick={() => setEditing(null)} disabled={form.submitting}>Annuler</button>
          </div>
        </form>
      )}
      {grids.length === 0 && !editing ? (
        <EmptyState title="Aucune grille contractuelle">{canWriteOrganization ? "Saisissez les montants négociés par votre organisation ; aucun tarif n’est proposé par défaut." : "Aucune grille n’a été saisie par l’organisation."}</EmptyState>
      ) : (
        <ul className={styles.cards} aria-label="Grilles contractuelles">
          {[...lineages.values()].map((versions) =>
            versions.map((grid) => (
              <li key={grid.id} className={styles.card}>
                <div className={styles.cardHead}>
                  <strong>{grid.label} <span className={styles.muted}>— version {grid.version_number}</span></strong>
                  <span className={styles.tags}>
                    <Tag tone={grid.status === "published" ? "green" : grid.status === "draft" ? "amber" : "neutral"}>{GRID_STATUS[grid.status]}</Tag>
                  </span>
                </div>
                <dl className={styles.meta}>
                  <div><dt>Applicable dès</dt><dd>{date(grid.effective_from)}</dd></div>
                  <div><dt>Publiée le</dt><dd>{dateTime(grid.published_at)}</dd></div>
                  <div><dt>Lignes</dt><dd>{grid.lines.length}</dd></div>
                </dl>
                {grid.lines.length > 0 && (
                  <table className={styles.table}>
                    <caption className={styles.srOnly}>Lignes de {grid.label}</caption>
                    <thead><tr><th scope="col">Libellé</th><th scope="col">Unité</th><th scope="col">Montant HT</th><th scope="col">Note</th></tr></thead>
                    <tbody>
                      {grid.lines.map((l, i) => (
                        <tr key={i}><th scope="row">{l.label}</th><td>{GRID_UNIT[l.unit]}</td><td>{money(l.amount_cents)}</td><td>{l.note || "—"}</td></tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {canWriteOrganization && (
                  <div className={styles.cardActions}>
                    {grid.status === "draft" && (
                      <>
                        <button type="button" className="button outline" onClick={() => open(grid)} disabled={!!editing}>Modifier</button>
                        <button
                          type="button"
                          className="button primary"
                          disabled={!!editing || publishForm.submitting || context.busy}
                          onClick={(event) => publishForm.submit(event, contractGridPayload.pick({ label: true }), { label: grid.label }, { action: "publish_contract_grid", id: grid.id, expected_version: grid.version }, () => undefined, "Grille publiée : elle est désormais figée.")}
                        >
                          Publier (irréversible)
                        </button>
                      </>
                    )}
                    {grid.status === "published" && !versions.some((v) => v.status === "draft") && (
                      <button type="button" className="button outline" onClick={() => open(grid, true)} disabled={!!editing}>Préparer une nouvelle version</button>
                    )}
                  </div>
                )}
              </li>
            )),
          )}
        </ul>
      )}
      <Truncated name="grilles" limited={report.snapshot.limits.contract_grids_limited} />
    </section>
  );
}
