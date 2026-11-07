"use client";
// ADM-10: corrective dossier of each warranty case (admin-warranty view). Shows the current link
// (or none); super admins see candidate EXISTING dossiers and may link one after an explicit
// confirmation, only while the case is « En cours d’examen ». No price, no payment action.
import { useEffect, useRef, useState } from "react";
import { category, STATUS } from "../../app/format";
import type { Status } from "../../app/types";
import { CASE_INITIAL, CASE_STATUS_LABEL, COPY, canLink, createCaseController, createCorrectiveApi, parseCases, tabStore, type CaseView, type Context, type CorrectiveApi, type Dossier, type Store, type WarrantyCaseRow } from "./model";
import styles from "./warranty-corrective.module.css";

const short = (v: string) => v.slice(0, 8).toUpperCase();
const day = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
const dossierLabel = (d: Dossier) => `${category(d.category).label} · ${STATUS[d.status as Status] ?? d.status} · créé le ${day(d.created_at)}`;

export type WarrantyCorrectivePanelProps = {
  context: Context;
  /** From the server's /me reply; the server enforces it again. */
  superAdmin: boolean;
  /** Opens the admin dossier view (#detail/<id>). */
  onOpenDossier: (interventionId: string) => void;
  demo?: boolean;
  api?: CorrectiveApi;
  store?: () => Store | null;
  /** Tests only. */
  initialCases?: WarrantyCaseRow[] | null;
  initial?: Record<string, CaseView>;
};

export function WarrantyCorrectivePanel(props: WarrantyCorrectivePanelProps) {
  if (props.demo)
    return (
      <section className={styles.panel} data-warranty-corrective="demo">
        <h2 className={styles.title}>{COPY.title}</h2>
        <p className={styles.note}>{COPY.demo}</p>
      </section>
    );
  return <Live key={`${props.context.userId() ?? "-"}|${props.context.generation()}`} {...props} />;
}

function Live({ context, superAdmin, onOpenDossier, api, store = tabStore, initialCases, initial }: WarrantyCorrectivePanelProps) {
  const [cases, setCases] = useState<WarrantyCaseRow[] | null | "error" | undefined>(initialCases === undefined ? undefined : initialCases);
  const latest = useRef({ api });
  latest.current = { api };
  const client = useRef<CorrectiveApi | null>(null);
  const getApi = () => (client.current ??= latest.current.api ?? createCorrectiveApi());
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (initialCases !== undefined && reload === 0) return;
    let active = true;
    const gen = context.generation(), uid = context.userId();
    setCases(undefined);
    void getApi().cases().then((r) => {
      if (!active || context.generation() !== gen || context.userId() !== uid) return;
      setCases(r.status === 200 ? parseCases(r.body) ?? "error" : "error");
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload]);
  return (
    <section className={styles.panel} aria-labelledby="warranty-corrective-title" data-warranty-corrective="live">
      <h2 id="warranty-corrective-title" className={styles.title}>{COPY.title}</h2>
      <p className={styles.muted}>{COPY.noAccessGranted}</p>
      {!superAdmin && <p className={styles.muted} data-corrective-superadmin-only="">{COPY.superAdminOnly}</p>}
      {cases === undefined && <p className={styles.muted} role="status">{COPY.casesLoading}</p>}
      {(cases === "error" || cases === null) && (
        <div role="alert">
          <p className={styles.error}>{COPY.casesFailed}</p>
          <button type="button" className={styles.button} onClick={() => setReload((k) => k + 1)}>Réessayer</button>
        </div>
      )}
      {Array.isArray(cases) && cases.length === 0 && <p className={styles.muted}>{COPY.noCases}</p>}
      {Array.isArray(cases) && cases.length > 0 && (
        <ul className={styles.cases}>
          {cases.map((c) => (
            <li key={c.id}>
              <CaseCorrective kase={c} context={context} superAdmin={superAdmin} onOpenDossier={onOpenDossier} api={getApi} store={store} initial={initial?.[c.id]} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CaseCorrective({ kase, context, superAdmin, onOpenDossier, api, store, initial }: { kase: WarrantyCaseRow; context: Context; superAdmin: boolean; onOpenDossier: (id: string) => void; api: () => CorrectiveApi; store: () => Store | null; initial?: CaseView }) {
  const [view, setRaw] = useState<CaseView>(initial ?? CASE_INITIAL);
  const ref = useRef(view);
  const set = (v: CaseView) => {
    ref.current = v;
    setRaw(v);
  };
  const ctrl = useRef<ReturnType<typeof createCaseController> | null>(null);
  useEffect(() => {
    const c = createCaseController({ api, caseId: kase.id, store, context, get: () => ref.current, set });
    ctrl.current = c;
    if (!initial) {
      c.restorePending();
      void c.load();
    }
    return () => {
      c.detach();
      if (ctrl.current === c) ctrl.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [other, setOther] = useState("");
  const [otherError, setOtherError] = useState("");
  const d = view.data;
  const allowed = canLink(superAdmin, kase.status, view);
  return (
    <article className={styles.case} aria-labelledby={`wc-${kase.id}`} data-corrective-case={kase.id} data-case-status={kase.status}>
      <h3 id={`wc-${kase.id}`} className={styles.caseTitle}>
        Demande {short(kase.id)} · {CASE_STATUS_LABEL[kase.status]}
      </h3>
      {view.phase === "loading" && <p className={styles.muted} role="status">{COPY.loading}</p>}
      {view.phase === "forbidden" && <p className={styles.muted}>{COPY.forbidden}</p>}
      {view.phase === "error" && (
        <div role="alert">
          <p className={styles.error}>{view.error}</p>
          <button type="button" className={styles.button} onClick={() => void ctrl.current?.load()}>Réessayer</button>
        </div>
      )}
      {view.notice && <p className={styles.note} role="status" data-corrective-notice="">{view.notice}</p>}
      {view.error && view.phase === "ready" && (
        <div role="alert" data-corrective-error="">
          <p className={styles.error}>{view.error}</p>
          {view.pending && (
            <button type="button" className={styles.button} disabled={view.busy} onClick={() => void ctrl.current?.retry()} data-corrective-retry="">
              {view.busy ? "Envoi…" : "Réessayer le même rattachement"}
            </button>
          )}
        </div>
      )}
      {d && (
        <>
          {d.link ? (
            <p className={styles.linkRow} data-corrective-link={d.link.id}>
              <span>{COPY.linked} {dossierLabel(d.link)}</span>
              <button type="button" className={styles.button} onClick={() => onOpenDossier(d.link!.id)} data-corrective-open={d.link.id}>Ouvrir le dossier</button>
            </p>
          ) : (
            <p className={styles.muted} data-corrective-none="">{COPY.none}</p>
          )}
          {superAdmin && !d.link && (
            <div className={styles.candidates} data-corrective-candidates="">
              <h4 className={styles.subtitle}>{COPY.candidatesTitle}</h4>
              {kase.status !== "reviewing" && <p className={styles.muted} data-corrective-blocked="">{COPY.notReviewing}</p>}
              {d.candidates.length === 0 && <p className={styles.muted}>{COPY.noCandidates}</p>}
              <ul className={styles.list}>
                {d.candidates.map((c) => (
                  <li key={c.id} className={styles.item} data-corrective-candidate={c.id}>
                    <span>{dossierLabel(c)}</span>
                    <span className={styles.actions}>
                      <button type="button" className={styles.button} onClick={() => onOpenDossier(c.id)}>Ouvrir</button>
                      <button type="button" className={`${styles.button} ${styles.primary}`} disabled={!allowed} onClick={() => setConfirm(c.id)} data-corrective-pick={c.id}>Rattacher…</button>
                    </span>
                  </li>
                ))}
              </ul>
              {d.has_more && <p className={styles.muted} data-corrective-more="">{COPY.more}</p>}
              <form
                className={styles.other}
                noValidate
                onSubmit={(e) => {
                  e.preventDefault();
                  const v = other.trim();
                  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) return setOtherError(COPY.otherInvalid);
                  setOtherError("");
                  setConfirm(v.toLowerCase());
                }}
                data-corrective-other=""
              >
                <label htmlFor={`wc-other-${kase.id}`} className={styles.muted}>{COPY.otherLabel}</label>
                <span className={styles.actions}>
                  <input id={`wc-other-${kase.id}`} className={styles.input} value={other} onChange={(e) => setOther(e.target.value)} disabled={!allowed} aria-invalid={otherError ? true : undefined} />
                  <button type="submit" className={styles.button} disabled={!allowed} data-corrective-other-pick="">Rattacher…</button>
                </span>
                {otherError && <small className={styles.error}>{otherError}</small>}
              </form>
            </div>
          )}
          {confirm && (
            <div className={styles.confirm} role="alertdialog" aria-labelledby={`wc-confirm-${kase.id}`} data-corrective-confirm={confirm}>
              <p id={`wc-confirm-${kase.id}`}>{COPY.confirm(short(confirm), short(kase.id))}</p>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={`${styles.button} ${styles.primary}`}
                  disabled={!allowed}
                  onClick={() => void ctrl.current?.link(superAdmin, kase.status, confirm).then(() => setConfirm(null))}
                  data-corrective-execute=""
                >
                  Confirmer le rattachement
                </button>
                <button type="button" className={styles.button} disabled={view.busy} onClick={() => setConfirm(null)}>Annuler</button>
              </div>
            </div>
          )}
        </>
      )}
    </article>
  );
}
