"use client";
import { BRAND_NAME } from "@/lib/brand";
import {
  cloneElement,
  isValidElement,
  useId,
  useState,
  type ReactNode,
} from "react";
import { Icon } from "./icons";
import { STATUS, ARTISAN_STATUS } from "./format";
import { CONTRACT_MESSAGES } from "./api";
import type { ContractState, Status } from "./types";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="brand">
      <span className="brand-mark" aria-hidden="true">
        <img decoding="async" src="/brand/domdepannage-sigle.png" width={64} height={64} alt="" />
      </span>
      <span>
        {BRAND_NAME}
        {!compact && <small>Le dépannage électrique, au clair.</small>}
      </span>
    </span>
  );
}
export function Badge({
  status,
  wording = "client",
}: {
  status: Status;
  wording?: "client" | "artisan";
}) {
  return (
    <span className={`badge status-${status}`}>
      <span />
      {(wording === "artisan" ? ARTISAN_STATUS : STATUS)[status]}
    </span>
  );
}
export function Tag({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "blue" | "green" | "amber" | "red" | "violet";
  children: ReactNode;
}) {
  return <span className={`tag tag-${tone}`}>{children}</span>;
}
export type HeadingLevel = 1 | 2 | 3 | 4;
export function Empty({
  icon = "list",
  title,
  children,
  action,
  level = 3,
}: {
  icon?: string;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  /** Heading level of the title: 1 when this state IS the page's main content (e.g. a not-found
   *  page), otherwise the level under the surrounding heading. Default 3 (unchanged uses). */
  level?: HeadingLevel;
}) {
  const Heading = `h${level}` as "h1" | "h2" | "h3" | "h4";
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon name={icon} size={30} />
      </span>
      <Heading>{title}</Heading>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}
export function Loader({ label = "Chargement…" }: { label?: string }) {
  return (
    <div className="page-loader" role="status">
      <span className="spinner" />
      {label}
    </div>
  );
}
// Field associates label, hint and error with the control through ids (aria-describedby).
export function Field({
  label,
  children,
  hint,
  error,
  id,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  error?: string;
  id?: string;
}) {
  const generated = useId();
  const controlId = id || generated;
  const describedBy =
    [hint ? `${controlId}-hint` : "", error ? `${controlId}-error` : ""]
      .filter(Boolean)
      .join(" ") || undefined;
  // A single form control child receives the id and descriptions automatically.
  const control =
    isValidElement<Record<string, unknown>>(children) &&
    typeof children.type === "string" &&
    ["input", "select", "textarea"].includes(children.type)
      ? cloneElement(children, {
          id: (children.props.id as string | undefined) || controlId,
          "aria-describedby": describedBy,
          "aria-invalid": error ? true : undefined,
        })
      : children;
  return (
    <div className={`field ${error ? "field-invalid" : ""}`}>
      <label htmlFor={controlId}>{label}</label>
      {control}
      {hint && <small id={`${controlId}-hint`}>{hint}</small>}
      {error && (
        <small className="field-error" id={`${controlId}-error`} role="alert">
          {error}
        </small>
      )}
    </div>
  );
}
export function PageTitle({
  title,
  subtitle,
  action,
  back,
  level = 1,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  back?: { label: string; onClick: () => void };
  /** 2 when the surrounding shell already renders the page h1 (embedded page). Default 1. */
  level?: 1 | 2;
}) {
  const Heading = level === 2 ? "h2" : "h1";
  return (
    <>
      {back && (
        <button type="button" className="back-link" onClick={back.onClick}>
          <Icon name="back" size={17} />
          {back.label}
        </button>
      )}
      <div className="page-title">
        <div>
          <Heading>{title}</Heading>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {action}
      </div>
    </>
  );
}
export function Alerts({
  error,
  notice,
  onClearError,
  onClearNotice,
}: {
  error: string;
  notice: string;
  onClearError: () => void;
  onClearNotice: () => void;
}) {
  return (
    <>
      {error && (
        <div className="alert error" role="alert">
          <Icon name="warning" />
          <span>{error}</span>
          <button
            type="button"
            onClick={onClearError}
            aria-label="Fermer le message d’erreur"
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      )}
      {notice && (
        <div className="alert success" role="status">
          <Icon name="check" />
          <span>{notice}</span>
          <button
            type="button"
            onClick={onClearNotice}
            aria-label="Fermer le message"
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      )}
    </>
  );
}
// A function that is not usable right now, with the real reason. Never a dead button.
// `blocker` is kept as a data attribute for verification only; users see plain wording.
export function Unavailable({
  title,
  reason,
  state,
  blocker,
  children,
  onRetry,
  retryLabel = "Réessayer",
}: {
  title: string;
  reason?: string;
  state?: ContractState;
  blocker?: string;
  children?: ReactNode;
  /** Bounded recovery action (re-probe of the same contract under the same identity and rights). */
  onRetry?: () => void | Promise<void>;
  retryLabel?: string;
}) {
  const [retrying, setRetrying] = useState(false);
  const text =
    reason || (state && state !== "available" ? CONTRACT_MESSAGES[state] : "");
  async function retry() {
    if (!onRetry || retrying) return;
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  }
  return (
    <div className="unavailable" role="note" data-blocker={blocker}>
      <span className="unavailable-icon">
        <Icon name="lock" size={18} />
      </span>
      <div>
        <strong>{title}</strong>
        {text && <p>{text}</p>}
        {children}
        {onRetry && (
          <button type="button" className="button secondary unavailable-retry" onClick={() => void retry()} disabled={retrying} aria-busy={retrying}>
            {retrying ? "Nouvelle tentative…" : retryLabel}
          </button>
        )}
      </div>
    </div>
  );
}
export function ConfirmAction({
  label,
  message,
  confirmLabel,
  busy = false,
  danger = false,
  className,
  onConfirm,
}: {
  label: string;
  message: string;
  confirmLabel: string;
  busy?: boolean;
  danger?: boolean;
  className?: string;
  onConfirm: () => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  return (
    <div className={`inline-confirmation ${danger ? "destructive" : ""}`}>
      {!open ? (
        <button
          type="button"
          className={className || (danger ? "text-button danger" : "button outline")}
          disabled={busy}
          onClick={() => setOpen(true)}
        >
          {label}
        </button>
      ) : (
        <div className="confirmation-review">
          <p>{message}</p>
          <div>
            <button
              type="button"
              className={danger ? "button destructive-button" : "button primary"}
              disabled={busy || pending}
              onClick={async () => {
                setPending(true);
                try {
                  await onConfirm();
                  setOpen(false);
                } finally {
                  setPending(false);
                }
              }}
            >
              {pending ? "Enregistrement…" : confirmLabel}
            </button>
            <button
              type="button"
              className="button outline"
              disabled={busy || pending}
              onClick={() => setOpen(false)}
            >
              Annuler
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
// Segmented filter with accessible pressed state (not role=tab: no panel semantics needed).
export function Segments<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="tabs" role="group" aria-label={label}>
      {options.map(([id, text]) => (
        <button
          type="button"
          key={id}
          className={value === id ? "active" : ""}
          aria-pressed={value === id}
          onClick={() => onChange(id)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}
export function Stat({
  icon,
  tone = "blue",
  label,
  value,
  note,
}: {
  icon: string;
  tone?: "blue" | "green" | "amber" | "violet" | "navy";
  label: string;
  value: ReactNode;
  note?: ReactNode;
}) {
  return (
    <div className="stat">
      <span className={`stat-icon ${tone}`}>
        <Icon name={icon} />
      </span>
      <section>
        <span>{label}</span>
        <strong>{value}</strong>
        {note && <small>{note}</small>}
      </section>
    </div>
  );
}
// Rendered instead of a view the current role may not open (hash typed directly, stale link).
export function Forbidden({ onHome }: { onHome: () => void }) {
  return (
    <section className="panel forbidden" aria-labelledby="forbidden-title">
      <span className="empty-icon">
        <Icon name="lock" size={28} />
      </span>
      <h2 id="forbidden-title">Cette page ne fait pas partie de votre espace</h2>
      <p>
        Le lien demandé correspond à un autre rôle ou à une autre organisation.
        Aucune donnée n’a été chargée.
      </p>
      <button type="button" className="button primary" onClick={onHome}>
        Revenir à mon espace
      </button>
    </section>
  );
}
export function DemoNote({ children }: { children: ReactNode }) {
  return (
    <p className="demo-note">
      <Icon name="info" size={14} />
      {children}
    </p>
  );
}
