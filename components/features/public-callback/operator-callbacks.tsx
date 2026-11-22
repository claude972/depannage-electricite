"use client";
// PUB-04 support queue: callback requests left by the public. Open / closed tabs, numbered pages.
// « Classer » ONLY when can_close and version 1; after success, an uncertain reply or a 409 the page
// is re-read. 401/403 ⇒ cleared + scope refusal. Identity checked before and after each await (and
// the component remounts on identity change). « Classé » is an operator action only.
import { useEffect, useRef, useState } from "react";
import { COPY, REASON_LABEL, SUPPORT_PATH, isClosure, parseQueue, queueUrl, timed, type CallbackQueue, type Context, type Status } from "./model";
import styles from "./public-callback.module.css";

export type OperatorCallbacksProps = { context: Context; fetcher?: typeof fetch };
type View = { key: string; phase: "loading" | "ready" | "error" | "forbidden"; data: CallbackQueue | null; error: string; notice: string; busy: string | null };
const when = (iso: string) => new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Martinique" });

export function OperatorCallbacks(props: OperatorCallbacksProps) {
  return <Live key={`${props.context.userId() ?? "-"}|${props.context.generation()}`} {...props} />;
}

function Live({ context, fetcher }: OperatorCallbacksProps) {
  const [status, setStatus] = useState<Status>("open");
  const [page, setPage] = useState(1);
  const identity = () => `${latest.current.context.userId() ?? "-"}|${latest.current.context.generation()}`;
  const latest = useRef({ fetcher, context, status, page });
  latest.current = { fetcher, context, status, page };
  // Everything shown or commanded is bound to identity + status + page AT RENDER.
  const keyOf = (st: Status, pg: number) => `${identity()}|${st}|${pg}`;
  const currentKey = keyOf(status, page);
  const [view, setRaw] = useState<View>({ key: currentKey, phase: "loading", data: null, error: "", notice: "", busy: null });
  const ref = useRef(view);
  const set = (v: View) => {
    ref.current = v;
    setRaw(v);
  };
  const seq = useRef(0);
  const alive = useRef(true);
  const doFetch = (): typeof fetch => latest.current.fetcher ?? ((...a) => fetch(...a));
  const load = async (st: Status, pg: number, notice = "") => {
    const my = ++seq.current;
    const key = keyOf(st, pg);
    set({ key, phase: "loading", data: null, error: "", notice, busy: null });
    const r = await timed(doFetch(), queueUrl(st, pg), { method: "GET" });
    if (!alive.current || my !== seq.current || keyOf(latest.current.status, latest.current.page) !== key) return; // stale: dropped
    if (r.status === 401 || r.status === 403) return set({ key, phase: "forbidden", data: null, error: COPY.forbidden, notice: "", busy: null });
    const q = r.status === 200 ? parseQueue(r.body, st, pg) : null;
    if (!q) return set({ key, phase: "error", data: null, error: COPY.loadFailed, notice, busy: null });
    set({ key, phase: "ready", data: q, error: "", notice, busy: null });
  };
  useEffect(() => {
    alive.current = true;
    void load(status, page);
    return () => {
      alive.current = false;
      seq.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, page]);
  const shown = view.key === currentKey ? view : { key: currentKey, phase: "loading" as const, data: null, error: "", notice: "", busy: null };
  const close = async (id: string) => {
    const v = ref.current;
    const row = v.data?.items.find((i) => i.id === id);
    if (v.key !== currentKey || !v.data?.can_close || !row || row.version !== 1 || v.busy) return;
    const who = identity();
    set({ ...v, busy: id, notice: "", error: "" });
    const r = await timed(doFetch(), SUPPORT_PATH, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, expected_version: 1 }) });
    if (!alive.current || identity() !== who) return; // identity changed: nothing re-read, nothing shown
    if (r.status === 401 || r.status === 403) {
      // Refused: invalidate every GET already in flight (an earlier 200 must not re-show the rows).
      seq.current++;
      return set({ key: keyOf(latest.current.status, latest.current.page), phase: "forbidden", data: null, error: COPY.forbidden, notice: "", busy: null });
    }
    const notice = r.status === 200 && isClosure(r.body) ? COPY.closedOk : r.status === 409 ? COPY.conflict : COPY.uncertain;
    // Re-read the CURRENT tab / page only (never the one of the click if it changed meanwhile).
    await load(latest.current.status, latest.current.page, notice);
  };
  const d = shown.data;
  return (
    <section className={styles.opPanel} aria-labelledby="op-callbacks-title" data-op-callbacks={shown.phase} data-op-callbacks-key={`${status}|${page}`}>
      <h2 id="op-callbacks-title">{COPY.opTitle}</h2>
      <p className={styles.hint}>{COPY.opNote}</p>
      <div className={styles.tabs} role="tablist" aria-label="Demandes de rappel">
        {(["open", "closed"] as const).map((st) => (
          <button key={st} type="button" role="tab" aria-selected={status === st} className={styles.tab} onClick={() => { if (st !== status) { setStatus(st); setPage(1); } }}>
            {st === "open" ? COPY.open : COPY.closedTab}
          </button>
        ))}
      </div>
      {shown.phase === "loading" && <p className={styles.hint} role="status">{COPY.loading}</p>}
      {shown.phase === "forbidden" && <p className={styles.note} role="alert" data-op-callbacks-forbidden="">{shown.error}</p>}
      {shown.phase === "error" && (
        <div className={styles.note} role="alert">
          <p className={styles.error}>{shown.error}</p>
          <button type="button" className={styles.secondary} onClick={() => void load(status, page)}>Réessayer</button>
        </div>
      )}
      {shown.notice && <p className={styles.hint} role="status" data-op-callbacks-notice="">{shown.notice}</p>}
      {shown.phase === "ready" && d && (
        <>
          <p className={styles.hint}>{d.total} demande(s)</p>
          {d.items.length === 0 ? (
            <p className={styles.hint}>{COPY.empty}</p>
          ) : (
            <ul className={styles.list}>
              {d.items.map((i) => (
                <li key={i.id} className={styles.item} data-op-callback={i.id}>
                  <strong className={styles.phone}>{i.phone}</strong>
                  <span className={styles.meta}>{REASON_LABEL[i.reason]} · reçue le {when(i.created_at)}{i.closed_at ? ` · ${COPY.closedLabel} le ${when(i.closed_at)}` : ""}</span>
                  {d.can_close && i.version === 1 && (
                    <button type="button" className={styles.secondary} disabled={shown.busy !== null} onClick={() => void close(i.id)} data-op-callback-close={i.id}>
                      {shown.busy === i.id ? "Classement…" : COPY.close}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <nav className={styles.pager} aria-label="Pages">
            <button type="button" className={styles.pageButton} disabled={d.page.number <= 1} onClick={() => setPage(d.page.number - 1)}>Précédent</button>
            <span className={styles.pageInfo} aria-live="polite" data-op-callbacks-page="">Page {d.page.number} sur {d.page.pages}</span>
            <button type="button" className={styles.pageButton} disabled={d.page.number >= d.page.pages} onClick={() => setPage(d.page.number + 1)}>Suivant</button>
          </nav>
        </>
      )}
    </section>
  );
}
