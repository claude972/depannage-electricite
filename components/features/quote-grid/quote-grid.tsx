"use client";
// ENT-13 contract quote grid UI: QuoteGridAccessPanel (organisation owner attaches / detaches the grid
// of ONE dossier), QuoteGridPicker (assigned artisan applies the attached grid to the draft; the
// answer is the exact draft envelope), ContractSourceLine (« Basé sur la grille X version N » only
// when the server says so). Tokens only, 44 px targets, StrictMode-safe controllers.
import { useEffect, useId, useRef, useState } from "react";
import type { QuoteDraftEnvelope } from "../../app/types";
import { money } from "../../app/format";
import type { TaxRate } from "../../../lib/tax-rates";
import {
  ACCESS_INITIAL,
  COPY,
  UNIT_LABEL,
  buildApply,
  createAccessController,
  createQgApi,
  parseApplied,
  parseOptions,
  parseSource,
  sourceLabel,
  tabStore,
  type AccessState,
  type Context,
  type GridOptions,
  type GridSource,
  type QgApi,
  type Store,
  QG_TIMEOUT,
} from "./model";
import styles from "./quote-grid.module.css";

const uuid = (): string | null => (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : null);

// ---- Owner access ---------------------------------------------------------------------------------
export function QuoteGridAccessPanel(props: { interventionId: string; context: Context; demo?: boolean; /** Reason why a grid cannot be authorised yet (e.g. no artisan assigned): the control is disabled and the reason shown. */ attachBlockedReason?: string; api?: QgApi; store?: () => Store | null; newId?: () => string | null; initial?: AccessState }) {
  if (props.demo)
    return (
      <div className={styles.block} data-quote-grid-access="demo">
        <p className={styles.muted}>{COPY.demo}</p>
      </div>
    );
  return <Access key={`${props.context.userId() ?? "-"}|${props.context.generation()}|${props.interventionId}`} {...props} />;
}
function Access({ interventionId, context, attachBlockedReason, api, store = tabStore, newId = uuid, initial }: { interventionId: string; context: Context; attachBlockedReason?: string; api?: QgApi; store?: () => Store | null; newId?: () => string | null; initial?: AccessState }) {
  const uid = useId();
  const [state, setRaw] = useState<AccessState>(initial ?? ACCESS_INITIAL);
  const ref = useRef(state);
  const set = (s: AccessState) => {
    ref.current = s;
    setRaw(s);
  };
  const latest = useRef({ api, store, newId });
  latest.current = { api, store, newId };
  const ctrl = useRef<ReturnType<typeof createAccessController> | null>(null);
  useEffect(() => {
    let client: QgApi | null = null;
    const c = createAccessController({ api: () => (client ??= latest.current.api ?? createQgApi()), interventionId, store: () => latest.current.store(), newId: () => latest.current.newId(), context, get: () => ref.current, set });
    ctrl.current = c;
    if (!initial) {
      c.restorePending();
      void c.load();
    }
    return () => {
      c.stop();
      if (ctrl.current === c) ctrl.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [choice, setChoice] = useState("");
  const [confirm, setConfirm] = useState<"attach" | "detach" | null>(null);
  // Owner-only: anyone else sees nothing (the server refuses the read).
  if (state.phase === "forbidden") return null;
  if (state.phase === "loading") return <p className={styles.muted} role="status" data-quote-grid-access="loading">{COPY.loading}</p>;
  const d = state.data;
  if (state.phase === "error" || !d)
    return (
      <div role="alert" data-quote-grid-access="error">
        <p className={styles.error}>{COPY.loadFailed}</p>
        <button type="button" className={styles.button} onClick={() => void ctrl.current?.load()}>Réessayer</button>
      </div>
    );
  const current = d.grid_id ? d.grids.find((g) => g.id.toLowerCase() === d.grid_id!.toLowerCase()) : undefined;
  const locked = state.busy || !!state.pending;
  const labelOf = (id: string) => d.grids.find((g) => g.id === id)?.label ?? `Grille ${id.slice(0, 8)}`;
  return (
    <section className={styles.block} aria-labelledby={`${uid}-t`} data-quote-grid-access="ready">
      <h3 id={`${uid}-t`} className={styles.title}>{COPY.accessTitle}</h3>
      <p className={styles.text} data-quote-grid-current={d.grid_id ?? "none"}>
        {d.grid_id ? `${current ? `${current.label} (version ${current.version})` : `Grille ${d.grid_id.slice(0, 8)}`} · autorisation version ${d.version}` : COPY.accessNone}
      </p>
      <p className={styles.muted}>{COPY.accessNote}</p>
      {state.notice && <p className={styles.text} role="status" data-quote-grid-notice="">{state.notice}</p>}
      {state.error && (
        <div role="alert" data-quote-grid-error="">
          <p className={styles.error}>{state.error}</p>
          {state.pending && (
            <button type="button" className={styles.button} disabled={state.busy} onClick={() => void ctrl.current?.retry()} data-quote-grid-retry="">
              {state.busy ? "Envoi…" : "Réessayer la même commande"}
            </button>
          )}
        </div>
      )}
      <div className={styles.row}>
        <label className={styles.muted} htmlFor={`${uid}-g`}>Grille publiée</label>
        <select id={`${uid}-g`} className={styles.input} value={choice} onChange={(e) => setChoice(e.target.value)} disabled={locked || !!attachBlockedReason} aria-describedby={attachBlockedReason ? `${uid}-b` : undefined}>
          <option value="">Choisir…</option>
          {d.grids.filter((g) => g.id !== d.grid_id).map((g) => (
            <option key={g.id} value={g.id}>{g.label} (version {g.version})</option>
          ))}
        </select>
        <button type="button" className={`${styles.button} ${styles.primary}`} disabled={locked || !choice || !!attachBlockedReason} onClick={() => setConfirm("attach")} data-quote-grid-attach="">Autoriser…</button>
        {d.grid_id && <button type="button" className={styles.button} disabled={locked} onClick={() => setConfirm("detach")} data-quote-grid-detach="">Retirer l’autorisation…</button>}
      </div>
      {attachBlockedReason && <p id={`${uid}-b`} className={styles.muted} data-quote-grid-blocked="">{attachBlockedReason}</p>}
      {d.next_cursor && <button type="button" className={styles.button} onClick={() => void ctrl.current?.load(d.next_cursor)}>{COPY.more}</button>}
      {confirm && (
        <div className={styles.confirm} role="alertdialog" aria-labelledby={`${uid}-c`} data-quote-grid-confirm={confirm}>
          <p id={`${uid}-c`}>{confirm === "attach" ? COPY.confirmAttach(labelOf(choice)) : COPY.confirmDetach}</p>
          <div className={styles.row}>
            <button type="button" className={`${styles.button} ${styles.primary}`} disabled={locked} onClick={() => void (confirm === "attach" ? ctrl.current?.attach(choice) : ctrl.current?.detach())?.then((ok) => { setConfirm(null); if (ok) setChoice(""); })} data-quote-grid-execute="">
              Confirmer
            </button>
            <button type="button" className={styles.button} disabled={state.busy} onClick={() => setConfirm(null)}>Annuler</button>
          </div>
        </div>
      )}
    </section>
  );
}

// ---- Contract source on a quote -------------------------------------------------------------------
export function ContractSourceLine({ quoteId, demo = false, api, initial }: { quoteId: string; demo?: boolean; api?: QgApi; initial?: GridSource | null }) {
  const [src, setSrc] = useState<GridSource | null>(initial ?? null);
  const latest = useRef(api);
  latest.current = api;
  useEffect(() => {
    if (demo || initial !== undefined) return;
    let active = true;
    void (latest.current ?? createQgApi()).source(quoteId).then((r) => {
      const s = r.status === 200 ? parseSource(r.body) : undefined;
      if (active) setSrc(s ?? null); // unknown / error ⇒ nothing claimed
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteId, demo]);
  if (!src) return null;
  return <p className={styles.source} data-quote-grid-source={`${src.grid_id}:${src.grid_version}`}>{sourceLabel(src)}</p>;
}

// ---- Artisan picker -------------------------------------------------------------------------------
export type PickerProps = {
  interventionId: string;
  artisanId: string | null;
  envelope: QuoteDraftEnvelope;
  taxRate: TaxRate | null;
  /** Unsaved manual edits in the editor (applying replaces them, after confirmation). */
  dirty: boolean;
  disabled: boolean;
  demo?: boolean;
  api?: QgApi;
  /** The exact draft envelope of the apply answer, with the grid source it came from. */
  onApplied: (env: QuoteDraftEnvelope, source: GridSource) => void;
  /** The server's statement of the grid the CURRENT draft comes from (GET current). */
  onCurrent: (source: GridSource | null) => void;
  onConflict: (message: string) => void;
  /** Tests only. */
  initial?: GridOptions | null;
};
export function QuoteGridPicker(props: PickerProps) {
  if (props.demo) return null;
  return <Picker {...props} />;
}
function Picker({ interventionId, artisanId, envelope, taxRate, dirty, disabled, api, onApplied, onCurrent, onConflict, initial }: PickerProps) {
  const uid = useId();
  const [opts, setOpts] = useState<GridOptions | null | "error" | undefined>(initial === undefined ? undefined : initial);
  const [qty, setQty] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState<ReturnType<typeof buildApply>>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const client = useRef<QgApi | null>(null);
  const getApi = () => (client.current ??= api ?? createQgApi());
  const cb = useRef({ onCurrent });
  cb.current = { onCurrent };
  useEffect(() => {
    if (initial !== undefined) return;
    let active = true;
    void getApi().options(interventionId, null).then((r) => {
      if (!active) return;
      const o = r.status === 200 ? parseOptions(r.body, null) : null;
      setOpts(o ?? (r.status === 403 || r.status === 404 ? null : "error"));
      if (o) cb.current.onCurrent(o.current);
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interventionId, envelope.version]);
  if (opts === undefined) return <p className={styles.muted} role="status" data-quote-grid-picker="loading">{COPY.loading}</p>;
  if (opts === "error") return <p className={styles.muted} data-quote-grid-picker="error">{COPY.loadFailed}</p>;
  if (!opts || opts.grids.length === 0) return <p className={styles.muted} data-quote-grid-picker="none">{COPY.pickerNone}</p>;
  const grid = opts.grids[0];
  const send = async (body: NonNullable<ReturnType<typeof buildApply>>) => {
    setBusy(true);
    setError("");
    setNotice("");
    const r = await getApi().apply(interventionId, body);
    setBusy(false);
    setConfirm(false);
    if (r.status === 200) {
      const env = parseApplied(r.body, interventionId, artisanId, body);
      if (env) {
        setPending(null);
        setNotice(COPY.applied);
        onApplied(env, { grid_id: grid.id, grid_version: grid.version, grid_label: grid.label });
        return;
      }
    }
    if (r.status === 409) {
      setPending(null);
      onConflict(COPY.applyConflict);
      return;
    }
    if (r.status === 401) {
      setPending(null);
      setSessionExpired(true);
      setError("Votre session a expiré. Reconnectez-vous pour appliquer la grille.");
      return;
    }
    if ([400, 403, 404, 422, 429].includes(r.status)) {
      setPending(null);
      setError(COPY.applyRefused);
      return;
    }
    // Lost reply / 503 / unverifiable answer: same request on demand (draft idempotency: version + token).
    if (r.status === QG_TIMEOUT || r.status === 0 || r.status >= 500 || r.status === 200) {
      setPending(body);
      setError(COPY.applyRetry);
    }
  };
  const apply = () => {
    const body = buildApply(grid, qty, envelope, taxRate);
    if (!body) return setError(COPY.selectAtLeast);
    if (dirty && !confirm) return setConfirm(true);
    void send(body);
  };
  return (
    <section className={styles.block} aria-labelledby={`${uid}-t`} data-quote-grid-picker={grid.id}>
      <h3 id={`${uid}-t`} className={styles.title}>{COPY.pickerTitle} : {grid.label} (version {grid.version})</h3>
      <p className={styles.muted}>{COPY.pickerNote}</p>
      <ul className={styles.list}>
        {grid.lines.map((l) => (
          <li key={l.index} className={styles.item} data-quote-grid-line={l.index}>
            <label htmlFor={`${uid}-q${l.index}`}>{l.label} · {money(l.unit_price_cents)} HT / {UNIT_LABEL[l.unit]}</label>
            <input id={`${uid}-q${l.index}`} className={styles.qty} inputMode="numeric" placeholder="Qté" value={qty[l.index] ?? ""} onChange={(e) => setQty({ ...qty, [l.index]: e.target.value.replace(/[^0-9]/g, "") })} disabled={disabled || busy || sessionExpired} aria-label={`Quantité pour ${l.label}`} />
          </li>
        ))}
      </ul>
      {notice && <p className={styles.text} role="status" data-quote-grid-applied="">{notice}</p>}
      {error && <p className={styles.error} role="alert" data-quote-grid-apply-error="">{error}</p>}
      {confirm && <p className={styles.warning} role="alert" data-quote-grid-replace="">{COPY.replaceWarning}</p>}
      <div className={styles.row}>
        {pending ? (
          <button type="button" className={styles.button} disabled={busy || disabled} onClick={() => void send(pending)} data-quote-grid-retry-apply="">
            {busy ? "Envoi…" : "Réessayer la même demande"}
          </button>
        ) : (
          <button type="button" className={`${styles.button} ${styles.primary}`} disabled={busy || disabled || sessionExpired} onClick={apply} data-quote-grid-apply="">
            {busy ? "Application…" : confirm ? "Remplacer par la grille" : "Appliquer la grille au brouillon"}
          </button>
        )}
        {confirm && <button type="button" className={styles.button} disabled={busy} onClick={() => setConfirm(false)}>Annuler</button>}
      </div>
    </section>
  );
}
