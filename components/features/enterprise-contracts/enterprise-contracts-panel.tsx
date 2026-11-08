"use client";
// ENT-13 — live « Contrats cadres » of the active organisation: paged server list (50, newest first,
// « Afficher plus » with dedup; 422 cursor ⇒ page 1), detail (terms) read when a contract is opened.
// Bound at render to identity + organisation + write epoch (+ contract id for the detail): an old
// frame is never shown and late replies are dropped. Writes stay the existing save_contract command
// (passed in by the host); after a write the host bumps `epoch` ⇒ fresh page 1 + the open detail.
import { useEffect, useRef, useState } from "react";
import { Icon } from "../../app/icons";
import { date } from "../../app/format";
import {
  CONTRACTS_COPY as COPY,
  STATUS_LABEL,
  createContracts,
  detailUrl,
  getJson,
  identityKey,
  listInitial,
  parseContract,
  type Context,
  type ContractDetail,
  type ListState,
} from "./model";
import styles from "./enterprise-contracts.module.css";

/** Typed context the enterprise host passes to ProfessionalOperations (wired by ROOT). */
export type EnterpriseContractsContext = {
  organizationId: string | null;
  context: Context;
  fetcher?: typeof fetch;
};
/** No identity: nothing is read. */
export const NO_CONTRACTS_CONTEXT: Context = { generation: () => 0, userId: () => null };

export type EnterpriseContractsProps = {
  context: Context;
  organizationId: string | null | undefined;
  /** Bumped by the host after each successful write: invalidates every older read. */
  epoch: number;
  canWrite: boolean;
  busy: boolean;
  /** The existing save_contract command (unchanged payload). */
  onSave: (values: Record<string, unknown>) => Promise<boolean | undefined>;
  fetcher?: typeof fetch;
};

function useWaiting(until: number): boolean {
  const [, tick] = useState(0);
  const waiting = until > Date.now();
  useEffect(() => {
    if (!waiting) return;
    const t = setTimeout(() => tick((n) => n + 1), Math.max(0, until - Date.now()) + 20);
    return () => clearTimeout(t);
  }, [until, waiting]);
  return waiting;
}

export function EnterpriseContractsPanel({ context, organizationId, epoch, canWrite, busy, onSave, fetcher }: EnterpriseContractsProps) {
  const base = identityKey(context, organizationId);
  const [nonce, setNonce] = useState(0);
  const key = base ? `${base}|${epoch}|${nonce}` : null;
  const [state, setRaw] = useState<ListState>(() => listInitial(""));
  const ref = useRef(state);
  const set = (s: ListState) => {
    ref.current = s;
    setRaw(s);
  };
  const latest = useRef({ fetcher, context });
  useEffect(() => {
    latest.current = { fetcher, context };
  });
  const ctrl = useRef<{ key: string; c: ReturnType<typeof createContracts> } | null>(null);
  useEffect(() => {
    if (!key || !organizationId) return;
    const c = createContracts({
      fetcher: () => latest.current.fetcher ?? ((...a) => fetch(...a)),
      organizationId,
      key,
      context: { generation: () => latest.current.context.generation(), userId: () => latest.current.context.userId() },
      get: () => ref.current,
      set,
    });
    ctrl.current = { key, c };
    void c.load();
    return () => c.dispose();
    // key carries identity + organisation + epoch + retry nonce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  // The open contract belongs to one identity + organisation.
  const [open, setOpen] = useState<{ base: string | null; id: string | null }>({ base, id: null });
  const openId = open.base === base ? open.id : null;
  const s = key && state.key === key ? state : listInitial(key ?? "");
  const waiting = useWaiting(s.retryAt);
  const c = ctrl.current && ctrl.current.key === key ? ctrl.current.c : null;

  // The opened contract is an autonomous panel (exact point read), not a list row: it survives the
  // post-write return to page 1 and is cleared on a list refusal or an identity/org change.
  const shownId = s.phase === "refused" ? null : openId;
  useEffect(() => {
    if (shownId) document.querySelector<HTMLElement>(`[data-contract-panel="${shownId}"]`)?.focus();
  }, [shownId]);
  if (!base || !organizationId) return <p className={styles.hint} data-contracts="choose">{COPY.choose}</p>;
  return (
    <div data-contracts={s.phase} aria-busy={s.phase === "loading" || s.loadingMore || undefined}>
      {shownId && (
        <section className={styles.note} aria-label="Contrat ouvert" tabIndex={-1} data-contract-panel={shownId}>
          <button type="button" className={styles.button} onClick={() => setOpen({ base, id: null })} data-contract-close="">
            Fermer le contrat
          </button>
          <ContractDetailView
            key={`${base}|${shownId}`}
            id={`contract-${shownId}`}
            context={context}
            organizationId={organizationId}
            contractId={shownId}
            epoch={epoch}
            canWrite={canWrite}
            busy={busy}
            onSave={onSave}
            fetcher={fetcher}
          />
        </section>
      )}
      {s.notice && <p className={styles.note} role="status" data-contracts-notice="">{s.notice}</p>}
      {s.phase === "loading" && <p className={styles.hint} role="status">{COPY.loading}</p>}
      {s.phase === "refused" && <p className={styles.note} role="alert" data-contracts-refused="">{s.error}</p>}
      {s.phase === "error" && (
        <div className={styles.note} role="alert" data-contracts-error="">
          <p className={styles.error}>{s.error}</p>
          <button type="button" className={styles.button} disabled={waiting} onClick={() => setNonce((n) => n + 1)} data-contracts-retry="">
            {waiting ? "Nouvelle tentative possible dans un instant…" : "Réessayer"}
          </button>
        </div>
      )}
      {s.phase === "ready" &&
        (s.items.length ? (
          <ul className={styles.list} aria-label="Contrats cadres">
            {s.items.map((ct) => {
              const expanded = openId === ct.id;
              return (
                <li key={ct.id} className={styles.item} data-contract-row={ct.id}>
                  <button
                    type="button"
                    className={styles.toggle}
                    aria-expanded={expanded}
                    aria-controls={`contract-${ct.id}`}
                    data-contract-open={ct.id}
                    onClick={() => {
                      setOpen({ base, id: expanded ? null : ct.id });
                    }}
                  >
                    <span>
                      <strong>{ct.title}</strong>
                      <small>
                        Réf. {ct.reference || "—"} — {STATUS_LABEL[ct.status]} — du {date(ct.starts_on)}
                        {ct.ends_on ? ` au ${date(ct.ends_on)}` : ""}
                      </small>
                    </span>
                    <Icon name="arrow" size={17} />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className={styles.hint} data-contracts-empty="">{COPY.empty}</p>
        ))}
      {s.moreError && <p className={styles.error} role="alert">{s.moreError}</p>}
      {s.phase === "ready" && s.next && (
        <button type="button" className={styles.button} disabled={s.loadingMore || waiting} onClick={() => void c?.more()} data-contracts-more="">
          {s.loadingMore ? "Chargement…" : COPY.more}
        </button>
      )}
    </div>
  );
}

type DetailState = { key: string; phase: "loading" | "ready" | "gone" | "error"; contract: ContractDetail | null; retryAt: number };

function ContractDetailView({ id, context, organizationId, contractId, epoch, canWrite, busy, onSave, fetcher }: { id: string; context: Context; organizationId: string; contractId: string; epoch: number; canWrite: boolean; busy: boolean; onSave: EnterpriseContractsProps["onSave"]; fetcher?: typeof fetch }) {
  const base = identityKey(context, organizationId);
  const [nonce, setNonce] = useState(0);
  const key = base ? `${base}|${contractId.toLowerCase()}|${epoch}|${nonce}` : "";
  const [frame, setFrame] = useState<DetailState | null>(null);
  const latest = useRef({ fetcher, context });
  useEffect(() => {
    latest.current = { fetcher, context };
  });
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const still = () => !cancelled && identityKey(latest.current.context, organizationId) === base;
    void getJson(latest.current.fetcher ?? ((...a) => fetch(...a)), detailUrl(organizationId, contractId)).then((r) => {
      if (!still()) return; // late reply: dropped
      if (r.status === 401 || r.status === 403 || r.status === 404 || r.status === 422) return setFrame({ key, phase: "gone", contract: null, retryAt: 0 });
      const contract = r.status === 200 ? parseContract(r.body, organizationId, contractId) : null;
      setFrame(contract ? { key, phase: "ready", contract, retryAt: 0 } : { key, phase: "error", contract: null, retryAt: r.retryAfter ? Date.now() + r.retryAfter * 1000 : 0 });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const d: DetailState = frame && frame.key === key ? frame : { key, phase: "loading", contract: null, retryAt: 0 };
  const waiting = useWaiting(d.retryAt);
  return (
    <div id={id} className={styles.detail} data-contract-detail={d.phase} aria-busy={d.phase === "loading" || undefined}>
      {d.phase === "loading" && <p className={styles.hint} role="status">{COPY.detailLoading}</p>}
      {d.phase === "gone" && <p className={styles.note} role="alert">{COPY.detailGone}</p>}
      {d.phase === "error" && (
        <div className={styles.note} role="alert">
          <p className={styles.error}>{COPY.detailFailed}</p>
          <button type="button" className={styles.button} disabled={waiting} onClick={() => setNonce((n) => n + 1)} data-contract-retry="">
            {waiting ? "Nouvelle tentative possible dans un instant…" : "Réessayer"}
          </button>
        </div>
      )}
      {d.phase === "ready" && d.contract && (
        <>
          <p>
            {STATUS_LABEL[d.contract.status]} — du {date(d.contract.starts_on)}
            {d.contract.ends_on ? ` au ${date(d.contract.ends_on)}` : ""}
          </p>
          <p data-contract-terms="">{d.contract.terms}</p>
          {canWrite && (
            <button
              type="button"
              className="button outline"
              disabled={busy}
              data-contract-toggle-status=""
              onClick={() => {
                const ct = d.contract!;
                // Existing command, unchanged payload (same fields as the workspace listing).
                void onSave({
                  action: "save_contract",
                  id: ct.id,
                  organization_id: ct.organization_id,
                  title: ct.title,
                  reference: ct.reference,
                  starts_on: ct.starts_on,
                  ends_on: ct.ends_on || undefined,
                  terms: ct.terms,
                  status: ct.status === "archived" ? "active" : "archived",
                });
              }}
            >
              {d.contract.status === "archived" ? "Réactiver" : "Archiver"}
            </button>
          )}
        </>
      )}
    </div>
  );
}
