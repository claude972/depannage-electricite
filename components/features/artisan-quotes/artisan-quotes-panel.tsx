"use client";
// ART-07 — live « Devis » list of the artisan: paged server list (newest first, status filter,
// « Afficher plus » follows next_cursor with dedup by id; a filter change restarts at page 1).
// The state is bound at render to identity + filter (no old frame) and replies to identity +
// filter + sequence (late ones dropped). No cache fallback: rows come only from the route.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Tag } from "../../app/ui";
import { ARTISAN_STATUS, category, dateTime, money, quoteRef } from "../../app/format";
import {
  FILTER_LABEL,
  QUOTE_FILTERS,
  QUOTES_COPY as COPY,
  QUOTE_STATUS_LABEL,
  createQuotes,
  fenceKey,
  quotesInitial,
  type Context,
  type QuoteFilter,
  type QuoteItem,
  type QuotesState,
} from "./model";
import styles from "./artisan-quotes.module.css";

export type ArtisanQuotesPanelProps = {
  context: Context;
  /** « Voir le dossier »: the current dossier, not a claim to show this exact quote. */
  onOpenDossier: (interventionId: string) => void;
  /** Extra action per row (exact point read of the quote), rendered by the caller. */
  rowAction?: (item: QuoteItem) => ReactNode;
  fetcher?: typeof fetch;
};

/** Re-renders when `until` (epoch ms) is reached, so a Retry-After wait ends on its own. */
function useUntil(until: number): boolean {
  const [, tick] = useState(0);
  const waiting = until > Date.now();
  useEffect(() => {
    if (!waiting) return;
    const t = setTimeout(() => tick((n) => n + 1), Math.max(0, until - Date.now()) + 20);
    return () => clearTimeout(t);
  }, [until, waiting]);
  return waiting;
}

export function ArtisanQuotesPanel({ context, onOpenDossier, rowAction, fetcher }: ArtisanQuotesPanelProps) {
  const [filter, setFilter] = useState<QuoteFilter>("all");
  const [state, setRaw] = useState<QuotesState>(() => quotesInitial(""));
  const ref = useRef(state);
  const set = (s: QuotesState) => {
    ref.current = s;
    setRaw(s);
  };
  const latest = useRef({ fetcher, context });
  useEffect(() => {
    latest.current = { fetcher, context };
  });
  const key = fenceKey(context, filter);
  const ctrl = useRef<ReturnType<typeof createQuotes> | null>(null);
  useEffect(() => {
    if (!key) return;
    const c = createQuotes({
      fetcher: () => latest.current.fetcher ?? ((...a) => fetch(...a)),
      filter,
      context: { generation: () => latest.current.context.generation(), userId: () => latest.current.context.userId() },
      get: () => ref.current,
      set,
    });
    ctrl.current = c;
    void c.load();
    return () => c.dispose();
    // The key carries identity + filter: any change restarts at page 1.
  }, [key, filter]);
  // Render fence: a state of another identity or filter is never shown.
  const s = key && state.key === key ? state : quotesInitial(key ?? "");
  const waiting = useUntil(s.retryAt);
  const c = ctrl.current && ctrl.current.key === key ? ctrl.current : null;
  return (
    <div data-artisan-quotes={key ? s.phase : "forbidden"} data-filter={filter} aria-busy={s.phase === "loading" || s.loadingMore || undefined}>
      <div className={styles.filters} role="group" aria-label="Filtrer les devis par état">
        {QUOTE_FILTERS.map((f) => (
          <button key={f} type="button" className={styles.filter} aria-pressed={f === filter} data-quotes-filter={f} onClick={() => setFilter(f)}>
            {FILTER_LABEL[f]}
          </button>
        ))}
      </div>
      {!key && <p className={styles.error} role="alert">{COPY.session}</p>}
      {s.notice && <p className={styles.note} role="status" data-quotes-notice="">{s.notice}</p>}
      {key && s.phase === "loading" && <p className={styles.hint} role="status">{COPY.loading}</p>}
      {s.phase === "forbidden" && <p className={styles.error} role="alert" data-quotes-forbidden="">{s.error}</p>}
      {s.phase === "error" && (
        <div className={styles.note} role="alert" data-quotes-error="">
          <p className={styles.error}>{s.error}</p>
          <button type="button" className={styles.button} disabled={waiting} onClick={() => void c?.load()} data-quotes-retry="">
            {waiting ? "Nouvelle tentative possible dans un instant…" : "Réessayer"}
          </button>
        </div>
      )}
      {s.phase === "ready" &&
        (s.items.length ? (
          <ul className={styles.rows} aria-label="Devis">
            {s.items.map((q) => {
              const st = QUOTE_STATUS_LABEL[q.status];
              return (
                <li key={q.id} className={styles.row} data-quote-row={q.id}>
                  <div className={styles.rowMain}>
                    <strong>{quoteRef(q.id)}</strong>
                    <span className={styles.meta}>
                      {category(q.intervention.category).label} — dossier {ARTISAN_STATUS[q.intervention.status].toLowerCase()}
                    </span>
                    <span>
                      <Tag tone={st.tone}>
                        {st.label}
                        {q.status === "accepted" && q.accepted_at ? ` le ${dateTime(q.accepted_at)}` : ""}
                      </Tag>
                    </span>
                  </div>
                  <div className={styles.amount}>
                    <strong>{money(q.total_cents)}</strong>
                    <span className={styles.meta}>Total TTC du devis</span>
                    <span className={styles.meta}>{dateTime(q.created_at)}</span>
                  </div>
                  <div className={styles.actions}>
                    {rowAction?.(q)}
                    <button type="button" className={styles.button} onClick={() => onOpenDossier(q.intervention_id)} data-quote-dossier={q.intervention_id}>
                      Voir le dossier
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className={styles.hint} data-quotes-empty="">{filter === "all" ? COPY.emptyAll : COPY.empty}</p>
        ))}
      {s.moreError && <p className={styles.error} role="alert">{s.moreError}</p>}
      {s.phase === "ready" && s.next && (
        <button type="button" className={styles.button} disabled={s.loadingMore || waiting} onClick={() => void c?.more()} data-quotes-more="">
          {s.loadingMore ? "Chargement…" : COPY.more}
        </button>
      )}
    </div>
  );
}
