"use client";

import { Fragment, useId, useRef, useState } from "react";
import { date } from "../../app/format";
import { Segments, Tag } from "../../app/ui";
import { ComplianceReminderPanel } from "../operational-reminders/operational-reminder-panel";
import { RECORDS_COPY, useSiteRecords, type DueRow } from "./use-site-records";
import styles from "../../role/enterprise.module.css";

type Tab = "upcoming" | "completed" | "audits";
type Context = { generation(): number; userId(): string | null };
const choices: readonly (readonly [Tab, string])[] = [
  ["upcoming", "À traiter"],
  ["completed", "Terminées"],
  ["audits", "Audits et sécurité"],
];
const empty: Record<Tab, string> = {
  upcoming: "Aucune échéance en attente pour ce site.",
  completed: "Aucune échéance terminée pour ce site.",
  audits: "Aucun audit ou signalement de sécurité pour ce site.",
};

export function SiteComplianceRecords({ siteId, context, canWrite, busy, complete, kindLabels, statusLabels }: {
  siteId: string;
  context: Context;
  canWrite: boolean;
  busy: boolean;
  complete(row: DueRow): Promise<boolean>;
  kindLabels: Readonly<Record<string, string>>;
  statusLabels: Readonly<Record<string, string>>;
}) {
  const heading = useId();
  const [tab, setTab] = useState<Tab>("upcoming");
  const [reminder, setReminder] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const records = useSiteRecords({ enabled: true, context, siteId, kind: tab });
  const { state } = records;

  async function markComplete(row: DueRow) {
    if (!canWrite || busy || inFlight.current || row.site_id !== siteId || row.status === "completed") return;
    inFlight.current = true;
    setSaving(true);
    const uid = context.userId(), generation = context.generation();
    try {
      const ok = await complete(row);
      if (ok && uid === context.userId() && generation === context.generation()) {
        setReminder(null);
        records.refresh();
      }
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  return (
    <section className="panel" aria-labelledby={heading} data-direct-site-compliance={tab}>
      <div className={styles.panelTitle}>
        <h2 id={heading}>Échéances et audits du site</h2>
        <fieldset disabled={saving} className={styles.segmentsWrap}>
          <Segments label="Filtrer les échéances et audits" value={tab} options={choices} onChange={(next) => { setReminder(null); setTab(next); }} />
        </fieldset>
      </div>
      {(state.phase === "idle" || state.phase === "loading") && <p className={styles.muted} role="status">{RECORDS_COPY.loading}</p>}
      {(state.phase === "error" || state.phase === "forbidden" || state.failed === "more") && (
        <div role="alert">
          <p className={styles.muted}>{state.error}</p>
          {state.phase !== "forbidden" && <button type="button" className="button outline" onClick={records.retry}>Réessayer</button>}
        </div>
      )}
      {state.phase === "ready" && (state.items.length ? (
        (state.items as DueRow[]).map((row) => (
          <Fragment key={row.id}>
            <div className={styles.listRow} data-direct-site-compliance-row={row.id}>
              <section>
                <strong>{row.title}</strong>
                <small>{kindLabels[row.kind] || row.kind} · échéance {date(row.due_on)}</small>
                {row.notes && <p>{row.notes}</p>}
              </section>
              <Tag tone={row.status === "completed" ? "green" : "amber"}>{statusLabels[row.status] || row.status}</Tag>
              {canWrite && row.status !== "completed" && (
                <>
                  <button type="button" className="button outline" disabled={busy || saving} onClick={() => void markComplete(row)}>
                    Marquer terminé
                  </button>
                  <button type="button" className="button outline" disabled={busy || saving} aria-expanded={reminder === row.id} onClick={() => setReminder(reminder === row.id ? null : row.id)}>
                    Gérer le rappel
                  </button>
                </>
              )}
            </div>
            {canWrite && row.status !== "completed" && reminder === row.id && (
              <ComplianceReminderPanel complianceId={row.id} context={context} demo={false} />
            )}
          </Fragment>
        ))
      ) : <p className={styles.muted}>{empty[tab]}</p>)}
      {state.phase === "ready" && state.next && state.failed !== "more" && (
        <button type="button" className="button outline" disabled={state.loadingMore || saving} onClick={records.more}>
          {state.loadingMore ? "Chargement…" : RECORDS_COPY.more}
        </button>
      )}
    </section>
  );
}
