"use client";
// ADM-09 (E32) — read-only platform audit journal for an operator holding the `audit` capability
// (/me). Paginated server read (GET /api/platform-operations/audit); nothing is written here.
// Rights come from /me only; a refused read purges the rows (shared useLoad rule).
import { useEffect, useState } from "react";
import type { ContractState, PlatformAccess, PlatformClient, PlatformViewScope } from "../../../lib/features/platform-operations/types";
import type { PlatformDemo } from "../../../lib/features/platform-operations/demo";
import { EmptyState, ErrorBox, Gate, Loading, Pager, Panel, dateTime, scopeKey, shortId, useLoad } from "./shared";
import styles from "./platform-operations.module.css";

export type PlatformAuditViewProps = { state: ContractState; unavailableMessage: string; scope: PlatformViewScope; client: PlatformClient; demo?: PlatformDemo };

export function PlatformAuditView(props: PlatformAuditViewProps) {
  return <Gate state={props.state} unavailableMessage={props.unavailableMessage} title="Journal d’audit"><Inner key={scopeKey(props.scope)} {...props} /></Gate>;
}
function Inner({ client, demo }: PlatformAuditViewProps) {
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const cursor = cursors[cursors.length - 1] ?? null;
  const me = useLoad<PlatformAccess>(() => (demo ? Promise.resolve(demo.access) : client.load.me()), [demo]);
  const list = useLoad(
    () => (demo ? Promise.resolve({ entries: [], page: { limit: 25, total: 0, has_more: false, next_cursor: null } }) : client.load.audit({ cursor, limit: 25 })),
    [demo, cursor],
  );
  // Counter-review: a refused page (data already purged) re-reads the rights (/me) before any new
  // audit read; the next audit GET only happens on an explicit retry once /me granted it again.
  useEffect(() => {
    if (list.refused) me.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.refused]);
  if (me.loading && !me.data) return <Loading label="Chargement des droits…" />;
  if (me.error && !me.data) return <ErrorBox message={me.error} onRetry={me.reload} />;
  if (!me.data?.super_admin && !me.data?.capabilities.audit)
    return <div className="forbidden"><strong>Le journal d’audit nécessite l’habilitation de lecture du journal.</strong></div>;
  return (
    <div className={styles.view} data-module="platform-operations" data-platform-view="audit">
      <Panel title="Journal d’audit" intro="Actions sensibles enregistrées par la plateforme, de la plus récente à la plus ancienne. Lecture seule.">
        {list.error && list.data && (
          // A failed page over rows already shown (503): visible, retryable, previous page reachable.
          <ErrorBox message={list.error} onRetry={list.reload} />
        )}
        {list.loading && !list.data ? (
          <Loading />
        ) : list.error && !list.data ? (
          <ErrorBox message={list.error} onRetry={list.refused && me.loading ? undefined : list.reload} />
        ) : !list.data?.entries.length ? (
          <EmptyState title="Aucune entrée de journal" />
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <caption className={styles.srOnly}>Entrées du journal d’audit</caption>
              <thead><tr><th>Date</th><th>Action</th><th>Objet</th><th>Auteur</th></tr></thead>
              <tbody>
                {list.data.entries.map((e) => (
                  <tr key={e.id} data-audit-entry={e.id}>
                    <td>{dateTime(e.created_at)}</td>
                    <td className={styles.mono}>{e.action}</td>
                    <td><span className={styles.mono}>{e.target_kind}</span> {shortId(e.target_id)}</td>
                    <td className={styles.mono}>{e.actor_id ? shortId(e.actor_id) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {list.data && (
          // Pagination neutralised while a page loads; « Suivant » off after a failed page.
          <Pager
            page={{ ...list.data.page, has_more: list.data.page.has_more && !list.loading && !list.error }}
            canPrev={cursors.length > 1 && !list.loading}
            onPrev={() => setCursors((c) => c.slice(0, -1))}
            onNext={() => list.data?.page.next_cursor && setCursors((c) => [...c, list.data!.page.next_cursor])}
          />
        )}
      </Panel>
    </div>
  );
}
