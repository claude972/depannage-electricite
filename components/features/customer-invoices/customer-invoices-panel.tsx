"use client";
// FIN-05 / ENT-16 customer invoices & credit notes — read-only list + detail of the documents
// issued to the current account (service invoices for clients / organisations, platform
// commission invoices for artisans). PDFs only through /api/invoices/:id/pdf. No issue, refund or
// payment action; a document's state never stands for a payment state.
import { useEffect, useRef, useState } from "react";
import {
  BASIS_LABEL,
  DEFAULT_INVOICES_CONTEXT,
  INVOICES_COPY,
  INVOICES_INITIAL,
  KIND_LABEL,
  createInvoicesApi,
  createInvoicesController,
  filtersKey,
  formatEuros,
  formatRate,
  invoiceLinks,
  type InvoiceFilters,
  type InvoiceKind,
  type InvoiceSummary,
  type InvoicesApi,
  type InvoicesContext,
  type InvoicesState,
} from "./invoices-model";
import styles from "./customer-invoices.module.css";

export type CustomerInvoicesPanelProps = {
  /** Fixed scope given by the parent (organization_id, site_id, intervention_id, basis…). */
  filters: InvoiceFilters;
  api?: InvoicesApi;
  context?: InvoicesContext;
  demo?: boolean;
  title?: string;
  /** Tests only. */
  initial?: InvoicesState;
};
/** Keyed by scope + identity: any filter or account change starts a fresh panel (no cursor reuse). */
export function CustomerInvoicesPanel(props: CustomerInvoicesPanelProps) {
  const uid = (props.context ?? DEFAULT_INVOICES_CONTEXT).userId();
  return <Panel key={`${uid ?? "-"}|${filtersKey(props.filters)}`} {...props} />;
}

const dateFr = (iso: string) => new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(iso));

function Panel({ filters, api, context = DEFAULT_INVOICES_CONTEXT, demo = false, title = "Factures et avoirs", initial }: CustomerInvoicesPanelProps) {
  const [state, setStateRaw] = useState<InvoicesState>(initial ?? INVOICES_INITIAL);
  const ref = useRef(state);
  const set = (next: InvoicesState) => {
    ref.current = next;
    setStateRaw(next);
  };
  const latest = useRef({ api, context });
  latest.current = { api, context };
  const [kind, setKind] = useState<InvoiceKind | null>(filters.kind ?? null);
  const controller = useRef<ReturnType<typeof createInvoicesController> | null>(null);
  if (!controller.current) {
    let client: InvoicesApi | null = null;
    controller.current = createInvoicesController({
      api: () => (client ??= latest.current.api ?? createInvoicesApi()),
      context: { generation: () => latest.current.context.generation(), userId: () => latest.current.context.userId() },
      get: () => ref.current,
      set,
      demo,
    });
  }
  const ctrl = controller.current;
  useEffect(() => {
    ctrl.attach();
    if (!initial) void ctrl.load({ ...filters, kind });
    return () => ctrl.detach();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctrl]);
  const chooseKind = (k: InvoiceKind | null) => {
    setKind(k);
    void ctrl.load({ ...filters, kind: k }); // a filter change always restarts from page 1
  };
  const locked = Boolean(filters.kind);

  return (
    <section className={styles.panel} aria-labelledby="customer-invoices-title" data-invoices-panel={state.phase}>
      <div className={styles.head}>
        <h2 id="customer-invoices-title">{title}</h2>
      </div>
      <p className={styles.hint}>{INVOICES_COPY.notPayment}</p>
      {state.phase === "demo" && <p className={styles.note} data-invoices-demo="">{INVOICES_COPY.demo}</p>}
      {state.phase !== "demo" && !locked && (
        <div className={styles.actions} role="group" aria-label="Type de document">
          {([[null, "Tous"], ["invoice", "Factures"], ["credit_note", "Avoirs"]] as const).map(([k, label]) => (
            <button key={label} type="button" className={styles.secondary} aria-pressed={kind === k} onClick={() => chooseKind(k)} disabled={state.phase === "loading"}>
              {label}
            </button>
          ))}
        </div>
      )}
      {state.phase === "loading" && <p className={styles.hint} role="status">Chargement des factures…</p>}
      {(state.phase === "error" || state.phase === "denied") && (
        <div className={styles.error} role="alert" data-invoices-error={state.phase}>
          {state.error}{" "}
          {state.phase === "error" && <button type="button" className={styles.secondary} onClick={() => void ctrl.load()}>Réessayer</button>}
        </div>
      )}
      {state.phase === "ready" && !state.invoices.length && <p className={styles.hint} data-invoices-empty="">{INVOICES_COPY.empty}</p>}
      {state.phase === "ready" && state.invoices.length > 0 && (
        <>
          <ul className={styles.list}>
            {state.invoices.map((i) => (
              <InvoiceRow key={i.id} invoice={i} open={state.detail?.id === i.id} onToggle={() => (state.detail?.id === i.id ? ctrl.closeDetail() : void ctrl.openDetail(i.id))}>
                {state.detail?.id === i.id && <Detail state={state} onRetry={() => void ctrl.openDetail(i.id)} />}
              </InvoiceRow>
            ))}
          </ul>
          <p className={styles.hint} data-invoices-count="">
            {state.page?.has_more && state.total !== null ? INVOICES_COPY.partial(state.invoices.length, state.total) : INVOICES_COPY.end}
          </p>
          {state.page?.has_more && (
            <button type="button" className={styles.secondary} disabled={state.loadingMore} onClick={() => void ctrl.more()} data-invoices-more="">
              {state.loadingMore ? "Chargement…" : "Afficher plus"}
            </button>
          )}
        </>
      )}
    </section>
  );
}

function PdfLinks({ id }: { id: string }) {
  const l = invoiceLinks(id);
  return (
    <span className={styles.actions}>
      <a className={styles.link} href={l.open} target="_blank" rel="noopener noreferrer" data-invoice-pdf="open">Voir le PDF</a>
      <a className={styles.link} href={l.download} data-invoice-pdf="download">Télécharger</a>
    </span>
  );
}

function InvoiceRow({ invoice: i, open, onToggle, children }: { invoice: InvoiceSummary; open: boolean; onToggle: () => void; children?: React.ReactNode }) {
  return (
    <li className={styles.row} data-invoice-id={i.id} data-invoice-kind={i.kind}>
      <div className={styles.rowHead}>
        <strong>{KIND_LABEL[i.kind]} {i.number}</strong>
        <span>{BASIS_LABEL[i.basis]} · émis le {dateFr(i.issued_at)}</span>
      </div>
      <dl className={styles.kv}>
        <div><dt>Émetteur</dt><dd>{i.issuer_name}</dd></div>
        <div><dt>Destinataire</dt><dd>{i.recipient_name}</dd></div>
        <div><dt>{i.kind === "credit_note" ? "Montant de l’avoir TTC" : "Total TTC"}</dt><dd>{formatEuros(i.total_cents)}</dd></div>
        <div><dt>dont TVA</dt><dd>{formatEuros(i.tax_cents)}</dd></div>
      </dl>
      <div className={styles.actions}>
        <PdfLinks id={i.id} />
        <button type="button" className={styles.secondary} aria-expanded={open} onClick={onToggle} data-invoice-detail="">
          {open ? "Masquer le détail" : "Détail"}
        </button>
      </div>
      {children}
    </li>
  );
}

function Detail({ state, onRetry }: { state: InvoicesState; onRetry: () => void }) {
  const d = state.detail!;
  if (d.phase === "loading") return <p className={styles.hint} role="status">Chargement du document…</p>;
  if (d.phase !== "ready" || !d.data)
    return (
      <div className={styles.error} role="alert" data-invoice-detail-error={d.phase}>
        {d.error}{" "}
        {d.phase === "error" && <button type="button" className={styles.secondary} onClick={onRetry}>Réessayer</button>}
      </div>
    );
  const { invoice: i, related_invoice, credit_notes, credit_notes_page, version } = d.data;
  return (
    <div className={styles.confirm} data-invoice-detail-ready="">
      <table className={styles.table}>
        <caption className={styles.hint}>Lignes du document</caption>
        <thead><tr><th>Libellé</th><th className={styles.num}>Qté</th><th className={styles.num}>Prix unitaire HT</th></tr></thead>
        <tbody>{i.lines.map((l, n) => <tr key={n}><td>{l.label}</td><td className={styles.num}>{l.quantity}</td><td className={styles.num}>{formatEuros(l.unit_price_cents)}</td></tr>)}</tbody>
      </table>
      <dl className={styles.kv}>
        <div><dt>Total HT</dt><dd>{formatEuros(i.subtotal_cents)}</dd></div>
        <div><dt>TVA ({formatRate(i.tax_rate)})</dt><dd>{formatEuros(i.tax_cents)}</dd></div>
        <div><dt>Total TTC</dt><dd>{formatEuros(i.total_cents)}</dd></div>
      </dl>
      {i.reason && <p className={styles.hint}>Motif : {i.reason}</p>}
      {related_invoice && <p className={styles.hint} data-invoice-related="">Avoir sur la facture {related_invoice.number} ({formatEuros(related_invoice.total_cents)} TTC). <PdfLinks id={related_invoice.id} /></p>}
      {credit_notes.length > 0 && (
        <div data-invoice-credit-notes="">
          <strong>Avoirs émis sur cette facture</strong>
          <ul className={styles.list}>
            {credit_notes.map((n) => (
              <li key={n.id}>{n.number} · {formatEuros(n.total_cents)} TTC · émis le {dateFr(n.issued_at)} <PdfLinks id={n.id} /></li>
            ))}
          </ul>
          {!credit_notes_page.complete && <p className={styles.hint}>{INVOICES_COPY.creditNotesPartial(credit_notes.length, credit_notes_page.total)}</p>}
        </div>
      )}
      <p className={styles.hint}>{INVOICES_COPY.version} <span className={styles.mono}>{version.sha256}</span></p>
    </div>
  );
}
