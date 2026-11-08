"use client";
// Consolidated declared energy (ENT-09/15), enterprise « Rapports ». Read-only (GET). Explicit site
// selection and explicit date range (no implicit « all »); per site and meter, the coverage the
// server reports — a missing measurement is « non déclaré / manquant », a declared 0 is 0; totals
// only with complete recorded coverage (otherwise the reasons); comparison only when the server
// says the periods are comparable. Identity-guarded after the await; demo: no call. Logic: ./model.
// « Exporter en CSV » (ROOT b404b4f): private download of exactly the displayed consolidation —
// same-origin GET with credentials, no-store, blob + object URL (revoked), server filename; one export
// at a time; a reply after an identity / consolidation / organisation change or an unmount is dropped
// and nothing is saved.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { COMPARISON_REASON, COPY, EMPTY_FORM, EXPORT_COPY, centsToEuros, exportError, fetchCsv, fetchReport, formToSelection, incompleteReasons, parseReport, totalConsumption, totalCost, whToKwh, type EnergyReport, type Form, type Result, type Selection } from "./model";
import styles from "./energy-consolidation.module.css";

export type EnergyConsolidationProps = {
  organizationId: string | null;
  /** Sites of the active organisation the session can read; the server re-checks every one. */
  sites: { id: string; name: string; archived?: boolean }[];
  demo: boolean;
  context: { generation(): number; userId(): string | null };
  fetcher?: typeof fetch;
  /** Tests only. */
  initial?: { form: Form; report: EnergyReport | null; selection: Selection | null };
};
type Phase = "idle" | "loading" | "ready" | "error";
type ExportState = { phase: "idle" } | { phase: "busy" } | { phase: "done"; filename: string } | { phase: "error"; message: string; waitS: number | null };

/** Private, uncached save: object URL for this blob only, revoked right after the download starts. */
function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  try {
    a.click();
  } finally {
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

export function EnergyConsolidationPanel({ organizationId, sites, demo, context, fetcher, initial }: EnergyConsolidationProps) {
  const [form, setForm] = useState<Form>(initial?.form ?? EMPTY_FORM);
  const [formError, setFormError] = useState("");
  const [phase, setPhase] = useState<Phase>(initial?.report ? "ready" : "idle");
  const [report, setReport] = useState<EnergyReport | null>(initial?.report ?? null);
  const [shown, setShown] = useState<Selection | null>(initial?.selection ?? null);
  const [error, setError] = useState("");
  const seq = useRef(0);
  const [exp, setExp] = useState<ExportState>({ phase: "idle" });
  const [retryWait, setRetryWait] = useState(false);
  const exporting = useRef(false);
  const waitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Instance fence: every effect run (StrictMode included) opens its own epoch and its cleanup closes
  // it, so any continuation of an unmounted instance (organisation switch remounts the panel, leaving
  // « Rapports ») — or of another organisation — is inert: no setState, no saveBlob.
  const alive = useRef(false);
  const epoch = useRef(0);
  const org = useRef(organizationId);
  org.current = organizationId;
  useEffect(() => {
    epoch.current++;
    alive.current = true;
    return () => {
      epoch.current++;
      alive.current = false;
      clearTimeout(waitTimer.current);
    };
  }, []);
  const fence = () => {
    const ep = epoch.current, o = org.current;
    return () => alive.current && epoch.current === ep && org.current === o;
  };
  const name = (id: string) => sites.find((s) => s.id === id)?.name ?? "Site";

  if (demo)
    return (
      <section className={styles.panel} aria-labelledby="energy-consolidation-title" data-energy-consolidation="demo">
        <h2 id="energy-consolidation-title">Consommation d’énergie (consolidé)</h2>
        <p className={styles.note}>{COPY.demo}</p>
        <p className={styles.hint} data-energy-export="demo">{EXPORT_COPY.demo}</p>
      </section>
    );

  const run = async (sel: Selection) => {
    const my = ++seq.current;
    const gen = context.generation(), uid = context.userId();
    const live = fence();
    setPhase("loading");
    setError("");
    // A new consolidation replaces the displayed one: any export in flight belongs to the old one.
    exporting.current = false;
    clearTimeout(waitTimer.current);
    setRetryWait(false);
    setExp({ phase: "idle" });
    const r: Result = await fetchReport(fetcher ?? ((...a) => fetch(...a)), sel);
    if (!live()) return; // old instance / organisation: inert
    // StrictMode / identity guard: only the latest request, under the same identity, applies.
    if (my !== seq.current) return;
    if (context.generation() !== gen || context.userId() !== uid) {
      // Identity changed meanwhile: the reply is dropped, nothing from it is shown.
      setReport(null);
      setShown(null);
      setPhase("idle");
      return;
    }
    const parsed = r.status === 200 ? parseReport(r.body, sel) : null;
    if (parsed) {
      setReport(parsed);
      setShown(sel);
      setPhase("ready");
      return;
    }
    setReport(null);
    setShown(null);
    setPhase("error");
    setError(r.status === 403 || r.status === 404 ? COPY.forbidden : r.status === 422 ? COPY.invalid : COPY.loadFailed);
  };
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!organizationId) return;
    const out = formToSelection(organizationId, form);
    if ("error" in out) return setFormError(out.error);
    setFormError("");
    void run(out.selection);
  };
  const exportCsv = async () => {
    // Single flight, and only for the consolidation on screen (exactly its filters).
    if (exporting.current || phase !== "ready" || !shown) return;
    exporting.current = true;
    const sel = shown, my = seq.current;
    const gen = context.generation(), uid = context.userId();
    const live = fence();
    clearTimeout(waitTimer.current);
    setRetryWait(false);
    setExp({ phase: "busy" });
    const out = await fetchCsv(fetcher ?? ((...a) => fetch(...a)), sel);
    if (!live()) return; // unmounted or another organisation meanwhile: nothing is shown or saved
    if (my !== seq.current) return; // another consolidation was displayed meanwhile: drop, save nothing
    exporting.current = false;
    if (context.generation() !== gen || context.userId() !== uid) {
      setExp({ phase: "idle" }); // identity changed: the file is dropped, nothing is saved
      return;
    }
    if (out.kind === "file") {
      saveBlob(out.blob, out.filename);
      setExp({ phase: "done", filename: out.filename });
      return;
    }
    if (out.kind === "off-contract") return setExp({ phase: "error", message: EXPORT_COPY.offContract, waitS: null });
    setExp({ phase: "error", message: exportError(out.status, out.retryAfterS), waitS: out.retryAfterS });
    if (out.retryAfterS) {
      setRetryWait(true);
      waitTimer.current = setTimeout(() => setRetryWait(false), out.retryAfterS * 1000);
    }
  };
  const toggle = (id: string) => setForm((f) => ({ ...f, site_ids: f.site_ids.includes(id) ? f.site_ids.filter((x) => x !== id) : [...f.site_ids, id] }));

  return (
    <section className={styles.panel} aria-labelledby="energy-consolidation-title" data-energy-consolidation={phase} aria-busy={phase === "loading" || undefined}>
      <h2 id="energy-consolidation-title">Consommation d’énergie (consolidé)</h2>
      <p className={styles.hint}>{COPY.declaredOnly}</p>
      {!sites.length ? (
        <p className={styles.note} data-energy-no-sites="">{COPY.noSites}</p>
      ) : (
        <form className={styles.form} onSubmit={submit} noValidate>
          <fieldset className={styles.sites}>
            <legend>Sites (choix explicite, 50 au plus)</legend>
            {sites.map((s) => (
              <label key={s.id} className={styles.check}>
                <input type="checkbox" checked={form.site_ids.includes(s.id)} onChange={() => toggle(s.id)} data-energy-site={s.id} />
                {s.name}{s.archived ? " (archivé)" : ""}
              </label>
            ))}
          </fieldset>
          <div className={styles.dates}>
            <label>Du<input type="date" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} required /></label>
            <label>Au<input type="date" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} required /></label>
          </div>
          <label className={styles.check}>
            <input type="checkbox" checked={form.compare} onChange={(e) => setForm({ ...form, compare: e.target.checked })} />
            Comparer à une autre période
          </label>
          {form.compare && (
            <div className={styles.dates}>
              <label>Comparaison du<input type="date" value={form.previous_from} onChange={(e) => setForm({ ...form, previous_from: e.target.value })} /></label>
              <label>au<input type="date" value={form.previous_to} onChange={(e) => setForm({ ...form, previous_to: e.target.value })} /></label>
            </div>
          )}
          {formError && <p className={styles.error} role="alert" data-energy-form-error="">{formError}</p>}
          <button type="submit" className={styles.primary} disabled={phase === "loading" || !organizationId}>{phase === "loading" ? "Consolidation…" : "Consolider les relevés déclarés"}</button>
        </form>
      )}

      {phase === "loading" && <p className={styles.hint} role="status">Lecture des relevés déclarés…</p>}
      {phase === "error" && (
        <div className={styles.note} role="alert" data-energy-error="">
          <p className={styles.error}>{error}</p>
          <button type="button" className={styles.secondary} onClick={() => { const out = organizationId ? formToSelection(organizationId, form) : null; if (out && "selection" in out) void run(out.selection); }}>Réessayer</button>
        </div>
      )}
      {sites.length > 0 && (
        <div className={styles.exportBar} data-energy-export={exp.phase}>
          <p className={styles.hint}>{phase === "ready" && shown ? EXPORT_COPY.scope : EXPORT_COPY.needSelection}</p>
          <button type="button" className={styles.secondary} onClick={() => void exportCsv()} disabled={!(phase === "ready" && shown) || exp.phase === "busy" || exp.phase === "error"} aria-busy={exp.phase === "busy" || undefined}>
            {exp.phase === "busy" ? EXPORT_COPY.busy : EXPORT_COPY.button}
          </button>
          {exp.phase === "done" && <p className={styles.ok} role="status">{EXPORT_COPY.done(exp.filename)}</p>}
          {exp.phase === "error" && (
            <div className={styles.note} role="alert" data-energy-export-error="">
              <p className={styles.error}>{exp.message}</p>
              <button type="button" className={styles.secondary} onClick={() => void exportCsv()} disabled={retryWait}>Réessayer</button>
            </div>
          )}
        </div>
      )}
      {phase === "ready" && report && shown && <ReportView report={report} selection={shown} name={name} />}
    </section>
  );
}

function ReportView({ report, selection, name }: { report: EnergyReport; selection: Selection; name: (id: string) => string }) {
  const consumption = totalConsumption(report.current);
  const cost = totalCost(report.current);
  const reasons = consumption ? [] : incompleteReasons(report, name);
  return (
    <div className={styles.result} data-energy-report="">
      <p className={styles.hint}>Période du {selection.from} au {selection.to} · {selection.site_ids.length} site(s) choisi(s).</p>
      <div className={styles.total} data-energy-total={consumption ? "complete" : "incomplete"}>
        <h3>Total des relevés déclarés</h3>
        {consumption ? (
          <p><strong>{consumption}</strong>{cost ? ` · ${cost}` : " · coût incomplet (au moins un relevé sans coût)"}</p>
        ) : (
          <>
            <p><strong>{COPY.noTotal}</strong></p>
            {reasons.length > 0 && <ul className={styles.reasons}>{reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
          </>
        )}
      </div>
      {selection.previous_from && (
        <div className={styles.compare} data-energy-comparison={report.comparison.reason}>
          <h3>Comparaison ({selection.previous_from} → {selection.previous_to})</h3>
          <p>{COMPARISON_REASON[report.comparison.reason]}</p>
          {report.comparison.comparable && report.comparison.consumption_delta_wh !== null && (
            <p><strong>Écart : {whToKwh(report.comparison.consumption_delta_wh)}</strong>{report.comparison.cost_delta_cents !== null ? ` · ${centsToEuros(report.comparison.cost_delta_cents)}` : " · coût non comparable"}</p>
          )}
        </div>
      )}
      <h3>Par site et par compteur déclaré</h3>
      <ul className={styles.siteList}>
        {report.sites.map((s) => {
          const meters = report.meters.filter((m) => m.site_id === s.site_id);
          const siteTotal = totalConsumption(s.current);
          return (
            <li key={s.site_id} className={styles.site} data-energy-site-result={s.site_id}>
              <div className={styles.siteHead}>
                <strong>{name(s.site_id)}</strong>
                <span>{siteTotal ?? (meters.length ? "total non calculable (couverture incomplète)" : "aucun compteur déclaré")}</span>
              </div>
              {meters.length > 0 && (
                <dl className={styles.kv}>
                  {meters.map((m) => (
                    <div key={m.meter_label} data-energy-meter={m.meter_label}>
                      <dt>{m.meter_label}</dt>
                      <dd>
                        {m.current.consumption_wh === null ? <span data-energy-missing="">{COPY.missing}</span> : <span data-energy-value="">{whToKwh(m.current.consumption_wh)}</span>}
                        {" · "}
                        {m.current.coverage_complete ? "couverture complète" : "couverture incomplète"}
                        {m.current.crossing_count > 0 ? ` · ${m.current.crossing_count} relevé(s) débordant la période, exclus` : ""}
                        {m.current.cost_cents !== null ? ` · ${centsToEuros(m.current.cost_cents)}` : m.current.record_count > 0 ? " · coût non renseigné" : ""}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
