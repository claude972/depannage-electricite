"use client";
// Proposal of an amendment on an accepted quote. The preview totals are indicative; the server
// recomputes every amount and the amendment only applies once the decider accepts it.
import { useId, useState, type FormEvent } from "react";
import {
  MAX_LINES,
  emptyLine,
  lineInputErrors,
  previewTotals,
  validateAmendmentForm,
  type AmendmentFormErrors,
  type AmendmentFormInput,
  type LineInput,
} from "../../../lib/features/quote-documents/panel-model";
import { TAX_RATE_OPTIONS, TAX_RATE_PLACEHOLDER, TAX_RATE_HINT, TAX_RATE_REQUIRED, parseTaxRateInput } from "../../app/tax-rate";
import styles from "./quote-documents.module.css";

/** The submitted value is exactly what the (backend-owned) validator returns: no rate literal is
 *  restated here, so the type follows the canonical list once the backend widens it. */
export type AmendmentValue = Extract<ReturnType<typeof validateAmendmentForm>, { ok: true }>["value"];
/** Starts with NO rate: the issuer chooses explicitly. */
export const initialAmendmentInput = (): AmendmentFormInput => ({ lines: [emptyLine()], taxRate: "", reason: "", validUntil: "" });
/** Submit guard: an explicit supported rate (lib/tax-rates) first, then the shared validator. */
export function checkAmendment(input: AmendmentFormInput, now: Date = new Date()): { ok: true; value: AmendmentValue } | { ok: false; errors: AmendmentFormErrors } {
  const result = validateAmendmentForm(input, now);
  if (parseTaxRateInput(input.taxRate) === null) return { ok: false, errors: { ...(result.ok ? { lines: input.lines.map(() => ({})) } : result.errors), taxRate: TAX_RATE_REQUIRED } };
  return result;
}

export function AmendmentForm({
  quoteReference,
  busy,
  onSubmit,
  onCancel,
}: {
  quoteReference: string;
  busy: boolean;
  onSubmit: (value: AmendmentValue) => Promise<void>;
  onCancel: () => void;
}) {
  const id = useId();
  const [input, setInput] = useState<AmendmentFormInput>(initialAmendmentInput);
  const [errors, setErrors] = useState<AmendmentFormErrors | null>(null);
  const [touched, setTouched] = useState(false);
  const preview = previewTotals(input);
  const updateLine = (index: number, patch: Partial<LineInput>) =>
    setInput((s) => ({ ...s, lines: s.lines.map((l, i) => (i === index ? { ...l, ...patch } : l)) }));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    const result = checkAmendment(input);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors(null);
    await onSubmit(result.value);
  };
  return (
    <form className={styles.form} onSubmit={(e) => void submit(e)} noValidate aria-labelledby={`${id}-legend`}>
      <fieldset disabled={busy}>
        <legend id={`${id}-legend`}>Proposer un avenant au devis {quoteReference}</legend>
        <p className={styles.note}>
          L’avenant ajoute des prestations au devis accepté, sans le modifier. Il n’entre en vigueur qu’après acceptation explicite.
        </p>
        {errors?.form && (
          <p className="field-error" role="alert">
            {errors.form}
          </p>
        )}
        {input.lines.map((line, index) => {
          const lineErrors = touched ? (errors?.lines[index] ?? lineInputErrors(line)) : {};
          const base = `${id}-line-${index}`;
          return (
            <div className={styles.lineGrid} key={base}>
              <div className={`field ${lineErrors.label ? "field-invalid" : ""}`}>
                <label htmlFor={`${base}-label`}>Prestation {index + 1}</label>
                <input id={`${base}-label`} value={line.label} maxLength={160} onChange={(e) => updateLine(index, { label: e.target.value })} aria-invalid={lineErrors.label ? true : undefined} aria-describedby={lineErrors.label ? `${base}-label-error` : undefined} />
                {lineErrors.label && (
                  <small className="field-error" id={`${base}-label-error`}>
                    {lineErrors.label}
                  </small>
                )}
              </div>
              <div className={`field ${lineErrors.quantity ? "field-invalid" : ""}`}>
                <label htmlFor={`${base}-quantity`}>Quantité</label>
                <input id={`${base}-quantity`} inputMode="numeric" value={line.quantity} onChange={(e) => updateLine(index, { quantity: e.target.value })} aria-invalid={lineErrors.quantity ? true : undefined} aria-describedby={lineErrors.quantity ? `${base}-quantity-error` : undefined} />
                {lineErrors.quantity && (
                  <small className="field-error" id={`${base}-quantity-error`}>
                    {lineErrors.quantity}
                  </small>
                )}
              </div>
              <div className={`field ${lineErrors.price ? "field-invalid" : ""}`}>
                <label htmlFor={`${base}-price`}>Prix unitaire HT (€)</label>
                <input id={`${base}-price`} inputMode="decimal" value={line.price} onChange={(e) => updateLine(index, { price: e.target.value })} aria-invalid={lineErrors.price ? true : undefined} aria-describedby={lineErrors.price ? `${base}-price-error` : undefined} />
                {lineErrors.price && (
                  <small className="field-error" id={`${base}-price-error`}>
                    {lineErrors.price}
                  </small>
                )}
              </div>
              <button type="button" className={`button outline ${styles.remove}`} onClick={() => setInput((s) => ({ ...s, lines: s.lines.filter((_, i) => i !== index) }))} disabled={input.lines.length <= 1} aria-label={`Retirer la prestation ${index + 1}`}>
                Retirer
              </button>
            </div>
          );
        })}
        <div className={styles.actions}>
          <button type="button" className="button outline" onClick={() => setInput((s) => ({ ...s, lines: [...s.lines, emptyLine()] }))} disabled={input.lines.length >= MAX_LINES}>
            Ajouter une prestation
          </button>
        </div>
        <div className={styles.inline}>
          <div className={`field ${errors?.taxRate ? "field-invalid" : ""}`}>
            <label htmlFor={`${id}-tax`}>TVA</label>
            <select id={`${id}-tax`} value={input.taxRate} onChange={(e) => setInput((s) => ({ ...s, taxRate: e.target.value }))} aria-invalid={errors?.taxRate ? true : undefined} data-tax-rate="">
              <option value="">{TAX_RATE_PLACEHOLDER}</option>
              {TAX_RATE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            {errors?.taxRate ? <small className="field-error">{errors.taxRate}</small> : <small>{TAX_RATE_HINT}</small>}
          </div>
          <div className={`field ${errors?.validUntil ? "field-invalid" : ""}`}>
            <label htmlFor={`${id}-valid`}>Valable jusqu’au (facultatif)</label>
            <input id={`${id}-valid`} type="date" value={input.validUntil} onChange={(e) => setInput((s) => ({ ...s, validUntil: e.target.value }))} aria-invalid={errors?.validUntil ? true : undefined} />
            {errors?.validUntil && <small className="field-error">{errors.validUntil}</small>}
          </div>
        </div>
        <div className={`field ${errors?.reason ? "field-invalid" : ""}`}>
          <label htmlFor={`${id}-reason`}>Motif de l’avenant</label>
          <textarea id={`${id}-reason`} rows={3} maxLength={2000} value={input.reason} onChange={(e) => setInput((s) => ({ ...s, reason: e.target.value }))} aria-invalid={errors?.reason ? true : undefined} />
          {errors?.reason && <small className="field-error">{errors.reason}</small>}
        </div>
        <div className={styles.preview} aria-live="polite">
          {preview ? (
            <>
              <span>
                Sous-total HT <strong>{preview.subtotal}</strong>
              </span>
              <span>
                TVA {preview.taxLabel} <strong>{preview.tax}</strong>
              </span>
              <span>
                Total TTC indicatif <strong>{preview.total}</strong>
              </span>
            </>
          ) : (
            <span>Totaux calculés par le serveur à l’envoi.</span>
          )}
        </div>
        <div className={styles.actions}>
          <button type="submit" className="button primary" disabled={busy}>
            {busy ? "Envoi…" : "Proposer l’avenant"}
          </button>
          <button type="button" className="button outline" onClick={onCancel} disabled={busy}>
            Annuler
          </button>
        </div>
      </fieldset>
    </form>
  );
}
