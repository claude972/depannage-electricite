"use client";
// ART-07 — exact quote opened from the list: GET /api/artisan/quotes/[id] only (never the cache,
// never the 20-capped dossier detail, never another quote). Bound at render to identity + quote id;
// a late reply (other sequence, identity or quote) is dropped.
import { useEffect, useRef, useState } from "react";
import { Tag } from "../../app/ui";
import { ARTISAN_STATUS, category, dateTime, money, quoteRef } from "../../app/format";
import { taxRateLabel } from "../../app/tax-rate";
import { getJson, QUOTE_STATUS_LABEL, type Context } from "./model";
import { DETAIL_COPY as COPY, parseQuoteDetail, quoteDetailUrl, type DetailState } from "./detail";
import styles from "./artisan-quotes.module.css";

type Frame = { key: string; nonce: number; state: DetailState };
const detailKey = (ctx: Context, quoteId: string) => {
  const uid = ctx.userId();
  return uid ? `${uid}|${ctx.generation()}|${quoteId.toLowerCase()}` : null;
};

export function useQuoteDetail(context: Context, quoteId: string, fetcher?: typeof fetch) {
  const key = detailKey(context, quoteId);
  const [nonce, setNonce] = useState(0);
  const [frame, setFrame] = useState<Frame | null>(null);
  const seq = useRef(0);
  const latest = useRef({ context, fetcher });
  useEffect(() => {
    latest.current = { context, fetcher };
  });
  useEffect(() => {
    if (!key) return;
    const my = ++seq.current;
    let cancelled = false;
    const uid = latest.current.context.userId() ?? "";
    const still = () => !cancelled && my === seq.current && detailKey(latest.current.context, quoteId) === key;
    void getJson(latest.current.fetcher ?? ((...a) => fetch(...a)), quoteDetailUrl(quoteId)).then((r) => {
      if (!still()) return;
      let state: DetailState;
      if (r.status === 404 || r.status === 403 || r.status === 422) state = { phase: "inaccessible" };
      else if (r.status === 401) state = { phase: "session" };
      else {
        const detail = r.status === 200 ? parseQuoteDetail(r.body, quoteId, uid) : null;
        state = detail ? { phase: "ready", detail } : { phase: "error", retryAt: r.retryAfter ? Date.now() + r.retryAfter * 1000 : 0 };
      }
      setFrame({ key, nonce, state });
    });
    return () => {
      cancelled = true;
    };
  }, [key, nonce, quoteId]);
  const state: DetailState = !key ? { phase: "session" } : frame && frame.key === key && frame.nonce === nonce ? frame.state : { phase: "loading" };
  return { state, retry: () => setNonce((n) => n + 1) };
}

function useWaiting(until: number): boolean {
  const [, tick] = useState(0);
  const waiting = until > Date.now();
  useEffect(() => {
    if (!waiting) return;
    const t = setTimeout(() => tick((n) => n + 1), Math.max(0, until - Date.now()) + 20);
    return () => clearTimeout(t);
  }, [until, waiting]);
  return waiting;
}

export function ArtisanQuoteDetail({ context, quoteId, onBack, onOpenDossier, fetcher }: { context: Context; quoteId: string; onBack: () => void; onOpenDossier: (interventionId: string) => void; fetcher?: typeof fetch }) {
  const { state, retry } = useQuoteDetail(context, quoteId, fetcher);
  const waiting = useWaiting(state.phase === "error" ? state.retryAt : 0);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [quoteId]);
  return (
    <section className="panel" aria-labelledby="artisan-quote-title" data-quote-detail={state.phase} data-quote-id={quoteId}>
      <button type="button" className={styles.button} onClick={onBack} data-quote-back="">
        Retour à la liste
      </button>
      <h2 id="artisan-quote-title" ref={heading} tabIndex={-1} style={{ fontSize: 18, margin: "12px 0 8px" }}>
        Devis {quoteRef(quoteId)}
      </h2>
      {state.phase === "loading" && <p className={styles.hint} role="status">{COPY.loading}</p>}
      {state.phase === "inaccessible" && (
        <p className={styles.note} role="alert" data-quote-inaccessible="">
          {COPY.inaccessible}
        </p>
      )}
      {state.phase === "session" && <p className={styles.error} role="alert">{COPY.session}</p>}
      {state.phase === "error" && (
        <div className={styles.note} role="alert" data-quote-error="">
          <p className={styles.error}>{COPY.error}</p>
          <button type="button" className={styles.button} disabled={waiting} onClick={retry} data-quote-retry="">
            {waiting ? "Nouvelle tentative possible dans un instant…" : "Réessayer"}
          </button>
        </div>
      )}
      {state.phase === "ready" && (
        <>
          <p className={styles.meta}>
            {category(state.detail.intervention.category).label} — dossier {ARTISAN_STATUS[state.detail.intervention.status].toLowerCase()} · créé le {dateTime(state.detail.quote.created_at)}
          </p>
          <p style={{ margin: "8px 0 12px" }}>
            <Tag tone={QUOTE_STATUS_LABEL[state.detail.quote.status].tone}>
              {QUOTE_STATUS_LABEL[state.detail.quote.status].label}
              {state.detail.quote.status === "accepted" && state.detail.quote.accepted_at ? ` le ${dateTime(state.detail.quote.accepted_at)}` : ""}
            </Tag>
          </p>
          <div className={styles.lines} data-quote-lines="">
            {state.detail.quote.lines.map((l, index) => (
              <div key={index} className={styles.line}>
                <div>
                  {l.label}
                  <span>
                    {l.quantity} × {money(l.unit_price_cents)} HT
                  </span>
                </div>
                <strong>{money(l.quantity * l.unit_price_cents)}</strong>
              </div>
            ))}
          </div>
          <div className={styles.totals}>
            <div>
              <span>Total HT</span>
              <span>{money(state.detail.quote.subtotal_cents)}</span>
            </div>
            <div>
              <span>TVA ({taxRateLabel(state.detail.quote.tax_rate)})</span>
              <span>{money(state.detail.quote.tax_cents)}</span>
            </div>
            <div className={styles.total}>
              <span>Total TTC</span>
              <span data-quote-total="">{money(state.detail.quote.total_cents)}</span>
            </div>
          </div>
          <p className={styles.hint}>Total du devis seul : avenants et règlements n’y sont pas inclus.</p>
          <button type="button" className={styles.button} onClick={() => onOpenDossier(state.detail.quote.intervention_id)} data-quote-detail-dossier="">
            Voir le dossier
          </button>
        </>
      )}
    </section>
  );
}
