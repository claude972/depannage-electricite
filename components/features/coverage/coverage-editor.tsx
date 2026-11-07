"use client";
// Admin editor of the published postal coverage (PUB-03), platform admin (server-enforced). The list
// starts empty (never prefilled); codes are added explicitly (5 digits, deduplicated, ≤ 250) and
// removed one by one. Publish / withdraw each need an explicit confirmation. One command at a time,
// stored in this tab under `courant-private-coverage:<uid>:<generation>` and read back before the POST;
// a lost reply / 503 / 429 offers « Réessayer » with the SAME command; 409 ⇒ honest message + reload;
// 401/403 clear everything. Demo: honest note, zero calls. Logic in ./model.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { EDITOR_COPY, EDITOR_INITIAL, MAX_CODES, createEditor, parseCodes, sortedCodes, tabStore, type Context, type EditorView, type Store } from "./model";
import styles from "./coverage.module.css";

const uuid = (): string | null => (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : null);
export type CoverageEditorProps = { demo: boolean; context: Context; fetcher?: typeof fetch; store?: () => Store | null; newId?: () => string | null };

export function CoverageEditor(props: CoverageEditorProps) {
  if (props.demo)
    return (
      <section className={styles.panel} aria-labelledby="coverage-editor-title" data-coverage-editor="demo">
        <h2 id="coverage-editor-title">{EDITOR_COPY.title}</h2>
        <p className={styles.note}>{EDITOR_COPY.demo}</p>
      </section>
    );
  return <Editor {...props} />;
}

function useWait(seconds: number | null, key: unknown) {
  const [waiting, setWaiting] = useState(false);
  useEffect(() => {
    if (!seconds) return setWaiting(false);
    setWaiting(true);
    const t = setTimeout(() => setWaiting(false), seconds * 1000);
    return () => clearTimeout(t);
  }, [seconds, key]);
  return waiting;
}

function Editor({ fetcher, store = tabStore, newId = uuid, context }: CoverageEditorProps) {
  const [view, setRaw] = useState<EditorView>(EDITOR_INITIAL);
  const ref = useRef(view);
  const set = (next: EditorView) => {
    ref.current = next;
    setRaw(next);
  };
  const latest = useRef({ fetcher, store, newId, context });
  latest.current = { fetcher, store, newId, context };
  const ctrl = useRef<ReturnType<typeof createEditor> | null>(null);
  ctrl.current ??= createEditor({
    fetcher: () => latest.current.fetcher ?? ((...a) => fetch(...a)),
    store: () => latest.current.store(),
    newId: () => latest.current.newId(),
    context: { generation: () => latest.current.context.generation(), userId: () => latest.current.context.userId() },
    get: () => ref.current,
    set,
  });
  const c = ctrl.current;
  useEffect(() => {
    c.restorePending();
    void c.load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [codes, setCodes] = useState<string[]>([]);
  const [entry, setEntry] = useState("");
  const [entryMsg, setEntryMsg] = useState("");
  const [confirm, setConfirm] = useState<"publish" | "withdraw" | null>(null);
  const wait = useWait(view.pending ? view.waitS : null, view.error);
  const data = view.data;
  const published = data?.postal_codes ?? [];

  if (view.phase === "forbidden")
    return (
      <section className={styles.panel} aria-labelledby="coverage-editor-title" data-coverage-editor="forbidden">
        <h2 id="coverage-editor-title">{EDITOR_COPY.title}</h2>
        <p className={styles.note}>{EDITOR_COPY.forbidden}</p>
      </section>
    );

  const add = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const out = parseCodes(entry, codes);
    setCodes(sortedCodes([...codes, ...out.added]));
    const parts: string[] = [];
    if (out.added.length) parts.push(`${out.added.length} code(s) ajouté(s).`);
    if (out.invalid.length) parts.push(`Ignoré(s), pas cinq chiffres : ${out.invalid.join(", ")}.`);
    if (out.duplicates.length) parts.push(`Déjà dans la liste : ${out.duplicates.join(", ")}.`);
    if (out.overflow) parts.push(`Limite de ${MAX_CODES} codes atteinte.`);
    if (!parts.length) parts.push("Saisissez un ou plusieurs codes postaux de cinq chiffres.");
    setEntryMsg(parts.join(" "));
    setEntry(out.invalid.join(" "));
  };
  const blocked = view.busy || Boolean(view.pending) || !data;

  return (
    <section className={styles.panel} aria-labelledby="coverage-editor-title" data-coverage-editor={view.phase} aria-busy={view.busy || undefined}>
      <h2 id="coverage-editor-title">{EDITOR_COPY.title}</h2>
      <p className={styles.hint}>{EDITOR_COPY.intro}</p>
      {view.phase === "loading" && <p className={styles.hint} role="status">{EDITOR_COPY.loading}</p>}
      {view.phase === "error" && (
        <div className={styles.note} role="alert">
          <p className={styles.error}>{view.error}</p>
          <button type="button" className={styles.secondary} onClick={() => void c.load()}>Réessayer</button>
        </div>
      )}
      {data && (
        <div className={styles.block} data-coverage-published={data.version}>
          <h3>Liste publiée {data.version > 0 ? `(version ${data.version})` : ""}</h3>
          {published.length ? (
            <ul className={styles.codes} aria-label="Codes postaux publiés">
              {published.map((p) => <li key={p} className={styles.code}>{p}</li>)}
            </ul>
          ) : (
            <p className={styles.hint}>{EDITOR_COPY.none}</p>
          )}
        </div>
      )}
      {data && (
        <div className={styles.block} data-coverage-draft={codes.length}>
          <h3>Nouvelle liste à publier ({codes.length}/{MAX_CODES})</h3>
          <form className={styles.row} onSubmit={add} noValidate>
            <label className={styles.field}>
              Codes postaux (séparés par des espaces ou des virgules)
              <input type="text" inputMode="numeric" autoComplete="off" value={entry} onChange={(e) => setEntry(e.target.value)} />
            </label>
            <button type="submit" className={styles.secondary} disabled={blocked}>Ajouter</button>
          </form>
          {entryMsg && <p className={styles.hint} role="status">{entryMsg}</p>}
          {published.length > 0 && codes.length === 0 && (
            <button type="button" className={styles.secondary} onClick={() => setCodes([...published])} disabled={blocked}>
              Partir de la liste publiée
            </button>
          )}
          {codes.length > 0 && (
            <ul className={styles.codes} aria-label="Nouvelle liste">
              {codes.map((p) => (
                <li key={p} className={styles.code}>
                  {p}
                  <button type="button" className={styles.remove} aria-label={`Retirer ${p}`} onClick={() => setCodes(codes.filter((x) => x !== p))} disabled={blocked}>×</button>
                </li>
              ))}
            </ul>
          )}
          <div className={styles.actions}>
            <button type="button" className={styles.primary} onClick={() => setConfirm("publish")} disabled={blocked || codes.length === 0}>Publier cette liste</button>
            {published.length > 0 && (
              <button type="button" className={styles.danger} onClick={() => setConfirm("withdraw")} disabled={blocked}>Retirer la zone publiée</button>
            )}
          </div>
          {confirm && !blocked && (
            <div className={styles.confirm} role="group" aria-labelledby="coverage-confirm" data-coverage-confirm={confirm}>
              <p id="coverage-confirm">
                {confirm === "publish"
                  ? `Publier ${codes.length} code(s) postal(aux) en version ${data.version + 1} : cette liste remplace la liste publiée et devient visible du public sous « Tarifs ». Elle n’engage aucune disponibilité ni aucun délai.`
                  : `Retirer la zone publiée (version ${data.version + 1}) : le public verra « zone non encore publiée ». Aucune demande n’est bloquée.`}
              </p>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={confirm === "publish" ? styles.primary : styles.danger}
                  onClick={async () => {
                    const action = confirm;
                    setConfirm(null);
                    const ok = action === "publish" ? await c.publish(codes) : await c.withdraw();
                    if (ok && action === "publish") setCodes([]);
                  }}
                >
                  {confirm === "publish" ? "Confirmer la publication" : "Confirmer le retrait"}
                </button>
                <button type="button" className={styles.secondary} onClick={() => setConfirm(null)}>Annuler</button>
              </div>
            </div>
          )}
        </div>
      )}
      {view.busy && <p className={styles.hint} role="status">Envoi…</p>}
      {view.notice && <p className={styles.ok} role="status" data-coverage-notice="">{view.notice}</p>}
      {view.phase !== "error" && view.error && (
        <div className={styles.note} role="alert" data-coverage-error="">
          <p className={styles.error}>{view.error}{view.pending && wait && view.waitS ? ` (réessayez dans ${view.waitS} s)` : ""}</p>
          {view.pending && (
            <div className={styles.actions}>
              <button type="button" className={styles.secondary} onClick={() => void c.retry()} disabled={view.busy || wait}>Réessayer</button>
              <button type="button" className={styles.secondary} onClick={() => c.discard()} disabled={view.busy}>Abandonner</button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
