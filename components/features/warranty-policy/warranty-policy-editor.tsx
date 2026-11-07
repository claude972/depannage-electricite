"use client";
// Admin editor of the warranty conditions (PUB-06 / ADM-10). Draft and published version side by
// side with their versions; operator activation and environment guard shown separately; save /
// publish / enable / disable / withdraw only as explicit actions (publish, enable and withdraw
// confirmed). Plain text only. Logic and session fence in ./model.
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { BODY_MAX, EDITOR_COPY, EDITOR_INITIAL, TITLE_MAX, createEditorApi, createEditorController, draftPublishable, tabStore, validateDraft, type EditorApi, type EditorContext, type EditorState, type Store } from "./model";
import styles from "./warranty-policy.module.css";

const uuid = (): string | null => (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : null);
const day = (iso: string) => new Date(iso).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" });

export type WarrantyPolicyEditorProps = {
  /** Session mutation context: storage key and every reply are bound to uid + generation. */
  context: EditorContext;
  demo?: boolean;
  api?: EditorApi;
  store?: () => Store | null;
  newId?: () => string | null;
  /** Tests only. */
  initial?: EditorState;
};

export function WarrantyPolicyEditor(props: WarrantyPolicyEditorProps) {
  if (props.demo)
    return (
      <section className={styles.panel} data-warranty-editor="demo">
        <h2 className={styles.title}>{EDITOR_COPY.title}</h2>
        <p className={styles.note}>{EDITOR_COPY.demo}</p>
      </section>
    );
  return <Editor key={`${props.context.userId() ?? "-"}|${props.context.generation()}`} {...props} />;
}

type Confirm = "publish" | "enable" | "withdraw" | null;
function Editor({ api, store = tabStore, newId = uuid, context, initial }: WarrantyPolicyEditorProps) {
  const uid = useId();
  const [view, setRaw] = useState<EditorState>(initial ?? EDITOR_INITIAL);
  const ref = useRef(view);
  const set = (next: EditorState) => {
    ref.current = next;
    setRaw(next);
  };
  const latest = useRef({ api, store, newId, context });
  latest.current = { api, store, newId, context };
  const ctrl = useRef<ReturnType<typeof createEditorController> | null>(null);
  // One controller per effect run (StrictMode-safe); restore never sends anything by itself.
  useEffect(() => {
    let client: EditorApi | null = null;
    const c = createEditorController({
      api: () => (client ??= latest.current.api ?? createEditorApi()),
      store: () => latest.current.store(),
      newId: () => latest.current.newId(),
      context: { generation: () => latest.current.context.generation(), userId: () => latest.current.context.userId() },
      get: () => ref.current,
      set,
    });
    ctrl.current = c;
    if (!initial) {
      c.restorePending();
      void c.load();
    }
    return () => {
      c.detach();
      if (ctrl.current === c) ctrl.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [form, setForm] = useState<{ title: string; body: string } | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const data = view.data;

  if (view.phase === "forbidden")
    return (
      <section className={styles.panel} data-warranty-editor="forbidden">
        <h2 className={styles.title}>{EDITOR_COPY.title}</h2>
        <p className={styles.note}>{EDITOR_COPY.forbidden}</p>
      </section>
    );
  if (view.phase === "loading" || (!data && view.phase !== "error"))
    return <p className={styles.muted} role="status" data-warranty-editor="loading">{EDITOR_COPY.loading}</p>;
  if (!data)
    return (
      <section className={styles.panel} data-warranty-editor="error">
        <p className={styles.error} role="alert">{view.error || EDITOR_COPY.loadFailed}</p>
        <button type="button" className={styles.button} onClick={() => void ctrl.current?.load()}>Réessayer</button>
      </section>
    );

  const f = form ?? { title: data.draft.title, body: data.draft.body };
  const errors = validateDraft(f.title, f.body);
  const locked = view.busy || !!view.pending;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (errors.title || errors.body) return;
    if (await ctrl.current?.save(f.title, f.body)) setForm(null);
  };
  const run = async (action: Exclude<Confirm, null> | "disable") => {
    const c = ctrl.current;
    if (!c) return;
    await c[action]();
    setConfirm(null);
  };
  return (
    <section className={styles.panel} aria-labelledby={`${uid}-title`} data-warranty-editor="ready">
      <h2 id={`${uid}-title`} className={styles.title}>{EDITOR_COPY.title}</h2>
      <dl className={styles.kv}>
        <dt>Version des conditions</dt>
        <dd data-warranty-version="">{data.version}</dd>
        <dt>Publication en ligne</dt>
        <dd data-warranty-published={data.published ? data.published.version : "none"}>
          {data.published ? `Version ${data.published.version} « ${data.published.title} », publiée le ${day(data.published.published_at)}` : "Aucune version publiée"}
        </dd>
        <dt>Activation par l’opérateur</dt>
        <dd data-warranty-operator={data.operator_enabled ? "on" : "off"}>{data.operator_enabled ? "Activée pour la version publiée" : "Non activée"}</dd>
        <dt>Garde d’environnement du service</dt>
        <dd data-warranty-environment={data.environment_enabled ? "on" : "off"}>{data.environment_enabled ? "Ouverte" : "Fermée"}</dd>
        <dt>Dépôt des demandes</dt>
        <dd data-warranty-enabled={data.enabled ? "on" : "off"}>{data.enabled ? "Ouvert" : "Fermé"}</dd>
      </dl>
      {data.operator_enabled && !data.environment_enabled && <p className={styles.note}>{EDITOR_COPY.envClosed}</p>}
      {view.notice && <p className={styles.note} role="status" data-warranty-notice="">{view.notice}</p>}
      {view.error && (
        <div role="alert" data-warranty-error="">
          <p className={styles.error}>{view.error}</p>
          {view.pending && (
            <button type="button" className={styles.button} disabled={view.busy} onClick={() => void ctrl.current?.retry()} data-warranty-retry="">
              {view.busy ? "Envoi…" : "Réessayer la même commande"}
            </button>
          )}
        </div>
      )}
      <form className={styles.form} onSubmit={(e) => void submit(e)} noValidate data-warranty-form="">
        <h3 className={styles.subtitle}>Brouillon (non publié)</h3>
        <p className={styles.muted}>{EDITOR_COPY.plainText}</p>
        <label className={styles.label} htmlFor={`${uid}-t`}>Titre</label>
        <input id={`${uid}-t`} className={styles.input} value={f.title} maxLength={TITLE_MAX} disabled={locked} onChange={(e) => setForm({ ...f, title: e.target.value })} aria-invalid={errors.title ? true : undefined} />
        {errors.title && <small className={styles.error}>{errors.title}</small>}
        <label className={styles.label} htmlFor={`${uid}-b`}>Texte des conditions</label>
        <textarea id={`${uid}-b`} className={styles.textarea} rows={12} maxLength={BODY_MAX} value={f.body} disabled={locked} onChange={(e) => setForm({ ...f, body: e.target.value })} aria-invalid={errors.body ? true : undefined} />
        {errors.body && <small className={styles.error}>{errors.body}</small>}
        <div className={styles.actions}>
          <button type="submit" className={`${styles.button} ${styles.primary}`} disabled={locked} data-warranty-save="">{view.busy ? "Envoi…" : "Enregistrer le brouillon"}</button>
          {form !== null && <button type="button" className={styles.button} disabled={locked} onClick={() => setForm(null)}>Annuler les modifications</button>}
        </div>
      </form>
      <div className={styles.actions} data-warranty-actions="">
        <button type="button" className={styles.button} disabled={locked || !draftPublishable(data) || form !== null} onClick={() => setConfirm("publish")} data-warranty-publish="">Publier le brouillon enregistré…</button>
        {data.published && !data.operator_enabled && (
          <button type="button" className={styles.button} disabled={locked} onClick={() => setConfirm("enable")} data-warranty-enable="">Activer le dépôt pour la version {data.published.version}…</button>
        )}
        {data.operator_enabled && (
          <button type="button" className={styles.button} disabled={locked} onClick={() => void run("disable")} data-warranty-disable="">Désactiver le dépôt</button>
        )}
        {data.published && (
          <button type="button" className={`${styles.button} ${styles.danger}`} disabled={locked} onClick={() => setConfirm("withdraw")} data-warranty-withdraw="">Retirer la publication…</button>
        )}
      </div>
      {!draftPublishable(data) && <p className={styles.muted}>{EDITOR_COPY.emptyDraft}</p>}
      {confirm && (
        <div className={styles.confirm} role="alertdialog" aria-labelledby={`${uid}-c`} data-warranty-confirm={confirm}>
          <p id={`${uid}-c`}>
            {confirm === "publish"
              ? `Publier le brouillon enregistré « ${data.draft.title} » ? Il remplacera la version en ligne et le dépôt des demandes sera désactivé jusqu’à une nouvelle activation.`
              : confirm === "enable"
                ? `${EDITOR_COPY.enableNote} Version concernée : ${data.published?.version}.`
                : "Retirer la publication en ligne ? Le dépôt des demandes sera désactivé ; les versions déjà publiées restent consultables par numéro."}
          </p>
          <div className={styles.actions}>
            <button type="button" className={`${styles.button} ${styles.primary}`} disabled={locked} onClick={() => void run(confirm)} data-warranty-confirm-execute="">Confirmer</button>
            <button type="button" className={styles.button} disabled={view.busy} onClick={() => setConfirm(null)}>Annuler</button>
          </div>
        </div>
      )}
      {data.published && (
        <div className={styles.preview}>
          <h3 className={styles.subtitle}>Version en ligne ({data.published.version})</h3>
          <p className={styles.plain} data-warranty-published-body="">{data.published.body}</p>
        </div>
      )}
    </section>
  );
}
