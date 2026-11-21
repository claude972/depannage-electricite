"use client";
// ENT-05 co-ownership panel for ONE syndic site: human general-meeting records and documentary calls
// for funds. Never a quorum computation, a collection / payment, or a « sent » claim. Writes only
// when the server says can_write; versioned commands with a stable record id and a fresh
// command_id per operation (replayed unchanged after a lost reply).
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  CO_COPY,
  CO_INITIAL,
  DEFAULT_CO_CONTEXT,
  FUND_STATUS,
  KIND_TITLE,
  MEETING_STATUS,
  coUuid,
  createCoApi,
  createCoController,
  editFundForm,
  editMeetingForm,
  formatEuros,
  fundFormToCommand,
  fundFrozen,
  fundStatusOptions,
  linkedCalls,
  meetingFormToCommand,
  meetingStatusOptions,
  newFundForm,
  newMeetingForm,
  type CoApi,
  type CoContext,
  type CoErrors,
  type CoKind,
  type CoOwnershipRecord,
  type CoState,
  type FundForm,
  type MeetingForm,
} from "./coownership-model";
import styles from "./co-ownership.module.css";

type PanelProps = { siteId: string; readOnly?: boolean; api?: CoApi; context?: CoContext; demo?: boolean; /** Tests only. */ initial?: Partial<Record<CoKind, CoState>>; newId?: () => string | null; tab?: CoKind };
/** Per site (the route is site-scoped). Keyed by uid + generation + mode + site. */
export function CoOwnershipPanel(props: PanelProps) {
  const ctx = props.context ?? DEFAULT_CO_CONTEXT;
  return <SitePanel key={`${ctx.userId() ?? "-"}|${ctx.generation()}|${props.demo ? "demo" : "live"}|${props.siteId}|${Boolean(props.readOnly)}`} {...props} />;
}

function useKind(kind: CoKind, { siteId, api, context = DEFAULT_CO_CONTEXT, demo = false, initial, readOnly = false }: PanelProps) {
  const [state, setStateRaw] = useState<CoState>(() => { const value = initial?.[kind] ?? CO_INITIAL; return readOnly ? { ...value, canWrite: false, pending: null } : value; });
  const ref = useRef(state);
  const set = (next: CoState) => {
    if (readOnly) next = { ...next, canWrite: false, pending: null };
    ref.current = next;
    setStateRaw(next);
  };
  const latest = useRef({ api, context });
  latest.current = { api, context };
  const controller = useRef<ReturnType<typeof createCoController> | null>(null);
  if (!controller.current) {
    let client: CoApi | null = null;
    controller.current = createCoController({
      api: () => (client ??= latest.current.api ?? createCoApi()),
      siteId,
      kind,
      context: { generation: () => latest.current.context.generation(), userId: () => latest.current.context.userId() },
      get: () => ref.current,
      set,
      demo,
    });
  }
  const ctrl = controller.current;
  useEffect(() => {
    ctrl.attach();
    if (!initial?.[kind]) void ctrl.load();
    return () => ctrl.detach();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctrl]);
  return { state, ref, ctrl };
}
const localDateTime = (iso: string | null) => (iso ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)) : "non renseignée");
const dateFr = (d: string | null) => (d ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(new Date(`${d}T12:00:00`)) : "non renseignée");

function SitePanel(props: PanelProps) {
  const meetings = useKind("meeting", props);
  const calls = useKind("fund_call", props);
  const [tab, setTab] = useState<CoKind>(props.tab ?? "meeting");
  const cur = tab === "meeting" ? meetings : calls;
  return (
    <section className={styles.panel} aria-labelledby={`co-${props.siteId}|${Boolean(props.readOnly)}`} data-co-panel={cur.state.phase}>
      <div className={styles.head}>
        <h2 id={`co-${props.siteId}|${Boolean(props.readOnly)}`}>Copropriété</h2>
      </div>
      <p className={styles.note} data-co-banner="">{CO_COPY.banner}</p>
      <div className={styles.actions} role="tablist" aria-label="Dossiers de copropriété">
        {(["meeting", "fund_call"] as CoKind[]).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={styles.secondary} onClick={() => setTab(k)} data-co-tab={k}>
            {KIND_TITLE[k]}
          </button>
        ))}
      </div>
      <KindSection kind={tab} hook={cur} other={tab === "meeting" ? calls.state.records : meetings.state.records} newId={props.newId ?? coUuid} />
    </section>
  );
}

function KindSection({ kind, hook, other, newId }: { kind: CoKind; hook: ReturnType<typeof useKind>; other: CoOwnershipRecord[]; newId: () => string | null }) {
  const { state, ref, ctrl } = hook;
  const [form, setForm] = useState<MeetingForm | FundForm | null>(null);
  const [errors, setErrors] = useState<CoErrors>({});
  const [archiving, setArchiving] = useState<CoOwnershipRecord | null>(null);
  const [noId, setNoId] = useState(false);
  useEffect(() => {
    setForm(null);
    setArchiving(null);
    setErrors({});
  }, [kind]);
  const open = (f: MeetingForm | FundForm | null) => {
    setErrors({});
    setForm(f);
  };
  const startNew = () => {
    const id = newId();
    if (!id) return setNoId(true);
    setNoId(false);
    open(kind === "meeting" ? newMeetingForm(id) : newFundForm(id));
  };
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!form) return;
    const commandId = newId();
    if (!commandId) return setNoId(true);
    setNoId(false);
    const out = form.kind === "meeting" ? meetingFormToCommand(form, commandId) : fundFormToCommand(form, commandId, other);
    if ("errors" in out) return setErrors(out.errors);
    setErrors({});
    await ctrl.save(out.command);
    const s = ref.current;
    if (!s.writeError && !s.pending && s.saved) setForm(null); // 409 / 404 / 422 / 503 keep the values
  };
  const confirmArchive = async (r: CoOwnershipRecord) => {
    const commandId = newId();
    if (!commandId) return setNoId(true);
    setNoId(false);
    await ctrl.archive(r, commandId);
    setArchiving(null);
  };
  const writeError = state.writeError && (
    <div className={styles.error} role="alert">
      {state.writeError}{" "}
      {state.pending ? (
        <button type="button" className={styles.secondary} disabled={state.busy} onClick={() => void ctrl.retry()} data-co-retry="">Réessayer</button>
      ) : (
        <button type="button" className={styles.secondary} disabled={state.busy} onClick={() => void ctrl.load()} data-co-reload="">Actualiser</button>
      )}
    </div>
  );
  const meetingOptions = other.filter((m) => m.kind === "meeting" && m.archived_at === null && m.values.status !== "cancelled");

  return (
    <div role="tabpanel" data-co-section={kind}>
      {state.phase === "demo" && <p className={styles.note} data-co-demo="">{CO_COPY.demo}</p>}
      {noId && <p className={styles.error} role="alert" data-co-noid="">{CO_COPY.noId}</p>}
      {state.phase === "ready" && !state.canWrite && <p className={styles.note} data-co-readonly="">{CO_COPY.readOnly}</p>}
      {state.phase === "ready" && state.canWrite && !form && (
        <div className={styles.actions}>
          <button type="button" className={styles.primary} onClick={startNew} data-co-add={kind}>{kind === "meeting" ? "Ajouter une assemblée" : "Ajouter un appel de fonds"}</button>
        </div>
      )}
      {state.saved && <p className={styles.ok} role="status">{state.saved}</p>}
      {!form && writeError}

      {form?.kind === "meeting" && state.canWrite && (
        <form className={styles.form} onSubmit={(e) => void submit(e)} noValidate data-co-form="meeting">
          <h3>{form.expected_version === null ? "Nouvelle assemblée générale" : `Modifier l’assemblée (version ${form.expected_version})`}</h3>
          <Field label="Titre" error={errors.title}><input value={form.title} maxLength={200} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <div className={styles.grid}>
            <Field label={`Début (${CO_COPY.localTime})`} error={errors.starts_local}><input type="datetime-local" value={form.starts_local} onChange={(e) => setForm({ ...form, starts_local: e.target.value })} /></Field>
            <Field label={`Fin (${CO_COPY.localTime}, facultatif)`} error={errors.ends_local}><input type="datetime-local" value={form.ends_local} onChange={(e) => setForm({ ...form, ends_local: e.target.value })} /></Field>
          </div>
          <Field label="Lieu" error={errors.location}><input value={form.location} maxLength={300} onChange={(e) => setForm({ ...form, location: e.target.value })} /></Field>
          <Field label="Statut" error={errors.status}>
            <select className={styles.select} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as MeetingForm["status"] })}>
              {meetingStatusOptions(form.saved_status).map((s) => <option key={s} value={s}>{MEETING_STATUS[s]}</option>)}
            </select>
          </Field>
          <Field label="Ordre du jour" error={errors.agenda}><textarea value={form.agenda} maxLength={6000} rows={3} onChange={(e) => setForm({ ...form, agenda: e.target.value })} /></Field>
          <Field label="Compte rendu (saisi par le gestionnaire)" error={errors.minutes}><textarea value={form.minutes} maxLength={12000} rows={4} onChange={(e) => setForm({ ...form, minutes: e.target.value })} /></Field>
          <Field label="Décisions consignées (une par ligne, 20 au plus)" error={errors.decisions}><textarea value={form.decisions} rows={3} onChange={(e) => setForm({ ...form, decisions: e.target.value })} /></Field>
          <p className={styles.hint}>Aucun quorum ni résultat de vote n’est calculé par l’application.</p>
          {writeError}
          <FormActions busy={state.busy} onCancel={() => open(null)} />
        </form>
      )}

      {form?.kind === "fund_call" && state.canWrite && (() => {
        const frozen = fundFrozen(form.saved_status);
        return (
          <form className={styles.form} onSubmit={(e) => void submit(e)} noValidate data-co-form="fund_call" data-co-frozen={frozen ? "true" : undefined}>
            <h3>{form.expected_version === null ? "Nouvel appel de fonds" : `Modifier l’appel (version ${form.expected_version})`}</h3>
            {frozen && <p className={styles.note}>{CO_COPY.frozen}</p>}
            <div className={styles.grid}>
              <Field label="Libellé" error={errors.label}><input value={form.label} maxLength={200} disabled={frozen} onChange={(e) => setForm({ ...form, label: e.target.value })} /></Field>
              <Field label="Référence" error={errors.reference}><input value={form.reference} maxLength={100} disabled={frozen} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></Field>
              <Field label="Montant (€)" error={errors.amount_euros}><input inputMode="decimal" value={form.amount_euros} disabled={frozen} onChange={(e) => setForm({ ...form, amount_euros: e.target.value })} /></Field>
              <Field label="Échéance" error={errors.due_on}><input type="date" value={form.due_on} disabled={frozen} onChange={(e) => setForm({ ...form, due_on: e.target.value })} /></Field>
              <Field label="Date d’émission (si émis)" error={errors.issued_on}><input type="date" value={form.issued_on} disabled={frozen} onChange={(e) => setForm({ ...form, issued_on: e.target.value })} /></Field>
              <Field label="Statut" error={errors.status}>
                <select className={styles.select} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as FundForm["status"] })}>
                  {fundStatusOptions(form.saved_status).map((s) => <option key={s} value={s}>{FUND_STATUS[s]}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Référence du document source (procès-verbal, appel papier…)" error={errors.document_reference}><input value={form.document_reference} maxLength={240} disabled={frozen} onChange={(e) => setForm({ ...form, document_reference: e.target.value })} /></Field>
            <Field label="Assemblée liée (information)" error={errors.meeting_id}>
              <select className={styles.select} value={form.meeting_id ?? ""} disabled={frozen} onChange={(e) => setForm({ ...form, meeting_id: e.target.value || null })}>
                <option value="">Aucune</option>
                {form.meeting_id && !meetingOptions.some((m) => m.id === form.meeting_id) && <option value={form.meeting_id}>Assemblée non chargée</option>}
                {meetingOptions.map((m) => m.kind === "meeting" && <option key={m.id} value={m.id}>{m.values.title} ({MEETING_STATUS[m.values.status]})</option>)}
              </select>
            </Field>
            <Field label="Note (facultatif)" error={errors.note}><textarea value={form.note} maxLength={4000} rows={3} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
            <p className={styles.hint}>{CO_COPY.declarative}</p>
            {writeError}
            <FormActions busy={state.busy} onCancel={() => open(null)} />
          </form>
        );
      })()}

      {state.phase === "loading" && <p className={styles.hint} role="status">Chargement…</p>}
      {(state.phase === "error" || state.phase === "unavailable") && (
        <div className={styles.error} role="alert" data-co-error="">
          {state.error}{" "}
          {state.phase === "error" && <button type="button" className={styles.secondary} onClick={() => void ctrl.load()}>Réessayer</button>}
        </div>
      )}
      {state.phase === "ready" && !state.records.length && <p className={styles.hint} data-co-empty="">{CO_COPY.empty[kind]}</p>}
      {state.phase === "ready" && state.total !== null && state.page?.has_more && <p className={styles.hint} data-co-partial="">{CO_COPY.partial(state.records.length, state.total)}</p>}
      {state.phase === "ready" && state.records.length > 0 && (
        <ul className={styles.list}>
          {state.records.map((r) => (
            <li key={r.id} className={styles.row} data-co-id={r.id}>
              {r.kind === "meeting" ? (
                <>
                  <div className={styles.rowHead}><strong>{r.values.title}</strong><span>{MEETING_STATUS[r.values.status]}</span></div>
                  <dl className={styles.kv}>
                    <div><dt>Début ({CO_COPY.localTime})</dt><dd>{localDateTime(r.values.starts_at)}</dd></div>
                    {r.values.location && <div><dt>Lieu</dt><dd>{r.values.location}</dd></div>}
                    <div><dt>Version</dt><dd>{r.version}</dd></div>
                  </dl>
                  {r.values.agenda && <p className={styles.hint}>Ordre du jour : {r.values.agenda}</p>}
                  {r.values.decisions.length > 0 && <ul className={styles.list}>{r.values.decisions.map((d, i) => <li key={i}>{d}</li>)}</ul>}
                </>
              ) : (
                <>
                  <div className={styles.rowHead}><strong>{r.values.label}</strong><span>{FUND_STATUS[r.values.status]} · réf. {r.values.reference}</span></div>
                  <dl className={styles.kv}>
                    <div><dt>Montant déclaré</dt><dd>{formatEuros(r.values.amount_cents)}</dd></div>
                    <div><dt>Échéance</dt><dd>{dateFr(r.values.due_on)}</dd></div>
                    <div><dt>Émis le</dt><dd>{dateFr(r.values.issued_on)}</dd></div>
                    <div><dt>Document source</dt><dd>{r.values.document_reference}</dd></div>
                    <div><dt>Version</dt><dd>{r.version}</dd></div>
                  </dl>
                  {r.values.note && <p className={styles.hint}>{r.values.note}</p>}
                </>
              )}
              {state.canWrite && (
                archiving?.id === r.id ? (
                  <div className={styles.confirm} role="alertdialog" aria-label="Confirmer l’archivage" data-co-archive-confirm="">
                    <p>Archiver ce dossier (version {r.version}) ? Il reste dans l’historique.</p>
                    {r.kind === "meeting" && linkedCalls(other, r.id).length > 0 && (
                      <div data-co-linked="">
                        <p className={styles.hint}>{CO_COPY.linkedCalls}</p>
                        <ul className={styles.list}>{linkedCalls(other, r.id).map((c) => <li key={c.id}>{c.values.label} · réf. {c.values.reference}</li>)}</ul>
                      </div>
                    )}
                    <div className={styles.actions}>
                      <button type="button" className={styles.danger} disabled={state.busy} onClick={() => void confirmArchive(r)}>Confirmer l’archivage</button>
                      <button type="button" className={styles.secondary} disabled={state.busy} onClick={() => setArchiving(null)}>Annuler</button>
                    </div>
                  </div>
                ) : (
                  <div className={styles.actions}>
                    <button type="button" className={styles.secondary} disabled={state.busy || Boolean(form)} onClick={() => open(r.kind === "meeting" ? editMeetingForm(r) : editFundForm(r))}>Modifier</button>
                    <button type="button" className={styles.secondary} disabled={state.busy} onClick={() => setArchiving(r)}>Archiver</button>
                  </div>
                )
              )}
            </li>
          ))}
        </ul>
      )}
      {state.phase === "ready" && state.page?.has_more && (
        <button type="button" className={styles.secondary} disabled={state.loadingMore || state.busy} onClick={() => void ctrl.more()} data-co-more="">
          {state.loadingMore ? "Chargement…" : "Afficher plus"}
        </button>
      )}
    </div>
  );
}

function FormActions({ busy, onCancel }: { busy: boolean; onCancel: () => void }) {
  return (
    <div className={styles.actions}>
      <button type="submit" className={styles.primary} disabled={busy} data-co-save="">{busy ? "Enregistrement…" : "Enregistrer"}</button>
      <button type="button" className={styles.secondary} disabled={busy} onClick={onCancel}>Annuler</button>
    </div>
  );
}
function Field({ label, error, children }: { label: string; error?: string; children: React.ReactElement }) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      {children}
      {error && <small className={styles.error} role="alert">{error}</small>}
    </label>
  );
}
