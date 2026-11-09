"use client";
import { useEffect, useState } from "react";
import { z } from "zod";
import { fiscalYearPayload } from "../../../lib/features/site-operations/schemas";
import { BUDGET_CATEGORY, date, money } from "../../../lib/features/site-operations/labels";
import type { BudgetCategory, FiscalYear, FiscalYearStatus } from "../../../lib/features/site-operations/types";
import { effectiveFiscalYearId, selectionAfterYearCreated } from "../../../lib/features/site-operations/view-model";
import { EmptyState, Field, Notice, ReadOnly, Tag, Truncated, fromCents, toCents, useSubmit, type PanelContext } from "./shared";
import styles from "./site-operations.module.css";

const lineSchema = z.object({ amount_cents: z.number().int().min(0, "Montant invalide.").max(100000000, "Montant trop élevé."), note: z.string().trim().max(1000) }).strict();
type YearDraft = { label: string; starts_on: string; ends_on: string; status: FiscalYearStatus };
const emptyYear = (): YearDraft => ({ label: "", starts_on: "", ends_on: "", status: "open" });

export function BudgetPanel({ context }: { context: PanelContext }) {
  const { report, canWrite, canWriteOrganization } = context;
  const { fiscal_years: years, budget_lines: lines, budget_consumption: consumption, limits } = report.snapshot;
  const current = report.completeness.budget.current_fiscal_year_id;
  const [chosen, setSelected] = useState<string>(current ?? years[0]?.id ?? "");
  // Derived at render: a choice that no longer exists (or none, when the panel mounted with 0 years)
  // falls back to the current fiscal year, then the first one.
  const selected = effectiveFiscalYearId(chosen, years, current);
  const [yearEditing, setYearEditing] = useState<{ id: string | null; version: number | null } | null>(null);
  const [yearDraft, setYearDraft] = useState<YearDraft>(emptyYear);
  const [lineEditing, setLineEditing] = useState<BudgetCategory | null>(null);
  const [lineDraft, setLineDraft] = useState({ amount: "", note: "" });
  /** E08: server values (and version) the open line form is based on; a re-read with another
   *  version reloads the untouched fields, keeps the typed ones and flags the conflict. */
  const [lineBase, setLineBase] = useState<{ version: number | null; amount: string; note: string } | null>(null);
  const [lineConflict, setLineConflict] = useState(false);
  const yearForm = useSubmit(context);
  const lineForm = useSubmit(context);
  const year = years.find((y) => y.id === selected) ?? null;
  const yearLines = lines.filter((l) => l.fiscal_year_id === selected);
  const used = consumption.find((c) => c.fiscal_year_id === selected) ?? null;
  const total = yearLines.reduce((n, l) => n + l.amount_cents, 0);
  const openYear = (row: FiscalYear | null) => {
    setYearEditing(row ? { id: row.id, version: row.version } : { id: null, version: null });
    setYearDraft(row ? { label: row.label, starts_on: row.starts_on, ends_on: row.ends_on, status: row.status } : emptyYear());
    yearForm.setMessage(null);
  };
  const openLine = (category: BudgetCategory) => {
    const existing = yearLines.find((l) => l.category === category);
    setLineEditing(category);
    const values = { amount: existing ? fromCents(existing.amount_cents) : "", note: existing?.note ?? "" };
    setLineDraft(values);
    setLineBase({ version: existing?.version ?? null, ...values });
    setLineConflict(false);
    lineForm.setMessage(null);
  };
  const editedLine = lineEditing ? yearLines.find((l) => l.category === lineEditing) ?? null : null;
  useEffect(() => {
    if (!lineEditing || !lineBase) return;
    const version = editedLine?.version ?? null;
    if (version === lineBase.version) return;
    const server = { amount: editedLine ? fromCents(editedLine.amount_cents) : "", note: editedLine?.note ?? "" };
    setLineDraft((d) => ({ amount: d.amount === lineBase.amount ? server.amount : d.amount, note: d.note === lineBase.note ? server.note : d.note }));
    setLineBase({ version, ...server });
    setLineConflict(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineEditing, editedLine?.version]);
  return (
    <section aria-labelledby="so-budget-title">
      <header className={styles.sectionHead}>
        <div>
          <h3 id="so-budget-title">Budget par exercice</h3>
          <p>{years.length ? `${years.length} exercice${years.length > 1 ? "s" : ""} configuré${years.length > 1 ? "s" : ""}.` : "Aucun exercice budgétaire configuré : les montants engagés ne peuvent pas être rapprochés d’un budget."}</p>
        </div>
        {canWriteOrganization && !yearEditing && (
          <button type="button" className="button primary" onClick={() => openYear(null)}>Ajouter un exercice</button>
        )}
      </header>
      {!canWrite && <ReadOnly reason={context.readOnlyReason} />}
      {canWrite && !canWriteOrganization && <p className={styles.hint}>Les exercices sont définis au niveau de l’organisation ; votre accès permet seulement de saisir les lignes de ce site.</p>}
      {yearForm.message && !yearEditing && <Notice tone={yearForm.message.tone} onClose={() => yearForm.setMessage(null)}>{yearForm.message.text}</Notice>}
      {yearEditing && (
        <form
          className={styles.form}
          noValidate
          onSubmit={(event) =>
            yearForm.submit(
              event,
              fiscalYearPayload,
              yearDraft,
              yearEditing.id
                ? { action: "save_fiscal_year", organization_id: report.snapshot.site.organization_id, payload: { ...yearDraft, label: yearDraft.label.trim() }, id: yearEditing.id, expected_version: yearEditing.version ?? 0 }
                : { action: "save_fiscal_year", organization_id: report.snapshot.site.organization_id, payload: { ...yearDraft, label: yearDraft.label.trim() } },
              (done) => {
                setYearEditing(null);
                if (!yearEditing.id) setSelected((prev) => selectionAfterYearCreated(prev, done.result, report.computed_at.slice(0, 10)));
              },
              yearEditing.id ? "Exercice mis à jour." : "Exercice ajouté.",
            )
          }
        >
          <h4>{yearEditing.id ? "Modifier l’exercice" : "Nouvel exercice budgétaire"}</h4>
          {yearForm.message && <Notice tone={yearForm.message.tone}>{yearForm.message.text}</Notice>}
          <div className={styles.grid2}>
            <Field label="Libellé" error={yearForm.errors.label}>{(a) => <input {...a} value={yearDraft.label} maxLength={80} onChange={(e) => setYearDraft((d) => ({ ...d, label: e.target.value }))} />}</Field>
            <Field label="Statut" error={yearForm.errors.status}>
              {(a) => (
                <select {...a} value={yearDraft.status} onChange={(e) => setYearDraft((d) => ({ ...d, status: e.target.value as FiscalYearStatus }))}>
                  <option value="open">Ouvert</option>
                  <option value="closed">Clôturé</option>
                </select>
              )}
            </Field>
            <Field label="Début" error={yearForm.errors.starts_on}>{(a) => <input {...a} type="date" value={yearDraft.starts_on} onChange={(e) => setYearDraft((d) => ({ ...d, starts_on: e.target.value }))} />}</Field>
            <Field label="Fin" hint="Les exercices d’une organisation ne peuvent pas se chevaucher." error={yearForm.errors.ends_on}>{(a) => <input {...a} type="date" value={yearDraft.ends_on} onChange={(e) => setYearDraft((d) => ({ ...d, ends_on: e.target.value }))} />}</Field>
          </div>
          <div className={styles.actions}>
            <button type="submit" className="button primary" disabled={yearForm.submitting || context.busy}>{yearForm.submitting ? "Enregistrement…" : "Enregistrer"}</button>
            <button type="button" className="button outline" onClick={() => setYearEditing(null)} disabled={yearForm.submitting}>Annuler</button>
          </div>
        </form>
      )}
      {years.length === 0 ? (
        !yearEditing && <EmptyState title="Aucun exercice budgétaire">{canWriteOrganization ? "Définissez d’abord les dates de l’exercice de votre organisation." : "Les exercices sont configurés par l’organisation."}</EmptyState>
      ) : (
        <>
          <div className={styles.toolbar}>
            <Field label="Exercice">
              {(a) => (
                <select {...a} value={selected} onChange={(e) => { setSelected(e.target.value); setLineEditing(null); }}>
                  {years.map((y) => (
                    <option key={y.id} value={y.id}>{y.label} · {date(y.starts_on)} → {date(y.ends_on)}{y.id === current ? " (en cours)" : ""}</option>
                  ))}
                </select>
              )}
            </Field>
            {year && canWriteOrganization && !yearEditing && (
              <button type="button" className="button outline" onClick={() => openYear(year)}>Modifier l’exercice</button>
            )}
          </div>
          {year && (
            <div className={styles.statRow} aria-label="Synthèse de l’exercice">
              <div><span>Budget saisi</span><strong>{money(total)}</strong><small>{yearLines.length} ligne{yearLines.length > 1 ? "s" : ""}</small></div>
              <div><span>Devis acceptés</span><strong>{used ? money(used.accepted_cents) : "—"}</strong><small>{used ? `${used.interventions} dossier${used.interventions > 1 ? "s" : ""}` : "non calculé"}</small></div>
              <div><span>Réglé</span><strong>{used ? money(used.paid_cents) : "—"}</strong><small>sur l’exercice</small></div>
              <div><span>Écart</span><strong>{used && yearLines.length ? money(total - used.accepted_cents) : "—"}</strong><small>{yearLines.length ? "budget − devis acceptés" : "aucune ligne saisie"}</small></div>
            </div>
          )}
          {year && (
            <table className={styles.table}>
              <caption>Lignes budgétaires — {year.label}</caption>
              <thead>
                <tr><th scope="col">Poste</th><th scope="col">Montant</th><th scope="col">Note</th>{canWrite && <th scope="col"><span className={styles.srOnly}>Action</span></th>}</tr>
              </thead>
              <tbody>
                {(Object.keys(BUDGET_CATEGORY) as BudgetCategory[]).map((category) => {
                  const line = yearLines.find((l) => l.category === category);
                  return (
                    <tr key={category}>
                      <th scope="row">{BUDGET_CATEGORY[category]}</th>
                      <td>{line ? money(line.amount_cents) : <Tag tone="neutral">Non saisi</Tag>}</td>
                      <td>{line?.note || "—"}</td>
                      {canWrite && (
                        <td>
                          <button type="button" className="button outline" onClick={() => openLine(category)} disabled={lineEditing !== null}>{line ? "Modifier" : "Saisir"}</button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {lineForm.message && lineEditing === null && <Notice tone={lineForm.message.tone} onClose={() => lineForm.setMessage(null)}>{lineForm.message.text}</Notice>}
          {year && lineEditing && (
            <form
              className={styles.form}
              noValidate
              onSubmit={(event) => {
                const amount_cents = toCents(lineDraft.amount);
                const existing = yearLines.find((l) => l.category === lineEditing);
                return lineForm.submit(
                  event,
                  lineSchema,
                  { amount_cents, note: lineDraft.note },
                  { action: "save_budget_line", site_id: report.site_id, fiscal_year_id: year.id, category: lineEditing, amount_cents, note: lineDraft.note.trim(), ...(existing ? { expected_version: existing.version } : {}) },
                  () => setLineEditing(null),
                  "Ligne budgétaire enregistrée.",
                );
              }}
            >
              <h4>{BUDGET_CATEGORY[lineEditing]} — {year.label}</h4>
              {lineForm.message && <Notice tone={lineForm.message.tone}>{lineForm.message.text}</Notice>}
              {lineConflict && <Notice tone="error">Cette ligne a été modifiée entre-temps : sa version actuelle est rechargée ci-dessous ; vos modifications sont conservées. Vérifiez avant d’enregistrer.</Notice>}
              <div className={styles.grid2}>
                <Field label="Montant (€)" hint="Montant décidé par votre organisation, sans TVA ajoutée automatiquement." error={lineForm.errors.amount_cents}>
                  {(a) => <input {...a} inputMode="decimal" value={lineDraft.amount} onChange={(e) => setLineDraft((d) => ({ ...d, amount: e.target.value }))} />}
                </Field>
                <Field label="Note (facultatif)" error={lineForm.errors.note}>
                  {(a) => <input {...a} value={lineDraft.note} maxLength={1000} onChange={(e) => setLineDraft((d) => ({ ...d, note: e.target.value }))} />}
                </Field>
              </div>
              <div className={styles.actions}>
                <button type="submit" className="button primary" disabled={lineForm.submitting || context.busy}>{lineForm.submitting ? "Enregistrement…" : "Enregistrer"}</button>
                <button type="button" className="button outline" onClick={() => setLineEditing(null)} disabled={lineForm.submitting}>Annuler</button>
              </div>
            </form>
          )}
        </>
      )}
      <Truncated name="exercices" limited={limits.fiscal_years_limited} />
      <Truncated name="lignes budgétaires" limited={limits.budget_lines_limited} />
    </section>
  );
}
