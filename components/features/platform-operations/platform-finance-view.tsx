"use client";
// Prepared finance (contract A1/A2): ledger, reconciliation, invoices/credit notes, refund requests, disputes, settings.
// No control here moves money; "approuvée" never means "remboursée".
import { useCallback, useState, type ReactNode } from "react";
import type { ContractState, Dispute, DisputeOutcome, FinanceConfig, FinanceReport, Invoice, InvoiceReadiness, LedgerEntry, Page, PlatformAccess, PlatformClient, PlatformViewScope, RefundRequest } from "../../../lib/features/platform-operations/types";
import { COMMISSION_NOT_CONFIGURED, REFUND_EXECUTION_MESSAGE } from "../../../lib/features/platform-operations/config";
import { EMPTY_READINESS, UUID_RE, disputeActions, readinessFingerprint, readinessReduce, refundActions, refundStatusLabel, validateAmountCents, validateDisputeDecision, validateRefundDecision, validateText, type ReadinessTarget } from "../../../lib/features/platform-operations/state-machines";
import type { PlatformDemo } from "../../../lib/features/platform-operations/demo";
import { invoiceDocumentLinks } from "../../../lib/features/platform-operations/invoice-links";
import { EmptyState, ErrorBox, Field, Gate, Loading, Pager, Panel, ReadOnly, dateTime, errorText, money, newRequestId, scopeKey, shortId, useLoad } from "./shared";
import styles from "./platform-operations.module.css";

export type PlatformFinanceViewProps = { state: ContractState; unavailableMessage: string; scope: PlatformViewScope; client: PlatformClient; demo?: PlatformDemo; onNavigate?: (view: string, param?: string) => void };
type Tab = "overview" | "ledger" | "invoices" | "refunds" | "disputes" | "settings";
const TABS: { id: Tab; label: string }[] = [{ id: "overview", label: "Rapprochement" }, { id: "ledger", label: "Ledger" }, { id: "invoices", label: "Factures et avoirs" }, { id: "refunds", label: "Remboursements" }, { id: "disputes", label: "Litiges" }, { id: "settings", label: "Paramètres" }];
const DEMO_NOTE = "Mode démonstration : aucune action n’est envoyée.";
const KIND_LABEL: Record<LedgerEntry["entry_kind"], string> = { payment_settled: "Règlement enregistré", commission_estimated: "Commission estimée (non prélevée)", commission_withheld: "Commission prélevée (confirmée)", refund_settled: "Remboursement confirmé" };
const MISSING_LABEL: Record<string, string> = { billing_contact: "coordonnées de facturation manquantes", payment_not_settled: "paiement non confirmé", quote_not_accepted: "devis non accepté", already_issued: "facture déjà émise pour ce paiement", artisan_company_name: "raison sociale de l’artisan manquante", artisan_siret: "SIRET de l’artisan manquant", artisan_legal_status: "forme juridique de l’artisan manquante", artisan_address: "adresse de l’artisan manquante", artisan_identity: "identité légale de l’artisan incomplète", platform_issuer: "émetteur plateforme non configuré", platform_commission_vat_rate: "taux de TVA de commission non configuré", commission_not_confirmed: "commission non confirmée par le fournisseur de paiement", payment_total_mismatch: "montant du règlement incohérent avec le devis", amendment_snapshot_mismatch: "versions des avenants à vérifier", invoice_mixed_tax_rates: "plusieurs taux de TVA : une facture adaptée est nécessaire", invoice_lines_limit: "trop de lignes pour ce document", invoice_tax_rounding_mismatch: "arrondi de TVA à vérifier", amendment_invalid: "avenant non exploitable" };
/** Unknown readiness code: still a BLOCKING condition, never shown raw. */
const MISSING_FALLBACK = "condition bloquante non détaillée : vérifiez le dossier avant toute émission";

// ---- F2: preview amounts are shown only when the server gave them as safe integers ----------------
export const PREVIEW_UNAVAILABLE = "Montants de l’aperçu indisponibles : vérifiez à nouveau.";
export type PreviewAmounts = { total_cents: number; tax_cents: number; subtotal_cents: number };
const safeCents = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
/** null ⇒ blocking: never a substituted 0, never an « Émettre » button. */
export function previewAmounts(preview: InvoiceReadiness["preview"] | null | undefined): PreviewAmounts | null {
  if (!preview) return null;
  const { total_cents, tax_cents, subtotal_cents } = preview;
  if (!(safeCents(total_cents) && safeCents(tax_cents) && safeCents(subtotal_cents) && total_cents > 0)) return null;
  // HT + TVA must equal TTC exactly (and the sum stay a safe integer): an inconsistent preview blocks.
  const sum = subtotal_cents + tax_cents;
  return Number.isSafeInteger(sum) && sum === total_cents ? { total_cents, tax_cents, subtotal_cents } : null;
}

// ---- F3: explicit confirmation with a FROZEN payload ---------------------------------------------
/** A confirmation holds a cloned, recursively frozen copy of the payload taken when it opened; any input change
 *  cancels it (re-confirmation required). The request_id inside is the form's current one, so a
 *  retry after a failure reuses it (a new one is generated only after success, as before). */
export type Confirmation<P> = { payload: Readonly<P>; summary: string[] } | null;
export function openConfirmation<P extends object>(payload: P, summary: string[]): Confirmation<P> {
  return { payload: deepFreeze(structuredCloneSafe(payload)), summary: [...summary] };
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  }
  return value;
}
function structuredCloneSafe<P>(value: P): P {
  return JSON.parse(JSON.stringify(value)) as P;
}
export function ConfirmBox({ title, summary, confirmLabel, busy, onConfirm, onCancel }: { title: string; summary: string[]; confirmLabel: string; busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className={styles.card} role="alertdialog" aria-label={title} data-finance-confirm="">
      <strong>{title}</strong>
      <ul className={styles.list}>{summary.map((line) => <li key={line}>{line}</li>)}</ul>
      <div className={styles.actions}>
        <button type="button" className={`${styles.button} ${styles.primary}`} disabled={busy} onClick={onConfirm} data-finance-confirm-ok="">{confirmLabel}</button>
        <button type="button" className={styles.button} disabled={busy} onClick={onCancel}>Annuler</button>
      </div>
    </div>
  );
}

// ---- F4: ledger basis — allowlisted business keys only, provider ids never shown ----------------
const SOURCE_LABEL: Record<string, string> = { payments: "règlement enregistré", provider_event: "événement fournisseur confirmé" };
const RATE_SOURCE_LABEL: Record<string, string> = { platform_setting: "paramètre plateforme" };
const BASIS_LABELS: Record<string, { label: string; format: (v: unknown) => string | null }> = {
  // Own-property lookups only: inherited names (« __proto__ », « constructor »…) are never labels.
  source: { label: "Origine", format: (v) => (typeof v === "string" && Object.prototype.hasOwnProperty.call(SOURCE_LABEL, v) && SOURCE_LABEL[v]) || null },
  paid_at: { label: "Réglé le", format: (v) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? dateTime(v) : null) },
  quote_id: { label: "Devis", format: (v) => (typeof v === "string" && UUID_RE.test(v) ? shortId(v) : null) },
  rate_source: { label: "Origine du taux", format: (v) => (typeof v === "string" && Object.prototype.hasOwnProperty.call(RATE_SOURCE_LABEL, v) && RATE_SOURCE_LABEL[v]) || null },
  bps: { label: "Taux", format: (v) => (typeof v === "number" && Number.isSafeInteger(v) ? `${(v / 100).toFixed(2)} %` : null) },
  setting_version: { label: "Version du paramètre", format: (v) => (typeof v === "number" && Number.isSafeInteger(v) ? String(v) : null) },
  gross_cents: { label: "Montant de base", format: (v) => (safeCents(v) ? money(v) : null) },
  amount_cents: { label: "Montant", format: (v) => (safeCents(v) ? money(v) : null) },
  tax_included: { label: "TVA incluse", format: (v) => (typeof v === "boolean" ? (v ? "oui" : "non") : null) },
  version: { label: "Version", format: (v) => (typeof v === "number" && Number.isSafeInteger(v) ? String(v) : null) },
  refund_request_id: { label: "Demande de remboursement", format: (v) => (typeof v === "string" && UUID_RE.test(v) ? shortId(v) : null) },
};
/** Known keys with French labels; every other key (provider references, event/session ids…) is
 *  only counted, never rendered. */
export function ledgerBasisRows(basis: Record<string, unknown> | null | undefined): { rows: { label: string; value: string }[]; hidden: number } {
  const rows: { label: string; value: string }[] = [];
  let hidden = 0;
  for (const [key, value] of Object.entries(basis ?? {})) {
    const known = Object.prototype.hasOwnProperty.call(BASIS_LABELS, key) ? BASIS_LABELS[key] : null;
    const shown = known ? known.format(value) : null;
    if (known && shown !== null) rows.push({ label: known.label, value: shown });
    else hidden++;
  }
  return { rows, hidden };
}
export function LedgerBasis({ basis }: { basis: Record<string, unknown> | null | undefined }) {
  const { rows, hidden } = ledgerBasisRows(basis);
  return (
    <>
      {rows.map((r) => <span key={r.label}>{r.label} : {r.value}</span>)}
      {hidden > 0 && <span className={styles.hint}>{hidden === 1 ? "1 autre détail non affiché" : `${hidden} autres détails non affichés`}</span>}
    </>
  );
}

type Ctx = { client: PlatformClient; demo?: PlatformDemo; canWrite: boolean; superAdmin: boolean; notify: (m: { kind: "ok" | "error"; text: string } | null) => void; busy: boolean; act: (work: () => Promise<unknown | null>, done: string, after?: () => void) => Promise<void>; scopeKey: string; rendering: boolean };

export function PlatformFinanceView(props: PlatformFinanceViewProps) {
  return <Gate state={props.state} unavailableMessage={props.unavailableMessage} title="Finance plateforme"><Inner key={scopeKey(props.scope)} {...props} /></Gate>;
}
function Inner({ scope, client, demo }: PlatformFinanceViewProps) {
  const [tab, setTab] = useState<Tab>("overview");
  const me = useLoad<PlatformAccess>(() => (demo ? Promise.resolve(demo.access) : client.load.me()), [demo]);
  const [message, notify] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const act = useCallback(async (work: () => Promise<unknown | null>, done: string, after?: () => void) => {
    if (busy) return;
    if (demo) { notify({ kind: "error", text: DEMO_NOTE }); return; }
    setBusy(true); notify(null);
    try { const result = await work(); if (result !== null) { notify({ kind: "ok", text: done }); after?.(); } }
    catch (e) { notify({ kind: "error", text: errorText(e) }); } finally { setBusy(false); }
  }, [busy, demo]);
  if (me.loading && !me.data) return <Loading label="Chargement des droits…" />;
  if (me.error && !me.data) return <ErrorBox message={me.error} onRetry={me.reload} />;
  if (!me.data?.capabilities.finance) return <div className="forbidden"><strong>Cet espace nécessite le scope finance.</strong><p>Demandez l’habilitation à un super administrateur.</p></div>;
  const ctx: Ctx = { client, demo, canWrite: scope.authority.canWrite && !demo && (me.data.super_admin || me.data.scopes.includes("finance_write")), superAdmin: !demo && scope.authority.canWrite && me.data.super_admin, notify, busy, act, scopeKey: scopeKey(scope), rendering: me.data.capabilities.invoice_rendering === true };
  return (
    <div className={styles.view} data-module="platform-operations" data-platform-view="finance">
      <div className={styles.head}><div><h2>Finance plateforme</h2><p>Ledger en centimes, rapprochement avec les paiements confirmés et suivi documentaire. Aucune action réelle auprès du fournisseur de paiement n’est disponible dans cette version.</p></div></div>
      {!scope.authority.canWrite && <ReadOnly reason={scope.authority.reason} />}
      {scope.authority.canWrite && !ctx.canWrite && !demo && <ReadOnly reason="votre scope finance est en lecture seule." />}
      {demo && <p className={styles.alert}>{DEMO_NOTE}</p>}
      <ConfigNotices config={me.data.config} />
      <div className={styles.tabs} role="tablist" aria-label="Sections finance">{TABS.filter((t) => t.id !== "settings" || me.data?.super_admin).map((t) => <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={styles.tab} onClick={() => { setTab(t.id); notify(null); }}>{t.label}</button>)}</div>
      {message && <p className={message.kind === "ok" ? styles.success : styles.error} role={message.kind === "ok" ? "status" : "alert"}>{message.text}</p>}
      {tab === "overview" && <Overview ctx={ctx} />}
      {tab === "ledger" && <Ledger ctx={ctx} />}
      {tab === "invoices" && <Invoices ctx={ctx} />}
      {tab === "refunds" && <Refunds ctx={ctx} />}
      {tab === "disputes" && <Disputes ctx={ctx} />}
      {tab === "settings" && me.data.super_admin && <Settings ctx={ctx} onSaved={me.reload} />}
    </div>
  );
}
function ConfigNotices({ config }: { config: FinanceConfig }) {
  return (
    <div className={styles.strip}>
      <Stat label="Fournisseur de paiement" value={config.payment_provider.configured ? (config.payment_provider.mode === "live" ? (config.payment_provider.live_enabled ? "Réel activé" : "Réel non activé") : "Mode test") : "Non configuré"} note="Remboursements et commissions réelles indisponibles sans événement fournisseur confirmé." />
      <Stat label="Taux de commission (paramètre)" value={config.commission.setting_bps === null ? "Non configuré" : `${(config.commission.setting_bps / 100).toFixed(2)} %`} note={config.commission.aligned === false ? "Écart avec le taux du paiement en ligne : à vérifier." : config.commission.aligned === null ? COMMISSION_NOT_CONFIGURED : "Aligné avec le paiement en ligne."} />
      <Stat label="Émetteur plateforme" value={config.invoice_issuer.configured ? "Configuré" : "Non configuré"} note="Requis pour toute facture de commission." />
    </div>
  );
}
function Stat({ label, value, note }: { label: string; value: ReactNode; note?: string }) { return <dl className={styles.stat}><dt>{label}</dt><dd>{value}{note && <><br /><small>{note}</small></>}</dd></dl>; }
function Message({ children }: { children: ReactNode }) { return <p className={styles.hint}>{children}</p>; }
function useList<T>(ctx: Ctx, load: (cursor: string | null) => Promise<T | null>, demoValue: T, deps: unknown[]) {
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const cursor = cursors[cursors.length - 1] ?? null;
  const list = useLoad<T>(() => (ctx.demo ? Promise.resolve(demoValue) : load(cursor)), [ctx.demo, cursor, ...deps]);
  return { ...list, cursors, cursor, pager: (page: Page) => <Pager page={page} canPrev={cursors.length > 1} onPrev={() => setCursors((c) => c.slice(0, -1))} onNext={() => page.next_cursor && setCursors((c) => [...c, page.next_cursor])} />, resetCursor: () => setCursors([null]) };
}
const demoPage = (total: number): Page => ({ limit: 25, total, has_more: false, next_cursor: null });

// ---- Overview ----------------------------------------------------------------------------
function Overview({ ctx }: { ctx: Ctx }) {
  const data = useLoad<{ report: FinanceReport; config: FinanceConfig }>(() => (ctx.demo ? Promise.resolve({ report: ctx.demo.report, config: ctx.demo.access.config }) : ctx.client.load.finance()), [ctx.demo]);
  if (data.loading && !data.data) return <Loading label="Calcul du rapport…" />;
  if (data.error && !data.data) return <ErrorBox message={data.error} onRetry={data.reload} />;
  if (!data.data) return null;
  const r = data.data.report;
  return (
    <>
      <Panel title="Paiements et ledger" intro={`Comptes exacts au ${dateTime(r.generated_at)}. Les montants sont TTC, en euros.`}
        action={ctx.canWrite && <button type="button" className={`${styles.button} ${styles.primary}`} disabled={ctx.busy} onClick={() => ctx.act(() => ctx.client.command.reconcile({ limit: 200 }), "Rapprochement exécuté ; le taux appliqué est le paramètre serveur. Les déclarations sur place restent des déclarations, pas des preuves bancaires.", data.reload)}>Rapprocher les règlements</button>}>
        <div className={styles.strip}>
          <Stat label="Paiements réglés" value={`${r.payments.paid_count} · ${money(r.payments.paid_cents)}`} note={`Inclut les règlements déclarés reçus sur place par l’artisan (pas une preuve bancaire). En attente : ${r.payments.pending_count} · échoués : ${r.payments.failed_count} · tentatives échouées : ${r.payments.failed_attempts}`} />
          <Stat label="Règlements au registre" value={`${r.ledger.settled_count} · ${money(r.ledger.settled_cents)}`} note={r.ledger.missing_settlement ? `${r.ledger.missing_settlement} règlement(s) sans écriture : lancez le rapprochement.` : "Tous les règlements sont inscrits. Le registre peut inclure des déclarations sur place, qui ne sont pas une preuve bancaire."} />
          <Stat label="Écarts de montant" value={String(r.ledger.amount_mismatches)} note="Écritures dont le montant ou la devise diffère du paiement." />
          <Stat label="Commission estimée (non prélevée)" value={`${r.ledger.commission_estimated_count} · ${money(r.ledger.commission_estimated_cents)}`} note={r.commission_setting ? `Au taux ${(r.commission_setting.bps / 100).toFixed(2)} % (version ${r.commission_setting.version}).` : COMMISSION_NOT_CONFIGURED} />
          <Stat label="Commission prélevée (confirmée)" value={`${r.ledger.commission_withheld_count} · ${money(r.ledger.commission_withheld_cents)}`} note="Connue uniquement par événement fournisseur confirmé." />
          <Stat label="Remboursements confirmés" value={`${r.ledger.refund_settled_count} · ${money(r.ledger.refund_settled_cents)}`} />
        </div>
      </Panel>
      <Panel title="Demandes, litiges et documents">
        <div className={styles.strip}>
          {Object.entries(r.refund_requests).map(([status, v]) => <Stat key={status} label={refundStatusLabel(status as RefundRequest["status"])} value={`${v.count} · ${money(v.cents)}`} />)}
          {!Object.keys(r.refund_requests).length && <Stat label="Demandes de remboursement" value="0" />}
          {Object.entries(r.disputes).map(([status, c]) => <Stat key={status} label={`Litiges ${DISPUTE_LABEL[status as Dispute["status"]] ?? status}`} value={String(c)} />)}
          <Stat label="Factures / avoirs" value={`${r.invoices.invoice_count} / ${r.invoices.credit_note_count}`} />
        </div>
      </Panel>
    </>
  );
}
const DISPUTE_LABEL: Record<Dispute["status"], string> = { open: "ouverts", under_review: "en examen", resolved: "résolus", closed: "clos" };

// ---- Ledger ------------------------------------------------------------------------------
function Ledger({ ctx }: { ctx: Ctx }) {
  const [kind, setKind] = useState("");
  const list = useList(ctx, (cursor) => ctx.client.load.ledger({ entry_kind: kind || null, cursor, limit: 25 }), { entries: ctx.demo?.ledger ?? [], page: demoPage(ctx.demo?.ledger.length ?? 0) }, [kind]);
  return (
    <Panel title="Écritures" intro="Chaque écriture est immuable et porte sa base de calcul." action={<div className={styles.toolbar}><label>Nature<select value={kind} onChange={(e) => { setKind(e.target.value); list.resetCursor(); }}><option value="">Toutes</option>{Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label></div>}>
      {list.loading && !list.data ? <Loading /> : list.error && !list.data ? <ErrorBox message={list.error} onRetry={list.reload} /> : !list.data?.entries.length ? <EmptyState title="Aucune écriture">Le rapprochement inscrit les paiements confirmés ; les commissions prélevées et remboursements n’apparaissent qu’après confirmation du fournisseur.</EmptyState> : (
        <div className={styles.tableWrap}><table className={styles.table}><caption className={styles.srOnly}>Écritures du ledger</caption>
          <thead><tr><th>Date</th><th>Nature</th><th>Paiement</th><th className={styles.num}>Montant</th><th>Base</th></tr></thead>
          <tbody>{list.data.entries.map((e) => <tr key={e.id}><td>{dateTime(e.created_at)}</td><td>{KIND_LABEL[e.entry_kind]}</td><td className={styles.mono}>{shortId(e.payment_id)}</td><td className={styles.num}>{e.direction === "debit" ? "−" : "+"}{money(e.amount_cents, e.currency)}</td><td className={styles.details}><LedgerBasis basis={e.basis} /></td></tr>)}</tbody></table></div>
      )}
      {list.data && list.pager(list.data.page)}
    </Panel>
  );
}

// ---- Invoices ------------------------------------------------------------------------------
function DocumentLinks({ ctx, invoiceId }: { ctx: Ctx; invoiceId: string }) {
  const links = invoiceDocumentLinks({ invoiceId, rendering: ctx.rendering, demo: Boolean(ctx.demo) });
  if (links.state === "unavailable") return <span className={styles.hint}>{links.note}</span>;
  if (links.state === "demo") return <span className={styles.actions}><span role="link" aria-disabled="true" className={styles.disabledLink}>Ouvrir le PDF</span><span role="link" aria-disabled="true" className={styles.disabledLink}>Télécharger</span><span className={styles.hint}>{links.note}</span></span>;
  return <span className={styles.actions}><a className={styles.link} href={links.open} target="_blank" rel="noopener">Ouvrir le PDF</a><a className={styles.link} href={links.download}>Télécharger</a></span>;
}
function InvoiceDetail({ ctx, id, onClose }: { ctx: Ctx; id: string; onClose: () => void }) {
  const detail = useLoad(() => (ctx.demo ? Promise.resolve({ invoice: ctx.demo.invoices.find((i) => i.id === id) as Invoice, credit_notes: [] as Invoice[], document: null }) : ctx.client.load.invoice(id)), [ctx.demo, id]);
  return (
    <Panel title="Détail du document" action={<button type="button" className={styles.button} onClick={onClose}>Fermer</button>}>
      {detail.loading && !detail.data ? <Loading /> : detail.error && !detail.data ? <ErrorBox message={detail.error} onRetry={detail.reload} /> : !detail.data?.invoice ? <EmptyState title="Document introuvable" /> : (
        <>
          <dl className={styles.kv}>
            <dt>Numéro</dt><dd className={styles.mono}>{detail.data.invoice.number}</dd>
            <dt>Type</dt><dd>{detail.data.invoice.kind === "invoice" ? "Facture" : "Avoir"} · {detail.data.invoice.basis === "service" ? "prestation" : "commission"} · émis le {dateTime(detail.data.invoice.issued_at)}</dd>
            <dt>Émetteur</dt><dd>{detail.data.invoice.issuer.legal_name}{detail.data.invoice.issuer.siret && ` · SIRET ${detail.data.invoice.issuer.siret}`}<br />{detail.data.invoice.issuer.address}</dd>
            <dt>Destinataire</dt><dd>{detail.data.invoice.recipient.name ?? detail.data.invoice.recipient.legal_name}<br />{detail.data.invoice.recipient.address}</dd>
            <dt>Montants</dt><dd>HT {money(detail.data.invoice.subtotal_cents)} · TVA {money(detail.data.invoice.tax_cents)} ({Number(detail.data.invoice.tax_rate)} %) · TTC {money(detail.data.invoice.total_cents)}</dd>
            {detail.data.invoice.reason && <><dt>Motif</dt><dd>{detail.data.invoice.reason}</dd></>}
            <dt>Document</dt><dd><DocumentLinks ctx={ctx} invoiceId={detail.data.invoice.id} /></dd>
          </dl>
          <div className={styles.tableWrap}><table className={styles.table}><caption className={styles.srOnly}>Lignes du document</caption><thead><tr><th>Libellé</th><th className={styles.num}>Qté</th><th className={styles.num}>PU HT</th></tr></thead><tbody>{detail.data.invoice.lines.map((l, i) => <tr key={i}><td>{l.label}</td><td className={styles.num}>{l.quantity}</td><td className={styles.num}>{money(l.unit_price_cents)}</td></tr>)}</tbody></table></div>
          {detail.data.credit_notes.length > 0 && <ul className={styles.list}>{detail.data.credit_notes.map((n) => <li key={n.id} className={styles.card}><div className={styles.panelHead}><span>Avoir <span className={styles.mono}>{n.number}</span> · {money(n.total_cents)} · {dateTime(n.issued_at)}</span><DocumentLinks ctx={ctx} invoiceId={n.id} /></div>{n.reason && <span className={styles.hint}>{n.reason}</span>}</li>)}</ul>}
        </>
      )}
    </Panel>
  );
}
function Invoices({ ctx }: { ctx: Ctx }) {
  const list = useList(ctx, (cursor) => ctx.client.load.invoices({ cursor, limit: 25 }), { invoices: ctx.demo?.invoices ?? [], page: demoPage(ctx.demo?.invoices.length ?? 0) }, []);
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <>
      <Panel title="Registre" intro="Documents émis uniquement à partir d’un émetteur réel, d’un paiement confirmé et de coordonnées de facturation renseignées. Un document ne se supprime pas : il se corrige par avoir.">
        {list.loading && !list.data ? <Loading /> : list.error && !list.data ? <ErrorBox message={list.error} onRetry={list.reload} /> : !list.data?.invoices.length ? <EmptyState title="Aucun document">Vérifiez d’abord les conditions d’émission pour un paiement confirmé.</EmptyState> : (
          <div className={styles.tableWrap}><table className={styles.table}><caption className={styles.srOnly}>Factures et avoirs</caption>
            <thead><tr><th>Numéro</th><th>Type</th><th>Émetteur</th><th>Destinataire</th><th className={styles.num}>HT</th><th className={styles.num}>TVA</th><th className={styles.num}>TTC</th><th>Émis</th><th>Document</th></tr></thead>
            <tbody>{list.data.invoices.map((i) => <tr key={i.id}><td className={styles.mono}><button type="button" className="text-button" onClick={() => setSelected(i.id)}>{i.number}</button>{i.related_invoice_id && <div>sur {shortId(i.related_invoice_id)}</div>}</td><td>{i.kind === "invoice" ? "Facture" : "Avoir"} · {i.basis === "service" ? "prestation" : "commission"}</td><td>{i.issuer.legal_name}</td><td>{i.recipient.name ?? i.recipient.legal_name}</td><td className={styles.num}>{money(i.subtotal_cents)}</td><td className={styles.num}>{money(i.tax_cents)} ({Number(i.tax_rate)} %)</td><td className={styles.num}>{money(i.total_cents)}</td><td>{dateTime(i.issued_at)}</td><td><DocumentLinks ctx={ctx} invoiceId={i.id} /></td></tr>)}</tbody></table></div>
        )}
        {list.data && list.pager(list.data.page)}
      </Panel>
      {selected && <InvoiceDetail key={selected} ctx={ctx} id={selected} onClose={() => setSelected(null)} />}
      {ctx.canWrite && <IssueForm ctx={ctx} onIssued={list.reload} />}
      {ctx.canWrite && <CreditNoteForm ctx={ctx} onIssued={list.reload} />}
      {ctx.canWrite && <BillingContactForm ctx={ctx} />}
      <Message>{ctx.rendering ? "Les PDF sont rendus à partir de l’instantané immuable du registre ; chaque lien est privé et réservé au scope finance." : "Rendu PDF non disponible sur ce service ; ce registre expose les données exactes du document."}</Message>
    </>
  );
}
const BASIS_LABEL = { service: "Prestation (émetteur : artisan)", platform_commission: "Commission (émetteur : plateforme)" } as const;
export function issueSummary(basis: keyof typeof BASIS_LABEL, paymentId: string, a: PreviewAmounts): string[] {
  return [`Base : ${BASIS_LABEL[basis]}`, `Paiement : ${paymentId}`, `TTC ${money(a.total_cents)} · TVA ${money(a.tax_cents)} · HT ${money(a.subtotal_cents)}`];
}
/** Readiness outcome: missing reasons (translated), or amounts from the server, or a blocking
 *  « amounts unavailable » — never a substituted 0 and then no « Émettre ». */
export function ReadinessResult({ readiness, paymentId, busy, onIssue, onRecheck }: { readiness: InvoiceReadiness; paymentId: string; busy: boolean; onIssue: (a: PreviewAmounts) => void; onRecheck: () => void }) {
  if (!readiness.ready) return <div className={styles.danger} role="alert"><strong>Émission impossible</strong><ul>{readiness.missing.map((m) => <li key={m}>{MISSING_LABEL[m] ?? MISSING_FALLBACK}</li>)}</ul></div>;
  const amounts = previewAmounts(readiness.preview);
  if (!amounts)
    return (
      <div className={styles.danger} role="alert" data-finance-preview-missing="">
        <strong>{PREVIEW_UNAVAILABLE}</strong>
        <div className={styles.actions}><button type="button" className={styles.button} disabled={busy} onClick={onRecheck}>Vérifier les conditions</button></div>
      </div>
    );
  return (
    <div className={styles.card}>
      <strong>Conditions réunies pour le paiement <span className={styles.mono}>{shortId(paymentId)}</span></strong>
      <dl className={styles.kv}><dt>TTC</dt><dd>{money(amounts.total_cents)}</dd><dt>TVA</dt><dd>{money(amounts.tax_cents)}</dd><dt>HT</dt><dd>{money(amounts.subtotal_cents)}</dd></dl>
      <div className={styles.actions}><button type="button" className={`${styles.button} ${styles.primary}`} disabled={busy} onClick={() => onIssue(amounts)}>Émettre</button></div>
    </div>
  );
}
function IssueForm({ ctx, onIssued }: { ctx: Ctx; onIssued: () => void }) {
  const [basis, setBasis] = useState<"service" | "platform_commission">("service"); const [paymentId, setPaymentId] = useState(""); const [error, setError] = useState(""); const [requestId, setRequestId] = useState(newRequestId);
  // Readiness is bound to the exact target it was requested for (payment, basis, scope); a late result for another target is discarded.
  const [model, setModel] = useState(EMPTY_READINESS);
  const [confirm, setConfirm] = useState<Confirmation<{ request_id: string; basis: typeof basis; payment_id: string }>>(null);
  const target = (): ReadinessTarget => ({ payment_id: paymentId.trim().toLowerCase(), basis, scope_key: ctx.scopeKey });
  const onInput = (next: { basis?: typeof basis; paymentId?: string }) => { setConfirm(null); const b = next.basis ?? basis, p = next.paymentId ?? paymentId; if (next.basis) setBasis(next.basis); if (next.paymentId !== undefined) setPaymentId(next.paymentId); setModel((m) => readinessReduce(m, { type: "input", target: { payment_id: p.trim().toLowerCase(), basis: b, scope_key: ctx.scopeKey } })); };
  const check = () => {
    if (!UUID_RE.test(paymentId.trim())) { setError("Identifiant de paiement invalide."); return; }
    setError(""); setConfirm(null); const t = target(), fingerprint = readinessFingerprint(t);
    setModel((m) => readinessReduce(m, { type: "check", target: t }));
    void ctx.act(async () => {
      try { const r: InvoiceReadiness | null = await ctx.client.command.invoiceReadiness({ basis: t.basis, payment_id: t.payment_id }); if (r) setModel((m) => readinessReduce(m, { type: "result", fingerprint, readiness: r })); else setModel((m) => readinessReduce(m, { type: "fail", fingerprint })); return r; }
      catch (e) { setModel((m) => readinessReduce(m, { type: "fail", fingerprint })); throw e; }
    }, "Conditions vérifiées.");
  };
  const readiness = model.readiness, bound = model.target, stale = readinessFingerprint(target()) !== model.current;
  return (
    <Panel title="Émettre une facture" intro="Vérifiez d’abord les conditions ; rien n’est substitué aux données manquantes.">
      <form className={styles.form} noValidate onSubmit={(e) => { e.preventDefault(); check(); }}>
        <Field label="Base"><select value={basis} disabled={ctx.busy} onChange={(e) => onInput({ basis: e.target.value as typeof basis })}><option value="service">Prestation (émetteur : artisan)</option><option value="platform_commission">Commission (émetteur : plateforme)</option></select></Field>
        <Field label="Identifiant du paiement" error={error}><input value={paymentId} disabled={ctx.busy} onChange={(e) => onInput({ paymentId: e.target.value })} autoComplete="off" aria-invalid={Boolean(error)} /></Field>
        <div className={`${styles.actions} ${styles.full}`}><button type="submit" className={styles.button} disabled={ctx.busy}>{model.pending ? "Vérification…" : "Vérifier les conditions"}</button></div>
      </form>
      {readiness && bound && !stale && !confirm && (
        <ReadinessResult
          readiness={readiness}
          paymentId={bound.payment_id}
          busy={ctx.busy}
          onRecheck={check}
          onIssue={(amounts) => setConfirm(openConfirmation({ request_id: requestId, basis: bound.basis, payment_id: bound.payment_id }, issueSummary(bound.basis, bound.payment_id, amounts)))}
        />
      )}
      {confirm && (
        <ConfirmBox
          title="Confirmer l’émission de la facture"
          summary={confirm.summary}
          confirmLabel="Confirmer l’émission"
          busy={ctx.busy}
          onCancel={() => setConfirm(null)}
          onConfirm={() => ctx.act(() => ctx.client.command.issueInvoice({ ...confirm.payload }), "Facture émise et auditée.", () => { setConfirm(null); setModel(EMPTY_READINESS); setRequestId(newRequestId()); onIssued(); })}
        />
      )}
    </Panel>
  );
}
function CreditNoteForm({ ctx, onIssued }: { ctx: Ctx; onIssued: () => void }) {
  const [invoiceId, setInvoiceIdRaw] = useState(""); const [amount, setAmountRaw] = useState(""); const [reason, setReasonRaw] = useState(""); const [errors, setErrors] = useState<Record<string, string>>({}); const [requestId, setRequestId] = useState(newRequestId);
  const [confirm, setConfirm] = useState<Confirmation<{ request_id: string; invoice_id: string; amount_cents: number; reason: string }>>(null);
  // Any field change cancels an open confirmation (its payload was frozen when it opened).
  const setInvoiceId = (v: string) => { setConfirm(null); setInvoiceIdRaw(v); };
  const setAmount = (v: string) => { setConfirm(null); setAmountRaw(v); };
  const setReason = (v: string) => { setConfirm(null); setReasonRaw(v); };
  return (
    <Panel title="Émettre un avoir" intro="Plafonné au solde restant de la facture ; TVA au prorata.">
      <form className={styles.form} noValidate onSubmit={(e) => { e.preventDefault(); const next: Record<string, string> = {}; if (!UUID_RE.test(invoiceId.trim())) next.invoice = "Identifiant de facture invalide."; const cents = validateAmountCents(amount, 10000000); if ("error" in cents) next.amount = cents.error; const r = validateText(reason, 10, 1000, "Motif"); if (r) next.reason = r; setErrors(next); if (Object.keys(next).length || "error" in cents) return; const invoice_id = invoiceId.trim().toLowerCase(); setConfirm(openConfirmation({ request_id: requestId, invoice_id, amount_cents: cents.cents, reason: reason.trim() }, [`Facture : ${invoice_id}`, `Montant TTC de l’avoir : ${money(cents.cents)}`, `Motif : ${reason.trim()}`])); }}>
        <Field label="Identifiant de la facture" error={errors.invoice}><input value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)} autoComplete="off" /></Field>
        <Field label="Montant TTC (€)" error={errors.amount}><input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" /></Field>
        <Field label="Motif" error={errors.reason} full><textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} /></Field>
        <div className={`${styles.actions} ${styles.full}`}><button type="submit" className={`${styles.button} ${styles.primary}`} disabled={ctx.busy || Boolean(confirm)}>Émettre l’avoir</button></div>
      </form>
      {confirm && (
        <ConfirmBox
          title="Confirmer l’émission de l’avoir"
          summary={confirm.summary}
          confirmLabel="Confirmer l’avoir"
          busy={ctx.busy}
          onCancel={() => setConfirm(null)}
          onConfirm={() => ctx.act(() => ctx.client.command.issueCreditNote({ ...confirm.payload }), "Avoir émis et audité.", () => { setConfirm(null); setAmountRaw(""); setReasonRaw(""); setRequestId(newRequestId()); onIssued(); })}
        />
      )}
    </Panel>
  );
}
function BillingContactForm({ ctx }: { ctx: Ctx }) {
  const [kind, setKind] = useState<"profile" | "organization">("profile"); const [subject, setSubject] = useState(""); const [legalName, setLegalName] = useState(""); const [address, setAddress] = useState(""); const [siret, setSiret] = useState(""); const [vat, setVat] = useState(""); const [version, setVersion] = useState<number | null>(null); const [errors, setErrors] = useState<Record<string, string>>({});
  const load = () => { if (!UUID_RE.test(subject.trim())) { setErrors({ subject: "Identifiant invalide." }); return; } setErrors({}); void ctx.act(async () => { const r = await ctx.client.load.billingContact(kind, subject.trim().toLowerCase()); if (r) { const c = r.billing_contact; setLegalName(c?.legal_name ?? ""); setAddress(c?.address ?? ""); setSiret(c?.siret ?? ""); setVat(c?.vat_number ?? ""); setVersion(c?.version ?? null); } return r; }, "Coordonnées chargées."); };
  return (
    <Panel title="Coordonnées de facturation" intro="Donnée autoritative du destinataire ; l’adresse d’intervention n’est jamais utilisée à sa place.">
      <form className={styles.form} noValidate onSubmit={(e) => { e.preventDefault(); const next: Record<string, string> = {}; if (!UUID_RE.test(subject.trim())) next.subject = "Identifiant invalide."; const n = validateText(legalName, 1, 160, "Raison sociale"); if (n) next.legalName = n; const a = validateText(address, 5, 500, "Adresse"); if (a) next.address = a; if (siret && !/^[0-9]{14}$/.test(siret)) next.siret = "14 chiffres attendus."; if (vat && !/^[A-Z]{2}[0-9A-Z]{2,13}$/.test(vat)) next.vat = "Numéro de TVA invalide."; setErrors(next); if (Object.keys(next).length) return; void ctx.act(() => ctx.client.command.setBillingContact({ subject_kind: kind, subject_id: subject.trim().toLowerCase(), legal_name: legalName.trim(), address: address.trim(), siret: siret || null, vat_number: vat || null, expected_version: version }), "Coordonnées enregistrées et auditées.", () => setVersion((v) => (v ?? 0) + 1)); }}>
        <Field label="Sujet"><select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}><option value="profile">Profil (particulier)</option><option value="organization">Organisation</option></select></Field>
        <Field label="Identifiant" error={errors.subject}><span className={styles.actions}><input value={subject} onChange={(e) => setSubject(e.target.value)} autoComplete="off" /><button type="button" className={styles.button} onClick={load} disabled={ctx.busy}>Charger</button></span></Field>
        <Field label="Raison sociale ou nom" error={errors.legalName}><input value={legalName} onChange={(e) => setLegalName(e.target.value)} maxLength={160} /></Field>
        <Field label="Adresse de facturation" error={errors.address}><input value={address} onChange={(e) => setAddress(e.target.value)} maxLength={500} /></Field>
        <Field label="SIRET (facultatif)" error={errors.siret}><input value={siret} onChange={(e) => setSiret(e.target.value)} inputMode="numeric" /></Field>
        <Field label="N° TVA (facultatif)" error={errors.vat}><input value={vat} onChange={(e) => setVat(e.target.value.toUpperCase())} /></Field>
        <div className={`${styles.actions} ${styles.full}`}><button type="submit" className={`${styles.button} ${styles.primary}`} disabled={ctx.busy}>{version ? `Mettre à jour (version ${version})` : "Enregistrer"}</button></div>
      </form>
    </Panel>
  );
}

// ---- Refund requests -----------------------------------------------------------------------
function Refunds({ ctx }: { ctx: Ctx }) {
  const [status, setStatus] = useState("");
  const list = useList(ctx, (cursor) => ctx.client.load.refundRequests({ status: status || null, cursor, limit: 25 }), { requests: ctx.demo?.refundRequests ?? [], page: demoPage(ctx.demo?.refundRequests.length ?? 0) }, [status]);
  const [decision, setDecision] = useState<{ id: string; action: "approve" | "reject" | "cancel"; note: string; error: string } | null>(null);
  return (
    <>
      <p className={styles.alert} role="note">{REFUND_EXECUTION_MESSAGE}</p>
      <Panel title="Demandes de remboursement" action={<div className={styles.toolbar}><label>Statut<select value={status} onChange={(e) => { setStatus(e.target.value); list.resetCursor(); }}><option value="">Tous</option>{(["requested", "approved", "rejected", "cancelled", "settled"] as const).map((s) => <option key={s} value={s}>{refundStatusLabel(s)}</option>)}</select></label></div>}>
        {list.loading && !list.data ? <Loading /> : list.error && !list.data ? <ErrorBox message={list.error} onRetry={list.reload} /> : !list.data?.requests.length ? <EmptyState title="Aucune demande">Une demande se crée pour un paiement confirmé, dans la limite du montant réglé.</EmptyState> : (
          <ul className={styles.list}>{list.data.requests.map((r) => (
            <li key={r.id} className={styles.card}>
              <div className={styles.panelHead}><strong>{money(r.amount_cents, r.currency)} · paiement <span className={styles.mono}>{shortId(r.payment_id)}</span></strong><span className={`tag ${r.status === "settled" ? "tag-green" : r.status === "approved" ? "tag-blue" : r.status === "requested" ? "tag-amber" : ""}`}>{refundStatusLabel(r.status)}</span></div>
              <p className={styles.hint}>{r.reason}</p>
              <dl className={styles.kv}><dt>Demandée</dt><dd>{dateTime(r.created_at)} · version {r.version}</dd>{r.decided_at && <><dt>Décision</dt><dd>{dateTime(r.decided_at)}{r.decision_note && ` — ${r.decision_note}`}</dd></>}{r.settled_at && <><dt>Confirmé</dt><dd>{dateTime(r.settled_at)} · réf. {r.provider_reference}</dd></>}</dl>
              {ctx.canWrite && refundActions(r.status).length > 0 && (decision?.id === r.id
                ? <form className={styles.form} noValidate onSubmit={(e) => { e.preventDefault(); const err = validateRefundDecision({ action: decision.action, note: decision.note }); if (err) { setDecision({ ...decision, error: err }); return; } void ctx.act(() => ctx.client.command.decideRefund(r.id, { action: decision.action, expected_version: r.version, note: decision.note.trim() }), "Décision enregistrée. Aucun montant n’a été remboursé.", () => { setDecision(null); list.reload(); }); }}>
                  <Field label="Décision"><select value={decision.action} onChange={(e) => setDecision({ ...decision, action: e.target.value as typeof decision.action })}>{refundActions(r.status).map((a) => <option key={a} value={a}>{{ approve: "Approuver (sans exécution)", reject: "Rejeter", cancel: "Annuler la demande" }[a]}</option>)}</select></Field>
                  <Field label="Note" error={decision.error} full><textarea value={decision.note} onChange={(e) => setDecision({ ...decision, note: e.target.value })} maxLength={1000} /></Field>
                  <div className={`${styles.actions} ${styles.full}`}><button type="submit" className={`${styles.button} ${styles.primary}`} disabled={ctx.busy}>Confirmer</button><button type="button" className={styles.button} onClick={() => setDecision(null)}>Fermer</button></div>
                </form>
                : <div className={styles.actions}><button type="button" className={styles.button} onClick={() => setDecision({ id: r.id, action: refundActions(r.status)[0], note: "", error: "" })}>Décider</button></div>)}
            </li>))}</ul>
        )}
        {list.data && list.pager(list.data.page)}
      </Panel>
      {ctx.canWrite && <RefundForm ctx={ctx} onCreated={list.reload} />}
    </>
  );
}
function RefundForm({ ctx, onCreated }: { ctx: Ctx; onCreated: () => void }) {
  const [paymentId, setPaymentId] = useState(""); const [amount, setAmount] = useState(""); const [reason, setReason] = useState(""); const [errors, setErrors] = useState<Record<string, string>>({}); const [requestId, setRequestId] = useState(newRequestId);
  return (
    <Panel title="Nouvelle demande" intro="Créer une demande n’exécute aucun remboursement.">
      <form className={styles.form} noValidate onSubmit={(e) => { e.preventDefault(); const next: Record<string, string> = {}; if (!UUID_RE.test(paymentId.trim())) next.payment = "Identifiant de paiement invalide."; const cents = validateAmountCents(amount, 10000000); if ("error" in cents) next.amount = cents.error; const r = validateText(reason, 10, 2000, "Motif"); if (r) next.reason = r; setErrors(next); if (Object.keys(next).length || "error" in cents) return; void ctx.act(() => ctx.client.command.requestRefund({ request_id: requestId, payment_id: paymentId.trim().toLowerCase(), amount_cents: cents.cents, reason: reason.trim() }), "Demande enregistrée (statut : demandée).", () => { setAmount(""); setReason(""); setRequestId(newRequestId()); onCreated(); }); }}>
        <Field label="Identifiant du paiement" error={errors.payment}><input value={paymentId} onChange={(e) => setPaymentId(e.target.value)} autoComplete="off" /></Field>
        <Field label="Montant (€)" error={errors.amount}><input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" /></Field>
        <Field label="Motif" error={errors.reason} full><textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} /></Field>
        <div className={`${styles.actions} ${styles.full}`}><button type="submit" className={`${styles.button} ${styles.primary}`} disabled={ctx.busy}>Enregistrer la demande</button></div>
      </form>
    </Panel>
  );
}

// ---- Disputes -------------------------------------------------------------------------------
function Disputes({ ctx }: { ctx: Ctx }) {
  const [status, setStatus] = useState("");
  const list = useList(ctx, (cursor) => ctx.client.load.disputes({ status: status || null, cursor, limit: 25 }), { disputes: ctx.demo?.disputes ?? [], page: demoPage(ctx.demo?.disputes.length ?? 0) }, [status]);
  const [decision, setDecision] = useState<{ id: string; action: "review" | "resolve" | "close"; outcome: DisputeOutcome; refund: string; note: string; error: string } | null>(null);
  return (
    <>
      <Panel title="Litiges" action={<div className={styles.toolbar}><label>Statut<select value={status} onChange={(e) => { setStatus(e.target.value); list.resetCursor(); }}><option value="">Tous</option>{(["open", "under_review", "resolved", "closed"] as const).map((s) => <option key={s} value={s}>{DISPUTE_LABEL[s]}</option>)}</select></label></div>}>
        {list.loading && !list.data ? <Loading /> : list.error && !list.data ? <ErrorBox message={list.error} onRetry={list.reload} /> : !list.data?.disputes.length ? <EmptyState title="Aucun litige" /> : (
          <ul className={styles.list}>{list.data.disputes.map((d) => (
            <li key={d.id} className={styles.card}>
              <div className={styles.panelHead}><strong>{d.subject}</strong><span className="tag">{DISPUTE_LABEL[d.status]}</span></div>
              <p className={styles.hint}>{d.description}</p>
              <dl className={styles.kv}><dt>Origine</dt><dd>{{ client: "Client", artisan: "Artisan", platform: "Plateforme" }[d.origin]} · paiement <span className={styles.mono}>{shortId(d.payment_id)}</span> · version {d.version}</dd>{d.resolved_at && <><dt>Issue</dt><dd>{{ none: "—", refund_requested: "remboursement demandé", no_refund: "sans remboursement", other: "autre" }[d.outcome]} — {d.resolution_note}</dd></>}</dl>
              {ctx.canWrite && disputeActions(d.status).length > 0 && (decision?.id === d.id
                ? <form className={styles.form} noValidate onSubmit={(e) => { e.preventDefault(); const err = validateDisputeDecision({ action: decision.action, note: decision.note, outcome: decision.action === "resolve" ? decision.outcome : null, refund_request_id: decision.action === "resolve" && decision.refund ? decision.refund : null }) ?? (decision.refund && !UUID_RE.test(decision.refund.trim()) ? "Identifiant de demande invalide." : null); if (err) { setDecision({ ...decision, error: err }); return; } void ctx.act(() => ctx.client.command.decideDispute(d.id, { action: decision.action, expected_version: d.version, note: decision.note.trim(), outcome: decision.action === "resolve" ? decision.outcome : undefined, refund_request_id: decision.action === "resolve" && decision.refund ? decision.refund.trim().toLowerCase() : null }), "Décision enregistrée.", () => { setDecision(null); list.reload(); }); }}>
                  <Field label="Action"><select value={decision.action} onChange={(e) => setDecision({ ...decision, action: e.target.value as typeof decision.action })}>{disputeActions(d.status).map((a) => <option key={a} value={a}>{{ review: "Passer en examen", resolve: "Résoudre", close: "Clore sans suite" }[a]}</option>)}</select></Field>
                  {decision.action === "resolve" && <Field label="Issue"><select value={decision.outcome} onChange={(e) => setDecision({ ...decision, outcome: e.target.value as DisputeOutcome })}><option value="none">Choisir…</option><option value="refund_requested">Remboursement demandé</option><option value="no_refund">Sans remboursement</option><option value="other">Autre</option></select></Field>}
                  {decision.action === "resolve" && decision.outcome === "refund_requested" && <Field label="Identifiant de la demande de remboursement" full><input value={decision.refund} onChange={(e) => setDecision({ ...decision, refund: e.target.value })} /></Field>}
                  <Field label="Note" error={decision.error} full><textarea value={decision.note} onChange={(e) => setDecision({ ...decision, note: e.target.value })} maxLength={2000} /></Field>
                  <div className={`${styles.actions} ${styles.full}`}><button type="submit" className={`${styles.button} ${styles.primary}`} disabled={ctx.busy}>Confirmer</button><button type="button" className={styles.button} onClick={() => setDecision(null)}>Fermer</button></div>
                </form>
                : <div className={styles.actions}><button type="button" className={styles.button} onClick={() => setDecision({ id: d.id, action: disputeActions(d.status)[0], outcome: "none", refund: "", note: "", error: "" })}>Décider</button></div>)}
            </li>))}</ul>
        )}
        {list.data && list.pager(list.data.page)}
      </Panel>
      {ctx.canWrite && <DisputeForm ctx={ctx} onCreated={list.reload} />}
    </>
  );
}
function DisputeForm({ ctx, onCreated }: { ctx: Ctx; onCreated: () => void }) {
  const [paymentId, setPaymentId] = useState(""); const [origin, setOrigin] = useState<"client" | "artisan" | "platform">("client"); const [subject, setSubject] = useState(""); const [description, setDescription] = useState(""); const [errors, setErrors] = useState<Record<string, string>>({}); const [requestId, setRequestId] = useState(newRequestId);
  return (
    <Panel title="Ouvrir un litige">
      <form className={styles.form} noValidate onSubmit={(e) => { e.preventDefault(); const next: Record<string, string> = {}; if (!UUID_RE.test(paymentId.trim())) next.payment = "Identifiant de paiement invalide."; const s = validateText(subject, 4, 160, "Objet"); if (s) next.subject = s; const d = validateText(description, 10, 4000, "Description"); if (d) next.description = d; setErrors(next); if (Object.keys(next).length) return; void ctx.act(() => ctx.client.command.openDispute({ request_id: requestId, payment_id: paymentId.trim().toLowerCase(), origin, subject: subject.trim(), description: description.trim() }), "Litige ouvert.", () => { setSubject(""); setDescription(""); setRequestId(newRequestId()); onCreated(); }); }}>
        <Field label="Identifiant du paiement" error={errors.payment}><input value={paymentId} onChange={(e) => setPaymentId(e.target.value)} autoComplete="off" /></Field>
        <Field label="Origine"><select value={origin} onChange={(e) => setOrigin(e.target.value as typeof origin)}><option value="client">Client</option><option value="artisan">Artisan</option><option value="platform">Plateforme</option></select></Field>
        <Field label="Objet" error={errors.subject} full><input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={160} /></Field>
        <Field label="Description" error={errors.description} full><textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={4000} /></Field>
        <div className={`${styles.actions} ${styles.full}`}><button type="submit" className={`${styles.button} ${styles.primary}`} disabled={ctx.busy}>Ouvrir</button></div>
      </form>
    </Panel>
  );
}

// ---- Settings (super admin) ----------------------------------------------------------------
function Settings({ ctx, onSaved }: { ctx: Ctx; onSaved: () => void }) {
  const settings = useLoad(() => (ctx.demo ? Promise.resolve({ invoice_issuer: null, commission_bps: null }) : ctx.client.load.settings()), [ctx.demo]);
  const [bps, setBpsRaw] = useState(""); const [issuer, setIssuer] = useState({ legal_name: "", siret: "", address: "", vat_number: "", commission_vat_rate: "" }); const [errors, setErrors] = useState<Record<string, string>>({}); const [seeded, setSeeded] = useState(false);
  const [rateConfirm, setRateConfirm] = useState<Confirmation<{ key: "commission_bps"; value: { bps: number }; expected_version: number | null }>>(null);
  if (settings.loading && !settings.data) return <Loading />;
  if (settings.error && !settings.data) return <ErrorBox message={settings.error} onRetry={settings.reload} />;
  const data = settings.data;
  const setBps = (v: string) => { setRateConfirm(null); setBpsRaw(v); };
  if (data && !seeded) { setSeeded(true); if (data.commission_bps) setBpsRaw(String(data.commission_bps.value.bps)); if (data.invoice_issuer) { const v = data.invoice_issuer.value; setIssuer({ legal_name: v.legal_name, siret: v.siret, address: v.address, vat_number: v.vat_number ?? "", commission_vat_rate: v.commission_vat_rate === null ? "" : String(v.commission_vat_rate) }); } }
  if (!ctx.superAdmin) return <ReadOnly reason="les paramètres sont réservés aux super administrateurs." />;
  return (
    <>
      <Panel title="Taux de commission (points de base)" intro="Valeur serveur de confiance utilisée pour les estimations ; chaque écriture conserve le taux et la version appliqués. Aucun taux par défaut.">
        <form className={styles.form} noValidate onSubmit={(e) => { e.preventDefault(); if (!/^\d{1,5}$/.test(bps) || Number(bps) > 10000) { setErrors({ bps: "Entier entre 0 et 10000 (100 = 1 %)." }); return; } setErrors({}); const value = Number(bps); setRateConfirm(openConfirmation({ key: "commission_bps" as const, value: { bps: value }, expected_version: data?.commission_bps?.version ?? null }, [`Nouveau taux de commission : ${(value / 100).toFixed(2)} % (${value} points de base)`, data?.commission_bps ? `Taux actuel : ${(data.commission_bps.value.bps / 100).toFixed(2)} % (version ${data.commission_bps.version})` : "Taux actuel : non configuré"])); }}>
          <Field label="Points de base" hint={data?.commission_bps ? `Version actuelle ${data.commission_bps.version}.` : "Non configuré."} error={errors.bps}><input value={bps} onChange={(e) => setBps(e.target.value)} inputMode="numeric" /></Field>
          <div className={`${styles.actions} ${styles.full}`}><button type="submit" className={`${styles.button} ${styles.primary}`} disabled={ctx.busy || Boolean(rateConfirm)}>Enregistrer</button></div>
        </form>
        {rateConfirm && (
          <ConfirmBox
            title="Confirmer le taux de commission"
            summary={rateConfirm.summary}
            confirmLabel="Confirmer le taux"
            busy={ctx.busy}
            onCancel={() => setRateConfirm(null)}
            onConfirm={() => ctx.act(() => ctx.client.command.setSetting({ ...rateConfirm.payload, value: { ...rateConfirm.payload.value } }), "Taux enregistré et audité.", () => { setRateConfirm(null); settings.reload(); onSaved(); })}
          />
        )}
      </Panel>
      <Panel title="Émetteur plateforme (factures de commission)" intro="Données légales saisies sous la responsabilité du super administrateur ; rien n’est pré-rempli.">
        <form className={styles.form} noValidate onSubmit={(e) => { e.preventDefault(); const next: Record<string, string> = {}; const n = validateText(issuer.legal_name, 1, 160, "Raison sociale"); if (n) next.legal_name = n; if (!/^[0-9]{14}$/.test(issuer.siret)) next.siret = "14 chiffres attendus."; const a = validateText(issuer.address, 5, 500, "Adresse"); if (a) next.address = a; if (issuer.vat_number && !/^[A-Z]{2}[0-9A-Z]{2,13}$/.test(issuer.vat_number)) next.vat_number = "Numéro de TVA invalide."; if (issuer.commission_vat_rate && !["0", "5.5", "10", "20"].includes(issuer.commission_vat_rate)) next.commission_vat_rate = "Taux non pris en charge."; setErrors(next); if (Object.keys(next).length) return; void ctx.act(() => ctx.client.command.setSetting({ key: "invoice_issuer", value: { legal_name: issuer.legal_name.trim(), siret: issuer.siret, address: issuer.address.trim(), vat_number: issuer.vat_number || null, commission_vat_rate: issuer.commission_vat_rate === "" ? null : (Number(issuer.commission_vat_rate) as 0 | 5.5 | 10 | 20) }, expected_version: data?.invoice_issuer?.version ?? null }), "Émetteur enregistré et audité.", () => { settings.reload(); onSaved(); }); }}>
          <Field label="Raison sociale" error={errors.legal_name}><input value={issuer.legal_name} onChange={(e) => setIssuer({ ...issuer, legal_name: e.target.value })} maxLength={160} /></Field>
          <Field label="SIRET" error={errors.siret}><input value={issuer.siret} onChange={(e) => setIssuer({ ...issuer, siret: e.target.value })} inputMode="numeric" /></Field>
          <Field label="Adresse" error={errors.address} full><input value={issuer.address} onChange={(e) => setIssuer({ ...issuer, address: e.target.value })} maxLength={500} /></Field>
          <Field label="N° TVA (facultatif)" error={errors.vat_number}><input value={issuer.vat_number} onChange={(e) => setIssuer({ ...issuer, vat_number: e.target.value.toUpperCase() })} /></Field>
          <Field label="TVA sur commission" hint="Vide = non configuré : aucune facture de commission possible." error={errors.commission_vat_rate}><select value={issuer.commission_vat_rate} onChange={(e) => setIssuer({ ...issuer, commission_vat_rate: e.target.value })}><option value="">Non configuré</option><option value="0">0 %</option><option value="5.5">5,5 %</option><option value="10">10 %</option><option value="20">20 %</option></select></Field>
          <div className={`${styles.actions} ${styles.full}`}><button type="submit" className={`${styles.button} ${styles.primary}`} disabled={ctx.busy}>{data?.invoice_issuer ? `Mettre à jour (version ${data.invoice_issuer.version})` : "Enregistrer"}</button></div>
        </form>
      </Panel>
    </>
  );
}
