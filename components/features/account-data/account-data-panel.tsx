"use client";
// « Mes données » (SYS-09 / PUB-10): download every personal section as one JSON file, and request
// erasure through a support ticket (nothing is erased now). Identity-guarded after every await;
// erasure request_id fenced in this tab's storage before the POST; demo: honest note, zero calls.
// Logic: ./model (strict copy of the ROOT e541656 contract).
import { useEffect, useRef, useState } from "react";
import { COLLECT_INITIAL, COPY, ERASURE_INITIAL, SECTIONS, SECTION_LABEL, TICKET_STATUS, createCollector, createErasure, tabStore, type CollectState, type Context, type ErasureState, type Store } from "./model";
import styles from "./account-data.module.css";

export type AccountDataPanelProps = {
  demo: boolean;
  context: Context;
  /** Opens the ticket in the existing support route. */
  onOpenTicket?: (ticketId: string) => void;
  fetcher?: typeof fetch;
  store?: () => Store | null;
  newId?: () => string | null;
};

/** Private, uncached save: object URL for this blob only, revoked right after the download starts. */
function saveJson(json: string, filename: string) {
  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  try {
    a.click();
  } finally {
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
const uuid = () => (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : null);

function useWait(seconds: number | null, key: unknown) {
  const [waiting, setWaiting] = useState(false);
  useEffect(() => {
    if (!seconds) return setWaiting(false);
    setWaiting(true);
    const t = setTimeout(() => setWaiting(false), seconds * 1000);
    return () => clearTimeout(t);
  }, [seconds, key]);
  return waiting;
}

export function AccountDataPanel({ demo, context, onOpenTicket, fetcher, store, newId }: AccountDataPanelProps) {
  const [collect, setCollect] = useState<CollectState>(COLLECT_INITIAL);
  const [erasure, setErasure] = useState<ErasureState>(ERASURE_INITIAL);
  const collector = useRef<ReturnType<typeof createCollector> | null>(null);
  const eraser = useRef<ReturnType<typeof createErasure> | null>(null);
  const doFetch: typeof fetch = fetcher ?? ((...a) => fetch(...a));
  if (!demo && !collector.current) collector.current = createCollector({ fetcher: doFetch, context, save: saveJson, set: setCollect });
  if (!demo && !eraser.current) eraser.current = createErasure({ fetcher: doFetch, store: store ?? tabStore, newId: newId ?? uuid, context, set: setErasure });
  useEffect(() => {
    if (demo) return;
    // StrictMode remounts: (re)create live controllers, restore this identity's pending request.
    const c = (collector.current ??= createCollector({ fetcher: doFetch, context, save: saveJson, set: setCollect }));
    const e = (eraser.current ??= createErasure({ fetcher: doFetch, store: store ?? tabStore, newId: newId ?? uuid, context, set: setErasure }));
    e.restore();
    return () => {
      c.dispose();
      e.dispose();
      collector.current = null;
      eraser.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo]);
  const collectWait = useWait(collect.phase === "error" ? collect.waitS : null, collect.error);
  const erasureWait = useWait(erasure.phase === "error" ? erasure.waitS : null, erasure.error);

  if (demo)
    return (
      <section className={styles.panel} aria-labelledby="account-data-title" data-account-data="demo">
        <h2 id="account-data-title">{COPY.title}</h2>
        <p className={styles.note}>{COPY.demo}</p>
      </section>
    );

  const collecting = collect.phase === "collecting";
  const showProgress = collect.phase === "collecting" || collect.phase === "error";
  return (
    <section className={styles.panel} aria-labelledby="account-data-title" data-account-data="">
      <h2 id="account-data-title">{COPY.title}</h2>
      <p className={styles.hint}>{COPY.intro}</p>

      <div className={styles.block} data-account-download={collect.phase}>
        <h3>Télécharger une copie</h3>
        <p className={styles.hint}>{COPY.scope}</p>
        <button type="button" className={styles.primary} onClick={() => void collector.current?.run()} disabled={collecting || (collect.phase === "error" && collectWait)} aria-busy={collecting || undefined}>
          {collecting ? COPY.collecting : collect.phase === "error" ? "Réessayer" : COPY.download}
        </button>
        {showProgress && (
          <ol className={styles.progress} aria-label="Progression par section">
            {SECTIONS.map((s) => (
              <li key={s} data-account-section={s} data-status={collect.progress[s].status}>
                <span>{SECTION_LABEL[s]}</span>
                <span className={styles.state}>
                  {collect.progress[s].status === "done" ? (s === "account" ? "lu" : `${collect.progress[s].rows} élément(s)`) : collect.progress[s].status === "loading" ? (collect.progress[s].rows ? `${collect.progress[s].rows} élément(s)…` : "lecture…") : collect.progress[s].status === "error" ? "échec" : "en attente"}
                </span>
              </li>
            ))}
          </ol>
        )}
        {collecting && <p className={styles.hint} role="status">Lecture de vos données, section par section…</p>}
        {collect.phase === "error" && (
          <p className={styles.error} role="alert" data-account-download-error="">
            {collect.error} « Réessayer » reprend à la section en échec, sans doublon.
          </p>
        )}
        {collect.phase === "aborted" && <p className={styles.error} role="alert">{COPY.aborted}</p>}
        {collect.phase === "done" && <p className={styles.ok} role="status">{COPY.done(collect.filename)}</p>}
      </div>

      <div className={styles.block} data-account-erasure={erasure.phase}>
        <h3>Effacement de mes données</h3>
        {erasure.phase === "idle" && (
          <button type="button" className={styles.secondary} onClick={() => eraser.current?.ask()}>
            {COPY.erasure}
          </button>
        )}
        {erasure.phase === "confirming" && (
          <div className={styles.confirm} role="group" aria-labelledby="account-erasure-confirm">
            <p id="account-erasure-confirm">{COPY.erasureExplain}</p>
            <div className={styles.actions}>
              <button type="button" className={styles.danger} onClick={() => void eraser.current?.send()}>
                {COPY.erasureConfirm}
              </button>
              <button type="button" className={styles.secondary} onClick={() => eraser.current?.cancel()}>
                {COPY.cancel}
              </button>
            </div>
          </div>
        )}
        {erasure.phase === "sending" && <p className={styles.hint} role="status">{COPY.erasureSending}</p>}
        {erasure.phase === "done" && erasure.receipt && (
          <div className={styles.confirm} role="status" data-account-erasure-ticket={erasure.receipt.ticket_id}>
            <p className={styles.ok}>{erasure.receipt.replayed ? COPY.erasureReplayed : COPY.erasureDone}</p>
            <p className={styles.hint}>Statut du ticket : {TICKET_STATUS[erasure.receipt.status]}.</p>
            {onOpenTicket && (
              <button type="button" className={styles.secondary} onClick={() => onOpenTicket(erasure.receipt!.ticket_id)}>
                {COPY.openTicket}
              </button>
            )}
          </div>
        )}
        {erasure.phase === "error" && (
          <div className={styles.confirm} role="alert" data-account-erasure-error="">
            <p className={styles.error}>{erasure.error}</p>
            {erasure.retry ? (
              <button type="button" className={styles.secondary} onClick={() => void eraser.current?.send()} disabled={erasureWait}>
                Réessayer
              </button>
            ) : (
              <button type="button" className={styles.secondary} onClick={() => eraser.current?.ask()}>
                {COPY.erasure}
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
