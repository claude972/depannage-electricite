"use client";
// Admin editor of the public operator profile (super admin only, server-enforced). Draft and
// published version side by side; save (versioned), publish (blocked with the list of missing
// minimum fields until the saved draft has them; the server stays the authority), withdraw (with
// confirmation). One command at a time, command_id kept in tab storage before each POST; a lost
// reply / 503 offers « Réessayer » with the SAME command; 409 ⇒ honest message + reload. Demo:
// no call. Logic in ./model.
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { OperatorField } from "../../../lib/features/public-operator-profile/contract";
import { EDITOR_INITIAL, FIELD_LABELS, FIELD_ORDER, PROFILE_COPY, createEditorApi, createEditorController, formToProfile, missingMinimum, tabStore, type EditorApi, type EditorContext, type EditorView, type Store } from "./model";
import styles from "./operator-profile.module.css";

const uuid = (): string | null => (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : null);

export type OperatorProfileEditorProps = {
  demo: boolean;
  /** From the server's /me reply (session.platformAccess.super_admin); the server enforces it again. */
  superAdmin: boolean;
  /** Session mutation context: storage key and every reply are bound to uid + generation. */
  context: EditorContext;
  api?: EditorApi;
  store?: () => Store | null;
  newId?: () => string | null;
  /** Tests only. */
  initial?: EditorView;
};

export function OperatorProfileEditor(props: OperatorProfileEditorProps) {
  if (props.demo)
    return (
      <section className={styles.panel} aria-labelledby="operator-profile-title" data-operator-editor="demo">
        <h2 id="operator-profile-title">Informations publiques de l’exploitant</h2>
        <p className={styles.note}>{PROFILE_COPY.demo}</p>
      </section>
    );
  if (!props.superAdmin)
    return (
      <section className={styles.panel} aria-labelledby="operator-profile-title" data-operator-editor="forbidden">
        <h2 id="operator-profile-title">Informations publiques de l’exploitant</h2>
        <p className={styles.note}>{PROFILE_COPY.forbidden}</p>
      </section>
    );
  return <Editor {...props} />;
}

function Editor({ api, store = tabStore, newId = uuid, context, initial }: OperatorProfileEditorProps) {
  const [view, setRaw] = useState<EditorView>(initial ?? EDITOR_INITIAL);
  const ref = useRef(view);
  const set = (next: EditorView) => {
    ref.current = next;
    setRaw(next);
  };
  const latest = useRef({ api, store, newId, context });
  latest.current = { api, store, newId, context };
  const ctrl = useRef<ReturnType<typeof createEditorController> | null>(null);
  if (!ctrl.current) {
    let client: EditorApi | null = null;
    ctrl.current = createEditorController({
      api: () => (client ??= latest.current.api ?? createEditorApi()),
      store: () => latest.current.store(),
      newId: () => latest.current.newId(),
      context: { generation: () => latest.current.context.generation(), userId: () => latest.current.context.userId() },
      get: () => ref.current,
      set,
    });
  }
  const c = ctrl.current;
  useEffect(() => {
    if (initial) return;
    c.restorePending();
    void c.load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const data = view.data;
  const [values, setValues] = useState<Partial<Record<OperatorField, string>> | null>(null);
  const form: Partial<Record<OperatorField, string>> = values ?? (data ? Object.fromEntries(FIELD_ORDER.map((f) => [f, data.draft[f] ?? ""])) : {});
  const [errors, setErrors] = useState<Partial<Record<OperatorField, string>>>({});
  const [withdrawing, setWithdrawing] = useState(false);
  const missing = data ? missingMinimum(data.draft) : [];
  // 401 / 403: the typed draft values are dropped along with the controller's copies.
  useEffect(() => {
    if (view.phase === "forbidden") setValues(null);
  }, [view.phase]);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const out = formToProfile(form);
    if ("errors" in out) return setErrors(out.errors);
    setErrors({});
    if (await c.save(out.profile)) setValues(null);
  };

  return (
    <section className={styles.panel} aria-labelledby="operator-profile-title" data-operator-editor={view.phase} aria-busy={view.busy || view.phase === "loading" || undefined}>
      <h2 id="operator-profile-title">Informations publiques de l’exploitant</h2>
      <p className={styles.hint}>Le brouillon n’est jamais affiché publiquement. Seule la version publiée apparaît sur les pages À propos, Mentions légales, Contact et Confidentialité.</p>
      {view.phase === "loading" && <p className={styles.hint} role="status">Lecture de la configuration…</p>}
      {view.phase === "forbidden" && <p className={styles.note} data-operator-forbidden="">{PROFILE_COPY.forbidden}</p>}
      {view.phase === "error" && (
        <p className={styles.error} role="alert">
          {view.error}{" "}
          <button type="button" className={styles.secondary} onClick={() => void c.load()}>Réessayer</button>
        </p>
      )}
      {view.notice && <p className={styles.ok} role="status">{view.notice}</p>}
      {view.error && view.phase === "ready" && (
        <div className={styles.error} role="alert" data-operator-error="">
          {view.error}{" "}
          {view.pending ? (
            <button type="button" className={styles.secondary} disabled={view.busy} onClick={() => void c.retry()} data-operator-retry="">Réessayer</button>
          ) : (
            <button type="button" className={styles.secondary} disabled={view.busy} onClick={() => { setValues(null); void c.load(); }} data-operator-reload="">Recharger</button>
          )}
        </div>
      )}

      {data && view.phase === "ready" && (
        <div className={styles.columns}>
          <form className={styles.form} onSubmit={(e) => void submit(e)} noValidate data-operator-draft={data.version}>
            <h3>Brouillon (version {data.version})</h3>
            {FIELD_ORDER.map((f) => (
              <label key={f} className={styles.field}>
                <span>{FIELD_LABELS[f]}{missing.includes(f) ? " — requis pour publier" : ""}</span>
                {f === "about_text" ? (
                  <textarea rows={4} maxLength={2000} value={form[f] ?? ""} onChange={(e) => setValues({ ...form, [f]: e.target.value })} />
                ) : (
                  <input value={form[f] ?? ""} onChange={(e) => setValues({ ...form, [f]: e.target.value })} />
                )}
                {errors[f] && <small className={styles.error} role="alert">{errors[f]}</small>}
              </label>
            ))}
            <div className={styles.actions}>
              <button type="submit" className={styles.primary} disabled={view.busy || Boolean(view.pending)} data-operator-save="">{view.busy ? "Enregistrement…" : "Enregistrer le brouillon"}</button>
              <button type="button" className={styles.primary} disabled={view.busy || Boolean(view.pending) || missing.length > 0} onClick={() => void c.publish()} data-operator-publish="">Publier le brouillon enregistré</button>
            </div>
            {missing.length > 0 && (
              <p className={styles.hint} data-operator-missing="">Publication impossible tant que ces champs du brouillon enregistré manquent : {missing.map((f) => FIELD_LABELS[f]).join(", ")}.</p>
            )}
          </form>
          <aside className={styles.published} data-operator-published={data.published ? data.published.version : "none"}>
            <h3>{data.published ? `Publié (version ${data.published.version})` : "Rien n’est publié"}</h3>
            {data.published ? (
              <>
                <p className={styles.hint}>Publié le {new Date(data.published.published_at).toLocaleString("fr-FR")}.</p>
                <dl className={styles.kv}>
                  {FIELD_ORDER.filter((f) => data.published!.profile[f]).map((f) => (
                    <div key={f}><dt>{FIELD_LABELS[f]}</dt><dd>{data.published!.profile[f]}</dd></div>
                  ))}
                </dl>
                {withdrawing ? (
                  <div className={styles.confirm} role="alertdialog" aria-label="Confirmer le retrait" data-operator-withdraw-confirm="">
                    <p>Retirer la publication ? Les pages publiques afficheront de nouveau « À renseigner par l’exploitant ».</p>
                    <div className={styles.actions}>
                      <button type="button" className={styles.danger} disabled={view.busy} onClick={() => void c.withdraw().then(() => setWithdrawing(false))} data-operator-withdraw-yes="">Confirmer le retrait</button>
                      <button type="button" className={styles.secondary} disabled={view.busy} onClick={() => setWithdrawing(false)}>Annuler</button>
                    </div>
                  </div>
                ) : (
                  <button type="button" className={styles.secondary} disabled={view.busy || Boolean(view.pending)} onClick={() => setWithdrawing(true)} data-operator-withdraw="">Retirer la publication</button>
                )}
              </>
            ) : (
              <p className={styles.hint}>Les pages publiques affichent « À renseigner par l’exploitant ».</p>
            )}
          </aside>
        </div>
      )}
    </section>
  );
}
