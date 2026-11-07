"use client";
// Live « En cours » / « Terminées » of the artisan Missions view: paged server history (newest first,
// « Afficher plus » follows next_cursor, dedup by id). Keyed by the host on identity + segment, so
// any change restarts at page 1; replies bound to identity + sequence (stale ones dropped). Rows are
// rendered by the host (same MissionRow) and open through openIntervention, cache or not.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { HISTORY_COPY as COPY, HISTORY_INITIAL, createHistory, type Context, type Counts, type HistoryFilter, type HistoryItem, type HistoryState } from "./model";
import styles from "./mission-history.module.css";

export { historyLabel, type Counts as HistoryCounts, type HistoryItem } from "./model";

export type MissionHistoryPanelProps = {
  filter: HistoryFilter;
  context: Context;
  renderRow: (item: HistoryItem) => ReactNode;
  /** Existing empty state of the segment. */
  empty: ReactNode;
  onCounts: (counts: Counts) => void;
  fetcher?: typeof fetch;
};

export function MissionHistoryPanel({ filter, context, renderRow, empty, onCounts, fetcher }: MissionHistoryPanelProps) {
  const [state, setRaw] = useState<HistoryState>(HISTORY_INITIAL);
  const ref = useRef(state);
  const set = (s: HistoryState) => {
    ref.current = s;
    setRaw(s);
  };
  const latest = useRef({ fetcher, context, onCounts });
  latest.current = { fetcher, context, onCounts };
  const ctrl = useRef<ReturnType<typeof createHistory> | null>(null);
  useEffect(() => {
    const c = createHistory({
      fetcher: () => latest.current.fetcher ?? ((...a) => fetch(...a)),
      filter,
      context: { generation: () => latest.current.context.generation(), userId: () => latest.current.context.userId() },
      get: () => ref.current,
      set,
      onCounts: (x) => latest.current.onCounts(x),
    });
    ctrl.current = c;
    void c.load();
    return () => c.dispose();
  }, [filter]);
  const c = ctrl.current;
  return (
    <div data-mission-history={state.phase} data-filter={filter} aria-busy={state.phase === "loading" || state.loadingMore || undefined}>
      {state.notice && <p className={styles.note} role="status" data-mission-history-notice="">{state.notice}</p>}
      {state.phase === "loading" && <p className={styles.hint} role="status">{COPY.loading}</p>}
      {state.phase === "forbidden" && <p className={styles.error} role="alert">{state.error}</p>}
      {state.phase === "error" && (
        <div className={styles.note} role="alert" data-mission-history-error="">
          <p className={styles.error}>{state.error}</p>
          <button type="button" className={styles.button} onClick={() => void c?.load()}>Réessayer</button>
        </div>
      )}
      {state.phase === "ready" && (state.items.length ? <div className={styles.rows}>{state.items.map((i) => <div key={i.id} data-mission-history-row={i.id}>{renderRow(i)}</div>)}</div> : empty)}
      {state.moreError && <p className={styles.error} role="alert">{state.moreError}</p>}
      {state.phase === "ready" && state.next && (
        <button type="button" className={styles.button} disabled={state.loadingMore} onClick={() => void c?.more()} data-mission-history-more="">
          {state.loadingMore ? "Chargement…" : COPY.more}
        </button>
      )}
    </div>
  );
}
