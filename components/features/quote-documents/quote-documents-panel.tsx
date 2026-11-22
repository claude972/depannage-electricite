"use client";
// Leaf component of ADV-DOCUMENTS-001 (props per WEB-SHARED-001). It never fetches: `client` is
// injected by the lead; a `null` result is a stale chain and changes nothing. Write controls
// appear only when the lead's authority allows writing AND the server permission says so.
import { useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import {
  AMENDMENT_STATUS_LABELS,
  QUOTE_STATUS_LABELS,
  formatDate,
  formatDateTimeUtc,
  formatEuro,
  formatTaxRate,
  issuerFieldLabels,
  validityLabel,
} from "../../../lib/features/quote-documents/format";
import { canWrite, executeCommand, initialPanelState, panelReducer, readOnlyReason, scopeKey, toFailure } from "../../../lib/features/quote-documents/panel-model";
import type {
  ContractState,
  OverviewAmendment,
  OverviewQuote,
  QuoteDocumentEvent,
  QuoteDocumentSummary,
  QuoteDocumentsClient,
  QuoteDocumentsCommand,
  QuoteDocumentsDemo,
  QuoteDocumentsScope,
  QuoteDocumentsTarget,
  QuoteLine,
} from "../../../lib/features/quote-documents/types";
import { AmendmentForm } from "./amendment-form";
import { ValidityForm } from "./validity-form";
import styles from "./quote-documents.module.css";

export interface QuoteDocumentsPanelProps {
  state: ContractState;
  unavailableMessage?: string;
  scope: QuoteDocumentsScope;
  client: QuoteDocumentsClient;
  demo?: QuoteDocumentsDemo;
  onNavigate?: (view: string, param?: string) => void;
  target: QuoteDocumentsTarget;
  variant: "artisan" | "client" | "enterprise";
  /** SYS-05: changes when the lead refreshed its workspace or its dossier polling tick fired. The
   *  overview is then re-read silently (no loader, forms and notices kept); a failed or stale
   *  re-read keeps what is shown. */
  refreshKey?: string | number;
}

const TITLES = {
  artisan: "Documents, validité et avenants du devis",
  client: "Document du devis et avenants",
  enterprise: "Documents, validité et avenants",
} as const;
const UNAVAILABLE = {
  unknown: "Vérification de la disponibilité des documents de devis…",
  missing: "Les documents de devis ne sont pas encore activés sur ce service.",
  unavailable: "Les documents de devis sont momentanément indisponibles. Réessayez plus tard.",
} as const;
const EVENT_LABELS: Record<QuoteDocumentEvent["action"], string> = {
  terms_set: "Validité enregistrée",
  document_generated: "Document généré",
  document_downloaded: "Document téléchargé",
  amendment_proposed: "Avenant proposé",
  amendment_accepted: "Avenant accepté",
  amendment_rejected: "Avenant refusé",
  amendment_withdrawn: "Avenant retiré",
};
const DEMO_NOTICE = "Démonstration : cette action n’est pas enregistrée.";

function statusTone(status: string): string {
  if (status === "accepted") return "tag tag-green";
  if (status === "rejected" || status === "withdrawn") return "tag tag-red";
  if (status === "proposed" || status === "sent") return "tag tag-amber";
  return "tag";
}
function validityTone(validity: string | undefined): string {
  if (validity === "expired") return "tag tag-red";
  if (validity === "valid") return "tag tag-green";
  return "tag";
}

export function QuoteDocumentsPanel(props: QuoteDocumentsPanelProps) {
  const { state, unavailableMessage, scope, client, demo, onNavigate, target, variant, refreshKey } = props;
  const key = scopeKey(scope, target);
  // Demo seeds are available synchronously (server rendering shows them too); live data is loaded.
  const [panel, dispatch] = useReducer(panelReducer, key, (k) => (demo ? panelReducer(initialPanelState(k), { type: "loaded", overview: demo.overview }) : initialPanelState(k)));
  const keyRef = useRef(key);
  keyRef.current = key;
  const [proposing, setProposing] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<{ id: string; mode: "accept" | "reject"; note: string } | null>(null);

  // Any change of identity, organisation, site or target clears everything and reloads.
  useEffect(() => {
    dispatch({ type: "reset", key });
    setProposing(null);
    setDeciding(null);
    if (demo) {
      dispatch({ type: "loaded", overview: demo.overview });
      return;
    }
    if (state !== "available") return;
    let active = true;
    dispatch({ type: "load" });
    client
      .load(target)
      .then((overview) => {
        if (!active || keyRef.current !== key) return;
        if (overview === null) dispatch({ type: "reset", key });
        else dispatch({ type: "loaded", overview });
      })
      .catch((error: unknown) => {
        if (active && keyRef.current === key) dispatch({ type: "load_failed", failure: toFailure(error) });
      });
    return () => {
      active = false;
    };
    // `target` is compared through `key`; `client` and `demo` are stable per lead render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, state, demo]);

  // SYS-05: silent re-read when the lead's refresh key moves (the other party accepted the quote,
  // proposed or decided an amendment). Never during a command: it ends with its own fresh read.
  const pendingRef = useRef(panel.pending);
  pendingRef.current = panel.pending;
  const refreshSeen = useRef(refreshKey);
  useEffect(() => {
    if (refreshSeen.current === refreshKey) return;
    refreshSeen.current = refreshKey;
    if (demo || state !== "available" || pendingRef.current) return;
    const mountedKey = keyRef.current;
    let active = true;
    client
      .load(target)
      .then((overview) => {
        if (active && overview && keyRef.current === mountedKey && !pendingRef.current) dispatch({ type: "loaded", overview });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const reload = async () => {
    if (demo) return;
    const mountedKey = key;
    dispatch({ type: "load" });
    try {
      const overview = await client.load(target);
      if (keyRef.current !== mountedKey) return;
      if (overview === null) dispatch({ type: "reset", key: mountedKey });
      else dispatch({ type: "loaded", overview });
    } catch (error) {
      if (keyRef.current === mountedKey) dispatch({ type: "load_failed", failure: toFailure(error) });
    }
  };
  const run = async (body: QuoteDocumentsCommand): Promise<boolean> => {
    if (panel.pending) return false;
    if (demo) {
      dispatch({ type: "command_failed", failure: { status: 0, message: DEMO_NOTICE } });
      return false;
    }
    // Continuation guard: the key mounted when the command started must still be the current one
    // after every await; otherwise nothing is dispatched and callers get `false` (no form reset).
    const mountedKey = key;
    return executeCommand({ client, body, target, isCurrent: () => keyRef.current === mountedKey, dispatch });
  };

  if (state !== "available" && !demo) {
    return (
      <div className="unavailable" role="note" data-blocker="quote-documents-contract">
        <div>
          <strong>{TITLES[variant]}</strong>
          <p>{unavailableMessage || UNAVAILABLE[state]}</p>
        </div>
      </div>
    );
  }

  const overview = panel.overview;
  const busy = panel.pending !== null;
  const writable = scope.authority.canWrite;

  return (
    <section className={styles.panel} aria-labelledby="quote-documents-title" aria-busy={panel.phase === "loading" || busy}>
      <div className={styles.head}>
        <div>
          <h2 id="quote-documents-title">{TITLES[variant]}</h2>
          <p className={styles.lead}>
            Chaque document reflète exactement la version du devis ou de l’avenant choisie, avec sa validité et son état au moment de la génération.
          </p>
        </div>
        {demo && <span className={styles.demoTag}>Données de démonstration</span>}
      </div>
      {!writable && (
        <p className={styles.readOnly} role="note">
          {readOnlyReason(scope)}
        </p>
      )}
      {panel.notice && (
        <div className="alert success" role="status">
          <span>{panel.notice}</span>
          <button type="button" className="text-button" onClick={() => dispatch({ type: "dismiss" })}>
            Fermer
          </button>
        </div>
      )}
      {panel.commandError && (
        <div className={`alert ${panel.commandError.status === 0 && demo ? "warning" : "error"}`} role="alert" data-blocker={`http-${panel.commandError.status}`}>
          <span>{panel.commandError.message}</span>
          <button type="button" className="text-button" onClick={() => dispatch({ type: "dismiss" })}>
            Fermer
          </button>
        </div>
      )}
      {panel.conflict && (
        <div className="alert warning" role="alert" data-blocker="http-409">
          <span>{panel.conflict.message}</span>
          <button type="button" className="text-button" onClick={() => void reload()}>
            Recharger
          </button>
        </div>
      )}
      {panel.issuerMissing && (
        <div className="alert warning" role="alert" data-blocker="issuer-incomplete">
          <span>
            Le dossier professionnel de l’émetteur est incomplet
            {panel.issuerMissing.length ? ` (${issuerFieldLabels(panel.issuerMissing)})` : ""}. Le document ne sera généré qu’une fois ces informations renseignées ; rien d’inventé ne sera imprimé.
            {variant === "artisan" && onNavigate && (
              <>
                {" "}
                <button type="button" className="text-button" onClick={() => onNavigate("artisan-profile")}>
                  Compléter mon dossier
                </button>
              </>
            )}
          </span>
        </div>
      )}

      {panel.phase === "loading" && !overview && (
        <div className={styles.loader} role="status">
          <span className="spinner" aria-hidden="true" />
          Chargement des documents…
        </div>
      )}
      {panel.phase === "error" && panel.loadError && (
        <div className="alert error" role="alert" data-blocker={`http-${panel.loadError.status}`}>
          <span>{panel.loadError.message}</span>
          <button type="button" className="text-button" onClick={() => void reload()}>
            Réessayer
          </button>
        </div>
      )}
      {overview && overview.quotes.length === 0 && (
        <div className={styles.empty}>
          <h3>Aucun devis pour ce dossier</h3>
          <p>Les documents, la validité et les avenants apparaîtront ici dès qu’un devis aura été envoyé.</p>
        </div>
      )}
      {overview && !overview.issuer.ready && overview.quotes.length > 0 && (
        <p className={styles.readOnly} role="note" data-blocker="issuer-incomplete">
          {overview.viewer.is_artisan
            ? `Votre dossier professionnel est incomplet${overview.issuer.missing.length ? ` (${issuerFieldLabels(overview.issuer.missing)})` : ""} : la génération de documents est bloquée tant qu’il n’est pas complété.`
            : "Le dossier professionnel de l’émetteur est incomplet : la génération de documents est bloquée tant qu’il n’est pas complété."}
          {overview.viewer.is_artisan && onNavigate && (
            <>
              {" "}
              <button type="button" className="text-button" onClick={() => onNavigate("artisan-profile")}>
                Compléter mon dossier
              </button>
            </>
          )}
        </p>
      )}
      {overview?.quotes.map((quote) => (
        <QuoteCard
          key={quote.id}
          quote={quote}
          scope={scope}
          busy={busy}
          pending={panel.pending}
          demo={Boolean(demo)}
          client={client}
          run={run}
          proposing={proposing === quote.id}
          setProposing={(open) => setProposing(open ? quote.id : null)}
          deciding={deciding}
          setDeciding={setDeciding}
        />
      ))}
      {overview && overview.quotes.length > 0 && (
        <p className={styles.note}>
          Le règlement sur la plateforme porte sur le devis accepté et ses avenants acceptés.
        </p>
      )}
      {overview && overview.history.length > 0 && (
        <details className={styles.history}>
          <summary>Historique ({overview.history.length})</summary>
          <ol>
            {overview.history.map((event) => (
              <li key={event.id}>
                <time dateTime={event.created_at}>{formatDateTimeUtc(event.created_at)}</time>
                {EVENT_LABELS[event.action] ?? event.action}
                {typeof event.details?.revision === "number" ? ` — révision ${event.details.revision}` : ""}
                {typeof event.details?.version === "number" ? ` — avenant n° ${event.details.version}` : ""}
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}

function LinesTable({ lines, subtotal, taxRate, tax, total, caption }: { lines: QuoteLine[]; subtotal: number; taxRate: number; tax: number; total: number; caption: string }) {
  return (
    <div className={styles.linesScroll} role="region" aria-label={caption} tabIndex={0}>
      <table className={styles.lines}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Prestation</th>
            <th scope="col" className={styles.num}>
              Qté × PU HT
            </th>
            <th scope="col">Montant HT</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) => (
            <tr key={index}>
              <td>{line.label}</td>
              <td className={styles.num}>
                {line.quantity} × {formatEuro(line.unit_price_cents)}
              </td>
              <td>{formatEuro(line.quantity * line.unit_price_cents)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2}>Sous-total HT</td>
            <td>{formatEuro(subtotal)}</td>
          </tr>
          <tr>
            <td colSpan={2}>TVA {formatTaxRate(taxRate)}</td>
            <td>{formatEuro(tax)}</td>
          </tr>
          <tr className={styles.total}>
            <td colSpan={2}>Total TTC</td>
            <td>{formatEuro(total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function DocumentLinks({ documents, demo, client }: { documents: QuoteDocumentSummary[]; demo: boolean; client: QuoteDocumentsClient }) {
  if (!documents.length) return <p className={styles.meta}>Aucun document généré pour cette version.</p>;
  return (
    <ul className={styles.list}>
      {documents.map((doc) => (
        <li key={doc.id} className={styles.item}>
          <span className={styles.grow}>
            <strong>
              {doc.reference} — révision {doc.revision}
            </strong>
            <br />
            <span className={styles.meta}>Généré le {formatDateTimeUtc(doc.generated_at)}</span>
          </span>
          <span className={styles.links}>
            {demo ? (
              <span className={styles.meta}>Téléchargement indisponible en démonstration</span>
            ) : (
              <>
                <a className="button outline" href={client.documentHref(doc.id, true)} target="_blank" rel="noopener noreferrer">
                  Ouvrir le PDF
                </a>
                <a className="button outline" href={client.documentHref(doc.id)} download>
                  Télécharger
                </a>
              </>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

function QuoteCard({
  quote,
  scope,
  busy,
  pending,
  demo,
  client,
  run,
  proposing,
  setProposing,
  deciding,
  setDeciding,
}: {
  quote: OverviewQuote;
  scope: QuoteDocumentsScope;
  busy: boolean;
  pending: string | null;
  demo: boolean;
  client: QuoteDocumentsClient;
  run: (body: QuoteDocumentsCommand) => Promise<boolean>;
  proposing: boolean;
  setProposing: (open: boolean) => void;
  deciding: { id: string; mode: "accept" | "reject"; note: string } | null;
  setDeciding: (value: { id: string; mode: "accept" | "reject"; note: string } | null) => void;
}) {
  const terms = quote.terms;
  const validityText = validityLabel(terms);
  return (
    <article className={styles.quote} aria-labelledby={`quote-${quote.id}`}>
      <div className={styles.quoteHead}>
        <h3 id={`quote-${quote.id}`}>Devis {quote.reference}</h3>
        <span className={statusTone(quote.status)}>{QUOTE_STATUS_LABELS[quote.status] ?? quote.status}</span>
        <span className={styles.meta}>Envoyé le {formatDateTimeUtc(quote.created_at)}</span>
        <span className={styles.amount}>{formatEuro(quote.total_cents)} TTC</span>
      </div>

      <div className={styles.section}>
        <h4>Validité</h4>
        <div className={styles.row}>
          <span className={validityTone(terms?.validity)}>{validityText}</span>
          {terms?.updated_at && <span className={styles.meta}>Renseignée le {formatDateTimeUtc(terms.updated_at)}</span>}
        </div>
        {terms?.validity === "expired" && quote.status === "sent" && (
          <p className={styles.meta}>Ce devis ne peut plus être accepté : sa validité est dépassée. L’artisan peut en envoyer une nouvelle version.</p>
        )}
        {canWrite(scope, quote.permissions.can_set_terms) && (
          <ValidityForm key={`${quote.id}-${terms?.updated_at ?? ""}`} terms={terms} busy={busy} onSubmit={async (validUntil) => void (await run({ action: "set_terms", quote_id: quote.id, valid_until: validUntil }))} />
        )}
      </div>

      <div className={styles.section}>
        <h4>Documents du devis</h4>
        <DocumentLinks documents={quote.documents} demo={demo} client={client} />
        {canWrite(scope, quote.permissions.can_generate) && (
          <div className={styles.actions}>
            <button type="button" className="button primary" disabled={busy} onClick={() => void run({ action: "generate", quote_id: quote.id, amendment_id: null })}>
              {pending === "generate" ? "Génération…" : quote.documents.length ? "Mettre à jour le PDF du devis" : "Générer le PDF du devis"}
            </button>
          </div>
        )}
        <details>
          <summary className="text-button">Voir les lignes du devis</summary>
          <LinesTable lines={quote.lines} subtotal={quote.subtotal_cents} taxRate={quote.tax_rate} tax={quote.tax_cents} total={quote.total_cents} caption={`Lignes du devis ${quote.reference}`} />
        </details>
      </div>

      <div className={styles.section}>
        <h4>Avenants</h4>
        {quote.status !== "accepted" && quote.amendments.length === 0 && <p className={styles.meta}>Les avenants ne concernent qu’un devis accepté.</p>}
        {quote.status === "accepted" && quote.amendments.length === 0 && <p className={styles.meta}>Aucun avenant proposé sur ce devis.</p>}
        {quote.amendments.map((amendment) => (
          <AmendmentCard key={amendment.id} amendment={amendment} quote={quote} scope={scope} busy={busy} pending={pending} demo={demo} client={client} run={run} deciding={deciding} setDeciding={setDeciding} />
        ))}
        {/* CLI-07: every party reads the same agreed total — base quote + ACCEPTED amendments only
            (amounts as returned by the server; proposed, refused and withdrawn ones are excluded). */}
        {quote.status === "accepted" && quote.amendments.some((a) => a.status === "accepted") && (
          <p className={styles.row} data-quote-accepted-total="">
            <span>Total TTC, avenants acceptés compris</span>
            <strong className={styles.amount}>{formatEuro(quote.total_cents + quote.amendments.filter((a) => a.status === "accepted").reduce((sum, a) => sum + a.total_cents, 0))}</strong>
            <span className={styles.meta}>
              Devis {formatEuro(quote.total_cents)} + {quote.amendments.filter((a) => a.status === "accepted").length > 1 ? "avenants acceptés" : "avenant accepté"} {formatEuro(quote.amendments.filter((a) => a.status === "accepted").reduce((sum, a) => sum + a.total_cents, 0))}
            </span>
          </p>
        )}
        {canWrite(scope, quote.permissions.can_propose) && !proposing && (
          <div className={styles.actions}>
            <button type="button" className="button outline" disabled={busy} onClick={() => setProposing(true)}>
              Proposer un avenant
            </button>
          </div>
        )}
        {canWrite(scope, quote.permissions.can_propose) && proposing && (
          <AmendmentForm
            quoteReference={quote.reference}
            busy={busy}
            onCancel={() => setProposing(false)}
            onSubmit={async (value) => {
              const ok = await run({ action: "propose", base_quote_id: quote.id, ...value });
              if (ok) setProposing(false);
            }}
          />
        )}
      </div>
    </article>
  );
}

function AmendmentCard({
  amendment,
  quote,
  scope,
  busy,
  pending,
  demo,
  client,
  run,
  deciding,
  setDeciding,
}: {
  amendment: OverviewAmendment;
  quote: OverviewQuote;
  scope: QuoteDocumentsScope;
  busy: boolean;
  pending: string | null;
  demo: boolean;
  client: QuoteDocumentsClient;
  run: (body: QuoteDocumentsCommand) => Promise<boolean>;
  deciding: { id: string; mode: "accept" | "reject"; note: string } | null;
  setDeciding: (value: { id: string; mode: "accept" | "reject"; note: string } | null) => void;
}) {
  const mine = deciding?.id === amendment.id ? deciding : null;
  const decide = canWrite(scope, amendment.permissions.can_decide);
  let decision: ReactNode = null;
  if (decide && !mine) {
    decision = (
      <div className={styles.actions}>
        <button type="button" className="button primary" disabled={busy} onClick={() => setDeciding({ id: amendment.id, mode: "accept", note: "" })}>
          Accepter l’avenant
        </button>
        <button type="button" className="button outline" disabled={busy} onClick={() => setDeciding({ id: amendment.id, mode: "reject", note: "" })}>
          Refuser
        </button>
      </div>
    );
  } else if (decide && mine) {
    decision = (
      <div className={styles.form} role="group" aria-label={`Décision sur l’avenant n° ${amendment.version}`}>
        {mine.mode === "accept" ? (
          <p className={styles.note}>
            Vous acceptez l’avenant n° {amendment.version} ({amendment.reference}) de {formatEuro(amendment.total_cents)} TTC, en plus du devis accepté {quote.reference}. Cette acceptation porte sur cette version exacte.
          </p>
        ) : (
          <div className="field">
            <label htmlFor={`note-${amendment.id}`}>Motif du refus (facultatif)</label>
            <textarea id={`note-${amendment.id}`} rows={2} maxLength={2000} value={mine.note} onChange={(e) => setDeciding({ ...mine, note: e.target.value })} disabled={busy} />
          </div>
        )}
        <div className={styles.actions}>
          <button
            type="button"
            className="button primary"
            disabled={busy}
            onClick={async () => {
              const ok = await run(mine.mode === "accept" ? { action: "accept", amendment_id: amendment.id } : { action: "reject", amendment_id: amendment.id, note: mine.note.trim() });
              if (ok) setDeciding(null);
            }}
          >
            {pending === mine.mode ? "Enregistrement…" : mine.mode === "accept" ? "Confirmer l’acceptation" : "Confirmer le refus"}
          </button>
          <button type="button" className="button outline" disabled={busy} onClick={() => setDeciding(null)}>
            Annuler
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className={styles.amendment}>
      <header>
        <strong>
          Avenant n° {amendment.version} — {amendment.reference}
        </strong>
        <span className={statusTone(amendment.status)}>{AMENDMENT_STATUS_LABELS[amendment.status]}</span>
        <span className={styles.meta}>Proposé le {formatDateTimeUtc(amendment.created_at)}</span>
        <span className={styles.amount}>{formatEuro(amendment.total_cents)} TTC</span>
      </header>
      <p className={styles.reason}>{amendment.reason}</p>
      <div className={styles.row}>
        <span className={validityTone(amendment.terms.validity)}>{validityLabel(amendment.terms)}</span>
        {amendment.decided_at && (
          <span className={styles.meta}>
            Décision le {formatDateTimeUtc(amendment.decided_at)}
            {amendment.decision_note ? ` — ${amendment.decision_note}` : ""}
          </span>
        )}
      </div>
      <details>
        <summary className="text-button">Voir les prestations de l’avenant</summary>
        <LinesTable lines={amendment.lines} subtotal={amendment.subtotal_cents} taxRate={amendment.tax_rate} tax={amendment.tax_cents} total={amendment.total_cents} caption={`Prestations de l’avenant ${amendment.reference}`} />
      </details>
      <DocumentLinks documents={amendment.documents} demo={demo} client={client} />
      {amendment.terms.validity === "expired" && amendment.status === "proposed" && (
        <p className={styles.meta}>La validité de cet avenant est dépassée : il ne peut plus être accepté. {formatDate(amendment.terms.valid_until)}</p>
      )}
      {decision}
      <div className={styles.actions}>
        {canWrite(scope, amendment.permissions.can_generate) && (
          <button type="button" className="button outline" disabled={busy} onClick={() => void run({ action: "generate", quote_id: quote.id, amendment_id: amendment.id })}>
            {amendment.documents.length ? "Mettre à jour le PDF de l’avenant" : "Générer le PDF de l’avenant"}
          </button>
        )}
        {canWrite(scope, amendment.permissions.can_withdraw) && (
          <button type="button" className="button outline" disabled={busy} onClick={() => void run({ action: "withdraw", amendment_id: amendment.id })}>
            {pending === "withdraw" ? "Retrait…" : "Retirer la proposition"}
          </button>
        )}
      </div>
    </div>
  );
}
