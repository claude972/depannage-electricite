"use client";
// ENT-11 panel: one atomic page at a time (own captured_at), honest scope, no cross-page sums.
import { useEffect, useRef, useState } from "react";
import {
  createOrgSlaApi,
  reasonText,
  siteFigures,
  summaryScope,
  viewFromResult,
  type OrgSlaApi,
  type SlaView,
} from "./organization-sla-model";
import styles from "./organization-sla.module.css";

type Props = {
  organizationId: string;
  context: { generation(): number; userId(): string | null };
  api?: OrgSlaApi;
  /** Tests only. */
  initial?: SlaView;
};

const dateTime = (iso: string) => new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });

export function OrganizationSlaPanel({ organizationId, context, api, initial }: Props) {
  const [view, setView] = useState<SlaView>(initial ?? { phase: "loading" });
  const seq = useRef(0);
  const client = useRef<OrgSlaApi>(api ?? createOrgSlaApi());
  const ctx = useRef(context);
  ctx.current = context;

  const load = async (cursor: string | null, pageIndex: number) => {
    const my = ++seq.current;
    const gen = ctx.current.generation(), uid = ctx.current.userId();
    setView({ phase: "loading" });
    const r = await client.current.get(organizationId, cursor);
    if (my !== seq.current || ctx.current.generation() !== gen || ctx.current.userId() !== uid) return;
    setView(viewFromResult(r, organizationId, cursor, pageIndex));
  };
  const lastRequest = useRef<{ cursor: string | null; pageIndex: number }>({ cursor: null, pageIndex: 0 });
  const go = (cursor: string | null, pageIndex: number) => {
    lastRequest.current = { cursor, pageIndex };
    void load(cursor, pageIndex);
  };

  useEffect(() => {
    if (initial) return;
    go(null, 0);
    return () => {
      seq.current++; // any reply after unmount / organisation change is dropped
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  return (
    <section className="panel" aria-labelledby="org-sla" data-org-sla={view.phase} aria-busy={view.phase === "loading" || undefined}>
      <h2 id="org-sla">Respect des SLA (consolidé)</h2>
      {view.phase === "loading" && <p className={styles.muted}>Chargement du rapport SLA…</p>}
      {view.phase === "error" && (
        <>
          <p role="alert">{view.text}</p>
          {view.retry && (
            <div className={styles.actions}>
              <button type="button" className="button outline" onClick={() => (view.restart ? go(null, 0) : go(lastRequest.current.cursor, lastRequest.current.pageIndex))}>
                Réessayer
              </button>
            </div>
          )}
        </>
      )}
      {view.phase === "ready" && <Report view={view} onNext={(c) => go(c, view.pageIndex + 1)} onFirst={() => go(null, 0)} />}
    </section>
  );
}

function Report({ view, onNext, onFirst }: { view: Extract<SlaView, { phase: "ready" }>; onNext: (cursor: string) => void; onFirst: () => void }) {
  const r = view.report;
  const s = r.summary;
  if (!r.sites.length)
    return <p className={styles.muted}>{r.scope.visible_sites_total ? "Aucun site sur cette page." : "Aucun site visible avec vos droits dans cette organisation."}</p>;
  return (
    <>
      <p className={styles.scope} data-org-sla-scope={r.complete_for_organization ? "organization" : r.complete_for_visible_scope ? "visible" : "page"}>
        {summaryScope(r)}
      </p>
      <p className={styles.muted}>
        Instantané du {dateTime(r.captured_at)} · page {view.pageIndex + 1}. Chaque page est un instantané distinct : les chiffres de pages différentes ne s’additionnent pas.
      </p>
      <div className={styles.summary}>
        <Figure n={s.breached} label="cas en dépassement" />
        <Figure n={s.pending} label="cas en cours (délai non échu)" />
        <Figure n={s.met} label="cas respectés (réponse et résolution)" />
        <Figure n={s.indeterminate} label="cas indéterminés" />
        <Figure n={s.not_measurable} label="cas non mesurables" />
        <Figure n={s.unavailable} label="cas sans politique ou calendrier chargé" />
      </div>
      <p className={styles.muted}>
        {s.cases_evaluated} cas évalués sur {s.cases_returned} transmis. {s.partially_measurable > 0 ? `${s.partially_measurable} cas ne sont mesurables que sur un seul délai.` : ""}
      </p>
      {r.reasons.length > 0 && (
        <ul className={styles.reasons} data-org-sla-reasons="">
          {r.reasons.map((reason) => (
            <li key={reason}>{reasonText(reason)}</li>
          ))}
        </ul>
      )}
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Site</th>
            <th>Cas évalués</th>
            <th>Dépassés</th>
            <th>En cours</th>
            <th>Respectés</th>
            <th>Autres</th>
          </tr>
        </thead>
        <tbody>
          {r.sites.map((site) => {
            const f = siteFigures(site);
            return (
              <tr key={site.id} data-org-sla-site={site.id}>
                <td data-label="Site">
                  {site.name}
                  {!site.complete && <small className={styles.muted}> · incomplet : {site.reasons.map(reasonText).join(" ; ")}</small>}
                </td>
                <td data-label="Cas évalués">
                  {f.evaluated} / {site.cases_total}
                  {f.notReturned > 0 && <small className={styles.muted}> ({f.notReturned} plus anciens non transmis)</small>}
                </td>
                <td data-label="Dépassés">{f.breached}</td>
                <td data-label="En cours">{f.pending}</td>
                <td data-label="Respectés">{f.met}</td>
                <td data-label="Autres">{f.other + f.unavailable}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className={styles.muted}>Aucune conformité contractuelle ou réglementaire n’est attestée ici : il s’agit des délais enregistrés et évalués par l’application.</p>
      <div className={styles.actions}>
        {r.page.has_more && r.page.next_cursor && (
          <button type="button" className="button outline" onClick={() => onNext(r.page.next_cursor!)}>
            Sites suivants ({r.page.remaining_sites_total - r.page.returned_sites} restants)
          </button>
        )}
        {view.pageIndex > 0 && (
          <button type="button" className="button outline" onClick={onFirst}>
            Revenir à la première page
          </button>
        )}
      </div>
    </>
  );
}

function Figure({ n, label }: { n: number; label: string }) {
  return (
    <div className={styles.figure}>
      <strong>{n}</strong>
      <span>{label}</span>
    </div>
  );
}
