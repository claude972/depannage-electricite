"use client";
// ART-10 — live renderings of the server performance report (Overview summary, Profile grid,
// Performance page). Figures come only from the report; no cache value is ever shown here.
// Visual classes are the artisan space ones (read-only import), so live and demo look alike.
import type { ReactNode } from "react";
import { Icon } from "../../app/icons";
import { Empty, Loader, Unavailable } from "../../app/ui";
import { money } from "../../app/format";
import styles from "../../role/artisan.module.css";
import type { ArtisanPerformanceReport } from "../../app/types";
import type { PerformanceHandle } from "./use-artisan-performance";
import { growthLabel, periodLabel, ratingLabel } from "./model";

const UNAVAILABLE =
  "Les indicateurs de performance ne peuvent pas être lus pour le moment. Aucun chiffre n’est affiché à la place.";
const ERROR = "La lecture des indicateurs a échoué. Aucun chiffre n’est affiché à la place.";

/** Loading, unavailable, error and empty states, shared by the three mounts. */
function NotReady({ perf, compact }: { perf: PerformanceHandle; compact?: boolean }) {
  if (perf.phase === "loading") return <Loader label="Lecture des indicateurs…" />;
  if (perf.phase === "unavailable") {
    return <Unavailable title="Performance indisponible" reason={UNAVAILABLE} onRetry={perf.retry} />;
  }
  if (perf.phase === "error") {
    return <Unavailable title="Lecture impossible" reason={ERROR} onRetry={perf.retry} />;
  }
  if (perf.phase === "empty") {
    return (
      <Empty icon="chart" title={compact ? "Pas encore d’activité" : "Aucune activité sur ces deux mois"}>
        Aucun règlement confirmé, aucune intervention terminée sur{" "}
        {periodLabel(perf.report.period.previous_start)} et {periodLabel(perf.report.period.current_start)},
        et aucun avis.
      </Empty>
    );
  }
  return null;
}

function Tile({ icon, tone, label, value, note }: { icon: string; tone: string; label: string; value: ReactNode; note: string }) {
  return (
    <div className={styles.perfTile}>
      <div className={styles.perfTileTop}>
        <span className={`${styles.perfIcon} ${tone}`}>
          <Icon name={icon} />
        </span>
        <strong>{value}</strong>
      </div>
      <span>{label}</span>
      <small>{note}</small>
    </div>
  );
}

function Basis({ report, measuredPunctuality = false }: { report: ArtisanPerformanceReport; measuredPunctuality?: boolean }) {
  const b = report.basis;
  return (
    <details className={styles.basis}>
      <summary>Base de calcul</summary>
      <div className={styles.basisBody}>
        <p>
          Période : {periodLabel(report.period.current_start)}, comparée à{" "}
          {periodLabel(report.period.previous_start)} (mois calendaires de votre appareil, début
          inclus, fin exclue). Chiffres calculés par le serveur sur l’ensemble de vos dossiers.
        </p>
        {report.limited && <p>Résultat partiel signalé par le serveur.</p>}
        <ul className={styles.formulaList}>
          {b.revenue && <li>Montant payé : {b.revenue}</li>}
          {b.completed && <li>Interventions terminées : {b.completed}</li>}
          {b.rating && <li>Note moyenne : {b.rating}</li>}
          {b.growth && <li>Évolution : {b.growth}</li>}
          {measuredPunctuality ? (
            <li>
              Ponctualité : mesurée sur le mois en cours à partir des créneaux de rendez-vous et des arrivées enregistrés ; la règle détaillée figure dans « Activité par période » de la page Performance.
            </li>
          ) : (
            b.punctuality && <li>Ponctualité : {b.punctuality}</li>
          )}
        </ul>
      </div>
    </details>
  );
}

/** Overview card (M35) — same layout as the demo summary. */
export function LivePerformanceSummary({ perf, onDetail }: { perf: PerformanceHandle; onDetail: () => void }) {
  const report = perf.phase === "ready" ? perf.report : null;
  return (
    <section className={`panel ${styles.perfPanel}`} aria-labelledby="perf-title" aria-busy={perf.phase === "loading"}>
      <div className={styles.perfHead}>
        <Icon name="trend" />
        <h2 id="perf-title">Performance</h2>
        <button type="button" className="text-button" onClick={onDetail}>
          Détail
        </button>
      </div>
      {report ? (
        <>
          <div className={styles.perfPair}>
            <div className={styles.perfFigure}>
              <span className={`${styles.perfIcon} ${styles.amberIcon}`}>
                <Icon name="star" />
              </span>
              <div>
                <span className={styles.perfLabel}>Note moyenne</span>
                <strong className={styles.perfValue}>
                  {report.rating.average !== null ? (
                    <>
                      {ratingLabel(report.rating.average)}
                      <small>/5</small>
                    </>
                  ) : (
                    "—"
                  )}
                </strong>
                <span className={styles.perfNote}>
                  {report.rating.count ? `Basée sur ${report.rating.count} avis` : "Aucun avis encore"}
                </span>
              </div>
            </div>
            <div className={styles.perfFigure}>
              <span className={`${styles.perfIcon} ${styles.greenIcon}`}>
                <Icon name="euro" />
              </span>
              <div>
                <span className={styles.perfLabel}>Payé TTC du mois</span>
                <strong className={styles.perfValue} data-testid="perf-current-paid">
                  {money(report.current.paid_service_cents)}
                </strong>
                <span className={styles.perfNote}>
                  {periodLabel(report.period.current_start)}
                  {report.growth_percent !== null ? ` · ${growthLabel(report.growth_percent)}` : ""}
                </span>
              </div>
            </div>
          </div>
          <Basis report={report} />
        </>
      ) : (
        <NotReady perf={perf} compact />
      )}
    </section>
  );
}

/** Profile block and Performance page grid (M36). `since` is the account seniority. */
/** `punctuality`: the measured tile supplied by the host (period report of the current month).
 *  Without it, the grid keeps the honest « not computed » placeholder of the monthly report. */
export function LivePerformanceGrid({ perf, since, punctuality }: { perf: PerformanceHandle; since: string | null; punctuality?: ReactNode }) {
  if (perf.phase !== "ready") {
    return (
      <div aria-busy={perf.phase === "loading"}>
        <NotReady perf={perf} />
      </div>
    );
  }
  const { report } = perf;
  const prevLabel = periodLabel(report.period.previous_start);
  return (
    <>
      <div className={styles.perfGrid} data-testid="perf-grid">
        <Tile
          icon="euro"
          tone={styles.greenIcon}
          label="Payé TTC du mois"
          value={<span data-testid="perf-current-paid">{money(report.current.paid_service_cents)}</span>}
          note={`${report.current.paid_count} ${report.current.paid_count > 1 ? "règlements confirmés" : "règlement confirmé"} · ${periodLabel(report.period.current_start)}`}
        />
        <Tile
          icon="check"
          tone={styles.greenIcon}
          label="Interventions terminées"
          value={<span data-testid="perf-current-completed">{report.current.completed_missions_count}</span>}
          note={periodLabel(report.period.current_start)}
        />
        <Tile
          icon="star"
          tone={styles.amberIcon}
          label="Note moyenne"
          value={report.rating.average !== null ? `${ratingLabel(report.rating.average)} / 5` : "—"}
          note={report.rating.count ? `${report.rating.count} avis, toutes périodes` : "Aucun avis encore"}
        />
        <Tile
          icon="trend"
          tone={styles.blueIcon}
          label="Évolution du montant payé"
          value={report.growth_percent !== null ? growthLabel(report.growth_percent) : "—"}
          note={
            report.growth_percent !== null
              ? `Par rapport à ${prevLabel} (${money(report.previous.paid_service_cents)})`
              : `Aucun montant payé en ${prevLabel}`
          }
        />
        <Tile
          icon="calendar"
          tone={styles.blueIcon}
          label="Ancienneté"
          value={since ?? "—"}
          note={since ? "Depuis l’inscription" : "Date d’inscription non transmise"}
        />
        {punctuality ?? (
          <div className={styles.perfTile}>
            <Unavailable
              title="Ponctualité"
              reason={report.basis.punctuality || "Non calculée par le serveur."}
              blocker="mesure de ponctualité non prévue"
            />
          </div>
        )}
      </div>
      <Basis report={report} measuredPunctuality={punctuality !== undefined} />
    </>
  );
}

/** Subtitle of the Performance page, live: server period, never a loaded-cache wording. */
export function livePerformanceSubtitle(perf: PerformanceHandle): string {
  return perf.phase === "ready" || perf.phase === "empty"
    ? `Période : ${periodLabel(perf.report.period.current_start)} — chiffres calculés par le serveur.`
    : "Indicateurs calculés par le serveur sur l’ensemble de vos dossiers.";
}

/** Rating line of the Profile header, live: server rating only. */
export function LiveRatingLine({ perf }: { perf: PerformanceHandle }) {
  if (perf.phase !== "ready" && perf.phase !== "empty") return null;
  const { rating } = perf.report;
  return rating.average !== null ? (
    <span>
      <Icon name="star" size={16} /> {ratingLabel(rating.average)} / 5 ({rating.count} avis)
    </span>
  ) : (
    <span>Aucun avis pour le moment</span>
  );
}
