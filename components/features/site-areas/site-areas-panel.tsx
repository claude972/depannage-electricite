"use client";
// ENT-08 site floors / zones / common areas panel (ENT-05 parties communes = classification only:
// no general assembly, quorum or funds claim). Hierarchy shown as returned (parent_id / depth);
// rows whose parent is on another page are flagged, never re-parented. Writes only when the
// server says can_write; versioned commands with a stable area id and a fresh command_id per
// operation (replayed unchanged after a lost reply).
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  AREAS_COPY,
  AREAS_INITIAL,
  DEFAULT_AREAS_CONTEXT,
  KIND_LABEL,
  areaFormToCommand,
  areaRows,
  areaUuid,
  createAreasApi,
  createAreasController,
  editAreaForm,
  newAreaForm,
  parentOptions,
  type AreaErrors,
  type AreaForm,
  type AreaKind,
  type AreasApi,
  type AreasContext,
  type AreasState,
  type SiteArea,
} from "./areas-model";
import styles from "./site-areas.module.css";

type PanelProps = { siteId: string; api?: AreasApi; context?: AreasContext; demo?: boolean; /** Tests only. */ initial?: AreasState; newId?: () => string | null };
/** Keyed by uid + generation + mode + site: any identity or scope change is a fresh panel. */
export function SiteAreasPanel(props: PanelProps) {
  const ctx = props.context ?? DEFAULT_AREAS_CONTEXT;
  return <SitePanel key={`${ctx.userId() ?? "-"}|${ctx.generation()}|${props.demo ? "demo" : "live"}|${props.siteId}`} {...props} />;
}
const depthClass = (d: number) => (d === 2 ? styles.depth2 : d === 3 ? styles.depth3 : d === 4 ? styles.depth4 : "");

function SitePanel({ siteId, api, context = DEFAULT_AREAS_CONTEXT, demo = false, initial, newId = areaUuid }: PanelProps) {
  const [state, setStateRaw] = useState<AreasState>(initial ?? AREAS_INITIAL);
  const ref = useRef(state);
  const set = (next: AreasState) => {
    ref.current = next;
    setStateRaw(next);
  };
  const latest = useRef({ api, context });
  latest.current = { api, context };
  const controller = useRef<ReturnType<typeof createAreasController> | null>(null);
  if (!controller.current) {
    let client: AreasApi | null = null;
    controller.current = createAreasController({
      api: () => (client ??= latest.current.api ?? createAreasApi()),
      siteId,
      context: { generation: () => latest.current.context.generation(), userId: () => latest.current.context.userId() },
      get: () => ref.current,
      set,
      demo,
    });
  }
  const ctrl = controller.current;
  useEffect(() => {
    ctrl.attach();
    if (!initial) void ctrl.load();
    return () => ctrl.detach();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctrl]);

  const [form, setForm] = useState<AreaForm | null>(null);
  const [errors, setErrors] = useState<AreaErrors>({});
  const [archiving, setArchiving] = useState<SiteArea | null>(null);
  const [noId, setNoId] = useState(false);
  const open = (f: AreaForm | null) => {
    setErrors({});
    setForm(f);
  };
  const startNew = (parent: string | null = null) => {
    const id = newId();
    if (!id) return setNoId(true);
    setNoId(false);
    open(newAreaForm(id, parent));
  };
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!form) return;
    const commandId = newId();
    if (!commandId) return setNoId(true);
    setNoId(false);
    const out = areaFormToCommand(form, commandId, ref.current.records);
    if ("errors" in out) return setErrors(out.errors);
    setErrors({});
    await ctrl.save(out.command);
    const s = ref.current;
    if (!s.writeError && !s.pending && s.saved) setForm(null); // 409 / 404 / 422 / 503 keep the values
  };
  const confirmArchive = async (r: SiteArea) => {
    const commandId = newId();
    if (!commandId) return setNoId(true);
    setNoId(false);
    await ctrl.archive(r, commandId);
    setArchiving(null);
  };
  const writeError = state.writeError && (
    <div className={styles.error} role="alert">
      {state.writeError}{" "}
      {state.pending ? (
        <button type="button" className={styles.secondary} disabled={state.busy} onClick={() => void ctrl.retry()} data-areas-retry="">Réessayer</button>
      ) : (
        <button type="button" className={styles.secondary} disabled={state.busy} onClick={() => void ctrl.load()} data-areas-reload="">Actualiser</button>
      )}
    </div>
  );
  const rows = areaRows(state.records);
  const byId = new Map(state.records.map((r) => [r.id, r]));
  const options = form ? parentOptions(state.records, form.expected_version === null ? null : form.id) : [];

  return (
    <section className={styles.panel} aria-labelledby={`areas-${siteId}`} data-areas-panel={state.phase} aria-busy={state.busy || state.phase === "loading" || undefined}>
      <div className={styles.head}>
        <h2 id={`areas-${siteId}`}>Étages, zones et parties communes</h2>
        {state.canWrite && state.phase === "ready" && !form && (
          <button type="button" className={styles.primary} onClick={() => startNew()} data-areas-add="">Ajouter</button>
        )}
      </div>
      <p className={styles.hint}>{AREAS_COPY.intro}</p>
      {state.phase === "demo" && <p className={styles.note} data-areas-demo="">{AREAS_COPY.demo}</p>}
      {noId && <p className={styles.error} role="alert" data-areas-noid="">{AREAS_COPY.noId}</p>}
      {state.phase === "ready" && !state.canWrite && <p className={styles.note} data-areas-readonly="">{AREAS_COPY.readOnly}</p>}
      {state.saved && <p className={styles.ok} role="status">{state.saved}</p>}
      {!form && writeError}

      {form && state.canWrite && (
        <form className={styles.form} onSubmit={(e) => void submit(e)} noValidate data-areas-form={form.expected_version === null ? "create" : "edit"}>
          <h3>{form.expected_version === null ? "Nouvel élément" : `Modifier (version ${form.expected_version})`}</h3>
          <Field label="Nom" error={errors.label}><input value={form.label} maxLength={160} onChange={(e) => setForm({ ...form, label: e.target.value })} /></Field>
          <fieldset className={styles.choices}>
            <legend>Type</legend>
            {(Object.keys(KIND_LABEL) as AreaKind[]).map((k) => (
              <label key={k}><input type="radio" name={`kind-${form.id}`} checked={form.kind === k} onChange={() => setForm({ ...form, kind: k })} />{KIND_LABEL[k]}</label>
            ))}
          </fieldset>
          <Field label="Rattaché à" error={errors.parent_id}>
            <select className={styles.select} value={form.parent_id ?? ""} onChange={(e) => setForm({ ...form, parent_id: e.target.value || null })}>
              <option value="">Aucun (niveau principal)</option>
              {form.parent_id && !options.some((o) => o.id === form.parent_id) && <option value={form.parent_id}>{byId.get(form.parent_id)?.label ?? "Parent non chargé"}</option>}
              {options.map((o) => <option key={o.id} value={o.id}>{"— ".repeat(o.depth - 1)}{o.label} ({KIND_LABEL[o.kind]})</option>)}
            </select>
          </Field>
          <Field label="Référence (facultatif)" error={errors.reference}><input value={form.reference} maxLength={80} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></Field>
          <Field label="Note (facultatif)" error={errors.note}><textarea value={form.note} maxLength={2000} rows={3} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
          {writeError}
          <div className={styles.actions}>
            <button type="submit" className={styles.primary} disabled={state.busy} data-areas-save="">{state.busy ? "Enregistrement…" : "Enregistrer"}</button>
            <button type="button" className={styles.secondary} disabled={state.busy} onClick={() => open(null)}>Annuler</button>
          </div>
        </form>
      )}

      {state.phase === "loading" && <p className={styles.hint} role="status">Chargement des zones…</p>}
      {(state.phase === "error" || state.phase === "unavailable") && (
        <div className={styles.error} role="alert" data-areas-error="">
          {state.error}{" "}
          {state.phase === "error" && <button type="button" className={styles.secondary} onClick={() => void ctrl.load()}>Réessayer</button>}
        </div>
      )}
      {state.phase === "ready" && !state.records.length && <p className={styles.hint} data-areas-empty="">{AREAS_COPY.empty}</p>}
      {state.phase === "ready" && state.total !== null && state.page?.has_more && <p className={styles.hint} data-areas-partial="">{AREAS_COPY.partial(state.records.length, state.total)}</p>}
      {state.phase === "ready" && rows.length > 0 && (
        <ul className={styles.list}>
          {rows.map(({ area: r, orphan }) => (
            <li key={r.id} className={`${styles.row} ${depthClass(r.depth)}`} data-area-id={r.id} data-area-depth={r.depth}>
              <div className={styles.rowHead}>
                <strong>{r.label}</strong>
                <span>{KIND_LABEL[r.kind]} · niveau {r.depth}{orphan && <> · <em data-area-orphan="">{AREAS_COPY.orphan}</em></>}</span>
              </div>
              <dl className={styles.kv}>
                {r.reference && <div><dt>Référence</dt><dd>{r.reference}</dd></div>}
                <div><dt>Version</dt><dd>{r.version}</dd></div>
              </dl>
              {r.note && <p className={styles.hint}>{r.note}</p>}
              {state.canWrite && (
                archiving?.id === r.id ? (
                  <div className={styles.confirm} role="alertdialog" aria-label="Confirmer l’archivage" data-areas-archive-confirm="">
                    <p>Archiver « {r.label} » (version {r.version}) ? Une zone qui a encore des sous-zones actives ne peut pas être archivée.</p>
                    <div className={styles.actions}>
                      <button type="button" className={styles.danger} disabled={state.busy} onClick={() => void confirmArchive(r)}>Confirmer l’archivage</button>
                      <button type="button" className={styles.secondary} disabled={state.busy} onClick={() => setArchiving(null)}>Annuler</button>
                    </div>
                  </div>
                ) : (
                  <div className={styles.actions}>
                    <button type="button" className={styles.secondary} disabled={state.busy || Boolean(form)} onClick={() => open(editAreaForm(r))}>Modifier</button>
                    {r.depth < 4 && <button type="button" className={styles.secondary} disabled={state.busy || Boolean(form)} onClick={() => startNew(r.id)}>Ajouter dessous</button>}
                    <button type="button" className={styles.secondary} disabled={state.busy} onClick={() => setArchiving(r)}>Archiver</button>
                  </div>
                )
              )}
            </li>
          ))}
        </ul>
      )}
      {state.phase === "ready" && state.page?.has_more && (
        <button type="button" className={styles.secondary} disabled={state.loadingMore || state.busy} onClick={() => void ctrl.more()} data-areas-more="">
          {state.loadingMore ? "Chargement…" : "Afficher plus"}
        </button>
      )}
    </section>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactElement }) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      {children}
      {error && <small className={styles.error} role="alert">{error}</small>}
    </label>
  );
}
