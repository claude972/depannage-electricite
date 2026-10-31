"use client";
import { useState } from "react";
import { maintenancePlanPayload } from "../../../lib/features/site-operations/schemas";
import { FREQUENCY_KIND, PLAN_STATUS, date } from "../../../lib/features/site-operations/labels";
import type { FrequencyKind, MaintenancePlan, MaintenancePlanPayload, PlanStatus } from "../../../lib/features/site-operations/types";
import { EmptyState, Field, Notice, ReadOnly, Tag, Truncated, orNull, toInt, useSubmit, type PanelContext } from "./shared";
import { z } from "zod";
import styles from "./site-operations.module.css";

type Draft = { equipment_id: string; title: string; frequency_kind: FrequencyKind; frequency_value: string; next_due_on: string; last_done_on: string; status: PlanStatus; notes: string };
const empty = (): Draft => ({ equipment_id: "", title: "", frequency_kind: "none", frequency_value: "", next_due_on: "", last_done_on: "", status: "active", notes: "" });
const fromRow = (p: MaintenancePlan): Draft => ({ equipment_id: p.equipment_id ?? "", title: p.title, frequency_kind: p.frequency_kind, frequency_value: p.frequency_value === null ? "" : String(p.frequency_value), next_due_on: p.next_due_on ?? "", last_done_on: p.last_done_on ?? "", status: p.status, notes: p.notes });
const toPayload = (d: Draft): MaintenancePlanPayload => ({
  equipment_id: orNull(d.equipment_id),
  title: d.title.trim(),
  frequency_kind: d.frequency_kind,
  frequency_value: d.frequency_kind === "none" ? null : toInt(d.frequency_value),
  next_due_on: orNull(d.next_due_on),
  last_done_on: orNull(d.last_done_on),
  status: d.status,
  notes: d.notes.trim(),
});
const visitSchema = z.object({ done_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Indiquez la date de la visite."), summary: z.string().trim().max(4000) }).strict();

export function MaintenancePanel({ context }: { context: PanelContext }) {
  const { report, canWrite } = context;
  const plans = report.snapshot.maintenance_plans;
  const equipment = new Map(report.snapshot.equipment.map((e) => [e.id, e.name]));
  const today = report.computed_at.slice(0, 10);
  const [editing, setEditing] = useState<{ id: string | null; version: number | null } | null>(null);
  const [draft, setDraft] = useState<Draft>(empty);
  const [visitFor, setVisitFor] = useState<string | null>(null);
  const [visit, setVisit] = useState({ done_on: "", summary: "" });
  const form = useSubmit(context);
  const visitForm = useSubmit(context);
  const open = (row: MaintenancePlan | null) => {
    setEditing(row ? { id: row.id, version: row.version } : { id: null, version: null });
    setDraft(row ? fromRow(row) : empty());
    setVisitFor(null);
    form.setMessage(null);
  };
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const completeness = report.completeness.maintenance;
  return (
    <section aria-labelledby="so-maintenance-title">
      <header className={styles.sectionHead}>
        <div>
          <h3 id="so-maintenance-title">Plan de maintenance</h3>
          <p>
            {completeness.plans} plan{completeness.plans > 1 ? "s" : ""} actif{completeness.plans > 1 ? "s" : ""}
            {completeness.without_schedule > 0 && ` · ${completeness.without_schedule} sans échéance`}
            {completeness.overdue !== null ? ` · ${completeness.overdue} échéance${completeness.overdue > 1 ? "s" : ""} dépassée${completeness.overdue > 1 ? "s" : ""}` : " · dépassements non mesurables (aucune échéance configurée)"}
          </p>
        </div>
        {canWrite && !editing && (
          <button type="button" className="button primary" onClick={() => open(null)}>
            Ajouter un plan
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
              maintenancePlanPayload,
              toPayload(draft),
              editing.id ? { action: "save_maintenance_plan", site_id: report.site_id, payload: toPayload(draft), id: editing.id, expected_version: editing.version ?? 0 } : { action: "save_maintenance_plan", site_id: report.site_id, payload: toPayload(draft) },
              () => setEditing(null),
              editing.id ? "Plan mis à jour." : "Plan ajouté.",
            )
          }
        >
          <h4>{editing.id ? "Modifier le plan" : "Nouveau plan de maintenance"}</h4>
          {form.message && <Notice tone={form.message.tone}>{form.message.text}</Notice>}
          <div className={styles.grid2}>
            <Field label="Intitulé" error={form.errors.title}>
              {(a) => <input {...a} value={draft.title} maxLength={160} onChange={(e) => set("title", e.target.value)} />}
            </Field>
            <Field label="Équipement concerné (facultatif)" error={form.errors.equipment_id}>
              {(a) => (
                <select {...a} value={draft.equipment_id} onChange={(e) => set("equipment_id", e.target.value)}>
                  <option value="">Tout le site</option>
                  {report.snapshot.equipment.map((e) => (
                    <option key={e.id} value={e.id}>{e.name}</option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Périodicité" hint="Aucune périodicité n’est proposée par défaut : indiquez celle que votre organisation a décidée." error={form.errors.frequency_kind}>
              {(a) => (
                <select {...a} value={draft.frequency_kind} onChange={(e) => set("frequency_kind", e.target.value as FrequencyKind)}>
                  {Object.entries(FREQUENCY_KIND).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Valeur N" error={form.errors.frequency_value}>
              {(a) => <input {...a} inputMode="numeric" value={draft.frequency_value} disabled={draft.frequency_kind === "none"} onChange={(e) => set("frequency_value", e.target.value)} />}
            </Field>
            <Field label="Prochaine échéance (facultatif)" hint="Sans date, le plan reste « sans échéance » et n’entre dans aucun compteur." error={form.errors.next_due_on}>
              {(a) => <input {...a} type="date" value={draft.next_due_on} onChange={(e) => set("next_due_on", e.target.value)} />}
            </Field>
            <Field label="Dernière réalisation (facultatif)" error={form.errors.last_done_on}>
              {(a) => <input {...a} type="date" value={draft.last_done_on} onChange={(e) => set("last_done_on", e.target.value)} />}
            </Field>
            <Field label="Statut" error={form.errors.status}>
              {(a) => (
                <select {...a} value={draft.status} onChange={(e) => set("status", e.target.value as PlanStatus)}>
                  {Object.entries(PLAN_STATUS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              )}
            </Field>
          </div>
          <Field label="Notes (facultatif)" error={form.errors.notes}>
            {(a) => <textarea {...a} value={draft.notes} maxLength={4000} onChange={(e) => set("notes", e.target.value)} />}
          </Field>
          <div className={styles.actions}>
            <button type="submit" className="button primary" disabled={form.submitting || context.busy}>{form.submitting ? "Enregistrement…" : "Enregistrer"}</button>
            <button type="button" className="button outline" onClick={() => setEditing(null)} disabled={form.submitting}>Annuler</button>
          </div>
        </form>
      )}
      {plans.length === 0 && !editing ? (
        <EmptyState title="Aucun plan de maintenance">{canWrite ? "Définissez les visites périodiques décidées par votre organisation pour ce site." : "Aucun plan n’a été défini pour ce site."}</EmptyState>
      ) : (
        <ul className={styles.cards} aria-label="Plans de maintenance">
          {plans.map((plan) => {
            const overdue = plan.status === "active" && plan.next_due_on !== null && plan.next_due_on < today;
            return (
              <li key={plan.id} className={styles.card}>
                <div className={styles.cardHead}>
                  <strong>{plan.title}</strong>
                  <span className={styles.tags}>
                    <Tag tone={plan.status === "active" ? "green" : plan.status === "paused" ? "amber" : "neutral"}>{PLAN_STATUS[plan.status]}</Tag>
                    {plan.next_due_on === null ? <Tag tone="neutral">Sans échéance</Tag> : overdue ? <Tag tone="red">Échéance dépassée</Tag> : <Tag tone="blue">Échéance {date(plan.next_due_on)}</Tag>}
                  </span>
                </div>
                <dl className={styles.meta}>
                  <div><dt>Équipement</dt><dd>{plan.equipment_id ? equipment.get(plan.equipment_id) ?? "Équipement non affiché" : "Tout le site"}</dd></div>
                  <div><dt>Périodicité</dt><dd>{plan.frequency_kind === "none" ? "Sans périodicité" : `${FREQUENCY_KIND[plan.frequency_kind].replace("N", String(plan.frequency_value))}`}</dd></div>
                  <div><dt>Dernière réalisation</dt><dd>{date(plan.last_done_on)}</dd></div>
                  <div><dt>Visites enregistrées</dt><dd>{plan.visits.length}{plan.visits.length >= 20 ? " (20 dernières)" : ""}</dd></div>
                </dl>
                {plan.visits.length > 0 && (
                  <details className={styles.details}>
                    <summary>Historique des visites</summary>
                    <ul className={styles.plain}>
                      {plan.visits.map((v) => (
                        <li key={v.id}>
                          <span>{date(v.done_on)}</span>
                          <span>{v.summary || "Sans compte rendu"}</span>
                          {v.intervention_id && context.onNavigate && (
                            <button type="button" className={styles.link} onClick={() => context.onNavigate?.("intervention", v.intervention_id ?? undefined)}>Voir le dossier</button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {canWrite && (
                  <div className={styles.cardActions}>
                    <button type="button" className="button outline" onClick={() => open(plan)} disabled={!!editing || visitFor !== null}>Modifier</button>
                    <button type="button" className="button outline" onClick={() => { setVisitFor(plan.id); setVisit({ done_on: "", summary: "" }); visitForm.setMessage(null); }} disabled={!!editing || visitFor !== null}>Enregistrer une visite</button>
                  </div>
                )}
                {visitFor === plan.id && (
                  <form
                    className={styles.subform}
                    noValidate
                    onSubmit={(event) =>
                      visitForm.submit(event, visitSchema, visit, { action: "record_maintenance_visit", plan_id: plan.id, done_on: visit.done_on, summary: visit.summary.trim(), intervention_id: null }, () => setVisitFor(null), "Visite enregistrée.")
                    }
                  >
                    {visitForm.message && <Notice tone={visitForm.message.tone}>{visitForm.message.text}</Notice>}
                    <Field label="Date de la visite" error={visitForm.errors.done_on}>
                      {(a) => <input {...a} type="date" value={visit.done_on} onChange={(e) => setVisit((v) => ({ ...v, done_on: e.target.value }))} />}
                    </Field>
                    <Field label="Compte rendu (facultatif)" hint={plan.frequency_kind === "none" ? "Sans périodicité, la prochaine échéance n’est pas recalculée." : "La prochaine échéance est recalculée à partir de cette date et de la périodicité."} error={visitForm.errors.summary}>
                      {(a) => <textarea {...a} value={visit.summary} maxLength={4000} onChange={(e) => setVisit((v) => ({ ...v, summary: e.target.value }))} />}
                    </Field>
                    <div className={styles.actions}>
                      <button type="submit" className="button primary" disabled={visitForm.submitting || context.busy}>{visitForm.submitting ? "Enregistrement…" : "Enregistrer la visite"}</button>
                      <button type="button" className="button outline" onClick={() => setVisitFor(null)} disabled={visitForm.submitting}>Annuler</button>
                    </div>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {visitForm.message && visitFor === null && <Notice tone={visitForm.message.tone} onClose={() => visitForm.setMessage(null)}>{visitForm.message.text}</Notice>}
      <Truncated name="plans" limited={report.snapshot.limits.maintenance_plans_limited} />
    </section>
  );
}
