"use client";
// Leaf component: personal planning of the artisan (contract ADV-PLANNING-NOTIFICATIONS-001, A1).
// Everything comes through props; no fetch, no global import, no derived right. The server view
// decides free/occupied intervals; the browser only lays the week out in the planning zone.
import { useCallback, useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { Empty, Field, Loader, Tag, Unavailable } from "../../app/ui";
import { Icon } from "../../app/icons";
import { PLANNING_COPY, canEdit, reduceCommand, reduceLoad, scopeKey, type ContractState, type LeafScope, type LoadState, type PlanningClient } from "../../../lib/features/planning/leaf";
import { PLANNING_TIME_ZONE, type AvailabilityRule, type PlanningCommand, type PlanningEntry, type PlanningEntryKind, type PlanningView, type Weekday } from "../../../lib/features/planning/types";
import { WEEKDAYS, WEEKDAY_LABELS, clipToDay, dateKey, instantFromKey, labelDate, labelTime, minutesLabel, parseMinutes, toIsoWithOffset, weekRange } from "../../../lib/features/planning/time";
import styles from "./artisan-planning.module.css";

export type ArtisanPlanningProps = {
  state: ContractState;
  unavailableMessage: string;
  scope: LeafScope;
  client: PlanningClient;
  demo?: PlanningView;
  onNavigate?: (view: string, param?: string) => void;
  timeZone?: string;
};
const KIND_LABELS: Record<PlanningEntryKind, string> = { busy: "Occupé (rendez-vous personnel)", unavailable: "Indisponible (congé, fermeture)", available: "Disponible exceptionnellement" };
const newRequestId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `00000000-0000-4000-8000-${Date.now().toString(16).padStart(12, "0").slice(-12)}`);

/** Remounts on any scope change so that no form, draft or data survives an identity switch. */
export function ArtisanPlanning(props: ArtisanPlanningProps) {
  return <PlanningBody key={scopeKey(props.scope)} {...props} />;
}

function PlanningBody({ state, unavailableMessage, scope, client, demo, onNavigate, timeZone = PLANNING_TIME_ZONE }: ArtisanPlanningProps) {
  const [offset, setOffset] = useState(0);
  const [load, setLoad] = useState<LoadState<PlanningView>>(demo ? { status: "ready", data: demo } : { status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [notice, setNotice] = useState("");
  // Demo data describes its own week; live data follows today's week in the planning zone.
  const anchor = demo ? demo.range.from : null;
  const range = useMemo(() => weekRange(anchor ? new Date(anchor) : new Date(), timeZone, offset), [anchor, timeZone, offset]);
  const todayKey = dateKey(new Date(), timeZone);
  const available = state === "available";

  useEffect(() => {
    if (demo || !available) return;
    let active = true;
    setLoad((previous) => (previous.status === "ready" ? previous : { status: "loading" }));
    client
      .load({ from: toIsoWithOffset(range.from, timeZone), to: toIsoWithOffset(range.to, timeZone) })
      .then((answer) => { if (active) setLoad((previous) => reduceLoad(previous, answer)); })
      .catch((error: unknown) => { if (active) setLoad({ status: "error", message: error instanceof Error && error.message ? error.message : PLANNING_COPY.loadError }); });
    return () => { active = false; };
  }, [client, demo, available, range, timeZone, reloadKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);
  const view = load.status === "ready" ? load.data : null;
  const edit = canEdit(scope, view);
  const writable = edit.allowed && !demo;

  if (!available) return <Unavailable title="Planning" reason={unavailableMessage} state={state} blocker="capability:planning" />;
  return (
    <div className={styles.root} data-scope={scope.userId}>
      {demo && <p className={styles.demoNote}>{PLANNING_COPY.demo}</p>}
      {!edit.allowed && <p className={styles.readOnly} role="note"><strong>{PLANNING_COPY.readOnly}.</strong> {edit.reason}</p>}
      {notice && <p className={styles.notice} role="status">{notice}</p>}
      <div className={styles.toolbar}>
        <div>
          <h2 className={styles.weekTitle}>Semaine du {labelDate(range.from, timeZone)}</h2>
          <span className={styles.zone}>Heures affichées en {timeZone === PLANNING_TIME_ZONE ? "heure de Martinique (UTC−4)" : timeZone}.</span>
        </div>
        <div className={styles.toolbarNav}>
          <button type="button" className="button outline" aria-label="Semaine précédente" onClick={() => setOffset((o) => o - 1)}><Icon name="back" size={18} /></button>
          <button type="button" className="button outline" onClick={() => setOffset(0)} disabled={offset === 0}>Aujourd’hui</button>
          <button type="button" className="button outline" aria-label="Semaine suivante" onClick={() => setOffset((o) => o + 1)}><Icon name="arrow" size={18} /></button>
          {!demo && <button type="button" className="button outline" onClick={reload} aria-label="Recharger la semaine"><Icon name="refresh" size={18} /></button>}
        </div>
      </div>
      {load.status === "loading" && <Loader label="Chargement du planning…" />}
      {load.status === "error" && (
        <div className="alert" role="alert">
          <p className={styles.error}>{load.message}</p>
          <button type="button" className="button outline" onClick={reload}>Réessayer</button>
        </div>
      )}
      {view && (
        <>
          <ul className={styles.legend} aria-label="Légende">
            <li><span className={`${styles.swatch} ${styles.blockFree}`} />Libre</li>
            <li><span className={`${styles.swatch} ${styles.blockAppointment}`} />Rendez-vous d’intervention</li>
            <li><span className={`${styles.swatch} ${styles.blockBusy}`} />Occupé</li>
            <li><span className={`${styles.swatch} ${styles.blockUnavailable}`} />Indisponible</li>
          </ul>
          <WeekGrid view={view} days={range.days} todayKey={todayKey} timeZone={timeZone} writable={writable} client={client} onChanged={(message) => { setNotice(message); reload(); }} onNavigate={onNavigate} />
          {(view.limits.entries_limited || view.limits.appointments_limited) && (
            <p className={styles.demoNote}>La semaine contient plus d’éléments que la limite affichée ({view.limits.entries} entrées, {view.limits.appointments} rendez-vous). Réduisez la période pour tout voir.</p>
          )}
          <RulesSection view={view} writable={writable} client={client} onChanged={(message) => { setNotice(message); reload(); }} />
          {writable && <EntryForm key={`entry-${reloadKey}`} client={client} days={range.days} timeZone={timeZone} onChanged={(message) => { setNotice(message); reload(); }} />}
        </>
      )}
    </div>
  );
}

// ---- Week ---------------------------------------------------------------------------------------
type Block = { key: string; kind: "free" | "appointment" | PlanningEntryKind; start: number; end: number; label: string; detail?: string; entry?: PlanningEntry; interventionId?: string; outside?: boolean };
function WeekGrid({ view, days, todayKey, timeZone, writable, client, onChanged, onNavigate }: { view: PlanningView; days: string[]; todayKey: string; timeZone: string; writable: boolean; client: PlanningClient; onChanged: (message: string) => void; onNavigate?: (view: string, param?: string) => void }) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const blocksFor = (key: string): Block[] => {
    const blocks: Block[] = [];
    for (const f of view.free) { const c = clipToDay(f, key, timeZone); if (c) blocks.push({ key: `free-${f.starts_at}`, kind: "free", ...c, label: "Libre" }); }
    for (const a of view.appointments) { const c = clipToDay(a, key, timeZone); if (c) blocks.push({ key: `apt-${a.intervention_id}`, kind: "appointment", ...c, label: `Rendez-vous ${a.reference}`, detail: `${a.city}${a.note ? ` · ${a.note}` : ""}`, interventionId: a.intervention_id, outside: a.outside_availability }); }
    for (const e of view.entries) { const c = clipToDay(e, key, timeZone); if (c) blocks.push({ key: `entry-${e.id}`, kind: e.kind, ...c, label: e.title || KIND_LABELS[e.kind], detail: e.note || undefined, entry: e }); }
    return blocks.sort((a, b) => a.start - b.start || a.end - b.end);
  };
  const remove = async (entry: PlanningEntry) => {
    setPending(entry.id); setError(null);
    try {
      const outcome = reduceCommand(await client.command({ action: "delete_entry", id: entry.id, expected_version: entry.version }));
      if (outcome.kind === "success") onChanged("Entrée supprimée.");
      else if (outcome.kind !== "stale") setError({ key: entry.id, message: outcome.kind === "conflict" ? `${outcome.message} ${PLANNING_COPY.conflictHint}` : outcome.message });
    } finally { setPending(null); }
  };
  const empty = days.every((key) => blocksFor(key).length === 0);
  if (empty) return <Empty icon="calendar" title={PLANNING_COPY.emptyWeek}>{view.rules.length ? "Aucun créneau libre, rendez-vous ni entrée sur cette semaine." : PLANNING_COPY.emptyRules}</Empty>;
  return (
    <ol className={styles.week} aria-label="Semaine">
      {days.map((key) => {
        const blocks = blocksFor(key);
        return (
          <li key={key} className={`${styles.day} ${key === todayKey ? styles.dayToday : ""}`}>
            <div className={styles.dayHead}>
              <strong>{labelDate(instantFromKey(key, 720, timeZone) ?? new Date(), timeZone)}</strong>
              {key === todayKey && <span className={styles.today}>Aujourd’hui</span>}
            </div>
            {blocks.length === 0 && <p className={styles.dayEmpty}>—</p>}
            {blocks.map((b) => (
              <div key={b.key} className={`${styles.block} ${b.kind === "free" ? styles.blockFree : b.kind === "appointment" ? styles.blockAppointment : b.kind === "busy" ? styles.blockBusy : b.kind === "unavailable" ? styles.blockUnavailable : styles.blockAvailable}`}>
                <time>{minutesLabel(b.start)} – {minutesLabel(b.end)}</time>
                <span>{b.label}</span>
                {b.detail && <small>{b.detail}</small>}
                {b.outside && <small className={styles.outside}>Hors de vos disponibilités déclarées</small>}
                {(b.interventionId && onNavigate) || (b.entry && writable) ? (
                  <div className={styles.blockActions}>
                    {b.interventionId && onNavigate && <button type="button" className="text-button" onClick={() => onNavigate("intervention", b.interventionId)}>Ouvrir le dossier</button>}
                    {b.entry && writable && <button type="button" className="text-button" disabled={pending === b.entry.id} onClick={() => remove(b.entry!)}>{pending === b.entry.id ? "Suppression…" : "Supprimer"}</button>}
                  </div>
                ) : null}
                {b.entry && error?.key === b.entry.id && <small className={styles.error} role="alert">{error.message}</small>}
              </div>
            ))}
          </li>
        );
      })}
    </ol>
  );
}

// ---- Recurring rules ---------------------------------------------------------------------------
function RulesSection({ view, writable, client, onChanged }: { view: PlanningView; writable: boolean; client: PlanningClient; onChanged: (message: string) => void }) {
  const [editing, setEditing] = useState<AvailabilityRule | "new" | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);
  const remove = async (rule: AvailabilityRule) => {
    setPending(rule.id); setError(null);
    try {
      const outcome = reduceCommand(await client.command({ action: "delete_rule", id: rule.id, expected_version: rule.version }));
      if (outcome.kind === "success") onChanged("Plage supprimée.");
      else if (outcome.kind !== "stale") setError({ id: rule.id, message: outcome.kind === "conflict" ? `${outcome.message} ${PLANNING_COPY.conflictHint}` : outcome.message });
    } finally { setPending(null); }
  };
  return (
    <section className={styles.section} aria-labelledby="planning-rules">
      <div className={styles.sectionHead}>
        <h2 id="planning-rules">Disponibilités habituelles</h2>
        {writable && editing === null && <button type="button" className="button primary" onClick={() => setEditing("new")}><Icon name="plus" size={16} />Ajouter une plage</button>}
      </div>
      {view.rules.length === 0 ? (
        <p className={styles.dayEmpty}>{PLANNING_COPY.emptyRules}</p>
      ) : (
        <ul className={styles.rules}>
          {view.rules.map((rule) => (
            <li key={rule.id}>
              <div>
                <strong>{WEEKDAY_LABELS[rule.weekday]}</strong> {minutesLabel(rule.start_minute)} – {minutesLabel(rule.end_minute)}
                <small>
                  {rule.time_zone !== PLANNING_TIME_ZONE && `Fuseau ${rule.time_zone} · `}
                  Depuis le {labelDate(instantFromKey(rule.valid_from, 720, rule.time_zone) ?? new Date(), rule.time_zone)}
                  {rule.valid_until && ` jusqu’au ${labelDate(instantFromKey(rule.valid_until, 720, rule.time_zone) ?? new Date(), rule.time_zone)}`}
                </small>
                {error?.id === rule.id && <small className={styles.error} role="alert">{error.message}</small>}
              </div>
              {writable && (
                <div className={styles.blockActions}>
                  <button type="button" className="text-button" onClick={() => { setError(null); setEditing(rule); }}>Modifier</button>
                  <button type="button" className="text-button" disabled={pending === rule.id} onClick={() => remove(rule)}>{pending === rule.id ? "Suppression…" : "Supprimer"}</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {writable && editing !== null && (
        <RuleForm key={editing === "new" ? "new" : editing.id} rule={editing === "new" ? null : editing} client={client} onClose={() => setEditing(null)} onChanged={(message) => { setEditing(null); onChanged(message); }} />
      )}
    </section>
  );
}
function RuleForm({ rule, client, onClose, onChanged }: { rule: AvailabilityRule | null; client: PlanningClient; onClose: () => void; onChanged: (message: string) => void }) {
  const id = useId();
  const [requestId, setRequestId] = useState(newRequestId);
  const [weekday, setWeekday] = useState<Weekday>(rule?.weekday ?? 1);
  const [start, setStart] = useState(rule ? minutesLabel(rule.start_minute) : "08:00");
  const [end, setEnd] = useState(rule ? minutesLabel(rule.end_minute) : "12:00");
  const [validFrom, setValidFrom] = useState(rule?.valid_from ?? "");
  const [validUntil, setValidUntil] = useState(rule?.valid_until ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next: Record<string, string> = {};
    const startMinutes = parseMinutes(start), endMinutes = parseMinutes(end);
    if (startMinutes === null || startMinutes > 1439) next.start = "Heure de début invalide (HH:MM).";
    if (endMinutes === null || endMinutes < 1) next.end = "Heure de fin invalide (HH:MM).";
    if (startMinutes !== null && endMinutes !== null && endMinutes <= startMinutes) next.end = "L’heure de fin doit être postérieure à l’heure de début.";
    if (validFrom && !/^\d{4}-\d{2}-\d{2}$/.test(validFrom)) next.validFrom = "Date invalide.";
    if (validUntil && !/^\d{4}-\d{2}-\d{2}$/.test(validUntil)) next.validUntil = "Date invalide.";
    if (validFrom && validUntil && validUntil < validFrom) next.validUntil = "La date de fin doit être postérieure à la date de début.";
    setErrors(next); setConflict(false);
    if (Object.keys(next).length) return;
    const body: PlanningCommand = { action: "save_rule", request_id: requestId, weekday, start_minute: startMinutes!, end_minute: endMinutes!, valid_from: validFrom || null, valid_until: validUntil || null, ...(rule ? { id: rule.id, expected_version: rule.version } : {}) };
    setBusy(true);
    try {
      const outcome = reduceCommand(await client.command(body));
      if (outcome.kind === "success") { setRequestId(newRequestId()); onChanged(rule ? "Plage modifiée." : "Plage ajoutée."); }
      else if (outcome.kind === "conflict") { setConflict(true); setErrors({ form: `${outcome.message} ${PLANNING_COPY.conflictHint}` }); }
      else if (outcome.kind === "refused") setErrors({ form: outcome.message });
    } finally { setBusy(false); }
  };
  return (
    <form className={styles.form} onSubmit={submit} aria-labelledby={`${id}-title`} noValidate>
      <h3 id={`${id}-title`} className={styles.weekTitle}>{rule ? "Modifier la plage" : "Nouvelle plage hebdomadaire"}</h3>
      <div className={styles.formRow}>
        <Field label="Jour"><select value={weekday} onChange={(e) => setWeekday(Number(e.target.value) as Weekday)}>{WEEKDAYS.map((d) => <option key={d} value={d}>{WEEKDAY_LABELS[d]}</option>)}</select></Field>
        <Field label="Début" error={errors.start}><input type="time" value={start} required onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="Fin" error={errors.end}><input type="time" value={end} required onChange={(e) => setEnd(e.target.value)} /></Field>
      </div>
      <div className={styles.formRow}>
        <Field label="À partir du (facultatif)" error={errors.validFrom} hint="Vide : dès aujourd’hui."><input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} /></Field>
        <Field label="Jusqu’au (facultatif)" error={errors.validUntil} hint="Vide : sans fin."><input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} /></Field>
      </div>
      {errors.form && <p className={styles.error} role="alert">{errors.form}</p>}
      <div className={styles.formActions}>
        <button type="submit" className="button primary" disabled={busy}>{busy ? "Enregistrement…" : "Enregistrer"}</button>
        <button type="button" className="text-button" onClick={onClose}>Annuler</button>
        {conflict && <button type="button" className="text-button" onClick={onClose}>Recharger</button>}
      </div>
    </form>
  );
}

// ---- One-off entry -------------------------------------------------------------------------------
function EntryForm({ client, days, timeZone, onChanged }: { client: PlanningClient; days: string[]; timeZone: string; onChanged: (message: string) => void }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [requestId, setRequestId] = useState(newRequestId);
  const [kind, setKind] = useState<PlanningEntryKind>("busy");
  const [day, setDay] = useState(days[0]);
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("10:00");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  if (!open) return <div className={styles.formActions}><button type="button" className="button outline" onClick={() => setOpen(true)}><Icon name="plus" size={16} />Ajouter une entrée ponctuelle</button></div>;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next: Record<string, string> = {};
    const startMinutes = parseMinutes(start), endMinutes = parseMinutes(end);
    const startsAt = startMinutes === null ? null : instantFromKey(day, startMinutes, timeZone);
    const endsAt = endMinutes === null ? null : instantFromKey(day, endMinutes, timeZone);
    if (!startsAt) next.start = "Heure de début invalide (HH:MM).";
    if (!endsAt) next.end = "Heure de fin invalide (HH:MM).";
    if (startsAt && endsAt && endsAt <= startsAt) next.end = "La fin doit être postérieure au début.";
    if (title.length > 160) next.title = "160 caractères maximum.";
    if (note.length > 2000) next.note = "2000 caractères maximum.";
    setErrors(next); setConflict(false);
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      const outcome = reduceCommand(await client.command({ action: "save_entry", request_id: requestId, kind, starts_at: toIsoWithOffset(startsAt!, timeZone), ends_at: toIsoWithOffset(endsAt!, timeZone), title: title.trim(), note: note.trim() }));
      if (outcome.kind === "success") { setRequestId(newRequestId()); setOpen(false); onChanged("Entrée ajoutée."); }
      else if (outcome.kind === "conflict") { setConflict(true); setErrors({ form: `${outcome.message} ${PLANNING_COPY.conflictHint}` }); }
      else if (outcome.kind === "refused") setErrors({ form: outcome.message });
    } finally { setBusy(false); }
  };
  return (
    <form className={styles.form} onSubmit={submit} aria-labelledby={`${id}-title`} noValidate>
      <h3 id={`${id}-title`} className={styles.weekTitle}>Nouvelle entrée ponctuelle</h3>
      <div className={styles.formRow}>
        <Field label="Nature"><select value={kind} onChange={(e) => setKind(e.target.value as PlanningEntryKind)}>{(Object.keys(KIND_LABELS) as PlanningEntryKind[]).map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}</select></Field>
        <Field label="Jour"><select value={day} onChange={(e) => setDay(e.target.value)}>{days.map((d) => <option key={d} value={d}>{labelDate(instantFromKey(d, 720, timeZone) ?? new Date(), timeZone)}</option>)}</select></Field>
        <Field label="Début" error={errors.start}><input type="time" value={start} required onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="Fin" error={errors.end}><input type="time" value={end} required onChange={(e) => setEnd(e.target.value)} /></Field>
      </div>
      <Field label="Intitulé (privé, facultatif)" error={errors.title}><input maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
      <Field label="Note (privée, facultative)" error={errors.note}><textarea maxLength={2000} rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <p className={styles.demoNote}>Un créneau « occupé » refuse tout rendez-vous d’intervention au même moment ; vos intitulés et notes ne sont jamais visibles des clients.</p>
      {errors.form && <p className={styles.error} role="alert">{errors.form}</p>}
      <div className={styles.formActions}>
        <button type="submit" className="button primary" disabled={busy}>{busy ? "Enregistrement…" : "Enregistrer"}</button>
        <button type="button" className="text-button" onClick={() => setOpen(false)}>Annuler</button>
        {conflict && <Tag tone="amber">Conflit de créneau</Tag>}
      </div>
    </form>
  );
}
