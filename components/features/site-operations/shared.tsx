"use client";
// Local primitives of the site operations lot. Only global CSS classes from app/globals.css
// (.button, .alert, .field, .tag, .empty-state, .unavailable) and the local CSS module are used;
// nothing is imported from components/app/**.
import { useId, useState, type FormEvent, type ReactNode } from "react";
import type { ZodType } from "zod";
import { fieldErrors, fromCents, fromInstant, orNull, toCents, toInstant, toInt } from "../../../lib/features/site-operations/forms";
import { type RunOutcome } from "../../../lib/features/site-operations/view-model";
import type { SiteOperationsCommand, SiteOperationsCommandResult, SiteOperationsReport } from "../../../lib/features/site-operations/types";
import styles from "./site-operations.module.css";

export { fieldErrors, fromCents, fromInstant, orNull, toCents, toInstant, toInt };
export type { RunOutcome };
/** Everything a panel receives from the view; panels never call the client themselves. */
export type PanelContext = {
  report: SiteOperationsReport;
  canWrite: boolean;
  canWriteOrganization: boolean;
  readOnlyReason: string | null;
  busy: boolean;
  run(command: SiteOperationsCommand): Promise<RunOutcome>;
  onNavigate?(view: string, param?: string): void;
};
export type Tone = "neutral" | "blue" | "green" | "amber" | "red" | "violet";

export function Tag({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`tag tag-${tone}`}>{children}</span>;
}
export function Notice({ tone, children, onClose }: { tone: "error" | "success" | "warning"; children: ReactNode; onClose?: () => void }) {
  return (
    <div className={`alert ${tone}`} role={tone === "error" ? "alert" : "status"}>
      <span>{children}</span>
      {onClose && (
        <button type="button" onClick={onClose} aria-label="Fermer ce message">
          ×
        </button>
      )}
    </div>
  );
}
export function Loading({ label }: { label: string }) {
  return (
    <div className={styles.loading} role="status">
      <span className={styles.spinner} aria-hidden="true" />
      {label}
    </div>
  );
}
export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}
export function ReadOnly({ reason }: { reason: string | null }) {
  return (
    <div className={styles.readOnly} role="note">
      <strong>Lecture seule</strong>
      <p>{reason ?? "Les modifications ne sont pas disponibles pour votre compte sur ce site."}</p>
    </div>
  );
}
export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: (props: { id: string; "aria-describedby": string | undefined; "aria-invalid": true | undefined }) => ReactNode }) {
  const id = useId();
  const describedBy = [hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div className={`field ${error ? "field-invalid" : ""}`}>
      <label htmlFor={id}>{label}</label>
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
      {hint && <small id={`${id}-hint`}>{hint}</small>}
      {error && (
        <small className="field-error" id={`${id}-error`} role="alert">
          {error}
        </small>
      )}
    </div>
  );
}
export function Truncated({ name, limited }: { name: string; limited: boolean }) {
  if (!limited) return null;
  return <p className={styles.truncated}>Liste tronquée : seuls les {name} les plus récents sont affichés. Les totaux ne couvrent pas les éléments non affichés.</p>;
}
/**
 * Submission guard shared by every form: validates locally, blocks double submission, keeps
 * values after failure, shows the server refusal as-is, and ignores a stale (null) outcome.
 */
export function useSubmit(context: PanelContext) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  async function submit(event: FormEvent, schema: ZodType, value: unknown, command: SiteOperationsCommand, onDone: (result: SiteOperationsCommandResult) => void, successText: string) {
    event.preventDefault();
    if (submitting || context.busy) return;
    const found = fieldErrors(schema, value);
    setErrors(found);
    setMessage(null);
    if (Object.keys(found).length) {
      setMessage({ tone: "error", text: found._ ?? "Vérifiez les champs signalés." });
      return;
    }
    setSubmitting(true);
    try {
      const outcome = await context.run(command);
      if (outcome.status === "failed") setMessage({ tone: "error", text: outcome.message });
      else if (outcome.status === "done") {
        setMessage({ tone: "success", text: successText });
        onDone(outcome.result);
      }
      // "stale": the identity chain changed; neither success nor update.
    } finally {
      setSubmitting(false);
    }
  }
  return { errors, message, setMessage, submitting, submit };
}
