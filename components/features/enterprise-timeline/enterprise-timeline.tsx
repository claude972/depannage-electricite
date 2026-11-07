// Read-only chronology of an enterprise dossier (no action, no loading: props only).
import { dateTime } from "../../app/format";
import { STATE_LABEL, type TimelineStep } from "./timeline-model";
import styles from "./enterprise-timeline.module.css";

export function EnterpriseTimeline({ steps, cancelled = false }: { steps: TimelineStep[]; cancelled?: boolean }) {
  return (
    <section className={`panel ${styles.panel}`} aria-labelledby="dossier-timeline" data-enterprise-timeline="">
      <h2 id="dossier-timeline">Chronologie du dossier</h2>
      {cancelled && <p className={styles.note}>Dossier annulé. Aucune étape supplémentaire ne sera enregistrée.</p>}
      <ol className={styles.list}>
        {steps.map((s) => (
          <li key={s.key} className={`${styles.step} ${styles[s.state]}`} data-step={s.key} data-state={s.state} aria-current={s.state === "current" ? "step" : undefined}>
            <span className={styles.marker} aria-hidden="true" />
            <div className={styles.body}>
              <div className={styles.head}>
                <strong>{s.label}</strong>
                <span className={styles.badge}>{STATE_LABEL[s.state]}</span>
              </div>
              <p className={styles.detail}>{s.detail}</p>
              {s.date && (
                <small className={styles.date} data-step-date="">
                  <time dateTime={s.date}>{dateTime(s.date)}</time>
                </small>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
