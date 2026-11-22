"use client";
import { useRef, useState, type FormEvent } from "react";
import { useEnterpriseSearch, ENTERPRISE_SEARCH_COPY } from "../enterprise-search/use-enterprise-search";
import { z } from "zod";
import { slaCalendarPayload, slaCasePayload, slaPolicyPayload } from "../../../lib/features/site-operations/schemas";
import { NOT_MEASURABLE, NO_GLOBAL_ALERT_NOTICE, TRACK_STATUS, WEEKDAY, dateTime, minutes } from "../../../lib/features/site-operations/labels";
import type { CalendarWindow, PolicyStatus, SlaCalendar, SlaCalendarPayload, SlaCase, SlaCasePayload, SlaEvaluation, SlaPolicy, SlaPolicyPayload, SlaTrack, Urgency } from "../../../lib/features/site-operations/types";
import { EmptyState, Field, Notice, ReadOnly, Tag, Truncated, fromInstant, orNull, toInstant, toInt, useSubmit, type InterventionSearchBinding, type PanelContext, type Tone } from "./shared";
import styles from "./site-operations.module.css";

const TRACK_TONE: Record<SlaTrack["status"], Tone> = { met: "green", breached: "red", pending: "blue", not_measurable: "neutral" };
type Mode = { kind: "none" } | { kind: "calendar"; id: string | null; version: number | null } | { kind: "policy"; id: string | null; version: number | null } | { kind: "case"; id: string | null; version: number | null } | { kind: "pause"; caseId: string; version: number } | { kind: "resume"; caseId: string; version: number };
type CalendarDraft = { name: string; timezone: string; windows: { weekday: string; start: string; end: string }[]; closed_dates: string };
type PolicyDraft = { name: string; calendar_id: string; urgency: "" | Urgency; response: string; resolution: string; status: PolicyStatus };
// intervention_id is part of the editable state: editing another field never drops the link.
type CaseDraft = { policy_id: string; intervention_id: string | null; reference: string; opened_at: string; responded_at: string; resolved_at: string; notes: string };
const emptyCalendar = (): CalendarDraft => ({ name: "", timezone: "", windows: [{ weekday: "1", start: "", end: "" }], closed_dates: "" });
const calendarFromRow = (c: SlaCalendar): CalendarDraft => ({ name: c.name, timezone: c.timezone, windows: c.windows.map((w) => ({ weekday: String(w.weekday), start: w.start, end: w.end })), closed_dates: c.closed_dates.join("\n") });
const calendarPayload = (d: CalendarDraft): SlaCalendarPayload => ({
  name: d.name.trim(),
  timezone: d.timezone.trim(),
  windows: d.windows.map((w): CalendarWindow => ({ weekday: Number(w.weekday), start: w.start, end: w.end })),
  closed_dates: d.closed_dates.split(/[\n,;\s]+/).map((s) => s.trim()).filter(Boolean),
});
const emptyPolicy = (): PolicyDraft => ({ name: "", calendar_id: "", urgency: "", response: "", resolution: "", status: "active" });
const policyFromRow = (p: SlaPolicy): PolicyDraft => ({ name: p.name, calendar_id: p.calendar_id ?? "", urgency: p.urgency ?? "", response: p.response_target_minutes === null ? "" : String(p.response_target_minutes), resolution: p.resolution_target_minutes === null ? "" : String(p.resolution_target_minutes), status: p.status });
const policyPayload = (d: PolicyDraft): SlaPolicyPayload => ({ name: d.name.trim(), calendar_id: orNull(d.calendar_id), urgency: d.urgency || null, response_target_minutes: toInt(d.response), resolution_target_minutes: toInt(d.resolution), status: d.status });
const emptyCase = (policyId: string): CaseDraft => ({ policy_id: policyId, intervention_id: null, reference: "", opened_at: "", responded_at: "", resolved_at: "", notes: "" });
const caseFromRow = (c: SlaCase): CaseDraft => ({ policy_id: c.policy_id, intervention_id: c.intervention_id, reference: c.reference, opened_at: fromInstant(c.opened_at), responded_at: fromInstant(c.responded_at), resolved_at: fromInstant(c.resolved_at), notes: c.notes });
const casePayload = (d: CaseDraft): SlaCasePayload => ({ policy_id: d.policy_id, intervention_id: d.intervention_id, reference: d.reference.trim(), opened_at: toInstant(d.opened_at) ?? "", responded_at: toInstant(d.responded_at), resolved_at: toInstant(d.resolved_at), notes: d.notes.trim() });
const pauseSchema = z.object({ started_at: z.string().min(1, "Indiquez le début de la pause."), reason: z.string().trim().max(400) }).strict();
const resumeSchema = z.object({ ended_at: z.string().min(1, "Indiquez la fin de la pause.") }).strict();

// Same derivation as the enterprise CSV export (app/api/enterprise/interventions/search/route.ts).
const ticketRef = (id: string) => `INT-${id.slice(0, 6).toUpperCase()}`;
const CATEGORY_LABEL: Record<string, string> = { outage: "Coupure de courant", panel: "Tableau électrique", socket: "Prise ou interrupteur", lighting: "Éclairage", diagnostic: "Recherche de panne" };
const day = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });

/**
 * ENT-07 — optional link of an SLA case to an intervention of THIS site. The current link (even
 * outside the loaded page or after a read error) is always shown and kept; it is removed only by
 * « Retirer le lien ». The choice reads the paginated enterprise search bounded to organisation +
 * site + identity; rows of any other site are never offered.
 */
function InterventionLink({ value, onChange, binding, organizationId, siteId }: { value: string | null; onChange: (id: string | null) => void; binding: InterventionSearchBinding | undefined; organizationId: string; siteId: string }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const filters = binding && open ? { organization_id: organizationId, site_id: siteId, category: null, status: null, search, sort: "recent" as const } : null;
  const { state, retry } = useEnterpriseSearch({ enabled: Boolean(binding && open), context: binding?.context ?? { generation: () => 0, userId: () => null }, filters, page, api: binding?.api });
  const rows = state.items.filter((r) => r.site_id === siteId.toLowerCase());
  return (
    <fieldset className={styles.fieldset} data-sla-intervention={value ?? ""}>
      <legend>Ticket d’intervention lié (facultatif)</legend>
      <p className={styles.hint} data-sla-current-link="">
        {value ? <>Ticket lié : <strong>{ticketRef(value)}</strong></> : "Aucun ticket lié."}
      </p>
      <div className={styles.actions}>
        {value && (
          <button type="button" className="button outline" onClick={() => onChange(null)} data-sla-unlink="">
            Retirer le lien
          </button>
        )}
        {binding ? (
          <button type="button" className="button outline" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {open ? "Masquer les interventions du site" : value ? "Choisir un autre ticket" : "Choisir un ticket du site"}
          </button>
        ) : (
          <span className={styles.hint}>Le choix d’un ticket n’est pas disponible ici.</span>
        )}
      </div>
      {binding && open && (
        <div data-sla-picker={state.phase}>
          <Field label="Rechercher une intervention du site">{(a) => <input {...a} type="search" value={search} maxLength={80} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />}</Field>
          {state.phase === "loading" && <p className={styles.hint} role="status">{ENTERPRISE_SEARCH_COPY.loading}</p>}
          {(state.phase === "error" || state.phase === "forbidden") && (
            <div role="alert" data-sla-picker-error="">
              <p className={styles.hint}>{state.error || ENTERPRISE_SEARCH_COPY.failed} Le ticket lié actuel est conservé.</p>
              {state.phase === "error" && <button type="button" className="button outline" onClick={() => retry()}>Réessayer</button>}
            </div>
          )}
          {state.phase === "ready" && rows.length === 0 && <p className={styles.hint} data-sla-picker-empty="">Aucune intervention de ce site ne correspond.</p>}
          {state.phase === "ready" && rows.length > 0 && (
            <ul className={styles.plain} aria-label="Interventions du site">
              {rows.map((r) => (
                <li key={r.id} data-sla-option={r.id}>
                  <label style={{ display: "flex", gap: 10, alignItems: "center", minHeight: 44, cursor: "pointer" }}>
                    <input type="radio" name="sla-intervention" checked={value === r.id} onChange={() => onChange(r.id)} style={{ width: 20, height: 20 }} />
                    <span>
                      <strong>{ticketRef(r.id)}</strong> · {CATEGORY_LABEL[r.category] ?? r.category} · {r.city} · {day(r.created_at)}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {state.phase === "ready" && state.pages > 1 && (
            <div className={styles.actions} aria-label="Pages des interventions">
              <button type="button" className="button outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} data-sla-prev="">Précédent</button>
              <span className={styles.hint}>Page {state.page} sur {state.pages}</span>
              <button type="button" className="button outline" disabled={page >= state.pages} onClick={() => setPage((p) => p + 1)} data-sla-next="">Suivant</button>
            </div>
          )}
        </div>
      )}
    </fieldset>
  );
}

function TrackCell({ label, track }: { label: string; track: SlaTrack }) {
  return (
    <div className={styles.track}>
      <span>{label}</span>
      <Tag tone={TRACK_TONE[track.status]}>{TRACK_STATUS[track.status]}</Tag>
      {track.status === "not_measurable" ? (
        <small>{track.reason ? NOT_MEASURABLE[track.reason] : "non mesurable"}</small>
      ) : (
        <small>
          cible {minutes(track.target_minutes)} · écoulé {minutes(track.elapsed_minutes)}
          {track.status === "pending" && ` · reste ${minutes(track.remaining_minutes)}`}
          {/* ENT-06: the computed due date stays readable after a response or a resolution. */}
          {track.deadline_at && <span data-sla-deadline=""> · échéance calculée {dateTime(track.deadline_at)}</span>}
        </small>
      )}
    </div>
  );
}

export function SlaPanel({ context }: { context: PanelContext }) {
  const { report, canWrite, canWriteOrganization } = context;
  const { sla_calendars: calendars, sla_policies: policies, sla_cases: cases, limits } = report.snapshot;
  const evaluations = new Map<string, SlaEvaluation>(report.sla.cases.map((c) => [c.case_id, c]));
  const summary = report.sla.summary;
  const [mode, setMode] = useState<Mode>({ kind: "none" });
  const [calendarDraft, setCalendarDraft] = useState<CalendarDraft>(emptyCalendar);
  const [policyDraft, setPolicyDraft] = useState<PolicyDraft>(emptyPolicy);
  const [caseDraft, setCaseDraft] = useState<CaseDraft>(() => emptyCase(policies[0]?.id ?? ""));
  const [pauseDraft, setPauseDraft] = useState({ started_at: "", reason: "" });
  const [resumeDraft, setResumeDraft] = useState({ ended_at: "" });
  const form = useSubmit(context);
  // SLA case editor: one save at a time (synchronous guard) and a token per opened editor, so only
  // the editor that sent the save is closed by its success; a late reply for another one is ignored.
  const caseInFlight = useRef(false);
  const caseEditor = useRef(0);
  const siteRef = useRef(report.site_id);
  siteRef.current = report.site_id;
  const close = () => {
    caseEditor.current++;
    setMode({ kind: "none" });
  };
  const start = (next: Mode) => { caseEditor.current++; setMode(next); form.setMessage(null); };
  const saveCase = async (event: FormEvent) => {
    event.preventDefault();
    if (mode.kind !== "case" || !canWrite || caseInFlight.current || form.submitting || context.busy) return;
    caseInFlight.current = true;
    const token = caseEditor.current, site = report.site_id;
    const payload = casePayload(caseDraft); // built once: after a failure the draft (and link) stay as sent
    const command = mode.id
      ? { action: "save_sla_case" as const, site_id: site, payload, id: mode.id, expected_version: mode.version ?? 0 }
      : { action: "save_sla_case" as const, site_id: site, payload };
    try {
      await form.submit(event, slaCasePayload, payload, command, () => {
        if (caseEditor.current === token && site === siteRef.current) close();
      }, "Dossier enregistré.");
    } finally {
      caseInFlight.current = false;
    }
  };
  const activePolicies = policies.filter((p) => p.status === "active");
  const org = report.snapshot.site.organization_id;
  return (
    <section aria-labelledby="so-sla-title">
      <header className={styles.sectionHead}>
        <div>
          <h3 id="so-sla-title">Suivi des délais</h3>
          <p>{NO_GLOBAL_ALERT_NOTICE}</p>
        </div>
      </header>
      {!canWrite && <ReadOnly reason={context.readOnlyReason} />}
      {limits.sla_cases_limited && <p className={styles.truncated}>Synthèse partielle : seuls les {cases.length} dossiers les plus récents sont comptés ; d’autres dossiers existent et ne sont pas évalués ici.</p>}
      <div className={styles.statRow} aria-label="Synthèse des délais">
        <div><span>Dossiers suivis</span><strong>{summary.cases}</strong><small>{limits.sla_cases_limited ? "affichés (liste tronquée)" : `${summary.measurable} mesurable${summary.measurable > 1 ? "s" : ""}`}</small></div>
        <div><span>Dépassés</span><strong>{summary.measurable ? summary.breached : "—"}</strong><small>{summary.measurable ? "parmi les dossiers mesurables" : "aucun dossier mesurable"}</small></div>
        <div><span>En cours</span><strong>{summary.measurable ? summary.pending : "—"}</strong><small>délai non échu</small></div>
        <div><span>Non mesurables</span><strong>{summary.not_measurable}</strong><small>calendrier ou cible manquants</small></div>
      </div>
      {form.message && mode.kind === "none" && <Notice tone={form.message.tone} onClose={() => form.setMessage(null)}>{form.message.text}</Notice>}

      <h4 className={styles.subhead}>Calendriers ouvrés de l’organisation</h4>
      {canWrite && !canWriteOrganization && <p className={styles.hint}>Les calendriers sont définis au niveau de l’organisation.</p>}
      {calendars.length === 0 ? (
        <p className={styles.hint}>Aucun calendrier ouvré : tous les délais restent non mesurables tant qu’un calendrier n’est pas configuré.</p>
      ) : (
        <ul className={styles.plain}>
          {calendars.map((c) => (
            <li key={c.id}>
              <span><strong>{c.name}</strong> · {c.timezone}</span>
              <span>{c.windows.length ? c.windows.map((w) => `${WEEKDAY[w.weekday]} ${w.start}–${w.end}`).join(", ") : "aucune plage ouvrée"}{c.closed_dates.length ? ` · ${c.closed_dates.length} jour${c.closed_dates.length > 1 ? "s" : ""} fermé${c.closed_dates.length > 1 ? "s" : ""}` : ""}</span>
              {canWriteOrganization && <button type="button" className={styles.link} onClick={() => { setCalendarDraft(calendarFromRow(c)); start({ kind: "calendar", id: c.id, version: c.version }); }} disabled={mode.kind !== "none"}>Modifier</button>}
            </li>
          ))}
        </ul>
      )}
      {canWriteOrganization && mode.kind === "none" && <button type="button" className="button outline" onClick={() => { setCalendarDraft(emptyCalendar()); start({ kind: "calendar", id: null, version: null }); }}>Ajouter un calendrier</button>}
      {mode.kind === "calendar" && (
        <form className={styles.form} noValidate onSubmit={(event) => form.submit(event, slaCalendarPayload, calendarPayload(calendarDraft), mode.id ? { action: "save_sla_calendar", organization_id: org, payload: calendarPayload(calendarDraft), id: mode.id, expected_version: mode.version ?? 0 } : { action: "save_sla_calendar", organization_id: org, payload: calendarPayload(calendarDraft) }, close, "Calendrier enregistré.")}>
          <h4>{mode.id ? "Modifier le calendrier" : "Nouveau calendrier ouvré"}</h4>
          {form.message && <Notice tone={form.message.tone}>{form.message.text}</Notice>}
          <div className={styles.grid2}>
            <Field label="Nom" error={form.errors.name}>{(a) => <input {...a} value={calendarDraft.name} maxLength={160} onChange={(e) => setCalendarDraft((d) => ({ ...d, name: e.target.value }))} />}</Field>
            <Field label="Fuseau horaire" hint="Identifiant IANA, par exemple America/Martinique ou Europe/Paris." error={form.errors.timezone}>{(a) => <input {...a} value={calendarDraft.timezone} maxLength={64} onChange={(e) => setCalendarDraft((d) => ({ ...d, timezone: e.target.value }))} />}</Field>
          </div>
          <fieldset className={styles.fieldset}>
            <legend>Plages ouvrées {form.errors.windows && <span className="field-error" role="alert">{form.errors.windows}</span>}</legend>
            {calendarDraft.windows.map((w, i) => (
              <div key={i} className={styles.lineRow}>
                <Field label={`Jour ${i + 1}`}>{(a) => <select {...a} value={w.weekday} onChange={(e) => setCalendarDraft((d) => ({ ...d, windows: d.windows.map((x, j) => (j === i ? { ...x, weekday: e.target.value } : x)) }))}>{Object.entries(WEEKDAY).map(([k, v]) => (<option key={k} value={k}>{v}</option>))}</select>}</Field>
                <Field label="Début (HH:MM)">{(a) => <input {...a} value={w.start} placeholder="08:00" maxLength={5} onChange={(e) => setCalendarDraft((d) => ({ ...d, windows: d.windows.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)) }))} />}</Field>
                <Field label="Fin (HH:MM)">{(a) => <input {...a} value={w.end} placeholder="17:00" maxLength={5} onChange={(e) => setCalendarDraft((d) => ({ ...d, windows: d.windows.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)) }))} />}</Field>
                <button type="button" className="button outline" onClick={() => setCalendarDraft((d) => ({ ...d, windows: d.windows.filter((_, j) => j !== i) }))} aria-label={`Retirer la plage ${i + 1}`}>Retirer</button>
              </div>
            ))}
            <button type="button" className="button outline" onClick={() => setCalendarDraft((d) => ({ ...d, windows: [...d.windows, { weekday: "1", start: "", end: "" }] }))} disabled={calendarDraft.windows.length >= 21}>Ajouter une plage</button>
          </fieldset>
          <Field label="Jours fermés (facultatif)" hint="Une date AAAA-MM-JJ par ligne, décidée par votre organisation ; aucun calendrier de jours fériés n’est fourni." error={form.errors.closed_dates}>{(a) => <textarea {...a} value={calendarDraft.closed_dates} onChange={(e) => setCalendarDraft((d) => ({ ...d, closed_dates: e.target.value }))} />}</Field>
          <div className={styles.actions}>
            <button type="submit" className="button primary" disabled={form.submitting || context.busy}>{form.submitting ? "Enregistrement…" : "Enregistrer"}</button>
            <button type="button" className="button outline" onClick={close} disabled={form.submitting}>Annuler</button>
          </div>
        </form>
      )}

      <h4 className={styles.subhead}>Règles de délai du site</h4>
      {policies.length === 0 ? (
        <p className={styles.hint}>Aucune règle configurée pour ce site.</p>
      ) : (
        <ul className={styles.plain}>
          {policies.map((p) => (
            <li key={p.id}>
              <span><strong>{p.name}</strong> {p.status === "archived" && <Tag tone="neutral">Archivée</Tag>}</span>
              <span>
                {p.urgency ? (p.urgency === "urgent" ? "Urgences" : "Interventions planifiées") : "Toutes urgences"} · réponse {p.response_target_minutes === null ? "non définie" : minutes(p.response_target_minutes)} · résolution {p.resolution_target_minutes === null ? "non définie" : minutes(p.resolution_target_minutes)} · {p.calendar_id ? calendars.find((c) => c.id === p.calendar_id)?.name ?? "calendrier non affiché" : "sans calendrier (non mesurable)"}
              </span>
              {canWrite && <button type="button" className={styles.link} onClick={() => { setPolicyDraft(policyFromRow(p)); start({ kind: "policy", id: p.id, version: p.version }); }} disabled={mode.kind !== "none"}>Modifier</button>}
            </li>
          ))}
        </ul>
      )}
      {canWrite && mode.kind === "none" && <button type="button" className="button outline" onClick={() => { setPolicyDraft(emptyPolicy()); start({ kind: "policy", id: null, version: null }); }}>Ajouter une règle</button>}
      {mode.kind === "policy" && (
        <form className={styles.form} noValidate onSubmit={(event) => form.submit(event, slaPolicyPayload, policyPayload(policyDraft), mode.id ? { action: "save_sla_policy", site_id: report.site_id, payload: policyPayload(policyDraft), id: mode.id, expected_version: mode.version ?? 0 } : { action: "save_sla_policy", site_id: report.site_id, payload: policyPayload(policyDraft) }, close, "Règle enregistrée.")}>
          <h4>{mode.id ? "Modifier la règle" : "Nouvelle règle de délai"}</h4>
          {form.message && <Notice tone={form.message.tone}>{form.message.text}</Notice>}
          <div className={styles.grid2}>
            <Field label="Nom" error={form.errors.name}>{(a) => <input {...a} value={policyDraft.name} maxLength={160} onChange={(e) => setPolicyDraft((d) => ({ ...d, name: e.target.value }))} />}</Field>
            <Field label="Calendrier ouvré" hint="Sans calendrier, la règle reste non mesurable." error={form.errors.calendar_id}>{(a) => <select {...a} value={policyDraft.calendar_id} onChange={(e) => setPolicyDraft((d) => ({ ...d, calendar_id: e.target.value }))}><option value="">Aucun</option>{calendars.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}</select>}</Field>
            <Field label="Urgence concernée" error={form.errors.urgency}>{(a) => <select {...a} value={policyDraft.urgency} onChange={(e) => setPolicyDraft((d) => ({ ...d, urgency: e.target.value as PolicyDraft["urgency"] }))}><option value="">Toutes</option><option value="urgent">Urgences</option><option value="scheduled">Interventions planifiées</option></select>}</Field>
            <Field label="Statut" error={form.errors.status}>{(a) => <select {...a} value={policyDraft.status} onChange={(e) => setPolicyDraft((d) => ({ ...d, status: e.target.value as PolicyStatus }))}><option value="active">Active</option><option value="archived">Archivée</option></select>}</Field>
            <Field label="Cible de réponse (minutes ouvrées, facultatif)" error={form.errors.response_target_minutes}>{(a) => <input {...a} inputMode="numeric" value={policyDraft.response} onChange={(e) => setPolicyDraft((d) => ({ ...d, response: e.target.value }))} />}</Field>
            <Field label="Cible de résolution (minutes ouvrées, facultatif)" error={form.errors.resolution_target_minutes}>{(a) => <input {...a} inputMode="numeric" value={policyDraft.resolution} onChange={(e) => setPolicyDraft((d) => ({ ...d, resolution: e.target.value }))} />}</Field>
          </div>
          <div className={styles.actions}>
            <button type="submit" className="button primary" disabled={form.submitting || context.busy}>{form.submitting ? "Enregistrement…" : "Enregistrer"}</button>
            <button type="button" className="button outline" onClick={close} disabled={form.submitting}>Annuler</button>
          </div>
        </form>
      )}

      <h4 className={styles.subhead}>Dossiers suivis</h4>
      {canWrite && mode.kind === "none" && activePolicies.length > 0 && <button type="button" className="button primary" onClick={() => { setCaseDraft(emptyCase(activePolicies[0].id)); start({ kind: "case", id: null, version: null }); }}>Ouvrir un dossier de délai</button>}
      {canWrite && activePolicies.length === 0 && <p className={styles.hint}>Créez d’abord une règle active pour suivre un dossier.</p>}
      {/* Right lost after re-evaluation (canWrite false): the editor is withdrawn, nothing is sent. */}
      {mode.kind === "case" && canWrite && (
        <form className={styles.form} noValidate onSubmit={(event) => void saveCase(event)} data-sla-case-form={form.submitting ? "saving" : "idle"}>
          <h4>{mode.id ? "Modifier le dossier" : "Nouveau dossier de délai"}</h4>
          {/* Every field and every link control (choose, remove, search, pages) is locked while the save is in flight. */}
          <fieldset disabled={form.submitting} aria-busy={form.submitting || undefined} style={{ display: "contents" }} data-sla-lock="">
          {form.message && <Notice tone={form.message.tone}>{form.message.text}</Notice>}
          <div className={styles.grid2}>
            <Field label="Règle appliquée" error={form.errors.policy_id}>{(a) => <select {...a} value={caseDraft.policy_id} onChange={(e) => setCaseDraft((d) => ({ ...d, policy_id: e.target.value }))}>{policies.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}</select>}</Field>
            <Field label="Référence (facultatif)" error={form.errors.reference}>{(a) => <input {...a} value={caseDraft.reference} maxLength={160} onChange={(e) => setCaseDraft((d) => ({ ...d, reference: e.target.value }))} />}</Field>
            <Field label="Ouverture" hint="Heure locale de votre appareil ; convertie en temps universel." error={form.errors.opened_at}>{(a) => <input {...a} type="datetime-local" value={caseDraft.opened_at} onChange={(e) => setCaseDraft((d) => ({ ...d, opened_at: e.target.value }))} />}</Field>
            <Field label="Réponse constatée (facultatif)" error={form.errors.responded_at}>{(a) => <input {...a} type="datetime-local" value={caseDraft.responded_at} onChange={(e) => setCaseDraft((d) => ({ ...d, responded_at: e.target.value }))} />}</Field>
            <Field label="Résolution constatée (facultatif)" error={form.errors.resolved_at}>{(a) => <input {...a} type="datetime-local" value={caseDraft.resolved_at} onChange={(e) => setCaseDraft((d) => ({ ...d, resolved_at: e.target.value }))} />}</Field>
          </div>
          <Field label="Notes (facultatif)" error={form.errors.notes}>{(a) => <textarea {...a} value={caseDraft.notes} maxLength={4000} onChange={(e) => setCaseDraft((d) => ({ ...d, notes: e.target.value }))} />}</Field>
          <InterventionLink value={caseDraft.intervention_id} onChange={(id) => setCaseDraft((d) => ({ ...d, intervention_id: id }))} binding={context.interventionSearch} organizationId={org} siteId={report.site_id} />
          <div className={styles.actions}>
            <button type="submit" className="button primary" disabled={form.submitting || context.busy}>{form.submitting ? "Enregistrement…" : "Enregistrer"}</button>
            <button type="button" className="button outline" onClick={close} disabled={form.submitting}>Annuler</button>
          </div>
          </fieldset>
        </form>
      )}
      {cases.length === 0 ? (
        <EmptyState title="Aucun dossier suivi">Les délais sont suivis à partir des faits saisis par votre organisation (ouverture, réponse, résolution, pauses).</EmptyState>
      ) : (
        <ul className={styles.cards} aria-label="Dossiers de délai">
          {cases.map((c) => {
            const e = evaluations.get(c.id);
            const policy = policies.find((p) => p.id === c.policy_id);
            const openPause = c.pauses.find((p) => p.ended_at === null);
            return (
              <li key={c.id} className={styles.card}>
                <div className={styles.cardHead}>
                  <strong>{c.reference || `Dossier ${c.id.slice(0, 8).toUpperCase()}`} <span className={styles.muted}>— {policy?.name ?? "règle non affichée"}</span></strong>
                  <span className={styles.tags}>
                    {e?.paused_now && <Tag tone="amber">En pause</Tag>}
                    {c.resolved_at && <Tag tone="green">Résolu</Tag>}
                    {e && !e.measurable && <Tag tone="neutral">Non mesurable</Tag>}
                  </span>
                </div>
                <dl className={styles.meta}>
                  <div><dt>Ouvert</dt><dd>{dateTime(c.opened_at)}</dd></div>
                  <div><dt>Réponse</dt><dd>{dateTime(c.responded_at)}</dd></div>
                  <div><dt>Résolution</dt><dd>{dateTime(c.resolved_at)}</dd></div>
                  <div><dt>Pauses</dt><dd>{c.pauses_total}{c.pauses_total !== c.pauses.length ? ` (${c.pauses.length} reçues)` : ""}</dd></div>
                  <div>
                    <dt>Ticket lié</dt>
                    <dd data-sla-case-link={c.intervention_id ?? ""}>
                      {c.intervention_id ? (
                        context.onNavigate ? (
                          <button type="button" className={styles.link} onClick={() => context.onNavigate?.("intervention", c.intervention_id!)}>{ticketRef(c.intervention_id)}</button>
                        ) : ticketRef(c.intervention_id)
                      ) : "—"}
                    </dd>
                  </div>
                </dl>
                {e && (
                  <div className={styles.tracks}>
                    <TrackCell label="Réponse" track={e.response} />
                    <TrackCell label="Résolution" track={e.resolution} />
                  </div>
                )}
                {e && !e.measurable && <p className={styles.hint}>Non mesurable : {e.reasons.map((r) => NOT_MEASURABLE[r]).join(" ; ")}.</p>}
                {c.pauses.length > 0 && (
                  <details className={styles.details}>
                    <summary>Pauses</summary>
                    <ul className={styles.plain}>
                      {c.pauses.map((p) => (<li key={p.id}><span>{dateTime(p.started_at)} → {p.ended_at ? dateTime(p.ended_at) : "en cours"}</span><span>{p.reason || "—"}</span></li>))}
                    </ul>
                  </details>
                )}
                {canWrite && (
                  <div className={styles.cardActions}>
                    <button type="button" className="button outline" disabled={mode.kind !== "none"} onClick={() => { setCaseDraft(caseFromRow(c)); start({ kind: "case", id: c.id, version: c.version }); }}>Modifier</button>
                    {!c.resolved_at && !openPause && <button type="button" className="button outline" disabled={mode.kind !== "none"} onClick={() => { setPauseDraft({ started_at: "", reason: "" }); start({ kind: "pause", caseId: c.id, version: c.version }); }}>Mettre en pause</button>}
                    {openPause && <button type="button" className="button outline" disabled={mode.kind !== "none"} onClick={() => { setResumeDraft({ ended_at: "" }); start({ kind: "resume", caseId: c.id, version: c.version }); }}>Reprendre</button>}
                  </div>
                )}
                {mode.kind === "pause" && mode.caseId === c.id && (
                  <form className={styles.subform} noValidate onSubmit={(event) => form.submit(event, pauseSchema, pauseDraft, { action: "pause_sla_case", id: c.id, started_at: toInstant(pauseDraft.started_at) ?? "", reason: pauseDraft.reason.trim(), expected_version: mode.version }, close, "Pause enregistrée.")}>
                    {form.message && <Notice tone={form.message.tone}>{form.message.text}</Notice>}
                    <Field label="Début de la pause" error={form.errors.started_at}>{(a) => <input {...a} type="datetime-local" value={pauseDraft.started_at} onChange={(e) => setPauseDraft((d) => ({ ...d, started_at: e.target.value }))} />}</Field>
                    <Field label="Motif (facultatif)" error={form.errors.reason}>{(a) => <input {...a} value={pauseDraft.reason} maxLength={400} onChange={(e) => setPauseDraft((d) => ({ ...d, reason: e.target.value }))} />}</Field>
                    <div className={styles.actions}>
                      <button type="submit" className="button primary" disabled={form.submitting || context.busy}>{form.submitting ? "Enregistrement…" : "Mettre en pause"}</button>
                      <button type="button" className="button outline" onClick={close} disabled={form.submitting}>Annuler</button>
                    </div>
                  </form>
                )}
                {mode.kind === "resume" && mode.caseId === c.id && (
                  <form className={styles.subform} noValidate onSubmit={(event) => form.submit(event, resumeSchema, resumeDraft, { action: "resume_sla_case", id: c.id, ended_at: toInstant(resumeDraft.ended_at) ?? "", expected_version: mode.version }, close, "Reprise enregistrée.")}>
                    {form.message && <Notice tone={form.message.tone}>{form.message.text}</Notice>}
                    <Field label="Fin de la pause" error={form.errors.ended_at}>{(a) => <input {...a} type="datetime-local" value={resumeDraft.ended_at} onChange={(e) => setResumeDraft({ ended_at: e.target.value })} />}</Field>
                    <div className={styles.actions}>
                      <button type="submit" className="button primary" disabled={form.submitting || context.busy}>{form.submitting ? "Enregistrement…" : "Reprendre le délai"}</button>
                      <button type="button" className="button outline" onClick={close} disabled={form.submitting}>Annuler</button>
                    </div>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <Truncated name="dossiers" limited={limits.sla_cases_limited} />
      <Truncated name="règles" limited={limits.sla_policies_limited} />
      <Truncated name="calendriers" limited={limits.sla_calendars_limited} />
    </section>
  );
}
