"use client";
// Explicit validity of a sent quote. Clearing the date is allowed and then shown as
// "non renseignée"; a past date is refused here and again by the server.
import { useId, useState, type FormEvent } from "react";
import type { QuoteTerms } from "../../../lib/features/quote-documents/types";
import { validateValidUntil } from "../../../lib/features/quote-documents/validity";
import styles from "./quote-documents.module.css";

export function ValidityForm({
  terms,
  busy,
  onSubmit,
}: {
  terms: QuoteTerms | null;
  busy: boolean;
  onSubmit: (validUntil: string | null) => Promise<void>;
}) {
  const id = useId();
  const [value, setValue] = useState(terms?.valid_until ?? "");
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const check = validateValidUntil(value);
    if (!check.ok) {
      setError(check.message);
      return;
    }
    setError("");
    await onSubmit(check.value);
  };
  return (
    <form className={styles.form} onSubmit={(e) => void submit(e)} noValidate>
      <fieldset disabled={busy}>
        <legend>Validité du devis</legend>
        <div className={styles.inline}>
          <div className={`field ${error ? "field-invalid" : ""}`}>
            <label htmlFor={id}>Valable jusqu’au (inclus)</label>
            <input
              id={id}
              type="date"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`}
              aria-invalid={error ? true : undefined}
            />
            <small id={`${id}-hint`}>Laissez vide pour indiquer que la validité n’est pas renseignée. Dates évaluées en UTC.</small>
            {error && (
              <small className="field-error" id={`${id}-error`} role="alert">
                {error}
              </small>
            )}
          </div>
          <div className={styles.actions}>
            <button type="submit" className="button primary" disabled={busy}>
              {busy ? "Enregistrement…" : "Enregistrer la validité"}
            </button>
          </div>
        </div>
      </fieldset>
    </form>
  );
}
