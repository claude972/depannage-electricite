"use client";
// ENT-09 site energy panel. Human-declared consumption periods (invoice, meter reading, manual
// entry) for one site: list with exact units, server totals shown only with their completeness,
// and — only when the server says can_write — create / edit / archive with versioned, idempotent
// commands. No automatic meter feed, no estimate, no prorata. Logic in ./energy-model.
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  DEFAULT_ENERGY_CONTEXT,
  ENERGY_COPY,
  ENERGY_INITIAL,
  SOURCE_LABEL,
  createEnergyApi,
  createEnergyController,
  editForm,
  formToCommand,
  formatCents,
  formatWh,
  newForm,
  totalsView,
  type EnergyApi,
  type EnergyContext,
  type EnergyForm,
  type EnergyRecord,
  type EnergyState,
  type FormErrors,
} from "./energy-model";
import styles from "./site-energy.module.css";

const uuid = () => (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : "00000000-0000-4000-8000-000000000000");
const dateFr = (d: string) => {
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
};

export function SiteEnergyPanel({ siteId, api, context = DEFAULT_ENERGY_CONTEXT, initial, newId = uuid }: { siteId: string; api?: EnergyApi; context?: EnergyContext; /** Tests only. */ initial?: EnergyState; newId?: () => string }) {
  const [state, setStateRaw] = useState<EnergyState>(initial ?? ENERGY_INITIAL);
  const ref = useRef(state);
  const set = (next: EnergyState) => {
    ref.current = next;
    setStateRaw(next);
  };
  const latest = useRef({ api, context });
  latest.current = { api, context };
  const controller = useRef<ReturnType<typeof createEnergyController> | null>(null);
  if (!controller.current) {
    let client: EnergyApi | null = null;
    controller.current = createEnergyController({
      api: () => (client ??= latest.current.api ?? createEnergyApi()),
      siteId,
      context: { generation: () => latest.current.context.generation(), userId: () => latest.current.context.userId() },
      get: () => ref.current,
      set,
    });
  }
  const ctrl = controller.current;
  useEffect(() => {
    ctrl.attach();
    if (!initial) void ctrl.load();
    return () => ctrl.detach();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctrl]);

  const [from, setFrom] = useState(state.filters.from ?? "");
  const [to, setTo] = useState(state.filters.to ?? "");
  const [filterError, setFilterError] = useState("");
  const [form, setForm] = useState<EnergyForm | null>(null);
  const [errors, setErrors] = useState<FormErrors>({});
  const [archiving, setArchiving] = useState<EnergyRecord | null>(null);

  const applyFilter = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (from && to && to < from) return setFilterError("La fin de l’intervalle précède son début.");
    setFilterError("");
    void ctrl.load({ from: from || null, to: to || null });
  };
  const submitForm = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!form) return;
    const out = formToCommand(form);
    if ("errors" in out) return setErrors(out.errors);
    setErrors({});
    await ctrl.save(out.command);
    const s = ref.current;
    if (!s.writeError && !s.pending && s.saved) setForm(null); // success only; 409/422/503 keep the values
  };

  const t = state.totals ? totalsView(state.totals) : null;
  return (
    <section className={styles.panel} aria-labelledby={`energy-${siteId}`} data-energy-panel={state.phase} aria-busy={state.busy || state.phase === "loading" || undefined}>
      <div className={styles.head}>
        <h2 id={`energy-${siteId}`}>Consommation électrique</h2>
        {state.canWrite && state.phase === "ready" && !form && (
          <button type="button" className={styles.primary} onClick={() => { setErrors({}); setForm(newForm(newId())); }} data-energy-add="">
            Ajouter une période
          </button>
        )}
      </div>
      <p className={styles.hint}>Périodes déclarées à partir d’une facture, d’un relevé de compteur ou d’une saisie : aucun relevé automatique.</p>

      <form className={styles.filters} onSubmit={applyFilter} noValidate aria-label="Filtrer par période">
        <label>Du<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>Au<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <button type="submit" className={styles.secondary}>Filtrer</button>
        <small className={styles.hint}>{ENERGY_COPY.basis}</small>
        {filterError && <small className={styles.error} role="alert">{filterError}</small>}
      </form>

      {state.phase === "ready" && !state.canWrite && <p className={styles.note} data-energy-readonly="">{ENERGY_COPY.readOnly}</p>}
      {state.saved && <p className={styles.ok} role="status">{state.saved}</p>}
      {state.writeError && !form && (
        <div className={styles.error} role="alert">
          {state.writeError}{" "}
          {state.pending && <button type="button" className={styles.secondary} disabled={state.busy} onClick={() => void ctrl.retry()} data-energy-retry="">Réessayer</button>}
          <button type="button" className={styles.secondary} onClick={() => void ctrl.load()}>Actualiser</button>
        </div>
      )}

      {form && state.canWrite && (
        <form className={styles.form} onSubmit={(e) => void submitForm(e)} noValidate data-energy-form={form.expected_version === null ? "create" : "edit"}>
          <h3>{form.expected_version === null ? "Nouvelle période" : `Modifier la période (version ${form.expected_version})`}</h3>
          <Field label="Compteur" error={errors.meter_label}><input value={form.meter_label} maxLength={160} onChange={(e) => setForm({ ...form, meter_label: e.target.value })} /></Field>
          <div className={styles.grid}>
            <Field label="Début de période" error={errors.period_start}><input type="date" value={form.period_start} onChange={(e) => setForm({ ...form, period_start: e.target.value })} /></Field>
            <Field label="Fin de période" error={errors.period_end}><input type="date" value={form.period_end} onChange={(e) => setForm({ ...form, period_end: e.target.value })} /></Field>
            <Field label="Consommation (kWh)" hint="3 décimales au plus" error={errors.consumption_kwh}><input inputMode="decimal" value={form.consumption_kwh} onChange={(e) => setForm({ ...form, consumption_kwh: e.target.value })} /></Field>
            <Field label="Coût TTC (€, facultatif)" hint="2 décimales au plus" error={errors.cost_euros}><input inputMode="decimal" value={form.cost_euros} onChange={(e) => setForm({ ...form, cost_euros: e.target.value })} /></Field>
          </div>
          <fieldset className={styles.choices}>
            <legend>Source</legend>
            {(Object.keys(SOURCE_LABEL) as (keyof typeof SOURCE_LABEL)[]).map((k) => (
              <label key={k}><input type="radio" name={`source-${form.id}`} checked={form.source_kind === k} onChange={() => setForm({ ...form, source_kind: k })} />{SOURCE_LABEL[k]}</label>
            ))}
          </fieldset>
          <Field label="Référence de la source" hint="N° de facture, de relevé…" error={errors.source_reference}><input value={form.source_reference} maxLength={240} onChange={(e) => setForm({ ...form, source_reference: e.target.value })} /></Field>
          <Field label="Note (facultatif)" error={errors.note}><textarea value={form.note} maxLength={2000} rows={3} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
          {state.writeError && (
            <p className={styles.error} role="alert">
              {state.writeError}{" "}
              {state.pending && <button type="button" className={styles.secondary} disabled={state.busy} onClick={() => void ctrl.retry()} data-energy-retry="">Réessayer</button>}
            </p>
          )}
          <div className={styles.actions}>
            <button type="submit" className={styles.primary} disabled={state.busy} data-energy-save="">{state.busy ? "Enregistrement…" : "Enregistrer"}</button>
            <button type="button" className={styles.secondary} disabled={state.busy} onClick={() => { setForm(null); setErrors({}); }}>Annuler</button>
          </div>
        </form>
      )}

      {state.phase === "loading" && <p className={styles.hint} role="status">Chargement des consommations…</p>}
      {(state.phase === "error" || state.phase === "unavailable") && (
        <div className={styles.error} role="alert" data-energy-error="">
          {state.error}{" "}
          {state.phase === "error" && <button type="button" className={styles.secondary} onClick={() => void ctrl.load()}>Réessayer</button>}
        </div>
      )}

      {state.phase === "ready" && t && (
        <dl className={styles.totals} data-energy-totals={state.totals?.complete ? "complete" : "partial"}>
          <div><dt>Consommation</dt><dd>{t.consumption}</dd></div>
          <div><dt>Coût</dt><dd>{t.cost}</dd></div>
          {t.notes.map((n) => <p key={n} className={styles.hint}>{n}</p>)}
        </dl>
      )}

      {state.phase === "ready" && !state.records.length && <p className={styles.hint} data-energy-empty="">{ENERGY_COPY.empty}</p>}
      {state.phase === "ready" && state.records.length > 0 && (
        <ul className={styles.list}>
          {state.records.map((r) => (
            <li key={r.id} className={styles.row} data-energy-id={r.id}>
              <div className={styles.rowHead}>
                <strong>{r.meter_label}</strong>
                <span>{dateFr(r.period_start)} → {dateFr(r.period_end)}</span>
              </div>
              <dl className={styles.kv}>
                <div><dt>Consommation</dt><dd>{formatWh(r.consumption_wh)}</dd></div>
                <div><dt>Coût</dt><dd>{formatCents(r.cost_cents)}</dd></div>
                <div><dt>Source</dt><dd>{SOURCE_LABEL[r.source_kind]} · {r.source_reference}</dd></div>
                <div><dt>Version</dt><dd>{r.version}{r.archived_at ? " · archivée" : ""}</dd></div>
              </dl>
              {r.note && <p className={styles.hint}>{r.note}</p>}
              {state.canWrite && !r.archived_at && (
                archiving?.id === r.id ? (
                  <div className={styles.confirm} role="alertdialog" aria-label="Confirmer l’archivage" data-energy-archive-confirm="">
                    <p>Archiver la période « {r.meter_label} » du {dateFr(r.period_start)} au {dateFr(r.period_end)} (version {r.version}) ? Elle ne sera plus comptée.</p>
                    <div className={styles.actions}>
                      <button type="button" className={styles.danger} disabled={state.busy} onClick={() => { void ctrl.archive(r).then(() => setArchiving(null)); }}>Confirmer l’archivage</button>
                      <button type="button" className={styles.secondary} disabled={state.busy} onClick={() => setArchiving(null)}>Annuler</button>
                    </div>
                  </div>
                ) : (
                  <div className={styles.actions}>
                    <button type="button" className={styles.secondary} disabled={state.busy || Boolean(form)} onClick={() => { setErrors({}); setForm(editForm(r)); }}>Modifier</button>
                    <button type="button" className={styles.secondary} disabled={state.busy} onClick={() => setArchiving(r)}>Archiver</button>
                  </div>
                )
              )}
            </li>
          ))}
        </ul>
      )}
      {state.phase === "ready" && state.page?.has_more && (
        <button type="button" className={styles.secondary} disabled={state.loadingMore} onClick={() => void ctrl.more()} data-energy-more="">
          {state.loadingMore ? "Chargement…" : "Afficher plus"}
        </button>
      )}
    </section>
  );
}

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: React.ReactElement }) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      {children}
      {hint && <small className={styles.hint}>{hint}</small>}
      {error && <small className={styles.error} role="alert">{error}</small>}
    </label>
  );
}
