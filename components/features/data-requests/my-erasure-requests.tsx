"use client";
// « Mes demandes d’effacement » (SYS-07, client « Mes données »): private paged list of the current
// account's requests. Request state, execution (« Effacement non commencé », always) and the ticket
// link are distinct; nothing here says data was erased. Re-read when `refresh` changes (after a POST).
import { useEffect, useRef, useState } from "react";
import { DATA_REQUESTS_COPY as COPY, EXECUTION_LABEL, STATE_LABEL } from "./contract";
import { LIST_INITIAL, createList, type Context, type ListState } from "./model";
import styles from "./data-requests.module.css";

export type MyErasureRequestsProps = { context: Context; onOpenTicket?: (ticketId: string) => void; refresh?: number; fetcher?: typeof fetch };
const day = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { dateStyle: "long", timeZone: "America/Martinique" });

export function MyErasureRequests({ context, onOpenTicket, refresh = 0, fetcher }: MyErasureRequestsProps) {
  const [state, setRaw] = useState<ListState>(LIST_INITIAL);
  const ref = useRef(state);
  const set = (s: ListState) => {
    ref.current = s;
    setRaw(s);
  };
  const latest = useRef({ fetcher, context });
  latest.current = { fetcher, context };
  const ctrl = useRef<ReturnType<typeof createList> | null>(null);
  useEffect(() => {
    const c = createList({
      fetcher: () => latest.current.fetcher ?? ((...a) => fetch(...a)),
      context: { generation: () => latest.current.context.generation(), userId: () => latest.current.context.userId() },
      kind: "personal",
      get: () => ref.current,
      set,
    });
    ctrl.current = c;
    void c.load();
    return () => c.dispose();
  }, [refresh]);
  const c = ctrl.current;
  return (
    <div className={styles.block} data-erasure-requests={state.phase} aria-busy={state.phase === "loading" || undefined}>
      <h4 className={styles.title}>{COPY.mineTitle}</h4>
      <p className={styles.hint}>{COPY.mineNote}</p>
      {state.phase === "loading" && <p className={styles.hint} role="status">{COPY.loading}</p>}
      {(state.phase === "error" || state.phase === "forbidden") && (
        <div className={styles.note} role="alert">
          <p className={styles.error}>{state.error}</p>
          {state.phase === "error" && <button type="button" className={styles.secondary} onClick={() => void c?.load()}>Réessayer</button>}
        </div>
      )}
      {state.phase === "ready" && state.rows.length === 0 && <p className={styles.hint} data-erasure-empty="">{COPY.empty}</p>}
      {state.phase === "ready" && state.rows.length > 0 && (
        <ul className={styles.list}>
          {state.rows.map((r) => (
            <li key={r.id} className={styles.item} data-erasure-request={r.id}>
              <span className={styles.labels}>
                <span className={styles.badge} data-erasure-state={r.state}>Demande : {STATE_LABEL[r.state]}</span>
                <span className={styles.badge} data-erasure-execution={r.execution_state}>{EXECUTION_LABEL[r.execution_state]}</span>
              </span>
              <span className={styles.meta}>Déposée le {day(r.created_at)} · mise à jour le {day(r.updated_at)}</span>
              {onOpenTicket && (
                <button type="button" className={styles.secondary} onClick={() => onOpenTicket(r.ticket_id)} data-erasure-ticket={r.ticket_id}>
                  {COPY.openTicket}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {state.moreError && <p className={styles.error} role="alert">{state.moreError}</p>}
      {state.phase === "ready" && state.next && (
        <button type="button" className={styles.secondary} disabled={state.loadingMore} onClick={() => void c?.more()} data-erasure-more="">
          {state.loadingMore ? "Chargement…" : COPY.more}
        </button>
      )}
    </div>
  );
}
