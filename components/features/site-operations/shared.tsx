"use client";
// Local primitives of the site operations lot. Only global CSS classes from app/globals.css
// (.button, .alert, .field, .tag, .empty-state, .unavailable) and the local CSS module are used;
// nothing is imported from components/app/**.
import { useCallback, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { ZodType } from "zod";
import { fieldErrors, fromCents, fromInstant, orNull, toCents, toInstant, toInt } from "../../../lib/features/site-operations/forms";
import { type RunOutcome } from "../../../lib/features/site-operations/view-model";
import type { SiteOperationsCommand, SiteOperationsCommandResult, SiteOperationsReport } from "../../../lib/features/site-operations/types";
import styles from "./site-operations.module.css";

export { fieldErrors, fromCents, fromInstant, orNull, toCents, toInstant, toInt };
export type { RunOutcome };
/** Everything a panel receives from the view; panels never call the client themselves. */
/** ENT-07: identity-bound access to the paginated enterprise intervention search (site + organisation). */
export type InterventionSearchBinding = {
  context: { generation(): number; userId(): string | null };
  api?: import("../enterprise-search/model").SearchApi;
};
export type PanelContext = {
  demo?: boolean;
  report: SiteOperationsReport;
  /** Absent (demo, no identity) ⇒ no intervention list is read; the existing link stays as is. */
  interventionSearch?: InterventionSearchBinding;
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
export function Notice({ tone, children, onClose }: { tone: "error" | "success" | "warning" | "info"; children: ReactNode; onClose?: () => void }) {
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
export function Field({ label, hint, error, required = false, children }: { label: string; hint?: string; error?: string; required?: boolean; children: (props: { required?: boolean; id: string; "aria-describedby": string | undefined; "aria-invalid": true | undefined }) => ReactNode }) {
  const id = useId();
  const describedBy = [hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div className={`field ${error ? "field-invalid" : ""}`}>
      <label htmlFor={id}>{label}{required && " (obligatoire)"}</label>
      {children({ id, required, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
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
  const [message, setMessage] = useState<{ tone: "error" | "success" | "info"; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const opener = useRef<{ element: HTMLElement; scope: Element | null; text: string } | null>(null);
  const begin = () => {
    const element = document.activeElement;
    if (element instanceof HTMLElement) opener.current = { element, scope: element.closest("section"), text: element.textContent?.trim() ?? "" };
    setErrors({});
    setMessage(null);
  };
  const formRef = useCallback((node: HTMLFormElement | null) => {
    if (!node) return;
    const frame = requestAnimationFrame(() => node.querySelector<HTMLElement>("input:not([disabled]), select:not([disabled]), textarea:not([disabled])")?.focus());
    return () => {
      cancelAnimationFrame(frame);
      setErrors({});
      setMessage((current) => current?.tone === "success" ? current : null);
      const origin = opener.current;
      requestAnimationFrame(() => {
        if (!origin?.scope?.isConnected) return;
        const target = origin.element.isConnected ? origin.element : [...origin.scope.querySelectorAll<HTMLElement>("button")].find(button => button.textContent?.trim() === origin.text);
        target?.focus();
      });
    };
  }, []);
  const demoNotice = context.demo ? <p className={styles.demoBanner} role="note">Démonstration : vous pouvez explorer et vérifier ce formulaire, mais aucun enregistrement n’est possible.</p> : null;
  /** E22: synchronous lock — two submissions in the same loop (before any render) send one POST. */
  const lock = useRef(false);
  async function submit(event: FormEvent, schema: ZodType, value: unknown, command: SiteOperationsCommand, onDone: (result: SiteOperationsCommandResult) => void, successText: string) {
    event.preventDefault();
    const element = event.currentTarget as HTMLFormElement;
    if (lock.current || submitting || context.busy) return;
    // E06: a form left open after the rights were re-read as read-only never posts.
    if (!context.canWrite) {
      setMessage({ tone: "error", text: context.readOnlyReason ?? "Lecture seule : vos droits actuels ne permettent pas cette modification." });
      return;
    }
    const found = fieldErrors(schema, value);
    setErrors(found);
    setMessage(null);
    if (Object.keys(found).length) {
      setMessage({ tone: "error", text: found._ ?? "Vérifiez les champs signalés." });
      requestAnimationFrame(() => element.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    if (context.demo) {
      setMessage({ tone: "info", text: "Formulaire vérifié. Aucun enregistrement n’est effectué en démonstration." });
      return;
    }
    lock.current = true;
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
      lock.current = false;
      setSubmitting(false);
    }
  }
  return { errors, message, setMessage, submitting, submit, begin, formRef, demoNotice };
}
