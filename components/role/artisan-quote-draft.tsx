"use client";
// Quote draft editor of the assigned artisan (contract WEB-PWA-QUOTE-DRAFT-001).
// Saving a draft is never sending it: publication is a distinct, explicit command. Every
// call goes through `session`; a 409 keeps the typed lines and offers an explicit reload.
// When the draft route is unavailable, the direct send editor (forms.QuoteEditor) remains.
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Session } from "../app/session-types";
import type { Line, Quote, QuoteDraftCommand, QuoteDraftEnvelope } from "../app/types";
import { Icon } from "../app/icons";
import { ConfirmAction, Field, Loader, Unavailable } from "../app/ui";
import { QuoteEditor } from "../app/forms";
import { dateTime, money, quoteRef } from "../app/format";
import styles from "./artisan-quote-draft.module.css";

type EditLine = { label: string; quantity: string; price: string };
type LineErrors = { label?: string; quantity?: string; price?: string };
type Pending = "save" | "discard" | "send" | "reload" | null;
type Phase = "loading" | "unavailable" | "ready";
/** A 409 (or an externally published quote). `server` is set once the envelope has been
 *  re-read and differs from the typed lines: the artisan then chooses, never the browser. */
type Conflict = { message: string; server?: QuoteDraftEnvelope };

const TAX_RATES = [0, 5.5, 10, 20];
const MAX_LINES = 30;
const MAX_LABEL = 160;
const MAX_QUANTITY = 1000;
const MAX_PRICE_CENTS = 10_000_000;
const DEFAULT_LINES: EditLine[] = [
  { label: "Déplacement", quantity: "1", price: "0" },
  { label: "Main-d’œuvre", quantity: "1", price: "0" },
];

function fromLines(lines: Line[]): EditLine[] {
  return lines.map((l) => ({
    label: l.label,
    quantity: String(l.quantity),
    price: String(l.unit_price_cents / 100),
  }));
}
function parseQuantity(raw: string): number | null {
  if (!raw.trim()) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= MAX_QUANTITY ? n : null;
}
function parsePrice(raw: string): number | null {
  if (!raw.trim()) return null;
  const n = Number(raw.replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(n)) return null;
  const cents = Math.round(n * 100);
  return cents >= 0 && cents <= MAX_PRICE_CENTS ? cents : null;
}
// `strict` also flags empty numbers (after a save/send attempt); otherwise only typed values
// that cannot be saved are reported, so the artisan is not scolded while filling a line.
function lineErrors(l: EditLine, strict: boolean): LineErrors {
  const e: LineErrors = {};
  if (l.label.length > MAX_LABEL) e.label = `${MAX_LABEL} caractères maximum.`;
  if ((strict || l.quantity.trim()) && parseQuantity(l.quantity) === null)
    e.quantity = "Entier de 1 à 1 000.";
  if ((strict || l.price.trim()) && parsePrice(l.price) === null)
    e.price = "Montant de 0 à 100 000 € HT.";
  return e;
}
/** Lines as the contract expects them, or null when a typed value cannot be saved. */
function toLines(lines: EditLine[]): Line[] | null {
  const out: Line[] = [];
  for (const l of lines) {
    const quantity = parseQuantity(l.quantity);
    const unit_price_cents = parsePrice(l.price);
    if (quantity === null || unit_price_cents === null || l.label.length > MAX_LABEL) return null;
    out.push({ label: l.label, quantity, unit_price_cents });
  }
  return out;
}
function sameDraft(a: Line[] | null, aTax: number | null, b: Line[], bTax: number | null) {
  if (!a || a.length !== b.length || aTax !== bTax) return false;
  return a.every((l, i) => {
    const other = b[i];
    return (
      !!other &&
      l.label === other.label &&
      l.quantity === other.quantity &&
      l.unit_price_cents === other.unit_price_cents
    );
  });
}
/** Newest quote still "sent" on the dossier, i.e. the proposal the client currently sees. */
function newestSent(quotes: Quote[], interventionId: string): Quote | undefined {
  return quotes
    .filter((q) => q.intervention_id === interventionId && q.status === "sent")
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
}
function taxLabel(rate: number | null) {
  return rate === null ? "TVA : taux à choisir" : `TVA ${String(rate).replace(".", ",")} %`;
}

function DraftSummary({
  rows,
  footer,
}: {
  rows: { label: string; detail: string }[];
  footer: string;
}) {
  return (
    <>
      {rows.length === 0 ? (
        <p className={styles.summaryEmpty}>Aucune ligne.</p>
      ) : (
        <ul className={styles.summary}>
          {rows.map((r, index) => (
            <li key={index}>
              {r.label}
              <span>{r.detail}</span>
            </li>
          ))}
        </ul>
      )}
      <p className={styles.summaryFooter}>{footer}</p>
    </>
  );
}

export function QuoteDraftEditor({
  session,
  interventionId,
  onPublished,
  replaces,
}: {
  session: Session;
  interventionId: string;
  /** After a successful publication: the exact quote id when the server gives it, otherwise
   *  undefined and the caller selects the newest sent quote of the dossier. */
  onPublished: (quoteId: string | undefined) => void;
  /** Sent quote that a publication from this editor replaces (dossier status "quoted"). */
  replaces?: Quote;
}) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [envelope, setEnvelope] = useState<QuoteDraftEnvelope | null>(null);
  const [lines, setLines] = useState<EditLine[]>(DEFAULT_LINES);
  const [taxRate, setTaxRate] = useState<number | null>(null);
  const [touched, setTouched] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [failure, setFailure] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  // Callbacks read the latest session without re-running the load effect on every render.
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const seq = useRef(0);

  const applyEnvelope = (env: QuoteDraftEnvelope, resetLines: boolean) => {
    setEnvelope(env);
    if (!resetLines) return;
    setLines(env.draft ? fromLines(env.draft.lines) : DEFAULT_LINES);
    setTaxRate(env.draft ? env.draft.tax_rate : null);
    setTouched(false);
  };

  // Initial load (and reload after a publication, once the workspace has been re-read).
  useEffect(() => {
    const my = ++seq.current;
    setPhase("loading");
    setConflict(null);
    setFailure("");
    void sessionRef.current.loadQuoteDraft(interventionId).then((env) => {
      if (my !== seq.current) return;
      if (!env) {
        setPhase("unavailable");
        return;
      }
      applyEnvelope(env, true);
      setPhase("ready");
    });
    return () => {
      seq.current++;
    };
  }, [interventionId, reloadKey]);

  const parsed = toLines(lines);
  const errors = lines.map((l) => lineErrors(l, touched));
  const tooMany = lines.length > MAX_LINES;
  const saveValid = parsed !== null && !tooMany;
  const subtotal = parsed ? parsed.reduce((n, l) => n + l.quantity * l.unit_price_cents, 0) : 0;
  const tax = taxRate === null ? 0 : Math.round((subtotal * taxRate) / 100);
  const missing: string[] = [];
  if (!parsed) missing.push("des quantités et prix valides");
  else {
    if (parsed.length === 0) missing.push("au moins une ligne");
    if (parsed.some((l) => !l.label.trim())) missing.push("un libellé sur chaque ligne");
    if (subtotal <= 0) missing.push("un total HT supérieur à zéro");
  }
  if (taxRate === null) missing.push("un taux de TVA");
  const publishable = saveValid && missing.length === 0;
  const draft = envelope?.draft ?? null;
  const dirty = draft ? !sameDraft(parsed, taxRate, draft.lines, draft.tax_rate) : true;
  const sent = newestSent(session.data.quotes, interventionId);
  // A quote published outside this draft (other tab, direct send): the server would answer
  // 409 anyway; say it before the attempt and require a reload.
  const external =
    phase === "ready" && !!envelope && !conflict && (sent?.id ?? null) !== envelope.current_quote_id;
  const busy = session.busy || pending !== null;
  const locked = busy || !!conflict || external;

  const command = async (body: QuoteDraftCommand, kind: Exclude<Pending, null>) => {
    setPending(kind);
    setFailure("");
    try {
      return await sessionRef.current.quoteDraftCommand(interventionId, body);
    } finally {
      setPending(null);
    }
  };
  const save = async (base: QuoteDraftEnvelope | null = envelope) => {
    setTouched(true);
    if (!base || !parsed || tooMany) return null;
    const result = await command(
      {
        action: "save",
        expected_version: base.version,
        assignment_token: base.assignment_token,
        base_quote_id: base.current_quote_id,
        lines: parsed,
        tax_rate: taxRate,
      },
      "save",
    );
    if (result.ok) {
      setEnvelope(result.envelope);
      setConflict(null);
      return result.envelope;
    }
    if (result.conflict) setConflict({ message: result.message });
    else setFailure(result.message);
    return null;
  };
  const send = async () => {
    setTouched(true);
    if (!envelope || !publishable) return;
    // The server publishes the stored draft: unsaved changes are saved first, explicitly.
    let base = envelope;
    if (dirty) {
      const saved = await save(envelope);
      if (!saved) return;
      base = saved;
    }
    const result = await command(
      { action: "send", expected_version: base.version, assignment_token: base.assignment_token },
      "send",
    );
    if (result.ok) {
      setEnvelope(result.envelope);
      setLines(DEFAULT_LINES);
      setTaxRate(null);
      setTouched(false);
      setConflict(null);
      onPublished(result.envelope.quote_id);
      // Re-read once the workspace has been refreshed: the new envelope then names the
      // published quote as current, so it is never reported as "another channel".
      setPhase("loading");
      setReloadKey((k) => k + 1);
      return;
    }
    if (result.conflict) setConflict({ message: result.message });
    else setFailure(result.message);
  };
  const discard = async () => {
    if (!envelope?.draft) return;
    const result = await command(
      {
        action: "discard",
        expected_version: envelope.version,
        assignment_token: envelope.assignment_token,
      },
      "discard",
    );
    if (result.ok) applyEnvelope(result.envelope, true);
    else if (result.conflict) setConflict({ message: result.message });
    else setFailure(result.message);
  };
  // Re-reads the envelope. Identical server draft: adopt it silently. Different: show both
  // versions and let the artisan choose. Never resolves a conflict on its own.
  const reload = async (reason?: string) => {
    const my = ++seq.current;
    setPending("reload");
    setFailure("");
    const env = await sessionRef.current.loadQuoteDraft(interventionId);
    if (my !== seq.current) return;
    setPending(null);
    if (!env) {
      setPhase("unavailable");
      return;
    }
    setPhase("ready");
    const typedIsDefault = sameDraft(parsed, taxRate, toLines(DEFAULT_LINES) ?? [], null);
    const same = env.draft
      ? sameDraft(parsed, taxRate, env.draft.lines, env.draft.tax_rate)
      : typedIsDefault;
    if (same) {
      applyEnvelope(env, true);
      setConflict(null);
      return;
    }
    setConflict({ message: conflict?.message ?? reason ?? "", server: env });
  };
  const takeServer = () => {
    if (!conflict?.server) return;
    applyEnvelope(conflict.server, true);
    setConflict(null);
  };
  const keepMine = async () => {
    if (!conflict?.server) return;
    const server = conflict.server;
    setEnvelope(server);
    setConflict(null);
    await save(server);
  };
  const update = (index: number, patch: Partial<EditLine>) =>
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));

  if (phase === "loading")
    return (
      <section className={`panel ${styles.editor}`} aria-labelledby="quote-draft-title">
        <h2 id="quote-draft-title">{replaces ? "Réviser le devis" : "Établir le devis"}</h2>
        <Loader label="Lecture du brouillon…" />
      </section>
    );

  if (phase === "unavailable")
    return (
      <div className={styles.fallback}>
        <Unavailable
          title="Brouillon de devis"
          state={session.capabilities.quoteDraft}
          blocker="quote-draft-route"
        >
          <p>Brouillon indisponible ; l’envoi direct reste possible.</p>
          {replaces && (
            <p>
              Le devis envoyé {quoteRef(replaces.id)} ({money(replaces.total_cents)} TTC) sera
              remplacé par un envoi direct.
            </p>
          )}
          <button
            type="button"
            className="button outline"
            disabled={busy}
            onClick={() => void reload()}
          >
            {pending === "reload" ? "Nouvelle tentative…" : "Réessayer le brouillon"}
          </button>
        </Unavailable>
        <QuoteEditor
          busy={session.busy}
          demo={session.mode === "demo"}
          onSubmit={(values) =>
            void sessionRef.current
              .action(interventionId, "send_quote", values)
              .then((ok) => ok && onPublished(undefined))
          }
        />
      </div>
    );

  const typedRows = lines.map((l) => ({
    label: l.label.trim() || "(sans libellé)",
    detail: `${l.quantity || "?"} × ${l.price || "?"} € HT`,
  }));
  const serverDraft = conflict?.server?.draft ?? null;
  const serverRows = (serverDraft?.lines ?? []).map((l) => ({
    label: l.label.trim() || "(sans libellé)",
    detail: `${l.quantity} × ${money(l.unit_price_cents)} HT`,
  }));
  const reloadButton = (
    <button type="button" className="button outline" disabled={busy} onClick={() => void reload()}>
      {pending === "reload" ? "Rechargement…" : "Recharger le brouillon"}
    </button>
  );
  let status: ReactNode;
  if (draft)
    status = (
      <>
        Brouillon enregistré le {dateTime(draft.updated_at)}
        {dirty ? " — modifications non enregistrées" : ""}
      </>
    );
  else status = "Brouillon non enregistré";

  return (
    <section
      className={`panel ${styles.editor}`}
      aria-labelledby="quote-draft-title"
      aria-busy={pending !== null || undefined}
    >
      <div className={styles.head}>
        <div>
          <h2 id="quote-draft-title">{replaces ? "Réviser le devis" : "Établir le devis"}</h2>
          <p className={styles.lead}>
            Enregistrez votre brouillon à tout moment : il reste privé tant que vous n’envoyez
            pas le devis au client.
          </p>
        </div>
        <p className={styles.saved} role="status">
          {status}
        </p>
      </div>
      {replaces && (
        <p className={styles.note}>
          <Icon name="info" size={16} />
          <span>
            Devis envoyé {quoteRef(replaces.id)} ({money(replaces.total_cents)} TTC) : sa
            publication le remplacera pour le client.
          </span>
        </p>
      )}

      {conflict && (
        <div className={`alert warning ${styles.conflict}`} role="alert">
          <Icon name="warning" size={17} />
          <div className={styles.conflictBody}>
            <p>
              <strong>Brouillon modifié depuis votre dernière lecture.</strong>
              {conflict.message ? ` ${conflict.message}` : ""}
            </p>
            {!conflict.server ? (
              <>
                <p>Votre saisie est conservée. Rechargez le brouillon pour continuer.</p>
                <div className={styles.actions}>{reloadButton}</div>
              </>
            ) : (
              <>
                <p>
                  La version enregistrée diffère de votre saisie. Choisissez celle à conserver ;
                  rien n’est décidé automatiquement.
                </p>
                <div className={styles.compare}>
                  <div>
                    <h3>Votre saisie</h3>
                    <DraftSummary rows={typedRows} footer={taxLabel(taxRate)} />
                  </div>
                  <div>
                    <h3>Version enregistrée</h3>
                    {serverDraft ? (
                      <DraftSummary rows={serverRows} footer={taxLabel(serverDraft.tax_rate)} />
                    ) : (
                      <p className={styles.summaryEmpty}>
                        Aucun brouillon enregistré sur la plateforme
                        {conflict.server.current_quote_id
                          ? ` ; devis envoyé ${quoteRef(conflict.server.current_quote_id)}`
                          : ""}
                        .
                      </p>
                    )}
                  </div>
                </div>
                <div className={styles.actions}>
                  <button
                    type="button"
                    className="button outline"
                    disabled={busy}
                    onClick={takeServer}
                  >
                    Reprendre la version enregistrée
                  </button>
                  <button
                    type="button"
                    className="button primary"
                    disabled={busy || !saveValid}
                    onClick={() => void keepMine()}
                  >
                    {pending === "save" ? "Enregistrement…" : "Conserver ma saisie"}
                  </button>
                </div>
                {!saveValid && (
                  <p>Corrigez les valeurs signalées ci-dessous pour conserver votre saisie.</p>
                )}
              </>
            )}
          </div>
        </div>
      )}
      {external && (
        <div className={`alert warning ${styles.conflict}`} role="alert">
          <Icon name="warning" size={17} />
          <div className={styles.conflictBody}>
            <p>
              <strong>Un devis a été publié par un autre canal.</strong> Rechargez le brouillon
              avant d’enregistrer ; votre saisie est conservée.
            </p>
            <div className={styles.actions}>{reloadButton}</div>
          </div>
        </div>
      )}
      {failure && (
        <div className={`alert error ${styles.failure}`} role="alert">
          <Icon name="warning" size={17} />
          <span>{failure}</span>
        </div>
      )}

      <div className={styles.rows}>
        {lines.length === 0 && (
          <p className={styles.emptyLines}>Aucune ligne. Ajoutez une prestation pour commencer.</p>
        )}
        {lines.map((l, index) => {
          const e = errors[index] ?? {};
          return (
            <div className={styles.row} key={index}>
              <Field label={`Prestation ${index + 1}`} error={e.label}>
                <input
                  type="text"
                  maxLength={MAX_LABEL}
                  value={l.label}
                  placeholder="Libellé de la prestation"
                  onChange={(ev) => update(index, { label: ev.target.value })}
                />
              </Field>
              <Field label="Quantité" error={e.quantity}>
                <input
                  type="number"
                  inputMode="numeric"
                  min="1"
                  max={MAX_QUANTITY}
                  step="1"
                  value={l.quantity}
                  onChange={(ev) => update(index, { quantity: ev.target.value })}
                />
              </Field>
              <Field label="Prix unitaire HT (€)" error={e.price}>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  max={MAX_PRICE_CENTS / 100}
                  step="0.01"
                  value={l.price}
                  onChange={(ev) => update(index, { price: ev.target.value })}
                />
              </Field>
              <button
                type="button"
                className={`icon-button ${styles.remove}`}
                aria-label={`Supprimer la prestation ${index + 1}`}
                disabled={busy}
                onClick={() => setLines((prev) => prev.filter((_, j) => j !== index))}
              >
                <Icon name="close" size={17} />
              </button>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        className="text-button"
        disabled={busy || lines.length >= MAX_LINES}
        onClick={() =>
          setLines((prev) => [...prev, { label: "", quantity: "1", price: "0" }])
        }
      >
        <Icon name="plus" size={17} />
        Ajouter une ligne
      </button>
      {lines.length >= MAX_LINES && (
        <p className={styles.hint}>{MAX_LINES} lignes maximum par devis.</p>
      )}

      <div className={styles.tax}>
        <Field
          label="Taux de TVA (%)"
          hint={
            session.mode === "demo"
              ? "Taux de démonstration, sans validation fiscale."
              : "Renseignez le taux applicable à votre prestation."
          }
          error={touched && taxRate === null ? "Choisissez le taux pour pouvoir envoyer." : undefined}
        >
          <select
            value={taxRate === null ? "" : String(taxRate)}
            onChange={(ev) => setTaxRate(ev.target.value === "" ? null : Number(ev.target.value))}
          >
            <option value="">Choisir un taux</option>
            {TAX_RATES.map((r) => (
              <option key={r} value={String(r)}>
                {String(r).replace(".", ",")} %
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className={styles.totals}>
        <div>
          <span>Total HT</span>
          <strong>{parsed ? money(subtotal) : "—"}</strong>
        </div>
        <div>
          <span>{taxRate === null ? "TVA (taux à choisir)" : `TVA (${String(taxRate).replace(".", ",")} %)`}</span>
          <strong>{parsed && taxRate !== null ? money(tax) : "—"}</strong>
        </div>
        <div className={styles.total}>
          <span>Total TTC</span>
          <strong>{parsed && taxRate !== null ? money(subtotal + tax) : "—"}</strong>
        </div>
        <small className={styles.estimate}>
          Estimation d’affichage ; montants recalculés par la plateforme à l’envoi.
        </small>
      </div>

      <div className={styles.actions}>
        <button
          type="button"
          className="button outline"
          disabled={locked || !saveValid}
          onClick={() => void save()}
        >
          {pending === "save" ? "Enregistrement…" : "Enregistrer le brouillon"}
        </button>
        {draft && (
          <ConfirmAction
            label="Abandonner le brouillon"
            message="Le brouillon privé sera effacé. Aucun devis déjà envoyé n’est modifié."
            confirmLabel={pending === "discard" ? "Abandon…" : "Abandonner"}
            danger
            busy={locked}
            onConfirm={discard}
          />
        )}
        <button
          type="button"
          className="button primary"
          disabled={locked || !publishable}
          onClick={() => void send()}
        >
          <Icon name="send" />
          {pending === "send" ? "Envoi au client…" : "Envoyer le devis au client"}
        </button>
      </div>
      {!publishable && !tooMany && (
        <p className={styles.hint}>Pour envoyer, il manque : {missing.join(", ")}.</p>
      )}
      {tooMany && <p className={styles.hint}>Réduisez à {MAX_LINES} lignes pour enregistrer.</p>}
      {publishable && dirty && (
        <p className={styles.hint}>
          L’envoi enregistre d’abord votre saisie, puis publie le devis au client.
        </p>
      )}
    </section>
  );
}
