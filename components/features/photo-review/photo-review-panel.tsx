"use client";
// SYS-10 photo review of ONE dossier. Client: explicit consent, then request / withdraw per photo
// (server flags only); a result is shown only after the artisan's validation. Assigned artisan:
// validate / reject per the server flag. Fixed labels only, no free text, never a diagnosis.
import { useEffect, useId, useRef, useState } from "react";
import { CATEGORY_LABEL, COPY, PR_INITIAL, READABILITY_LABEL, STATUS_LABEL, createPrApi, createPrController, tabStore, visibleResult, type Context, type PrApi, type PrItem, type PrState, type Store } from "./model";
import styles from "./photo-review.module.css";

const uuid = (): string | null => (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : null);
const ACTIVE = new Set(["requested", "uncertain", "awaiting_review", "validated"]);
export type PhotoRef = { id: string; name: string };
export type PhotoReviewProps = { interventionId: string; role: "client" | "artisan"; photos: PhotoRef[]; context: Context; demo?: boolean; api?: PrApi; store?: () => Store | null; newId?: () => string | null; /** Tests only. */ initial?: PrState };

export function PhotoReviewPanel(props: PhotoReviewProps) {
  if (props.demo)
    return (
      <section className={styles.panel} data-photo-review="demo">
        <h3 className={styles.title}>{COPY.title}</h3>
        <p className={styles.note}>{COPY.demo}</p>
        <p className={styles.muted}>{COPY.manual}</p>
      </section>
    );
  return <Live key={`${props.context.userId() ?? "-"}|${props.context.generation()}|${props.role}|${props.interventionId}`} {...props} />;
}

function Live({ interventionId, role, photos, context, api, store = tabStore, newId = uuid, initial }: PhotoReviewProps) {
  const uid = useId();
  const [state, setRaw] = useState<PrState>(initial ?? PR_INITIAL);
  const ref = useRef(state);
  const set = (s: PrState) => {
    ref.current = s;
    setRaw(s);
  };
  const latest = useRef({ api, store, newId });
  latest.current = { api, store, newId };
  const ctrl = useRef<ReturnType<typeof createPrController> | null>(null);
  useEffect(() => {
    let client: PrApi | null = null;
    const c = createPrController({ api: () => (client ??= latest.current.api ?? createPrApi()), interventionId, store: () => latest.current.store(), newId: () => latest.current.newId(), context, get: () => ref.current, set });
    ctrl.current = c;
    if (!initial) {
      c.restorePending();
      void c.load();
    }
    return () => {
      c.stop();
      if (ctrl.current === c) ctrl.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [consent, setConsent] = useState(false);
  const v = state.view;
  const locked = state.busy || !!state.pending;
  const itemsByDoc = new Map((v?.items ?? []).map((it) => [it.document_id.toLowerCase(), it]));
  const rows: { doc: PhotoRef; item: PrItem | undefined }[] = photos.map((doc) => ({ doc, item: itemsByDoc.get(doc.id.toLowerCase()) }));
  for (const it of v?.items ?? []) if (!photos.some((d) => d.id.toLowerCase() === it.document_id.toLowerCase())) rows.push({ doc: { id: it.document_id, name: "Photo" }, item: it });
  const requestable = (it: PrItem | undefined) => !!v?.can_request && (!it || it.status === "withdrawn");
  return (
    <section className={styles.panel} aria-labelledby={`${uid}-t`} aria-busy={state.busy || undefined} data-photo-review={state.phase} data-photo-review-role={role}>
      <h3 id={`${uid}-t`} className={styles.title}>{COPY.title}</h3>
      <p className={styles.muted}>{COPY.disclaimer}</p>
      {state.phase === "loading" && <p className={styles.muted} role="status">{COPY.loading}</p>}
      {state.phase === "forbidden" && <p className={styles.note}>{COPY.forbidden}</p>}
      {state.phase === "error" && (
        <div role="alert">
          <p className={styles.error}>{state.error || COPY.loadFailed}</p>
          <button type="button" className={styles.button} onClick={() => void ctrl.current?.load()}>Réessayer</button>
        </div>
      )}
      {state.notice && <p className={styles.note} role="status" data-photo-review-notice="">{state.notice}</p>}
      {state.phase === "ready" && state.error && (
        <div role="alert" data-photo-review-error="">
          <p className={styles.error}>{state.error}</p>
          {state.pending && (
            <button type="button" className={styles.button} disabled={state.busy} onClick={() => void ctrl.current?.retry()} data-photo-review-retry="">
              {state.busy ? "Envoi…" : "Réessayer la même commande"}
            </button>
          )}
        </div>
      )}
      {state.phase === "ready" && v && (
        <>
          {!v.provider_available && <p className={styles.note} data-photo-review-provider-off="">{COPY.providerOff}</p>}
          {rows.length === 0 && <p className={styles.muted} data-photo-review-empty="">{COPY.none}</p>}
          {v.can_request && rows.some((r) => requestable(r.item)) && (
            <label className={styles.check}>
              <input type="checkbox" checked={consent} disabled={locked} onChange={(e) => setConsent(e.target.checked)} data-photo-review-consent="" />
              <span>{COPY.consent}</span>
            </label>
          )}
          <ul className={styles.list}>
            {rows.map(({ doc, item }) => {
              const result = item ? visibleResult(item, role) : null;
              return (
                <li key={doc.id} className={styles.item} data-photo-review-doc={doc.id} data-photo-review-status={item?.status ?? "none"}>
                  <span className={styles.name}>{doc.name}</span>
                  <span className={styles.muted}>{item ? STATUS_LABEL[item.status] : "Aucune revue demandée"}</span>
                  {result && (
                    <span className={styles.result} data-photo-review-result="">
                      {CATEGORY_LABEL[result.category]} · {READABILITY_LABEL[result.readability]}
                    </span>
                  )}
                  {role === "client" && item && item.status !== "validated" && ACTIVE.has(item.status) && <span className={styles.muted}>{COPY.pendingHuman}</span>}
                  <span className={styles.row}>
                    {requestable(item) && (
                      <button type="button" className={`${styles.button} ${styles.primary}`} disabled={locked || !consent} onClick={async () => { if (await ctrl.current?.request(doc.id, consent)) setConsent(false); }} data-photo-review-request={doc.id}>Demander une revue</button>
                    )}
                    {item?.can_withdraw && (
                      <button type="button" className={styles.button} disabled={locked} onClick={() => void ctrl.current?.withdraw(item.id)} data-photo-review-withdraw={item.id}>Retirer la demande</button>
                    )}
                    {item?.can_review && (
                      <>
                        <button type="button" className={`${styles.button} ${styles.primary}`} disabled={locked} onClick={() => void ctrl.current?.review(item.id, "validate")} data-photo-review-validate={item.id}>Valider</button>
                        <button type="button" className={styles.button} disabled={locked} onClick={() => void ctrl.current?.review(item.id, "reject")} data-photo-review-reject={item.id}>Écarter</button>
                      </>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className={styles.muted}>{COPY.manual}</p>
        </>
      )}
    </section>
  );
}
