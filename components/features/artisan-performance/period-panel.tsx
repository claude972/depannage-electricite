"use client";
// ART-10 — « Activité par période » : revenue by period and source, completed interventions and
// punctuality, read from GET /api/artisan/performance/period for the chosen bounds. Live only
// (the demo keeps its local figures). A frame is bound to identity + bounds + retry: a late reply
// for another period or another account is dropped, and no figure survives a failed read.
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Icon } from "../../app/icons";
import { Loader, Unavailable } from "../../app/ui";
import { money } from "../../app/format";
import styles from "../../role/artisan.module.css";
import { getJson } from "../artisan-quotes/model";
import { identityKey } from "./model";
import {
  PERIOD_PRESETS,
  PRESET_LABEL,
  SOURCE_LABEL,
  boundsLabel,
  customBounds,
  parsePeriodReport,
  periodUrl,
  presetBounds,
  punctualityText,
  type Bounds,
  type PeriodPreset,
  type PeriodReportView,
} from "./period-model";

export type PeriodSource = { mode: string; mutationContext: { generation(): number; userId(): string | null } };
type PeriodState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "ready"; report: PeriodReportView }
  | { phase: "forbidden" }
  | { phase: "session" }
  | { phase: "error" };
type Frame = { key: string; state: PeriodState };

const COPY = {
  forbidden: "Ces indicateurs sont réservés au compte artisan concerné. Aucun chiffre n’est affiché.",
  session: "Votre session a expiré. Reconnectez-vous pour lire ces indicateurs.",
  error: "Les indicateurs de la période n’ont pas pu être lus. Aucun chiffre n’est affiché à la place.",
};

export function usePeriodReport(source: PeriodSource, bounds: Bounds | null, fetcher?: typeof fetch): PeriodState & { retry: () => void } {
  const live = source.mode !== "demo";
  const identity = live ? identityKey(source.mutationContext) : null;
  const [nonce, setNonce] = useState(0);
  const key = identity && bounds ? `${identity}|${bounds.start}|${bounds.end}|${nonce}` : null;
  const [frame, setFrame] = useState<Frame | null>(null);
  const seq = useRef(0);
  const latest = useRef({ source, fetcher });
  useEffect(() => {
    latest.current = { source, fetcher };
  });
  const start = bounds?.start, end = bounds?.end;
  useEffect(() => {
    if (!key || !start || !end) return;
    const my = ++seq.current;
    let cancelled = false;
    const asked = { start, end };
    const still = () => !cancelled && my === seq.current && identityKey(latest.current.source.mutationContext) === identity;
    void getJson(latest.current.fetcher ?? ((...a) => fetch(...a)), periodUrl(asked)).then((r) => {
      if (!still()) return;
      let state: PeriodState;
      if (r.status === 401) state = { phase: "session" };
      else if (r.status === 403) state = { phase: "forbidden" };
      else {
        const report = r.status === 200 ? parsePeriodReport(r.body, asked) : null;
        state = report ? { phase: "ready", report } : { phase: "error" };
      }
      setFrame({ key, state });
    });
    return () => {
      cancelled = true;
    };
  }, [key, identity, start, end]);
  const state: PeriodState = !key ? { phase: "idle" } : frame && frame.key === key ? frame.state : { phase: "loading" };
  return { ...state, retry: () => setNonce((n) => n + 1) };
}

function Failure({ state, retry }: { state: PeriodState; retry: () => void }) {
  if (state.phase === "forbidden") return <Unavailable title="Accès refusé" reason={COPY.forbidden} />;
  if (state.phase === "session") return <Unavailable title="Session expirée" reason={COPY.session} />;
  if (state.phase === "error") return <Unavailable title="Lecture impossible" reason={COPY.error} onRetry={retry} />;
  return null;
}

/** Punctuality tile of the monthly grid (Profile and Performance): current calendar month. */
export function PunctualityTile({ source, fetcher }: { source: PeriodSource; fetcher?: typeof fetch }) {
  const [bounds] = useState(() => presetBounds("month"));
  const period = usePeriodReport(source, bounds, fetcher);
  if (period.phase === "idle") return null;
  const text = period.phase === "ready" ? punctualityText(period.report.punctuality) : null;
  return (
    <div className={styles.perfTile} data-testid="perf-punctuality" data-punctuality-phase={period.phase} aria-busy={period.phase === "loading"}>
      <div className={styles.perfTileTop}>
        <span className={`${styles.perfIcon} ${styles.blueIcon}`}>
          <Icon name="clock" />
        </span>
        <strong data-testid="perf-punctuality-value">{text ? text.value : period.phase === "loading" ? "…" : "—"}</strong>
      </div>
      <span>Ponctualité du mois</span>
      <small>
        {text
          ? text.note
          : period.phase === "loading"
            ? "Lecture en cours…"
            : period.phase === "forbidden"
              ? COPY.forbidden
              : period.phase === "session"
                ? COPY.session
                : COPY.error}
      </small>
      {period.phase === "error" && (
        <button type="button" className="text-button" onClick={period.retry}>
          Réessayer
        </button>
      )}
    </div>
  );
}

function day(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

export function PeriodPerformancePanel({ source, fetcher }: { source: PeriodSource; fetcher?: typeof fetch }) {
  const id = useId();
  const [preset, setPreset] = useState<PeriodPreset>("month");
  const [bounds, setBounds] = useState<Bounds | null>(() => presetBounds("month"));
  const [from, setFrom] = useState(() => day(new Date(new Date().getFullYear(), new Date().getMonth(), 1)));
  const [to, setTo] = useState(() => day(new Date()));
  const [formError, setFormError] = useState("");
  const period = usePeriodReport(source, bounds, fetcher);
  if (source.mode === "demo") return null;
  const choose = (next: PeriodPreset) => {
    setPreset(next);
    setFormError("");
    // A custom period is read only once its two dates are applied: no figure of the previous
    // period stays under the new selection.
    setBounds(next === "custom" ? null : presetBounds(next));
  };
  const apply = (event: FormEvent) => {
    event.preventDefault();
    const check = customBounds(from, to);
    if (!check.ok) {
      setFormError(check.message);
      setBounds(null);
      return;
    }
    setFormError("");
    setBounds(check.bounds);
  };
  const report = period.phase === "ready" ? period.report : null;
  const punctuality = report ? punctualityText(report.punctuality) : null;
  return (
    <section className="panel" aria-labelledby={`${id}-title`} data-period-performance={period.phase} aria-busy={period.phase === "loading"}>
      <h2 id={`${id}-title`} style={{ fontSize: 17, marginBottom: 8 }}>
        Activité par période
      </h2>
      <p className={styles.sectionNote}>
        Montants payés, interventions terminées et ponctualité recalculés par le serveur sur l’ensemble de vos dossiers pour la période choisie.
      </p>
      <label className="field" htmlFor={`${id}-preset`}>
        <span>Période</span>
        <select id={`${id}-preset`} value={preset} onChange={(e) => choose(e.target.value as PeriodPreset)} data-period-preset="">
          {PERIOD_PRESETS.map((p) => (
            <option key={p} value={p}>
              {PRESET_LABEL[p]}
            </option>
          ))}
        </select>
      </label>
      {preset === "custom" && (
        <form onSubmit={apply} noValidate data-period-custom="" style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end", margin: "8px 0 12px" }}>
          <label className="field" htmlFor={`${id}-from`} style={{ flex: "1 1 140px", margin: 0 }}>
            <span>Du</span>
            <input id={`${id}-from`} type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-invalid={formError ? true : undefined} aria-describedby={formError ? `${id}-error` : undefined} />
          </label>
          <label className="field" htmlFor={`${id}-to`} style={{ flex: "1 1 140px", margin: 0 }}>
            <span>Au (inclus)</span>
            <input id={`${id}-to`} type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-invalid={formError ? true : undefined} aria-describedby={formError ? `${id}-error` : undefined} />
          </label>
          <button type="submit" className="button outline" disabled={period.phase === "loading"}>
            {period.phase === "loading" ? "Calcul…" : "Appliquer"}
          </button>
          {formError && (
            <p className="field-error" role="alert" id={`${id}-error`} style={{ flexBasis: "100%", margin: 0 }}>
              {formError}
            </p>
          )}
        </form>
      )}
      {bounds && (
        <p className={styles.sectionNote} data-period-label="">
          Période : {boundsLabel(bounds)}.
        </p>
      )}
      {!bounds && preset === "custom" && !formError && <p className={styles.sectionNote}>Choisissez les deux dates puis « Appliquer » pour calculer la période.</p>}
      {period.phase === "loading" && <Loader label="Calcul de la période…" />}
      <Failure state={period} retry={period.retry} />
      {report && punctuality && (
        <>
          <div className={styles.perfGrid} data-testid="period-grid">
            <div className={styles.perfTile}>
              <div className={styles.perfTileTop}>
                <span className={`${styles.perfIcon} ${styles.greenIcon}`}>
                  <Icon name="euro" />
                </span>
                <strong data-testid="period-paid">{money(report.revenue.paid_cents)}</strong>
              </div>
              <span>Payé TTC sur la période</span>
              <small>
                {report.revenue.paid_count
                  ? `${report.revenue.paid_count} ${report.revenue.paid_count > 1 ? "règlements confirmés" : "règlement confirmé"}`
                  : "Aucun règlement confirmé sur la période"}
              </small>
            </div>
            <div className={styles.perfTile}>
              <div className={styles.perfTileTop}>
                <span className={`${styles.perfIcon} ${styles.greenIcon}`}>
                  <Icon name="check" />
                </span>
                <strong data-testid="period-completed">{report.completed_missions_count}</strong>
              </div>
              <span>Interventions terminées</span>
              <small>Date de fin dans la période</small>
            </div>
            <div className={styles.perfTile}>
              <div className={styles.perfTileTop}>
                <span className={`${styles.perfIcon} ${styles.blueIcon}`}>
                  <Icon name="clock" />
                </span>
                <strong data-testid="period-punctuality">{punctuality.value}</strong>
              </div>
              <span>Ponctualité</span>
              <small data-testid="period-punctuality-note">{punctuality.note}</small>
            </div>
          </div>
          <h3 style={{ fontSize: 15, margin: "14px 0 4px" }}>Montant payé par source</h3>
          {report.revenue.by_source.length ? (
            <div className={styles.paidList} data-testid="period-sources">
              {report.revenue.by_source.map((s) => (
                <div key={s.source} className={styles.paidRow} data-period-source={s.source}>
                  <div>
                    {SOURCE_LABEL[s.source]}
                    <span>
                      {s.paid_count} {s.paid_count > 1 ? "règlements confirmés" : "règlement confirmé"}
                    </span>
                  </div>
                  <strong>{money(s.paid_cents)}</strong>
                </div>
              ))}
            </div>
          ) : (
            <p className={styles.sectionNote}>Aucun règlement confirmé sur cette période : aucune source à détailler.</p>
          )}
          <details className={styles.basis}>
            <summary>Base de calcul de la période</summary>
            <div className={styles.basisBody}>
              <p>Période {boundsLabel(bounds ?? report.period)} (calendrier de votre appareil, premier et dernier jours inclus).</p>
              <ul className={styles.formulaList}>
                <li>Montant payé : {report.basis.revenue}</li>
                <li>Interventions terminées : {report.basis.completed}</li>
                <li>Ponctualité : {report.basis.punctuality}</li>
                {report.punctuality.from_start_count > 0 && (
                  <li>
                    {report.punctuality.from_start_count} {report.punctuality.from_start_count > 1 ? "mesures reposent" : "mesure repose"} sur l’heure de démarrage, faute de déclaration « sur place ».
                  </li>
                )}
              </ul>
            </div>
          </details>
        </>
      )}
    </section>
  );
}
