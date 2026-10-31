"use client";
import { ENTITY, EVENT_ACTION, dateTime, shortId } from "../../../lib/features/site-operations/labels";
import { EmptyState, Truncated, type PanelContext } from "./shared";
import styles from "./site-operations.module.css";

export function HistoryPanel({ context }: { context: PanelContext }) {
  const { events, limits } = context.report.snapshot;
  return (
    <section aria-labelledby="so-history-title">
      <header className={styles.sectionHead}>
        <div>
          <h3 id="so-history-title">Historique des modifications</h3>
          <p>Chaque enregistrement est journalisé côté serveur avec son auteur et sa version.</p>
        </div>
      </header>
      {events.length === 0 ? (
        <EmptyState title="Aucune modification enregistrée">L’historique se remplit au fil des enregistrements de ce site et de la configuration de l’organisation.</EmptyState>
      ) : (
        <table className={styles.table}>
          <caption className={styles.srOnly}>Historique</caption>
          <thead>
            <tr><th scope="col">Date</th><th scope="col">Élément</th><th scope="col">Action</th><th scope="col">Version</th><th scope="col">Portée</th></tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td>{dateTime(e.created_at)}</td>
                <td>{ENTITY[e.entity] ?? e.entity} {shortId(e.entity_id)}</td>
                <td>{EVENT_ACTION[e.action] ?? e.action}</td>
                <td>{e.version}</td>
                <td>{e.site_id ? "Site" : "Organisation"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Truncated name="événements" limited={limits.events_limited} />
    </section>
  );
}
