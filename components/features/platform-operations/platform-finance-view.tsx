"use client";
// Prepared finance (contract A1/A2): ledger, reconciliation, invoices/credit notes, refund requests, disputes, settings.
// No control here moves money; "approuvée" never means "remboursée".
import { useCallback, useState, type ReactNode } from "react";
import type { ContractState, Dispute, DisputeOutcome, FinanceConfig, FinanceReport, Invoice, InvoiceReadiness, LedgerEntry, Page, PlatformAccess, PlatformClient, PlatformViewScope, RefundRequest } from "../../../lib/features/platform-operations/types";
import { COMMISSION_NOT_CONFIGURED, REFUND_EXECUTION_MESSAGE } from "../../../lib/features/platform-operations/config";
import { UUID_RE, disputeActions, refundActions, refundStatusLabel, validateAmountCents, validateDisputeDecision, validateRefundDecision, validateText } from "../../../lib/features/platform-operations/state-machines";
import type { PlatformDemo } from "../../../lib/features/platform-operations/demo";
import { EmptyState, ErrorBox, Field, Gate, Loading, Pager, Panel, ReadOnly, dateTime, errorText, money, newRequestId, scopeKey, shortId, useLoad } from "./shared";
import styles from "./platform-operations.module.css";

export type PlatformFinanceViewProps = { state: ContractState; unavailableMessage: string; scope: PlatformViewScope; client: PlatformClient; demo?: PlatformDemo; onNavigate?: (view: string, param?: string) => void };
type Tab = "overview" | "ledger" | "invoices" | "refunds" | "disputes" | "settings";
const TABS: { id: Tab; label: string }[] = [{ id: "overview", label: "Rapprochement" }, { id: "ledger", label: "Ledger" }, { id: "invoices", label: "Factures et avoirs" }, { id: "refunds", label: "Remboursements" }, { id: "disputes", label: "Litiges" }, { id: "settings", label: "Paramètres" }];
const DEMO_NOTE = "Mode démonstration : aucune action n’est envoyée.";
const KIND_LABEL: Record<LedgerEntry["entry_kind"], string> = { payment_settled: "Encaissement confirmé", commission_estimated: "Commission estimée (non prélevée)", commission_withheld: "Commission prélevée (confirmée)", refund_settled: "Remboursement confirmé" };
const MISSING_LABEL: Record<string, string> = { billing_contact: "coordonnées de facturation manquantes", payment_not_settled: "paiement non confirmé", quote_not_accepted: "devis non accepté", already_issued: "facture déjà émise pour ce paiement", artisan_company_name: "raison sociale de l’artisan manquante", artisan_siret: "SIRET de l’artisan manquant", artisan_legal_status: "forme juridique de l’artisan manquante", artisan_address: "adresse de l’artisan manquante", artisan_identity: "identité légale de l’artisan incomplète", platform_issuer: "émetteur plateforme non configuré", platform_commission_vat_rate: "taux de TVA de commission non configuré", commission_not_confirmed: "commission non confirmée par le fournisseur de paiement" };

type Ctx = { client: PlatformClient; demo?: PlatformDemo; canWrite: boolean; superAdmin: boolean; notify: (m: { kind: "ok" | "error"; text: string } | null) => void; busy: boolean; act: (work: () => Promise<unknown | null>, done: string, after?: () => void) => Promise<void> };

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
  const ctx: Ctx = { client, demo, canWrite: scope.authority.canWrite && !demo && (me.data.super_admin || me.data.scopes.includes("finance_write")), superAdmin: !demo && scope.authority.canWrite && me.data.super_admin, notify, busy, act };
  return (
    <div className={styles.view}>
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
        action={ctx.canWrite && <button type="button" className={`${styles.button} ${styles.primary}`} disabled={ctx.busy} onClick={() => ctx.act(() => ctx.client.command.reconcile({ limit: 200 }), "Rapprochement exécuté ; le taux appliqué est le paramètre serveur.", data.reload)}>Rapprocher les paiements confirmés</button>}>
        <div className={styles.strip}>
          <Stat label="Paiements confirmés" value={`${r.payments.paid_count} · ${money(r.payments.paid_cents)}`} note={`En attente : ${r.payments.pending_count} · échoués : ${r.payments.failed_count} · tentatives échouées : ${r.payments.failed_attempts}`} />
          <Stat label="Encaissements au ledger" value={`${r.ledger.settled_count} · ${money(r.ledger.settled_cents)}`} note={r.ledger.missing_settlement ? `${r.ledger.missing_settlement} paiement(s) confirmé(s) sans écriture : lancez le rapprochement.` : "Tous les paiements confirmés sont inscrits."} />
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
          <tbody>{list.data.entries.map((e) => <tr key={e.id}><td>{dateTime(e.created_at)}</td><td>{KIND_LABEL[e.entry_kind]}</td><td className={styles.mono}>{shortId(e.payment_id)}{e.external_event_id && <div>{e.external_event_id}</div>}</td><td className={styles.num}>{e.direction === "debit" ? "−" : "+"}{money(e.amount_cents, e.currency)}</td><td className={styles.details}>{Object.entries(e.basis).map(([k, v]) => <span key={k}>{k} : {String(v)}</span>)}</td></tr>)}</tbody></table></div>
      )}
      {list.data && list.pager(list.data.page)}
    </Panel>
  );
}

// ---- Invoices ------------------------------------------------------------------------------
function Invoices({ ctx }: { ctx: Ctx }) {
  const list = useList(ctx, (cursor) => ctx.client.load.invoices({ cursor, limit: 25 }), { invoices: ctx.demo?.invoices ?? [], page: demoPage(ctx.demo?.invoices.length ?? 0) }, []);
  return (
    <>
      <Panel title="Registre" intro="Documents émis uniquement à partir d’un émetteur réel, d’un paiement confirmé et de coordonnées de facturation renseignées. Un document ne se supprime pas : il se corrige par avoir.">
        {list.loading && !list.data ? <Loading /> : list.error && !list.data ? <ErrorBox message={list.error} onRetry={list.reload} /> : !list.data?.invoices.length ? <EmptyState title="Aucun document">Vérifiez d’abord les conditions d’émission pour un paiement confirmé.</EmptyState> : (
          <div className={styles.tableWrap}><table className={styles.table}><caption className={styles.srOnly}>Factures et avoirs</caption>
            <thead><tr><th>Numéro</th><th>Type</th><th>Émetteur</th><th>Destinataire</th><th className={styles.num}>HT</th><th className={styles.num}>TVA</th><th className={styles.num}>TTC</th><th>Émis</th></tr></thead>
            <tbody>{list.data.invoices.map((i) => <tr key={i.id}><td className={styles.mono}>{i.number}{i.related_invoice_id && <div>sur {shortId(i.related_invoice_id)}</div>}</td><td>{i.kind === "invoice" ? "Facture" : "Avoir"} · {i.basis === "service" ? "prestation" : "commission"}</td><td>{i.issuer.legal_name}</td><td>{i.recipient.name ?? i.recipient.legal_name}</td><td className={styles.num}>{money(i.subtotal_cents)}</td><td className={styles.num}>{money(i.tax_cents)} ({Number(i.tax_rate)} %)</td><td className={styles.num}>{money(i.total_cents)}</td><td>{dateTime(i.issued_at)}</td></tr>)}</tbody></table></div>
        )}
        {list.data && list.pager(list.data.page)}
      </Panel>
      {ctx.canWrite && <IssueForm ctx={ctx} onIssued={list.reload} />}
      {ctx.canWrite && <CreditNoteForm ctx={ctx} onIssued={list.reload} />}
      {ctx.canWrite && <BillingContactForm ctx={ctx} />}
      <Message>Le rendu PDF des documents est fourni par le lot documents ; ce registre expose les données exactes du document.</Message>
    </>
  );
}
function IssueForm({ ctx, onIssued }: { ctx: Ctx; onIssued: () => void }) {
  const [basis, setBasis] = useState<"service" | "platform_commission">("service"); const [paymentId, setPaymentId] = useState(""); const [error, setError] = useState(""); const [readiness, setReadiness] = useState<InvoiceReadiness | null>(null); const [requestId, setRequestId] = useState(newRequestId);
  const check = () => { if (!UUID_RE.test(paymentId.trim())) { setError("Identifiant de paiement invalide."); return; } setError(""); setReadiness(null); void ctx.act(async () => { const r = await ctx.client.command.invoiceReadiness({ basis, payment_id: paymentId.trim().toLowerCase() }); if (r) setReadiness(r); return r; }, "Conditions vérifiées."); };
  return (
    <Panel title="Émettre une facture" intro="Vérifiez d’abord les conditions ; rien n’est substitué aux données manquantes.">
      <form className={styles.form} noValidate onSubmit={(e) => { e.preventDefault(); check(); }}>
        <Field label="Base"><select value={basis} onChange={(e) => { setBasis(e.target.value as typeof basis); setReadiness(null); }}><option value="service">Prestation (émetteur : artisan)</option><option value="platform_commission">Commission (émetteur : plateforme)</option></select></Field>
        <Field label="Identifiant du paiement" error={error}><input value={paymentId} onChange={(e) => { setPaymentId(e.target.value); setReadiness(null); }} autoComplete="off" aria-invalid={Boolean(error)} /></Field>
        <div className={`${styles.actions} ${styles.full}`}><button type="submit" className={styles.button} disabled={ctx.busy}>Vérifier les conditions</button></div>
      </form>
      {readiness && (readiness.ready
        ? <div className={styles.card}><strong>Conditions réunies</strong><dl className={styles.kv}><dt>TTC</dt><dd>{money(readiness.preview.total_cents ?? 0)}</dd><dt>TVA</dt><dd>{money(readiness.preview.tax_cents ?? 0)}</dd><dt>HT</dt><dd>{money(readiness.preview.subtotal_cents ?? 0)}</dd></dl>
          <div className={styles.actions}><button type="button" className={`${styles.button} ${styles.primary}`} disabled={ctx.busy} onClick={() => ctx.act(() => ctx.client.command.issueInvoice({ request_id: requestId, basis, payment_id: paymentId.trim().toLowerCase() }), "Facture émise et auditée.", () => { setReadiness(null); setRequestId(newRequestId()); onIssued(); })}>Émettre</button></div></div>
        : <div className={styles.danger} role="alert"><strong>Émission impossible</strong><ul>{readiness.missing.map((m) => <li key={m}>{MISSING_LABEL[m] ?? m}</li>)}</ul></div>)}
    </Panel>
  );
}
function CreditNoteForm({ ctx, onIssued }: { ctx: Ctx; onIssued: () => void }) {
  const [invoiceId, setInvoiceId] = useState(""); const [amount, setAmount] = useState(""); const [reason, setReason] = useState(""); const [errors, setErrors] = useState<Record<string, string>>({}); const [requestId, setRequestId] = useState(newRequestId);
  return (
    <Panel title="Émettre un avoir" intro="Plafonné au solde restant de la facture ; TVA au prorata.">
      <form className={styles.form} noValidate onSubmit={(e) => { e.preventDefault(); const next: Record<string, string> = {}; if (!UUID_RE.test(invoiceId.trim())) next.invoice = "Identifiant de facture invalide."; const cents = validateAmountCents(amount, 10000000); if ("error" in cents) next.amount = cents.error; const r = validateText(reason, 10, 1000, "Motif"); if (r) next.reason = r; setErrors(next); if (Object.keys(next).length || "error" in cents) return; void ctx.act(() => ctx.client.command.issueCreditNote({ request_id: requestId, invoice_id: invoiceId.trim().toLowerCase(), amount_cents: cents.cents, reason: reason.trim() }), "Avoir émis et audité.", () => { setAmount(""); setReason(""); setRequestId(newRequestId()); onIssued(); }); }}>
        <Field label="Identifiant de la facture" error={errors.invoice}><input value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)} autoComplete="off" /></Field>
        <Field label="Montant TTC (€)" error={errors.amount}><input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" /></Field>
        <Field label="Motif" error={errors.reason} full><textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} /></Field>
        <div className={`${styles.actions} ${styles.full}`}><button type="submit" className={`${styles.button} ${styles.primary}`} disabled={ctx.busy}>Émettre l’avoir</button></div>
      </form>
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
  const [bps, setBps] = useState(""); const [issuer, setIssuer] = useState({ legal_name: "", siret: "", address: "", vat_number: "", commission_vat_rate: "" }); const [errors, setErrors] = useState<Record<string, string>>({}); const [seeded, setSeeded] = useState(false);
  if (settings.loading && !settings.data) return <Loading />;
  if (settings.error && !settings.data) return <ErrorBox message={settings.error} onRetry={settings.reload} />;
  const data = settings.data;
  if (data && !seeded) { setSeeded(true); if (data.commission_bps) setBps(String(data.commission_bps.value.bps)); if (data.invoice_issuer) { const v = data.invoice_issuer.value; setIssuer({ legal_name: v.legal_name, siret: v.siret, address: v.address, vat_number: v.vat_number ?? "", commission_vat_rate: v.commission_vat_rate === null ? "" : String(v.commission_vat_rate) }); } }
  if (!ctx.superAdmin) return <ReadOnly reason="les paramètres sont réservés aux super administrateurs." />;
  return (
    <>
      <Panel title="Taux de commission (points de base)" intro="Valeur serveur de confiance utilisée pour les estimations ; chaque écriture conserve le taux et la version appliqués. Aucun taux par défaut.">
        <form className={styles.form} noValidate onSubmit={(e) => { e.preventDefault(); if (!/^\d{1,5}$/.test(bps) || Number(bps) > 10000) { setErrors({ bps: "Entier entre 0 et 10000 (100 = 1 %)." }); return; } setErrors({}); void ctx.act(() => ctx.client.command.setSetting({ key: "commission_bps", value: { bps: Number(bps) }, expected_version: data?.commission_bps?.version ?? null }), "Taux enregistré et audité.", () => { settings.reload(); onSaved(); }); }}>
          <Field label="Points de base" hint={data?.commission_bps ? `Version actuelle ${data.commission_bps.version}.` : "Non configuré."} error={errors.bps}><input value={bps} onChange={(e) => setBps(e.target.value)} inputMode="numeric" /></Field>
          <div className={`${styles.actions} ${styles.full}`}><button type="submit" className={`${styles.button} ${styles.primary}`} disabled={ctx.busy}>Enregistrer</button></div>
        </form>
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
