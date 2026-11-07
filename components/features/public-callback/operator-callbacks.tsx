"use client";
// PUB-04 support queue: callback requests left by the public. Open / closed tabs, numbered pages.
// « Classer » ONLY when can_close and version 1; after success, an uncertain reply or a 409 the page
// is re-read. 401/403 ⇒ cleared + scope refusal. Identity checked before and after each await (and
// the component remounts on identity change). « Classé » is an operator action only.
import { useEffect, useRef, useState } from "react";
import { COPY, REASON_LABEL, SUPPORT_PATH, isClosure, parseQueue, queueUrl, timed, type CallbackQueue, type Context, type Status } from "./model";
import styles from "./public-callback.module.css";

export type OperatorCallbacksProps = { context: Context; fetcher?: typeof fetch };
type View = { phase: "loading" | "ready" | "error" | "forbidden"; data: CallbackQueue | null; error: string; notice: string; busy: string | null };
const INITIAL: View = { phase: "loading", data: null, error: "", notice: "", busy: null };
const when = (iso: string) => new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Martinique" });

export function OperatorCallbacks(props: OperatorCallbacksProps) {
  return <Live key={`${props.context.userId() ?? "-"}|${props.context.generation()}`} {...props} />;
}

function Live({ context, fetcher }: OperatorCallbacksProps) {
  const [status, setStatus] = useState<Status>("open");
  const [page, setPage] = useState(1);
  const [view, setRaw] = useState<View>(INITIAL);
  const ref = useRef(view);
  const set = (v: View) => {
    ref.current = v;
    setRaw(v);
  };
  const seq = useRef(0);
  const alive = useRef(true);
  const latest = useRef({ fetcher, context });
  latest.current = { fetcher, context };
  const doFetch = (): typeof fetch => latest.current.fetcher ?? ((...a) => fetch(...a));
  const who = () => ({ uid: latest.current.context.userId(), gen: latest.current.context.generation() });
  const same = (w: { uid: string | null; gen: number }) => alive.current && latest.current.context.userId() === w.uid && latest.current.context.generation() === w.gen;
  const forbid = () => set({ ...INITIAL, phase: "forbidden", error: COPY.forbidden });
  const load = async (st: Status, pg: number, notice = "") => {
    const my = ++seq.current;
    const w = who();
    set({ ...ref.current, phase: ref.current.data ? ref.current.phase : "loading", notice, busy: null });
    const r = await timed(doFetch(), queueUrl(st, pg), { method: "GET" });
    if (my !== seq.current || !same(w)) return;
    if (r.status === 401 || r.status === 403) return forbid();
    const q = r.status === 200 ? parseQueue(r.body, st, pg) : null;
    if (!q) return set({ ...INITIAL, phase: "error", error: COPY.loadFailed, notice });
    set({ phase: "ready", data: q, error: "", notice, busy: null });
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
  const close = async (id: string) => {
    const d = ref.current.data;
    const row = d?.items.find((i) => i.id === id);
    if (!d?.can_close || !row || row.version !== 1 || ref.current.busy) return;
    const w = who();
    set({ ...ref.current, busy: id, notice: "", error: "" });
    const r = await timed(doFetch(), SUPPORT_PATH, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, expected_version: 1 }) });
    if (!same(w)) return;
    if (r.status === 401 || r.status === 403) return forbid();
    const notice = r.status === 200 && isClosure(r.body) ? COPY.closedOk : r.status === 409 ? COPY.conflict : COPY.uncertain;
    await load(status, page, notice); // always re-read: success, conflict or uncertain reply
  };
  const d = view.data;
  return (
    <section className={styles.opPanel} aria-labelledby="op-callbacks-title" data-op-callbacks={view.phase}>
      <h2 id="op-callbacks-title">{COPY.opTitle}</h2>
      <p className={styles.hint}>{COPY.opNote}</p>
      <div className={styles.tabs} role="tablist" aria-label="Demandes de rappel">
        {(["open", "closed"] as const).map((s) => (
          <button key={s} type="button" role="tab" aria-selected={status === s} className={styles.tab} onClick={() => { setStatus(s); setPage(1); }}>
            {s === "open" ? COPY.open : COPY.closedTab}
          </button>
        ))}
      </div>
      {view.phase === "loading" && <p className={styles.hint} role="status">{COPY.loading}</p>}
      {view.phase === "forbidden" && <p className={styles.note} role="alert" data-op-callbacks-forbidden="">{view.error}</p>}
      {view.phase === "error" && (
        <div className={styles.note} role="alert">
          <p className={styles.error}>{view.error}</p>
          <button type="button" className={styles.secondary} onClick={() => void load(status, page)}>Réessayer</button>
        </div>
      )}
      {view.notice && <p className={styles.hint} role="status" data-op-callbacks-notice="">{view.notice}</p>}
      {view.phase === "ready" && d && (
        <>
          <p className={styles.hint}>{d.total} demande(s) · page {d.page.number} / {d.page.pages}</p>
          {d.items.length === 0 ? (
            <p className={styles.hint}>{COPY.empty}</p>
          ) : (
            <ul className={styles.list}>
              {d.items.map((i) => (
                <li key={i.id} className={styles.item} data-op-callback={i.id}>
                  <strong className={styles.phone}>{i.phone}</strong>
                  <span className={styles.meta}>{REASON_LABEL[i.reason]} · reçue le {when(i.created_at)}{i.closed_at ? ` · ${COPY.closedLabel} le ${when(i.closed_at)}` : ""}</span>
                  {d.can_close && i.version === 1 && (
                    <button type="button" className={styles.secondary} disabled={view.busy !== null} onClick={() => void close(i.id)} data-op-callback-close={i.id}>
                      {view.busy === i.id ? "Classement…" : COPY.close}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {d.page.pages > 1 && (
            <nav className={styles.pager} aria-label="Pages">
              {Array.from({ length: d.page.pages }, (_, k) => k + 1).map((n) => (
                <button key={n} type="button" className={styles.pageButton} aria-current={n === d.page.number ? "page" : undefined} onClick={() => setPage(n)}>{n}</button>
              ))}
            </nav>
          )}
        </>
      )}
    </section>
  );
}
